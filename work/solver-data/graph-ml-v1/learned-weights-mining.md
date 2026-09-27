# Learned Weights Mining — Grammar-Authoring Insights (2026-04-25)

Top-15 edges (by |weight|) per archetype-trained weight file. Each edge
= a learned action-ordering preference (positive = preferred ; negative = avoided).
Coverage column flags whether the from/to card is already in an
archetype-expertise file.

**Use as** : suggestions for new bridges/goals to author manually, or
sanity-check on existing coverage.

---

## ⚠ Critical Context — Framework Architecture (F12)

Two structural caveats that change how to read this report :

**(1) `GraphGuidedRanker` is a hard override, NOT a soft bias.**
In `graph-guided-ranker.ts:84`, `rank()` sorts by `(y.bonus - x.bonus)`
as primary key, base-ranker order as secondary. Any action with non-zero
outgoing-weight sum is ranked above any action with smaller sum,
regardless of base ranker score. Comment says "tie-break preserving base
semantics" but implementation reorders by bonus first.

**Consequence**: trained weights don't *nudge* the strategic-grammar
decisions — they *replace* them for any action with edges in the graph.
This is why SCALE is invariant (calibration sweep 25/50/200/500 produced
identical 362.81 aggregate) : uniform scaling preserves ordering, primary
sort unchanged.

**(2) Card-level aggregation collapses effect signal.** `graphBonus(action)` =
sum of ALL outgoing edges from `action.cardId`, regardless of which effect
the action invokes. So the surfaced edges below should be read as
"ES learned that THIS PAIR of cards is good/bad", not "this exact
effect-to-effect transition".

**Reinterpretation of top edges below**:
- Positive in-deck edge = "when both cards are in deck, the from-card
  earned a positive net outgoing-weight sum, so it gets ranked higher
  than other cards in the same prompt"
- Negative = "from-card got a net-negative sum, so it gets ranked LOWER"
- Magnitude is comparable WITHIN an archetype but not across (mean |w|
  varies 3-4× across files).

---

## branded

Training fixture: `branded-dracotail-opener`.  Deck size: 38 unique cardIds.
Active edges: 267 (267 tier-A, 659 zero non-tier).  In-deck edges: **29** ✓
Mean |w| = 1.124.  Max |w| = 4.754.

> ⚠ 238 of 267 active edges are on cards NOT in this fixture's deck.
> Their weights drifted during training without learning signal — treat as initialisation noise.
> Tables below filter to **in-deck edges only** (the meaningful subset).

### Top 10 positive in-deck (ES learned : prefer these transitions)

| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \| to-cov |
|---|--------|--------------------------------------|--------|-------------------|
| 1 | 3.259 ✓ | 6153210 (Ketu Dracotail) e1 → 75003700 (Dracotail Lukias) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 2 | 1.527 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 70534340 (Lubellion the Searing Dragon) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap, branded/goal:branded-mirrorjade-line |
| 3 | 1.403 ✓ | 6153210 (Ketu Dracotail) e1 → 33760966 (Dracotail Arthalion) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap, branded/goal:branded-dracotail-canonical-full, branded/goal:branded-dracotail-4mzone-partial, branded/goal:dracotail-arthalion-secreterion-duo |
| 4 | 1.188 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 73819701 (Fallen of the White Dragon) e2a | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap |
| 5 | 1.167 ✓ | 84477320 (Dracotail Phryxul) e1b → 75003700 (Dracotail Lukias) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 6 | 0.744 ✓ | 84477320 (Dracotail Phryxul) e1a → 75003700 (Dracotail Lukias) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 7 | 0.442 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 73819701 (Fallen of the White Dragon) e2b | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap |
| 8 | 0.231 ✓ | 6153210 (Ketu Dracotail) e1 → 75003700 (Dracotail Lukias) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 9 | 0.059 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 84477320 (Dracotail Phryxul) e1a | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap |
| 10 | 0.007 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 33760966 (Dracotail Arthalion) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap, branded/goal:branded-dracotail-canonical-full, branded/goal:branded-dracotail-4mzone-partial, branded/goal:dracotail-arthalion-secreterion-duo |

### Top 10 negative in-deck (ES learned : avoid these transitions)

| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \| to-cov |
|---|--------|--------------------------------------|--------|-------------------|
| 1 | -4.449 ✓ | 44482554 (Dracotail Pan) e2 → 75003700 (Dracotail Lukias) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 2 | -4.048 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 87746184 (Albion the Branded Dragon) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap, branded/goal:branded-albion-milled |
| 3 | -3.098 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 68468459 (Fallen of Albaz) e1b | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap |
| 4 | -2.530 ✓ | 6153210 (Ketu Dracotail) e1 → 84477320 (Dracotail Phryxul) e1a | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 5 | -2.477 ✓ | 84477320 (Dracotail Phryxul) e1a → 75003700 (Dracotail Lukias) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 6 | -1.994 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 84477320 (Dracotail Phryxul) e1b | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| branded/roleMap |
| 7 | -1.774 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 72578374 (Khaos Starsource Dragon) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| — not covered |
| 8 | -1.260 ✓ | 6153210 (Ketu Dracotail) e1 → 84477320 (Dracotail Phryxul) e1b | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 9 | -1.193 ✓ | 44482554 (Dracotail Pan) e2 → 84477320 (Dracotail Phryxul) e1b | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | branded/roleMap \| branded/roleMap |
| 10 | -0.948 ✓ | 38811586 (Albion the Sanctifire Dragon) e3 → 76666602 (The Dragon that Devours the Dogma) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| — not covered |

## ryzeal-mitsurugi

Training fixture: `ryzeal-mitsurugi-opener`.  Deck size: 42 unique cardIds.
Active edges: 267 (267 tier-A, 659 zero non-tier).  In-deck edges: **46** ✓
Mean |w| = 0.362.  Max |w| = 1.177.

> ⚠ 221 of 267 active edges are on cards NOT in this fixture's deck.
> Their weights drifted during training without learning signal — treat as initialisation noise.
> Tables below filter to **in-deck edges only** (the meaningful subset).

### Top 10 positive in-deck (ES learned : prefer these transitions)

| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \| to-cov |
|---|--------|--------------------------------------|--------|-------------------|
| 1 | 0.684 ✓ | 72238166 (Node Ryzeal) e2 → 35844557 (Sword Ryzeal) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap |
| 2 | 0.646 ✓ | 17954937 (Mitsurugi Great Purification) e2 → 40543231 (Mitsurugi no Mikoto, Aramasa) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-habakiri-endboard \| mitsurugi/roleMap |
| 3 | 0.589 ✓ | 17954937 (Mitsurugi Great Purification) e2 → 19899073 (Ame no Murakumo no Mitsurugi) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-habakiri-endboard \| mitsurugi/roleMap, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-tempest-finisher |
| 4 | 0.549 ✓ | 8633261 (Ice Ryzeal) e2 → 84433129 (Star Ryzeal) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap |
| 5 | 0.430 ✓ | 8633261 (Ice Ryzeal) e2 → 34909328 (Ryzeal Detonator) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap, ryzeal/goal:ryzeal-canonical-endboard, ryzeal/goal:ryzeal-xyz-tower-partial, ryzeal/goal:ryzeal-detonator-solo, mitsurugi/goal:ryzeal-mitsurugi-hybrid-apex |
| 6 | 0.399 ✓ | 8633261 (Ice Ryzeal) e2 → 7511613 (Ryzeal Duo Drive) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap, ryzeal/goal:ryzeal-canonical-endboard, ryzeal/goal:ryzeal-xyz-tower-partial, ryzeal/goal:ryzeal-duo-drive-solo, mitsurugi/goal:ryzeal-mitsurugi-hybrid-apex |
| 7 | 0.399 ✓ | 17954937 (Mitsurugi Great Purification) e2 → 82782870 (Mitsurugi no Mikoto, Kusanagi) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-habakiri-endboard \| mitsurugi/roleMap |
| 8 | 0.393 ✓ | 13332685 (Ame no Habakiri no Mitsurugi) e2 → 40543231 (Mitsurugi no Mikoto, Aramasa) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor.target, mitsurugi/goal:mitsurugi-habakiri-endboard, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap |
| 9 | 0.380 ✓ | 17954937 (Mitsurugi Great Purification) e2 → 40543231 (Mitsurugi no Mikoto, Aramasa) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-habakiri-endboard \| mitsurugi/roleMap |
| 10 | 0.326 ✓ | 17954937 (Mitsurugi Great Purification) e2 → 40543231 (Mitsurugi no Mikoto, Aramasa) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-habakiri-endboard \| mitsurugi/roleMap |

