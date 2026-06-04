# Spec — Post-`MSG_CHAIN_SOLVED` buffer drain (scheduler-level rescue)

**Date** : 2026-06-04
**Branche cible** : `feat/anim-pipeline-v2` (continue post-`e94e06b0`)
**Repro** : http://localhost:4200/pvp/replay/18a55f97-7076-4716-9032-dcf88c9a86f4?seekTo=2
**Harness** : `front/e2e/debug-radiant-typhoon-draw-discard.spec.ts`

## Symptôme

Carte Magie (Radiant Typhoon Vision) qui s'active, fait piocher 2 / défausse 1 sur
résolution, puis se self-destroy en bas de chain :

- **Replay** : la carte reste sur S5, lock GY-0 leak, safety-timeout 7.5s, reload.
- **PvP** : la carte de self-destroy apparaît au cimetière SANS animation, puis
  l'animation S5→GY joue alors qu'elle est déjà visible au GY (lock GY-0
  ref-count=2 partagé).

## Cause racine (confirmée par harness, dense-log 792 lignes)

Séquence ordonnée des messages dans le state replay 3 :

```
MSG_CHAINING → MSG_CHAIN_SOLVING → MSG_DRAW × 2 → MSG_SHUFFLE_HAND
→ SELECT_CARD → MSG_MOVE (discard cost) → MSG_CHAIN_SOLVED
→ MSG_MOVE (self-destroy)
```

Puis **State 4** : `[MSG_CHAIN_END]` seul (séparateur de chains côté précompute).

Pendant `chainPhase === 'resolving'`, `ChainResolutionManager.bufferIfResolving`
met les `BOARD_CHANGING_EVENT_TYPES` dans `_bufferedBoardEvents`. `replayBuffer()`
est déclenché par `onChainLinkResolved` (overlay) une seule fois par link
résolu.

