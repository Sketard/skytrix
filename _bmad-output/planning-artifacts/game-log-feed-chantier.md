# Chantier — Game Log + Effect Activation Feed (PvP)

> UX design spec — Sally (UX Designer), 2026-05-21.
> Steady-state skytrix: this is a feature chantier, not a frozen BMad
> planning spec. Live truth stays `CLAUDE.md` + `docs/`.
> Communication FR / document EN.

## 1. Problem & Origin

During a PvP duel, when the opponent activates an effect on a card that
has **multiple effects in one text block**, the player has **no way to
know which effect was chosen**. The board shows the card lighting up,
but not *what it did*.

Master Duel solves this with two surfaces:

1. A **text bubble** under the opponent's name showing the exact effect
   just activated.
2. A **full game log** — a scrolling side panel listing every event of
   the duel (draws, phases, turns, summons, activations, resolutions,
   card movements).

This chantier delivers **both**, scoped and shipped as one block.

### Reference captures

Master Duel game-log captures provided by the user (`Capture1.PNG`,
`Capture2.PNG`, `Capture3.PNG` at repo root — move to
`_mockups/assets/` or delete after this chantier). They show:

- A narrow **vertical side band**, edge-anchored, scrollable.
- **Turn separators** — wide, labelled `Turn N`, carrying both players' LP.
- **Phase separators** — `Draw Phase`, `Standby Phase`, `Main1 Phase`.
- **Player colour coding** — blue band = one player, red band = the other.
- **Activation rows** — `Activate`, card thumbnail, effect text in a dark box.
- **Resolution rows** — `Effect Resolution` with a chain-link badge ①②③.
- **Movement rows** — `Special Summon`, `Add`, `Discard`, illustrated
  with card thumbnail → destination icon and an arrow.
- **Draw rows** — `Draw` with face-down card backs.

## 2. Scope (LOCKED with user)

### IN SCOPE

| # | Feature | Summary |
|---|---------|---------|
| **A** | Effect bubble | Real-time bubble under the opponent's duelist card showing the last effect they activated. |
| **B** | Game log panel | Full Master-Duel-style game log: a left/right edge side band, full height, listing every duel event chronologically. |

### OUT OF SCOPE (decided & dropped)

- **Card-inspector "Activé ce tour" mention** — dropped 2026-05-21.
  Reason: the per-effect string index (`strIndex`) lives only in the
  duel-server's `cards.cdb` (English, indexed `str1..str16`), while the
  card-inspector renders Spring Boot card text (French, single
  concatenated blob from the YGOPro API). The two text sources do not
  share a structure or a language, so a `strIndex` cannot address a
  paragraph of the inspector text without a multilingual `cards.cdb`
  or a YGOPro-text-split data chantier. Too complex for now —
  revisit only if that data reconciliation is ever done.

## 3. Decisions Log (all confirmed with user)

### Feature A — Effect bubble

| Aspect | Decision |
|--------|----------|
| Trigger | Opponent activates an effect (`MSG_CHAINING`). |
| Anchor | Under the **opponent's duelist card** (P2, top). |
| Content | The **last** effect only — the resolved effect text. |
| Player scope | **Opponent only.** The player knows their own effects. |
| Duration | ~3.5 s fixed, scaled by `speedMultiplier` via `ctx.scaledDuration`. |
| Rapid re-trigger | A second activation **replaces** the content and **restarts** the timer. No queue, no stacking. |
| vs chain overlay | **Coexist, bubble on top.** The bubble has a **higher z-index** than `pvp-chain-overlay` — if they overlap, the bubble stays fully readable. The activated-effect info outranks the resolution overlay; in practice there is room to see both. |
| Long text | Bubble **grows** to fit, up to a **max height**, then **scrolls internally**. |

**Guard-rails (design constraints, not user choices):**

- *G1 — bounded growth.* "Grows to fit" is capped at a max height
  (≈ 40% of the opponent half-board height). Beyond that, the bubble
  scrolls internally instead of pushing toward infinity. The cap is
  **not** about the chain overlay (the bubble is allowed to overlap
  and sits above it) — it is about not letting the bubble run off the
  opponent's half of the screen.
- *G2 — never mask the board.* The bubble is anchored so it expands
  **toward the corner**, not toward the centre of the board. The
  board itself — zones, cards — stays uncovered; the chain overlay
  may be overlapped, the playable board may not. Max height keeps the
  bubble above the opponent's monster-zone row.

