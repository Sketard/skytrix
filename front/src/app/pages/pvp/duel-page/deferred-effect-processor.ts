// =============================================================================
// deferred-effect-processor.ts — β.2a (2026-05-26) + β.3 cas #12 (2026-05-26)
// -----------------------------------------------------------------------------
// Materialises cross-event temporal correlations as explicit `DeferredEffect` /
// `EffectReady` / `EffectAbandoned` markers on the duel's EventStream. The
// projections (β.3+) consume the markers; the YGO knowledge of "what waits on
// what" lives here, in the `RULES` table, and nowhere else. Cf.
// `_bmad-output/planning-artifacts/duel-session-chantier.md §3.7` +
// `_bmad-output/planning-artifacts/beta-2-deferred-effect-processor-spec.md`.
//
// β.2a shipped the INFRASTRUCTURE only: the observe loop, the timer / collision
// / checkpoint / silentReset mechanics, the `ResetTarget` integration, and an
// EMPTY `RULES` table. β.2b populated `RULES` with 5 working ObserverRule.
//
// β.3 cas #12 introduces a second rule family — `RewriterRule` — capable of
// synthesizing virtual events at trigger time and absorbing later events
// (drop the routing aval). See `ARCHITECTURE GUARD` block above
// `RewriterRule` interface. Cf. spec
// `_bmad-output/planning-artifacts/beta-3-case-12-xyz-leave-with-materials-spec.md`.
//
// **Plain class**, NOT `@Injectable`. Owned + constructed privately by the
// `AnimationOrchestratorService` so the DEP observes the SAME `pushToStream`
// convergence point boundary events / runner transport events / MSG_*
// in-queue tap all flow through. This is the only way to observe transport
// (runner) events alongside the WS messages in the order they appear on
// the stream; placing the DEP under `DuelEventProcessor` (the BP's host)
// would only see the WS slice.
//
// **Scope**: `CONNECTION_LIFETIME`. PerspectiveSwitched does NOT abandon
// open deferreds (cf. §3.7bis lifecycle bullet); STATE_SYNC / RematchStarted
// (which cascade DUEL → CONNECTION) do. The scope hierarchy filter inside
// `ScopeResetDispatcher` enforces this — a PERSPECTIVE-only dispatch
// reaches no target whose scope is CONNECTION or deeper.
//
// **Timing model**: a deferred is opened by a rule's `trigger`,
// optionally re-armed by `chainTo` (for compound predicates per §3.1),
// closed by a matching flux event (`EffectReady`), evicted by collision
// (`EffectAbandoned(timeout)` on the displaced entry), aged out by
// `DEFERRED_TIMEOUT_MS` (`EffectAbandoned(timeout)`), or wiped en masse
// by `applyReset` (`EffectAbandoned(checkpoint)`). The internal `_active`
// map is keyed by `name` — collisions are an INVARIANT VIOLATION
// (duelAssert in dev, warn-and-evict in prod, never silent overlap).
// =============================================================================

import type {
  ResetTarget,
  ScopeCategory,
} from '../projections';
import type {
  AwaitingPredicate,
  DeferredEffectEvent, DeferredFluxEvent,
  EffectAbandonedEvent, EffectReadyEvent, StreamEvent,
} from '../types';
import type { MoveMsg } from '../duel-ws.types';
import { DEFERRED_TIMEOUT_MS } from './animation-constants';
import { duelAssert } from '../../../core/utilities/duel-assert';
import type { DuelLogger } from './duel-logger';

// Re-export the FluxEvent alias the DEP works with — the wider StreamEvent
// union from `types/` (palier 0 + β.1 boundary + β.2 deferred + α.3
// transport, all merged at β.2a). The DEP itself never narrows to MSG_*
// because rules legitimately match boundary or transport events.
type FluxEvent = StreamEvent;

/** Minimal clock interface — lets specs inject a fake-timer instead of
 *  reaching for global `setTimeout`. Mirrors the pattern used by other
 *  DEP-adjacent classes (cf. `PollDropWatchdog`). */
export interface DeferredClock {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

const REAL_CLOCK: DeferredClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
};

