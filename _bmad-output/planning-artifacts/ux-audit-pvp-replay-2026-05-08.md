---
title: UX Audit 360° — PVP & Replay
auditor: Sally (UX Designer)
date: 2026-05-08
scope: PVP (lobby + duel) and Replay modes
method: Live code reading + Nielsen heuristics + Yu-Gi-Oh! player intuitions
status: Reviewed by Axel — decisions captured 2026-05-08
---

# UX Audit 360° — PVP & Replay

## 1. Executive Summary

The skytrix PVP mode is **technically very solid** — CDK focus trap on prompts,
near-systematic `aria-live`, `prefers-reduced-motion` covered across 25 files,
animations orchestrated with rare rigor. The Replay mode is **an excellent
viewer**: smooth scrubbing, dual perspective, integrated fork.

But the product carries two **structural UX debts**:

1. **Player identity vanishes the moment the duel begins.** No "me vs you"
   color on the board, on chain links, or in announcements. In competitive
   PVP, this is the most penalizing flaw.
2. **Time pressure is invisible on 9 prompts out of 10.** Only RPS/TP shows
   a countdown. All other prompts (CHAIN, CARD, TRIBUTE…) have a silent
   server-side timer — the player discovers the timeout by losing the turn.

Beyond these two debts: ~12 lower-amplitude frictions, listed P0→P2 below.

**Decisions captured from Axel (2026-05-08) are inlined under each finding.**

## 2. Heuristic Audit (Nielsen)

### ✅ What holds

