import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { Deck } from '../../../core/model/deck';
import type { SolverState, HandtrapConfig, SolverStartConfig } from '../../../core/model/solver.model';
import { SolverService } from '../services/solver.service';
import { onCardImgError } from '../solver-result/card-image-fallback';

interface DeduplicatedCard {
  cardId: number;
  name: string;
  imageUrl: string;
  maxCopies: number;
}

@Component({
  selector: 'app-solver-config',
  standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, TranslatePipe],
  templateUrl: './solver-config.component.html',
  styleUrl: './solver-config.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolverConfigComponent {
  protected readonly solverService = inject(SolverService);
  private readonly destroyRef = inject(DestroyRef);

  readonly deck = input.required<Deck>();
  readonly solverState = input.required<SolverState>();

  readonly solve = output<SolverStartConfig>();

  readonly onImgError = onCardImgError;

  readonly selectedHand = signal<Record<number, number>>({});
  readonly speed = signal<'fast' | 'optimal'>(this.solverService.prefs().speed);
  readonly algorithm = signal<'dfs' | 'mcts' | 'auto'>(this.solverService.prefs().algorithm);
  readonly mode = signal<'goldfish' | 'adversarial'>(this.solverService.prefs().mode);
  readonly selectedHandtraps = signal<number[]>([...this.solverService.prefs().handtrapIds]);
  readonly deckSeed = signal('');
  readonly showAdvanced = signal(false);
  readonly deckSeedValid = computed(() => !this.deckSeed() || /^\d+,\d+$/.test(this.deckSeed().trim()));
  readonly dfsHint = signal(false);
  readonly deckSwitchAdversarialHint = signal(false);
  private _savedAlgorithm: 'dfs' | null = null;
  private _dfsHintTimerId: ReturnType<typeof setTimeout> | null = null;
  private _deckSwitchHintTimerId: ReturnType<typeof setTimeout> | null = null;
  private _previousDeckId: string | null = null;

  // Tick every 250ms while a cooldown is pending so the disabled-state computed
  // re-evaluates without waiting for the next user interaction. Cleared on
  // destroy.
  private readonly cooldownTick = signal(Date.now());
  readonly isLocked = computed(() => this.solverState() === 'running');
  readonly inCooldown = computed(() => this.cooldownTick() < this.solverService.cooldownUntil());
  readonly canSolve = computed(() => {
    if (this.isLocked() || this.inCooldown()) return false;
    if (this.totalSelected() < 1 || this.totalSelected() > 5) return false;
    if (this.mode() === 'adversarial') {
      if (!this.solverService.handtraps()) return false;
      if (this.selectedHandtraps().length === 0) return false;
    }
    return true;
  });
  readonly canQuickSolve = computed(() =>
    !this.isLocked() &&
    !this.inCooldown() &&
    this.deduplicatedCards().length > 0 &&
    (this.mode() !== 'adversarial' || this.selectedHandtraps().length > 0)
  );

  readonly solveTooltip = computed(() => {
    if (this.totalSelected() < 1 || this.totalSelected() > 5) return 'solver.config.notEnoughCards';
    if (this.mode() === 'adversarial' && this.selectedHandtraps().length === 0) return 'solver.config.selectHandtrap';
    return '';
  });

  readonly deduplicatedCards = computed<DeduplicatedCard[]>(() => {
    const deck = this.deck();
    const filled = deck.mainDeck.filter(c => c.index !== -1);
    const groups = new Map<number, DeduplicatedCard>();
    for (const icd of filled) {
      const cardId = icd.card.card.id!;
      const existing = groups.get(cardId);
      if (existing) {
        existing.maxCopies++;
      } else {
        groups.set(cardId, {
          cardId,
          name: icd.card.card.name ?? '',
          imageUrl: icd.card.images[0]?.smallUrl || 'assets/images/card_back.jpg',
          maxCopies: 1,
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly totalSelected = computed(() =>
    Object.values(this.selectedHand()).reduce((s, n) => s + n, 0)
  );

  readonly hasEnoughCards = computed(() =>
    this.deduplicatedCards().reduce((sum, c) => sum + c.maxCopies, 0) >= 5
  );

  constructor() {
    // Restore per-deck hand selection from the service when the deck context
    // changes. Persisting the hand here keeps it stable across solver page
    // navigation; switching to another deck still resets the hand.
    effect(() => {
      const deck = this.deck();
      const deckId = String(deck.id ?? '');
      const stored = this.solverService.getHandForDeck(deckId);
      this.selectedHand.set(stored);
      this.deckSeed.set('');
      // Show a transient hint when switching decks while in adversarial mode —
      // handtrap selection persists across decks and may not be relevant (#11).
      if (this._previousDeckId !== null && this._previousDeckId !== deckId && this.mode() === 'adversarial') {
        this.deckSwitchAdversarialHint.set(true);
        if (this._deckSwitchHintTimerId !== null) clearTimeout(this._deckSwitchHintTimerId);
        this._deckSwitchHintTimerId = setTimeout(() => { this._deckSwitchHintTimerId = null; this.deckSwitchAdversarialHint.set(false); }, 5000);
      }
      this._previousDeckId = deckId;
    });

    // Persist hand back to the service whenever it changes (without writing
    // every keystroke to localStorage — hands are session-scoped only).
    effect(() => {
      const hand = this.selectedHand();
      const deck = this.deck();
      const deckId = String(deck.id ?? '');
      this.solverService.setHandForDeck(deckId, hand);
    });

    // Persist speed/algorithm/mode/handtrap preferences to localStorage.
    effect(() => {
      const speed = this.speed();
      const algorithm = this.algorithm();
      const mode = this.mode();
      const handtrapIds = this.selectedHandtraps();
      const current = this.solverService.prefs();
      if (speed === current.speed && algorithm === current.algorithm
        && mode === current.mode
        && handtrapIds.length === current.handtrapIds.length
        && handtrapIds.every((id, i) => id === current.handtrapIds[i])) return;
      this.solverService.updatePrefs({ speed, algorithm, mode, handtrapIds });
    });

    // Prune orphaned handtrap selections when server handtrap list changes.
    effect(() => {
      const serverHandtraps = this.solverService.handtraps();
      if (!serverHandtraps) return;
      const validIds = new Set(serverHandtraps.map(h => h.cardId));
      const current = this.selectedHandtraps();
      const pruned = current.filter(id => validIds.has(id));
      if (pruned.length !== current.length) {
        this.selectedHandtraps.set(pruned);
      }
    });

    // Cooldown ticker — only runs while a cooldown is pending.
    const tickerId = setInterval(() => {
      if (Date.now() < this.solverService.cooldownUntil()) {
        this.cooldownTick.set(Date.now());
      }
    }, 250);
    this.destroyRef.onDestroy(() => {
      clearInterval(tickerId);
      if (this._dfsHintTimerId !== null) clearTimeout(this._dfsHintTimerId);
      if (this._deckSwitchHintTimerId !== null) clearTimeout(this._deckSwitchHintTimerId);
    });
  }

  selectedCount(cardId: number): number {
    return this.selectedHand()[cardId] ?? 0;
  }

  onCardClick(card: DeduplicatedCard): void {
    if (this.isLocked()) return;
    const current = this.selectedCount(card.cardId);

    if (current >= card.maxCopies) {
      // At max → reset to 0
      this.selectedHand.update(prev => {
        const next = { ...prev };
        delete next[card.cardId];
        return next;
      });
      return;
    }

    // If hand is full, block — only the reset-to-0 path (above) is allowed
    if (this.totalSelected() >= 5) return;

    this.selectedHand.update(prev => ({
      ...prev,
      [card.cardId]: current + 1,
    }));
  }

  fillRandom(): void {
    if (this.isLocked()) return;
    const gap = 5 - this.totalSelected();
    if (gap <= 0) return;

    const current = this.selectedHand();
    const available: number[] = [];
    for (const card of this.deduplicatedCards()) {
      const remaining = card.maxCopies - (current[card.cardId] ?? 0);
      for (let i = 0; i < remaining; i++) {
        available.push(card.cardId);
      }
    }

    // Fisher-Yates shuffle
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    const picked = available.slice(0, gap);
    const additions: Record<number, number> = {};
    for (const cardId of picked) {
      additions[cardId] = (additions[cardId] ?? 0) + 1;
    }

    this.selectedHand.update(prev => {
      const next = { ...prev };
      for (const [id, count] of Object.entries(additions)) {
        next[Number(id)] = (next[Number(id)] ?? 0) + count;
      }
      return next;
    });
  }

  clearSelection(): void {
    if (this.isLocked()) return;
    this.selectedHand.set({});
  }

  onModeChange(mode: 'goldfish' | 'adversarial'): void {
    if (mode === 'adversarial' && this.algorithm() === 'dfs') {
      this._savedAlgorithm = 'dfs';
      this.algorithm.set('auto');
      this.dfsHint.set(true);
      if (this._dfsHintTimerId !== null) clearTimeout(this._dfsHintTimerId);
      this._dfsHintTimerId = setTimeout(() => { this._dfsHintTimerId = null; this.dfsHint.set(false); }, 3000);
    }
    if (mode === 'goldfish' && this._savedAlgorithm) {
      this.algorithm.set(this._savedAlgorithm);
      this._savedAlgorithm = null;
    }
    this.mode.set(mode);
  }

  handtrapImageUrl(cardId: number): string {
    return `/api/documents/small/code/${cardId}`;
  }

  onHandtrapToggle(cardId: number, checked: boolean): void {
    if (checked) {
      this.selectedHandtraps.set([...this.selectedHandtraps(), cardId]);
    } else {
      this.selectedHandtraps.set(this.selectedHandtraps().filter(id => id !== cardId));
    }
  }

  quickSolve(): void {
    if (!this.canQuickSolve()) return;
    this.fillRandom();
    this.onSolve();
  }

  onSolve(): void {
    if (!this.canSolve()) return;

    const hand: number[] = [];
    for (const [cardId, count] of Object.entries(this.selectedHand())) {
      for (let i = 0; i < count; i++) {
        hand.push(Number(cardId));
      }
    }

    let handtraps: HandtrapConfig[] | undefined = undefined;
    if (this.mode() === 'adversarial') {
      if (!this.solverService.handtraps()) return;
      handtraps = this.selectedHandtraps()
        .map(id => this.solverService.handtraps()!.find(h => h.cardId === id))
        .filter((h): h is HandtrapConfig => !!h);
    }

    const deck = this.deck();
    const seedValue = this.deckSeed().trim();
    this.solve.emit({
      deckId: String(deck.id!),
      hand,
      mode: this.mode(),
      speed: this.speed(),
      algorithm: this.algorithm(),
      handtraps,
      deckSeed: seedValue && this.deckSeedValid() ? seedValue : undefined,
    });
  }
}
