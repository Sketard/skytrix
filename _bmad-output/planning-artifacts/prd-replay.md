---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain-skipped', 'step-06-innovation-skipped', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
status: complete
inputDocuments: ['brainstorming-session-2026-03-21.md', 'project-context.md', 'prd-pvp.md', 'architecture-pvp.md']
workflowType: 'prd'
createdDate: '2026-03-21'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 1
  projectDocs: 3
classification:
  projectType: web_app
  domain: general
  complexity: medium
  projectContext: brownfield
---

# Product Requirements Document - skytrix PvP Replay Mode

**Author:** Axel
**Date:** 2026-03-21
**Related:** [prd-pvp.md](prd-pvp.md) (PvP Online Duels PRD)

*Convention: User Journeys are written in French (author's working language). All other sections are in English.*

## Executive Summary

**Product:** PvP Replay Mode for the skytrix Yu-Gi-Oh! deck management platform — recording, playback, and interactive exploration of completed PvP duels.

**Problem:** When a bug occurs during a PvP duel (e.g., an effect doesn't resolve correctly at turn 12), reproducing it requires manually playing through 11 turns to reach the same board state. This is hours of work for a single investigation.

**Solution:** A replay system that records all WebSocket messages during PvP duels and replays them server-side through OCGCore WASM. The player navigates the replay with video-like controls (play, pause, seek, step, fast-forward) and can fork at any point into a PvP Quick Duel Solo session to test alternative actions.

**Differentiator:** The replay is not a standalone system — it bridges PvP and PvP Quick Duel Solo. Event sourcing is native (WS messages ARE the replay format), fork reuses the PvP reconnection mechanism, and the Sequence Viewer reuses PvP board components. Minimal new code for high-value debugging capability.

**Target User:** Axel (solo developer, personal use) — primarily for debugging PvP duel engine issues, secondarily for post-game analysis.

**Prerequisite:** PvP Online Duels v1 ([prd-pvp.md](prd-pvp.md)) provides the foundation: Duel Server, OCGCore WASM integration, WebSocket protocol (62+ message types), PvP board components, PvP Quick Duel Solo pipeline.

## Success Criteria

### User Success

- Open a past duel replay from match history and navigate to any point using video-like controls (play, pause, seek, step forward/back, rewind, fast-forward)
- Identify a bug by replaying the exact sequence of events that produced it — seek eliminates O(n) manual reproduction
- Fork from any point into a PvP Quick Duel Solo session to test alternative actions and isolate root causes
- Both hands and all face-down cards visible in replay (omniscient view) — no strategic value post-game
- Quickly find the right replay via deck name, opponent, turn count, and result. MVP uses paginated list sorted by date (most recent first) — filtering and search are Growth features

### Business Success

- Complete developer debug loop (duel > find bug > replay > fork > fix > validate) stays within skytrix
- Replay replaces hours of manual board state reconstruction as the primary bug investigation tool

### Technical Success

- Event sourcing is native — raw WS messages captured during PvP duels ARE the replay format, no custom serialization
- Fast-forward through OCGCore WASM without rendering enables rapid seek (exact target to validate in Architecture)
- Fork reuses the PvP reconnection mechanism (replay WS messages into a new OCGCore WASM instance) — already proven in production
- PvP turn timers ignored during replay playback

### Measurable Outcomes

- A completed PvP duel can be found in match history and its replay opened within seconds
- Forking from replay to PvP Quick Duel Solo preserves the exact board state with no desynchronization

## Product Scope & Phased Development

**MVP Approach:** Problem-solving MVP — the smallest feature set that makes the debug loop viable without manual reproduction.

**Resource:** Solo developer (Axel). Existing tri-service infrastructure. No new microservices — extends the Duel Server and Spring Boot API.

### MVP (Phase 1)

**Core User Journeys Supported:** Both Journey 1 (Debug) and Journey 2 (Analyse)

**Must-Have Capabilities:**
1. **Server-side WS capture:** Duel Server records all 47 WS message types during PvP duels, persisted via Spring Boot API
2. **Match history:** List of past duels (deck name, opponent, turn count, result, date) with replay access
3. **Sequence Viewer:** Video-like playback controls — play, pause, step forward/back, seek, rewind, fast-forward (variable speed)
4. **Omniscient view:** Both players' hands, face-down cards, and all zones fully visible
5. **Fork to PvP Quick Duel Solo:** Branch from any point into a Quick Duel Solo session controlling both players, with full OCGCore state reconstructed
6. **TTL-based retention:** Automatic purge after configurable period (duration defined in Architecture)

### Growth Features (Phase 2)

- "View Replay" button on duel result screen
- Replay sharing (send a replay link to another player)
- Bookmarks/annotations within a replay timeline

### Vision (Phase 3)

- Spectator mode integration
- AI analysis of replays (suggesting optimal plays at decision points)

### Risk Mitigation Strategy

**Technical Risks:**
- *Server-side replay fidelity:* **Low risk** — replaying WS messages through OCGCore WASM is deterministic. Same inputs = same outputs. Already validated by PvP reconnection mechanism
- *Fork state reconstruction:* **Low risk** — uses the same `duelQueryField()` + `duelQuery()` snapshot mechanism as PvP reconnection, already proven in production
- *Storage volume:* **Low risk** — POC measured ~32KB per duel (252 responses, 12 turns with simple decks). ~10 players × few duels/day × 32KB = negligible for PostgreSQL
- *Step-back / rewind performance:* **Low risk** — POC measured 51ms avg to fast-forward 252 responses through OCGCore WASM (40x under the 2s performance gate). Checkpoints are not necessary for MVP
- *Lua script divergence:* **Accepted risk** — Replay uses the current ProjectIgnis card scripts at playback time, not the scripts active during the original duel. If scripts are updated between recording and playback, replay may diverge from the original game sequence. Acceptable for a small team with infrequent script updates

**Market Risks:** None — personal project

**Resource Risks:** MVP is small in scope (extends existing services, no new infrastructure). Natural stopping point after each capability — capture alone is useful even without the viewer

## User Journeys

### Journey 1 : Le Debugger — Reproduire et corriger un bug

Axel vient de finir un duel PvP avec son deck Tearlaments. Tour 12, un effet de fusion trigger depuis le cimetière ne s'est pas résolu correctement — la fusion n'a pas eu lieu malgré les matériaux disponibles. Le duel continue, Axel perd, mais le bug est noté mentalement.

Deux jours plus tard, Axel veut investiguer. Il ouvre la page Match History et retrouve la partie grâce au nom de son deck ("Tearlaments v3"), l'adversaire, et le nombre de tours (18). Il clique sur "Replay".

Le Sequence Viewer s'ouvre en vue omnisciente — les deux mains et toutes les cartes face cachée sont visibles. Axel fast-forward jusqu'au tour 11. Puis il passe en step-by-step pour observer message par message ce qui se passe au tour 12. Il voit que l'effet trigger de Tearlaments Scheiren est envoyé par le moteur, mais la réponse de sélection des matériaux de fusion ne correspond pas aux cartes attendues. Le bug est identifié.

Axel clique "Fork" au moment précis avant la résolution de l'effet. Le système crée une session PvP Quick Duel Solo avec l'état OCGCore reconstruit à ce point exact. Axel contrôle les deux joueurs, rejoue la séquence manuellement, confirme que le bug est reproductible, puis retourne dans son code pour corriger le filtre de message côté Duel Server.

**Capabilities revealed:** match history (deck name, opponent, turn count, result), replay playback (fast-forward, step-by-step), omniscient view, fork to PvP Quick Duel Solo with OCGCore state reconstruction, WS message-level granularity

### Journey 2 : L'Analyste — Explorer des alternatives post-game

Axel vient de perdre un duel PvP serré. Tour 6, son adversaire a activé Ash Blossom sur son starter et Axel a choisi de ne pas chaîner Called by the Grave — une décision qu'il regrette. Il veut savoir si chaîner aurait changé l'issue du duel.

Depuis le match history, il ouvre le replay de la partie qu'il vient de jouer. Il navigue au tour 6, juste avant la décision critique. Il observe en omniscient view que l'adversaire avait encore 2 handtraps en main — information qu'il n'avait pas pendant le duel. Cela change sa lecture de la situation.

Il clique "Fork" au moment de la décision. En PvP Quick Duel Solo, il contrôle les deux côtés. Il chaîne Called by the Grave sur Ash Blossom. Le moteur résout la chaîne correctement — le starter passe. Axel continue le duel en testant les 2-3 tours suivants pour vérifier si la nouvelle ligne de jeu mène à un board viable. Conclusion : chaîner était la bonne décision. Axel intègre cette lecture dans ses futurs duels.

**Capabilities revealed:** immediate post-game replay access, seek to specific turn, omniscient view (opponent hand reveal), fork at decision point, PvP Quick Duel Solo for alternative scenario testing

### Journey Requirements Summary

| Capability | J1 (Debug) | J2 (Analyse) |
|---|---|---|
| Match history (deck, opponent, turns, result) | x | x |
| Replay playback (play, pause, seek, step, FF) | x | x |
| Omniscient view (both hands, face-downs) | x | x |
| Fork to PvP Quick Duel Solo | x | x |
| OCGCore state reconstruction at fork point | x | x |
| Variable speed (fast-forward ↔ step-by-step) | x | x |
| WS message-level granularity | x | |
| Post-game immediate access | | x |

## Web App Technical Context

- **Architecture:** Extension of the existing PvP tri-service architecture — Angular 19 SPA ↔ WebSocket ↔ Node.js Duel Server (OCGCore WASM) ↔ HTTP ↔ Spring Boot API
- **Replay playback is server-side:** The Duel Server replays recorded WS messages through OCGCore WASM and streams the results to the client over WebSocket — identical to a live PvP duel. The Angular client receives the same message types as during a real game. No OCGCore WASM on the client side
- **Routes:** `/pvp/history` (match history, lazy-loaded), `/pvp/replay/:replayId` (replay viewer, lazy-loaded)
- **Communication:**
  - Replay playback: Frontend ↔ Duel Server via WebSocket (pre-computed board states at load, fork command)
  - Match history: Frontend ↔ Spring Boot via REST API (`GET /api/replays` — paginated list, metadata only; `DELETE /api/replays/{id}` — individual deletion)
  - Replay storage: Duel Server → Spring Boot API (`POST /api/replays` — persist at duel end)
  - Replay fetch: Duel Server ← Spring Boot API (`GET /api/internal/replays/:id` — fetch full replay data for pre-computation). Angular never fetches individual replay data — the replay viewer receives metadata via WS `REPLAY_METADATA` at handshake, supporting deep links to `/pvp/replay/:replayId` without match history context
- **Fast-forward / Seek:** The Duel Server replays WS messages through OCGCore without sending intermediate results to the client, then sends a state snapshot at the target point. Same mechanism as PvP reconnection (`duelQueryField()` + `duelQuery()`)
- **Fork:** Creates a PvP Quick Duel Solo session from the reconstructed OCGCore state at the current replay point. The client transitions from replay WebSocket to Quick Duel Solo dual WebSocket connections
- **Browser support:** Same as PvP — Chrome, Firefox, Edge, Safari (latest 2 versions), Chrome Android, Safari iOS (latest 2 versions). Landscape lock on mobile
- **Performance targets:** Seek to any point in a duel served by Duel Server WASM fast-forward. Round-trip for playback controls < 500ms (aligned with PvP NFR1)
- **Reuses from PvP:** Board display components (PvpBoardContainerComponent), card component, card inspector, WebSocket service infrastructure, authentication (JWT), deck data services, animation pipeline
- **No SEO needed:** Authenticated app, no public-facing replay pages

## Functional Requirements

### Replay Data Capture

- FR1: The system records all WS messages exchanged during a PvP duel and persists them server-side at duel completion. Duels that do not complete normally (server crash, process kill) do not produce a replay — this is an accepted limitation. Duels ended by DISCONNECT, TIMEOUT, or SURRENDER DO produce replays — these are valid completion states. The replay contains responses up to the disconnect/timeout/surrender point and is shorter than a naturally concluded duel
- FR2: The system stores replay metadata alongside the recorded messages (player usernames, deck names, turn count, duel result, date). The duel result is stored relative to player1 using the `DuelResult` enum (9 values: VICTORY, DEFEAT, DRAW, TIMEOUT, DISCONNECT, SURRENDER, OPPONENT_TIMEOUT, OPPONENT_DISCONNECT, OPPONENT_SURRENDER). OPPONENT_* variants preserve the "why" context in match history (e.g., "Win — opponent timeout" vs generic "Victory"). `flip()` maps between perspectives at query time: VICTORY↔DEFEAT, TIMEOUT↔OPPONENT_TIMEOUT, DISCONNECT↔OPPONENT_DISCONNECT, SURRENDER↔OPPONENT_SURRENDER, DRAW→DRAW

### Match History

- FR3: The player can view a list of past duels with replay data (deck name, opponent, turn count, result, date)
- FR4: The player can open a replay from the match history list

### Sequence Viewer — Playback

- FR5: The player can play a replay, displaying the duel board state progressing through recorded events with visual feedback (card movements, animations)
- FR6: The player can pause the replay at any point
- FR7: The player can step forward one event at a time from a paused state
- FR8: The player can step backward one event at a time from a paused state
- ~~FR9: The player can fast-forward the replay at variable speed~~ *(Removed by UX spec — seek/scrub via pre-computed client-side states replaces variable-speed fast-forward)*
- ~~FR10: The player can rewind the replay~~ *(Removed by UX spec — seek/scrub replaces rewind)*
- FR11: The player can seek to a specific turn in the replay. The timeline shows a miniature board preview on hover (desktop) to help visually identify the right moment before seeking

### Sequence Viewer — Display

- FR12: The system displays the replay in omniscient view — both players' hands, face-down cards, and all zones are fully visible
- FR13: The system displays the current turn number and active phase during replay playback
- FR14: The player can inspect card details for any card visible on the board during replay
- FR15: The system ignores PvP turn timers and inactivity timeouts during replay playback

### Fork to PvP Quick Duel Solo

- FR16: The player can fork the replay at any point into a PvP Quick Duel Solo session
- FR17: The system reconstructs the complete OCGCore game state at the fork point, enabling the Quick Duel Solo session to continue from that exact board state
- FR18: The player controls both players in the forked Quick Duel Solo session

### Replay Retention

- FR19: The system automatically purges replay data older than a configurable retention period
- FR20: The player can delete individual replays from match history (`DELETE /api/replays/{id}`)

## Non-Functional Requirements

### Performance

- NFR1: Playback control actions (play, pause, step, seek) respond within 500ms round-trip (aligned with PvP NFR1)
- NFR2: Fast-forward / seek to any point in a duel completes server-side in under 500ms. POC validated: 51ms avg for 252 responses (12-turn duel). Scales linearly — a 30-turn duel with ~600 responses would be ~120ms
- NFR3: Match history page loads the list of past duels within standard API response time (< 1 second)

### Reliability

- NFR4: Replay playback produces the exact same board state sequence as the original duel — deterministic replay guaranteed by replaying the same WS messages through OCGCore
- NFR5: Fork to PvP Quick Duel Solo reconstructs a valid OCGCore game state that allows the duel to continue without errors or desynchronization
- NFR6: The WebSocket connection for replay playback remains stable for the full duration of a replay session (reuses PvP WebSocket infrastructure and heartbeat/keep-alive)

### Compatibility

- NFR7: Replay mode functions on the same browser matrix as PvP — modern desktop browsers (Chrome, Firefox, Edge, Safari latest 2 versions) and mobile browsers (Chrome Android, Safari iOS latest 2 versions)

## Open Questions for UX Design Spec

- Fork transition: visual feedback when switching from replay (passive) to Quick Duel Solo (active)
- Return to replay after fork: one-way transition or ability to go back to the original timeline?
- Omniscient view in Quick Duel Solo post-fork: same full visibility or perspective switching?

## Cross-Reference to PvP PRD

This PRD is a companion to [prd-pvp.md](prd-pvp.md) (PvP Online Duels). The Replay Mode extends the PvP architecture — it does not introduce new microservices or communication patterns. Key dependencies:

- **WS message protocol:** All 62+ message types defined in PvP PRD (FR1 capture)
- **PvP Quick Duel Solo:** `SoloDuelOrchestratorService` with dual WS connections (FR16-18 fork)
- **PvP reconnection mechanism:** `duelQueryField()` + `duelQuery()` snapshot (FR17 state reconstruction)
- **PvP board components:** `PvpBoardContainerComponent`, card component, card inspector (FR5, FR12-14 display)
- **Authentication:** JWT-protected routes and WebSocket connections (shared infrastructure)
