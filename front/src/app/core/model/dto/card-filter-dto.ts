import { CardAttribute } from '../../enums/card-attribute';
import { CardType } from '../../enums/card-type.enum';

export class CardFilterDTO {
  minAtk: number | null;
  maxAtk: number | null;
  minDef: number | null;
  maxDef: number | null;
  name: string | null;
  attribute: CardAttribute | null;
  archetype: string | null;
  scale: number | null;
  linkval: number | null;
  types: Array<CardType>;
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
    this.scale = null;
    this.linkval = null;
    this.types = [];
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