// ---------------------------------------------------------------------------
// Rule type union (β.3 cas #12) — `ObserverRule | RewriterRule`
// ---------------------------------------------------------------------------

/**
 * Champs partagés par toutes les rules — déclaratif, observable depuis
 * le flux. Aucun side-effect, aucune ressource externe.
 */
export interface BaseRule {
  /**
   * Décide si le `event` courant ouvre une nouvelle deferred. La rule
   * est responsable d'être suffisamment narrow pour qu'un event sans
   * rapport ne la déclenche pas.
   */
  trigger: (event: FluxEvent) => boolean;
  /**
   * Identifiant stable de la deferred — typiquement
   * `<family>:<chainIndex>` ou `<family>:<cardCode>:<ref>`. Les noms
   * DOIVENT être uniques parmi les deferreds simultanément ouvertes ;
   * une collision est une INVARIANT VIOLATION surfacée par `duelAssert`.
   */
  deriveName: (event: FluxEvent, triggerRef: number) => string;
  /**
   * Décrit le matcher littéral que la deferred attend pour se fermer.
   */
  derivePredicate: (event: FluxEvent, triggerRef: number) => AwaitingPredicate;
}

/**
 * Rule classique (observer). Pure du point de vue du flux : lit, décide,
 * marque. Pas de side-effect, pas de synthèse, pas d'absorption.
 *
 * Les 5 rules de β.2b (overlay-show, trigger-show, attack-impact,
 * lp-cost, counter-pulse) sont tous des ObserverRule. Le discriminant
 * `kind?: 'observer'` est OPTIONNEL — un rule sans `kind` est traité
 * comme `ObserverRule`. Garantit la compat ascendante stricte sur les
 * 5 rules existants : aucune migration de leur code nécessaire à β.3.
 */
export interface ObserverRule extends BaseRule {
  kind?: 'observer';
  /**
   * Re-arm la deferred avec un nouveau predicate (compound flow) ou la
   * close (retourner `null` = close + EffectReady).
   *
   * `matchedRef` est la valeur que portait le matched event au push
   * sur le stream — typiquement embarqué dans le nouveau predicate
   * (e.g. `{kind:'animation', type:'AnimationCompleted', ref:
   * matchedRef}`) pour pinner la prochaine étape sur l'animation du
   * matched event.
   */
  chainTo?: (
    matchedEvent: FluxEvent,
    matchedRef: number,
    deferred: ActiveDeferredView,
  ) => AwaitingPredicate | null;
}

/**
 * ⚠️ ARCHITECTURE GUARD (β.3 cas #12, 2026-05-26)
 *
 * `RewriterRule` est la famille « Flow rewrite » (catalogue ε3 §1bis).
 * Elle ROMPT l'invariant pure-observer du DEP : elle synthétise des
 * events virtuels via `onTrigger` (side-effect sortant) et absorbe des
 * events ultérieurs via `chainTo` retournant `{kind: 'absorb'}` /
 * `{kind: 'absorb-and-close'}` (side-effect entrant — drop du routing
 * aval).
 *
 * Aujourd'hui UN SEUL RewriterRule existe : `xyzLeaveWithMaterials`.
 *
 * AVANT D'AJOUTER UN 2e RewriterRule — REVUE D'ARCHI OBLIGATOIRE.
 * Rule of Three : à 2 cas du même genre, extraire un processor séparé
 * `FlowRewriteProcessor` est probablement la meilleure réponse, plutôt
 * que d'élargir la famille rewriter dans le DEP.
 *
 * Le test invariant `deferred-effect-rules.spec.ts`
 *   "β.3 cas #12 — at most one RewriterRule allowed without architecture review"
 * verrouille cette garde au build CI (compile-test time).
 *
 * Cf. décisions A1 + B2 architecture review β.3 cas #12.
 * Cf. spec d'impl `beta-3-case-12-xyz-leave-with-materials-spec.md`
 *   §2.1 + §10 hors-scope.
 */
export interface RewriterRule extends BaseRule {
  kind: 'rewriter';

