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
  return 'PRE_DUEL';
}
