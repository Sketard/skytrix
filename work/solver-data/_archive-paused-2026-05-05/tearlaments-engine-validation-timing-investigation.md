# Tearlaments fusion "engine validation timing" — root cause + fix

**Date:** 2026-05-03
**Status:** SHIPPED (commit-pending)
**Predecessor:** `path-beta-v2-aggregate-2026-05-03.md` (bug 4)

## TL;DR

The "OCGCore exposes invalid materials, fusion silently no-ops" framing in the
Path β v2 aggregate memo (bug 4) is **misdiagnosed**. The materials the engine
exposes ARE valid (e.g. Reinoheart is a Tearlaments monster — setcode 386 — and
satisfies Kitkallos's "1 Tearlaments + 1 Aqua" via Havnis-as-Aqua-slot +
Reinoheart-as-Tearlaments-slot, since `Fusion.SelectMix` checks the global
assignment). The actual root cause is upstream:

**The OCG adapter does not handle `MSG_SORT_CARD` (25) or `MSG_SORT_CHAIN` (21).**
Tearlaments fusion clauses (Havnis e2, Scheiren, Kitkallos itself) end with
`Duel.SortDeckbottom(tp,tp,ct)` — letting the player choose deck-bottom order
for the materials being shuffled in. The adapter's `runUntilPlayerPrompt`
loop doesn't recognize msg 25 as a select-prompt (only 15 SELECT_* types are
in `MESSAGE_TO_PROMPT`), falls through to `if (!selectMsg) return [];`, and
the CLI sees `legal=[]` → treats it as "engine ended."

The fusion's internal state at that point: materials moved to deck-bottom
(MOVE messages already emitted), but the SS step hasn't run yet — it's
gated on the pending SORT response. The duel is **alive and waiting**, not
ended.

## Concrete reproduction

`scripts/debug-tear-fusion.ts` (now removed, kept reproducible via the same
plan + manual `core.duelProcess` loop):

```
step 10 SELECT_UNSELECT_CARD: pick Reinoheart as material (responseIndex 1)
   ↓ adapter sends type=7 index=1 to engine
   iter 0: status=CONTINUE, msg=type80 (CARD_SELECTED hint)
   iter 1: status=CONTINUE, msg=type50 MOVE Reinoheart M1→DECK[bottom, position=10]
   iter 2: status=CONTINUE, msg=type50 MOVE Havnis  GY→DECK[bottom, position=10]
   iter 3: status=WAITING,  msg=type25 SORT_CARD  ← adapter ignores this
   ↑ adapter returns [], CLI treats as "engine ended"
```

After auto-responding `{type: 15, order: null}`:
```
   iter 4: msg=type2 HINT (hint=92731385 = Kitkallos)
   iter 5: status=WAITING, msg=type18 SELECT_PLACE for Kitkallos ← fusion proceeds normally
```

## Recommended fix path (shipped)

**Adapter-level auto-respond, identity order** (`order: null`):

```ts
// src/solver/ocgcore-adapter.ts::runUntilPlayerPrompt
if (status === OcgProcessResult.WAITING) {
  // SORT_CARD / SORT_CHAIN: not enumerated as player prompts. Auto-respond
  // with order=null (engine treats as default order) so fusion clauses that
  // end with Duel.SortDeckbottom (Tearlaments archetype) complete normally.
  const sortMsg = messages.find((m) =>
    m.type === OcgMessageType.SORT_CARD || m.type === OcgMessageType.SORT_CHAIN);
  if (sortMsg) {
    const resp = { type: 15, order: null } as unknown;
    this.core.duelSetResponse(internal.nativeHandle, resp as never);
    internal.responseHistory.push(resp);
    continue;
  }
  const selectMsg = messages.find((m) => SELECT_MSG_TYPES.has(m.type));
  if (!selectMsg) return [];
  // ...
}
```