  /**
   * Side-effect au moment du trigger. Acquiert des ressources (locks,
   * etc.) + synthétise des events virtuels via le sink. Retourne
   * `{payload?}` — le payload sera porté tel quel par la deferred et
   * passé à `chainTo` (lecture seule pour le DEP, mutable côté rule)
   * et à `onClose?` (libération de ressources).
   */
  onTrigger: (
    event: FluxEvent,
    triggerRef: number,
    sinks: RuleSinks,
  ) => { payload?: unknown };

  /**
   * Hook de libération appelé sur TOUS les chemins de fermeture de la
   * deferred :
   *   - `'matched'`     — `chainTo` a retourné `null` / `absorb-and-close`.
   *   - `'timeout'`     — `DEFERRED_TIMEOUT_MS` écoulé sans match.
   *   - `'checkpoint'`  — `applyReset({CONNECTION_LIFETIME})`.
   *
   * Pattern try/finally formalisé au niveau du contrat de rule —
   * permet de release un lock / un timer / un float préparé sans
   * fuite, peu importe le chemin. `silentReset` NE l'appelle PAS
   * (intentionnel — le stream subscriber meurt avec le même scope,
   * émettre une closure polluerait un stream que personne ne lit).
   */
  onClose?: (
    payload: unknown,
    reason: CloseReason,
  ) => void;

  /**
   * Verdict étendu — peut retourner les verbes classiques
   * (`AwaitingPredicate` / `null`) OU les nouveaux verbes
   * d'absorption.
   */
  chainTo: (
    matchedEvent: FluxEvent,
    matchedRef: number,
    deferred: ActiveDeferredView,
  ) => RewriterVerdict;
}

/**
 * Verdict retourné par `RewriterRule.chainTo`. Discrimination par valeurs
 * spécifiques `'absorb'` / `'absorb-and-close'` AVANT typage comme
 * `AwaitingPredicate` — cf. `interpretRewriterVerdict` ci-dessous.
 *
 * - `AwaitingPredicate` (truthy, peut avoir un champ `kind` qui n'est
 *   PAS `'absorb'` ni `'absorb-and-close'`) → re-arm.
 * - `null` → close + EffectReady.
 * - `{kind: 'absorb'}` → drop le routing aval, deferred reste ouverte.
 * - `{kind: 'absorb-and-close'}` → drop le routing aval + close + EffectReady.
 */
export type RewriterVerdict =
  | AwaitingPredicate
  | null
  | { kind: 'absorb' }
  | { kind: 'absorb-and-close' };

export type DeferredRule = ObserverRule | RewriterRule;

/** Raisons de fermeture d'une deferred — passées à `RewriterRule.onClose?`. */
export type CloseReason = 'matched' | 'timeout' | 'checkpoint';

// ---------------------------------------------------------------------------
// RuleSinks (β.3 cas #12) — surface d'effet pour les RewriterRule
// ---------------------------------------------------------------------------

/**
 * Sinks exposés aux `RewriterRule` au moment de `onTrigger`.
 * Intentionnellement minimal — chaque méthode est un POINT DE COUPLAGE
 * du DEP avec le reste de l'app. Ajouter une méthode = inviter un
 * nouveau use case ; à faire en revue d'archi, pas opportunément.
 *
 * Le sink par défaut (`NO_OP_SINKS`) fait rien — utilisable comme test
 * seam ET comme câblage de production. Voir doctrine ci-dessous : la
 * production utilise `NO_OP_SINKS` par choix (pas par dette), parce
 * qu'aucune anim de remplacement n'est désirée pour les settlings
 * absorbés (cf. xyzLeaveWithMaterials).
 *
 * Résolution Q5 audit Commit 1 (Axel 2026-05-26) — 2 méthodes.
 * `lockZone(zoneId, absolutePlayer)` accepte un index absolu ; la
 * conversion absolu→relatif est INTERNE au sink (via
 * `ctx.relativePlayer`). La rule reste agnostique de la convention
 * DOM `${zoneId}-${relPlayer}`.
 */
export interface RuleSinks {
  /**
   * Enqueue N events virtuels APRÈS l'event courant en cours de
   * dispatch, AVANT les events suivants déjà enqueués mais pas encore
   * dispatchés. Si appelé en dehors d'un dispatch (queue vide),
   * insère en tête de queue.
   *
   * Les events fournis DOIVENT être taggués virtuels via
   * `tagAsVirtual` du `virtual-event-registry` (cf. §4.6 spec cas #12).
   */
  enqueueVirtualMoves: (events: readonly MoveMsg[]) => void;

