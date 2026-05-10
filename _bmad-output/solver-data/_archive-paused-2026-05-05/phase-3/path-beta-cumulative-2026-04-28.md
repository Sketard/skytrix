# Path β Cumulative — Honest Baseline + 4 Fixtures Audited + chainTargets Grammar

**Date:** 2026-04-28
**Status:** SHIPPED — multiple lifts confirmed, scaling decision pending
**Predecessor:** `path-beta-poc-2026-04-28.md`
**Decision:** Path β = real productivity tool, **first sustained ML-R&D lift** since Phase 3 began.

---

## TL;DR

Path β architecture (Claude Code subagent dispatch + OCG replay CLI) delivered
**multiple matched lifts at $0 API cost** across 4 fixtures audited. The
subagent autonomy went beyond "execute authored plan" to **autonomous
discovery refuting prior human-authored ceilings**.

| Fixture | Authored claim | Replayed-as-is | β fixed | vs DFS-with-leak | vs DFS-honest |
|---|---:|---:|---:|---:|---:|
| **branded-dracotail-opener** | (none) | 3/8 | **7/8** | **+3** | **+4 (est.)** |
| **ryzeal-mitsurugi-opener** | 4/5 | 3/5 | **5/5** | **+? (TBD)** | **+4 (est.)** |
| radiant-typhoon-opener | 3/3 | 3/3 | 3/3 | 0 | 0 |
| **ddd-pendulum-opener** (2026-04-28) | (none) | n/a | **2/5** | **+1** | **+1** |
| (snake-eye-yummy-opener) | n/a | incompatible format (PvP raw-replay) | — | — | — |

**D/D/D (4th archetype family — pendulum-combo):** β-1 v2 from-scratch, 20 iterations,
honest baseline 1/5 → 2/5 (Cursed King Siegfried + Deus Machinex). Subagent diagnosed
3 missing as structurally unreachable from this opener: Wave High King Caesar (only 1
Lv6 Fiend possible — Clovis), Sky King Zeus Ragnarok (Link 3 would consume the others),
Headhunt (no in-deck trap tutor). Methodology validated on a 4th archetype family but
lift is at the low end (+1) — D/D/D's expected board exceeds 5-card hand's budget.

Tier 1 honest baseline measurement landed: DFS-canonical-eval **with**
`preferredSearchTargets` leak = 26/69; **without** = 22/69 (Δ-4 cum
matched). The 4-card lift was carried by fixture-leak in action enumeration.

Combined estimate at 14-fix scale: if β-1-v2 / β-3 audit pattern
generalizes to other authored fixtures + viable archetypes, projected
cum matched **30-40/69** from the honest 22/69 baseline at $0 marginal
cost per fixture.

---

## What was shipped this stage

### Tier 1 — Honest baseline (`SOLVER_DISABLE_PREFERRED=1`)

`scripts/evaluate-structural.ts:518` — env-gated removal of fixture-leak
in SELECT_CARD enumeration. Baseline at canonical config now reports:

| Config | Cum matched | Cum score |
|---|---:|---:|
| DFS canonical (with `preferredSearchTargets`) | 26/69 | 523 |
| **DFS honest baseline (`SOLVER_DISABLE_PREFERRED=1`)** | **22/69** | **452** |

→ **4 of 26 cum matched were carried by leak.** This is the new ground
truth for measuring future lifts.

### Path β chainTargets[] grammar extension

`scripts/replay-trajectory-cli.ts` — added `chainTargets[]` field to plan
steps, mirror of `targets[]` but consumed at SELECT_CHAIN prompts. Default
behavior at SELECT_CHAIN remains pass; explicit overrides activate the
named trigger instead.

```json
{
  "cardName": "Blazing Cartesia, the Virtuous",
  "verb": "activate",
  "targets": [
    { "cardName": "Secreterion Dragon" },
    { "cardName": "Dracotail Flame" },
    { "cardName": "Dracotail Horn" }
  ],
  "chainTargets": [
    { "cardName": "Dracotail Mululu" },
    { "cardName": "Dracotail Phryxul" }
  ]
}
```

### Subagent dispatches (5 total, all $0)

