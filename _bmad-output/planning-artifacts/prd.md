---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain-skipped', 'step-06-innovation-skipped', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete', 'step-e-01-discovery', 'step-e-02-review', 'step-e-03-edit']
status: complete
inputDocuments: ['project-context.md']
workflowType: 'prd'
lastEdited: '2026-02-24'
editHistory:
  - date: '2026-02-12'
    changes: 'Applied sprint change proposal: responsive multi-device support (Technical Context, NFR9, NFR11, NFR12)'
  - date: '2026-02-24'
    changes: 'Extracted all PvP content into dedicated prd-pvp.md. This PRD now covers solo simulator only. Removed FR35-FR58, NFR13-NFR20, Journeys 4-5, Phase 2 (PvP), PvP sections from Executive Summary, Success Criteria, Technical Context, and Risk Mitigation.'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 1
classification:
  projectType: web_app
  domain: general
  complexity: medium
  projectContext: brownfield
---

# Product Requirements Document - skytrix Solo Simulator

**Author:** Axel
**Date:** 2026-02-07
**Related:** [prd-pvp.md](prd-pvp.md) (PvP Online Duels PRD)

*Convention: User Journeys are written in French (author's working language). All other sections are in English.*

## Executive Summary

**Product:** Yu-Gi-Oh! deck management application with integrated solo combo testing simulator, built on the existing skytrix platform.

**Problem:** No tool exists to test deck combos from a decklist without entering a live duel — players rely on real games to validate turn 1 sequences, making deck optimization slow.

**Solution:** A manual free-form simulator accessible from any decklist in skytrix. The player draws, summons, activates, mills, searches via drag & drop across all 18 game zones. No rules engine, full manual control, undo/redo. Ideal for rapid combo testing.

**Differentiator:** Single integrated workflow: build deck > test combos. No context switching between applications. Visual polish inspired by Yu-Gi-Oh! Master Duel.

**Target User:** Axel (solo developer, personal use) — competitive Yu-Gi-Oh! player who builds and optimizes decks in skytrix.

**Technical Context:** Brownfield project. Angular 19 SPA with Java/Spring Boot backend. Solo mode is frontend-only — no backend changes required.

## Success Criteria

### User Success

- Start a solo simulation from any existing decklist in one click
- Fluid combo testing: all actions feel instant and natural via drag & drop
- Immediate board reset (one action to restart from scratch)
- Full manual control over all zones and actions — no artificial constraints
- Visually polished interface, more aesthetic than DB Grinder and EDOPro
- Board remains readable with 10+ cards in play
- Undo/redo for recovering from mid-combo mistakes
- Card details (image + effect text) visible on hover for reference

### Business Success

- Personal project for personal use initially
- The simulator replaces external simulators as Axel's go-to combo testing tool
- Seamless integration with existing skytrix deck management workflow

### Technical Success

- Frontend-only for solo mode: no backend changes required
- No lag when moving cards between zones, even with full board states
- Reuses existing card data model and images
- Client-side randomization for representative test hands

### Measurable Outcomes

- A full combo sequence (10+ actions) executes without friction or UI delays
- Board reset to initial state in under 1 second
- All Yu-Gi-Oh! game zones represented and functional including Extra Monster Zones and Pendulum Zones

## Product Scope & Phased Development

**MVP Approach:** Problem-Solving MVP with Design Excellence — a fully functional solo combo testing tool with visual polish matching or exceeding skytrix's existing aesthetic standards.

**Resource:** Solo developer (Axel), frontend-only. All infrastructure already in place.

**Internal MVP Milestones:** The MVP is structured into 3 incremental sub-phases (A/B/C) to provide deliverable checkpoints and avoid development tunneling.

### MVP-A: Core Simulator (Playable Board)

The complete board with basic actions — enough to test simple combos.

1. Load decklist (main deck, extra deck) from deck detail page
2. Shuffle and draw initial hand
3. All 18 game zones: hand, monster (1-5), spell/trap (1-5 — ST1/ST5 double as Pendulum L/R per Master Rule 5), Extra Monster (2), field spell, graveyard, banish, extra deck, main deck
4. Drag & drop card movement between any zones
5. Manual card actions: draw, summon/set, activate, send to GY, banish, return to hand/deck
6. Card detail on hover (reuse existing card-tooltip component)
7. Reset board to start fresh

### MVP-B: Extended Actions (Advanced Simulation)

Enriched card interactions for comprehensive combo testing.

8. Search deck (view & pick a card)
9. Shuffle deck at any time
10. Mill: send top N cards from deck to graveyard
11. Reveal/excavate: view top N cards from deck
12. View stacked zones: expandable overlay for deck, GY, banish, extra deck
13. Pick from zone: select specific card from stacked zone
14. Face-down / flip cards
15. Toggle ATK/DEF position (visual rotation)
16. Reorder cards within hand (drag to sort)
17. Keyboard shortcuts for common actions (draw, undo, redo, reset)

### MVP-C: Command Stack (Undo/Redo)

Comfort layer for iterative combo exploration.

18. Undo/redo actions (Command pattern — delta-based commands with CompositeCommand for batch operations)

### Phase 2: Growth & Polish

Solo enhancements for a more complete experience.

- Token creation on the field
- Life point counter
- Phase tracking (Draw, Standby, Main 1, Battle, Main 2, End)
- Save/load board states mid-combo
- Record and share combo sequences

### Risk Mitigation Strategy

**Technical Risks:**
- *Drag & drop with 18 zones:* Mitigated — `cdkDropListGroup` auto-connects all zones. Proven pattern. Ensure CDK version >= 19.1.6 to avoid known performance regression.
- *Command pattern complexity:* Mitigated — delta-based commands are well-established. Shuffle stores order snapshot. CompositeCommand handles batch operations. ~10 command types cover all actions.
- *Performance with full board:* Mitigated — OnPush change detection + Angular signals + `cdkDropListSortingDisabled` on single-card zones.
- *Board layout with 18 zones:* Mitigated — design a minimal wireframe/grid layout before coding. Plan the board grid upfront to avoid a functional but visually cluttered result.

**Market Risks:** None — personal project for personal use.

**Resource Risks:** The 3 internal MVP milestones (A/B/C) provide natural stopping points — each sub-phase delivers a usable product.

## User Journeys

### Journey 1: The Combo Builder — Happy Path

Axel vient de finir la construction d'un nouveau deck Tearlaments dans skytrix. Il a ajoute les dernieres cartes, peaufine le ratio. Maintenant, la question qui le travaille : "est-ce que mon combo turn 1 passe ?"

Actuellement, il n'a aucun moyen de le savoir sans aller en duel reel. Il doit esperer tomber sur la bonne main.

Avec le simulateur : depuis la page de son deck, il clique **"Tester"**. Le simulateur charge son deck, shuffle, et lui distribue 5 cartes. Il regarde sa main — parfait, il a ses starters. Il commence a derouler : normal summon, effet, mill 3 depuis le deck, une Tearlaments tombe au cimetiere, il l'active depuis le GY, fusion... En 8 actions fluides via drag & drop, son board final est pose. Son combo passe. Il clique **Reset**, reteste 4-5 mains differentes, identifie que 3 fois sur 5 il a une main jouable. Confiance acquise — il sait que son deck tient la route.

**Capabilities revealed:** deck loading, shuffle, draw, drag & drop, mill, graveyard interaction, pick from zone, reset, card tooltip for effect reference

### Journey 2: The Optimizer — Iteration & Edge Cases

Axel teste son deck et tombe sur une main briquee — aucun starter, que des extenders. Il veut comprendre pourquoi. Il utilise **search deck** pour regarder les cartes restantes et realise que ses 3 starters etaient en bas du deck. Il note qu'il devrait peut-etre ajouter un 4eme starter.

Il modifie son deck (retour a la page deck builder), revient au simulateur, reteste. Cette fois, il deroule un combo mais se trompe a l'etape 5 — il envoie la mauvaise carte au cimetiere. Au lieu de tout recommencer, il fait **undo** deux fois, reprend au bon moment, et continue son combo.

Apres 10 tests, il a une bonne vision des forces et faiblesses de son deck. Il identifie qu'un ratio est a ajuster.

**Capabilities revealed:** search deck, undo/redo, iterative deck editing + retesting workflow, view stacked zones

### Journey 3: The Explorer — Learning a New Archetype

Axel decouvre un nouvel archetype et veut comprendre comment les cartes interagissent. Il cree un deck basique, lance le simulateur, et utilise **card detail on hover** intensivement pour relire les effets pendant qu'il teste. Il pose une carte face cachee, simule un tour adverse imaginaire, puis flip sa carte pour activer son effet. Il explore les differentes lignes de jeu possibles, utilisant le reveal pour voir ce qu'il aurait pioche, testant differentes sequences d'activation.

**Capabilities revealed:** card detail on hover, face-down/flip, reveal/excavate, exploratory play without constraints

### Journey Requirements Summary

| Capability | J1 | J2 | J3 |
|---|---|---|---|
| Deck loading from decklist | x | x | x |
| Shuffle & draw | x | x | x |
| Drag & drop between zones | x | x | x |
| Mill from deck | x | | |
| Search deck & pick | | x | |
| View stacked zones | | x | x |
| Undo/redo | | x | |
| Reset board | x | x | |
| Card detail on hover | x | | x |
| Face-down / flip | | | x |
| Reveal/excavate | | | x |
| ATK/DEF toggle | x | x | x |

*FR10 (drop zone highlighting), FR21 (empty deck prevention), FR24 (card count on stacked zones), and FR32 (keyboard shortcuts) are cross-cutting capabilities.*

## Web App Technical Context

- **Architecture:** Angular 19 SPA (frontend) + Spring Boot API (backend, existing). Solo mode is 100% frontend — no backend changes required.
- **Routes:** `/decks/:id/simulator` (solo mode, existing)
- **Browser Support:** Modern browsers — desktop (Chrome, Firefox, Edge, Safari latest two versions) and mobile (Chrome Android, Safari iOS latest two versions)
- **SEO:** Not applicable — authenticated features
- **Real-time:** Not needed — all state local to browser session
- **Responsive Design:** Responsive multi-device — deck management pages use fluid layouts with breakpoints (mobile-first CSS). The simulator board uses a fixed aspect ratio (1060x772) with proportional scaling on all devices; mobile adds a tap-to-place interaction mode and landscape-locked display.
- **Performance Targets:** Drag & drop within 16ms frame budget
- **Reuses:** Existing services (card data, deck data, card images), existing card-tooltip component
- **Dependencies:** Angular CDK DragDrop (already installed)

## Functional Requirements

### Simulation Initialization

- FR1: The player can launch a simulation from any existing decklist
- FR2: The system loads main deck cards into the main deck zone and extra deck cards into the extra deck zone
- FR3: The player can shuffle the main deck
- FR4: The system draws an initial hand of 5 cards from the top of the shuffled deck
- FR5: The player can shuffle the deck at any point during the simulation

### Card Movement & Placement

- FR6: The player can move a card from any zone to any other zone via drag & drop
- FR7: The player can reorder cards within the hand zone
- FR8: The system enforces zone capacity (single-card zones accept only one card)
- FR9: All 18 physical game zones are available: hand, monster (1-5), spell/trap (1-5 — ST1/ST5 double as Pendulum L/R per Master Rule 5), Extra Monster (2), field spell, graveyard, banish, extra deck, main deck
- FR10: The player can see visual feedback on drop zones during drag, indicating which zones can accept the card

### Card Actions

- FR11: The player can draw one or more cards from the top of the deck to the hand
- FR12: The player can summon or set a card from hand to a monster zone
- FR13: The player can activate a card (move from hand to a spell/trap zone or field spell zone)
- FR14: The player can send any card on the board or in hand to the graveyard
- FR15: The player can banish any card on the board, in hand, or in the graveyard
- FR16: The player can return any card from any zone to the hand
- FR17: The player can return any card from any zone to the top or bottom of the deck

### Deck Operations

- FR18: The player can search the deck (view all cards) and pick a specific card to add to hand or another zone
- FR19: The player can mill a specified number of cards (send top N from deck to graveyard)
- FR20: The player can reveal/excavate the top N cards of the deck in a popup overlay for inspection, then return them or move them to other zones
- FR21: The system prevents drawing when the deck is empty and provides visual feedback

### Zone Inspection

- FR22: The player can view the full contents of any stacked zone (deck, graveyard, banish, extra deck) in an overlay
- FR23: The player can select and move a specific card from any stacked zone to another zone
- FR24: The player can see the card count for each stacked zone without opening it

### Card State & Information

- FR25: The player can set a card face-down (displaying card back)
- FR26: The player can flip a face-down card face-up
- FR27: The player can toggle a monster's battle position (ATK/DEF visual indicator)
- FR28: The player can view card details (enlarged image and effect text) by hovering over any card via the card inspector side panel. Face-down cards show full card details — face-down is a positional state, not an information barrier in solo context.

### Session Management

- FR29: The player can undo the last action performed
- FR30: The player can redo a previously undone action
- FR31: The player can undo/redo batch operations as a single unit (e.g., mill 3 undoes all 3 card moves at once)
- FR32: The player can perform common actions via keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo, Escape close overlay). No keyboard shortcut for Reset.
- FR33: The player can reset the entire board to the initial state (re-shuffle and re-draw)
- FR34: The simulator is accessible only to authenticated users from the deck detail page