  /**
   * Acquiert un lock ref-compté externe sur la zone identifiée par
   * `(zoneId, absolutePlayer)`. Le sink fait la conversion
   * absolu→relatif via `ctx.relativePlayer` et construit la zone key
   * DOM `${zoneId}-${relPlayer}` en interne.
   *
   * Le rule DOIT release ce lock via le hook `onClose?(payload, reason)`
   * — sur les 3 chemins (matched / timeout / checkpoint). Pattern
   * try/finally encodé par l'API. Sans release, fuite de lock = zone
   * jamais re-committée = bug visuel persistant.
   *
   * Le lock externe est superposable aux locks internes que les
   * handlers acquièrent eux-mêmes — c'est du ref-counting, donc
   * indépendant. La zone reste rendered DOM tant que l'un OU l'autre
   * est actif.
   */
  lockZone: (zoneId: number, absolutePlayer: number) => ZoneLock;
}

/**
 * Sentinel pour les zones lockables. La méthode `release()` peut être
 * appelée plusieurs fois sans erreur (idempotent) — aide pour les
 * branches `onClose?` qui peuvent être appelées sur plusieurs chemins
 * fermant la même deferred (matched + checkpoint en cascade dans un
 * burst).
 *
 * Différent de `RenderedBoardStateService.ZoneLock` (qui expose aussi
 * `commit()`) — ce ZoneLock-ci est minimaliste, dédié au DEP. Le sink
 * réel (Commit 2) wrappe le `RenderedBoardStateService.ZoneLock` et
 * n'expose que `release()` (le commit est implicite à la dernière
 * release par ref-counting).
 */
export interface ZoneLock {
  release: () => void;
}

/**
 * Default sinks — no-op pour tests ET pour la production. Le câblage
 * réel (`dataSource.enqueueVirtualMoves` + `rbs.lockZone`) a été
 * envisagé puis abandonné par décision design (Axel 2026-06-01) :
 *
 *   Le settling XYZ matériaux GY→GY n'a PAS besoin d'animation de
 *   remplacement. Le `RewriterRule` `xyzLeaveWithMaterials` absorbe
 *   correctement les N MSG_MOVE settlings côté journal (plus de
 *   doublons "→ Graveyard"), et l'absence de visuel pour ces
 *   settlings est volontaire — un travel OVERLAY→GRAVE depuis la
 *   zone MZONE du XYZ source ne porte aucune information utile au
 *   joueur. Le `pileToPile` pré-U16 (flashs dans le GY) était de
 *   toute façon laid.
 *
 * `enqueueVirtualMoves` reste no-op + l'`onTrigger` du rule peut
 * encore synthétiser des virtuels (ils partent dans le vide) pour
 * garder la rule auto-suffisante côté contract — si un futur
 * scenario veut réellement un visuel de remplacement, il suffit
 * de câbler ce sink sans toucher au rule.
 */
export const NO_OP_SINKS: RuleSinks = {
  enqueueVirtualMoves: () => { /* by design: no replacement anim for absorbed settlings */ },
  lockZone: () => ({ release: () => { /* no-op */ } }),
};

// ---------------------------------------------------------------------------
// ActiveDeferred — état interne portant payload + rule
// ---------------------------------------------------------------------------

/**
 * View passed to `chainTo` — exposes the DEP's bookkeeping fields
 * (name / triggerRef / awaitingPredicate) as read-only and the
 * rule-owned payload as **deliberately mutable** (post-review M3).
 *
 * Why `payload` is not `readonly` :
 *  · `readonly` in TypeScript blocks reassignment only, not deep
 *    mutation — `payload.x = …` compiles either way.
 *  · The actual contract is "payload is owned by the rule after
 *    `onTrigger` returns". Rules like `xyzLeaveWithMaterials` mutate
 *    `payload.expectedCardCodes` and `payload.remaining` inside
 *    `chainTo` ; this is the supported pattern, not an escape hatch.
 *  · A prior `readonly unknown` annotation was misleading both ways :
 *    it didn't protect at runtime, and it suggested the rule should
 *    return a new payload (which the verdict shape doesn't support).
 */
