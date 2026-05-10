# chainTargets[] silent-failure mode + non-retroactive lock — investigation memo (2026-05-03)

**Status**: doc-only updates applied; no production code touched. β-1 baseline bit-exactness preserved by construction.

**Trigger**: Path β v3 subagent post-mortem on snake-eye-yummy-opener flagged `chainTargets[]` as the dominant silent-failure mode and noted §B.6 wording was ambiguous about which "If/When … you can" Triggers need explicit `chainTargets[]` vs which auto-resolve. Plus a related blind-spot on Promethean Princess + Lollipo "FIRE-only" lock being misclassified as retroactive.

---

## (a) Code audit — where chainTargets[] is consumed and how SELECT_CHAIN is treated

### Adapter side (`duel-server/src/solver/ocgcore-adapter.ts`)

**Enumeration of `SELECT_CHAIN` actions** (lines 1452-1467):

```ts
case 'SELECT_CHAIN': {
  const selects = (msg['selects'] ?? []) as { code, description, location?, sequence? }[];
  for (let i = 0; i < selects.length; i++) {
    pushAction({ responseIndex: i, cardId: selects[i].code, ..., actionTag: 'activate' },
               { type: 8, index: i });
  }
  if (!(msg['forced'] as boolean)) {
    pushAction({ responseIndex: -1, cardId: 0, ..., actionTag: 'pass' }, { type: 8, index: null });
  }
  break;
}
```

The pivotal logic is the `forced` flag (line 1463). The `forced` boolean comes from the OCG-core engine on every SELECT_CHAIN message (`@n1xx1/ocgcore-wasm` types `OcgMessageSelectChain.forced: boolean`). Its semantics:
- `forced=true` → at least one mandatory trigger (`EFFECT_TYPE_TRIGGER_F`) is in `selects[]` and MUST be activated. The pass action is NOT surfaced.
- `forced=false` → all triggers in `selects[]` are optional (`EFFECT_TYPE_TRIGGER_O`). The pass action (responseIndex=-1, `{type:8, index:null}`) is added as a legal choice.

**Adversarial / opponent path** (lines 2027-2028): opponent's auto-respond on SELECT_CHAIN always returns `{type:8, index:null}` (pass) — opponent triggers are never auto-fired by the adapter. (Adversarial mode is gated on `config.handtraps.length > 0`, off for canonical eval.)

**EXPLORATORY_PROMPTS gate** (`solver-types.ts:90`): SELECT_CHAIN is in `EXPLORATORY_PROMPTS`, so for the DFS solver it always surfaces as a branch point (one branch per chain link + a pass branch when `!forced`). The DFS picks autonomously via the ranker — this part is unrelated to plan-replay's chainTargets[] mechanism.

### CLI side (`duel-server/scripts/replay-trajectory-cli.ts`)

**chainTargets queue** (lines 224, 1264): `pendingChainTargets: TargetSpec[]` is loaded from each plan-step's `chainTargets[]` array at every IDLECMD. Leftovers from the previous step are discarded when the next IDLECMD fires.

**Consumption at SELECT_CHAIN** (lines 789-806, 1305-1312):

```ts
function tryConsumeChainTarget(legal: Action[]): Action | null {
  if (pendingChainTargets.length === 0) return null;
  const t = pendingChainTargets[0];
  let match: Action | null = null;
  if (t.responseIndex !== undefined) {
    match = legal.find(a => a.responseIndex === t.responseIndex) ?? null;
  } else {
    const wanted = (t.cardNames ?? (t.cardName ? [t.cardName] : [])).map(normalizeName);
    if (wanted.length > 0) {
      match = legal.find(a => {
        const n = normalizeName(a.cardName || getName(a.cardId));
        return wanted.some(w => n === w || n.includes(w) || w.includes(n));
      }) ?? null;
    }
  }
  if (match) pendingChainTargets.shift();
  return match;
}

// Plan-mode SELECT_CHAIN:
if (promptType === 'SELECT_CHAIN') {
  chosen = tryConsumeChainTarget(legal);
  if (chosen) {
    pickSource = 'target';
  } else {
    chosen = legal.find(a => a.responseIndex === -1) ?? legal[0];
    pickSource = 'auto';
  }
}
```

The fallback when `tryConsumeChainTarget` returns null is `legal.find(a => a.responseIndex === -1) ?? legal[0]`:
- For optional chains (`forced=false`, pass present): picks the pass → trigger silently dropped.
- For mandatory chains (`forced=true`, no pass action surfaced): falls through to `legal[0]` → first mandatory trigger fires automatically.

**Skip-tolerant matching for `cardName`-only entries** (line 779 vs 804): note the asymmetry.
- `tryConsumeTarget` (regular targets[]) is **skip-tolerant on cardName misses**: it leaves the entry in the queue if no legal action matches.
- `tryConsumeChainTarget` is **NOT skip-tolerant**: it always returns null on no match without shifting; the entry stays at queue head and re-tries at the next SELECT_CHAIN. This is correct semantics — the trigger window for an optional cardName may open across multiple chain links.

