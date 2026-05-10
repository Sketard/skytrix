# Macro-Action DFS POC (Niveau 2) — Faisabilité technique CONFIRMÉE

**Date:** 2026-05-03
**Status:** POC COMPLETE — verdict FAISABILITÉ OK, GO conditionnel H1
**Predecessor:** 9 NULL solver-side consécutifs (resource scoring, path scoring, path ranker, value head, EFFECTYN compression Phase 2, verb-class policy, arch-c distillation, MCTS+priors, …) + Option G canonical bump (matched 27→31)
**Question asked:** un DFS qui search en macro-actions au lieu de prompt-by-prompt peut-il atteindre la canonical line 5/5 sur D/D/D dans le budget canonical (800 nœuds / 12s) ?

## TL;DR

| Métrique | Valeur |
|---|---|
| Run A — D/D/D + full canonical replay | **5/5 matched, 59 score, 40 macros, 271 prompts, 369ms** |
| Run B — D/D/D + seed sub-prompts only (DFS libre entry-point) | 0/5 matched, 800 macros explorés, budget exhausted |
| Run C — branded sans seed (DefaultSubPromptPolicy) | 2/8 matched, 800 macros, infrastructure OK |
| Compression effective | **6.78×** (271 prompts / 40 macros sur full canonical) |
| Build clean | ✅ TypeScript strict, 0 fichier production touché |

**Verdict** : la compression macro est mécaniquement faisable et propre. Le bottleneck du run B (matched 0/5) **n'est pas un défaut structurel** du macro-DFS — c'est la **sélection d'entry-point** non guidée. Le ranker doit opérer au niveau macro, pas au niveau prompt.

## Niveau 1 — Argument combinatoire (audit avant code)

Sur le raw-replay canonical D/D/D (`eb8c6865`, 5/5 par construction) :

| Métrique | Valeur |
|---|---|
| Prompts totaux exécutés | 272 |
| Prompts OWN player | 210 |
| Macro-actions sémantiques OWN | 31 (27 IDLECMD + 4 own active CHAIN) |
| Pass CHAIN auto (BF≈1) | 125 |
| Compression de profondeur | **8.8×** (272 → 31) |
| Profondeur effective prompt-tree | 478 bits |
| Profondeur effective macro-tree | 87 bits |
| Couverture budget 800 nœuds (prompt) | 2.01% |
| Couverture budget 800 nœuds (macro) | **11.0%** (×5.5) |

L'argument tenait sur papier : 8.8× moins de profondeur, 5.5× plus de coverage à budget égal.

## Niveau 2 — Implémentation et runs

### Architecture livrée

Trois fichiers, 100% standalone :

| Fichier | LoC | Rôle |
|---|---|---|
| `duel-server/src/solver/macro-action-types.ts` | 159 | Types réutilisables (`MacroAction`, `MacroNode`, `SubPromptPolicy`, `MacroEnumerator`) |
| `duel-server/src/solver/macro-dfs.ts` | 862 | Moteur + 2 policies (Default + SeededCanonical) + énumérateur OCGCore + `runMacroDfs(cfg)` |
| `duel-server/scripts/macro-dfs-poc.ts` | 408 | CLI (fixture loader, scorer, output JSON, modes) |

**0 modification** dans `dfs-solver.ts`, `ocgcore-adapter.ts`, `solver-orchestrator.ts`, `interruption-scorer.ts`, ni aucun autre fichier production.

### Mécanismes clés

- **Fork OCGCore** : via `WebAssembly.Memory` snapshot/restore (réplique du pattern `OCGCoreAdapter.forkViaSnapshot`). Pas de `duelClone` côté lib — le hook `WebAssembly.instantiate` capture la mémoire pour permettre snapshot/restore depuis le harness.
- **Énumération macro** : `enumerateLegalMacros(duelId, policy, ctx, stats)` avance OCGCore en absorbant les sub-prompts triviaux via la policy, jusqu'au prochain entry-point branchable (IDLECMD ou own CHAIN actif). Retourne 1 MacroAction par choix légal.
- **Politique sub-prompts** :
  - `DefaultSubPromptPolicy` — heuristiques fixes (PLACE = première zone légale, POSITION = atk, EFFECTYN = yes, opp CHAIN = pass, ANNOUNCE_NUMBER = max, RPS = 1/3 selon player)
  - `SeededCanonicalSubPromptPolicy` — lookup par fingerprint `(promptType, lastIdleResponseIndex, subPromptIdxInMacro)` depuis raw-replay seedé, fallback Default
  - Hook étendu `selectEntryPoint(legalMacros, ctx)` activé en mode `--full-canonical-replay` : matching par `(action_byte, index)` du raw-replay step pour replay déterministe

### Run A — full-canonical-replay D/D/D (validation pipeline)

```
fixture            = ddd-pendulum-opener
seed               = ddd-pendulum-replay-eb8c6865.raw-replay.json (272 raw steps)
budget             = 800 nodes / 12 s / depth 50
matched            = 5/5
bestScore          = 59
bestPath length    = 40 macros
macros explored    = 40
prompts traversed  = 271 (ratio 6.78)
wall time          = 369 ms
stopped            = tree-exhausted
policy stats       = trivial=0  seeded=232  auto-pass=0
entry-point sel    = seeded=40  dfsBranched=1
```