export interface ActiveDeferredView {
  readonly name: string;
  readonly triggerRef: number;
  readonly awaitingPredicate: AwaitingPredicate;
  /**
   * β.3 cas #12 — opaque pour le DEP (jamais lu côté DEP), mutable
   * côté rule. Stocké au moment de `openDeferred` via
   * `RewriterRule.onTrigger` qui retourne `{payload?}`. Passé à
   * `chainTo` et à `onClose?` tel quel. Permet de porter un état
   * inter-events (compteur de matériaux restants, lock acquis, etc.)
   * sans que le DEP ait à le connaître.
   */
  payload?: unknown;
}

interface ActiveDeferred extends ActiveDeferredView {
  awaitingPredicate: AwaitingPredicate;
  timerId: ReturnType<typeof setTimeout>;
  /** The rule that opened this deferred. Stored so `tryRearm` / close
   *  / abandon paths can reach `chainTo` / `onClose?` in O(1) without
   *  scanning the rules table. */
  rule: DeferredRule;
  /** Mutable payload — un rule peut le muter au fil des `chainTo`
   *  (decrement counters, etc.). */
  payload?: unknown;
}

/**
 * Default empty rule set. Production callers should pass the populated
 * `RULES` from `deferred-effect-rules.ts` via the constructor's `rules`
 * argument. Kept exported (and empty) so a DEP instantiated without an
 * explicit `rules` argument (test seam, defensive prod) stays a no-op.
 */
export const RULES: readonly DeferredRule[] = [];

export class DeferredEffectProcessor implements ResetTarget {
  readonly scope: ScopeCategory = 'CONNECTION_LIFETIME';

  /** Active deferreds keyed by `name`. Size N ≤ 11 in steady-state, so
   *  the per-event O(N) matcher pass is negligible. */
  private readonly _active = new Map<string, ActiveDeferred>();
  /** Monotonic counter used when `observe(event)` is called without an
   *  explicit `ref` (test seam + back-compat path). Production callers
   *  (the orchestrator) pass their own central ref via
   *  `observe(event, ref)` and the internal counter is ignored. */
  private _nextRef = 0;

  /**
   * @param emit  Sink for emitted `DeferredFluxEvent`s. Same contract as
   *              `BoundaryProcessor.emit` — fire-and-forget, the DEP
   *              does not handle sink failures.
   * @param getLogger  Lazy accessor so the orchestrator can assign its
   *              `DuelLogger` AFTER constructing the DEP without binding
   *              `undefined` at field-init time (mirror of the BP pattern).
   * @param clock Optional fake-timer hook for specs. Defaults to real
   *              `setTimeout`/`clearTimeout`.
   * @param rules Optional rule table override (test injection). Production
   *              uses the module-level `RULES` constant.
   * @param sinks β.3 cas #12 — sinks exposés aux `RewriterRule` au
   *              moment de `onTrigger`. Default `NO_OP_SINKS` (back-
   *              compat + tests legacy). Production (Commit 2) wire
   *              `dataSource.enqueueVirtualMoves` + `rbs.lockZone`.
   */
  constructor(
    private readonly emit: (event: DeferredFluxEvent) => void,
    private readonly getLogger: () => DuelLogger | undefined = () => undefined,
    private readonly clock: DeferredClock = REAL_CLOCK,
    private readonly rules: readonly DeferredRule[] = RULES,
    private readonly sinks: RuleSinks = NO_OP_SINKS,
  ) {}

