# Implementation Readiness Assessment Report

**Date:** 2026-02-25
**Project:** skytrix (PvP Online Duels)

---
stepsCompleted: [step-01-document-discovery, step-02-prd-analysis, step-03-epic-coverage-validation, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
documents:
  prd: prd-pvp.md
  architecture: architecture-pvp.md
  epics: epics-pvp.md
  ux: ux-design-specification-pvp.md
  supplementary: ocgcore-technical-reference.md
---

## 1. Document Inventory

| Document Type | File | Size |
|---|---|---|
| PRD | prd-pvp.md | 272 lines, 21 KB |
| Architecture | architecture-pvp.md | 842 lines, 61 KB |
| Epics & Stories | epics-pvp.md | 847 lines, 61 KB |
| UX Design Spec | ux-design-specification-pvp.md | 1920 lines, 148 KB |
| Technical Reference | ocgcore-technical-reference.md | 625 lines, 26 KB |

**Duplicates:** None
**Missing:** None

## 2. PRD Analysis

### Functional Requirements (25 total)

#### Matchmaking & Session (FR1–FR7)
- **FR1:** The player can create a PvP duel room from any valid decklist; the room appears in a lobby visible to other authenticated players
- **FR2:** The system validates the deck before creating or joining a room (TCG format, TCG banlist compliance, deck size constraints: 40-60 main deck, 0-15 extra deck, 0-15 side deck)
- **FR3:** The player can browse available duel rooms and join one with a valid decklist
- **FR4:** The system starts the duel automatically when two players have joined the same room: both players play Rock-Paper-Scissors (30-second timeout, random selection on timeout) to determine who chooses to go first or second, then the duel begins with automatic hand distribution (5 cards each)
- **FR5:** The player can surrender during a PvP duel at any point
- **FR6:** The system handles player disconnection with a 60-second reconnection grace period
- **FR7:** The system declares a winner when: opponent's LP reaches 0, opponent surrenders, opponent's deck is empty and a draw is required, or opponent exceeds the reconnection timeout. The system declares a draw when both players' LP reach 0 simultaneously or other draw conditions are met per duel engine rules

#### Turn & Phase Management (FR8–FR10)
- **FR8:** The system manages turn structure automatically (Draw Phase, Standby Phase, Main Phase 1, Battle Phase, Main Phase 2, End Phase)
- **FR9:** The player can perform Main Phase actions by clicking a card to open a contextual action menu listing available actions (normal summon, set, activate, special summon, change position). Phase-level actions (enter Battle Phase, end turn) are available via persistent UI controls
- **FR10:** The player can perform Battle Phase actions by clicking a monster to open a contextual attack menu (declare attack target). Phase-level actions (activate quick effect, enter Main Phase 2, end turn) are available via persistent UI controls

#### Player Prompts & Engine Delegation (FR11–FR13)
- **FR11:** The player can respond to effect activation prompts via modal dialogs: confirm activation (yes/no), select card(s) from a presented list, choose a zone on the field via highlighted selection, select a monster position (ATK/DEF/face-down), declare a card attribute or monster type, declare a number
- **FR12:** The system delegates chain resolution to the duel engine, which resolves chains automatically following official Yu-Gi-Oh! rules (SEGOC, LIFO resolution, timing)
- **FR13:** The system delegates all game rule enforcement to the duel engine: summoning conditions, effect timing windows, damage calculation, zone restrictions, Extra Monster Zone access (Master Rule 5)

#### Board Display & Information (FR14–FR25)
- **FR14:** The system displays both players' fields: own field in full detail, opponent's face-up cards visible, opponent's face-down cards shown as card backs
- **FR15:** The system hides opponent's private information: hand contents (card count visible, not identity), deck order, face-down card identities, extra deck contents
- **FR16:** The system displays life points for both players, updated in real-time after damage or LP changes
- **FR17:** The system displays the current chain of effects being resolved, showing each chain link's card and effect
- **FR18:** The player can view card details for any face-up card on the field or in any public zone (graveyard, banished)
- **FR19:** The system provides a visual indicator when it is the player's turn to act and what type of response is expected
- **FR20:** The system enforces a turn timer with a cumulative time pool: 300 seconds initially, +40 seconds added to the remaining pool at the start of each subsequent turn. The timer counts down only during the active player's decision windows and pauses during chain resolution and opponent's actions
- **FR21:** The system enforces an inactivity timeout: if a player performs no action for 100 seconds when a response is required, the system automatically forfeits the match
- **FR22:** The system provides at least one visual feedback per game event in PvP (summon, destroy, activate, flip, LP change, chain link addition/resolution). Minimum: card movement animation + brief highlight. Visual style inspired by Yu-Gi-Oh! Master Duel
- **FR23:** PvP interaction is click-based (respond to engine prompts by selecting from presented options) — not drag & drop. This is a distinct interaction paradigm from solo mode
- **FR24:** The system displays a duel result screen at the end of a PvP duel showing: outcome (victory, defeat, or draw) and reason (opponent LP reduced to 0, opponent surrendered, opponent timed out, opponent disconnected, draw by simultaneous LP depletion)
- **FR25:** The system provides a client-side activation toggle (Auto/On/Off) that filters how the client handles optional effect activation prompts received from the engine. Auto (default): prompt only in reaction to game events. On: prompt at every legal priority window. Off: auto-respond "No"/"Pass" to all optional prompts. Per-duel, resets to Auto at duel start, does not affect mandatory prompts

### Non-Functional Requirements (10 total)

#### Network & Latency (NFR1–NFR2)
- **NFR1:** PvP duel actions complete within 500ms under normal network conditions
- **NFR2:** The WebSocket connection remains stable for the full duration of a duel (up to 60 minutes) with automatic heartbeat/keep-alive

#### Scalability (NFR3)
- **NFR3:** The duel server supports at least 50 concurrent duels without degradation in response time

#### Reliability (NFR4–NFR5)
- **NFR4:** A disconnected player can reconnect to an active duel within 60 seconds without losing game state
- **NFR5:** If both players disconnect, the duel state is preserved server-side for up to 4 hours before automatic cleanup

#### Security (NFR6–NFR8)
- **NFR6:** The duel server is the sole authority for game state — the client receives only information the active player is authorized to see
- **NFR7:** All player responses are validated by the duel engine — invalid responses are rejected without corrupting game state
- **NFR8:** PvP routes and WebSocket connections are protected by existing JWT authentication

#### Compatibility (NFR9)
- **NFR9:** PvP mode functions on modern desktop and mobile browsers (latest two versions). Landscape lock on mobile

#### Licensing (NFR10)
- **NFR10:** The duel server's usage of OCGCore complies with AGPL-3.0 license requirements

### Additional Requirements & Constraints
- **Anti-Cheat Principle:** Frontend never sends decklists directly to the Duel Server. Spring Boot validates and relays server-to-server
- **Board Layout:** Reuses solo simulator board zone components with fixed aspect ratio (1060x772), proportional scaling. Mobile: landscape-locked
- **Dependencies:** `@n1xx1/ocgcore-wasm`, `better-sqlite3`, `ws`/`socket.io`, ProjectIgnis/CardScripts, ProjectIgnis/BabelCDB
- **Banlist Management:** TCG banlist data stored in database, updated manually, ~4 updates/year
- **Visual Reference:** Yu-Gi-Oh! Master Duel for aesthetics and interaction model
- **Phased Delivery:** PvP-A (Core Duel), PvP-B (Session Management), PvP-C (Visual Polish)

### PRD Completeness Assessment
- PRD is well-structured with clear FR/NFR numbering (FR1-FR25, NFR1-NFR10)
- Success criteria are measurable and specific
- User journeys map clearly to functional requirements
- Phased delivery strategy (A/B/C) provides natural stopping points
- Risk mitigations are documented with concrete evidence (PoC validated)
- Cross-reference table to solo PRD maintained for traceability

## 3. Epic Coverage Validation

### Epic Structure

| Epic | Name | Stories |
|---|---|---|
| Epic 1 | Core Online Duel | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 |
| Epic 2 | Lobby & Matchmaking | 2.1, 2.2, 2.3, 2.4 |
| Epic 3 | Session Resilience & Duel Lifecycle | 3.1, 3.2, 3.3, 3.4 |
| Epic 4 | Visual Polish & Chain Visualization | 4.1, 4.2 |

**Total:** 4 epics, 17 stories

### FR Coverage Matrix

| FR | PRD Requirement (summary) | Epic / Story Coverage | Status |
|---|---|---|---|
| FR1 | Create PvP duel room from decklist | Epic 2 / Story 2.1 | ✓ Covered |
| FR2 | Deck validation (TCG format, banlist, size) | Epic 2 / Story 2.1 + 2.2 | ✓ Covered |
| FR3 | Browse and join duel rooms | Epic 2 / Story 2.2 | ✓ Covered |
| FR4 | Auto-start duel (RPS, hand distribution) | Epic 2 / Story 2.3 | ✓ Covered |
| FR5 | Surrender at any point | Epic 3 / Story 3.1 | ✓ Covered |
| FR6 | Disconnection handling (60s grace) | Epic 3 / Story 3.3 | ✓ Covered |
| FR7 | Win/draw detection (LP 0, surrender, deck-out, timeout, disconnect) | Epic 3 / Stories 3.1 + 3.2 + 3.3 + 3.4 | ✓ Covered |
| FR8 | Automatic turn structure (DP, SP, MP1, BP, MP2, EP) | Epic 1 / Story 1.3 + 1.7 | ✓ Covered |
| FR9 | Main Phase actions via contextual action menu | Epic 1 / Story 1.7 | ✓ Covered |
| FR10 | Battle Phase actions via contextual attack menu | Epic 1 / Story 1.7 | ✓ Covered |
| FR11 | Player prompts (yes/no, select cards, choose zone, etc.) | Epic 1 / Story 1.6 | ✓ Covered |
| FR12 | Engine-delegated chain resolution | Epic 1 / Story 1.3 | ✓ Covered |
| FR13 | Engine-delegated game rule enforcement | Epic 1 / Story 1.3 | ✓ Covered |
| FR14 | Two-player board display | Epic 1 / Story 1.5 | ✓ Covered |
| FR15 | Hide opponent private information | Epic 1 / Story 1.3 (message filter) | ✓ Covered |
| FR16 | Life point display for both players | Epic 1 / Story 1.5 (PvpLpBadge) | ✓ Covered |
| FR17 | Chain visualization | Epic 4 / Story 4.1 | ✓ Covered |
| FR18 | Card detail inspection (face-up / public zones) | Epic 1 / Story 1.7 (CardInspector PvP) | ✓ Covered |
| FR19 | Turn/response indicator | Epic 1 / Story 1.7 (PvpPhaseBadge) | ✓ Covered |
| FR20 | Turn timer (300s pool + 40s/turn) | Epic 3 / Story 3.2 | ✓ Covered |
| FR21 | Inactivity timeout (100s forfeit) | Epic 3 / Story 3.2 | ✓ Covered |
| FR22 | Visual feedback per game event | Epic 4 / Story 4.2 | ✓ Covered |
| FR23 | Click-based interaction (not drag & drop) | Epic 1 / Story 1.6 + 1.7 | ✓ Covered |
| FR24 | Duel result screen | Epic 3 / Story 3.4 | ✓ Covered |
| FR25 | Client-side activation toggle (Auto/On/Off) | Epic 1 / Story 1.7 (PvpActivationToggle) | ✓ Covered |

### NFR Coverage Matrix

| NFR | Requirement (summary) | Epic / Story Coverage | Status |
|---|---|---|---|
| NFR1 | <500ms round-trip | Epic 1 / Stories 1.2 + 1.3 + 1.4 | ✓ Covered |
| NFR2 | WebSocket stable 60 min | Epic 1 / Story 1.4 + Epic 3 / Story 3.3 | ✓ Covered |
| NFR3 | 50 concurrent duels | Epic 1 / Story 1.2 + 1.3 (worker threads) | ✓ Covered |
| NFR4 | 60s reconnection | Epic 3 / Story 3.3 | ✓ Covered |
| NFR5 | 4h state preservation | Epic 3 / Story 3.3 | ✓ Covered |
| NFR6 | Server authority / anti-cheat | Epic 1 / Story 1.3 (message filter) | ✓ Covered |
| NFR7 | Response validation | Epic 1 / Story 1.3 | ✓ Covered |
| NFR8 | JWT authentication | Epic 1 / Story 1.4 + Epic 2 / Stories 2.1 + 2.2 | ✓ Covered |
| NFR9 | Browser compatibility + landscape lock | Epic 1 / Story 1.5 | ✓ Covered |
| NFR10 | AGPL-3.0 compliance | Epic 1 / Story 1.2 | ✓ Covered |

### Missing Requirements

**None.** All 25 FRs and all 10 NFRs have traceable coverage in the epic breakdown.

### Coverage Statistics

- Total PRD FRs: **25**
- FRs covered in epics: **25**
- FR coverage: **100%**
- Total PRD NFRs: **10**
- NFRs covered in epics: **10**
- NFR coverage: **100%**

## 4. UX Alignment Assessment

### UX Document Status

**Found:** `ux-design-specification-pvp.md` (1920 lines, 148 KB) — comprehensive UX specification

### UX ↔ PRD Alignment

| # | Issue | Severity | Notes |
|---|---|---|---|
| U1 | FR11: PRD says "modal dialogs" for prompts; UX spec uses bottom-sheet overlays (non-blocking) | Low | UX takes precedence per workflow. Better design choice — board remains visible during decisions |
| U2 | NFR9: PRD says Chrome/Firefox/Edge/Safari; UX spec narrows to Chrome+Safari only for MVP | Low | Acceptable MVP scope reduction. Firefox/Edge support implicit via standards compliance |
| U3 | FR9/FR10: PRD says "persistent UI controls"; UX uses collapsible circular badge (PvpPhaseBadge) | Info | Valid interpretation — controls are accessible, just collapsed by default |
| U4 | FR19: "what type of response is expected" handled implicitly by prompt pattern rather than explicit indicator | Info | Sufficient for MVP — the prompt itself communicates the expected response |

**UX Additions Beyond PRD (not in PRD but specified in UX):**
1. Rematch flow (Journey 4, PvpDuelResultOverlayComponent) — significant addition
2. "Back to Deck" button on result screen — enhances build→test→duel loop
3. Single tab enforcement (BroadcastChannel/localStorage)
4. In-prompt card inspection via long press (mobile, 500ms)
5. Double-tap pattern for overlapped hand cards
6. Duel loading screen with card image pre-fetch
7. App background recovery (visibilitychange + snackbar)
8. Fullscreen API + orientation lock at duel init
9. High contrast mode support (forced-colors media query)

### UX ↔ Architecture Alignment

| # | Issue | Severity | Notes |
|---|---|---|---|
| A1 | **MSG_DECK_LIST doesn't exist** — UX spec references this message for card pre-fetching; neither OCGCore nor architecture defines it | HIGH | Need alternative mechanism (e.g., deck card IDs via Spring Boot REST at room join) |
| A2 | **Rematch flow has no WebSocket protocol support** — UX defines full rematch flow but no REMATCH_REQUEST/REMATCH_RESPONSE messages exist in architecture | HIGH | Need protocol messages + server logic + OCGCore worker lifecycle |
| A3 | **RPS WebSocket messages not formally defined** — architecture chose server-managed RPS but RPS_CHOICE/RPS_RESULT not in protocol definition | MEDIUM | Messages are referenced in tech ref but not formalized in architecture's ws-protocol.ts |
| A4 | **Prompt component count mismatch** — architecture says 3 files (card-select, zone-select, choice); UX spec defines 6 sub-components with distinct behaviors | MEDIUM | UX spec is more detailed and should take precedence. Architecture needs update |
| A5 | **SORT_CHAIN and SORT_CARD prompts have no UX mapping** — real OCGCore prompts with no sub-component | MEDIUM | Uncommon but real (Sylvan excavation, simultaneous optional triggers). MVP: auto-select fallback |
| A6 | **ANNOUNCE_CARD has no viable UI** — declaring a card name from 13,000+ cards with "free input" is unusable | MEDIUM | Needs autocomplete/search design. MVP: auto-select fallback acceptable |
| A7 | **Timer model underspecified in architecture** — UX says "300s pool + 40s/turn" but architecture never specifies the parameters | LOW | Parameters are in UX spec and PRD (FR20). Implementer needs to check UX spec |
| A8 | **Animation queue may be insufficient** — architecture's simple FIFO Signal<GameEvent[]> vs UX's choreography requirements (sequential chains, inter-link gaps, parallel LP+phase) | LOW | Implementation detail — can be refined during Epic 4 |
| A9 | **"Choose first/second" prompt after RPS** — no UX component explicitly mapped for this interaction | LOW | Can use PromptYesNoComponent or PromptOptionListComponent |
| A10 | **OCGCore WAITING message (ID 3) routing** — should be forwarded to non-deciding player as "Waiting..." but not in architecture protocol | LOW | Easy to add during implementation |

### Architecture ↔ OCGCore Technical Reference Alignment

| # | Issue | Severity | Notes |
|---|---|---|---|
| T1 | **FR25 missing from architecture FR tracking** — architecture says "24/24 FRs" but PRD has 25 | MEDIUM | Toggle is discussed in architecture cross-cutting concerns but not formally tracked |
| T2 | **Architecture says "OCGCore DUEL_END"** — OCGCore produces MSG_WIN (ID 5), not DUEL_END | LOW | DUEL_END is a valid server-translated wrapper, but naming is misleading in the FR→file table |
| T3 | **Reconnection query underspecified** — architecture uses minimal flags; tech ref shows ~14 flags needed for complete snapshot | HIGH | Missing OVERLAY_CARD, COUNTERS, TYPE, LEVEL, RANK, ATTRIBUTE, RACE, LSCALE, RSCALE, LINK data |
| T4 | **Architecture doesn't handle RELOAD_FIELD (ID 162)** — the tech ref documents this message but architecture ignores it | LOW | May simplify reconnection if produced automatically. Needs investigation |
| T5 | **SELECT_CARD_CODES response (type 6)** — alternative response format not acknowledged in architecture | LOW | If OCGCore expects this format in some cases, response handling could break |
| T6 | **Server-managed RPS means ROCK_PAPER_SCISSORS/HAND_RES OCGCore messages never produced** — architecture should note these as unexpected/dropped | Info | Defensive coding recommendation |

**Gaps Filled by OCGCore Technical Reference:**
1. Complete response format for all 21 prompt types (section 7) — essential for ws-protocol.ts
2. Additional anti-cheat filter rules: CONFIRM_DECKTOP, CONFIRM_EXTRATOP, DECK_TOP (route to player only), WAITING (route to non-deciding player)
3. Startup Lua scripts list (20 exact filenames, section 5) — critical for duel server initialization
4. OcgFieldState structure for reconnection (section 8) — exact shape with nested types
5. OcgQueryFlags bitmask values (section 8) — needed for query construction
6. Phase constants (section 10) and Location constants (section 11) — needed for implementation
7. ~30 additional state update message types not explicitly listed in architecture — need filter rules

### Cross-Cutting Issues

**Contradictions:**
1. FR count: architecture (24) vs PRD (25) — FR25 missing from formal tracking
2. "Modal dialogs" (PRD FR11) vs "bottom-sheet overlays" (UX) — UX takes precedence
3. NFR9 browser scope: PRD (4 browsers) vs UX (Chrome+Safari only)
4. Prompt components: architecture (3 files) vs UX (6 sub-components)

**Missing Specifications (developer would need):**
1. WebSocket DTO structures for: TIMER_UPDATE, GAME_STATE, RPS_CHOICE, RPS_RESULT, REMATCH_REQUEST, REMATCH_RESPONSE, OPPONENT_DISCONNECTED
2. SORT_CARD / SORT_CHAIN prompt UI component
3. ANNOUNCE_CARD search/autocomplete UI
4. Auto-select fallback behavior per unimplemented prompt type
5. OCGCore error notification message type + UX for "engine error" result
6. Room code generation algorithm (4-6 char, character set, collision handling)
7. Deep link format mismatch: UX says `skytrix.app/pvp/XXXX` vs architecture route `/pvp/duel/:roomId`
8. Card image pre-fetch mechanism (MSG_DECK_LIST doesn't exist)
9. Player 0/1 identity mapping (authenticated user → OCGCore team index)

## 5. Epic Quality Review

### Epic-Level Assessment

| Epic | User Value | Independence | Verdict |
|---|---|---|---|
| Epic 1: Core Online Duel | FAIL — heavily infrastructure-weighted (Stories 1.1-1.4 are dev-only). User value only in 1.5-1.7 | FAIL — no user can play a duel via Epic 1 alone. No room creation, no lobby, no RPS, no entry point | Needs restructuring |
| Epic 2: Lobby & Matchmaking | PASS — clear user outcome: find and start a duel | PASS — depends correctly on Epic 1 output | Clean |
| Epic 3: Session Resilience & Duel Lifecycle | PASS — every story delivers visible user value | PASS — depends on Epics 1+2, no forward deps | Clean |
| Epic 4: Visual Polish & Chain Visualization | PASS — user-visible quality improvements | PASS — depends on Epics 1-3, no forward deps | Clean |

### Violations by Severity

#### CRITICAL

| # | Violation | Recommendation |
|---|---|---|
| C1 | **Epic 1 is not independently usable.** No entry point for users — no room creation, no RPS, no way to start a duel via UI. "User can benefit from this epic alone" fails | Either merge minimal room creation + RPS into Epic 1, or honestly rename it "Duel Engine Infrastructure & Board UI" as a technical foundation epic |
| C2 | **Story 1.4 creates Room entity + Flyway migration + RoomService in Epic 1**, but room CRUD UI is in Epic 2. Database schema created 1 full epic before users can use it | Move Room entity, Flyway migration, RoomController, RoomService to Epic 2 Story 2.1. Story 1.4 focuses on duel server HTTP API + Angular WebSocket only |
| C3 | **6 stories are severely oversized**: 1.2 (scaffold+protocol+Docker), 1.3 (OCGCore+filter+HTTP), 1.4 (Spring Boot+Angular), 1.6 (shell+6 sub-components), 1.7 (distributed UI+4 components), 3.3 (server+client+edge cases) | Split each into 2-4 smaller independently deliverable stories. Target: max 2-3 files or 1 system boundary per story |

#### MAJOR

| # | Violation | Recommendation |
|---|---|---|
| M1 | **Stories 1.1 and 1.2 are developer stories** with no user value ("As a developer, I want a scaffold") | Label as "Technical Story / Enabler" or fold 1.1 into 1.5 and 1.2's protocol into 1.3 |
| M2 | **Story 2.4 AC "pre-fetches card thumbnails for both decks"** — potential NFR6 violation. Opponent decklist is private; knowing which cards to pre-fetch leaks deck contents | Clarify: pre-fetch for own deck only. Opponent thumbnails fetched on-demand as cards become visible |
| M3 | **ACs throughout are implementation-prescriptive** rather than outcome-based. Examples: exact file paths, Angular decorators, Dockerfile instructions, UUID code, CSS properties, signal types | Move implementation details to Technical Design section. Rewrite ACs as testable outcomes |
| M4 | **`animationQueue` signal created in Story 1.4 but not consumed until Story 4.2** — dead code for Epics 1-3 | Define signal interface in 1.4, defer queue implementation (push logic, event classification) to 4.2 |

#### MINOR

| # | Violation | Recommendation |
|---|---|---|
| m1 | Story 1.5 AC references prompt sheet behavior from Story 1.6 (untestable if delivered first) | Move that AC to Story 1.6 or 1.7 |
| m2 | Story 3.2 doesn't specify client-side timer behavior when TIMER_STATE messages are delayed | Add AC: "Client maintains local countdown interpolation between server messages" |
| m3 | Story 2.1 "Duel PvP" button — no AC for adding button to existing decklist page (brownfield gap) | Add explicit AC for button placement in existing DecklistDetailComponent |
| m4 | Story 2.2 has no room list refresh mechanism (polling/refresh button) | Add AC for polling interval or manual refresh |
| m5 | Room code collision risk — no AC for collision handling | Add: "If generated code exists, regenerate (max 3 attempts)" |
| m6 | Story 3.4 introduces server-side session state (decklist retention) not mentioned in 1.2/1.3 | Document this state in Story 1.3 (duel lifecycle) for early visibility |
| m7 | FR17 (chain viz) and FR22 (visual feedback) deferred to Epic 4 — board is completely static for Epics 1-3 | Acknowledge explicitly: board updates "teleport" until Epic 4 |

### Dependency Map (Critical Path)

```
1.1 ──┐
1.2 ──┤
1.3 ←─┘ (depends on 1.2)
1.4 ← (depends on 1.2, 1.3)
      ├── 1.5 ← (depends on 1.1, 1.4) ──┐
      └── 1.6 ← (depends on 1.4) ────────┤
                                          ├── 1.7
                                          │
Epic 2: 2.1 ← 2.2 ← 2.3 ← 2.4          │
         ↑              ↑                │
         └── 1.4 (Room) └── 1.6 (RPS)───┘

Epic 3: 3.1 ← 1.7 (toolbar)
        3.2 ← 1.5 (timer badge)
        3.3 ← 1.4 (WebSocket)
        3.4 ← 3.1, 3.2, 3.3

Epic 4: 4.1 ← 1.5 (board zones)
        4.2 ← 1.4 (animationQueue signal)
```

**Critical path:** 1.2 → 1.3 → 1.4 → 1.5/1.6 (parallel) → 1.7 → 2.1 → 2.3 → Epic 3 → Epic 4

### Quality Statistics

| Metric | Value |
|---|---|
| Total epics | 4 |
| Total stories | 17 |
| Critical violations | 3 |
| Major violations | 4 |
| Minor violations | 7 |
| Oversized stories | 6 (1.2, 1.3, 1.4, 1.6, 1.7, 3.3) |
| Developer stories (no user value) | 2 (1.1, 1.2) |
| Brownfield integration gaps | 2 |

## 6. Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK** — The planning artifacts are comprehensive and well-aligned at the requirements level (100% FR/NFR coverage), but structural issues in the epic breakdown and cross-document specification gaps must be addressed before implementation can proceed efficiently.

### Issue Summary

| Category | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| UX ↔ PRD Alignment | 0 | 0 | 0 | 2 | 2 |
| UX ↔ Architecture Alignment | 2 | 1 | 2 | 4 | 1 |
| Architecture ↔ OCGCore Tech Ref | 0 | 1 | 1 | 3 | 1 |
| Cross-Cutting Specs | 0 | 0 | 0 | 0 | 9 missing specs |
| Epic Quality | 3 | 4 | 7 | — | — |
| **Total** | **5** | **6** | **10** | **9** | **13** |

### Critical Issues Requiring Immediate Action

1. **Epic 1 not independently usable + Room entity misplaced.** The core structural problem: Epic 1 bundles infrastructure with UI but provides no user entry point. Room entity is created too early. This must be resolved before sprint planning.

2. **6 oversized stories (1.2, 1.3, 1.4, 1.6, 1.7, 3.3)** spanning multiple systems and 3-7 files each. These cannot be reliably estimated, reviewed, or completed in predictable increments. Split before implementation.

3. **MSG_DECK_LIST doesn't exist** — The UX spec references a message type for card image pre-fetching that neither OCGCore nor the architecture defines. Need an alternative mechanism.

4. **Rematch flow has no WebSocket protocol** — A significant UX feature (Story 3.4) with zero architectural protocol support. Need REMATCH_REQUEST/REMATCH_RESPONSE message definitions.

5. **Reconnection query underspecified** — Architecture uses minimal query flags; OCGCore tech ref shows ~14 flags are needed for a complete state snapshot. XYZ materials, counters, types, levels, attributes, scales, and link data would all be missing.

### What the OCGCore Technical Reference Resolves

The `ocgcore-technical-reference.md` document **significantly closes the implementation gap** between the architecture document and actual coding. It provides:

- **Complete response formats** for all 21 prompt types (section 7) — eliminates guesswork in ws-protocol.ts
- **Anti-cheat filter rules** for 5 additional message types the architecture missed
- **Startup Lua scripts** (20 exact filenames) — without this, the duel server can't initialize
- **Reconnection snapshot strategy** with proper query flags and data structure shapes
- **Phase/Location constants** — needed for zone mapping and phase display
- **RPS flow clarification** — both OCGCore-native and server-managed approaches documented with trade-offs

**Verdict:** The tech ref is essential for implementation. It should be considered a required companion to the architecture document and referenced in the epics (particularly Stories 1.2, 1.3, 1.6).

### Recommended Next Steps

1. **Restructure Epic 1:**
   - Move Room entity, Flyway migration, RoomController, RoomService from Story 1.4 → Epic 2 Story 2.1
   - Either add a thin end-to-end "test duel via deep link" story to make Epic 1 demonstrable, or accept it as a technical foundation epic and label accordingly

2. **Split the 6 oversized stories** into independently deliverable units (target: max 2-3 files, 1 system boundary per story). This will roughly double the story count from 17 to ~28-30 but each story will be estimable and reviewable.

3. **Add missing WebSocket protocol definitions** to architecture: TIMER_UPDATE DTO, GAME_STATE DTO, RPS_CHOICE/RPS_RESULT, REMATCH_REQUEST/REMATCH_RESPONSE, OPPONENT_DISCONNECTED notification. These are all needed before Stories 2.3, 3.2, 3.3, 3.4 can be implemented.

4. **Resolve MSG_DECK_LIST** — Either define a custom server message, or use Spring Boot REST to provide deck card IDs at room join for pre-fetching. Update Story 2.4 AC accordingly.

5. **Enrich reconnection query** — Update architecture to use the tech ref's FULL_FLAGS (~14 flags) for reconnection snapshots. Reference tech ref section 8 explicitly in Story 3.3.

6. **Add `ocgcore-technical-reference.md` as input document** to the epics document frontmatter and reference it in Stories 1.2, 1.3, and 1.6.

7. **Address Story 2.4 potential NFR6 violation** — Clarify that card thumbnail pre-fetch is for own deck only; opponent thumbnails fetched on-demand.

### Strengths

- PRD is exemplary: clear FR/NFR numbering, measurable success criteria, user journeys, phased delivery, risk mitigations with PoC evidence
- **100% FR and NFR coverage** in epics — zero requirements gaps
- UX spec is the most detailed document (148 KB) with comprehensive component specifications, interaction flows, and edge case handling
- OCGCore tech ref provides the "last mile" implementation details that close the gap between architecture concepts and actual API calls
- Cross-reference traceability maintained between all documents
- Phased delivery (PvP-A/B/C) provides natural stopping points

### Final Note

This assessment identified **43 issues** across 5 categories. The planning quality is high — the PRD, UX, and tech ref are excellent artifacts. The primary weaknesses are in the epic/story structure (Epic 1 independence, story sizing) and in missing WebSocket protocol definitions that bridge the UX flows to the architecture. These are addressed pre-implementation and should not require fundamental redesign — they are refinements to an otherwise solid plan.

**Assessor:** Claude (Implementation Readiness Workflow)
**Date:** 2026-02-25
