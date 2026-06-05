# ReplayDuelAdapter — inventaire complet avant suppression (2026-06-05)

> **Statut** : inventaire de référence pour le chantier v4
> ([anim-pipeline-v4-replay-unification-2026-06-05.md](anim-pipeline-v4-replay-unification-2026-06-05.md)).
> À consulter en Phase 1 (design `MockDuelConnection`) et Phase 5
> (cleanup) — chaque comportement listé ici doit être consciemment
> "porté", "remplacé" ou "retiré". Pas d'oubli silencieux.

## Périmètre

`replay-duel-adapter.ts` (418 lignes) + `replay-transport.service.ts`
(345 lignes) — les 2 fichiers qui meurent en Phase 5.

Le doc liste **chaque responsabilité concrète** des 2 fichiers et son
sort dans le chantier v4. Les sections sont organisées par type de
comportement, pas par fichier.

## A — Contract `AnimationDataSource` (adapter ↔ orchestrator)

Tout ce qui est délégué au `processor: DuelEventProcessor` :

| Méthode | Implémentation actuelle | Sort v4 |
|---|---|---|
| `dequeueAnimation()` | `processor.dequeueAnimation()` | **Porté** — `MockDuelConnection` délègue identiquement au processor |
| `removeAnimationAt(i)` | `processor.removeAnimationAt(i)` | **Porté** |
| `prependToQueue(entries)` | `processor.prependToQueue(entries)` | **Porté** |
| `enqueueDirective(d)` | `processor.enqueueDirective(d)` | **Porté** |
| `applyChainSolving(idx)` | `processor.applyChainSolving(idx)` | **Porté** |
| `applyChainSolved(idx)` | `processor.applyChainSolved(idx)` | **Porté** |
| `applyChainEnd()` | `processor.applyChainEnd()` | **Porté** |

**Observation** : la majorité de l'interface adapter est juste un
pass-through vers le processor. C'est aussi ce que fait `DuelConnection`
(post-γ-c c8 : 1 processor par connection). Pas de difficulté de portage —
copier-coller depuis `DuelConnection` ou créer une classe de base.

Signaux exposés :

| Signal | Source | Sort v4 |
|---|---|---|
| `animationQueue` | `processor.animationQueue` | **Porté** |
| `activeChainLinks` | `processor.activeChainLinks` | **Porté** |
| `chainPhase` | `processor.chainPhase` | **Porté** |
| `hasPendingChainEntry` | `processor.hasPendingChainEntry` | **Porté** |
| `pendingChainEntry` | `processor.pendingChainEntry` | **Porté** |
| `pendingPrompt` | `signal<Prompt \| null>(null)` — **toujours null en replay actuel** | **Change** : `MockDuelConnection` met une vraie value sur SELECT_* (comme PvP) |
| `renderedBoardState` | `rbs` (owned, instantiated locally) | **Porté** |
| `boardStateView` | `rbs` | **Porté** |

**Point d'attention 1** — Aujourd'hui le replay n'expose JAMAIS de prompt
visible côté `pendingPrompt` signal (le prompt est exposé via
`activePrompt` computed sur `_activeDecision`). C'est `pvp-prompt-dialog`
qui lit `dataSource.pendingPrompt`. Donc aujourd'hui en replay le dialog
ne s'affiche pas via ce path — il s'affiche via une autre voie (à vérifier).

En v4 (Option B), `MockDuelConnection.pendingPrompt` sera mis à jour
quand `dispatchNext()` dispatche un `SELECT_*` — exactement comme PvP.
**Conséquence subtile** : le code de `pvp-prompt-dialog` côté replay
prend potentiellement un chemin différent post-v4. À tester en Phase 7.

## B — Pipeline de feed des transitions (cœur du travail v4)

C'est là que se trouve la **vraie complexité spécifique au replay** qui
disparaît dans v4. Détaille chaque méthode.

### B1 — `feedTransition(prev, next)` ([replay-duel-adapter.ts:151](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L151))

Fait :
1. `busy.set(true)` + reset `_steps = []`.
2. `rbs.updateLogical(swapBs(prev.boardState))` — restore la state de DÉPART.
3. `rbs.assertNoLocks('feedTransition')`.
4. `rbs.syncRendered()` — rendered ← logical.
5. `resetProcessorForTransition()` — clear le processor (full reset si idle, juste queue si mid-chain).
6. Boucle sur `swapEvents(next.events)` → `processor.processMessage(event)` pour chaque.
7. `syncAfterBoardState(rbs, chainPhase, queueLen, swappedNext, true)` — sync tier decision.
8. `processor.observeBoardState(swappedNext)` — alimente BoundaryProcessor pour Turn/Phase deltas.
9. Si queue vide → `rbs.syncRendered()` + `busy.set(false)`.

