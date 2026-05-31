# Audit cohabitation PvP / SOLO / Replay / Fork-solo — Findings complémentaires

> **État : DRAFT — à refiner avec Axel.**
> Date : 2026-05-31. Branche : `feat/anim-pipeline-v2`.
> Scope : transport / events / animation / perspective / reset
> sur les 4 modes (PvP normal, SOLO multiplex, Replay, Fork-solo).
> Méthode : exploration multi-agents 5 axes + vérification ciblée du
> code (CLAUDE.md considérée potentiellement stale). 84 findings bruts
> → croisés contre `pvp-solo-replay-audit-findings-2026-05-30.md` (F1-F23)
> → vérifications V1-V8 en bloc → 13 findings résiduels après dédup
> → **2ᵉ passe red-team adversarial** (4 vagues, posture "prove this wrong")
> → 2 REAL + 1 marginal + 2 PARTIAL/LOW + 8 NOT_REPRODUCED.
> Complète le memo 30/05 (ne le remplace pas).

Légende sévérité : 🔴 immédiat · 🟠 confirmé/préoccupant · ⚠️ parité fragile ·
🔁 duplication · 🧩 dette load-bearing · ✅ fausse alerte (verify écarte).

Légende verdict red-team : **REAL** (bug réel confirmé) · **PARTIAL** (bug
réel mais effet visible nul/limité) · **NOT_REPRODUCED** (l'agent a trouvé
le mécanisme compensatoire qui invalide l'allégation).

Colonne **Décision** à remplir ensemble : `FIX` / `BACKLOG` / `WONTFIX` /
`INVESTIGATE` / `DOC-ONLY`.

---

## 🟠 Findings RÉELS confirmés

### F25 — `CheckpointPayload` infrastructure = code mort
**Verdict red-team : REAL.**
- **Lieu** : `animation-orchestrator.service.ts:990` (`scopeDispatcher?.dispatch(scopes)`
  — 1 seul argument) + `scope-reset-dispatcher.ts:82` (accepte le payload) +
  `checkpoint-payload.ts` (interface définie) + tous les `applyReset` qui
  déclarent `_checkpointPayload?:` (underscore = unused).
- **Vérification red-team** : grep exhaustif sur `dispatch(scopes, payload)` →
  aucun call site avec 2 arguments dans tout le codebase. Tous les
  `applyReset` (LpAnimationTracker, BattleAnimationTracker,
  ChainResolutionManager, 8 projections) déclarent le paramètre
  underscore-prefixed. **Aucun consumer ne lit jamais un payload.**
- **Statut** : infrastructure complète mais ZÉRO usage. Soit la finir
  (cas d'usage : DEP rehydrate les deferreds en cours, gameLog reseed
  depuis snapshot serveur), soit la purger.
- **Sévérité** : MEDIUM (dette load-bearing : l'infra existe mais inutilisée).
- **Décision** :

### F37 — `lastSentForPlayer` memoization non clearée au STATE_SYNC (composante de F4)
**Verdict red-team : REAL marginal.**
- **Lieu** : `duel-connection.ts:250` (`lastSentForPlayer: 0 | 1 | null = null`)
  + `:1017-1030` (STATE_SYNC handler wipe les slots mais pas ce champ) +
  `duel-web-socket.service.ts:380-383` (`sendAnimationsDone` triangulation
  3-niveaux).
- **Vérification red-team** : scenario techniquement reproductible : user 0
  envoie réponse → `lastSentForPlayer = 0` → STATE_SYNC arrive
  (reconnect SOLO) → slots wipés mais `lastSentForPlayer` reste à `0` →
  `sendAnimationsDone` tague avec stale 0. **MAIS** les 2 fallbacks
  (`timerState.pendingPlayer ?? perspective()`) couvrent partiellement.
  Le scenario nécessite STATE_SYNC en SOLO mid-duel = reconnect, **rare en
  pratique**.
- **Lien F4 du 30/05** : F4 traite la TRIANGULATION 3-niveaux comme un
  problème de fond ("l'orchestrateur doit savoir quelles animations il
  vient de drainer"). F37 = la 1ʳᵉ source de triangulation est stale au
  reconnect → aggrave F4. À grouper avec F4 dans le fix de fond.
- **Sévérité** : LOW (rare + fallback partiel).
- **Décision** : grouper avec F4 du 30/05.

---

## ⚠️ PARTIAL — Bug technique réel, effet visible nul ou limité

### F27 — Replay seek ne dispatche que `{PERSPECTIVE_LIFETIME}` (LP non reset)
**Verdict red-team : PARTIAL → LOW.**
- **Lieu** : `replay-page.component.ts:797-798` (`abortAndClean()` appelle
  `orchestrator.resetForSwitch()`) + `animation-orchestrator.service.ts:1152-1164`
  (dispatche `{PERSPECTIVE_LIFETIME}` seul).
- **Vérification red-team** : `resetForSwitch` dispatche bien
  uniquement `{PERSPECTIVE_LIFETIME}` → `trackedLp` théoriquement stale.
  **MAIS** `lp-animation-tracker.ts:218 syncFromBoardState()` est appelé
  via `onFinalize()` callback (`animation-orchestrator.service.ts:565`)
  APRÈS que la queue drain. En path replay, `feedTransition()` appelle
  `rbs.updateLogical(boardState)` (replay-duel-adapter.ts:153) AVANT que
  `peekLpDelta` puisse lire un delta. **Donc aucun bug LP visible.**
- **Reste valable** : la cohérence sémantique du dispatch (seek = checkpoint
  causal côté UX, devrait être `{DUEL_LIFETIME}` comme PvP STATE_SYNC) est
  une dette doctrinale. Pas un bug, juste de la redondance.
- **Sévérité** : LOW (cosmétique).
- **Décision** : DOC-ONLY ou WONTFIX.

### F29 — `BoundaryProcessor.forceClosure` jamais appelé en Replay
**Verdict red-team : PARTIAL (invisible).**
- **Lieu** : `replay-duel-adapter.ts` (absence de call) vs
  `duel-connection.ts:1015, 1310, 1356`.
- **Vérification red-team** : les boundaries déséquilibrées sont
  techniquement réelles dans le processor entre 2 transitions. **MAIS**
  `replay-duel-adapter.ts:347` appelle `resetProcessorForTransition()` →
  `processor.reset()` → `boundary.silentReset()` (drop state). Et
  `duel-game-log.service.ts:272-276` `rebuildUpTo()` crée un NEW
  GameLogBuilder qui wipe ENTIÈREMENT le journal. **Les boundaries
  déséquilibrées disparaissent avant qu'aucun consumer ne les voie.**
- **Sévérité** : LOW (cosmétique).
- **Décision** : DOC-ONLY ou WONTFIX.

---

## ✅ NOT_REPRODUCED — Findings écartés par red-team

Ces 8 findings ont été soulevés par l'audit initial mais invalidés par la
vérification adversariale. À documenter en "NON-findings vérifiés" pour
qu'ils ne soient pas re-creusés.

### F24 — Rematch PvP DUEL_LIFETIME reset manquant — ✅ NOT_REPRODUCED
- **Mécanisme compensatoire trouvé** : `duel-animation-bridge.service.ts:46-55`
  contient un reactive effect qui watch `wsService.rematchStarting()` signal.
  Quand `true`, l'effect appelle `animationService.onStateSync()` **synchro­nement**.
  Le reset `{DUEL_LIFETIME}` (LpAnimationTracker.trackedLp + _pendingLpCommits
  + DEP active deferreds) EST déclenché au rematch — juste pas par où je
  pensais. L'agent T5 a manqué ce wire.
- **Leçon** : 2ᵉ chemin de wiring découplé (callback wsService.onStateSync
  pour STATE_SYNC + effect watch sur rematchStarting pour REMATCH_STARTING).
  Pas idéal en lisibilité mais fonctionnellement correct.

### F26 — `wsService.onStateSync` callback fragile (single subscriber)
- **Mécanisme compensatoire** : single owner unique vérifié par grep
  exhaustif. Une seule assignation dans le codebase
  (`duel-page.component.ts:604`). Pas de debug overlay/telemetry/second
  pipeline qui en aurait besoin. Over-engineering.

### F28 — Fork-solo : aucun checkpoint, état accumulé entre forks
- **Mécanisme compensatoire** : naviguer vers `/pvp/duel/fork-${replayId}`
  crée une nouvelle URL → Angular default route reuse strategy →
  `DuelPageComponent` re-instancié → `ngOnInit` frais → orchestrator /
  adapter / connection neufs. **Pas d'accumulation possible.** L'allégation
  supposait l'enchaînement sur la même page, ce qui n'arrive jamais.

### F30 — `pushToStream` hors `AnimationDataSource` interface
- **Mécanisme compensatoire** : grep des call sites → tous internes à
  `AnimationOrchestratorService` (5 calls) ou **page-bootstrap**
  (`duel-page.component.ts:598`, `replay-page.component.ts:548`). **Zéro
  manager n'appelle pushToStream.** La doctrine "passe via AnimationDataSource"
  ne s'applique qu'aux managers — les pages utilisent l'orchestrator
  concret pour le wire bootstrap, ce qui est légitime.

### F31 — `BoundaryProcessor` non-ResetTarget (asymétrie pattern)
- **Mécanisme compensatoire** : `duel-event-processor.ts:299`
  `boundary.silentReset()` est appelé INCONDITIONNELLEMENT dans
  `processor.reset()`. BP est owned par processor → coupling intentionnel
  co-mortem. Registering au dispatcher serait redondant. L'asymétrie avec
  DEP est intentionnelle (DEP est owned par l'orchestrator, pas par le
  processor, scope différent).

### F32 — `pendingPrompt` asymétrie interface (replay always null)
- **Mécanisme compensatoire** : tous les consumers de `dataSource.pendingPrompt()`
  font déjà un null-guard explicite avant de lire (`if (prompt && !animating)`,
  `?.type === 'DICE_ROLL'`, etc.). `signal(null)` en replay est une
  implémentation valide du contrat. Aucune logique business ne dépend
  de prompts non-null en replay.

### F33 — `ownPlayerIndex` sémantique asymétrique (absolu PvP vs relatif SOLO)
- **Mécanisme compensatoire** : convergence par construction. En SOLO,
  `perspectiveIndex()` est le slot du viewer dans la board SWAPPÉE (donc
  toujours = "qui je vois maintenant"). En PvP, `ocgPlayerIndex()` est le
  slot du viewer après que `sanitizeBoardState` ait swap `players[]`. **Les
  deux résolvent au même "viewer's index dans le array relativisé".** Donc
  `players[ownPlayerIndex].lp` lit la même chose dans les 2 modes.
  Asymétrie cosmétique, pas un bug.

### F35 — `unregister()` jamais appelé par les ResetTargets
- **Mécanisme compensatoire** : `ScopeResetDispatcher` est providé au scope
  COMPONENT (`duel-page.component.ts:85` + `replay-page.component.ts:82`
  dans `providers: [...]`). Lifetime alignment par DI : quand le component
  meurt, l'injector qui a créé le dispatcher meurt, le dispatcher disparaît,
  tous les targets registered sont GC'd ensemble. **Pas de leak.**

### F38 — `lastDrawAnnouncedHash` reset au switch mais non testé
- **Mécanisme compensatoire (qualifié)** : `solo-duel-orchestrator.spec.ts:142`
  teste `switchPerspective` + `notifyPerspectiveSwitch`. La dédup elle-même
  est testée ailleurs. **MAIS** la jonction spécifique "switch invalidates
  hash → no double-announce" n'a pas de pin test. Coverage gap réel mais
  ce n'est pas un bug — c'est une faiblesse de test, pas une faiblesse de
  code.

---

## 🔁 Doublons explicites avec memo 30/05

- **F36 ≡ F19** : `assertNoLocks()` documentée comme garde mais zéro
  appelant prod. → voir F19 (30/05).
- **F39 ≡ F13** : `_innerLoopDepth` triple défense post-cicatrice
  infinite-rescue. → voir F13 (30/05).
- **F40 ≡ F12** : `TargetIndicatorManager` hors pattern ResetTarget. →
  voir F12 (30/05).

---

## ✅ Verifications positives (audit clean — ne pas re-creuser)

Ces points ont été VÉRIFIÉS par l'audit V1-V8 (1ʳᵉ passe) ou par parité
explicite trouvée au code. À ajouter à la liste "Cases NON-findings" du
memo 30/05 :

- **V1 ✅ DEP scope** : `DeferredEffectProcessor` déclare
  `scope = CONNECTION_LIFETIME` (`deferred-effect-processor.ts:366`) et
  `applyReset` skip si `!scopes.has('CONNECTION_LIFETIME')`. Doctrine
  "deferreds survivent au switchPerspective, abandonnés au STATE_SYNC/
  Rematch" ENFORCED par le code.
- **V2 ✅ Projections β.3** : les 8 projections sont attachées
  explicitement à `_eventStream` via `attachEventStream(stream, injector)`
  dans le ctor de l'orchestrator (`animation-orchestrator.service.ts:620-670`).
  Pas de wire implicite.
- **V5 ✅ ChainResolutionManager.applyReset** : branche bien sur
  `scopes.has('CONNECTION_LIFETIME')` (full reset) vs
  `scopes.has('PERSPECTIVE_LIFETIME')` (timers only). Les 2 branches
  existent (`chain-resolution-manager.ts:308-316`).
- **V6 ✅ LpAnimationTracker.applyReset** : single-branch DUEL_LIFETIME.
  Le PERSPECTIVE slice (animatingLpPlayer) a été extrait en projection
  séparée (`AnimatingLpProjection`). Architecture déjà clean.
- **V7 ✅ BattleAnimationTracker.applyReset** : clear timer + signal
  atomiquement quand `scopes.has('PERSPECTIVE_LIFETIME')`
  (`battle-animation-tracker.ts:140-157`).
- **V8 ✅ `expandInvalidatedScopes` test non-contiguous** : pin le P9
  hardening (`scope.spec.ts:47-56`).
- **F34 ✅ `syncAfterBoardState` parité 4-tier** : 4 call sites passent
  les mêmes args, parité enforced par construction (shared free function).

---

## Récap priorités proposées (à arbitrer)

Après red-team, la liste actionnable se réduit à **2 findings réels** +
quelques gaps documentaires.

| Ordre | Finding | Type | Effort | Décision |
|---|---|---|---|---|
| 1 | F25 CheckpointPayload code mort (purger ou finir) | 🟠 archi | faible (purge) ou moyen (finir) | |
| 2 | F37 lastSentForPlayer stale @ STATE_SYNC | 🧩 dette (grouper avec F4) | dans F4 | |
| 3 | F27 Replay seek scope sémantique redondant | ⚠️ doc | trivial | |
| 4 | F29 BoundaryProcessor.forceClosure replay (cosmétique) | ⚠️ doc | trivial | |

**Doublons explicites (référencer le 30/05)** :
- F36 ≡ F19 (assertNoLocks code mort)
- F39 ≡ F13 (_innerLoopDepth triple défense)
- F40 ≡ F12 (TargetIndicatorManager hors pattern)

---

## Périmètre d'audit & méta

**Couvert :**
- Transport / lifecycle / ownership des conns (axe 1)
- Ownership events / convergence points / stream (axe 2)
- Parité animation / data source / RBS / orchestrator (axe 3)
- Perspective / referentials absolute vs relative (axe 4)
- Reset / scopes / cleanup / checkpoints (axe 5)

**Croisé contre** : `pvp-solo-replay-audit-findings-2026-05-30.md`
(F1-F23). Les findings actifs ou DONE du 30/05 ne sont PAS réintroduits
ici sauf doublon explicitement référencé pour cross-check.

**Méthode** :
1. 5 agents Explore en parallèle, 1 par axe → 84 findings bruts
2. Filtrage manuel contre les 23 F1-F23 du 30/05 (retrait des matches)
3. 1 agent de vérification ciblée (V1-V8) sur les NEEDS VERIFY
   survivants → 8/8 verdicts CONFIRMED, 5 fausses alertes éliminées,
   2 findings consolidés
4. Déduplication inter-axes (regroupements F-T*.N → F24-F40)
5. Rédaction memo (1ʳᵉ version)
6. **2ᵉ passe red-team adversariale** : 4 vagues × 3-4 findings,
   posture "prove this wrong" → **8 NOT_REPRODUCED** + 2 REAL + 2 PARTIAL
   + 1 marginal

**Coût agents total** : ~410k subagent tokens (5 axes) + ~50k (verify V1-V8)
+ ~292k (red-team 4 vagues).

**Bénéfice** : 84 findings bruts → 13 actifs (après dédup 30/05) → **2
findings réels + 1 marginal** après red-team. Taux de fausses alertes
internes : 62% (8/13). Bonne hygiène : un audit sans red-team aurait
produit 13 findings dont 8 imaginaires.

---

## Leçons méta de l'audit

1. **L'exhaustif sans red-team produit du bruit.** Mes agents axe 1-5 ont
   sur-flaggé des "asymétries" qui étaient en fait des couplings
   intentionnels (F31 BP/processor) ou des single-owner légitimes (F26).
   La red-team est la sécurité.
2. **CLAUDE.md n'est pas (toujours) stale.** Beaucoup de doctrines
   documentées sont enforced par code (V1-V8 + F31-F35). Le risque
   "doc stale" est plus faible que je le craignais — mais reste réel
   (cf. F20 du 30/05 qui était stale).
3. **Les wires découplés cachent des couvertures.** F24 a été manqué par
   l'audit T5 parce que le mécanisme de reset rematch est dans
   `duel-animation-bridge.service.ts`, pas dans `duel-connection.ts`. Si
   2 chemins de wiring existent (callback + effect réactif), c'est plus
   robuste mais plus dur à auditer.
4. **L'asymétrie n'est pas toujours un bug.** F32 (pendingPrompt always
   null en replay) et F33 (ownPlayerIndex sémantique) étaient des "trucs
   qui sentent" mais convergent à l'usage par construction. Smell ≠ bug.

---

## Notes de refinement (à remplir ensemble)

> _(espace libre pour les arbitrages, regroupements en chantiers, mises de côté)_
