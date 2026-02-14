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