### Feature B — Game log panel

| Aspect | Decision |
|--------|----------|
| Form | **Full-height side band**, edge-anchored, scrollable (faithful to the captures). |
| Trigger | A dedicated button **replacing the debug-hub button** in PvP mode (see §6.3). |
| Default state | **Closed.** Duel starts with the board at full width; the player opens the log on demand. |
| Width | Narrower than the current `DuelDevHub` panel. |
| Content | **Full game log** — turns, phases, draws, summons, activations, resolutions, movements. |
| Player scope | **Both players.** |
| Time window | **Whole duel**, grouped by turn. |
| Order | **Oldest at top**, history flows downward; newest at the bottom. |
| Sticky headers | Turn-group headers stick to the top of the scroll viewport. |
| Live update | Updates **live** while open. |
| Click a row | Opens the **card-inspector** for that card. |

**Guard-rail:**

- *G3 — auto-scroll on new entry.* Since order is oldest-at-top, a new
  entry appends at the **bottom** — off-screen. While the log is open
  and the user is **already scrolled to the bottom**, the panel
  auto-scrolls to reveal the new entry. If the user has scrolled **up**
  to read history, do **not** hijack the scroll; show a small
  `↓ new entries` affordance pinned at the bottom edge that scrolls
  down on click. (Standard chat/log pattern.)

## 4. UX Specification

### 4.1 Feature A — Effect bubble

**The scene.** The opponent activates `K9-66a Jokul`. At that instant a
bubble appears under their duelist card, showing the exact effect text.
The player reads it, understands, the bubble fades. It is an **alert**,
not a reading panel.

```
┌──────────────────────────────────────┐
│                       ┌────────────┐ │
│                       │ [LOX]  8000│ │  ← opponent duelist card (P2)
│                       │  [avatar]  │ │
│                       └────────────┘ │
│                   ┌──────────────────┤
│                   │ ⚡ K9-66a Jokul   │  ← the bubble
│                   │ "Reveal this card │
│                   │  and 1 other Lvl 5│
│                   │  monster in your  │
│                   │  hand; Special… " │
│                   └──────────────────┤
│        [ opponent board ]             │
```

**Behaviour:**

- Appears on `MSG_CHAINING` where the activating player is the opponent.
- Shows the effect text (`descriptionText` — see §5.1).
- Holds ~3.5 s (`ctx.scaledDuration(EFFECT_BUBBLE_MS, EFFECT_BUBBLE_MIN_MS)`),
  then fades out.
- "Last effect wins": a new `MSG_CHAINING` (opponent) **replaces** the
  text and **restarts** the timer.
- Coexists with `pvp-chain-overlay` (guard-rails G1, G2).
- Enters with a fade/slide, exits with a fade.

**States:**

| State | Trigger | Visual |
|-------|---------|--------|
| Hidden | default / timer elapsed | not rendered |
| Entering | opponent `MSG_CHAINING` | fade+slide in |
| Visible | — | full bubble, timer running |
| Replaced | new opponent `MSG_CHAINING` | content swaps, timer resets, no exit anim |
| Exiting | timer elapsed | fade out |

### 4.2 Feature B — Game log panel

**The scene.** Turn 5. The opponent just chained three effects. The
player is unsure of the order. They click the log button. The
full-height side band slides in from the edge: the chronological list
of everything since turn 1, grouped by turn, oldest at top. They scroll,
read, close. The duel resumes.

**Closed state** — only the trigger button is visible (§6.3).

**Open state — full-height side band:**

```
┌─ board ───────────────────────┬─ Game Log ──────[✕]─┐
│                               │ ░ Turn 1 ░ P1 8000  │ ← turn separator
│                               │            P2 8000  │   (sticky)
│   [ opponent board ]          │ ── Draw Phase ──     │ ← phase separator
│                               │ 🔵 Draw   [🂠][🂠]   │
│   ─────────────────────────   │ ── Main1 Phase ──    │
│   [ player board ]            │ 🔵 [img] Card name   │
│                               │    Activate          │
│   [ hand ]                    │    "effect text…"    │
│                               │ ① Effect Resolution  │
│                               │    [img] Special     │
│                               │    Summon  →  [zone] │
│                               │ ░ Turn 2 ░ P1 8000   │
│                               │            P2 7200   │
│                               │ 🔴 [img] Card name   │
│                               │    Activate          │
│                               │  ↓ new entries       │ ← G3 affordance
└───────────────────────────────┴──────────────────────┘
```