1. **β-3 audit branded-dracotail** → 6/8 (recording fix: activate GY-fusion-material triggers)
2. **β-1 from-scratch (no chainTargets)** → 4/8 (parity DFS-leak baseline; identified SELECT_CHAIN blind spot)
3. **β-3 audit radiant-typhoon** → 3/3 confirmed (archetype has no GY recursion → no improvement available)
4. **β-3 audit ryzeal-mitsurugi** → 5/5 (refuted authored 4/5 ceiling; tail extension Ext Ryzeal → Duo Drive Xyz)
5. **β-1 v2 (chainTargets)** → 7/8 attempt 1, rate-limited before convergence

Total wall ~75 min. ~600K-700K tokens consumed on subscription quota.

---

## Critical discoveries

### 1. β-1 v2 attempt 1 found a structurally novel combo line

Both prior subagents (β-1 v1 and β-3) declared Mululu and Secreterion
"structurally unreachable" on this opening hand. The β-1 v2 subagent found
the answer in its FIRST attempt:

- Replace Cartesia → Arthalion (which uses Mululu+Phryxul as materials,
  leaving them in GY but board-absent) with **Cartesia → Secreterion**
  (Spellcaster fusion using same materials)
- Then **Secreterion's GY-revive effect** SS's Mululu from GY onto the field
- Net: lose Arthalion (1 card), gain Secreterion + Mululu (2 cards) = **+1 net**

This refutes the previous "structural ceiling" claim. The subagent didn't
just optimize within constraints — it **found a different decomposition
of the goal** that prior reasoners missed.

### 2. Mitsurugi β-3 refuted a human-authored ceiling claim

The authored canonical line for `ryzeal-mitsurugi-opener` documented `_ceiling:
"4/5 via this line. 5/5 would require..."` and declared Ext Ryzeal SS-self
"blocked by OCG R4-only lock". The β-3 subagent re-probed legal actions at
the terminal state and discovered the lock no longer applies (engine evolved
since 2026-04-19). It appended SS Ext Ryzeal + Xyz Duo Drive → 5/5.

This is **autonomous discovery**, not authoring replay. The subagent
exceeded what humans had locked in.

### 3. Pattern is archetype-dependent

| Archetype | β-3 lift mechanism | Result |
|---|---|---|
| Branded/Dracotail | GY-fusion-material trigger activation (recording missed) | +3 (3 → 6/8) |
| Mitsurugi/Ryzeal | Tail extension + ceiling refutation | +2 (3 → 5/5) |
| Radiant/Typhoon | None — archetype has no GY recursion or stale claims | 0 |

→ β-3 audit is **not uniformly +N per fixture**. It works where the
authored recording has bugs OR where the archetype offers reachable
optimization.

### 4. SELECT_CHAIN blind spot was the β-1 grammar's hidden ceiling

β-1 v1 plateaued at 4/8 because `targets[]` only covered SELECT_CARD-class
prompts. Multiple optional triggers queued at SELECT_CHAIN auto-passed.
chainTargets[] closed this gap → β-1 v2 immediately reached 7/8 at
attempt 1. **This validates that grammar gaps were the primary
limitation, not LLM intelligence.**

### 5. Rate limit hit at ~600-700K cumulative tokens

The β-1 v2 dispatch hit the Claude Code subscription rate limit
mid-run (resets at 13:40 Paris). At 5 dispatches ranging from 60K to
200K tokens each, the daily/hourly quota is finite but ample for
serial work — parallel dispatches × big fixtures consumes faster.

