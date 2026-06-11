// =============================================================================
// boundary-processor.ts — β.1 (2026-05-26)
// -----------------------------------------------------------------------------
// Detects causal-group boundaries (Chain / Turn / Phase) and emits them as
// {@link BoundaryEvent}s on the duel's EventStream. Cf.
// `_bmad-output/planning-artifacts/duel-session-chantier.md §3.8`.
//
// Plain class — instantiated privately by `DuelEventProcessor`, which calls
// `observeMessage()` for every WS message in the order they arrive and
// `observeBoardState()` for each BOARD_STATE payload received by the
// adapter layer (DuelConnection / MockDuelConnection). The processor
// itself owns the emit callback, so boundaries land on the same stream
// as `MSG_CHAIN_NEGATED`, `MSG_WIN`, etc. — `onEvent` in the processor.
//
// Sync mandatory (§3.8): boundary emission runs BEFORE the matching
// MSG_* / BOARD_STATE field is forwarded to projections, so a
// projection never sees `MSG_CHAINING(N)` without having seen
// `ChainStarted(N)` first, nor a BOARD_STATE with a new `turnCount`
// without `TurnStarted` first.
//
// Detection rules (flat OCGCore guarantee — chains never nest, turns
// never overlap, phases are strictly sequential):
//   · `MSG_CHAINING` with the chain currently idle → `ChainStarted(idx)`
//     (idx = `chainIndex` from the message). Subsequent `MSG_CHAINING`s
//     during the same chain (`chainPhase` already 'building') do NOT
//     re-open — they accumulate links into the same chain.
//   · `MSG_CHAIN_END` → `ChainEnded(chainId)` where `chainId` is the
//     id captured at `ChainStarted` (the chain may have grown multi-link
//     since then; the boundary id stays at the opening id).
//   · BOARD_STATE delta on `turnCount` → `TurnEnded(prev)` (if a turn
//     was open) + `TurnStarted(new)`.
//   · BOARD_STATE delta on `phase` → `PhaseEnded(prev)` (if a phase
//     was open) + `PhaseStarted(new)`.
//   · First BOARD_STATE (no `lastTurnSeen` yet) → `TurnStarted(N)` +
//     `PhaseStarted(P)` with no preceding `*Ended`. Asymmetric by
//     design — a duel opens with no preceding turn/phase.
//
// Mismatch detection (§3.8 §"strict assert"):
//   · `MSG_CHAIN_END` while `chainOpen === null` → `logger.warn`
//     (escalation to throw was considered; rejected because legitimate
//     pre-β.1 specs feed isolated MSG_CHAIN_END as a queue-routing test
//     and would all fail. The self-heal `ChainEnded(-1)` keeps the
//     journal consistent; production sequencing bugs surface via the
//     warn in DevHub + the synthetic chainId).
//   · `MSG_CHAINING(N)` while `chainOpen !== null` is naturally
//     ignored (multi-link accumulation), but logged in case the
//     upstream contract drifts. Today this is the only documented
//     OCGCore behaviour — see `chain-state-tracker.spec.ts:68-77`.
//
// Forced closure (§3.6 checkpoints + DUEL_END):
//   · `forceClosure('STATE_SYNC' | 'RematchStarted' | 'DuelEnded')`
//     synthesizes the missing `*Ended` for every open group, in inner-
//     to-outer order (Chain before Phase before Turn), then resets the
//     internal state. The caller (DuelEventProcessor / orchestrator)
//     drives this — the BP itself does not observe checkpoint messages
//     directly.
// =============================================================================

import type { BoundaryEvent, ChainStartedEvent } from '../types';
import type {
  BoardStatePayload, ChainingMsg, Phase, Player, ServerMessage,
} from '../duel-ws.types';
import type { DuelLogger } from './duel-logger';

/** Reason passed to `forceClosure` — drives the dev-mode log site only. */
export type BoundaryClosureReason =
  | 'STATE_SYNC'
  | 'RematchStarted'
  | 'DuelEnded';

