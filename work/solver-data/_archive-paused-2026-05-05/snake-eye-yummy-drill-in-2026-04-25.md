# Snake-Eye-Yummy Drill-In — 2026-04-25

**Why this fixture**: most-invested archetype (snake-eye + yummy = 2 expertise files, 9 authored bridges, 113 catalog entries) but lowest matched ratio (1/7) in the cross-fixture audit. Worst-performing per-investment ROI in the corpus.

**Run**: `npx tsx scripts/audit-fixture.ts --fixture=snake-eye-yummy-opener --node-budget=400 --budget-ms=300000` from HEAD `8443516d`.

**Result**: score=10, depth=46, nodes=3077, wallMs=34862. **goalMatchPoints=0**, latentPoints=0, fallbackPoints=1.

---

## Expected vs Peak (the actual mismatch)

### Expected board (canonical Snake-Eye Yummy hybrid line)
| Zone | Card | Position |
|---|---|---|
| MZONE | Lollipo★Yummy Way | defense (Xyz Rank 1) |
| MZONE | Snake-Eyes Flamberge Dragon | attack |
| MZONE | Silhouhatte Rabbit | attack |
| SZONE | Yummy☆Surprise | set |
| SZONE | Angel Statue - Azurune | set |
| SZONE | I:P Masquerena | set |
| FIELD | Divine Temple of the Snake-Eye | set |

### Peak board (what solver found)
| Zone | Card |
|---|---|
| **M1** | **Snake-Eyes Doomed Dragon** (face-up atk) ← *NOT in expected* |
| S1 | Triple Tactics Thrust (facedown) |
| S2 | Triple Tactics Talent (facedown) |
| FIELD | **Divine Temple of the Snake-Eye** ✓ matches |
| EMZ_L | Linkuriboh |

**Real matched count = 1** (only Divine Temple in correct zone). The audit's "MATCHES expected" annotation incorrectly flags 3 ED cards (Lollipo/I:P/Silhouhatte) — they're face-down in EXTRA, not materialized in MZONE/SZONE as expected. evaluate-structural's `zoneMatches` correctly rejects them (yielding the actual 1/7).

---

## Failure mode identified : **Scorer-proxy / canonical-line divergence**

The solver took a **completely different line**:

```
NS Snake-Eye Ash → search Mignon (Yummy starter)
Activate Mignon (Yummy mechanic)
Activate Triple Tactics Thrust + Talent (interruption value)
Re-activate Snake-Eye Ash → cost = Mignon to GY
Activate Poplar (somewhere in chain)
Activate Divine Temple (FIELD) ✓
SS Linkuriboh
SS Snake-Eyes Doomed Dragon (apex monster)
```

This finds a **defensible 1-monster endboard** (Doomed Dragon body + Triple Tactics backrow + Divine Temple) but bears no resemblance to the expected **3-monster + 3-trap Snake-Eye Yummy hybrid**.

**Score breakdown reveals why**:
- `interruptionScore: 10` (1 targetedNegate + 9 weighted) — Doomed Dragon line scores OK on interruptions
- `explorationScore: 10` — same
- `goalMatchPoints: 0` — **no goal in expertise matches this peak**
- `latentPoints: 0` — no latent intermediate signal triggered

The Solver's RouteAwareRanker has expertise for snake-eye but the goals don't recognize Doomed Dragon as a valid waypoint OR apex for this fixture's canonical line.

---

## Three distinct findings

### Finding A — Scorer optimizes for interruption value, not canonical line
The solver picks the path that maximizes interruption + exploration scores. Doomed Dragon line gives 10+10 = 20. The canonical Lollipo+Flamberge+Silhouhatte line might also give comparable interruption, but the solver doesn't see why it'd be better — without `goalMatchPoints` reward for that specific apex, it picks the local optimum.

