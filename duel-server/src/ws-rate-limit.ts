/**
 * Sliding-window WebSocket connection rate limiter, keyed by client IP.
 *
 * Tracks ONLY failed/rejected connection attempts (auth failure, bad token,
 * etc.) — successful connections do not count. Designed to mitigate
 * brute-force token guessing without throttling legitimate reconnects.
 *
 * Sweep interval cleans up IPs whose recent timestamps have all expired,
 * bounding memory in the face of long-tail attackers.
 */

const WS_RATE_LIMIT_WINDOW_MS = 60_000;
const WS_RATE_LIMIT_MAX = 30;
const SWEEP_INTERVAL_MS = 5 * 60_000;

const wsFailedConnections = new Map<string, number[]>();

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
  const timestamps = wsFailedConnections.get(ip) ?? [];
  timestamps.push(now);
  // Cap array size to prevent memory growth from rapid-fire spam
  if (timestamps.length > WS_RATE_LIMIT_MAX * 2) {
    timestamps.splice(0, timestamps.length - WS_RATE_LIMIT_MAX);
  }
  wsFailedConnections.set(ip, timestamps);
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