🔵 = viewer (relative player 0) · 🔴 = opponent (relative player 1).

**Grammar — five block kinds.** An exhaustive audit of every game
event the front-end can receive (see §4.3) found that a move-only
grammar misses 12 non-move events. The log therefore has **five block
kinds**. There is **no per-row category title** for move rows — the
verb above the arrow already names the action.

1. **Separators** — decision, turn, phase, chain delimiters, duel-over.
2. **Move rows** — every card displacement; one uniform anatomy.
3. **RNG rows** — coin toss, dice roll.
4. **Combat rows** — attack declaration, battle calculation.
5. **Action rows** — counter +/−, equip, become-target, GY↔Deck swap.

**Universal row anatomy — three parts.** Every non-separator row has
exactly the same three-part structure. Two distinct card roles must
never be conflated:

```
[ SOURCE card ]          ← the card that ACTIVATED the effect.
                           ALWAYS revealed (an activation is public in
                           YGO), carries the chain-link badge ①②③ when
                           the event is in a chain / resolution.
  « effect description » ← descriptionText — ALWAYS present.
  ┌─ body ─────────────────────────────────────┐
  │ [ moved card ] ─verb─▶ [ dest ]             │ ← the card actually
  │ [ moved card ] ─verb─▶ [ dest ]             │   DISPLACED. One
  └─────────────────────────────────────────────┘   sub-row per card.
```

- **The SOURCE card ≠ the moved card.** The source is *what activated*
  (e.g. `Cup of Ace`, `Card Destruction`, `Endymion`). The moved cards
  are *what the effect displaced* (the 2 drawn cards, the discarded
  hand, …). A draw effect's source header is the activating card; the
  drawn cards are sub-rows underneath.
- **Visibility is on the MOVED cards, not the source.** The source
  card is always revealed — an activation is public information. The
  **moved cards** are revealed or shown as a card back **per OCGCore**:
  if the engine does not reveal a displaced card (opponent discards
  face-down, opponent draws), that sub-row shows a card back +
  "Carte non révélée". The front-end never infers a hidden identity.
- **The description is always present** — even for an opponent's
  effect (the activation is public, so its text is too). The only
  rows *without* source + description are the special cases below.
- **Body shape varies by event type** — moved-card sub-rows, or an
  RNG body, or a combat body, or an action body (§4.2 tables).

**Standardised field grid — always the full mini-board.** Any time a
row shows an **on-field position** (Normal/Special Summon, Set,
on-field move, etc.), it renders the **complete mini-board** — for
each player a **monster row (5) + spell/trap row (5)**, plus the
shared **EMZ band (2 cells)** between the halves. Never a half-grid,
never a single row. Reasons: (a) some effects place cards on the
**opponent's** field; (b) cards go to Spell/Trap zones, not just
Monster zones. **One field-grid component, used everywhere.** Targeted
cell(s) highlighted; source cell(s) of an on-field move marked
distinctly.

**Negated chain link.** When `MSG_CHAIN_NEGATED` marks a link, its
resolution row renders **dimmed**, the source card name **struck
through**, with a `Nié` tag. The effect text stays visible (the player
should still see *what was* negated). The row is never dropped — a
negated effect is critical information.

**Position change** (`MSG_CHANGE_POS`) has its own body: source card +
description + a `before → after` state pair (`ATK → DEF`, `face-down
→ face-up`).

**Extra-Deck summon materials.** A Fusion/Synchro/Xyz/Link summon
shows, under the summoned monster, the **consumed materials** as
sub-rows (a `Matériaux` sub-label groups them), then an `Invocation`
sub-label for the monster itself landing on the board grid. Xyz
materials go to the OVERLAY zone, others to the GY — the destination
chip reflects it.

**Verb language — French.** All log verbs are French (`Pioche`,
`Ajout`, `Inv. Normale`, `Défausse`, `Bannissement`, `Matériau`, …)
via i18n keys, consistent with the rest of the skytrix UI. (Distinct
from O3, which is about the *effect description text* sourced from
`cards.cdb`.)

**Special rows without a source header / description:**

- **Initial 5-card draw** — just the 5 cards (face-up for the viewer,
  backs for the opponent). No source, no description.
