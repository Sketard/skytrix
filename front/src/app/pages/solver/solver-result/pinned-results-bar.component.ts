import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import type { PinnedResult } from '../../../core/model/solver.model';
import { onCardImgError } from './card-image-fallback';

@Component({
  selector: 'app-pinned-results-bar',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .pinned-bar {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 8px 0;
    }
    .pin-card {
      min-width: 200px;
      max-width: 280px;
      flex-shrink: 0;
    }
    .pin-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
    }
    .pin-score {
      font-weight: 700;
      font-size: 16px;
    }
    .pin-meta {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 2px;
    }
    .pin-mode {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--mat-sys-surface-variant);
    }
    .pin-cards-row {
      display: flex;
      gap: 2px;
      margin-top: 4px;
    }
    .pin-thumb {
      width: 32px;
      height: 46px;
      object-fit: cover;
      border-radius: 2px;
    }
    .pin-label {
      font-size: 10px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 4px;
    }
  `,
  template: `
    <div class="pinned-bar">
      @for (pin of pins(); track pin.savedAt) {
        <mat-card class="pin-card" appearance="outlined">
          <mat-card-content>
            <div class="pin-header">
              <span class="pin-score">{{ pin.score }}</span>
              <span class="pin-mode">
                {{ (pin.config.mode === 'adversarial' ? 'solver.pin.adversarial' : 'solver.pin.goldfish') | translate }}
              </span>
              <button mat-stroked-button color="warn"
                [attr.aria-label]="'solver.pin.unpin' | translate"
                (click)="unpin.emit($index)">
                <mat-icon fontIcon="close"></mat-icon>
              </button>
            </div>
            <div class="pin-meta">{{ pin.config.deckName }}</div>
            @if (pin.handCards.length > 0) {
              <div class="pin-label">{{ 'solver.pin.hand' | translate }}</div>
              <div class="pin-cards-row">
                @for (card of pin.handCards; track $index) {
                  <img class="pin-thumb"
                    [src]="cardArtUrl(card.cardId)"
                    [alt]="card.cardName"
                    (error)="imgError($event)" />
                }
              </div>
            }
            @if (pin.endBoardCards.length > 0) {
              <div class="pin-label">{{ 'solver.pin.endBoard' | translate }}</div>
              <div class="pin-cards-row">
                @for (card of pin.endBoardCards; track $index) {
                  <img class="pin-thumb"
                    [src]="cardArtUrl(card.cardId)"
                    [alt]="card.cardName"
                    (error)="imgError($event)" />
                }
              </div>
            }
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
})
export class PinnedResultsBarComponent {
  readonly pins = input.required<PinnedResult[]>();
  readonly unpin = output<number>();

  cardArtUrl(cardId: number): string {
    return `https://images.ygoprodeck.com/images/cards_cropped/${cardId}.jpg`;
  }

  imgError(event: Event): void {
    onCardImgError(event);
  }
}
