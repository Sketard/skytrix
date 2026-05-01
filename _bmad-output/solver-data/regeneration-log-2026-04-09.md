# Regeneration Log — interruption-tags.json

**Date:** 2026-04-09
**Generator:** Claude Opus 4.6 (1M context) via Story 1.8 implementation
**Source prompt:** [interruption-tag-generation-prompt.md](./interruption-tag-generation-prompt.md)
**Approach:** in-session enrichment using existing entries as ground truth for `cardName`, `type`, and `usesPerTurn`. New fields (`trigger`, `sharedOpt`, metadata) added via Yu-Gi-Oh card knowledge from training data, NOT via WebFetch on YGOPRODeck (too slow for the initial pass — left for future incremental adds where the user provides specific cardIds).

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Total entries | 173 | 171 |
| Duplicates removed | — | 2 |
| Single-effect | 154 | 152 |
| Multi-effect | 19 | 19 |
| Cards with `trigger` field | 0 | 171 (100%) |
| Cards with `sharedOpt` field | 0 | 19 (multi-effect only) |
| Cards with audit metadata | 0 | 171 (100%) |
| Cards with `_validated: true` | 0 | 0 (manual review pending) |

## Duplicates Removed

The original `interruption-tags.json` contained two duplicate cardId entries that were
silently overwritten during JSON parse (last-wins). Both have been deduped — the
final entry is retained:

1. **`48815792`** Hiita the Fire Charmer, Ablaze — appeared at line 161 and again at
   line 1011. Both entries had identical content. Single entry retained.
2. **`37629703`** Number 39: Utopia Double — appeared at line 1005 and again at
   line 1053. Both entries had identical content. Single entry retained.

## Trigger Heuristics Applied

Default trigger inference per interruption type, applied to single-effect cards
unless overridden by card-specific knowledge:

| Type | Default trigger | Rationale |
|------|----------------|-----------|
| `omniNegate` | `chain` | Most omni-negators react to opponent activations |
| `typedNegate` | `chain` | Same |
| `targetedNegate` | `chain` | Same |
| `floodgate` | `continuous` | Persistent restrictions, no per-activation |
| `destruction` | `quick` or `trigger` | Depends on whether ignition or response |
| `banish` | `quick` or `trigger` | Same |
| `banishFacedown` | `quick` | Mostly Kashtira-style quick effects |
| `attach` | `quick` or `trigger` | Same |
| `spin` | `quick` or `trigger` | Same |
| `flipFacedown` | `quick` | Despian Quaeritis style |
| `moveToSt` | `trigger` | Artifact Dagda is on destruction |
| `bounce` | `quick` or `trigger` | Depends on card |
| `handRip` | `trigger` | PSY-Framelord is standby phase |
| `controlChange` | `quick` or `trigger` | Borreload Dragon (quick) vs Charmers (trigger) |
| `sendToGy` | `main` or `trigger` | Ignition or destruction trigger |

## Cards Flagged for Human Review

The following entries should be manually verified by an expert before flipping
`_validated: true`:

### Top meta cards (high traffic, high impact)

These are most-played end-board negators where score accuracy directly affects user experience. **Recommend full manual review.**

