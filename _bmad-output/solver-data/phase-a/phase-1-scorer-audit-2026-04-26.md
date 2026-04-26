# Phase 1 — Scorer audit + tag coverage gap closure

**Date:** 2026-04-26.
**Goal:** verify the scorer is the trustworthy ground truth before Phase B
trains on it. Per Phase 0 honest-baseline memo, the scorer is the only
remaining objective signal once scaffolding is removed.
**Outcome:** the scorer is **structurally honest but blind to large parts of
its objective**. Tag coverage was 47.8% — i.e., 36 of 69 expectedBoard cards
had no interruption tag, including 100% of stun-runick and 71% of
snake-eye-yummy. After adding 15 tags + removing D/D archetype hardcode,
honest baseline lifts +5 matched (15→20) and the scorer is now deck-agnostic.

## Audit findings

### 1. Tag coverage gap (the real Phase 1 issue)

Initial state: 33/69 expectedBoard cards tagged (47.8%). Per fixture:

| Fixture | tagged | gap |
|---|---|---|
| ddd-pendulum-opener | 5/5 | — |
| radiant-typhoon-opener | 3/3 | — |
| ryzeal-mitsurugi-opener | 3/5 | Duo Drive, Mitsurugi |
| branded-dracotail-opener | 6/8 | Cartesia, Mululu |
| kashtira-azamina-opener | 1/4 | Ilia Silvia, Dracossack, WANTED |
| horus-crystron-opener | 1/4 | Quariongandrax, Imsety, Sarcophagus |
| dinomorphia-opener | 1/3 | Domain, Intact |
| spright-opener | 2/4 | Red, Carrot |
| snake-eye-yummy-opener | 2/7 | Yummy Way, Silhouhatte, Y☆Surprise, Azurune, Snake-Eye Temple |
| tearlaments-opener | 2/4 | Kaleido-Heart, Fiendsmith Requiem |
| floowandereeze-opener | 1/4 | Apex Avian, Nightingale, Map |
| labrynth-opener | 1/4 | Big/Small Welcome, Transaction Rollback |
| **stun-runick-opener** | **0/4** | Hugin, Fountain, Rivalry, Freezing Curses |
| nekroz-ryzeal-opener | 1/4 | Duo Drive, Trishula, Kaleidoscope |
| branded-mirrorjade-line | 4/6 | Sanctifire, Faimena |

Stun-runick at 0/4 means the scorer was COMPLETELY BLIND to its expected
endboard. ES on this scorer cannot distinguish "reached canonical stun-runick"
from "did nothing".

### 2. Triage of 36 missing cards

Read full oracle text from `cards.cdb` for each. Classified per the
interruption-tag-generation-prompt rules:

**TAG (15 cards — real interruption pieces):**
- 46396218 Azamina Ilia Silvia — Tribute-self omniNegate (quick)
- 22110647 Mecha Phantom Beast Dracossack — Tribute-PhantomBeast destruction
- 13455674 Crystron Quariongandrax — On-Synchro banish (persistent removal)
- 7336745 Dinomorphia Intact — Pay LP typedNegate (monster) + destruction
- 75922381 Spright Red — Tribute Lv2-mat typedNegate (monster, quick)
- 2311090 Spright Carrot — Tribute Lv2-mat typedNegate (S/T, quick)
- 44822037 Angel Statue Azurune — Sacrifice Cont. Trap mon: typedNegate (anti-SS) + destruction
- 28226490 Tearlaments Kaleido-Heart — On-SS or Aqua-to-GY: spin
- 29587993 Mist Valley Apex Avian — Self-bounce omniNegate (quick)
- 92714517 Big Welcome Labrynth — GY: bounce 1 opp card (sharedOpt 1/turn)
- 90846359 Rivalry of Warlords — floodgate (1 type per side)
- 30430448 Runick Freezing Curses — Quick: typedNegate (monster)
- 52068432 Nekroz of Trishula — handtrap targetedNegate + on-Ritual banish×3
- 29369059 Yummy☆Surprise — bounce 2 opp cards
- 1528054 Silhouhatte Rabbit — On Cont-Trap-summoned-as-mon: destroy 1 opp S/T

**NULL (15 cards — combo enablers / non-interruption per prompt rules):**
- 95515789 Cartesia, 7375867 Mululu, 1498449 Faimena (Quick Fusion combo enablers)
- 7511613 Ryzeal Duo Drive (search/material recycle, -100 ATK debuff insignificant)
- 80845034 WANTED: Seeker (search Diabellstar, GY recycle)
- 84941194 Imsety, 16528181 King's Sarcophagus (Horus combo + own protection)
- 26631975 Dinomorphia Domain (Fusion combo + anti-burn protection)
- 28126717 Floowandereeze Map (Normal Summon manipulation)
- 5380979 Welcome Labrynth (own-turn SS + own-side lock)
- 6351147 Transaction Rollback (Normal Trap copy mechanism — opaque to classifier)
- 55990317 Hugin the Runick Wings (search + own-protection redirection)
- 92107604 Runick Fountain (meta-enabler, not direct interruption)
- 51124303 Nekroz Kaleidoscope (Ritual combo)
- 53639887 Divine Temple Snake-Eye (own-SS response, not opp disruption)
- 38811586 Albion Sanctifire Dragon (own-side SS during opp turn, no negate)
- 48608796 Lyrilusc Assembled Nightingale (multi-attacker)
- 2463794 Fiendsmith's Requiem (Tribute-self combo)
- 55397172 Futsu Mitsurugi (defensive own-SS response)
- 93192592 Lollipo Yummy Way (defensive bounce-self combo)

