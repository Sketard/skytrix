---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
inputDocuments: ['prd.md', 'architecture.md', 'project-context.md']
---

# UX Design Specification skytrix

**Author:** Axel
**Date:** 2026-02-08

---

## Executive Summary

### Project Vision

A solo Yu-Gi-Oh! combo testing simulator integrated into the existing skytrix deck management application. The simulator provides a fully manual, visually polished game board where players can load any decklist, draw a hand, and execute card actions via drag & drop across 18 physical game zones. No rules engine — full manual control for maximum flexibility. Visual reference: Yu-Gi-Oh! Master Duel aesthetics.

The core workflow is: build deck → test combos → iterate — all within a single application, eliminating the need for external simulators like DB Grinder or EDOPro.

### Target Users

**Primary User:** Axel — solo developer and competitive Yu-Gi-Oh! player who builds and optimizes decks in skytrix. High technical proficiency. Desktop-first usage with short, repetitive testing sessions (5-10 hands per deck iteration).

**Usage Context:** Personal tool for personal use. Sessions are short and iterative — load deck, test hands, identify weaknesses, adjust deck, retest. The simulator must support rapid reset-and-retry cycles.

### Key Design Challenges

1. **Visual Density Management** — 18 zones on a single screen. The board must remain readable with 10+ cards in play. Clear visual hierarchy between primary zones (monster, spell/trap, hand) and secondary zones (banish, extra deck). Future mobile adaptation must be considered in the CSS Grid layout design.
2. **Action Discoverability** — Without a rules engine to guide the player, all available actions (mill, search, reveal, flip, toggle position, banish, return to hand/deck) must be intuitively discoverable through the interface. No tutorial — the UI must be self-explanatory.
3. **Drag & Drop Precision** — Targeting the correct zone among 18 while dragging a card. Visual feedback during drag (zone highlighting, capacity indicators) is critical to avoid frustrating mis-drops.
4. **Future Mobile Readiness** — While MVP is desktop-only, the layout architecture (CSS Grid) should be designed with eventual portrait/touch adaptation in mind to avoid a full redesign later.

### Design Opportunities

1. **Visual Polish as Differentiator** — Master Duel-inspired aesthetics set this apart from every existing combo testing tool. The visual quality becomes a reason to use skytrix over functional-but-ugly alternatives.
2. **Integrated Workflow Fluidity** — Seamless transition from deck builder to simulator and back. No competitor offers this integrated experience. The "Test" button from the deck detail page is a one-click bridge.
3. **Undo/Redo as Exploration Superpower** — Iterative combo exploration without full resets. Players can branch, backtrack, and explore alternative play lines — a capability no traditional simulator provides.

## Core User Experience

### Defining Experience

The simulator's core experience is defined by a single interaction: **dragging a card from one zone to another**. Every feature in the simulator — summoning, activating, milling, searching, banishing, returning — is a variation of moving a card between zones. If this one interaction is fluid, precise, and visually satisfying, the entire product succeeds.

The core loop is: **load deck → shuffle → draw 5 → execute combo via drag & drop → evaluate board → reset → retry**. This cycle must complete in seconds, not minutes. The simulator exists to answer one question fast: "does my combo work?"

### Platform Strategy

- **Primary Platform:** Desktop web (Angular 19 SPA) — mouse + keyboard interaction
- **Input Model:** Mouse-driven drag & drop as primary, keyboard shortcuts as accelerators
- **Hover Dependency:** Card tooltips on hover are integral to the experience — desktop-only capability leveraged fully
- **Screen Requirements:** Large screen assumed — 18 zones displayed simultaneously without scrolling
- **Future Mobile Consideration (Post-MVP):** CSS Grid layout architecture will use relative units and named grid areas to enable eventual portrait/touch adaptation without full redesign. Pill and overlay interactions will need touch equivalents (tap, long press) in mobile version.
- **Offline:** Not required — deck data loaded at initialization, then all processing is client-side and ephemeral
- **No Backend Dependency:** Zero network calls during simulation — all state is local

### Effortless Interactions

1. **Drag & Drop as Natural Language** — Grab a card, drop it where you want. No context menus, no confirmation dialogs, no intermediate steps. The card goes where you put it.
2. **Drop Zone Illumination** — During drag, valid target zones highlight. The player instinctively knows where to drop without memorizing zone rules.
3. **Instant Undo** — Ctrl+Z works exactly like any editor. No "are you sure?" — just immediate reversal. Redo with Ctrl+Y.
4. **One-Click Reset** — Single button with brief confirmation returns to a fresh shuffled hand. Competitors require quitting and relaunching.
5. **Passive Card Info** — Hover to read card effects. No click needed, no mode to enter. Information is always one hover away.
6. **Automatic Zone Behavior** — Single-card zones reject drops when occupied (card returns to origin). No error messages — the interface just does the right thing.

### Pill Interaction System

Pills are contextual action buttons that provide access to stacked zone operations. They are a **minimal complement** to drag & drop, not a parallel interaction system. Pills exist only where drag alone cannot reach: **hidden cards inside stacked zones**.

**Zone Pills (Stacked Zones — Essential):**
- Appear on **click** (not hover) on stacked zones (deck, graveyard, banish, extra deck)
- Click trigger avoids accidental activations during drag operations across the board
- Primary purpose: open the pile view overlay to see and interact with stacked cards
- Zone-specific actions: Draw, Mill N, Shuffle, Search (deck); View (GY, banish, extra deck)
- These are the ONLY way to access hidden/stacked cards — essential for gameplay