- **Draw Phase regular draw** — the mandatory turn draw is caused by
  *no card* (it is a turn rule). The row shows only the drawn card as
  a body sub-row; **no source header, no description**. (Effect-driven
  draws DO have a source — the activating card.)

**Separators:**

| Separator | Source | Renders |
|-----------|--------|---------|
| Pre-duel decision | RPS / first-second result | "X a choisi de jouer en premier/second" |
| Turn separator | `turnCount` delta (synthesized) | `Turn N`, both players' LP, wide band |
| Phase separator | `phase` delta (synthesized) | phase name, thin band |
| Chain start / resolution / end | `MSG_CHAINING` (first link) / `MSG_CHAIN_SOLVING` / `MSG_CHAIN_END` | three distinct delimiters |
| Duel over | `MSG_WIN` / `DUEL_END` | winner + reason (LP 0 / deck-out / Exodia / surrender / timeout…) — final block |

**Move rows** (all the same anatomy; the verb varies):

| Event | Verb on arrow | Source → Dest | Notes |
|-------|---------------|---------------|-------|
| Initial 5-card draw | — | — | special: just the 5 cards, no flow line |
| Draw | `Draw` | DECK → HAND | **same pattern as Add**; opponent draw → card hidden |
| Summon | `Normal/Special/Fusion/Synchro/Xyz/Link Summon` | HAND or EXTRA → field grid | `MSG_MOVE` → MZONE + `reason` bitmask |
| Set | `Set` | HAND → field grid | `MSG_SET`; thumbnail is a card back |
| Flip Summon | `Flip Summon` | field → field | `MSG_FLIP_SUMMONING` |
| Activation | `Activate` | source → field grid | `MSG_CHAINING`; chain-link badge on card header; effect text box below |
| Resolution | effect verb (`Negate`, `Special Summon`, …) | source → dest | `MSG_CHAIN_SOLVING`/`_SOLVED`; chain-link badge |
| Add / Discard / Send to GY / Banish / Return | `Add` / `Discard` / `Send to GY` / `Banish` / `Return to Deck` | pile/field → pile | `MSG_MOVE` non-summon |
| On-field move | `Move` | full both-halves grid → grid | `MSG_MOVE` field→field |
| Swap / Shuffle-set | `Swap` / `Shuffle` | card ↔ card / field repositions | `MSG_SWAP`, `MSG_SHUFFLE_SET_CARD` — fit the move pattern |

**RNG rows** (icon + label + results, no flow line):

| Event | Source | Renders |
|-------|--------|---------|
| Coin toss | `MSG_TOSS_COIN` | per-result Pile/Face chips |
| Dice roll | `MSG_TOSS_DICE` | per-result die value (1–6) |

**Combat rows** (attacker side ⚔ defender side; defender absent = direct):

| Event | Source | Renders |
|-------|--------|---------|
| Attack | `MSG_ATTACK` | attacker card + ATK vs defender card + ATK/DEF; or "direct attack" |
| Battle calculation | `MSG_BATTLE` | per-side damage / "détruit" outcome |

**Action rows** (icon + label + target chips / counter badge):

| Event | Source | Renders |
|-------|--------|---------|
| Add / Remove counter | `MSG_ADD_COUNTER` / `MSG_REMOVE_COUNTER` | counter type + `+N` / `−N` badge |
| Equip | `MSG_EQUIP` | equip card → target card |
| Become target | `MSG_BECOME_TARGET` | the targeted card thumbnails |
| GY ↔ Deck swap | `MSG_SWAP_GRAVE_DECK` | player label, no card |

Every non-separator row carries a **player band colour** (blue / red),
relativized from the absolute event player (see §5.5).

> LP-change events (`MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST`)
> are **not** their own rows — the net LP is shown on turn separators
> and combat rows. See open question O1.

**Row anatomy — moved card revealed above the flow.** For movement /
summon rows, the **moved card** is shown as a header *above* the
`source → dest` flow line (thumbnail + card name). Whether the card is
**revealed or face-down is decided by OCGCore**, not by the front-end:
the server emits the card identity only when the move is public
information. If OCGCore does not reveal it (e.g. an opponent banishing
from deck face-down), the header shows a **card back + "Carte non
révélée"** — the front-end MUST NOT infer or leak the hidden identity.
The `cardCode` / `cardName` on `MSG_MOVE` is simply absent/null in
that case (already filtered server-side by `message-filter.ts`).

