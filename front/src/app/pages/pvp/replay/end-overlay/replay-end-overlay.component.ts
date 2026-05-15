import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { ReplayOutcome } from '../replay-outcome.util';

// End-of-replay slide-in panel. Receives the pre-derived outcome (see
// `deriveOutcome` in `replay-outcome.util.ts` — D19) and shows three CTAs
// per mockup §end-overlay: "Rejouer" (primary gold shimmer) + "Forker à ce
// point" (secondary cyan) + "Bibliothèque" (ghost). A meta line under the
// result pill exposes `Tour N · MM:SS` (mockup §end-overlay-meta).
//
// Layout-only SCSS — visuals come from DS Wave 1 utility classes (`.surface-card`,
// `.pill--celebrated`, `.btn--cta-shimmer`, `.text-mono`, `.text-eyebrow`).
//
// Esc / ArrowLeft dismiss → `dismissed` output, page resumes playback.
@Component({
  selector: 'app-replay-end-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, A11yModule],
  templateUrl: './replay-end-overlay.component.html',
  styleUrl: './replay-end-overlay.component.scss',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': 'ariaLabel()',
    tabindex: '-1',
    cdkTrapFocus: '',
    cdkTrapFocusAutoCapture: '',
  },
})
export class ReplayEndOverlayComponent {
  readonly outcome  = input.required<ReplayOutcome>();
  readonly selfLp   = input.required<number>();
  readonly oppLp    = input.required<number>();
  readonly selfName = input.required<string>();
  readonly oppName  = input.required<string>();
  readonly turnCount = input<number | null>(null);
  readonly durationSec = input<number | null>(null);

  readonly replay    = output<void>();
  readonly fork      = output<void>();
  readonly library   = output<void>();
  readonly dismissed = output<void>();

  /** Mockup §end-overlay-meta — composed string `Tour N · MM:SS`. Either
   *  segment is dropped when null so legacy replays render the available
   *  metadata only. */
  protected readonly metaLine = computed<string | null>(() => {
    const turn = this.turnCount();
    const dur = this.durationSec();
    const parts: string[] = [];
    if (turn != null && turn > 0) {
      parts.push(this.translate.instant('replay.timeline.turn', { n: turn }));
    }
    if (dur != null && dur > 0) {
      const m = Math.floor(dur / 60);
      const s = String(dur % 60).padStart(2, '0');
      parts.push(`${m}:${s}`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  });

  private readonly translate = inject(TranslateService);

  // Reactive aria-label — recomputes when outcome() flips OR when the language changes.
  // Pipes can't run in host bindings, so we resolve via TranslateService.instant.
  protected readonly ariaLabel = computed(() => this.translate.instant(this.outcomeI18n()));

  // `.pill--<variant>` mapping (DS Wave 1 §2.6 + spec F1 table).
  protected readonly pillVariant = computed<'gold' | 'neutral' | 'cyan'>(() => {
    switch (this.outcome()) {
      case 'victory': return 'gold';
      case 'defeat':  return 'neutral';
      case 'draw':    return 'cyan';
    }
  });

  protected readonly outcomeI18n = computed(() => `replay.viewer.endOverlay.${this.outcome()}`);

  // Side that "won the LP race" — used to apply text-gold-gradient on the winner.
  // `null` when draw (no winner highlight).
  protected readonly winnerSide = computed<'self' | 'opp' | null>(() => {
    if (this.outcome() === 'draw') return null;
    return this.outcome() === 'victory' ? 'self' : 'opp';
  });

  @HostListener('document:keydown.escape')
  onDismissKey(): void {
    this.dismissed.emit();
  }
}