### Top 10 negative in-deck (ES learned : avoid these transitions)

| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \| to-cov |
|---|--------|--------------------------------------|--------|-------------------|
| 1 | -0.917 ✓ | 8633261 (Ice Ryzeal) e2 → 34022970 (Ext Ryzeal) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap |
| 2 | -0.826 ✓ | 17954937 (Mitsurugi Great Purification) e2 → 18176525 (Mitsurugi no Mikoto, Saji) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-habakiri-endboard \| mitsurugi/roleMap, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor |
| 3 | -0.760 ✓ | 55397172 (Futsu no Mitama no Mitsurugi) e1 → 82782870 (Mitsurugi no Mikoto, Kusanagi) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap |
| 4 | -0.742 ✓ | 13332685 (Ame no Habakiri no Mitsurugi) e2 → 82782870 (Mitsurugi no Mikoto, Kusanagi) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor.target, mitsurugi/goal:mitsurugi-habakiri-endboard, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap |
| 5 | -0.707 ✓ | 55397172 (Futsu no Mitama no Mitsurugi) e1 → 40543231 (Mitsurugi no Mikoto, Aramasa) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap |
| 6 | -0.660 ✓ | 55397172 (Futsu no Mitama no Mitsurugi) e1 → 19899073 (Ame no Murakumo no Mitsurugi) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap, mitsurugi/goal:mitsurugi-murakumo-endboard, mitsurugi/goal:mitsurugi-tempest-finisher |
| 7 | -0.621 ✓ | 8633261 (Ice Ryzeal) e2 → 34022970 (Ext Ryzeal) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap |
| 8 | -0.553 ✓ | 55397172 (Futsu no Mitama no Mitsurugi) e1 → 18176525 (Mitsurugi no Mikoto, Saji) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor, mitsurugi/bridge:feral-imps-mikoto-ritual-tutor |
| 9 | -0.522 ✓ | 72238166 (Node Ryzeal) e2 → 34909328 (Ryzeal Detonator) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | ryzeal/roleMap \| ryzeal/roleMap, ryzeal/goal:ryzeal-canonical-endboard, ryzeal/goal:ryzeal-xyz-tower-partial, ryzeal/goal:ryzeal-detonator-solo, mitsurugi/goal:ryzeal-mitsurugi-hybrid-apex |
| 10 | -0.520 ✓ | 55397172 (Futsu no Mitama no Mitsurugi) e1 → 40543231 (Mitsurugi no Mikoto, Aramasa) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | mitsurugi/roleMap, mitsurugi/goal:mitsurugi-futsu-canonical, mitsurugi/goal:mitsurugi-tempest-finisher \| mitsurugi/roleMap |

## snake-eye

Training fixture: `snake-eye-yummy-opener`.  Deck size: 37 unique cardIds.
Active edges: 267 (267 tier-A, 659 zero non-tier).  In-deck edges: **107** ✓
Mean |w| = 0.558.  Max |w| = 2.509.

> ⚠ 160 of 267 active edges are on cards NOT in this fixture's deck.
> Their weights drifted during training without learning signal — treat as initialisation noise.
> Tables below filter to **in-deck edges only** (the meaningful subset).

### Top 10 positive in-deck (ES learned : prefer these transitions)

| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \| to-cov |
|---|--------|--------------------------------------|--------|-------------------|
| 1 | 2.031 ✓ | 48452496 (Snake-Eyes Flamberge Dragon) e3 → 90241276 (Snake-Eyes Poplar) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/bridge:snake-eye-flamberge-gy-dual-ss-bridge, snake-eye/bridge:doomed-dragon-alt-ss-snake-eye-zone-send-bridge.precond, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field \| snake-eye/roleMap, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.target, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.produces, snake-eye/bridge:bonfire-poplar-1card-snake-eye-ignition-bridge.target, snake-eye/bridge:bonfire-poplar-1card-snake-eye-ignition-bridge, snake-eye/bridge:bonfire-poplar-1card-snake-eye-ignition-bridge.produces, snake-eye/bridge:doomed-dragon-alt-ss-snake-eye-zone-send-bridge.precond, snake-eye/bridge:snake-eye-diabellstar-szone-continuous-spell-setup-bridge, snake-eye/goal:snake-eye-poplar-on-field |
| 2 | 1.866 ✓ | 2295440 (One for One) e1 → 10966439 (Marshmao☆Yummy) e2b | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| snake-eye/roleMap |
| 3 | 1.356 ✓ | 67098897 (Cooky★Yummy Way) e2 → 31425736 (Cupsy☆Yummy) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap |
| 4 | 1.254 ✓ | 67098897 (Cooky★Yummy Way) e2 → 93192592 (Lollipo★Yummy Way) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field |
| 5 | 1.083 ✓ | 93360904 (Yummyusment★Acroquey) e2 → 93192592 (Lollipo★Yummy Way) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field |
| 6 | 0.998 ✓ | 67098897 (Cooky★Yummy Way) e2 → 31603289 (Cupsy★Yummy Way) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge.produces, snake-eye/goal:snake-eye-cupsy-way-synchro-landed |
| 7 | 0.978 ✓ | 93192592 (Lollipo★Yummy Way) e1 → 68810435 (Cooky☆Yummy) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field \| snake-eye/roleMap |
| 8 | 0.978 ✓ | 93192592 (Lollipo★Yummy Way) e1 → 30581601 (Yummy★Snatchy) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field \| snake-eye/roleMap |
| 9 | 0.957 ✓ | 9674034 (Snake-Eye Ash) e3 → 90241276 (Snake-Eyes Poplar) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.produces, snake-eye/bridge:snake-eye-ash-oak-chain-ss, snake-eye/bridge:snake-eye-ash-oak-chain-ss.target, snake-eye/bridge:snake-eye-diabellstar-szone-continuous-spell-setup-bridge \| snake-eye/roleMap, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.target, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.produces, snake-eye/bridge:bonfire-poplar-1card-snake-eye-ignition-bridge.target, snake-eye/bridge:bonfire-poplar-1card-snake-eye-ignition-bridge, snake-eye/bridge:bonfire-poplar-1card-snake-eye-ignition-bridge.produces, snake-eye/bridge:doomed-dragon-alt-ss-snake-eye-zone-send-bridge.precond, snake-eye/bridge:snake-eye-diabellstar-szone-continuous-spell-setup-bridge, snake-eye/goal:snake-eye-poplar-on-field |
| 10 | 0.933 ✓ | 93192592 (Lollipo★Yummy Way) e2 → 31425736 (Cupsy☆Yummy) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field \| snake-eye/roleMap |

### Top 10 negative in-deck (ES learned : avoid these transitions)

| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \| to-cov |
|---|--------|--------------------------------------|--------|-------------------|
| 1 | -1.136 ✓ | 93360904 (Yummyusment★Acroquey) e2 → 68810435 (Cooky☆Yummy) e3 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap |
| 2 | -1.028 ✓ | 66975205 (Yummyusment☆Mignon) e2 → 30581601 (Yummy★Snatchy) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap |
| 3 | -0.987 ✓ | 2295440 (One for One) e1 → 9674034 (Snake-Eye Ash) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| snake-eye/roleMap, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.produces, snake-eye/bridge:snake-eye-ash-oak-chain-ss, snake-eye/bridge:snake-eye-ash-oak-chain-ss.target, snake-eye/bridge:snake-eye-diabellstar-szone-continuous-spell-setup-bridge |
| 4 | -0.931 ✓ | 2295440 (One for One) e1 → 29301450 (S:P Little Knight) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| snake-eye/roleMap |
| 5 | -0.877 ✓ | 93360904 (Yummyusment★Acroquey) e2 → 31425736 (Cupsy☆Yummy) e2 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap |
| 6 | -0.865 ✓ | 67098897 (Cooky★Yummy Way) e2 → 30581601 (Yummy★Snatchy) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap \| snake-eye/roleMap |
| 7 | -0.854 ✓ | 31603289 (Cupsy★Yummy Way) e2 → 10966439 (Marshmao☆Yummy) e2a | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge.produces, snake-eye/goal:snake-eye-cupsy-way-synchro-landed \| snake-eye/roleMap |
| 8 | -0.852 ✓ | 93192592 (Lollipo★Yummy Way) e2 → 10966439 (Marshmao☆Yummy) e2a | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field \| snake-eye/roleMap |
| 9 | -0.850 ✓ | 2295440 (One for One) e1 → 9674034 (Snake-Eye Ash) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | — not covered \| snake-eye/roleMap, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge, snake-eye/bridge:snake-eye-ash-1card-ignition-bridge.produces, snake-eye/bridge:snake-eye-ash-oak-chain-ss, snake-eye/bridge:snake-eye-ash-oak-chain-ss.target, snake-eye/bridge:snake-eye-diabellstar-szone-continuous-spell-setup-bridge |
| 10 | -0.824 ✓ | 31603289 (Cupsy★Yummy Way) e2 → 93192592 (Lollipo★Yummy Way) e1 | summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match) | snake-eye/roleMap, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge, snake-eye/bridge:cupsy-way-synchro-link-1-as-tuner-bridge.produces, snake-eye/goal:snake-eye-cupsy-way-synchro-landed \| snake-eye/roleMap, snake-eye/goal:snake-eye-yummy-canonical-apex, snake-eye/goal:snake-eye-yummy-trio-on-field |

