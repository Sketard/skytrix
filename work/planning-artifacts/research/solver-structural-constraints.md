# Solver Structural Constraints — limits on viable combo discovery

**Status:** v1 — 2026-04-13
**Purpose:** Formalize the axes along which the Combo Path Solver is bounded
from producing viable combo lines on meta decks. Each constraint is a lever:
lifting one raises the ceiling on what the solver can discover, but they are
not independent — some are multiplicative (move ordering × node budget),
others additive (fork cost + timeout).

This document is the reference when deciding where to invest. It does not
prescribe fixes — it enumerates what caps the current architecture.

---

## Success criterion

The solver is **functional** if it produces viable combo lines for competitive
meta decks (Tier 1-2 of the current format). A *viable line* is one that a
competent human player would recognize as the intended combo for a given
opener: the right end-board, the right sequence of activations, and a score
that matches community consensus on deck strength.

Anything less than this is considered **partial**, and partial is equivalent
to buggy — a solver that occasionally finds the right line or finds a
plausible-looking wrong line is harder to trust than one that cleanly fails.
This bar governs the entire document: each constraint is evaluated by asking
"can the solver cross this threshold without addressing this item?"

---

## 1. Physical constraints (scaling axes)

These constraints have purely quantitative effects. They describe the size
and cost of the search, independent of any semantic understanding of the
game.

### 1.1 Node budget

**Description:** The maximum number of decision nodes the DFS or MCTS
expansion can visit within a single solve.

**Current state:** Bounded implicitly by `timeLimitMs` for DFS and by
`treePruningTopX / maxResultNodes` (500) for the returned decision tree.
There is no explicit node cap during the exhaustive search phase.

**Impact:** Determines how much of the state space the solver can sample.
Meta decks have branching factors in the 5-20 range at Main Phase prompts
(observed max BF of 17 on Mitsurugi, 15 on Dracotail, 17 on D/D/D). At
BF=10 and depth 15, the theoretical tree has 10¹⁵ = 10^15 nodes — the
solver sees <1% of it in any practical budget.

