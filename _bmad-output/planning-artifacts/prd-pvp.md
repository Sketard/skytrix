---
status: updated-post-implementation
inputDocuments: ['prd.md', 'research-ygo-duel-engine.md', 'brainstorming-session-2026-03-21.md']
workflowType: 'prd'
createdDate: '2026-02-24'
lastUpdated: '2026-04-05'
classification:
  projectType: web_app
  domain: general
  complexity: high
  projectContext: brownfield
---

# Product Requirements Document - skytrix PvP (Online Automated Duels)

**Author:** Axel
**Date:** 2026-02-24
**Related:** [prd.md](prd.md) (Solo Simulator PRD), [research-ygo-duel-engine.md](research-ygo-duel-engine.md)

*Convention: User Journeys are written in French (author's working language). All other sections are in English.*

## Executive Summary

**Product:** Online PvP automated duels for the skytrix Yu-Gi-Oh! deck management platform, powered by OCGCore (the open-source C++ duel engine used by EDOPro).

**Problem:** Existing online Yu-Gi-Oh! simulators (EDOPro, Dueling Nexus) are standalone applications disconnected from skytrix's deck management and solo combo testing workflow. Players must export/import decklists manually and context-switch between applications to go from deck building to online play.

**Solution:** A PvP mode accessible from any decklist in skytrix. All game rules are enforced automatically by OCGCore — chain resolution, effect timing, damage calculation, win conditions. The engine runs server-side for anti-cheat integrity. Players interact by responding to engine prompts (select cards, choose zones, confirm effects). The PvP board reuses the same visual components as the solo simulator but with a distinct interaction paradigm: click-based prompts instead of free-form drag & drop.

**Differentiator:** Seamless build > test > duel workflow within a single application. No context switching. Visual polish inspired by Yu-Gi-Oh! Master Duel.

**Target User:** Axel (solo developer, personal use) — competitive Yu-Gi-Oh! player who builds and optimizes decks in skytrix.

**Prerequisite:** The solo simulator MVP ([prd.md](prd.md)) provides the shared foundation: board zone components, card inspector, card data services, authentication, and deck management APIs.

**Technical Context:** The PvP mode adds a Node.js microservice running OCGCore via WebAssembly (`@n1xx1/ocgcore-wasm`), communicating with the Angular frontend over WebSocket. The existing Spring Boot backend handles authentication, matchmaking orchestration, and deck relay (anti-cheat: the frontend never sends decklists directly to the duel server).

## Success Criteria

### User Success

- Start an online duel from any valid decklist with minimal setup
- All game rules enforced automatically — no manual rule adjudication needed
- Clear prompts for every player decision (select cards, choose zones, confirm effects)
- Seamless transition between solo testing and PvP dueling from the same deck
- Visually polished PvP experience inspired by Yu-Gi-Oh! Master Duel

### Business Success

- skytrix becomes a viable alternative to EDOPro/Dueling Nexus for online play
- Complete build > test > duel loop without leaving skytrix

### Technical Success

- OCGCore executes duels without errors for all supported cards (~13,000+ cards with Lua scripts)
- Server-authoritative architecture — no game state leakage to unauthorized players
- WebSocket communication remains stable throughout a full duel (~20-50 turns)

### Measurable Outcomes

- Matchmaking finds an opponent within 30 seconds when players are available
- Player action to board update round-trip under 500ms (network included)
- A full duel completes without desynchronization between client and server

## Product Scope & Phased Development

**MVP Approach:** Incremental delivery in 3 sub-phases (A/B/C) followed by a growth phase. Each sub-phase delivers a testable increment.

**Resource:** Solo developer (Axel). Existing Angular + Spring Boot infrastructure. New Node.js duel server microservice.

**Architecture:** Angular 19 SPA <-WebSocket-> Node.js Duel Server (OCGCore WASM) <-HTTP-> Spring Boot API (auth, matchmaking, deck relay).

### PvP-A: Core Duel (Functional Online Duel)

The minimum to have two players complete a fully automated duel online.

1. Duel server microservice (Node.js + `@n1xx1/ocgcore-wasm`)
2. WebSocket bidirectional connection between frontend and duel server
3. Deck loading from decklists relayed by Spring Boot (server-to-server, anti-cheat)
4. Full automated duel flow: Draw Phase, Standby Phase, Main Phase 1, Battle Phase, Main Phase 2, End Phase
5. Player prompts for all engine query types: select card(s), confirm effect (yes/no), choose zone, select position, declare attribute/type/number, select chain response
6. Automatic chain resolution, effect timing, damage calculation, win condition detection
7. Two-player board display: own field in full detail, opponent's face-up cards visible, face-down shown as card backs
8. Life point tracking and display for both players
9. Win/draw detection: opponent LP reaches 0, surrender, deck-out, reconnection timeout, simultaneous LP depletion
10. Anti-cheat: server-only authority, message filtering (no private info leakage), response validation

### PvP-B: Session Management (Usable Online Experience)

Turn the raw duel into a complete matchmaking and session management experience.

11. Room-based lobby: create room (from decklist) / browse available rooms / join with valid deck
12. Deck validation before room entry: TCG format, TCG banlist compliance, deck size (40-60 main, 0-15 extra, 0-15 side)
13. Surrender at any point during a duel
14. Disconnection handling with 60-second reconnection grace period
15. Turn timer: 300-second cumulative pool, +40 seconds per subsequent turn, counts down during active player's decision windows only
16. Inactivity timeout: 120 seconds without action forfeits the match (with 20-second warning before timeout)
17. Duel result screen: outcome (victory/defeat/draw), reason (LP 0, surrender, timeout, disconnect, draw condition)

### PvP-C: Visual Polish (Master Duel Quality)

Visual feedback and information display to match Yu-Gi-Oh! Master Duel's quality bar.

18. Visual feedback per game event: card movement animation + brief highlight for summon, destroy, activate, flip, LP change, chain link
19. Chain visualization: display each chain link's card and effect during resolution
20. Card detail inspection for any face-up card or card in public zones (graveyard, banished)
21. Visual indicator when it's the player's turn and what response type is expected
22. Click-based interaction paradigm: respond to engine prompts by selecting from presented options (not drag & drop)

### Phase 2: Growth & Expansion

Enhancements for a more complete PvP experience.

- **Solo duel via PvP engine:** *(implemented in v1)* — `SoloDuelOrchestratorService` enables single-player testing against oneself using dual WebSocket connections through the PvP duel pipeline. Dev-only `QuickDuel` endpoint bypasses lobby for rapid testing
- **AI opponent:** heuristic-based auto-player for true solo practice (not yet implemented — currently the player controls both sides)
- **Spectator mode:** watch ongoing duels
- **Ranked mode:** Elo-based rating system
#### Replay System *(implemented in v1)*

A replay system that records all WebSocket messages during PvP duels and replays them server-side through OCGCore WASM. The player navigates the replay with video-like controls (play, pause, seek, step) and can fork at any point into a PvP Quick Duel Solo session to test alternative actions. Event sourcing is native (WS messages ARE the replay format), fork reuses the PvP reconnection mechanism, and the Sequence Viewer reuses PvP board components.

**Success Criteria:**

- Seek eliminates O(n) manual reproduction — navigate to any point in a past duel within seconds
- Fork to PvP Quick Duel Solo preserves the exact board state with no desynchronization
- Omniscient view (both hands, face-down cards) enables post-game analysis with full information
- Event sourcing is native — no custom serialization, raw WS messages are the replay format
- Fast-forward through OCGCore WASM: 51ms avg for 252 responses (12-turn duel), scales linearly

**MVP Scope:**

1. **Server-side WS capture:** Duel Server records all 47 WS message types during PvP duels, persisted via Spring Boot API
2. **Match history:** List of past duels (deck name, opponent, turn count, result, date) with replay access
3. **Sequence Viewer:** Video-like playback controls — play, pause, step forward/back, seek
4. **Omniscient view:** Both players' hands, face-down cards, and all zones fully visible
5. **Fork to PvP Quick Duel Solo:** Branch from any point into a Quick Duel Solo session controlling both players, with full OCGCore state reconstructed
6. **TTL-based retention:** Automatic purge after configurable period

**Growth Features:** "View Replay" button on duel result screen, replay sharing, bookmarks/annotations within a replay timeline.

**Vision:** Spectator mode integration, AI analysis of replays (suggesting optimal plays at decision points).

**Replay Risk Mitigation:**

- *Server-side replay fidelity:* **Low risk** — replaying WS messages through OCGCore WASM is deterministic. Same inputs = same outputs. Already validated by PvP reconnection mechanism
- *Fork state reconstruction:* **Low risk** — uses the same `duelQueryField()` + `duelQuery()` snapshot mechanism as PvP reconnection, already proven in production
- *Storage volume:* **Low risk** — POC measured ~32KB per duel (252 responses, 12 turns with simple decks). Negligible for PostgreSQL
- *Step-back / rewind performance:* **Low risk** — POC measured 51ms avg to fast-forward 252 responses through OCGCore WASM (40x under the 2s performance gate). Checkpoints not necessary for MVP
- *Lua script divergence:* **Accepted risk** — Replay uses current ProjectIgnis card scripts at playback time, not the scripts active during the original duel. If scripts are updated between recording and playback, replay may diverge. Acceptable for a small team with infrequent script updates

## User Journeys

### Journey 1: The Duelist — PvP Happy Path

Axel vient de peaufiner son deck Tearlaments dans le simulateur solo. Il a teste plusieurs mains, son combo turn 1 passe 4 fois sur 5. Il est pret a le valider en conditions reelles.

Depuis la page de son deck, il clique **"Duel PvP"**. Le systeme valide son deck (format TCG, banlist, taille). Il cree une room qui apparait dans le lobby. Un autre joueur la rejoint. Le duel demarre : pierre-feuille-ciseaux pour determiner qui joue en premier, puis distribution automatique des mains de 5 cartes.

C'est son tour. Le systeme lui propose ses actions disponibles : invocation normale, activation de magie, poser une carte. Il invoque son starter, le moteur detecte automatiquement l'effet declenche et lui demande s'il veut l'activer. "Oui." L'effet s'execute, mill 3 depuis le deck — une Tearlaments tombe au cimetiere. Le moteur detecte l'effet trigger obligatoire et l'ajoute a la chaine. La chaine se resout : fusion automatique. Tout est fluide — pas besoin de gerer les regles manuellement, le moteur fait le travail.

L'adversaire repond avec un Ash Blossom. Le moteur gere la chaine : effet nie. Axel continue son tour avec un plan B. Apres 8 tours, l'adversaire tombe a 0 LP. Victoire affichee.

**Capabilities revealed:** deck validation, room creation/lobby, automated duel flow, OCGCore rule enforcement, effect chain resolution, contextual action menus, player prompts (yes/no, select card, choose zone), LP tracking, win condition detection, duel result screen

### Journey 2: The Competitor — Solo + PvP Loop

Axel vient de perdre un duel PvP — son adversaire a joue un handtrap qu'il n'avait pas anticipe. Il retourne dans le simulateur solo pour tester comment jouer autour de Ash Blossom. Il ajuste son deck dans le deckbuilder, ajoute Called by the Grave, puis reteste ses combos en solo en simulant le handtrap manuellement (il envoie lui-meme une carte au cimetiere pour simuler la negate).

Satisfait de sa nouvelle ligne de jeu, il relance un duel PvP. Cette fois, quand l'adversaire active Ash, il chaine Called by the Grave — le moteur resout correctement la chaine et l'effet adverse est nie. Son combo passe. Le cycle deckbuilder > solo > PvP > ajustement est fluide et ne quitte jamais skytrix.

**Capabilities revealed:** iteration between solo testing and PvP validation, deck adjustment workflow, chain interaction in PvP, integrated build-test-play loop

### Journey Requirements Summary

| Capability | J1 (PvP) | J2 (PvP+Solo) |
|---|---|---|
| Deck validation & room lobby | x | x |
| Automated duel flow (OCGCore) | x | x |
| Player prompts (select/confirm) | x | x |
| Chain resolution display | x | x |
| LP tracking & win detection | x | x |
| Two-player board display | x | x |
| Duel result screen | x | x |
| Card detail on hover | x | x |
| Solo <> PvP transition | | x |

## Web App Technical Context

- **Architecture:** Tri-service — Angular 19 SPA (frontend) + Spring Boot API (backend, existing) + Node.js Duel Server (new, `@n1xx1/ocgcore-wasm`)
- **Routes:** `/pvp` (PvP lobby, lazy-loaded), `/pvp/duel/:roomCode` (PvP duel, lazy-loaded with canDeactivate guard)
- **Communication:**
  - Frontend <> Duel Server: WebSocket (bidirectional duel messages during active duel)
  - Frontend <> Spring Boot: REST API (auth, matchmaking, deck management)
  - Spring Boot -> Duel Server: HTTP internal (create duel + relay decklists, anti-cheat; data update: PUT /api/update-data triggers cards.cdb + scripts refresh from ProjectIgnis; POST /api/validate-passcodes for deck passcode double-validation)
- **Anti-Cheat Principle:** The frontend never sends decklists directly to the Duel Server. Spring Boot validates the deck and relays it server-to-server. The Duel Server is the sole authority for game state — the client receives only information the active player is authorized to see.
- **Browser Support:** Modern browsers — desktop (Chrome, Firefox, Edge, Safari latest two versions) and mobile (Chrome Android, Safari iOS latest two versions)
- **Board Layout:** PvP uses a dedicated `PvpBoardContainerComponent` with responsive sizing (`height: 90%; aspect-ratio: 274/215; max-width: 100%`). Both player sides visible with CSS 3D perspective (`--pvp-perspective-depth: 800px`). Mobile: landscape-locked display.
- **Performance Targets:** Action-to-update round-trip < 500ms (network included). OCGCore processes actions in <10ms.
- **Reuses from solo:** Board zone components (adapted for PvP read-only display), card-tooltip/inspector component, card data services, card images (lazy loading for opponent's cards), authentication (JWT), deck management APIs
- **Dependencies (Duel Server):** `@n1xx1/ocgcore-wasm` (OCGCore WASM), `better-sqlite3` (cards.cdb reader), `ws` (WebSocket server), ProjectIgnis/CardScripts (13,000+ Lua files), ProjectIgnis/BabelCDB (cards.cdb SQLite)
- **Banlist Management:** TCG banlist data stored in the database, updated manually via existing settings page. Banlist updates published ~4 times/year by Konami.
- **Visual Reference:** Yu-Gi-Oh! Master Duel — board layout, aesthetics, PvP interaction model (click-based prompts, turn timer, animations, chain visualization)

## Functional Requirements

### Matchmaking & Session

- FR1: The player can create a PvP duel room from any valid decklist; the room appears in a lobby visible to other authenticated players
- FR2: The system validates the deck before creating or joining a room (TCG format, TCG banlist compliance, deck size constraints: 40-60 main deck, 0-15 extra deck, 0-15 side deck)
- FR3: The player can browse available duel rooms and join one with a valid decklist
- FR4: The system starts the duel automatically when two players have joined the same room: both players play Rock-Paper-Scissors (30-second timeout, random selection on timeout) to determine who chooses to go first or second, then the duel begins with automatic hand distribution (5 cards each)
- FR5: The player can surrender during a PvP duel at any point
- FR6: The system handles player disconnection with a 60-second reconnection grace period
- FR7: The system declares a winner when: opponent's LP reaches 0, opponent surrenders, opponent's deck is empty and a draw is required, or opponent exceeds the reconnection timeout. The system declares a draw when both players' LP reach 0 simultaneously or other draw conditions are met per duel engine rules

### Turn & Phase Management

- FR8: The system manages turn structure automatically (Draw Phase, Standby Phase, Main Phase 1, Battle Phase, Main Phase 2, End Phase)
- FR9: The player can perform Main Phase actions by clicking a card to open a contextual action menu listing available actions (normal summon, set, activate, special summon, change position). Phase-level actions (enter Battle Phase, end turn) are available via persistent UI controls
- FR10: The player can perform Battle Phase actions by clicking a monster to open a contextual attack menu (declare attack target). Phase-level actions (activate quick effect, enter Main Phase 2, end turn) are available via persistent UI controls

### Player Prompts & Engine Delegation

- FR11: The player can respond to effect activation prompts via modal dialogs: confirm activation (yes/no), select card(s) from a presented list, choose a zone on the field via highlighted selection, select a monster position (ATK/DEF/face-down), declare a card attribute or monster type, declare a number
- FR12: The system delegates chain resolution to the duel engine, which resolves chains automatically following official Yu-Gi-Oh! rules (SEGOC, LIFO resolution, timing)
- FR13: The system delegates all game rule enforcement to the duel engine: summoning conditions, effect timing windows, damage calculation, zone restrictions, Extra Monster Zone access (Master Rule 5)

### Board Display & Information

- FR14: The system displays both players' fields: own field in full detail, opponent's face-up cards visible, opponent's face-down cards shown as card backs
- FR15: The system hides opponent's private information: hand contents (card count visible, not identity), deck order, face-down card identities, extra deck contents
- FR16: The system displays life points for both players, updated in real-time after damage or LP changes
- FR17: The system displays the current chain of effects being resolved, showing each chain link's card and effect
- FR18: The player can view card details for any face-up card on the field or in any public zone (graveyard, banished)
- FR19: The system provides a visual indicator when it is the player's turn to act and what type of response is expected
- FR20: The system enforces a turn timer with a cumulative time pool: 300 seconds initially, +40 seconds added to the remaining pool at the start of each subsequent turn. The timer counts down only during the active player's decision windows and pauses during chain resolution and opponent's actions
- FR21: The system enforces an inactivity timeout: if a player performs no action for 120 seconds when a response is required, the system automatically forfeits the match. A warning is displayed to the player 20 seconds before the timeout expires
- FR22: The system provides at least one visual feedback per game event in PvP (summon, destroy, activate, flip, LP change, chain link addition/resolution). Minimum: card movement animation + brief highlight. Visual style inspired by Yu-Gi-Oh! Master Duel
- FR23: PvP interaction is click-based (respond to engine prompts by selecting from presented options) — not drag & drop. This is a distinct interaction paradigm from solo mode
- FR24: The system displays a duel result screen at the end of a PvP duel showing: outcome (victory, defeat, or draw) and reason (opponent LP reduced to 0, opponent surrendered, opponent timed out, opponent disconnected, draw by simultaneous LP depletion)

- FR25: The system provides a client-side activation toggle (Auto/On/Off) that filters how the client handles optional effect activation prompts received from the engine. The engine always sends all legal prompts (it is unaware of the toggle); the client decides whether to display or auto-respond. **Auto** (default): prompt the player only in reaction to a game event — opponent activates a card/effect, a monster is summoned (Normal/Special/Flip), an attack is declared, or the opponent's turn is about to end. Auto does NOT prompt during open game state windows (Draw/Standby Phase with no activation, phase transitions, post-chain-resolution windows, opponent setting a card). **On**: prompt the player at every legal priority window, including open game state windows, phase transitions, Draw/Standby Phase, Battle Phase sub-steps, and post-chain-resolution. **Off**: auto-respond "No"/"Pass" to all optional prompts without displaying them. The toggle is per-duel (resets to Auto at duel start), visible during the player's turn, and does not affect mandatory prompts or mandatory trigger effects

## Non-Functional Requirements

### Network & Latency

- NFR1: PvP duel actions (player response -> board state update on both clients) complete within 500ms under normal network conditions
- NFR2: The WebSocket connection remains stable for the full duration of a duel (up to 60 minutes) with automatic heartbeat/keep-alive

### Scalability

- NFR3: The duel server supports at least 50 concurrent duels without degradation in response time

### Reliability

- NFR4: A disconnected player can reconnect to an active duel within 60 seconds without losing game state
- NFR5: If both players disconnect, the duel state is preserved server-side for up to 4 hours before automatic cleanup

### Security

- NFR6: The duel server is the sole authority for game state — the client receives only information the active player is authorized to see (no opponent hand contents, no face-down card identities, no deck order). Verified by: WebSocket message inspection confirms no private opponent data in payloads
- NFR7: All player responses are validated by the duel engine — invalid responses (illegal card selections, out-of-turn actions) are rejected without corrupting game state. The duel server enforces WebSocket rate limiting (30 failed messages per 60 seconds per IP), state sync rate limiting (1 request per 5 seconds per player), a maximum of 5 invalid responses before connection termination, and an anti-bluff delay (200-1500ms random) on instant responses to prevent timing side-channel analysis
- NFR8: PvP routes and WebSocket connections are protected by existing JWT authentication — unauthenticated users cannot access matchmaking or duels

### Compatibility

- NFR9: PvP mode functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). The duel board locks to landscape orientation on mobile devices

### Licensing

- NFR10: The duel server's usage of OCGCore complies with AGPL-3.0 license requirements — source code for the duel server is made available if the service is deployed publicly

### Replay Data Capture

- FR26: The system records all WS messages exchanged during a PvP duel and persists them server-side at duel completion. Duels that do not complete normally (server crash, process kill) do not produce a replay — this is an accepted limitation. Duels ended by DISCONNECT, TIMEOUT, or SURRENDER DO produce replays — these are valid completion states. The replay contains responses up to the disconnect/timeout/surrender point and is shorter than a naturally concluded duel
- FR27: The system stores replay metadata alongside the recorded messages (player usernames, deck names, turn count, duel result, date). The duel result is stored relative to player1 using the `DuelResult` enum (9 values: VICTORY, DEFEAT, DRAW, TIMEOUT, DISCONNECT, SURRENDER, OPPONENT_TIMEOUT, OPPONENT_DISCONNECT, OPPONENT_SURRENDER). OPPONENT_* variants preserve the "why" context in match history (e.g., "Win — opponent timeout" vs generic "Victory"). `flip()` maps between perspectives at query time: VICTORY↔DEFEAT, TIMEOUT↔OPPONENT_TIMEOUT, DISCONNECT↔OPPONENT_DISCONNECT, SURRENDER↔OPPONENT_SURRENDER, DRAW→DRAW

### Replay Match History

- FR28: The player can view a list of past duels with replay data (deck name, opponent, turn count, result, date)
- FR29: The player can open a replay from the match history list

### Replay Sequence Viewer — Playback

- FR30: The player can play a replay, displaying the duel board state progressing through recorded events with visual feedback (card movements, animations)
- FR31: The player can pause the replay at any point
- FR32: The player can step forward one event at a time from a paused state
- FR33: The player can step backward one event at a time from a paused state
- ~~FR34: The player can fast-forward the replay at variable speed~~ *(Removed by UX spec — seek/scrub via pre-computed client-side states replaces variable-speed fast-forward)*
- ~~FR35: The player can rewind the replay~~ *(Removed by UX spec — seek/scrub replaces rewind)*
- FR36: The player can seek to a specific turn in the replay. The timeline shows a miniature board preview on hover (desktop) to help visually identify the right moment before seeking

### Replay Sequence Viewer — Display

- FR37: The system displays the replay with a perspective toggle — the player can switch between Player 1 and Player 2 viewpoints, with full visibility of the selected player's hand, face-down cards, and all zones
- FR38: The system displays the current turn number and active phase during replay playback
- FR39: The player can inspect card details for any card visible on the board during replay
- FR40: The system ignores PvP turn timers and inactivity timeouts during replay playback

### Replay Fork to PvP Quick Duel Solo

- FR41: The player can fork the replay at any point into a PvP Quick Duel Solo session
- FR42: The system reconstructs the complete OCGCore game state at the fork point, enabling the Quick Duel Solo session to continue from that exact board state
- FR43: The player controls both players in the forked Quick Duel Solo session

### Replay Retention

- FR44: The system automatically purges replay data older than a configurable retention period
- FR45: The player can delete individual replays from match history (`DELETE /api/replays/{id}`)

### Replay Non-Functional Requirements

- NFR11: Playback control actions (play, pause, step, seek) respond within 500ms round-trip (aligned with PvP NFR1)
- NFR12: Fast-forward / seek to any point in a duel completes server-side in under 500ms. POC validated: 51ms avg for 252 responses (12-turn duel). Scales linearly — a 30-turn duel with ~600 responses would be ~120ms
- NFR13: Match history page loads the list of past duels within standard API response time (< 1 second)
- NFR14: Replay playback produces the exact same board state sequence as the original duel — deterministic replay guaranteed by replaying the same WS messages through OCGCore
- NFR15: Fork to PvP Quick Duel Solo reconstructs a valid OCGCore game state that allows the duel to continue without errors or desynchronization
- NFR16: The WebSocket connection for replay playback remains stable for the full duration of a replay session (reuses PvP WebSocket infrastructure and heartbeat/keep-alive)
- NFR17: Replay mode functions on the same browser matrix as PvP — modern desktop browsers (Chrome, Firefox, Edge, Safari latest 2 versions) and mobile browsers (Chrome Android, Safari iOS latest 2 versions)

## Cross-References

### PvP → Solo PRD

This PRD is a companion to [prd.md](prd.md) (Solo Simulator). The following mapping shows the FR/NFR correspondence for traceability:

| PvP PRD | Original unified PRD |
|---|---|
| FR1-FR7 | FR35-FR41 |
| FR8-FR10 | FR42-FR44 |
| FR11-FR13 | FR45-FR47 |
| FR14-FR25 | FR48-FR59 |
| NFR1-NFR2 | NFR13-NFR14 |
| NFR3 | NFR15 |
| NFR4-NFR5 | NFR16-NFR17 |
| NFR6-NFR7 | NFR18-NFR19 |
| NFR8 | NFR7 (shared) |
| NFR9 | NFR9 (shared) |
| NFR10 | NFR20 |

### Replay FR/NFR Mapping (formerly prd-replay.md)

| This PRD | Original prd-replay.md |
|---|---|
| FR26-FR27 | FR1-FR2 (Capture) |
| FR28-FR29 | FR3-FR4 (Match History) |
| FR30-FR36 | FR5-FR11 (Playback) |
| FR37-FR40 | FR12-FR15 (Display) |
| FR41-FR43 | FR16-FR18 (Fork) |
| FR44-FR45 | FR19-FR20 (Retention) |
| NFR11-NFR13 | NFR1-NFR3 (Performance) |
| NFR14-NFR16 | NFR4-NFR6 (Reliability) |
| NFR17 | NFR7 (Compatibility) |
