import { Injectable } from '@angular/core';

export const enum DuelLogCategory {
  QUEUE    = 'QUEUE',
  MOVE     = 'MOVE',
  DRAW     = 'DRAW',
  CHAIN    = 'CHAIN',
  SHUFFLE  = 'SHUFFLE',
  REPLAY   = 'REPLAY',
  LP       = 'LP',
  PROC     = 'PROC',
  /** Zone-key → DOM element (or float / card) lookups. Every conversion from
   *  a string identifier to a runtime object goes through this category, so a
   *  failing animation can be traced from `cardTravelEngine.travel(...)` back
   *  to the resolver call that returned null. Verbose by design — filter via
   *  setCategories() in the debug panel when not investigating. */
  RESOLVE  = 'RESOLVE',
  /** Message ingestion across the WS / Replay adapter / DuelEventProcessor
   *  boundary. Traces a server message from arrival on the websocket (or
   *  replay step feed) through to its enqueue in the animation queue. Useful
   *  when a visible event "is missing" — you can confirm whether the message
   *  was received at all, or was swallowed by an upstream filter. */
  PIPELINE = 'PIPELINE',
}

/**
 * Categorical logger for the animation + ingestion pipeline.
 *
 * Default state: all categories enabled in dev (loud — read with grep), and
 * persisted to localStorage so a DevHub toggle survives reload. Production
 * users who hit a stalled animation can paste the console excerpt directly
 * into a bug report without first re-running with extra flags.
 *
 * RESOLVE / PIPELINE are off by default in the persisted set because they
 * are extremely high-volume (every zone resolve, every WS message). Enable
 * them via `setCategories()` when investigating, or set the `duel-log-categories`
 * localStorage key manually.
 *
 * Provided at component level (NOT root) alongside AnimationOrchestratorService.
 */
@Injectable()
export class DuelLogger {
  /** Categories that are loud by default — opted out of localStorage default
   *  to keep the console readable on normal runs. */
  private static readonly VERBOSE_CATEGORIES: ReadonlySet<string> = new Set<string>([
    DuelLogCategory.RESOLVE,
    DuelLogCategory.PIPELINE,
  ]);

  private static readonly DEFAULT_ENABLED: ReadonlySet<string> = new Set<string>([
    DuelLogCategory.QUEUE, DuelLogCategory.MOVE, DuelLogCategory.DRAW,
    DuelLogCategory.CHAIN, DuelLogCategory.SHUFFLE, DuelLogCategory.REPLAY,
    DuelLogCategory.LP, DuelLogCategory.PROC,
  ]);

  private enabled: Set<string>;
  private _traceId = '';

  constructor() {
    const stored = localStorage.getItem('duel-log-categories');
    this.enabled = stored ? new Set(stored.split(',')) : new Set(DuelLogger.DEFAULT_ENABLED);
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

  /** Convenience for the RESOLVE category: one-line trace of a zoneKey → result
   *  conversion. Free-form `note` carries fallback / mismatch / cause context.
   *  Falsy results (null/undefined/empty) automatically downgrade to a warn so
   *  silent skips surface even when the RESOLVE category is filtered out. */
  resolve(method: string, input: string, result: unknown, note?: string): void {
    const tag = result == null || (typeof result === 'string' && !result)
      ? 'null'
      : (typeof result === 'object' && 'tagName' in (result as object) ? `<${(result as Element).tagName.toLowerCase()}>` : 'ok');
    const suffix = note ? ` | ${note}` : '';
    if (tag === 'null') {
      this.warn('RESOLVE %s("%s") → null%s', method, input, suffix);
      return;
    }
    if (this.enabled.has(DuelLogCategory.RESOLVE)) {
      console.log(`${this.prefix}[ANIM:RESOLVE] ${method}("${input}") → ${tag}${suffix}`);
    }
  }

  /** Warnings always fire (deadlocks, timeouts, error recovery, RESOLVE
   *  failures). Routed through console.warn so they survive a category
   *  filter and stand out visually in the DevTools console. */
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`${this.prefix}[ANIM] ${msg}`, ...args);
  }

  /** Enable/disable categories at runtime. */
  setCategories(cats: DuelLogCategory[]): void {
    this.enabled = new Set(cats);
    localStorage.setItem('duel-log-categories', cats.join(','));
  }

  /** Whether a category is currently enabled. Read by callers that build
   *  expensive log payloads (e.g. board-state dumps) only when needed. */
  isEnabled(cat: DuelLogCategory): boolean {
    return this.enabled.has(cat);
  }

  /** Categories considered noisy by default — useful for the DevHub toggle UI
   *  to render them in a separate "Verbose" section. */
  static isVerbose(cat: DuelLogCategory): boolean {
    return DuelLogger.VERBOSE_CATEGORIES.has(cat);
  }
}
