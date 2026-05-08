import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DebugLogEntry, formatPlayerResponse, formatServerMessage, categorizeMsg, extractPlayerFromMsg } from './debug-log-formatter';
import type { ServerMessage } from '../duel-ws.types';

const MAX_DEBUG_ENTRIES = 5000;

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
    this.appendEntry({ timestamp: Date.now(), category, text, player });
  }

  logPlayerResponse(promptType: string, data: Record<string, unknown>): void {
    if (!this.enabled) return;
    const text = formatPlayerResponse(promptType, data);
    this.appendEntry({ timestamp: Date.now(), category: 'response' as const, text });
  }

  clearLogs(): void {
    this._entries.set([]);
  }

  private appendEntry(entry: DebugLogEntry): void {
    this._entries.update(entries => {
      const next = entries.length >= MAX_DEBUG_ENTRIES ? entries.slice(1) : entries.slice();
      next.push(entry);
      return next;
    });
  }
}
