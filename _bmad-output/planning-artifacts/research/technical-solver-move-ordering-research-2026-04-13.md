---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/research/solver-structural-constraints.md
  - _bmad-output/planning-artifacts/research/technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md
  - _bmad-output/planning-artifacts/research/technical-solver-fork-cost-resolution-research-2026-04-13.md
workflowType: 'research'
lastStep: 6
status: 'complete'
research_type: 'technical'
research_topic: 'Move ordering for the YGO combo solver'
research_goals: |
  1. Survey move-ordering techniques from mature game-AI communities
     (chess alpha-beta engines, Go classical and modern MCTS, Hearthstone
     AI, poker action abstraction, general search heuristics) and extract
     the primitives that apply to non-alpha-beta search with hard time
     budgets.
  2. Analyze the unique decision points of the YGO solver:
     `SELECT_IDLECMD` (the dominant bottleneck), `SELECT_CHAIN`,
     `SELECT_BATTLECMD`, `SELECT_EFFECTYN`, `SELECT_YESNO`,
     `SELECT_OPTION`, `SELECT_CARD`, `SELECT_POSITION`,
     `SELECT_TRIBUTE` — and determine which ordering techniques are
     applicable where.
  3. Distill archetype-aware ordering strategies: how to bias
     enumeration toward the combo-relevant cards of the current deck
     without hard-coding per-archetype logic.
  4. Evaluate statistical-learning ordering (history heuristic, killer
     moves, counter-move, late move reduction) that accumulates
     signal over the course of a single solve.
  5. Propose a concrete v1 ranker architecture extending the existing
     `GoldfishChainRanker` to cover `SELECT_IDLECMD` and the other
     unordered prompts, with effort bands and a validation strategy.
user_name: 'Axel'
date: '2026-04-13'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical

**Date:** 2026-04-13
**Author:** Axel
**Research Type:** Technical

---

## Research Overview

This research addresses constraint 2.1 from
[solver-structural-constraints.md](./solver-structural-constraints.md):
**move ordering (ranker quality)**. The Yu-Gi-Oh combo solver currently
orders actions at only two prompt types:

- `SELECT_CHAIN` — reordered by `GoldfishChainRanker` (activations
  first, pass last).
- `SELECT_BATTLECMD` — filtered to `to_m2` / `to_ep` only, skipping
  individual attacks.

Every other prompt — including `SELECT_IDLECMD`, **the single most
important decision point in main phase combo building** — uses raw
enumeration order as returned by OCGCore. `SELECT_EFFECTYN`,
`SELECT_YESNO`, `SELECT_OPTION`, `SELECT_CARD`, `SELECT_POSITION`,
and `SELECT_TRIBUTE` are similarly unordered.

The constraints doc is explicit that move ordering is **the dominant
lever for effective depth per unit of budget**: *"A good ranker can
make a 500-node search discover combos that a bad ranker would need
50000 nodes to find."* This is not an optimization — it is the
difference between the solver reaching the right terminal before the
budget expires and not reaching it at all.

Move ordering is the **third of the three top blockers** identified in
the constraints doc, alongside:

- **Scorer fidelity** (addressed by
  [the pre-DL latent evaluation research](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md))
- **Fork cost** (addressed by
  [the fork cost research](./technical-solver-fork-cost-resolution-research-2026-04-13.md))

The three blockers are **mutually reinforcing**. A better scorer
without reach gets nowhere (fork cost ceiling). A bigger reach without
direction explores randomly (move ordering ceiling). A better compass
without a map reaches the wrong place (scorer ceiling). This research
addresses the third track — direction.

The methodology is **cross-domain transposition with YGO-specific
decision analysis**. Chess alpha-beta engines have 60+ years of
move-ordering literature, but the context is different (alpha-beta
with known bounds). Go classical MCTS (RAVE, progressive bias)
operates in a non-alpha-beta regime closer to ours. Hearthstone AI
and general MCTS research contribute card-game-specific patterns.
Each technique is evaluated for applicability to YGO's prompt types,
which are more varied than chess moves or Go stones.

Explicitly out of scope: learned policy networks (bootstrap problem,
same argument as prior researches — no labeled corpus of good action
sequences at v1), adversarial-specific ordering (handtrap predictions
for Epic 2 MCTS — different research track once Epic 2 stabilizes),
and alpha-beta pruning (our DFS is exhaustive within budget, not
alpha-beta).

---

## Technical Research Scope Confirmation

**Research Topic:** Move ordering for the YGO combo solver (constraint 2.1)

**Research Goals:**

1. Survey move-ordering techniques from chess alpha-beta engines, Go
   classical and modern MCTS, Hearthstone AI, poker action abstraction,
   and general search heuristics. Focus on techniques applicable to
   non-alpha-beta DFS with hard time budget.
2. Analyze the unique decision points of the YGO solver and determine
   which ordering technique applies to which prompt type.
3. Distill archetype-aware ordering strategies without per-archetype
   hard-coded logic.
4. Evaluate statistical-learning ordering (history heuristic, killer
   moves, counter-move, LMR analogs) that accumulates signal within
   a single solve.
5. Propose a concrete v1 ranker architecture extending the existing
   `GoldfishChainRanker` to cover all unordered prompts.

**Technical Research Scope:**

- **Chess classical ordering** — MVV-LVA, killer moves, history
  heuristic, counter-move, PV move, hash move, SEE, LMR
- **Go MCTS ordering** — RAVE, AMAF, progressive bias, progressive
  widening, PUCT, prior-biased UCT
- **Card game action pruning** — Hearthstone AI literature, Tales of
  Tribute / Strategy Card Game AI competitions, poker abstraction
- **Non-alpha-beta ordering** — techniques for DFS without a window,
  where the cutoff is time budget rather than score bounds
- **YGO-specific prompt analysis** — decomposition by prompt type,
  critical vs. marginal prompts, cross-prompt interactions
- **Archetype inference** — detect deck archetype at runtime, bias
  without enum hard-coding
- **Intra-solve statistical ordering** — history heuristic adapted:
  "which action led to high scores recently" → boost future encounters

**Research Methodology:**

- Cross-domain transposition (chess + Go + Hearthstone + general MCTS)
- YGO decision point analysis per prompt type
- Multi-source verification for every technique
- Final deliverable: concrete v1 ranker architecture with effort bands

**Input Documents:**

- [solver-structural-constraints.md](./solver-structural-constraints.md) — problem definition, section 2.1
- [pre-DL scorer research](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md) — complementary blocker
- [fork cost research](./technical-solver-fork-cost-resolution-research-2026-04-13.md) — complementary blocker
- `GoldfishChainRanker` source code — anchoring point

**Out of Scope:**

- Learned policy networks (bootstrap problem, same argument as prior
  researches)
- Adversarial-specific ordering (Epic 2 MCTS handtrap prediction —
  separate research once Epic 2 stabilizes)
- Alpha-beta pruning (our DFS is exhaustive within budget, not
  alpha-beta)

**Scope Confirmed:** 2026-04-13

---

## Technology Stack Analysis — Move Ordering Landscape

> **Template adaptation note.** Same adaptation as prior researches —
> "languages / frameworks / databases" is not the framing. This section
> surveys the **four source domains** for move ordering techniques
> (chess classical, Go MCTS, AlphaZero-style PUCT, Hearthstone AI) and
> evaluates each primitive for applicability to YGO's non-alpha-beta DFS
> with a hard time budget.

### 1. Chess Classical Move Ordering (alpha-beta heritage)

Chess engines have 60+ years of move-ordering literature, primarily
focused on **maximizing the effectiveness of alpha-beta pruning** —
the earlier a good move is tried, the tighter the window becomes,
the more subtrees are cut. This is a fundamentally different regime
from our DFS with hard time budget, but several of the underlying
primitives transpose cleanly because they capture a general principle:
"try the best move first, however 'best' is estimated".

#### The typical chess ordering sequence

Modern chess engines (Stockfish classical, Rustic, Fruit, Crafty)
follow this order:

1. **Hash move** — the best move from a prior search of this position
   (retrieved from the transposition table). Zero extra computation;
   often produces an immediate beta cutoff.
2. **MVV-LVA captures** (Most Valuable Victim, Least Valuable
   Aggressor) — capture moves ordered by `victim_value × 10 −
   attacker_value`. Prioritizes `pawn × queen` (huge gain) over
   `queen × pawn` (loses material).
3. **Killer moves** — quiet moves that caused a beta cutoff at the
   same ply in a sibling node. Stored in a small table `killers[ply]`
   holding 2-3 entries per ply. Reset between searches.
4. **Counter moves** — for each opponent move, the engine remembers
   the best reply seen so far. Looked up by `counter[lastMove]`.
5. **History heuristic** — a table `history[piece][to]` incremented
   when a quiet move produces a cutoff. Depth-weighted increments
   (`+= depth²`) bias toward deep cutoffs. Used to order remaining
   moves.
6. **Losing captures** — captures with negative SEE (Static Exchange
   Evaluation) are moved to the end of the capture list or after
   killers.
7. **Everything else** — unordered or in raw enumeration order.

#### What transposes to YGO, and what doesn't

**Applicable**:

- **Hash move** (with semantic reinterpretation) — our TT at
  `SELECT_IDLECMD` (gated per constraint 3.1) can store not just
  a score but a "best action so far" hint. On re-encountering the
  same Zobrist-keyed state, try that action first.
- **History heuristic** — directly applicable. Maintain a table
  `history[actionSignature]` incremented when an action leads to a
  high-score terminal. On subsequent enumerations at similar
  prompts, order candidates by history score. The action signature
  for YGO would be `(cardId, effectType)` — e.g.,
  `(SnakeEyeFlamberge, Activate)` — because the same effect of the
  same card should be reused regardless of position.
- **Killer moves** — adaptable. At each depth, remember the last
  K actions that led to the best-score terminals seen so far; try
  them first at sibling nodes of the same depth.

**Not directly applicable**:

- **MVV-LVA** — captures are a chess concept. The YGO analog would
  be "destructions" (Galaxy-Eyes destroys, Kaiju tributes), but the
  value calculation is completely different: destroying a low-cost
  monster is worse than destroying a boss monster, which is the
  *opposite* of MVV-LVA's intuition ("use cheap pieces to capture
  expensive ones"). We need a different heuristic for YGO's
  equivalent of captures.
- **SEE** — requires a stable "exchange sequence" definition. YGO
  has no direct analog.
- **Counter moves** — requires a notion of "opponent move" responded
  to. Goldfish solver has no opponent. In Epic 2 adversarial this
  becomes relevant but it is a separate research track.

**Key insight**: chess move ordering is **state-action statistics**.
The killer/history/counter heuristics do not understand the semantics
of a move — they only remember *which moves produced results in the
past* and replay them preferentially. **This is
archetype-independent learning that works by accumulation**, and it
is exactly what the YGO solver needs on `SELECT_IDLECMD`.

