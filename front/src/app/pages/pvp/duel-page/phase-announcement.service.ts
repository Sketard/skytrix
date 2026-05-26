import { Injectable, inject, OnDestroy, computed, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslateService } from '@ngx-translate/core';
import type { Phase, Player } from '../duel-ws.types';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { AnimationOrchestratorService } from './animation-orchestrator.service';

export interface PhaseAnnouncement {
  label: string;
  isOpponent: boolean;
  phase: Phase;
  turnPlayer: Player;
  turnCount: number;
}

const PHASE_ANNOUNCE_DURATION = 1000;

/**
 * Phases worth announcing visually + vocally — the 6 canonical turn phases:
 *  - DRAW         : turn start, draw the card
 *  - STANDBY      : standby phase (timing window for some effects)
 *  - MAIN1        : first Main Phase
 *  - BATTLE_START : entry into Battle Phase
 *  - MAIN2        : second Main Phase (back from BP)
 *  - END          : End Phase / turn end
 *
 * Silently skipped: BATTLE_STEP, DAMAGE, DAMAGE_CALC, BATTLE. These are
 * combat sub-phases that fire many times during a single Battle Phase —
 * announcing each would saturate the player with noise. They remain
 * visible in the phase-pill central indicator.
 */
const MAJOR_PHASES: ReadonlySet<Phase> = new Set([
  'DRAW', 'STANDBY', 'MAIN1', 'BATTLE_START', 'MAIN2', 'END',
]);

/**
 * β.3 cas #13 (2026-05-26) — `show()` enqueues an `announcement` directive
 * on the main animation queue instead of running its own timer + queue. The
 * queue runner gates further event dispatch on the directive's duration —
 * a `SELECT_IDLECMD` arriving during the announcement now stays parked
 * behind it, fixing the "user can normal-summon while DRAW PHASE banner is
 * up" bug. Serialisation of consecutive phase changes is preserved by the
 * queue itself (no need for a service-internal file).
 */
@Injectable()
export class PhaseAnnouncementService implements OnDestroy {
  private readonly liveAnnouncer: LiveAnnouncer;
  private readonly translate: TranslateService;
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly orchestrator = inject(AnimationOrchestratorService);

  private readonly _announcement = signal<PhaseAnnouncement | null>(null);
  readonly announcement = this._announcement.asReadonly();

  readonly displayedPhase = computed(() => this._announcement()?.phase ?? null);
  readonly displayedTurnPlayer = computed(() => this._announcement()?.turnPlayer ?? null);
  readonly displayedTurnCount = computed(() => this._announcement()?.turnCount ?? null);

  constructor(liveAnnouncer: LiveAnnouncer, translate: TranslateService) {
    this.liveAnnouncer = liveAnnouncer;
    this.translate = translate;
  }

  /** i18n phase label (FR/EN). Falls back to the raw phase token if no key. */
  phaseDisplayName(phase: string): string {
    const key = `duel.phase.full.${phase}`;
    const translated = this.translate.instant(key);
    // ngx-translate returns the key itself when no translation exists.
    return translated === key ? phase : translated;
  }

  show(label: string, isOpponent: boolean, phase: Phase, turnPlayer: Player, turnCount: number): void {
    // Filter major phases only — silent skip otherwise (cf MAJOR_PHASES doc).
    if (!MAJOR_PHASES.has(phase)) return;
    const ann: PhaseAnnouncement = { label, isOpponent, phase, turnPlayer, turnCount };
    this.dataSource.enqueueDirective({
      kind: 'announcement',
      source: `phase:${phase}`,
      durationMs: PHASE_ANNOUNCE_DURATION,
      // β.3 cas #13 — phase banners restent SÉQUENTIELS dans la queue
      // (bloquantes par défaut). Si plusieurs phase changes back-to-back,
      // la queue les sérialise, pas d'overwrite du `_announcement` signal.
      // Les prompts serveur (SELECT_IDLECMD) sont gatés par le composant
      // qui lit `announcement` — quand l'annonce ≠ phase logique, le
      // prompt est caché (cf. duel-page.component.ts effectivePrompt).
      onShow: () => {
        this._announcement.set(ann);
        this.liveAnnouncer.announce(
          ann.isOpponent ? this.translate.instant('duel.a11y.opponentPhase', { phase: ann.label }) : ann.label,
        );
      },
      onClear: () => this._announcement.set(null),
    });
    // Wake the runner explicitly. The bridge's animationQueue watcher would
    // also call this on the next microtask tick, but relying on the effect
    // here means the directive may sit in the queue if the runner had just
    // finalised (race with the `setRunning(false)` window). The explicit
    // call is idempotent (`notifyEnqueue` is gated by `_isProcessing`).
    this.orchestrator.startProcessingIfIdle();
  }

  /** Hard-clear the visible announcement. A scoped reset (rematch /
   *  state-sync / destroy) cancels the in-flight directive via the
   *  orchestrator's `clearTimersAndPolling`, but components that need to
   *  drop the visible banner outside that path call this. */
  clear(): void {
    this._announcement.set(null);
  }

  ngOnDestroy(): void {
    this.clear();
  }
}