export class BoundaryProcessor {
  /**
   * `chainOpen` holds the id captured at the opening `MSG_CHAINING`.
   * Stays set across multi-link chains (subsequent `MSG_CHAINING`s
   * during 'building' do NOT reset it) until `MSG_CHAIN_END` closes
   * the whole group. `null` means no chain is open.
   */
  private chainOpen: number | null = null;

  /** Last `turnCount` + `turnPlayer` observed on a BOARD_STATE. `null`
   *  before the first BOARD_STATE arrives. */
  private lastTurn: { turnNumber: number; player: Player } | null = null;

  /** Last `phase` observed on a BOARD_STATE. `null` before the first
   *  BOARD_STATE arrives. */
  private lastPhase: Phase | null = null;

  /**
   * Sink for emitted boundary events. Assigned by `DuelEventProcessor`
   * at construction so the BP doesn't need to know about the stream
   * shape. Fire-and-forget: the BP does not handle sink failures
   * (consumer responsibility — same contract as `onEvent` upstream).
   *
   * `getLogger` is an accessor (not a stored ref) because the DEP
   * assigns its `logger` field AFTER instantiating the BP — capturing
   * the value at construction time would bind to `undefined`. The
   * closure dereferences lazily inside `observeMessage`.
   */
  constructor(
    private readonly emit: (event: BoundaryEvent) => void,
    private readonly getLogger: () => DuelLogger | undefined = () => undefined,
  ) {}

