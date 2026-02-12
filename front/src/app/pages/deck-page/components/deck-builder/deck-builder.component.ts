import { IndexedCardDetail } from '../../../../core/model/card-detail';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { ChangeDetectionStrategy, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { DeckViewerComponent } from './components/deck-viewer/deck-viewer.component';
import { Deck } from '../../../../core/model/deck';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { DeckCardZoneComponent } from '../../../../components/deck-card-zone/deck-card-zone.component';
import { CardSize } from '../../../../components/card/card.component';
import { jsPDF } from 'jspdf';
import { MatIconModule } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { ExportDTO } from '../../../../core/model/dto/export-dto';
import { ExportService } from '../../../../services/export.service';
import { downloadDocument } from '../../../../core/utilities/functions';
import { DeckDTO } from '../../../../core/model/dto/deck-dto';
import {
  ActionButton,
  MultipleActionButtonComponent,
} from '../../../../components/multiple-action-button/multiple-action-button.component';
import { ExportMode } from '../../../../core/enums/export.mode.enum';
import { CardFiltersComponent } from '../../../../components/card-filters/card-filters.component';
import { CardSearcherComponent } from '../../../../components/card-searcher/card-searcher.component';
import { HandTestComponent } from './components/hand-test/hand-test.component';
import { NgIf } from '@angular/common';
import { TooltipService } from '../../../../services/tooltip.service';
import { Router } from '@angular/router';

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
    MultipleActionButtonComponent,
    CardFiltersComponent,
    CardSearcherComponent,
    HandTestComponent,
    NgIf,
  ],
  templateUrl: './deck-builder.component.html',
  styleUrl: './deck-builder.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckBuilderComponent {
  @Input()
  set id(deckId: number | undefined) {
    if (deckId) {
      this.deckBuildService.getById(deckId).subscribe((deck: Deck) => this.deckBuildService.initDeck(deck));
    }
  }

  @ViewChild('importInput') importInput: ElementRef | undefined;

  public size: CardSize = CardSize.DECK;

  readonly exportButtons: Array<ActionButton> = [
    {
      label: 'Export standard',
      callback: () => {
        this.export(ExportMode.CLASSIC);
      },
    },
    {
      label: 'Export Cardmarket',
      callback: () => {
        this.export(ExportMode.MARKET);
      },
    },
  ];

  readonly filtersOpened = this.deckBuildService.openedFilters;
  readonly handTestOpened = this.deckBuildService.handTestOpened;

  constructor(
    public deckBuildService: DeckBuildService,
    private readonly exportService: ExportService,
    private readonly tooltipService: TooltipService,
    private readonly router: Router
  ) {
    this.deckBuildService.resetDeck();
    this.tooltipService.setActiveSearchService(this.deckBuildService);
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

  public closeFilters() {
    this.deckBuildService.toggleFilters();
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