**Card Pills (Board Cards — Nice-to-Have, Post-MVP-A):**
- Optional shortcut pills on hover over cards on the board (Send to GY, Banish, Flip, Toggle ATK/DEF)
- Not required for MVP-A — drag & drop already covers all card-to-zone movements
- Can be added as comfort layer if drag-only testing reveals friction points

**Pill-to-Drag Flow:**
- Zone pills open a **side or bottom overlay** (not fullscreen centered) to keep the board visible as a drag target
- Player selects a card in the overlay, then drags it to any target zone on the board
- This two-step flow (click opens access → drag completes placement) preserves drag-first philosophy
- The overlay position ensures drop zones remain accessible during the drag

**Display Rules:**
- Pills are NEVER permanently visible — they appear on click (zones) only
- A global `isDragging` flag suppresses all pill display during active drag operations — no distracting pop-ins while moving cards
- Pills disappear when the player starts dragging or clicks elsewhere
- The board remains visually clean at rest, interactive on engagement

### Critical Success Moments

1. **"This is better" Moment** — First drag & drop interaction. The card moves smoothly, the target zone highlights, the drop feels precise. The visual polish exceeds EDOPro and DB Grinder immediately.
2. **"This is what I needed" Moment** — First complete combo (10+ actions) executes without friction. The board matches the intended end state. The player knows the combo works.
3. **"Make or Break" Interaction** — A mis-drop or drag lag during a combo sequence. If undo is not instant and obvious, frustration kills the experience. The undo must be as fast as the mistake.
4. **"Why didn't this exist before" Moment** — Clicking "Test" from the deck page, landing directly in the simulator with the deck loaded. The integrated workflow is the unique value.
5. **"I can explore freely" Moment** — Using undo to backtrack 3 actions, trying an alternative line, then undoing again to try a third option. No fear, no penalty, pure exploration.
6. **"Stacked zones feel accessible" Moment** — Clicking the graveyard, seeing the pile in a side overlay, picking a card, and dragging it to the field — all in one fluid motion. Hidden cards are never out of reach.

### Experience Principles

1. **Drag-First** — Drag & drop is THE interaction mode. Everything is draggable, everywhere is droppable (where valid). Pills exist only where drag cannot reach (stacked zone access). Even stacked zone interactions conclude with a drag.
2. **Zero Friction Cycles** — The test-reset-retry cycle must be as fast as the player's thought. No friction between intention and action. Every transition (load, reset, draw) is near-instant.
3. **Visual Clarity Under Density** — 18 zones, 40+ cards — the board must remain readable. Strict visual hierarchy between primary zones (monsters, spells, hand) and secondary zones (banish, extra deck). Pills appear only on click, are suppressed during drag — the board stays clean.
4. **Forgiving Exploration** — Undo/redo makes every action reversible. The player explores without fear of "breaking" the board state. Mistakes are cheap, experimentation is encouraged.
5. **Progressive Disclosure** — The board at rest is minimal and uncluttered. Complexity reveals itself on interaction: pills appear on click, overlays open to the side, card details show on hover. The interface is as simple or as rich as the player needs in the moment.

## Desired Emotional Response

### Primary Emotional Goals

1. **Mastery & Control** — "I control every card, every action. Nothing escapes me." The simulator is a precision tool that responds exactly to the player's intent. Full manual control reinforces the feeling of expertise.
2. **Flow & Immersion** — "I don't think about the interface, only my combo." The UI disappears during play. Drag & drop is so fluid that the player's focus stays on card interactions, not on operating the tool.
3. **Confidence** — "My deck works, I proved it in 5 tests." The simulator transforms uncertainty into validated knowledge. After a testing session, the player knows their deck's strengths and weaknesses.
4. **Aesthetic Satisfaction** — "It's beautiful, it's a pleasure to play on." Master Duel-level visual polish turns every card placement into a micro-moment of delight. The board is a visual experience, not just a functional grid.
5. **Lucidity** — "My deck has a problem, now I know which one." Even negative results (bricked hands, failed combos) are successes of the tool. The simulator reveals truth about the deck — the design must frame negative outcomes as actionable insight, not discouragement.

### Emotional Journey Mapping

| Moment | Target Emotion |
|---|---|
| First visit — empty board with deck loaded | Recognition — the layout matches a familiar Yu-Gi-Oh! playmat. No learning needed, instant confidence. |
| Click "Test" from deck page | Anticipation — "let's see what this deck can do" |
| Initial hand of 5 displayed | Excitement or clarity — "I have my starters!" or "bricked, quick reset" |
| During combo execution (drag & drop) | Flow / immersion — the interface vanishes, only the combo matters |
| Final board state achieved | Satisfaction / pride — "my combo works, the board is clean" |
| Mid-combo mistake | Serenity (not frustration) — Ctrl+Z, resume. No big deal. |
| Board reset | Renewal — clean slate in 1 second, fresh start |
| After 5-10 test hands (positive) | Confidence — "I know my deck, its strengths and weaknesses" |
| After 5-10 test hands (negative — bricked) | Lucidity — "my deck has a ratio problem, I know what to fix". The ultra-fast reset cycle encourages retesting rather than abandoning. |
| Return to deck builder | Motivation — "I know exactly what to adjust" |

### Micro-Emotions

**Critical Emotional Pairs (desired > avoided):**

