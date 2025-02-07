import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, Signal, signal } from '@angular/core';
import { TooltipService } from '../../services/tooltip.service';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatSuffix } from '@angular/material/form-field';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DeckBuildService, DeckZone } from '../../services/deck-build.service';
import { Deck } from '../../core/model/deck';

@Component({
  selector: 'card-tooltip',
  imports: [CommonModule, MatIcon, MatIconButton, MatSuffix, MatButton],
  templateUrl: './card-tooltip.component.html',
  styleUrl: './card-tooltip.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardTooltipComponent {
  public readonly deckBuildService = signal<DeckBuildService | undefined>(undefined);
  public readonly deck: Signal<Deck | undefined> = computed(() => this.deckBuildService()?.deck());
  public readonly maxNumberOfCopyReached = signal<boolean>(false);
  public readonly numberOfCopy = signal<number>(0);

  public readonly maxCardCopy = Deck.MAX_CARD_COPY;

  constructor(
    public tooltipService: TooltipService,
    private readonly httpClient: HttpClient
  ) {
    effect(() => {
      const service = this.tooltipService.activeSearchService();
      if (service && service instanceof DeckBuildService) {
        const deck = this.deck();
        const cardDetail = this.tooltipService.cardDetail();
        if (deck && cardDetail) {
          this.maxNumberOfCopyReached.set(deck.isMaxNumberOfCopyReached(cardDetail));
          this.numberOfCopy.set(deck.numberOfCopy(cardDetail));
        }
        this.deckBuildService.set(service);
      } else {
        this.deckBuildService.set(undefined);
      }
    });
  }

  public async toggleFavorite(id: number, currentlyFavorite: boolean) {
    if (currentlyFavorite) {
      await firstValueFrom(this.tooltipService.activeSearchService()!.removeFavoriteCard(this.httpClient, id));
    } else {
      await firstValueFrom(this.tooltipService.activeSearchService()!.addFavoriteCard(this.httpClient, id));
    }
    this.tooltipService.setCardDetail({ ...this.tooltipService.cardDetail()!, favorite: !currentlyFavorite });
    this.tooltipService.activeSearchService()!.refreshResearch();
  }

  public addOrRemove(value: number) {
    if (value > 0) {
      this.deckBuildService()?.addCard(this.tooltipService.cardDetail()!, DeckZone.MAIN);
    } else {
      this.deckBuildService()?.removeFirstCard(this.tooltipService.cardDetail()!);
    }
  }
}
