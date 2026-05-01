# PVP ↔ Replay Divergences

Audit des différences comportementales entre le mode PVP (`DuelConnection`) et le mode
Replay (`ReplayDuelAdapter`) dans le pipeline animation/rendering.

**Objectif** : aligner les deux modes au maximum pour que tester en replay couvre le PVP
(hors timing socket).

---

## HIGH — Bugs masqués par replay

### 1. `commitAll()` aux frontières de transition (replay-only)

Replay appelle `commitAll()` avant chaque nouvelle transition → efface tous les locks.
En PVP, seul `commitUnlocked()` tourne entre les events. Si un lock fuit, replay le
masque automatiquement, PVP non.

**Fichiers** :
- `replay-duel-adapter.ts` : lignes 99, 110, 129, 175, 210, 240
- `animation-orchestrator.service.ts:105` : `finalizeAndCommit()` → `commitUnlocked()`

**Implication** : tout futur bug de lock orphelin sera invisible en replay.

### 2. `setAnimating(false)` → boucle synchrone (replay-only)

En replay, `setAnimating(false)` appelle `advanceStep()` synchroniquement → peut
immédiatement re-peupler la queue et relancer les animations. En PVP,
`setAnimating(false)` ne fait rien — la queue ne se remplit que quand un message
WebSocket arrive (asynchrone).

**Fichiers** :
- `replay-duel-adapter.ts:47-56` : `setAnimating(false)` → `advanceStep()`
- `duel-connection.ts:258-261` : `setAnimating(false)` → noop (log + flag)

**Implication** : fenêtre en PVP entre `setAnimating(false)` et le prochain message WS.
Si un event arrive pendant cette fenêtre et que le watcher ne re-trigger pas
l'orchestrateur → queue bloquée.

### 3. Timing des events : synchrone (replay) vs asynchrone (PVP)

Replay feed tous les events d'un step d'un coup (boucle `for`). PVP les reçoit un par
un via WebSocket. En PVP, si des messages arrivent avec du délai entre eux :
- `preLockQueuedSources` ne voit que les events déjà dans la queue
- Un MSG_MOVE qui arrive 50ms plus tard n'est pas pré-locké → sa zone destination peut
  flasher avant que l'animation commence

**Fichiers** :
- `replay-duel-adapter.ts:195-206` : boucle synchrone `for (const event of step.events)`
- `duel-connection.ts:368-375` : `onmessage` → `handleMessage()` un par un
- `move-animation-router.ts:166-200` : `preLockQueuedSources` — snapshot de la queue

**Mitigation partielle** : `preLockQueuedSources` est re-exécuté à chaque itération de
la queue loop (line 429 au début, line 538 après processEvent). Un event arrivant
pendant un `await` sera pré-locké à l'itération suivante avant tout `commitUnlocked`.
Le résidu théorique (event arrivé entre `commitUnlocked` et son propre processing) est
borné par les locks acquis synchrones dans chaque branche.

---

## MEDIUM — Comportement différent

### 4. `isBoardActive` dynamique (PVP) vs toujours `true` (replay)

En PVP, si l'adversaire se déconnecte mid-animation → `boardActive = false` → prochain
`BOARD_STATE` appelle `commitAll()` → locks cassés → carte snap à destination.

**Fichiers** :
- `duel-page.component.ts:470` : `isBoardActive: () => this.roomState() === 'active'`
- `replay-page.component.ts:414` : `isBoardActive: () => true`
- `animation-data-source.ts:67-68` : `if (!boardActive) rbs.commitAll()`

### 5. Chain state preservation entre transitions

Replay préserve le chain state entre transitions (`resetQueue()` au lieu de `reset()`).
PVP n'a pas de concept de "transition" — les events arrivent en continu. Si un
STATE_SYNC arrive mid-chain → `reset()` complet → chain links disparaissent.

**Fichiers** :
- `replay-duel-adapter.ts:250-256` : `resetProcessorForTransition()` — garde chain state
- `duel-connection.ts:424-429` : STATE_SYNC → `processor.reset()` (tout efface)