Both `OcgResponseType.SORT_CARD` and SORT_CHAIN responses use the same shape
(`{type: 15, order: number[] | null}`) — the WASM binding only declares
`OcgResponseSortCard` in the `OcgResponse` union; SORT_CHAIN reuses that same
response type by C++ convention.

**Why identity order, not player prompt?** Order rarely matters for
turn-1 ground-truth (the deck reshuffles before any ordering becomes
observable), and surfacing as a player prompt would require a new
`PromptType` + enumerator + queue grammar entry — over-engineering for the
Tearlaments case. The contract can be revisited if a future fixture proves
order-sensitive.

## Validation

Tearlaments fixture (plan-v6 — minimal NS Reinoheart → Havnis-fusion-Kit
→ pick Reinoheart material):
- Before fix: `matched: 0/4, score: 0, stopped: completed` (engine
  prematurely terminated mid-fusion-resolution, Kitkallos never summons)
- After fix: `matched: 1/4, score: 0, stopped: completed` (Kitkallos
  successfully on field)

Tearlaments fixture (plan-v21 — v2 best plan, no Tearlaments fusion):
- Before fix: `matched: 2/4, score: 10`
- After fix: `matched: 2/4, score: 10` (no regression)

**Bit-exact gate on β-1 baselines** (commit-pinned 7f2aa406):
- branded-dracotail-opener: trace.jsonl bit-exact identical (after CRLF
  normalization), matched 7/8 score 37 unchanged.
- ddd-pendulum-opener: trace.jsonl bit-exact identical, matched 3/5 score
  37 unchanged.
- snake-eye-yummy-opener: trace.jsonl bit-exact identical, matched 4/7
  score 33 unchanged.

(Result.json files have minor pre-existing schema drift unrelated to this
fix: new `pathPoints` field from the path-scoring-pilot, plus HAND entries
in `finalBoardSelf` from the branded-mirrorjade `SCORED_ZONES` change.
Neither affects matched/score.)

## Strategic implications

1. **Path β v2 bug 4 → falsified diagnosis, real bug fixed**. Tearlaments
   2/4 ceiling is **not** "engine exposes invalid materials"; it's an
   adapter coverage gap on SORT prompts. With the fix, Tearlaments fusions
   are reachable; combo lines using Havnis + Scheiren GY-fusion clauses
   should now extend further.

2. **Re-dispatch tearlaments-opener with v2 methodology recommended**.
   With Kitkallos and Kaleido-Heart now reachable, the previous 2/4 ceiling
   is no longer materially blocked. Estimated cost: 1 subagent
   re-dispatch (~30 min wallclock).

3. **Other Tearlaments-style "fusion places materials at deck-bottom"
   archetypes are also unblocked** (e.g. some pre-Tear fusions, Sky Striker
   Hayate, etc. that use `SortDeckbottom`). No fixture in the current
   canonical-eval covers these directly, so empirical impact beyond
   tearlaments is bounded by fixture coverage.

## Tooling notes

- `scripts/debug-tear-fusion.ts` was created as an investigation throwaway
  (uses `core.duelProcess`/`duelGetMessage` directly to bypass adapter
  filtering); deleted post-investigation.
- Lua source paths are at `data/scripts_full/official/` (note the
  `official/` subdir — `find data/scripts_full/c92731385.lua` would miss).
- Useful one-liner to inspect any Lua source given a cardId:
  `find data/scripts_full -name "c<cardId>*.lua"`.

## Open questions

1. **Should SORT prompts ever surface to the plan grammar?** For combos
   that scry-then-ladder via deck-bottom (e.g., a future Path β plan that
   wants to set up a specific deck-top for next turn's draw), the
   identity-order auto-response is wrong. Defer until a concrete fixture
   demonstrates need.

2. **Does the fix unblock other Tear fixtures we don't know about?** The
   fix is fully archetype-agnostic — any future fixture using
   `Duel.SortDeckbottom` benefits automatically.
