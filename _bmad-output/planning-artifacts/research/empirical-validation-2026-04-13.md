# Solver empirical validation — 2026-04-13

**Status:** v1 — spike / one-shot measurement
**Purpose:** Ground-truth the hierarchy of blockers proposed in
[solver-structural-constraints.md](solver-structural-constraints.md) before
committing to the 12-18 week joint execution of the three technical research
docs (pre-DL scorer, fork cost, move ordering).

**Gating question:** Are the three top blockers (1.3 fork cost, 2.1 move
ordering, 2.3 latent modeling / 2.2 scorer fidelity) the real dominants of
the empty-endboard failure mode, or does the observed failure reframe the
priority stack?

**Short answer:** The hierarchy is correct in spirit but the sequencing and
severity differ from the doc. See §6 "Conclusion".

---

## 1. Setup

### 1.1 Fixtures (reused from existing suite, not authored here)

Three curated competitive meta openers from
[solver-validation-decks.json](solver-validation-decks.json), each with a
hand-curated `expectedBoard` golden and a fixed `deckSeed` (determinism fix
shipped in commit b60cfc2d, 2026-04-13):

| Fixture | Deck | Hand (5 cards) | Expected board (cards) |
|---------|------|----------------|------------------------|
| `ddd-pendulum-opener` | D/D/D, WCQ Top 4 | Savant Kepler + Savant Copernicus + Scale Surveyor + Dark Contract with the Gate + Mulcharmy Fuwalos | 5 cards: Wave High King Caesar, Super Doom King Bright Armageddon, Sky King Zeus Ragnarok, Cursed King Siegfried, D/D/D Headhunt |
| `ryzeal-mitsurugi-opener` | Mitsurugi Ryzeal, HK Top 8 | Ame no Habakiri + Ice Ryzeal + Sword Ryzeal + Mitsurugi Prayers + Mulcharmy Fuwalos | 6 cards: Ryzeal Detonator, Ryzeal Duo Drive, Futsu no Mitama no Mitsurugi, Number 90 Galaxy-Eyes Photon Lord, Ryzeal Cross, Mitsurugi Great Purification |
| `branded-dracotail-opener` | Branded Dracotail, Bainbridge 2nd | Dracotail Faimena + Dracotail Lukias + Dracotail Pan + Branded Fusion + Blazing Cartesia | 6 cards: Dracotail Arthalion, Ecclesia and the Dark Dragon, Dracotail Flame, Dracotail Horn, Dracotail Sting, Dracotail Faimena (in hand) |

### 1.2 Instrumentation

Env-gated (`SOLVER_INSTRUMENT=1`, no-op when unset) timing counters added at
three call-sites via the new module
[solver-instrumentation.ts](../../../duel-server/src/solver/solver-instrumentation.ts):

- `OCGCoreAdapter.fork()` — count + `process.hrtime.bigint()` delta, plus a
  6-bucket histogram (<1ms, 1-5, 5-10, 10-20, 20-50, 50ms+)
- `OCGCoreAdapter.applyAction()` — count + total ns
- `InterruptionScorer.scoreWithCards()` — count + total ns

Runner:
[spike-empirical-validation.ts](../../../duel-server/scripts/spike-empirical-validation.ts).
Boots the adapter + DfsSolver in-process (skipping the piscina worker pool so
counters are readable in the same process). One DFS instance per fixture to
prevent TT / Zobrist bleed. Dumps a full structured JSON (raw data) and logs
a per-fixture summary.

Raw JSON artifacts:
- `empirical-validation-2026-04-13-raw.json` — speed=fast run
- `empirical-validation-2026-04-13-optimal-raw.json` — speed=optimal run

### 1.3 Solver configuration

Unchanged from production (`duel-server/data/solver-config.json`):

- `maxDepth`: 50
- `timeBudgetFastMs`: 5000 ms
- `timeBudgetOptimalMs`: 60000 ms
- `transpositionMaxEntries`: (default)
- `mode`: goldfish (single-player), DFS algorithm

Run on Windows 10 Pro, OCGCore v11.0 (`@n1xx1/ocgcore-wasm` v0.1.1), node v22.21.1.

### 1.4 What this spike deliberately does NOT measure

- **MCTS behavior** — DFS only; MCTS adds another failure axis (ranker vs
  rollout policy) that would confuse the signal on a 1-day spike.
- **Real wall-clock tuning** — budgets are the production defaults; no
  attempt to find an inflection point.
- **Top-K path diversity** — only the top-1 `mainPath` is captured. The
  `result.tree` has scored children but the current failure mode (score = 0-6)
  makes second-best paths uninformative.

---

## 2. Raw results — speed=fast (5000 ms budget)

