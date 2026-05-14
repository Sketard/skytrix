import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ContextPillComponent } from '../context-pill/context-pill.component';
import { TimelineZoomControlComponent, type ZoomLevel } from '../timeline-zoom-control/timeline-zoom-control.component';

// 3-zone transport bar (F3 viewer-rework). Layout:
//
//   [ context — turn pill + position + phase + event label ]
//   [ controls — skipStart ◀◀ stepBack ◀ play(52px gold) ▶ stepForward ▶▶ skipEnd ]
//   [ options  — zoom-control · toggles · perspective · fork · cheatSheet · ⋯ More ]
//
// All visuals come from DS Wave 1 (`.icon-btn`, `.icon-btn--lg.--round`, `.pill`,
// `.btn`, `.btn--ghost`, `.btn--cta-shimmer`). Material dependencies removed —
// the previous `MatIconButton`/`MatIcon`/`MatProgressSpinner`/`MatTooltip` are
// gone. Hover tooltips are kept via plain `title` attributes (browser-native).
//
// Cascade hide (D13):
//   ≤ 920px → label-short on toggles + fork label drop, .context-event-label
//             + .context-phase drop via `<app-context-pill>` (D13 internal MQ).
//   ≤ 480px → toggles + fork + perspective collapse into `⋯ More` (D15) — the
//             page handles the More-sheet contents.
@Component({
  selector: 'app-transport-bar',
  templateUrl: './transport-bar.component.html',
  styleUrl: './transport-bar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, ContextPillComponent, TimelineZoomControlComponent],
})
export class TransportBarComponent {
  // === Context inputs (left zone) ============================================
  readonly turnLabel = input<string>('');     // e.g. "Tour 3 / 11 tours"
  /** Per-player tag ("P1"). Renamed from `positionLabel` in the F3 refactor to
   *  avoid colliding with the legacy free-form `positionLabel` string that the
   *  page passes today — F4 will wire the new structured fields. */
  readonly playerPositionLabel = input<string | null>(null);
  readonly phaseLabel = input<string | null>(null);    // e.g. "Main 1"
  readonly eventLabel = input<string | null>(null);    // e.g. "Activation : Snake-Eye Ash"

  // === Controls inputs =======================================================
  readonly isPlaying = input(false);
  readonly atEnd = input(false);
  readonly forking = input(false);

  // === Options inputs ========================================================
  readonly animationsEnabled = input(false);
  readonly promptMode = input<'result' | 'decision'>('result');
  readonly perspectiveIndex = input(0);
  readonly perspectiveName = input<string>('');
  readonly zoomLevel = input<ZoomLevel>(1);
  readonly hasNonDefaultOption = input<boolean>(false); // mobile ⋯ dot indicator

  // === Outputs ===============================================================
  readonly skipStart = output<void>();
  readonly stepBack = output<void>();
  readonly playPause = output<void>();
  readonly stepForward = output<void>();
  readonly skipEnd = output<void>();
  readonly fork = output<void>();
  readonly toggleAnimations = output<void>();
  readonly togglePromptMode = output<void>();
  readonly togglePerspective = output<void>();
  readonly zoomLevelChange = output<ZoomLevel>();
  readonly openCheatSheet = output<void>();
  readonly openMoreOptions = output<void>();

  protected readonly playIcon = computed(() => (this.isPlaying() ? '⏸' : '▶'));
  protected readonly playAriaKey = computed(() => (this.isPlaying() ? 'replay.transport.pause' : 'replay.transport.play'));
  protected readonly animationsAriaKey = computed(() =>
    this.animationsEnabled() ? 'replay.transport.disableAnimations' : 'replay.transport.enableAnimations',
  );
  protected readonly promptAriaKey = computed(() =>
    this.promptMode() === 'decision' ? 'replay.transport.skipDecisions' : 'replay.transport.showDecisions',
  );
  protected readonly perspectiveAriaKey = computed(() =>
    this.perspectiveIndex() === 0 ? 'replay.transport.viewAsPlayer2' : 'replay.transport.viewAsPlayer1',
  );
}