- **Recognition > Confusion** — First-time users instantly recognize the Yu-Gi-Oh! playmat layout. No tutorial needed, no learning curve for the board structure.
- **Confidence > Confusion** — Every zone is clear, every action is obvious. Never "what can I do here?"
- **Flow > Frustration** — Drag is precise, undo is instant. No friction that breaks the rhythm.
- **Satisfaction > Impatience** — Reset is instant, shuffle is fast. Never waiting.
- **Delight > Mere satisfaction** — Master Duel visual polish transforms a mundane action (placing a card) into a micro-moment of pleasure.
- **Lucidity > Discouragement** — Negative test results are framed as useful discovery, not failure. The ease of reset-and-retry turns disappointment into iteration.

### Design Implications

| Emotion | Supporting UX Choices |
|---|---|
| **Recognition** | Board layout mirrors standard Yu-Gi-Oh! playmat zones — familiar spatial arrangement eliminates onboarding |
| **Mastery** | 100% manual control, no imposed rules, all zones accessible, no artificial constraints |
| **Flow** | Drag & drop < 16ms, zero confirmation dialogs during play, non-intrusive pills, keyboard shortcuts |
| **Confidence** | Drop zone highlighting during drag, undo always available, card info on hover, clear zone labels |
| **Aesthetic Satisfaction** | Master Duel-inspired visuals, smooth placement animations, clean board at rest, polished card rendering |
| **Serenity on Error** | Instant undo, redo available, reset without penalty, silent rejection of invalid drops |
| **Lucidity** | Ultra-fast reset encourages retesting, seamless return to deck builder for adjustments |

### Emotional Design Principles

1. **The Interface Disappears** — During active play, the UI should be invisible. The player sees cards and zones, not buttons and borders. Chrome and controls fade to the background.
2. **Mistakes Are Free** — Every error is instantly reversible. The emotional cost of a wrong action is zero. This encourages bold exploration over cautious play.
3. **Flow > Beauty** — Aesthetic polish serves the rhythm, never the reverse. Animations must be < 100ms or interruptible by the next action. If a player drags a second card while the first is animating, the first animation completes instantly. Beauty is the spice, flow is the meal.
4. **Momentum Never Breaks** — No loading screens, no spinners, no "processing" states. Every action completes within the player's attention span. The combo rhythm is sacred.
5. **Recognition Over Learning** — The board layout mirrors the physical Yu-Gi-Oh! playmat that every player knows. Spatial familiarity replaces tutorials. First-time confidence is built through recognition, not instruction.
6. **Negative Results Are Wins** — The simulator reveals truth about a deck. Bricked hands are not failures — they are actionable data. The design encourages rapid iteration: reset fast, retest, adjust, repeat.

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

**Yu-Gi-Oh! Master Duel (Primary Visual Reference):**
- Premium board aesthetics: dark atmospheric background with luminous zone accents
- Zones delimited by subtle borders — clean grid without visual heaviness
- Card rendering with shadow and elevation during interactions
- Stacked zone access via click on zone icon → overlay expansion
- Weakness to avoid: long, blocking animations during chain resolution

**Hearthstone (Primary Interaction Reference):**
- Gold standard for card game drag & drop — fluid, satisfying, physically weighted
- Cards follow the cursor with slight inertia, creating a tactile sensation
- Valid drop zones illuminate during drag — instant visual guidance
- Invalid drops return the card to origin with a smooth animation, zero error messages
- Minimalist board despite many elements — visual clarity under density
- Short, interruptible animations that never block the next action

**EDOPro / DB Grinder (Anti-Reference):**
- Functionally complete but visually austere — utility-first design
- Context menus (right-click → dropdown → select action) create unnecessary friction
- Information overload: counters, logs, and statuses always visible
- These represent the UX baseline to surpass — same functionality, radically better interaction

### Transferable UX Patterns

**Interaction Patterns:**
- **Physical drag feedback** (from Hearthstone) — card follows cursor with slight weight/inertia, creating a tactile sensation during drag. Reinforces the Mastery emotion.
- **Zone highlighting during drag** (from Hearthstone) — valid target zones illuminate, invalid zones stay neutral. Directly transferable to all 18 simulator zones. Supports Confidence emotion.
- **Silent invalid drop recovery** (from Hearthstone) — card returns to origin with smooth animation on invalid drop. No error toast, no dialog. Supports Serenity on Error emotion.
- **Click-to-expand stacked zones** (from Master Duel) — click on GY/deck/banish icon opens an overlay showing all cards. Maps directly to zone pills system.

**Visual Patterns:**
- **Atmospheric board** (from Master Duel) — dark background with luminous accents on active zones. The board has visual presence without distracting from cards. Supports Aesthetic Satisfaction emotion.
- **Subtle zone borders** (from Master Duel) — thin lines that define zones without creating a heavy grid. Borders can intensify during drag for guidance. Supports Visual Clarity Under Density principle.
- **Card elevation on drag** (from Hearthstone) — shadow and slight scale increase when a card is picked up, reinforcing the physical metaphor. Supports Flow & Immersion emotion.

**Navigation Patterns:**
- **Overlay for pile inspection** (from both) — side/bottom overlay shows stacked zone contents without obscuring the board. Player can drag from overlay to board. Supports Progressive Disclosure principle.

### Anti-Patterns to Avoid

