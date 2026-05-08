// =============================================================================
// Structured JSON Logger
// =============================================================================
//
// Wraps console.log/warn/error with structured JSON output in production.
// In development, falls back to plain text for readability.
//
// LOG_LEVEL env var controls minimum level: 'debug' | 'info' | 'warn' | 'error'.
// Default: 'debug' (all logs visible).
//
// L9 — PII handling: some log sites pass `playerId` (Spring Boot user UUID),
// `username`, or `deckName` in the structured context (e.g. duel start, replay
// auth failures). These IDs/usernames are necessary for cross-system debugging
// (matching duel logs to Spring Boot session traces) and are kept out of the
// `msg` field — they only appear in `ctx`. If the deployment is subject to
// GDPR right-to-erasure, log retention should be ≤30 days OR `playerId`
// should be hashed before emit (override `forDuel` to wrap the logger).
// Decks themselves (cardCode arrays) are NOT logged.

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVEL_ORDER[(process.env['LOG_LEVEL'] as LogLevel) ?? 'debug'] ?? 0;

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  duelId?: string;
  player?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;

  if (IS_PRODUCTION) {
    const entry: LogEntry = { ts: new Date().toISOString(), level, msg, ...ctx };
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  } else {
    const prefix = ctx?.duelId ? `[${ctx.duelId}]` : '';
    const extra = ctx
      ? ' ' + Object.entries(ctx)
          .filter(([k]) => k !== 'duelId')
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ')
      : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`${prefix} ${msg}${extra}`);
  }
}

export function debug(msg: string, ctx?: Record<string, unknown>): void {
  emit('debug', msg, ctx);
}

export function log(msg: string, ctx?: Record<string, unknown>): void {
  emit('info', msg, ctx);
}

export function warn(msg: string, ctx?: Record<string, unknown>): void {
  emit('warn', msg, ctx);
}

export function error(msg: string, ctx?: Record<string, unknown>): void {
  emit('error', msg, ctx);
}

export type DuelLogger = ReturnType<typeof forDuel>;

/** Create a child logger with a fixed duelId context. */
export function forDuel(duelId: string) {
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => debug(msg, { duelId, ...ctx }),
    log: (msg: string, ctx?: Record<string, unknown>) => log(msg, { duelId, ...ctx }),
    warn: (msg: string, ctx?: Record<string, unknown>) => warn(msg, { duelId, ...ctx }),
    error: (msg: string, ctx?: Record<string, unknown>) => error(msg, { duelId, ...ctx }),
  };
}
