/**
 * Sliding-window WebSocket connection rate limiter, keyed by client IP.
 *
 * Counts handshake attempts (`consumeWsAttempt` at connection open) AND
 * post-await auth failures (`recordFailedWsAttempt`). Pre-incrementing at
 * the handshake closes a race where N concurrent connections from the same
 * IP could all pass the check at threshold-1 (each seeing N-1 < MAX) and
 * then all `recordFailedWsAttempt`, exceeding MAX silently.
 *
 * A legitimate user does not exceed 30 reconnects in 60s under normal
 * conditions, so the pessimistic counting policy adds no real friction.
 *
 * Sweep interval cleans up IPs whose recent timestamps have all expired,
 * bounding memory in the face of long-tail attackers.
 */

const WS_RATE_LIMIT_WINDOW_MS = 60_000;
const WS_RATE_LIMIT_MAX = 30;
const SWEEP_INTERVAL_MS = 5 * 60_000;

const wsFailedConnections = new Map<string, number[]>();

/** Filter expired timestamps and return the live array (mutates the map). */
function pruneAndGet(ip: string, now: number): number[] {
  const timestamps = wsFailedConnections.get(ip) ?? [];
  const recent = timestamps.filter(t => now - t < WS_RATE_LIMIT_WINDOW_MS);
  if (recent.length === 0) {
    wsFailedConnections.delete(ip);
    return [];
  }
  wsFailedConnections.set(ip, recent);
  return recent;
}

/** Cap array growth from rapid-fire spam (keeps memory bounded). */
function appendTimestamp(ip: string, recent: number[], now: number): void {
  recent.push(now);
  if (recent.length > WS_RATE_LIMIT_MAX * 2) {
    recent.splice(0, recent.length - WS_RATE_LIMIT_MAX);
  }
  wsFailedConnections.set(ip, recent);
}

/**
 * Atomic "register attempt + check threshold" used at handshake open.
 * Returns true if the IP is over the limit AFTER counting this attempt.
 * Closes the race: N concurrent calls from the same IP each see a
 * monotonically increasing counter, so only the first MAX get `false`.
 */
export function consumeWsAttempt(ip: string): boolean {
  const now = Date.now();
  const recent = pruneAndGet(ip, now);
  appendTimestamp(ip, recent, now);
  return recent.length >= WS_RATE_LIMIT_MAX;
}

/**
 * Read-only check used by tests and diagnostics — does NOT count an attempt.
 * Production callers should use `consumeWsAttempt` instead.
 */
export function isWsRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = wsFailedConnections.get(ip);
  if (!timestamps) return false;
  const recent = timestamps.filter(t => now - t < WS_RATE_LIMIT_WINDOW_MS);
  if (recent.length === 0) {
    wsFailedConnections.delete(ip);
    return false;
  }
  wsFailedConnections.set(ip, recent);
  return recent.length >= WS_RATE_LIMIT_MAX;
}

export function recordFailedWsAttempt(ip: string): void {
  const now = Date.now();
  const recent = pruneAndGet(ip, now);
  appendTimestamp(ip, recent, now);
}

/**
 * Periodic sweep — drops IPs whose timestamps have all aged out of the
 * sliding window. Returns the interval handle so callers can clear it on
 * shutdown.
 */
export function startWsRateLimitSweep(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of wsFailedConnections) {
      const recent = timestamps.filter(t => now - t < WS_RATE_LIMIT_WINDOW_MS);
      if (recent.length === 0) wsFailedConnections.delete(ip);
      else wsFailedConnections.set(ip, recent);
    }
  }, SWEEP_INTERVAL_MS);
}

/** Test helper — current entry count (do not depend on this in prod code). */
export function _wsRateLimitSize(): number {
  return wsFailedConnections.size;
}

/** Test helper — clears all state. */
export function _wsRateLimitReset(): void {
  wsFailedConnections.clear();
}
