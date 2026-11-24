import { CardDetailDTO } from '../../../core/model/dto/card-detail-dto';

/** A set that booster mode can open — mirror of back BoosterSetDTO. */
export interface BoosterSetDTO {
  name: string;
  /** Set prefix of its prints (e.g. "LOB"), may be null. */
  code: string | null;
  cardCount: number;
}

export type BoosterDeckZone = 'MAIN' | 'EXTRA';

/** One pulled copy — mirror of back PulledCardDTO. `id` identifies the copy. */
export interface PulledCardDTO {
  id: number;
  boosterIndex: number;
  slotIndex: number;
  card: CardDetailDTO;
  deckZone: BoosterDeckZone | null;
  deckIndex: number | null;
}

/** The connected player's side of a booster room — mirror of back BoosterStateDTO. */
export interface BoosterStateDTO {
  setName: string;
  boosterCount: number;
  openedBoosters: number;
  minMainDeckSize: number;
  maxMainDeckSize: number;
  maxExtraDeckSize: number;
  ready: boolean;
  cards: PulledCardDTO[];
}

/** Deck submitted when marking ready: pulled-copy ids, in deck order. */
export interface BoosterDeckDTO {
  main: number[];
  extra: number[];
}