  /**
   * Observe a flux event in arrival order. Two phases, strict order:
   *  (a) Drain — match the event against every active deferred's
   *      `awaitingPredicate`. Each match either re-arms the deferred
   *      (via `chainTo`, passing the captured `ref` so a rule can
   *      target the matched event's animation completion), emits
   *      `EffectReady` + drops the entry, OR (β.3 cas #12) absorbs
   *      the event from routing aval (RewriterRule only).
   *  (b) Open — match the event against every rule's `trigger`. Each
   *      match opens a new deferred + emits `DeferredEffect`. For
   *      `RewriterRule`, also calls `onTrigger(event, ref, sinks)` and
   *      stores the returned `payload` on the active deferred.
   *
   * (a) runs BEFORE (b) so a single event can both fulfill an existing
   * deferred AND trigger a new one of the same name without collision.
   *
   * `ref` is the monotonic counter assigned by the orchestrator's
   * `pushToStream` — the SAME ref the matching `AnimationStarted` /
   * `AnimationCompleted` events will carry, so a `chainTo` callback
   * can construct a predicate `{kind:'animation', ref: matchedRef}`.
   * If omitted (test seam) the DEP uses its own internal counter.
   *
   * @returns `{absorbed: true}` if at least one `RewriterRule` deferred
   *          absorbed the event (the orchestrator should SKIP the
   *          routing aval + emit synthetic `AnimationStarted` /
   *          `AnimationCompleted` markers for stream consistency).
   *          `{absorbed: false}` otherwise — the common case.
   */
  observe(
    event: FluxEvent,
    ref: number = this._nextRef++,
  ): { absorbed: boolean } {
    const drainResult = this.drainMatchingDeferreds(event, ref);
    this.openDeferredsForRules(event, ref);
    return drainResult;
  }

  // ---------------------------------------------------------------------------
  // ResetTarget contract — scope-driven fan-out
  // ---------------------------------------------------------------------------

  /**
   * α.4b/β.2a `ResetTarget` entry. Routes the reset by scope membership:
   *   - `CONNECTION_LIFETIME` present (STATE_SYNC / RematchStarted) →
   *     emit `EffectAbandoned(reason='checkpoint')` for every active
   *     deferred (in insertion order), then clear `_active` + timers.
   *     Each `RewriterRule.onClose?(payload, 'checkpoint')` is called
   *     BEFORE the emit (β.3 cas #12, decision D2 — release garanti).
   *   - Otherwise (e.g. PERSPECTIVE_LIFETIME) → no-op. The dispatcher's
   *     own scope filter already prevents the call in PERSPECTIVE-only
   *     dispatches, but the guard is kept for clarity + defense in
   *     depth.
   */
  applyReset(invalidatedScopes: ReadonlySet<ScopeCategory>): void {
    if (!invalidatedScopes.has('CONNECTION_LIFETIME')) return;
    this.abandonAllActive('checkpoint');
  }

  /**
   * Silent reset — drops every active deferred + clears every timer
   * WITHOUT emitting `EffectAbandoned` and WITHOUT calling
   * `RewriterRule.onClose?`. Mirror of `BoundaryProcessor.silentReset()`:
   * called by `DuelEventProcessor.reset()` on hard teardown (duel
   * destroy / fresh start) where the stream subscriber dies with the
   * same scope, so emitting closures would only pollute a stream
   * nobody reads.
   *
   * Use `applyReset({CONNECTION_LIFETIME})` from a §3.6 checkpoint when
   * the journal SHOULD see the closures + the rules SHOULD release
   * their resources.
   */
  silentReset(): void {
    for (const deferred of this._active.values()) {
      this.clock.clearTimeout(deferred.timerId);
    }
    this._active.clear();
  }

  // ---------------------------------------------------------------------------
  // Test-only inspection — used by `deferred-effect-processor.spec.ts`
  // ---------------------------------------------------------------------------

  /** Number of currently active deferreds. Test-only — projections MUST
   *  derive their state from `EffectReady`/`EffectAbandoned` events on
   *  the flux (DP-4: no `activeNames` signal exposed). */
  activeCount(): number { return this._active.size; }

