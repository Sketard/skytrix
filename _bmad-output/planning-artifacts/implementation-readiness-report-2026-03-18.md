---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
documentsIncluded:
  prd: prd-pvp.md
  architecture:
    - architecture-pvp.md
    - animation-architecture-pvp.md
  epics: epics-pvp.md
  ux:
    - ux-design-specification-pvp.md
    - ux-design-board-animations.md
    - ux-design-card-alteration-indicators.md
    - ux-design-chain-negation-feedback.md
scope: PvP Online Duels
---

# Implementation Readiness Assessment Report

**Date:** 2026-03-18
**Project:** skytrix
**Scope:** PvP Online Duels

## 1. Document Inventory

### PRD
- `prd-pvp.md` (21.7 KB, Feb 25)

### Architecture
- `architecture-pvp.md` (77.3 KB, Mar 12)
- `animation-architecture-pvp.md` (20.2 KB, Mar 12)

### Epics & Stories
- `epics-pvp.md` (86 KB, Mar 12)

### UX Design
- `ux-design-specification-pvp.md` (160 KB, Mar 12)
- `ux-design-board-animations.md` (14.7 KB, Mar 10)
- `ux-design-card-alteration-indicators.md` (23.2 KB, Mar 12)
- `ux-design-chain-negation-feedback.md` (8.3 KB, Mar 12)

### Supplementary Documents
- `ocgcore-technical-reference.md` (26.4 KB)
- `research-ocgcore-message-protocol.md` (36.8 KB)
- `pvp-presentation-summary.md` (20 KB)

**Duplicates:** None
**Missing Documents:** None

## 2. PRD Analysis

### Functional Requirements (25 FRs)

- **FR1:** The player can create a PvP duel room from any valid decklist; the room appears in a lobby visible to other authenticated players
- **FR2:** The system validates the deck before creating or joining a room (TCG format, TCG banlist compliance, deck size constraints: 40-60 main deck, 0-15 extra deck, 0-15 side deck)
- **FR3:** The player can browse available duel rooms and join one with a valid decklist
- **FR4:** The system starts the duel automatically when two players have joined the same room: both players play Rock-Paper-Scissors (30-second timeout, random selection on timeout) to determine who chooses to go first or second, then the duel begins with automatic hand distribution (5 cards each)
- **FR5:** The player can surrender during a PvP duel at any point
- **FR6:** The system handles player disconnection with a 60-second reconnection grace period
- **FR7:** The system declares a winner when: opponent's LP reaches 0, opponent surrenders, opponent's deck is empty and a draw is required, or opponent exceeds the reconnection timeout. The system declares a draw when both players' LP reach 0 simultaneously or other draw conditions are met per duel engine rules
- **FR8:** The system manages turn structure automatically (Draw Phase, Standby Phase, Main Phase 1, Battle Phase, Main Phase 2, End Phase)
- **FR9:** The player can perform Main Phase actions by clicking a card to open a contextual action menu listing available actions (normal summon, set, activate, special summon, change position). Phase-level actions (enter Battle Phase, end turn) are available via persistent UI controls
- **FR10:** The player can perform Battle Phase actions by clicking a monster to open a contextual attack menu (declare attack target). Phase-level actions (activate quick effect, enter Main Phase 2, end turn) are available via persistent UI controls
- **FR11:** The player can respond to effect activation prompts via modal dialogs: confirm activation (yes/no), select card(s) from a presented list, choose a zone on the field via highlighted selection, select a monster position (ATK/DEF/face-down), declare a card attribute or monster type, declare a number
- **FR12:** The system delegates chain resolution to the duel engine, which resolves chains automatically following official Yu-Gi-Oh! rules (SEGOC, LIFO resolution, timing)
- **FR13:** The system delegates all game rule enforcement to the duel engine: summoning conditions, effect timing windows, damage calculation, zone restrictions, Extra Monster Zone access (Master Rule 5)
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
- **FR25:** The system provides a client-side activation toggle (Auto/On/Off) that filters how the client handles optional effect activation prompts received from the engine

