// =============================================================================
// solver-pins.service.ts — Pinned result snapshots (Story 3.2). Extracted
// from SolverService so `PinnedResultsBarComponent` can inject this directly
// without pulling the full solver surface. Persists to localStorage.
// =============================================================================

import { Injectable, Signal, computed, signal } from '@angular/core';
import type {
  HistoryEntryConfig,
  PinnedResult,
  SolverResult,
} from '../../../core/model/solver.model';

const PINNED_RESULTS_CAP = 4;
const PINS_STORAGE_KEY = 'solver:pins:v1';

function loadPins(): PinnedResult[] {
  try {
    const raw = localStorage.getItem(PINS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is PinnedResult =>
        p !== null && typeof p === 'object'
        && typeof (p as PinnedResult).score === 'number'
        && typeof (p as PinnedResult).savedAt === 'number'
        && (p as PinnedResult).config !== undefined
        && Array.isArray((p as PinnedResult).handCards)
        && Array.isArray((p as PinnedResult).endBoardCards),
    );
  } catch {
    return [];
  }
}

/** Minimal context the caller must provide when pinning a result. Keeps
 *  this service independent of SolverService (no circular DI) — the caller
 *  (SolverService) resolves all the pieces and hands them in. */
export interface PinSnapshotContext {
  result: SolverResult;
  config: HistoryEntryConfig;
  /** Map from cardId → card name. Should be a stable snapshot (the
   *  `lastSolveCardNames` captured at solve time) so names resolve correctly
   *  even if the user navigates away from the original deck. */
  cardNames: Map<number, string>;
}

@Injectable({ providedIn: 'root' })
export class SolverPinsService {
  readonly pinnedResults = signal<PinnedResult[]>(loadPins());

  /** True when a new pin can be added (result supplied + under the cap). */
  hasRoom(): boolean {
    return this.pinnedResults().length < PINNED_RESULTS_CAP;
  }

  /** Factory for a `canPin` computed that the caller can build from any
   *  result signal. Kept as a factory (not a baked-in computed) so
   *  SolverService can wire it against its own `result()` without coupling
   *  this service to SolverService's signal graph. */
  canPinFor(resultSignal: Signal<SolverResult | null>) {
    return computed(() => this.hasRoom() && resultSignal() !== null);
  }

  pin(ctx: PinSnapshotContext): void {
    if (!this.hasRoom()) return;

    const { result, config, cardNames } = ctx;
    const handCards = Object.entries(config.hand).flatMap(([idStr, count]) => {
      const cardId = Number(idStr);
      const cardName = cardNames.get(cardId) ?? `#${cardId}`;
      return Array.from({ length: count }, () => ({ cardId, cardName }));
    }).slice(0, 5);

    const pin: PinnedResult = {
      score: result.score,
      scoreBreakdown: result.scoreBreakdown,
      mainPath: result.mainPath,
      endBoardCards: (result.endBoardCards ?? []).map(c => ({ cardId: c.cardId, cardName: c.cardName })),
      handCards,
      config: { ...config },
      minimax: result.minimax,
      deckSeed: result.stats.deckSeed,
      savedAt: Date.now(),
    };

    this.pinnedResults.update(pins => [...pins, pin]);
    this.persist();
  }

  unpin(index: number): void {
    this.pinnedResults.update(pins => pins.filter((_, i) => i !== index));
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(this.pinnedResults()));
    } catch { /* quota / private mode — silently ignore */ }
  }
}
