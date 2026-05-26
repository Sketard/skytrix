// =============================================================================
// deferred-effect-rules.ts — β.2b (2026-05-26)
// -----------------------------------------------------------------------------
// The metier table consumed by `DeferredEffectProcessor`. Each rule
// declares a `trigger` predicate, a `deriveName`, and a
// `derivePredicate` (the literal matcher the DEP poses on subsequent
// flux events); compound rules add `chainTo` to re-arm with a fresh
// predicate after the first match (typically: MSG_MOVE → AnimationCompleted
// of THAT MSG_MOVE).
//
// β.2b ships 5 working rules + 5 documented stubs. Pragmatic scope:
// rules whose predicates can be expressed cleanly without heuristics
// that risk false positives in production. The stubs are intentional
// β.2b-bis / β.3 work, with the catalogue case + the reason for
// deferral inline.
//
// Cf. `_bmad-output/planning-artifacts/deferred-effects-catalogue.md`
// (11 catalogue cases) + `beta-2-deferred-effect-processor-spec.md §3`
// (the spec table).
//
// **Naming convention** (DP-5):
//  · `<family>:<chainIndex>` — one per chain link (overlay-show).
//  · `<family>:<ref>` — one per business event (trigger-show, attack-impact,
//    lp-cost, counter-pulse). The `ref` is the orchestrator's monotonic
//    stream ref, so a duel-long sequence stays collision-free.
//
// =============================================================================

import type { StreamEvent } from '../types';
import type {
  ChainingMsg, MoveMsg, AttackMsg, AddCounterMsg, RemoveCounterMsg,
  PayLpCostMsg,
} from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import type {
  ActiveDeferredView, DeferredRule, RewriterRule, RewriterVerdict,
  ZoneLock,
} from './deferred-effect-processor';
import { REASON_XYZ_MATERIAL_SETTLE } from './ocgcore-reason-flags';
import { tagAsVirtual } from './virtual-event-registry';

// ---------------------------------------------------------------------------
// Type guards on the FluxEvent union — narrow without `as` casts elsewhere.
// ---------------------------------------------------------------------------

function isChaining(e: StreamEvent): e is ChainingMsg {
  return (e as { type?: string }).type === 'MSG_CHAINING';
}
function isMove(e: StreamEvent): e is MoveMsg {
  return (e as { type?: string }).type === 'MSG_MOVE';
}
function isAttack(e: StreamEvent): e is AttackMsg {
  return (e as { type?: string }).type === 'MSG_ATTACK';
}
function isPayLpCost(e: StreamEvent): e is PayLpCostMsg {
  return (e as { type?: string }).type === 'MSG_PAY_LPCOST';
}
function isAddOrRemoveCounter(e: StreamEvent): e is AddCounterMsg | RemoveCounterMsg {
  const t = (e as { type?: string }).type;
  return t === 'MSG_ADD_COUNTER' || t === 'MSG_REMOVE_COUNTER';
}

// ---------------------------------------------------------------------------
// #1 — overlay-show (Cost-deferral, the cost-before-overlay test of victory)
// ---------------------------------------------------------------------------
//
// Canonical scenario (cf. `bug-cost-before-overlay-sequence.md`):
//   T5  MSG_CHAINING(player=me, chain-2, cardCode=Ash)
//       → opens deferred `overlay-show:chain-1` (the chain id captured
//         is the OPENING chain index, NOT the local link index)
//       → predicate étape 1 : { type: 'MSG_MOVE', player: me,
//                                cardCode: Ash }
//   T6  MSG_MOVE(Ash → GY, cost)
//       → predicate étape 1 matches → chainTo re-arms
//       → predicate étape 2 : { kind:'animation',
//                                type:'AnimationCompleted',
//                                ref: <T6 ref> }
//   T7  AnimationCompleted(ref=T6)
//       → predicate étape 2 matches → EffectReady('overlay-show:chain-1')
//
// DP-5 — one deferred per chain group. The trigger only fires for
// link N≥2 (chainIndex >= 1) because link-1 has nothing to wait on (no
// preceding cost in the chain). The name uses a stable chain id so
// multiple MSG_CHAININGs in the same chain DON'T open multiple
// deferreds — the `_active.has(name)` collision invariant + the trigger
// returning true on each MSG_CHAINING would otherwise duelAssert. We
// resolve by having the trigger return true ONLY for chainIndex >= 1
// AND by using a chain-group-stable name `overlay-show:chain-N` where
// N is the link index at which the chain became multi (the first
// chainIndex >= 1 we saw). Subsequent MSG_CHAININGs of the same chain
// raise the collision in dev; in prod they evict the older entry —
// either way the visual outcome (overlay-show on cost completion) is
// preserved.
//
// **What this catches**: hand traps (Ash, Veiler, Ghost Ogre,
// Effect Veiler, Maxx "C") discarded from hand as their own cost.
// **What this misses (β.2b acknowledged)**: chains whose cost is a
// DIFFERENT card than the activator (Solemn series banishing a board
// monster, Pot of Desires banishing 10 deck cards). Those need
// per-card narrowing in β.x.