| Fixture | wall | term. | nodes | depth | BFavg | BFmax | forks | mean fork | **fork %** | score | mainPath | matched/expected | missing tagged / untagged |
|---------|------|-------|-------|-------|-------|-------|-------|-----------|-----------|-------|----------|------------------|---------------------------|
| D/D/D | 4289 ms | **timeout** | 77 | 15 / 50 | 1.93 | 17 | 76 | 50.79 ms | **90.0 %** | 0 | 7 | **0/5** | 0 / 5 |
| Mitsurugi | 4264 ms | **timeout** | 77 | 9 / 50 | 3.14 | 15 | 76 | 50.88 ms | **90.7 %** | 0 | 3 | **0/6** | 0 / 6 |
| Branded Dracotail | 4304 ms | **timeout** | 82 | 3 / 50 | 2.85 | 13 | 81 | 48.06 ms | **90.4 %** | 0 | 3 | **0/6** | 0 / 6 |

Fork cost histograms (speed=fast):

| Fixture | <1ms | 1-5ms | 5-10ms | 10-20ms | 20-50ms | 50ms+ |
|---------|------|-------|--------|---------|---------|-------|
| D/D/D | 0 | 0 | 0 | 0 | 48 | 28 |
| Mitsurugi | 0 | 0 | 0 | 0 | 43 | 33 |
| Branded Dracotail | 0 | 0 | 0 | 0 | 67 | 14 |

**Not a single fork under 20 ms.** The adapter's fork-via-replay cost floor
on meta decks is effectively 20-50 ms regardless of fixture, and a
significant long-tail in the 50 ms+ bucket (18-43 % of forks).

---

## 3. Raw results — speed=optimal (60000 ms budget)

| Fixture | wall | term. | nodes | depth | BFavg | BFmax | forks | mean fork | **fork %** | score | mainPath | matched/expected |
|---------|------|-------|-------|-------|-------|-------|-------|-----------|-----------|-------|----------|------------------|
| D/D/D | 28 800 ms | completed | 539 | 31 / 50 | 1.72 | 17 | 538 | 48.47 ms | **90.5 %** | 1 | 24 | **0/5** |
| Mitsurugi | 15 583 ms | completed | 294 | 11 / 50 | 3.21 | 18 | 293 | 48.37 ms | **91.0 %** | 1 | 11 | **0/6** |
| Branded Dracotail | 28 193 ms | completed | 515 | 11 / 50 | 3.03 | 15 | 514 | 49.76 ms | **90.7 %** | 6 | 10 | **0/6** |

### 3.1 Score breakdowns at optimal

| Fixture | total | weighted | fallbackPoints | dominant field(s) |
|---------|-------|----------|----------------|-------------------|
| D/D/D | 1 | 0 | 1 | `fallbackPoints=1` — a D/D Scale Surveyor credited as "untagged face-up monster" |
| Mitsurugi | 1 | 0 | 1 | `fallbackPoints=1` — a Mitsurugi no Mikoto Saji credited as untagged face-up monster |
| Branded Dracotail | 6 | 6 | 0 | `bounce=1` × weight 6 — ONE tagged bounce effect. Credit is real but the resulting endboard is a single Rindbrumm the Striking Dragon, not the Albion + Arthalion + Ecclesia line expected |

### 3.2 Main-path first actions (speed=optimal)

- **D/D/D**: `Mulcharmy Fuwalos, Mulcharmy Fuwalos, (pass), (pass), ...` —
  the "mainPath" is the solver activating the handtrap twice at the
  turn-start chain window and never reaching Main Phase.
- **Mitsurugi**: same pattern — `Mulcharmy Fuwalos, Mulcharmy Fuwalos, (pass), ...`
- **Branded Dracotail**: `Branded Fusion, Branded Fusion, Dracotail Faimena, (pass), Branded Fusion` — this fixture is the **only one** of the three where the solver actually summons through the opener. It finds a shallow line (depth 11) that bounces once, scores 6, and stops.

### 3.3 What "completed" means at optimal

For D/D/D, Mitsurugi, and Branded Dracotail at 60 s budget the termination
reason is `completed` — **NOT `timeout`**. The solver did not run out of
time: it ran out of things the current scorer rewarded. Reached leaves
scored ≤6; no positive-score IDLECMD transpositions existed to cache; no
unexplored sibling had a reachable score above `bestScore`. The search
collapsed on a local optimum because **the compass is blind**.

Mitsurugi in particular wraps up in 15.6 s out of 60 s — it doesn't even
need the full optimal budget to exhaust its reachable space. More time
would change nothing.

---

## 4. Observations

### 4.1 Fork cost: dominant, invariant, and 3-5× worse than the doc estimate

Across all 6 runs (3 fixtures × 2 speeds), fork time as a fraction of wall
clock is **89.7 %, 90.0 %, 90.4 %, 90.5 %, 90.7 %, 91.0 %**. This is not
just "dominant", this is *total*. Every other cost is noise — scoring is
<0.1 %, applyAction is <0.1 %, enumeration / hashing / bookkeeping fit in
the remaining ~9 %.