**Sort v4** : disparaît. Remplacé par `mockConn.dispatchNext()` × N
appels successifs qui poussent chaque message un à un comme un WS qui
livre des messages PvP. Pas de "transition" concept — c'est juste un
cursor qui avance dans `messages[]`.

**Comportements à préserver** dans le nouveau path :
- Le swap perspective (`swapBs`/`swapEvents`) — déplacé dans le mockConn
  où il fait le perspective swap des `ServerMessage` qui arrivent.
  Identique au pattern `DuelConnection._maybeSwapBoardState` pour SOLO
  (γ-c c4.4).
- `observeBoardState` du BoundaryProcessor — déclenché à chaque BOARD_STATE
  dispatché, comme dans `DuelConnection`.

### B2 — `feedTransitionPhased(prev, next)` ([replay-duel-adapter.ts:179](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L179))

Variante avec gestion des `DecisionMoment[]`. Fait :
1. Si `!next.decisions?.length` → délègue à `feedTransition`.
2. Sinon : même setup que `feedTransition` mais construit `_steps`
   via `buildSteps(events, decisions, finalBoardState)`.
3. Appelle `advanceStep()` pour démarrer la traversée.
4. Renvoie `'prompt'` ou `'done'` selon si `_activeDecision` est posé.

**Sort v4** : disparaît. Le concept de "step queue avec decisions
imbriquées" n'existe plus — chaque `SELECT_*` dans `messages[]` est
juste un message qui pose `pendingPrompt` puis le scheduler arme
l'auto-respond.

### B3 — `buildSteps(rawEvents, decisions, finalBoardState)` ([replay-duel-adapter.ts:203](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L203))

Découpe les events en segments `animate` séparés par des `decide`.
Préserve le pattern "events + pendingState" du PvP pour chaque segment.

**Comportements à préserver** :
- L'invariant "le SELECT_* est inclus À LA FIN du segment précédent
  pour que le processor commit son pending chain entry". → En v4,
  l'ordre des messages dans `messages[]` est déjà fixé par la
  précompute. Garantir que la précompute génère le même ordre.
- L'utilisation du `decision.boardState` comme `pendingState` pour le
  segment précédent (matche la BOARD_STATE pré-prompt en PvP).
  → En v4, la précompute génère un BOARD_STATE explicite avant chaque
  SELECT_* (comme un worker PvP normal le ferait).
- La détection de mismatch `selectCount !== decisions.length` + fallback.
  → En v4, le mismatch ne peut plus survenir parce que les responses
  sont au même endroit que les SELECT_*. À garder comme assert dev.

**Sort v4** : remplacé par la séquence linéaire `messages[]`. La logique
"segment + decision" est encodée dans l'ordre des messages eux-mêmes.

### B4 — `advanceStep()` ([replay-duel-adapter.ts:242](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L242))

Boucle while qui dépile `_steps` :
- Step `decide` SELECT_CHAIN sans cartes → continue (auto-skip).
- Step `decide` avec cartes → `_activeDecision.set(decision)` + return.
- Step `animate` → feed events au processor + sync + return si queue non vide.

**Comportement subtil à préserver** :
- L'auto-skip de `SELECT_CHAIN` sans cartes ("en PvP ces fenêtres sont
  auto-déclinées par le toggle d'activation et ne sont jamais montrées").
  → En v4, la précompute serveur doit faire le même filtrage : ne pas
  insérer dans `messages[]` les `SELECT_CHAIN` que le serveur PvP
  filtre déjà (déjà géré par `transformMessage` côté serveur).

### B5 — `resumeAfterPrompt()` ([replay-duel-adapter.ts:307](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L307))

Appelé par le transport quand le timer auto-dismiss fire OU quand l'user
clique manuellement sur le prompt. Wipe `_activeDecision` + relance
`advanceStep`.

**Sort v4** : remplacé. Le flow devient :
- Le scheduler arme `setTimeout(REPLAY_PROMPT_DELAY_MS)` après dispatch
  d'un `SELECT_*`.
- Le timer fire → `mockConn.simulatePlayerResponse(autoResponses[offset])`
  → wipe `pendingPrompt` → scheduler reprend `dispatchNext`.