**Levers:**
- Progressive widening (limit children per visit based on N^α)
- Iterative deepening (allow shallow exhaustive first, widen as budget allows)
- Beam search with pruning by score estimate
- Selective action expansion (don't expand actions the ranker rates below a threshold)

**Interaction:** Amplified by `1.3 Fork cost` and `2.1 Move ordering`.
Uncapped by timeout alone because each node has a fixed floor cost.

---

### 1.2 Wall-clock timeout

**Description:** The maximum wall-clock time a solve can run before being
forcibly terminated by the orchestrator.

**Current state:** Configurable via `timeBudgetFastMs` (5000ms) and
`timeBudgetOptimalMs` (60000ms) in `solver-config.json`. A verification
budget of 15% is reserved for `verifyMainPath`. The orchestrator enforces
a 1.5× hard kill deadline.

**Impact:** Bounds user-perceived latency. Per the current brief, time is
acceptable "within reason" — so this is not the hard constraint, but it
still defines the working window for the exhaustive phase.

**Levers:**
- Per-solve mode tiers (fast/optimal/exhaustive)
- Background solves (dispatch to a queue, poll for results)
- Early termination when a verified line is found (even below budget)

**Interaction:** Interacts multiplicatively with `1.3 Fork cost`. Raising
this constraint alone yields diminishing returns unless fork cost drops.

---

### 1.3 Fork cost

**Description:** The time required to create a new search branch from a
parent state. Each DFS child or MCTS expansion requires a fork.

**Current state:** `OCGCoreAdapter.fork()` delegates to `forkViaReplay()`
because `@n1xx1/ocgcore-wasm` v0.1.1 does not expose a native WASM memory
snapshot. The replay mechanism re-applies the entire action history on a
fresh duel instance. Empirical cost: **10-17ms per fork** on a typical
branch; scales linearly with path length (later nodes are more expensive
than early ones because they replay longer histories).

**Impact:** Dominates budget usage for any non-trivial combo. At 15ms/fork
and a 5000ms budget, the absolute ceiling is 333 forks per solve —
*before* the cost of action enumeration, Zobrist hashing, scoring, or TT
lookups. Meta combo lines are 15-25 actions long; with branching factor
even modestly above 1, the raw number of required forks exceeds the
budget.

A snapshot-based fork (constant-time, O(1) in path length) would lift
this ceiling by roughly 10-50× depending on combo depth.

**Levers:**
- Upstream: wait for `@n1xx1/ocgcore-wasm` to expose WASM memory snapshot
- Local: cache intermediate state in a fork pool keyed by Zobrist hash
  (risky because OCGCore internal state is not captured by Zobrist)
- Architectural: shift to an MCTS variant that reuses handles across
  iterations instead of forking per expansion

**Interaction:** This is the hidden multiplier behind `1.1 Node budget`
and `1.2 Wall-clock timeout`. Lifting either without lifting this yields
less-than-proportional gains.

---

## 2. Semantic constraints (search quality)

These constraints relate to the *direction* the search takes, not how much
it covers. Even with infinite physical resources, a solver with a bad
compass explores the wrong space.

### 2.1 Move ordering (ranker quality)

**Description:** The order in which legal actions are enumerated for
exploration. Better ordering → the solver reaches good terminals before
budget expires.

**Current state:** `GoldfishChainRanker` reorders `SELECT_CHAIN`
(activations first, pass last) and `SELECT_BATTLECMD` (to_m2/to_ep only,
skipping individual attacks). `SELECT_IDLECMD` — the single most important
decision point — uses raw OCGCore enumeration order. `SELECT_EFFECTYN`,
`SELECT_YESNO`, `SELECT_OPTION`, `SELECT_CARD`, `SELECT_POSITION`,
`SELECT_TRIBUTE` are all unordered.

**Impact:** Combo discovery is fundamentally a pathfinding problem. The
DFS is exhaustive within its budget; the question is whether it reaches
the right terminal before running out. With bad ordering, the "right"
sequence sits at the end of a wide enumeration and is visited last —
often after budget is exhausted. Move ordering is the dominant lever
for effective depth.

**Levers:**
- Heuristic ordering at `SELECT_IDLECMD`: prioritize summons > activations > sets > pass
- Card-archetype-aware ordering (Dracotail combo piece first for a Dracotail deck)
- Statistical ordering from prior solves (which actions led to high-score terminals?)
- Learned policy (shallow NN over action features)

**Interaction:** Multiplies the effective reach of `1.1 Node budget`. A
good ranker can make a 500-node search discover combos that a bad ranker
would need 50000 nodes to find.

---

### 2.2 Scorer fidelity

**Description:** How well the scoring function ranks boards by their
real-world strength. The solver follows the scorer; if the scorer is
miscalibrated, the solver converges on the wrong goal.

**Current state:** `InterruptionScorer` computes a weighted sum over
tagged interruption effects (15 interruption types, each with a weight
from `interruption-weights.json`) plus a small fallback heuristic
(+1 per face-up monster in a Monster Zone). Tagged cards total 171 in
`interruption-tags.json`, vs ~13k cards in cards.cdb — coverage is
approximately 1.3%.

**Issues beyond `2.3 Latent modeling`:**
- Relative weights of interruption types are empirically set (omniNegate=14,
  typedNegate=10, etc.) and have not been calibrated against expert judgment.
- Fallback heuristic doesn't distinguish a vanilla 4-star beater from a boss
  monster that *could* be tagged but isn't.
- No concept of resource cost (did the combo use 5 cards to build a 3-card
  endboard? That's worse than a 2-card combo to the same endboard).
- No concept of LP remaining, hand size, or deck depletion — identical
  boards with different resource states score identically.
- Life points remaining are not scored; a board that survives a test turn
  with 8000 LP versus 1000 LP is indistinguishable.

**Impact:** Even with perfect exploration and perfect node budget, the
solver will converge on whatever terminal scores highest. If the scorer
overweights shallow terminals (the "do nothing is safe" bias we just
fixed for Extra Deck face-down cards), long combos are never preferred.

**Levers:**
- Expand `interruption-tags.json` coverage via LLM batch (discussed
  separately)
- Calibrate weights against human rankings of known meta boards
- Add a resource-cost penalty term (cards used vs cards on board)
- Add a survivability term (estimated LP / remaining interrupts)

**Interaction:** Gates everything else. A fixed scorer with all other
axes at infinity still produces the wrong answer.

---

### 2.3 Latent interruption modeling

**Description:** Cards whose value comes not from their own effect but
from what they can trigger during the opponent's turn — the "wake-up"
pattern pervasive in modern meta (Faimena → Guramel, Diabellstar →
Original Sinful Spoils → Snake-Eye chain, Albion → Branded Fusion, etc).

**Current state:** Not modeled. `InterruptionTag` entries record only
what a card itself does. A board that ends on Faimena + Guramel-in-extra
scores 0 because Faimena is not on any interruption list and Guramel
is face-down in the Extra Deck (and would be skipped anyway after the
recent face-down-extra fix).

**Impact:** The majority of modern meta endboards rely on at least one
wake-up layer. Branded, Snake-Eye, Tearlaments, Kashtira, Floowandereeze,
Dracotail, Mitsurugi, Runick all use this pattern. A solver unable to
recognize latent interruptions cannot score any of their real endboards
correctly, which means it cannot discover them (search follows scoring).

**Levers:**
- Extend `InterruptionTag` with an `enables` field describing what the
  card can trigger and under what preconditions
- Build a pre-computed "latent potential" table via offline simulation:
  fork representative terminals, apply canonical opponent plays, observe
  state deltas, store the result
- Score latent effects with a confidence discount (fraction of direct value)
- Limit recursion depth (1-2 hops for v1, deeper for v2)

**Interaction:** Independent of physical constraints — this is a pure
modeling gap. Closing it does not help if `1.3 Fork cost` prevents the
solver from reaching the terminal where the latent card would be
recognized in the first place.

---

## 3. Representation constraints (model gaps)

These are places where the solver's observation of the game state is
incomplete relative to OCGCore's real internal state.

### 3.1 Observed state completeness

**Description:** The set of observable game facts available to Zobrist
hashing, verification keys, and the scorer.

**Current state:** The adapter exposes zones (18 physical), card positions,
LP, phase, turn, overlay counts, and activation log (Story 1.8). It does
**not** expose:
- Chain queue position (which link of the current chain we're on)
- Effect resolution stage (pending targets, triggered-but-not-resolved
  effects waiting to be chained)
- Per-chain-window state (which handtraps are "consumed this window"
  distinct from OPT-spent-this-turn)
- Order-of-resolution metadata (which card activated first this chain)

**Impact:** We already hit this when restricting TT caching to
`SELECT_IDLECMD` prompts. Two distinct chain-resolution states with
identical field content collapse to the same Zobrist hash, causing the TT
to short-circuit valid branches with stale cached scores. The workaround
(gate TT to IDLECMD only) preserves correctness but loses cache benefits
on chain-heavy combos.

**Levers:**
- Upstream: ask `@n1xx1/ocgcore-wasm` to expose chain queue inspection
- Local: enrich the verification key with a prompt fingerprint
  (promptType + sorted action fingerprints) — already considered and
  deemed insufficient for the Mitsurugi case
- Architectural: track an "event sequence counter" incremented per
  applyAction, hash it alongside the board — makes every state unique
  but breaks legitimate cross-path TT hits

**Interaction:** Compounds with every caching-related optimization
(`1.1 Node budget`, TT, loop detection).

---

### 3.2 Terminal classification

**Description:** When the DFS decides a branch is "done", the reason
matters for scoring.

**Current state:** A branch is terminal when `actions.length === 0` OR
`depth >= maxDepth`. The DFS does not distinguish:
- (a) *Volontary end phase* — the player chose to end turn, resulting
  in a legitimate scored endboard
- (b) *Stuck* — no legal actions remain mid-phase because every remaining
  option is blocked (no mana, no valid targets, no activatable effects)
- (c) *Depth cap hit* — the cap bit before the combo finished; the state
  is mid-combo

All three are scored by the same `scoreTerminal()` call, using the same
`scoreWithCards()` function, with no distinction. Case (a) is a real
endboard; (b) and (c) are not meaningful game states but still contribute
to `ctx.bestScore` tracking.

**Impact:** Short-line terminals of type (a) at depth 2 can out-score
long-line terminals of type (c) at depth 50 when the combo is mid-resolution,
biasing `extractMainPath()` toward shallow unfinished sequences. The
recent observability instrumentation exposes `depthCapHit` but the
scorer does not use it.

**Levers:**
- Detect (a) vs (b)/(c) via phase inspection at terminal time (a proper
  end-phase terminal has `phase === 'END'`)
- Down-weight (b)/(c) terminals in the scorer
- Refuse to score (c) at all — propagate score of best *reachable*
  descendant instead

**Interaction:** Partially addresses the scorer bias but does not replace
a correct scoring function for completed endboards.

---

### 3.3 Deck seed determinism

**Description:** The reproducibility of a solve given the same input
(deck, hand, algorithm, seed).

**Current state:** `SolverOrchestrator.solve()` generates fresh random
bytes for each worker seed (`randomBytes(16)`), overriding any
`deckSeed` specified in the `DuelConfig`. Two runs on the same fixture
produce different deck orders, different draws, and therefore different
search trees. Our harness fixture stores a deckSeed per hand, but it is
silently discarded.

**Impact:** Golden test fixtures and regression checks are impossible.
We cannot meaningfully compare two commits on the same input because
the input is randomized. Human inspection of a "weird" result cannot
be reproduced by another developer.

**Levers:**
- Respect `duelConfig.deckSeed` when provided; only randomize when absent
- Expose a CLI flag on the harness to force deterministic mode
- For MCTS, keep seed diversity across workers but derive them
  deterministically from a session seed

**Interaction:** Independent of all other constraints. Pure reproducibility
/ tooling concern. Must be addressed before any regression harness can
be built.

---

## 4. Scope constraints (coverage and trust)

### 4.1 Data coverage

**Description:** The fraction of existing Yu-Gi-Oh! cards that the
solver can correctly model.

**Current state:** `cards.cdb` contains approximately 13k cards; the
`scripts_full/official/` directory ships approximately 13k corresponding
Lua scripts. The startup warnings observed during solver runs show a
few missing scripts (`c0.lua`, `proc_unofficial.lua`, `c43096270.lua`)
but these are sentinel or smoke-test cards, not meta cards. Meta card
coverage is effectively 100% at the data level.

What is *not* fully covered:
- Cards released between the last `cards.cdb` refresh and the current date
- Cards with errata (`c43096270` alias issue already documented)
- Alias normalization (multiple IDs pointing to the same card — handled
  in the fixture loader but not audited)
- Forbidden/limited list awareness (all cards are treated as legal)

**Impact:** Uncovered card → action enumerator silently returns empty
or wrong actions → combo invisible to the solver. The pipeline fails
silently, which is the worst possible failure mode for a tool under
the "partial is buggy" contract.

**Levers:**
- Script version pin + CI check that all fixture cards are present
- Refresh procedure documented (pull latest `cards.cdb` + `scripts_full`
  from Project Ignis)
- Ban list integration (optional for goldfish, required for adversarial)

**Interaction:** Bounds the universe of testable decks. Independent of
all other constraints.

---

### 4.2 Verification and trust

**Description:** The confidence that a returned combo line is actually
replayable on a fresh duel with the same input.

**Current state:** `verifyMainPath()` in `solver-worker.ts` replays the
recommended line on a fresh duel post-solve. On mismatch, the result is
marked `verified: false` but **still returned** to the caller. The
frontend displays a warning icon but does not refuse to display
unverified lines.

**Impact:** Unverified lines can happen legitimately (non-determinism in
OCGCore, which the action enumerator sometimes exhibits at certain
prompts) and illegitimately (the solver internally diverged from the
replay due to a state bug). Without distinguishing the two, the user
cannot know whether to trust a line.

**Levers:**
- Classify verification failures by root cause (enumerator non-determinism
  vs. state divergence)
- Auto-retry on non-determinism, hard-fail on divergence
- Refuse to return unverified lines in a "strict" mode

**Interaction:** Orthogonal to the search itself. This is about trust,
not search quality.

---

## 5. Prioritization

Rough ranking by impact on the "produce viable lines" criterion, combined
with estimated implementation effort:

| # | Constraint | Severity | Effort | First to unlock |
|---|-----------|---------|--------|-----------------|
| 2.3 | Latent interruption modeling | 🔴 Blocking | High | Meta endboard scoring |
| 1.3 | Fork cost | 🔴 Blocking | Depends on upstream | Deep combo reach |
| 2.1 | Move ordering | 🔴 Blocking | Medium | Effective depth per budget |
| 2.2 | Scorer fidelity | 🟠 High | Medium | Ranking quality |
| 3.3 | Deck seed determinism | 🟠 High | Low | Regression testing |
| 3.1 | Observed state completeness | 🟠 High | High | TT caching on chain windows |
| 3.2 | Terminal classification | 🟡 Medium | Low | Short-line scoring bias |
| 4.2 | Verification and trust | 🟡 Medium | Low | User confidence |
| 1.1 | Node budget | 🟡 Medium | Low | Marginal once ordering fixed |
| 4.1 | Data coverage | 🟢 Low | Low | Edge-case decks |
| 1.2 | Wall-clock timeout | 🟢 Low | N/A | Stated as acceptable |

The three top blockers (2.3 latent, 1.3 fork, 2.1 ordering) each alone
prevent viable lines on every tested meta deck. They are also mutually
reinforcing: a better scorer (2.3) without reach (1.3) gets nowhere, a
bigger reach (1.3) without direction (2.1) explores randomly, a better
ordering (2.1) without a compass (2.3) reaches the wrong place.

There is no single "fix one constraint" path to viable output. A viable
solver requires addressing at least one item from each of the three
sections (physical, semantic, representation) simultaneously.

---

## Explicitly out of scope for this document

Items that affect solver behavior but are not conceptual constraints
on the architecture:

- **Resource modeling** (LP, hand size, deck count as scoring inputs) —
  a feature request, not a constraint
- **Goldfish vs adversarial mode** — a mode selector; both modes share
  all constraints above
- **Memory ceiling interaction between V8 and WASM** — an implementation
  detail, not a modeling limit
- **Upstream EDOPro script bugs** — outside our control, addressed via
  the data refresh procedure
- **Multi-player formats** (Tag Duel, 3v3) — not in the solver's target
  scope