  /** Return the active deferred's view by name, or `undefined`.
   *  Test-only — same DP-4 reasoning as `activeCount`. */
  peekActive(name: string): ActiveDeferredView | undefined {
    return this._active.get(name);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private drainMatchingDeferreds(
    event: FluxEvent,
    ref: number,
  ): { absorbed: boolean } {
    let absorbed = false;
    // Iterate over a snapshot so mid-iteration `_active.delete` + reopen
    // by `chainTo` are safe. Map insertion order is preserved by JS
    // semantics, so collisions later evict the older entry deterministically.
    for (const [name, deferred] of [...this._active]) {
      if (!this.matches(event, deferred.awaitingPredicate)) continue;

      // β.3 cas #12 — branchement par `kind` du rule. RewriterRule
      // peut retourner les nouveaux verbes 'absorb' / 'absorb-and-close'
      // en plus des verbes classiques (AwaitingPredicate / null).
      if (deferred.rule.kind === 'rewriter') {
        const verdict = deferred.rule.chainTo(event, ref, deferred);
        const action = this.interpretRewriterVerdict(verdict);
        switch (action.kind) {
          case 'rearm':
            this.rearmInPlace(deferred, action.predicate);
            break;
          case 'close':
            this.closeReady(name, deferred, 'matched');
            break;
          case 'absorb':
            absorbed = true;
            break;
          case 'absorb-and-close':
            absorbed = true;
            this.closeReady(name, deferred, 'matched');
            break;
        }
      } else {
        // ObserverRule (legacy) — chainTo retourne AwaitingPredicate |
        // null | undefined. Aucun changement de comportement vs β.2b.
        const rearmed = this.tryRearmObserver(event, ref, deferred);
        if (rearmed) continue;
        this.closeReady(name, deferred, 'matched');
      }
    }
    return { absorbed };
  }

  /**
   * β.3 cas #12 — discrimine le `RewriterVerdict`. Test sur valeurs
   * spécifiques `'absorb'` / `'absorb-and-close'` AVANT typage comme
   * `AwaitingPredicate` — résolution Q2 audit (Axel 2026-05-26,
   * Option B). Un `AwaitingPredicate` peut LUI AUSSI avoir un champ
   * `kind` (e.g. `{kind: 'animation', type: 'AnimationCompleted',
   * ref: 42}` est un rearm valide), donc l'ordre de test est
   * critique.
   */
  private interpretRewriterVerdict(
    verdict: RewriterVerdict,
  ):
    | { kind: 'close' }
    | { kind: 'absorb' }
    | { kind: 'absorb-and-close' }
    | { kind: 'rearm'; predicate: AwaitingPredicate }
  {
    if (verdict === null) return { kind: 'close' };
    const k = (verdict as { kind?: string }).kind;
    if (k === 'absorb') return { kind: 'absorb' };
    if (k === 'absorb-and-close') return { kind: 'absorb-and-close' };
    return { kind: 'rearm', predicate: verdict as AwaitingPredicate };
  }

  private openDeferredsForRules(event: FluxEvent, ref: number): void {
    for (const rule of this.rules) {
      if (!rule.trigger(event)) continue;
      this.openDeferred(rule, event, ref);
    }
  }

  /** Test the literal-equality matcher (Z2). `undefined` fields in the
   *  predicate are wildcards; defined fields require strict equality. */
  private matches(event: FluxEvent, predicate: AwaitingPredicate): boolean {
    const candidate = event as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(predicate)) {
      if (expected === undefined) continue;
      if (candidate[key] !== expected) return false;
    }
    return true;
  }

  private openDeferred(rule: DeferredRule, event: FluxEvent, ref: number): void {
    const name = rule.deriveName(event, ref);
    if (this._active.has(name)) {
      // Z6 — collisions of `name` are an invariant violation. duelAssert
      // throws in dev; in prod we abandon the older entry with
      // `EffectAbandoned(timeout)` so the stream stays consistent + warn
      // for DevHub visibility.
      duelAssert(
        false,
        'DeferredEffectProcessor.openDeferred',
        `name "${name}" already active (existing triggerRef=${this._active.get(name)!.triggerRef})`,
      );
      this.getLogger()?.warn(
        '[DEFERRED] collision on name "%s" — abandoning previous', name);
      this.abandonByName(name, 'timeout');
    }
    const predicate = rule.derivePredicate(event, ref);
    const timerId = this.clock.setTimeout(
      () => this.timeoutAbandon(name),
      DEFERRED_TIMEOUT_MS,
    );

    // β.3 cas #12 — call `onTrigger` for RewriterRule (side-effects:
    // enqueue virtuals, acquire locks). Returns the payload to store
    // on the active deferred. Done AFTER the timer is armed so a
    // synchronous re-entry from a sink (unlikely but defensive) finds
    // the deferred ready.
    let payload: unknown | undefined;
    if (rule.kind === 'rewriter') {
      const result = rule.onTrigger(event, ref, this.sinks);
      payload = result.payload;
    }

    this._active.set(name, {
      name, triggerRef: ref, awaitingPredicate: predicate, timerId, rule, payload,
    });
    this.emit({
      kind: 'deferred', type: 'DeferredEffect',
      name, triggerRef: ref, awaitingPredicate: predicate,
    } satisfies DeferredEffectEvent);
  }

