---
title: β.3 cas #12 — xyz-leave-with-materials (spec d'implémentation)
status: ready (pour démarrer le code, dépend de la fin de la session #13)
parent_chantier: duel-session-chantier.md
parent_catalogue: deferred-effects-catalogue.md §1bis + §3.7bis test #5
parent_plan: duel-session-chantier-implementation-plan.md
references:
  - deferred-effects-catalogue.md §1bis (description du rewrite de flux)
  - deferred-effects-catalogue.md §4 test #5 (DUAL assertion)
  - beta-2-deferred-effect-processor-spec.md (API DEP existante)
  - duel-session-chantier.md §3.7 (DEP étendu, famille « Flow rewrite »)
  - CLAUDE.md « DeferredEffectProcessor (β.2a + β.2b, 2026-05-26) »
  - CLAUDE.md « Animation Parity Rule » + « Async Handler Lock Contract »
  - move-animation-router.ts:186 (processOverlayDetachEvent — réutilisé)
  - move-animation-router.ts:147-150 (branche leaveFieldDestroy / leaveFieldNonDestroy)
  - deferred-effect-rules.ts (table actuelle, 5 règles + 5 stubs)
  - deferred-effect-processor.ts (contrat `chainTo` actuel : `AwaitingPredicate | null`)
date: 2026-05-26
author: Claude (architect) + Axel (validation) + Winston (architecture review 2026-05-26)
architecture_review:
  - decision_A: A1 + garde explicite (étendre DEP, commentaire bloquant, test invariant ≤1 RewriterRule)
  - decision_B: B2 — type union `ObserverRule | RewriterRule` (gating compile-time)
  - decision_C: C2 — side-channel `_transport_lastAbsorbed` (mirror de `_transport_lastDispatchedRef`)
  - decision_D: D2 — `onTrigger` retourne `{payload?}` + hook `onClose?(payload, reason)` (release garantie 3 chemins)
  - decision_E: E2 — WeakSet `virtual-event-registry.ts` front-only (protocole WS reste propre)
audit_resolutions_2026-05-26:
  - Q2 (RewriterVerdict discrimination): Option B — test sur valeurs spécifiques `'absorb'` / `'absorb-and-close'` AVANT typage AwaitingPredicate. Pas de wrapper, zéro breaking change sur les 5 ObserverRule.
  - Q5 (RuleSinks méthodes): 2 méthodes. `lockZone(zoneId: number, absolutePlayer: number)` accepte un index absolu, conversion absolu→relatif interne au sink (via `ctx.relativePlayer`). Pas de méthode `relativePlayer` exposée.
  - Q4 (predicate awaiting): Ajouter `player: m.player` au `derivePredicate` pour serrer la mass-destruction bilatérale (robustesse gratuite, matcher strict-equality du DEP).
---

# β.3 cas #12 — `xyz-leave-with-materials` — spec d'implémentation

## §0 Bug visuel à résoudre

Reporté 2026-05-26 par Axel pendant l'audit visuel β.3.

**Symptôme** : quand un monstre XYZ avec N matériaux quitte le terrain
(toute raison — battle destroy, Link material, Tribute Summon, return-
to-deck, banishment), les N ex-matériaux « flashent à tour de rôle dans
le GY » au lieu de voyager visuellement depuis la zone MZONE de l'XYZ
parti.

**Cause racine** : une fois l'XYZ parti, OCGCore émet pour chaque ex-
matériau un message `MSG_MOVE` avec :
- `fromLocation = LOCATION.GRAVE` (la position des matériaux dans
  OCGCore une fois l'XYZ détaché)
- `toLocation = LOCATION.GRAVE`
- `reason = REASON_RULE | REASON_LOST_TARGET = 0x400 | 0x200 = 0x600`
- `fromSequence` / `toSequence` : valeurs internes OCGCore (settling
  positions dans la zone GRAVE après perte de la target XYZ)

Le routeur actuel ([move-animation-router.ts:179-180](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L179-L180))
tombe sur la branche `pileToPile(mc)` (les deux locations sont des
piles). Cette branche anime un travel quasi-statique à l'intérieur du
GY avec `impactGlowColor: GLOW_GY`. Visuellement c'est un flash dans la
zone GY — le bug observé.

**Pourquoi le routeur ne peut pas fixer ça seul** : pour décider si un
`GRAVE → GRAVE reason=0x600` doit être routé en `pileToPile` ou rerouté
vers le flux « ex-matériel d'XYZ », le routeur devrait connaître :
1. L'historique récent du flux (quel XYZ vient de partir, avec quels
   matériaux).
2. Le pattern de bitfield `reason` (croisement YGO/OCGCore).
3. La corrélation cross-event entre le `MSG_MOVE` de l'XYZ et les N
   `MSG_MOVE` settling qui suivent.

C'est exactement le contrat du `DeferredEffectProcessor` (corrélation
cross-event sur le flux). Le routeur reste dispatch-pure ; le DEP
absorbe le pattern + synthétise le visuel correct.

---

## §1 Vue d'ensemble du fix

### 1.1 Le rewrite en 3 étapes

1. **Trigger DEP** — un nouveau `DeferredRule xyzLeaveWithMaterials`
   ouvre une deferred au `MSG_MOVE` d'un XYZ qui quitte
   MZONE/EMZ avec `overlayMaterials.length > 0`.

2. **Absorption** — quand les N `MSG_MOVE GRAVE→GRAVE reason=0x600`
   qui suivent arrivent (`cardCode` ∈ la liste des matériaux du trigger),
   le `chainTo` du rule retourne un nouveau verbe : `{kind:'absorb'}`.
   Le DEP supprime alors l'event du flux côté **routing animation** :
   l'event reste sur l'`_eventStream` (pour le journal et les rules
   suivantes) mais n'est PAS dispatché au `_handleEntry` du routeur.

3. **Synthèse visuelle** — au moment du trigger (étape 1), le rule
   demande aussi au DEP d'**enqueuer N MSG_MOVE virtuels**
   (`fromLocation = LOCATION.OVERLAY, toLocation = LOCATION.GRAVE`,
   un par matériau, `fromSequence = i ∈ [0..N-1]` correspondant à la
   position d'overlay sur l'XYZ source) sur la queue d'animation. Ces
   events synthétiques sont routés via la branche existante
   `processOverlayDetachEvent` ([move-animation-router.ts:186](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L186)),
   qui anime un slide-out + travel depuis la position MZONE de l'XYZ
   vers le GY (visuel souhaité).

### 1.2 Diagramme de séquence

```
WS              orchestrator         DEP                    routeur           floats
│  MSG_MOVE XYZ MZONE→GRAVE
│  (overlayMaterials.length === 2)
├──────────────►│
│               │ pushToStream(MSG_MOVE_xyz, ref=42)
│               ├────────────────────►│
│               │                     │ trigger.match → openDeferred('xyz-leave:42')
│               │                     │ side-effect : enqueue 2 virtuels
│               │◄────────────────────┤ (via dataSource.enqueueVirtualMoves)
│               │                     │
│               │ dispatch MSG_MOVE_xyz────────────►│ leaveFieldNonDestroy / Destroy
│               │                                     │
│               │ dispatch MSG_MOVE_virtuel_0 (OVERLAY→GRAVE)
│               │                                     ├──► processOverlayDetachEvent
│               │                                     │         slide-out + travel float #0
│               │ dispatch MSG_MOVE_virtuel_1
│               │                                     ├──► processOverlayDetachEvent
│               │                                     │         slide-out + travel float #1
│  MSG_MOVE GRAVE→GRAVE reason=0x600 cardCode=mat0
├──────────────►│
│               │ pushToStream(MSG_MOVE_settle0, ref=43)
│               ├────────────────────►│
│               │                     │ matches deferred('xyz-leave:42').predicate
│               │                     │ chainTo retourne {kind:'absorb'}
│               │◄────────────────────┤ event marqué absorbed (drop du routing)
│               │ pas de dispatch routeur — float déjà animé
│  MSG_MOVE GRAVE→GRAVE reason=0x600 cardCode=mat1
├──────────────►│
│               │ pushToStream(MSG_MOVE_settle1, ref=44)
│               ├────────────────────►│
│               │                     │ matches deferred('xyz-leave:42').predicate
│               │                     │ chainTo retourne {kind:'absorb'} ET
│               │                     │ N == matérielsReçus → closeReady + emit EffectReady
│               │◄────────────────────┤
│               │ pas de dispatch routeur
│               │ EffectReady('xyz-leave:42') pour future projection éventuelle
```

### 1.3 Surface de modification

Mise à jour 2026-05-26 après architecture review (5 décisions actées en frontmatter).

| Fichier | Modif | Verrouillé par session #13 ? |
|---|---|---|
| `deferred-effect-processor.ts` | Refactor `DeferredRule` en type union `ObserverRule | RewriterRule` (déc. B2). Branchement `if (rule.kind === 'rewriter')` dans `openDeferred` + `drainMatchingDeferreds`. Hook `onClose?` appelé sur matched/timeout/checkpoint (déc. D2). `observe()` retourne `{absorbed: boolean}`. | Non |
| `deferred-effect-rules.ts` | Ajouter `xyzLeaveWithMaterials: RewriterRule` + l'enregistrer dans `RULES`. Garde test : `RULES.filter(r => r.kind === 'rewriter').length <= 1` (déc. A1 garde). | Non |
| `ocgcore-reason-flags.ts` (**nouveau**) | Module isolé pour les constantes `REASON_*` OCGCore. Source = `constant.lua:125-152`. | Non |
| `virtual-event-registry.ts` (**nouveau**) | WeakSet front-only + `tagAsVirtual` / `isVirtual` (déc. E2). ~15 lignes. | Non |
| `move-animation-router.ts` | Aucune modif (la branche OVERLAY→GRAVE existante anime déjà les virtuels — cf. §3.3). | Non |
| `animation-data-source.ts` | Ajouter `enqueueVirtualMoves(events: readonly MoveMsg[])` à l'interface. | **Oui** (verrouillé) |
| `animation-orchestrator.service.ts` | (1) Side-channel `_transport_lastAbsorbed: boolean` (déc. C2). (2) `_handleEntry` lit le side-channel après `pushToStream`, skip dispatch si `true` + émet `AnimationStarted/Completed` sync. (3) Wire `RuleSinks` (real `enqueueVirtualMoves` + `lockZone`) au constructor du DEP. | **Oui** (verrouillé) |
| `duel-debug.service.ts` | Décorer les events `_virtual: true` au moment du dump JSON via `isVirtual(event)` (déc. E2 — visibilité debug sans pollution runtime). | Non |
| `front/.../duel-ws-game.types.ts` + `duel-server/.../ws-protocol-game.ts` | Ajouter `overlayMaterials?: number[]` à `MoveMsg` (Commit 0bis — modif protocole obligatoire, cf. §4.5). | Non |
| `duel-server/.../duel-worker.ts` | `transformMove` : ajouter query `OcgQueryFlags.OVERLAY` sur la source MZONE (cf. §4.5). | Non |

⚠️ La spec NE livre PAS le code aujourd'hui. Elle figure le contrat. La
livraison code se fait en 3 commits (révisé 2026-05-26 après
investigation §7.2) :

- **Commit 0bis (protocole WS, autonome)** — ajout
  `overlayMaterials?: number[]` à `MoveMsg` front+back +
  `duel-worker.ts:transformMove` query `OcgQueryFlags.OVERLAY` sur la
  source MZONE. Aucune dépendance avec le DEP. Mergeable
  indépendamment.
