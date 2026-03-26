import { LOCATION } from '../duel-ws.types';
import type { ChainLinkState } from '../types';

/**
 * Find the current hand index for a chain link card by matching cardCode,
 * preferring the index closest to the original sequence. Falls back to
 * original sequence when cardCode matching fails (opponent face-down cards).
 */
function findCurrentIndex(
  cardCode: number, originalSeq: number,
  handCards: readonly { cardCode: number | null }[],
  usedIndices: Set<number>,
): number {
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
    const idx = findCurrentIndex(link.cardCode, link.sequence, handCards, used);
    if (idx === -1) continue;
    const chainNum = link.chainIndex + 1;
    if (!map.has(idx) || map.get(idx)! < chainNum) map.set(idx, chainNum);
  }
  return map;
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
    const idx = findCurrentIndex(link.cardCode, link.sequence, handCards, used);
    if (idx === -1) continue;
    if (showBadges) {
      const chainNum = link.chainIndex + 1;
      if (!badges.has(idx) || badges.get(idx)! < chainNum) badges.set(idx, chainNum);
    }
    if (link.cardCode) revealed.set(idx, link.cardCode);
  }
  return { badges, revealed };
}