### 6. Prompt timing et auto-response

PVP : prompt réel, l'utilisateur décide (potentiellement 30s). Replay : auto-respond
avec délai 800–3000ms. Pendant ce temps, la queue peut accumuler des events
différemment → le queue collapse (>5 events) peut se trigger dans un mode mais pas
l'autre.

**Fichiers** :
- `duel-prompt-effects.service.ts:17-49` : auto-respond conditionnel (PVP)
- `replay-page.component.ts:688-701` : `schedulePromptDismiss()` (replay)

---

## LOW — Cosmétique / informatif

### 7. `setAnimating(true)` jamais appelé en replay

Le flag `_animating` en replay est géré via le signal `busy`. Pas d'impact visuel.

### 8. Animation collapse timing

Même mécanisme (`animation-orchestrator.service.ts:379-388`), mais la taille de queue au
moment du check peut différer entre les deux modes.

---

## Résolutions

- [x] **#1 Lock lifecycle** : `commitAll()` remplacé par `syncRendered()` dans le flux
  normal de replay (6 sites). `assertNoLocks()` ajouté aux frontières de transition
  pour détecter les lock leaks en dev. `abort()` / `jumpToState()` conservent
  `commitAll()` (chemins de reset exceptionnels, comme `onStateSync` en PVP).
  `syncAfterBoardState` utilise un three-tier sync : full sync (idle+empty queue),
  `syncPileCounts()` (DECK/EXTRA + metadata, queue non-vide), defer (resolving).
  Cela empêche les zones animées d'être exposées prématurément quand les pre-locks
  ne sont pas encore en place.
- [x] **#2 `setAnimating` contrat** : gardé tel quel (option A). La boucle synchrone
  `setAnimating(false)` → `advanceStep()` est l'analogue replay du WebSocket `onmessage`.
- [x] **#3 Timing sync vs async** : accepté comme risque résiduel. Pre-lock est
  "best effort" — le vrai garde-fou est le `dstLock` synchrone dans chaque branche.
  **Parité partielle acquise via `boardStateAfter`** (commit 92adc7e4) : le serveur
  attache une snapshot post-event aux events BOARD_CHANGING en phase resolving dans
  LES DEUX modes (live + precompute) ; `processEvent` appelle
  `rbs.updateLogical(boardStateAfter)` avant dispatch → logical state avance au même
  grain des deux côtés.
- [x] **#4 `isBoardActive`** : accepté — PVP-only par nature (déconnexion réseau).
- [x] **#5 Chain state** : s'aligne automatiquement avec la résolution de #1.
- [x] **#6 Prompt timing** : accepté — inhérent à la nature du replay.

---

## MEDIUM+ — Nouveaux points documentés (commit 92adc7e4)

### 9. Queue collapse — drop silencieux d'events visuels

Avant fix : le prédicat "pas de chain event" autorisait la collapse sur TOUT type
d'event. Mais `applyInstantAnimation()` ne traite que LP/chain. MSG_MOVE,
MSG_CONFIRM_CARDS, etc. étaient **silencieusement droppés** en combo long.

**Fichiers** :
- `animation-orchestrator.service.ts:418-431` — collapse loop
- `animation-orchestrator.service.ts:974-987` — applyInstantAnimation

**Résolution** : prédicat inversé en "TOUS les events sont LP-class". Les bursts LP
pathologiques restent collapsés, les events visuels jamais. Voir CLAUDE.md → Chain
State Machine Rules → Queue collapse.

### 10. Buffer replay — séquence d'animations multi-event

Nouveaux invariants documentés dans CLAUDE.md → Buffer Replay Batch Construction :
- Interleave CONFIRM_CARDS par card pour flow tutor→reveal→tutor.
- Session HAND lock + beginHandBatch pour fan positions distincts.
- Category boundary flush pour XYZ detach → destroy.
- commitAndClearFloat conditionnel (garde float tant que zone lockée).

S'appliquent aux DEUX modes puisque le buffer est alimenté par `chainManager.
bufferIfResolving` et drainé par `replayBuffer` identiquement.