Comportement préservé : "déclencher la suite quand le prompt est dismissé".

### B6 — `collapseRemainingSteps()` ([replay-duel-adapter.ts:313](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L313))

Skip-to-end : flush tous les `_steps` restants en mode instantané.

**Sort v4** : remplacé par une boucle de seek qui consume `messages[]`
sans armer les setTimeouts auto-respond. Pseudo-code :
```ts
skipToEnd(): void {
  while (this._messageCursor < this.messages.length) {
    const msg = this.messages[this._messageCursor++];
    if (msg.type.startsWith('SELECT_')) {
      // Skip — applique directement la response
      this.simulatePlayerResponse(autoResponses[this._messageCursor - 1]);
    } else {
      this.dispatch(msg);
    }
  }
}
```

**Comportement préservé** : alimenter le BoundaryProcessor avec le dernier
`pendingState` pour que Turn/Phase deltas fire. → En v4, le dernier BOARD_STATE
de `messages[]` arrive naturellement.

### B7 — `jumpToState(state)` ([replay-duel-adapter.ts:373](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L373))

Seek arbitraire :
1. `abort()` — wipe processor + commitAll + clear steps.
2. `rbs.updateLogical(swapBs(state.boardState))`.
3. `rbs.commitAll('replay:jumpToState')`.
4. Si `state.chainSnapshot` : `processor.restoreChainState` + conditionnel
   `applyChainSolving`.

**Sort v4** : devient `mockConn.seekToOffset(navIndex[N].messageOffset)` —
détaillé dans le plan Phase 4. Réutilise `cancelOrphanedLocks` (v3 Phase 3)
+ `resetForReplaySeek` (v3 Phase 5) + le helper shared F9-bis
`chainingMsgsToLinkStates` + `processor.restoreChainState`.

**Comportement préservé** : la restauration mid-chain via `chainSnapshot`.
La précompute v4 stocke ce snapshot dans `navIndex[]` au lieu de
`PreComputedState`. **Même code path de restoration.**

### B8 — `abort()` ([replay-duel-adapter.ts:362](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L362))

Teardown / replay-page destroy :
1. `processor.reset()`.
2. `rbs.commitAll('replay:abort')`.
3. `_steps = []`, `_activeDecision.set(null)`, `busy.set(false)`.

**Sort v4** : devient `mockConn.cleanup()` ou `mockConn.requestStop()`.
Réutilise `cancelOrphanedLocks` (v3 Phase 3). Pas de `tolerateLocks` —
les locks sont droppés proprement.

### B9 — `resetProcessorForTransition()` ([replay-duel-adapter.ts:354](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L354))

Reset partiel : si `chainPhase === 'idle'` → full reset, sinon juste
`resetQueue` (preserve les chain signals pour multi-link).

**Sort v4** : disparaît. En v4, le mockConn ne fait pas de "reset per
transition" — le processor accumule comme en PvP. Le reset arrive
uniquement à seek ou cleanup.

## C — Perspective swap (replay-only mécanisme)

| Item | Actuellement | Sort v4 |
|---|---|---|
| `perspectiveIndex` signal | `signal<0\|1>(0)` sur l'adapter | **Déplacé** vers `DuelContext.perspectiveSource` (déjà existant pour SOLO post-γ-c) — partagé avec SOLO |
| `swapBs(bs)` méthode | Wrap autour de `swapBoardState(bs, perspectiveIndex())` | **Porté** — appelé depuis `MockDuelConnection._maybeSwapBoardState` (pattern PvP SOLO multiplex) |
| `swapEvents(events)` | Wrap autour de `swapEventBoardStates` | **Porté** — appelé dans `mockConn.dispatchNext` AVANT push vers orchestrator |

**Observation** : le swap est ALREADY shared (helpers extraits dans
`board-state-swap.ts` post-γ-c). En v4, on continue de l'utiliser.
Le mockConn applique le swap AVANT de dispatcher au processor, identique
au pattern `DuelConnection` SOLO multiplex.

## D — Transport service (`ReplayTransportService`)

### D1 — État de transport

| Signal | Description | Sort v4 |
|---|---|---|
| `currentIndex` | Index du state actuel dans `boardStates[]` | **Remplacé** par `mockConn.messageCursor` (offset dans `messages[]`) + un mapper vers `navIndex` pour scrubber UI |
| `isPlaying` | Auto-play actif | **Porté** |
| `pausedAtBoundary` | Pause auto à computedUpTo | **Porté** (le streaming partiel des messages existe toujours) |