Le 2ᵉ `MSG_MOVE` (self-destroy) arrive APRÈS ce drain mais TOUJOURS pendant
`chainPhase === 'resolving'` (`applyChainEnd` n'a pas encore tourné — `MSG_CHAIN_END`
est dans l'état 4, pas encore feed). Il est re-bufferé silencieusement et plus
aucun trigger ne le drainera :

- `resumeEffect` gate sur `_waitingForOverlay` qui est `false` après le 1er drain.
- `handleChainEnd` ne s'exécute jamais : l'adapter ne feed pas l'état 4 tant que
  `chainPhase=resolving` (gate de `maybeAdvance`).

**Deadlock circulaire** :
- MSG_CHAIN_END dort dans l'état 4 ;
- l'état 4 ne sera feed qu'avec `chainPhase=idle` ;
- `chainPhase=idle` ne se produira qu'au dequeue de MSG_CHAIN_END.

Le buffer non-drainé est le coin du triangle qui doit céder.

## Asymétrie PvP↔Replay

| | PvP | Replay |
|---|---|---|
| Modèle | Push WS, serveur impose le tempo | Pull adapter, client demande le prochain état quand il est ready |
| MSG_CHAIN_END | Arrive forcément, queue grossit, runner finit par le traiter | Demandé par `maybeAdvance`, gated sur `chainPhase=idle` |
| Effet d'un buffer non-drainé | Inoffensif (CHAIN_END finit par arriver et drainer en CHAIN_END handler) | Deadlock (CHAIN_END jamais demandé) |

La segmentation `MSG_CHAIN_END` du précompute existe pour **séparer 2 chains
consécutives dans la timeline**, pas pour créer ce découplage. C'est un effet de
bord. Aligner sur PvP (inclure MSG_CHAIN_END dans le même state que les events
post-CHAIN_SOLVED) casserait la séparation visuelle des chains consécutives ET
nécessiterait de re-précompter tous les replays existants. Coût > bénéfice.

## Plan — Approche C (scheduler-level rescue dans le runner)

`decideNextStep` est l'arbitre central des actions du runner. La branche
`pre-replay-buffer` existe DÉJÀ pour un cas connexe (mid-chain pre-replay
quand un prompt arrive avec un buffer non-drainé) :

```ts
// queue-runner.ts:227-229
if (input.isResolving && input.hasBufferedEvents && input.hasPendingPrompt) {
  return { action: 'pre-replay-buffer' };
}
```

Et le wire-up dans l'orchestrator est déjà en place :

```ts
// animation-orchestrator.service.ts:568
preReplayBuffer: () => this.replayBuffer(true),  // inlineFromLoop=true
```

L'inline-path de `replayBuffer` (cf. `animation-orchestrator.service.ts:765-772`)
prepend le batch + clearWaiting, sans `await-signal`, sans `notifyEnqueue` (le
runner est déjà en train de processer). Exactement ce qu'il faut pour un
straggler post-CHAIN_SOLVED.

### Fix proposé

**Relaxer la condition** : retirer `hasPendingPrompt` du gate. La condition
devient :

```ts
if (input.isResolving && input.hasBufferedEvents) {
  return { action: 'pre-replay-buffer' };
}
```

À ce point dans `decideNextStep`, on sait déjà que :
- `!input.isWaitingForOverlay` (priorité 1 retourne `pause-external` sinon) ;
- `!input.hasDrawsInFlight` (idem) ;
- `queue.length === 0` (sinon dequeue prioritaire) ;
- `deferredSolvingEntry === null` (sinon consume-deferred prioritaire).

Donc on est exactement dans le scénario "queue drainée, overlay relâché, mais
chain encore resolving (le runner attend la suite — un prompt, ou un MSG_CHAIN_END,
ou un straggler post-CHAIN_SOLVED arrivé via la précompute)". **Tous ces cas
veulent le même remède** : flusher le buffer dans la queue principale via inline
replayBuffer.

### Sémantique de la branche après le fix

| Avant (`pre-replay-buffer`) | Après (`drain-buffer`) |
|---|---|
| Mid-chain pre-replay forcé par un prompt en attente. Le joueur DOIT voir l'animation avant de répondre. | Drain du buffer dès qu'il est non-vide et que le runner serait sinon en `finalize` pendant `resolving`. Couvre le cas prompt-pending ET le straggler post-CHAIN_SOLVED. |

Le nom de l'action reste `pre-replay-buffer` (changer le nom = bruit) ; on met
à jour le commentaire pour refléter le scope élargi.

## Edge cases & risk register

| Scénario | Comportement attendu |
|---|---|
| **R1 — Drain ré-entrance** | `replayBuffer` est gardé par `_isReplayingBuffer` côté orchestrator + `_drainingBuffer` côté manager. Le 2ᵉ drain dans le même tick (impossible — un seul tick par `decideNextStep`) est blockable de toute façon. Côté manager, `drainBuffer()` return un array vide si vidé → `replayBuffer` early-return. ✓ déjà en place. |
| **R2 — Boucle infinie sur buffer impossible à drainer** | Le drain reprepend des directives + des events ; le tick suivant les dequeue. Si pour une raison X le buffer se re-remplit instantanément après le drain, on aurait une boucle. Mitigation : le `_isReplayingBuffer` flag protège — pendant le drain (qui passe par `processEvent` → `bufferIfResolving` returns false grâce à `_drainingBuffer=true` ou `_isReplayingBuffer` checké en amont). En sortie de drain, le buffer est vide ; le straggler suivant alimente normalement la queue et n'est PAS re-bufferé. ✓ |
| **R3 — Watchdog POLL-DROP** | Le watchdog s'arme au `case 'finalize'` quand `chainPhase=resolving`. Avec le fix, on n'atteint plus `finalize` quand le buffer est non-vide → le watchdog reste désarmé tant qu'il y a quelque chose à drainer. Sain. Si le drain finit avec buffer toujours vide ET phase=resolving (en attente d'un CHAIN_END qui viendra dans le state suivant), `finalize` fire normalement et le watchdog s'arme — comportement actuel inchangé. ✓ |
| **R4 — PvP regression possible** | En PvP, ce gate était inactif (le prompt ne vient pas mid-chain en PvP, la séquence WS pousse directement). Avec la condition relâchée, PvP pourrait aussi entrer dans `pre-replay-buffer` quand un MOVE arrive post-CHAIN_SOLVED via WS et que le runner finit son tick. Effet net : **2 batchs séparés** au lieu d'un seul (1er batch = events pré-CHAIN_SOLVED, 2ᵉ batch = MOVE post-CHAIN_SOLVED), chacun avec son propre dst-lock GY-0 sans ref-count=2 partagé. **C'est la correction du bug PvP en plus.** À valider visuellement. ✓ bonus |
| **R5 — Buffered events en cours d'arrivée pendant le drain inline** | Le drain inline ne peut pas être interrompu par un event WS qui arriverait dans le même tick (single-threaded JS). Au prochain tick, soit l'event est déjà dans le buffer (drainé par la prochaine itération du loop), soit il vient d'entrer dans la queue principale (dequeued normalement). ✓ |
| **R6 — Compatibilité avec le `finalize` watchdog en PvP normal (pas de straggler)** | Si `chainPhase=resolving` + buffer vide + queue vide → branche 4a sautée → `finalize` → watchdog armed. Comportement inchangé. ✓ |
| **R7 — `pre-replay-buffer` boucle quand `replayBuffer` produit un batch vide** | `replayBuffer` ne retourne pas avant d'avoir vraiment vidé `_bufferedBoardEvents` (drainBuffer la vide synchrone). Pour produire une boucle, il faudrait que `bufferIfResolving` re-pousse pendant le drain, ce qui est interdit par `_drainingBuffer=true` (set par `beginDrain` en début de `replayBuffer`). ✓ |