**Total FRs: 25**

### Non-Functional Requirements (10 NFRs)

- **NFR1:** PvP duel actions (player response -> board state update on both clients) complete within 500ms under normal network conditions
- **NFR2:** The WebSocket connection remains stable for the full duration of a duel (up to 60 minutes) with automatic heartbeat/keep-alive
- **NFR3:** The duel server supports at least 50 concurrent duels without degradation in response time
- **NFR4:** A disconnected player can reconnect to an active duel within 60 seconds without losing game state
- **NFR5:** If both players disconnect, the duel state is preserved server-side for up to 4 hours before automatic cleanup
- **NFR6:** The duel server is the sole authority for game state — the client receives only information the active player is authorized to see (no opponent hand contents, no face-down card identities, no deck order)
- **NFR7:** All player responses are validated by the duel engine — invalid responses (illegal card selections, out-of-turn actions) are rejected without corrupting game state
- **NFR8:** PvP routes and WebSocket connections are protected by existing JWT authentication
- **NFR9:** PvP mode functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). Landscape lock on mobile
- **NFR10:** The duel server's usage of OCGCore complies with AGPL-3.0 license requirements

**Total NFRs: 10**

### Additional Requirements & Constraints

- **Anti-cheat:** Frontend never sends decklists directly to Duel Server — Spring Boot relays server-to-server
- **Phased development:** PvP-A (core duel), PvP-B (session management), PvP-C (visual polish) — natural stopping points
- **Prerequisite:** Solo simulator MVP provides shared foundation (board zone components, card inspector, card data services, auth, deck management APIs)

### PRD Completeness Assessment

The PRD is well-structured with clear FR/NFR numbering (25 FRs, 10 NFRs), user journeys in French, phased scope (A/B/C), risk mitigation, and cross-references to the solo PRD. All requirements are testable and specific.

## 3. Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement (summary) | Epic Coverage | Status |
|---|---|---|---|
| FR1 | Room creation from decklist | Epic 2 | ✅ Covered |
| FR2 | Deck validation (TCG, banlist, size) | Epic 2 | ✅ Covered |
| FR3 | Browse/join rooms | Epic 2 | ✅ Covered |
| FR4 | Auto-start (RPS + hand distribution) | Epic 2 | ✅ Covered |
| FR5 | Surrender | Epic 3 | ✅ Covered |
| FR6 | Disconnection handling (60s grace) | Epic 3 | ✅ Covered |
| FR7 | Win/draw conditions | Epic 3 | ✅ Covered |
| FR8 | Automated turn structure | Epic 1 | ✅ Covered |
| FR9 | Main Phase actions (contextual menu) | Epic 1 | ✅ Covered |
| FR10 | Battle Phase actions (attack menu) | Epic 1 | ✅ Covered |
| FR11 | Player prompts (all SELECT_* types) | Epic 1 | ✅ Covered |
| FR12 | Chain resolution delegation | Epic 1 | ✅ Covered |
| FR13 | Full game rule enforcement | Epic 1 | ✅ Covered |
| FR14 | Two-player board display | Epic 1 | ✅ Covered |
| FR15 | Private information hiding | Epic 1 | ✅ Covered |
| FR16 | LP display (both players) | Epic 1 | ✅ Covered |
| FR17 | Chain visualization | Epic 6 | ✅ Covered |
| FR18 | Card detail inspection | Epic 1 | ✅ Covered |
| FR19 | Turn indicator | Epic 1 | ✅ Covered |
| FR20 | Turn timer (chess-clock) | Epic 3 | ✅ Covered |
| FR21 | Inactivity timeout (100s) | Epic 3 | ✅ Covered |
| FR22 | Visual feedback per game event | Epic 6 (partial) + Epic 7 | ✅ Covered (split) |
| FR23 | Click-based interaction | Epic 1 | ✅ Covered |
| FR24 | Duel result screen | Epic 3 | ✅ Covered |
| FR25 | Activation toggle (Auto/On/Off) | Epic 1 | ✅ Covered |

