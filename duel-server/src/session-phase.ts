/**
 * Mount-discriminant phase derivation — maps an `ActiveDuelSession` to the
 * `SessionPhaseMsg.phase` value emitted right after `SESSION_TOKEN`.
 *
 * Lets the client decide between mounting the pre-duel dice arena
 * (`PRE_DUEL`), a mid-duel board skeleton (`DUELING`), or the
 * preservation-period end-screen (`ENDED`) without sniffing the n-th
 * message or waiting on a timeout.
 *
 * Pure: takes a session, returns one of three strings. Easily testable
 * without booting the WS server (covered by `session-phase.spec.ts`).
 */
import type { ActiveDuelSession } from './types.js';

export type DerivedSessionPhase = 'PRE_DUEL' | 'DUELING' | 'ENDED';

export function derivePhase(session: ActiveDuelSession): DerivedSessionPhase {
  // ENDED overrides everything: preservation-period reconnect after a duel
  // has resolved. Detected via storedDuelResult (set when DUEL_END is
  // captured for replay/preservation) OR endedAt (set on cleanup paths).
  if (session.storedDuelResult || session.endedAt !== null) return 'ENDED';
  if (session.phase === 'DUELING') return 'DUELING';
  // SOLO multiplex skips the dice arena entirely (no second player to roll
  // against). The worker spawns synchronously the moment the lone WS
  // connects (`isReadyToStart` in lifecycle-helpers.ts returns true on a
  // single connection for SOLO), so `WAITING_PLAYERS` is a sub-millisecond
  // window with no UI value. Reporting `DUELING` upfront lets the SOLO
  // client skip `showDiceArena()` (the "flash dice" symptom) and mount the
  // board skeleton directly while prefetch runs in the background.
  // Cf. parity investigation 2026-06-05 + flash-dice-solo bug.
  if (session.soloMode && session.phase === 'WAITING_PLAYERS') return 'DUELING';
  return 'PRE_DUEL';
}