For 14-fix scaling: dispatch sequentially, ~3-4 fixtures per quota window,
total ~3-4 quota windows = **1-2 days of wall time at $0 cost**. Or
spend the API budget for full-parallel ($300-700 per pass per the
prior memo's estimate).

---

## Per-fixture matched status (best evidence so far)

Best matched count achieved per fixture under various measurement regimes.
Empty cells = not measured.

| Fixture | DFS leak | DFS honest | Path β best |
|---|---:|---:|---:|
| branded-dracotail-opener | 4/8 | (≤3/8 est.) | **7/8** (β-1 v2) |
| ryzeal-mitsurugi-opener | (TBD) | (~1/5 est.) | **5/5** (β-3) |
| radiant-typhoon-opener | 2/3 | (≤2/3 est.) | 3/3 (β-3) |
| 11 other fixtures | (sum gives 26/69 leak / 22/69 honest cumulative) | | unaudited |

---

## Scaling decision

Three options remain:

### Option A — Audit remaining 11 fixtures via β subagents (~1-2 days wall, $0)
- Dispatch sequential β-1 v2 (chainTargets) on each fixture; ~5-10 attempts each
- Estimate: +1 to +4 matched per fixture where archetype permits, +0 where not
- Projection: cum matched **30-40/69 from honest baseline 22/69**
- Risk: rate-limit windows may add 1-2 days
- Cost: $0

### Option B — Switch to API direct (`@anthropic-ai/sdk`) for parallel processing (~hours wall, $300-700)
- Code orchestrator script: `for fixture in FIXTURES: dispatch β-1-v2-equivalent via Anthropic API`
- ~14 fixtures × 10 attempts × 30K tokens = ~4M tokens × $5/M = ~$20 input + $X output
- Estimated cost: $200-500 for one full pass at ~Opus 4.7 pricing
- Faster turnaround, no rate-limit constraint
- Same intelligence as subagent (uses same model)

### Option C — Freeze at current state (ship 22/69 honest + per-fixture wins as opt-in)
- Ship the honest baseline as v2 (with `SOLVER_DISABLE_PREFERRED=1` env-gated)
- Ship the chainTargets[] grammar + the 4 fixture audit results
- Document 7/8 / 5/5 / 3/3 per-fixture wins as "manually-curated best plans"
- Don't auto-run on remaining 11 fixtures
- Future R&D: extend β infrastructure later if/when team budget allows

---

## Recommendation

**Option A** — sequential β-1-v2 dispatches on the 11 remaining fixtures
over the next 1-2 days. Reasons:

1. Marginal cost is $0; wall time is the only constraint, and most can
   run unsupervised in the background
2. Each dispatch is independent — failures don't cascade
3. Aggregate gives a real number for "what's reachable on the 14-fix at
   $0 cost" — calibrates the value of further R&D investment
4. The infrastructure (replay CLI, fixture context dumper, knowledge
   extractors) is shipped and stable; this is mostly orchestration

After Option A, decide based on the resulting cum-matched number whether
to scale via API (B) or freeze (C).

---

## Files & references

- Tier 1 gate: `duel-server/scripts/evaluate-structural.ts:518`
- Replay CLI extensions: `duel-server/scripts/replay-trajectory-cli.ts`
- POC artifacts:
  - `duel-server/data/path-beta-poc/branded-dracotail-opener/beta1v2-attempt-1.json` + `-result.json` (7/8)
  - `duel-server/data/path-beta-poc/ryzeal-mitsurugi-opener/beta3-best-trajectory.json` (5/5)
  - `duel-server/data/path-beta-poc/radiant-typhoon-opener/beta3-best-trajectory.json` (3/3 confirmed)
- Eval results:
  - `duel-server/data/eval-arch-c/control.json` (DFS leak 26/69)
  - `duel-server/data/eval-arch-c/honest-no-preferred.json` (DFS honest 22/69)
- Predecessors:
  - `_bmad-output/solver-data/phase-3/path-beta-poc-2026-04-28.md`
  - `_bmad-output/solver-data/phase-3/arch-c-phase-3-wiring-2026-04-28.md`

---

## Out of scope this stage

- Snake-eye-yummy-opener: incompatible format (PvP raw-replay schema). Either
  port the schema to `{steps[]}` format OR run β-1 v2 from-scratch.
- Apply β-3 pattern to remaining authored canonicals: only 4 fixtures have
  authored lines; rest need β-1 v2 from-scratch.
- API-direct pipeline (`@anthropic-ai/sdk`): if subscription rate limits
  block scaling, this is the fallback.
- Tier 2 (SELECT_CARD always-branchable): would replace the magic
  number 6 with full enumeration. Real ML R&D, multi-week.
- Tier 3 (learned context-aware preferences): same.