### NFR Coverage

| NFR | Primary Epic | Cross-cutting |
|---|---|---|
| NFR1 (<500ms round-trip) | Epic 1 | — |
| NFR2 (WS stable 60 min) | Epic 1 | Epic 3 |
| NFR3 (50 concurrent duels) | Epic 1 | — |
| NFR4 (60s reconnection) | Epic 3 | — |
| NFR5 (4h state preservation) | Epic 3 | — |
| NFR6 (Server authority, anti-cheat) | Epic 1 | — |
| NFR7 (Response validation) | Epic 1 | — |
| NFR8 (JWT authentication) | Epic 1 | Epic 2, Epic 3 |
| NFR9 (Browser compat, landscape lock) | Epic 1 | — |
| NFR10 (AGPL-3.0 compliance) | Epic 1 | — |

### Missing Requirements

None — all 25 FRs and 10 NFRs are covered in epics.

### Coverage Statistics

- Total PRD FRs: 25
- FRs covered in epics: 25
- Coverage percentage: **100%**
- Total PRD NFRs: 10
- NFRs covered in epics: 10
- NFR coverage percentage: **100%**

### Observations

- FR22 is split across Epic 6 (chain overlay + basic orchestration) and Epic 7 (card travel animations) — logical decomposition
- Epic numbering skips 4 (goes 1, 2, 3, 5, 6, 7) — likely removed/merged during planning, not a functional gap
- Epic 5 (Tech Debt) covers no new FRs — resolves technical debt from Epics 1-3

## 4. UX Alignment Assessment

### UX Document Status

Found — 4 UX documents:
- `ux-design-specification-pvp.md` (160 KB) — main spec
- `ux-design-board-animations.md` (14.7 KB) — animation timing supplement
- `ux-design-card-alteration-indicators.md` (23.2 KB) — card alteration visuals
- `ux-design-chain-negation-feedback.md` (8.3 KB) — chain negation feedback

### UX ↔ PRD Alignment

**Status: ✅ Strong alignment — 25/25 FRs addressed**

**Strategic UX additions (within PRD scope, no contradictions):**
1. Two-beat rendering for prompts (MSG_HINT context first, interactive elements 50ms later)
2. Floating Instruction Pattern (spatial overlay for zone selection instead of modal dialog)
3. Collapse-to-inspect (minimize active prompt to inspect board without dismissing)
4. Activation toggle behavioral semantics (Auto/On/Off detailed implementation spec)
5. Chain overlay non-interactive (pointer-events: none during chain construction)
6. Opponent hand count badge only (not individual card slots)
7. Zone browser dual-mode (browse vs action mode)
8. Perspective fallback flat mode (low-end devices with hardwareConcurrency < 4)

**Strategic divergence (FR9):** UX uses "distributed UI" — cards glow on field to indicate available actions. Single action = direct send (no menu). 2+ actions = Card Action Menu appears. PRD says "contextual action menu" — UX interprets spatially rather than as a persistent menu bar. Justified and documented.

**Low-priority deferrals (edge cases <1% of gameplay):**
- SORT_CARD / SORT_CHAIN prompts → auto-respond with default order
- ANNOUNCE_CARD → auto-select first valid option
- Keyboard shortcuts → deferred to PvP-B
- Formal WCAG compliance testing → post-MVP

### UX ↔ Architecture Alignment

**Status: ✅ Fully aligned — no contradictions**

- **Component naming:** 10/10 UX components match architecture component names exactly
- **Message types:** All UX interactions supported by defined WebSocket message types
- **Animation timing:** Same CSS tokens and duration values in both specs
- **Accessibility:** prefers-reduced-motion fully specified in both documents
- **Performance:** <500ms round-trip, animation duration tokens, speed multiplier all aligned