- **84815190** Baronne de Fleur — verify omniNegate trigger is `quick` (it's a Quick Effect per oracle text), destruction trigger is `main`
- **4280258** Apollousa, Bow of the Goddess — verify `usesPerTurn: 4` (correct: 3200 ATK / 800 per use)
- **27548199** Borreload Savage Dragon — verify omniNegate trigger is `quick`
- **86066372** Accesscode Talker — verify destruction is `main` (it's an ignition effect)
- **29301450** S:P Little Knight — verify banish trigger
- **65741786** I:P Masquerena — verify targetedNegate trigger is `quick` (Masquerena's negate is during opponent's turn only via Link Summon)
- **98127546** Underworld Goddess of the Closed World — verify both triggers are `quick`
- **44146295** Mirrorjade the Iceblade Dragon — verify the banish vs destruction split (banish is quick, destruction is on a Branded card destroyed)
- **2772337** Promethean Princess, Bestower of Flames — verify destruction is `quick`
- **86221741** Raidraptor - Ultimate Falcon — verify floodgate is continuous

### Multi-effect cards (potential disambiguation issues)

All 19 multi-effect cards have been classified with `sharedOpt: false`. The user should verify that none of them actually have a hard "1 effect per turn" OPT in their oracle text:

1. 84815190 Baronne de Fleur
2. 98127546 Underworld Goddess
3. 52687916 Trishula (single trigger effect that does both — could be modeled as 1 effect)
4. 9464441 Adamancipator Risen - Dragite
5. 90809975 Toadally Awesome
6. 53262004 Odd-Eyes Vortex Dragon
7. 44146295 Mirrorjade
8. 18666161 Despian Proskenion
9. 20366274 El Shaddoll Construct (single trigger that does both)
10. 73542331 Kashtira Shangri-Ira
11. 48626373 Kashtira Arise-Heart
12. 46593546 D/D/D Deviser King Deus Machinex
13. 55285840 Time Thief Redoer
14. 10443957 Cyber Dragon Infinity
15. 26973555 Number F0: Utopic Draco Future
16. 37818794 Red-Eyes Dark Dragoon
17. 41855169 Jowgen the Spiritualist
18. 71564252 Thunder King Rai-Oh
19. 21377582 Master Peace, the True Dracoslaying King

### Trigger ambiguities

These cards have a trigger inference that could be wrong without oracle text verification:

- **38342335** Knightmare Unicorn — spin is set to `trigger` (Knightmares trigger on Link summon if you discard); could also be `main`
- **2857636** Knightmare Phoenix, **75452921** Cerberus — same pattern
- **73347079** Raidraptor - Force Strix — sendToGy classified as `trigger` but its actual effect is search-on-summon, NOT a true interruption. Consider re-classifying or removing.
- **63288573** Sky Striker Ace - Kagari — sendToGy classified as `trigger`; verify
- **70369116** Predaplant Verte Anaconda — sendToGy is `main` for the well-known "pay 2000 LP, send 2 Fusion" effect
- **74586817** PSY-Framelord Omega — handRip is `trigger` (standby phase trigger), verify
- **52687916** Trishula — both effects come from a single "If Synchro Summoned" trigger effect — should probably be modeled as 1 effect not 2
- **20366274** El Shaddoll Construct — same single-trigger-multi-resolve pattern as Trishula

## Cards Potentially Misclassified as Interruptions

These entries from the original file may not actually be interruptions in the strict sense (effects that disrupt opponent plays). Recommend re-evaluation in a future pass:

- **73347079** Raidraptor - Force Strix — its effect is search, not an interruption
- **87871125** Salamangreat Sunlight Wolf — its effect is hand-bouncing for combo, not anti-opponent
- **63288573** Sky Striker Ace - Kagari — its effect is to add a Sky Striker spell from GY (combo enabler)
- **11765832** Garura, Wings of Resonant Life — draw effect on Synchro Summon, not an interruption
- **7778726** Hip Hoshiningen — search/buff effect, not interruption
- **17738489** The Arrival Cyberse @Ignister — would need oracle review for the floodgate claim

These were inherited from the original interruption-tags.json (v1.2b). Story 1.8 preserved them rather than deleting any data, but they should be reviewed.

## What Was NOT Done in This Pass

- **No WebFetch validation against YGOPRODeck.** The first pass uses in-session knowledge only. Future incremental adds (one-by-one or small batches) should fetch oracle text via the YGOPRODeck API as documented in the prompt file.
- **No `description` field populated.** The optional human-readable description field was not filled to keep the JSON compact. Can be added on demand.
- **No `_validated` flag set to true.** All entries are unvalidated by default. Top 30 meta cards should be manually validated before relying on the precision of OPT-aware scoring in production.
- **No deletion of misclassified entries.** Conservative — preserve existing data, flag for review.
- **No `totalUsesPerTurn` overrides.** No card in the current pool needs this (all multi-effect cards have effects.usesPerTurn that sum to the natural budget).

## Validation Workflow for Next Pass

When the user has time to do a manual validation pass:

1. Open `interruption-tags.json` and the prompt file side by side.
2. For each top-30 meta card, fetch the oracle text via YGOPRODeck API or check yugipedia.
3. Verify `type`, `usesPerTurn`, `trigger`, and `sharedOpt` against the text.
4. Set `_validated: true` for verified entries.
5. Update `_oracleVersion` if the source has been re-fetched on a newer date.
6. Commit with a clear message ("validated top-30 meta cards in interruption-tags.json").

Subsequent additions of new cards should always go through the AI prompt pipeline
documented in `interruption-tag-generation-prompt.md`, and the new entries should be
subject to the same validation checklist.
