import { ChangeDetectionStrategy, Component } from '@angular/core';
import { i18nAttr } from '../../../../shared/i18n';

/**
 * Mid-duel refresh placeholder — surfaced when `sessionPhase === 'DUELING'`
 * on a fresh WS attach but before the first BOARD_STATE lands, so the user
 * never sees the dice arena flash on resync.
 *
 * Layout mirrors `<app-pvp-board-container>` (274:215 ratio, 3 rows × 7
 * cols) plus the two off-canvas hand strips, so the swap to the real
 * board happens with zero layout shift. Skeleton classes live in
 * `front/src/app/shared/skel/skel.scss` under `.board-skel` (consumed
 * via global class selectors — no per-component encapsulation).
 */
@Component({
  selector: 'app-pvp-board-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="board-skel" aria-hidden="true">
      <!-- Opponent hand strip (top, half off-canvas) -->
      <div class="board-skel__hand board-skel__hand--opponent">
        @for (_ of fakeHand; track $index) {
          <div class="skel-hand-card"></div>
        }
      </div>

      <!-- Player hand strip (bottom, 35% off-canvas) -->
      <div class="board-skel__hand board-skel__hand--player">
        @for (_ of fakeHand; track $index) {
          <div class="skel-hand-card"></div>
        }
      </div>

      <!-- Centered board (3 rows × 7 cols, 274:215 ratio) -->
      <div class="board-skel__board">
        <!-- Opponent field (top row): MZ near center, ST near edge -->
        <div class="board-skel__row board-skel__row--opponent">
          <div class="skel-pile" style="grid-area: deck"></div>
          <div class="skel-zone" style="grid-area: st5"></div>
          <div class="skel-zone" style="grid-area: st4"></div>
          <div class="skel-zone" style="grid-area: st3"></div>
          <div class="skel-zone" style="grid-area: st2"></div>
          <div class="skel-zone" style="grid-area: st1"></div>
          <div class="skel-pile" style="grid-area: extra"></div>
          <div class="skel-pile" style="grid-area: gy"></div>
          <div class="skel-zone" style="grid-area: mz5"></div>
          <div class="skel-zone" style="grid-area: mz4"></div>
          <div class="skel-zone" style="grid-area: mz3"></div>
          <div class="skel-zone" style="grid-area: mz2"></div>
          <div class="skel-zone" style="grid-area: mz1"></div>
          <div class="skel-pile" style="grid-area: field"></div>
        </div>

        <!-- Central strip: banished (cols 1 & 7) + EMZ slots (cols 3 & 5) -->
        <div class="board-skel__row board-skel__row--central">
          <div class="skel-pile skel-pile--banished-opponent"></div>
          <div class="skel-zone skel-zone--emz-left"></div>
          <div class="skel-zone skel-zone--emz-right"></div>
          <div class="skel-pile skel-pile--banished-player"></div>
        </div>

        <!-- Player field (bottom row): MZ near center, ST near edge -->
        <div class="board-skel__row board-skel__row--player">
          <div class="skel-pile" style="grid-area: field"></div>
          <div class="skel-zone" style="grid-area: mz1"></div>
          <div class="skel-zone" style="grid-area: mz2"></div>
          <div class="skel-zone" style="grid-area: mz3"></div>
          <div class="skel-zone" style="grid-area: mz4"></div>
          <div class="skel-zone" style="grid-area: mz5"></div>
          <div class="skel-pile" style="grid-area: gy"></div>
          <div class="skel-pile" style="grid-area: extra"></div>
          <div class="skel-zone" style="grid-area: st1"></div>
          <div class="skel-zone" style="grid-area: st2"></div>
          <div class="skel-zone" style="grid-area: st3"></div>
          <div class="skel-zone" style="grid-area: st4"></div>
          <div class="skel-zone" style="grid-area: st5"></div>
          <div class="skel-pile" style="grid-area: deck"></div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
  `],
})
export class PvpBoardSkeletonComponent {
  protected readonly ariaLabel = i18nAttr('a11y.loadingDuelBoard');
  protected readonly fakeHand = Array.from({ length: 5 });
}
