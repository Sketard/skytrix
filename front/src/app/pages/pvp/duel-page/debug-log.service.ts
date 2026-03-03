import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { CardDataCacheService } from './card-data-cache.service';
import { DebugLogEntry, extractCardCodes, formatPlayerResponse, formatServerMessage } from './debug-log-formatter';
import type { ServerMessage } from '../duel-ws.types';

@Injectable()
export class DebugLogService {
  private readonly cardDataCache = inject(CardDataCacheService);
  private readonly enabled = !environment.production;
  private destroyed = false;

  private readonly _entries = signal<DebugLogEntry[]>([]);
  readonly entries = this._entries.asReadonly();
  readonly panelOpen = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  logServerMessage(msg: ServerMessage): void {
    if (!this.enabled) return;

    const text = formatServerMessage(msg);
    if (text === null) return;

    const category = this.categorize(msg.type);
    const entry: DebugLogEntry = { timestamp: Date.now(), category, text };
    this._entries.update(entries => [...entries, entry]);

    const codes = extractCardCodes(msg);
    if (codes.length > 0) {
      Promise.all(codes.map(c => this.cardDataCache.getCardData(c).catch(() => null))).then(results => {
        if (this.destroyed) return;
        let newText = entry.text;
        codes.forEach((code, i) => {
          const data = results[i];
          if (data?.name) {
            newText = newText.replace(`[${code}]`, `${data.name} [${code}]`);
          }
        });
        if (newText !== entry.text) {
          this._entries.update(entries => {
            const idx = entries.indexOf(entry);
            if (idx === -1) return entries;
            const updated = [...entries];
            updated[idx] = { ...entry, text: newText };
            return updated;
          });
        }
      });
    }
  }

  logPlayerResponse(promptType: string, data: Record<string, unknown>): void {
    if (!this.enabled) return;
    const text = formatPlayerResponse(promptType, data);
    this._entries.update(entries => [...entries, { timestamp: Date.now(), category: 'response' as const, text }]);
  }

  clearLogs(): void {
    this._entries.set([]);
  }

  private categorize(type: string): 'event' | 'prompt' | 'system' {
    if (
      type.startsWith('SELECT_') ||
      type.startsWith('ANNOUNCE_') ||
      type.startsWith('SORT_') ||
      type === 'RPS_CHOICE'
    ) {
      return 'prompt';
    }
    if (
      [
        'DUEL_END',
        'RPS_RESULT',
        'OPPONENT_DISCONNECTED',
        'OPPONENT_RECONNECTED',
        'REMATCH_INVITATION',
        'REMATCH_STARTING',
        'REMATCH_CANCELLED',
        'WORKER_ERROR',
      ].includes(type)
    ) {
      return 'system';
    }
    return 'event';
  }
}
