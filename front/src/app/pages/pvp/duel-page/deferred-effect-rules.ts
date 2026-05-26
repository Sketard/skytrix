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
import { LOCATION } from '../duel-ws.types';
import type { DeferredRule } from './deferred-effect-processor';

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
];
