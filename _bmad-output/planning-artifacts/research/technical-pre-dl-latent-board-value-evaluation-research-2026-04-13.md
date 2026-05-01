---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/research/solver-structural-constraints.md
workflowType: 'research'
lastStep: 6
status: 'complete'
research_type: 'technical'
research_topic: 'Pre-DL latent board value evaluation for the YGO combo solver'
research_goals: |
  1. Survey proven pre-Deep-Learning techniques across game AI (chess, Go,
     poker, Hearthstone, Magic: The Gathering, RTS) for encoding the
     non-immediate value of non-terminal positions inside a hand-crafted
     evaluation function.
  2. Distill transposable patterns for the four forms of latent potential
     relevant to Yu-Gi-Oh endboards: (a) wake-up / trigger-on-opponent-turn,
     (b) continuation threat, (c) passive protection, (d) grind value.
  3. Propose a concrete feature set and decomposition structure (candidates:
     EHS-like additive-with-risk, king-safety-like hand-crafted pattern
     library, Go-influence-like potential fields) applicable to the existing
     InterruptionScorer, together with an empirical calibration strategy.
  4. Document the "DL horizon": conditions under which a learned value
     function would become appropriate as a future v2-v3 evolution, without
     engaging it in v1.
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

This research addresses a scoring gap identified in
[solver-structural-constraints.md](./solver-structural-constraints.md),
section 2.3 ("Latent interruption modeling") and its extended interpretation
covering all forms of non-immediate board value. The Yu-Gi-Oh combo solver's
current evaluation function (`InterruptionScorer`) scores only what cards do
*immediately* on the turn the endboard is produced. This misses the dominant
value model of modern meta decks, whose endboards rely on:

- **Wake-up / trigger-on-opponent-turn** effects (Faimena→Guramel, Diabellstar
  → Original Sinful Spoils → Snake-Eye chain, Albion → Branded Fusion).
- **Continuation threat** (Kashtira Fenrir paving the way to Arise-Heart).
- **Passive protection** (untargetable/indestructible walls that enable the
  rest of the board to operate).
- **Grind value** (Snake-Eye Flamberge recursive revival across turns).

Because the scorer cannot evaluate these forms, the search — which follows
the scorer — never converges on the endboards that rely on them. The
downstream effect is that every Tier 1-2 meta deck tested so far produces
non-viable combo lines.

The research methodology is **cross-domain pattern mining**: surveying how
other game-AI communities solved the structurally identical problem of
evaluating non-terminal positions with hand-crafted evaluation functions,
then extracting transposable primitives for Yu-Gi-Oh.

The explicit scope boundary is **pre-Deep-Learning techniques only**.
Learned value networks (AlphaZero-style) are out of v1 scope because:
(a) the bootstrap problem — self-play cannot generate training data while
the solver itself cannot produce viable lines; (b) the infrastructure cost
(Python pipeline, training, distillation, deployment, versioning) is
disproportionate to a v1 exploration; (c) the current solver's `InterruptionScorer`
is already a pre-DL evaluator whose extension is the most direct path to
viable output. A brief "DL horizon" section will document the conditions
under which a learned approach should be revisited.

---

## Technical Research Scope Confirmation

**Research Topic:** Pre-DL latent board value evaluation for the YGO combo solver

**Research Goals:**

1. Survey proven pre-Deep-Learning techniques across game AI (chess, Go,
   poker, Hearthstone, Magic: The Gathering, RTS) for encoding the
   non-immediate value of non-terminal positions inside a hand-crafted
   evaluation function.
2. Distill transposable patterns for the four forms of latent potential
   relevant to Yu-Gi-Oh endboards: (a) wake-up / trigger-on-opponent-turn,
   (b) continuation threat, (c) passive protection, (d) grind value.
3. Propose a concrete feature set and decomposition structure (candidates:
   EHS-like additive-with-risk, king-safety-like hand-crafted pattern
   library, Go-influence-like potential fields) applicable to the existing
   `InterruptionScorer`, together with an empirical calibration strategy.
4. Document the "DL horizon": conditions under which a learned value
   function would become appropriate as a future v2-v3 evolution, without
   engaging it in v1.

**Technical Research Scope:**

- **Cross-domain pattern survey** — chess (quiescence, SEE, king safety,
  Stockfish classical), Go (influence functions, potential territory),
  poker (EHS, Ppot/Npot), Hearthstone (SabberStone/Firestone feature
  evaluators), Magic: The Gathering (Forge phase-aware evaluator), RTS
  (threat maps, potential fields).
- **Feature design principles** — how pre-DL engines encode potential
  threats and conditional value as additive features; robust vs. fragile
  features under tuning.
- **Decomposition architectures** — additive-with-weights (Stockfish),
  EHS decomposition with positive and negative terms (poker),
  influence / potential fields (Go), weighted-sum + pattern library
  (Hearthstone).
- **Calibration methodologies** — automatic tuning (Texel, SPSA,
  CMA-ES), reference corpus labeling, LLM-assisted bootstrap, human
  gold labels with inter-rater agreement.
- **YGO applicability mapping** — explicit transposition of each
  retained pattern to the four forms of latent potential, with a
  proposed integration path inside the existing `InterruptionScorer`,
  `interruption-tags.json`, and `interruption-weights.json`.
- **DL horizon** — short section documenting the conditions that would
  justify revisiting a learned value function in v2-v3, without
  exploring those techniques in depth.

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Explicit distinction between published research, community practice,
  and folk knowledge
- Comprehensive technical coverage with evaluation-function-specific
  insights

**Input Documents:**

- [solver-structural-constraints.md](./solver-structural-constraints.md) — problem definition (section 2.3 extended)
- Existing solver code: `InterruptionScorer`, `interruption-tags.json`,
  `interruption-weights.json` — integration anchor

**Scope Confirmed:** 2026-04-13

---

## Technology Stack Analysis — Game-AI Evaluation Landscape

> **Template adaptation note.** The generic "programming languages / databases /
> cloud infrastructure" framing of the workflow template does not fit a research
> topic centered on evaluation function design. This section is re-scoped to the
> **pre-DL game-AI evaluation landscape** that is actually relevant: the
> open-source engines that expose mature hand-crafted evaluators, the academic
> corpus behind them, the tuning and calibration frameworks, and the reference
> datasets used to validate them.

### 1. Open-Source Engines With Hand-Crafted Evaluators

The most direct source of transposable patterns is the codebase of engines that
*still ship* or *recently shipped* a classical (pre-DL) evaluator. Each of the
following is either directly inspectable or has publicly documented design.

#### Stockfish — Chess (classical evaluator)

Stockfish is the canonical reference for pre-DL evaluation. Until the adoption
of NNUE (2020) its strength came from a handcrafted **linear combination of
positional features**: material balance, piece-square tables, mobility, king
safety, pawn structure, threats, space, and passed pawns.

Salient design choices documented by the Chess Programming Wiki and the Stockfish
Evaluation Guide:

- **Attack-unit accumulator for king safety** — each minor piece attacking a
  square in the king zone adds 2 attack units, a rook attack adds 3, a queen
  attack adds 5; a safe queen contact check adds 6, a safe rook contact check
  adds "a couple" more. The final king-safety score is a non-linear function
  of the accumulator that sharply increases past a threshold. This is the
  canonical way to encode a **menace potentielle non encore réalisée** —
  exactly the structural shape a YGO wake-up threat would need.
- **Tapered evaluation** — every feature has two weights, a middle-game weight
  and an endgame weight, linearly interpolated through a game-phase scalar
  (0 = opening, 1 = late endgame). This lets the same feature encode different
  values in different contexts, which maps directly to YGO's "combo turn vs.
  opponent turn" phase distinction.
- **Mobility = squares reachable** per piece. Cheap feature, high signal; a
  direct analog to "number of activatable effects remaining" or "targets
  available for this monster".
- **Linear combination with hundreds of hand-tuned weights** — not dozens.
  Stockfish's pre-NNUE eval had 500+ parameters, all tuned by SPSA against
  test suites.

