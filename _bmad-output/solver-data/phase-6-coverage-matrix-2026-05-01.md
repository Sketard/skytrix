# Phase 6 — sourceCardId Coverage Matrix

**Date:** 2026-05-01
**Companion to:** [prompt-resolver-refactor-2026-05-01.md](prompt-resolver-refactor-2026-05-01.md) §6
**Pinned commit SHA at time of audit:** `39cf6e4f` (Phase 5 ship)
**Audit corpus:** 538 prompts × 6 baselines (3 β-1 + 3 β-3, all in `_bmad-output/solver-data/phase-1-baselines/`)

This matrix documents how reliably each `OcgMessageType` exposes a `sourceCardId` (the card whose effect emitted the prompt) — the input that `CardExpertiseOracle` needs to fire. Built empirically by sampling `selectMsg` payloads with `SOLVER_DUMP_MSGS=1` and decoding three candidate fields per message: `msg.code` (direct), `msg.description` (bigint encoded `cardCode << 20 | strIndex`), and `selects[0].description` (per-link source for SELECT_CHAIN).

## Result

| PromptType | n | code | descSrc | sel0Src | **ANY** | Verdict |
|---|---|---|---|---|---|---|
| SELECT_EFFECTYN | 22 | 100% | — | — | **100%** | ✅ reliable (msg.code) |
| SELECT_YESNO | 2 | 0% | 100% | — | **100%** | ✅ reliable (msg.description >> 20), n=2 small |
| SELECT_POSITION | 33 | 100% | — | — | **100%** | ✅ reliable (msg.code) |
| SELECT_CHAIN | 279 | 0% | 0% | 31% | **31%** | ⚠️ partial (per-link via selects[i].description; no whole-prompt source) |
| SELECT_IDLECMD | 52 | 0% | 0% | 0% | **0%** | ❌ no source (it's a strategic decision menu) |
| SELECT_OPTION | 4 | 0% | 0% | 0% | **0%** | ❌ |
| SELECT_CARD | 44 | 0% | 0% | 0% | **0%** | ❌ |
| SELECT_PLACE | 65 | 0% | — | — | **0%** | ❌ |
| SELECT_UNSELECT_CARD | 36 | 0% | — | — | **0%** | ❌ |
| SELECT_SUM | 1 | 0% | 0% | 0% | **0%** | ❌ |

**Global coverage:** 22 + 2 + 33 + 86 (CHAIN partial) = **143 / 538 = 26.6%**

**Coverage among types where CardExpertiseOracle is most useful** (SELECT_EFFECTYN, SELECT_YESNO, SELECT_POSITION = effects-of-known-cards): **57 / 57 = 100%**.

## Decision

Refactor design doc Risk #2 sets a hard gate at **<60% reliability → Phase 7 scope shrinks**. Global coverage at 26.6% is below the gate, but the breakdown reveals that the 3 high-value prompt types are 100% reliable. Phase 7 is therefore scoped to:

- **In scope (100%-reliable prompts):**
  - SELECT_EFFECTYN — author hints with `policy: 'yes' | 'no'` to override the legacy default-YES
  - SELECT_YESNO — author hints with `policy: 'yes' | 'no'` to override the legacy default-NO
  - SELECT_POSITION — author hints with `policy: 'face-down' | 'face-up-attack' | 'face-up-defense'`

- **Out of scope (no reliable source plumbing):**
  - SELECT_IDLECMD — this is a strategic decision; covered by Path β plan files instead
  - SELECT_CARD — pool-of-options selector; covered by `preferredSearchTargets` config + `policy: 'preferred'` per-action match (which doesn't need sourceCardId because it filters on candidate cardId, not source)
  - SELECT_PLACE / SELECT_UNSELECT_CARD / SELECT_OPTION / SELECT_SUM — too rare or no source field
  - SELECT_CHAIN — partial coverage; per-link source exists but the prompt has no single "owning" card. CardExpertise doesn't fit naturally; stick with the existing `chainTargets` plan-side mechanism.

## Implementation

### `extractSourceCardIdFromMsg(msg)` helper [ocgcore-adapter.ts](duel-server/src/solver/ocgcore-adapter.ts)

```ts
export function extractSourceCardIdFromMsg(msg: Record<string, unknown>): number | undefined {
  const codeVal = msg['code'];
  if (typeof codeVal === 'number' && codeVal !== 0) return codeVal;
  const descRaw = msg['description'];
  if (typeof descRaw === 'bigint') {
    const cardCode = Number(descRaw >> 20n);
    if (cardCode > 0) return cardCode;
  }
  return undefined;
}
```

Set on `internal.lastPromptSourceCardId` unconditionally in `runUntilPlayerPrompt` after the `selectMsg` is extracted, regardless of `SOLVER_USE_PROMPT_RESOLVER`. Both code paths read the same source.

### Surfaces

| Surface | Consumer | Path |
|---|---|---|
| `DecisionContext.sourceCardId` | DFS (in-adapter resolver path) | Read from `internal.lastPromptSourceCardId` directly |
| `OCGCoreAdapter.getLastPromptSourceCardId(handle)` | CLI replay (out-of-adapter consumer) | Public getter; called between `getLegalActions` and `resolver.resolve` |

CLI usage:
```ts
const legal = adapter.getLegalActions(handle);
const ctx: DecisionContext = {
  // ...
  sourceCardId: adapter.getLastPromptSourceCardId(handle),
};
const result = cliResolver.resolve(ctx);
```

## Bit-exact gate

Phase 6 is plumbing-only: `CardExpertiseOracle` continues to pass through (no `decisionHints` populated yet). 6/6 replay baselines (3 β-1 + 3 β-3) reproduce byte-identically with `SOLVER_USE_PROMPT_RESOLVER=1`. All 5 smoke test suites still pass (123 tests total).

## Audit reproducibility

Add `SOLVER_DUMP_MSGS=1` to any baseline capture command and the adapter logs `[MSG_DUMP] type=N promptType=X player=Y code=Z keys=[...]` per prompt. Re-run the harness across the 6 baselines and aggregate:

```bash
SOLVER_DUMP_MSGS=1 npx tsx scripts/capture-phase-1-baselines.ts \
  --out-dir=/tmp/p6-audit --mode=replay 2>&1 | grep MSG_DUMP > /tmp/p6-msgs.log
# ...post-process per-promptType counters as in this matrix
```

The full instrumentation block was committed temporarily during the audit (commit history) and then removed. Re-add as needed for future re-validation (e.g., after an OCGCore version bump).

---

## Audit A — `actionHistory` lookback as fallback (REJECTED)

**Hypothesis tested:** for prompts where `extractSourceCardIdFromMsg` returns undefined (73% of prompts), can we use `actionHistory.findLast(a => a._isEffectActivation).cardId` as the sourceCardId? If yes, this would lift global coverage from 26.6% to ~95%.

**Setup:** Added `SOLVER_DUMP_LOOKBACK=1` instrumentation logging both the extracted source AND the lookback candidate for every prompt across the 6 baselines (538 prompts). Then validated lookback against extract on the 2 ground-truth prompt types (SELECT_EFFECTYN + SELECT_POSITION, both 100% reliable from `msg.code`).

**Result:**
- Lookback presence: 95% of prompts (only `histLen=0` early-game prompts have no lookback candidate).
- Lookback agreement vs ground truth on SELECT_EFFECTYN: **4/18 matched, 14/18 mismatched** (22%).
- Lookback agreement vs ground truth on SELECT_POSITION: **6/32 matched, 26/32 mismatched** (19%).

**Conclusion:** The lookback signal is **majority-wrong** even where we can verify it. Several failure modes contribute:
- `_isEffectActivation` is set on chain link selections (SELECT_CHAIN), SELECT_EFFECTYN yes, and IDLECMD activates — but NOT on normal-summons. So a SELECT_PLACE issued by Lukias's on-summon search doesn't have Lukias as the most-recent `_isEffectActivation` action.
- `actionHistory` contains every applied action including opponent goldfish responses and mechanical defaults; `findLast` reaches back too far.
- SELECT_IDLECMD lookbacks are pure noise (an IDLECMD prompt has no source card; lookback returns the previous turn's last activation).

**Decision:** lookback is NOT integrated into `extractSourceCardIdFromMsg`. Authoring `decisionHints` based on a 22%-correct signal would produce silent misfires (wrong card's hint applied to another card's prompt). The 100%-reliable subset (SELECT_EFFECTYN/SELECT_YESNO/SELECT_POSITION via `msg.code` / `msg.description`) is sufficient for Phase 7's audited fixtures.

**Future work:** an MSG_HINT / MSG_CHAINING event-stream investigation (Audit B, ~3-4h) might surface a more reliable per-prompt source — OCGCore likely emits these context events between SELECT_* messages. Not blocking Phase 7.