### Clarifications Needed (Non-Blocking)

| Item | Priority | Detail |
|---|---|---|
| Stagger timing discrepancy | Medium | UX says 30ms accelerated stagger; arch formula yields 50ms (`max(50, 100×speed)`). Recommend aligning during implementation |
| TURN_INFO / TIMER_UPDATE message types | Medium | Referenced in architecture for timer/turn display but not confirmed in ws-protocol.ts excerpt. Verify or add before implementation |
| MSG_HINT mandatory vs optional | Medium | Architecture marks as "UX-critical T1" but notes optional fallback. Clarify: required for all prompts or just some? |
| CardTravelService zone element registry | Medium | Architecture mentions `registerZoneResolver()` but UX doesn't specify ViewChildren query pattern. Clarify injection mechanism |
| Card alteration OCGCore query flags | Medium | UX lists 12 query flags needed. Verify all implemented in duel-worker.ts before board rendering |

### Warnings

None — UX documentation is comprehensive and well-aligned with both PRD and Architecture.

## 5. Epic Quality Review

### Epic-Level Assessment

| Epic | Status | User Value | Independence | Sizing | Key Issues |
|---|---|---|---|---|---|
| Epic 1 (Core Online Duel) | 🟠 Major | ⚠️ Story 1.2 is infra-only | ❌ Sequential chain 1.2→1.7 | ❌ Stories 1.2 & 1.6 epic-sized | Split 1.2 and 1.6; unblock parallel dev |
| Epic 2 (Lobby & Matchmaking) | 🟢 Pass | ✅ All stories user-facing | ✅ Independent from Epic 3+ | ✅ Appropriate | 4 minor AC clarifications |
| Epic 3 (Session Resilience) | 🟢 Pass | ✅ All stories user-facing | ✅ Independent from Epic 5+ | ✅ Appropriate | 1 minor rematch timing ambiguity |
| Epic 5 (Tech Debt) | 🟡 Minor | ⚠️ Mixed (debt resolution) | ✅ Depends on Epics 1-4 only | ❌ Unnumbered story too large | Add Story 5.4/5.5 headers; split Docker+thumbnails |
| Epic 6 (Chain Overlay) | 🟠 Major | ✅ Visual chain feedback | ✅ Depends on Epics 1-5 only | ⚠️ Story 6.3 borderline | Clarify board-change detection events |
| Epic 7 (Board Animations) | 🔴 Critical | ✅ Spatial card travel | ⚠️ Story 7.3 forward dep on 6.3 | ❌ Story 7.3 epic-sized | Split 7.3; resolve overlayHidden signal |

### Critical Violations (Block Sprint Planning)

#### CV-1: Story 1.2 — Epic-Sized Scope
- **Issue:** Duel server scaffold + 47 WS message types + Docker + types module = 3-5 days
- **Action:** Split into Story 1.2a (Node.js Scaffold), 1.2b (WebSocket Protocol Definition), 1.2c (HTTP + Docker)
- **Impact:** Enables parallel server/client development

#### CV-2: Story 1.6 — Epic-Sized Scope
- **Issue:** 6 prompt sub-components + bottom sheet + focus trap + keyboard shortcuts = 3-4 days
- **Action:** Split into Story 1.6a (Sheet Coordinator), 1.6b (Simple Prompts: YesNo, Options, RPS), 1.6c (Complex Prompts: CardGrid, ZoneHighlight, NumericInput)
- **Impact:** Allows incremental UI development

#### CV-3: Story 7.3 — Epic-Sized + Forward Dependency
- **Issue:** Buffer & Replay combines 4 interacting systems. Board-state masking mechanism unspecified. Forward dependency on `overlayHidden` signal from Story 6.3 (not emitted there)
- **Action:** Split into 7.3a (Event Buffering) + 7.3b (Replay Orchestration). Add `overlayHidden` signal emission to Story 6.3 ACs
- **Impact:** Reduces coupling, enables independent testing