  /**
   * Re-arm un deferred ObserverRule via son `chainTo` optionnel.
   * Renvoie `true` ssi la deferred a été re-armée (chainTo défini ET
   * retournant un nouveau predicate).
   */
  private tryRearmObserver(
    event: FluxEvent,
    matchedRef: number,
    deferred: ActiveDeferred,
  ): boolean {
    if (deferred.rule.kind === 'rewriter') return false; // type-narrow guard
    if (!deferred.rule.chainTo) return false;
    const nextPredicate = deferred.rule.chainTo(event, matchedRef, deferred);
    if (nextPredicate === null) return false;
    this.rearmInPlace(deferred, nextPredicate);
    return true;
  }

  /**
   * Re-arm un deferred IN PLACE — fresh timer, fresh predicate, même
   * nom + même triggerRef. NE PAS appeler `onClose?` (la deferred
   * n'est pas fermée).
   */
  private rearmInPlace(deferred: ActiveDeferred, nextPredicate: AwaitingPredicate): void {
    this.clock.clearTimeout(deferred.timerId);
    deferred.awaitingPredicate = nextPredicate;
    deferred.timerId = this.clock.setTimeout(
      () => this.timeoutAbandon(deferred.name),
      DEFERRED_TIMEOUT_MS,
    );
  }

  private closeReady(
    name: string,
    deferred: ActiveDeferred,
    reason: CloseReason,
  ): void {
    this.clock.clearTimeout(deferred.timerId);
    this._active.delete(name);

    // β.3 cas #12 — release des ressources du rule (lock, timer, etc.)
    // AVANT l'émission de l'EffectReady, pour que tout consumer du flux
    // qui observe l'EffectReady voie un état déjà nettoyé.
    if (deferred.rule.kind === 'rewriter') {
      deferred.rule.onClose?.(deferred.payload, reason);
    }

    this.emit({
      kind: 'deferred', type: 'EffectReady',
      name, triggerRef: deferred.triggerRef,
    } satisfies EffectReadyEvent);
  }

  private abandonByName(name: string, reason: 'timeout' | 'checkpoint'): void {
    const deferred = this._active.get(name);
    if (!deferred) return;
    this.clock.clearTimeout(deferred.timerId);
    this._active.delete(name);

    // β.3 cas #12 — release aussi sur timeout / checkpoint. Garantie
    // no-leak peu importe le chemin de fermeture.
    if (deferred.rule.kind === 'rewriter') {
      deferred.rule.onClose?.(deferred.payload, reason);
    }

    this.emit({
      kind: 'deferred', type: 'EffectAbandoned',
      name, triggerRef: deferred.triggerRef, reason,
    } satisfies EffectAbandonedEvent);
  }

  private abandonAllActive(reason: 'timeout' | 'checkpoint'): void {
    // Snapshot insertion order — `Map` preserves it, so checkpoint
    // emission order matches the order the deferreds were opened. The
    // T-I3 spec asserts this.
    const names = [...this._active.keys()];
    for (const name of names) this.abandonByName(name, reason);
  }

  private timeoutAbandon(name: string): void {
    // Race-safe: if the deferred was matched between the timer arm and
    // the timer fire, `_active.get(name)` is already gone — silent return.
    if (!this._active.has(name)) return;
    this.getLogger()?.warn('[DEFERRED] "%s" timed out after %dms',
      name, DEFERRED_TIMEOUT_MS);
    this.abandonByName(name, 'timeout');
  }
}
