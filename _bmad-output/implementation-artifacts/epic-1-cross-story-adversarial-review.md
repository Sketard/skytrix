# Epic 1 PvP — Cross-Story Adversarial Review

**Date:** 2026-02-27
**Scope:** Stories 1.2 through 1.7 — cross-story coherence
**Reviewer:** Claude Opus 4.6 (adversarial-general)
**Verdict:** 12 findings (3 Critical, 3 High, 4 Medium, 2 Low)

---

## Critical

### C1. `players[0]` is NOT always "self" — client assumption contradicts server implementation

**Stories involved:** 1.3 (server filter), 1.5 (board display), 1.6 (prompts), 1.7 (turn actions)

Story 1.5 Dev Notes state: "`duelState().players[0]` = the LOCAL player (self), `duelState().players[1]` = the OPPONENT. The duel server filters and orients BOARD_STATE per-player before sending." Stories 1.6 and 1.7 rely on this convention throughout (e.g., `duelState().turnPlayer === 0` means own turn).

**However**, the actual `sanitizeBoardState()` in `message-filter.ts` (Story 1.3) does NOT swap the array — it sanitizes private info but preserves OCGCore's original `players[0]` = OCGCore player 0, `players[1]` = OCGCore player 1 for BOTH recipients. Player 1 would receive their own data at index 1, not index 0.

Every component that uses `players[0]` as "self" (board container, hand rows, LP badges, phase badge own-turn check, activation toggle visibility) is **broken for Player 2**.

**Fix options:**
- (A) Server-side: swap `players[]` array in `sanitizeBoardState()` so `players[0]` is always the recipient
- (B) Client-side: pass `playerIndex` from Spring Boot room response, use it to index into `players[]`

---

### C2. RPS auto-responded by worker — `PromptRpsComponent` is dead code

**Stories involved:** 1.3 (duel worker), 1.6 (prompt RPS UI)

