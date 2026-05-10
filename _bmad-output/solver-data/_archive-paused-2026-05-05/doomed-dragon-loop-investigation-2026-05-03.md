# Doomed Dragon Procedure Infinite Loop — Investigation 2026-05-03

## TL;DR

**Hypothesis A (REPLACE EFFECT_CHANGE_TYPE breaks IsMonsterCard) is FALSIFIED.**
**Hypothesis B (Doomed Dragon's filter is incompatible with Cont-Spell-zone monsters) is FALSIFIED.**
**Hypothesis C (auto-respond can't escape multi-pick atomic flow) is CONFIRMED.**

Real bug: when `replay-trajectory-cli` plan provides exactly N `targets[]` for an
atomic multi-pick `SELECT_CARD min=max=N finishable=true` prompt (Doomed Dragon's
alt-summon procedure uses this), the auto-fallback `legal[0]` picks
`multi-pick-undo` instead of `multi-pick-commit` — generating an
undo/add/undo/add infinite loop until `--max-iterations=2000` ceiling.

Fix: 2-line patch (1 file CLI, 1 file oracle) preferring `multi-pick-commit`
over `legal[0]` when targets exhausted inside a multi-pick. Bit-exact backward
compat verified on 2 of 3 β-1 v2 baselines (3rd has stale plan unrelated to
fix).

## (a) cardIds identified

- `58071334` — Snake-Eyes Doomed Dragon (Fusion Lv8) — uses `Duel.SelectMatchingCard(...,2,2,true,...)` for alt-SS procedure
- `27260347` — Snake-Eyes Diabellstar
- `9674034`  — Snake-Eye Ash
- `90241276` — Snake-Eyes Poplar
- `45663742` — Snake-Eye Oak
- `48452496` — Snake-Eyes Flamberge Dragon
- `53639887` — Divine Temple of the Snake-Eye

## (b) Lua audit

### Doomed Dragon `c58071334.lua` — alt-summon-procedure filter

```lua
function s.hspfilter(c)
  return c:IsMonsterCard() and c:IsFaceup() and c:IsAbleToGraveAsCost()
end
function s.hspcon(e,c)
  ...
  return Duel.GetLocationCountFromEx(tp,tp,nil,c)>0
    and Duel.IsExistingMatchingCard(s.hspfilter,tp,LOCATION_STZONE,0,2,nil)
end
function s.hsptg(e,tp,eg,ep,ev,re,r,rp,chk,c)
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
  local g=Duel.SelectMatchingCard(tp,s.hspfilter,tp,LOCATION_STZONE,0,2,2,true,nil)
  ...
end
```

**Key observation**: `LOCATION_STZONE` (S/T zone), `IsMonsterCard()`,
`min=max=2`, `forced=true` (atomic multi-pick).

### Snake-Eye / Divine Temple `EFFECT_CHANGE_TYPE` — both Doomed Dragon and Divine Temple register

```lua
local e1=Effect.CreateEffect(c)
e1:SetType(EFFECT_TYPE_SINGLE)
e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
e1:SetCode(EFFECT_CHANGE_TYPE)
e1:SetValue(TYPE_SPELL|TYPE_CONTINUOUS)
e1:SetReset((RESET_EVENT|RESETS_STANDARD)&~RESET_TURN_SET)
tc:RegisterEffect(e1)
```

### `IsMonsterCard` definition (`utility.lua:169`)

```lua
Card.IsMonsterCard=aux.FilterBoolFunction(Card.IsOriginalType,TYPE_MONSTER)
```

**`IsMonsterCard` checks `IsOriginalType`, NOT current type.** Snake-Eye
monsters placed-as-Cont-Spell still pass `IsMonsterCard()` regardless of
whether `EFFECT_CHANGE_TYPE` is REPLACE or ADD. Hypothesis A falsified.

Confirmed by Divine Temple's filter at `c53639887.lua:64`:

```lua
function s.spfilter(c,e,tp)
  return c:IsFaceup() and c:IsOriginalType(TYPE_MONSTER)
    and c:IsContinuousSpell() and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
end
```

This filter explicitly demands BOTH `IsOriginalType(TYPE_MONSTER)` AND
`IsContinuousSpell()` — proving the engine has a clean distinction between
original type (monster) and current type (cont spell), and a placed-Snake-Eye
satisfies both.

## (c) Repro test — minimal trace

`v3-attempt-8.json` reaches the Doomed Dragon summon-procedure step (after
NS Ash search Poplar trigger, Yummyusment activation, Ash send-2 SS Flamberge,
Divine Temple → Diabellstar in S-zone, Diabellstar S-zone → Ash back to S-zone,
I:P Masquerena Link, Flamberge place I:P as Cont Spell).

Trajectory at the loop start (run with `--max-iterations=200`):

```
step 44: SELECT_IDLECMD  Snake-Eyes Doomed Dragon (summon-procedure) [plan]
step 45: SELECT_CARD     Snake-Eyes Diabellstar [target] resp=0   (multi-pick-add picks=[diabellstar_idx])
step 46: SELECT_CARD     Snake-Eye Ash [target] resp=0            (multi-pick-add picks=[diabellstar_idx, ash_idx])
step 47: SELECT_CARD     (pass) [auto] resp=0                     (multi-pick-undo, picks back to [diabellstar_idx])
step 48: SELECT_CARD     Snake-Eye Ash [auto] resp=0              (multi-pick-add re-picks Ash)
step 49: SELECT_CARD     (pass) [auto] resp=0                     (undo)
... repeated 1953 times until ceiling ...
```

**Loop mechanism** (root cause):

1. Plan provides 2 `targets[]` matching the 2 picks needed (Diabellstar, Ash).
2. After 2 picks, `picks.length == max == 2`. The enumerator emits actions in
   order: ADD (skipped, can't add when at max) → UNDO (cardId=0, responseIndex=0)
   → COMMIT (cardId=0, responseIndex=1).
3. Plan targets exhausted. Auto-fallback was `chosen = legal[0]` →
   picks UNDO at responseIndex=0. picks reverts to 1.
4. Next iteration: ADD candidates re-emitted, Ash at responseIndex=0.
   `legal[0]` picks Ash → picks back to 2.
5. GOTO step 3 forever.

`(pass)` text in the trajectory comes from `getName(0)` returning `(pass)` for
cardId=0 — both UNDO and ADD-of-cardId-0 print as `(pass)`, masking the loop's
true ping-pong nature in the log.

## (d) Hypothesis confirmed: C (auto-respond cannot escape atomic multi-pick)

Evidence:

- The Lua filter is correct (`IsMonsterCard` = `IsOriginalType(TYPE_MONSTER)`).
- The atomic multi-pick FOUND both Diabellstar and Ash as legal candidates
  (steps 45-46 successfully picked them via plan targets).
- Loop is in the auto-fallback after targets exhausted, NOT in OCG core.

The bug surfaces specifically for **atomic** multi-pick procedures
(`SelectMatchingCard` with finishable=true) like Doomed Dragon's alt-procedure.
Link procedures (`Link.AddProcedure`) use `SELECT_UNSELECT_CARD` (iterative)
which has a different protocol where each pick is a real OCG round-trip — they
don't hit this bug, which is why Almiraj/Silhouhatte plans always worked.

## (e) Fix proposed (shipped, NOT committed — pending review)

### `duel-server/scripts/replay-trajectory-cli.ts:1335`

```diff
              chosen = tryConsumeTarget(legal, promptType);
              if (chosen) {
                pickSource = 'target';
              } else {
-               chosen = legal[0];
+               // Atomic multi-pick auto-fallback (2026-05-04): prefer COMMIT
+               // when present (min satisfied) over legal[0] which is UNDO.
+               // See doomed-dragon-loop-investigation-2026-05-03.md.
+               const commit = legal.find(a => a.actionTag === 'multi-pick-commit');
+               chosen = commit ?? legal[0];
                pickSource = 'auto';
              }
```

### `duel-server/src/solver/plan-replay-oracles.ts:236`

Same fix for the resolver-mode path (gated by `SOLVER_USE_PROMPT_RESOLVER=1`,
default OFF, but kept in lockstep for forward compat).

```diff
    } else if (SUB_PROMPT_PICKABLE.has(ctx.promptType)) {
      const consumed = tryConsumeTarget(legal, ctx);
      if (consumed) {
        chosen = consumed;
        pickSource = 'target';
      } else {
-       chosen = legal[0];
+       const commit = legal.find(a => a.actionTag === 'multi-pick-commit');
+       chosen = commit ?? legal[0];
        pickSource = 'auto';
      }
```

**Why this is correct, not a workaround**:

- Outside multi-pick atomic flows, `commit` is `undefined` → `legal[0]` is used
  (no behavior change for any non-multi-pick prompt, including SELECT_PLACE,
  SELECT_OPTION, SELECT_POSITION, etc.).
- Inside multi-pick atomic flows, `commit` is only present when
  `canCommitMultiPick` returns true (min satisfied + sum constraints). Picking
  commit is exactly the correct semantic when the plan author has provided
  the exact pick count required.
- If the plan provided FEWER targets than `min` (e.g., 1 target for min=2),
  commit is NOT in legal[] — `legal[0]` is the first ADD action, behavior
  preserved (will pick a 2nd card automatically and then commit on next
  iteration via the new fallback).
- DFS solver path is untouched; the fix lives only in CLI/oracle code.

### Backward-compat verification

| fixture | β-1 v2 baseline | with fix |
|---|---|---|
| branded-dracotail-opener | 7/8 score 37 completed | **7/8 score 37 completed** ✅ bit-exact |
| snake-eye-yummy-opener | 3/7 score 25 completed | **3/7 score 25 completed** ✅ bit-exact |
| ddd-pendulum-opener | (stale plan, hand mismatch — unrelated to fix) | (same divergence at step 0, stale-plan issue) |

### Empirical fix verification on the bug

Re-ran `v3-attempt-8.json` after fix:

- Before: `matched=3/7 score=17 stopped=ceiling errorMessage="Hit max-iterations=2000"`
- After:  `matched=3/7 score=18 stopped=divergence` (Silhouhatte material missing — unrelated authoring issue, expected since Diabellstar+Ash were sent to GY by Doomed Dragon's procedure cost)

Trajectory after step 47 now correctly resolves:

```
step 47: SELECT_CARD   (pass) [auto] resp=1   (multi-pick-commit ✅)
step 48: SELECT_PLACE  (pass) [auto] resp=0   (Doomed Dragon placement)
step 49: SELECT_CHAIN  (pass) (pass) [auto]
step 50: SELECT_EFFECTYN  Snake-Eyes Doomed Dragon [auto] resp=1
step 51: SELECT_CARD   Snake-Eyes Flamberge Dragon [auto] resp=0  (Doomed Dragon's pl-effect target)
...
```

Doomed Dragon successfully summons. Bug fully resolved.

## (f) Impact estimate on fixtures

**Direct impact** (atomic multi-pick procedures with min=max≥2 finishable=true):

- **snake-eye-yummy-opener** Path β v3: unblocks Doomed Dragon line
  (subagent will now be able to validate any plan using Doomed Dragon's
  alt-procedure). Could lift snake-eye matched count beyond current 3/7
  baseline if subagent finds a viable line.
- **Other Snake-Eye / Diabellstar combo decks**: any deck using
  Snake-Eyes Doomed Dragon or any other archetype with similar atomic
  `SelectMatchingCard(...,N,N,true,...)` summon procedure benefits.

**Procedure types LIKELY to use atomic multi-pick** (need empirical
confirmation, not in scope here):

- Synchro/Fusion alt-procedures using `Duel.SelectMatchingCard` directly
- Some Ritual Tribute prompts with min=max materials
- Self-contained "send N face-up cards" cost patterns

**Procedure types NOT affected** (use SELECT_UNSELECT_CARD iterative):

- Most Link summons (`proc_link.lua` → `Link.AddProcedure`)
- Modern Synchro `proc_synchro.lua` → `Synchro.AddProcedureMix*`
- Modern Fusion `proc_fusion.lua` → `Fusion.AddProcMix`
  - **Caveat**: Doomed Dragon ALSO has `Fusion.AddProcMix` registered
    alongside the alt-procedure. The alt-procedure (the one with the bug)
    is the EFFECT_SPSUMMON_PROC variant, not the standard fusion path.

**Aggregate canonical-eval impact**: 0 — DFS solver does not use the CLI
plan-replay path. Canonical-eval baselines are bit-exact preserved.

**Aggregate Path β v3 dispatch impact**: TBD — depends on which fixtures
have authored or auto-discovered plans using such procedures. The known
victim is snake-eye-yummy-opener-v3-attempt-8 (and its derivatives).

## Open questions / out of scope

1. **Plan grammar extension**: should plans be able to express the COMMIT
   step explicitly (e.g., `responseIndex: -1` semantic on the 3rd target)?
   Currently the auto-fallback handles it, which is consistent with Link
   summon behavior (`responseIndex: -1` finish marker is also auto-handled).
   Mild preference: leave as-is; the auto-fallback is the right default.

2. **Adapter-side detection**: should `ocgcore-adapter.ts` detect the
   undo/add ping-pong and abort with a clearer error than just hitting
   the iteration ceiling? With the CLI fix in place, this is no longer
   pressing — the loop won't form in plan-replay mode. Could still add a
   safety net for future failure modes.

3. **Existing β-1 baselines (e.g., ddd-pendulum)**: the
   `beta1v2-best-plan.json` for ddd has a hand mismatch (Magnet Warrior /
   Dark Ruler vs. ddd cards). Likely a stale fixture-level plan from a
   pre-fixture-correction era. Not in scope of this investigation but
   worth flagging as a follow-up.

## Files touched (review pending — NOT committed)

- `duel-server/scripts/replay-trajectory-cli.ts` (1 method, +13 lines)
- `duel-server/src/solver/plan-replay-oracles.ts` (1 method, +13 lines)

Both edits are localized 2-line behavior changes (`legal[0]` → `commit ?? legal[0]`)
with explanatory comments. No types, no APIs, no signatures changed.

## Time spent

~2h end-to-end (Lua audit + repro + fix + bit-exact verification).
