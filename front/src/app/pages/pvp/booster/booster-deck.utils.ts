import { CardType } from '../../../core/enums/card-type.enum';
import { CardDetail } from '../../../core/model/card-detail';
import { BoosterDeckDTO, BoosterDeckZone, PulledCardDTO } from './booster.types';

/** Every pulled copy of one card, with how many are in the deck. */
export interface PoolEntry {
  readonly cardId: number;
  readonly detail: CardDetail;
  readonly zone: BoosterDeckZone;
  /** Ids of the pulled copies, in pull order. */
  readonly copyIds: readonly number[];
  readonly inDeck: number;
}

export interface DeckLimits {
  readonly minMain: number;
  readonly maxMain: number;
  readonly maxExtra: number;
}

export type DeckProblem = 'mainTooSmall' | 'mainTooLarge' | 'extraTooLarge';

export function zoneOf(pull: PulledCardDTO): BoosterDeckZone {
  return pull.card.card.extraCard ? 'EXTRA' : 'MAIN';
}

/** Monsters by level (high first), then spells, then traps, then name. */
function sortRank(detail: CardDetail): number {
  const types = detail.card.types ?? [];
  if (types.includes(CardType.SPELL)) return 1;
  if (types.includes(CardType.TRAP)) return 2;
  return 0;
}

export function comparePoolEntries(a: PoolEntry, b: PoolEntry): number {
  if (a.zone !== b.zone) return a.zone === 'MAIN' ? -1 : 1;
  const rank = sortRank(a.detail) - sortRank(b.detail);
  if (rank !== 0) return rank;
  const level = (b.detail.card.level ?? 0) - (a.detail.card.level ?? 0);
  if (level !== 0) return level;
  return (a.detail.card.name ?? '').localeCompare(b.detail.card.name ?? '');
}

/** Groups the pulled copies by card, counting those in `deckIds`. */
export function buildPool(pulls: readonly PulledCardDTO[], deckIds: ReadonlySet<number>): PoolEntry[] {
  const byCard = new Map<number, { detail: CardDetail; zone: BoosterDeckZone; copyIds: number[] }>();
  for (const pull of pulls) {
    const cardId = pull.card.card.id ?? pull.card.card.passcode ?? 0;
    let entry = byCard.get(cardId);
    if (!entry) {
      entry = { detail: new CardDetail(pull.card), zone: zoneOf(pull), copyIds: [] };
      byCard.set(cardId, entry);
    }
    entry.copyIds.push(pull.id);
  }
  return [...byCard.entries()]
    .map(([cardId, e]) => ({
      cardId,
      detail: e.detail,
      zone: e.zone,
      copyIds: e.copyIds,
      inDeck: e.copyIds.filter(id => deckIds.has(id)).length,
    }))
    .sort(comparePoolEntries);
}

/** The deck the player submitted earlier, restored from the pulls. */
export function deckFromPulls(pulls: readonly PulledCardDTO[]): BoosterDeckDTO {
  const ordered = (zone: BoosterDeckZone) => pulls
    .filter(p => p.deckZone === zone)
    .sort((a, b) => (a.deckIndex ?? 0) - (b.deckIndex ?? 0))
    .map(p => p.id);
  return { main: ordered('MAIN'), extra: ordered('EXTRA') };
}

/** Adds one free copy of `entry` to its zone; unchanged when none is free or the zone is full. */
export function addCopy(deck: BoosterDeckDTO, entry: PoolEntry, limits: DeckLimits): BoosterDeckDTO {
  const used = new Set([...deck.main, ...deck.extra]);
  const free = entry.copyIds.find(id => !used.has(id));
  if (free === undefined) return deck;
  if (entry.zone === 'MAIN') {
    return deck.main.length >= limits.maxMain ? deck : { ...deck, main: [...deck.main, free] };
  }
  return deck.extra.length >= limits.maxExtra ? deck : { ...deck, extra: [...deck.extra, free] };
}

/** Removes the last added copy of `entry` from the deck. */
export function removeCopy(deck: BoosterDeckDTO, entry: PoolEntry): BoosterDeckDTO {
  const ids = new Set(entry.copyIds);
  const list = entry.zone === 'MAIN' ? deck.main : deck.extra;
  const lastIndex = list.map(id => ids.has(id)).lastIndexOf(true);
  if (lastIndex < 0) return deck;
  const next = list.filter((_, i) => i !== lastIndex);
  return entry.zone === 'MAIN' ? { ...deck, main: next } : { ...deck, extra: next };
}

/** Every pulled copy, up to the zone maxima, in pool order. */
export function fillDeck(pool: readonly PoolEntry[], limits: DeckLimits): BoosterDeckDTO {
  const main: number[] = [];
  const extra: number[] = [];
  for (const entry of pool) {
    const target = entry.zone === 'MAIN' ? main : extra;
    const max = entry.zone === 'MAIN' ? limits.maxMain : limits.maxExtra;
    for (const id of entry.copyIds) {
      if (target.length < max) target.push(id);
    }
  }
  return { main, extra };
}

export function deckProblem(deck: BoosterDeckDTO, limits: DeckLimits): DeckProblem | null {
  if (deck.main.length < limits.minMain) return 'mainTooSmall';
  if (deck.main.length > limits.maxMain) return 'mainTooLarge';
  if (deck.extra.length > limits.maxExtra) return 'extraTooLarge';
  return null;
}
