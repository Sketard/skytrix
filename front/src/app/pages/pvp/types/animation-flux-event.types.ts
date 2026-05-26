/**
 * β.2b — animation lifecycle events emitted by the
 * `AnimationOrchestratorService` around every dispatched business event.
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md §3.3` +
 * `beta-2-deferred-effect-processor-spec.md §1.5` (the orchestrator wrap
 * pattern — the QueueRunner stays YGO-blind, so the events are emitted
 * one layer up where the YGO `type` of the dispatched message is known).
 *
 * Two events per business message:
 *  · `AnimationStarted({ref, msgType})` — pushed onto the stream
 *    immediately BEFORE the orchestrator awaits the business handler's
 *    Promise / async / number return.
 *  · `AnimationCompleted({ref, msgType})` — pushed onto the stream
 *    immediately AFTER that await resolves (or the synchronous hold
 *    elapses).
 *
 * `ref` is the monotonic counter assigned by the orchestrator at
 * `pushToStream(businessEvent)` time — the SAME `ref` the DEP uses to
 * tag the business event itself. A rule that wants to wait for the
 * completion of a specific MSG_MOVE (cost) returns an
 * `AwaitingPredicate { kind: 'animation', type: 'AnimationCompleted',
 * ref: <captured-from-the-MSG_MOVE-match> }`. The capture happens in
 * the rule's `chainTo` callback, which receives the matched event's ref
 * alongside the event itself.
 *
 * Discriminator: every member carries `kind: 'animation'` so the
 * `StreamEvent` union routes them past MSG_* consumers (the legacy
 * `GameLogBuilder` filters them out — see `duel-game-log.service.ts`).
 *
 * **What's NOT in this union**: per-event progress / per-frame ticks
 * (the renderer-side animation engine doesn't need a flux event for
 * each rAF). β.2b only emits the two lifecycle boundaries; β.x can
 * grow the union if a rule legitimately requires sub-event resolution.
 */

export interface AnimationStartedEvent {
  kind: 'animation';
  type: 'AnimationStarted';
  /** Monotonic stream ref assigned to the underlying business event. */
  ref: number;
  /** The YGO message type the orchestrator is about to dispatch
   *  (e.g. `'MSG_MOVE'`, `'MSG_DRAW'`). Lets a rule narrow on the
   *  message family without having to peek at the original event. */
  msgType: string;
}

export interface AnimationCompletedEvent {
  kind: 'animation';
  type: 'AnimationCompleted';
  ref: number;
  msgType: string;
}

/**
 * β.3 Standardisation 1 (2026-05-26) — emitted by handlers that have
 * an INTERNAL sub-phase ending before the overall animation completes
 * (e.g. `MSG_SWAP_GRAVE_DECK`'s glow finishes mid-handler, before the
 * travel even starts). Projections that need to clear a transient
 * visual at the sub-phase boundary observe this event instead of
 * `AnimationCompleted` (which fires at the END of the handler's hold,
 * too late for sub-phase clears).
 *
 * **Emission contract**: handlers emit via the orchestrator's
 * `phaseWait(phase, durationMs, msgType)` helper, which combines the
 * setTimeout wait + the stream push. The `ref` is the same as the
 * business event's stream ref (`_transport_lastDispatchedRef`), so a
 * rule's `awaitingPredicate` can pin to "the glow of THIS specific
 * MSG_SWAP_GRAVE_DECK" if it ever needed to.
 *
 * **`phase` namespace**: handler-defined string identifier — `'glow'`
 * for swapGraveDeck, future handlers add their own. Uniqueness is by
 * pair `(msgType, phase)`. Standardise to lowercase kebab-case
 * (`'glow'`, `'fade-out'`, `'pulse-impact'`) for grep-ability.
 *
 * **What's NOT in scope**: per-frame ticks, intra-phase progress.
 * Only the boundaries between named phases. A handler with N
 * sub-phases emits N `AnimationPhaseCompleted` events plus the
 * final `AnimationCompleted` when the runner's hold elapses.
 */
export interface AnimationPhaseCompletedEvent {
  kind: 'animation';
  type: 'AnimationPhaseCompleted';
  /** Handler-defined sub-phase identifier (lowercase kebab-case). */
  phase: string;
  /** YGO source message type — same value as `AnimationCompleted.msgType`. */
  msgType: string;
  /** Stream ref of the parent business event. */
  ref: number;
}

export type AnimationFluxEvent =
  | AnimationStartedEvent
  | AnimationCompletedEvent
  | AnimationPhaseCompletedEvent;

/** Guard: discriminate an `AnimationFluxEvent` from any `StreamEvent`
 *  member. Mirror of `isBoundaryEvent` / `isDeferredFluxEvent`. */
export function isAnimationFluxEvent(e: unknown): e is AnimationFluxEvent {
  return typeof e === 'object' && e !== null
    && (e as { kind?: unknown }).kind === 'animation';
}