Sources:
[Move Ordering — Chessprogramming Wiki](https://www.chessprogramming.org/Move_Ordering),
[Killer Heuristic — Chessprogramming Wiki](https://www.chessprogramming.org/Killer_Heuristic),
[History Heuristic — Chessprogramming Wiki](https://www.chessprogramming.org/History_Heuristic),
[MVV-LVA — Chessprogramming Wiki](https://www.chessprogramming.org/MVV-LVA),
[Killer Moves Heuristic — Rustic Chess](https://rustic-chess.org/search/ordering/killers.html),
[MVV-LVA — Rustic Chess](https://rustic-chess.org/search/ordering/mvv_lva.html).

### 2. Go MCTS — RAVE, AMAF, Progressive Bias

Go brought MCTS into the mainstream in 2006-2008 and with it a
distinct family of move-ordering techniques. The key insight: **Go
positions are highly order-invariant** — placing a black stone on
D5 and later on E3 produces the same position as placing E3 then
D5. This invariance enables aggressive statistical sharing across
playouts.

#### AMAF — All Moves As First

When running a playout from a given state, every move seen during
the playout updates statistics as if it had been played **from that
starting state**. This gives every node early data on every action,
not just the one that was actually selected. Costs nothing
computationally — the update is O(playout_length) but the playout
happens anyway.

#### RAVE — Rapid Action Value Estimation

RAVE biases the UCT selection formula with AMAF statistics:

```
RAVE(a) = (1 - β) × Q_UCT(a) + β × Q_AMAF(a)
```

where β decreases with visit count — early in the search, the AMAF
bootstrap dominates (because real statistics are noisy); late in the
search, the real statistics take over (because AMAF bias is noise
relative to direct signal). Gelly & Silver 2007 showed RAVE
produces **orders-of-magnitude improvement** in Go strength vs. plain
UCT.

#### Progressive Bias

Chaslot et al. 2008. Adds a heuristic `h(state, action)` to the UCT
formula:

```
selection_score(a) = Q(a) + c × sqrt(ln(N_parent) / N(a)) + bias(a)
```

where `bias(a) = h(state, a) / (1 + N(a))`. Early visits rely on the
heuristic; accumulating visits dilute the bias, handing control to
the real statistics. **This is the bootstrap mechanism**: the
heuristic guides early search, then fades out as data arrives.

#### Nonzero priors

A simpler variant: when creating a child node, initialize it with
`wins = w0` and `visits = v0` based on a prior belief. Actions with
higher priors appear to have higher win rates until enough real
visits accumulate to reset the score.

#### What transposes to YGO

**Not directly applicable**: AMAF/RAVE rely on position-order
invariance. In YGO, action order matters intensely — activating
Diabellstar before Snake-Eye Flamberge produces a completely
different chain than activating them in reverse. AMAF statistics
would conflate these, injecting misleading bias.

**Highly applicable**: **progressive bias is the ideal pattern for
our Epic 2 MCTS**. The `h(state, action)` heuristic is exactly what
we will have once the scorer research ships — a cheap function that
estimates the value of taking an action. Progressive bias integrates
the scorer as an action-level prior, without requiring the full
scorer to be called on every descendant.

**Directly applicable to DFS Epic 1**: nonzero priors translate to
"initial ordering". If we have a heuristic score for each candidate
action, we sort candidates descending by heuristic and enumerate in
that order. The DFS has no backup mechanism (we don't update the
heuristic with real statistics mid-search), so the pattern is
simpler than progressive bias — but the principle is identical.

Sources:
[Monte-Carlo Tree Search and Rapid Action Value Estimation (Gelly & Silver)](https://www.cs.utexas.edu/~pstone/Courses/394Rspring13/resources/mcrave.pdf),
[Monte Carlo Tree Search — Wikipedia](https://en.wikipedia.org/wiki/Monte_Carlo_tree_search),
[Progressive Strategies for Monte-Carlo Tree Search (Chaslot et al.)](https://www.researchgate.net/publication/23751563_Progressive_Strategies_for_Monte-Carlo_Tree_Search),
[MCTS: Review of Recent Modifications and Applications (Springer)](https://link.springer.com/article/10.1007/s10462-022-10228-y).

### 3. PUCT — The AlphaZero Action Selection Formula

PUCT (Polynomial / Predictor Upper Confidence for Trees) is the
action selection formula used by AlphaGo, AlphaZero, and every
subsequent DeepMind-style self-play reinforcement learning system.

#### The formula

```
PUCT(s, a) = Q(s, a) + c × P(a | s) × sqrt(Σ_b N(s, b)) / (1 + N(s, a))
```

Where:
- `Q(s, a)` — mean action value (current average)
- `P(a | s)` — prior probability from a policy network
- `N(s, a)` — visit count for this action
- `Σ_b N(s, b)` — total visits at the parent node
- `c` — exploration constant (typically 1.0-2.5)

The `P(a | s)` term is the critical difference from plain UCT. In
UCT, every unvisited action has the same exploration bonus. In PUCT,
the exploration bonus is **scaled by the prior probability** — high-
prior actions get explored more early, low-prior actions get starved
unless the real statistics contradict the prior.

#### What transposes

The PUCT formula requires a **policy prior** `P(a | s)`. AlphaZero
produces this from a trained neural network. Without self-play
infrastructure (bootstrap problem, per prior researches), we cannot
produce a learned prior at v1.

**The pre-DL substitute**: a **heuristic prior** — a hand-crafted
function that assigns a normalized probability to each candidate
action based on simple features. For YGO:

```
h_prior(action) = softmax_over_candidates(
    w_type      × action_type_weight[action.promptType] +
    w_archetype × archetype_match_score(action, detected_archetype) +
    w_history   × history_score(action.signature) +
    w_hash      × (1.0 if action == ttHint else 0.0)
)
```

The weights are tuned in the same pipeline as the scorer
(Texel/ES), and the archetype detection fires once per solve to set
the archetype context. The prior is then frozen for the duration
of the solve.

**This is heuristic PUCT** — the well-documented pre-DL predecessor
of policy-network PUCT. Chess engines that do MCTS-flavored search
(CrazyAra, ChessZero clones) use it; game AI literature refers to
it as "biased UCT" or "prior-biased UCT".

**Applicability**: directly applicable to Epic 2 MCTS as the action
selection formula, with the heuristic prior replacing the learned
policy. For Epic 1 DFS, we don't use a selection formula — we
enumerate exhaustively within budget — but the **same heuristic
prior** can be used as a sort key, giving us "order candidates by
h_prior descending" which is exactly what we want.

Sources:
[Replacing PUCT with a Planning Model (Glauben 2022)](https://ml-research.github.io/papers/glauben2022replacing.pdf),
[Lessons from AlphaZero Part 3: Parameter Tweaking (Oracle)](https://medium.com/oracledevs/lessons-from-alphazero-part-3-parameter-tweaking-4dceb78ed1e5),
[Monte-Carlo Graph Search for AlphaZero (arXiv:2012.11045)](https://arxiv.org/pdf/2012.11045),
[UCT — Chessprogramming Wiki](https://www.chessprogramming.org/UCT).

### 4. Hearthstone AI — Card Game Specific Action Pruning

Hearthstone is the closest genre neighbor for YGO, per the prior
scorer research landscape. On the ordering / pruning side,
Hearthstone literature contributes patterns specifically shaped for
**large branching factors in a digital card game**.

#### The Hearthstone branching factor problem

Zhang & Buro 2017 report branching factors of **~4000 at card draw**
— enormous by chess standards (average branching ~35) but comparable
in order of magnitude to YGO's main phase (5-20 per step, but
combined with multiple steps per turn explodes the effective branch
count).

Their solution has two components, both applicable to our case:

**Chance node bucketing**: group similar chance events (card draws
that produce similar strategic outcomes) into buckets, sample one
representative from each bucket. Reduces branching by an order of
magnitude with minimal strategic loss.

**High-level rollout policies**: replace uniform-random playouts
with policy-guided rollouts where the policy is a shallow
classifier trained on expert data. Playout quality improves, the
effective sample size shrinks, the total search budget goes
farther.

#### Soft pruning — MDPI 2022 (Pruning Stochastic Game Trees with
Neural Networks)

A newer variant: use a neural network (or, equivalently, a
hand-crafted heuristic) to predict **how many actions to prune** at
each search step. Pruned actions are not permanently eliminated —
they can be **re-considered later** if the search budget allows.
This is "soft pruning" as opposed to "hard pruning" (kill the
branch immediately).

**The key property**: soft pruning is **correctness-preserving**.
A hard-pruned action can never be explored, which means if the hard
prune was wrong, the best solution is permanently hidden. Soft
pruning defers exploration; it never eliminates it. For a solver
with a zero-tolerance correctness contract (per the "partial is
buggy" constraint doc framing), soft pruning is the only acceptable
pruning pattern.

#### What transposes

- **Chance node bucketing**: not applicable. YGO is deterministic at
  solve time once deck seed determinism is fixed (constraint 3.3).
  Bucketing is a technique for randomness, not for deterministic
  branching.
- **High-level rollout policies**: directly applicable to Epic 2
  MCTS playouts. Instead of random rollouts, guide them with a
  cheap heuristic policy — same pattern as progressive bias but
  applied to the simulation phase instead of the selection phase.
- **Soft pruning**: highly applicable to Epic 1 DFS. Implementation:
  sort candidates by heuristic prior; within the time budget,
  explore the top-K first; if budget remains after top-K finishes,
  explore the next K; and so on. Low-priority actions are pruned
  *temporarily* if the budget runs out before reaching them, but
  the search order guarantees that the best-prior actions are
  tried before the budget expires.
- **Branching factor awareness**: YGO's peak branching factors
  (17 on Mitsurugi, 15 on Dracotail, 17 on D/D/D per the
  constraints doc) are **3 orders of magnitude smaller** than
  Hearthstone's 4000, but the combinatorial explosion across depth
  is similar. Any ordering gain compounds multiplicatively across
  levels.

Sources:
[Improving Hearthstone AI by Learning High-Level Rollout Policies (Zhang & Buro 2017)](https://skatgame.net/mburo/ps/cig17-hsai.pdf),
[Pruning Stochastic Game Trees Using Neural Networks (MDPI 2022)](https://www.mdpi.com/2227-7390/10/9/1509),
[Improving Hearthstone AI by Combining MCTS and Supervised Learning (arXiv:1808.04794)](https://arxiv.org/pdf/1808.04794),
[Optimizing Hearthstone Agents using an Evolutionary Algorithm (arXiv:2410.19681)](https://arxiv.org/html/2410.19681v1).

### 5. Landscape Summary — Primitives by Applicability

| Primitive | Source | Epic 1 DFS | Epic 2 MCTS | Prereq |
|-----------|--------|-----------|-------------|--------|
| Hash move (TT best-action hint) | Chess | ✅ high | ✅ high | Extended TT schema |
| History heuristic | Chess (Schaeffer 1983) | ✅ **critical** | ✅ high | None |
| Killer moves (depth-keyed) | Chess | ✅ medium | ✅ medium | Depth-indexed store |
| Counter moves | Chess | ❌ N/A goldfish | ⚠️ Epic 2 adversarial | Opponent model |
| MVV-LVA | Chess | ❌ no YGO analog | ❌ no YGO analog | — |
| SEE | Chess | ❌ no exchange sequence | ❌ — | — |
| LMR (Late Move Reduction) | Chess | ❌ alpha-beta only | ❌ — | — |
| AMAF / RAVE | Go | ❌ YGO is order-sensitive | ❌ same | — |
| Progressive bias | Go MCTS | ⚠️ sort-key only | ✅ **critical** | Heuristic scorer |
| Nonzero priors | Go MCTS | ✅ sort-key form | ✅ init-form | Heuristic scorer |
| Heuristic PUCT | AlphaZero (pre-DL substitute) | ⚠️ sort-key only | ✅ **critical** | Heuristic prior function |
| Chance node bucketing | Hearthstone | ❌ not stochastic | ❌ — | — |
| High-level rollout policy | Hearthstone | ❌ DFS no rollouts | ✅ high | Heuristic policy |
| **Soft pruning with top-K ordering** | Hearthstone + general | ✅ **critical** | ✅ high | Heuristic prior |
| **Archetype-aware bias** | YGO-specific (novel) | ✅ **critical** | ✅ critical | Archetype detection |

**Three v1 critical primitives for Epic 1 DFS identified**:

1. **Heuristic prior over candidates** (from PUCT / progressive bias
   / nonzero priors, reduced to a sort-key function for DFS)
2. **History heuristic** (chess) — accumulates action-level learning
   within a solve with zero precomputation
3. **Archetype-aware bias** — YGO-specific. Detect the deck's
   archetype once per solve, use it to weight candidate actions
   toward combo-relevant cards. This is the single largest lever
   specific to YGO.

**Supporting primitives** worth adding if effort permits:

- **Hash move** (TT hint) — minor effort, small compounding benefit
- **Killer moves at depth** — small effort, medium benefit
- **Soft pruning with time-budget-aware top-K** — correctness-
  preserving, gives graceful degradation if budget runs out mid-
  enumeration

**Key insight for the v1 architecture**: the three critical
primitives are **composable into a single sort key** that replaces
OCGCore's raw enumeration order at `SELECT_IDLECMD`:

```
sort_key(action) =
    w_archetype × archetype_score(action, detected_archetype) +
    w_history   × history_table.get(action.signature) +
    w_prior     × heuristic_prior(action, state) +
    w_hint      × (1.0 if action == ttBestAction else 0.0)
```

Every term has a clear provenance in established literature. No
single term is the whole answer — the composition is what
distinguishes a good ranker from a weak one.

### 6. What the Literature Does NOT Directly Offer

Three gaps in the transposable material, worth flagging so the v1
design does not expect solutions that don't exist:

- **YGO does not have a published canonical ordering heuristic**.
  Chess has MVV-LVA, Go has RAVE, poker has action abstraction —
  all well-tested in their domains. YGO has nothing. We are in
  genuinely novel territory for the domain-specific components
  (especially archetype detection and action-type weights).
- **Pre-DL game-AI literature assumes either alpha-beta or MCTS as
  the search regime**. DFS-with-budget is a third regime rarely
  addressed directly. Most techniques need semantic reinterpretation
  ("beta cutoff" → "improved best terminal"; "prior for selection"
  → "prior for sort order").
- **Order-sensitivity precludes AMAF-family techniques**. The single
  most elegant MCTS ordering technique (RAVE) is unavailable because
  YGO action ordering is semantically significant. This eliminates
  a large swath of Go-community literature.

## Integration Patterns Analysis — Plugging the Ranker into the Solver

> **Template adaptation note.** "API / REST / microservices" is not the
> framing. This section describes how the move-ordering primitives (three
> critical + supporting) plug into the existing `GoldfishChainRanker` and
> the action enumeration pipeline, with per-prompt dispatch, state
> management, and cross-research coupling.

### 1. The Ranker Hook — Where in the Pipeline

The current `GoldfishChainRanker` is invoked only at `SELECT_CHAIN`
and `SELECT_BATTLECMD`, leaving every other prompt with OCGCore's
raw enumeration order. The extension requires a single hook point
that handles **all** prompts:

```typescript
interface ActionRanker {
  rank(
    promptType: OcgPromptType,
    candidates: readonly OcgAction[],
    context: RankContext,
  ): readonly OcgAction[];
}

interface RankContext {
  state: RenderedBoardState;        // snapshot for heuristic computation
  depth: number;                     // current DFS depth
  history: HistoryTable;             // intra-solve history heuristic
  archetype: ArchetypeContext;       // detected once at solve start
  ttBestAction: OcgAction | null;    // TT hint (if available)
}
```

The ranker is called **once per prompt** at the adapter level,
producing a sorted `readonly OcgAction[]` that the DFS then walks in
order. The DFS itself is unchanged — it still enumerates all
candidates, but in a different order.

**Critical property**: the ranker is **order-preserving
correctness-wise**. It never removes candidates — it only reorders
them. A candidate pruned by time budget at the end of the search is
pruned by the DFS's time check, not by the ranker. This is the
**soft pruning contract**: the best candidates are visited first, the
budget decides when to stop.

### 2. Per-Prompt-Type Dispatch

Not every prompt benefits from every primitive. The ranker dispatches
on `promptType` to a prompt-specific strategy:

| Prompt | Primary primitives | Secondary | Notes |
|--------|-------------------|-----------|-------|
| `SELECT_IDLECMD` | Heuristic prior + history + archetype | Hash, killer, soft pruning | **Dominant decision point** — every primitive applies |
| `SELECT_CHAIN` | Existing `GoldfishChainRanker` logic + heuristic prior | History | Already partially ordered; extend with prior |
| `SELECT_BATTLECMD` | Existing filter (to_m2 / to_ep) | None | Binary choice usually; ordering has minimal impact |
| `SELECT_EFFECTYN` | Archetype + history | — | Binary yes/no; heuristic picks default |
| `SELECT_YESNO` | Archetype + history | — | Same shape as EFFECTYN |
| `SELECT_OPTION` | Heuristic prior + archetype | History | Multi-option effect variants (ex. Diabellstar effect options) |
| `SELECT_CARD` | Archetype + heuristic prior | History | Target selection — critical for combos |
| `SELECT_POSITION` | Archetype (defense-position-bias for walls) | — | Face-down vs face-up vs defense |
| `SELECT_TRIBUTE` | Heuristic prior (lowest value tributes first) | — | Minimize cost of tribute summoning |

**Why dispatch matters**: applying the full ranker to every prompt is
wasted computation for binary yes/no decisions. Dispatch lets us
spend compute where it matters (IDLECMD) and stay out of the way
elsewhere.

### 3. Archetype Context — Fire Once, Read Many

Archetype detection runs **once at the start of a solve**, not per
step. The detected context is frozen for the duration and read from
the `RankContext` by every ranker invocation.

#### The detection logic

```typescript
interface ArchetypeContext {
  primary: string;           // e.g., "snake-eye", "branded", "mitsurugi"
  confidence: number;        // 0..1
  comboPieces: Set<number>;  // card IDs that matter for this archetype
  wakeUpTargets: Set<number>; // extra deck cards this archetype triggers
}

function detectArchetype(deck: readonly number[], hand: readonly number[]): ArchetypeContext {
  const archetypes = loadArchetypeRegistry();  // archetype-registry.json
  const scores = archetypes.map(a => ({
    archetype: a,
    score: countMatches(deck, a.signatureCards) + countMatches(hand, a.signatureCards) * 2,
  }));
  const best = scores.sort((x, y) => y.score - x.score)[0];
  if (best.score < MIN_DETECTION_THRESHOLD) {
    return UNKNOWN_ARCHETYPE;  // no hard-coded path; prior-only ordering
  }
  return {
    primary: best.archetype.name,
    confidence: normalize(best.score),
    comboPieces: new Set(best.archetype.comboPieces),
    wakeUpTargets: new Set(best.archetype.wakeUpTargets),
  };
}
```

**Archetype registry is data, not code**. A new `archetype-registry.json`
file lists each known archetype with:

```json
{
  "snake-eye": {
    "signatureCards": [<Diabellstar>, <SnakeEyeAsh>, <OriginalSinfulSpoils>, ...],
    "comboPieces": [...],
    "wakeUpTargets": [<Snake-Eye Flamberge>, <Linkuriboh>, ...]
  },
  "branded": {
    "signatureCards": [<BrandedFusion>, <FallenOfAlbaz>, <BrandedDespia>, ...],
    "comboPieces": [...],
    "wakeUpTargets": [<Granguignol>, <Albion>, ...]
  },
  ...
}
```

This sidesteps the "hard-coded per-archetype logic" risk: the code is
generic, the data is per-archetype, and new archetypes are JSON
additions. The pattern mirrors `interruption-tags.json` and
`latent-patterns.json` from the prior scorer research.

#### Fallback for unknown archetypes

When detection fails (score below threshold, or a new unrecognized
deck), `ArchetypeContext.primary = "unknown"` and the archetype term
in the sort key contributes **zero**. The ranker falls back on the
prior + history + hash terms, which still produce non-trivial
ordering — just without the archetype-specific bias. Graceful
degradation, no cliff.

Sources:
[Deck Archetype Prediction in Hearthstone (Eger 2020)](https://slothlab.info/assets/pdf/eger2020fdg.pdf),
[Machine Learning: the Gathering](https://blog.4dcu.be/programming/games/2019/12/29/Magic-the-Gathering.html),
[The Deck Archetype Spectrum — Cloudfall Studios](https://www.cloudfallstudios.com/blog/2019/1/27/the-deck-archetype-spectrum),
[Identifying Deck Archetypes — Tempo Storm](https://tempostorm.com/articles/identifying-deck-archetypes).

### 4. History Table — Per-Solve, Per-Worker, Intra-Solve Learning

The history heuristic accumulates within a single solve. Schaeffer's
original formulation (chess) is `history[piece][to] += depth²`; the
YGO analog is:

```typescript
type ActionSignature = string;  // e.g., "Diabellstar:Activate" or "12345:Summon"

class HistoryTable {
  private scores = new Map<ActionSignature, number>();

  record(action: OcgAction, depth: number, terminalScore: number): void {
    const sig = signatureOf(action);
    const existing = this.scores.get(sig) ?? 0;
    this.scores.set(sig, existing + terminalScore * depth);
  }

  get(signature: ActionSignature): number {
    return this.scores.get(signature) ?? 0;
  }

  clear(): void {
    this.scores.clear();  // called at the start of each solve
  }
}
```

**Critical differences from Schaeffer's original**:

- Incremented by `terminalScore × depth`, not by `depth²`.
  `depth²` in chess weights deep cutoffs heavily because deep
  cutoffs save more work. In our DFS, we weight by **observed
  terminal score** — an action that leads to a high-score terminal
  is worth trying first at sibling prompts.
- **Per-solve lifetime**, not per-search-tree. The history table
  resets at the start of each solve. Cross-solve persistence is a
  future optimization, not v1.
- **Per-worker ownership**. Each piscina worker has its own history
  table; workers don't share. This matches the scorer research's
  Tier 1/2/3 isolation.
- **Action signature, not board-specific key**. The signature is
  `(cardId, actionType)` — we deliberately collapse across board
  positions so that the same card-effect accumulates statistics
  across the whole solve, not just at one specific state.

#### When the table is consulted

The history term appears in the sort key at every prompt that
dispatches through the ranker. It **dominates the sort key late in a
solve** (when the table has real data) and **defers to the other
terms early** (when the table is empty). This is analogous to
progressive bias's `bias(a) / (1 + N(a))` fade but implemented as an
additive term rather than a decaying weight.

### 5. Heuristic Prior — The Zero-Visit Bootstrap

The heuristic prior is the function that orders candidates **before
any terminal has been seen in the current solve**. It is the
replacement for AlphaZero's policy network in the pre-DL regime.

```typescript
function heuristicPrior(
  action: OcgAction,
  state: RenderedBoardState,
  archetype: ArchetypeContext,
  weights: RankerWeights,
): number {
  let score = 0;

  // Action type weight — summons > activations > sets > pass
  score += weights.actionType[action.type];

  // Card-type bonuses — monster effects, spell activations, etc.
  if (isEffectActivation(action)) {
    score += weights.effectActivation;
  }

  // State-dependent multipliers — summoning when empty board bonus, etc.
  score += stateModifier(action, state) * weights.stateModifier;

  // Archetype match — combo-piece bonus
  if (archetype.comboPieces.has(action.cardId)) {
    score += weights.archetypeComboPiece * archetype.confidence;
  }

  return score;
}
```

**Critical property**: every term is a simple lookup or O(1)
computation. The prior must run at **every** prompt, potentially
hundreds of times per solve — it cannot do expensive scoring.

**Cross-research coupling**: once the prior scorer research ships,
the prior can be extended with a cheap version of the
`InterruptionScorer` that looks at the immediate impact of the
action. This is the integration point the scorer research flagged
under "`scoreState(state)` as a distinct entry point for Epic 2
MCTS" — the ranker is the first consumer of that API.

### 6. Hash Move (TT Best-Action Hint)

The existing TT stores `(score, best_action, depth)` at
`SELECT_IDLECMD` prompts. The ranker reads `best_action` from the TT
on every invocation and, if present, gives that action a dominant
weight in the sort key:

```typescript
const ttEntry = tt.lookup(stateHash);
const ttBestAction = ttEntry?.bestAction ?? null;

sortKey(action) = ... (other terms) + w_hint * (action == ttBestAction ? 1 : 0)
```

With `w_hint` large enough, the TT hint **always** comes first,
which is exactly the chess "hash move" pattern. When the TT is
empty (first visit to this state), the hint contributes zero and
the other terms take over.

**Interaction with constraint 3.1**: the TT is gated to IDLECMD
prompts only, so the hash-move primitive only applies at IDLECMD.
At other prompts the ranker falls back on the other terms.

### 7. Killer Moves at Depth

Optional supporting primitive. Maintain a small table
`killers[depth]` holding 2-3 actions that led to high-score
terminals at this depth in sibling branches:

```typescript
class KillersTable {
  private killers: OcgAction[][] = [];   // killers[depth] = [action1, action2, ...]

  record(action: OcgAction, depth: number): void {
    const slot = (this.killers[depth] ??= []);
    if (slot.length < 2) {
      slot.push(action);
    } else {
      slot[1] = slot[0];
      slot[0] = action;
    }
  }

  contains(action: OcgAction, depth: number): boolean {
    return (this.killers[depth] ?? []).some(k => actionsEqual(k, action));
  }

  clear(): void { this.killers = []; }
}
```

The ranker checks `killers.contains(action, depth)` and adds a
moderate bonus. This is a **small-effort, medium-benefit** primitive
— recommended for v1 but not critical.

### 8. Soft Pruning via Sort + Budget

The crucial correctness-preserving property of soft pruning:

- The ranker **does not prune**. It only sorts.
- The DFS walks candidates in sort order, applying the time budget
  check at each candidate.
- If the budget runs out mid-enumeration, unexplored candidates are
  **not explored**, but they are **not permanently eliminated from
  the tree** either — the search simply terminates at that point.

This is the "soft pruning" pattern from the Hearthstone / MDPI
literature, implemented without a separate pruning step. The sort
order ensures that **if any candidates are skipped due to budget,
they are the low-priority ones**. High-priority candidates are
guaranteed to be visited first.

**What this gives us**: graceful degradation under budget pressure.
A solve with a small budget produces a partial tree biased toward
the high-prior actions (the ones we expect to be good). A solve with
a large budget produces a full tree. The distinction is quantitative,
not qualitative — the ranker is identical, the budget decides how
much is explored.

### 9. Iterative Deepening — A Useful Complement

Iterative deepening is not strictly required, but it pairs very well
with move ordering. The standard DFS-with-budget approach runs a
single DFS to `maxDepth`, stopping on budget. Iterative deepening
runs DFS to depth 1, then 2, then 3, ... up to `maxDepth`, restarting
each time from the root.

**Apparent waste**: running depth 1 then depth 2 seems to duplicate
work. In practice, the total cost is about **2× the cost of a single
deep search** (because the shallow searches are dwarfed by the
deepest one). The benefit:

- **Each iteration produces a fully-explored tree at its depth**,
  giving the ranker useful history for the next iteration.
- **The TT accumulates best-action hints** from shallow searches
  that the deep search can reuse via the hash-move primitive.
- **Budget-aware**: if the budget runs out during iteration K, the
  result from iteration K-1 is complete and usable, not partial.

Chess engines universally use iterative deepening for these reasons
plus alpha-beta window tightening (which we don't benefit from).

**Recommendation**: consider iterative deepening as a Phase B
optimization once the basic ranker is in place. Not a v1 critical
primitive, but a clean fit with the rest of the architecture.

Sources:
[Iterative Deepening Depth-First Search — Wikipedia](https://en.wikipedia.org/wiki/Iterative_deepening_depth-first_search),
[Iterative Deepening — Chessprogramming Wiki](https://www.chessprogramming.org/Iterative_Deepening),
[Depth-First Iterative-Deepening (Korf 1985)](https://www.cse.sc.edu/~mgv/csce580f09/gradPres/korf_IDAStar_1985.pdf).

### 10. Cross-Research Coupling

This research reuses infrastructure from both prior researches and
does not duplicate any of it.

| Primitive | Depends on |
|-----------|-----------|
| History heuristic | Nothing (standalone) |
| Archetype detection | `archetype-registry.json` (new data file, no code dep) |
| Heuristic prior v1 (basic) | Nothing (simple lookups) |
| **Heuristic prior v2 (scorer-based)** | [scorer research](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md) Phase B (DirectScorer + LatentScorer) |
| Hash move (TT hint) | Existing TT, with schema extension to store `best_action` |
| Killer moves | Nothing |
| Soft pruning | Sort + budget — no new infrastructure |
| Iterative deepening | Budget tracking infrastructure (already exists) |
| Ranker architecture | **Shared fixture harness** with prior researches; shared deck seed determinism (3.3) |

**Key observation**: this research **can ship its v1 primitives
(history + archetype + basic prior + hash + soft pruning) independently
of the scorer research**. Phase B of the scorer research enhances the
prior to v2 (scorer-based) but is not a blocker for v1.

Similarly, **this research is independent of the fork cost research**:
better ordering produces benefits regardless of fork cost. But
**combined lift is multiplicative**: better ordering × cheaper forks ×
better scorer = each lift compounds the others.

### 11. Failure Modes and Fallbacks

| Failure mode | Cause | Mitigation |
|--------------|-------|------------|
| **FM-1** Archetype detection misfires | Ambiguous deck, overlapping signatures | Fallback to "unknown" archetype → weight term → 0, other terms take over |
| **FM-2** History table bias points to a wrong action (local optimum) | Early terminal was a false high-score | Tuner-tuned `w_history` weight bounds influence; other terms dilute |
| **FM-3** Heuristic prior is miscalibrated | Incorrect weights | Same tuning pipeline as the scorer — calibrate on fixture harness |
| **FM-4** TT hint points to an action no longer legal at the current state | State drift between TT capture and re-visit | Ranker verifies legality before using hint; falls back on other terms if not legal |
| **FM-5** Ranker adds meaningful latency | Per-prompt cost too high | Dispatch by prompt type (binary prompts skip full sort); cap ranker cost at N% of solve budget |
| **FM-6** Ranker makes search worse on some fixtures | Weights tuned on a different fixture distribution | Held-out fixture split; promotion gated on no regression |
| **FM-7** Archetype registry is stale (new meta deck not yet in registry) | Data drift | Registry is JSON → incrementally updated, same pattern as interruption-tags |
| **FM-8** The same fixture finds different main paths on different runs (non-determinism) | Deck seed not fixed | **Prerequisite**: constraint 3.3 (shared with prior researches) |

### 12. Invariants the Integration Must Preserve

- **Correctness**: the ranker **never removes candidates**. Soft
  pruning happens via time budget, not via ranker logic.
- **Determinism**: given the same initial state, the ranker produces
  the same sort order. History heuristic is deterministic (same
  input → same table).
- **Composability**: each term in the sort key is optional. Setting
  any weight to 0 disables that term without breaking others.
- **Fallback-friendliness**: if archetype detection fails, the rest
  of the ranker works. If TT is empty, the rest works. If the
  heuristic scorer isn't shipped yet, the rest works.
- **Replay-compatible**: the ranker is deterministic and uses only
  the observed state, so replay-based verification (Story 1.8,
  fork cost research Phase D) can re-run a solve and reproduce
  the same action order.

### 13. Key Integration Findings

- **Single hook point** — one `ActionRanker` interface, called at
  every prompt, dispatches by prompt type internally.
- **Per-prompt dispatch** spends compute where it matters (IDLECMD)
  and stays out of the way at binary prompts.
- **Archetype context is frozen at solve start**, read from context
  at every invocation. Data-driven registry, no hard-coded logic.
- **History table is per-solve, per-worker**. No cross-solve
  persistence in v1.
- **Heuristic prior v1 is simple lookups**; v2 integrates with the
  scorer research's sub-scorers via `scoreState()` once that ships.
- **Hash move piggybacks on the existing TT**, with a schema
  extension to store the best action in addition to the score.
- **Soft pruning via sort + budget** is correctness-preserving and
  produces graceful degradation under budget pressure.
- **Iterative deepening is a clean complement** but not v1 critical.
- **This research is independent of the other two** for v1, but
  combined lift is multiplicative.
- **Shared prerequisites** with the other researches: deck seed
  determinism (3.3), fixture harness, same weight tuning pipeline
  (ES).
- **Eight failure modes identified**, all with mitigations that do
  not require code path restructuring.

## Architectural Patterns and Design — Structuring the Ranker

> **Template adaptation note.** Same adaptation pattern as prior
> researches. "SOLID / cloud / microservices" is irrelevant. This section
> covers the internal structure of the move-ordering subsystem:
> composite sort-key, strategy dispatch, registry, table patterns, data
> /code separation, and a concrete v1 architecture proposal.

### 1. Composite Pattern — The Sort Key as a Sum of Primitives

The sort key is a **weighted sum of independent terms**, each
implemented by a distinct primitive:

```
sort_key(action, context) =
    w_archetype × archetype_term(action, context)
  + w_history   × history_term(action, context)
  + w_prior     × prior_term(action, context)
  + w_hint      × hint_term(action, context)
  + w_killer    × killer_term(action, context)
```

**Why this specific shape**:

- **Independence** — each term is computed from a distinct source of
  signal. Zeroing one term doesn't break the others.
- **Composability** — adding a new term is adding a line. No cross-
  term interaction code.
- **Tunability** — all weights live in `ranker-weights.json`
  (following the same data/code separation as the scorer research).
  ES tuning operates on the weight vector.
- **Debugging** — the final sort key decomposes cleanly into named
  components; a bad ordering can be traced to the term that
  dominated incorrectly.

**The additive form mirrors Stockfish's classical evaluator** (sum
of feature scores) and the scorer research's proposed sub-scorer
composition. This is not a coincidence — the composite pattern is
the default shape for pre-DL game AI evaluators, and move ordering
is fundamentally an evaluator applied to actions instead of states.

### 2. Strategy Pattern — Per-Prompt Dispatch

Different prompts need different ordering logic. The Strategy
pattern handles this cleanly:

```typescript
interface PromptRankStrategy {
  readonly handles: readonly OcgPromptType[];
  rank(
    candidates: readonly OcgAction[],
    context: RankContext,
  ): readonly OcgAction[];
}

class CompositePromptRanker implements ActionRanker {
  private strategies: Map<OcgPromptType, PromptRankStrategy>;

  rank(promptType, candidates, context) {
    const strategy = this.strategies.get(promptType) ?? this.fallback;
    return strategy.rank(candidates, context);
  }
}
```

**Strategies at v1**:

- `IdleCmdStrategy` — the full sort-key composition (all 5 terms)
- `ChainStrategy` — wraps existing `GoldfishChainRanker`, adds
  prior term
- `BattleCmdStrategy` — wraps existing filter logic
- `BinaryPromptStrategy` — handles EFFECTYN / YESNO with
  archetype + history only
- `TargetSelectStrategy` — handles SELECT_CARD / SELECT_OPTION /
  SELECT_POSITION / SELECT_TRIBUTE with archetype + prior
- `FallbackStrategy` — identity (raw enumeration order) for any
  prompt type not explicitly handled

**Why dispatch at the strategy level, not with if/else in a single
method**: adding a new prompt type handler is adding a new class
and a registration entry, not modifying an existing dispatcher. This
is the Open/Closed Principle applied to prompt handling.

### 3. Registry Pattern — Archetype as Data

The archetype detection is implemented as a **registry lookup**, not
as hard-coded classification logic:

```typescript
interface ArchetypeDefinition {
  name: string;
  signatureCards: readonly number[];    // high-signal indicators
  comboPieces: readonly number[];       // boost these in priors
  wakeUpTargets: readonly number[];     // boost if these are in extra deck
  minConfidenceThreshold: number;
}

class ArchetypeRegistry {
  private archetypes: readonly ArchetypeDefinition[];

  constructor(path: string) {
    this.archetypes = loadJson(path);  // archetype-registry.json
  }

  detect(deck: readonly number[], hand: readonly number[]): ArchetypeContext {
    // Compute match scores, return highest-confidence archetype
  }
}
```

**Why this matters**:

- **New archetypes are data changes, not code changes**. Add an entry
  to `archetype-registry.json`, no TypeScript changes. Matches the
  pattern used by `interruption-tags.json` and
  `latent-patterns.json`.
- **Testable in isolation** — unit tests can feed synthetic decks
  and verify detected archetypes. No search infrastructure needed.
- **Versionable** — `archetype-registry.json` has its own schema
  version, invalidated independently of the other data files.
- **LLM-assisted seeding** — new archetypes can be bootstrapped via
  the same LLM prompt pattern used for `interruption-tags.json`
  generation (per CLAUDE.md / `interruption-tag-generation-prompt.md`).

### 4. Table Pattern — History, Killers, Priors

The history table, killers table, and (optionally) prior cache are
all **mutable state tables** owned by the ranker for the duration of
a solve:

```typescript
class HistoryTable { /* as defined earlier */ }
class KillersTable { /* as defined earlier */ }
class PriorCache {
  // Memoize heuristic prior computation for a fixed state
  // to avoid re-computing when the ranker is called at
  // the same prompt type multiple times in a tight loop.
}
```

**Ownership**: the tables are owned by the **per-solve context**,
not by the ranker singleton. Each solve gets fresh tables; clear on
solve start, discard on solve end. This matches the scorer research's
per-worker per-solve state isolation.

**Threading**: single-threaded within a solve. No concurrency
primitives needed. Workers are isolated by piscina.

### 5. Facade Pattern — The `GoldfishChainRanker` Evolution

The existing `GoldfishChainRanker` is renamed and extended into a
facade:

```typescript
// Before:
class GoldfishChainRanker {
  rankChain(candidates): OcgAction[];
  rankBattleCmd(candidates): OcgAction[];
}

// After:
class SolverActionRanker implements ActionRanker {
  constructor(
    private strategies: Map<OcgPromptType, PromptRankStrategy>,
    private context: SolveLifecycleContext,
  ) {}

  rank(promptType, candidates, context): readonly OcgAction[] {
    return this.strategies.get(promptType)?.rank(candidates, context)
        ?? candidates;
  }
}
```

The existing chain/battle logic is preserved inside
`ChainStrategy` / `BattleCmdStrategy`, so no existing behavior is
lost. New strategies are added alongside the old ones. This is
the **strangler pattern** applied at the method level — wrap, don't
rewrite.

### 6. Data / Code / Weights Separation

The v1 architecture splits state into four categories, following the
same discipline as the scorer and fork cost researches:

| Category | Artifact | Change frequency |
|----------|----------|------------------|
| **Code** — primitive logic, sort key composition, strategy dispatch | `.ts` modules in `solver/ranker/` | Per-release |
| **Data** — archetype registry, action type constants | `archetype-registry.json`, `action-type-weights.json` | Per new meta deck / ruleset change |
| **Weights** — tuned coefficients for the sort key | `ranker-weights.json` | Per tuning run |
| **State** — history table, killers table, archetype context | In-memory, per-solve | Per solve |

**Calibration operates only on weights**. The calibration pipeline
(ES or Texel on the fixture harness) reads the `ranker-weights.json`
file and produces a new one. No code changes, no data changes.

### 7. Proposed v1 Architecture — Pulling It Together

```
OCGCoreAdapter (existing — instrumented)
  └── actionRanker: ActionRanker (injected)

SolverActionRanker (NEW — replaces GoldfishChainRanker)
  ├── strategies: Map<OcgPromptType, PromptRankStrategy>
  │     ├── IdleCmdStrategy (full sort key)
  │     ├── ChainStrategy (wraps existing chain ranker + prior term)
  │     ├── BattleCmdStrategy (existing filter)
  │     ├── BinaryPromptStrategy (yes/no, effect yn)
  │     ├── TargetSelectStrategy (card, option, position, tribute)
  │     └── FallbackStrategy (identity)
  ├── historyTable: HistoryTable (per-solve)
  ├── killersTable: KillersTable (per-solve)
  └── archetypeContext: ArchetypeContext (frozen at solve start)

Sort-key primitives (NEW — each in its own module)
  ├── ArchetypeTerm (reads ArchetypeContext)
  ├── HistoryTerm (reads HistoryTable)
  ├── PriorTerm v1 (stateless lookup)
  ├── PriorTerm v2 (calls InterruptionScorer.scoreState — Phase B+)
  ├── HintTerm (reads TT best_action)
  └── KillerTerm (reads KillersTable)

Supporting classes
  ├── ArchetypeRegistry (loads archetype-registry.json)
  ├── HistoryTable (Map<ActionSignature, number>)
  ├── KillersTable (depth-indexed LIFO)
  └── RankerWeights (loaded from ranker-weights.json)

Integration points
  ├── OCGCoreAdapter — invokes ranker at every prompt
  ├── SolverLifecycle — creates SolverActionRanker at solve start,
  │                     disposes at solve end
  └── InterruptionScorer — called by PriorTerm v2 via scoreState()
```

**File layout**:

```
duel-server/src/solver/
├── ranker/
│   ├── action-ranker.ts                    (interface)
│   ├── solver-action-ranker.ts             (facade)
│   ├── prompt-strategies/
│   │   ├── idle-cmd-strategy.ts
│   │   ├── chain-strategy.ts
│   │   ├── battle-cmd-strategy.ts
│   │   ├── binary-prompt-strategy.ts
│   │   ├── target-select-strategy.ts
│   │   └── fallback-strategy.ts
│   ├── terms/
│   │   ├── archetype-term.ts
│   │   ├── history-term.ts
│   │   ├── prior-term.ts
│   │   ├── hint-term.ts
│   │   └── killer-term.ts
│   ├── state/
│   │   ├── history-table.ts
│   │   ├── killers-table.ts
│   │   └── rank-context.ts
│   ├── archetype/
│   │   ├── archetype-registry.ts
│   │   └── archetype-detection.ts
│   └── weights/
│       └── ranker-weights.ts
└── data/
    ├── archetype-registry.json             (NEW)
    ├── action-type-weights.json            (NEW — or merged into ranker-weights)
    └── ranker-weights.json                 (NEW — tuned via ES)
```

**Key design decisions**:

1. **Every term is its own module** — 5-6 files, each ~50-100 LOC.
   No single file is a god class. Unit-testable in isolation.
2. **Strategies own their own dispatch logic**. The composite ranker
   is just a registry lookup. New prompt handlers = new strategy
   module, zero changes to the composite.
3. **Weights are injected, not hard-coded**. `RankerWeights` is
   loaded from JSON at solver startup and passed to every term via
   the context.
4. **State tables are context-owned, not ranker-owned**. The ranker
   reads them but doesn't hold them. The `SolveLifecycleContext`
   creates them at solve start and discards at solve end.
5. **Priority v1 (stateless) and v2 (scorer-based) are interchangeable
   implementations** of the same `PriorTerm` interface. v1 ships
   with the basic ranker; v2 ships after the scorer research's
   Phase B.
6. **The existing `GoldfishChainRanker` is wrapped, not replaced**.
   `ChainStrategy` internally delegates to the current implementation
   and adds the prior term as a secondary sort. Zero regression in
   the paths that already work.
7. **Fallback strategy is identity**, so any unhandled prompt type
   gets raw enumeration order. Unknown prompts never break the
   solver.

### 8. Interaction with the Existing Solver

The ranker plugs into `OCGCoreAdapter` at a **single hook point**:

```typescript
// Inside OCGCoreAdapter.processPrompt() or equivalent:
const rawCandidates = await this.core.enumerateActions(prompt);
const rankedCandidates = this.actionRanker.rank(
  prompt.type,
  rawCandidates,
  this.buildRankContext(prompt, state),
);
return rankedCandidates;
```

**This is the only code change in the existing enumeration path.**
Everything else happens inside the ranker. The DFS is unchanged.
The TT is unchanged (except for the schema extension to store
`best_action`). The scorer is unchanged.

**On terminal observed**, the solver invokes a feedback call:

```typescript
// At terminal evaluation time:
this.actionRanker.recordTerminal(actionPath, terminalScore, depth);
```

which internally updates `HistoryTable` and `KillersTable`. This is
the learning loop: each terminal produces a small statistical update
that biases future sibling enumerations.

### 9. Key Architectural Findings

- **Composite sort key** — weighted sum of independent terms, each
  term optional, each weight tuned. Matches the scorer research's
  sub-scorer architecture and the general pre-DL game AI pattern.
- **Strategy pattern for per-prompt dispatch** — one module per
  prompt type handler, open/closed compliant.
- **Registry pattern for archetypes** — data-driven, versioned,
  LLM-seedable. Same pattern as `interruption-tags.json`.
- **Table pattern for history/killers** — per-solve, per-worker,
  discarded at solve end.
- **Facade evolution of `GoldfishChainRanker`** — wrap existing
  logic inside strategies, no rewrite.
- **Four-category state split** — code / data / weights / in-memory
  state, each with a different change frequency.
- **Primitive terms are modular** — 5-6 files, each ~50-100 LOC,
  independently testable and tunable.
- **v1 stateless prior + v2 scorer-based prior** are interchangeable
  `PriorTerm` implementations, allowing v1 to ship without the
  scorer research.
- **Single hook point into `OCGCoreAdapter`** — minimal disruption
  to the existing enumeration pipeline.
- **Feedback loop via `recordTerminal()`** — closes the learning
  loop between terminal evaluation and future ordering.

## Implementation Research — Roadmap for Move Ordering

> **Template adaptation note.** Same adaptation as prior researches.
> "CI/CD / DevOps / team org" irrelevant. This section gives a concrete
> phased roadmap, testing strategy, risk register, effort bands, and
> success metrics.

### 1. Phased Implementation Roadmap

The work splits into **four phases** with clear dependencies. Phase A
is foundation work shared with the other researches. Phase B ships
the v1 ranker with basic primitives. Phase C tunes weights. Phase D
integrates the scorer-based prior once the scorer research's Phase B
is complete.

#### Phase A — Foundation (3-5 days)

**Goal**: establish the ranker interface, hook into the enumeration
pipeline, and extract the existing chain ranker into a strategy.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| A.1 | Define `ActionRanker` interface + `RankContext` type | None |
| A.2 | Define `PromptRankStrategy` interface | A.1 |
| A.3 | Create `SolverActionRanker` facade with Map-based strategy dispatch | A.2 |
| A.4 | Extract existing `GoldfishChainRanker` chain logic into `ChainStrategy` | A.3 |
| A.5 | Extract existing `GoldfishChainRanker` battle logic into `BattleCmdStrategy` | A.3 |
| A.6 | Create `FallbackStrategy` (identity) for unhandled prompt types | A.3 |
| A.7 | Wire `SolverActionRanker` into `OCGCoreAdapter` at the single hook point | A.4, A.5, A.6 |
| A.8 | Rename `GoldfishChainRanker` → remove (logic already migrated to strategies) | A.7 |
| A.9 | Run the fixture harness (from scorer research Phase A or joint) and confirm zero regression | A.7, shared fixture harness |

**Exit criterion**: the fixture harness produces identical results
before and after Phase A. The refactor is a zero-behavior-change
foundation.

**Why this phase is pure refactor**: we want to introduce the new
architecture without changing behavior, so that Phase B's behavior
changes are isolated and traceable. This is the "make the change
easy, then make the easy change" discipline.

#### Phase B — v1 Primitives (2-3 weeks)

**Goal**: ship the five sort-key primitives (archetype, history,
prior v1, hint, killer) and the `IdleCmdStrategy` that composes
them. This is the core research deliverable.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| B.1 | Build `archetype-registry.json` with entries for top 8-10 meta decks (Snake-Eye, Branded, Tearlaments, Mitsurugi, Kashtira, Dracotail, Floowandereeze, Runick) | None |
| B.2 | Implement `ArchetypeRegistry` loader and `ArchetypeDetection` logic | B.1 |
| B.3 | Implement `HistoryTable` (per-solve) | None |
| B.4 | Implement `KillersTable` (depth-indexed) | None |
| B.5 | Implement `ArchetypeTerm` / `HistoryTerm` / `HintTerm` / `KillerTerm` | B.2, B.3, B.4 |
| B.6 | Implement `PriorTerm v1` (stateless lookups: action type weight, effect activation bonus, state modifier) | None |
| B.7 | Create `action-type-weights.json` with seeded initial weights by inspection | None |
| B.8 | Implement `IdleCmdStrategy` composing all 5 terms | B.5, B.6 |
| B.9 | Implement `BinaryPromptStrategy` (archetype + history only) | B.5 |
| B.10 | Implement `TargetSelectStrategy` (archetype + prior) | B.5, B.6 |
| B.11 | Extend `ChainStrategy` with the prior term (secondary sort) | B.6 |
| B.12 | Extend TT schema to store `best_action` alongside score | None |
| B.13 | Implement the `recordTerminal()` feedback loop in the solver | B.3, B.4 |
| B.14 | Seed `ranker-weights.json` with sensible defaults by inspection | None |
| B.15 | Run fixture harness; confirm no regression, measure lift on at-risk fixtures | B.8+ |

**Exit criterion**: fixture harness shows ≥ 20% reduction in total
forks to reach the main-path terminal on at least 3 top-10 meta
fixtures, zero regression on any fixture.

**Important**: Phase B ships with **hand-seeded weights**, not tuned
weights. The goal is to prove the ranker architecture works and
produces measurable lift before investing in calibration. Hand
seeding is cheap, produces reasonable results, and establishes a
baseline for Phase C.

#### Phase C — Weight Calibration (1-2 weeks)

**Goal**: tune the `ranker-weights.json` coefficients to maximize
fixture hit rate.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| C.1 | Define fitness function: combination of fixture hit rate + total fork count + terminal score achieved | Phase B |
| C.2 | Reuse the ES tuner infrastructure from the scorer research (shared calibration pipeline) | Scorer research Phase C infrastructure |
| C.3 | Run ES tuning on the fixture harness | C.1, C.2 |
| C.4 | Validate tuned weights on held-out fixtures | C.3 |
| C.5 | Promote tuned `ranker-weights.json` as default | C.4 |

**Exit criterion**: tuned weights show ≥ 10% additional improvement
on the fixture hit rate compared to Phase B's hand-seeded weights,
with no regression on any held-out fixture.

**Critical dependency**: Phase C requires the ES tuner to be built
(from the scorer research). If scorer research C is not yet at
that stage, this can be implemented as a standalone tuner — but
the recommendation is **joint execution** so the tuner is shared.

#### Phase D — v2 Prior Integration (1-2 weeks, after scorer research Phase B)

**Goal**: upgrade `PriorTerm v1` (stateless lookups) to `PriorTerm
v2` (calls into the scorer research's `scoreState()` API for
richer signal).

| Step | Description | Prerequisite |
|------|-------------|--------------|
| D.1 | Implement `PriorTerm v2` calling `InterruptionScorer.scoreState()` | Scorer research Phase B complete |
| D.2 | A/B test v1 vs v2 on fixture harness using `ForkVerification`-style strategy selection | D.1 |
| D.3 | Re-tune weights with v2 active | D.2 |
| D.4 | Promote v2 as default if lift > 10% | D.3 |

**Exit criterion**: v2 prior shows measurable improvement over v1 on
at least 50% of the fixture suite, or v1 remains the default with
v2 available behind a config flag.

**Why this phase is last**: it depends on the scorer research's
Phase B shipping first. Until then, v1 prior is the entry point
and the ranker research is fully functional without v2.

### 2. Testing Strategy

**Primary testing mechanism**: the shared fixture harness from the
other two researches. Each fixture is `(deck, startingHand,
expectedMainPath, expectedScoreRange, deckSeed)` and the pass/fail
is whether the solver's top main-path matches `expectedMainPath`.

**Per-phase test focus**:

- **Phase A** (refactor): zero-regression check. Existing fixture
  results must match bit-for-bit before and after.
- **Phase B** (primitives): lift measurement. Each fixture reports
  (forks-to-solve, depth-reached, final score, hit/miss). Phase B
  must not regress any fixture.
- **Phase C** (tuning): held-out split. 70% of fixtures for tuning,
  30% for held-out validation. Tuning is promoted only if held-out
  performance matches or exceeds training.
- **Phase D** (v2 prior): A/B comparison via strategy-selectable
  prior (config flag: `prior: "v1" | "v2"`). Run both on the same
  fixture suite, compare hit rates and fork counts.

**Unit-level testing**:

- `ArchetypeRegistry` — synthetic deck lists, verify detection
- `HistoryTable` — specific add/get/clear invariants
- `KillersTable` — depth-indexed LIFO behavior
- Each `*Term` — deterministic input → deterministic output
- `IdleCmdStrategy` — combines terms correctly with expected weights

**Integration-level testing**:

- Full fixture harness run (per phase exit criterion)
- Regression pack covering common edge cases (empty candidates,
  single-candidate prompt, all-equal-score actions)

**Correctness invariants** (to be tested):

- Ranker never removes candidates (length preservation)
- Sort is stable (deterministic on equal keys)
- Fallback strategy is pure identity
- History table deterministic across re-runs with same terminal
  observations

### 3. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **R1** Archetype detection produces false positives on mixed-archetype decks | Medium | Medium | Confidence threshold; fallback to unknown → graceful |
| **R2** Hand-seeded weights in Phase B are worse than raw enumeration | Low | Medium | Fixture harness gates promotion; revert if regression observed |
| **R3** History term biases toward an early false local optimum | Medium | Medium | Bound `w_history` via tuning; other terms dilute |
| **R4** Ranker latency exceeds budget savings | Medium | Medium | Dispatch-by-prompt skips full sort for binary prompts; profile per-term cost |
| **R5** TT hint from prior solve is no longer legal at current state | Medium | Low | Legality check before applying hint; fall through to other terms |
| **R6** Sort is not stable in JavaScript engine (spec says it is since ES2019 but older V8 variants may differ) | Very low | Low | Use Array.prototype.sort with a tie-breaker on a stable fingerprint (e.g., action index) |
| **R7** v1 prior term is so weak that Phase C tuning can't rescue it | Medium | Medium | Ship Phase D (v2 scorer-based prior) as a follow-up before giving up |
| **R8** Fixture harness not available because scorer research A hasn't shipped | High unless joint | High | **Joint execution** with scorer research — shared prerequisite |
| **R9** Deck seed determinism (3.3) not shipped → history feedback loop is noisy | Certain unless prereq ships | High | **Prerequisite** — shared with all three researches |
| **R10** Ranker doesn't help because fork cost dominates | Medium | Medium | Fork cost research running in parallel; combined lift is multiplicative; Phase B lift is still meaningful at current fork cost |
| **R11** Archetype registry goes stale after meta rotation | Certain over time | Low | JSON data file, incrementally updated via same LLM-assisted pattern as `interruption-tags.json` |

### 4. Cross-Constraint Dependencies

| Constraint | This research | Notes |
|-----------|---------------|-------|
| **1.1** Node budget | Indirect benefit | Better ordering → reach better terminals within same budget |
| **1.2** Wall-clock timeout | Indirect benefit | Same |
| **1.3** Fork cost | Orthogonal | Addressed by fork cost research; combined lift is multiplicative |
| **2.1** Move ordering | **Directly addressed** | Core of this research |
| **2.2** Scorer fidelity | Complementary via Phase D | v2 prior uses scorer's `scoreState()` |
| **2.3** Latent interruption modeling | Complementary via Phase D | Same as 2.2 |
| **3.1** Observed state completeness | Reads the state the scorer uses | No new state requirements |
| **3.2** Terminal classification | Complementary | History feedback uses terminal scores — benefits from better classification |
| **3.3** Deck seed determinism | **Hard prerequisite** | History feedback loop requires reproducible runs; also shared by other researches |
| **4.1** Data coverage | Orthogonal | — |
| **4.2** Verification and trust | Indirect | Better main-path → higher trust |

**Shared with prior researches**:

- **Deck seed determinism (3.3)** — the #1 shared prerequisite
  across all three researches.
- **Fixture harness** — shared infrastructure, built once.
- **ES tuner** — shared calibration pipeline.
- **`ranker-weights.json` is tuned in the same ES run** as
  `interruption-weights.json` if both are tunable simultaneously,
  or separately if conflicts arise.

### 5. Effort Estimation

Effort in calendar weeks for a single developer:

| Phase | Effort Band | Confidence |
|-------|------------|-----------|
| Phase A (Foundation refactor) | 3-5 days | High |
| Phase B (v1 primitives) | 2-3 weeks | Medium |
| Phase C (Weight calibration) | 1-2 weeks | Medium |
| Phase D (v2 prior — after scorer) | 1-2 weeks | High |
| **Total** | **4.5-8 weeks** | Medium |

**Confidence commentary**:

- Phase A is mechanical refactor, bounded.
- Phase B is moderate — most of the primitives are straightforward,
  but `archetype-registry.json` seeding quality determines how much
  lift Phase B produces, and that's empirical.
- Phase C depends on the shared ES tuner being available.
- Phase D depends on scorer research Phase B — can be deferred
  indefinitely if needed.

**Comparison to prior researches**:

- Scorer research: 6-11 weeks
- Fork cost research: 5.5-11 weeks
- **Move ordering research: 4.5-8 weeks** (this one — shortest)

**Why this one is shortest**: the ranker architecture is smaller in
scope (one subsystem, not an engine-wrapper fork or a complex
evaluator), and most primitives have direct chess-engine analogs
to borrow from. It is also the most independent of the other
researches — v1 primitives need only the shared prerequisites.

### 6. Success Metrics

| Metric | Phase A Target | Phase B Target | Phase C Target | Phase D Target |
|--------|---------------|----------------|----------------|----------------|
| Fixture hit rate (top-K main path match) | Baseline captured | ≥ baseline | +10% from Phase B | +5% from Phase C |
| Forks to reach main-path terminal (median) | Baseline captured | -20% on ≥ 3 fixtures | -30% overall | -40% overall |
| Effective search depth reached (median) | Baseline captured | Same or +10% | +20% | +30% |
| Ranker latency per prompt (ms) | N/A | ≤ 2% of solve time | ≤ 2% | ≤ 2% |
| Archetype detection accuracy on synthetic fixtures | N/A | ≥ 90% | ≥ 90% | ≥ 90% |
| History table coverage (% of actions with non-zero score) | N/A | ≥ 40% by mid-solve | ≥ 40% | ≥ 40% |
| Regression count vs. baseline | 0 | 0 | 0 | 0 |

**The critical graduation metric**: **forks to reach main-path
terminal**. A good ranker reaches the right terminal with fewer
forks — this is the direct measurement of "effective depth per
budget". Combined with the fork cost research's reduction in
per-fork cost, the two effects multiply into total solve-time
reduction.

**Non-negotiable**: `Regression count = 0`. Any fixture that passes
at baseline must continue to pass. No "lift on average at the cost
of some regressions" allowed.

### 7. Joint Execution with Prior Researches

This is the **third** research on the solver stack; joint execution
with the first two is increasingly important because they share:

- **Shared prerequisite**: deck seed determinism (constraint 3.3).
- **Shared fixture harness** — built once in the joint foundation,
  used by all three.
- **Shared ES tuner** — `interruption-weights.json` (scorer),
  `ranker-weights.json` (this research), both tunable via the same
  ES loop, on the same fixture harness.
- **Shared benchmark harness** — fork cost bench + fixture harness
  combined produces the `total solve time` metric that ties all
  three.

**Recommended joint sequencing (v3 — three researches)**:

1. **Week 0** — Ship deck seed determinism (shared prereq).
2. **Week 0-1** — Build shared foundation: fixture harness + fork
   bench + ranker interface refactor (Phase A of all three, shared
   infrastructure).
3. **Weeks 1-4** — Phase B of all three in parallel where bandwidth
   allows:
   - Scorer Phase B (latent extension)
   - Fork cost Phase B (replay cache)
   - **Ranker Phase B (v1 primitives)**
4. **Weeks 4-6** — Converge on joint benchmark. Measure cumulative
   lift from all three Phase B deliverables.
5. **Weeks 6-11** — Phase C of all three (calibration, snapshot
   primitive, weight tuning). Shared ES tuner in place.
6. **Weeks 11-13** — Phase D convergence (scorer calibration, fork
   verification, ranker v2 prior).

**Combined end state**: a solver with latent-aware scoring, cheap
forks, and intelligent action ordering — all three blockers
addressed, fixture hit rate meeting the "functional" bar of ≥ 60%
on top 10 meta decks.

**Total combined effort for all three researches**:
**~12-18 weeks** for a single developer.

### 8. What This Research Does NOT Promise

Repeated for emphasis:

- **Viable combo lines alone.** Requires scorer research to find
  the right terminal, fork cost research to have budget to reach
  it, and this research to take the right path. All three are
  necessary.
- **Zero false-archetype detections.** Mixed and hybrid decks
  exist; the fallback is graceful (unknown archetype → term
  contributes 0) but detection will not be 100% accurate.
- **v2 scorer-based prior at v1 ship.** v1 ships with the basic
  stateless prior; v2 is a follow-up gated on scorer research
  Phase B.
- **Improvements to Epic 2 MCTS specifically.** The ranker benefits
  Epic 2 as much as Epic 1, but no Epic 2-specific work (progressive
  bias with the ranker as the prior, PUCT variant with the ranker
  as the policy) is part of this roadmap. Those are Epic 2
  refinements to consider after Epic 2 stabilizes.
- **Cross-solve learned state.** History table is per-solve. Future
  research could explore cross-solve persistence (e.g., learned
  action weights over hundreds of solves) but v1 keeps the state
  ephemeral.
- **Replacement of the existing chain ranker.** The existing logic
  is preserved inside `ChainStrategy`; nothing is removed.

### 9. Key Implementation Findings

- **Four-phase roadmap** (Foundation / v1 primitives / Tuning /
  v2 prior).
- **Phase A is a pure refactor** — introduce architecture without
  changing behavior, so Phase B changes are isolated and traceable.
- **Phase B ships hand-seeded weights** — prove the architecture
  before investing in calibration.
- **Phase C depends on shared ES tuner** from the scorer research.
- **Phase D is optional and deferred** — gated on scorer research
  Phase B, provides richer prior but not required for v1 ranker.
- **Effort band: 4.5-8 weeks** — the shortest of the three solver
  researches.
- **Shared fixture harness and ES tuner** with prior researches;
  joint execution is recommended.
- **Success metric: forks to reach main-path terminal** — the
  direct measurement of effective depth per budget.
- **Non-negotiable: zero regressions.** Any fixture that passes at
  baseline must continue to pass.
- **Combined effort for all three researches: ~12-18 weeks**.

---

# Research Synthesis — Executive Summary and Strategic Recommendations

> **Template adaptation note.** Same adaptation as the prior researches —
> generic template sections dropped. This synthesis delivers an
> executive summary, a cross-cutting TOC, consolidated findings, an
> action checklist, and — because this is the third and final research
> in the solver stack — **an integrated view of all three researches**.

## Executive Summary

The skytrix combo solver orders actions only at `SELECT_CHAIN` and
`SELECT_BATTLECMD`, leaving `SELECT_IDLECMD` — the dominant decision
point of main phase combo building — using OCGCore's raw enumeration
order. The structural constraints doc is explicit that move ordering
is the dominant lever for effective depth per unit of budget:
*"A good ranker can make a 500-node search discover combos that a bad
ranker would need 50,000 nodes to find."* This is not an optimization
— it is the difference between reaching the right terminal before
budget expires and not reaching it at all. Move ordering is the
**third of three top blockers** identified in the constraints doc,
alongside latent interruption scoring (addressed by
[the pre-DL scorer research](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md))
and fork cost (addressed by
[the fork cost research](./technical-solver-fork-cost-resolution-research-2026-04-13.md)).

The research surveyed four source domains — chess classical ordering,
Go MCTS, AlphaZero-family PUCT, and Hearthstone AI — and found that
each contributes distinct primitives that compose into a single sort
key. Chess classical gives us **history heuristic**, **killer moves**,
and **hash move** — the state-action statistics that accumulate
"which moves produced results" regardless of the move's semantics. Go
MCTS contributes **progressive bias** and **nonzero priors**, which
map to our DFS as "sort by heuristic score descending". AlphaZero's
**PUCT formula** reduces to **heuristic PUCT** in the pre-DL regime,
where the policy network is replaced by a hand-crafted prior function
— directly applicable to our Epic 2 MCTS and reusable as a sort-key
term in Epic 1 DFS. Hearthstone AI contributes the **soft pruning**
pattern, which preserves correctness while allowing graceful
degradation under budget pressure. **AMAF / RAVE**, the elegant Go
MCTS technique, is unavailable because YGO action ordering is
semantically significant (activating Diabellstar before Snake-Eye
Flamberge produces a different chain than the reverse).

The research produces a **concrete architecture**: a composite sort
key composed of five independent terms — **archetype**, **history**,
**prior**, **hint**, **killer** — each implemented as its own
~50-100 LOC module, with a **per-prompt-type strategy dispatch** that
handles the seven critical YGO prompt types (`SELECT_IDLECMD`,
`SELECT_CHAIN`, `SELECT_BATTLECMD`, `SELECT_EFFECTYN`, `SELECT_YESNO`,
`SELECT_OPTION`, `SELECT_CARD`, `SELECT_POSITION`, `SELECT_TRIBUTE`).
The archetype context is detected once per solve from a data-driven
`archetype-registry.json`. The history table is per-solve, per-worker,
accumulated via a `recordTerminal()` feedback loop. The existing
`GoldfishChainRanker` is preserved inside `ChainStrategy`, not
rewritten.

The **four-phase roadmap** (Foundation, v1 Primitives, Calibration,
v2 Prior Integration) totals **4.5-8 weeks** for a single developer
— the shortest of the three solver researches. Phase A is a pure
refactor (3-5 days). Phase B ships the five primitives with
hand-seeded weights (2-3 weeks). Phase C tunes weights via the shared
ES tuner from the scorer research (1-2 weeks). Phase D integrates
the scorer-based prior (optional, deferred, 1-2 weeks after scorer
research Phase B ships). v1 primitives require no other research
to ship beyond the shared prerequisite (deck seed determinism,
constraint 3.3).

**Key Technical Findings:**

- **The literature gives us three critical primitives for v1** —
  heuristic prior, history heuristic, archetype-aware bias. No
  single primitive is the whole answer; the composition is what
  distinguishes a good ranker from a weak one.
- **AMAF/RAVE is off the table** — YGO's action order is
  semantically significant, precluding the most elegant MCTS
  ordering technique. This eliminates a large swath of Go-community
  literature.
- **Chess move ordering is state-action statistics**, not semantic
  understanding. The killer/history/counter heuristics do not
  understand moves — they remember which moves produced results.
  This is archetype-independent learning that works by accumulation,
  and it is exactly what the YGO solver needs on IDLECMD.
- **Pre-DL PUCT is a sort-key function**, not a selection formula,
  in the DFS regime. The same heuristic prior function is reused
  across Epic 1 DFS (as a sort key) and Epic 2 MCTS (as the PUCT
  policy prior).
- **Soft pruning is correctness-preserving** — the ranker sorts,
  the time budget prunes. High-priority candidates are guaranteed
  to be visited first; the budget decides how much is explored.
- **Archetype detection is data-driven** — `archetype-registry.json`
  is a new file following the same pattern as `interruption-tags.json`.
  New archetypes are data additions, not code changes. LLM-seedable.
- **This research is the most independent of the three** — v1
  primitives need only the shared prerequisites (deck seed
  determinism, fixture harness). Scorer-based prior is a Phase D
  follow-up, not a v1 blocker.

**Strategic Recommendations:**

1. **Ship Phase A as the first development sprint of the joint
   execution**. It is a pure refactor, foundational for Phase B,
   and takes 3-5 days. Phase A is explicitly designed to be zero-
   behavior-change so it can land without risk.
2. **Seed `archetype-registry.json` from the top meta decks
   currently tracked in `interruption-tags.json`**. The two files
   share a card-ID vocabulary; cards flagged as interruption
   sources for an archetype are likely combo pieces for that same
   archetype.
3. **Do not defer the tuning phase**. Hand-seeded weights produce
   reasonable Phase B lift, but the calibration phase is what
   converts the architecture into meaningful search improvement.
   Run Phase C immediately after Phase B stabilizes.
4. **Phase D is optional and deferrable**. If the scorer research
   Phase B hasn't shipped when this research reaches Phase D, park
   v2 prior integration as a follow-up. v1 prior is sufficient for
   the ranker to deliver its core lift.
5. **Do not pursue learned policy networks at v1**. Same bootstrap
   argument as the other researches — no labeled corpus of
   good action sequences exists. This is explicitly deferred to a
   future v2-v3 track.
6. **Run this research jointly with the other two**. The combined
   lift from all three blockers shipped together is multiplicative,
   not additive.

## Table of Contents

| Section | Content | Primary question answered |
|---------|---------|---------------------------|
| Research Overview (top) | Problem definition, scope, explicit out-of-scope | Why do we care about move ordering? |
| Technical Research Scope Confirmation | Topic, goals, methodology, inputs | What did we commit to investigate? |
| Technology Stack Analysis — Move Ordering Landscape | 4-domain survey: chess classical, Go MCTS, PUCT, Hearthstone AI | What primitives exist, what transposes, what doesn't? |
| Integration Patterns Analysis | Ranker hook, per-prompt dispatch, archetype context, history table, prior, hash/killer/soft pruning, iterative deepening | How do the chosen primitives plug into the existing solver? |
| Architectural Patterns and Design | Composite sort key, strategy dispatch, registry, table pattern, facade, data/code/weights separation, **v1 architecture proposal** | How is the ranker structured internally? |
| Implementation Research | 4-phase roadmap, testing strategy, risk register, cross-constraint deps, effort bands, joint execution | What concrete steps produce a working deliverable? |
| Research Synthesis (this section) | Executive summary, consolidated findings, integrated view of all three solver researches | What do we actually do? |

## Consolidated Findings by Theme

### Findings on the Problem Structure

- **Move ordering is a direction problem, not a reach problem.**
  Fork cost determines *how many* states we can visit; move
  ordering determines *which ones first*. They are orthogonal axes
  of the same physical budget.
- **The effective-depth multiplier is the largest lever.** A 10-100×
  multiplier in "useful states visited per budget" is routine in
  the chess/Go literature with good ordering vs. raw enumeration.
- **Move ordering benefits compound multiplicatively with the other
  two researches.** Better scorer × bigger reach × correct
  direction = each axis multiplies the benefits of the others.

### Findings on the Technical Landscape

- **Four source domains contribute distinct primitives.** No single
  community has solved the whole problem for our use case.
- **Chess gives us state-action accumulation** (history, killer,
  hash move) — the underlying primitive for "try what worked
  before first".
- **Go MCTS gives us heuristic bias** (progressive bias, nonzero
  priors) — the underlying primitive for "try what looks good
  first".
- **AlphaZero gives us PUCT** (policy-biased selection) — the
  mathematical framework that combines the above under a single
  formula. In pre-DL regime, the policy becomes a hand-crafted
  prior function.
- **Hearthstone gives us soft pruning** — the correctness-preserving
  budget discipline that ensures the best candidates are tried
  first without ever permanently eliminating low-priority ones.
- **YGO is genuinely novel territory** for archetype detection and
  action-type weights. No published canonical ordering heuristic
  for YGO exists.

### Findings on Integration

- **Single hook point into `OCGCoreAdapter`** — one call to
  `actionRanker.rank()` at every prompt, producing a sorted array
  that the DFS walks in order. The DFS itself is unchanged.
- **Per-prompt dispatch** — each prompt type maps to a strategy
  module that applies the relevant primitives. Binary prompts
  (EFFECTYN, YESNO) get cheap ordering; IDLECMD gets the full
  sort key.
- **Archetype detection fires once per solve**, frozen for the
  duration. Read-only from `RankContext`. Data-driven from
  `archetype-registry.json`, LLM-seedable via the same prompt
  pattern as `interruption-tags.json`.
- **History table is per-solve, per-worker**. Incremented at every
  terminal via `recordTerminal()`. Dominated late in a solve when
  real data accumulates, deferred early when other terms drive the
  ordering.
- **Heuristic prior v1 is O(1) lookups** that run at every prompt.
  Cheap enough to never be the bottleneck.
- **v2 prior integrates `InterruptionScorer.scoreState()`** from
  the scorer research — the exact integration point the prior
  research flagged for Epic 2 MCTS progressive bias.
- **Hash move piggybacks on the existing TT** with a schema
  extension (store `best_action` alongside score). Gated to
  IDLECMD per constraint 3.1.
- **Soft pruning via sort + budget** — the ranker never removes
  candidates; the DFS time check decides when to stop.

### Findings on Architecture

- **Composite sort key** — weighted sum of 5 independent terms,
  each term optional, each weight tuned. Matches the scorer
  research's sub-scorer architecture and the Stockfish classical
  evaluator pattern.
- **Strategy pattern** — 6 prompt strategies at v1, each in its
  own module. Open/Closed Principle applied to prompt handling.
- **Registry pattern** — `ArchetypeRegistry` loads
  `archetype-registry.json`. Data-driven, versioned, LLM-seedable.
- **Table pattern** — history and killers tables are context-owned,
  per-solve, discarded at solve end.
- **Facade evolution** — `SolverActionRanker` wraps the existing
  chain/battle logic inside strategies. Zero-regression migration.
- **4-category state split** — code / data / weights / in-memory,
  each with a different change frequency. Calibration operates
  only on weights.
- **Primitive terms are modular** — 5-6 files at ~50-100 LOC each,
  independently testable and tunable.
- **v1 stateless prior + v2 scorer-based prior** are
  interchangeable `PriorTerm` implementations, allowing v1 to ship
  independently of scorer research.

### Findings on Implementation

- **Four-phase roadmap** (Foundation / v1 Primitives / Tuning /
  v2 Prior).
- **Phase A is pure refactor** — 3-5 days, zero-behavior-change,
  foundational for Phase B.
- **Phase B is the core deliverable** — 2-3 weeks, ships with
  hand-seeded weights, lift target -20% forks on ≥ 3 top-10
  fixtures.
- **Phase C is calibration** — 1-2 weeks, depends on shared ES
  tuner from scorer research.
- **Phase D is optional** — 1-2 weeks, gated on scorer research
  Phase B, provides richer prior but not required for v1 ranker.
- **Effort band 4.5-8 weeks** — shortest of the three solver
  researches.
- **Non-negotiable: zero regressions** on baseline fixtures.
- **Shared prerequisites** with other researches: deck seed
  determinism (3.3), fixture harness, ES tuner.

## Integrated View of All Three Solver Researches

This is the third and final research in the solver stack. The three
researches together cover all three blockers identified in
[solver-structural-constraints.md](./solver-structural-constraints.md):

| Constraint | Research | Status | Effort | Critical path |
|-----------|----------|--------|--------|---------------|
| **2.3** Latent interruption modeling | [pre-DL scorer research](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md) | ✅ complete | 6-11 wk | Direction (what to aim for) |
| **1.3** Fork cost | [fork cost research](./technical-solver-fork-cost-resolution-research-2026-04-13.md) | ✅ complete | 5.5-11 wk | Reach (how far we can look) |
| **2.1** Move ordering | **this research** | ✅ complete | 4.5-8 wk | Direction (which path to try first) |

**Shared prerequisites across all three** (must ship first):

- **Deck seed determinism** (constraint 3.3) — 1 developer-day,
  unconditional. Without this, nothing downstream is testable.
- **Fixture harness** — shared test infrastructure, built once,
  consumed by all three. Curated top-10 meta openers with expected
  main paths.
- **Fork cost benchmark harness** — measurement infrastructure,
  quantifies cumulative lift from all three researches.

**Shared infrastructure built across the three** (shared, not
duplicated):

- **ES tuner** — calibrates `interruption-weights.json` (scorer),
  `ranker-weights.json` (move ordering). Built once in scorer
  research Phase C.
- **Strategy pattern pool** — `ForkStrategy` (fork cost),
  `PromptRankStrategy` (move ordering) — both use the same pattern
  applied to different subsystems.
- **Zobrist hash discipline** — scorer TT, replay cache, TT
  best-action hint all key from the same `StateHasher` with the
  same IDLECMD gating.

**Recommended joint execution sequence**:

1. **Week 0** — Ship deck seed determinism (unblocks all three).
2. **Week 0-1** — Build shared foundation:
   - Fixture harness with top-10 meta openers
   - Fork cost benchmark harness
   - Ranker interface refactor (move ordering Phase A)
   - Scorer module extraction (scorer research Phase A)
   - Fork strategy extraction (fork cost research Phase A)
3. **Weeks 1-4** — Parallel Phase B across all three:
   - Scorer Phase B (latent extension): `latent-patterns.json`,
     considerations, EHS composer
   - Fork cost Phase B (replay cache): `LRU2Q`, `ReplayCache`,
     `ForkViaReplayCache`
   - **Move ordering Phase B (v1 primitives)**:
     `archetype-registry.json`, history table, prior v1, hint,
     killer, strategies
4. **Weeks 4-6** — Converge on joint benchmark. Measure cumulative
   lift.
5. **Weeks 6-11** — Parallel Phase C across all three:
   - Scorer Phase C (calibration): labeled corpus + ES tuning
   - Fork cost Phase C (snapshot primitive): wrapper fork + JS
     state classification
   - Move ordering Phase C (weight tuning): ES on shared tuner
6. **Weeks 11-13** — Phase D convergence:
   - Scorer: final fixture validation
   - Fork cost: verification strategy + zero-mismatch graduation
   - Move ordering: v2 prior integration (if scorer Phase B stable)

**Combined end state after week 13**:

- **Latent-aware scoring** — endboards with wake-up, continuation,
  protection, or grind value are correctly valued
- **Cheap forks** — 10-50× reduction in per-fork cost, 3-10×
  reduction in replay cost
- **Intelligent ordering** — 20-40% reduction in forks to reach
  main-path terminal
- **All cumulative** — combined solve-time reduction of **-80%
  to -95%** on top-10 meta fixtures

**"Functional" bar met**: ≥ 60% fixture hit rate on top-10 meta
decks. This is the graduation criterion from "partial" (equivalent
to buggy per the constraints doc framing) to actually-shippable.

**Combined effort**:

- Solo sequential: **16-30 weeks** (sum of the three researches)
- Solo with parallelization where possible: **~12-18 weeks**
- Shared foundation overhead: already counted in the per-research
  effort bands

## Action Checklist — Next 2 Weeks

Converting research into work for joint execution of all three
solver researches:

| # | Action | Research | Rationale |
|---|--------|----------|-----------|
| 1 | Review and approve this research document | Move ordering | Gate for joint execution |
| 2 | Review and approve the other two research documents together | All | Joint execution requires joint approval |
| 3 | **Ship deck seed determinism (constraint 3.3)** | All (shared prereq) | Unconditional #1 blocker for all three |
| 4 | Build the shared fixture harness with top-10 meta openers | All (shared) | Single source of truth for regression |
| 5 | Build the fork cost benchmark harness | Fork cost + move ordering | Measures forks-to-solve metric for both |
| 6 | Phase A parallel refactors (scorer extraction, fork strategy extraction, ranker interface) | All | Zero-behavior-change foundation |
| 7 | Seed `archetype-registry.json` from existing `interruption-tags.json` | Move ordering | Reuse card vocabulary from scorer research |
| 8 | Begin Phase B of all three in parallel | All | Where bandwidth allows |

Everything beyond this list is Phase B+ work scheduled after the
shared foundation is in place.

## What This Research Does NOT Promise

Repeated for emphasis:

- **Viable combo lines alone.** This research gives the solver
  direction; it does not give the solver a scorer (direction on
  what to aim for) or the reach to follow that direction far enough
  (fork cost). All three must ship for viable output.
- **Zero false archetype detections.** Mixed decks, hybrid
  strategies, and brand-new meta archetypes will sometimes be
  classified as "unknown", which degrades gracefully but does not
  always identify the right bias.
- **Cross-solve learned state.** History table is per-solve.
  Persisting action scores across solves (true "learned
  experience") is a future v2-v3 research, not v1.
- **Learned policy network.** Out of scope. Same bootstrap argument.
- **Replacement of `GoldfishChainRanker`.** The existing logic is
  preserved inside `ChainStrategy`.
- **Epic 2 MCTS-specific ordering.** The ranker benefits Epic 2
  automatically (progressive bias, PUCT policy prior) but no Epic 2
  refinements are part of this research.
- **Ordering of stochastic events.** YGO is deterministic at solve
  time once deck seed is fixed; no stochastic action ordering is
  needed.

## Research Methodology Notes

This research used **cross-domain transposition with YGO-specific
decision analysis** as its primary method. Four domains were
surveyed (chess, Go, AlphaZero, Hearthstone), and the transposable
primitives were cross-referenced against YGO's prompt types and
action semantics. The deliberate goal was to produce an architecture
grounded in established literature rather than inventing from
scratch.

**Sources span**:

- **Chess programming**: Chess Programming Wiki (Move Ordering,
  Killer Heuristic, History Heuristic, MVV-LVA, UCT, Iterative
  Deepening), Rustic Chess engine documentation, Stockfish and
  GNU Chess manuals, TalkChess forum discussions.
- **Go MCTS**: Gelly & Silver's RAVE paper (2007), Chaslot et al.'s
  Progressive Strategies (2008), MCTS review literature (Wikipedia,
  Springer AI Review 2022).
- **AlphaZero / PUCT**: AlphaGo and AlphaZero papers, Oracle blog's
  PUCT parameter tuning series, Glauben's "Replacing PUCT with a
  Planning Model" (2022), Monte-Carlo Graph Search for AlphaZero.
- **Hearthstone AI**: Zhang & Buro 2017 (rollout policies), MDPI
  2022 (neural pruning of stochastic trees), Dockhorn's opponent
  modeling work, Hearthstone AI Competition papers.
- **Archetype detection**: Eger 2020 (Hearthstone deck archetype
  prediction), Magic ML papers, Tempo Storm / Cloudfall archetype
  taxonomies.
- **Iterative deepening**: Korf 1985, Chess Programming Wiki on
  iterative deepening.

**Confidence levels**:

- **High**: claims about established chess / Go / Hearthstone /
  AlphaZero techniques — all well-documented in multiple sources.
- **Medium**: claims about transposing those techniques to YGO
  — reasoned analogies, not tested.
- **Low**: effort estimates, fixture lift predictions, archetype
  detection accuracy — empirical guesses to be validated in
  Phases B/C.

Every claim in this document is either:

- Cited to a public source, or
- Derived from internal project files (constraints doc, CLAUDE.md,
  existing solver code), or
- An explicit synthesis marked as such.

## Research Conclusion

**The recommended path is full joint execution of all three solver
researches.** This research (move ordering) is the third of three
blockers identified in the constraints doc, and the constraints
doc is explicit that **all three must ship for "functional" output**.
No single research alone is sufficient; the combined lift is
multiplicative; the effort is bounded; the roadmaps are sequenced.

This research is the **most independent of the three** — v1
primitives need only the shared prerequisites (deck seed
determinism and fixture harness) and ship the core lift without
depending on the other researches. It is also the **shortest**
(4.5-8 weeks vs. 5.5-11 and 6-11 for the others). It should not
be deferred as "the one we'll do later" — it can ship in parallel
with the others at low additional cost.

The solver stack after all three researches ship is a qualitatively
different tool: it finds the right endboard (scorer), reaches it
in reasonable time (fork cost), and takes the right path to get
there (this research). This is the minimum viable state that
graduates from "partial = buggy" to actually-functional per the
constraints doc's own framing.

**Next concrete step**: execute the shared deck seed determinism
fix (constraint 3.3) this week as a stand-alone quick fix, then
convene to review all three research documents as a **joint plan**
and commit to the shared foundation (fixture harness + fork bench
+ Phase A refactors) as a single coherent sprint.

---

**Technical Research Completion Date:** 2026-04-13
**Research Period:** single-session comprehensive technical analysis
**Source Verification:** all technical claims cited with public
  sources or internal project files
**Technical Confidence Level:** High on landscape, Medium on
  transposition, Low on empirical predictions
**Prior Researches:** latent scoring (constraint 2.3),
  fork cost resolution (constraint 1.3)
**Following Researches:** none — this is the third and final of
  the three top blockers identified in the constraints doc. Future
  research tracks are v2-v3 refinements (cross-solve learned state,
  learned policy networks, Epic 2 adversarial-specific ordering),
  gated on v1 shipping successfully.

_This comprehensive technical research document serves as the
reference blueprint for the skytrix combo solver's move-ordering
subsystem, producing a composite-sort-key ranker with five primitive
terms (archetype, history, heuristic prior, TT hint, killer moves)
that addresses constraint 2.1 of the solver structural constraints
document and completes the three-research stack needed for
"functional" solver output on Tier 1-2 meta decks._
