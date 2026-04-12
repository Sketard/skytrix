// =============================================================================
// solver-export.service.ts — Export a solve result as a compact JSON snapshot
// to the clipboard (Story 3.4). Extracted from SolverService to isolate the
// one-shot clipboard concern from WS / history / pins.
// =============================================================================

import { Injectable, inject } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { NotificationService } from '../../../core/services/notification.service';
import type {
  HandtrapConfig,
  HistoryEntryConfig,
  SolverResult,
} from '../../../core/model/solver.model';

/** Minimal context the caller must provide. Keeps this service independent
 *  of SolverService — the caller resolves all pieces and hands them in. */
export interface ExportContext {
  result: SolverResult;
  config: HistoryEntryConfig;
  /** Snapshot map cardId → name. Use `lastSolveCardNames` so resolution
   *  survives deck navigation post-solve. */
  cardNames: Map<number, string>;
  /** Server handtrap list (for resolving handtrap names on adversarial solves).
   *  Pass `[]` or `null` if not applicable — adversarial solves that can't
   *  resolve a handtrap name will fall back to `#cardId`. */
  handtrapList: HandtrapConfig[] | null;
}

@Injectable({ providedIn: 'root' })
export class SolverExportService {
  private readonly clipboard = inject(Clipboard);
  private readonly notify = inject(NotificationService);

  export(ctx: ExportContext): void {
    const { result, config, cardNames, handtrapList } = ctx;

    const hand = Object.entries(config.hand).map(([idStr, count]) => ({
      cardId: Number(idStr),
      cardName: cardNames.get(Number(idStr)) ?? `#${idStr}`,
      count,
    }));

    // Strip zero-valued fields from scoreBreakdown except `total`/`weighted`
    // (always present — they're the aggregate scores).
    const bd = result.scoreBreakdown;
    const scoreBreakdown = Object.fromEntries(
      Object.entries(bd).filter(([k, v]) => v !== 0 || k === 'total' || k === 'weighted'),
    );

    const exportObj: Record<string, unknown> = {
      deckName: config.deckName,
      deckId: config.deckId,
      deckSeed: result.stats.deckSeed,
      hand,
      mode: config.mode,
      speed: config.speed,
      algorithm: config.algorithm,
      algorithmUsed: result.stats.algorithmUsed,
      score: result.score,
      scoreBreakdown,
      endBoardCards: (result.endBoardCards ?? []).map(c => ({
        cardId: c.cardId, cardName: c.cardName, zone: c.zone,
      })),
    };

    if (result.minimax != null) {
      exportObj['minimax'] = result.minimax;
    }

    if (config.mode === 'adversarial' && config.handtraps && config.handtraps.length > 0) {
      const htList = handtrapList ?? [];
      exportObj['handtraps'] = config.handtraps.map(id => {
        const ht = htList.find(h => h.cardId === id);
        return { cardId: id, cardName: ht?.cardName ?? cardNames.get(id) ?? `#${id}` };
      });
    }

    if (result.adversarialTimings) {
      exportObj['adversarialTimings'] = result.adversarialTimings.map(t => ({
        handtrapCardName: t.handtrapCardName,
        usedAtStep: result.mainPath[t.stepIndex]?.cardName ?? `step ${t.stepIndex}`,
      }));
    }

    exportObj['mainPath'] = result.mainPath.map(a => ({
      cardName: a.cardName,
      actionDescription: a.actionDescription,
    }));

    if (result.partial) {
      exportObj['partial'] = true;
    }

    exportObj['timestamp'] = Date.now();

    if (this.clipboard.copy(JSON.stringify(exportObj, null, 2))) {
      this.notify.success('solver.export.copied');
    } else {
      this.notify.error('solver.export.failed');
    }
  }
}
