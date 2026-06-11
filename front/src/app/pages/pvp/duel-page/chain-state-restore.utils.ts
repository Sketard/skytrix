import type { ChainingMsg } from '../duel-ws.types';
import type { ChainLinkState } from '../types';
import { locationToZoneId } from '../pvp-zone.utils';

/**
 * Convert a server-side `ChainingMsg[]` snapshot + a set of negated chain
 * indices into the `ChainLinkState[]` shape the `DuelEventProcessor` stores
 * in `activeChainLinks`.
 *
 * Shared between two consumers that BOTH receive the same server-side
 * snapshot shape:
 *
 *   1. PvP `_handleChainState` (reconnect handshake) — `ChainStateMsg.links`
 *      from the server's session-level `ChainStateContainer`.
 *   2. Replay `MockDuelConnection.seekToOffset` (mid-chain seek) —
 *      `ReplayStreamNavEntry.chainSnapshot.links`
 *      from the precompute's per-entry `ChainStateContainer` (F9-bis,
 *      2026-06-04). Without this restore, the overlay + chain badges stay
 *      empty after seeking into a chain because `processor.reset()` wipes
 *      `activeChainLinks` and no `MSG_CHAINING(1..N-1)` is re-fed.
 *
 * `resolving: false` on every link by convention: a reconnect / seek lands
 * the user on a snapshot. The per-link `resolving` flag is set by the
 * caller via `processor.applyChainSolving(currentSolvingChainIndex)` when
 * the snapshot also carries that field (`ReplayStreamNavEntry.chainSnapshot`
 * does; the PvP `ChainStateMsg` does not — the live worker fires
 * `MSG_CHAIN_SOLVING` as a real message after the handshake instead).
 */
export function chainingMsgsToLinkStates(
  links: ChainingMsg[],
  negatedIndices: ReadonlySet<number>,
): ChainLinkState[] {
  return links.map(msg => ({
    chainIndex: msg.chainIndex,
    cardCode: msg.cardCode,
    cardName: msg.cardName,
    player: msg.player,
    zoneId: locationToZoneId(msg.location, msg.sequence),
    location: msg.location,
    sequence: msg.sequence,
    resolving: false,
    negated: negatedIndices.has(msg.chainIndex),
    descriptionText: msg.descriptionText,
    handCopiesAtChaining: msg.handCopiesAtChaining,
  }));
}
