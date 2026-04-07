import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';

export interface SolverDebugEntry {
  timestamp: number;
  category: 'solver-in' | 'solver-out';
  text: string;
}

@Injectable()
export class SolverDebugLogService {
  private readonly enabled = environment.debugTools;

  private readonly _entries = signal<SolverDebugEntry[]>([]);
  readonly entries = this._entries.asReadonly();
  readonly panelOpen = signal(false);

  logMessage(msg: { type: string; [k: string]: unknown }, category: 'solver-in' | 'solver-out'): void {
    if (!this.enabled) return;
    const { type, ...rest } = msg;
    const text = `[${type}] ${JSON.stringify(rest)}`;
    this._entries.update(entries => [...entries, { timestamp: Date.now(), category, text }]);
  }

  clearLogs(): void {
    this._entries.set([]);
  }
}
