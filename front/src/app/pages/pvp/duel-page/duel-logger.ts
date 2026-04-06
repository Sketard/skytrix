import { Injectable } from '@angular/core';

export const enum DuelLogCategory {
  QUEUE   = 'QUEUE',
  MOVE    = 'MOVE',
  DRAW    = 'DRAW',
  CHAIN   = 'CHAIN',
  SHUFFLE = 'SHUFFLE',
  REPLAY  = 'REPLAY',
  LP      = 'LP',
  PROC    = 'PROC',
}

/**
 * Category-filtered logger for the animation pipeline.
 * Silent by default — enable categories via localStorage or debug panel.
 *
 * Provided at component level (NOT root) alongside AnimationOrchestratorService.
 */
@Injectable()
export class DuelLogger {
  private enabled: Set<string>;
  private _traceId = '';

  constructor() {
    const stored = localStorage.getItem('duel-log-categories');
    this.enabled = stored
      ? new Set(stored.split(','))
      : new Set<string>([DuelLogCategory.QUEUE, DuelLogCategory.MOVE, DuelLogCategory.DRAW,
          DuelLogCategory.CHAIN, DuelLogCategory.SHUFFLE, DuelLogCategory.REPLAY,
          DuelLogCategory.LP, DuelLogCategory.PROC]);
  }

  /** Set the server-provided traceId for log correlation. */
  setTraceId(traceId: string): void {
    this._traceId = traceId;
  }

  private get prefix(): string {
    return this._traceId ? `[${this._traceId}]` : '';
  }

  /** Category-gated log — silent unless category is enabled. */
  log(cat: DuelLogCategory, msg: string, ...args: unknown[]): void {
    if (this.enabled.has(cat)) console.log(`${this.prefix}[ANIM:${cat}] ${msg}`, ...args);
  }

  /** Warnings always fire (deadlocks, timeouts, error recovery). */
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`${this.prefix}[ANIM] ${msg}`, ...args);
  }

  /** Enable/disable categories at runtime. */
  setCategories(cats: DuelLogCategory[]): void {
    this.enabled = new Set(cats);
    localStorage.setItem('duel-log-categories', cats.join(','));
  }
}
