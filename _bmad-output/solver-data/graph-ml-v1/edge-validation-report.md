# Edge Validation — `summon-then-trigger` Precision Audit (2026-04-25)

Audits all 4285 edges in `edges-all.json`. Focus : pattern 2
(`summon-then-trigger`) edges where the to-effect has a `condition.simpleFilter`
predicate that gates the trigger by summon-type (e.g., `fusionSummoned`).
The current `enumerate-edges.ts:506` only checks the event code, not the
condition predicates → false-positives slip through.

## Outcome

| Outcome | Count |
|---|---:|
| Edges not in scope (other patterns) | 3697 |
| Validated (no summon-type gate) | 508 |
| **False-positive (fusionSummoned mismatch)** | **0** |
| Needs parser upgrade (synchro/xyz/link/ritual gates) | 80 |
| Catalog miss (to-effect) | 0 |
| Catalog miss (from-effect) | 0 |
| **TOTAL** | **4285** |

## Recommendations

1. **Patch `enumerate-edges.ts:506`** : when `toEff.condition.simpleFilter.predicates` contains a `fusionSummoned` (and other summon-type) gate, intersect with `fromEff.categories` membership of the corresponding category. Reject the edge when the gate is incompatible.
2. **Parser upgrade for non-Fusion summon types** : currently the catalog only marks `CATEGORY_FUSION_SUMMON` explicitly. Synchro/Xyz/Link/Ritual summons need their own category flags (or a normalised "summon-type" enum) so the validator can apply the same logic.
3. **Re-train weights with cleaned graph** : every false-positive edge ate ES gradient capacity without yielding learning signal. After cleanup, the same training budget should produce sharper weights.
