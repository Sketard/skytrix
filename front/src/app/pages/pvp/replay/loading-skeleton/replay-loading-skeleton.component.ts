import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SkelComponent } from '../../../../shared/skel/skel.component';
import { PillComponent } from '../../../../components/pill/pill.component';

// Wireframe shown while the replay loads — replaces the legacy `<mat-progress-spinner>`
// plein écran (D10). Layout: topbar skel + board skel + timeline skel + transport
// skel + live progress pill. Every block is `<app-skel>` primitive — no
// ad-hoc div/.skel-* classes (skytrix convention `project_skeleton_screens_convention`).
//
// The `.pill.pill--live` indicator consumes DS Wave 1 §2.6 — it owns the
// pulse-dot animation, so the component doesn't define its own.
@Component({
  selector: 'app-replay-loading-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, SkelComponent, PillComponent],
  templateUrl: './replay-loading-skeleton.component.html',
  styleUrl: './replay-loading-skeleton.component.scss',
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
  },
})
export class ReplayLoadingSkeletonComponent {
  /** Current loaded-turn count, e.g. 6. */
  readonly current = input<number>(0);
  /** Total turn count from REPLAY_METADATA, e.g. 11. Null while metadata not yet received. */
  readonly total = input<number | null>(null);

  /** Whether the detailed "loaded {{current}}/{{total}}" pill is shown.
   *  Otherwise renders the generic "loading…" pill. */
  protected readonly hasProgress = computed(() => this.total() != null && this.current() > 0);

  protected readonly progressParams = computed(() => ({
    current: this.current(),
    total: this.total() ?? 0,
  }));
}
