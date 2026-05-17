import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslateService } from '@ngx-translate/core';
import type { Phase, Player } from '../duel-ws.types';

export interface PhaseAnnouncement {
  label: string;
  isOpponent: boolean;
  phase: Phase;
  turnPlayer: Player;
  turnCount: number;
}

const PHASE_ANNOUNCE_DURATION = 2000;

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

@Injectable()
export class PhaseAnnouncementService implements OnDestroy {
  private readonly liveAnnouncer: LiveAnnouncer;
  private readonly translate: TranslateService;

  private readonly _announcement = signal<PhaseAnnouncement | null>(null);
  readonly announcement = this._announcement.asReadonly();

  readonly displayedPhase = computed(() => this._announcement()?.phase ?? null);
  readonly displayedTurnPlayer = computed(() => this._announcement()?.turnPlayer ?? null);
  readonly displayedTurnCount = computed(() => this._announcement()?.turnCount ?? null);

  private queue: PhaseAnnouncement[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

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
    this.queue.push({ label, isOpponent, phase, turnPlayer, turnCount });
    if (!this.timer) {
      this.drain();
    }
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this._announcement.set(null);
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private drain(): void {
    const next = this.queue.shift();
    if (!next) {
      this.timer = setTimeout(() => {
        this._announcement.set(null);
        this.timer = null;
      }, 500);
      return;
    }

    this._announcement.set(next);
    this.liveAnnouncer.announce(
      next.isOpponent ? this.translate.instant('duel.a11y.opponentPhase', { phase: next.label }) : next.label,
    );

    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, PHASE_ANNOUNCE_DURATION);
  }
}