5/5 cartes attendues présentes (Deus Machinex / Caesar / Siegfried / Sky King Zeus Ragnarok / Headhunt). Le `dfsBranched=1` final correspond à un IDLECMD post-canonical (transition end-phase) hors couverture du raw-replay.

### Run B — D/D/D seed sub-prompts only

```
matched            = 0/5
bestScore          = 2
macros explored    = 800
prompts traversed  = 6644
wall time          = 2.9s
stopped            = budget-exhausted
entry-point sel    = seeded=0  dfsBranched=195
```

Conforme au baseline diagnostic. La policy seedée ne couvre QUE les sub-prompts mécaniques ; au moment d'un IDLECMD le DFS choisit aveuglément parmi 8-10 options et dilue son budget sur les mauvaises branches dès la racine.

### Run C — branded sans seed (sanity infra)

```
matched            = 2/8
bestScore          = 7
macros explored    = 800
prompts traversed  = 6132
wall time          = 2.7s
stopped            = budget-exhausted
entry-point sel    = seeded=0  dfsBranched=450
```

Pas de crash, exploration légale, score attendu bas. Infra macro générique fonctionne sur fixture inconnue.

## Diagnostic

Le pipeline macro est sain : il **peut reproduire** la canonical line entière (40 macros, 271 prompts, 5/5 matched en 369ms) quand on lui donne le bon entry-point à chaque nœud. Le bottleneck du Run B n'est PAS structurel — c'est la sélection d'entry-point.

**Conséquence** : la compression macro **transfère** le bottleneck de "profondeur de search" vers "qualité du ranker à entry-point". Elle ne le supprime pas. Cette observation est **rétrospectivement importante** pour interpréter les 9 NULL passés.

### Interprétation des 9 NULL à la lumière du POC

Tous les 9 pilotes ont essayé d'aider un DFS qui voyait un arbre 8.8× trop profond. À cette profondeur, ajouter un signal scalaire (path scoring, value head, verb-class policy, etc.) ne se compose pas — l'erreur s'accumule sur 272 prompts au lieu de 31 macros. Ce n'est pas que les signaux étaient mauvais : c'est que le substrat les diluait.

Hypothèse réfutable : **les mêmes pilotes sur un substrat macro pourraient lifter**. C'est le test H1.

## Ce que le POC prouve / ne prouve pas

✅ **Prouvé** :
- Faisabilité technique de la compression macro
- Fork OCGCore via WASM memory snapshot fonctionne
- Énumération générique légale, sans crash sur fixture inconnue
- Le pipeline peut reproduire la canonical line en <1s avec 40 macros
- Compression réelle 6.78× cohérente avec le calcul Niveau 1 (8.8× max théorique)

❌ **Non prouvé** :
- Pertinence algorithmique sans oracle canonical (Run A est tautologique par design)
- Lift sur 69 fixtures vs prompt-DFS canonical (= H1, en cours)
- `DefaultSubPromptPolicy` à elle seule sur fixtures non documentées (branded 2/8 indique des limites)

## Bug mineur trouvé en chemin

Le seed du fixture (`deckSeed: "11111,22222"`) est indépendant du seed du raw-replay. Le mode `--full-canonical-replay` charge maintenant automatiquement le deck/seed du raw-replay. Pas un bug du macro-DFS lui-même, dépendance de bootstrap.

## API publique livrée

```typescript
export interface MacroAction {
  kind: 'idlecmd' | 'chain' | 'end-phase' | 'opp-pass';
  description: string;
  rootAction: Action;
  absorbedSubPrompts: SubPromptResolution[];
  promptCount: number;
}

export interface SubPromptPolicy {
  resolve(msg, promptType, promptPlayer, ctx): SubPromptResolution | null;
  selectEntryPoint?(legalMacros, ctx): number | null;
}

export interface MacroEnumerator {
  enumerateLegalMacros(duelId, policy, ctx, stats): EnumerationResult;
}

export function runMacroDfs(initialDuelId: number, cfg: MacroDfsConfig): MacroDfsResult;
```

API promotion-ready pour H1 (eval 69 fixtures avec scorer existant + ranker existant câblés au niveau macro).

## Verdict POC Niveau 2

**FAISABILITÉ TECHNIQUE OK** — le mécanisme est sain, l'infra propre, l'API claire.

**PIVOT pour Niveau 3** : ne PAS étendre vers "énumérateur générique de macros" (initialement prévu). À la place, **promotion macro-DFS en moteur + wiring ranker existant + eval 69 fixtures** (= H1).

Critère succès H1 : cum matched ≥ 33/69 (vs baseline 31/69).
- Si lift réel → diagnostic propre des 9 NULL passés (substrat changé suffit)
- Si nul → pivot vers H3 (Path β industrialisé en politique de ranker entry-point)

## Files

- `duel-server/src/solver/macro-action-types.ts` (159 LoC, créé)
- `duel-server/src/solver/macro-dfs.ts` (862 LoC, créé)
- `duel-server/scripts/macro-dfs-poc.ts` (408 LoC, créé)
- `_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json` (référentiel canonical D/D/D, existant)