- **Commit 1 (DEP-only, autonome)** — étend l'API du DEP + ajoute le
  rule (avec `enqueueVirtualMoves` mocké par un sink injecté). Tests
  unitaires du DEP couvrent absorb + side-effect, avec des fixtures
  synthétiques portant déjà `overlayMaterials` (pas de dépendance
  Commit 0bis pour les unit tests). Mergeable sans toucher
  l'orchestrator ni le protocole.
- **Commit 2 (orchestrator + routeur)** — wire le sink réel
  (`enqueueVirtualMoves`) + la consommation de la liste « absorbed »
  côté `_handleEntry`. Doit attendre la fin de la session #13. Test
  d'intégration end-to-end requiert Commits 0bis + 1 mergés.

---

## §2 Extension API du DEP

Architecture review 2026-05-26 — choix B2 (type union discriminé) + D2 (`onTrigger`+`onClose?`).

### 2.1 Le DEP devient un processor à deux familles (décision A1 + garde)

Le DEP β.2 était un **observateur passif** — il regardait les events, ouvrait/fermait des deferreds, émettait des markers, ne touchait rien d'autre. Le cas #12 introduit une 2e famille de rules — les **rewriters** — qui synthétisent des events et en absorbent d'autres.

⚠️ **Garde architecturale (décision A1)** : tant qu'**un seul** rule de la famille rewriter existe (`xyzLeaveWithMaterials`), il vit dans le DEP. Avant d'en ajouter un 2e, **revue d'archi obligatoire** pour décider si l'extraction `FlowRewriteProcessor` est justifiée (Rule of Three). Test invariant :

```ts
// Dans deferred-effect-rules.spec.ts
it('β.3 cas #12 — at most one RewriterRule allowed without architecture review', () => {
  const rewriters = RULES.filter(r => r.kind === 'rewriter');
  expect(rewriters.length).toBeLessThanOrEqual(1);
});
```

Et commentaire bloquant au-dessus de `RewriterRule` dans le code :

```ts
/**
 * ⚠️ ARCHITECTURE GUARD (β.3 cas #12, 2026-05-26)
 *
 * RewriterRule is the "Flow rewrite" family (catalogue §1bis). It
 * BREAKS the DEP's pure-observer invariant: it synthesizes events
 * (`onTrigger`) and absorbs others (`chainTo` returning `absorb`).
 *
 * AT MOST ONE RewriterRule is allowed without an architecture
 * review. Adding a 2nd one triggers the Rule of Three: extract a
 * separate `FlowRewriteProcessor` instead of growing this family in
 * the DEP.
 *
 * The test `deferred-effect-rules.spec.ts:"at most one RewriterRule"`
 * enforces this at compile-test time.
 */
```

### 2.2 Type union `ObserverRule | RewriterRule` (décision B2)

Aujourd'hui (`deferred-effect-processor.ts:98-107`) il n'y a qu'**un** type `DeferredRule` avec 4 propriétés (`trigger`, `deriveName`, `derivePredicate`, `chainTo?`). Toutes sont pures.

Refonte en **type union discriminé** par `kind` :

```ts
interface BaseRule {
  trigger: (event: FluxEvent) => boolean;
  deriveName: (event: FluxEvent, triggerRef: number) => string;
  derivePredicate: (event: FluxEvent, triggerRef: number) => AwaitingPredicate;
}

/**
 * Rule classique (observer). Pure du point de vue du flux : lit,
 * décide, marque. Pas de side-effect, pas de synthèse, pas
 * d'absorption.
 *
 * Les 5 rules existants (overlay-show, trigger-show, attack-impact,
 * lp-cost, counter-pulse) sont tous des ObserverRule.
 */
interface ObserverRule extends BaseRule {
  kind?: 'observer';  // discriminant optionnel — absent par défaut
  /**
   * Re-arm avec un nouveau predicate (compound flow) ou close
   * (retourner null = close + EffectReady).
   */
  chainTo?: (
    matchedEvent: FluxEvent,
    matchedRef: number,
    deferred: ActiveDeferredView,
  ) => AwaitingPredicate | null;
}

/**
 * Rule de la famille « Flow rewrite » — synthétise N events, absorbe
 * N events. Cf. ARCHITECTURE GUARD §2.1.
 *
 * Couple obligatoire : `onTrigger` + `chainTo` retournant un
 * verdict du type `RewriterVerdict` (peut inclure `absorb` /
 * `absorb-and-close`). Le typesystem empêche d'écrire un rewriter
 * sans `onTrigger` ou un observer avec `absorb`.
 */
interface RewriterRule extends BaseRule {
  kind: 'rewriter';  // discriminant obligatoire

  /**
   * Side-effect au moment du trigger. Acquiert ressources
   * (locks, etc.) + synthétise events virtuels via le sink.
   * Retourne `{payload?}` — le payload sera passé tel quel à
   * `chainTo` (lecture seule pour le DEP, mutable côté rule) et à
   * `onClose?` (libération de ressources).
   */
  onTrigger: (
    event: FluxEvent,
    triggerRef: number,
    sinks: RuleSinks,
  ) => { payload?: unknown };

  /**
   * Hook de libération appelé sur TOUS les chemins de fermeture
   * de la deferred :
   *   - `'matched'`     — `chainTo` a retourné `null` / `absorb-and-close`.
   *   - `'timeout'`     — DEFERRED_TIMEOUT_MS écoulé sans match.
   *   - `'checkpoint'`  — `applyReset({CONNECTION_LIFETIME})`.
   *
   * Permet de release un lock / un timer / un float préparé sans
   * fuite, peu importe le chemin. Pattern try/finally formalisé au
   * niveau du contrat de rule.
   */
  onClose?: (
    payload: unknown,
    reason: 'matched' | 'timeout' | 'checkpoint',
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

type RewriterVerdict =
  | AwaitingPredicate              // re-arm (legacy)
  | null                            // close + EffectReady (legacy)
  | { kind: 'absorb' }              // drop du routing aval, deferred reste ouverte
  | { kind: 'absorb-and-close' };   // drop du routing aval + close + EffectReady

type DeferredRule = ObserverRule | RewriterRule;
```

**Résolution Q2 audit (discrimination)** : `AwaitingPredicate.kind` est
typé `kind?: string` (cf. `types/deferred-effect.types.ts:38`), donc un
retour `{kind: 'animation', type: 'AnimationCompleted', ref: 42}` est
un rearm valide qui collisionne syntaxiquement avec `{kind: 'absorb'}`.

L'`interpretRewriterVerdict` doit tester les VALEURS spécifiques
`'absorb'` / `'absorb-and-close'` AVANT de typer le retour comme
`AwaitingPredicate` :

```ts
private interpretRewriterVerdict(verdict: RewriterVerdict):
  | { kind: 'close' }
  | { kind: 'absorb' }
  | { kind: 'absorb-and-close' }
  | { kind: 'rearm', predicate: AwaitingPredicate }
{
  if (verdict === null) return { kind: 'close' };
  // ⚠️ Tester les valeurs sentinelles AVANT de typer comme AwaitingPredicate
  // — un AwaitingPredicate peut lui-même avoir un champ `kind` (typé
  // `kind?: string`), p.ex. `{kind: 'animation', type:
  // 'AnimationCompleted', ref: 42}` est un rearm valide.
  if ((verdict as { kind?: string }).kind === 'absorb') {
    return { kind: 'absorb' };
  }
  if ((verdict as { kind?: string }).kind === 'absorb-and-close') {
    return { kind: 'absorb-and-close' };
  }
  return { kind: 'rearm', predicate: verdict as AwaitingPredicate };
}
```

Pas de wrapper `{kind: 'rearm', predicate}` côté contrat du rule — les
5 ObserverRule existants retournent un `AwaitingPredicate` nu, on
préserve la compat ascendante stricte.

**Rationale du double verbe `absorb` / `absorb-and-close`** : la
deferred peut traiter N events avant d'avoir vu tous les matériaux
attendus. Tant qu'il en reste, retourner `{kind:'absorb'}` (drop le
routing, deferred vivante, predicate inchangé, timer non re-armé —
l'instance reste à découvrir des matches). Quand le dernier arrive,
retourner `{kind:'absorb-and-close'}` (drop le routing ET close +
EffectReady). Sans ce double verbe il faudrait soit ouvrir N
deferreds (collision sur `name`), soit re-armer avec le même
predicate (reset le timer à chaque match — complique l'invariant
timeout).

### 2.3 `RuleSinks` — intentionnellement minimal (décision D2)

Le sink reste à **2 méthodes** — pas plus. Toute extension nécessite
une revue d'archi (parallèle de la garde sur RewriterRule).

```ts
/**
 * Sinks exposés aux RewriterRule au moment de `onTrigger`. Intentionnellement
 * minimal pour limiter le couplage `DEP → reste de l'app`. Ajouter une
 * méthode = inviter un nouveau use case ; à faire en revue d'archi, pas
 * opportunément.
 *
 * Le sink par défaut (`NO_OP_SINKS`) fait rien — utilisable en test seam
 * et en prod tant qu'aucun RewriterRule n'est défini.
 *
 * Résolution Q5 audit Commit 1 : 2 méthodes (pas de `relativePlayer`
 * exposé). `lockZone` accepte un (zoneId, absolutePlayer) et fait la
 * conversion absolu→relatif interne au sink — le rule reste agnostique
 * de la convention DOM `${zoneId}-${relPlayer}`.
 */
interface RuleSinks {
  /** Enqueue N MSG_MOVE virtuels APRÈS l'event courant, AVANT les
   *  events suivants déjà enqueués mais pas encore dispatchés. */
  enqueueVirtualMoves: (events: readonly MoveMsg[]) => void;

  /** Acquiert un lock ref-compté sur la zone (zoneId, absolutePlayer).
   *  Le sink fait la conversion absolu→relatif via `ctx.relativePlayer`
   *  et construit la zone key DOM en interne. Le rule doit release
   *  via le hook `onClose?(payload)` (sinon fuite). */
  lockZone: (zoneId: number, absolutePlayer: number) => ZoneLock;
}

const NO_OP_SINKS: RuleSinks = {
  enqueueVirtualMoves: () => { /* default — wired by orchestrator in prod */ },
  lockZone: () => ({ release: () => { /* no-op */ } } as ZoneLock),
};
```

### 2.4 Wiring `onTrigger` / `onClose?` / `absorb` côté processor

Le DEP gère `onTrigger` dans `openDeferred`, et `onClose?` dans les 3
chemins de fermeture (matched / timeout / checkpoint).

```ts
private openDeferred(rule: DeferredRule, event: FluxEvent, ref: number): void {
  // ... (logique existante : collision check, predicate, timer, emit DeferredEffect)

  let payload: unknown | undefined;
  if (rule.kind === 'rewriter') {
    // Side-effect — peut synthétiser des events, lock des zones, etc.
    const result = rule.onTrigger(event, ref, this.sinks);
    payload = result.payload;
  }

  this._active.set(name, {
    name, triggerRef: ref, awaitingPredicate: predicate, timerId, rule, payload,
  });
}