1. **Context menus for card actions** (EDOPro pattern) — Right-click → dropdown menu → select action. Too many clicks, breaks flow. Replace with direct drag & drop.
2. **Blocking animations** (Master Duel pattern) — Animations that prevent the next action from starting. Violates Flow > Beauty principle. All animations must be < 100ms or interruptible.
3. **Permanent information overload** (DB Grinder pattern) — Counters, logs, and status indicators always visible. Violates Progressive Disclosure principle. Show information on demand only.
4. **Mid-game confirmation dialogs** (Hearthstone "end turn" pattern) — For a solo simulator with undo/redo and no consequences, zero confirmation dialogs during play. Only exception: board reset (destructive, clears undo stack).
5. **Tiny touch targets** (general mobile anti-pattern) — Even on desktop, zones must be large enough for precise drops. Future mobile adaptation requires generous tap targets.

### Design Inspiration Strategy

**Adopt As-Is:**
- Hearthstone's drag & drop feedback model (physical weight, zone highlighting, silent recovery)
- Master Duel's click-to-expand pattern for stacked zones
- Hearthstone's short, interruptible animation philosophy

**Adapt to Context:**
- Master Duel's atmospheric board aesthetic — adapted for an 18-zone board (denser than Master Duel's ~12 visible zones). Simplify visual effects to maintain performance.
- Card elevation/shadow effects — use CSS box-shadow and transform: scale() rather than complex shader-like effects. Performance-first adaptation.
- Overlay positioning — adapt to side/bottom placement (not centered fullscreen) to maintain board visibility during pill-to-drag flow.

**Explicitly Avoid:**
- EDOPro's context menu interaction model — replaced entirely by drag-first + pills
- Master Duel's blocking animation sequences — all animations are interruptible or < 100ms
- DB Grinder's utility-first visual approach — aesthetic polish is a core differentiator, not optional
- Any pattern that adds clicks between intention and action

## Design System Foundation

### Design System Choice

**Angular Material 19.1.1 (Existing) + Custom Simulator Theme**

The design system is predetermined by the brownfield context. skytrix already uses Angular Material with CDK. The simulator extends this foundation with a dedicated visual theme for the game board while reusing Material infrastructure for standard UI elements.

Zero new dependencies — Architecture decision enforced.

### Rationale for Selection

1. **Brownfield constraint** — Angular Material is already installed, themed, and used across the application. Adding a second design system would create inconsistency and bloat.
2. **CDK DragDrop** — The drag & drop infrastructure is part of Angular CDK, already installed. No alternative needed.
3. **Board is custom by nature** — No design system provides card game board components. The board layout, zone components, and card rendering are 100% custom regardless of design system choice.
4. **Material for standard UI** — Overlays, dialogs (reset confirmation), buttons (pills), tooltips — these are standard UI patterns where Material excels and is already in use.

### Implementation Approach

**Material Components Used in Simulator:**

| Component | Use Case |
|---|---|
| CDK DragDrop | All card drag & drop interactions, zone connections |
| CDK Overlay / mat-dialog | Pile inspection overlays (GY, banish, deck search, reveal) |
| mat-button | Zone pills (Draw, Mill, Shuffle, Search, View) |
| mat-icon | Zone labels, action indicators |
| mat-tooltip | Card detail on hover (reuses existing card-tooltip component) |
| mat-dialog | Reset confirmation dialog (only confirmation in the simulator) |

**Custom Components (No Material):**

| Component | Reason |
|---|---|
| Board layout (CSS Grid) | Unique 18-zone game board — no Material equivalent |
| Zone component | Custom zone rendering with capacity logic, dual-purpose Pendulum indicator |
| Stacked zone component | Card count badge + top card preview — game-specific rendering |
| Hand component | Ordered multi-card zone with free reordering — custom layout |
| Sim-card component | Card rendering (face-up/down, ATK/DEF rotation, drag handle) — game-specific |

### Customization Strategy

**Simulator Theme (SCSS Variables):**

A dedicated set of SCSS variables in `src/app/styles/` for the simulator page, coexisting with the existing app theme:

- **Board background:** Dark atmospheric tones (inspired by Master Duel) — deep navy/charcoal gradient
- **Zone borders:** Subtle luminous lines — low opacity at rest, intensified during drag hover
- **Zone highlighting:** Accent color glow on valid drop targets during drag
- **Card shadows:** Elevation effect on drag (box-shadow + slight scale transform)
- **Stacked zone badges:** Card count indicators with semi-transparent background
- **Pill buttons:** Compact, semi-transparent buttons that blend with the board aesthetic
- **Overlay backdrop:** Semi-transparent dark overlay that dims the board without hiding it

**Theme Isolation:**
- Simulator styles are scoped to the simulator page component (Angular ViewEncapsulation default)
- No impact on existing app theming
- Shared SCSS variables allow consistency with the broader skytrix palette where appropriate (accent colors, typography)

## Defining Core Experience

### Defining Experience

**"Drag cards across a Yu-Gi-Oh! board to test your combo in seconds."**

The simulator's identity is captured in one interaction: picking up a card and placing it exactly where you want on a familiar playmat. Every feature — mill, search, banish, summon, activate — is a variation of this single gesture. If the drag & drop feels perfect, the product succeeds. If it doesn't, nothing else matters.

### User Mental Model

**Current Problem-Solving:**
- Real duels (EDOPro, Master Duel) — must play a full game to test one combo. Relies on drawing the right hand by chance.
- Mental simulation — reading card effects and imagining sequences. Unreliable, error-prone for complex combos.

**Mental Model the Player Brings:**
- The Yu-Gi-Oh! playmat is hardcoded in muscle memory — zone positions are instinctive, not learned
- Combos are thought of as linear sequences with branches: normal summon → effect → mill → trigger → fusion
- Cards are physical objects to be picked up and placed — not data entries in a form
- The deck is a stack to draw from, the graveyard is a pile to browse — real-world metaphors apply directly

