import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * "Rotate device" overlay — shown when the page is in portrait orientation.
 *
 * Both PvP duel and Replay viewer need this: the board layout is
 * intrinsically landscape (16:9, 7 zones in a row). The component owns the
 * `matchMedia` listener, the signal, the DOM (SVG + translated paragraph)
 * and the SCSS. Consumers just render it conditionally where they want
 * (typically inside `@if (isActive) { <app-orientation-lock /> }`).
 *
 * Drop it inside a positioned ancestor (the host uses `display: contents`,
 * the inner `.orientation-overlay` is `position: absolute`).
 */
@Component({
  selector: 'app-orientation-lock',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isPortrait()) {
      <div
        class="orientation-overlay"
        role="alertdialog"
        aria-modal="true"
        [attr.aria-label]="'duel.misc.rotateLandscape' | translate">
        <div class="orientation-content">
          <svg class="rotate-icon" viewBox="0 0 24 24" width="64" height="64" fill="currentColor" aria-hidden="true">
            <path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32zm-6.25-.77c-.59-.59-1.54-.59-2.12 0L1.75 8.11c-.59.59-.59 1.54 0 2.12l12.02 12.02c.59.59 1.54.59 2.12 0l6.36-6.36c.59-.59.59-1.54 0-2.12L10.23 1.75zm4.6 19.44L2.81 9.17l6.36-6.36 12.02 12.02-6.36 6.38zm-7.31.29C4.25 19.94 1.91 16.76 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81-1.33 1.32z"/>
          </svg>
          <p>{{ 'duel.misc.rotateLandscape' | translate }}</p>
        </div>
      </div>
    }
  `,
  styleUrl: './orientation-lock.component.scss',
  host: { '[style.display]': '"contents"' },
})
export class OrientationLockComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly isPortrait = signal(false);

  constructor() {
    const mql = window.matchMedia('(orientation: portrait)');
    this.isPortrait.set(mql.matches);
    const handler = (e: MediaQueryListEvent) => this.isPortrait.set(e.matches);
    mql.addEventListener('change', handler);
    this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));
  }
}
