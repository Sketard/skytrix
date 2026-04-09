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
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { Deck } from '../../../core/model/deck';
import type { SolverState } from '../../../core/model/solver.model';
import type { SolverStartConfig } from '../../../core/model/solver.model';
import { SolverService } from '../services/solver.service';

interface DeduplicatedCard {
  cardId: number;
  name: string;
  imageUrl: string;
  maxCopies: number;
}

@Component({
  selector: 'app-solver-config',
  standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, TranslatePipe],
  templateUrl: './solver-config.component.html',
  styleUrl: './solver-config.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolverConfigComponent {
  private readonly solverService = inject(SolverService);
  private readonly destroyRef = inject(DestroyRef);

  readonly deck = input.required<Deck>();
  readonly solverState = input.required<SolverState>();

  readonly solve = output<SolverStartConfig>();

  readonly selectedHand = signal<Record<number, number>>({});
  readonly speed = signal<'fast' | 'optimal'>(this.solverService.prefs().speed);
  readonly algorithm = signal<'dfs' | 'mcts' | 'auto'>(this.solverService.prefs().algorithm);

  // Tick every 250ms while a cooldown is pending so the disabled-state computed
  // re-evaluates without waiting for the next user interaction. Cleared on
  // destroy.
  private readonly cooldownTick = signal(Date.now());
  readonly isLocked = computed(() => this.solverState() === 'running');
  readonly inCooldown = computed(() => this.cooldownTick() < this.solverService.cooldownUntil());
  readonly canSolve = computed(() =>
    !this.isLocked() && !this.inCooldown() && this.totalSelected() === 5
  );

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
    });

    // Persist hand back to the service whenever it changes (without writing
    // every keystroke to localStorage — hands are session-scoped only).
    effect(() => {
      const hand = this.selectedHand();
      const deck = this.deck();
      const deckId = String(deck.id ?? '');
      this.solverService.setHandForDeck(deckId, hand);
    });

    // Persist speed/algorithm preferences to localStorage immediately on change.
    effect(() => {
      this.solverService.updatePrefs({
        speed: this.speed(),
        algorithm: this.algorithm(),
      });
    });

    // Cooldown ticker — only runs while a cooldown is pending.
    const tickerId = setInterval(() => {
      if (Date.now() < this.solverService.cooldownUntil()) {
        this.cooldownTick.set(Date.now());
      }
    }, 250);
    this.destroyRef.onDestroy(() => clearInterval(tickerId));
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

  onSolve(): void {
    if (!this.canSolve()) return;

    const hand: number[] = [];
    for (const [cardId, count] of Object.entries(this.selectedHand())) {
      for (let i = 0; i < count; i++) {
        hand.push(Number(cardId));
      }
    }

    const deck = this.deck();
    this.solve.emit({
      deckId: String(deck.id!),
      deck: {
        main: deck.cleanSlotsAndMapIds(deck.mainDeck),
        extra: deck.cleanSlotsAndMapIds(deck.extraDeck),
      },
      hand,
      mode: 'goldfish',
      speed: this.speed(),
      algorithm: this.algorithm(),
    });
  }
}
