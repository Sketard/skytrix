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

export type AnimationFluxEvent =
  | AnimationStartedEvent
  | AnimationCompletedEvent;

/** Guard: discriminate an `AnimationFluxEvent` from any `StreamEvent`
 *  member. Mirror of `isBoundaryEvent` / `isDeferredFluxEvent`. */
export function isAnimationFluxEvent(e: unknown): e is AnimationFluxEvent {
  return typeof e === 'object' && e !== null
    && (e as { kind?: unknown }).kind === 'animation';
}