Sources:
[King Safety — Chessprogramming Wiki](https://www.chessprogramming.org/King_Safety),
[Stockfish Evaluation Guide (hxim)](https://hxim.github.io/Stockfish-Evaluation-Guide/),
[Stockfish — Chessprogramming Wiki](https://www.chessprogramming.org/Stockfish),
[About removal of classical evaluation (Discussion #4678)](https://github.com/official-stockfish/Stockfish/discussions/4678).

#### SabberStone — Hearthstone (most domain-relevant)

SabberStone is an open-source (AGPLv3) C# Hearthstone simulator and the official
platform for the CIG/IEEE Hearthstone AI Competition. It is the closest
structural analog to our use case: a digital card game with triggers,
deathrattles, auras, secrets, and conditional effects — all of which are
*latent* forms of value in the same sense as YGO wake-ups.

Key findings from the competition papers and Hearthstone AI literature:

- **All simulation-based bots use the same shape of heuristic evaluator** — a
  weighted sum of features (some hand-crafted, some tuned via evolutionary
  algorithms). One widely-copied baseline weighs each player's minions, hand
  size, and hero health.
- **Minion scoring decomposes into attack, health, and ability terms** —
  e.g., a taunt minion receives a flat bonus, a divine shield minion receives
  a multiplicative bonus, etc. Abilities that activate *on a trigger we
  haven't seen yet* (secrets, deathrattles) are scored with a discount —
  exactly the pattern we need for YGO wake-ups.
- **21 parameters was the common tuning surface** in the Dockhorn et al.
  line of work (ES-optimized). This is a useful order-of-magnitude anchor:
  not 5, not 200 — the sweet spot for hand-crafted digital card-game
  evaluators seems to be **10-30 parameters**.
- **Opponent-move prediction is treated as a separate module** (Dockhorn 2018)
  — the evaluator scores a state *given an assumption about what the opponent
  will play*. This cleanly separates "static latent value" from "adversarial
  reachability", which is relevant to our future-Epic2 adversarial solver.

Sources:
[SabberStone — GitHub](https://github.com/HearthSim/SabberStone),
[SabberStone — HearthSim](https://hearthsim.info/sabberstone/),
[Introducing the Hearthstone-AI Competition (ResearchGate)](https://www.researchgate.net/publication/333718956_Introducing_the_Hearthstone-AI_Competition),
[Optimizing Hearthstone Agents using an Evolutionary Algorithm (arXiv:2410.19681)](https://arxiv.org/html/2410.19681v1),
[Predicting Opponent Moves for Improving Hearthstone AI (Dockhorn 2018)](https://adockhorn.github.io/files/papers/2018__IPMU__Predicting_Opponent_Moves_for_Improving_Hearthstone_AI.pdf).

#### Forge — Magic: The Gathering (cautionary negative example)

Forge is the open-source MtG rules engine, with an AI widely documented as
*weak* for reasons that directly illuminate our problem. Each card and ability
has a `canPlayAI()` method that returns true if the AI should play it — a
**per-card, per-moment decision** with no cross-card reasoning. The AI also
does not play spells during the opponent's turn except for counterspells and
during combat, which is explicitly called out as "done to simplify the code".

Why this matters for our research: **Forge encodes exactly the failure mode
we are trying to avoid**. Per-card evaluation without opponent-turn modeling
→ cannot use two Shocks to kill a 4/4, cannot plan a flash counterspell, cannot
recognize that a card's value comes from a trigger it will fire later.
Transposing Forge's approach to YGO would be the least-effort solution and
would reproduce exactly our current scorer gap.

The FLAIRS paper "Toward a Competitive Agent Framework for Magic: The Gathering"
(Ward & Cowling) proposes a more sophisticated agent framework but is described
as "lacking algorithms for all decision-making procedures required for a typical
game of Magic" — indicating that MtG AI does not currently have a canonical
pre-DL evaluator we can copy. MtG is thus a **gap** in the literature, not a
source of positive patterns.

Sources:
[Forge — GitHub](https://github.com/Card-Forge/forge),
[Forge's Awesome AI (mtgrares.blogspot.com)](http://mtgrares.blogspot.com/2010/05/forges-awesome-ai.html),
[Toward a Competitive Agent Framework for Magic: The Gathering (FLAIRS)](https://journals.flvc.org/FLAIRS/article/download/128416/130109/218220).

#### Go pre-AlphaGo — Boundary of applicability

Go pre-AlphaGo is included for a specific reason: it shows where **pre-DL
evaluation fundamentally struggles**. Classical heuristics are described as
insufficient for Go because the critical concepts (influence, territory, aji,
shape) are "more nebulous than in chess" and "almost impossible to represent
numerically". Pre-AlphaGo engines plateaued at amateur 5-dan despite decades
of effort.

NeuroGo used a neural network trained by temporal-difference self-play to
predict territory — so Go was the **first game in which purely hand-crafted
features were known to be insufficient**, and the fix (learned value function)
was exactly what AlphaGo later scaled up.

The transposable lesson for us: **some aspects of board value are pattern-dense
and locally computable (Stockfish king safety, Hearthstone minion stats), while
others are emergent and abstract (Go territory, YGO multi-turn grind)**. The
research must distinguish which YGO latent forms fall into which bucket.
Wake-up effects are pattern-dense (triggered by identifiable card interactions);
long-range grind value is more Go-like and may resist hand-crafted encoding.

Sources:
[AlphaGo — Wikipedia](https://en.wikipedia.org/wiki/AlphaGo),
[AlphaGo Algorithm (GeeksforGeeks)](https://www.geeksforgeeks.org/artificial-intelligence/alphago-algorithm-in-artificial-intelligence/).

### 2. Analytical Framework: Poker EHS

Poker contributes the most mathematically crisp pre-DL framework for our
problem. Effective Hand Strength (EHS), developed by Billings, Papp, Schaeffer
and Szafron at the University of Alberta for the Loki/Poki systems (1998),
decomposes the value of a hand into three orthogonal components:

```
EHS = HS × (1 − NPOT) + (1 − HS) × PPOT
```

- `HS` = current hand strength (the direct value, equivalent to a YGO endboard's
  *direct interruption count*).
- `PPOT` = positive potential — probability that a currently-weak hand will
  improve to a winning hand given future cards (equivalent to the probability
  that a YGO wake-up card will actually trigger and disrupt).
- `NPOT` = negative potential — probability that a currently-strong hand will
  deteriorate (equivalent to the risk that a handtrap or boardbreak adversary
  response cuts the continuation).

This is the **cleanest mathematical template** available in the literature for
our problem. It explicitly models:

1. A direct-value term (our current `InterruptionScorer`).
2. An upside-potential term (wake-up, continuation threat).
3. A downside-risk term (handtrap susceptibility, adversarial disruption).

EHS is computed exhaustively in poker (iterating over all opponent hands and
board rollouts). The YGO equivalent is rollout-based: fork the endboard, apply
canonical adversary responses, measure the state delta. This is **expensive
but tractable for a small set of canonical opener archetypes** during scorer
calibration, not at solve time.

Sources:
[Effective hand strength algorithm — Wikipedia](https://en.wikipedia.org/wiki/Effective_hand_strength_algorithm),
[6.3 Effective Hand Strength (Papp thesis, U. of Alberta)](https://webdocs.cs.ualberta.ca/~jonathan/PREVIOUS/Grad/papp/node46.html),
[Opponent Modeling in Poker (Billings et al., AAAI 1998)](https://cdn.aaai.org/AAAI/1998/AAAI98-070.pdf).

### 3. Tuning and Calibration Frameworks

Once features are designed, their **weights must be calibrated**. Three
approaches dominate the pre-DL literature:

#### Texel Tuning (logistic regression on labeled positions)

Texel tuning, introduced by Peter Österlund (author of the Texel engine), fits
eval weights by minimizing a sigmoid error between the static eval and the
actual game outcome on a labeled corpus of "quiet" positions (no forcing moves
pending). It is conceptually equivalent to logistic regression on a win/draw/loss
label.

- **Can simultaneously optimize hundreds of parameters** in reasonable time.
- **Training runs in ~45 minutes on 8-core CPU** (vs. weeks for SPSA against
  live engine matches). TensorFlow-based implementations run in ~5 minutes
  on GPU.
- **Requires a labeled corpus**. The canonical chess corpus is Zurichess's
  `quiet_labeled.epd` — positions filtered for quiescence with engine-assigned
  outcome labels.
- **Loss function**: `MSE(sigmoid(eval(pos)) − outcome)` over the corpus,
  where outcome ∈ {0, 0.5, 1}.

This is **directly applicable to YGO** if we can build a labeled corpus of
endboards. The label is the dependent variable — in chess it's game outcome;
in our case it would be a human-authored score (gold labels) or a rollout-based
proxy (did the endboard block a canonical adversary turn? binary).

Sources:
[Texel's Tuning Method — Chessprogramming Wiki](https://www.chessprogramming.org/Texel%27s_Tuning_Method),
[Texel's Tuning Method — Zurichess blog](http://www.zurichess.xyz/blog/texels-tuning-method/index.html),
[ROFCHADE Technical Page](https://rofchade.nl/?page_id=116),
[Tapered Eval — Chessprogramming Wiki](https://www.chessprogramming.org/Tapered_Eval).

#### SPSA (Simultaneous Perturbation Stochastic Approximation)

SPSA is Stockfish's primary tuning mechanism. It perturbs all parameters
simultaneously with random signs, plays matches with the perturbed eval, and
updates weights in the direction that improves win rate. Reported downsides:

- **Training data generation takes ~1 week** of CPU time.
- Requires a **full match harness** (engine vs. engine) to generate the
  gradient signal.
- Unlike Texel, SPSA is **engine-in-the-loop** — it optimizes against real
  match outcomes, not a static corpus.

For YGO: SPSA is probably *not* the right fit at v1. It requires two solvers
playing each other, and we do not have an adversarial solver. It would become
relevant if combined with Epic 2 adversarial MCTS once that produces stable
matches.

#### Evolutionary Strategies (used in Hearthstone literature)

SabberStone bots commonly use ES (Evolutionary Strategies) to tune a
~21-parameter feature set. Papers report convergence in hours of single-CPU
time. ES is **gradient-free** and handles the non-differentiable nature of
simulator-based fitness well.

For YGO: ES is probably the **most immediately viable** tuning framework.
It does not require differentiable evaluators, it scales to the 10-30
parameter surface expected for our scorer extension, and it works with any
fitness function we can compute (including rollout-based PPot/NPot
estimation).

### 4. Reference Datasets and Labeling Approaches

None of the above tuning frameworks work without labeled data. The existing
labeled corpora across game AI:

| Domain | Dataset | Label | Size |
|--------|---------|-------|------|
| Chess | Zurichess `quiet_labeled.epd` | Game outcome (0/0.5/1) | Millions |
| Chess | Lichess game database | PGN with engine eval | Billions of positions |
| Hearthstone | CIG2018 test suites | Match outcomes | Competition-sized |
| Hearthstone | SabberStone deck rollouts | Simulated win rate | Generated on demand |
| Poker | Opponent hand distributions | Exact EHS computation | All combinations |
| MtG | *None public* | — | — |
| Yu-Gi-Oh | *None public* | — | — |

The YGO gap is stark: **there is no public labeled dataset of endboards**.
This implies the research must propose a **bootstrap strategy**:

- Human-curated gold labels (expensive, small: hundreds to low thousands)
- LLM-assisted labeling (medium cost, noisier: thousands to tens of thousands,
  already partially validated via the `interruption-tag-generation-prompt.md`
  pattern from CLAUDE.md)
- Rollout-based proxy labels (cheap, noisy: "did endboard block canonical
  opener X?" as a binary signal)
- Hybrid: LLM labels for initial weight estimates, human gold labels for
  validation, rollout proxy for regression detection

### 5. Gap Identification

**No published pre-DL evaluation research exists for Yu-Gi-Oh specifically.**
This is both a risk (no off-the-shelf blueprint) and an opportunity (the
research produces novel work rather than re-stating existing patterns).

The closest genre neighbor is **Hearthstone AI**, which shares:
- Digital card game with triggers, secrets, auras, deathrattles
- Complex card interactions
- Conditional effect activation
- Need for opponent-move prediction

The closest mathematical framework is **poker EHS**, which shares:
- Direct value + upside potential + downside risk decomposition
- Rollout-based potential estimation
- Small parameter surface

The closest engineering reference for *how to calibrate* hand-crafted weights
at scale is **Stockfish's classical evaluator + Texel tuning**.

**Research implication**: the v1 evaluator should be architected as a hybrid —
*poker EHS decomposition* providing the mathematical structure, *Hearthstone
feature design* providing the card-interaction primitives, *Stockfish's king
safety accumulator pattern* providing the "latent threat intensity" computation
shape, and *Texel/ES-style tuning* providing the calibration mechanism. None
of these are copy-paste; each contributes a primitive.

### Key Technology Stack Findings Summary

- Pre-DL evaluators for card games converge on **10-30 weighted features**
  (not dozens, not hundreds).
- The **EHS decomposition** is the only rigorous mathematical framework for
  direct + latent + risk value.
- **King safety accumulators** (Stockfish) are the canonical way to encode
  non-realized threats in a linear evaluator, with a non-linear response
  past a threshold.
- **Texel tuning + ES** are the viable calibration paths; SPSA is too
  expensive for v1.
- **Labeled data is the universal bottleneck** — no pre-DL eval project
  succeeds without a corpus, and YGO has none.
- **Forge is a cautionary counter-example** — per-card evaluation without
  opponent-turn modeling reproduces exactly our current gap.
- **Go pre-AlphaGo is the outer boundary** — some forms of board value
  (abstract, emergent, long-range) resist hand-crafted encoding and should
  be explicitly deferred rather than badly approximated.

## Integration Patterns Analysis — Embedding Pre-DL Evaluators in a Search Engine

> **Template adaptation note.** The generic "API / REST / microservices /
> event-driven" framing of this step is irrelevant to our topic. "Integration"
> here means **how a hand-crafted evaluator plugs into the search engine** —
> where it is called, how it avoids per-node recomputation, how it coordinates
> with terminal classification, caching, and opponent rollouts. Each pattern
> below is presented with a direct transposition to the skytrix solver
> architecture.

### 1. Eval Call Placement — Where the Evaluator Is Invoked

#### Stockfish — quiescence + lazy eval

In pre-NNUE Stockfish, the static evaluation is called at **two distinct
points** and with **two distinct call shapes**:

1. **At quiescence leaves** — after alpha-beta descends to `depth == 0`, it
   hands off to a quiescence search that extends only "forcing" moves
   (captures, checks, promotions). The static eval is the *stand-pat* score
   at the root of quiescence, establishing a lower bound. Quiescence
   recursion then tries forcing moves and compares their evaluated children
   to the stand-pat; the better of the two is returned.
2. **At interior nodes via lazy eval** — the full static evaluation is
   decomposed into ordered stages. Stage 1 computes cheap features (material,
   piece-square tables) that are often already maintained incrementally.
   If the partial score lies outside `[alpha − margin, beta + margin]`, the
   search cuts off immediately and never computes stages 2-3. This is lazy
   evaluation: it trades evaluation precision for a 2-5× throughput gain
   at nodes far from the alpha-beta window.

**The caveat**: lazy eval is noted as *less relevant in modern engines that
use null-move pruning and LMR*, because those reductions already keep the
tree close to the window, so lazy cutoffs rarely trigger.

**Transposition to the YGO solver**:

- Our search is DFS, not alpha-beta. There is no `[alpha, beta]` window, so
  the lazy-eval cutoff pattern **does not directly apply**. But a degenerate
  form does: if we score only **at terminals** (not at internal nodes), the
  eval cost is paid exactly once per path rather than once per node — which
  is already the current architecture. This is the correct default for DFS.
- **Staged evaluation is still useful** even without alpha-beta: we can
  compute a cheap direct-interruption score first, then only compute the
  expensive latent-potential term if the direct score is below a threshold
  (or if the branch is one of the top-K candidates). This turns latent
  computation from a per-terminal cost into a top-K cost.

Sources:
[Lazy Evaluation — Chessprogramming Wiki](https://www.chessprogramming.org/Lazy_Evaluation),
[Evaluation — Chessprogramming Wiki](https://www.chessprogramming.org/Evaluation),
[Is a Lazy Eval a Good Thing? — Chess Programming](https://www.chessprogramming.net/is-a-lazy-eval-a-good-thing/),
[Quiescence Search — Chessprogramming Wiki](https://www.chessprogramming.org/Quiescence_Search).

#### MCTS — leaf evaluation + progressive bias + rollout policy

The Hearthstone MCTS literature (Zhang & Buro 2017, Santos 2021, Choe &
Kim 2019) converges on three integration points for a hand-crafted
evaluator inside MCTS:

1. **Leaf evaluation** — when MCTS selection reaches an unexpanded node, the
   evaluator is called to produce a *value estimate* that replaces (or
   supplements) a random rollout. This is the most direct integration:
   `V(leaf) := evaluator(state)`. Modern Hearthstone MCTS papers use
   gradient-boosted trees or small dense NNs for this role, but a linear
   hand-crafted evaluator fits exactly the same slot.
2. **Progressive bias** — when a node has been visited only a few times and
   its Q-value statistics are unreliable, the selection formula blends the
   Q-value with a heuristic value `h(state, action)` weighted by
   `1 / visits`. As visits accumulate, statistics take over. This is the
   **canonical way to inject a hand-crafted prior into MCTS** without
   committing to it at every step.
3. **Rollout policy** — instead of uniformly random playouts, the evaluator
   can be used to rank actions and bias rollout sampling toward actions
   scored higher. This is "replace random playouts with playouts using
   expert knowledge", shown to give significant lift in Hearthstone AI.

**Transposition to the YGO solver**:

- Our current solver has **DFS for Epic 1 (goldfish)** and **Minimax MCTS
  for Epic 2 (adversarial)**. The integration points above map as follows:
  - Epic 1 DFS: only (1) — the evaluator is called at terminals, no
    progressive bias, no rollout policy (DFS is exhaustive within budget).
  - Epic 2 Minimax MCTS: all three integration points become available.
    Progressive bias is the most valuable because it lets the evaluator
    influence action selection without requiring per-step rollouts.
- **Critical note for Epic 2**: progressive bias requires the evaluator to
  be fast enough to be called at *every selection step*, not just at leaves.
  The staged eval pattern (cheap first, latent second) is essential to
  make this tractable.

Sources:
[Improving Hearthstone AI by Learning High-Level Rollout Policies (Zhang & Buro, CIG 2017)](https://skatgame.net/mburo/ps/cig17-hsai.pdf),
[Improving Hearthstone AI by Combining MCTS and Supervised Learning (arXiv:1808.04794)](https://arxiv.org/pdf/1808.04794),
[Monte Carlo Tree Search Experiments in Hearthstone (Santos, IST)](https://fenix.tecnico.ulisboa.pt/downloadFile/1970719973966524/paper.pdf),
[Applying Gradient Boosting Trees and Stochastic Leaf Evaluation to MCTS on Hearthstone (IEEE)](https://ieeexplore.ieee.org/document/9356305/).

### 2. Incremental Feature Extraction — Avoiding Per-Node Recomputation

#### The chess engine pattern: accumulators + feature hash tables

Chess engines have 40+ years of experience avoiding re-evaluation from scratch.
The two dominant patterns are:

1. **Incremental material / PST update** — material and piece-square-table
   scores are maintained as running sums. When a move is made, the engine
   subtracts the contribution of the leaving piece and adds the contribution
   of the arriving piece. An entire board reset happens only at the root.
   This reduces the dominant cost of `eval()` from O(pieces) to O(1) per
   move.
2. **Feature hash tables** — expensive sub-evaluations (pawn structure,
   king safety zone) depend only on a *subset* of the board. A pawn hash
   table keyed by the pawn Zobrist signature caches the pawn evaluation;
   hit rates exceed 95% because most moves do not change the pawn structure.
   King safety likewise gets its own hash table in some engines.

NNUE, while post-DL, extends this pattern: the first layer of the NN is a
large linear accumulator that is **updated incrementally** as pieces move,
exploiting the locality of chess moves. Chess engine devs describe NNUE as
"accumulator-based incremental first-layer output update". The pattern is
the same; only the weights are learned.

**Transposition to the YGO solver**:

- `InterruptionScorer.scoreWithCards()` currently scans all zones on every
  call. Given that fork cost is already the dominant budget consumer
  (section 1.3 of the constraints doc), **per-terminal eval cost is small
  relative to fork cost** — so incremental update is **not a top priority**
  at v1. The fork replays the entire history anyway, so `scoreTerminal()`
  is called once per terminal with a fresh state.
- **However**, if v2 introduces per-step evaluation (progressive bias in
  MCTS), incremental feature maintenance becomes essential. The pattern to
  borrow: maintain a per-zone-category accumulator (direct interruptions,
  wake-up potential, continuation potential) updated as cards are added or
  removed from monitored zones, Zobrist-keyed for cache reuse.
- **A specifically valuable YGO analog of the pawn hash table**: a
  *"face-up extra zone hash table"*. Meta endboards are concentrated in
  face-up MZONE and SZONE; face-down extra / hand / graveyard change rarely
  during combat/end-phase. Hashing the face-up zones independently gives a
  very high hit rate.

Sources:
[Transposition Table — Wikipedia](https://en.wikipedia.org/wiki/Transposition_table),
[Evaluation — Chessprogramming Wiki](https://www.chessprogramming.org/Evaluation),
[An Incremental Evaluation Function and a Test-Suite for Computer Chess (Stöckl)](https://medium.com/datadriveninvestor/an-incremental-evaluation-function-and-a-testsuite-for-computer-chess-6fde22aac137),
[A Theoretical Analysis of the Development and Design Principles of NNUE for Chess Evaluation (IJRIAS)](https://rsisinternational.org/journals/ijrias/articles/a-theoretical-analysis-of-the-development-and-design-principles-of-nnue-for-chess-evaluation/).

### 3. Terminal Classification and Stand-Pat Discipline

#### Chess: static eval as a lower bound, not a final answer

Quiescence search embodies a subtle integration point: the static evaluator
is **not trusted as a final answer** when the position is volatile. Instead,
it is used as a **stand-pat lower bound** that the quiescence search can
choose to improve on by extending forcing moves. The search returns
`max(stand_pat, best_quiescent_child)`, meaning the evaluator's score is
treated as "at worst, the position is this good".

This directly addresses a problem identified in
[solver-structural-constraints.md — section 3.2 "Terminal classification"](./solver-structural-constraints.md):
currently, all three terminal types (voluntary end phase, stuck mid-phase,
depth cap hit) are scored identically. A chess-style quiescence
discipline would split this:

- **Voluntary end phase** (type a) → the position is "quiet" — run the full
  static evaluator and return the result directly.
- **Stuck mid-phase** (type b) → the state is involuntary; apply a *penalty*
  (the combo terminated because of an inability, not a choice).
- **Depth cap hit** (type c) → the state is *volatile* — do not trust the
  static eval. Either propagate the best score among descendants (chess
  analog: extend the search by one ply with a minimal branch) or return
  the static eval with a **volatility discount** (multiplier < 1).

**Transposition**: terminal classification is currently a known gap
(constraint 3.2). The quiescence integration pattern is the canonical way
to fix it: distinguish quiet from volatile terminals, use the static eval
only on quiet ones, and handle volatile terminals with a different rule.

Sources:
[Quiescence Search — Chessprogramming Wiki](https://www.chessprogramming.org/Quiescence_Search),
[Chess Engine, Pt. 5: Quiescence Search, Endgames, Repetition Avoidance (dogeystamp)](https://www.dogeystamp.com/chess5/).

### 4. Opponent-Response Integration for Latent Value

#### Poker EHS: rollouts are the integration mechanism

Poker EHS is computed by **rollout over all opponent hand distributions and
future board cards**. The static "hand strength" (HS) is cheap, but PPot
and NPot require enumerating plausible opponent hands and possible public
cards. The integration pattern is an **inner loop around the static eval**:

```
for each opponent_hand in sampled_opponent_distribution:
    for each future_board in possible_futures:
        outcome = showdown(my_hand, opponent_hand, future_board)
        update HS, PPot, NPot counters
EHS = HS × (1 − NPot) + (1 − HS) × PPot
```

Crucially, the evaluator itself is called **many times per position** —
once per rollout sample. The base evaluator is dirt cheap (hand comparison
with a precomputed rank table); the rollout is what dominates cost.

**Transposition to the YGO solver**:

- For YGO latent value, the natural analog is: when scoring an endboard
  that contains Faimena, fork the state, apply a canonical adversary
  action (e.g., activate an Effect Monster), observe whether Guramel gets
  summoned and what it negates. Repeat for N canonical adversary actions.
  The aggregate is `P(Faimena disrupts | adversary does X) × impact(X)`.
- **This is prohibitive at solve time** — fork cost (15ms) × N rollouts
  × M endboards quickly blows the budget. The poker literature's solution
  is **precomputed tables**: EHS is often precomputed offline for all
  possible hand × board combinations and looked up at runtime.
- **The applicable pattern for YGO**: a **precomputed latent-value table**
  keyed by `(card_id, context)`, generated *once* offline by running the
  rollout simulation against canonical adversary responses. At solve time
  the scorer performs an O(1) table lookup, not a fork.
- Context granularity is the design trade-off: too fine → table explodes;
  too coarse → values are imprecise. A reasonable v1 granularity:
  `(card_id, zone, board_density_bucket, turn_parity)`, yielding
  perhaps 10k-100k entries for the ~171 currently tagged cards.

Sources:
[Opponent Modeling in Poker (Billings et al., AAAI 1998)](https://poker.cs.ualberta.ca/publications/AAAI98.pdf),
[Effective Hand Strength Algorithm — Wikipedia](https://en.wikipedia.org/wiki/Effective_hand_strength_algorithm),
[Improved Opponent Modeling in Poker (ICAI 2000)](https://poker.cs.ualberta.ca/publications/ICAI00.pdf).

### 5. Calibration Pipeline Integration

The calibration pipeline is a **separate system** from the runtime evaluator
in every mature engine. The integration contract is:

- **Runtime**: evaluator reads weights from a versioned artifact
  (`interruption-weights.json`). No logic for updating weights exists in
  the runtime.
- **Offline**: a calibration job takes a labeled corpus + the current eval
  function + a search algorithm (Texel tuner, ES optimizer) and produces
  a new weights artifact.
- **Validation**: a regression harness runs the new weights against a
  held-out test set and produces a pass/fail signal before the artifact
  is promoted.

Stockfish's workflow (publicly documented on TalkChess) is typical:
patches propose new features or weight changes, the Fishtest distributed
testing framework runs ~40k match games under SPRT criteria, and the patch
is merged only if it crosses an Elo threshold.

**Transposition**: YGO cannot run "match games" until adversarial (Epic 2)
is stable. The v1-equivalent validation is **fixture-based**: the regression
harness runs the solver against a curated set of meta openers and verifies
that the main path still matches the expected combo. Weight changes are
promoted only if the fixture pass rate improves.

**Hard dependency**: fixture-based validation requires **deterministic
solves** — see constraint 3.3 "Deck seed determinism" in the constraints
doc. This is a **blocker for the calibration pipeline as a whole**, not
just for this research. The deck seed fix must ship before any calibration
can be meaningful.

### 6. Pattern Compatibility Matrix

| Integration Pattern | Applicable to Epic 1 (DFS) | Applicable to Epic 2 (MCTS) | Prerequisite |
|---------------------|----------------------------|------------------------------|--------------|
| Terminal-only evaluator call | ✅ current default | ⚠️ use leaf-eval instead | — |
| Staged (lazy) eval with cheap first / latent second | ✅ top-K only | ✅ per-step viable | — |
| Quiescence-style terminal classification | ✅ recommended | ✅ recommended | — |
| Incremental feature accumulator | ❌ not needed (fork replays) | ✅ required for perf | Epic 2 |
| Feature hash tables (face-up zones key) | ⚠️ optional | ✅ required for perf | Epic 2 + 3.1 state model |
| Progressive bias with hand-crafted prior | ❌ N/A | ✅ core MCTS integration | Epic 2 |
| Rollout policy biased by evaluator | ❌ N/A | ✅ core MCTS integration | Epic 2 |
| Precomputed latent-value table (EHS-style) | ✅ O(1) lookup at terminal | ✅ O(1) lookup at leaf | Offline simulation pipeline |
| Offline calibration with regression harness | ✅ required | ✅ required | **Constraint 3.3 (deck seed)** |

### Key Integration Pattern Findings

- **The DFS terminal-only eval pattern is architecturally fine for Epic 1**;
  the real cost is fork, not eval.
- **Staged evaluation** (cheap direct first, expensive latent second) is
  useful even without alpha-beta, as a top-K gating mechanism.
- **Quiescence discipline** directly solves the known terminal-classification
  gap (constraint 3.2) without needing Epic 2.
- **Feature hash tables** become essential in Epic 2 when progressive bias
  requires per-step evaluation; face-up MZONE/SZONE is the natural hashing
  key (high hit rate because meta endboards concentrate there).
- **EHS-style opponent rollouts** are prohibitive at solve time but
  **tractable offline** — the appropriate integration is a precomputed
  latent-value table, not an inner loop.
- **Calibration pipeline integration is blocked by deck seed determinism**
  (constraint 3.3). No tuning framework (Texel, ES, SPSA) works without
  reproducible solves.
- **MCTS-specific integration points** (progressive bias, rollout policy,
  leaf evaluation) are Epic 2 concerns and should not distort Epic 1
  scorer design, but the v1 design should leave the door open (e.g.,
  exposing `scoreState(state)` as a distinct entry point from
  `scoreTerminal(actions, state)` so MCTS can call it at non-terminal
  nodes in Epic 2 without a rewrite).

## Architectural Patterns and Design — Structuring the Evaluator

> **Template adaptation note.** "System architecture patterns / SOLID / cloud
> native / microservices" is not the right framing for an evaluator's internal
> structure. This section is re-scoped to the **architectural patterns that
> shape a pre-DL evaluation function**: modular decomposition, feature-vs-weight
> separation, tapered/context-aware evaluation, piece-square-table-style context
> lookups, hierarchical sub-scorers, and additive vs. multiplicative
> composition. It closes with a concrete proposed architecture for the
> `InterruptionScorer` extension.

### 1. Modular Decomposition — "Considerations" as the Atomic Unit

The canonical architectural primitive for game-AI evaluators is the
**consideration** — the smallest piece of decision-making logic that
evaluates one factor in isolation. The pattern is described in *Game AI Pro
3, Chapter 8 "Modular AI"* (Dill & Dragert): *"Considerations are the bite-
sized pieces out of which decision-making logic is built. They represent
concepts like the distance between two targets, the amount of health a
target has left, or how long it has been since a particular option was last
selected."*

The architectural properties that make considerations useful:

- **Single responsibility** — each consideration evaluates exactly one
  factor. No internal branching, no cross-factor coupling.
- **Composable** — considerations are combined by a top-level utility
  function (weighted sum, multiplication, or a more elaborate formula).
- **Independently testable** — each consideration can be unit-tested in
  isolation with synthetic input.
- **Independently tunable** — each consideration exposes one or more
  weights, and tuning frameworks operate on the weight vector without
  touching feature logic.

**Transposition**: the current `InterruptionScorer` already implements a
simple consideration-like split (15 tagged interruption types, each with
its own weight in `interruption-weights.json`). Extending it requires
**new considerations** — not restructuring. Each latent form (wake-up,
continuation, protection, grind) should become **its own consideration**
with its own feature input and its own weight, added to the existing
bag, not folded into the current scorer.

Sources:
[Modular AI (Dill & Dragert, Game AI Pro 3, Chapter 8)](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter08_Modular_AI.pdf).

### 2. Feature / Weights Separation — Code vs. Data

Every mature pre-DL evaluator enforces a **strict separation** between:

- **Feature logic** — code that reads state and computes a numeric feature
  value. Checked into source control, versioned with the engine.
- **Weights** — numeric coefficients applied to features. Stored in a
  separate data artifact (JSON, binary blob, EPD file), **versioned
  independently from the code**.

Stockfish's source code contains feature implementations; the weights come
from SPSA tuning runs and are committed as constants in the same file —
but the tuning runs themselves read labeled test positions (a different
artifact entirely), never the source. Texel tuning externalizes this even
further: the tuner is a separate tool that reads `quiet_labeled.epd` and
produces new weight values.

**Architectural implications**:

- Feature design and weight calibration are **different jobs**, done by
  different processes, on different timelines. Feature code changes when
  a new form of latent value is discovered; weights change after every
  tuning run.
- A single feature can have **multiple sets of weights** for different
  contexts (middle-game vs. endgame, for example). This is the foundation
  of tapered evaluation (next section).
- When new cards are added to the data (`cards.cdb` refresh, new
  `interruption-tags.json` entries), **only data changes** — feature code
  remains unchanged. This is the architectural property that makes the
  evaluator card-agnostic.

**Transposition**: `interruption-tags.json` and `interruption-weights.json`
are already structured this way, which is the correct foundation. The
extension must preserve it: new latent features add new **tag fields**
(data) and new **consideration implementations** (code), calibrated by a
tuning pipeline that touches only the weights file.

### 3. Tapered / Context-Aware Evaluation — Two Sets of Weights, Interpolated

Tapered evaluation is the canonical pattern for **context-dependent
feature values**. Every feature carries two weights: an opening-phase
weight and an endgame-phase weight. The engine computes a scalar
**phase fraction** from cheap features (material counts in chess), then
interpolates the two weights:

```
final_score = (opening_score × (256 − phase) + endgame_score × phase) / 256
```

The purpose is to **remove evaluation discontinuity**. Without tapering, a
feature like "king safety" would flip sign abruptly when transitioning
from middle game to endgame (where king activity becomes a positive).
With tapering, the transition is smooth.

Tapered evaluation is used by Fruit, Stockfish, ROFCHADE, MadChess,
Rustic, and effectively every serious chess engine since ~2005.

**Transposition to YGO**:

- YGO has its own phase distinction that maps directly: **own turn** (combo
  building — direct interruptions matter little, setup matters) vs.
  **opponent turn** (latent effects matter — wake-ups activate, handtraps
  must be defended against). The evaluator should carry **two weights per
  feature**: an "on own turn" weight and an "on opponent turn" weight.
- The "phase fraction" for YGO could be a simple **binary** (turn parity)
  or a graded scalar (e.g., "how deep into opponent turn are we?" —
  relevant for MCTS progressive evaluation but not for end-turn scoring).
- **V1 recommendation**: binary phase at end-turn scoring time. A feature
  like "wake-up potential" has a **high weight on opponent turn**
  (because that's when it will matter) but can still have a small weight
  on own turn (because it reserves the tempo). A feature like "direct
  interruption" has its current weight on own turn and a discounted
  weight on opponent turn (because direct effects have already been
  factored into what the opponent is responding to).

This gives every feature a **(w_own, w_opp)** pair; tuning optimizes both.

Sources:
[Tapered Eval — Chessprogramming Wiki](https://www.chessprogramming.org/Tapered_Eval),
[Tapering the Evaluation — Rustic Chess](https://rustic-chess.org/evaluation/tapering.html),
[Mediocre Chess: Tapered Eval Guide](http://mediocrechess.blogspot.com/2011/10/guide-tapered-eval.html).

### 4. Piece-Square Tables — The Context Lookup Pattern

Piece-square tables (PST) are **multi-dimensional arrays** indexed by
`(piece_type, square)` that return a numeric positional bonus. They are
the simplest and most widely-used pattern for "this piece is more valuable
here than there". Modern engines use **two PSTs per piece** (opening and
endgame), interpolated by tapered eval.

Key architectural properties:

- **Pure lookup**, no computation at runtime.
- **Fully data-driven** — the table content is hand-tuned or optimized by
  Texel-style gradient descent.
- **Trivially incrementally updatable** — when a piece moves from square A
  to square B, subtract PST[piece, A] and add PST[piece, B]. O(1) per
  move.
- **Composable** — PST scores are summed into the total evaluation
  alongside mobility, king safety, pawn structure, etc. No coupling.

PeSTO (Piece-Square Table Only) is a well-known minimalist engine that
uses *only* PSTs for evaluation and still achieves strong play — showing
that well-tuned context lookups alone carry significant signal.

**Transposition to YGO**:

- The direct analog is a **card-zone table**: `CardZoneValue[card_id][zone_id]`
  that returns a base positional value for "this card in this zone". A
  Faimena in MZONE scores differently from Faimena in the GY.
- This is **orthogonal to** the existing `interruption-tags.json` (which
  encodes *what a card does*). The CZV table encodes *where the card
  becomes valuable*. Both contribute.
- Entry count: ~13k cards × 18 zones = ~234k entries if dense, but
  realistically only a few hundred cards need meaningful per-zone
  distinctions. Sparse storage: a map of `(card_id, zone) → value`, with
  a default of 0.
- **Why this is useful for latent value**: a wake-up card like Faimena
  is valuable precisely because it's in MZONE (so it can trigger Guramel)
  — not because it *is* an interruption. The CZV pattern captures this
  naturally: `CZV[faimena_id][MZONE_faceUp]` holds a positive weight even
  though the tag table has nothing to say about Faimena.

Sources:
[Piece-Square Tables — Chessprogramming Wiki](https://www.chessprogramming.org/Piece-Square_Tables),
[Piece-Square Tables — Rustic Chess](https://rustic-chess.org/evaluation/psqt.html),
[PeSTO: Piece Square Tables Only — ROFCHADE](https://rofchade.nl/?p=307),
[Simplified Evaluation Function — Chessprogramming Wiki](https://www.chessprogramming.org/Simplified_Evaluation_Function).

### 5. Additive Composition vs. Multiplicative Modifiers

The dominant composition pattern in pre-DL evaluators is **additive**:
the final score is a weighted sum of feature values. Stockfish, PeSTO,
Texel, most Hearthstone bots — all follow this pattern.

```
eval(state) = Σ w_i × feature_i(state)
```

**Why additive is the default**:

- **Linear and differentiable** — compatible with Texel tuning (logistic
  regression), gradient descent, SPSA.
- **Easy to debug** — each feature contributes a named component; a bad
  score can be traced to a specific over/under-weighted feature.
- **Easy to reason about** — adding a new feature never breaks existing
  ones (to first order).

**Why multiplicative composition is occasionally used**:

- Some interactions are **intrinsically multiplicative**: a divine-shield
  minion's value is roughly 1.5× its base (Hearthstone); a targeted
  protection effect multiplies the value of what it protects, not the
  value of itself.
- **Limited scope** — multiplicative effects are typically modifiers on a
  base additive feature, not a replacement for the additive backbone.

**EHS decomposition as a hybrid**:

The poker EHS formula, `HS × (1 − NPot) + (1 − HS) × PPot`, is a **hybrid**:
the direct-value term is multiplied by `(1 − NPot)` (risk discount) and
the latent term is multiplied by `(1 − HS)` (because if you're already
winning, upside doesn't help). This is neither pure additive nor pure
multiplicative — it is a **two-scale weighted interaction**.

**Architectural implication**: the top-level composer in an EHS-style
scorer is its own module, separate from the sub-scorers. The sub-scorers
each produce an additive feature sum in [0, 1]-normalized space, and the
composer applies the EHS formula to combine them.

**Transposition for v1**:

```
direct  = Σ w_direct_i × direct_feature_i      // normalized to [0, 1]
latent  = Σ w_latent_i × latent_feature_i      // normalized to [0, 1]
risk    = Σ w_risk_i × risk_feature_i          // normalized to [0, 1]
total   = direct × (1 − risk) + (1 − direct) × latent × (1 − risk)
```

Each sub-sum is a flat additive composition (friendly to Texel/ES
tuning). The top-level composer is a fixed non-linear formula (the EHS
template). This keeps calibration simple (tune the weight vectors) while
still capturing direct+latent+risk interactions.

### 6. Hierarchical Sub-Scorers

Modular AI literature (Dill & Dragert) and the Hearthstone AI papers
converge on a **hierarchical composition** pattern: a top-level evaluator
delegates to sub-evaluators, each responsible for a separable aspect of
the state.

```
Evaluator (top-level)
├── BoardEvaluator    — valuation of on-board pieces/minions
├── HandEvaluator     — valuation of cards in hand
├── ResourceEvaluator — mana/LP/deck count
├── ThreatEvaluator   — opponent threats projected forward
└── Composer          — combines sub-scores into final value
```

This is a **composite pattern**, familiar from general software
architecture, applied to scoring. Each sub-evaluator can itself contain
multiple considerations, calling the pattern recursively if needed.

**Why this matters for YGO**:

- Our current scorer is a **single monolithic function**
  (`scoreWithCards`). Extending it for latent value by inlining new logic
  inside `scoreWithCards` would produce a god-function.
- Hierarchical composition makes the extension **additive**: introduce a
  new `LatentScorer` alongside the existing direct-interruption logic,
  wire them together via a composer. Existing code changes minimally.

### 7. Pattern Library — Rule-Based Encoding of Interactions

Neither piece-square tables nor feature accumulators can encode **specific
interactions** (e.g., "Faimena triggers Guramel"). For such patterns,
chess engines use **pattern detection rules** — code that identifies
specific configurations and applies a bonus. Examples:

- **Outpost detection** — a knight on a hole in the opponent's pawn
  structure, defended by a pawn, gets a bonus.
- **Passed pawn race** — a pawn with no opposing pawns on its file or
  adjacent files gets a bonus that grows with its rank.
- **Fianchetto bishop in the long diagonal** — a bishop on g2 with a pawn
  on g3 and a king on g1 gets a bonus, penalty if the g-pawn is missing.

These patterns are **hand-written rules**, sometimes hundreds of them,
each implementing a `detect(state) → bool` and a `score(state) → number`.
Engines keep them in a **pattern library** — a file or module whose sole
purpose is pattern detection.

**Transposition to YGO**: a **latent pattern library** holds wake-up
rules, continuation threats, and protection chains as data + code:

```
latent-patterns.json (data)
{
  "faimena_guramel": {
    "precondition": {
      "board": ["faimena_in_mzone_faceup"],
      "extra": ["guramel_facedown"]
    },
    "trigger": "opponent_monster_effect_activation",
    "effect_type": "wake_up_monster_negate",
    "base_weight": 0.8,
    "confidence": 0.9
  },
  ...
}

latent-pattern-library.ts (code)
- detectPattern(pattern, state) → bool
- evaluatePattern(pattern, state) → number
- iterate patterns, sum matching values
```

The pattern library is **data-driven** (new wake-ups = new JSON entries,
no code changes) but **not purely data** — the precondition DSL needs
code support. This matches how chess outpost detection is implemented:
the rule is general ("knight in a hole, pawn defender"), the instance
data is per-rule.

**Coverage strategy**: v1 ships with 20-50 hand-authored patterns covering
the top meta decks (Branded, Snake-Eye, Tearlaments, Mitsurugi, etc.).
Coverage expands incrementally as new meta archetypes appear, via the
same LLM-assisted pipeline already used for `interruption-tags.json`
(per CLAUDE.md and `interruption-tag-generation-prompt.md`).

### 8. Proposed v1 Architecture — Pulling It Together

Synthesizing the patterns above into a concrete proposal:

```
InterruptionScorer (top-level composer — EHS formula)
│
├── DirectScorer (EXISTING — minor refactor)
│   ├── Considers: interruption tags (current 15 types)
│   ├── Reads: interruption-tags.json, weights.direct.*
│   └── Produces: direct ∈ [0, 1]
│
├── LatentScorer (NEW)
│   ├── WakeUpConsideration
│   │   ├── Reads: latent-patterns.json (wake-up entries),
│   │   │          weights.latent.wakeup.*
│   │   └── Detects pattern preconditions, sums matching bonuses
│   ├── ContinuationConsideration
│   │   ├── Reads: latent-patterns.json (continuation entries),
│   │   │          weights.latent.continuation.*
│   │   └── Scores multi-turn grind/resource plays
│   ├── ProtectionConsideration
│   │   ├── Reads: interruption-tags.json (passive-protection tags),
│   │   │          weights.latent.protection.*
│   │   └── Scores passive walls and targeting immunity as multipliers
│   └── Produces: latent ∈ [0, 1]
│
├── RiskScorer (NEW)
│   ├── HandtrapSusceptibilityConsideration
│   │   ├── Reads: weights.risk.handtrap.*
│   │   │          (feature: count of effects the board depends on)
│   │   └── Estimates probability that one handtrap cuts the chain
│   └── Produces: risk ∈ [0, 1]
│
├── CardZoneValue table (NEW, optional)
│   ├── Sparse map (card_id, zone_id) → bonus
│   └── Added as a feature into DirectScorer or LatentScorer as appropriate
│
└── TaperedComposer (NEW — top-level EHS combination)
    ├── Reads: weights.composer.own_turn_scale,
    │          weights.composer.opp_turn_scale
    ├── Each sub-scorer has (w_own, w_opp) weight pair
    └── total = direct × (1 − risk) + (1 − direct) × latent × (1 − risk)
```

**File layout**:

```
duel-server/
├── data/
│   ├── interruption-tags.json            (existing — extended)
│   ├── interruption-weights.json         (existing — extended with
│   │                                      latent/risk/composer sections)
│   ├── latent-patterns.json              (NEW — wake-ups + continuation)
│   └── card-zone-values.json             (NEW — sparse CZV table)
└── src/solver/
    └── scoring/
        ├── interruption-scorer.ts         (existing — top-level composer)
        ├── direct-scorer.ts               (NEW — extracted from current)
        ├── latent-scorer.ts               (NEW)
        │   ├── wake-up-consideration.ts
        │   ├── continuation-consideration.ts
        │   └── protection-consideration.ts
        ├── risk-scorer.ts                 (NEW)
        │   └── handtrap-consideration.ts
        ├── card-zone-value.ts             (NEW — CZV lookup)
        └── latent-pattern-library.ts      (NEW — precondition DSL runtime)
```

**Key design decisions**:

1. **Data and code are strictly separated** — every new concept introduces
   a JSON file (data) and a TS module (code). Tuning touches only JSON.
2. **Existing logic is preserved and wrapped, not rewritten**. `DirectScorer`
   is the existing `scoreWithCards` logic extracted into its own module;
   its behavior is unchanged at v1 launch.
3. **`scoreState(state)` is the new entry point** exposed by each sub-scorer,
   distinct from the terminal-only legacy entry. This enables Epic 2 MCTS
   to call sub-scorers at non-terminal nodes (progressive bias) without
   touching the composer.
4. **Tapered weights per feature** — every sub-scorer's considerations
   carry `(w_own_turn, w_opp_turn)` pairs, interpolated by a phase scalar
   derived from turn parity and board density.
5. **EHS composer** is a fixed non-linear formula, not a learned model —
   the formula shape is taken from 30 years of poker research.
6. **Pattern library is extensible data** — new wake-ups added without
   code changes, validated by `_validated: true` flag (same pattern as
   `interruption-tags.json`).

### Key Architectural Findings

- **Considerations are the atomic unit** of modular evaluators. Each new
  latent form should be its own consideration, not a branch in existing
  logic.
- **Feature / weights separation is non-negotiable** — enables independent
  calibration, supports data-only card additions, and keeps the evaluator
  testable.
- **Tapered evaluation maps directly** to YGO's own-turn vs. opponent-turn
  context split; every feature should carry two weights.
- **Piece-square tables transpose to a card-zone-value table** — a sparse
  `(card_id, zone)` → value map captures positional value orthogonally to
  effect-based value.
- **Additive composition inside sub-scorers + EHS composition at the top**
  is the right hybrid: tunable with Texel/ES, but captures the
  direct+latent+risk interaction from poker.
- **Hierarchical sub-scorers** prevent the main scorer from becoming a
  god-function and align with the existing modular decomposition of the
  orchestrator (precedent: AnimationOrchestrator decomposed into 5
  managers, per CLAUDE.md).
- **Pattern library (hand-written rules, data-driven instances)** is how
  chess engines encode specific interactions; the same pattern works for
  YGO wake-ups.
- **A concrete v1 architecture is proposed** that preserves the existing
  scorer, adds four new modules (direct, latent, risk, composer), and
  introduces two new data files (`latent-patterns.json`,
  `card-zone-values.json`).

Sources:
[Modular AI — Dill & Dragert, Game AI Pro 3 Ch. 8](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter08_Modular_AI.pdf),
[Tapered Eval — Chessprogramming Wiki](https://www.chessprogramming.org/Tapered_Eval),
[Piece-Square Tables — Chessprogramming Wiki](https://www.chessprogramming.org/Piece-Square_Tables),
[PeSTO — ROFCHADE](https://rofchade.nl/?p=307),
[Improving Hearthstone AI by Combining MCTS and Supervised Learning (arXiv:1808.04794)](https://arxiv.org/pdf/1808.04794),
[Optimizing Hearthstone Agents using an Evolutionary Algorithm (arXiv:2410.19681)](https://arxiv.org/html/2410.19681v1).

## Implementation Research — Practical Roadmap for v1

> **Template adaptation note.** The generic "technology adoption / CI/CD /
> DevOps / team organization / cost optimization" framing is not applicable
> to a solo brownfield project extending an existing scorer. This section is
> re-scoped to the **concrete implementation path** for the architecture
> proposed in the previous section: phased roadmap, fixture-based testing
> strategy, calibration workflow, data bootstrap, risk assessment, cross-
> constraint dependencies, and effort bands.

### 1. Phased Implementation Roadmap

The work splits into **three phases** organized by dependency rather than
feature coverage. Each phase is individually deployable and produces
measurable lift.

#### Phase A — Foundation (unblocks everything else)

**Goal**: make the evaluator extension *possible* by fixing prerequisites
that block any calibration work.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| A.1 | Fix deck seed determinism (constraint 3.3) — respect `duelConfig.deckSeed` instead of overriding | None |
| A.2 | Extract `DirectScorer` from current `scoreWithCards` into its own module; existing behavior unchanged | A.1 |
| A.3 | Build a fixture-based regression harness: curated meta openers + expected main-path combos + pass/fail comparison | A.1 |
| A.4 | Wire up `scoreState(state)` entry point alongside `scoreTerminal(actions, state)`; v1 delegates to the same internal logic but establishes the API for Epic 2 | A.2 |
| A.5 | Terminal classification fix (constraint 3.2) — distinguish voluntary-end / stuck / depth-cap-hit; apply quiescence-style discipline | A.2 |

**Why this phase is non-negotiable**: any change to `interruption-weights.json`
or new feature without A.1 (determinism) is unverifiable. Without A.3
(regression harness), you have no signal on whether a weight change is an
improvement or a regression. Phase A is short (days to low weeks) and
mechanical; it exists to unblock later phases.

#### Phase B — Latent Feature Extension (the core research deliverable)

**Goal**: add the latent / risk sub-scorers and the EHS composer; ship
an improved but *uncalibrated* evaluator that already outperforms the
current scorer on the fixture suite.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| B.1 | Create `latent-patterns.json` with 20-50 hand-authored wake-up rules for the top 8-10 meta decks (Branded, Snake-Eye, Tearlaments, Mitsurugi, Kashtira, Floowandereeze, Dracotail, Runick) | A.3 |
| B.2 | Implement `LatentPatternLibrary` precondition DSL runtime (detect + score) | A.3 |
| B.3 | Implement `WakeUpConsideration`, `ContinuationConsideration`, `ProtectionConsideration` reading from `latent-patterns.json` | B.2 |
| B.4 | Implement `RiskScorer` + `HandtrapSusceptibilityConsideration` | A.2 |
| B.5 | Implement `TaperedComposer` with EHS formula; extend `interruption-weights.json` schema with `direct/latent/risk/composer` sections + `(w_own, w_opp)` pairs | B.3, B.4 |
| B.6 | Seed default weights by inspection (not tuned); run fixture harness and confirm no regression vs. current scorer | B.5 |
| B.7 | Implement sparse `card-zone-value.ts` lookup (optional for v1, may be deferred to v1.1) | B.5 |

**Phase B exit criteria**: fixture pass rate is ≥ current scorer on meta
fixtures, and the evaluator produces structurally correct scores on
endboards that previously scored 0 (Faimena + Guramel test case must no
longer be a zero).

#### Phase C — Calibration (the "makes it actually work" phase)

**Goal**: tune the weights on a labeled corpus to maximize fixture hit
rate and reduce false positives.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| C.1 | Build a labeled corpus of ~500-2000 endboards: LLM-assisted scoring of fixtures + held-out meta endboards from deck guides | Phase B |
| C.2 | Implement a Texel-style or ES-style offline tuner over `interruption-weights.json` | C.1 |
| C.3 | Define a fitness function: weighted combination of (fixture pass rate, corpus loss, latency budget) | C.1 |
| C.4 | Run tuning, collect new weights; validate via fixture harness + corpus held-out set | C.2, C.3 |
| C.5 | Promote new weights as the default artifact; keep prior as a fallback | C.4 |

**Phase C exit criteria**: viable lines on at least **6 of the top 10 meta
decks** (target for "functional" per the constraints doc). Anything less
counts as partial and is retained only as a staging weights set, not the
default.

### 2. Testing Strategy — Fixture-Based Regression

#### SPRT is the wrong fit at v1 (and here's the adaptation)

Chess engines use SPRT (Sequential Probability Ratio Test) as the gold
standard for validating weight changes: play engine-new vs. engine-old
until the result is significant. Stockfish's Fishtest distributes this
across thousands of machines; a typical test is 20k-40k games per patch.

**SPRT does not apply to our v1 solver** because:

- SPRT requires two-sided matches (old vs. new playing against each
  other). The goldfish solver has no opponent.
- Win/loss is not our signal — we want to know whether the solver
  *reproduces the expected combo*, not whether it beats another solver.
- Epic 2 adversarial (when available) would enable SPRT-style testing,
  but it is not a prerequisite for v1 evaluator calibration.

**The v1-appropriate substitute: fixture hit-rate testing with binomial
confidence intervals.**

- Curated fixture suite: **10-30 meta openers**, each with a human-
  authored expected main path ("the intended combo").
- Metric: **fixture hit rate** — fraction of fixtures where the solver's
  top main-path matches the expected path (exact match or fuzzy match
  on key actions).
- Change validation: Wilson score interval on the pass rate difference
  between `weights_new` and `weights_old`, with a required confidence
  threshold before promotion.
- This is essentially **a 1-sided SPRT analog on a binomial outcome with
  a fixed fixture pool**, which is statistically cleaner than SPRT but
  needs a reasonably large fixture count (≥20) for sensitivity.

Hearthstone AI Competition structure is the direct precedent: participants
submit bots, the competition runs **100+ games per matchup over a small
number of known decks** to determine win rate. Our analog: the solver is
the bot, the fixtures are the "decks", and the metric is "does the
expected main-path appear in the top-K results" rather than win rate.

Sources:
[Sequential Probability Ratio Test — Chessprogramming Wiki](https://www.chessprogramming.org/Sequential_Probability_Ratio_Test),
[Fishtest FAQ — Stockfish Docs](https://official-stockfish.github.io/docs/fishtest-wiki/Fishtest-FAQ.html),
[SPRT Testing — Rustic Chess](https://rustic-chess.org/progress/sprt_testing.html),
[Hearthstone AI Competition](https://hearthstoneai.github.io/),
[Introducing the Hearthstone-AI Competition (Dockhorn)](https://adockhorn.github.io/files/papers/Introducing%20the%20Hearthstone-AI%20Competition.pdf).

#### Fixture Suite Design

**Initial target**: 20 fixtures covering the top 8-10 meta decks of the
current format, with variants:

- 2-3 openers per deck (representative hands, not edge cases)
- Each fixture records: deck list, starting hand, expected main path
  (ordered action sequence), expected score range
- Categorized by failure mode: "wake-up heavy" (Mitsurugi, Branded),
  "continuation threat" (Kashtira, Tearlaments), "grind"
  (Snake-Eye Flamberge), "passive protection" (Apollousa + Baronne +
  Borreload chains)
- Each fixture stores its `deckSeed` — reproducible given A.1

Fixtures are versioned and grow incrementally. The initial 20 unblock
Phase B; expanding to 50-100 is a Phase C concern.

### 3. Calibration Workflow — Data Bootstrap + Tuning Loop

#### Labeled corpus bootstrap (the universal bottleneck)

Every pre-DL evaluator calibration runs into the same problem: where do
the labels come from? The evidence from Phase A of the search landscape:

- Chess has millions of labeled positions (game outcomes). Not
  applicable here — we don't have "games" to label.
- Hearthstone uses rollout-based self-play labels. Not applicable at v1
  — no adversarial solver yet.
- Poker precomputes exact EHS from combinatorial enumeration. Not
  applicable — YGO's action space is too large.

**The v1-appropriate strategy: three-tier labeling**.

| Tier | Source | Cost | Volume | Quality |
|------|--------|------|--------|---------|
| 1 | Fixture expected paths | Zero (already authored) | 20-100 | Gold — human-curated |
| 2 | LLM-assisted endboard scoring via batch prompt (precedent: `interruption-tag-generation-prompt.md`) | Low (API calls) | 500-2000 | Silver — noisy but scalable |
| 3 | Rollout proxy: for each candidate endboard, fork and apply N canonical adversary moves, measure disruption count | Medium (CPU, but no human) | Unlimited | Bronze — noisy but deterministic |

LLM-assisted labeling is validated by current industry practice: *"LLMs
can label data at the same or better quality compared to skilled human
annotators, but approximately 20x faster and 7x cheaper"*, and the
pattern already has a proven in-project precedent via
`interruption-tag-generation-prompt.md`.

Tier 3 is unique in that it **generates its own labels from
simulation** — analogous to Hearthstone's rollout-based approach but
limited to single-turn opponent responses (the cost of a full game
rollout is not tractable at YGO fork cost).

**Bootstrap sequence**:
1. Start with Tier 1 alone. Run Phase B with inspection-seeded weights.
2. Use Tier 2 to expand the corpus to ~500 endboards. Re-run fixture
   harness; if the expanded labels produce regressions on Tier 1, the
   LLM prompt needs refinement.
3. Tier 3 as a final augmentation for failure-mode specific cases.

Sources:
[Automatic Data Labeling with LLMs — Vellum AI](https://www.vellum.ai/blog/automatic-data-labeling-with-llms),
[LLM Data Labeling — Label Your Data](https://labelyourdata.com/articles/llm-data-labeling),
[Data Labeling for AI — Labelbox](https://labelbox.com/guides/data-labeling/).

#### Tuning Loop Details

The Phase C tuning loop is:

```
input:  interruption-weights.json (initial)
        labeled corpus (Tier 1 + Tier 2 ± Tier 3)
        fitness function

loop:
    1. Perturb weights (ES variant)
    2. Compute loss on corpus + fixture hit rate
    3. Combine into fitness: λ × corpus_loss − (1 − λ) × fixture_pass_rate
    4. Accept if fitness improved; otherwise revert
    5. Every N steps, run the full fixture harness for validation

output: interruption-weights.json (tuned)
```

**ES over Texel**: choose ES as the primary algorithm because
- Gradient-free — no differentiability requirement on the feature code
- Works with the full non-linear EHS composer as-is
- Matches the 21-parameter scale reported by Hearthstone papers
- No reliance on labeled data being fully quiet (more YGO-friendly)

Texel remains available as a fallback for the linear sub-scorer weights
if ES converges poorly.

### 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **R1**: LLM-assisted labels are too noisy to tune weights | Medium | High | Tier 1 corpus alone is sufficient for Phase B bootstrap; Tier 2 gated by inter-rater checks against Tier 1 |
| **R2**: Pattern library misses a meta deck's wake-up pattern | High | Medium | Incremental: ship Phase B without universal coverage; add patterns per deck; coverage is a gradient, not a binary |
| **R3**: EHS formula is wrong shape for YGO | Low | High | Keep composer formula configurable; if EHS underperforms, fall back to pure additive |
| **R4**: Per-terminal evaluation cost rises significantly | Medium | Medium | Staged eval pattern: cheap direct first, latent only on top-K candidates — bounds the worst-case cost |
| **R5**: Calibration overfits to the fixture suite | Medium | High | Held-out corpus split; fixture-pass-rate improvement must also hold on held-out endboards before promotion |
| **R6**: Fork cost (constraint 1.3) bottlenecks Phase C (Tier 3 rollouts too expensive) | High | Medium | Cap Tier 3 to a small set of canonical adversaries; precompute Tier 3 table offline once, reuse for all tuning runs |
| **R7**: New latent features interact badly with existing pruning (TT, loop detection) | Medium | High | No change to search logic in v1 — scoring is orthogonal to pruning at terminal nodes |
| **R8**: Deck seed fix (A.1) reveals pre-existing bugs masked by non-determinism | Medium | Medium | Expected — treat as discovery, allocate buffer in Phase A effort band |

### 5. Cross-Constraint Dependencies

This research touches **3 of the 11 structural constraints** from
[solver-structural-constraints.md](./solver-structural-constraints.md):

- **2.2 Scorer fidelity** → addressed directly by Phase B
- **2.3 Latent interruption modeling** → addressed directly by Phase B
- **3.2 Terminal classification** → addressed directly by Phase A.5
- **3.3 Deck seed determinism** → hard dependency for Phase A.1

**Does not address**:

- **1.1 Node budget / 1.2 Wall-clock / 1.3 Fork cost** — physical
  constraints, orthogonal
- **2.1 Move ordering** — semantic constraint, complementary but separate
  research
- **3.1 Observed state completeness** — complementary, would improve TT
  cache hit rate for the new scorer but is not a prerequisite
- **4.1 Data coverage / 4.2 Verification** — orthogonal

**Prioritization implication**: per the constraints doc's own ranking,
the three top blockers are 2.3 (latent), 1.3 (fork), 2.1 (move
ordering). This research addresses 2.3 end-to-end but produces **no lift
on 1.3 or 2.1**. A viable solver requires addressing all three — this
research is necessary but not sufficient.

### 6. Effort Estimation (Gross Bands)

Effort in calendar weeks for a single developer working full-time,
assuming the proposed architecture is followed:

| Phase | Effort Band | Confidence |
|-------|------------|-----------|
| Phase A (Foundation) | 1-2 weeks | High |
| Phase B (Latent Extension) | 3-5 weeks | Medium |
| Phase C (Calibration) | 2-4 weeks | Low |
| **Total** | **6-11 weeks** | Medium |

Confidence is lower on Phase C because it depends on dataset quality
which can only be assessed empirically after Phase B ships.

For comparison:
- The DL alternative path discussed earlier: ~2-4 months minimum, with
  lower confidence and no bootstrap path.
- The "do nothing" path: the solver remains non-functional on meta decks
  (baseline).

### 7. DL Horizon — When to Revisit

This is the promised short section on **when learned value functions
become appropriate**. The conditions identified earlier remain valid:

1. **Labeled dataset exists and is non-trivial** — the Phase C corpus
   (~500-2000 endboards) from this research *becomes* the seed dataset
   for a DL approach. After Phase C, tier 2+3 labels can be combined
   with the fixture suite into a ~10k-50k example dataset over several
   meta formats.
2. **Pre-DL plateau observed** — after ES tuning has converged and the
   fixture hit rate stops improving despite weight updates, the linear
   model is saturated. This is the signal that the feature set itself is
   insufficient.
3. **Inference cost budget exists** — fork cost fix (constraint 1.3)
   lands, per-terminal budget increases by 10-50×, enabling richer
   evaluators.
4. **Patterns resist hand-crafting** — specifically for grind value and
   multi-turn continuation (the "Go-like" forms), which are harder to
   capture with rule-based patterns. This is where a learned value
   function would add signal the pre-DL approach cannot reach.

**What DL would look like in v2-v3** (brief sketch, not actionable now):

- Small MLP (100k-500k params) on a tabular feature vector — the same
  features the pre-DL evaluator already computes, plus a card-embedding
  layer
- Trained by distillation from the Phase C tuned scorer + augmented with
  Tier 3 rollout data
- Deployed via onnxruntime-node in the solver worker, batched
  inference for throughput
- Tuned via self-play once Epic 2 adversarial is stable
- Deployment path: soft launch as an optional "learned mode" flag,
  gated on the feature scorer continuing to be the default fallback

**Not included in this research** — the specifics of training pipeline,
model architecture, or bootstrap data pipeline for DL. Those belong in a
future research task gated on the four trigger conditions above.

### 8. Success Metrics

| Metric | Phase A Target | Phase B Target | Phase C Target |
|--------|---------------|----------------|----------------|
| Deterministic solve (same input → same output) | 100% | 100% | 100% |
| Fixture pass rate (top-K main path match) | Baseline captured | ≥ baseline | ≥ 60% on top 10 meta fixtures |
| Terminal classification (voluntary vs. stuck vs. depth-cap) | Implemented | Used in scoring | Validated |
| Evaluator latency at terminal (relative to baseline) | 1.0× | ≤ 1.5× | ≤ 1.5× |
| Endboards containing latent cards produce non-zero scores | — | 100% | 100% |
| LLM-labeled corpus inter-rater agreement with fixtures | — | — | ≥ 80% |

**"Functional" per the constraints doc** = Phase C target of ≥ 60%
fixture hit rate on the top 10 meta decks. Anything below this remains
"partial" and should not be marketed as viable.

### Implementation Research Key Findings

- **Three phases** (Foundation / Latent Extension / Calibration) are
  sequential hard dependencies. Skipping Phase A makes Phase B
  unverifiable; skipping Phase B makes Phase C unbuildable.
- **Deck seed determinism (constraint 3.3) is the #1 blocker** for the
  entire research. Fix this first regardless of anything else.
- **Fixture-based regression testing is the v1-appropriate substitute
  for SPRT**. 20-30 curated meta openers with expected main paths
  provide enough statistical power with Wilson-interval comparison.
- **Three-tier labeling strategy** (fixture gold + LLM silver + rollout
  bronze) is the viable path to a calibration corpus without human
  curation effort at scale.
- **ES is the recommended tuning algorithm** (gradient-free, matches
  Hearthstone precedent, works with EHS composer).
- **Effort band: 6-11 weeks** total for a solo developer; compared to
  2-4 months minimum for the DL alternative.
- **This research addresses 3 of 11 structural constraints** (2.2, 2.3,
  3.2) and requires 3.3 as a prerequisite. It does not address fork
  cost (1.3) or move ordering (2.1), both of which must be addressed
  in parallel research for a truly viable solver.
- **The DL horizon is concrete**: the Phase C corpus *becomes* the seed
  dataset for a future learned value function. This research is not a
  dead end if DL later becomes the target; it is the bootstrap phase
  that a DL approach currently cannot skip.

Sources:
[Sequential Probability Ratio Test — Chessprogramming Wiki](https://www.chessprogramming.org/Sequential_Probability_Ratio_Test),
[Fishtest FAQ — Stockfish Docs](https://official-stockfish.github.io/docs/fishtest-wiki/Fishtest-FAQ.html),
[Hearthstone AI Competition](https://hearthstoneai.github.io/),
[Automatic Data Labeling with LLMs — Vellum AI](https://www.vellum.ai/blog/automatic-data-labeling-with-llms),
[LLM Data Labeling — Label Your Data](https://labelyourdata.com/articles/llm-data-labeling).

---

# Research Synthesis — Executive Summary and Strategic Recommendations

> **Template adaptation note.** The generic synthesis template asks for
> sections on "Security and Compliance", "Scalability Patterns",
> "Competitive Technical Advantage", "Future Innovation Opportunities" —
> none of which apply to an evaluation-function research topic for a
> personal solver project. This synthesis is re-scoped to **what actually
> matters**: an executive summary that tells the decision-makers (ourselves)
> what to do, a cross-cutting TOC linking the sections already written,
> consolidated key findings, and a concrete action checklist.

## Executive Summary

The skytrix combo solver currently fails to produce viable combo lines on
Tier 1-2 meta decks because its evaluation function (`InterruptionScorer`)
scores only what cards do *immediately* on the turn a combo resolves. The
dominant value model of modern meta — **wake-up triggers**, **continuation
threats**, **passive protection**, and **grind value** — is invisible to
the scorer. Since the DFS follows the scorer, the search never converges
on the endboards that rely on these effects. The solver's other structural
constraints (fork cost, move ordering) are real and complementary, but
this research shows that **the scoring gap is addressable in 6-11 weeks of
solo-developer effort via pre-Deep-Learning techniques**, without needing
new infrastructure, learned models, or self-play pipelines.

The pre-DL game-AI literature — chess (Stockfish classical), Hearthstone AI
(SabberStone, Dockhorn line of work), poker (Billings/Schaeffer EHS), Go
(classical influence functions), MtG (Forge as cautionary counter-example)
— provides a **complete set of transposable patterns** for this problem.
Specifically: the **poker EHS decomposition** (`HS × (1 − NPot) + (1 − HS)
× PPot`) provides the mathematical structure for direct + latent + risk
value; **Stockfish's king-safety accumulator** provides the canonical
pattern for encoding non-realized threats; **Hearthstone feature-based
evaluators** (10-30 parameters, tuned by ES) provide the scale anchor and
the direct genre precedent; **Stockfish tapered evaluation** provides the
context-dependent weighting pattern (own-turn vs. opponent-turn); and
**chess piece-square tables** provide the card-zone-value lookup pattern.

The research produces a **concrete v1 architecture**: a hierarchical
evaluator composed of `DirectScorer` (existing, extracted), `LatentScorer`
(new, three considerations + pattern library), `RiskScorer` (new),
`CardZoneValue` (new sparse lookup), and a top-level `TaperedComposer`
applying the EHS formula with per-feature `(w_own, w_opp)` pairs. It
specifies two new data files (`latent-patterns.json`,
`card-zone-values.json`), preserves the feature/weights separation already
present in the existing scorer, and exposes a `scoreState(state)` entry
point that will later enable Epic 2 MCTS progressive bias without a
rewrite. The implementation is split into three phases — **Foundation**
(fixing deck seed determinism, extracting the direct scorer, building the
fixture harness), **Latent Extension** (the core research deliverable),
and **Calibration** (ES tuning on a three-tier labeled corpus built via
fixture gold + LLM silver + rollout bronze).

**Key Technical Findings:**

- **The scoring gap is solvable pre-DL.** No single pattern is sufficient,
  but the *combination* of EHS decomposition + tapered weights + pattern
  library + fixture-based calibration is a complete solution path with
  well-documented precedent.
- **DL is feasible but premature.** The bootstrap problem (no labeled
  dataset, no working self-play) makes a learned value function
  infeasible at v1. The Phase C corpus produced by this research is
  precisely the dataset a future DL approach would need — this research
  is not a dead end for DL, it is the bootstrap phase DL cannot skip.
- **The research is necessary but not sufficient.** It addresses 3 of 11
  structural constraints (2.2 scorer fidelity, 2.3 latent modeling, 3.2
  terminal classification) and requires 1 more as a prerequisite (3.3
  deck seed determinism). It does not address fork cost (1.3) or move
  ordering (2.1), which are complementary blockers that must be addressed
  in parallel research.
- **Deck seed determinism is the #1 prerequisite.** No tuning framework
  works without reproducible solves. This single fix (~days of effort)
  unblocks everything else and must be executed first regardless of
  research direction.
- **Fixture-based regression testing is the v1-appropriate substitute for
  SPRT.** Chess engine gold standards require match-play between engine
  versions, which the goldfish solver cannot produce. 20-30 curated meta
  openers with expected main paths and binomial confidence intervals
  provide sufficient statistical power.
- **LLM-assisted labeling has both industry validation and an in-project
  precedent.** The `interruption-tag-generation-prompt.md` pattern
  already in use for `interruption-tags.json` extends naturally to
  endboard scoring.

**Strategic Recommendations:**

1. **Ship deck seed determinism immediately** (Phase A.1), unconditional
   on the rest of this research. It is a prerequisite not only for the
   scorer extension but for every regression-testable change to the solver.
2. **Build the fixture suite before any scoring work** (Phase A.3). 20
   curated meta openers with expected main paths, versioned as a test
   fixture, become the single source of truth for "is the solver getting
   better or worse".
3. **Implement the architecture proposed in section 8 of Architectural
   Patterns, not a variation**. It is the result of pattern triangulation
   across chess, poker, and Hearthstone — every component has a documented
   precedent. Deviating from it requires equivalent justification.
4. **Seed the pattern library with hand-authored wake-up rules for the top
   8-10 meta decks before calibrating weights** (Phase B.1). Coverage is
   a gradient, not a binary — partial coverage of meta decks produces
   measurable lift over zero coverage.
5. **Defer DL consideration until all four trigger conditions are met**.
   This research identifies the conditions explicitly. Revisit only when
   one or more are crossed, not on speculation or hype.

## Table of Contents

| Section | Content | Primary question answered |
|---------|---------|---------------------------|
| Research Overview (top) | Problem definition, scope | What are we researching and why? |
| Technical Research Scope Confirmation | Topic, goals, methodology, inputs | What did we commit to investigate? |
| Technology Stack Analysis — Game-AI Evaluation Landscape | Open-source engines, academic corpus, tuning frameworks, datasets | What pre-DL evaluators exist, what do they do, what can we learn from them? |
| Integration Patterns Analysis | Eval call placement, incremental features, terminal classification, rollout integration, calibration pipeline | How does a pre-DL evaluator plug into a search engine without breaking anything? |
| Architectural Patterns and Design | Considerations, feature/weights separation, tapered eval, PST, composition patterns, pattern library, **v1 architecture proposal** | How should the evaluator be structured internally? |
| Implementation Research | Phased roadmap, fixture testing, calibration workflow, risk register, cross-constraint dependencies, DL horizon | What concrete steps produce a working deliverable and in what order? |
| Research Synthesis (this section) | Executive summary, consolidated findings, action checklist | What do we actually do? |

## Consolidated Findings by Theme

### Findings on the Problem Structure

- The evaluation gap is **fundamentally a scoring problem, not a search
  problem**. Adding search budget without fixing the scorer converges on
  the wrong answer faster.
- The gap manifests in **four forms of latent value** (wake-up,
  continuation, protection, grind), not a single "wake-up" pattern. The
  initial framing in the constraints doc was narrower than the real
  scope.
- **Some forms are more tractable than others.** Wake-ups and passive
  protection are pattern-dense and hand-craftable; grind value and
  long-range continuation are Go-like and may resist pre-DL encoding.
  Acknowledge this split in v1 scope rather than forcing all four into
  equal treatment.

### Findings on the Technical Landscape

- **No YGO-specific pre-DL evaluator exists in the literature.** This
  research is producing novel application, not replicating published work.
- **Hearthstone is the closest genre neighbor**, contributing feature
  vocabulary, tuning scale (10-30 parameters), and opponent-move
  prediction as a separable concern.
- **Poker EHS is the closest mathematical framework**, contributing the
  decomposition structure that every sub-scorer plugs into.
- **Stockfish classical is the closest engineering reference**,
  contributing the accumulator pattern, tapered eval, PSTs, Texel tuning,
  and the data/code separation discipline.
- **Forge (MtG) is the canonical negative example** — per-card evaluation
  without opponent-turn modeling is exactly the failure mode we must
  avoid, and it illustrates what the pre-DL pattern looks like when done
  badly.
- **Go pre-AlphaGo is the outer boundary** — some forms of board value
  cannot be hand-crafted at professional quality, and distinguishing
  tractable from intractable cases is a v1 design concern, not a
  discovered limitation after implementation.

### Findings on Integration

- **Terminal-only evaluation is correct for DFS** (Epic 1). The fork cost
  dominates per-terminal eval cost by orders of magnitude, so incremental
  feature maintenance is not a priority at v1.
- **Progressive bias in MCTS** (Epic 2) requires per-step evaluation and
  thus makes incremental features essential — but this is Epic 2 concern,
  not v1. Design v1 with `scoreState(state)` as a distinct entry point so
  Epic 2 can call into sub-scorers without a rewrite.
- **Quiescence-style terminal classification directly solves the known
  constraint 3.2 gap**. Distinguish quiet (voluntary end phase) from
  volatile (stuck, depth-cap-hit) terminals and apply different scoring
  rules to each.
- **Opponent-response rollouts are prohibitive at solve time** but
  **tractable offline**. Precompute a latent-value table keyed by
  `(card_id, context)`; look up at runtime instead of rolling out per
  call.
- **The calibration pipeline is blocked by deck seed determinism**. No
  tuning framework (Texel, ES, SPSA) works without reproducible solves.

### Findings on Architecture

- **Hierarchical sub-scorers with a top-level EHS composer** is the
  natural decomposition. Each sub-scorer is additive (tunable), the
  composer applies a fixed non-linear formula (30 years of poker research
  validates the shape).
- **Tapered weights `(w_own, w_opp)` apply to every feature**, not just a
  subset. This doubles the calibration surface but captures the most
  important context split for YGO scoring.
- **Data/code separation is preserved and extended**. New wake-up rules
  are new JSON entries; new feature types are new considerations; neither
  requires touching the search engine, the state model, or the existing
  direct scorer.
- **Pattern library encodes interactions that features cannot**. Wake-up
  rules are hand-authored data + a minimal precondition DSL runtime, same
  shape as chess outpost/passed-pawn detection rules.
- **The existing scorer is preserved, not rewritten**. `DirectScorer`
  extracts `scoreWithCards` unchanged; all new logic is additive. This is
  a critical risk mitigation — the existing scorer has known behavior
  that has been debugged over prior epics, and preserving it avoids
  regression in already-working paths.

### Findings on Implementation

- **Three-phase roadmap** (Foundation / Latent / Calibration) with hard
  dependencies. Phase A is mechanical and short; Phase B is the core
  deliverable; Phase C is the only phase with low confidence (depends on
  dataset quality).
- **The three-tier labeling strategy** (fixture gold / LLM silver /
  rollout bronze) is the viable path to a calibration corpus without
  human curation at scale. LLM-assisted labeling has both industry
  validation (20× faster, 7× cheaper than human) and an in-project
  precedent.
- **ES is preferred over Texel for tuning** because it is gradient-free,
  works with the non-linear EHS composer as-is, matches the Hearthstone
  precedent at the 20-30 parameter scale, and does not require the corpus
  to be fully quiet.
- **Fixture hit-rate with Wilson intervals** replaces SPRT for v1
  validation. A 20-30 fixture suite with binomial confidence testing is
  statistically sufficient and avoids the match-play infrastructure
  requirement.
- **Effort band: 6-11 weeks solo** vs. 2-4 months minimum for DL. This is
  the single strongest argument for pre-DL at v1.
- **"Functional" is defined concretely**: ≥ 60% fixture hit rate on the
  top 10 meta decks. This is the graduation criterion from "partial"
  (equivalent to buggy per the constraints doc) to actually-shippable.

## Cross-Research Coupling

This research must be read alongside two future complementary research
tracks to produce a fully viable solver:

1. **Fork cost research** (constraint 1.3) — the single largest physical
   budget consumer. Lifting it 10-50× via WASM snapshot or replay caching
   is a separate research effort. Without it, the best possible scorer is
   still capped by the search budget.
2. **Move ordering research** (constraint 2.1) — the effective-depth
   multiplier. A good ranker can make a 500-node search discover combos
   that a bad ranker would need 50000 nodes to find. The current solver
   has no ranker on `SELECT_IDLECMD`, the single most important decision
   point.

The three efforts (this research + fork cost + move ordering) are
**mutually reinforcing**: a better scorer (this research) without reach
(1.3) gets nowhere; a bigger reach without direction (2.1) explores
randomly; better ordering without a compass (this research) reaches the
wrong place. The constraints doc is explicit that **all three must be
addressed for "functional" output** — none alone is sufficient.

## Action Checklist — Next 2 Weeks

Converting research into work:

| # | Action | Phase | Rationale |
|---|--------|-------|-----------|
| 1 | Review and approve this research document | — | Gate for the rest |
| 2 | Create a tracking epic (or milestone) for the scorer extension | — | Work organization |
| 3 | Fix deck seed determinism (A.1) | Phase A | Unconditional prerequisite |
| 4 | Draft the fixture suite: 20 meta openers + expected main paths | Phase A | Single source of truth for regression |
| 5 | Extract `DirectScorer` from current `scoreWithCards` (A.2) | Phase A | No-op refactor to unblock architecture |
| 6 | Implement quiescence-style terminal classification (A.5) | Phase A | Low effort, high signal |
| 7 | Build initial `latent-patterns.json` for 2-3 meta decks as proof of concept | Phase B preview | Validates the DSL shape early |
| 8 | Spike the `TaperedComposer` with the EHS formula and dummy weights | Phase B preview | Validates the composer shape early |

Everything beyond this list is Phase B/C work that should be scheduled
after Phase A completes and the fixture harness produces its first
baseline.

## DL Horizon — Explicit Gating Conditions

Repeated here for prominence, from Section 7 of Implementation Research:

A learned value function should be revisited **only when** at least one of
the following is observable:

1. **Labeled dataset is non-trivial and available** — the Phase C corpus
   of this research is the seed, expanded via rollout bronze labels to
   ~10k-50k examples across meta formats.
2. **Pre-DL plateau is observed** — ES tuning has converged and the
   fixture hit rate stops improving despite weight updates, indicating
   the feature set is saturated.
3. **Fork cost has been resolved** (constraint 1.3) — per-terminal
   budget increases by 10-50×, enabling richer evaluators including
   small NN inference.
4. **Patterns resist hand-crafting** — specifically for grind value and
   long-range continuation (the Go-like forms), where rule-based
   encoding produces brittle results despite careful effort.

**None of these conditions is currently satisfied.** Revisiting DL now
would duplicate work that the pre-DL path produces as a byproduct, and
would stall on the bootstrap problem. The path forward is pre-DL v1 →
observe → reassess at Phase C completion.

## Research Methodology Notes

This research used **cross-domain pattern mining** as its primary method:
surveying other game-AI communities that solved the structurally
identical problem and extracting transposable primitives. The sources
span:

- **Chess programming**: Chess Programming Wiki, Stockfish documentation,
  TalkChess forum, Texel tuning papers, Rustic/ROFCHADE/MadChess engine
  documentation, Zurichess blog.
- **Hearthstone AI**: SabberStone framework, Hearthstone AI Competition
  papers, Dockhorn et al. publications (Predicting Opponent Moves,
  Improving Hearthstone AI by Combining MCTS and Supervised Learning),
  Optimizing Hearthstone Agents evolutionary paper.
- **Poker AI**: University of Alberta Poker Research Group, Loki/Poki
  papers (Billings, Papp, Schaeffer, Szafron), Effective Hand Strength
  algorithm (1998).
- **Magic: The Gathering AI**: Forge engine, FLAIRS Magic agent framework
  paper.
- **Go AI**: pre-AlphaGo classical heuristics literature, NeuroGo
  references.
- **General game AI**: Game AI Pro 3 Chapter 8 (Modular AI, Dill &
  Dragert), MCTS progressive bias literature.
- **Calibration and testing**: SPRT documentation, Fishtest FAQ, Wilson
  score interval references, LLM-based data labeling industry practice.

Every claim in this document is either:

- Cited to a public source, or
- Derived from internal project files
  ([solver-structural-constraints.md](./solver-structural-constraints.md),
  CLAUDE.md, existing solver code), or
- An explicit synthesis marked as such.

**Confidence levels**:

- **High**: claims about pre-DL chess/Hearthstone/poker state-of-the-art
  — these are established fields with consensus literature.
- **Medium**: claims about transposition to YGO — these are reasoned
  analogies, not tested.
- **Low**: effort estimates, fixture hit rate targets, corpus quality
  predictions — these are informed guesses, to be empirically validated
  in Phase B/C.

## Research Conclusion

**The pre-DL path is the right v1 bet for the skytrix solver scoring
problem.** It has mature precedent (30+ years), a solvable implementation
(6-11 weeks), a defined graduation criterion (≥ 60% fixture hit rate on
top 10 meta), and it leaves the door open for DL as a v2-v3 refinement
without creating a dead end. The Phase A foundation work is short and
unconditional — it unblocks everything, and it should be executed
immediately regardless of whether the rest of this research is adopted
wholesale.

The research does not promise a complete solver — it promises to address
the scoring gap that is currently the dominant failure mode on meta
decks. Fork cost and move ordering remain complementary blockers. A fully
viable solver requires addressing all three in parallel, and the
constraints doc is explicit on this point.

**Next concrete step**: execute Phase A.1 (deck seed determinism) this
week as a stand-alone quick fix, then convene to review this document and
commit to Phase A.2-A.5 as a single coherent block of work.

---

**Technical Research Completion Date:** 2026-04-13
**Research Period:** single-session comprehensive technical analysis
**Source Verification:** all technical claims cited with public sources
  or internal project files
**Technical Confidence Level:** High on landscape, Medium on YGO
  transposition, Low on empirical predictions
**Next Research Tracks:** fork cost (constraint 1.3), move ordering
  (constraint 2.1) — both complementary blockers

_This comprehensive technical research document serves as the reference
blueprint for extending the skytrix combo solver's `InterruptionScorer`
to capture latent board value via pre-Deep-Learning patterns transposed
from the broader game-AI literature._