- **#1 Visibility of system status** — 8 distinct room states, `aria-live` on
  countdown, contextualized spinners ([duel-page.component.html:39](front/src/app/pages/pvp/duel-page/duel-page.component.html#L39)).
- **#5 Error prevention** — `cdkTrapFocus` + `cdkTrapFocusAutoCapture` on
  prompts ([pvp-prompt-dialog.component.html:4-5](front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.html#L4-L5)).
- **#9 Help users recover from errors** — reconnect snackbars
  ([duel-connection-effects.service.ts:25-43](front/src/app/pages/pvp/duel-page/duel-connection-effects.service.ts#L25-L43))
  with parallel LiveAnnouncer.
- **#10 Help & docs (a11y)** — LiveAnnouncer announces "Chain Link X
  added/resolving/negated" ([pvp-chain-overlay.component.ts:301-304](front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts#L301-L304)).

### ⚠️ What cracks

- **#1 — Visibility (ambiguous waiting state)** — `duel.prompt.waitingResponse`
  doesn't say if **me** or the **opponent** is being waited for
  ([pvp-prompt-dialog.component.html:27](front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.html#L27)).
- **#2 — Match with real world** — SELECT_OPTION for ANNOUNCE_RACE/ATTRIBUTE
  shows hardcoded `"Race X"` / `"Attribute Y"`
  ([prompt-option-list.component.ts:81-82](front/src/app/pages/pvp/duel-page/prompts/prompt-option-list/prompt-option-list.component.ts#L81-L82)).
  YGO players know "Dragon" / "FIRE", not "Race 6".
- **#4 — Consistency** — three different visual logics for multi-select count:
  - SELECT_CARD → "X / Y selected"
  - SELECT_SUM → progress bar
  - SELECT_TRIBUTE → tribute counter
- **#5 — Error prevention (no-undo)** — SELECT_PLACE / SELECT_DISFIELD respond
  on direct zone click ([prompt-zone-highlight.component.ts](front/src/app/pages/pvp/duel-page/prompts/prompt-zone-highlight/prompt-zone-highlight.component.ts)).
  No "Cancel", no re-pick.
- **#7 — Flexibility (keyboard inconsistency)** — RPS = `1/2/3`, other CHOICE
  = `Enter/Escape`, activation toggle = `Space`. Three keyboard conventions.

## 3. Cognitive Load — Miller's Law (7±2)

Three severe overload zones identified:

### Zone A — Center board during chain resolution

During a 4+ link chain resolution, the player sees in parallel:
1. 10 field zones with potential chain badges
2. Chain overlay (3 cards front/mid/back with pulse + glow + negation colors)
3. Animated LP badge (red flash, 300-600ms interpolation)
4. Phase badge + turn count
5. Pulsing red timer if ≤30s
6. Player hand row
7. Opponent hand row
8. Activation toggle
9. (Possible) coin flip / dice / phase announcement toasts

→ **9 simultaneous animated sources**. `prefers-reduced-motion` helps but the
"normal" player gets cumulative visual noise.
([pvp-chain-overlay.component.ts:152-175](front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts#L152-L175))

### Zone B — Hand row + action menu

Hand of 8 cards in a fan with overlap ratio **-0.41 on desktop**
([pvp-hand-row.component.ts:71-86](front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts#L71-L86)).
Visually nice; functionally, **precisely picking the middle card becomes
hard** when the action menu opens above
([duel-page.ts:705-751](front/src/app/pages/pvp/duel-page/duel-page.component.ts#L705-L751)).

### Zone C — End-of-game multi-overlay

Possible stack: `result-overlay` + `disconnect-grace-overlay` + leftover
prompt dialog + RPS overlay if rematch. The `aria-live="assertive"` of
result ([duel-page.component.html:399](front/src/app/pages/pvp/duel-page/duel-page.component.html#L399))
guarantees announcement, but visually there is **no z-index registry** — a
leftover prompt can occlude the result.

## 4. Critical YGO Moments

| Moment | What works | What's missing |
|---|---|---|
| **Chain build (≥2 links)** | Elegant 3D overlay, LiveAnnouncer announces each add | **No player marker** on the badge — who chained what? |
| **Chain resolution** | Cyan pulse / grey shake for negated, excellent contrast | **No post-resolution recap** (X resolved / Y negated) |
| **Negation** | Greyscale + silver glow + shake — visually perfect ([pvp-chain-overlay.component.scss:175-209](front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss#L175-L209)) | Nothing to flag |
| **OPT (Once Per Turn)** | Solver has OPT-aware scoring, but UX shows nothing | **Critical missing** : "OPT consumed" visual marker |
| **Opponent disconnect** | Grace overlay with CSS progress bar ([duel-page.component.html:382-385](front/src/app/pages/pvp/duel-page/duel-page.component.html#L382-L385)), "Leave" button | Total duration in seconds in DOM but **no visible label** |
| **Inactivity warning** | mat-dialog modal with acknowledgement | OK |
| **Prompt timeout** | Server-side timeout, default applied | **No visible timer** on 9/10 prompts → player "loses" without understanding |
| **Reconnection** | "Connection restored" snackbar + LiveAnnouncer | OK — exemplary |

## 5. Replay — Targeted Audit

### ✅ Strengths

- **Smooth scrubbing** — continuous drag on timeline, miniature board preview
  on hover ([timeline-bar.component.ts:75-116](front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts#L75-L116))
- **3-level zoom timeline** on wheel, anchor zoom — pro-grade gesture
- **Rich shortcuts** — 8 keyboard actions (Space, ←/→, Home/End, F, A, M, V, D)
  ([replay-page.component.ts:563-579](front/src/app/pages/pvp/replay/replay-page.component.ts#L563-L579))
- **Omniscient mode** — both hands visible (essential for analysis)
- **Switch perspective (V)** — see P1 or P2 — signature feature
- **Fork** with divergence check + "Continue" snackbar on LP/turn/phase mismatch

### ⚠️ Gaps

- **No speed control** (fixed 500ms/event — [replay-page.component.ts:117](front/src/app/pages/pvp/replay/replay-page.component.ts#L117)).
  For an 80-event duel, this is rejection-grade for a coach who wants to skim.
- **No discovery surface** — no "replay-list" component found in code. Users
  reach a replay via URL only, never via a browsable list.
- **No share/export** — no copy-link, export, or timestamp-bookmark button.
- **Non-customizable shortcuts** — hardcoded. No remap UI, no visible cheat sheet.
- **"Not-computed" translucent bullets** — smart, but no explanatory tooltip
  → user discovers loading by trial-and-error.

## 6. PVP ↔ Replay Parity

| Aspect | PVP | Replay | Verdict |
|---|---|---|---|
| Prompts | Interactive | Read-only auto-dismiss | ✅ Intentional, clean |
| Hands | 1 visible | 2 visible (omniscient) | ✅ Justified |
| Perspective | Fixed | Switchable (V) | ✅ Analysis benefit |
| Animations | Always on | Toggleable (A) | ✅ Skim benefit |
| Timer | Visible | Absent | ✅ Coherent |
| Speed | N/A | **Missing** | ❌ Should exist |
| Coin/dice toasts | Visible | TBD | ⚠️ Likely absent |
| Phase announcement | 2s | Same (shared PhaseAnnouncementService) | ✅ |
| Chain overlay | Identical | Identical (DataSource pattern) | ✅ Exemplary architecture |

**Global parity verdict:** the `AnimationDataSource` architecture documented
in CLAUDE.md guarantees visual parity. **This discipline is rare and
precious.** Must be preserved.

## 7. Accessibility

| Criterion | State | Citation |
|---|---|---|
| `prefers-reduced-motion` | ✅ Covered across 25 SCSS/TS files | `reducedMotion` signal in [duel-context.ts](front/src/app/pages/pvp/duel-page/duel-context.ts) |
| Modal focus trap | ✅ CDK on prompts | [pvp-prompt-dialog.component.html:4-5](front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.html#L4-L5) |
| `aria-live` regions | ✅ polite + assertive by criticality | result assertive, status polite |
| LiveAnnouncer chain | ✅ Announces add/resolving/negated | [duel-a11y-effects.service.ts](front/src/app/pages/pvp/duel-page/duel-a11y-effects.service.ts) |
| `role="region"` waiting states | ✅ | [duel-page.component.html:4-72](front/src/app/pages/pvp/duel-page/duel-page.component.html) |
| Aria-label "Join" room cards | ❌ Missing | lobby-page.component.ts |
| Aria-label quick-duel input | ❌ Missing | lobby-page.component.ts |
| Red timer ≤30s contrast | ⚠️ Verify on dark bg | pvp-timer-badge.component.scss |
| Keyboard consistency | ⚠️ 3 different conventions | RPS `1/2/3` vs Enter/Escape vs Space |
| Screen reader chain identity | ❌ No "Player A activated…" | neutral "Chain Link N…" announcements |

## 8. Prioritized Findings — with Axel's Decisions (2026-05-08)

### 🔴 P0 — Competitive blockers

#### P0-1 — Player markers on chain badges [✅ ACCEPTED — REFINED & READY FOR IMPLEMENTATION]

**Problem:** Player doesn't know who chained what in 3+ link chains. Possible
decision error. LiveAnnouncer announcements are neutral ("Chain Link N…")
without player identity. The two chain badge components (board badge +
chain overlay badge) both use a single color regardless of player ownership.

**Decision context (Axel 2026-05-08):**
- **Surface:** chain badges only — cards untouched (border, glow, fill all preserved)
- **Palette:** blue (self) / amber (opponent) — colorblind-safe, hue distance ≈190°
- **A11y wording:** LiveAnnouncer becomes `"You added Chain Link N: [card]"` /
  `"Opponent added Chain Link N: [card]"` (same pattern for resolving / negated)
- **Resolution pulse channel:** untouched. The existing gold token
  (`--pvp-chain-glow-resolving: rgba(255, 215, 0, 0.6)`) and the negation
  grey treatment remain identity-agnostic. Two orthogonal channels: badge
  identity (who) vs card/badge state (resolving / negated).

**Mockup reference:** [_bmad-output/mockups/p0-1-player-markers.html](_bmad-output/mockups/p0-1-player-markers.html)

---

##### Component ① — Board chain badge (pulsing circle on cards in zones)

**Chosen redesign: Option C — "hybrid"** (premium upgrade, preserves
legibility):
- **Solid colored circle preserved** for legibility on busy card art
- **Pulse mechanic re-engineered**: instead of scale + opacity on the
  whole badge, the pulse becomes:
  - An **inner glow** (white-ish, color-tinted) that breathes from inside
  - An **outer glow** (color-aware: blue for self, amber for opponent)
  - Animation duration: **1.2s** (slightly slower than current 1s for a
    more organic "breathing light" feel) ease-in-out infinite alternate
- **Numeral typography**: italic 900, white fill, 1px white stroke,
  paint-order stroke fill, soft white text-shadow (matches the chain
  overlay aesthetic without copying it)

**Color tokens (NEW):**

| Token | Self (blue) | Opponent (amber) |
|---|---|---|
| Background | `rgba(30, 90, 200, 0.9)` (current — preserved) | `rgba(180, 83, 9, 0.92)` (amber-700) |
| Inner glow (pulse from) | `rgba(173, 216, 255, 0.55)` | `rgba(254, 215, 170, 0.55)` |
| Outer glow (pulse from) | `rgba(96, 165, 250, 0.55)` | `rgba(245, 158, 11, 0.55)` |

The ring-style border (`border: 2px solid rgba(150, 150, 160, 0.8)` today)
is **replaced by the inner+outer glow combo** — no static ring needed
because the pulse itself defines the silhouette.

**Negation override:** when the link is negated, identity color is suppressed:
`background: rgba(70, 70, 70, 0.85)`, `border: 2px solid rgba(160, 160, 160, 0.8)`,
`animation: none`. Negation = stronger signal, takes priority over identity
(consistent with the chain overlay's grey takeover).

---

##### Component ② — Chain overlay badge (Master Duel-style italic numeral)

**Chosen redesign: Variant A — "outline only"** (continuity-preserving):
- White fill on both self and opponent (current Master Duel pattern preserved)
- Stroke + glow split by player

**Color tokens:**

| Token | Self (cyan) | Opponent (amber) |
|---|---|---|
| Stroke | `#4a90d9` (current — preserved) | `#f59e0b` (amber-500) |
| Fill | `#ffffff` | `#ffffff` |
| Primary glow (text-shadow) | `rgba(74, 144, 217, 0.85)` | `rgba(245, 158, 11, 0.85)` |
| Secondary glow | `rgba(74, 144, 217, 0.5)` | `rgba(180, 83, 9, 0.45)` |

**Resolution pulse / negation:** untouched.

---

##### Implementation plan (for Amelia)

**Data already wired up.** `ChainLinkState.player` plus
`buildHandChainBadges()` / `buildOpponentHandChainData()` in
[chain-badge.utils.ts](front/src/app/pages/pvp/duel-page/chain-badge.utils.ts)
already split links by ownership. The grunt work is done — pure
presentational change.

**Files to touch:**

1. **Board badge SCSS** —
   [pvp-board-container.component.scss:531-561](front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss#L531-L561):
   - Replace `chain-badge-pulse` keyframes with the inner+outer glow
     animation from Option C (see mockup).
   - Add `.chain-badge--opponent` modifier swapping background + glow tokens.
   - Update typographic block (italic, stroke, paint-order, text-shadow).
   - Bump font-size to `19px` clamp range to compensate italic horizontal compression.

2. **Hand row badges SCSS** — same pattern reused (hand row chain badges
   follow board badge style, not overlay style). Verify the actual SCSS
   path during implementation (likely
   [pvp-hand-row.component.scss](front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.scss)).

3. **Chain overlay badge SCSS** —
   [pvp-chain-overlay.component.scss:282-326](front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss#L282-L326):
   - Add `.chain-badge--opponent` modifier swapping `-webkit-text-stroke`
     + `text-shadow` colors.

4. **Templates** —
   - In each consuming component, add `[class.chain-badge--opponent]="link.player !== ownPlayerIndex()"`
     (or equivalent based on the existing data flow).
   - Verify how the badge currently receives ownership info — likely via
     the parent computing ownership before pushing into the badge map.

5. **A11y wording** —
   [duel-a11y-effects.service.ts](front/src/app/pages/pvp/duel-page/duel-a11y-effects.service.ts):
   - Replace neutral `"Chain Link N added: X"` with
     `"You added Chain Link N: X"` / `"Opponent added Chain Link N: X"`.
   - Same pattern for the resolving + negated announcements.
   - Add new i18n keys (e.g. `duel.a11y.chainLinkAddedSelf` /
     `duel.a11y.chainLinkAddedOpponent`) in
     [assets/i18n/fr.json](front/src/assets/i18n/fr.json) and `en.json`.

**Animations:**
- Component ① gets a NEW pulse keyframe (Option C inner+outer glow). The
  current `chain-badge-pulse` keyframe is replaced, not extended.
- Component ② animations untouched.
- `prefers-reduced-motion`: animation disabled, identity colors stay (the
  whole point of the feature is identity, which is static — only the
  pulse motion is reduced).

**Tests:**
- Visual snapshot tests on `pvp-board-container` covering both player
  colors + negated state.
- Update `chain-badge.utils.spec.ts` if the badge map shape changes
  (likely doesn't — ownership is already in `ChainLinkState`).
- Manual QA on a real duel: trigger a 3-link chain spanning both players,
  verify identity is readable mid-pulse and post-resolution.

**Estimate:** ~3-4h dev + tests + visual QA (slight bump from initial
~2-3h estimate due to the redesigned pulse keyframe — more SCSS work
than a pure color swap).

**Open question to resolve during implementation:** the hand row badges
might or might not currently use the same SCSS as the board badge. If
they're duplicated (likely), the new tokens should be hoisted into a
shared SCSS partial (e.g. `_chain-badge.scss`) to avoid drift between
the three usage sites.

---

#### P0-2 — Visible countdown timer on prompts [❌ REJECTED — alternative requested]

**Original problem:** Player suffers silent timeouts on 9 prompts out of 10.

**Original recommendation:** Visible countdown on all prompts.

**Decision (Axel 2026-05-08):** ❌ **Rejected.** No timer on prompts.

**ALTERNATIVE REQUESTED:**
> *"The opponent's timer should NOT be visible during the opponent's turn.
> It should remain MY timer, frozen."*

**Reformulated finding — P0-2bis: REFINED & READY FOR IMPLEMENTATION**

**Problem:** During the opponent's turn, the timer badge currently shows
the opponent's countdown ticking down. This is:
1. Information overload (not actionable for the local player)
2. Psychological pressure (false anxiety: "is HIS time running out fast
   enough?")
3. Cognitive disconnect — the badge label says "your time" implicitly but
   shows someone else's clock

**Root cause discovered (code investigation 2026-05-08):**
- Server already sends per-player `TIMER_STATE` messages
  ([duel-ws.types.ts:618-622](front/src/app/pages/pvp/duel-ws.types.ts#L618-L622))
- `DuelConnection` already stores **both timers in parallel** via
  `_timerStatePerPlayer: [TimerStateMsg | null, TimerStateMsg | null]`
  ([duel-connection.ts:55, 551-555](front/src/app/pages/pvp/duel-page/duel-connection.ts#L55))
- The bug: `pvp-board-container` feeds the badge with `_timerState` (= last
  received, usually opponent during their turn) instead of
  `_timerStatePerPlayer[ownPlayerIndex]`
- The badge already has a dead `isActive` computed
  ([pvp-timer-badge.component.ts:34-37](front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts#L34-L37))
  unused in template — evidence the intent existed but was abandoned

**Decision on visual treatment (Axel 2026-05-08):** **Variant 3 — "frozen
disabled gray"**.

The badge displays the local player's timer at all times. During the
opponent's turn, the badge enters a **disabled visual state**:
- Color tokens swap to a **subtle gray palette** (no green/yellow/red
  threshold colors)
- Slightly reduced opacity (≈0.6-0.7)
- Numeric value remains accurate (= the value at which the local timer
  was last updated)
- No pause icon, no extra text label — pure "this is muted, not active"

When my turn returns, the badge transitions back to its colored state
(threshold-aware: green/yellow/red).

**Visual states:**

```
  My turn, 180s remaining             Opponent's turn — frozen
  ┌─────────┐                         ┌─────────┐
  │  180s   │  green (active)         │  180s   │  gray (disabled)
  └─────────┘                         └─────────┘

  My turn, 25s remaining              Opponent's turn — frozen at 25s
  ┌─────────┐                         ┌─────────┐
  │   25s   │  red (urgent)           │   25s   │  gray (disabled,
  └─────────┘                         └─────────┘   no urgency cue)

  Opponent disconnected (orthogonal — keep current behavior)
  ┌────────────────────────┐
  │ Opponent connecting... │  override
  └────────────────────────┘
```

**Why Variant 3 (chosen) over alternatives:**
- **Variant 1 (silent freeze)** — too ambiguous, looks like a bug
- **Variant 2 (pause icon ⏸)** — communicates well but adds UI element
- **Variant 4 (text label)** — verbose, info already redundant with phase
  badge / opponent-thinking glow
- **Variant 3 (gray disabled)** — communicates "not active" via universal
  visual language (disabled = grayed). Lets the timer remain present
  without competing for attention. Matches the "minimal UI noise" stance
  Axel prefers throughout the audit.

**Trade-off accepted:** The threshold colors (red ≤30s) become invisible
during the opponent's turn. This is fine — when frozen, the value isn't
counting down, so the urgency cue would be a lie anyway. Color returns
the moment my turn restarts.

**Implementation notes (for Amelia):**

1. **Source switch**: in `pvp-board-container.component.ts`, change the
   timer source to read `_timerStatePerPlayer[ownPlayerIndex()]` instead
   of the legacy `_timerState`. Keep `_timerState` if still used by other
   consumers (debug log, etc.) — verify with a grep.

2. **New input** on `PvpTimerBadgeComponent`:
   `isOwnTurn = input<boolean>(false)`. Computed by the parent:
   `turnPlayer() === ownPlayerIndex()` (using absolute player indices).

3. **Cleanup**: delete the dead `isActive` computed at
   [pvp-timer-badge.component.ts:34-37](front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts#L34-L37)
   in the same PR.

4. **Color logic update** in the badge component:
   ```ts
   readonly colorClass = computed(() => {
     const state = this.timerState();
     if (!state) return '';
     if (!this.isOwnTurn()) return 'timer--disabled';  // NEW
     const totalSec = Math.floor(state.remainingMs / 1000);
     if (totalSec <= 30) return 'timer--red';
     if (totalSec <= 120) return 'timer--yellow';
     return 'timer--green';
   });
   ```

5. **SCSS**: add `.timer--disabled` modifier in
   `pvp-timer-badge.component.scss`. Use the project's neutral gray tokens
   (check `styles/_z-layers.scss` siblings for existing gray scale; if
   none, propose `#9ca3af` or similar mid-gray with opacity 0.65).
   Respect `prefers-reduced-motion` for the color transition.

6. **A11y**: dynamic `aria-label`:
   - Own turn: `"Your timer, X seconds remaining"` (current behavior)
   - Opponent's turn: `"Your timer, X seconds, paused — opponent's turn"`

7. **Open question to verify before/during impl**: does the server
   actually send a `TIMER_STATE` for the local player while the opponent
   is playing? If only the active player's timer is broadcast, the local
   timer's `remainingMs` will be stale (frozen at the value from the last
   "my turn" tick — which is actually the desired behavior, but worth
   confirming there's no UX regression where the displayed value drifts
   behind reality).

8. **Tests**: extend `pvp-timer-badge.spec.ts` to cover:
   - Own turn → colored variant
   - Opponent's turn → disabled gray variant (regardless of remainingMs)
   - Opponent's turn at value ≤30s → still gray, NOT red
   - Disconnect override → "Opponent connecting..." regardless of turn

9. **Estimated effort**: ~45-90 min including tests.

---

#### P0-3 — SELECT_PLACE / SELECT_DISFIELD direct click [❌ REJECTED — different pursuit]

**Original problem:** Wrong click on ED-link zone = lose game. No reverse.

**Original recommendation:** "tap-to-select / tap-confirm" pattern, or at
minimum mandatory double-click.

**Decision (Axel 2026-05-08):** ❌ **Rejected as proposed**, **REFRAMED into
P0-3bis: Reversible Multi-Step Prompts (Category E).**

---

##### P0-3bis — Reversible Multi-Step Prompts (Category E) [⏳ INVESTIGATION BRIEF READY]

**Refined product intent (Axel 2026-05-08, after scoping session):**

> *"I want to be able to click 'Special Summon from Extra Deck', see the
> next prompt step (zone selection), and **cancel** before I commit. Same
> for any multi-step SELECT_* sequence."*

**This is NOT** an action preview or speculation engine. It is **rollback
of in-progress prompt sequences** before final commit. Five categories
were considered during scoping:

| Cat | Intent | Decision |
|---|---|---|
| A | Static legality validation (legal zones, etc.) | Out of scope |
| B | Trigger projection (who will trigger if I do X) | Out of scope |
| C | Chain projection (full chain simulation) | Out of scope |
| D | End-board projection (full combo simulation) | Out of scope (=Solver territory) |
| **E** | **Multi-step prompt rollback** (cancel before commit) | **✅ IN SCOPE** |

**Key product decisions:**

1. **Scope: ALL multi-step SELECT_\* sequences.** Not a per-prompt fix —
   needs a generic mechanism that works for SELECT_PLACE, SELECT_CARD,
   SELECT_TRIBUTE, SELECT_DISFIELD, SELECT_TARGET, etc.

2. **Audience: competitive default** — visible to all players, no toggle.
   This is prompt ergonomics, not a crutch.

3. **Latency: <100ms synchronous.** Cancellation must feel instant. This
   constrains the implementation: no server round-trip allowed for the
   cancel — it must be local rollback at the prompt-state level.

4. **UI: right-click to step back** — leverages an already-learned gesture
   (right-click is currently used as cancel on some prompts —
   [pvp-prompt-dialog.component.ts:146-154](front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.ts#L146-L154)).
   The cancel-the-current-step semantic must be preserved when the prompt
   is part of a chain that can be cancelled (vs prompts where the
   commitment already happened upstream).

---

##### Investigation brief (for Winston)

**Goal:** Determine whether ocgcore can support reversible multi-step
prompt sequences with <100ms cancel latency, and recommend an
implementation strategy.

**Critical question to answer:** When a player clicks "Activate Effect"
and ocgcore enters a SELECT_PLACE / SELECT_TARGET / etc. state, **is
that state reversible?** If yes — how? If no — what alternatives exist?

**Investigation axes:**

1. **ocgcore state model**
   - Does ocgcore expose save/restore primitives (e.g.
     `Duel::SaveState()` / `Duel::LoadState()` or equivalent in the wrapped
     bindings used by skytrix)?
   - At what granularity? Per `duelProcess()` call? Per event? Per chain
     boundary?
   - What's the cost of a save (memory + time)? Of a restore?

2. **Current skytrix server architecture**
   - Where does the SELECT_* state live during prompt resolution? In
     ocgcore's internal state, in the duel-worker's wrapper, or both?
   - When the client sends a SELECT_* response, what does the server do
     before committing? Is there any pre-commit window?
   - References: [duel-server/duel-worker.ts](duel-server/duel-worker.ts)
     (likely path), `runDuelLoop` function

3. **Cancellation strategies (ranked by feasibility)**

   **Strategy 1 — Pure ocgcore rollback (ideal):**
   Server saves state at every "ENTER_SELECT_*" boundary. Right-click
   sends a CANCEL message → server restores. Client UI returns to
   pre-prompt state instantly.

   **Strategy 2 — Lazy commit (fallback):**
   Don't actually call ocgcore's response handler until the player
   confirms. Hold the SELECT_* response in a server-side buffer. On
   cancel, drop the buffer. On confirm, send. Issue: requires every
   prompt to expose an explicit confirm step (some currently auto-commit
   on click).

   **Strategy 3 — Client-side optimistic UI (degraded):**
   Treat SELECT_* in two phases on the client: "tentative selection"
   (purely UI) → "final selection" (sent to server). Cancel = drop
   tentative. Latency 0ms, but only works for prompts where the choice
   is purely cosmetic between client and server (no info revealed).

   **Strategy 4 — Hybrid (likely outcome):**
   Strategy 3 for prompts that have pure-client tentative state
   (SELECT_PLACE, position select). Strategy 2 for prompts where the
   server needs to know early (SELECT_TARGET reveals targeting info).
   Strategy 1 only if ocgcore makes it cheap.

4. **Edge cases to think through**
   - What if the player cancels during a chain that's already mid-resolution?
     (Probably forbidden — cancellation only available for the player's
     own active prompts, not anyone else's.)
   - What if the prompt timeout fires while the player is hovering with
     a tentative selection? (Server should treat tentative as not-sent
     → default fires.)
   - What if connection drops between cancel and re-enter? (Server is
     authoritative — its state is the truth, client re-syncs.)
   - Replay mode: cancellation has no meaning. The replay just shows the
     final committed action. Feature must be PVP-only.

5. **Existing snapshot mechanism (worth checking)**
   - [duel-server/duel-worker.ts](duel-server/duel-worker.ts) already
     builds per-event `boardStateAfter` snapshots in `runDuelLoop` /
     `runReplayPreComputation` (cf. CLAUDE.md). These are observation
     snapshots, not state-machine snapshots — different beast. But the
     existing serialization code might be reusable for Strategy 1.

**Output expected from Winston:**

A short technical brief (~600-800 words) answering:
1. Is Strategy 1 (pure ocgcore rollback) feasible in this codebase? Cost?
2. If not, is Strategy 2 (lazy commit) feasible? What server changes?
3. What's the recommended path forward (which Strategy or hybrid)?
4. Estimated effort (S/M/L/XL) for the recommended path.
5. Risks / unknowns that would require deeper investigation.

**Pre-investigation references:**
- [duel-server/](duel-server/) — ocgcore wrapping layer
- [_bmad-output/planning-artifacts/architecture-pvp.md](_bmad-output/planning-artifacts/architecture-pvp.md)
- [_bmad-output/planning-artifacts/ocgcore-technical-reference.md](_bmad-output/planning-artifacts/ocgcore-technical-reference.md)
- [front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.ts:146-154](front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.ts#L146-L154)
  for the existing right-click cancel pattern
- The ocgcore source itself (likely a git submodule under
  [duel-server/](duel-server/) or vendored) — for save/restore primitives

**This is an R&D track.** Winston should produce the brief, then come
back to Sally + Axel for joint review. Implementation only starts after
the strategy is locked.

**Status:** ⏳ Ready for Winston to start.

---

### 🟡 P1 — Perceptible friction (next sprint)

| ID | Finding | Recommendation | Status |
|---|---|---|---|
| **P1-1** | No replay speed control | 0.5×/1×/2×/4× slider in transport-bar | Pending discussion |
| **P1-2** | No replay discovery surface | `/pvp/history` page with deck/opponent/date/result filters | Pending discussion |
| **P1-3** | Effect submenus don't close on "back" | Stack-aware dismissal (Escape closes top of stack only) | Pending discussion |
| **P1-4** | Race / Attribute hardcoded "Race X" | i18n of YGO constants (FIRE, WATER, Dragon, Spellcaster…) | Pending discussion |
| **P1-5** | Ambiguous waiting state ("waitingResponse") | Dynamic label "Waiting for [opponentName]" vs "Your move" | Pending discussion |
| **P1-6** | No post-chain resolution recap | 3-5s mini-history: "Effect of A resolved · B negated · C resolved" | Pending discussion |
| **P1-7** | Grace timer duration invisible | Label "Reconnecting… 45s remaining" under bar | Pending discussion |
| **P1-8** | Hand row overlap -0.41 hard to target | Peek zone: hovered card rises 12px and z-tops | Pending discussion |

### 🟢 P2 — Polish (backlog)

| ID | Finding | Recommendation | Status |
|---|---|---|---|
| **P2-1** | Missing aria-labels on lobby (Join, quick-duel input) | Add labels | Pending discussion |
| **P2-2** | 3 keyboard conventions | Single convention: `1-9` for numbered choices, Enter=primary, Escape=secondary, Space=toggle | Pending discussion |
| **P2-3** | No "OPT consumed" visible | ⓘ marker on cards that already used their effect this turn | Pending discussion |
| **P2-4** | No share/bookmark replay timestamp | "Copy link to this moment" button in transport-bar | Pending discussion |
| **P2-5** | "Not-computed" bullets without explanation | Tooltip "Computing remaining states…" | Pending discussion |
| **P2-6** | No opponent profile / ELO pre-duel | Clickable profile badge in waiting room | Pending discussion |
| **P2-7** | No optimistic update on room creation | Inline spinner + button-only disable, no full-screen block | Pending discussion |

## 9. Structural Strength to Preserve

The `AnimationDataSource` architectural discipline documented in
[CLAUDE.md](CLAUDE.md) is exemplary. It guarantees that any UX improvement
applied to PVP automatically benefits Replay. **All future evolution should
flow through this channel — it's what maintains the near-perfect parity
observed.**

## 10. Next Steps — Status

| Track | Status | Owner | Next move |
|---|---|---|---|
| **P0-1 (player markers)** | ✅ **REFINED — ready for dev** | Amelia | Implement per spec in §8.P0-1. Mockup at [_bmad-output/mockups/p0-1-player-markers.html](_bmad-output/mockups/p0-1-player-markers.html). |
| **P0-2bis (frozen timer on opponent's turn)** | ✅ **REFINED — ready for dev** | Amelia | Implement per spec in §8.P0-2bis. ~45-90 min effort. |
| **P0-3bis (reversible multi-step prompts)** | ✅ **DELIVERED** | shipped | All 5 stories done: WASM snapshot POC, worker wrapper (5 state slots), CANCEL_PROMPT_SEQUENCE protocol + UI right-click, lifecycle gating (chain interlock + 30s TTL + cleanup), multi-duel concurrency stress test. 270/270 vitest green. Ready for production. See [`p0-3bis-poc-1-report.md`](../implementation-artifacts/p0-3bis-poc-1-report.md) and the four [`p0-3bis-*.md`](../implementation-artifacts/) story files. |

**Recommended sequence for delivery:**
1. P0-2bis first (smallest, lowest risk, immediate UX gain) — single sprint task
2. P0-1 next (medium effort, big perceptual gain) — same or next sprint
3. ~~P0-3bis after (R&D track, multi-week, gated by product scoping) — separate workstream~~ — **delivered 2026-05-08**

---

**Document maintained by:** Sally (UX Designer)
**Source data:** Live code reading on master branch, commit `59e54258` (2026-05-08)
**Related artifacts:**
- [ux-design-specification-pvp.md](_bmad-output/planning-artifacts/ux-design-specification-pvp.md)
- [ux-design-specification-replay.md](_bmad-output/planning-artifacts/ux-design-specification-replay.md)
- [CLAUDE.md](CLAUDE.md) (animation parity rules, chain state machine)
