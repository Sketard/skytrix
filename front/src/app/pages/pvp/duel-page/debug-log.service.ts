import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DebugLogEntry, formatPlayerResponse, formatServerMessage } from './debug-log-formatter';
import type { ServerMessage } from '../duel-ws.types';

@Injectable()
export class DebugLogService {
  private readonly enabled = !environment.production;

  private readonly _entries = signal<DebugLogEntry[]>([]);
  readonly entries = this._entries.asReadonly();
  readonly panelOpen = signal(false);

  logServerMessage(msg: ServerMessage): void {
    if (!this.enabled) return;

    const text = formatServerMessage(msg);
    if (text === null) return;

    const category = this.categorize(msg.type);
    this._entries.update(entries => [...entries, { timestamp: Date.now(), category, text }]);
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
