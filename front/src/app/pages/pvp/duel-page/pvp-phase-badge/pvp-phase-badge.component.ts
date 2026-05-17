import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Phase, Player, SelectBattleCmdMsg, SelectIdleCmdMsg } from '../../duel-ws.types';
import { BATTLE_ACTION, IDLE_ACTION } from '../idle-action-codes';
import { setupClickOutsideListener } from '../click-outside.utils';

interface PhaseTransition {
  label: string;
  actionCode: number;
}

const PHASE_ABBR: Record<Phase, string> = {
  DRAW: 'DP',
  STANDBY: 'SP',
  MAIN1: 'M1',
  BATTLE_START: 'BP',
  BATTLE_STEP: 'BP',
  DAMAGE: 'BP',
  DAMAGE_CALC: 'BP',
  BATTLE: 'BP',
  MAIN2: 'M2',
  END: 'EP',
};

@Component({
  selector: 'app-pvp-phase-badge',
  templateUrl: './pvp-phase-badge.component.html',
  styleUrl: './pvp-phase-badge.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpPhaseBadgeComponent {
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  readonly phase = input.required<Phase>();
  readonly turnPlayer = input.required<Player>();
  readonly turnCount = input(0);
  readonly isOwnTurn = input(false);
  readonly actor = input<'me' | 'opp'>('me');
  readonly actionablePrompt = input<SelectIdleCmdMsg | SelectBattleCmdMsg | null>(null);

  readonly phaseAction = output<{ action: number; index: null }>();

  readonly abbreviation = computed(() => PHASE_ABBR[this.phase()] ?? 'DP');
  readonly turnLabel = computed(() => this.translate.instant('duel.phase.turn', { n: this.turnCount() }));
  readonly menuExpanded = signal(false);

  /** Rich aria-label — phase + actor + interaction hint when actionable. */
  readonly ariaLabel = computed(() => {
    const phase = this.abbreviation();
    if (this.actor() === 'opp') {
      return this.translate.instant('duel.a11y.phasePillOppTurn', { phase });
    }
    const key = this.availableTransitions().length > 0
      ? 'duel.a11y.phasePillOwnTurn'
      : 'duel.a11y.phasePillOwnTurnNoActions';
    return this.translate.instant(key, { phase });
  });

  readonly availableTransitions = computed((): PhaseTransition[] => {
    const prompt = this.actionablePrompt();
    if (!prompt || !this.isOwnTurn()) return [];

    const transitions: PhaseTransition[] = [];
    if (prompt.type === 'SELECT_IDLECMD') {
      if (prompt.canBattlePhase) transitions.push({ label: this.translate.instant('duel.phase.battlePhase'), actionCode: IDLE_ACTION.BATTLE_PHASE });
      if (prompt.canEndPhase) transitions.push({ label: this.translate.instant('duel.phase.endTurn'), actionCode: IDLE_ACTION.END_TURN });
    } else if (prompt.type === 'SELECT_BATTLECMD') {
      if (prompt.canMainPhase2) transitions.push({ label: this.translate.instant('duel.phase.mainPhase2'), actionCode: BATTLE_ACTION.MAIN_PHASE_2 });
      if (prompt.canEndPhase) transitions.push({ label: this.translate.instant('duel.phase.endTurn'), actionCode: BATTLE_ACTION.END_TURN });
    }
    return transitions;
  });

  private removeOutsideListener: (() => void) | null = null;

  constructor() {
    // Close menu when actionablePrompt changes (new prompt arrival).
    effect(() => {
      this.actionablePrompt();
      untracked(() => {
        this.closeMenu();
      });
    });
  }

  toggleMenu(): void {
    if (!this.isOwnTurn() || this.availableTransitions().length === 0) return;
    const expanded = !this.menuExpanded();
    this.menuExpanded.set(expanded);

    if (expanded) {
      this.teardownOutsideListener();
      this.removeOutsideListener = setupClickOutsideListener(this.el, this.destroyRef, () => this.closeMenu());
    } else {
      this.teardownOutsideListener();
    }
  }

  selectTransition(transition: PhaseTransition): void {
    this.phaseAction.emit({ action: transition.actionCode, index: null });
    this.closeMenu();
    // Wave 3 §7.2.d : announce delegated to PhaseAnnouncementService. The
    // service fires on the WS-driven phase change (which is the source of
    // truth) instead of double-announcing on click.
  }

  onMenuKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.closeMenu();
        event.preventDefault();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const items = Array.from(
          (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')
        );
        const current = items.indexOf(event.target as HTMLElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[(current + delta + items.length) % items.length];
        next?.focus();
        event.preventDefault();
        break;
      }
    }
  }

  private closeMenu(): void {
    this.menuExpanded.set(false);
    this.teardownOutsideListener();
  }

  private teardownOutsideListener(): void {
    if (this.removeOutsideListener) {
      this.removeOutsideListener();
      this.removeOutsideListener = null;
    }
  }
}
