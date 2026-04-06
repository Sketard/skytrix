import { CardDetail } from './card-detail';
import { CardImageDTO } from './dto/card-image-dto';

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
  readonly images: ReadonlyArray<CardImageDTO>;
  readonly selectedImageId?: number;
}

export function resolveCardImage(cd: CardDetail, selectedImageId?: number): CardImageDTO | undefined {
  if (selectedImageId) {
    return cd.images.find(img => img.id === selectedImageId) ?? cd.images[0];
  }
  return cd.images[0];
}

export function toSharedCardData(cd: CardDetail, selectedImageId?: number): SharedCardData {
  const image = resolveCardImage(cd, selectedImageId);
  return {
    name: cd.card.name ?? '',
    imageUrl: image?.smallUrl ?? '',
    imageUrlFull: image?.url ?? '',
  };
}

export function toSharedCardInspectorData(cd: CardDetail, selectedImageId?: number): SharedCardInspectorData {
  const c = cd.card;
  const image = resolveCardImage(cd, selectedImageId);
  return {
    name: c.name ?? '',
    imageUrl: image?.smallUrl ?? '',
    imageUrlFull: image?.url ?? '',
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
    images: cd.images,
    selectedImageId,
  };
}
