# Anim Pipeline v3 — abort safety (backlog 2026-06-04)

> **Statut** : backlog, à attaquer après finition du chantier post-session
> 2026-06-03 (chantiers δ + ε restants). Axel a choisi cette voie sur la
> question "parité Replay↔SOLO PvP robuste".

## Contexte

Pendant le chantier γ (audit `tolerateLocks`), un log console
([console-export-2026-6-4_13-57-59.log](../../console-export-2026-6-4_13-57-59.log))
a confirmé un bug en replay : `togglePerspective` cliqué mid-animation
(chain en construction, locks `HAND-0` + `GY-0` posés) → cascade de 3
asserts qui throw.

Stack :

```
advanceStep                        replay-duel-adapter.ts:246
setAnimating                       replay-duel-adapter.ts:65
onIsRunningChange                  animation-orchestrator.service.ts:605
setRunning                         queue-runner.ts:749
requestStop                        queue-runner.ts:420
clearTimersAndPolling              animation-orchestrator.service.ts:892
resetAllState                      animation-orchestrator.service.ts:1006
resetForReplaySeek                 animation-orchestrator.service.ts:1243
abortAndClean                      replay-page.component.ts:843
onTogglePerspective                replay-page.component.ts:884
```

Le commit `c41db25a` avait ajouté un flag `tolerateLocks=true` sur
`resetAllState` pour ce cas. Mais il y a **3 asserts siblings dans
`replay-duel-adapter.ts`** (`feedTransition:154`,
`feedTransitionPhased:191`, `advanceStep:246`) qui ne sont pas couverts
et qui peuvent être déclenchés en cascade par `setAnimating(false)` ←
`runner.requestStop()` ← `resetAllState`.

## La doctrine cible

**Parité Replay↔SOLO PvP robuste par construction** — aucun hack
`tolerateLocks` nécessaire. Les locks orphelins sont éliminés à la source
plutôt que tolérés.

Comportement attendu :

- En replay : `togglePerspective` / `seek` / `scrub` cliquable mid-anim,
  interrompt l'anim instantanément, switch propre.
- En SOLO PvP : `switchPerspective` cliquable mid-anim également (gate
  `canSwitchPerspective` retiré sauf `promptBlocks`).
- Dans les deux : pas de mutation zombie d'IIFE bailed, pas de lock
  survivant, pas de `assertNoLocks` qui throw.

## Architecture v3 (esquisse)

### Principe — propager `AbortSignal` dans `lockZone`

Le runner installe déjà un `AbortController` à `notifyEnqueue` (palier C,
2026-05-23). Ce signal est propagé aux loop checks après chaque `await`.

L'étape v3 : **`lockZone` consume aussi ce signal**. Signature révisée :

```ts
lockZone(zoneKey: string, opts?: { signal?: AbortSignal }): LockHandle
```

Quand `signal.aborted` au moment du `lockZone()`, le call **no-op** :
retourne un handle dégénéré dont `commit()` / `release()` sont des
no-op et qui ne touche pas la `_locks` Map.

L'IIFE en flight qui appelle `lockZone` post-`requestStop` se voit
remettre un handle inerte → ne pose rien, ne fuit rien.

### Mécanisme complémentaire — `RBS.cancelOrphanedLocks(reason)`

Au `requestStop`, le RBS expose une méthode qui :

1. Itère sur `_locks`.
2. Force-commit chacun avec le tag `reason`.
3. Clear les `setTimeout` internes de chaque lock (le `LOCK_SAFETY_TIMEOUT`
   qui sinon fire 7.5s plus tard et pollue la console — c'est ce qu'on
   voit lignes 724-733 du log).
4. Vide `_locks`.

Appelé par `runner.requestStop()` BEFORE `setRunning(false)` pour que le
flip `isAnimating → false` ne déclenche pas la cascade `advanceStep` →
`assertNoLocks` avec des locks encore présents.

### Retrait des `tolerateLocks` skips

Une fois (a) et (b) en place, les 4 skips deviennent inutiles :

- `resetAllState(tolerateLocks=true)` → retire le paramètre.
- `replay-duel-adapter.ts` `feedTransition` / `feedTransitionPhased` /
  `advanceStep` → asserts strictes restaurées.