### D2 — Auto-play scheduler

| Méthode | Comportement | Sort v4 |
|---|---|---|
| `startPlayback` | Lance auto-play, gère cas index=0 et activePrompt | **Réécrit** — simplifié, devient boucle `dispatchNext` |
| `doStepForward` | Avance d'un state ; abort si busy | **Disparaît** — remplacé par `dispatchNext` qui avance d'un message |
| `feedAnimatedTransition` | Dispatche vers `feedTransition`/`feedTransitionPhased`/`jumpToState` selon mode | **Disparaît** — il n'y a plus de "transition", juste `dispatchNext` |
| `scheduleNext` | Schedule prochain step si pas busy + pas à la fin | **Simplifié** — vérifier juste `orchestrator.isAnimating` et `cursor < messages.length` |
| `pausePlayback` | Stop auto-play + clear timer | **Porté** |

### D3 — Schedule prompt dismiss (D2-bis crucial)

`schedulePromptDismiss()` ([replay-transport.service.ts:316](front/src/app/pages/pvp/replay/replay-transport.service.ts#L316)) :

```ts
const delta = (ts && prevTs) ? ts - prevTs : null;
const duration = delta !== null
  ? Math.min(Math.max(delta * 0.6, PROMPT_DISPLAY_MIN), PROMPT_DISPLAY_MAX)
  : PROMPT_DISPLAY_FALLBACK;
```

**Comportement actuel** : timing humain enregistré (`delta` entre 2 réponses)
clampé entre 800ms et 3s, scalé à 60%.

**Décision actée v4** : **délai fixe** `REPLAY_PROMPT_DELAY_MS` (suggéré
1200ms). Le `delta` humain et le scaling 60% disparaissent. Constantes
PROMPT_DISPLAY_MIN/MAX/FALLBACK retirées.

**Conséquence** :
- Plus besoin de stocker `activeTimestamp` dans la précompute.
- Plus de `lastResponseTimestamp` tracking.
- Code réduit à `setTimeout(() => resumeAfterPrompt(), REPLAY_PROMPT_DELAY_MS * speedMultiplier)`.

### D4 — Overlay gate `overlayActive` (F1, 2026-06-03)

`schedulePromptDismiss` aujourd'hui doit attendre que `overlayActive`
soit false avant d'armer son timer (sinon le dismiss-window tique
pendant que le prompt est masqué par l'overlay).

**Sort v4** : **conservé**. Le `mockConn` arme son `setTimeout
(REPLAY_PROMPT_DELAY_MS)` seulement quand `overlayActive() === false`.
Pattern identique. Effet réactif sur le signal.

**Point d'attention 2** — Le mockConn doit donc lire `overlayActive` —
ça crée une dépendance "mockConn → overlay state". Soit le mockConn
reçoit `overlayActive` comme `Signal<boolean>` en input (pattern), soit
le scheduler reste dans un service séparé (comme aujourd'hui) qui lit
les deux.

**Recommandation** : garder un `MockTransportService` simplifié qui
fait la coordination overlay + auto-respond + auto-advance. Le mockConn
est juste le data layer ; le transport est le orchestration layer. Évite
de coupler mockConn à des concepts UI.

## E — Comportements et garanties IMPLICITES qui pourraient être perdus

Liste des choses subtiles qui NE sont PAS dans une méthode mais qui
existent par effet de bord. À vérifier explicitement en Phase 3/7.

### E1 — Ordre "events FIRST, then BOARD_STATE sync"

`advanceStep` step `animate` ([replay-duel-adapter.ts:279-291](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L279-L291)) :
> // Feed events FIRST (same as PvP: events arrive before BOARD_STATE)

Le pattern PvP est : events arrivent via WS, puis BOARD_STATE confirme
l'état final. L'adapter reproduit cet ordre en feedant les events au
processor avant `syncAfterBoardState`.

**Sort v4** : préservé naturellement parce que `messages[]` linéaire =
événements puis BOARD_STATE comme PvP. **Mais** : tout ré-ordonnancement
de la précompute (ex: optimisation qui groupe les BOARD_STATE) peut
casser ce contrat. **Pin avec test** dans Phase 0 (parité event stream).

### E2 — Auto-skip `SELECT_CHAIN` sans cartes ([replay-duel-adapter.ts:259-266](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L259-L266))

> // Auto-skip chain windows with no chainable cards — in PvP these are
> // auto-declined by the activation toggle and never shown to the player.

**Vérifier** : la précompute serveur (`transformMessage`) filtre-t-elle
déjà ces SELECT_CHAIN, ou est-ce que c'est l'adapter qui doit le faire ?
Si le serveur filtre, l'auto-skip n'est plus nécessaire. Si non, il faut
le mettre dans la précompute v4.

### E3 — Pre-shuffle pendingState fixup

`buildSteps` final segment ([replay-duel-adapter.ts:235-237](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L235-L237)) :
> // Final segment: use the transition's next.boardState as pendingState
> // so that processShuffleEvent applies the post-shuffle state (matching
> // PvP behavior where the next BOARD_STATE from the server includes the
> // shuffle result).

**Sort v4** : naturellement préservé — la précompute génère le BOARD_STATE
final après MSG_SHUFFLE_DECK, comme un worker PvP le ferait.

### E4 — `_activeDecision.set(null)` à abort/jump

`abort` et `jumpToState` clearent `_activeDecision`. Le `pvp-prompt-dialog`
côté replay observe ce signal (via `activePrompt` computed). Sans clear,
le dialog resterait collé après un seek.

**Sort v4** : `mockConn.seekToOffset` doit clear `pendingPrompt` signal
(équivalent). À tester explicitement.

### E5 — Le seek skip-back conserve quoi ?

Aujourd'hui : `jumpToState` reload le state cible depuis `PreComputedState`,
restore chain via snapshot.

**Sort v4** : `seekToOffset(navIndex[N].messageOffset)` reload le snapshot
depuis `navIndex[N].boardStateSnapshot` + restore chain. Identique
sémantiquement.

**Différence subtile** : aujourd'hui `PreComputedState[N]` contient TOUS
les events depuis N-1 jusqu'à N. En v4 on saute directement à l'état N
sans rejouer les events. **Ça pourrait casser** des effets de bord sur
les projections qui s'attendent à voir les events. **À tester** : seek
arrière → projections à jour ? (probablement oui via `scopeDispatcher.dispatch
({DUEL_LIFETIME})` qui reset tout, puis rebuild via `gameLog.rebuildUpTo`).

### E6 — Le pattern `busy()` est consommé par le transport scheduler

`replay-transport.service.ts` lit `adapter.busy()` partout pour gater le
scheduler. C'est la métrique "est-ce que l'adapter peut prendre un nouveau
message ?".

**Sort v4** : équivalent `mockConn.isReady()` ou simplement
`!orchestrator.isAnimating()` côté scheduler. À designer.

## F — Patterns à RETIRER explicitement

Choses qui ne servent plus à rien post-v4 et doivent disparaître :

| Item | Raison |
|---|---|
| `_steps: ReplayStep[]` | Plus de step queue — séquence linéaire `messages[]` |
| `ReplayStep`, `AnimateStep`, `DecideStep` types | Idem |
| `PROMPT_DISPLAY_MIN/MAX/FALLBACK` | Délai fixe |
| `lastResponseTimestamp` | Plus de timing humain enregistré |
| `activeTimestamp` computed | Idem |
| `feedAnimatedTransition` dispatch sur 3 méthodes | Une seule voie : `dispatchNext` |
| `pausedAtBoundary` (?) | À garder si streaming partiel survit, à retirer si on charge tout d'un coup |
| F19 skip sites tagged (`replay:abort`, `replay:jumpToState`, `replay:collapseRemainingSteps`) | Toutes les 4 skip sites disparaissent post-v4 — `commitAll` n'est plus appelé avec `tolerateLocks` parce que `cancelOrphanedLocks` gère |

## G — Tests existants à porter / réécrire

Tests qui exercent l'adapter aujourd'hui :

- `replay-duel-adapter.spec.ts` — tests unitaires du feed/build/advance.
- Tests qui consument le `_activeDecision` signal.
- Tests du transport (`replay-transport.service.spec.ts`).
- `f9-bis-diagnostic.spec.ts` — restore chain mid-chain seek.
- `bug-post-chain-solved-buffer-drain-2026-06-04.md` repro spec.
- e2e `debug-radiant-typhoon-draw-discard.spec.ts`.

**Sort v4** :
- Tests adapter → réécrits pour `MockDuelConnection` (avec stubs WS-like).
- Tests transport → simplifiés (la boucle est plus simple).
- Test F9-bis → quasi inchangé (même restore helper).
- Bug repro → re-exécuté contre le nouveau path (validation Phase 7).
- e2e → quasi inchangé (test boîte noire).

## H — Récap : ce qui survit, ce qui meurt, ce qui change

### Survit (porté tel quel ou ~identique)

- Pass-through methods vers processor (A).
- `swapBoardState`/`swapEventBoardStates` helpers (déjà shared).
- Restauration chain via `chainSnapshot` (F9-bis helper shared).
- Overlay gate F1 (`overlayActive`).
- BoundaryProcessor `observeBoardState` (déclenché par chaque BOARD_STATE).

### Meurt (entièrement retiré)

- `ReplayDuelAdapter` classe entière.
- `_steps` step queue + types `ReplayStep`/`AnimateStep`/`DecideStep`.
- `feedTransition` / `feedTransitionPhased` / `buildSteps` / `advanceStep` / `resumeAfterPrompt` / `collapseRemainingSteps`.
- F19 skip sites tagged.
- `tolerateLocks` (déjà retiré en v3 Phase 4, mais resterait des références dans l'adapter).
- Timing humain enregistré (`PROMPT_DISPLAY_*`, `lastResponseTimestamp`, `activeTimestamp`).

### Change (porté avec sémantique modifiée)

- `pendingPrompt` signal : était toujours null en replay → devient mis à
  jour comme en PvP. **Conséquence dialog path à valider Phase 7.**
- `perspectiveIndex` signal : déplacé vers `DuelContext.perspectiveSource`
  (déjà existant).
- Seek : `jumpToState(state)` → `seekToOffset(navIndex[N].messageOffset)`.
- Auto-respond : `schedulePromptDismiss` → setTimeout fixe scalé par speed.
- Skip-to-end : `collapseRemainingSteps` → boucle dispatchNext sans armer
  les setTimeouts.

## I — Décisions ouvertes (à trancher pendant Phase 1 design)

1. **`MockDuelConnection` extends `DuelConnection` ou implémente
   `IDataConnection` séparément ?** L'extension permet de partager le
   code processor pass-through ; la séparation force une discipline plus
   stricte sur ce qui est "vraiment shared". Recommandation : interface
   `IDataConnection` séparée + 2 classes concrètes.

2. **Transport scheduler : extraire dans un service séparé ou intégrer
   dans `MockDuelConnection` ?** Recommandation : service séparé
   (`MockTransportService` ou simplement `ReplayTransportService`
   refactoré). Garde le mockConn pur data layer.

3. **`_activeDecision` survit-il ou est-il fusionné avec `pendingPrompt` ?**
   Aujourd'hui ce sont 2 signaux séparés. En v4 peut-être un seul.
   Recommandation : voir si quelque chose consomme `_activeDecision.response`
   ou `_activeDecision.hint` séparément. Si oui, garder. Sinon merge.

4. **Cas non-couvert : que se passe-t-il si `messages[]` se termine sans
   MSG_WIN ?** Replay tronqué, scénario debug. Aujourd'hui l'adapter
   gère ça via `atEnd()`. En v4, le scheduler s'arrête simplement
   quand `cursor >= messages.length`. À tester.

## J — Liens

- Chantier parent : [anim-pipeline-v4-replay-unification-2026-06-05.md](anim-pipeline-v4-replay-unification-2026-06-05.md).
- Test parité Phase 0 : [pvp-replay-event-stream-parity-spec-2026-06-05.md](pvp-replay-event-stream-parity-spec-2026-06-05.md).
- Chantier v3 livré : commits `88d1aad7` `d7264974` `f04a845a` `98fcfe13`.
- CLAUDE.md "Replay Board State Parity Rule" — sera simplifiée en Phase 5.
- CLAUDE.md "Replay-as-max-rate-PvP doctrine" — sera réécrite en
  "Replay = PvP readonly via MockDuelConnection".

## K — Effort estimé pour cette phase d'inventaire

- Lecture adapter + transport : déjà fait (ce document).
- Validation des 6 "comportements implicites" (E1-E6) : à faire en Phase 1
  avant de coder. **Effort : 2-3h.**
- Trancher les 4 décisions ouvertes : à faire en Phase 1. **Effort : 1h.**
- Mise à jour de ce doc avec les choix finaux : **Effort : 30min.**

Total : ce doc + 4h de validation Phase 1 = prêt à coder en Phase 2-3.
