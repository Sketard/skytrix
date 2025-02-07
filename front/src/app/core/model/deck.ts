import { CardDetail, IndexedCardDetail } from './card-detail';
import { IndexedCardDetailDTO } from './dto/card-detail-dto';
import { IndexedCardImageDTO } from './dto/card-image-dto';
import { DeckDTO } from './dto/deck-dto';
import { CardIndexDTO } from './dto/create-deck-dto';
import { DeckZone } from '../../services/deck-build.service';

export class Deck {
  id: number | undefined;
  name: string;
  images: Array<IndexedCardDetail>;
  mainDeck: Array<IndexedCardDetail>;
  extraDeck: Array<IndexedCardDetail>;
  sideDeck: Array<IndexedCardDetail>;

  static MAX_CARD_COPY = 3;

  constructor(deck?: DeckDTO) {
    this.id = deck?.id;
    this.name = deck?.name ?? 'Nouveau deck';
    this.images = this.createFixedSizeArray(this.createIndexedCardDetail(deck?.images), 3);
    this.mainDeck = this.mapDeckPart(60, deck?.mainDeck);
    this.extraDeck = this.mapDeckPart(15, deck?.extraDeck);
    this.sideDeck = this.mapDeckPart(15, deck?.sideDeck);
  }

  get hasCard(): boolean {
    return this.cleanSlotsAndMap([...this.mainDeck, ...this.extraDeck, ...this.sideDeck]).length > 0;
  }

  get isMainValid(): boolean {
    return this.cleanSlotsAndMap(this.mainDeck).length >= 40;
  }

  get mainCardNumber(): number {
    return this.cleanSlotsAndMap(this.mainDeck).length;
  }

  get extraCardNumber(): number {
    return this.cleanSlotsAndMap(this.extraDeck).length;
  }

  get sideCardNumber(): number {
    return this.cleanSlotsAndMap(this.sideDeck).length;
  }

  public getRandomMainCards(count: number, alreadyRetrieved: IndexedCardDetail[] = []): IndexedCardDetail[] {
    const usedIndexes = new Set(alreadyRetrieved.map(card => card.index));
    const mainCards = this.cleanSlots(this.mainDeck);
    const availableCards = mainCards.filter(card => !usedIndexes.has(card.index));

    const indexMap = new Map<number, IndexedCardDetail>();
    availableCards.forEach(card => {
      if (!indexMap.has(card.index)) {
        indexMap.set(card.index, card);
      }
    });

    const shuffledCards = Array.from(indexMap.values()).sort(() => Math.random() - 0.5);

    return shuffledCards.slice(0, Math.min(count, shuffledCards.length));
  }

  public cleanSlotsAndMap = (slots: Array<IndexedCardDetail>, image?: boolean): Array<CardIndexDTO> => {
    return this.cleanSlots(slots).map(
      (detail: IndexedCardDetail) =>
        new CardIndexDTO(image ? detail.card.images[0].id : detail.card.card.id!, detail.index)
    );
  };

  public cleanSlotsAndMapIds = (slots: Array<IndexedCardDetail>): Array<number> => {
    return this.cleanSlots(slots).map((detail: IndexedCardDetail) => detail.card.card.id!);
  };

  public sortDeck(): Deck {
    this.mainDeck = this.sortDeckPart(this.mainDeck);
    this.extraDeck = this.sortDeckPart(this.extraDeck);
    this.sideDeck = this.sortDeckPart(this.sideDeck);
    return this.clone();
  }

  public addImage(card: CardDetail): Deck {
    const firstAvailableSlot = this.images.findIndex(e => e.index === -1);
    if (firstAvailableSlot !== -1) {
      this.images[firstAvailableSlot] = new IndexedCardDetail(card, firstAvailableSlot);
    }
    return this.sortImages();
  }

  public removeImage(index: number): Deck {
    this.images[index] = new IndexedCardDetail(new CardDetail(), -1);
    return this.sortImages();
  }

  public updateImageIndex(newIndex: number, previousIndex: number): Deck {
    if (this.images[newIndex].index === -1) {
      const firstNoneAvailableSlot = this.images.findIndex(e => e.index === -1);
      this.images[previousIndex].index = firstNoneAvailableSlot;
      this.images[firstNoneAvailableSlot].index = -1;
    } else {
      this.images[newIndex].index = previousIndex;
      this.images[previousIndex].index = newIndex;
    }
    return this.sortImages();
  }

  public addCard(card: CardDetail, zone: DeckZone): Deck {
    const correctedZone = this.getCorrectZone(card, zone);
    const numberOfCopyReached = this._isMaxNumberOfCopyReached(card, correctedZone);
    if (numberOfCopyReached) {
      return this;
    }
    const firstAvailableSlot = this[correctedZone].findIndex(e => e.index === -1);
    if (firstAvailableSlot !== -1) {
      this[correctedZone][firstAvailableSlot] = new IndexedCardDetail(card, firstAvailableSlot);
    }
    return this.sortDeck();
  }