## Tests

### Karma — `queue-runner.spec.ts` (pure decideNextStep)

Ajouter à la suite "decideNextStep" :

- **T1 — straggler post-CHAIN_SOLVED** : inputs `{isResolving=true, hasBufferedEvents=true, hasPendingPrompt=false, isWaitingForOverlay=false, queueLen=0, ...}` → expected `{action: 'pre-replay-buffer'}`.
- **T2 — mid-chain pre-replay avec prompt** (régression) : inputs `{isResolving=true, hasBufferedEvents=true, hasPendingPrompt=true, ...}` → expected `{action: 'pre-replay-buffer'}` (inchangé).
- **T3 — finalize si pas de buffer** : inputs `{isResolving=true, hasBufferedEvents=false, queueLen=0, ...}` → expected `{action: 'finalize'}`.
- **T4 — pause-external bat tout** : inputs `{isWaitingForOverlay=true, hasBufferedEvents=true, isResolving=true, ...}` → expected `{action: 'pause-external'}` (priorité 1 inchangée).

### Harness — `debug-radiant-typhoon-draw-discard.spec.ts` (existant)

Critère succès après fix :

- `currentIndex` avance ≥ 4 (atteinte de MSG_CHAIN_END).
- Pas de warning `replayBuffer safety timeout`.
- Pas de `POLL-DROP REGRESSION`.
- Le 2ᵉ MSG_MOVE (Radiant Typhoon Vision self-destroy, card=20508881) animé
  visiblement (présence d'un float `inFlight` avec `dstKey=GY-0` puis `landed`).
- Final state : carte plus sur S5, présente dans GY-0.

Pas de modification du harness — il est déjà construit pour observer ce
deadlock spécifique.

## Implémentation

### Fichier 1 — `queue-runner.ts:227-229`

```diff
-  if (input.isResolving && input.hasBufferedEvents && input.hasPendingPrompt) {
-    return { action: 'pre-replay-buffer' };
-  }
+  // Mid-chain rescue : drain le buffer dès qu'il est non-vide et que le
+  // runner serait sinon en `finalize` pendant `resolving`. Couvre :
+  //   · le mid-chain pre-replay (prompt en attente — légacy)
+  //   · le straggler post-MSG_CHAIN_SOLVED (event bufferé après le drain
+  //     orchestré par `onChainLinkResolved`).
+  // Voir `_bmad-output/planning-artifacts/bug-post-chain-solved-buffer-drain-2026-06-04.md`.
+  if (input.isResolving && input.hasBufferedEvents) {
+    return { action: 'pre-replay-buffer' };
+  }
```

### Fichier 2 — `queue-runner.spec.ts`

Ajouter les 4 tests T1-T4 ci-dessus.

### Pas de modification

- `chain-resolution-manager.ts` — inchangé.
- `animation-orchestrator.service.ts` — inchangé (wire-up `preReplayBuffer`
  existe déjà ligne 568).
- `replay-precompute.ts` — inchangé (le découplage server-side reste — c'est le
  client qui devient autonome).
- `pvp-chain-overlay.component.ts` — inchangé.

## CLAUDE.md

Ajouter une ligne dans la section "Chain State Machine Rules" :

> **Mid-chain buffer drain rescue (2026-06-04)** : la branche `pre-replay-buffer`
> de `decideNextStep` couvre 2 cas — le mid-chain pre-replay (prompt en attente)
> ET le straggler post-CHAIN_SOLVED (event bufferé après le drain orchestré par
> `onChainLinkResolved`). Le 2ᵉ cas est nécessaire en replay parce que
> `MSG_CHAIN_END` est segmenté dans un state distinct par `replay-precompute.ts`
> et ne sera demandé qu'une fois `chainPhase=idle` — d'où la nécessité d'un
> drain autonome côté runner pour briser le deadlock circulaire. PvP en profite
> aussi (2 batchs séparés au lieu d'un seul avec lock GY-0 ref-count=2 partagé).

## Sortie attendue

1 ou 2 commits :

1. `fix(anim): drain chain buffer on post-CHAIN_SOLVED straggler — queue runner autonome` — queue-runner.ts + queue-runner.spec.ts + CLAUDE.md ligne.
2. (optionnel) `test(replay): pin radiant-typhoon-draw-discard harness regression` — si on veut pinner explicitement le harness comme test de non-régression.

Pas de migration BMad. Pas de doc CLAUDE.md section nouvelle.

---

# Suite (post-Fix C) — chantier session 2026-06-04 après-midi

Le **Fix C** (committé `8c30a325`) débloque le deadlock chain. Mais 2
symptômes cosmétiques restent post-fix, remontés par Axel via test
visuel et harness instrumenté à 5 niveaux.

## Symptômes cosmétiques résiduels (post-Fix C)

Sur la même chain Radiant Typhoon Vision (replay 18a55f97 seek=2) :

1. **Krosea discard reste en double pendant le travel HAND→GY** — la
   carte source en main ne quitte pas le DOM pendant l'animation. Le
   float voyage, mais la carte source reste affichée.
2. **Krosea n'apparait JAMAIS au cimetière** — même quand le float
   landed sur GY-0, le DOM cimetière reste vide. Plus tard, la Vision
   self-destroy arrive et prend la place.
3. **Vision reste sur S5 pendant son travel** — même pattern que
   symptôme 1 pour le 2ᵉ MOVE.

## Investigation — 5 couches d'instrumentation harness

Pour traquer le disconnect signal-vs-DOM, instrumentation ajoutée :

- `[BSA-CHECK]` côté `processEvent` — confirmer `boardStateAfter`
  PRÉSENT ou MISSING pour chaque MSG_MOVE, et contenu S5+GY.
- `[RBS-LOGICAL]` côté `updateLogical` — montrer prev→next pour HAND+GY.
- `[RBS-COMMIT]` côté `commitZone` — logical vs rendered pour S5/GY/HAND.
- `[LOCK-HAND-0]` ACQUIRE/COMMIT/RELEASE avec ID unique par lock.
- `[PRELOCK-HAND-0]` lifecycle du `_preLocks` map du `MoveAnimationRouter`.

Probe DOM enrichie : `cardCodes` extraits des `<img src>`, `floatsInDOM`,
visibility/opacity de chaque élément.

## Cause racine — `processShuffleEvent.commitAll()` zombifie les ZoneLocks

**Discovery** : pendant le pre-replay-buffer drain (Fix C), le buffer
contient `[MSG_DRAW × 2, MSG_SHUFFLE_HAND]`. Le `processShuffleEvent`
(`draw-sequence-manager.ts:639`) appelle `this.rbs.commitAll()` en
happy path pour synchroniser HAND avec les nouvelles cartes drawn.

**Anti-pattern** : `commitAll()` est nucléaire — il appelle
`this._locks.clear()` qui wipe TOUS les locks du `_locks` map, sans
notifier les `ZoneLock` closures encore actives. Or à ce moment, le
runner a un pre-lock HAND-0 acquis par `preLockQueuedSources` AVANT le
drain (pour anticiper le MOVE Krosea à venir). Ce pre-lock devient un
**zombie** :

- Son closure `released=false` (pas commit ni release).
- Son entrée dans `_locks` map a été wipée par `commitAll()`.

Quand le MOVE Krosea HAND→GY arrive plus tard et fait
`consumePreLock(HAND-0)`, le pre-lock zombie est retourné.
`discardFromHand` appelle `mc.preSrcLock?.commit()`. Le closure entre
dans son `commit()` (released=false), met `released=true`, puis check
`if (!this._locks.has('HAND-0')) return` → **early return silencieux**.
Aucun `commitZone(HAND-0)` ne fire. Le rendered HAND reste figé sur
l'état pré-1er-MOVE → la Krosea reste en double dans le DOM.

## Plan de fix — Option I (G + H + 2b ensemble)

### Option 2b — Server-side : étendre la fenêtre `chainResolving`

`ChainSnapshotTracker` (server) attache `boardStateAfter` aux events
BOARD_CHANGING uniquement pendant la fenêtre `MSG_CHAIN_SOLVING →
MSG_CHAIN_SOLVED`. **Problème** : les events post-CHAIN_SOLVED
(comme le self-destroy Vision) n'ont pas de snapshot. Côté client, la
logical state ne s'avance pas, le commit copie une logical stale.

**Fix** : étendre la fenêtre à `MSG_CHAIN_SOLVING → MSG_CHAIN_END`
(une seule fenêtre par chain, ne ferme qu'au CHAIN_END). Effet de
bord acceptable : le gate `liveChainTracker.isResolving` du PvP
cancel-rollback devient aussi plus restrictif — un cancel entre
SOLVED et END devient impossible. Sémantiquement plus correct (chain
pas finie).

Diff :

```diff
-    } else if (dto.type === 'MSG_CHAIN_SOLVED') {
+    } else if (dto.type === 'MSG_CHAIN_END') {
       this._chainResolving = false;
     }
```

22 tests vitest mis à jour pour le nouveau contrat.

### Option G — Client-side : zombie-safe `ZoneLock.commit()`

**Fix** : dans `ZoneLock.commit()` closure, si `_locks.has(zoneKey)` est
false, **forcer `commitZone(zoneKey)` quand même** au lieu de
l'early return.

Rationale : `commitZone` est idempotent (logical→rendered sync). Si la
zone a déjà été syncée par un `commitAll()` antérieur ET pas mutée
depuis, c'est un no-op visuel. Si elle a été mutée (notre cas via
`updateLogical(boardStateAfter)` post-Option 2b), c'est le sync que
le caller attend.

Diff :

```diff
       if (released) return;
       released = true;
       clearTimeout(timeoutId);
       this._safetyTimeouts.delete(timeoutId);
-      if (!this._locks.has(zoneKey)) return;
+      if (!this._locks.has(zoneKey)) {
+        this.commitZone(zoneKey);
+        return;
+      }
       const rc = this._locks.get(zoneKey)! - 1;
```

Defense-in-depth : protège contre toute future utilisation abusive de
`commitAll()` qui réintroduirait le zombification pattern.

### Option H — `processShuffleEvent`: `commitAll()` → `commitZone(handZoneKey)`

**Fix** : remplacer 2 sites dans `draw-sequence-manager.ts`
(`processShuffleEvent` happy path ligne 639 + reducedMotion fallback
ligne 596) par un sync ciblé HAND-${player} seulement.

Diff :

```diff
-      this.rbs.commitAll();
+      this.rbs.commitZone(handZoneKey);
```

Préserve l'invariant "un lock acquis par un acteur n'est libéré que par
cet acteur". Les pre-locks d'autres zones (GY-0, S5-0) restent actifs
pour leurs MOVE futurs.

### Doctrine — warning sur `commitAll()` doctring

Ajouter à `rendered-board-state.service.ts:commitAll()` un bloc DANGER :

> ⚠️ DANGER (2026-06-04) — DO NOT call `commitAll()` mid-batch to "just
> sync one zone". Sites comme `processShuffleEvent` faisaient ça et
> zombifiaient tous les ZoneLocks des autres acteurs.
> For partial syncs, prefer `commitZone(key)` — surgical, leaves other
> actors' locks alive, no zombie.

## Audit régression

### Autres `commitAll()` audités (8 sites)

- `orchestrator.resetAllState` — TERMINAL boundary ✅
- `BufferReplayBuilder.applyReducedMotion` — pas de locks attendus en reduced-motion ⚠️ surveillé
- `processShuffleEvent` catch (×2) — accepté en panic path ✅
- `duel-connection.skipPendingAnimations` — user skip-to-end ✅
- `duel-connection RematchStarted` — TERMINAL ✅
- `duel-connection._applyStateSync` — précédé par `assertNoLocks` ✅
- `rbs.destroy` — TERMINAL ✅

**Verdict** : aucun autre site n'a le pattern toxique (commitAll
mid-batch avec d'autres acteurs lockés).

### Régressions Options G + H

- **Option G** : `commitZone(key)` idempotent → no-op si déjà synced,
  proper sync si nécessaire. Pas de side-effect transversal.
- **Option H** : les zones non-HAND conservent leurs locks (GY, S5,
  etc.). C'est PRÉCISÉMENT ce que les pre-locks sont censés faire.
  Aucun scénario laissant une zone désync indéfiniment identifié.

## Tests + validation

- **Karma** : 73/73 specs vertes (RBS + draw-sequence-manager) post-cleanup.
- **Vitest** : 22/22 vertes (chain-snapshot-tracker).
- **Harness** : Krosea visible au GY à t=22.491s, HAND a 5 cards (1 Krosea),
  Vision arrive et prend la top de pile correctement.

## Commits planifiés

3 commits sur la branche `feat/anim-pipeline-v2`, après le commit Fix C
(`8c30a325`) :

1. `fix(server): extend chainResolving window to MSG_CHAIN_END` —
   `chain-snapshot-tracker.ts` + spec + `duel-worker.ts` + CLAUDE.md sections.
2. `fix(anim): zombie-safe ZoneLock.commit() + ciblé shuffle commit` —
   `rendered-board-state.service.ts` (Option G + warning) +
   `draw-sequence-manager.ts` (Option H ×2) + spec md update.
3. (potentiel) `test(replay): pin radiant-typhoon-draw-discard harness` —
   si on veut pinner explicitement.

Possible de fusionner 1+2 en un seul commit "fix(anim): Krosea discard
zombie lock" si on préfère un atomic fix du même bug. À voir.
