---
status: complete
inputDocuments: ['prd.md', 'research-ygo-duel-engine.md']
workflowType: 'prd'
createdDate: '2026-02-24'
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
16. Inactivity timeout: 100 seconds without action forfeits the match
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

- **AI opponent:** heuristic-based auto-player for solo practice via the PvP engine pipeline
- **Spectator mode:** watch ongoing duels
- **Ranked mode:** Elo-based rating system
- **Replay system:** record and replay completed duels

### Risk Mitigation Strategy

**Technical Risks:**

- *OCGCore integration:* **Mitigated** — PoC validated (Node.js + `@n1xx1/ocgcore-wasm`). Full duel loop proven with deck loading, rule enforcement, and auto-player responses. See [research §10.6](research-ygo-duel-engine.md).
- *Network latency:* **Mitigated** — OCGCore processes actions in <10ms; dominant latency is network round-trip. WebSocket keeps connection alive to avoid per-action handshakes.
- *Lua script maintenance:* **Mitigated** — ProjectIgnis/CardScripts repository is actively maintained by the community (~weekly updates). Scripts are loaded at duel start, not compiled into the server.
- *`@n1xx1/ocgcore-wasm` bus factor:* **Moderate risk** — single maintainer, pre-1.0. Mitigation: the WASM build is reproducible from edo9300/ygopro-core sources via Emscripten if the package becomes unmaintained.
- *Message filtering complexity:* **Moderate risk** — OCGCore messages must be filtered per-player to prevent information leakage (opponent hand, face-down cards, deck order). Mitigation: NEOS (production React client) and SRVPro (Node.js server) both implement this pattern successfully.
- *ESM compatibility:* **Mitigated** — PoC identified and resolved the `@n1xx1/ocgcore-wasm` ESM default export issue via `patch-package`. Fix documented in [research §10.6.3](research-ygo-duel-engine.md).

**Market Risks:** None — personal project for personal use.

**Resource Risks:** The 3 sub-phases (A/B/C) provide natural stopping points. PvP-A alone delivers a functional (if minimal) online duel. PvP-B adds session management. PvP-C adds polish.

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
- **Routes:** `/lobby` (PvP room browser, new), `/duel/:roomId` (PvP duel, new)
- **Communication:**
  - Frontend <> Duel Server: WebSocket (bidirectional duel messages during active duel)
  - Frontend <> Spring Boot: REST API (auth, matchmaking, deck management)
  - Spring Boot -> Duel Server: HTTP internal (create duel + relay decklists, anti-cheat)
- **Anti-Cheat Principle:** The frontend never sends decklists directly to the Duel Server. Spring Boot validates the deck and relays it server-to-server. The Duel Server is the sole authority for game state — the client receives only information the active player is authorized to see.
- **Browser Support:** Modern browsers — desktop (Chrome, Firefox, Edge, Safari latest two versions) and mobile (Chrome Android, Safari iOS latest two versions)
- **Board Layout:** Reuses the solo simulator's board zone components and fixed aspect ratio (1060x772) with proportional scaling. PvP adds both player sides visible. Mobile: landscape-locked display.
- **Performance Targets:** Action-to-update round-trip < 500ms (network included). OCGCore processes actions in <10ms.
- **Reuses from solo:** Board zone components (adapted for PvP read-only display), card-tooltip/inspector component, card data services, card images (lazy loading for opponent's cards), authentication (JWT), deck management APIs
- **Dependencies (Duel Server):** `@n1xx1/ocgcore-wasm` (OCGCore WASM, 885KB), `better-sqlite3` (cards.cdb reader), `ws` or `socket.io` (WebSocket server), ProjectIgnis/CardScripts (13,000+ Lua files), ProjectIgnis/BabelCDB (cards.cdb SQLite)
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
- FR21: The system enforces an inactivity timeout: if a player performs no action for 100 seconds when a response is required, the system automatically forfeits the match
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
- NFR7: All player responses are validated by the duel engine — invalid responses (illegal card selections, out-of-turn actions) are rejected without corrupting game state
- NFR8: PvP routes and WebSocket connections are protected by existing JWT authentication — unauthenticated users cannot access matchmaking or duels

### Compatibility

- NFR9: PvP mode functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). The duel board locks to landscape orientation on mobile devices

### Licensing

- NFR10: The duel server's usage of OCGCore complies with AGPL-3.0 license requirements — source code for the duel server is made available if the service is deployed publicly

## Cross-Reference to Solo PRD

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
