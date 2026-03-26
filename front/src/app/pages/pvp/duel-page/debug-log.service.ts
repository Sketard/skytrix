import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DebugLogEntry, formatPlayerResponse, formatServerMessage, categorizeMsg, extractPlayerFromMsg } from './debug-log-formatter';
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

    const category = categorizeMsg(msg.type);
    const player = extractPlayerFromMsg(msg);
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
}