#### CV-4: Epic 5 Unnumbered Story
- **Issue:** Docker integration tests + thumbnail pre-fetch combined without story number
- **Action:** Create Story 5.4 (Docker Container Integration Tests) + Story 5.5 (Thumbnail Pre-fetch Optimization)

### Major Issues (Clarify Before Sprint)

#### MJ-1: Epic 1 Sequential Dependency Chain
- **Issue:** Stories 1.2→1.3→1.4→1.5→1.6→1.7 form a strict sequential chain
- **Action:** Move WS protocol definition to architecture doc (frozen before epics phase), unblock 1.3 + 1.4 from 1.2
- **Recommendation:** After splitting 1.2, Stories 1.2a/1.2b/1.2c + 1.3 can run in parallel

#### MJ-2: Story 1.4 — Vague Spring Boot ACs
- **Issue:** Room entity schema, state machine triggers, JWT TTL mix concerns
- **Action:** Provide explicit schema (field names + types + constraints), enumerate state machine triggers, move JWT TTL to runbook

#### MJ-3: Story 1.5 ↔ 1.4 Circular Dependency
- **Issue:** Story 1.4 prescribes DuelPageComponent layout (1.5 concern)
- **Action:** Remove layout ACs from 1.4; move to 1.5

#### MJ-4: Story 6.3 — Board-Change Detection Vague
- **Issue:** Which events count as board-changing? Pulse duration not specified
- **Action:** Enumerate board-changing events (MSG_MOVE, MSG_DAMAGE, MSG_RECOVER). Specify pulse timing (e.g., 300ms)

#### MJ-5: Story 7.2 — Oversized + Missing Specs
- **Issue:** 8+ travel types, missing MSG_MOVE payload validation/fallback, impact glow specs undefined
- **Action:** Add payload validation AC, define glow design tokens, verify `CardInstance.isToken` field

### Minor Issues

| ID | Story | Issue | Recommendation |
|---|---|---|---|
| MI-1 | 2.1 | Polling frequency vague (2-3s) | Specify "every 2 seconds" |
| MI-2 | 2.3 | No RPS draw cap (infinite loop risk) | Add max 3 attempts; fallback to random |
| MI-3 | 3.4 | Rematch timing ambiguous | Clarify "within 5 min of DUEL_END" |
| MI-4 | 5.3 | Backend scheduler design implicit | Confirm scheduler approach before impl |
| MI-5 | 7.4 | Shuffle pseudo-elements ambiguous | Clarify max 2 (::before/::after) or create divs |
| MI-6 | 7.5 | XYZ offset proportional calc vague | Specify as 0.05em or percentage |
| MI-7 | 1.3 | Watchdog timeout handling unspecified | Specify: both players notified, draw declared |
| MI-8 | 1.3 | Message filter "complete MVP" without enumeration | Reference architecture doc table or enumerate |
| MI-9 | 1.7 | Actionable glow animation unspecified | Define pulse frequency, CSS approach |
| MI-10 | 1.7 | Card Action Menu positioning vague | Specify pixel offsets, width, max items |

### Positive Findings

- **Epics 2 & 3:** Excellent quality — clear user value, strong ACs (Given/When/Then), proper independence, appropriate sizing
- **FR traceability:** 100% across all epics — every FR mapped to at least one story
- **Brownfield awareness:** Database entities created when first needed (Story 2.1 creates Room table)
- **Accessibility:** LiveAnnouncer, aria-live, FocusTrap, prefers-reduced-motion integrated across stories
- **Edge cases:** Comprehensive coverage (multi-tab, background tab, simultaneous disconnect, 4h preservation)