**Expectations:**
- The board looks like the playmat I know
- Moving a card = grab it and put it somewhere. Not "select → choose destination → confirm"
- The combo result is visible at a glance on the final board state
- If I make a mistake, I undo it like in any editor

### Success Criteria

| Criteria | Indicator |
|---|---|
| **"It just works"** | A card lands exactly where intended on first try. Zero mis-drops in a typical session. |
| **Feeling competent** | A 10-action combo executes in under 15 seconds with no pauses or hesitation. |
| **Correct feedback** | Card snaps into zone with subtle visual confirmation (glow/shadow settle). Board state updates instantly. |
| **Perceived speed** | Every action completes before the player thinks about the next one. No perceptible delay between intention and result. |
| **Automatic behavior** | Shuffle on init, card count updates, zone capacity enforcement, undo stack tracking — all invisible to the player. |
| **Session success** | After 5-10 hands, the player has a clear mental model of their deck's consistency and knows what to adjust. |

### Novel UX Patterns

**Established Patterns (Adopt — zero education needed):**
- Drag & drop card movement (Hearthstone convention)
- Playmat zone layout (Yu-Gi-Oh! convention — every player knows it)
- Click on stacked zone to inspect (Master Duel convention)
- Ctrl+Z / Ctrl+Y for undo/redo (universal convention)
- Keyboard shortcuts for frequent actions (universal convention)

**Innovative Combinations (Our twist — naturally discoverable):**
- **Pill-to-drag flow** — click stacked zone → overlay opens → pick card → drag to board. Combines two known conventions (click-overlay + drag-drop) into a new flow. Naturally discoverable: "I click to see, I drag to act."
- **Undo in a card simulator** — existing simulators have no undo. Applying the universal Ctrl+Z pattern to a card game is novel but requires zero education because the gesture is already known.

**Nothing requires a tutorial.** All patterns are either established conventions or natural combinations of known interactions.

### Experience Mechanics

**The Drag & Drop Interaction — Step by Step:**

**1. Initiation:**
- Player hovers a card → cursor changes to grab
- Player clicks and holds → card "lifts" (scale: 1.05, box-shadow increases)
- Board enters drag mode: valid zones illuminate, `isDragging` flag suppresses pills
- CDK creates a drag preview that follows the cursor

**2. Interaction:**
- Card follows cursor with slight physical weight (CDK drag constraint)
- Valid target zones glow with accent color on hover
- Invalid zones (occupied single-card) show no reaction — silent rejection
- Hand zone allows reordering (sorting enabled)
- The player's focus is on the destination, not the interface

**3. Feedback:**
- Drop on valid zone: card snaps into position (< 100ms transition), subtle glow settles
- Drop on invalid zone: card returns to origin with smooth animation (CDK default behavior)
- Board state signal updates → computed signals propagate → OnPush re-renders affected zones only
- Command pushed to undo stack (invisible to player, instant)

**4. Completion:**
- Card is placed, board reflects the new state immediately
- Player moves to next action — zero pause, zero confirmation
- Combo complete: player observes final board, evaluates result
- Next action: reset for another hand, undo to try alternative, or return to deck builder

## Visual Design Foundation

### Color System

**Palette Philosophy:** Dark atmospheric board inspired by Master Duel — the simulator has its own visual universe, independent from the main skytrix app theme. The board is a stage where cards are the stars.

**Dual-Accent System:**
- **Cyan `#00d4ff`** — Primary interactive accent. Used for: drag zone highlighting, active pills, focused elements, interactive borders. Cyan = "you can act here."
- **Gold `#d4a017`** — Secondary status accent. Used for: successful card placement glow (settle animation), full zone badges, completion feedback. Gold = "something happened here."

**SCSS Token Map:**

| Token | Value | Usage |
|---|---|---|
| `$sim-bg` | `#0a0e1a` | Board background base (deep navy) |
| `$sim-surface` | `#111827` | Zone surface, overlay background |
| `$sim-surface-elevated` | `#1e293b` | Elevated surfaces (cards, active overlays) |
| `$sim-accent-primary` | `#00d4ff` | Interactive elements — drag highlights, pills, focus |
| `$sim-accent-secondary` | `#d4a017` | Status/reward — placement glow, success feedback |
| `$sim-zone-border` | `rgba(#00d4ff, 0.15)` | Zone borders at rest — subtle, luminous |
| `$sim-zone-highlight` | `rgba(#00d4ff, 0.3)` | Valid drop zone highlight during drag |
| `$sim-zone-glow-success` | `rgba(#d4a017, 0.4)` | Card placement settle glow |
| `$sim-text-primary` | `#f1f5f9` | Primary text — high contrast on dark |
| `$sim-text-secondary` | `#94a3b8` | Secondary text — labels, counts |
| `$sim-error` | `#ef4444` | Semantic error (reserved, rarely used in solo context) |
| `$sim-overlay-backdrop` | `rgba(#0a0e1a, 0.7)` | Overlay backdrop — dims board without hiding it |

**Color Rule:** Maximum 3 active colors on the board at any moment (cyan + gold + card art). Semantic colors (red, orange) stay in background — almost never appear in solo simulator context.

### Typography System

**Single Font Family:** Roboto (already bundled with Angular Material — zero additional network requests, zero FOIT risk).

**Hierarchy through weight and size, not font variety:**