**Tag coverage post-fix: 48/69 (69.6%)**, up from 33/69 (47.8%).

Note: the 15 NULL classifications are valid per the interruption-tag-generation-
prompt rules, but they REVEAL a fixture-vs-scorer mismatch: some `expectedBoard`
entries are not actually interruption pieces. They're in the canonical endboard
because the human author considers them "the combo's natural finishers", but
they don't directly interrupt the opponent. This is a separate concern — under
the long-term vision, fixtures should specify expectedBoard as "the maximum-
interruptionScore endboard" rather than "the canonical/aesthetic endboard".

### 3. D/D hardcode removed

`DARK_CONTRACT_IDS` + `DOOM_QUEEN_MACHINEX_ID` constants and their latent
points (max 11) were archetype-tagged scaffolding. Per Phase 0 philosophy,
deleted from `interruption-scorer.ts`. Remaining latent: only Step 1
deck-agnostic structural F1/F2/F3 (ritual unlock, tutor chain, ED material pool).

Impact on D/D fixture: -8 cum explorationScore (the Doom-Queen-PZONE bonus
that fired at peak). matched unchanged.

### 4. Other audit items — quick checks

**fallbackPoints** (+1 per untagged face-up monster, max 7):
- Bounded by max field zones (5 MZONE + 2 EMZ).
- At honest baseline most fixtures show fallbackPoints ≤ 3.
- Not gameable to dominant levels. KEEP (small heuristic, not exploitable).

**Weight calibration** (sum=120, range 5-14, omniNegate=14, sendToGy=5):
- Distribution: floodgate (32 tags), typedNegate (25), targetedNegate (24),
  destruction (23), omniNegate (23). Weights ~ correlate with type's actual
  interruption value.
- KEEP as-is. Tuning weights is Phase B territory (could be ES-evolved
  alongside the neural ranker).

**Step 1 latent (F1/F2/F3 globalCap=15)**: deck-agnostic, bounded. KEEP.

## Eval impact

Canonical: `--budget-ms=6000 --node-budget=400 --pool-size=1`.

| Config | matched | score | Δ vs Phase 0 same config |
|---|---|---|---|
| (a) Status quo (expertise + Phase A) | 31/69 | **605** | +0 matched, +52 score |
| (c) Honest baseline (no scaffolding) | **20/69** | 209 | +5 matched, +35 score |

Per-fixture honest baseline lifts (config c, Phase 0 → Phase 1):
- spright: 1/4 → **3/4** (+2 — Spright Red + Carrot now seen)
- stun-runick: 0/4 → **2/4** (+2 — Rivalry + Freezing Curses, fixture was 100% blind)
- nekroz-ryzeal: 0/4 → **1/4** (+1 — Trishula handtrap-style negate)
- 12 other fixtures unchanged (some have new tags but DFS doesn't reach those states)

The +5 matched lift is real and comes from CORRECTLY VALUING the canonical
endboard pieces, not from scaffolding. Several other fixtures have new tags
that don't yet lift matched because DFS at the current ranker quality
doesn't reach those states — that's exactly the gap Phase B's neural ranker
should close (with deck-agnostic features that generalize search guidance
across decks).

## Decision criteria for Phase B (revised)

At honest config (no scaffolding), Phase B succeeds when:
- **cum matched ≥ 25-28/69** (+5-8 over Phase-1 honest baseline 20)
- **cum score ≥ 280+** (+70 over baseline 209)
- 0 individual-fixture regressions
- Critically: **lifts come from fixtures where DFS currently has tags but doesn't reach states** — Phase B's added value is search guidance, not scoring.

Specifically Phase B should help: snake-eye-yummy (3 new tags, 0 reach),
labrynth (1 new tag, 0 reach), kashtira (2 new tags, 0 reach),
floowandereeze (1 new tag, 0 reach in matched but +3 in score), tearlaments
(1 new tag, 0 reach), dinomorphia (1 new tag, 0 reach).

## Remaining gaps (deferred)

The 15 cards classified as NULL are valid per the prompt's interruption-only
scope. But they expose **fixture-vs-scorer mismatch** on cards like:
- Cartesia, Mululu, Faimena, Sanctifire (Branded combo Fusions)
- Imsety, Sarcophagus (Horus combo)
- Albion the Sanctifire Dragon (peculiar own-SS-during-opp-turn)
- Hugin the Runick Wings (own-protection redirection)
- Runick Fountain, Snake-Eye Temple (meta-enabling Field Spells)

These are part of expectedBoard because humans consider them "canonical
endboard pieces", but they're not interruption value. This is a fixture
cleanup task — out of Phase 1 scope. Long-term, expectedBoard should be
de-emphasized (per 2026-04-26 vision); this mismatch becomes irrelevant
when expectedBoard is validation-only.

## Files

- `duel-server/data/interruption-tags.json` — 15 new entries, total 175
- `duel-server/src/solver/interruption-scorer.ts` — D/D hardcode deleted
- `_bmad-output/solver-data/phase-a/eval-phase1-{a,c,c-final}.json` — eval artefacts
- `_bmad-output/solver-data/phase-a/phase-1-scorer-audit-2026-04-26.md` — this memo

## Next: Phase B (graph-ml-v2)

Scorer is now adequately calibrated for Phase B training:
- Coverage at 69.6% (good enough — remaining 30.4% is fixture-mismatch, not gap)
- D/D hardcode removed (deck-agnostic)
- fallbackPoints + weights validated (not exploitable)
- Step 1 latent kept (legitimate deck-agnostic structural)

Phase B can now train ES on pure `interruptionScore` fitness without the
gaming or bias risks identified pre-audit. Honest baseline 20/69 is the
real reference point.
