import type { DuelConnection } from './duel-connection';
import type { DuelCardArtService } from './duel-card-art.service';
import type { DebugLogService } from './debug-log.service';

/**
 * γ-c cleanup F-3.2 (audit) — symmetric wiring of the 3 debug-log /
 * card-art sinks that every `DuelConnection` instance receives,
 * regardless of mode.
 *
 * Before this helper, the 3 lines lived inline at TWO places :
 *  - `DuelWebSocketService` ctor (for the PvP-normal default conn)
 *  - `SoloDuelOrchestratorService.init` (for the SOLO multiplex conn)
 *
 * The asymmetry meant a future 4th sink (e.g. `onError`) would have to
 * be added at both sites with the risk of forgetting one. Extracting to
 * a pure helper closes the dispersion.
 *
 * **What this helper does NOT wire** :
 *  - `onStateSync` — owned by `DuelWebSocketService` (re-applied on
 *    `bindSoloConnection`). The wsService is the consumer ; conn-side
 *    wiring would inject a wsService dep here, defeating the helper's
 *    purity.
 *  - `attachOutOfBandSink` — wired by the page (`duel-page.component.ts`
 *    or `replay-page.component.ts`) via `wsService.attachOutOfBandSink`
 *    or `adapter.attachOutOfBandSink`. Re-applied by
 *    `bindSoloConnection` for the SOLO swap.
 *  - `onDrawNewTurn` — wired by `DuelAnimationBridgeService` via
 *    `wsService.attachDrawNewTurnSink`. Re-applied by `bindSoloConnection`.
 *
 * The split is "ctor-time uniform wiring" (here) vs "page/bridge-time
 * sink registration" (the 3 above). Keeping the boundary explicit makes
 * the future "add 4th conn-ctor sink" decision a one-place add.
 */
export function wireConnectionDebugSinks(
  conn: DuelConnection,
  deps: { artService: DuelCardArtService; debugLog: DebugLogService },
): void {
  conn.artService = deps.artService;
  conn.onMessage = msg => deps.debugLog.logServerMessage(msg);
  conn.onResponse = (promptType, data) => deps.debugLog.logPlayerResponse(promptType, data);
}
