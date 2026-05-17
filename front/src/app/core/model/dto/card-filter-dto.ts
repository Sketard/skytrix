import { CardAttribute } from '../../enums/card-attribute';
import { CardRace } from '../../enums/card-race.enum';
import { CardType } from '../../enums/card-type.enum';

export class CardFilterDTO {
  minAtk: number | null;
  maxAtk: number | null;
  minDef: number | null;
  maxDef: number | null;
  name: string | null;
  attribute: CardAttribute | null;
  archetype: string | null;
  minScale: number | null;
  maxScale: number | null;
  minLinkval: number | null;
  maxLinkval: number | null;
  types: Array<CardType>;
  races: Array<CardRace>;
  cardSetFilter: CardSetFilterDTO;
  favorite: boolean;

  constructor() {
    this.minAtk = null;
    this.maxAtk = null;
    this.minDef = null;
    this.maxDef = null;
    this.name = null;
    this.attribute = null;
    this.archetype = null;
    this.minScale = null;
    this.maxScale = null;
    this.minLinkval = null;
    this.maxLinkval = null;
    this.types = [];
    this.races = [];
    this.cardSetFilter = new CardSetFilterDTO();
    this.favorite = false;
  }
}

export class CardSetFilterDTO {
  cardSetName: string | null;
  cardSetCode: string | null;
  cardRarityCode: string | null;

  constructor() {
    this.cardSetName = null;
    this.cardSetCode = null;
    this.cardRarityCode = null;
  }
}