| Element | Size | Weight | Usage |
|---|---|---|---|
| Zone labels | `0.75rem` | 500 | Zone identification (Monster, S/T, GY...) |
| Card name (overlay) | `0.875rem` | 500 | Card names in pile inspection — scannable at speed |
| Card count badge | `0.75rem` | 700 | Stacked zone card count (bold for visibility at small size) |
| Pill button text | `0.8125rem` | 500 | Zone action pills (Draw, Mill, Shuffle...) |
| Overlay heading | `1rem` | 600 | Overlay titles (Graveyard, Banished, Search...) |
| Body/tooltip text | `0.875rem` | 400 | Card effect text, tooltips, descriptions |

**Typography Principle:** On the board, text is minimal — zone labels and card counts only. Card names and details appear in overlays and tooltips (Progressive Disclosure). The board speaks through card art and spatial position, not text.

### Spacing & Layout Foundation

**Base Unit:** 4px (aligned with Angular Material's density system).

**Board Gaps:** Defined in `rem` (not `px`) for future mobile scalability — gaps scale with viewport when rem base is adjusted.

**Spacing Tokens:**

| Token | Value | Usage |
|---|---|---|
| `$sim-gap-zone` | `0.5rem` | Gap between board zones (CSS Grid gap) |
| `$sim-gap-card` | `0.25rem` | Gap between cards within a zone (hand spacing) |
| `$sim-padding-zone` | `0.5rem` | Internal zone padding |
| `$sim-padding-overlay` | `1rem` | Overlay internal padding |
| `$sim-radius-zone` | `0.375rem` | Zone border radius (subtle rounding) |
| `$sim-radius-card` | `0.25rem` | Card border radius |

**Layout Principles:**
1. **Fullscreen board** — The simulator board occupies 100% of the viewport. No sidebar, no permanent toolbar. Controls appear contextually (pills, overlays).
2. **CSS Grid with named areas** — Each of the 18 zones has a named grid area. Mobile adaptation will rearrange areas without changing component structure.
3. **Relative sizing** — Zone dimensions use `fr` units and `minmax()` for responsive behavior within the grid. Cards scale proportionally.
4. **Overlay positioning** — Pile overlays open to the side or bottom (never centered fullscreen) to keep the board visible as a drag target during pill-to-drag flow.

### Accessibility Considerations

**Contrast Compliance:**
- Primary text (`#f1f5f9`) on board background (`#0a0e1a`): contrast ratio ~15.4:1 (exceeds WCAG AAA)
- Secondary text (`#94a3b8`) on board background: contrast ratio ~6.5:1 (exceeds WCAG AA)
- Cyan accent on dark surface: contrast ratio ~8.2:1 (exceeds WCAG AA for UI components)
- Gold accent on dark surface: contrast ratio ~7.1:1 (exceeds WCAG AA for UI components)

**Interaction Accessibility:**
- Zone highlighting during drag provides non-color feedback (border intensification + subtle glow spread)
- Card elevation on drag (shadow + scale) provides non-color depth cue
- Pill buttons meet minimum 44x32px touch target for future mobile adaptation
- Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+R) provide non-mouse interaction paths

## Design Direction Decision

### Design Directions Explored

Eight design directions were generated and evaluated via interactive HTML mockups ([ux-design-directions.html](ux-design-directions.html)):

1. **Master Duel Classic** — Subtle cyan borders, dark navy surfaces, atmospheric. Faithful to Master Duel premium aesthetics.
2. **Neon Arena** — Amplified neon glow, electric atmosphere. High visual intensity.
3. **Clean Minimal** — Near-invisible zones at rest, maximum card focus.
4. **Frosted Glass** — Glassmorphism, translucent panels, rounded corners. Modern/iOS aesthetic.
5. **Elevation Rich** — Depth through shadow only (no borders). Physical, layered feel.
6. **Bold Grid** — Thick geometric borders, uppercase labels. Blueprint precision.
7. **Ambient Glow** — Inner zone illumination, warm golden field zone. Magical atmosphere.
8. **Stealth Dark** — Invisible at rest, zones materialize on interaction only.

### Chosen Direction

**Direction 1: Master Duel Classic** — selected for its faithful balance between Master Duel premium aesthetics and functional clarity. Subtle cyan borders define zones without visual heaviness. Dark atmospheric surfaces create depth while keeping card art as the visual focus.

### Board Layout (Corrected)

The board uses a **7-column x 4-row CSS Grid**, matching the official Yu-Gi-Oh! playmat layout:

```
   .     |   .   | EMZ-L |   .   | EMZ-R |   .   | Banish
 Field   |  M-1  |  M-2  |  M-3  |  M-4  |  M-5  |   GY
   ED    | ST-1  |  ST-2 |  ST-3 |  ST-4 |  ST-5 |  Deck
Controls |              Hand (5 cols)              |   .
```

**Zone Notes:**
- **ST-1** doubles as **Pendulum Left** zone. **ST-5** doubles as **Pendulum Right** zone (per Master Rule 5).
- **EMZ-L** and **EMZ-R** are Extra Monster Zones, positioned above M-2 and M-4 respectively.
- **Controls row**: Undo / Redo / Reset buttons aligned left, Hand zone spans 5 central columns.
- **Deck** and **Extra Deck** display cards face-down by default.

**CSS Grid Template:**
```css
grid-template-areas:
  ".        .     emz-l   .      emz-r   .      banish"
  "field    m1    m2      m3     m4      m5     gy"
  "ed       st1   st2     st3    st4     st5    deck"
  "controls hand  hand    hand   hand    hand   .";
```

### Zone Interaction Rules