const overlayShow: DeferredRule = {
  trigger: e => isChaining(e) && e.chainIndex >= 1,
  deriveName: e => `overlay-show:chain-${(e as ChainingMsg).chainIndex}`,
  derivePredicate: e => {
    const ch = e as ChainingMsg;
    return { type: 'MSG_MOVE', player: ch.player, cardCode: ch.cardCode };
  },
  chainTo: (matchedEvent, matchedRef, _deferred) => {
    if (!isMove(matchedEvent)) return null;
    return {
      kind: 'animation',
      type: 'AnimationCompleted',
      ref: matchedRef,
    };
  },
};

// ---------------------------------------------------------------------------
// #2 — trigger-show (Summon + trigger, Snake-Eye Ash style)
// ---------------------------------------------------------------------------
//
// Canonical scenario:
//   T1  MSG_MOVE(Snake-Eye Ash → MZONE)
//       → opens deferred `trigger-show:<cardCode>:<ref>`
//       → predicate : { kind:'animation',
//                        type:'AnimationCompleted',
//                        ref: <T1 ref> }  (the trigger's OWN ref)
//   T2  AnimationStarted(ref=T1)
//   T3  AnimationCompleted(ref=T1)
//       → predicate matches → EffectReady('trigger-show:Ash:1')
//   T4  MSG_CHAINING(SE Ash effect, chain-1)  (the trigger-effect)
//
// Self-referential — the deferred waits for the trigger's own
// `AnimationCompleted`. The trigger fires on every MSG_MOVE landing
// in MZONE; the projection consumer (β.3) decides whether to actually
// gate an overlay show on this EffectReady (most won't — the trigger-
// effect happens unconditionally after the summon animation in any
// case). Kept as a baseline pattern; β.3 will tune which msgTypes /
// cardCodes actually open one.

const triggerShow: DeferredRule = {
  trigger: e => isMove(e) && e.toLocation === LOCATION.MZONE,
  deriveName: (e, ref) => {
    const m = e as MoveMsg;
    return `trigger-show:${m.cardCode}:${ref}`;
  },
  derivePredicate: (_e, ref) => ({
    kind: 'animation',
    type: 'AnimationCompleted',
    ref,
  }),
};

// ---------------------------------------------------------------------------
// #6 — attack-impact (Battle + impact)
// ---------------------------------------------------------------------------
//
// Trigger: MSG_ATTACK. Predicate: AnimationCompleted of the same
// MSG_ATTACK (the attack line + clash impact animation). A counter-
// trap that chains in response to the attack opens its overlay only
// after the impact has finished. Single-ref, no compound.

const attackImpact: DeferredRule = {
  trigger: e => isAttack(e),
  deriveName: (_e, ref) => `attack-impact:${ref}`,
  derivePredicate: (_e, ref) => ({
    kind: 'animation',
    type: 'AnimationCompleted',
    ref,
  }),
};

// ---------------------------------------------------------------------------
// #9 — lp-cost (LP-payment as activation cost)
// ---------------------------------------------------------------------------
//
// Trigger: MSG_PAY_LPCOST. Predicate: AnimationCompleted of the same
// MSG_PAY_LPCOST. The overlay reveal of an LP-cost-paying effect
// (Solemn Judgment style) waits for the counter animation of the LP
// loss before showing.