## Non-Functional Requirements

### Performance

- NFR1: Drag & drop interactions render within a single animation frame (<16ms) with no visible jank
- NFR2: Board state updates (card moved, flipped, position toggled) reflect visually within 100ms
- NFR3: Board reset completes in under 1 second including re-shuffle and re-draw
- NFR4: The simulator remains responsive with a full board state (20+ cards across zones)
- NFR5: Card inspector panel appears within 200ms of hover
- NFR6: Zone overlays (deck search, graveyard view) open within 300ms regardless of card count

### Security

- NFR7: The simulator route is protected by existing authentication — unauthenticated users cannot access it. Verified by: unauthenticated access attempt returns 401/redirect to login
- NFR8: No card data or solo simulation state is transmitted to the backend — all solo processing remains client-side. Verified by: network inspector shows zero API calls during solo simulation session

### Compatibility

- NFR9: The application functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). The simulator locks to landscape orientation on mobile devices.
- NFR10: The simulator integrates with the existing skytrix build and deployment pipeline without additional configuration. Verified by: `ng build` succeeds with zero additional flags or environment variables

### Responsiveness

- NFR11: Deck management pages (deck list, deck detail, deck builder) are usable on viewports from 375px width (mobile portrait) to 2560px+ (ultrawide desktop) without horizontal scrolling
- NFR12: All interactive elements meet minimum touch target size of 44x44px on mobile viewports
- NFR12b: Deck management pages target WCAG 2.1 AA compliance (color contrast, keyboard navigation, screen reader labels). The simulator board is exempt due to its specialized visual interaction model