private drainMatchingDeferreds(event: FluxEvent, ref: number): { absorbed: boolean } {
  let absorbed = false;
  for (const [name, deferred] of [...this._active]) {
    if (!this.matches(event, deferred.awaitingPredicate)) continue;

    // Branchement par kind — type-narrow par TypeScript
    if (deferred.rule.kind === 'rewriter') {
      const verdict = deferred.rule.chainTo(event, ref, deferred);
      const action = this.interpretRewriterVerdict(verdict);
      switch (action.kind) {
        case 'rearm':
          this.rearmDeferredInPlace(deferred, action.predicate);
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
      // Observer legacy — chainTo retourne AwaitingPredicate | null | undefined
      const result = deferred.rule.chainTo?.(event, ref, deferred);
      if (result === null || result === undefined) {
        this.closeReady(name, deferred, 'matched');
      } else {
        this.rearmDeferredInPlace(deferred, result);
      }
    }
  }
  return { absorbed };
}

private closeReady(name: string, deferred: ActiveDeferred, reason: CloseReason): void {
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

  // β.3 cas #12 — release des ressources aussi sur timeout/checkpoint
  if (deferred.rule.kind === 'rewriter') {
    deferred.rule.onClose?.(deferred.payload, reason);
  }

  this.emit({
    kind: 'deferred', type: 'EffectAbandoned',
    name, triggerRef: deferred.triggerRef, reason,
  } satisfies EffectAbandonedEvent);
}

type CloseReason = 'matched' | 'timeout' | 'checkpoint';
```

Le constructor du DEP gagne le param `sinks` :

```ts
constructor(
  private readonly emit: (event: DeferredFluxEvent) => void,
  private readonly getLogger: () => DuelLogger | undefined = () => undefined,
  private readonly clock: DeferredClock = REAL_CLOCK,
  private readonly rules: readonly DeferredRule[] = RULES,
  private readonly sinks: RuleSinks = NO_OP_SINKS, // β.3 cas #12
) {}
```

### 2.5 `observe` retourne `{absorbed: boolean}`

```ts
observe(event: FluxEvent, ref: number = this._nextRef++): { absorbed: boolean } {
  const drainResult = this.drainMatchingDeferreds(event, ref);
  this.openDeferredsForRules(event, ref);
  return drainResult;
}
```

L'orchestrator stash ce flag dans un side-channel (décision C2, cf. §3.2) — pas un changement de signature `pushToStream`.

**Invariant** : un event peut être marqué `absorbed` par plusieurs deferreds simultanément (rare mais théoriquement possible). Le résultat est le même — skip dispatch. Le `OR` au-dessus de la boucle suffit.

### 2.6 `ActiveDeferred` gagne `payload?: unknown`

```ts
interface ActiveDeferredView {
  readonly name: string;
  readonly triggerRef: number;
  readonly awaitingPredicate: AwaitingPredicate;
  readonly payload?: unknown;  // β.3 cas #12 — opaque pour le DEP, mutable par le rule
}
```

Le DEP ne lit ni n'écrit jamais dans `payload` — il le porte d'`openDeferred` à `chainTo` / `onClose?`. Mutation du payload dans `chainTo` est legal (cas typique : décrémenter un compteur de matériaux attendus).

### 2.7 Compatibilité ascendante

- Les 5 rules existants n'ont pas de `kind` explicite → tombent dans `ObserverRule` (le `kind?: 'observer'` optionnel). Aucune migration nécessaire — le code est strictement identique pour eux.
- Le sink par défaut `NO_OP_SINKS` garantit qu'un DEP instancié sans sinks (tests legacy, prod si pas encore wired) ne jette rien et n'a aucun side-effect (`enqueueVirtualMoves` et `lockZone` no-op).
- `observe` retourne maintenant `{absorbed}` au lieu de `void`. Le seul caller en prod (l'orchestrator) doit lire ce flag — mais il l'ignore tant qu'il n'y a pas de RewriterRule (les 5 ObserverRule retournent toujours `absorbed: false`).
- Le hook `onClose?` est sur `RewriterRule` uniquement — les ObserverRule ne le voient pas dans leur type, donc impossible de l'ajouter par mégarde.

---

## §3 Wiring orchestrator (Commit 2, après session #13)

### 3.1 `enqueueVirtualMoves` côté `animation-data-source`

Nouvelle méthode sur l'interface `AnimationDataSource` :

```ts
/**
 * β.3 cas #12 — insère N MSG_MOVE virtuels dans la queue d'animation,
 * à la position « après l'event courant en cours de dispatch, avant les
 * events suivants déjà enqueués mais pas dispatchés ». Si appelé en
 * dehors d'un dispatch (queue vide), insère en tête.
 *
 * Les events virtuels portent un marker `_virtual: true` pour
 * permettre au journal et aux outils de debug de les distinguer des
 * events serveur. Le routeur ne fait pas la distinction — il anime
 * comme n'importe quel MSG_MOVE.
 */
enqueueVirtualMoves(events: readonly MoveMsg[]): void;
```

**Implémentations** :
- `DuelWebSocketService` (PvP) — délègue à `DuelConnection` qui ajoute
  les events à la queue interne du processor (probablement via
  `_animationQueue.insertAfterCurrent` à créer côté
  `DuelEventProcessor`).
- `ReplayDuelAdapter` (replay) — même chose. Le sink est partagé
  parce que le DEP est unique et observé via le stream commun.

**Note d'ownership** : la liste « events absorbed » que le DEP retourne
via `observe(event).absorbed` est consommée par l'orchestrator. Mais le
sink `enqueueVirtualMoves` est branché côté `dataSource` (qui appartient
à la couche PvP/Replay). Le couplage va `DEP → sinks → dataSource →
queue`. Le DEP n'importe pas `MoveMsg` autrement que comme type (déjà
fait dans `deferred-effect-rules.ts`).

### 3.2 Consommation `absorbed` côté orchestrator (décision C2 — side-channel)

Architecture review 2026-05-26 — `pushToStream` garde sa signature actuelle (`(event) => number`). Le flag `absorbed` est exposé via un **side-channel** privé sur l'orchestrator, miroir du `_transport_lastDispatchedRef` introduit en β.2b.

#### 3.2.1 Pourquoi pas changer la signature de `pushToStream`

`pushToStream` a **4 call-sites** dans l'orchestrator :

1. Le tap in-queue dans `processEvent` (le seul qui dispatche au routeur — **le seul** qui a besoin de `absorbed`).
2. `notifyOutOfBandEvent` (MSG_CHAIN_NEGATED, SELECT_CARD, synthetic MSG_WIN, boundary events, runner transport events). Ces events ne sont jamais routés → `absorbed` non-pertinent.
3. `pushDeferredToStream` (émissions DEP elles-mêmes : DeferredEffect, EffectReady, EffectAbandoned). Bypasse l'observe-loop. `absorbed` toujours `false` par construction.
4. Indirect via les helpers β.2b (`pushAnimationStarted`, `pushAnimationCompleted`) qui n'ont aucune raison de vérifier.

Changer la signature obligerait les 3 autres call-sites à destruct ou ignorer le flag — bruit pour rien.

#### 3.2.2 Le side-channel `_transport_lastAbsorbed`

```ts
// Dans AnimationOrchestratorService
/**
 * β.3 cas #12 (2026-05-26) — side-channel: did the LAST `pushToStream`
 * call see an event that a RewriterRule absorbed (drop the routing)?
 *
 * Read by `processEvent` immediately after `pushToStream` to decide
 * whether to dispatch the event to its handler or skip + emit
 * synchronous AnimationStarted/Completed.
 *
 * Mirror of `_transport_lastDispatchedRef` (β.2b). PERSPECTIVE_LIFETIME
 * transport state — reset at the top of `processEvent`, written by
 * `pushToStream`.
 */
private _transport_lastAbsorbed: boolean = false;

private pushToStream(event: StreamEvent): number {
  const ref = this._transport_nextStreamRef++;
  this._eventStream.set([...this._eventStream(), { event, ref }]);
  const result = this.deferredProcessor.observe(event, ref);
  this._transport_lastAbsorbed = result.absorbed;
  return ref;
}
```

#### 3.2.3 Consommation dans `processEvent`

Le pipeline reste similaire à β.2b, avec un branchement supplémentaire pour le cas absorbed :

```ts
private processEvent(event: GameEvent): number | 'async' | Promise<void> {
  this._transport_lastDispatchedRef = null;
  this._transport_lastAbsorbed = false;  // reset side-channel β.3 cas #12

  // Buffer board-changing events during chain resolution (inchangé)
  if (!this._isReplayingBuffer && this.chainManager.bufferIfResolving(event)) {
    return 0;
  }

  // Progressive logical-state sync (inchangé)
  const boardStateAfter = (event as GameEvent & { boardStateAfter?: DuelState }).boardStateAfter;
  if (boardStateAfter) this.rbs.updateLogical(boardStateAfter);

  // Push to stream — peut set `_transport_lastAbsorbed` à `true`
  const eventToPush = this.decorateLpEventForStream(event);
  this._transport_lastDispatchedRef = this.pushToStream(eventToPush);

  // β.3 cas #12 — si un RewriterRule a absorbé l'event, skip le
  // dispatch handler. On émet quand même AnimationStarted +
  // AnimationCompleted sync (durée 0) pour ne pas geler les
  // projections qui en dépendent (IsAnimatingProjection,
  // OverlayShowReadyProjection si chaînée, etc.).
  if (this._transport_lastAbsorbed) {
    this.pushAnimationStarted(this._transport_lastDispatchedRef, event.type);
    this.pushAnimationCompleted(this._transport_lastDispatchedRef, event.type);
    return 0;
  }

  // Dispatch normal (inchangé)
  switch (event.type) {
    case 'MSG_MOVE': return this.moveRouter.processMoveEvent(event as MoveMsg);
    // ... etc ...
  }
}
```

**Détail subtil** : `AnimationStarted` et `AnimationCompleted` doivent
être émis MÊME pour un event absorbed, pour 2 raisons :
1. La paire pin la cohérence du ref monotone — un consumer qui voit
   `ref=N` sur `pushToStream` doit aussi voir `AnimationStarted({ref:N})`
   et `AnimationCompleted({ref:N})` pour ne pas se désynchroniser.
2. Certaines projections (ex: `IsAnimatingProjection` via les events
   `runner-started`/`runner-stopped` — pas exactement la même chose
   mais analogue) lisent l'absence d'`AnimationCompleted` comme « il
   y a une animation en cours », ce qui ferait planter le `await` du
   runner.

Synchroneité : pas de `setTimeout`, pas d'`await`. Push immédiat des deux events. Le coût est ~2 mutations de signal Angular = négligeable.

#### 3.2.4 Pourquoi le DEP ne push pas lui-même les AnimationStarted/Completed

Question légitime : « pourquoi l'orchestrator les émet, pas le DEP qui sait qu'il a absorbé ? ». Réponse : le DEP n'a aucune connaissance du wrapping `AnimationStarted/Completed` (qui est un concern β.2b géré par l'orchestrator). Garder cette responsabilité côté orchestrator évite de couler la knowledge β.2b dans le DEP. Le DEP dit *« absorbed »*, l'orchestrator décide quoi en faire (skip dispatch + émettre les markers d'animation vide).

### 3.3 Routage des MSG_MOVE virtuels via `processOverlayDetachEvent`

Le routeur traite déjà la branche `OVERLAY → GRAVE` à
[move-animation-router.ts:131-134](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L131-L134) :

```ts
// XYZ overlay detach: OVERLAY -> GRAVE/BANISHED
if (mc.from === LOCATION.OVERLAY && (mc.to === LOCATION.GRAVE || mc.to === LOCATION.BANISHED)) {
  return this.overlayDetach(mc);
}
```

Et `overlayDetach` appelle `processOverlayDetachEvent` (privée à
[ligne 186](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L186)).

**Aucune modif côté routeur n'est nécessaire** : les MSG_MOVE virtuels
synthétisés par le rule auront `fromLocation = LOCATION.OVERLAY` et
`toLocation = LOCATION.GRAVE`, donc le routeur les anime déjà
correctement via la branche existante. Le visuel souhaité (slide-out
des matériaux depuis l'XYZ + travel vers le GY) est exactement ce que
`processOverlayDetachEvent` produit déjà.

⚠️ **Subtilité fromSequence** : `processOverlayDetachEvent` lit
`fromSequence` pour construire `srcKey =
locationToZoneKey(LOCATION.OVERLAY, fromSequence, relPlayer)`. La zone
OVERLAY est référencée par la position de l'XYZ source (la même
position MZONE/EMZ qu'il occupait avant de partir).

**Donc** : le rule cas #12 doit lire la position MZONE de l'XYZ (avant
qu'il parte) et la réutiliser comme `fromSequence` des virtuels. La
position est disponible via le `boardStateAfter` snapshot **du trigger
event** (qui est le MSG_MOVE de l'XYZ partant — son `fromSequence` est
sa position MZONE pré-départ). Cf. §4.2 pour le calcul.

---

## §4 Spécification du rule `xyzLeaveWithMaterials`

### 4.1 Constantes OCGCore — bitmask `reason`

**Source de vérité authoritative** :
[duel-server/data/scripts_full/constant.lua:125-152](../../duel-server/data/scripts_full/constant.lua#L125-L152).
Investigation 2026-05-26 — les valeurs sont celles des macros
OCGCore C (les Lua scripts les importent depuis la VM via les
constantes globales). Le wasm les expose directement comme `number`
sur le champ `reason` de la `OcgQueryFlags.REASON` query.

⚠️ **Bug pré-existant orthogonal** : `duel-server/src/game-log/game-log-builder.ts:40-49`
et `duel-server/src/replay-precompute.ts:70-79` déclarent leur propres
constantes `REASON_*` avec des valeurs **fausses** (REASON_FUSION=0x8
au lieu de 0x40000, REASON_XYZ=0x40 au lieu de 0x200000, etc.). Ce
bug est hors scope de #12 — à signaler dans un mémo séparé. Pour
#12, ne PAS se référer à ces fichiers ; lire `constant.lua` ou
ré-extraire via le wasm.

À ajouter dans un nouveau `ocgcore-reason-flags.ts` (isolé — la
knowledge YGO n'a pas à se mélanger aux durations dans
`animation-constants.ts`, cf. décision D2 §8) :

```ts
// OCGCore reason bitfield — source de vérité : constant.lua:125-152.
// Le wasm @n1xx1/ocgcore-wasm@0.1.1 émet ces valeurs telles quelles
// sur OcgQueryFlags.REASON.
export const REASON_DESTROY     = 0x1;
export const REASON_RELEASE     = 0x2;        // Tribute
export const REASON_TEMPORARY   = 0x4;
export const REASON_MATERIAL    = 0x8;        // Used as material (synchro/xyz/link/fusion)
export const REASON_SUMMON      = 0x10;
export const REASON_BATTLE      = 0x20;
export const REASON_EFFECT      = 0x40;
export const REASON_COST        = 0x80;
export const REASON_ADJUST      = 0x100;
export const REASON_LOST_TARGET = 0x200;
export const REASON_RULE        = 0x400;
export const REASON_SPSUMMON    = 0x800;
export const REASON_DISSUMMON   = 0x1000;
export const REASON_FLIP        = 0x2000;
export const REASON_DISCARD     = 0x4000;
export const REASON_RDAMAGE     = 0x8000;
export const REASON_RRECOVER    = 0x10000;
export const REASON_RETURN      = 0x20000;
export const REASON_FUSION      = 0x40000;
export const REASON_SYNCHRO     = 0x80000;
export const REASON_RITUAL      = 0x100000;
export const REASON_XYZ         = 0x200000;
export const REASON_REPLACE     = 0x1000000;
export const REASON_DRAW        = 0x2000000;
export const REASON_REDIRECT    = 0x4000000;
export const REASON_LINK        = 0x10000000;

/** Cas #12 — exactement le mask émis par OCGCore pour le settling
 *  position des ex-matériaux d'XYZ une fois l'XYZ parti. */
export const REASON_XYZ_MATERIAL_SETTLE = REASON_RULE | REASON_LOST_TARGET; // 0x600
```

**À vérifier en pass 1 d'implémentation** : capturer un duel réel
avec XYZ destroy via le debug-replay harness, dumper les `reason` hex
émis pour les settling events (catégorie PIPELINE de DuelLogger).
Confirmer que la valeur réelle est bien `0x600` (et pas, par exemple,
`0x600 | REASON_DESTROY = 0x601` selon le contexte de départ de
l'XYZ). Adapter le predicate à `(reason & 0x600) === 0x600` si la
valeur exacte varie.

### 4.2 Pattern de détection (trigger)

```ts
function isXyzLeaveWithMaterials(e: StreamEvent): e is MoveMsg {
  if (!isMove(e)) return false;
  const m = e as MoveMsg;
  // Le source est sur le terrain (MZONE ou EMZ).
  if (m.fromLocation !== LOCATION.MZONE) return false;
  // overlayMaterials > 0 — c'est ce qui le distingue d'un Effect Monster
  // qui quitte le terrain. Le snapshot boardStateAfter contient la card
  // pré-mouvement avec ses overlayMaterials. Voir §4.4 pour la lecture.
  const matCount = readOverlayMaterialsAtTrigger(m);
  if (matCount === 0) return false;
  // La destination est arbitraire : GRAVE, BANISHED, EXTRA (return-to-
  // deck), DECK (return-to-deck), HAND (rare mais possible — bounce d'XYZ
  // par Compulsory Evacuation Device par exemple). Le pattern absorbe les
  // settling REASON_RULE peu importe la dest finale de l'XYZ.
  return true;
}
```

⚠️ **EMZ** : `LOCATION.MZONE` couvre les zones EMZ aussi (EMZ slots
sont identifiés par `sequence ∈ [5,6]` — cf. CLAUDE.md « MR5 EMZ
convention »). Pas besoin de tester un `LOCATION.EMZ` séparé.

### 4.3 Predicate awaiting

```ts
{
  type: 'MSG_MOVE',
  player: m.player,                     // ← Q4 audit : robustesse mass-destroy bilatérale
  fromLocation: LOCATION.GRAVE,
  toLocation: LOCATION.GRAVE,
  reason: REASON_XYZ_MATERIAL_SETTLE,   // 0x600
  // cardCode est wildcard ici — on accepte n'importe quel matériau du
  // joueur attendu, la vérification d'appartenance se fait dans chainTo
  // via la liste capturée au trigger.
}
```

**Résolution Q4 audit (predicate awaiting)** : le champ `player` du
predicate est ajouté pour serrer la mass-destruction bilatérale (Dark
Hole : 1 XYZ par joueur, 4 settlings → sans `player`, chaque deferred
voit les 4 et `chainTo` filtre via `expectedCardCodes`). Avec `player`
au predicate, le matcher du DEP narrow avant `chainTo`. Robustesse
gratuite — un matériau d'un XYZ a toujours le même `player` (controller)
que l'XYZ qui le portait, donc aucun risque de faux négatif.

**Z2 strict-equality** : le matcher actuel du DEP fait du strict-
equality champ par champ. Le `reason` est un entier — match exact sur
0x600 fonctionne. Pas besoin d'extension du matcher.

### 4.4 État capturé au trigger + lock contract (décision D2)

Architecture review 2026-05-26 — le rule est un `RewriterRule` (décision B2), qui acquiert un **lock externe** sur la zone OVERLAY de l'XYZ source dans `onTrigger` et le release dans `onClose?` (garantie 3 chemins).

#### 4.4.1 Le lock contract (décision D2)

Cf. CLAUDE.md « Async Handler Lock Contract ». Pendant que les N MSG_MOVE virtuels OVERLAY→GRAVE sont en train d'animer, la zone OVERLAY de l'XYZ source DOIT rester rendue côté DOM. Or l'orchestrator a déjà appelé `updateLogical(boardStateAfter)` AVANT `pushToStream` ([animation-orchestrator.service.ts:1394](../../front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L1394)) — la zone MZONE de l'XYZ source est logiquement vide. Sans lock externe, un `commitUnlocked()` entre 2 virtuels démonterait l'élément DOM source → 2e virtuel verrait `getZoneElement(srcKey) === null` → skip silencieux du visuel.

Le lock externe garantit que la zone reste rendered tant que la deferred est ouverte, indépendamment des locks internes que chaque virtuel acquiert lui-même via `processOverlayDetachEvent`.

#### 4.4.2 Le rule complet

```ts
const xyzLeaveWithMaterials: RewriterRule = {
  kind: 'rewriter',  // discriminant — gate compile-time pour absorb + onTrigger

  trigger: isXyzLeaveWithMaterials,
  deriveName: (_e, ref) => `xyz-leave:${ref}`,
  derivePredicate: (e) => {
    const m = e as MoveMsg;
    return {
      type: 'MSG_MOVE',
      player: m.player,                     // Q4 audit
      fromLocation: LOCATION.GRAVE,
      toLocation: LOCATION.GRAVE,
      reason: REASON_XYZ_MATERIAL_SETTLE,   // 0x600 (cf. §4.1)
    };
  },

  /**
   * Acquiert le lock externe + synthétise les N virtuels.
   * Retourne le payload qui sera porté par la deferred jusqu'à la fin.
   */
  onTrigger: (e, _ref, sinks) => {
    const m = e as MoveMsg;
    const xyzMaterials = readOverlayMaterialsAtTrigger(m); // cf. §4.5

    // 1. Acquérir le lock externe sur la zone MZONE de l'XYZ source.
    //    Le sink convertit (m.player absolu) → relPlayer en interne via
    //    ctx.relativePlayer et construit la zone key DOM
    //    `${MZONE-fromSequence}-${relPlayer}`. Le rule reste agnostique
    //    de la convention DOM (cf. Q5 audit Commit 1).
    //
    //    On lock MZONE (pas OVERLAY) parce que la zone OVERLAY DOM est
    //    rendue *dans* la zone MZONE de l'XYZ — c'est le lock MZONE qui
    //    empêche le démontage du conteneur pendant les N animations
    //    OVERLAY→GRAVE.
    const xyzZoneLock = sinks.lockZone(
      LOCATION.MZONE,  // zoneId (incluant le fromSequence côté sink, voir note)
      m.player,         // absolutePlayer — sink convertit en relatif
    );
    // ⚠️ Pass 1 d'impl : la signature `lockZone(zoneId, absolutePlayer)`
    //    doit-elle aussi prendre `sequence` ? Si zoneId englobe la
    //    sequence (zoneKey final = `MZONE-${sequence}-${relPlayer}`), la
    //    signature devient `lockZone(zoneId, sequence, absolutePlayer)`.
    //    À figer en début de Commit 1 selon le format réel des zone keys
    //    construites par `locationToZoneKey`.

    // 2. Synthétiser N MSG_MOVE virtuels OVERLAY→GRAVE.
    //    Marqués via le WeakSet `tagAsVirtual` (cf. décision E2 / §4.6).
    const virtuals: MoveMsg[] = xyzMaterials.map((cardCode, i) => tagAsVirtual({
      type: 'MSG_MOVE',
      player: m.player,
      cardCode,
      cardName: '',  // résolu côté front via DuelCardArtService si nécessaire
      fromLocation: LOCATION.OVERLAY,
      fromSequence: m.fromSequence,  // position MZONE de l'XYZ source
      fromPosition: POSITION.FACEUP,
      toLocation: LOCATION.GRAVE,
      toSequence: 0,  // GRAVE est une pile, sequence ignoré par le routeur
      toPosition: POSITION.FACEUP,
      toPlayer: m.player,
      reason: REASON_XYZ_MATERIAL_SETTLE,
      isToken: false,
    }));
    sinks.enqueueVirtualMoves(virtuals);

    // 3. Retourner le payload — porté par la deferred jusqu'au close.
    return {
      payload: {
        xyzZoneLock,
        expectedCardCodes: new Set(xyzMaterials),
        remaining: xyzMaterials.length,
      } satisfies XyzLeavePayload,
    };
  },

  /**
   * Verdict d'absorption à chaque settling event matchant le predicate.
   * Mutate le payload (decrement remaining) — autorisé par le contrat.
   */
  chainTo: (matched, _ref, deferred) => {
    const payload = deferred.payload as XyzLeavePayload;
    if (!isMove(matched)) return null;  // never happens given predicate
    const m = matched as MoveMsg;

    if (!payload.expectedCardCodes.has(m.cardCode)) {
      // Cas pathologique : un GRAVE→GRAVE reason=0x600 arrive avec un
      // cardCode hors de la liste. On NE PAS absorbe (le routeur peut
      // faire son fallback pileToPile — c'est juste un settling
      // orphelin). On ne close pas la deferred non plus — on attend
      // les vrais settlings. Si aucun n'arrive, timeout fait son job.
      // Note : pas de re-arm — predicate reste identique pour le
      //        prochain GRAVE→GRAVE reason=0x600.
      return /* rearm avec même predicate */ deferred.awaitingPredicate;
    }

    // Match valide — absorbe + décrément
    payload.remaining -= 1;
    payload.expectedCardCodes.delete(m.cardCode);

    if (payload.remaining === 0) {
      return { kind: 'absorb-and-close' };  // dernier matériau → close
    }
    return { kind: 'absorb' };
  },

  /**
   * Release des ressources — appelé sur TOUS les chemins de fermeture :
   *   - 'matched'    : dernier settling vu (absorb-and-close)
   *   - 'timeout'    : DEFERRED_TIMEOUT_MS sans match
   *   - 'checkpoint' : STATE_SYNC / rematch
   *
   * Garantie no-leak du lock peu importe le chemin.
   */
  onClose: (payload, _reason) => {
    (payload as XyzLeavePayload).xyzZoneLock.release();
  },
};

/** Type du payload — porté par la deferred entre onTrigger et chainTo / onClose. */
interface XyzLeavePayload {
  /** Lock externe sur la zone MZONE de l'XYZ source, acquis dans onTrigger. */
  xyzZoneLock: ZoneLock;
  /** CardCodes des matériaux attendus en settling. Décrémenté dans chainTo. */
  expectedCardCodes: Set<number>;
  /** Compteur de settlings restants à absorber. */
  remaining: number;
}
```

#### 4.4.3 Pourquoi le rearm avec même predicate sur cardCode hors liste

Au lieu de `return null` (close immédiat — abandon de la deferred), on rearm avec le même predicate. Justification : si un settling event arrive avec un cardCode qu'on n'attend pas, c'est probablement le settling d'un AUTRE XYZ qui est en train de partir en parallèle (mass destruction, cf. §5.1). Un AUTRE deferred (`xyz-leave:N+1`) doit l'absorber. Le notre continue d'attendre **ses** settlings — rearm avec même predicate sans modifier le payload.

Risque : timeout si nos vrais settlings n'arrivent pas en temps voulu. Mais c'est `DEFERRED_TIMEOUT_MS = 5s` — assez large pour absorber un ordre OCGCore non-déterministe entre 2 XYZ.

⚠️ Mutation du `payload` dans `chainTo` : c'est un side-effect, mais contained à la deferred. Le DEP n'écrit jamais dans `payload` (read-only depuis sa perspective). Documenté dans le contrat `ActiveDeferredView` §2.6.

### 4.5 `readOverlayMaterialsAtTrigger` — investigation 2026-05-26

**Investigation faite** :

1. **`MoveMsg` actuel** ([front/src/app/pages/pvp/duel-ws-game.types.ts:16-47](../../front/src/app/pages/pvp/duel-ws-game.types.ts#L16-L47)
   et son miroir [duel-server/src/ws-protocol-game.ts:16-47](../../duel-server/src/ws-protocol-game.ts#L16-L47))
   **ne porte PAS `overlayMaterials`**. Seul `boardStateAfter?: BoardStatePayload`
   est attaché (replay precompute uniquement, BOARD_CHANGING events pendant
   `chainPhase === 'resolving'`).

2. **Pourquoi `boardStateAfter` ne suffit pas** : le snapshot reflète
   l'état **après** application du MSG_MOVE. Au moment du trigger
   `MSG_MOVE xyz MZONE → GRAVE`, la zone MZONE de l'XYZ est déjà vide
   dans `boardStateAfter`. Les `overlayMaterials` sont irrécupérables
   depuis ce snapshot. En live PvP, `boardStateAfter` est de toute
   façon absent.

3. **Pourquoi `logicalState()` ne suffit pas non plus** : ordre
   d'opérations dans
   [animation-orchestrator.service.ts:1393-1417](../../front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L1393-L1417) :
   ```
   1394:   if (boardStateAfter) this.rbs.updateLogical(boardStateAfter);
   ...
   1417:   this._transport_lastDispatchedRef = this.pushToStream(eventToPush);
   ```
   `updateLogical` est appelé **AVANT** `pushToStream`. Donc quand le
   DEP observe l'event via `pushToStream → deferredProcessor.observe`,
   le `logicalState` reflète **déjà** l'état post-mouvement. Aucune
   lecture rétroactive possible côté DEP via le board state.

4. **Le serveur a accès à `overlayMaterials` au moment de la query**.
   Dans `duel-worker.ts:queryCard`, la query `FLAG_OVERLAY` retourne
   les `overlayCards` ([duel-worker.ts:887-890](../../duel-server/src/duel-worker.ts#L887-L890)).
   Mais `transformMove` ([duel-worker.ts:341-370](../../duel-server/src/duel-worker.ts#L341-L370))
   ne query la card source actuellement — seulement la destination
   pour récupérer `reason`. La source vient de `msg.from` (paramètre
   OCGCore brut). Il faut **ajouter** une query `FLAG_OVERLAY` sur la
   source AVANT l'application du déplacement (i.e. au moment où OCGCore
   émet le MSG_MOVE — la card est encore dans `msg.from.location`).

**Conclusion** : modif protocole `MoveMsg` **OBLIGATOIRE** (non
optionnelle). Plan :

```ts
// front/src/app/pages/pvp/duel-ws-game.types.ts (et son miroir back)
export interface MoveMsg {
  // ... champs existants ...
  /**
   * β.3 cas #12 (2026-05-26) — overlayMaterials de la card source AU
   * MOMENT DU MSG_MOVE (avant son application). Émis uniquement quand
   * (a) la card a un overlay non-vide, ET (b) elle quitte une zone
   * field (MZONE/SZONE) ; absent autrement pour ne pas alourdir le
   * payload. Lu par le DEP rule `xyzLeaveWithMaterials` pour
   * détecter le départ d'XYZ et synthétiser les N MSG_MOVE virtuels
   * OVERLAY→GRAVE.
   */
  overlayMaterials?: number[];
}
```

**Helper** (côté front, dans `deferred-effect-rules.ts`) :

```ts
function readOverlayMaterialsAtTrigger(m: MoveMsg): number[] {
  return m.overlayMaterials ?? [];
}
```

**Côté back** (`duel-worker.ts:transformMove`) — ajouter la query
`FLAG_OVERLAY` sur la source quand la source est MZONE :

```ts
function transformMove(msg: any): ServerMessage {
  let reason = 0;
  if (core && duel && msg.to.location as number !== 0) {
    const reasonInfo = core.duelQuery(duel, {
      flags: OcgQueryFlags.REASON as number,
      controller: msg.to.controller,
      location: msg.to.location as number,
      sequence: msg.to.sequence,
      overlaySequence: 0,
    } as never);
    reason = reasonInfo?.reason ?? 0;
  }

  // β.3 cas #12 — query overlayMaterials de la source si elle est
  // sur le terrain (MZONE/SZONE). On query AVANT que le MSG_MOVE soit
  // appliqué côté OCGCore (la card est encore en `msg.from.location`).
  // ⚠️ vérifier en pass 1 que la query renvoie bien les matériaux à
  // ce moment, pas une liste vide post-départ. Si la query est
  // post-départ, alternative : capturer le snapshot board state JUSTE
  // AVANT le `duelProcess` qui produit le MSG_MOVE, et le passer en
  // closure à transformMove.
  let overlayMaterials: number[] | undefined;
  if (core && duel && msg.from.location === LOCATION.MZONE) {
    const overlayInfo = core.duelQuery(duel, {
      flags: OcgQueryFlags.OVERLAY as number,
      controller: msg.from.controller,
      location: msg.from.location as number,
      sequence: msg.from.sequence,
      overlaySequence: 0,
    } as never);
    const mats = overlayInfo?.overlayCards ?? [];
    if (mats.length > 0) overlayMaterials = mats;
  }

  return {
    type: 'MSG_MOVE', cardCode: msg.card, cardName: getCardName(msg.card),
    // ... autres champs inchangés ...
    reason,
    ...(overlayMaterials ? { overlayMaterials } : {}),
  };
}
```

⚠️ **Pass 1 d'implémentation R8 — invariant temporel à vérifier** : la
query `FLAG_OVERLAY` est-elle exécutée avant ou après la mutation
d'OCGCore qui retire l'XYZ ? Si OCGCore traite le MSG_MOVE par
phases (notify side observers → mutate field → emit MSG_MOVE), la
query au moment du callback `transformMove` peut tomber dans la
fenêtre post-mutation. Test à faire en pass 1 : XYZ destroy, vérifier
log de `overlayInfo?.overlayCards` au moment de transformMove. Si
vide, alternative : capturer un snapshot pre-call (closure side-channel
`lastFieldSnapshot` mis à jour à chaque `processOneMessage`).

### 4.6 Marker virtuel — WeakSet front-only (décision E2)

Architecture review 2026-05-26 — pas de champ `_virtual` sur le protocole WS. Le marker vit dans un module front isolé.

**Nouveau module** : `front/src/app/pages/pvp/duel-page/virtual-event-registry.ts`

```ts
/**
 * β.3 cas #12 (2026-05-26) — registre des MSG_MOVE virtuels synthétisés
 * par les RewriterRule du DEP. Permet de distinguer un event serveur
 * d'un event synthétique sans polluer le protocole WS (asymétrie
 * front/back qui pollurait le contrat).
 *
 * WeakSet : garbage-collected automatiquement quand l'event est dropped
 * de partout (queue, stream, références internes). Aucune fuite mémoire
 * possible.
 *
 * Cf. décision E2 architecture review β.3 cas #12.
 */
const VIRTUAL_EVENTS = new WeakSet<object>();

/**
 * Tag un MSG_MOVE comme synthétique. Retourne le même objet pour
 * chaînage fluide (`tagAsVirtual({...})`).
 */
export function tagAsVirtual<T extends object>(event: T): T {
  VIRTUAL_EVENTS.add(event);
  return event;
}

/**
 * Vérifie si un event a été tagué virtuel. Safe sur tout type
 * d'event (les non-tagués retournent `false`).
 */
export function isVirtual(event: object): boolean {
  return VIRTUAL_EVENTS.has(event);
}
```

**Usage côté rule** (cf. §4.4) :

```ts
import { tagAsVirtual } from './virtual-event-registry';

const virtuals = xyzMaterials.map(cardCode => tagAsVirtual({
  type: 'MSG_MOVE',
  /* ... */
}));
```

**Usage côté debug** (`duel-debug.service.ts`) — décoration au moment du dump :

```ts
import { isVirtual } from './virtual-event-registry';

// Dans DuelDebugService.snapshot()
return {
  // ... autres champs ...
  animationQueue: this.dataSource.animationQueue().map(entry => ({
    ...entry,
    ...(isVirtual(entry) ? { _virtual: true } : {}),
  })),
};
```

Les snapshots JSON affichent `_virtual: true` sur les events synthétiques pour visibilité debug — **sans** que `_virtual` soit dans le type `MoveMsg` runtime.

**Usage côté Game Log** (si un futur lot consomme la distinction) :

```ts
import { isVirtual } from './virtual-event-registry';

// Dans GameLogBuilder.notifyGameLog
if (event.type === 'MSG_MOVE' && isVirtual(event)) {
  // Affichage spécial (ex: "Matériau libéré") au lieu du MSG_MOVE générique
}
```

---

## §5 Edge cases

### 5.1 Plusieurs XYZ partent en même temps (mass destruction)

**Scénario** : un Dark Hole détruit 2 XYZ adverses (chacun avec 2
matériaux). 4 settling events `GRAVE→GRAVE reason=0x600`.

**Comportement** : chaque MSG_MOVE_xyz1, MSG_MOVE_xyz2 ouvre sa propre
deferred (`xyz-leave:42`, `xyz-leave:44`). La corrélation se fait par
`cardCode` du matériau — chaque deferred matche les settling events
avec un `cardCode` ∈ sa propre `expectedCardCodes`. Si les 2 XYZ ont
des matériaux distincts (cas normal — un matériau ne peut pas être
sous 2 XYZ simultanément), l'absorption est non-ambiguë.

**Cas pathologique** : 2 XYZ partagent un matériau par bug OCGCore
(impossible YGO, mais à robustifier). Le premier deferred qui voit le
settling absorbe ; le second voit son `expectedCardCodes` se vider sans
match → timeout après `DEFERRED_TIMEOUT_MS` → `EffectAbandoned(timeout)`
+ warn. Aucun crash.

### 5.2 XYZ avec un seul matériau (N=1)

Pas de différence — N=1 → 1 virtuel + 1 absorb-and-close. Couvert.

### 5.3 XYZ vide d'overlay au moment du départ

Le trigger filtre via `matCount === 0 → return false`. Pas de deferred,
pas de virtuels, le routeur traite le MSG_MOVE de l'XYZ normalement.
Aucun settling event ne suit côté OCGCore (pas de matériaux à
déplacer).

### 5.4 Return-to-deck XYZ

Destination de l'XYZ = `LOCATION.EXTRA` (Extra Deck). Matériaux vont
toujours en GY (règle YGO universelle). Le rule absorbe les settling
events GRAVE→GRAVE comme d'habitude. Visuel : matériaux animés depuis
la position MZONE vers GY ; XYZ animé MZONE→EXTRA séparément par le
routeur (branche existante `leaveFieldNonDestroy` → EXTRA).

### 5.5 XYZ banni

Destination XYZ = `LOCATION.BANISHED`. Matériaux toujours GY (sauf
cas exotique type Number 89 — non couvert en β.3, à traiter en pass 4
si rencontré). Idem return-to-deck.

### 5.6 STATE_SYNC / rematch au milieu

Le DEP a `scope: 'CONNECTION_LIFETIME'`. Un STATE_SYNC ou
RematchStarted dispatch `{CONNECTION_LIFETIME}` qui cascade → l'open
deferred reçoit `EffectAbandoned(reason='checkpoint')`. Les virtuels
déjà enqueués sont vidés par la queue reset standard. État cohérent
post-checkpoint.

### 5.7 Replay seek

Un seek pendant l'absorption traverse un `resetForSwitch` qui dispatch
`{PERSPECTIVE_LIFETIME}`. Le DEP ne reçoit RIEN
(`PERSPECTIVE_LIFETIME` plus volatile que `CONNECTION_LIFETIME`).
Comportement : les deferreds en cours **survivent au switch**. Risque :
si le replay seek saute par-dessus les settling events, le timer 5s
fait `EffectAbandoned(timeout)`. Acceptable — pas de bug visuel, juste
un warn dans la console.

### 5.8 Burst de settling avec un seul matériau mais cardCode dupliqué

Théoriquement possible si 2 XYZ ont chacun un matériau avec le même
cardCode (Snake-Eye Ash en double dans deux XYZ). Chaque deferred matche
sur `cardCode` ; le premier absorbe le premier settling, le second
absorbe le second. L'ordre d'itération du `Map._active` (insertion
order) garantit le déterminisme.

### 5.9 reduced-motion

Le routeur skip la slide-out + travel via `if
(ctx.reducedMotion()) return 0` ([move-animation-router.ts:187](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L187)).
Les MSG_MOVE virtuels sont quand même enqueués + dispatchés (pour
préserver le contrat lock), mais résolvent immédiatement. Visuel :
matériaux disparaissent instantanément, GY se met à jour. Pas de
flashs (parce que les settling events sont absorbés). Comportement
souhaité.

### 5.10 Synchronisation locks — résolu par décision D2

**Risque originel** : `preLockQueuedSources` ([move-animation-router.ts:245](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L245)) itère sur `dataSource.animationQueue()` au moment du flush. Les MSG_MOVE virtuels enqueués par `onTrigger` arrivent APRÈS ce flush, donc les pre-locks ne les couvrent pas. Un `commitUnlocked()` entre 2 virtuels démonterait la zone OVERLAY (déjà vidée logiquement à `boardStateAfter`) → 2e virtuel ne trouve pas son `srcElement` → skip silencieux.

**Résolution structurelle (décision D2)** : le rule acquiert un **lock externe** sur la zone MZONE de l'XYZ source dans `onTrigger` via `sinks.lockZone(xyzZoneKey)`. Ce lock est tenu pendant toute la durée de la deferred — release garanti par `onClose?` sur les 3 chemins (matched / timeout / checkpoint).

Pendant cette fenêtre :
- La zone MZONE source reste rendered DOM (le ref-count > 0).
- Chaque virtuel acquiert son propre lock interne via `processOverlayDetachEvent`, ref-compté par-dessus le lock externe.
- Aucun `commitUnlocked()` ne peut démonter la zone tant que le lock externe vit.

Le test T-I2 (cf. §6.2) verifie qu'il n'y a **pas de leak** du lock externe sur les chemins timeout + checkpoint — c'est précisément ce que `onClose?` garantit.

### 5.11 Le trigger event est lui-même un settling settled

Théoriquement, si OCGCore émet un `GRAVE→GRAVE reason=0x600` SANS être
précédé d'un MSG_MOVE d'XYZ partant (cas exotique non audité — cf.
catalogue §3 pass 3), le rule cas #12 ne s'ouvre pas (le trigger filtre
sur `fromLocation === MZONE`). Le settling tombe dans `pileToPile`
comme avant. Pas de régression sur les patterns non couverts.

---

## §6 Tests

### 6.1 Tests unitaires DEP (Commit 1)

Fichier : `front/src/app/pages/pvp/duel-page/deferred-effect-processor.spec.ts`

**T-V1** — `onTrigger` est appelé avec le bon ref :
```ts
const sinks = { enqueueVirtualMoves: jasmine.createSpy() };
const dep = new DeferredEffectProcessor(emit, getLogger, fakeClock, [xyzLeaveRule], sinks);
dep.observe(triggerMsg, 42);
expect(sinks.enqueueVirtualMoves).toHaveBeenCalledWith(jasmine.any(Array));
expect(sinks.enqueueVirtualMoves.calls.mostRecent().args[0].length).toBe(2);
```

**T-V2** — chainTo absorb maintient la deferred ouverte :
```ts
dep.observe(triggerMsg, 42);
expect(dep.activeCount()).toBe(1);
dep.observe(settling1Msg, 43);
expect(dep.activeCount()).toBe(1); // pas fermée
expect(emittedEvents).not.toContain(jasmine.objectContaining({type: 'EffectReady'}));
```

**T-V3** — chainTo absorb-and-close ferme + emit EffectReady :
```ts
dep.observe(triggerMsg, 42); // 2 matériaux attendus
dep.observe(settling1Msg, 43); // absorb
dep.observe(settling2Msg, 44); // absorb-and-close
expect(dep.activeCount()).toBe(0);
expect(emittedEvents).toContain(jasmine.objectContaining({type: 'EffectReady', name: 'xyz-leave:42'}));
```

**T-V4** — `observe` retourne `{absorbed: true}` pour un settling :
```ts
dep.observe(triggerMsg, 42);
const result = dep.observe(settling1Msg, 43);
expect(result.absorbed).toBe(true);
```

**T-V5** — Timeout normal sur la deferred si les settlings n'arrivent pas :
```ts
dep.observe(triggerMsg, 42);
fakeClock.tick(DEFERRED_TIMEOUT_MS + 1);
expect(emittedEvents).toContain(jasmine.objectContaining({type: 'EffectAbandoned', name: 'xyz-leave:42', reason: 'timeout'}));
```

**T-V6** — Compat ascendante : les 5 rules existants ne sont pas
affectés par le nouveau type union :
```ts
// Run la suite spec existante du DEP — doit rester 100% verte.
// Vérifier en plus : chaque rule existant a kind absent ou 'observer'.
RULES.filter(r => r.kind !== 'rewriter').forEach(r => {
  expect((r as any).onTrigger).toBeUndefined();
  expect((r as any).onClose).toBeUndefined();
});
```

**T-V7** — Cleanup `onClose?` sur `'timeout'` (décision D2 — fuite-lock-free) :
```ts
const onCloseSpy = jasmine.createSpy();
const rule: RewriterRule = { /* ... */, onClose: onCloseSpy };
const dep = new DeferredEffectProcessor(emit, getLogger, fakeClock, [rule], sinks);
dep.observe(triggerMsg, 42);
expect(onCloseSpy).not.toHaveBeenCalled();
fakeClock.tick(DEFERRED_TIMEOUT_MS + 1);
expect(onCloseSpy).toHaveBeenCalledWith(jasmine.any(Object), 'timeout');
```

**T-V8** — Cleanup `onClose?` sur `'checkpoint'` :
```ts
dep.observe(triggerMsg, 42);
dep.applyReset(new Set(['CONNECTION_LIFETIME']));
expect(onCloseSpy).toHaveBeenCalledWith(jasmine.any(Object), 'checkpoint');
// Vérifier aussi que le lock acquis dans onTrigger a été release
expect(payloadCapturedInOnTrigger.xyzZoneLock.release).toHaveBeenCalled();
```

**T-V9** — Garde architecturale A1 : au plus 1 RewriterRule :
```ts
// Dans deferred-effect-rules.spec.ts
it('β.3 cas #12 — at most one RewriterRule allowed without architecture review', () => {
  const rewriters = RULES.filter(r => r.kind === 'rewriter');
  expect(rewriters.length).toBeLessThanOrEqual(1);
});
```

**T-V10** — Gating compile-time du type union B2 (test conceptuel — ne compile pas si la garde fonctionne) :
```ts
// Vérifie au moins manuellement (review humaine) :
//   const bad: ObserverRule = { ..., onTrigger: () => {...} };  // ❌ TS error
//   const bad: RewriterRule = { kind: 'rewriter', ... };         // ❌ TS error si onTrigger absent
// Pas un test runtime — c'est une assertion sur le contrat de types.
```

### 6.2 Test d'intégration cas #12 (Commit 2)

Fichier : nouveau `front/src/app/pages/pvp/duel-page/case-12-xyz-leave.integration.spec.ts`

**T-I1** — DUAL assertion du catalogue §4 test #5 :
```ts
it('absorbs settling events and synthesizes overlay-detach travels', async () => {
  // Setup : XYZ posé avec 2 matériaux au MZONE-0.
  // Action : feed MSG_MOVE XYZ → GRAVE (reason = REASON_DESTROY) +
  //          2× MSG_MOVE GRAVE→GRAVE reason=0x600.
  await orchestrator.processEvent(xyzLeaveMsg);

  // Assertion 1 — structurelle : les 2 settling events n'ont PAS
  // lancé de travel pileToPile (assert no floats lancés avec srcKey
  // GRAVE-* pendant la window).
  const pileToPileFloats = floatRegistry.inFlightByZone()
    .filter(([key]) => key.startsWith('GRAVE-') && key.endsWith('-0'));
  expect(pileToPileFloats.length).toBe(0);

  // Assertion 2 — visuelle : 2 OVERLAY→GRAVE virtuels ont lancé des
  // floats avec srcKey OVERLAY-* (la position MZONE de l'XYZ source).
  const overlayFloats = floatRegistry.inFlightByZone()
    .filter(([key]) => key.startsWith('OVERLAY-'));
  expect(overlayFloats.length).toBe(2);
});
```

**T-I2** — Lock contract maintenu :
```ts
// Vérifier que la zone OVERLAY est lockée pendant la dispatch des
// virtuels et libérée à AnimationCompleted. Pas de commitUnlocked
// entre les 2 virtuels.
```

**T-I3** — Variante battle destroy (variant secondaire du catalogue §4) :
```ts
// XYZ détruit en battle (reason = REASON_DESTROY | REASON_BATTLE).
// Même pattern d'absorption attendu.
```

**T-I4** — Variante return-to-deck :
```ts
// XYZ vers EXTRA (Compulsory Evacuation Device d'XYZ + Extra Deck).
// Matériaux vont quand même au GY.
```

**T-I5** — Variante banished :
```ts
// XYZ banni. Matériaux GY.
```

### 6.3 Tests régression

Sur l'ensemble de la suite β.3 existante (1518 tests verts au commit
`1d59a168`) :
- Les 5 rules existants (overlay-show, trigger-show, attack-impact,
  lp-cost, counter-pulse) doivent rester 100% verts.
- Les 4 projections existantes consommant le DEP
  (OverlayShowReadyProjection, …) doivent rester 100% vertes.
- Les specs de `move-animation-router.spec.ts` (16 branches) doivent
  rester 100% verts — le routeur n'est pas modifié.

---

## §7 Plan d'exécution

### 7.1 Pré-requis

- ⏳ **Session #13 mergée** — la spec touche `animation-data-source.ts`
  + `animation-orchestrator.service.ts` au Commit 2. Démarrer le
  Commit 2 seulement quand la session #13 est mergée et stable.
- ✅ **Catalogue à jour** — `deferred-effects-catalogue.md` §1bis + §4
  test #5 sont déjà rédigés (commit `9b841b2c`). Rien à modifier.
- ✅ **Chantier doc à jour** — `duel-session-chantier.md` mentionne
  déjà cas #12 dans §3.7 et §4.3 (même commit).

### 7.2 Pré-requis confirmés par investigation (avant Commit 1)

**Investigation 2026-05-26** :

✅ **Constantes REASON** — vérifiées contre
[constant.lua:125-152](../../duel-server/data/scripts_full/constant.lua#L125-L152).
`REASON_RULE = 0x400`, `REASON_LOST_TARGET = 0x200`, mask de settling
= `0x600`. **Bug pré-existant orthogonal** dans
`game-log-builder.ts` + `replay-precompute.ts` (constantes fausses
locales — à traiter dans un mémo séparé, hors scope #12).

❌ **`overlayMaterials` sur `MoveMsg`** — confirmé ABSENT du protocole.
Modif protocole **OBLIGATOIRE** (tâche pré-Commit 1) :

1. Ajouter `overlayMaterials?: number[]` à `MoveMsg` dans
   [front/src/app/pages/pvp/duel-ws-game.types.ts](../../front/src/app/pages/pvp/duel-ws-game.types.ts)
   ET [duel-server/src/ws-protocol-game.ts](../../duel-server/src/ws-protocol-game.ts)
   (byte-sync front/back enforced par `scripts/check-ws-protocol-sync.mjs`,
   prebuild duel-server).
2. Peupler le champ côté serveur dans `duel-worker.ts:transformMove`
   via une query `OcgQueryFlags.OVERLAY` sur la source MZONE (cf. §4.5
   pour le code) — **vérifier l'invariant temporel R8** : la query
   doit s'exécuter AVANT la mutation OCGCore qui retire l'XYZ.
3. Re-générer les types si nécessaire et faire repasser
   `npm run prebuild` côté duel-server.

⚠️ **Conséquence sur la stratégie 2-commits** : Commit 1 (DEP-only)
peut être livré SANS modif protocole — le rule lit
`m.overlayMaterials ?? []`, ce qui retourne `[]` tant que le serveur
n'émet pas le champ → trigger ne fire jamais → comportement identique
au pre-fix. Mais le **vrai test** du rule (T-V1 onTrigger appelé avec
matériaux) nécessite la modif protocole en amont OU un fixture-message
synthétique dans le test (préférable — découple le commit DEP du
serveur).

→ **Plan recommandé** : Commit 1 (DEP, tests avec fixtures
synthétiques) **et** un Commit 0bis (modif protocole front+back) en
parallèle. Commit 2 (orchestrator + sinks) attend les 2 précédents et
la fin de session #13.

### 7.3a Commit 0bis — Protocole WS (autonome, parallèle au Commit 1)

1. `front/src/app/pages/pvp/duel-ws-game.types.ts` : ajouter
   `overlayMaterials?: number[]` à `MoveMsg`.
2. `duel-server/src/ws-protocol-game.ts` : miroir.
3. `duel-server/src/duel-worker.ts:transformMove` : query
   `OcgQueryFlags.OVERLAY` sur la source MZONE quand non vide
   (cf. §4.5 code). Vérifier R8 — invariant temporel de la query.
4. Faire passer `scripts/check-ws-protocol-sync.mjs` (prebuild
   duel-server).
5. Pas de test métier — c'est un champ optionnel non encore consommé.
   Vérifier régression : aucun test ne casse.

**Estimation** : 2-4h (modif protocole + test R8 + prebuild sync).

### 7.3b Commit 1 — DEP-only (autonome, mergeable immédiatement)

Architecture review 2026-05-26 — scope étendu par les 5 décisions actées.

1. `deferred-effect-processor.ts` :
   - Type union discriminé `DeferredRule = ObserverRule | RewriterRule` (déc. B2).
   - Type `RewriterVerdict` étendu (rearm / close / absorb / absorb-and-close).
   - Interface `RuleSinks` à 2 méthodes (`enqueueVirtualMoves`, `lockZone`).
   - Constante `NO_OP_SINKS`.
   - Champ `payload?: unknown` sur `ActiveDeferredView`.
   - Refactor `openDeferred` : branche `if (rule.kind === 'rewriter')` → appelle `onTrigger`, stocke payload.
   - Refactor `drainMatchingDeferreds` : branche `if (deferred.rule.kind === 'rewriter')` → consomme verdict étendu.
   - Refactor `closeReady` + `abandonByName` : appellent `onClose?` AVANT l'emit.
   - `observe()` retourne `{absorbed: boolean}`.
   - Constructor gagne le param `sinks: RuleSinks = NO_OP_SINKS`.
   - Commentaire `ARCHITECTURE GUARD` au-dessus de `RewriterRule` (déc. A1).

2. `ocgcore-reason-flags.ts` (**nouveau fichier**) :
   - Constantes `REASON_*` (cf. §4.1) sourcées depuis `constant.lua`.
   - Constante composite `REASON_XYZ_MATERIAL_SETTLE = 0x600`.

3. `virtual-event-registry.ts` (**nouveau fichier**) :
   - WeakSet + `tagAsVirtual` + `isVirtual` (déc. E2, cf. §4.6).

4. `deferred-effect-rules.ts` :
   - Helper `isXyzLeaveWithMaterials` + `readOverlayMaterialsAtTrigger`.
   - Interface `XyzLeavePayload`.
   - `xyzLeaveWithMaterials: RewriterRule` (cf. §4.4).
   - Enregistrer dans `RULES`.

5. Tests T-V1 à T-V10 dans `deferred-effect-processor.spec.ts` + `deferred-effect-rules.spec.ts` (T-V9 garde architecturale).

6. Régression : faire tourner les 1518 specs existants → 100% verts.

**Estimation révisée** : **8-12h** (type union B2 + onClose? + WeakSet + 10 tests unitaires).

### 7.3c (dépendance) Commit 1 attend Commit 0bis ?

Non. Commit 1 utilise des **fixtures synthétiques** dans ses unit tests
(le test construit un `MoveMsg` avec `overlayMaterials: [c1, c2]`
directement). Mergeable même si Commit 0bis n'est pas encore en
master.

### 7.4 Commit 2 — Orchestrator + sinks (après session #13)

Architecture review 2026-05-26 — side-channel C2 au lieu de signature changée.

1. `animation-data-source.ts` :
   - Ajouter `enqueueVirtualMoves(events: readonly MoveMsg[])` à l'interface.
   - Implémenter dans `DuelWebSocketService` et `ReplayDuelAdapter` (délègue à `DuelEventProcessor._animationQueue.insertAfterCurrent` — à créer).

2. `animation-orchestrator.service.ts` :
   - Side-channel `_transport_lastAbsorbed: boolean` (déc. C2, miroir de `_transport_lastDispatchedRef`).
   - `pushToStream(event)` garde sa signature `(StreamEvent) => number` — **inchangée**. Met à jour le side-channel après l'appel à `deferredProcessor.observe`.
   - Construire le `RuleSinks` réel (`{ enqueueVirtualMoves: (...) => this.dataSource.enqueueVirtualMoves(...), lockZone: (key) => this.rbs.lockZone(key) }`) et le passer au constructor du `DeferredEffectProcessor`.
   - `processEvent` : reset `_transport_lastAbsorbed = false` au top ; après `pushToStream`, si `_transport_lastAbsorbed === true` → émettre `AnimationStarted` + `AnimationCompleted` sync + `return 0` (skip dispatch).
   - 3 autres call-sites de `pushToStream` (`notifyOutOfBandEvent`, `pushDeferredToStream`, helpers β.2b) — **aucune modif** (ne lisent pas le side-channel).

3. Tests T-I1 à T-I5 dans `case-12-xyz-leave.integration.spec.ts`.

4. Test manuel debug-replay harness sur la regression exemplar (`debug-replay-example.spec.ts` — déjà existant via `b41ea2c8`) : valider qu'aucun travel pileToPile n'est lancé sur les settlings et que les overlay floats animent depuis l'XYZ parti vers le GY.

**Estimation révisée** : **5-7h** (sinks + side-channel + 5 tests d'intégration ; modification réduite parce qu'on ne change pas la signature de `pushToStream` — moins de cascade).

### 7.5 Documentation post-livraison

1. CLAUDE.md « DeferredEffectProcessor » :
   - Ajouter mention du verbe absorb + `onTrigger` + `RuleSinks`.
   - Mentionner cas #12 dans la table « rules shipped ».
2. CLAUDE.md « Animation Constants » :
   - Référencer `ocgcore-reason-flags.ts` si créé.
3. Mémoire `project_anim_pipeline_v2_beta_3_lots_1_4.md` :
   - Ajouter ligne « cas #12 livré » à la liste β.3.
4. `deferred-effects-catalogue.md` :
   - Mettre à jour le statut du cas #12 (ready → shipped).

---

## §8 Décisions

### 8.1 Décisions architecturales (acquises 2026-05-26 par architecture review)

| # | Décision | Choix retenu |
|---|----------|--------------|
| **A** | DEP étendu vs `FlowRewriteProcessor` séparé | **A1 + garde explicite** — étendre le DEP, commentaire `ARCHITECTURE GUARD` + test invariant T-V9 « au plus 1 RewriterRule ». Rule of Three appliquée. |
| **B** | Champs optionnels vs type union pour `DeferredRule` | **B2 — type union `ObserverRule | RewriterRule`** discriminé par `kind`. Gating compile-time empêche `absorb` sans `onTrigger`. |
| **C** | Signature `pushToStream` vs side-channel pour `absorbed` | **C2 — side-channel `_transport_lastAbsorbed`** — miroir de `_transport_lastDispatchedRef` (pattern β.2b). 3 callers `pushToStream` non impactés. |
| **D** | Lock contract : sink + release manuel vs payload + `onClose?` | **D2 — payload + hook `onClose?(payload, reason)`** — release garanti sur 3 chemins (matched/timeout/checkpoint). Pattern try/finally. `RuleSinks` reste minimal (2 méthodes). |
| **E** | Marker `_virtual` : protocole WS vs WeakSet front-only | **E2 — WeakSet `virtual-event-registry.ts` front-only** + décoration au dump debug. Protocole WS reste propre. |

### 8.2 Décisions tactiques (par défaut acceptable, à confirmer)

| # | Question | Choix par défaut |
|---|----------|------------------|
| D1 | Le payload `expectedCardCodes` est muté par `chainTo` (Set.delete + remaining--). OK ou préférer un `payload` ré-affecté à chaque rearm via une variante d'API ? | **Mutation** — le payload est `unknown` côté DEP (read-only depuis sa perspective). Mutation par le rule = pattern simple et localisé. Pas de coût caché. |
| D2 | Les constantes OCGCore reason vont dans `animation-constants.ts` (existant) ou dans un nouveau `ocgcore-reason-flags.ts` (isolé) ? | **Nouveau fichier** `ocgcore-reason-flags.ts` — la knowledge YGO n'a pas à se mélanger aux durations d'animation. Sourcing explicite `constant.lua:125-152` en commentaire. |
| D3 | ~~Sur le marker `_virtual: true` des MSG_MOVE synthétiques~~ | **Résolu par décision E2** (architecture review) — WeakSet front-only, pas de champ protocole. |
| D4 | Le rule cas #12 expose-t-il le cardCode XYZ dans le name de la deferred ? Aujourd'hui name = `xyz-leave:${ref}`. Variante : `xyz-leave:${ref}:${xyzCardCode}`. | **Sans cardCode XYZ** — un ref monotone unique suffit, garantit l'absence de collision. Plus court à grep en debug. Le cardCode XYZ est de toute façon accessible via le triggerRef + le snapshot du flux. |
| D5 | ~~Modif protocole vs lecture board state~~ | **Résolu par investigation 2026-05-26** : modif protocole obligatoire (cf. §4.5 + §7.2). Aucune alternative — `logicalState`/`renderedState` ne peut PAS être lu rétroactivement, et `boardStateAfter` reflète l'état post-départ. |

---

## §9 Risques + mitigations

Mise à jour 2026-05-26 — R3 / R4 / R6 résolus structurellement par les décisions A1/B2/D2/E2.

| # | Risque | Mitigation |
|---|--------|------------|
| R1 | Les settling events ne portent pas exactement `reason === 0x600` (cas où OCGCore mixe d'autres bits) | Test pré-impl : capturer un duel réel avec XYZ destroy, dumper les `reason` hex via DuelLogger PIPELINE. Si différent, élargir le predicate à `(reason & 0x600) === 0x600`. |
| R2 | `overlayMaterials` pas dans le protocole | **Confirmé absent** par investigation 2026-05-26. Modif protocole front+back obligatoire (§7.2). Plan Commit 0bis dédié. |
| R3 | ~~Une autre règle DEP voit un settling event et fait quelque chose d'inattendu~~ | **Résolu** par Z2 strict-equality + revue des 5 rules existants : aucun ne matche `from=GRAVE && to=GRAVE && reason=0x600`. Grep de confirmation au démarrage du Commit 1 (vérification 30 secondes). |
| R4 | ~~Le routeur pile-to-pile a un lock contract spécifique que `processOverlayDetachEvent` ne reproduit pas~~ | **Résolu par décision D2** — le rule acquiert un lock externe via `sinks.lockZone(xyzZoneKey)` dans `onTrigger`, release garanti par `onClose?` sur 3 chemins. Test T-V7 + T-V8 vérifient la garantie no-leak. |
| R5 | Le timer 5s du DEP est insuffisant si OCGCore retarde les settling events derrière des animations longues | Cas exotique non observé en β.3. Si rencontré : étendre `DEFERRED_TIMEOUT_MS` (constante existante) ou rendre par-rule configurable. |
| R6 | ~~`_virtual: true` casse une assertion typescript stricte ailleurs dans le code~~ | **Résolu par décision E2** — `_virtual` n'est PAS dans le protocole. WeakSet front-only via `virtual-event-registry.ts`. Aucun impact type. |
| R7 | Mass destruction de 3+ XYZ avec des matériaux qui se croisent crée une explosion de deferreds parallèles | Borné par overlayMaterials.length total ≤ ~10 cards (limite YGO). Map._active reste O(N) avec N≤10 — pas un problème de perf. |
| R8 | Query `OcgQueryFlags.OVERLAY` post-mutation OCGCore retourne `[]` | Test pass 1 (cf. §4.5) — si query est post-mutation, fallback : snapshot pre-call capturé dans une closure `lastFieldSnapshot` mise à jour à chaque `processOneMessage`. |
| R9 | `game-log-builder.ts` + `replay-precompute.ts` ont des constantes REASON_* fausses (REASON_FUSION=0x8 au lieu de 0x40000) | Bug pré-existant orthogonal. NE PAS s'appuyer sur ces fichiers pour les valeurs. À ouvrir en mémo séparé pour audit (déjà signalé dans §4.1). |
| R10 | **Un 2e RewriterRule est ajouté en silence** (drift de la garde A1) | **Mitigation triple** : (1) commentaire `ARCHITECTURE GUARD` au-dessus de `RewriterRule` ; (2) test invariant T-V9 fail si `RULES.filter(r => r.kind === 'rewriter').length > 1` ; (3) review code humain (Pattern flagged par les keywords `kind: 'rewriter'`). |

---

## §10 Hors-scope explicite

- **Pass 4 audit** des autres séquences OCGCore `REASON_RULE` (Pendulum scales, P-Effect, etc.) — déjà documenté dans le catalogue §3.
- **Généralisation du rewrite pour le bug β.3 #1** (matériaux XYZ summon vers EXTRA) — différent pattern (`MZONE → EXTRA toSeq=7`, pas `GRAVE → GRAVE reason=0x600`). Suivra son propre cas ε3 si on décide de le rewriter (cf. catalogue §3 pass 3 note). **Important** : si ce 2e cas devient un RewriterRule, déclencher la revue d'archi de la garde A1 (Rule of Three → extraction `FlowRewriteProcessor`).
- **Extraction `FlowRewriteProcessor` dédié** — disproportionné pour 1 cas unique (décision A1). À reconsidérer **systématiquement** si un 2e cas Flow-rewrite émerge (Rule of Three).
- **Animation parallèle XYZ + matériaux** (le travel de l'XYZ et les N virtuels OVERLAY→GRAVE en parallèle vs en stagger) — laissé en paramètre d'implémentation Commit 2. Choix par défaut : en parallèle (les virtuels sont enqueued comme une suite immédiate ; le routeur les anime indépendamment, le timing visuel est le même).
- **Audit du bug pré-existant `REASON_*` dans `game-log-builder.ts` + `replay-precompute.ts`** — orthogonal à #12 (cf. R9). Mémo séparé à ouvrir pour traiter — n'attendre pas la livraison de #12.
- **Sound effects** — pas couvert par β.3 anyway.

---

## §12 Architecture review — log des décisions (2026-05-26)

Cette section trace les 5 décisions structurelles prises lors de la revue Winston du 2026-05-26, avec leur rationale court pour référence future.

| # | Décision | Choix | Rationale court |
|---|----------|-------|-----------------|
| **A** | Étendre DEP vs `FlowRewriteProcessor` | A1 + garde | Rule of Three — 1 cas concret. Garde explicite + test invariant pour empêcher drift sans revue. |
| **B** | Champs optionnels vs type union | B2 union | Gating compile-time empêche `absorb sans onTrigger` (bug visuel silencieux). ~15 lignes de type pour sécurité défensive sur le futur. |
| **C** | Changer `pushToStream` vs side-channel | C2 side-channel | Pattern β.2b déjà établi (`_transport_lastDispatchedRef`). 3 callers `pushToStream` non impactés. Cohérence > pureté. |
| **D** | `RuleSinks.lockZone` + release manuel vs payload + `onClose?` | D2 onClose? | Release garanti sur 3 chemins (matched/timeout/checkpoint). Pattern try/finally formalisé. `RuleSinks` reste minimal. |
| **E** | `_virtual` protocole WS vs WeakSet front | E2 WeakSet | Le protocole WS reste un contrat front↔back pur. Visibilité debug préservée via décoration au dump. |

**Principes appliqués** :
- *Rule of Three before abstraction* (A1, mention dans hors-scope).
- *Boring technology for stability* (C2 — pattern existant réutilisé).
- *Developer productivity is architecture* (B2 — gating compile-time = moins de bugs à debug).

**À reconsidérer si...** :
- Un 2e cas Flow-rewrite émerge → réviser A → A2 (extraction FRP).
- Une nouvelle catégorie d'event nécessite `pushToStream` à signature étendue → réviser C.
- `RuleSinks` doit gagner une 3e méthode → revue archi pour éviter drift "le DEP touche tout".

---

## §11 Sources

- OCGCore `ocgapi.h` — bitmasks `REASON_*` (à fetcher si valeurs §4.1
  doivent être validées byte par byte).
- `_bmad-output/planning-artifacts/deferred-effects-catalogue.md` —
  §1bis (rationale du rewrite) + §4 test #5 (DUAL assertion).
- `_bmad-output/planning-artifacts/beta-2-deferred-effect-processor-spec.md`
  — base API du DEP qu'on étend.
- `_bmad-output/planning-artifacts/duel-session-chantier.md` §3.7 +
  §4.3 (cas #12 listé comme delivrable β).
- Audit visuel β.3 d'Axel (2026-05-26) — origine du bug rapporté.
- `front/src/app/pages/pvp/duel-page/move-animation-router.ts` — le
  routeur cible (lignes 131-134, 147-150, 186-235, 245-285).
- `front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts` — table
  des 5 rules existants à étendre.
- `front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts` —
  l'API à étendre.
