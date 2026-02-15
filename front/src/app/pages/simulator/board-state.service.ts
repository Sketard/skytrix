import { Injectable, computed, signal } from '@angular/core';
import { Deck } from '../../core/model/deck';
import { IndexedCardDetail } from '../../core/model/card-detail';
import { CardInstance, OverlayMode, ZoneId } from './simulator.models';

function createEmptyBoard(): Record<ZoneId, CardInstance[]> {
  return {
    [ZoneId.HAND]: [],
    [ZoneId.MONSTER_1]: [],
    [ZoneId.MONSTER_2]: [],
    [ZoneId.MONSTER_3]: [],
    [ZoneId.MONSTER_4]: [],
    [ZoneId.MONSTER_5]: [],
    [ZoneId.SPELL_TRAP_1]: [],
    [ZoneId.SPELL_TRAP_2]: [],
    [ZoneId.SPELL_TRAP_3]: [],
    [ZoneId.SPELL_TRAP_4]: [],
    [ZoneId.SPELL_TRAP_5]: [],
    [ZoneId.EXTRA_MONSTER_L]: [],
    [ZoneId.EXTRA_MONSTER_R]: [],
    [ZoneId.FIELD_SPELL]: [],
    [ZoneId.MAIN_DECK]: [],
    [ZoneId.EXTRA_DECK]: [],
    [ZoneId.GRAVEYARD]: [],
    [ZoneId.BANISH]: [],
  };
}

@Injectable()
export class BoardStateService {
  readonly boardState = signal<Record<ZoneId, CardInstance[]>>(createEmptyBoard());

  // Computed signals per zone
  readonly hand = computed(() => this.boardState()[ZoneId.HAND]);
  readonly monster1 = computed(() => this.boardState()[ZoneId.MONSTER_1]);
  readonly monster2 = computed(() => this.boardState()[ZoneId.MONSTER_2]);
  readonly monster3 = computed(() => this.boardState()[ZoneId.MONSTER_3]);
  readonly monster4 = computed(() => this.boardState()[ZoneId.MONSTER_4]);
  readonly monster5 = computed(() => this.boardState()[ZoneId.MONSTER_5]);
  readonly spellTrap1 = computed(() => this.boardState()[ZoneId.SPELL_TRAP_1]);
  readonly spellTrap2 = computed(() => this.boardState()[ZoneId.SPELL_TRAP_2]);
  readonly spellTrap3 = computed(() => this.boardState()[ZoneId.SPELL_TRAP_3]);
  readonly spellTrap4 = computed(() => this.boardState()[ZoneId.SPELL_TRAP_4]);
  readonly spellTrap5 = computed(() => this.boardState()[ZoneId.SPELL_TRAP_5]);
  readonly extraMonsterL = computed(() => this.boardState()[ZoneId.EXTRA_MONSTER_L]);
  readonly extraMonsterR = computed(() => this.boardState()[ZoneId.EXTRA_MONSTER_R]);
  readonly fieldSpell = computed(() => this.boardState()[ZoneId.FIELD_SPELL]);
  readonly mainDeck = computed(() => this.boardState()[ZoneId.MAIN_DECK]);
  readonly extraDeck = computed(() => this.boardState()[ZoneId.EXTRA_DECK]);
  readonly graveyard = computed(() => this.boardState()[ZoneId.GRAVEYARD]);
  readonly banish = computed(() => this.boardState()[ZoneId.BANISH]);

  // Boolean computed signals
  readonly isDeckEmpty = computed(() => this.boardState()[ZoneId.MAIN_DECK].length === 0);
  readonly isExtraDeckEmpty = computed(() => this.boardState()[ZoneId.EXTRA_DECK].length === 0);

  // UI state signals
  readonly selectedCard = signal<CardInstance | null>(null);
  readonly isDragging = signal<boolean>(false);

  // Material peek state signals
  readonly activeMaterialPeek = signal<{ cardId: string; zoneId: ZoneId } | null>(null);
  readonly isMaterialPeekOpen = computed(() => this.activeMaterialPeek() !== null);

