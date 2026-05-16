import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { AvatarComponent } from '../../../../shared/avatar/avatar.component';
import type { ReplayMetadataMsg } from '../../duel-ws.types';
import { deriveOutcome, type ReplayOutcome } from '../replay-outcome.util';

// Sticky horizontal page header for the replay viewer (DS Wave 1 §2.10 variant
// `.page-header--compact`). 3 zones grid: back-btn · match summary · meta + actions.
//
// All visuals come from DS utility classes. Layout-only SCSS.
// Avatars use the shared `<app-avatar>` (hue from pseudo).
//
// Outputs:
//   `back()`        → router.navigate(['/pvp/history'])
//   `copyLink()`    → page.onCopyLink() — toggles success-flash via input
//   `openDetails()` → opens mobile details bottom-sheet
//
// `copyJustSucceeded` input drives the 1.5s `.btn--success-flash` styling.
// The parent sets it true after `navigator.clipboard.writeText` resolves and
// flips it back via setTimeout.
@Component({
  selector: 'app-replay-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatIconModule, AvatarComponent],
  templateUrl: './replay-topbar.component.html',
  styleUrl: './replay-topbar.component.scss',
  host: { role: 'banner' },
})
export class ReplayTopbarComponent {
  readonly metadata = input.required<ReplayMetadataMsg | null>();
  /** Auth user id — used to detect which side is "self" for outcome mapping. */
  readonly mySide = input.required<0 | 1>();
  readonly copyJustSucceeded = input<boolean>(false);

  readonly back        = output<void>();
  readonly copyLink    = output<void>();
  readonly openDetails = output<void>();

  protected readonly selfName = computed(() => this.metadata()?.playerUsernames[this.mySide()] ?? '');
  protected readonly oppName  = computed(() => this.metadata()?.playerUsernames[this.mySide() === 0 ? 1 : 0] ?? '');
  protected readonly selfDeck = computed(() => this.metadata()?.deckNames[this.mySide()] ?? '');
  protected readonly oppDeck  = computed(() => this.metadata()?.deckNames[this.mySide() === 0 ? 1 : 0] ?? '');

  protected readonly outcome = computed<ReplayOutcome>(() =>
    deriveOutcome(this.metadata()?.result ?? null, this.mySide()),
  );

  // "V" / "D" / "—" pill on each player chip.
  protected readonly selfResultTag = computed(() => this.tagFor(this.outcome(), 'self'));
  protected readonly oppResultTag  = computed(() => this.tagFor(this.outcome(), 'opp'));

  protected readonly durationLabel = computed<string | null>(() => {
    const sec = this.metadata()?.durationSec;
    if (!sec || sec <= 0) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  });

  private tagFor(outcome: ReplayOutcome, side: 'self' | 'opp'): 'win' | 'loss' | null {
    if (outcome === 'draw') return null;
    const selfWon = outcome === 'victory';
    return side === 'self' ? (selfWon ? 'win' : 'loss') : (selfWon ? 'loss' : 'win');
  }
}