Mean fork time per call: **48-51 ms**. The research doc
[technical-solver-fork-cost-resolution-research-2026-04-13.md](technical-solver-fork-cost-resolution-research-2026-04-13.md)
estimated 10-17 ms from prior observation. Empirically the cost is 3-5×
worse on meta decks. The histogram confirms the "scales linearly with path
length" hypothesis — 14-43 % of forks fall in the 50 ms+ bucket on the
deeper searches. No forks land below 20 ms on meta decks, so there is no
cheap-fork regime to discover.

**Math of the ceiling:**
- 5000 ms fast budget ÷ 50 ms/fork = **100 forks / solve**
- 60000 ms optimal budget ÷ 50 ms/fork = **1200 forks / solve**
- Observed: 76-82 forks at fast, 293-538 at optimal. The budget is spent
  almost exclusively on fork replay.

Meta combos are 15-25 actions deep with branching factor 5-17 at IDLECMD
prompts. At fast budget, the solver cannot cover even a single branch
exhaustively past depth 5-6. At optimal budget, the solver's reach is
still an order of magnitude short of a reasonable combo tree. **The node
budget constraint (1.1) is a fiction — the physical constraint is
1.3, and 1.1/1.2 inherit their tightness from it.**

### 4.2 Scorer coverage: 17 of 17 expected endboard cards are untagged

The diff (expected vs actual) is unanimous and exhaustive:

| Fixture | missing cards | in interruption-tags.json |
|---------|---------------|---------------------------|
| D/D/D | 5 | **0** |
| Mitsurugi | 6 | **0** |
| Branded Dracotail | 6 | **0** |

Every single card that a human-curated `expectedBoard` lists for a meta
endboard on these three decks is **absent** from the 171-entry
`interruption-tags.json`. D/D/D boss monsters (Wave High King Caesar, Sky
King Zeus Ragnarok, Cursed King Siegfried), Mitsurugi boss monsters
(Futsu no Mitama, Number 90 Galaxy-Eyes Photon Lord), Dracotail Link/Xyz
(Arthalion, Ecclesia and the Dark Dragon) — none are known to the scorer.

This means the solver has **no way** to prefer a meta endboard over a
random setup, regardless of how much search budget it has. Even if fork
cost were free and the ranker were perfect, the solver would converge on
whatever leaf happens to have one tagged bounce effect (Branded's score=6
case) over a proper omninegate board (would score 14+ if Arthalion or
Ecclesia were tagged).

This is nominally "constraint 2.2 scorer fidelity" (weight calibration) but
empirically it is **data coverage**, not weights. The doc ranks 4.1 data
coverage as 🟢 Low severity; the empirical observation is that 4.1 and 2.2
are the same problem on meta decks, and together they rank 🔴 Blocking.

The 2.3 "latent interruption modeling" constraint (wake-up patterns like
Faimena → Guramel) is a *further* layer beyond this that cannot even be
assessed until direct-value tags cover the boss monsters themselves.

### 4.3 Move ordering: unmeasurable at the current depth

The harness saw `averageBranchingFactor` of 1.72-3.21 across runs with a
maximum BF of 13-18. The averages are **suppressed** because DFS spends
most nodes at SELECT_CHAIN / SELECT_YESNO / SELECT_EFFECTYN prompts where
the legal action count is 2-3 (activate/pass or yes/no). The real test of
move ordering — `SELECT_IDLECMD` with 15-17 candidate actions and the
solver having to pick the "right one" first — barely fires.

D/D/D and Mitsurugi at optimal reach depths 11-31, but the
`mainPath` first actions reveal the search is still stuck on the turn-start
handtrap chain, never entering Main Phase. Only Branded Dracotail crosses
into main-phase summons (Branded Fusion → Faimena) and hits depth 11 before
the shallow scorer gives up.

**Verdict:** constraint 2.1 move ordering cannot be validated or invalidated
on this data. **The search doesn't get far enough for the ranker's choices
to matter.** Fixing fork cost (1.3) and scorer coverage (2.2/2.3 data-side)
is a *prerequisite* to measuring ranker quality empirically.

### 4.4 The "completed" false positive at optimal

At optimal budget, all three fixtures terminate with reason `completed`,
not `timeout`. This is misleading to a casual reader: it suggests the
search successfully exhausted its relevant state space. Empirically, the
search exhausted the space *the scorer rewards*, which is a much smaller
space than the space of combo lines. Mitsurugi wrapping up in 15.6 s out
of 60 s is the cleanest signal — the solver literally cannot find anything
worth exploring.

This reinforces 4.2: the scorer's "compass" direction is what caps
effective reach, not the budget.

### 4.5 Transposition table is doing nothing useful