  public removeCard(index: number, zone: DeckZone): Deck {
    this[zone][index] = new IndexedCardDetail(new CardDetail(), -1);
    return this.sortDeck();
  }

  public removeFirstCard(card: CardDetail): Deck {
    const zone = this.getDefaultZone(card);
    const deckPart = this[zone];
    const lastOccurrence = deckPart.map(currentCard => currentCard.card.card.id).lastIndexOf(card.card.id);
    if (lastOccurrence === -1) {
      return this;
    }
    return this.removeCard(lastOccurrence, zone);
  }

  public updateCardIndex(zone: DeckZone, newIndex: number, previousIndex: number): Deck {
    if (this[zone][newIndex].index === -1) {
      const firstNoneAvailableSlot = this[zone].findIndex(e => e.index === -1);
      this[zone][previousIndex].index = firstNoneAvailableSlot;
      this[zone][firstNoneAvailableSlot].index = -1;
    } else {
      this[zone][newIndex].index = previousIndex;
      this[zone][previousIndex].index = newIndex;
    }
    return this.sortDeck();
  }

  public isMaxNumberOfCopyReached(card: CardDetail): boolean {
    const zone = this.getDefaultZone(card);
    return this._isMaxNumberOfCopyReached(card, zone);
  }

  public numberOfCopy(card: CardDetail): number {
    const zone = this.getDefaultZone(card);
    return this._numberOfCopy(card, zone);
  }

  private getDefaultZone(card: CardDetail): DeckZone {
    return card.card.extraCard ? DeckZone.EXTRA : DeckZone.MAIN;
  }

  private clone(): Deck {
    const copy = new Deck();
    copy.id = this.id;
    copy.name = this.name;
    copy.images = this.images;
    copy.mainDeck = this.mainDeck;
    copy.extraDeck = this.extraDeck;
    copy.sideDeck = this.sideDeck;
    return copy;
  }

  private _isMaxNumberOfCopyReached(card: CardDetail, zone: DeckZone): boolean {
    return this._numberOfCopy(card, zone) === card.card.banInfo;
  }

  private _numberOfCopy(card: CardDetail, zone: DeckZone): number {
    const part = this[zone];
    return part.reduce((acc, addedCard) => {
      const addedCardId = addedCard.card.card.id;
      if (!addedCardId) {
        return acc;
      }
      if (card.card.id === addedCard.card.card.id) {
        return acc + 1;
      } else {
        return acc;
      }
    }, 0);
  }

  private getCorrectZone(card: CardDetail, zone: DeckZone): DeckZone {
    let correctedZone = zone;
    if (card.card.extraCard && zone === DeckZone.MAIN) {
      correctedZone = DeckZone.EXTRA;
    } else if (!card.card.extraCard && zone === DeckZone.EXTRA) {
      correctedZone = DeckZone.MAIN;
    }
    return correctedZone;
  }

  private sortImages(): Deck {
    this.images = this.sortDeckPart(this.images);
    return this.clone();
  }

  private sortDeckPart(detail: Array<IndexedCardDetail>): Array<IndexedCardDetail> {
    const copy = [...detail.map(t => (!t.card.card.id ? { ...t, index: -1 } : t))];
    copy.sort((a, b) => {
      if (a.index === -1) {
        return 1;
      } else if (b.index === -1) {
        return -1;
      } else {
        return a.index - b.index;
      }
    });
    return copy;
  }

  private createIndexedCardDetail(dto?: Array<IndexedCardImageDTO>): Array<IndexedCardDetail> {
    return dto
      ? dto.map((indexedImage: IndexedCardImageDTO) => {
          const detail = new CardDetail();
          const image = indexedImage.image;
          detail.card.id = image.cardId;
          detail.images = [image];
          return new IndexedCardDetail(detail, indexedImage.index);
        })
      : new Array<IndexedCardDetail>();
  }

  private mapDeckPart(
    size: number,
    cards: Array<IndexedCardDetailDTO> = new Array<IndexedCardDetail>()
  ): Array<IndexedCardDetail> {
    return this.createFixedSizeArray(
      cards.map((card: IndexedCardDetailDTO) => new IndexedCardDetail(new CardDetail(card.card), card.index)),
      size
    );
  }

  private createFixedSizeArray(cards: Array<IndexedCardDetail>, size: number): Array<IndexedCardDetail> {
    const filledArray = Array(size).fill(new IndexedCardDetail(new CardDetail(), -1));
    const slicedArray = cards.slice(0, size);
    return slicedArray.concat(filledArray.slice(slicedArray.length));
  }

  private cleanSlots = (slots: Array<IndexedCardDetail>, image?: boolean): Array<IndexedCardDetail> => {
    return slots.filter((slot: IndexedCardDetail) => slot.index !== -1);
  };
}
