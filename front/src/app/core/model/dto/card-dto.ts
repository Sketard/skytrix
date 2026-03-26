import { CardAttribute } from '../../enums/card-attribute';
import { CardRace } from '../../enums/card-race.enum';
import { CardType } from '../../enums/card-type.enum';

export interface CardTranslationEntry {
  name: string;
  description: string;
}

export class CardDTO {
  id?: number;
  name?: string;
  description?: string;
  translations?: Record<string, CardTranslationEntry>;
  passcode?: number;
  types?: Array<CardType>;
  frameType?: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: CardRace;
  attribute?: CardAttribute;
  archetype?: string;
  scale?: number;
  linkval?: number;
  linkmarkers?: Array<string>;
  extraCard?: boolean;
  banInfo: number;

  constructor(card?: CardDTO) {
    this.id = card?.id;
    this.name = card?.name;
    this.description = card?.description?.replaceAll('\n', '<br>').replaceAll('●', '● ');
    if (card?.translations) {
      this.translations = {};
      for (const [lang, entry] of Object.entries(card.translations)) {
        this.translations[lang] = {
          name: entry.name,
          description: entry.description?.replaceAll('\n', '<br>').replaceAll('●', '● ') ?? '',
        };
      }
    }
    this.passcode = card?.passcode;
    this.types = card?.types;
    this.frameType = card?.frameType;
    this.atk = card?.atk;
    this.def = card?.def;
    this.level = card?.level;
    this.race = card?.race;
    this.attribute = card?.attribute;
    this.archetype = card?.archetype;
    this.scale = card?.scale;
    this.linkval = card?.linkval;
    this.linkmarkers = card?.linkmarkers || [];
    this.extraCard = card?.extraCard;
    this.banInfo = (!card && 3) || card!.banInfo;
  }
}