const lpCost: DeferredRule = {
  trigger: e => isPayLpCost(e),
  deriveName: (_e, ref) => `lp-cost:${ref}`,
  derivePredicate: (_e, ref) => ({
    kind: 'animation',
    type: 'AnimationCompleted',
    ref,
  }),
};

// ---------------------------------------------------------------------------
// #10 — counter-pulse (Visual badge lifecycle)
// ---------------------------------------------------------------------------
//
// Trigger: MSG_ADD_COUNTER or MSG_REMOVE_COUNTER. Predicate:
// AnimationCompleted of the same event. The counter badge mutation
// (display +/- update) waits for the pulse animation to finish.

const counterPulse: DeferredRule = {
  trigger: e => isAddOrRemoveCounter(e),
  deriveName: (_e, ref) => `counter-pulse:${ref}`,
  derivePredicate: (_e, ref) => ({
    kind: 'animation',
    type: 'AnimationCompleted',
    ref,
  }),
};

// ---------------------------------------------------------------------------
// #12 — xyz-leave-with-materials (Flow rewrite, β.3 — sole RewriterRule)
// ---------------------------------------------------------------------------
//
// Canonical scenario : un monstre XYZ avec N matériaux quitte le terrain
// (toute raison — battle destroy, Link material, Tribute, return-to-deck,
// banishment). OCGCore émet ensuite N `MSG_MOVE GRAVE→GRAVE reason=0x600`
// pour positionner les ex-matériaux dans le GY post-départ de l'XYZ. Le
// routeur tombe sur la branche `pileToPile` → flashs des matériaux dans le
// GY au lieu d'un travel propre depuis la zone MZONE de l'XYZ parti.
//
// Le rule absorbe ces N settling events du routing aval + synthétise N
// MSG_MOVE virtuels `OVERLAY→GRAVE` (un par matériau) avec
// `fromSequence = m.fromSequence` (la position MZONE de l'XYZ source).
// Le routeur les anime via la branche existante `processOverlayDetachEvent`
// (slide-out + travel depuis MZONE vers GY).
//
// Cf. spec parent §1 + §4 et catalogue §1bis cas #12.
// Cf. ARCHITECTURE GUARD au-dessus de `RewriterRule` —
// `xyzLeaveWithMaterials` est l'UNIQUE rewriter shipped à β.3.

/**
 * Détection du pattern « XYZ avec matériaux quittant le terrain ». Le
 * trigger NE LIT PAS la `reason` du MSG_MOVE de l'XYZ — toutes les
 * raisons de départ sont couvertes (destroy, release, link, redirect,
 * etc.). La détection robuste est « XYZ qui part du terrain », peu
 * importe pourquoi.
 *
 * Filtre via `overlayMaterials.length > 0` (champ Commit 0bis du
 * protocole). Defensive : le helper retourne `[]` si le champ est
 * absent (cas pré-Commit 0bis, vieux replays) — le trigger renvoie
 * `false` silencieusement.
 *
 * EMZ : `LOCATION.MZONE` couvre les zones EMZ aussi (EMZ slots
 * identifiés par `sequence ∈ [5,6]` — cf. CLAUDE.md MR5 EMZ
 * convention). Pas besoin d'un `LOCATION.EMZ` séparé.
 */
function isXyzLeaveWithMaterials(e: StreamEvent): e is MoveMsg {
  if (!isMove(e)) return false;
  if (e.fromLocation !== LOCATION.MZONE) return false;
  const materials = readOverlayMaterialsAtTrigger(e);
  if (materials.length === 0) return false;
  return true;
}

/**
 * Helper défensif : retourne `[]` si `overlayMaterials` est absent du
 * `MoveMsg` (cas pré-Commit 0bis, ou non-XYZ). Post-Commit 0bis, le
 * serveur peuple le champ via la query `OcgQueryFlags.OVERLAY_CARD`
 * capturée AVANT mutation OCGCore (snapshot pré-process).
 *
 * Note : `overlayMaterials` n'est PAS encore dans le type `MoveMsg`
 * front (Commit 0bis pas mergé) — d'où le cast via `unknown`. Une fois
 * Commit 0bis mergé, le cast deviendra inutile.
 */
