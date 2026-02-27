# Story 1.8 — Epic 1 Cross-Story Coherence Remediation

**Epic:** 1 — Core PvP Duel Engine
**Depends on:** 1.2–1.7 (all completed)
**Sprint:** 1 (remediation)

## Goal

Fix 7 cross-story coherence issues identified by adversarial review of Stories 1.2–1.7. These issues range from Critical (broken Player 2 UI, dead RPS component) to Low (inconsistent null normalization).

## Background

An adversarial review (`epic-1-cross-story-adversarial-review.md`) found 12 issues. 5 are deferred:
- **H2** (card data service) → separate story
- **M2** (MSG_CONFIRM_CARDS UI) → separate story
- **M3** (timer badge cosmetic) → Story 3.2
- **M4** (God component refactor) → Epic 2
- **L2** (protocol sync CI) → later

## Acceptance Criteria

### AC-1: BOARD_STATE player reindexing (Critical — C1)
- `sanitizeBoardState()` swaps `players[]` so `players[0]` = recipient, `players[1]` = sanitized opponent
- `turnPlayer` remapped from absolute OCGCore index to relative (0 = self, 1 = opponent)
- TODO comment added for Story 4.2 re: MSG_* `player` fields still using absolute indices

### AC-2: Forward RPS to client (Critical — C2)
- Worker no longer auto-responds to `ROCK_PAPER_SCISSORS`
- `transformMessage()` transforms `ROCK_PAPER_SCISSORS` → `RPS_CHOICE` DTO
- `transformMessage()` transforms `HAND_RES` → `RPS_RESULT` DTO
- `transformResponse()` handles `RPS_CHOICE` response (OCGCore type 20, +1 offset)
- `RPS_CHOICE` added to `SelectPromptType`, `RpsResponse` to `PlayerResponseMsg` union
- `RPS_CHOICE` added to `SELECT_TYPES` set in server.ts
- Protocol changes mirrored in `duel-ws.types.ts`

### AC-3: Reconnection token mechanism (Critical — C3)
- Server issues `SESSION_TOKEN` on WS connect with a unique reconnect token
- `PlayerSession` tracks `reconnectToken`
- On disconnect: grace period starts (60s), forfeit on expiry
- On reconnect with valid token: re-associate WS, issue new token, send `STATE_SYNC`
- Client stores reconnect token, uses it for reconnection
- `wasEverConnected` guard removed, replaced by token-based reconnection

### AC-4: Room end HTTP call (High — H1)
- `_duelResult` converted to `signal<DuelEndMsg | null>(null)` in `DuelWebSocketService`
- `DuelPageComponent` stores `roomId` from initial room fetch
- `effect()` watches `duelResult()` → `POST /api/rooms/${roomId}/end`
- `pvp-prompt-sheet.component.ts` updated to call `duelResult()` (signal)

### AC-5: Animation queue disabled (High — H3)
- `_animationQueue.update()` call commented out with `// TODO: Story 4.2 — re-enable when animation consumer exists`
- Case labels kept as no-op

### AC-6: Null normalization (Low — L1)
- MSG_DRAW and MSG_SHUFFLE_HAND opponent sanitization uses `null` instead of `0`
- `DrawMsg.cards` and `ShuffleHandMsg.cards` typed as `(number | null)[]`
- Protocol changes mirrored in `duel-ws.types.ts`

### AC-7: HintContext AC documentation (Medium — M1)
- Story 1.4 document updated: `HintContext` fields corrected from `{ cardCode, hintType, hintData }` to `{ hintType, player, value }`

## Dev Notes

### Implementation Order
1. C1 + L1 (message-filter.ts + protocol types)
2. C2 (duel-worker.ts + protocol types for RPS)
3. C3 (reconnection — protocol, server, client)
4. H1 + H3 (client-only fixes)
5. M1 (documentation)

### Files Modified
- `duel-server/src/message-filter.ts` — C1, L1, C3
- `duel-server/src/ws-protocol.ts` — L1, C2, C3
- `duel-server/src/duel-worker.ts` — C2
- `duel-server/src/server.ts` — C2, C3
- `duel-server/src/types.ts` — C3
- `front/src/app/pages/pvp/duel-ws.types.ts` — L1, C2, C3
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — C3, H1, H3
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — H1
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts` — H1
- `_bmad-output/implementation-artifacts/1-4-spring-boot-deck-relay-angular-websocket-connection.md` — M1
