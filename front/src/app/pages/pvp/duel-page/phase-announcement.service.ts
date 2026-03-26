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

const PHASE_DISPLAY: Record<string, string> = {
  DRAW: 'Draw Phase',
  STANDBY: 'Standby Phase',
  MAIN1: 'Main Phase 1',
  BATTLE_START: 'Battle Phase',
  BATTLE_STEP: 'Battle Step',
  DAMAGE: 'Damage Step',
  DAMAGE_CALC: 'Damage Calculation',
  BATTLE: 'Battle',
  MAIN2: 'Main Phase 2',
  END: 'End Phase',
};

const PHASE_ANNOUNCE_DURATION = 2000;

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

  phaseDisplayName(phase: string): string {
    return PHASE_DISPLAY[phase] ?? phase;
  }

  show(label: string, isOpponent: boolean, phase: Phase, turnPlayer: Player, turnCount: number): void {
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