**One Zone = One Card** (with XYZ exception):
- Each Monster/S/T zone holds exactly one card (single-card zone behavior).
- **XYZ Exception:** An XYZ monster can have overlay materials stacked underneath. Materials are visually indicated by card borders peeking out below the XYZ card. Click on an XYZ card opens a pill showing all attached materials. Each material is individually draggable (detach material for XYZ effects).

**No Zone Restrictions:**
- Monsters CAN be placed in S/T zones (certain card effects require this).
- Cards CAN be dropped on the Main Deck (return to deck) or Extra Deck (Pendulum monsters return face-up).
- The simulator imposes no placement validation — full manual control.

**Stacked Zone Interactions:**
- **Deck / Extra Deck:** Right-click opens a small context menu (Shuffle, Search). No dedicated pill buttons for Mill — milling is done by dragging the top card from Deck to GY.
- **Graveyard / Banished:** Click opens side overlay with card list and card images. Cards are draggable from overlay to board.
- **Deck and ED are face-down** — card backs displayed. Extra Deck Pendulum monsters are face-up (game rule).

**Card Images in Overlay:**
- When a pile overlay (GY, Banished, Deck search) is open, card images are displayed alongside card names for visual identification. Design to be tested and iterated.

### Design Rationale

1. **Master Duel Classic** aligns directly with the project's stated visual reference (Master Duel premium aesthetics) without overcommitting to flashy effects that could distract during fast combo sequences.
2. The subtle border approach supports visual density management — 18 zones remain distinct without creating a heavy grid that competes with card art.
3. The atmospheric dark background reinforces the "board as stage" metaphor where cards are the visual focus.
4. Direction 1 is the most natural starting point — it can be refined toward more glow (Direction 7) or more minimalism (Direction 3) based on real usage feedback.

### Implementation Approach

**Template-Ready CSS Architecture:**
- All grid areas defined as SCSS variables for easy layout changes (future mobile, alternative layouts).
- Zone positions parameterized — swapping EMZ positions or adding zones requires only grid-template changes, no component restructuring.
- Card aspect ratios and zone proportions defined as tokens for consistent scaling.

**XYZ Overlay Material Rendering:**
- Materials rendered as stacked elements with `position: absolute` offset (2-3px per material) showing only the card border edge.
- Click handler on XYZ card toggles a pill overlay listing all attached materials.
- Each material in the pill is a CDK drag source, enabling detach-to-zone operations.

**Right-Click Context Menu:**
- CDK Overlay triggered on `contextmenu` event for Deck and Extra Deck zones.
- Minimal menu: Shuffle, Search (Deck) / View (Extra Deck).
- Menu dismissed on click outside or on action selection.

**Overlay with Card Images:**
- Pile inspection overlays display card thumbnail + card name per row.
- Card image loaded from existing skytrix card image service.
- Layout: card image (small) | card name | drag handle — each row is a CDK drag source.

## User Journey Flows

### Journey 1: The Combo Builder (Happy Path)

**Entry:** Deck detail page → click "Tester" button
**Goal:** Validate that a turn-1 combo works in 5-10 test hands

**Flow:**

```mermaid
flowchart TD
    A[Deck Detail Page] -->|Click 'Tester'| B[Simulator loads deck]
    B --> C[Board appears: deck face-down, 18 empty zones]
    C --> D[Auto: shuffle + draw 5 to hand]
    D --> E{Evaluate hand}
    E -->|Bricked| F[Click Reset → confirm → reshuffle + draw 5]
    F --> E
    E -->|Playable| G[Begin combo execution]
    G --> H[Drag card from Hand to Monster/S/T zone]
    H --> I[Zone highlights cyan during drag]
    I --> J[Drop → card snaps, gold settle glow]
    J --> K{Card triggers mill/search?}
    K -->|Mill| L[Drag top card from Deck to GY]
    K -->|Search| M[Right-click Deck → Search → overlay opens with card images]
    M --> N[Find card in overlay → drag to Hand or zone]
    K -->|No| O[Next action]
    L --> O
    N --> O
    O --> P{Combo complete?}
    P -->|No| H
    P -->|Yes| Q[Evaluate final board state]
    Q --> R{Satisfied?}
    R -->|Test another hand| F
    R -->|Adjust deck| S[Navigate back to Deck Builder]
    R -->|Done| T[Close simulator]
```

**Key Interactions:**
- **Drag from Hand → Zone:** Card lifts (scale 1.05), valid zones highlight cyan, drop snaps with gold glow
- **Mill:** No button — drag the visible top-card of the Deck directly to GY
- **Search Deck:** Right-click Deck → context menu "Search" → side overlay with card images → drag to destination
- **GY trigger:** Click GY zone → side overlay opens → see card with image → drag to field or banish
- **Reset:** Single button with brief confirmation → clears board, reshuffles, draws 5

### Journey 2: The Optimizer (Iteration & Edge Cases)

**Entry:** Mid-session after a bricked hand or failed combo
**Goal:** Diagnose deck weakness and iterate deck construction

**Flow:**

