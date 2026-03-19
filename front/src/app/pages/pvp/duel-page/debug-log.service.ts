import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DebugLogEntry, formatPlayerResponse, formatServerMessage } from './debug-log-formatter';
import type { ServerMessage } from '../duel-ws.types';

@Injectable()
export class DebugLogService {
  private readonly enabled = environment.debugTools;

  private readonly _entries = signal<DebugLogEntry[]>([]);
  readonly entries = this._entries.asReadonly();
  readonly panelOpen = signal(false);

  logServerMessage(msg: ServerMessage): void {
    if (!this.enabled) return;

    const text = formatServerMessage(msg);
    if (text === null) return;

    const category = this.categorize(msg.type);
    const player = this.extractPlayer(msg);
    this._entries.update(entries => [...entries, { timestamp: Date.now(), category, text, player }]);
  }

  logPlayerResponse(promptType: string, data: Record<string, unknown>): void {
    if (!this.enabled) return;
    const text = formatPlayerResponse(promptType, data);
    this._entries.update(entries => [...entries, { timestamp: Date.now(), category: 'response' as const, text }]);
  }

  clearLogs(): void {
    this._entries.set([]);
  }

  private extractPlayer(msg: ServerMessage): 0 | 1 | undefined {
    if ('player' in msg && typeof msg.player === 'number') return msg.player as 0 | 1;
    if ('attackerPlayer' in msg && typeof msg.attackerPlayer === 'number') return msg.attackerPlayer as 0 | 1;
    return undefined;
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
