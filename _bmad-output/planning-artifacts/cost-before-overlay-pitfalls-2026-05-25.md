# Cost-Before-Overlay — Pièges & Failed Attempts (2026-05-25)

**Statut** : RECHERCHE ÉCHOUÉE — Tous changements revertés à HEAD `3f4d18ae`.
**Branche** : `chore/queue-runner-palier-0`.
**Objectif initial** : Faire apparaître le chain overlay APRÈS que les animations de coût (discard d'Ash Blossom, tribute, banish, detach) soient drainées de la queue, pas dès la réception WS de `MSG_CHAIN_SOLVING`.

Ce mémo documente **tous les pièges rencontrés** pendant la session 2026-05-25 pour qu'un chantier futur (option C — refactor profond planifié) ne les reproduise pas.

---

## 1. Le bug visuel cible

**Symptôme observé** : Quand Ash Blossom (ou tout handtrap avec cost SelfToGrave) chaîne sur un effet adverse en chain-2+, l'overlay chain apparaît AVANT que la carte ait fini son animation de discard vers le GY. Récit YGO attendu : `activate flash → discard travel → overlay apparaît → resolve`. Récit observé : `activate flash → overlay apparaît → discard travel → resolve`.

**Repro URL** : `/pvp/replay/db88ea27-7485-4285-aeae-ae4023f3b9c6?seekTo=4` (en replay) ou scénario SOLO PvP Lukias activate effect → switch player → Ash Blossom activate.

**Documentation aspirationnelle déjà présente dans le code** : [duel-event-processor.ts:46-50](front/src/app/pages/pvp/duel-page/duel-event-processor.ts#L46-L50) — *"deferred so cards that need cost payment finish their move animation first"*. L'intention existe depuis le commit `18b579c6` (2026-05-21) mais l'implémentation n'a jamais matché.

---

## 2. Les designs essayés et pourquoi ils ont tous échoué

### Tentative #1 — Single-pending + deferral à `MSG_CHAIN_SOLVING`

**Idée** : retirer le `commitPendingChainEntry()` du `case 'MSG_CHAIN_SOLVING'` du processor (timing WS) et le déplacer dans `AnimationOrchestratorService.handleChainSolving` (timing animation), via une nouvelle méthode `notifyChainSolvingDispatched()`.

**Pourquoi ça aurait dû marcher** : le QueueRunner ([queue-runner.ts:518-558](front/src/app/pages/pvp/duel-page/queue-runner.ts#L518-L558)) sérialise les events un par un en `await`ant chaque handler. Donc quand `MSG_CHAIN_SOLVING` est dispatché, tous les events précédents (`MSG_CHAINING`, `MSG_MOVE` de cost) sont animés.

**Pourquoi ça a échoué** : entre `MSG_CHAINING` (réception WS) et `MSG_CHAIN_SOLVING` (réception WS), le serveur envoie souvent un `WAITING_RESPONSE` (qui ouvre `SELECT_CHAIN`). Le case `WAITING_RESPONSE` du processor faisait `commitPendingChainEntry()` immédiatement → l'overlay s'affichait dès la réception WS, **avant** que la queue d'animation ait dispatché quoi que ce soit.

**Log de référence** : `console-export-2026-5-25_8-46-32.log` — `notifyChainSolvingDispatched NO-OP (no pending)` partout, le commit avait déjà eu lieu via `WAITING_RESPONSE`.

### Tentative #2 — Defer `WAITING_RESPONSE` / `SELECT_*` si `MSG_CHAIN_SOLVING` en queue (`commitPendingChainEntryIfNoSolvingQueued`)

**Idée** : `WAITING_RESPONSE` et `SELECT_*` ne commit que si pas de `MSG_CHAIN_SOLVING` dans l'animation queue.

**Pourquoi ça a échoué** : dans la séquence réelle observée (Lukias → Ash chain), `WAITING_RESPONSE` arrive **avant** que `MSG_CHAIN_SOLVING` soit en queue. Le serveur émet `CHAINING → WAITING_RESPONSE → CHAINING → WAITING_RESPONSE → … → tous les MSG_MOVE de cost → MSG_CHAIN_SOLVING × N`. Le `WAITING_RESPONSE` arrive en burst avant les MOVE, donc bien avant le SOLVING. Le predicat "SOLVING en queue" matche jamais à ce moment.

**Log de référence** : `console-export-2026-5-25_8-53-54.log` — `WAITING_RESPONSE chainIndex=1 → activeChainLinks.length=2` (commit direct, pas DEFERRED) ligne 288, puis `MSG_MOVE` après ligne 303.

### Tentative #3 — Defer si `chainPhase === 'building'` (`commitPendingChainEntryDeferredIfBuilding`)

**Idée** : predicat plus large. En phase `building`, par contrat YGO/OCGCore, soit `MSG_CHAIN_SOLVING` viendra (commit via `notifyChainSolvingDispatched`), soit `MSG_CHAIN_END` viendra (commit safety net direct). Defer toutes les safety nets `WAITING_RESPONSE` / `SELECT_*` en `building`.

**Problème introduit** : le case `MSG_CHAINING` faisait toujours `commitPendingChainEntry()` direct (overwrite protection), parce qu'avec un single-pending si CHAINING #2 arrive avec pending #1 toujours là, on doit commit #1 avant de poser pending=#2 (sinon perte). Mais ce commit overwrite-protect arrive **à la réception WS de CHAINING #2**, donc avant que la queue d'animation ait drainé MSG_MOVE de CHAINING #1.

**Log de référence** : `console-export-2026-5-25_9-11-3.log` lignes 107-117 — `MSG_CHAINING-overwrite-protect chainIndex=1 → length=2` (overlay pop) PUIS `MSG_MOVE handleEntry` (discard Ash arrive après).

### Tentative #4 — FIFO `_pendingChainEntries[]` + commit à `notifyChainSolvingDispatched` (FIFO head)

**Idée** : remplacer `_pendingChainEntry: signal<… | null>` par `_pendingChainEntries: signal<…[]>`. Append à chaque `MSG_CHAINING`, shift+commit à chaque `notifyChainSolvingDispatched`, flush à `MSG_CHAIN_END`. Pas d'overwrite-protect car la file accumule.

**Résultat** : **catastrophe** (`console-export-2026-5-25_9-26-5.log`). Multiples bugs :

1. **`resetForSwitch` vide la FIFO en plein milieu** (lignes 207, 244, 280, 309) — SOLO PvP switch entre joueurs détruit l'état. Les `notify` n'ont jamais lieu côté nouvelle conn car le SOLVING est arrivé dans l'instance morte.

2. **`MSG_CHAIN_END` flush ramène 3 pending d'un coup** (ligne 442-444) — l'overlay voit `0 → 3` et déclenche `WILL_SHOW_OVERLAY` **à la fin de la chain**, alors qu'il aurait dû apparaître AVANT.

3. **Contamination cross-chain** (lignes 629-636) — `activeChainLinks.length=4` au début d'une nouvelle chain, parce que la précédente est restée matérialisée. `applyChainEnd()` (qui clear `_activeChainLinks`) n'arrive jamais ou trop tard.

4. **`chainLinksWithPending = [...links, ...pending]`** dans duel-page/replay-page peut afficher 6 cartes au lieu de 3 dans le hand-row pendant une chain (régression visuelle).

5. **Burst `MSG_CHAIN_SOLVING` côté serveur** (lignes 432-439 : 4 SOLVING d'affilée) — pas sûr que chaque dispatch passe par `handleChainSolving`. Possible batch/skip qui empêche notify de tirer une fois par SOLVING.

---

## 3. Mécanismes systémiques à comprendre AVANT de retenter

### A. Le QueueRunner ne sérialise PAS dans tous les cas

Hypothèse de départ fausse : *"le runner await chaque handler, donc activate → cost → solving est séquentiel"*. En réalité, le séquencement casse dans **4 scénarios** :

1. **SOLO PvP switchPlayer** : 2 `DuelConnection` distinctes, l'orchestrator switch d'instance via `setActiveConnection`. `resetForSwitch` clear `_animationQueue` et plus encore. Si une chain est en cours sur conn0 et le switch arrive, le pending state de conn0 est perdu ou orphelin.

2. **Replay seek** : `abortAndClean` → `resetForSwitch` → fresh feed. Le `QueueRunner` palier C utilise `AbortController` pour court-circuiter les awaits mais le timing de l'orchestrator vs WS reception n'est pas garanti.

3. **Burst WS de N MSG_CHAIN_SOLVING** : OCGCore envoie tous les SOLVING/SOLVED de la chain en burst (souvent 4-6 messages en quelques µs). La queue d'animation se remplit mais le processor ne distingue pas "je drain le SOLVING #1" vs "j'ajoute SOLVING #2,#3,…" à la file.

4. **Animations parallèles non-await** : `BoardEffectsService.activateEffect` retourne une Promise qui pourrait résoudre AVANT que toutes les particules soient visuellement finies (voir [[faimena-activate-cost-overlap-2026-05-24]]).

### B. `MSG_CHAIN_END` est traité différemment par WS reception vs animation dispatch

- **Réception WS** : `case 'MSG_CHAIN_END'` dans `_processMessageInner` → enqueue (au cas où) + safety net commit. Mais c'est ICI que le code historique commit aussi le pending pour les paths où SOLVING n'arrive jamais.
- **Animation dispatch** : `handleChainEnd` dans orchestrator → `applyChainEnd()` qui set `chainPhase = 'idle'` ET clear `_activeChainLinks`.

Deux moments distincts. Un fix qui modifie la sémantique du commit doit considérer les deux.

### C. Le composant `PvpChainOverlayComponent` a 5 effects entrelacés

[pvp-chain-overlay.component.ts:226-387](front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts#L226-L387) :

- **Effect A** : main chain logic (lit `activeChainLinks` + `phase`) → `onNewChainLink()` qui `overlayVisible.set(true)` si `length ≥ 2`.
- **Effect B** : resolving detection → relit `overlayVisible.set(true)` quand `phase === 'resolving'`.
- **Effect C** : pending entry animation après prompt close.
- **Effect D** : hide overlay pendant chain resolution banner.
- **Effect E** : hide overlay quand prompt arrive pendant resolution.

**Conséquence** : changer `activeChainLinks` ou `chainPhase` à un moment précis peut déclencher 1, 2, ou 3 effects en cascade. Le simple fait de différer le commit du pending modifie le timing de tous ces effects sans qu'on s'en rende compte.

### D. Plusieurs consommateurs de `pendingChainEntry` au-delà du composant overlay

- `duel-page.component.ts:373` : `chainLinksWithPending` (hand-row z-index + chain badges).
- `replay-page.component.ts:452` : idem.
- `replay-duel-adapter.ts:36` : expose au template adapter.
- `duel-connection.ts:177` : expose la version processor.
- `duel-web-socket.service.ts:72` : computed sur l'active connection.

Tout changement de signature/valeur de `pendingChainEntry` casse 5 fichiers minimum (+ leurs specs).

### E. Le case `MSG_CHAINING` du processor a 3 responsabilités entrelacées

1. Set `chainPhase` à `'building'` (ligne 113).
2. Commit le pending précédent (overwrite protection, ligne 115).
3. Set le nouveau pending (ligne 116).
4. Enqueue le message dans `_animationQueue` (ligne 117).

Ces 4 actions sont **synchrones et inséparables** dans la version actuelle. Pour les déférer/séparer, il faut soit (a) accepter une FIFO de pending (avec les bugs vu en tentative #4), soit (b) introduire un nouveau signal `_chainLinksBuilding` qui sert au hand-row mais pas à l'overlay (decoupling structurel).

---

## 4. Recommandations pour le chantier C (option refactor profond)

### Spec attendu

Une spec BMad formelle dans `_bmad-output/planning-artifacts/` qui couvre :

1. **Inventaire complet des consommateurs** de `activeChainLinks`, `pendingChainEntry`, `chainPhase`. Vérifier comment chacun réagit à des transitions de timing modifiées.

2. **Couverture de tests d'intégration** spécifiques aux 4 scénarios qui cassent (voir §3.A) : SOLO PvP switch mid-chain, replay seek mid-chain, burst de N SOLVING, animation parallèle non-await.

3. **Decoupling structurel** : envisager de séparer le signal qui pilote le hand-row (peut être commit-eager) du signal qui pilote l'overlay (doit être commit-deferred). Plutôt qu'un seul `activeChainLinks` partagé.

4. **Validation SOLO PvP** : tout le scénario `console-export-2026-5-25_9-26-5.log` doit fonctionner sans contamination, sans flush bidon, sans overlay-pop tardif.

5. **Validation replay** : seek mid-chain, jump forward/backward, sub-event navigation — chacun doit préserver l'invariant *"overlay grows in sync with animation"*.

### Antipatterns à proscrire absolument

- **Pas de FIFO `_pendingChainEntries[]`** sans un mécanisme de cleanup robuste qui gère SOLO switch + replay seek + reset. La tentative #4 le prouve.

- **Pas de safety net "défère si X en queue"** — le predicat sur la queue d'animation est fragile car le serveur envoie en burst et la queue se remplit/vide rapidement (cf. tentative #2).

- **Pas de overwrite-protect synchrone à la réception WS** d'un nouveau `MSG_CHAINING` — c'est ce qui crée le bug de timing en chain-2+ (tentative #3).

- **Pas de modification de la signature de `pendingChainEntry`** (single → array, ou suppression) sans une migration coordonnée des 5+ consommateurs et de leurs specs (+ mock signals).

- **Pas de `MSG_CHAIN_END` flush bulk** qui ajoute N entries d'un coup à `activeChainLinks` — l'effect A va voir un saut `0 → N` et déclencher l'overlay au mauvais moment.

### Approche à favoriser (esquisse)

**Decoupling signal** : introduire `_handRevealChainLinks` (eager, suit tous les CHAINING reçus en WS) et `_animatedChainLinks` (deferred, suit le tempo d'animation). Le hand-row lit le premier, l'overlay lit le second. Pas de FIFO car les deux signaux sont indépendants.

OU

**Signal externe pour l'overlay** : laisser le processor + activeChainLinks tels quels (commit à WS reception, comportement actuel). Ajouter un nouveau signal côté orchestrator `_overlayAllowed = signal(false)` qui passe à `true` seulement quand l'orchestrator a fini d'animer le MOVE de cost. Le composant overlay regarde `activeChainLinks.length ≥ 2 && _overlayAllowed`.

**Avantage du 2e** : zéro modification au processor, zéro impact sur hand-row, scope chirurgical. C'est plus proche de l'option A du diagnostic original (Sally).

---

## 5. Fichiers touchés pendant la session (tous revertés)

Pour mémoire, les 14 fichiers qui ont été modifiés pendant la session et restaurés à HEAD :

- `CLAUDE.md` (ajout section "Pending Chain Entry Commit Timing")
- `front/src/app/pages/pvp/duel-page/duel-event-processor.ts` (cœur du fix)
- `front/src/app/pages/pvp/duel-page/duel-event-processor.spec.ts` (specs)
- `front/src/app/pages/pvp/duel-page/animation-data-source.ts` (interface)
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` (handleChainSolving)
- `front/src/app/pages/pvp/duel-page/duel-connection.ts` (délégation)
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` (délégation)
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` (chainLinksWithPending)
- `front/src/app/pages/pvp/duel-page/duel-page.component.spec.ts` (mock signal)
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts` (traces temporaires)
- `front/src/app/pages/pvp/replay/replay-duel-adapter.ts` (délégation)
- `front/src/app/pages/pvp/replay/replay-duel-adapter.spec.ts` (specs)
- `front/src/app/pages/pvp/replay/replay-page.component.ts` (chainLinksWithPending)
- `front/src/app/pages/pvp/replay/replay-integration.spec.ts` (specs adapter)

Tous revertés via `git checkout HEAD --` sur `chore/queue-runner-palier-0`.

---

## 6. Note sur l'état du repo après revert

Une erreur TS pré-existante dans `front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:50-51` empêche actuellement la compilation Angular :

```
conn0.onStateSync = (msg) => this.wsService.onStateSync?.(msg);
```

`DuelConnection.onStateSync` a la signature `() => void` mais on passe 1 argument `msg`. Ce fichier n'a PAS été touché pendant cette session — c'est une modif non commitée pré-existante dans la branche, probablement liée au chantier palier 0 game-log inachevé. Devra être résolue séparément (à fixer en amont avant de relancer un chantier C).

---

## 7. Logs sources de référence (à conserver pour reproduction)

- `console-export-2026-5-25_8-46-32.log` — tentative #1 (single-pending + defer à SOLVING)
- `console-export-2026-5-25_8-53-54.log` — tentative #2 (IfNoSolvingQueued)
- `console-export-2026-5-25_9-11-3.log` — tentative #3 (DeferredIfBuilding + overwrite-protect)
- `console-export-2026-5-25_9-26-5.log` — tentative #4 (FIFO) — la catastrophe finale
- `console-export-2026-5-24_22-18-18.log`, `22-23-27.log`, `23-1-38.log` — premiers tests visuels avant le diagnostic complet

Toutes ces traces ont des préfixes `[COMMIT-TRACE]` et `[OVERLAY-TRACE]` qui ne sont **plus dans le code** (revert). Pour les régénérer, voir la section Layer 1 / DuelLogger de CLAUDE.md.

---

**Auteur** : Amelia (BMad agent dev)
**Session** : 2026-05-25 ~08:00-10:00 UTC
**Pair-programming initial** : Sally (UX) → Winston (architecte) → Amelia (dev)
**Décision finale** : revert + tracking pour chantier C ultérieur
