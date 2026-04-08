import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
  readonly deck = input.required<Deck>();
  readonly solverState = input.required<SolverState>();

  readonly solve = output<SolverStartConfig>();

  readonly selectedHand = signal<Record<number, number>>({});
  readonly speed = signal<'fast' | 'optimal'>('fast');
  readonly algorithm = signal<'dfs' | 'mcts' | 'auto'>('auto');

  readonly isLocked = computed(() => this.solverState() === 'running');

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
    effect(() => {
      this.deck();
      this.selectedHand.set({});
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

  onSolve(): void {
    if (this.totalSelected() !== 5 || this.isLocked()) return;

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
