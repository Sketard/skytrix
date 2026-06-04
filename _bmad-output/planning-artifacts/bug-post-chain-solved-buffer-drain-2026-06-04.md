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