**Initial 5-card draw** is a special row: it shows **only the 5 cards**
(face-up for the viewer, card backs for the opponent), with **no
`source → dest` flow line** — the deck→hand move is implicit at duel
start.

**Interaction:**

- Click a row that has a `cardCode` → opens the card-inspector
  (reuse the `inspectCard` output pattern from
  `pvp-zone-browser-overlay`).
- Close: `✕` button, click-outside, or `Escape` — reuse
  `setupClickOutsideListener` + `onKeydown` from
  `pvp-zone-browser-overlay`.
- Live update with auto-scroll guard-rail G3.

### 4.3 Event-coverage audit — full game log

An exhaustive audit of every game event the front-end can receive
(orchestrator `processEvent()` switch + `DuelEventProcessor`
`GAME_EVENT_TYPES`) confirmed the grammar covers **all visible game
actions**. User decision (2026-05-21): **log everything** — the panel
is a full game log, not a card-action-only log.

**All events reach the front-end and are mapped to a block kind:**

| Event | Block kind |
|-------|------------|
| `MSG_DRAW` | Move row (Draw) — initial draw is the special 5-card variant |
| `MSG_MOVE` (all `reason` codes) | Move row (summon / set-by-move / Add / Discard / Send to GY / Banish / Return / on-field) |
| `MSG_SET` | Move row (Set) |
| `MSG_FLIP_SUMMONING` | Move row (Flip Summon) |
| `MSG_CHANGE_POS` | Move row (position change) |
| `MSG_CHAINING` | Move row (Activation) + chain-start delimiter on first link |
| `MSG_CHAIN_SOLVING` / `_SOLVED` | Move row (Resolution) + resolution delimiter |
| `MSG_CHAIN_END` | chain-end delimiter |
| `MSG_CHAIN_NEGATED` | folded onto the negated link's row (negated marker) |
| `MSG_CONFIRM_CARDS` | reveal — folded onto the matching move row (interleave) |
| `MSG_SHUFFLE_HAND` / `MSG_SHUFFLE_DECK` | Action row (shuffle) |
| `MSG_SWAP` / `MSG_SHUFFLE_SET_CARD` | Move row (Swap / Shuffle-set) |
| `MSG_SWAP_GRAVE_DECK` | Action row (GY↔Deck swap) |
| `MSG_TOSS_COIN` / `MSG_TOSS_DICE` | RNG row |
| `MSG_ATTACK` / `MSG_BATTLE` | Combat row |
| `MSG_EQUIP` | Action row (equip) |
| `MSG_ADD_COUNTER` / `MSG_REMOVE_COUNTER` | Action row (counter +/−) |
| `MSG_BECOME_TARGET` | Action row (targeting) |
| `MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST` | not a row — net LP shown on turn separators + combat rows (O1) |
| `MSG_WIN` / `DUEL_END` | Duel-over separator |

Events that **never reach the front-end** (engine-internal, no row
needed): `MSG_NEW_TURN`, `MSG_NEW_PHASE` (→ synthesized from
`BOARD_STATE` deltas, see §5.5), `MSG_START`, `MSG_RETRY`,
`MSG_LPUPDATE`, `MSG_HAND_RES`, `MSG_ROCK_PAPER_SCISSORS`.

## 5. Technical Contract

### 5.1 Server — `descriptionText` on `ChainingMsg`

`MSG_CHAINING` already carries `description: number` (a 64-bit code:
high 20 bits = card code, low 20 bits = effect string index). It is
**received by the front and silently dropped**.

- Add `descriptionText?: string` to `ChainingMsg` in
  **`ws-protocol-game.ts`** (both `duel-server/src/` and
  `front/src/app/pages/pvp/duel-ws-game.types.ts` — byte-synced by
  `scripts/check-ws-protocol-sync.mjs`).
- Populate it in `duel-worker.ts` where `MSG_CHAINING` is built, using
  the **existing** `getOptionDesc(description)` helper — the same path
  `SelectEffectYnMsg.descriptionText` already uses.
- The resolved text is `cards.cdb` text (English). This is consistent
  with what the duel-server already produces for `SELECT_OPTION`
  prompts. See open question O3.

### 5.2 Front transport — `ChainLinkState`

- `ChainLinkState` (`duel-state.types.ts`) gains `descriptionText`.
- `DuelEventProcessor.buildChainLinkState()` copies it from the
  `ChainingMsg` (today the field is dropped).