Story 1.6 (AC #7, Task 9) builds `PromptRpsComponent` — a full RPS UI with 30s timeout, keyboard shortcuts, icons, and turn-order selection. Story 1.3's `duel-worker.ts` auto-responds to OCGCore's RPS prompt with `Math.floor(Math.random() * 3)` and never forwards `RPS_CHOICE` to the client.

The RPS component will never render. Story 1.3 also added `RPS_CHOICE` to the message filter whitelist (routed to `message.player` only), contradicting the worker's auto-respond behavior. One of these two implementations is wrong.

**Fix options:**
- (A) Remove auto-respond from worker, forward RPS as `RPS_CHOICE` to clients via `parentPort.postMessage`
- (B) Delete `PromptRpsComponent` and accept server-side random RPS (simpler, but removes player agency)

---

### C3. WebSocket reconnection is impossible after successful connection

**Stories involved:** 1.3 (token lifecycle), 1.4 (reconnection logic)

Story 1.4 (AC #3) specifies reconnection with exponential backoff (2s/4s/8s, max 3 attempts) and `connectionStatus` transitions (`connected → reconnecting → lost`). Story 1.3 deletes the one-time token from `pendingTokens` on first successful WebSocket association.

The client's `wasEverConnected` guard correctly prevents reconnection attempts after `onopen` fires (since the token is consumed), but this means any network interruption after initial connection results in **permanent disconnection** — no reconnect, no `STATE_SYNC`, nothing. The entire reconnection signal flow and `STATE_SYNC` handling (Story 1.4 Task 10.7) are unreachable post-connection.

No story in Epic 1 provides an alternative reconnection mechanism (e.g., session-based token refresh, duel server issuing a reconnection token on first connect).

---

## High

### H1. Room lifecycle leaks — no story calls `POST /rooms/:id/end` after DUEL_END

**Stories involved:** 1.4 (room service + endRoom endpoint), 1.7 (duel end handling)

Story 1.4 creates `endRoom()` on the backend and says it's "called by Angular after DUEL_END." The `DUEL_END` handler in `DuelWebSocketService` (Story 1.4 Task 10.4) clears `pendingPrompt` and stores the result — but never calls any HTTP endpoint. Story 1.7 doesn't add this either.

Rooms stay in `ACTIVE` status indefinitely throughout Epic 1. The `RoomCleanupScheduler` only cleans `WAITING` rooms (30min TTL). The ACTIVE room health-check (60s) only transitions to `ENDED` when the duel server is completely unreachable — not when a specific duel ends normally. Normal duel endings leave permanent ghost rows in the database.

**Fix:** Add `httpClient.post('/rooms/:id/end')` call in `DuelWebSocketService` on `DUEL_END` receipt, or defer explicitly to Story 3.4 with a documented gap.

---

### H2. CardInspector shows placeholder "Card #XXXX" — players cannot read card effects

**Stories involved:** 1.5 (card rendering), 1.7 (inspector wrapper)

Story 1.7's `PvpCardInspectorWrapperComponent` maps `CardOnField.cardCode` to a `SharedCardInspectorData` object, but there is no PvP card data service to resolve card codes to names, types, effects, ATK/DEF. The completion notes admit: "Card inspector shows Card #XXXX placeholder name + card art image — full card name lookup requires a card data service not yet available in PvP context."

No subsequent story in Epic 1 addresses this. Reading card effects is fundamental to playing Yu-Gi-Oh! — a player facing an unfamiliar card has no way to understand what it does.

**Fix:** Create a `PvpCardDataService` that resolves `cardCode → card details` (either via Spring Boot REST lookup or a client-side card database loaded at duel init).

---

### H3. `animationQueue` signal grows unbounded — memory leak

**Stories involved:** 1.4 (signal definition + population), 1.5/1.6/1.7 (no consumption)

Story 1.4 defines `animationQueue: Signal<GameEvent[]>` and appends every animation-triggering `MSG_*` via `update(q => [...q, message])`. Stories 1.5, 1.6, and 1.7 never consume, dequeue, or clear this array. Animation playback is deferred to Story 4.2.

Throughout Epic 1, every draw, move, damage, attack, chain, and battle event accumulates in memory with zero consumption. In a 50-turn duel, this could reach thousands of entries — each a full `ServerMessage` object.

**Fix options:**
- (A) Drop animation events until Story 4.2 is implemented (don't push to queue)
- (B) Add a max queue size with oldest-first eviction
- (C) Document the leak as acceptable for MVP and fix in Story 4.2

---

## Medium

### M1. `HintContext` type definition diverges from AC specification

**Stories involved:** 1.4 (AC defines fields), 1.6 (uses actual fields)

Story 1.4 AC #2 specifies `HintContext = { cardCode: 0, hintType: 0, hintData: 0 }` and the initial signal value uses these field names. The actual implementation uses `{ hintType: number, player: number, value: number }` (matching the real `MsgHint` protocol type).

Story 1.6 references the correct fields (`hintContext.value` for card code lookup), so the code works — but the AC in Story 1.4 is factually wrong and would fail any literal AC verification. A developer reading Story 1.4's AC would implement the wrong interface.

**Fix:** Update Story 1.4 AC #2 to match the actual `HintContext` interface.

---

### M2. `MSG_CONFIRM_CARDS` has no client-side UI handler

**Stories involved:** 1.3 (filter routes to player), 1.4 (no handler), 1.6 (not in prompt mapping)

Story 1.3's message filter routes `MSG_CONFIRM_CARDS` to `message.player` only (AC #4). The Angular client receives it but has no dedicated handler — it falls through to `console.log` in `DuelWebSocketService.handleMessage()`.

`MSG_CONFIRM_CARDS` is sent by OCGCore when a player needs to confirm revealed cards (e.g., after excavating from deck). Without a UI, the player sees nothing — cards that should be shown for confirmation are silently logged. No story in Epic 1 addresses this, and it's not listed in the auto-select fallback set either.

**Fix:** Add a visual handler (e.g., a brief toast/overlay showing confirmed cards) or document as known gap.

---

### M3. `TIMER_STATE` never generated — timer badge shows "--:--" permanently

**Stories involved:** 1.3 (defers timer generation), 1.5 (timer badge UI)

Story 1.5 creates `PvpTimerBadgeComponent` with MM:SS formatting, color thresholds (green/yellow/red), and active/inactive dimming. Story 1.3 says `TIMER_STATE` is "generated by main thread timer logic (deferred to later story)."

No story in Epic 1 generates `TIMER_STATE` messages. The timer badge will display "--:--" for the entire Epic 1 lifecycle. The badge occupies central strip real estate, has color logic that never triggers, and is visually confusing — a frozen timer implies either a bug or no time limit.

**Impact:** Cosmetic. Story 3.2 is supposed to add timer logic. Consider hiding the badge entirely until then, or displaying "No timer" instead of "--:--".

---

### M4. DuelPageComponent has become a God Component by Story 1.7

**Stories involved:** 1.4 → 1.5 → 1.6 → 1.7 (cumulative growth)

Across Stories 1.4→1.7, `DuelPageComponent` accumulates:
- ~20 signals/computed values
- Inline Card Action Menu `<div>` template with `getBoundingClientRect()` positioning logic
- Inline mini-toolbar template
- IDLECMD/BATTLECMD routing orchestration
- Zone browser open/close logic
- Card inspector open/close logic
- Activation toggle filter logic (`shouldAutoRespond`)
- Zone highlight signals for Pattern A prompts
- Orientation detection + fullscreen API
- Connection overlay
- Prompt sheet wiring
- Event handlers for 8+ child component outputs

No story acknowledges the growing complexity or proposes extraction. By Epic 2-3, this component will be unmaintainable.

**Fix:** Extract orchestration logic into a `DuelOrchestratorService` or split into sub-orchestrators (prompt orchestration, action orchestration, UI state orchestration).

---

## Low

### L1. `cardCode` sanitization uses both `0` and `null` inconsistently across filter rules

**Stories involved:** 1.2 (protocol rule), 1.3 (filter implementation), 1.5 (client handling)

Story 1.2's protocol rule states: "Absent optional values use explicit `null` (never field omission)." Story 1.3's message filter uses `0` for `MSG_DRAW` and `MSG_SHUFFLE_HAND` card code sanitization, but `null` for `BOARD_STATE` face-down cards and opponent hand.

The client-side code in Story 1.5 (`pvp-card.utils.ts`) checks both `=== null` and `=== 0` — a workaround for this inconsistency. The protocol's own rule is violated by the server, forcing the client to handle two sentinel values for the same semantic concept ("hidden card").

---

### L2. `ws-protocol.ts` ↔ `duel-ws.types.ts` manual copy has no enforcement mechanism

**Stories involved:** 1.2 (establishes copy rule), all subsequent stories

Story 1.2 establishes a "same-commit update rule" via a comment header. No CI check, no hash comparison, no build-time validation exists across Stories 1.2–1.7 to verify the two files remain in sync.

The protocol is declared "frozen," but any future modification risks silent divergence. A type mismatch between server and client would manifest as runtime `undefined` field access — not a compile error.

**Fix options:**
- (A) Add a CI step comparing file hashes
- (B) Publish as a shared npm package consumed by both projects
- (C) Accept the risk for MVP (protocol is frozen, changes are unlikely)