```mermaid
flowchart TD
    A[Bricked hand — no starters] --> B{Investigate why}
    B --> C[Right-click Deck → Search]
    C --> D[Overlay opens: browse deck with card images]
    D --> E[See starters stuck at bottom of deck]
    E --> F[Mental note: add 4th starter]
    F --> G[Navigate to Deck Builder]
    G --> H[Adjust deck ratios]
    H --> I[Click 'Tester' → simulator reloads updated deck]
    I --> J[Shuffle + draw 5]
    J --> K[Execute combo]
    K --> L{Mistake at step N?}
    L -->|Yes| M[Ctrl+Z — undo last action]
    M --> N{Need more undo?}
    N -->|Yes| M
    N -->|No| O[Resume combo from corrected state]
    O --> K
    L -->|No| P[Complete combo]
    P --> Q{XYZ summon needed?}
    Q -->|Yes| R[Drag 2 materials to same zone]
    R --> S[Drag XYZ monster from ED → on top of materials]
    S --> T[Materials stack under XYZ — borders visible]
    T --> U{Need to detach material?}
    U -->|Yes| V[Click XYZ card → pill shows materials]
    V --> W[Drag material from pill → GY or target zone]
    U -->|No| X[Continue combo]
    Q -->|No| X
    W --> X
    X --> Y[After 10 hands: deck strengths/weaknesses identified]
    Y --> G
```

**Key Interactions:**
- **Undo chain:** Ctrl+Z repeatedly rewinds action by action. Ctrl+Y to redo. No limit during session.
- **XYZ summon flow:** Place 2+ materials in a zone → place XYZ on top. Materials visually stack (borders peeking). Click XYZ card → pill overlay shows materials → each material draggable for detach.
- **Deck Search investigation:** Right-click Deck → Search. Overlay shows all remaining cards with images. Does NOT remove cards — just visual inspection. To actually take a card: drag from overlay to hand/zone.
- **Iterative loop:** Simulator ↔ Deck Builder. "Tester" button always loads the current deck state.

### Journey 3: The Explorer (Learning New Archetype)

**Entry:** New deck created with unfamiliar archetype
**Goal:** Understand card interactions and discover combo lines

**Flow:**

```mermaid
flowchart TD
    A[New archetype deck loaded] --> B[Shuffle + draw 5]
    B --> C[Hover cards in hand — read effects via tooltip]
    C --> D{Understand what to do?}
    D -->|Not sure| E[Hover more cards, re-read effects]
    D -->|Yes| F[Drag card to zone — try an action]
    F --> G{Card needs to be face-down?}
    G -->|Yes| H[Set card face-down in S/T zone]
    G -->|No| I[Place face-up in Monster/S/T zone]
    H --> J[Simulate opponent turn mentally]
    J --> K[Click face-down card → Flip face-up]
    K --> L[Read activated effect via hover]
    I --> L
    L --> M{Explore alternative line?}
    M -->|Yes| N[Ctrl+Z back N steps]
    N --> O[Try different card sequence]
    O --> F
    M -->|No| P{Want to see what comes next in deck?}
    P -->|Yes| Q[Right-click Deck → Search → browse remaining cards]
    Q --> R[Identify potential draws and plan next actions]
    P -->|No| S[Continue executing actions]
    R --> S
    S --> T{Satisfied with understanding?}
    T -->|Try another hand| U[Reset → reshuffle → draw 5]
    U --> C
    T -->|Done| V[Close simulator or adjust deck]
```

**Key Interactions:**
- **Heavy hover usage:** Tooltip shows card image + full effect text. Essential for learning unfamiliar cards.
- **Face-down / Flip:** Drag card to S/T zone face-down (toggle via right-click or card pill). Click to flip face-up later.
- **Exploratory undo:** Ctrl+Z is the exploration superpower. Undo 5 actions, try different line, undo again. Zero penalty.
- **Deck browse:** Right-click Deck → Search is a non-destructive peek for learning what's in the deck.

### Journey Patterns

**Common Patterns Across All Journeys:**

| Pattern | Description | Used In |
|---|---|---|
| **Drag-to-zone** | Primary interaction — grab card, drop on target zone with visual feedback | All journeys |
| **Pile inspection** | Click stacked zone or right-click Deck → overlay with card images + drag sources | All journeys |
| **Undo chain** | Ctrl+Z reverses actions one by one, enabling exploration and error recovery | Journey 2, 3 |
| **Reset cycle** | Quick board reset → reshuffle → draw 5 for next test hand | Journey 1, 2 |
| **Hover-to-learn** | Card tooltip provides effect text without interrupting flow | Journey 1, 3 |
| **Context menu** | Right-click on Deck/ED for Shuffle, Search. Minimal, non-intrusive | Journey 1, 2, 3 |
| **XYZ material management** | Click XYZ → pill shows materials → drag to detach | Journey 2 |

**Navigation Pattern:**
- **Entry:** Always from Deck Detail page via "Tester" button
- **Exit:** Back to Deck Builder (for adjustments) or close simulator
- **Loop:** Simulator ↔ Deck Builder is the primary iteration cycle

### Flow Optimization Principles

1. **Zero-step mill** — No button, no menu. Drag top card from Deck to GY. One gesture replaces three clicks.
2. **Undo as exploration, not error correction** — Undo is a creative tool, not a safety net. The flow encourages branching: try line A, undo, try line B, compare.
3. **Right-click economy** — Context menus ONLY on Deck and ED zones (Shuffle, Search). No right-click elsewhere. Keeps the interaction space predictable.
4. **Overlay as drag source** — Every card in an overlay (GY, Banished, Deck Search) is immediately draggable. No "select then place" — see it, grab it, drag it.
5. **XYZ material peek** — Materials are always subtly visible (border peek). Full inspection requires one click. Detach requires one drag. Minimum friction for a complex mechanic.
6. **Hover is passive, click is active** — Hover = read information (tooltip). Click = open interaction (pills, overlays, flip). Clear mental model: looking vs. doing.
