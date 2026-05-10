# Macro-Action DFS H1 + H1.5 — Diagnostic NULL, Pivot H3

**Date:** 2026-05-03
**Status:** EXPERIMENT COMPLETE — verdict NULL, infrastructure conservée, pivot H3
**Predecessor:** `macro-action-poc-2026-05-03.md` (POC Niveau 2 faisabilité OK)
**Question asked:** la promotion macro-DFS + scorer existant lift-elle le cum matched sur 69 fixtures vs prompt-DFS baseline (31/596) ?

## TL;DR

| Config | Cum matched | Cum score | vs baseline (31/596) |
|---|---|---|---|
| Baseline prompt-DFS canonical | 31/69 | 596 | — |
| H1 macro-DFS G2 (sans activationLog) | 23/69 | 218 | −8 / −378 |
| H1 macro-DFS pre-G2 | 23/69 | 218 | −8 / −378 |
| **H1.5 macro-DFS G2 (avec activationLog)** | **23/69** | **198** | **−8 / −398** |
| H1.5 macro-DFS pre-G2 | 23/69 | 198 | −8 / −398 |

**Critère succès** : cum matched ≥ 33/69. **Résultat : 23/69, NULL franc.**

## H1 — Promotion macro-DFS + scorer existant (mode β)

### Setup

- Harness standalone `evaluate-macro-dfs.ts` (390 LoC, 0 prod touched)
- 15 fixtures, 69 expected cards
- Budget canonical : nb=800, tb=12000ms
- `DefaultSubPromptPolicy` seule (pas de seeding canonical)
- Scorer : `InterruptionScorer.scoreWithCards(fs)` — sans activationLog (caveat noté)
- Granularités testées : G2 (produit cartésien sub-prompts non-triviaux) et pre-G2 (entry-point seul)

### Résultats

```
Macro-DFS G2     cum: 23/69 matched, 218 score, ratio 8.45, wall 146s
Macro-DFS pre-G2 cum: 23/69 matched, 218 score, ratio 8.45, wall  34s
                  Δ vs baseline: −8 matched, −378 score
```

### Observations clés

- **G2 et pre-G2 bit-identiques** sur matched/score/promptsTraversed. G2 ne fait que coûter 4× plus de wall-time (146s vs 34s) pour des branches que le budget de 800 nœuds n'atteint jamais. **Le pari Option A' (G2) ne paie pas à ce budget.**
- **6 régressions, 1 progression** : mitsurugi 3→0 (−66 score), branded 4→2 (−73), radiant-typhoon 3→2 (−38), kashtira 2→1, snake-eye 2→1, nekroz-ryzeal 2→1, dinomorphia 1→2.
- **Compression réelle 8.45 prompts/macro** mais ne suffit pas à compenser la perte du ranker production (`RouteAwareRanker` + `GoalMatch` + archetype expertise).

### Caveat identifié

`activationLog` non threadé vers `scoreWithCards` → OPT counters non débités → score H1 (218) potentiellement gonflé. Coût ~0.5j pour fix : H1.5.

## H1.5 — Threading propre activationLog + distinctActivations

### Setup

- Modification `macro-dfs.ts` (~95 LoC) : `MacroDfsConfig.tags`, `DfsState.activationLog`/`distinctActivations`, snapshot/restore aux branches DFS, `recordMacroActivation()` mirror bit-pour-bit de `OCGCoreAdapter.recordActivation:2180-2215`
- `_isEffectActivation` propagé sur `buildIdleCmdMacros.activate` et `buildChainMacros` via `isFieldActivation(location)`
- `disambiguateEffect()` réutilisé pour resolver effectIndex
- Harness threade les 3 args propres : `scoreWithCards(fs, activationLog, distinctActivations)`

### Résultats

```
H1.5 G2     cum: 23/69 matched, 198 score
H1.5 pre-G2 cum: 23/69 matched, 198 score
                  Δ vs H1: 0 matched, −20 score
                  Δ vs baseline: −8 matched, −398 score
```

### Diagnostic propre

- **Search bit-identique entre H1 et H1.5 sur 12/15 fixtures.** Les 3 divergences (radiant-typhoon, spright, floowandereeze) sont time-bound (jitter clock <1% prompt-count), pas dues au fix.
- **Score baisse de 20 points** : c'est le débit OPT correctement appliqué (Snake-Eye Ash, Diabellstar, etc. ne sont plus crédités à plein quand ils sont sur le board après activation). C'est **une correction honnête** — H1 sur-comptait.
- **Le fix scorer ne change pas la topologie du search** — il corrige juste l'eval des leaves.