## Cross-Archetype Consensus (in-deck edges only)

Edges in the top-15 of **at least 2** archetype-trained weight files,
AND in-deck (both endpoints) for the relevant training fixtures.

*No edges in the top-15 of multiple archetypes.* Each weight file emphasises different transitions — supports F11 conclusion that learning is archetype-specific (different optima) rather than discovering a universal action-ordering.

## Concrete Suggestions for Grammar-Authoring

Most actionable insights surfaced by the in-deck mining :

### Branded — top-2 patterns
1. **Pan→Lukias is BAD (-4.45)** but **Ketu→Lukias is GOOD (+3.26)**. Both involve summoning Lukias from different ED materials. ES learned Ketu is the preferred path, Pan is not. Currently `branded.json` has neither in a bridge — adding a goal/bridge that codifies "if Lukias goal active, prefer Ketu material" could capture this.
2. **Albion→Branded Albion is BAD (-4.05)** despite `branded-albion-milled` being an existing GOAL target. ES learned this transition leads to worse outcomes than e.g. Albion→Lubellion (+1.53). Suggests `branded-albion-milled` may be an attractor goal that traps DFS in a suboptimal line. Worth reviewing whether the goal's baselineScore is too high.

### Snake-eye — top-2 patterns
1. **Acroquey→Cooky is BAD (-1.14)** between two roleMap cards. Suggests Acroquey's e2 path to Cooky is sub-optimal versus other paths to Cooky (e.g., Lollipo→Cooky +0.98). Could codify in a bridge that prefers Lollipo-driven Cooky summons.
2. **Flamberge→Poplar (e3 → e3) is STRONG +2.03** — already covered by `snake-eye-flamberge-gy-dual-ss-bridge`. Sanity confirmed : the bridge encodes a correct preference.

### Ryzeal-mits — top-2 patterns
1. **Mitsurugi Great Purification → Aramasa is GOOD (+0.65)**, multiple effect variants positive. Already in goals. Confirmed correct.
2. **Futsu→Kusanagi/Aramasa transitions are NEGATIVE (-0.55 to -0.76)** despite being in `mitsurugi-futsu-canonical` goal. ES learned these specific paths are suboptimal — possibly because the Futsu->Aramasa→Kusanagi sequence over-commits. Goal review candidate.

## Cross-Archetype Reading

No edge is in the top-15 of ≥2 archetypes. Each archetype trained against
a fundamentally different decision landscape. F8 was thus partially right :
archetype-specific specialisation IS happening — just at the level of
which-edges-matter rather than transferable cross-pollination.

## Limitations

- **Architectural caveat (see F12)** : top-positive edges aren't guarantees the bonus made the strategic grammar layer happy — they just won the bonus-primary sort. A higher-priority `RouteAwareRanker` route may have been ignored.
- **Card-level only** : effect-level patterns (e.g., Albion e3 vs e1, Cooky e2 vs e3) aren't distinguishable in the trained weights despite the underlying graph capturing them.
- **Plateau gen 2** : surfaced edges are what early ES gradients pointed to — not necessarily a global optimum. More generations might produce different weights, but plateau (F1) suggests not transformatively different.
- **Reason field is monotone** : every top edge has reason "summon-then-trigger". The graph extraction doesn't differentiate between e.g., search-then-trigger, GY-recover, banish-and-revive. Richer reason categories in `enumerate-edges.ts` would surface more diverse insights.