### 5.3 New service — `DuelGameLogService`

- **Net-new** Angular service, provided at the duel-page +
  replay-page component level (same scope as `DuelDebugService`).
- Taps the **`AnimationOrchestratorService.processEvent()` event
  stream** — the single chronological stream that already sees every
  game event in order. Attached as a passive side-effect tap; it MUST
  NOT interfere with animation dispatch.
- Accumulates `gameLogEntries: Signal<GameLogEntry[]>`.
- **Independent of the replay precompute pipeline** (per user
  decision) — but reuses the shared labelling utility (§5.4) so the
  *event → human label* logic is not duplicated.

`GameLogEntry` shape (indicative):

```ts
interface GameLogEntry {
  kind: 'turn' | 'phase' | 'draw' | 'summon' | 'set'
      | 'flip' | 'activation' | 'resolution' | 'movement' | 'lp';
  player: 0 | 1;            // RELATIVE (already relativized — see §5.5)
  turnCount: number;        // for turn grouping
  label: string;            // from game-log-labels.ts
  cardCode?: number;
  cardName?: string;
  effectText?: string;      // activation rows
  chainLink?: number;       // resolution rows
  fromZone?: ZoneId;
  toZone?: ZoneId;
  lp?: [number, number];    // turn-separator rows
  timestamp: number;
}
```

- Accumulates the **whole duel**; cleared only on duel reset
  (rematch / switch / destroy). Hook into the same
  `clearTimersAndPolling` / reset path the orchestrator uses.

### 5.4 Shared labelling utility — `game-log-labels.ts`

- Extract the **purely functional** label logic from
  `replay-precompute.ts` — `generateLabel()` / `describeMoveLabel()` —
  into a shared TS utility (`front/src/app/pages/pvp/game-log-labels.ts`,
  or a `shared/` location both front and duel-server can import).
- It is plain TypeScript (no Node APIs) → reusable on the front.
- `replay-precompute.ts` then imports the extracted utility instead of
  owning the logic → no divergence, single source of truth for the
  `event → "Activate: X" / "Normal Summon: X" / "Discard: X"` mapping.
- Apply the `no-doc-code-divergence` rule: full extraction + rename,
  not a copy.

### 5.5 Turn / phase synthesis

`MSG_NEW_TURN` and `MSG_NEW_PHASE` **do not exist** in the skytrix
protocol — OCGCore has them, the server never forwards them.

