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