  // Overlay state signals
  readonly activeOverlayZone = signal<ZoneId | null>(null);
  readonly activeOverlayMode = signal<OverlayMode | null>(null);
  readonly revealedCardIds = signal<Set<string>>(new Set());
  readonly isOverlayOpen = computed(() => this.activeOverlayZone() !== null);
  readonly activeOverlayCards = computed(() => {
    const zone = this.activeOverlayZone();
    if (zone === null) return [];
    return this.boardState()[zone];
  });
  readonly revealCards = computed(() => {
    if (this.activeOverlayMode() !== 'reveal') return [];
    const ids = this.revealedCardIds();
    return this.boardState()[ZoneId.MAIN_DECK].filter(c => ids.has(c.instanceId));
  });

  private originalDeck: Deck | null = null;

  openMaterialPeek(cardInstanceId: string, zoneId: ZoneId): void {
    this.closeOverlay();
    this.activeMaterialPeek.set({ cardId: cardInstanceId, zoneId });
  }

  closeMaterialPeek(): void {
    this.activeMaterialPeek.set(null);
  }

  openOverlay(zoneId: ZoneId, mode: OverlayMode = 'browse'): void {
    this.closeMaterialPeek();
    this.activeOverlayZone.set(zoneId);
    this.activeOverlayMode.set(mode);
  }

  closeOverlay(): void {
    this.activeOverlayZone.set(null);
    this.activeOverlayMode.set(null);
    this.revealedCardIds.set(new Set());
  }

  openDeckSearch(): void {
    this.openOverlay(ZoneId.MAIN_DECK);
  }

  openDeckReveal(count: number): void {
    this.closeMaterialPeek();
    const deckCards = this.boardState()[ZoneId.MAIN_DECK];
    const n = Math.min(count, deckCards.length);
    if (n === 0) return;
    const ids = new Set(deckCards.slice(-n).map(c => c.instanceId));
    this.revealedCardIds.set(ids);
    this.activeOverlayZone.set(ZoneId.MAIN_DECK);
    this.activeOverlayMode.set('reveal');
  }

  selectCard(card: CardInstance): void {
    this.selectedCard.set(card);
  }

  clearSelection(): void {
    this.selectedCard.set(null);
  }

  resetBoard(): void {
    if (!this.originalDeck) return;
    this.closeOverlay();
    this.closeMaterialPeek();
    this.clearSelection();
    this.isDragging.set(false);
    this.boardState.set(createEmptyBoard());
    this.initializeBoard(this.originalDeck);
  }

  initializeBoard(deck: Deck): void {
    this.originalDeck = deck;
    const mainDeckCards = this.convertToCardInstances(
      deck.mainDeck.filter(slot => slot.index !== -1)
    );
    const extraDeckCards = this.convertToCardInstances(
      deck.extraDeck.filter(slot => slot.index !== -1)
    ).map(card => ({ ...card, faceDown: true }));

    const shuffledMain = this.shuffle(mainDeckCards);

    const drawCount = Math.min(5, shuffledMain.length);
    const handCards = shuffledMain.slice(shuffledMain.length - drawCount);
    const remainingDeck = shuffledMain.slice(0, shuffledMain.length - drawCount);

    this.boardState.update(prev => ({
      ...prev,
      [ZoneId.MAIN_DECK]: remainingDeck,
      [ZoneId.EXTRA_DECK]: extraDeckCards,
      [ZoneId.HAND]: handCards,
    }));
  }

  private convertToCardInstances(cards: IndexedCardDetail[]): CardInstance[] {
    return cards.map(icd => ({
      instanceId: String(icd.id),
      card: icd.card,
      image: icd.card.images[0] ?? { id: 0, imageId: 0, url: '', smallUrl: '', cardId: 0 },
      faceDown: false,
      position: 'ATK' as const,
    }));
  }

  private shuffle(cards: CardInstance[]): CardInstance[] {
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