**Implication**: more bridges/goals describing the canonical line would let the scorer prefer it. Specifically missing:
- Bridge `lollipo-yummy-xyz-summon` (Lollipo as Rank 1 Xyz)
- Bridge `flamberge-dragon-snake-eye-finisher`
- Bridge `silhouhatte-rabbit-protect-pivot`
- Bridge `yummy-surprise-set-from-extra` (the set-trap aspect)

### Finding B — Diabellstar SZONE bridge (Phase 10c) NOT utilized
Today's authored bridge `snake-eye-diabellstar-szone-continuous-spell-setup-bridge` is in expertise. The peak board does NOT contain Diabellstar in SZONE. The action trace shows Diabellstar might be revealed somewhere (via Divine Temple activation) but never lands in SZONE.

**Hypotheses**:
1. RL hasn't trained on the new bridge's weights yet (committed today) → next training run might pick it up
2. The bridge requires Foolish Burial in hand (`requiresInitialState`) — fixture doesn't have Foolish Burial in deck, so DFS can't trigger this bridge
3. The DFS's exploration order doesn't reach Diabellstar SZONE state within node-budget

**Quick verification**: check fixture's deck for Foolish Burial (cardId 81439173). If absent, the bridge is unreachable for this fixture regardless of RL.

### Finding C — Score=10 here vs 23.2 in batch eval
audit-fixture run gave score=10, while batch eval gave 23.2. Different DFS configuration (algorithm? speed? per-iteration TT?). Inconsistency worth investigating — same fixture should give same score under same config.

---

## Concrete actionables

### For RL team

**P1 — Verify training data after today's commits**
- Re-run RL training cycle with HEAD `8443516d` weights
- Specifically check if bridge `snake-eye-diabellstar-szone-continuous-spell-setup-bridge` appears in trained-weights edge list
- If yes: re-evaluate snake-eye-yummy fixture, see if matched > 1
- If no: bridge is in expertise but graph doesn't include its edges (verify enumerate-edges output)

**P2 — Goal coverage gap for snake-eye-yummy canonical line**
- Author 2-3 bridges describing Lollipo/Flamberge/Silhouhatte apex paths
- This shifts goalMatchPoints away from generic Snake-Eye finishers (Doomed Dragon) toward fixture-specific canonical
- Cost: ~3-6h authoring (Phase 10c-style)

### For scoring infrastructure

**P3 — Investigate score divergence (10 vs 23.2)**
- Same fixture, same node-budget (400), different scores in audit-fixture vs evaluate-structural
- Suggests a non-deterministic component or config drift between scripts
- Critical for reproducibility before RL training comparisons

### For test fixture quality

**P4 — Reconsider expectedBoard for snake-eye-yummy fixture**
- The 7-piece canonical line is HIGH ceiling — even strong human players don't always reach it from this exact opening
- If the line is actually unreachable from this hand+deck combo, no solver/RL improvement helps
- Verify by manual play / oracle text analysis

---

## What this drill-in tells us about the methodology

This is exactly the **proxy-vs-target gap** the scoring methodology has — the solver optimizes a proxy (interruption + exploration scores) that approximates "good endboard" but doesn't pin to a specific canonical line. For:
- Combo testing where ANY valid finisher counts → current methodology works
- Fixture validation where a SPECIFIC line is canonical → scorer needs goal-match coverage

For the solo combo testing scope (per the strategic discussion), the question is: **does the user care which specific finisher the solver finds, or just that A finisher emerges?**

If "any finisher" → the 1/7 matched ratio is misleading. Solver actually performs OK (Doomed Dragon body is a reasonable endboard).

If "the canonical 7-piece" → significant authoring + scorer work needed.

This is a **product-design question**, not a technical one. Worth clarifying before more authoring or scorer tuning.

---

## Raw output

Full audit log: `/tmp/snake-eye-drill.log` (peak board, action trace, scoreBreakdown).

Re-run command: `cd duel-server && npx tsx scripts/audit-fixture.ts --fixture=snake-eye-yummy-opener --node-budget=400 --budget-ms=300000`