function readOverlayMaterialsAtTrigger(m: MoveMsg): readonly number[] {
  return (m as unknown as { overlayMaterials?: number[] }).overlayMaterials ?? [];
}

/**
 * Payload porté par la deferred `xyz-leave:<ref>` entre `onTrigger`,
 * `chainTo` (consommé sur chaque settling match) et `onClose?`
 * (release garanti sur 3 chemins matched/timeout/checkpoint).
 *
 * Mutation par `chainTo` autorisée par le contrat
 * `ActiveDeferredView.payload` — opaque côté DEP, mutable côté rule.
 */
interface XyzLeavePayload {
  /** Lock externe sur la zone MZONE de l'XYZ source. Empêche
   *  `commitUnlocked` de démonter la zone OVERLAY pendant que les N
   *  virtuels animent. */
  xyzZoneLock: ZoneLock;
  /** CardCodes des matériaux attendus en settling. Décrémenté dans
   *  `chainTo` à chaque absorb. */
  expectedCardCodes: Set<number>;
  /** Compteur de settlings restants à absorber. */
  remaining: number;
}

const xyzLeaveWithMaterials: RewriterRule = {
  kind: 'rewriter',

  trigger: isXyzLeaveWithMaterials,

  deriveName: (_e, ref) => `xyz-leave:${ref}`,

  /**
   * Predicate awaiting : settling event `GRAVE→GRAVE reason=0x600` du
   * MÊME joueur (controller) que l'XYZ qui vient de partir.
   *
   * Le champ `player` (résolution Q4 audit, Axel 2026-05-26) serre la
   * mass-destruction bilatérale — un matériau a toujours le même
   * controller que l'XYZ qui le portait, donc aucun risque de faux
   * négatif. Sans `player`, en cas de Dark Hole bilatéral, chaque
   * deferred verrait les 4 settlings et `chainTo` filtrerait via
   * `expectedCardCodes` — match plus tardif, robustesse moindre.
   */
  derivePredicate: (e) => {
    const m = e as MoveMsg;
    return {
      type: 'MSG_MOVE',
      player: m.player,
      fromLocation: LOCATION.GRAVE,
      toLocation: LOCATION.GRAVE,
      reason: REASON_XYZ_MATERIAL_SETTLE,
    };
  },

  /**
   * Side-effect au trigger : acquiert le lock externe sur la zone
   * MZONE source + synthétise N MSG_MOVE virtuels OVERLAY→GRAVE
   * (taggués via `tagAsVirtual`).
   *
   * Le sink fait la conversion absolu→relatif via `ctx.relativePlayer`
   * et construit la zone key DOM `${zoneId}-${relPlayer}` en interne
   * (résolution Q5 audit, Axel 2026-05-26) — le rule reste agnostique
   * de la convention DOM.
   *
   * ⚠️ Pass 1 d'impl Commit 2 : la signature `lockZone(zoneId,
   * absolutePlayer)` doit-elle aussi prendre `sequence` pour cibler
   * la zone MZONE-N spécifique (pas juste la zone MZONE générique) ?
   * Question Q5 résiduelle — à figer en début de Commit 2 selon le
   * format réel des zone keys construites par `locationToZoneKey`. En
   * attendant, NO_OP_SINKS.lockZone est un no-op release (tests OK,
   * prod inerte tant que Commit 2 n'est pas wired).
   */
  onTrigger: (e, _ref, sinks) => {
    const m = e as MoveMsg;
    const materials = readOverlayMaterialsAtTrigger(m);

    // 1. Lock externe sur la zone MZONE de l'XYZ source.
    const xyzZoneLock = sinks.lockZone(LOCATION.MZONE, m.player);

    // 2. Synthétiser N virtuels OVERLAY→GRAVE, taggués virtuels.
    const virtuals: MoveMsg[] = materials.map(cardCode => tagAsVirtual({
      type: 'MSG_MOVE',
      player: m.player,
      toPlayer: m.player,
      cardCode,
      cardName: '',                                // résolu côté front si nécessaire
      fromLocation: LOCATION.OVERLAY,
      fromSequence: m.fromSequence,                // position MZONE de l'XYZ source
      fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.GRAVE,
      toSequence: 0,                                // GRAVE = pile, sequence ignoré par le routeur
      toPosition: POSITION.FACEUP_ATTACK,
      isToken: false,
      reason: REASON_XYZ_MATERIAL_SETTLE,
    } satisfies MoveMsg));
    sinks.enqueueVirtualMoves(virtuals);

    // 3. Retourner le payload — porté par la deferred jusqu'au close.
    return {
      payload: {
        xyzZoneLock,
        expectedCardCodes: new Set(materials),
        remaining: materials.length,
      } satisfies XyzLeavePayload,
    };
  },

  /**
   * Verdict d'absorption sur chaque settling matchant le predicate.
   *
   * Mutate le payload (decrement remaining + delete cardCode) —
   * autorisé par le contrat (le DEP ne lit ni n'écrit dans `payload`).
   *
   * - `cardCode` hors liste → rearm avec MÊME predicate (probablement
   *   le settling d'un AUTRE XYZ parti en parallèle ; un autre
   *   deferred l'absorbera). Pas de modification du payload.
   * - dernier matériau → `absorb-and-close` (close la deferred + emit
   *   EffectReady + appelle onClose? avec reason='matched').
   * - sinon → `absorb` (deferred reste ouverte, predicate inchangé).
   */
  chainTo: (matched, _ref, deferred: ActiveDeferredView): RewriterVerdict => {
    if (!isMove(matched)) return null; // never happens given the predicate
    const payload = deferred.payload as XyzLeavePayload;

    if (!payload.expectedCardCodes.has(matched.cardCode)) {
      // Settling orphelin — un autre deferred l'absorbera. Rearm avec
      // même predicate pour rester à l'écoute des nôtres. Pas un
      // close (qui abandonnerait nos vrais settlings attendus).
      return deferred.awaitingPredicate;
    }

    payload.expectedCardCodes.delete(matched.cardCode);
    payload.remaining -= 1;

    if (payload.remaining === 0) {
      return { kind: 'absorb-and-close' };
    }
    return { kind: 'absorb' };
  },

  /**
   * Release du lock externe — appelé sur les 3 chemins de fermeture
   * (`'matched'` / `'timeout'` / `'checkpoint'`). Garantie no-leak
   * peu importe le chemin (décision D2 architecture review).
   *
   * `ZoneLock.release` est idempotent — safe sur double-fermeture.
   */
  onClose: (payload, _reason) => {
    (payload as XyzLeavePayload).xyzZoneLock.release();
  },
};

