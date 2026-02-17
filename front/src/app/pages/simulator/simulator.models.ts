import { CardDetail } from '../../core/model/card-detail';
import { CardImageDTO } from '../../core/model/dto/card-image-dto';
import { SharedCardData } from '../../core/model/shared-card-data';

export enum ZoneId {
  HAND = 'HAND',
  MONSTER_1 = 'MONSTER_1',
  MONSTER_2 = 'MONSTER_2',
  MONSTER_3 = 'MONSTER_3',
  MONSTER_4 = 'MONSTER_4',
  MONSTER_5 = 'MONSTER_5',
  SPELL_TRAP_1 = 'SPELL_TRAP_1',
  SPELL_TRAP_2 = 'SPELL_TRAP_2',
  SPELL_TRAP_3 = 'SPELL_TRAP_3',
  SPELL_TRAP_4 = 'SPELL_TRAP_4',
  SPELL_TRAP_5 = 'SPELL_TRAP_5',
  EXTRA_MONSTER_L = 'EXTRA_MONSTER_L',
  EXTRA_MONSTER_R = 'EXTRA_MONSTER_R',
  FIELD_SPELL = 'FIELD_SPELL',
  MAIN_DECK = 'MAIN_DECK',
  EXTRA_DECK = 'EXTRA_DECK',
  GRAVEYARD = 'GRAVEYARD',
  BANISH = 'BANISH',
}

export interface CardInstance {
  instanceId: string;
  card: CardDetail;
  image: CardImageDTO;
  faceDown: boolean;
  position: 'ATK' | 'DEF';
  overlayMaterials?: CardInstance[];
}

export type OverlayMode = 'browse' | 'search' | 'reveal';

export interface SimCommand {
  execute(): void;
  undo(): void;
}

export function toSharedCardData(ci: CardInstance): SharedCardData {
  return {
    name: ci.card.card.name ?? '',
    imageUrl: ci.image.smallUrl,
    imageUrlFull: ci.image.url,
  };
}

export const ZONE_CONFIG: Record<ZoneId, { type: 'single' | 'ordered' | 'stack'; label: string; shortLabel: string; pendulum?: 'left' | 'right' }> = {
  [ZoneId.HAND]: { type: 'ordered', label: 'Hand', shortLabel: '' },
  [ZoneId.MONSTER_1]: { type: 'single', label: 'Monster Zone 1', shortLabel: 'M1' },
  [ZoneId.MONSTER_2]: { type: 'single', label: 'Monster Zone 2', shortLabel: 'M2' },
  [ZoneId.MONSTER_3]: { type: 'single', label: 'Monster Zone 3', shortLabel: 'M3' },
  [ZoneId.MONSTER_4]: { type: 'single', label: 'Monster Zone 4', shortLabel: 'M4' },
  [ZoneId.MONSTER_5]: { type: 'single', label: 'Monster Zone 5', shortLabel: 'M5' },
  [ZoneId.SPELL_TRAP_1]: { type: 'single', label: 'Spell/Trap Zone 1', shortLabel: 'ST1', pendulum: 'left' },
  [ZoneId.SPELL_TRAP_2]: { type: 'single', label: 'Spell/Trap Zone 2', shortLabel: 'ST2' },
  [ZoneId.SPELL_TRAP_3]: { type: 'single', label: 'Spell/Trap Zone 3', shortLabel: 'ST3' },
  [ZoneId.SPELL_TRAP_4]: { type: 'single', label: 'Spell/Trap Zone 4', shortLabel: 'ST4' },
  [ZoneId.SPELL_TRAP_5]: { type: 'single', label: 'Spell/Trap Zone 5', shortLabel: 'ST5', pendulum: 'right' },
  [ZoneId.EXTRA_MONSTER_L]: { type: 'single', label: 'Extra Monster Zone Left', shortLabel: 'EMZ' },
  [ZoneId.EXTRA_MONSTER_R]: { type: 'single', label: 'Extra Monster Zone Right', shortLabel: 'EMZ' },
  [ZoneId.FIELD_SPELL]: { type: 'single', label: 'Field Spell Zone', shortLabel: 'Field' },
  [ZoneId.MAIN_DECK]: { type: 'stack', label: 'Main Deck', shortLabel: 'Deck' },
  [ZoneId.EXTRA_DECK]: { type: 'stack', label: 'Extra Deck', shortLabel: 'ED' },
  [ZoneId.GRAVEYARD]: { type: 'stack', label: 'Graveyard', shortLabel: 'GY' },
  [ZoneId.BANISH]: { type: 'stack', label: 'Banished', shortLabel: 'Banish' },
};
