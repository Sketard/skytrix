import { LruMap } from './lru-map.js';
import { REPLAY_CACHE_TTL_MS, type WorkerReplayPayload } from './types.js';

/**
 * Server-side cache of replay payloads keyed by replayId. Hit when a player
 * reconnects or forks within the TTL window, avoiding a re-fetch from Spring
 * Boot. Bounded LRU + TTL — eviction is silent (no callback wired).
 */
export interface ReplayCacheEntry {
  data: WorkerReplayPayload;
  playerIds: [string, string];
}

export type ReplayCache = LruMap<ReplayCacheEntry>;

const MAX_REPLAY_CACHE_ENTRIES = 50;

export function createReplayCache(): ReplayCache {
  return new LruMap<ReplayCacheEntry>({
    maxEntries: MAX_REPLAY_CACHE_ENTRIES,
    ttlMs: REPLAY_CACHE_TTL_MS,
  });
}