## 6. Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK** — The planning artifacts are comprehensive and well-aligned (PRD↔Architecture↔UX at 100% FR/NFR coverage), but the epics document has structural issues that must be resolved before sprint planning can begin.

### Scorecard

| Dimension | Score | Notes |
|---|---|---|
| PRD Completeness | ✅ 10/10 | 25 FRs + 10 NFRs, clear phasing, testable requirements |
| FR/NFR Coverage | ✅ 100% | All 25 FRs and 10 NFRs mapped to epics |
| UX ↔ PRD Alignment | ✅ Strong | 25/25 FRs addressed, 8 strategic additions, no contradictions |
| UX ↔ Architecture Alignment | ✅ Strong | 10/10 components match, timing aligned, no contradictions |
| Epic User Value | ⚠️ 4/6 | Epics 2, 3, 6, 7 user-centric; Epic 1 Story 1.2 and Epic 5 have infra stories |
| Epic Independence | ⚠️ 4/6 | Epics 2, 3, 5, 6 independent; Epic 1 has sequential chain; Epic 7 has forward dep |
| Story Sizing | ❌ 3/6 | 3 epic-sized stories (1.2, 1.6, 7.3) + 1 unnumbered story (5.X) |
| AC Quality | ⚠️ 4/6 | Epics 2, 3 excellent; Epics 1, 6, 7 have vague or under-specified ACs |

### Critical Issues Requiring Immediate Action

1. **Split 3 epic-sized stories** before sprint planning:
   - Story 1.2 → 1.2a + 1.2b + 1.2c (scaffold, protocol, HTTP+Docker)
   - Story 1.6 → 1.6a + 1.6b + 1.6c (sheet coordinator, simple prompts, complex prompts)
   - Story 7.3 → 7.3a + 7.3b (event buffering, replay orchestration)

2. **Fix Epic 5 formatting**: Add Story 5.4 and 5.5 headers; split Docker tests + thumbnail pre-fetch

3. **Resolve Story 7.3 forward dependency**: Add `overlayHidden` signal emission to Story 6.3 ACs

4. **Unblock Epic 1 parallel development**: Extract WS protocol as frozen prerequisite (not gated by Story 1.2 completion)

### Recommended Next Steps

1. **Rework epics-pvp.md** to address the 4 critical violations and 5 major issues identified above. This should take ~1 session of focused editing.

2. **Clarify the 10 minor AC issues** (polling frequency, RPS cap, rematch timing, glow specs, etc.) — quick inline AC updates.

3. **Re-run this readiness check** after rework to confirm all issues resolved.

4. **Proceed to Sprint Planning** once all critical/major issues are resolved.

### Implementation Order (Recommended)

```
Phase 0: WS Protocol Freeze (prerequisite — extract from Story 1.2b)
Phase 1: Epic 1 (Core Duel) — 10-12 stories after splitting
Phase 2: Epic 2 + Epic 3 in parallel (independent siblings)
Phase 3: Epic 5 (Tech Debt) — pull 5.3/5.3b into Epic 3 if needed
Phase 4: Epic 6 (Chain Overlay) — depends on Epics 1-5
Phase 5: Epic 7 (Board Animations) — depends on Epics 1-6
```

### Final Note

This assessment identified **4 critical, 5 major, and 10 minor issues** across 6 epics (17 stories). The planning foundation is solid — PRD, Architecture, and UX specs are thorough and well-aligned. The issues are concentrated in story sizing (3 stories too large) and AC specificity (Epics 1, 6, 7). Epics 2 and 3 are sprint-ready as-is. Address the critical story splits and major AC clarifications before proceeding to sprint planning.

---

**Assessment Date:** 2026-03-18
**Assessor:** Claude (Implementation Readiness Workflow)
**Scope:** skytrix PvP Online Duels
**Documents Reviewed:** 8 planning artifacts (PRD, Architecture ×2, Epics, UX ×4)