TT hit rates on all runs are 0.00 %: the table gates at `SELECT_IDLECMD`
only (to avoid chain-window hash collisions per the existing comment at
[dfs-solver.ts:255](../../../duel-server/src/solver/dfs-solver.ts#L255)),
and D/D/D + Mitsurugi never reach IDLECMD, so nothing is ever stored.
Branded Dracotail reaches IDLECMD but the scored states are not visited
enough times to produce cache hits within the 60 s budget.

Not a new constraint — this is the existing 3.1 "observed state
completeness" gap manifesting. Noted for completeness. **No action.**

---

## 5. What this means for the 3 technical research docs

The three research docs under review are:

1. [technical-solver-fork-cost-resolution-research-2026-04-13.md](technical-solver-fork-cost-resolution-research-2026-04-13.md) — WASM snapshot cache + replay cache, 5.5-11 weeks
2. [technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md](technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md) — pre-DL scorer extension, 6-11 weeks
3. [technical-solver-move-ordering-research-2026-04-13.md](technical-solver-move-ordering-research-2026-04-13.md) — composite ranker, 4.5-8 weeks

### 5.1 Validation per doc

| Doc | Mapped constraint | Empirically confirmed? | Notes |
|-----|-------------------|-----------------------|-------|
| Fork cost resolution | 1.3 | **Yes — and more severe than estimated** | 50 ms/fork observed vs 10-17 ms in the doc. Every other improvement is gated on this. |
| Pre-DL latent board value | 2.3 (+ implicitly 2.2, 4.1) | **Yes — critical** | 17/17 expected endboard cards are untagged. But the immediate gap is not latent modeling — it is **direct-value coverage** of meta bosses. Extending 171-card tags to ~500 meta cards is a smaller, earlier step than building a latent simulator. |
| Move ordering | 2.1 | **Deferred — unobservable on current data** | Ranker improvements cannot be measured while the search never reaches IDLECMD depth 2+. This doc cannot be validated empirically until 1.3 and 2.2-coverage land. |

### 5.2 Sequencing implication (NOT the same as the research doc's "joint execution")

The research docs proposed **12-18 weeks joint execution** with deck seed
determinism (3.3) as the only shared prerequisite. Determinism shipped
yesterday (commit b60cfc2d); we are now unblocked on the spine.

The empirical data argues for a **sequenced execution with the first two
in parallel, the third deferred**:

1. **Phase A (parallel, weeks 1-6)**:
   - **Fork cost** (research doc 1) — must land first or the other work cannot be measured
   - **Scorer data coverage** — NOT the latent modeling research as scoped, but a
     narrower first pass: expand `interruption-tags.json` from 171 to the
     boss monsters + key interruption cards of the top 10 meta decks. This
     is LLM-assisted (per the existing
     `_bmad-output/solver-data/interruption-tag-generation-prompt.md`
     workflow) and is probably a fraction of the 6-11 weeks the pre-DL
     research estimates because latent modeling is a v2 on top of basic
     coverage. **Delivers a working compass before latent modeling even
     starts.**
2. **Phase B (weeks 6-12)**:
   - **Pre-DL latent modeling** (research doc 2) — becomes tractable once
     direct value is credited for boss monsters. Wake-up patterns (Faimena
     → Guramel) are an *additional* reward on top of a functional baseline,
     not the baseline.
3. **Phase C (weeks 12-18)**:
   - **Move ordering** (research doc 3) — the ranker can now be tuned
     against a search that actually reaches IDLECMD branching points. Without
     Phase A, every ranker benchmark would measure noise.

The original doc's "mutually reinforcing" framing is correct, but the
sequence matters because Phase B and C cannot produce measurable progress
until Phase A is done.

### 5.3 A new first-week task not in any of the three docs

**Expand the `interruption-tags.json` coverage** for the three validation
fixtures' expected endboards before anything else. That is 17 cards. It
unblocks the empirical measurement of every subsequent improvement: once
those cards score real values, rerun this harness and you can see whether
better fork cost alone (or better ranker alone) moves the matched/expected
ratio. Without this, every future run will also score the expected endboards
as 0 and we will not be able to tell if we are making progress.

This is a sub-day effort (17 oracle-text lookups via the existing
`db.ygoprodeck.com` workflow) and is the cheapest gain on the board.

---

## 6. Conclusion

### 6.1 Actionable verdict

**The three top blockers are empirically confirmed as real, but the
severity and sequencing differ from the constraints doc:**

1. **1.3 fork cost** — confirmed 🔴 Blocking, and **3-5× worse than estimated**.
   Must ship first; every other improvement is masked by it.
2. **2.2 scorer fidelity (data coverage subset)** — confirmed 🔴 Blocking,
   and **underestimated** in the constraints doc (ranked 🟠 High). The issue
   is not weight calibration, it is that 171 tagged cards do not cover a
   single meta boss monster.
3. **2.3 latent modeling** — confirmed 🔴 Blocking conceptually but
   **premature**: it is a v2 layer on top of basic tag coverage. Attempting
   it before 2.2 is solved would build sophisticated wake-up scoring on a
   scorer that cannot rate the *direct* value of its own boss monsters.
4. **2.1 move ordering** — confirmed 🔴 Blocking in the doc but **empirically
   unmeasurable** on current data. Deferred until Phase A lands.

### 6.2 Should we commit to the 12-18 week joint execution?

**Not as written.** Commit instead to:

**Phase A (6 weeks, parallel)**:
- Research doc 1 (fork cost) at full scope
- A **scoped-down first pass** of research doc 2 — direct-value tag
  coverage for meta decks (17 cards minimum for the validation fixtures,
  ~300-500 for top 10 meta coverage). Defer latent modeling to Phase B.

**Gate decision at end of Phase A:** rerun this spike. If fork% drops
below 30 % and matched/expected ratio improves even partially, Phase A
worked and we continue. If fork% is still >60 % or matched stays at 0,
the snapshot cache did not deliver and we debug before investing Phase B/C.

**Phase B (4-6 weeks)**:
- Research doc 2 remainder (latent modeling)
- Empirically measurable now

**Phase C (4-8 weeks)**:
- Research doc 3 (move ordering), empirically measurable now

### 6.3 Pre-Phase A quick win (this week)

Add the 17 expected-board cards to `interruption-tags.json`. Rerun this
spike. If matched/expected jumps to non-zero, we have a **baseline** to
measure every subsequent improvement against. If it stays at zero, we
have isolated a *distinct* failure — the solver does not even produce
the right cards on the field, independent of scoring, which would flag
a deeper issue in the DFS logic itself that none of the three research
docs address.

### 6.4 Reproducing this measurement

```bash
cd duel-server
# Fast (5 s budget per fixture, ~15 s total)
SOLVER_INSTRUMENT=1 npx tsx scripts/spike-empirical-validation.ts --speed=fast
# Optimal (60 s budget per fixture, ~75 s total)
SOLVER_INSTRUMENT=1 npx tsx scripts/spike-empirical-validation.ts --speed=optimal
# Single fixture
SOLVER_INSTRUMENT=1 npx tsx scripts/spike-empirical-validation.ts --hand=branded-dracotail-opener --speed=optimal
```

The instrumentation module is a no-op when the env var is absent, so it is
safe to leave in tree.

---

## 7. Post-scriptum — Quick-win iterations (same day)

The pre-Phase A quick win from §6.3 was executed in two rounds. The first
round (tag expansion alone) produced a misleading result that was
debugged in round two via a methodology audit. The final clean measurement
is in §7.5. Read §7.1-§7.4 for how we got there.

## 7.0 Round 1 — Tag expansion results

The pre-Phase A quick win from §6.3 was executed immediately after the
initial measurement. Fourteen new entries were added to
[interruption-tags.json](../../../duel-server/data/interruption-tags.json)
(171 → 185), covering 14 of the 17 expected-board cards across the three
fixtures. Three cards returned `null` per the classifier rules:

- **Ryzeal Duo Drive** — own-team ATK buff + search, zero interruption
- **Futsu no Mitama no Mitsurugi** — revive on opponent SS, not disruption
- **Dracotail Faimena** — latent wake-up (constraint 2.3 territory); its
  direct effect is a combo-enabling Fusion Summon, no direct interruption

Raw artifacts:
- `empirical-validation-2026-04-13-post-tags-fast-raw.json`
- `empirical-validation-2026-04-13-post-tags-optimal-raw.json`

### 7.1 Delta vs. pre-tag baseline (speed=optimal, 60 s budget)

| Fixture | score (pre → post) | wall (pre → post) | nodes (pre → post) | depth (pre → post) | matched/expected |
|---------|---|---|---|---|---|
| D/D/D | 1 → **9** | 28.8 s → 28.7 s | 539 → 534 | 31 → 31 | 0/5 → **0/5** |
| Mitsurugi | 1 → **15** | 15.6 s → 15.8 s | 294 → 294 | 11 → 11 | 0/6 → **0/6** |
| Branded Dracotail | 6 → **24** | 28.2 s → **4.4 s** | 515 → **83** | 11 → 9 | 0/6 → **0/6** |

**Scores rose meaningfully (0-6 → 9-24), but `matched/expected` stayed at
0/17 across all three fixtures.** The quick-win gave the scorer a working
compass on the data-coverage axis without producing a single correctly-reached
expected endboard card.

### 7.2 The new failure mode this exposed

Inspecting the post-tag `scoreBreakdown` + `mainPath` for each fixture
shows a pattern none of the three research docs anticipated:

- **D/D/D** — score=9, breakdown=`{controlChange: 1, fallback: 1}`. The
  controlChange credit comes from D/D/D Headhunt **sitting in the starting
  hand** (never activated). MainPath: `[Fuwalos, Fuwalos, (pass)..., Savant
  Kepler, (pass)...]` — unchanged depth-24 walk that still doesn't assemble
  a board. Score rose purely from accounting for a drawn card.
- **Mitsurugi** — score=15, breakdown=`{omniNegate: 1, fallback: 1}`.
  The omniNegate credit (weight 14) comes from **Mitsurugi Great Purification
  in the starting hand**. Same 11-depth walk, same stuck-in-chain behavior.
  Score rose from a drawn handtrap.
- **Branded Dracotail** — score=24, breakdown=`{typedNegate: 1, banish: 1,
  bounce: 1}`. All three credits come from **Dracotail Flame + Sting + Horn
  in the starting hand** (they were drawn). MainPath: `[Dracotail Lukias,
  (pass), (pass)]` — **the solver abandoned the Branded Fusion combo line
  it was exploring pre-tags**. Elapsed time dropped from 28.2 s to 4.4 s;
  `completed` in both runs but for opposite reasons.

**The scorer is double-counting "interruption value I drew" as equivalent to
"interruption value I built"**. For Branded Dracotail, pre-tags the solver
was spending its 60 s budget exploring depth-11 Branded Fusion lines for a
Rindbrumm bounce (score 6). Post-tags, the same solver stops exploring at
depth 9 because the three starting-hand traps already score 24 — and no
additional summon it can reach in-budget beats that baseline. Branded's
quick-win is a **genuine regression in search depth and duration**, driven
by a scorer that over-rewards opening-hand composition.

### 7.3 What the quick-win actually proved

1. **Data coverage is a real bottleneck** (§4.2 still holds): previously
   invisible cards are now credited, and scores moved meaningfully upward
   on all three fixtures.
2. **Data coverage alone is insufficient** (new finding): without a
   discounting mechanism for HAND-zone tagged cards, coverage expansion
   creates a local-minimum where "pass and score your drawn traps" dominates
   any combo line the solver can reach in-budget.
3. **Fork cost remains the dominant blocker** (§4.1 still holds): on
   D/D/D and Mitsurugi the search behavior did not change at all — same
   depth, same node count, same stuck-in-chain-window pattern. Tag
   coverage cannot rescue reach.
4. **The expected endboards remain unreachable**: matched/expected stayed
   at 0/17 across all three fixtures. This is the single most important
   finding. **The quick-win validates that tagging is necessary but not
   sufficient** — the solver still does not reach the combos the fixtures
   were built to validate.

### 7.4 A fourth constraint surfaced by the quick-win

The research docs and [solver-structural-constraints.md](solver-structural-constraints.md)
do not separately enumerate this:

- **2.2b — Zone-weighted scoring / earned-vs-drawn distinction.** Tagged
  cards in the HAND zone should be weighted lower than on-field cards,
  OR the scorer should distinguish "drawn at open" from "added during
  combo" via the activation log. Without this, any tag-coverage expansion
  creates a scorer that rewards drawing a trap-loaded hand and punishes
  executing a combo.

This is adjacent to constraint 2.2 "scorer fidelity" but specifically
scoped: it is a structural weighting issue, not a weight calibration
issue. It requires either a fixed per-zone multiplier (simple) or
engagement with the activation log to separate earned from drawn
(requires solver-side plumbing, moderate).

**Sub-day fix candidate:** apply a HAND-zone multiplier (e.g. 0.25×) in
`InterruptionScorer.scoreWithCards()`. Rerun the spike. Expectation: the
Branded Dracotail regression reverses (search duration returns to the
pre-tag 28 s, score re-attaches to earned combo execution). If matched
stays 0, fork cost is definitively isolated as the remaining blocker.

### 7.4 Round 1 recommendation (SUPERSEDED — see §7.5-§7.6)

Round 1 proposed a new workstream "2.2b HAND-zone weighting / earned-vs-drawn
scoring". **This was a wrong diagnosis — see §7.5.** The symptom was a
real scorer regression but the root cause was a methodology bug in the
test fixture setup, not a scorer fidelity problem.

---

## 7.5 Round 2 — Methodology audit + the real root cause

On closer inspection, the Branded "regression" in round 1 did not make
sense under the user's sanity check: *if the hand already has all the
interruption value it needs, the solver should* still *try to exceed it
via combo execution, because a real Branded endboard produces ~3× more
interruption value than the 24 points credited to three trap cards in
hand*. The solver stopping at 24 suggested either (a) the scorer was
locally correct but the search couldn't reach a better terminal, or
(b) the solver was reporting pre-existing value as if it were earned.

To discriminate (a) from (b), the spike was extended with a **baseline
measurement**: before calling `dfs.solve()`, capture the field state and
compute `baselineScore = scorer.scoreWithCards(initialFieldState)`. Then
`deltaScore = finalScore - baselineScore` isolates what the solver
actually **earned** during execution.

This decomposition immediately exposed a methodology bug unrelated to
the solver itself: **`baselineScore = 24` and `handSize = 10`** on
Branded — not the 5-card starting hand the fixture specified.

### 7.5.1 The 10-card hand bug

`OCGCoreAdapter.createNativeDuel` hardcoded
`team1: { startingDrawCount: 5, drawCountPerTurn: 1 }`. The fixture loader
then pushed the 5 `config.hand` cards into the HAND zone via
`duelNewCard(location=HAND)`. When the duel started, OCGCore's
`startingDrawCount: 5` drew **five more cards** from the post-shuffle
DECK on top of those 5 — yielding a 10-card opening hand. Every prior
measurement in this document ran with a polluted 10-card hand, half of
it random draws from the meta deck.

For the three fixtures, those random draws happened to include:
- D/D/D: `D/D/D Headhunt` (1 copy, drawn)
- Mitsurugi: `Mitsurugi Great Purification` (1 copy, drawn)
- Branded Dracotail: `Dracotail Flame` + `Horn` + `Sting` (1 copy each, drawn together)

This fully explains the round-1 "hand pollution" pattern without any
scorer fix. It is not a scoring problem — it is a fixture setup
problem that was invisible until the new tags exposed it by assigning
non-zero score to the drawn cards.

### 7.5.2 The second bug: double `getLegalActions` call

The initial round-2 fix (`startingDrawCount: 0`) was set on the spike's
DuelConfig. On the next run, D/D/D and Mitsurugi produced clean baselines
(handSize=5, score=0) but **Branded Dracotail collapsed to
`nodes=1, depth=0, forks=0, mainPathLen=0`**, as if the solver saw zero
legal actions at the root.

Debugging showed that the spike was calling `adapter.getLegalActions`
twice on the same handle: once externally to capture the baseline, once
internally via `dfs.solve`. `runUntilPlayerPrompt` is not idempotent —
the second call progressed OCGCore's state machine past the first prompt
without a response having been set, and Branded's specific turn-start
sequence ended up at a state with no legal player actions. D/D/D and
Mitsurugi happened to be robust to the double call; Branded was not.

The fix was to drop the external `getLegalActions` entirely. Baseline is
now computed from `getFieldState()` alone (a pure `duelQueryLocation`
query that does not progress the engine). With `drawCountPerTurn: 0`
also set, HAND at this point is guaranteed to equal the fixture's
`hand` array exactly.

### 7.5.3 Code changes shipped

Two additions to `DuelConfig`, both optional and backward-compatible
(defaults preserve the production behavior):

- `startingDrawCount?: number` — overrides OCGCore's startingDrawCount.
  Default 5.
- `drawCountPerTurn?: number` — overrides OCGCore's drawCountPerTurn.
  Default 1.

The spike passes `0` for both. Production code paths (WS server,
solver worker, solver verifier, smoke tests) are unaffected — they do
not set the new fields, so OCGCore still uses `5` and `1`.

---

## 7.6 Round 2 — Clean delta results

### 7.6.1 Delta metric at speed=optimal (60 s budget)

Artifact: `empirical-validation-2026-04-13-clean-optimal-raw.json`

| Fixture | baseline | final score | **delta** | nodes | depth | forks | wall | term | matched atBaseline / earned / stillMissing |
|---------|----------|-------------|-----------|-------|-------|-------|------|------|--------------------------------------------|
| D/D/D | 0 | 1 | **+1** | 521 | 30/50 | 520 | 28.97 s | completed | 0 / 0 / 5 |
| Mitsurugi | 0 | 1 | **+1** | 89 | 11/50 | 88 | 5.13 s | completed | 0 / 0 / 6 |
| Branded Dracotail | 0 | 11 | **+11** | 131 | 13/50 | 130 | 6.96 s | completed | 0 / 0 / 6 |

Fork percentages of wall clock: **90.4 %, 90.9 %, 90.7 %** — invariant
from earlier rounds. The methodology fix did not move fork cost at all,
confirming §4.1's finding.

### 7.6.2 Delta metric at speed=fast (5 s budget)

Artifact: `empirical-validation-2026-04-13-clean-fast-raw.json`

| Fixture | baseline | final score | **delta** | nodes | depth | wall | term |
|---------|----------|-------------|-----------|-------|-------|------|------|
| D/D/D | 0 | 1 | +1 | 83 | 30/50 | 4.27 s | timeout |
| Mitsurugi | 0 | 1 | +1 | 85 | 11/50 | 4.28 s | timeout |
| Branded Dracotail | 0 | 0 | **+0** | 87 | 6/50 | 4.30 s | timeout |

Branded's +11 delta at optimal **disappears at fast**: with only 5 s
budget, the solver does not find the shallow fusion line at all, returning
score 0 and an empty endboard. Fork cost is why (5 s / 50 ms ≈ 100
forks max, and Branded needs at least ~130 forks to reach the 11-point
terminal as seen in the optimal run).

### 7.6.3 What the delta actually says

1. **Three fixtures, one of them earns anything.** Only Branded Dracotail
   produces a non-trivial delta (+11), and only at the 60 s budget. The
   +11 comes from one face-down tagged trap set during combo execution
   (Dracotail Flame typedNegate = 10) + one fallback monster (Secreterion
   Dragon = 1). This is the first empirical evidence that the solver's
   search machinery **can** execute a real combo fragment when
   (a) the baseline is not masked by pre-existing hand value, and
   (b) the budget is sufficient.

2. **D/D/D and Mitsurugi earn only +1 fallback**, not a real combo.
   Both reach IDLECMD prompts (mainPath length 24 and 7 respectively)
   but neither lands a *tagged* card on the board — only untagged
   monsters credited by the +1 fallback heuristic. The actions they
   explore are structurally failed combos, not passes.

3. **matched/expected stays at 0/17**. No fixture reaches a single
   expected endboard card. Branded's earned +11 comes from a
   **different** tagged card (Dracotail Flame set by the solver's
   chosen line) than any of the 6 expected cards listed in the golden.
   This tells us the solver is finding *a* combo, not *the* combo the
   human curator expected — and that distinction is independent of
   scorer fidelity since both are tagged.

4. **The original 2.1 move ordering hypothesis gets new weight.** The
   solver reached a 11-point terminal on Branded via what looks like a
   non-canonical combo line. With a better ranker it might have preferred
   the canonical Faimena → Arthalion path — but at 130 forks total, it
   had room to evaluate only a handful of top-level actions and picked
   one of them. This is weak but direct evidence that move ordering
   matters once the search can reach main-phase prompts at all.

5. **Fork cost is definitively isolated as the #1 blocker.** With a
   clean baseline and a working delta metric, the only remaining
   explanation for D/D/D earning just +1 at depth 30 is: *the solver
   cannot afford to explore any of the summon-heavy branches because
   each fork costs 50 ms and it only gets ~500 forks in the entire 60 s
   budget*. 500 forks are not enough to exhaust even a single
   10-wide × 5-deep exploration tree.

## 7.7 Revised recommendation (replaces §7.4)

The round-1 "Phase A workstream #3 = HAND-zone weighting" is **retracted**.
The scorer is not at fault; the fixture loader was. The fix has been
shipped via the new `startingDrawCount` / `drawCountPerTurn` fields and
used by the spike script. No production scorer changes are required.

The ORIGINAL §6.2 recommendation from the first measurement stands,
slightly simplified:

**Phase A (6 weeks, parallel)**:
1. **Fork cost** (research doc 1) — empirically confirmed as *the* blocker.
   Every other workstream is gated on this landing first.
2. **Direct-value tag coverage** (scoped subset of research doc 2) — the
   14-card quick win is a baseline, not a fix. Extending to the top
   ~300-500 meta cards remains required for Phase B measurability.
   **Round 1's failure mode is NOT a reason to gate this work** — it was
   a fixture bug, not a coverage bug.

**Phase B (4-6 weeks)** — Latent interruption modeling (research doc 2
remainder). Empirically measurable once Phase A has landed.

**Phase C (4-8 weeks)** — Move ordering (research doc 3). §7.6.3 point 4
adds weak but direct evidence that this matters; it remains
sequencing-gated behind Phase A.

**Gate at end of Phase A** (rerun this spike):
- `forkPctOfWall < 30 %` (currently 90 %)
- `delta > 0` on at least 2 of 3 fixtures at fast budget
- `earned > 0` on at least 1 of 3 fixtures at optimal budget
- The fixture hand / draw config changes shipped in §7.5.3 stay in the
  spike (not reverted).

## 7.8 Takeaway for the spike methodology itself

The 10-card hand bug was invisible for the entire history of the solver's
v1 development and validation. It was never caught because:
1. Nobody scored a fresh-duel baseline explicitly — the scorer was only
   invoked on terminals reached through the solver, and terminals were
   already mid-turn.
2. The 5-extra cards looked "right" for a 10-card hand in a live game,
   and post-draw hand sizes were never checked against the intended
   opener.
3. Pre-tag scoring was 0 for every hand card anyway, so the drawn
   cards contributed nothing observable.

The new `startingDrawCount` / `drawCountPerTurn` overrides in DuelConfig
should be used by **any** future test harness or regression fixture
that wants deterministic opening conditions. The spike does not need
special-case hacks — it just sets both to 0 in its DuelConfig
construction.

---

## Appendix A — Fixture failure pattern table

| Fixture | Pattern | Why it fails |
|---------|---------|-------------|
| D/D/D | **Stuck in turn-start chain window** | `mainPath=[Fuwalos, Fuwalos, pass, ...]`. At depth 31 (optimal) the solver still has not Normal Summoned Savant Kepler. Fork cost exhausts the chain-window exploration before any IDLECMD alternative is tried. |
| Mitsurugi | **Stuck in turn-start chain window** | Same pattern. `completed` at 15.6 s because the chain window's reachable state space is small and exhausted quickly — the solver confirms its 1-point fallback terminal is the best available under the current scorer and exits. |
| Branded Dracotail | **Reaches Main Phase, shallow interruption win** | Only fixture that actually summons (`Branded Fusion, Faimena, Branded Fusion`). Finds a leaf with one bounce effect (Rindbrumm → score 6) and stops. The real combo (depth ~20) is never attempted because the ranker has no reason to prefer the Albion path. |
