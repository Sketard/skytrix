import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { DeckBuildService } from '../../../../../../services/deck-build.service';
import { IndexedCardDetail } from '../../../../../../core/model/card-detail';
import { DeckBuilderCardComponent } from '../../../../../../components/card/deck-builder-card.component';
import { NgClass, NgForOf } from '@angular/common';
import { CardDisplayType } from '../../../../../../core/enums/card-display-type';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSuffix } from '@angular/material/form-field';

@Component({
  selector: 'app-hand-test',
  imports: [DeckBuilderCardComponent, NgForOf, NgClass, MatSlideToggle, FormsModule, MatButton, MatIcon, MatIconButton, MatSuffix],
  templateUrl: './hand-test.component.html',
  styleUrl: './hand-test.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandTestComponent {
  readonly displayMode = input<CardDisplayType>(CardDisplayType.MOSAIC);

  readonly cards = signal<Array<IndexedCardDetail>>([]);
  readonly goSecond = signal<boolean>(false);
  readonly count = signal<number>(1);

  constructor(public readonly deckBuildService: DeckBuildService) {
    effect(() => {
      this.count();
      const deck = this.deckBuildService.deck();
      const goSecond = this.goSecond();
      const cardNumber = 5 + (goSecond ? 1 : 0);
      this.cards.set(deck.getRandomMainCards(cardNumber));
    });
  }

  public retry() {
    this.count.update(value => ++value);
  }

  public close() {
    this.deckBuildService.toggleHandTestOpened();
  }
}