// ---------------------------------------------------------------------------
// Stubs deferred to β.2b-bis / β.3 — kept inline as documentation so a
// future reader sees why they're not shipped at β.2b.
// ---------------------------------------------------------------------------
//
// **#3 search-reveal-sync** — needs to know "this MSG_CHAINING is a
// tutor effect" before any deck→hand MSG_MOVE arrives. No flux-only
// signal exists; β.x narrows by per-card cardCode allowlist (Pot of
// Desires, Pot of Greed, Foolish Burial Goods, …).
//
// **#4 flip-summon-trigger** — needs MSG_FLIPSUMMONED which the
// current WS protocol does not declare separately from MSG_FLIP_SUMMONING.
// β.x adds a stream event or co-opts a BOARD_STATE delta.
//
// **#5 banish-seq** — sequential N-event naming (`banish-seq:<ref>:1`,
// `banish-seq:<ref>:2`, …) requires the rule to know "how many more
// in the burst" — needs lookahead. β.x explores a state-machine rule
// that opens incrementally per event in the burst.
//
// **#7 equip-stat** — predicate compound (MSG_MOVE then MSG_EQUIP)
// with a card-typing precondition (`EQUIP` Spell). The flux carries
// neither the card-type nor a guaranteed MSG_EQUIP ordering. β.x.
//
// **#8 xyz-attach** — counts N matériaux + final XYZ pose. Same
// lookahead issue as #5 + complex sequence detection. The
// test-of-victory #3 (multi-material XYZ) is deferred with this rule.
//
// **#11 pile-float-cleanup** — needs `TargetIndicatorManager` to
// emit on the stream first. β.2c.

export const RULES: readonly DeferredRule[] = [
  overlayShow,
  triggerShow,
  attackImpact,
  lpCost,
  counterPulse,
  xyzLeaveWithMaterials,
];