- `DuelGameLogService` observes `RenderedBoardStateService.renderedState`
  for **`turnCount` deltas** → synthesize a turn separator (capture
  both players' `lp` at that moment).
- Observes **`phase` deltas** → synthesize a phase separator.
- Per the Rendered Board State Constraint in `CLAUDE.md`: `turnCount`
  and `phase` are global properties that may run **ahead of locked
  zones** during animation. For the log this is acceptable — the log
  is a chronological journal, not animation-synced state — but
  document it so a future reader does not "fix" a non-bug.

### 5.6 Perspective convention

- `ChainingMsg.player`, `MSG_MOVE.player` / `toPlayer`, etc. are
  **absolute** (server P0/P1).
- Every `GameLogEntry.player` and every band colour MUST be
  **relativized**: `const rel = absolute === ownPlayerIndex ? 0 : 1`.
- Feature A's "is this the opponent?" test is the same relativization.
- Do this **once**, at log-entry construction, so the rendering layer
  only ever sees relative indices.

### 5.7 Replay parity

- `DuelGameLogService` taps the orchestrator event stream. The
  orchestrator is shared PvP ↔ Replay via `AnimationDataSource`
  (`CLAUDE.md` Animation Parity Rule). Replay re-feeds the same events.
- → The game log + the bubble **work in replay for free**, as long as
  the service is provided at the replay-page level too and taps the
  same stream. **Verify** this during implementation — do not assume.
- The bubble's "opponent only" test in replay uses `perspectiveIndex()`
  as `ownPlayerIndex` (the replay convention from `CLAUDE.md`).

### 5.8 Animation constants

Add to `animation-constants.ts`:

- `EFFECT_BUBBLE_MS` — base bubble hold duration (≈ 3500).
- `EFFECT_BUBBLE_MIN_MS` — floor for `scaledDuration`.
- `EFFECT_BUBBLE_FADE_MS` (+ `_MIN_MS` if the handler passes a min) —
  enter/exit fade.

## 6. Design System Compliance

**Read `front/DESIGN-SYSTEM.md` before writing any markup.** Every new
component added under `components/` MUST be registered there.

### 6.1 Effect bubble

- Built from DS primitives. No ad-hoc `<button>` / `<div class="…">`
  chrome — use DS surface tokens (`var(--surface-…)`, `var(--gold-…)`).
- Effect text colour: token only. Gold *text* → `--gold-on-surface`;
  gold *background/border/glow* → `--gold`.
- `mat-icon` (the ⚡ glyph) sized via `@include icon-size(...)`.
- New component → add a `card-inspector`-style entry to
  `DESIGN-SYSTEM.md`.

### 6.2 Game log panel

- Model the panel chrome on `pvp-zone-browser-overlay`:
  `setupClickOutsideListener`, `onKeydown` (Escape), `isClosing` +
  timed close, `OnPush`.
- Ghost scrollbar: `@include ghost-scroll` (see
  `ghost-scrollbar-convention`).
- Sticky turn headers — `position: sticky`, no `::ng-deep`.
- Player band colours — tokens. If no existing token fits the
  blue/red duel-side coding, add `--duel-side-self` /
  `--duel-side-opponent` in the token layer (`styles/**`), not inline
  hex.
- Row card thumbnails — reuse `DuelCardArtService.resolveUrl` (same as
  the zone-browser overlay).

### 6.3 The trigger button

- The button **replaces the debug-hub button** in PvP mode.
  `DuelDevHub` lives in `duel-page/duel-dev-hub/` and is opened from
  `pvp-board-container`. The dev hub itself stays a **dev-only**
  tool (`Ctrl+Shift+D`); only its on-screen *button* is swapped for
  the game-log button in PvP.
- The game-log button is an `<app-icon-button>` (history/scroll icon).
- **Decide at implementation:** keep the dev-hub reachable via the
  keyboard shortcut only in dev builds, OR keep both. The game-log
  button must not regress dev-hub access for developers. (Open
  question O2.)

## 7. Open Questions (resolve at implementation)

| ID | Question |
|----|----------|
| **O1** | RESOLVED 2026-05-21 — LP-change events (`MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST`) get **no dedicated row**. Net LP appears on turn separators and on combat rows. Keeps the log readable; combat damage is already shown in the combat block. |
| **O2** | Dev-hub access once its button is replaced — keyboard-only in dev builds, or keep both buttons? |
| **O3** | Bubble/log text language — `cards.cdb` is English. If skytrix duel prompts are already English, the bubble is consistent. If prompts are French, investigate the translation path. Verify the actual language of current `SELECT_OPTION` prompts in a live duel. |
| **O4** | Visual fidelity of movement rows (the `card → icon` + arrow illustration in the captures) — full illustration vs a simpler `Card → GY` text row. Pin against the Master Duel captures during the visual pass. |

## 8. Validation Prototype — build BEFORE the Angular component

**Method (agreed with user):** before writing the Angular game-log
component, prove the grammar reconstructs a real duel correctly. Take an
existing replay, run its event sequence through a pure game-log builder,
emit a **text / Markdown game log**, and eyeball it against the real
replay. If the feed is wrong, fix the *grammar* now — not later in TS.

**Reference replay:** `a8859c98-df53-4de3-bcdb-dd1a56176f86`
(`/pvp/replay/a8859c98-df53-4de3-bcdb-dd1a56176f86`).

### 8.1 Why an offline Node script (Strategy B), not a browser tap

The replay precompute (`replay-precompute.ts`) already produces
`PreComputedState[]`, and **each state carries `events: ServerMessage[]`
— the complete, ordered game-event stream** with full payloads
(`runReplayPreComputation`, ~line 265+; events accumulated ~line
354-401). That is the raw material — no reconstruction needed.

An **offline Node script** beats a browser/Playwright tap because:
- it runs server-side, so it can resolve effect text via the existing
  `getOptionDesc()` (`duel-worker.ts` ~line 256-267) + `cards.cdb` —
  a browser tap only sees the numeric `description` code;
- no headless browser, no animation render — fast, CI-friendly;
- it **builds the reusable brick** — see 8.2.

### 8.2 `GameLogBuilder` — the brick that is NOT throwaway

The core is a **pure TypeScript module**, zero replay/browser deps:

```
GameLogBuilder
  in:  ServerMessage[]  +  BoardStatePayload[] (per-transition snapshots)
  out: GameLogEntry[]   (the five-block grammar of §4.2)
```

This module is **the same one the Angular component will consume.** The
CLI prototype is only a *test harness* around it. Validating the grammar
on a real duel therefore also delivers the production brick — nothing is
thrown away. It must implement: turn/phase synthesis from `turnCount` /
`phase` deltas, the universal 3-part row anatomy, source-vs-moved-card
distinction, the five block kinds, chain delimiters + negated links,
Extra-Deck materials, perspective relativization.

### 8.3 The CLI tool

`duel-server/src/tools/game-log-builder-cli.ts` (≈250 LOC):
1. fetch the replay via the Spring Boot internal endpoint
   (`GET /internal/replays/{id}`, `X-Internal-Key` — see
   `replay-handlers.ts` ~line 172);
2. run it through `runReplayPreComputation`;
3. resolve `descriptionText` per `MSG_CHAINING` via a copied/extracted
   `getOptionDesc()` + `cards.cdb`;
4. feed the event stream into `GameLogBuilder`;
5. render `GameLogEntry[]` → Markdown.

Deliverable:
```
node duel-server/dist/tools/game-log-builder-cli.js \
  --replayId a8859c98-df53-4de3-bcdb-dd1a56176f86 \
  --perspective 0 \
  --output _bmad-output/game-log/a8859c98.md
```

→ read `a8859c98.md`, compare against the live replay, judge the grammar.

### 8.4 Note on `descriptionText`

For the prototype the CLI resolves `descriptionText` itself via
`getOptionDesc()` — **no protocol change needed yet**. Adding
`descriptionText` to `ChainingMsg` (§5.1) is the *production* wiring,
done after the grammar is validated. Validate first, wire the protocol
cleanly second.

## 9. Suggested Delivery Sequence (one block, internal order)

Shipped as one chantier, but a sane build order:

0. **Validation prototype** (§8) — `GameLogBuilder` (pure) + CLI tool,
   run on replay `a8859c98…`, eyeball the Markdown, fix the grammar if
   wrong. The `GameLogBuilder` from this step is reused by step 3.
1. **Server + transport** — `descriptionText` on `ChainingMsg`,
   `getOptionDesc()` wiring, `ChainLinkState` field, ws-protocol sync.
2. **`game-log-labels.ts`** — extract the shared labelling utility,
   repoint `replay-precompute.ts`.
3. **`DuelGameLogService`** — wraps the validated `GameLogBuilder`;
   event-stream tap, accumulation, turn/phase synthesis, perspective
   relativization.
4. **Feature A — effect bubble** — component, anchor, timing,
   guard-rails G1/G2.
5. **Feature B — game log panel** — side band, five-block row taxonomy,
   sticky headers, auto-scroll G3, click-to-inspect, trigger button swap.
6. **Replay parity check** — provide both at replay-page level,
   verify bubble + log render in replay.
7. **Visual pass** — fidelity against the three Master Duel captures,
   DS audit, `DESIGN-SYSTEM.md` registration, i18n keys (FR + EN).

## 9. Acceptance Criteria

- [ ] Opponent activates an effect → bubble appears under their duelist
      card with the correct effect text, holds ~3.5 s (speed-scaled),
      fades.
- [ ] A second opponent activation within 3.5 s replaces the bubble and
      restarts the timer.
- [ ] Bubble never fully covers the chain overlay (G1/G2).
- [ ] The PvP debug-hub button is replaced by the game-log button;
      dev-hub remains reachable for developers (O2 resolution).
- [ ] Clicking the game-log button opens a full-height edge side band.
- [ ] The log lists, chronologically and grouped by turn: turn
      separators (with LP), phase separators, draws, summons, sets,
      flips, activations, resolutions (with chain-link number),
      movements.
- [ ] Turn-group headers are sticky.
- [ ] Player rows are colour-coded by relative side (self vs opponent).
- [ ] New entries appear live; auto-scroll respects G3.
- [ ] Clicking a row with a card opens the card-inspector.
- [ ] The bubble and the game log both work in replay mode.
- [ ] All new UI uses DS components; new components registered in
      `front/DESIGN-SYSTEM.md`; new timing constants in
      `animation-constants.ts`.
- [ ] `npm run` lint + stylelint + ws-protocol-sync pass; specs green.
