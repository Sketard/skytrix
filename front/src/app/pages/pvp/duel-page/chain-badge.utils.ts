import { LOCATION } from '../duel-ws.types';
import type { ChainLinkState } from '../types';

/**
 * Find the current hand index for a chain link card by matching cardCode,
 * preferring the index closest to the original sequence. Falls back to
 * original sequence when cardCode matching fails (opponent face-down cards).
 *
 * F9-bis hand-discard fix (2026-06-04) — when `handCopiesAtChaining` is
 * supplied AND the current count of `cardCode` copies in `handCards` is
 * strictly lower than it, at least one copy has left the hand since the
 * activation. Almost always that's the activated card itself (discarded
 * for its own cost); the remaining copies are unrelated. Return -1 so
 * the resolver refuses to misroute the badge. Without this guard the
 * `bestDist` heuristic happily lands the badge on the closest remaining
 * copy. Falsy `handCopiesAtChaining` (legacy payloads, non-HAND
 * activations) skips the guard — pre-fix behavior preserved.
 */
function findCurrentIndex(
  cardCode: number, originalSeq: number,
  handCards: readonly { cardCode: number | null }[],
  usedIndices: Set<number>,
  handCopiesAtChaining?: number,
): number {
  if (handCopiesAtChaining != null) {
    let currentCount = 0;
    for (let i = 0; i < handCards.length; i++) {
      if (handCards[i].cardCode === cardCode) currentCount++;
    }
    // Strict less-than: one or more copies left the hand → assume the
    // activated card was among them. Equal counts mean every original
    // copy is still there, so matching by proximity is safe.
    if (currentCount < handCopiesAtChaining) return -1;
  }
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < handCards.length; i++) {
    if (usedIndices.has(i) || handCards[i].cardCode !== cardCode) continue;
    const dist = Math.abs(i - originalSeq);
    if (dist < bestDist) { bestIdx = i; bestDist = dist; }
  }
  if (bestIdx !== -1) { usedIndices.add(bestIdx); return bestIdx; }
  if (originalSeq < handCards.length && !usedIndices.has(originalSeq)) {
    usedIndices.add(originalSeq);
    return originalSeq;
  }
  return -1;
}

/**
 * Build a Map<handIndex, chainNumber> for hand cards belonging to `playerIndex`.
 * Matches chain links to current hand positions by cardCode to survive hand reflow.
 * Only populated when chain has ≥2 links OR phase is 'resolving'.
 */
export function buildHandChainBadges(
  links: readonly ChainLinkState[], playerIndex: number, chainPhase: string,
  handCards: readonly { cardCode: number | null }[],
): Map<number, number> {
  const map = new Map<number, number>();
  if (links.length < 2 && chainPhase !== 'resolving') return map;
  const used = new Set<number>();
  for (const link of links) {
    if (link.location !== LOCATION.HAND || link.player !== playerIndex) continue;
    const idx = findCurrentIndex(link.cardCode, link.sequence, handCards, used, link.handCopiesAtChaining);
    if (idx === -1) continue;
    const chainNum = link.chainIndex + 1;
    if (!map.has(idx) || map.get(idx)! < chainNum) map.set(idx, chainNum);
  }
  return map;
}

/**
 * Build a Map<handIndex, cardCode> for the player's OWN hand cards that are
 * part of any chain link — i.e. cards the player activated from hand and that
 * are now revealed to the opponent. Unlike {@link buildHandChainBadges} this
 * has NO ≥2-link threshold: a single-link chain (a lone hand-trap / spell)
 * must still flag its card so the template can raise its z-index above the
 * fan neighbours while it is shown.
 */
export function buildHandRevealedCards(
  links: readonly ChainLinkState[], playerIndex: number,
  handCards: readonly { cardCode: number | null }[],
): Map<number, number> {
  const revealed = new Map<number, number>();
  const used = new Set<number>();
  for (const link of links) {
    if (link.location !== LOCATION.HAND || link.player !== playerIndex) continue;
    const idx = findCurrentIndex(link.cardCode, link.sequence, handCards, used, link.handCopiesAtChaining);
    if (idx === -1) continue;
    if (link.cardCode) revealed.set(idx, link.cardCode);
  }
  return revealed;
}

/**
 * Build badges + revealed card codes for opponent hand cards in chain.
 * Matches chain links to current hand positions by cardCode to survive hand reflow.
 */
export function buildOpponentHandChainData(
  links: readonly ChainLinkState[], ownPlayerIndex: number, chainPhase: string,
  handCards: readonly { cardCode: number | null }[],
): { badges: Map<number, number>; revealed: Map<number, number> } {
  const showBadges = links.length >= 2 || chainPhase === 'resolving';
  const badges = new Map<number, number>();
  const revealed = new Map<number, number>();
  const used = new Set<number>();
  for (const link of links) {
    if (link.location !== LOCATION.HAND || link.player === ownPlayerIndex) continue;
    const idx = findCurrentIndex(link.cardCode, link.sequence, handCards, used, link.handCopiesAtChaining);
    if (idx === -1) continue;
    if (showBadges) {
      const chainNum = link.chainIndex + 1;
      if (!badges.has(idx) || badges.get(idx)! < chainNum) badges.set(idx, chainNum);
    }
    if (link.cardCode) revealed.set(idx, link.cardCode);
  }
  return { badges, revealed };
}