  /**
   * Observe a raw WS message. Drives chain boundary detection only.
   * Turn/Phase boundaries come from `observeBoardState` (BOARD_STATE
   * is the source of truth for those — there is no `MSG_NEW_TURN` /
   * `MSG_NEW_PHASE` in the WS protocol; the engine signals them via
   * the BOARD_STATE payload deltas).
   */
  observeMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'MSG_CHAINING': {
        const cm = msg as ChainingMsg;
        if (this.chainOpen === null) {
          // Chain opening — emit `ChainStarted(idx)`. The id captured
          // here stays for the whole chain group, even if subsequent
          // MSG_CHAINING messages add links with higher indices.
          this.chainOpen = cm.chainIndex;
          this.emit({
            kind: 'boundary',
            type: 'ChainStarted',
            chainId: cm.chainIndex,
          } satisfies ChainStartedEvent);
        }
        // Subsequent MSG_CHAINING during the same chain — no boundary.
        break;
      }
      case 'MSG_CHAIN_END': {
        const closing = this.chainOpen;
        if (closing === null) {
          // Orphan end — best-effort emit with synthetic chainId=-1 so
          // the journal stays consistent, plus a warn so DevHub surfaces
          // the upstream sequencing anomaly. A duelAssert here would
          // crash legitimate queue-routing tests that feed isolated
          // MSG_CHAIN_END; the warn is enough — see header comment.
          this.getLogger()?.warn(
            '[BOUNDARY] MSG_CHAIN_END received without an open chain — emitting synthetic ChainEnded(-1)');
          this.emit({ kind: 'boundary', type: 'ChainEnded', chainId: -1 });
          return;
        }
        this.chainOpen = null;
        this.emit({ kind: 'boundary', type: 'ChainEnded', chainId: closing });
        break;
      }
      // Other messages are passthrough — the BP only cares about chain
      // open/close on this channel. Turn/Phase travel via BOARD_STATE.
    }
  }

  /**
   * Observe a BOARD_STATE payload. Detects Turn and Phase deltas.
   * Called by the WS adapter (DuelConnection / MockDuelConnection)
   * AFTER `observeMessage` has fired for any preceding MSG_*, so
   * the sync-mandatory ordering is "MSG_* boundaries first, then
   * BOARD_STATE boundaries" within a single WS message — which
   * matches the actual WS arrival order.
   */
  observeBoardState(payload: BoardStatePayload): void {
    const newTurn = payload.turnCount;
    const newPlayer = payload.turnPlayer;
    const newPhase = payload.phase;

    if (this.lastTurn === null) {
      // First BOARD_STATE — open the initial turn + phase. Asymmetric
      // by design (no preceding *Ended). β.1 Option 4.
      this.lastTurn = { turnNumber: newTurn, player: newPlayer };
      this.lastPhase = newPhase;
      this.emit({
        kind: 'boundary', type: 'TurnStarted',
        turnNumber: newTurn, player: newPlayer,
      });
      this.emit({ kind: 'boundary', type: 'PhaseStarted', phase: newPhase });
      return;
    }

    // Turn delta — close the previous turn (which implicitly closes
    // the previous phase too, in inner-to-outer order: Phase, then
    // Turn).
    const turnChanged =
      newTurn !== this.lastTurn.turnNumber
      || newPlayer !== this.lastTurn.player;
    if (turnChanged) {
      if (this.lastPhase !== null) {
        this.emit({ kind: 'boundary', type: 'PhaseEnded', phase: this.lastPhase });
      }
      this.emit({
        kind: 'boundary', type: 'TurnEnded',
        turnNumber: this.lastTurn.turnNumber,
      });
      this.emit({
        kind: 'boundary', type: 'TurnStarted',
        turnNumber: newTurn, player: newPlayer,
      });
      this.emit({ kind: 'boundary', type: 'PhaseStarted', phase: newPhase });
      this.lastTurn = { turnNumber: newTurn, player: newPlayer };
      this.lastPhase = newPhase;
      return;
    }

    // Same turn, possibly different phase.
    if (newPhase !== this.lastPhase) {
      if (this.lastPhase !== null) {
        this.emit({ kind: 'boundary', type: 'PhaseEnded', phase: this.lastPhase });
      }
      this.emit({ kind: 'boundary', type: 'PhaseStarted', phase: newPhase });
      this.lastPhase = newPhase;
    }
  }

  /**
   * Forced closure — synthesize the missing `*Ended` for every open
   * group and reset internal state. Driven by the orchestrator when
   * a §3.6 checkpoint (STATE_SYNC / RematchStarted) or a DUEL_END
   * fires. Inner-to-outer emission order (Chain → Phase → Turn) so
   * a consumer sees groups close in causality order.
   *
   * Does NOT assert on missing groups — by construction these
   * checkpoints can land mid-anything and the BP is the recovery
   * mechanism, not the failure detector.
   */
  forceClosure(_reason: BoundaryClosureReason): void {
    if (this.chainOpen !== null) {
      this.emit({ kind: 'boundary', type: 'ChainEnded', chainId: this.chainOpen });
      this.chainOpen = null;
    }
    if (this.lastPhase !== null) {
      this.emit({ kind: 'boundary', type: 'PhaseEnded', phase: this.lastPhase });
      this.lastPhase = null;
    }
    if (this.lastTurn !== null) {
      this.emit({
        kind: 'boundary', type: 'TurnEnded',
        turnNumber: this.lastTurn.turnNumber,
      });
      this.lastTurn = null;
    }
  }

  /**
   * Silent reset — drops all open-group state WITHOUT emitting any
   * `*Ended`. Distinct from `forceClosure(...)` which emits closures
   * for the journal to see. Use when the duel teardown also drops the
   * stream subscriber (i.e. the projections will be rebuilt fresh and
   * have no use for the closure events).
   */
  silentReset(): void {
    this.chainOpen = null;
    this.lastTurn = null;
    this.lastPhase = null;
  }

  // --- Test-only state inspection (used by spec) -----------------------------

  /** True iff a chain is currently considered open by the BP. */
  hasOpenChain(): boolean { return this.chainOpen !== null; }
  /** True iff a turn is currently considered open by the BP. */
  hasOpenTurn(): boolean { return this.lastTurn !== null; }
}