### Plan-replay oracles (`plan-replay-oracles.ts`)

The oracle layer (used by `prompt-resolver` flag-gated path) does not directly touch chainTargets — chainTargets[] is consumed in the main CLI loop, not via oracles. The PromptResolver path is currently flag-OFF for plan-replay (it's the DFS-side abstraction). β-1 plan replay uses the legacy switch-case in the CLI loop.

---

## (b) Trigger taxonomy — mandatory vs optional vs cost-paying

Distilled from `duel-server/data/scripts_full/constant.lua:310,312` and the standard YGO/PSCT rules:

| Trigger flavor | Lua marker | OCG `forced` flag | Oracle wording | `chainTargets[]` needed? |
|---|---|---|---|---|
| **Mandatory** | `EFFECT_TYPE_TRIGGER_F` (0x200) | `true` (no pass action) | `If/When [event]: [effect]` (no `you can`) | **NO** — auto-fires via `legal[0]` fallback |
| **Optional** | `EFFECT_TYPE_TRIGGER_O` (0x80) | `false` (pass `responseIndex=-1` available) | `If/When [event]: **You can** [effect]` | **YES** — without it, default = pass = silent drop |
| **Cost-paying optional** | `EFFECT_TYPE_TRIGGER_O` + cost | `false` | `If/When [event]: **You can** pay/discard/banish X; [effect]` | **YES** — `chainTargets[]` to activate, then `targets[]` for the cost |

**Quantitative scale** (script files in `data/scripts_full/official/`): 1858 cards have `EFFECT_TYPE_TRIGGER_F`, 5777 cards have `EFFECT_TYPE_TRIGGER_O` — about 3.1× more optional than mandatory. So the silent-failure case is by far the more common case, and writing plans without explicit `chainTargets[]` is structurally fragile.

**Rule of thumb**: scan the trigger oracle clause for `you can`. Presence of `you can` → optional → needs `chainTargets[]`. Absence → mandatory → auto-fires.

**Edge case — "When … you can"**: still optional from SELECT_CHAIN perspective. The "When" timing rule (§1.7) is orthogonal — "When" determines whether the trigger surfaces at all (vs misses timing); if it surfaces, the SELECT_CHAIN behavior is governed solely by `forced` / `EFFECT_TYPE_TRIGGER_*`.

**Edge case — SEGOC ordering** (§4.7): when multiple triggers fire from one event, the engine surfaces a SELECT_CHAIN per turn-player precedence with all simultaneous candidates listed together. Each one needs an explicit `chainTargets[]` entry (matched in order — FIFO queue). The `cardNames`-multi-match form is useful when multiple triggers share an instant: `{cardNames: ["TriggerA", "TriggerB"]}` matches whichever is exposed first; provide N entries for N triggers.

**No edge case found** for: mandatory-with-cost. Cost paying happens during the trigger's resolution (Operation function), not at the SELECT_CHAIN gate; the gate just needs to fire.

---

## (c) Empirical validation — Snake-Eye triggers

Three Snake-Eye triggers reported by the v3 subagent as silent-failure cases:

### 1. Snake-Eyes Poplar (90241276) SS-on-add

`duel-server/data/scripts_full/official/c90241276.lua` lines 7-17:
```lua
local e1=Effect.CreateEffect(c)
e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)  -- ← OPTIONAL
e1:SetCode(EVENT_TO_HAND)
e1:SetCondition(function(e) return not e:GetHandler():IsReason(REASON_DRAW) end)
```
**Verdict**: `EFFECT_TYPE_TRIGGER_O` → optional → needs `chainTargets[]`.

### 2. Silhouhatte Rabbit (1528054) set-Cont-Trap on Link-Summon

`c1528054.lua` lines 19-29:
```lua
local e2=Effect.CreateEffect(c)
e2:SetCategory(CATEGORY_SET)
e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)  -- ← OPTIONAL
e2:SetCode(EVENT_SPSUMMON_SUCCESS)
e2:SetCondition(function(e) return e:GetHandler():IsLinkSummoned() end)
```
**Verdict**: `EFFECT_TYPE_TRIGGER_O` → optional → needs `chainTargets[]`.

### 3. Snake-Eyes Poplar (90241276) GY effect

`c90241276.lua` lines 33-42:
```lua
local e4=Effect.CreateEffect(c)
e4:SetCategory(CATEGORY_LEAVE_GRAVE)
e4:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)  -- ← OPTIONAL
e4:SetCode(EVENT_TO_GRAVE)
```
**Verdict**: `EFFECT_TYPE_TRIGGER_O` → optional → needs `chainTargets[]`.

### Empirical replay test

Setup: `_bmad-output/solver-data/chaintargets-investigation-2026-05-03/`.

- **`plan-no-chaintargets.json`** — copy of `v3-best-plan.json` with all `chainTargets[]` arrays removed. Same plan steps, same `targets[]`.
- **Test command**: `npx tsx scripts/replay-trajectory-cli.ts --fixture-id=snake-eye-yummy-opener --plan-file=<plan> --out=<result>`

| Run | matched | score | stoppedReason | notes |
|---|---|---|---|---|
| v3-best-plan (chainTargets[] present) | **4/7** | **24** | completed | reference baseline |
| plan-no-chaintargets (stripped) | **1/7** | **8** | divergence at step 3 | "No legal action matches Divine Temple verb=activate" |

**Replay log evidence (no-chaintargets run)** — every SELECT_CHAIN window between IDLECMDs shows `[auto] (pass)`:
```
SELECT_IDLECMD: Snake-Eye Ash (normal-summon) [plan]
SELECT_CHAIN:   (pass) (pass) [auto]   ← Poplar SS-on-add silently dropped
SELECT_EFFECTYN:Snake-Eye Ash [auto]   ← Ash's NS search trigger fires (separate prompt path)
SELECT_CHAIN:   (pass) (pass) [auto]
SELECT_CARD:    Snake-Eyes Poplar [target]
SELECT_CHAIN:   (pass) (pass) [auto]   ← Poplar SS-on-add window again, silently dropped
SELECT_IDLECMD: Yummyusment activate [plan]
...
SELECT_CHAIN:   (pass) (pass) [auto]
SELECT_CHAIN:   (pass) (pass) [auto]
SELECT_IDLECMD: Snake-Eye Ash activate [plan]
...
divergence at step 3 (Divine Temple): plan expects to activate Divine Temple but
the engine state has Poplar still in HAND (no SS happened) and other resource
state misaligned, so Divine Temple's activation prerequisites aren't met
```

**Mechanism**: Poplar didn't SS itself (optional EVENT_TO_HAND trigger silently passed) → Ash's later activate step couldn't include Poplar in send-2-face-up cost (Poplar is in HAND, not on field) → engine state diverges → Divine Temple's activation prerequisites fail → divergence.

**Validation conclusion**: silent-failure mode is real, reproducible, and the proposed taxonomy correctly predicts it from the Lua marker. The CLI's SELECT_CHAIN auto-fallback (`legal.find(a => a.responseIndex === -1) ?? legal[0]`) does the right thing for forced triggers (legal[0] is the trigger), and the wrong thing for optional triggers from a combo-LLM perspective (selects the pass, drops the trigger).

---

## (d) Doc updates applied

### B.6 (`_bmad-output/planning-artifacts/yugioh-game-rules.md`)

Added a new sub-section "**When does a Trigger need an explicit `chainTargets[]` entry vs auto-resolve?**" right after the existing "Trigger Effects do NOT need their own IDLECMD" paragraph. Includes:
- Operational table mapping `EFFECT_TYPE_TRIGGER_F` / `_O` / `_O+cost` → `forced` flag → `chainTargets[]` requirement.
- Mechanical rule explaining why `legal[0]` fallback works for forced and fails for optional.
- Rule of thumb on `you can` oracle text.
- Snake-Eye worked-example table covering all 4 triggers (Poplar SS-on-add, Poplar NS/SS search, Poplar GY, Silhouhatte set-Cont-Trap).
- Babycerasaurus counter-example for mandatory.
- Empirical validation summary (4/7 matched with chainTargets[] vs 1/7 without).
- 3-step diagnostic checklist when `matched < expected` despite `stoppedReason === "completed"`.

### §2.4 (same file)

Added a new sub-section "**Non-retroactive locks — ordering matters (don't over-eliminate)**" right after the Branded Fusion retroactive example. Includes:
- The two mechanisms: lingering-effect locks (`for the rest of this turn after this card's effect resolves`) and Continuous Effect locks tied to a card being on the field.
- Promethean Princess (cardId 2772337) worked example: lock is `EFFECT_TYPE_FIELD` with `LOCATION_MZONE` range — Continuous-Effect-on-field, forward-only.
- Lollipo Synchro ordering: `Promethean → Lollipo` blocked, `Lollipo → Promethean` legal.
- Branded Fusion contrast (turn-anchored = retroactive) vs Promethean (Continuous-on-field = forward-only).
- LLM blind-spot warning + classification heuristic (search lock text for `this turn` / `the turn you activate this card` keywords; check Lua for `EFFECT_TYPE_FIELD` vs `RegisterFlagEffect` patterns).

Both updates are pure additions, no existing content removed or moved. Structure preserved.

---

## (e) Code fix — none required

The investigation revealed:

1. **No bug in the adapter**: the `forced` flag handling at `ocgcore-adapter.ts:1463` is correct. Mandatory triggers don't get a pass action, optional ones do.

2. **No bug in `tryConsumeChainTarget`**: the matching logic correctly returns null when no chainTargets entry matches, leaving the entry queued (not skip-shift).

3. **No bug in the auto-fallback** at `replay-trajectory-cli.ts:1310`: `legal.find(a => a.responseIndex === -1) ?? legal[0]` is the right behavior — picks pass when available (optional, default-decline), falls through to legal[0] when not (mandatory, auto-fire).

4. **No bug in the CLI's chainTargets queue lifecycle**: queue is reset per IDLECMD, leftovers are discarded as documented.

The "silent failure" is a **doc gap**, not a code defect. The grammar exposes the right primitive (`chainTargets[]`); the LLM authors weren't told often enough that they MUST add an entry for every "you can" trigger they want to fire. With the §B.6 update, the rule is now operational and falsifiable.

**Minor unrelated finding** during code audit (logged for completeness, no fix applied):
- `tryConsumeTarget` (regular targets[]) is skip-tolerant on cardName misses (line 779), `tryConsumeChainTarget` is not (line 804). This asymmetry is intentional (cardName matching for chains spans multiple SELECT_CHAIN windows) but is undocumented in B.6/B.7. Not a bug, but worth a one-liner in B.6 next time the doc is touched.

---

## (f) Impact estimate — fixtures touched

The B.6 ambiguity affects every fixture where the canonical line uses optional triggers. Fixtures that already reach their canonical board (full `matched`) are not affected — the human author either added the right `chainTargets[]` or the optional triggers happened to be unused.

Fixtures where this is most likely to be the load-bearing gap (sample from MEMORY.md and v2 aggregate audit):

- **snake-eye-yummy-opener** — confirmed empirically (4/7 with vs 1/7 without). At least one Path β v2 follow-up may close the gap to 5/7 or 6/7 once the doc rule is internalized.
- **branded-mirrorjade** — Albion the Branded Dragon's GY-on-fusion-material `you can` triggers, set-spell triggers. Recently moved from 5/6 to 6/6 in F1 follow-up; the missing fix was a HAND matcher gap, but chainTargets discipline is also in play here.
- **labrynth, kashtira-azamina, spright** — full clears at 4/4 in v2 aggregate; no immediate impact, but plans authored under the new doc are less fragile to refactor.
- **tearlaments** — 2/4 → 3/4 after SORT_CARD fix. The remaining 1/4 gap is an "engine validation timing investigation" follow-up; not directly chainTargets-related.
- **D/D/D pendulum, ddd-archetype** — multiple `you can` Pendulum triggers (Doom Queen, Headhunt, Caesar). Stuck at 3/5 from raw-replay-verify ceiling 5/5 — a portion of that gap is plausibly chainTargets[] discipline.
- **floowandereeze, nekroz-ryzeal, dinomorphia** — many "you can" triggers; at 3/4 with rigorous structural ceilings (v2 aggregate). The doc rule clarification reduces re-author cost on these.

Estimated impact: applying the new B.6 rule on next-iteration plan authoring should plausibly recover **+1 to +3 cum matched** on next dispatch wave (snake-eye + 1-2 of the Path β follow-ups). Not measured directly here — would require a re-dispatch with the updated prompt that points to the new B.6 sub-section.

The §2.4 non-retroactive clarification is harder to quantify quantitatively but addresses a known LLM blind-spot (Promethean+Lollipo case ruled out by v3 subagent). Probably +0 to +1 cum matched on snake-eye (ddd-pendulum's lock interactions are different — Dark Contract pile, not turn-scoped) but reduces wasted dispatch attempts on plans that incorrectly eliminate combo permutations.

---

## (g) Blocker rencontré

None. Doc-only update, no code change required, β-1 baselines bit-exact preserved by construction (no production source touched).

The investigation confirmed the Path β v3 subagent's hypothesis: the failure mode is real and the proposed taxonomy maps cleanly to the OCG-core mechanism. The empirical 4/7 vs 1/7 gap on snake-eye-yummy-opener is a clean reproducer of the silent-failure pattern.

---

## Files

- `_bmad-output/planning-artifacts/yugioh-game-rules.md` — B.6 + §2.4 updated (additions only).
- `_bmad-output/solver-data/chaintargets-investigation-2026-05-03/plan-no-chaintargets.json` — control plan.
- `_bmad-output/solver-data/chaintargets-investigation-2026-05-03/result-no-chaintargets.json` — divergent result (1/7).
- `_bmad-output/solver-data/chaintargets-investigation-2026-05-03/result-with-chaintargets.json` — baseline result (4/7).
- This memo — `_bmad-output/solver-data/chaintargets-investigation-2026-05-03.md`.