Les 7 sites `assertNoLocks` redeviennent invariants par construction.

### Côté SOLO PvP

Le gate `canSwitchPerspective` ([solo-duel-orchestrator.service.ts:270-282](../../front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts))
est réduit à `promptBlocks` uniquement (un modal ouvert reste bloquant,
mais pas une anim en cours).

`SoloDuelOrchestratorService.switchPerspective()` gagne un `abortAndClean`-
like SOLO :

```ts
switchPerspective(): void {
  if (modalPromptOpen) return;
  this.animationService.resetForSoloSwitch();  // mirror of resetForReplaySeek
  this.duelCtx.setPerspective(to);
  this.animationService.notifyPerspectiveSwitch(from, to);
  // _lastAbsoluteBoardState déjà cached dans DuelConnection
  // → onPerspectiveSwitched re-feed automatique
}
```

`resetForSoloSwitch` dispatche `{PERSPECTIVE_LIFETIME}` (LP + journal
préservés, conn intacte) et passe par le même `resetAllState` qui n'a
plus besoin de `tolerateLocks`.

## Plan d'attaque

### Phase 1 — instrumenter (sans changer le comportement)

- Ajouter un compteur sur `lockZone` qui track les locks créés
  post-`requestStop` (instrumentation pure, pas de skip).
- Faire tourner SOLO + replay en dev pendant qqs jours pour quantifier
  l'occurrence réelle des bails IIFE post-abort.
- Décider de la stratégie d'IIFE bailout (cf. Phase 2) avec données.

### Phase 2 — wirer `AbortSignal` dans les async handlers

- Identifier tous les async handlers qui appellent `lockZone` : grep
  `lockZone(` dans `*.handler.ts` + `move-animation-router.ts` +
  `chain-resolution-manager.ts` + autres.
- Brancher le `runner._abort.signal` comme paramètre option à `lockZone`.
- Vérifier que les `await` internes des handlers checkent aussi
  `signal.aborted` pour bail tôt (pas juste à `lockZone`).

### Phase 3 — `cancelOrphanedLocks` au `requestStop`

- Ajouter la méthode `RBS.cancelOrphanedLocks(reason: string): number`
  retournant le count de locks effectivement nettoyés (pour télémétrie).
- Appeler depuis `QueueRunner.requestStop` AVANT `setRunning(false)`.

