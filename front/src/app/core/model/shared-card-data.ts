import { CardDetail } from './card-detail';

export interface SharedCardData {
  readonly name: string;
  readonly imageUrl: string;
  readonly imageUrlFull?: string;
}

export interface SharedCardInspectorData extends SharedCardData {
  readonly isMonster: boolean;
  readonly attribute?: string;
  readonly race?: string;
  readonly level?: number;
  readonly scale?: number;
  readonly linkval?: number;
  readonly isLink: boolean;
  readonly hasDefense: boolean;
  readonly displayAtk: string;
  readonly displayDef: string;
  readonly description: string;
}

export function toSharedCardData(cd: CardDetail): SharedCardData {
  return {
    name: cd.card.name ?? '',
    imageUrl: cd.images[0]?.smallUrl ?? '',
    imageUrlFull: cd.images[0]?.url ?? '',
  };
}

export function toSharedCardInspectorData(cd: CardDetail): SharedCardInspectorData {
  const c = cd.card;
  return {
    name: c.name ?? '',
    imageUrl: cd.images[0]?.smallUrl ?? '',
    imageUrlFull: cd.images[0]?.url ?? '',
    isMonster: c.isMonster ?? false,
    attribute: c.attribute,
    race: c.race,
    level: c.level,
    scale: c.scale,
    linkval: c.linkval,
    isLink: c.isLink ?? false,
    hasDefense: c.hasDefense ?? false,
    displayAtk: c.displayAtk,
    displayDef: c.displayDef,
    description: c.description ?? '',
  };
}