## Diagnostic combiné H1 + H1.5

Le caveat `activationLog` était **réel mais pas la cause** du gap −8 matched. Le bottleneck est définitivement **search-side**, pas scoring-side.

Les régressions se concentrent sur les fixtures où :
- **Le branching factor à IDLECMD sature 800 nœuds** avant d'atteindre les apex lines (snake-eye 1/7, branded 2/8)
- **L'horizon de search est insuffisant sans ranker** pour diriger (D/D/D 1/5, mitsurugi 0/5)

Cohérent avec le POC Run B (D/D/D 0/5 sans seed entry-point). **La compression seule transfère le bottleneck, ne le résout pas.**

### Réfutation rétrospective des 9 NULL

L'hypothèse "les pilotes scorer/ranker ont nullé parce que dilués sur 272 prompts vs 31 macros" est **réfutée**. Au niveau macro avec scorer correctement câblé, on retrouve exactement le même mur. Soit le signal lui-même était insuffisant, soit le ranker prod a un problème de calibration que la compression ne corrige pas. Dans tous les cas, ajouter du signal scalaire à un endroit n'a pas d'avenir à budget canonical.

## Verdict

**NULL franc.** La compression macro-action seule (avec ou sans G2, avec ou sans activationLog correct) n'atteint pas le baseline canonical sur 69 fixtures.

## Décision pour la suite — Skip H2, pivot direct H3

**Pourquoi pas H2 (wirer ranker au niveau macro)** :
- `path-ranker-pilot-2026-05-02` (7e NULL) a déjà mesuré qu'un per-decision boost ne fonctionne pas
- Le ranker prod opère sur des Actions ; au niveau macro l'objet ranké est sémantiquement différent
- H1.5 prouve que le scorer terminal sans guidage de search ne dirige pas vers les apex
- Coût ~3-5j pour potentiellement reproduire un 10e NULL côté ranker

**Pourquoi H3 (Path β industrialisé) est le pari rationnel** :
- Path β v2 a livré **+17 matched cum sur 11 fixtures audited** (`path-beta-v2-aggregate-2026-05-03`)
- Le LLM raisonne déjà au niveau macro — le bridge LLM↔macro-DFS devient naturel
- L'infra macro-DFS (POC + H1 + H1.5) est **réutilisable comme verifier** : un plan LLM = séquence de macros → rejoué mécaniquement → matched/score précis
- Le fix activationLog de H1.5 = bonus gratuit pour scoring précis des trajectoires LLM

## Infrastructure conservée (réutilisable pour H3)

| Fichier | LoC | Usage H3 prévu |
|---|---|---|
| `macro-action-types.ts` | 168 | Types pour `MacroAction` = output Path β |
| `macro-dfs.ts` | 957 | Verifier déterministe ; énumérateur réutilisable |
| `evaluate-macro-dfs.ts` | 400 | Harness 69 fixtures réutilisable pour eval H3 |
| `recordMacroActivation` + `disambiguateEffect` wiring | inclus | Scoring précis des plans Path β |

**0 fichier production modifié sur toute la séquence POC → H1 → H1.5.** Tout est gated par instanciation directe via script ; aucun risque de régression sur le pipeline canonical.

## Ce que la séquence a réellement produit

1. **Infrastructure macro-DFS propre** — promotion-ready, réutilisable comme verifier H3
2. **Fix threading scorer** — réutilisable pour évaluer n'importe quel plan macro
3. **Diagnostic empirique définitif** : bottleneck = search-side au niveau IDLECMD, pas scoring-side, pas compression-side
4. **Réfutation rétrospective des 9 NULL** : ils n'étaient pas dilués par la profondeur ; le mur est réel à tous niveaux d'abstraction. Investir dans des signaux scorer/ranker plus fins n'a pas d'avenir à budget canonical.

NULL diagnostic utile, pas NULL "on a perdu 4j".

## Files

- `duel-server/src/solver/macro-action-types.ts` — modifié H1 (+9 LoC pour `chosenSubPrompts`)
- `duel-server/src/solver/macro-dfs.ts` — modifié H1 (+260 LoC G2) + H1.5 (+95 LoC activationLog)
- `duel-server/scripts/evaluate-macro-dfs.ts` — créé H1 (~390 LoC) + threading H1.5 (+10 LoC)
- `duel-server/data/eval-macro-dfs/h1-default-{g2,pre-g2}.json` — H1 results
- `duel-server/data/eval-macro-dfs/h1-5-default-{g2,pre-g2}.json` — H1.5 results
- `_bmad-output/solver-data/macro-action-poc-2026-05-03.md` — memo POC prédécesseur