> #### 📝 Note de relecture Phase 3 (Axel, 2026-06-04, transmise à l'agent)
>
> **Lire le commit `af3195fa` AVANT d'écrire la Phase 3.** Il introduit
> 2 mécanismes (Fix G zombie-safe `ZoneLock.commit`, Fix H `commitZone`
> ciblé) qui changent les hypothèses du plan initial. Synthèse des
> ajustements à intégrer :
>
> **1. Pas besoin de forcer `released=true` sur les closures `ZoneLock`
> pending.** Le plan original disait "commit()/release() post-cleanup
> doivent être no-op (released=true set par cancelOrphaned)". Fausse
> piste : `released` vit dans la closure, le RBS n'a pas de handle
> dessus sans rupture API. Inutile parce que la zombie-safe path
> ([rendered-board-state.service.ts:286-289](../../front/src/app/pages/pvp/duel-page/rendered-board-state.service.ts#L286-L289))
> gère déjà le cas : si une IIFE bail post-cleanup et call `commit()`,
> ça fire `commitZone(zoneKey)` qui est idempotent. Double-fire
> théorique, no-op en pratique.
>
> **2. Ne PAS étendre `commitAll`, créer une méthode distincte
> `dropOrphanedLocks(reason: string): number`.** `commitAll` fait
> aujourd'hui 90% de ce qu'on veut, MAIS il termine par
> `_rendered.set(_logical())` — full sync rendered ← logical. Au
> `requestStop` (avant `jumpToState` qui va re-setter la state cible
> dans la foulée), ce full-sync est temporaire et peut masquer un
> état intermédiaire incorrect. La nouvelle méthode :
>
> ```ts
> dropOrphanedLocks(reason: string): number {
>   const count = this._locks.size;
>   if (count === 0) return 0;
>   this.logger?.warn(`[v3] dropOrphanedLocks(${reason}) clearing ${count} locks: ${[...this._locks.keys()].join(', ')}`);
>   for (const tid of this._safetyTimeouts) clearTimeout(tid);
>   this._safetyTimeouts.clear();
>   this._locks.clear();
>   // NE PAS toucher _rendered — le caller suivant (resetForReplaySeek
>   // → jumpToState → updateLogical → commitAll OU notifyPerspectiveSwitch
>   // → syncRendered) pose la state cible.
>   this._tolerateLocksDroppedCount += count;  // réutilise compteur F5 existant
>   return count;
> }
> ```
>
> Sémantique distincte assumée : `commitAll` = terminal teardown
> (rendered ← logical full sync), `dropOrphanedLocks` = transition
> (clear locks + safety timers, laisse rendered intact, caller suivant
> set la state cible).
>
> **3. Ordre exact dans `QueueRunner.requestStop()` — insérer le call
> APRÈS `_innerLoopDepth = 0`, AVANT `setRunning(false)`.** C'est la
> seule fenêtre où :
>   - Le `_abort.abort()` a déjà fait son taf (suspended loops vont
>     bail à leur prochain `throwIfAborted()`).
>   - `setRunning(false)` n'a PAS encore trigger la cascade
>     `onIsRunningChange → setAnimating(false) → advanceStep →
>     assertNoLocks throw` (qui est la cascade du log
>     `console-export-2026-6-4_13-57-59.log` lignes 706-733).
>
> ```ts
> // queue-runner.ts requestStop() — patch après _innerLoopDepth = 0
> const droppedCount = this.deps.dataSource.renderedBoardState
>   .dropOrphanedLocks('runner-requestStop');
> this.trace('requestStop:dropped-locks', { count: droppedCount });
> this.setRunning(false);
> ```
>
> **4. GARDER le compteur `_postRequestStopWindow` actif post-Phase 3.**
> Il est instrumental Phase 1 mais devient un **détecteur de
> régression Phase 2** : tout `lockZone()` qui fire pendant la window
> = handler async non-wiré avec l'AbortSignal. Le compteur reste utile
> jusqu'à la fin du chantier comme signal "Phase 2 incomplète".
>
> **5. Vérifier interaction `FloatRegistry` en Phase 6.** Le
> `commitUnlocked()` assert ([rendered-board-state.service.ts:380-384](../../front/src/app/pages/pvp/duel-page/rendered-board-state.service.ts#L380-L384))
> throw si une zone a un float in-flight mais n'est plus locked.
> Après `dropOrphanedLocks`, si un caller post-`requestStop` appelle
> `commitUnlocked()` avec des floats survivants, throw. À vérifier
> dans les tests : soit aucun caller ne re-trigger `commitUnlocked()`
> dans le path post-`requestStop`, soit `dropOrphanedLocks` doit aussi
> faire `floatRegistry.clearAllTravels()` (à confirmer manuellement).
>
> **6. Test critique avant Phase 4 — valider que le bug du log
> `console-export-2026-6-4_13-57-59.log` ne se reproduit plus AVEC les
> 3 asserts de `replay-duel-adapter.ts` toujours stricts.** Si oui →
> Phase 3 seule suffit pour débloquer, Phase 4 (retrait
> `tolerateLocks`) peut se faire en confiance. Sinon, audit Phase 2
> incomplet (handler async qui leak un lock post-abort).
>
> **Ce que la Phase 3 NE doit PAS faire :**
> - Retirer la zombie-safe path d'`af3195fa` — defense-in-depth contre
>   d'autres `commitAll` non-related (terminal teardowns).
> - Toucher au `rendered` signal dans `dropOrphanedLocks` — le caller
>   suivant pose la state cible (sinon on masque un bug).
> - Renommer ou modifier `commitAll` — sa sémantique terminale reste
>   valide pour `cleanup()`, `destroy()`, STATE_SYNC, REMATCH.

### Phase 4 — retirer les `tolerateLocks` skips

- Retirer le paramètre `tolerateLocks` de `resetAllState`.
- Retirer le call-site flag dans `resetForReplaySeek`.
- Restaurer les 3 asserts strictes dans `replay-duel-adapter.ts`.
- Retirer le compteur `tolerateLocksDroppedCount` (devenu inutile).

### Phase 5 — assouplir SOLO + ajouter `resetForSoloSwitch`

- Ajouter `AnimationOrchestratorService.resetForSoloSwitch()` (mirror de
  `resetForReplaySeek` sans `tolerateLocks`).
- Réduire `canSwitchPerspective` à `promptBlocks` uniquement.
- Brancher `resetForSoloSwitch` dans `SoloDuelOrchestratorService.switchPerspective()`
  AVANT `notifyPerspectiveSwitch`.

### Phase 6 — tests

- Karma : 1 spec par phase. Le harness `MockDataSource` + `makeRunner`
  livré au palier C (chantier QueueRunner) couvre les paths runner.
- e2e Playwright : harness v2 (cf.
  [replay-debug-harness-v2-2026-06-03.md](replay-debug-harness-v2-2026-06-03.md))
  une fois livré — scénario "togglePerspective mid-chain" en replay puis
  SOLO.
- Manuel : reproduire le log
  [console-export-2026-6-4_13-57-59.log](../../console-export-2026-6-4_13-57-59.log)
  et confirmer 0 throw.

## Effort estimé

| Phase | Durée |
|---|---|
| 1 (instrumenter) | 1h |
| 2 (AbortSignal dans handlers) | 3-4h |
| 3 (cancelOrphanedLocks) | 1h |
| 4 (retrait skips) | 30min |
| 5 (SOLO + resetForSoloSwitch) | 1-2h |
| 6 (tests + manuel) | 2-3h |
| **Total** | **~8-12h** |

## Risques identifiés

1. **IIFE bailout incomplet** — les handlers async ne checkent pas tous
   `signal.aborted` à chaque `await`. Phase 2 doit faire un audit
   exhaustif sinon des fuites résiduelles passent à travers.

2. **Refactor `lockZone` impact bas** — la signature change pour tous
   ses callers. Probablement ~30-50 sites. Migration via codemod ou
   pattern "deprecated old form + new form coexist" pendant N commits.

3. **SOLO timing** — `resetForSoloSwitch` clear le runner mais le
   serveur reste dans son état. Si le user switch perspective alors que
   le worker est en `WAITING_RESPONSE` pour le slot A et que l'UI flip
   à B, le serveur attend toujours la réponse de A. Vérifier que le
   `_lastAbsoluteBoardState` re-feed couvre ce cas ou si on doit aussi
   `requestStateSync` au switch.

4. **Régression test suite** — la suite a beaucoup de specs qui mockent
   `lockZone` ou qui pose des locks "à la main" dans des fixtures. La
   nouvelle signature optionnelle reste back-compat mais le retrait des
   `tolerateLocks` skips peut faire fail des specs qui dépendaient du
   comportement actuel.

## Décisions ouvertes

- **Stratégie d'IIFE bailout** : pure no-op handle (lockZone retourne
  inerte) vs throw `AbortError` que les handlers catch. Le no-op est plus
  simple mais masque les bails. Throw donne du contrôle mais demande des
  catch dans tous les handlers.
- **Doit-on garder le `LOCK_SAFETY_TIMEOUT_MS`** si les locks ne peuvent
  plus orpheliner ? Probablement oui en filet ultime (defense-in-depth)
  mais le délai peut descendre de 7.5s à 1s (alerte précoce d'un cas
  oublié).
- **Faut-il assouplir aussi le replay `[disabled]` côté bouton** ou laisser
  comme aujourd'hui (toujours cliquable) ? Le replay n'a pas de gate
  amont — la doctrine v3 préserve ça (parité descendante).

## Liens

- Bug observé : [console-export-2026-6-4_13-57-59.log](../../console-export-2026-6-4_13-57-59.log) lignes 706-733.
- Commit antérieur partiel : `c41db25a` "tolerate stranded locks at user-triggered replay seek".
- CLAUDE.md section "Replay Board State Parity Rule" — documente les 4
  skip sites actuels qui disparaîtront en Phase 4.
- Harness backlog : [replay-debug-harness-v2-2026-06-03.md](replay-debug-harness-v2-2026-06-03.md).
