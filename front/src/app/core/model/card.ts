import { CardType } from '../enums/card-type.enum';
import { CardDTO } from './dto/card-dto';

export class Card extends CardDTO {
  public hasAttributeIcon?: boolean;
  public isMonster?: boolean;
  public isSpellOrTrap?: boolean;
  public hasDefense?: boolean;
  public isLink?: boolean;
  public displayAtk: string;
  public displayDef: string;

  constructor(card?: CardDTO) {
    super(card);
    const cardTypes = card?.types;
    this.isMonster = cardTypes?.includes(CardType.MONSTER) || false;
    this.isSpellOrTrap = cardTypes?.some(type => type === CardType.TRAP || type === CardType.SPELL) || false;
    this.hasAttributeIcon = this.isMonster;
    this.isLink = cardTypes?.includes(CardType.LINK);
    this.hasDefense = this.isMonster && !this.isLink;
    this.displayAtk = this.getDisplayedValue(card?.atk);
    this.displayDef = this.getDisplayedValue(card?.def);
  }

  private getDisplayedValue(value: number | undefined): string {
    if (value || value === 0) {
      return value === -1 ? '?' : value.toString();
    }
    return '';
  }
}
