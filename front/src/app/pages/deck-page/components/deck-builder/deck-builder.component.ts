import { CardDetail, IndexedCardDetail } from '../../../../core/model/card-detail';
import { DeckBuildService, DeckZone } from '../../../../services/deck-build.service';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, Input, OnDestroy, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { DeckViewerComponent } from './components/deck-viewer/deck-viewer.component';
import { Deck } from '../../../../core/model/deck';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { DeckCardZoneComponent } from '../../../../components/deck-card-zone/deck-card-zone.component';
import { jsPDF } from 'jspdf';
import { MatIconModule } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { ExportDTO } from '../../../../core/model/dto/export-dto';
import { ExportService } from '../../../../services/export.service';
import { downloadDocument } from '../../../../core/utilities/functions';
import { DeckDTO } from '../../../../core/model/dto/deck-dto';
import { ExportMode } from '../../../../core/enums/export.mode.enum';
import { CardFiltersComponent } from '../../../../components/card-filters/card-filters.component';
import { CardSearcherComponent } from '../../../../components/card-searcher/card-searcher.component';
import { HandTestComponent } from './components/hand-test/hand-test.component';
import { Router } from '@angular/router';
import { CardInspectorComponent } from '../../../../components/card-inspector/card-inspector.component';
import { BottomSheetComponent } from '../../../../components/bottom-sheet/bottom-sheet.component';
import { SharedCardInspectorData, toSharedCardInspectorData } from '../../../../core/model/shared-card-data';
@Component({
  selector: 'app-deck-builder',
  imports: [
    DeckViewerComponent,
    CdkDropListGroup,
    MatInputModule,
    FormsModule,
    DeckCardZoneComponent,
    MatIconModule,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    CardFiltersComponent,
    CardSearcherComponent,
    HandTestComponent,
    CardInspectorComponent,
    BottomSheetComponent,
  ],
  templateUrl: './deck-builder.component.html',
  styleUrl: './deck-builder.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckBuilderComponent implements OnDestroy {
  @Input()
  set id(deckId: number | undefined) {
    if (deckId) {
      this.deckBuildService.getById(deckId).subscribe((deck: Deck) => this.deckBuildService.initDeck(deck));
    }
  }

  @ViewChild('importInput') importInput: ElementRef | undefined;
  @ViewChild('deckNameInput') deckNameInput: ElementRef<HTMLInputElement> | undefined;
  @ViewChild('deckNameInputDesktop') deckNameInputDesktop: ElementRef<HTMLInputElement> | undefined;
  readonly isEditingName = signal(false);
  private nameEditTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly selectedCardForInspector = signal<SharedCardInspectorData | null>(null);
  private readonly selectedCardDetail = signal<CardDetail | null>(null);
  readonly selectedCardCount = computed(() => {
    const cd = this.selectedCardDetail();
    if (!cd) return 0;
    const deck = this.deckBuildService.deck();
    const id = cd.card.id;
    return [...deck.mainDeck, ...deck.extraDeck, ...deck.sideDeck]
      .filter(slot => slot.card.card.id === id).length;
  });
  readonly ExportMode = ExportMode;

  readonly filtersRequestedSnap = signal<'full' | null>(null);
  readonly landscapeFiltersOpened = signal(false);
  readonly handTestOpened = this.deckBuildService.handTestOpened;
  readonly searchPanelOpened = signal(false);

  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly isMobilePortrait = toSignal(
    this.breakpointObserver.observe(['(max-width: 767px) and (orientation: portrait)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );
  readonly isLandscapeSplit = toSignal(
    this.breakpointObserver.observe(['(orientation: landscape) and (min-width: 576px) and (max-width: 767px)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );
  readonly isCompactHeight = toSignal(
    this.breakpointObserver.observe(['(min-width: 768px) and (max-height: 500px)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );
  readonly useExternalFilters = computed(() => this.isLandscapeSplit() || this.isCompactHeight());
  readonly isCardDragActive = this.deckBuildService.cardDragActive;

  constructor(
    public deckBuildService: DeckBuildService,
    private readonly exportService: ExportService,
    private readonly router: Router
  ) {
    this.deckBuildService.resetDeck();
  }

  ngOnDestroy(): void {
    if (this.nameEditTimeout) {
      clearTimeout(this.nameEditTimeout);
    }
  }

  startEditingName(): void {
    if (this.nameEditTimeout) {
      clearTimeout(this.nameEditTimeout);
      this.nameEditTimeout = null;
    }
    this.isEditingName.set(true);
    setTimeout(() => {
      const input = this.deckNameInput?.nativeElement ?? this.deckNameInputDesktop?.nativeElement;
      input?.focus();
    }, 0);
  }

  stopEditingName(): void {
    this.isEditingName.set(false);
    if (this.nameEditTimeout) {
      clearTimeout(this.nameEditTimeout);
    }
    if (this.deckBuildService.deck().id) {
      this.nameEditTimeout = setTimeout(() => this.save(), 500);
    }
  }

  onNameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement).blur();
    }
  }

  onCardClicked(cd: CardDetail): void {
    this.selectedCardDetail.set(cd);
    this.selectedCardForInspector.set(toSharedCardInspectorData(cd));
  }

  dismissInspector(): void {
    this.selectedCardForInspector.set(null);
    this.selectedCardDetail.set(null);
  }

  addSelectedCardToDeck(): void {
    if (!this.selectedCardDetail()) return;
    const cd = this.selectedCardDetail()!;
    this.deckBuildService.addCard(cd, cd.card.extraCard ? DeckZone.EXTRA : DeckZone.MAIN);
  }

  removeSelectedCardFromDeck(): void {
    if (!this.selectedCardDetail()) return;
    const cd = this.selectedCardDetail()!;
    const deck = this.deckBuildService.deck();
    const zones: Array<{ cards: Array<IndexedCardDetail>; zone: DeckZone }> = [
      { cards: deck.mainDeck, zone: DeckZone.MAIN },
      { cards: deck.extraDeck, zone: DeckZone.EXTRA },
      { cards: deck.sideDeck, zone: DeckZone.SIDE },
    ];
    for (const { cards, zone } of zones) {
      const idx = cards.findIndex(slot => slot.card.card.id === cd.card.id);
      if (idx >= 0) {
        this.deckBuildService.removeCard(idx, zone);
        return;
      }
    }
  }

  public save() {
    this.deckBuildService.save();
  }

  async createProxies() {
    const urls = this.getCardsUrls();
    const images = await Promise.all(
      urls.map(
        e =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e;
          })
      )
    );
    await this.generatePDF(images);
  }

  async generatePDF(images: any) {
    const doc = new jsPDF();

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const cardWidth = 59;
    const cardHeight = 86;

    const marginLeft = (pageWidth - 3 * cardWidth - 2) / 2;
    const marginTop = (pageHeight - 3 * cardHeight - 2) / 2;

    const horizontalSpacing = 0;
    const verticalSpacing = 0;
    const cardsPerPage = 9;

    let pageNumber = 1;
    for (let i = 0; i < images.length; i += cardsPerPage) {
      if (pageNumber > 1) {
        doc.addPage();
      }
      for (let j = i; j < i + cardsPerPage && j < images.length; j++) {
        const row = Math.floor((j - i) / 3);
        const col = (j - i) % 3;
        const x = marginLeft + col * (cardWidth + horizontalSpacing);
        const y = marginTop + row * (cardHeight + verticalSpacing);
        doc.addImage(images[j], 'PNG', x, y, cardWidth, cardHeight);
      }

      pageNumber++;
    }

    doc.save('proxies.pdf');
  }

  private getAllDeckCards(): Array<IndexedCardDetail> {
    const deck = this.deckBuildService.deck();
    return [...deck.mainDeck, ...deck.extraDeck, ...deck.sideDeck].filter(slot => slot.index !== -1);
  }

  private getCardsUrls(): Array<string> {
    return this.getAllDeckCards().map(e => e.card.images[0].url);
  }

  public export(mode: ExportMode) {
    const deck = this.deckBuildService.deck();
    const dto = new ExportDTO(deck, mode);
    this.exportService.exportDeckList(dto).subscribe(blob => {
      downloadDocument(blob.body, `${deck.name}.txt`, 'text/html');
    });
  }

  public openImportFile() {
    this.importInput?.nativeElement.click();
  }

  public import() {
    const file = this.importInput?.nativeElement.files[0];
    if (!file) {
      return;
    }
    this.exportService.importDeckList(file).subscribe((deck: DeckDTO) => {
      this.deckBuildService.initDeck(new Deck(deck));
    });
    (document.getElementById('importDeckInput') as HTMLInputElement).value = '';
  }

  public toggleSearchPanel() {
    this.searchPanelOpened.update(v => !v);
  }

  public onFiltersExpanded(expanded: boolean) {
    if (this.useExternalFilters()) {
      this.landscapeFiltersOpened.set(expanded);
    } else {
      this.filtersRequestedSnap.set(expanded ? 'full' : null);
    }
  }

  public toggleTestHand() {
    this.deckBuildService.toggleHandTestOpened();
  }

  public navigateToSimulator() {
    const deckId = this.deckBuildService.deck().id;
    if (!deckId) return;
    this.router.navigate(['/decks', deckId, 'simulator']);
  }
}
