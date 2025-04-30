import {DeckBuildService, DeckZone} from '../../services/deck-build.service';
import {FindOwnedCardPipe} from '../../core/pipes/find-owned-card.pipe';
import {OwnedCardService} from '../../services/owned-card.service';
import {AsyncPipe, CommonModule} from '@angular/common';
import {ChangeDetectionStrategy, Component, EventEmitter, input, Output} from '@angular/core';
import {CardDetail} from '../../core/model/card-detail';
import {Card} from '../../core/model/card';
import {CardDisplayType} from '../../core/enums/card-display-type';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatIconModule} from '@angular/material/icon';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {ShortOwnedCardDTO} from '../../core/model/dto/short-owned-card-dto';
import {FindGroupedOwnedCardPipe} from '../../core/pipes/find-grouped-owned-card';
import {CdkDrag, CdkDragStart} from '@angular/cdk/drag-drop';
import {Router} from '@angular/router';
import {TooltipService} from '../../services/tooltip.service';
import {ToolTipRendererDirective} from '../../core/directives/tooltip.directive';
import {ImgLoaderDirective} from '../../core/directives/img-loader.directive';

@Component({
  selector: 'card',
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    ReactiveFormsModule,
    FormsModule,
    FindOwnedCardPipe,
    AsyncPipe,
    FindGroupedOwnedCardPipe,
    ToolTipRendererDirective,
    CdkDrag,
    ImgLoaderDirective,
  ],
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardComponent {
  readonly cardDetail = input<CardDetail>(new CardDetail());
  readonly size = input<CardSize>(CardSize.MEDIUM);
  readonly cropped = input<boolean>(false);
  readonly displayMode = input<CardDisplayType>(CardDisplayType.INFORMATIVE);
  readonly deckBuildMode = input<boolean>(false);

  @Output() loaded = new EventEmitter<number>();

  public cardSize = CardSize;
  public displayType = CardDisplayType;
  public dragging: boolean = false;

  hideTooltip() {
    this.tooltipService.setCardDetail(undefined);
  }

  constructor(
    public readonly ownedCardService: OwnedCardService,
    private readonly deckBuildService: DeckBuildService,
    private readonly router: Router,
    private readonly tooltipService: TooltipService
  ) {
  }

  get card(): Card {
    return this.cardDetail().card;
  }

  public updateQuantity(event: FocusEvent, ownedCard: ShortOwnedCardDTO): void {
    this.ownedCardService.update(ownedCard.cardSetId, parseInt((event.target as HTMLInputElement).value));
  }

  public increaseQuantity(number: number, ownedCard: ShortOwnedCardDTO): void {
    const newQuantity = Math.max(0, ownedCard.number + number);
    this.ownedCardService.update(ownedCard.cardSetId, newQuantity);
  }

  public handleDragStart(event: CdkDragStart): void {
    this.dragging = true;
    this.hideTooltip();
  }

  public handleClick(event: MouseEvent): void {
    if (this.dragging) {
      this.dragging = false;
      return;
    }
    if (this.deckBuildMode() || this.router.url.includes('/decks/')) {
      this.deckBuildService.addCard(this.cardDetail(), this.card.extraCard ? DeckZone.EXTRA : DeckZone.MAIN);
    }
  }
}

export enum CardSize {
  DECK,
  DECK_EXTRA_SIDE,
  BIG,
  MEDIUM,
  SMALL,
  PLAYGROUND
}
