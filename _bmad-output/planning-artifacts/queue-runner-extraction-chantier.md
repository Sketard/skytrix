# Chantier — Extraction du `QueueRunner`

> **Statut** : 📋 backlog tracé — prochain chantier probable (acté avec Axel 2026-05-20).
> **Zone** : `AnimationOrchestratorService` — le cœur du pipeline d'animation PvP/Replay.
> **Nature** : refactor de testabilité (pas une feature, pas un fix).
> **Déclencheur** : audit post-chasse-aux-bugs de mai 2026 — voir la section "Pourquoi" ci-dessous.

---

## 1. Le problème en une phrase

Le **moteur de boucle de la file d'animation** (`_processAnimationQueueInner`
et son entourage) vit inline dans `AnimationOrchestratorService` — 1445 lignes
de source pour **191 lignes de spec qui ne testent qu'une seule fonction
statique pure** (`decideNextStep`). Tout le reste du moteur — la boucle async,
le cycle de vie, le dispatch, les gardes de ré-entrée — est **non testé en
unit**. C'est précisément la zone qui accumule des "primitifs de sécurité"
ad hoc à chaque nouveau bug de timing.

## 2. Pourquoi — la généalogie de la dette

Le pipeline a accumulé **7 primitifs** qui gèrent tous des facettes du même
problème : *le moteur de queue est une coroutine async non-annulable, et le
monde extérieur (seek, pause, reset, message WS) peut changer l'état pendant
qu'elle est suspendue sur un `await`*.

| Primitif | Rôle | Né de quel bug |
|---|---|---|
| `_isAnimating` | "la queue tourne ?" | primitif originel — sain |
| `_isProcessing` | garde de ré-entrée **synchrone** de `processAnimationQueue` | multiples déclencheurs (WS, advanceStep, resume effect) |
| `_innerLoopDepth` + `duelAssert` | **détecte** la ré-entrée parallèle de `_processAnimationQueueInner` | audit "finding C4" — `_isProcessing` laisse une fenêtre microtask |
| `_resetGeneration` | invalider une boucle async qui **survit à un reset** | bug seek-pendant-build, mai 2026 |
| `_rescueNoProgressCount` / `_lastRescueQueueLen` | empêcher la **boucle rescue infinie** | bug "infinite rescue", mai 2026 — un garde pour le garde |
| `PollDropWatchdog` | filet : détecter une chaîne bloquée | suppression du poll legacy, 2026-05-10 |
| `safetyTimeout` / `guardTimer` | forcer la continuation si une animation ne résout jamais | Promises de travel non résolues |

**Le motif** : chaque primitif est né d'un bug où le précédent s'est révélé
insuffisant. `_innerLoopDepth` *détecte* la faille de `_isProcessing`.
`_rescueNoProgressCount` borne le *rescue*, qui est lui-même un garde. Le
`PollDropWatchdog` rattrape ce que les autres ont laissé passer (CLAUDE.md le
dit : *"the dropped poll mechanism would have rescued this state"*). Un
mécanisme de sécurité qui en exige un autre = signal d'une abstraction
manquante.

**L'abstraction manquante** : un **"run" d'animation annulable et
identifiable**. Aujourd'hui "le traitement de la queue en cours" n'est PAS un
objet — c'est un jeu de variables d'instance + une promesse async flottante
que personne ne tient. D'où : on ne peut pas l'annuler (→ `_resetGeneration`),
on ne sait pas si deux runs coexistent (→ `_innerLoopDepth`), on ne peut pas
l'interroger (→ re-checks éparpillés), sa terminaison n'est pas garantie
(→ watchdog + rescue + compteur du rescue).

## 3. Décision de cadrage (2026-05-20)

- Le pipeline **se calme** (les bugs de mai étaient un cluster lié au replay
  rework récent) → **pas d'urgence**.
- Mais c'est **le cœur de skytrix** → la testabilité est un investissement
  rentable indépendamment des bugs.
- **Ordre acté** : testabilité d'abord (ce chantier), refactor archi
  (`AbortController`) seulement après et seulement si nécessaire — refactorer
  du code testé est sûr, refactorer du code non testé est un saut dans le vide.
- **Ne PAS faire en plein milieu d'un autre travail** — chantier dédié, en
  paliers testés.

## 4. État des lieux de la testabilité (audit 2026-05-20)

La décomposition "Orchestrator Decomposition" (CLAUDE.md) a **déjà fait ~90 %
du travail**. Tous les morceaux extraits sont testés :

| Fichier | src | spec | |
|---|---|---|---|
| `duel-event-processor` | 210 | 291 | ✅ |
| `chain-resolution-manager` | 241 | 465 | ✅ |
| `draw-sequence-manager` | 753 | 342 | ✅ |
| `move-animation-router` | 593 | 413 | ✅ |
| `lp-animation-tracker` | 120 | 284 | ✅ |
| `battle-animation-tracker` | 168 | 220 | ✅ |
| `target-indicator-manager` | 173 | 288 | ✅ |
| `buffer-replay-builder` | 308 | 387 | ✅ |
| `rendered-board-state.service` | 296 | 464 | ✅ |
| `card-travel-engine.service` | 335 | 431 | ✅ |
| `poll-drop-watchdog` | 119 | 162 | ✅ (extrait 2026-05-20) |
| `duel-context` | 105 | 154 | ✅ |
| **`animation-orchestrator.service`** | **1445** | **191** | **❌ seul `decideNextStep` testé** |

**Le seul trou est le moteur de boucle.** Il reste exactement un morceau à
extraire — le 8e, jamais sorti, et le plus central.

## 5. La solution — `QueueRunner`

Extraire le moteur de boucle dans une classe `QueueRunner` (ou
`AnimationLoop`), **exactement le geste déjà fait 8 fois** (les 7 managers +
`PollDropWatchdog`).

> **Note de cadrage (révisé après lecture du code réel, 2026-05-21).** La
> frontière n'est pas "la boucle d'un côté, un simple callback de l'autre".
> Trois constats du code décident du contrat ci-dessous :
> 1. **`case 'finalize'`** (`_processAnimationQueueInner` ~781-819) n'est
>    PAS du dispatch métier — il manipule directement les primitifs de
>    cycle de vie et l'invariant CLAUDE.md "finalizeAndCommit BEFORE
>    setAnimating". → migre dans le runner ; `finalizeAndCommit` lui-même
>    reste un callback `onFinalize`.
> 2. **`_handleEntry` est mixte** — du métier (divert pre-activation,
>    `processEvent`, release pre-locks, `commitMode`) ET de la mécanique de
>    boucle (le `guardTimer` du `Promise.race`, le `setTimeout` de durée,
>    l'attente). Il faut le **scinder** : la partie métier reste et
>    retourne le `result` brut (`number | 'async' | Promise<void>`) sans
>    l'attendre ; le runner possède l'attente. → 3 primitifs absorbés DÈS
>    le palier A (`guardTimer`, séquence d'attente, `_isProcessing`).
> 3. **`animationTimeouts[]`** est un registre partagé à l'échelle de
>    l'orchestrateur (6 producteurs, dont 1 seul dans la boucle). Il ne
>    migre PAS. Le runner possède SES timers internes (`_stepTimeout`,
>    `_guardTimer`) et expose `clearTimers()` ; `clearTimersAndPolling`
>    de l'orchestrateur appelle `runner.requestStop()`.

### Ce qui migre dans `QueueRunner`
- La boucle : `_processAnimationQueueInner`, `processAnimationQueue`,
  `startProcessingIfIdle`.
- **`decideNextStep`** (statique, pur) — migre dans `queue-runner.ts` avec
  ses 191 specs (décision actée 2026-05-21 : le cerveau rejoint son moteur).
- Les 5 primitifs de cycle de vie : `_isProcessing`, `_innerLoopDepth`,
  `_resetGeneration`, `_rescueNoProgressCount`, `_lastRescueQueueLen`.
- La logique de rescue (le `finally` block).
- Le `case 'finalize'` complet (mécanique de boucle).
- **L'attente d'un step** : le `setTimeout` de durée + le `guardTimer` du
  `Promise.race` (le 7e primitif `safetyTimeout/guardTimer`).
- `clearTimers()` (vide `_stepTimeout` + `_guardTimer`).

### Ce qui reste dans `AnimationOrchestratorService`
- Le **dispatch métier** : `_handleEntry` **scindé** (rend le `result`
  brut, n'attend plus), `processDirective`, et les ~30 handlers
  `processEvent` par type de message (MSG_MOVE, MSG_DRAW, …). Le runner
  appelle des callbacks injectés ; il ne connaît pas les types YGO.
- `finalizeAndCommit` + les resets LP/hand/zone → exposés via `onFinalize`.
- `_preActivationBuffer`, `_awaitSignalEffect`, `animationTimeouts[]`
  (registre orchestre-level), le wiring des 7 managers + `DuelContext`.
- `_isAnimating` : **frontière à trancher pendant le palier A** en lisant
  tous les call-sites — soit le runner possède son propre `_isRunning`
  distinct (sépare état métier et drapeau de boucle, plus propre), soit il
  lit/écrit `_isAnimating` via le contrat (extraction strictement
  mécanique). Ne pas figer avant d'avoir l'inventaire des call-sites.

### Contrat révisé
```ts
type EventResult = number | 'async' | Promise<void>;

interface QueueRunnerDeps {
  dataSource: AnimationDataSource;     // queue, chainPhase, setAnimating
  pollDropWatchdog: PollDropWatchdog;
  ctx: DuelContext;                    // speedMultiplier, safetyTimeout
  logger: DuelLogger;                  // → catégorie RUNNER (cf. §6bis)
  // dispatch métier — synchrones, retournent SANS attendre :
  handleEntry: (e: GameEvent) => EventResult;
  processDirective: (d: QueueDirective) => Promise<'continue' | 'pause'>;
  applyInstantAnimation: (e: GameEvent) => void;      // collapse
  consumeDeferredSolving: () => void;
  replayBufferPreReplay: () => Promise<void>;         // pre-replay-buffer
  // hooks d'effets de bord aux frontières de step :
  onStepSettled: () => void;     // lpTracker.commitIfPending + animatingZone
  onFinalize: () => void;        // finalizeAndCommit + resets LP/hand/zone
  preLockQueuedSources: () => void;
  decisionInputs: () => Omit<QueueDecisionInputs, 'queue'>;
}
```
API publique : `start()`, `notifyEnqueue()` (ex-`startProcessingIfIdle`),
`requestStop()` (ex-reset : `clearTimers()` + bump génération),
`isProcessing()` / `isAnimating()` (lus par `replayBuffer` et le chemin
inline `replayBuffer(false)`).

> **Piège `await-signal`.** Le directive `await-signal` crée un `effect()`
> qui rappelle aujourd'hui `processAnimationQueue()`. Après extraction,
> `_awaitSignalEffect` reste côté orchestrateur mais son callback appelle
> `runner.notifyEnqueue()`. Idem pour le chemin inline de `replayBuffer`
> qui doit interroger `runner.isProcessing()` au lieu de lire le champ.

## 6. Plan en paliers (chacun livrable + testé)

**Palier 0 — `EventStream` (prérequis archi, tranché 2026-05-22).**
Ajouter un signal `_eventStream: signal<GameEvent[]>` qui contient TOUS
les événements dispatchés du duel, en **ordre logique** (post-buffer de
chaîne). Push fait dans `AnimationOrchestratorService.processEvent`, **au
même point** que le tap `notifyGameLog` actuel (~ligne 1073, voir
décision d'option (a) ci-dessous) — donc côté orchestrateur, pas dans le
`DuelEventProcessor`. La file `_animationQueue` (côté processor) reste
strictement ce qu'elle est ; l'invariant CLAUDE.md "`MSG_CHAIN_NEGATED`
is NOT pushed to `animationQueue`" reste vrai (la file et le flux sont
deux objets distincts, dans deux fichiers distincts).
**Mais** : `MSG_CHAIN_NEGATED`, `SELECT_*` et `MSG_WIN` ne traversent
PAS aujourd'hui `processEvent` (ils sont consommés ailleurs : processor
pour CHAIN_NEGATED, prompt routing pour SELECT, serveur pour WIN). Le
palier 0 doit donc aussi **router ces 3 types vers `_eventStream`
depuis leur point de consommation respectif** — sans les pousser dans
la file d'animation. Pour `MSG_CHAIN_NEGATED` : le processor expose un
callback `onEvent?: (event) => void` que l'orchestrateur câble vers le
push `_eventStream`. Pour `SELECT_CARD` : push depuis le routeur de
prompt. Pour `MSG_WIN` : push depuis le handler `DUEL_END` côté
orchestrateur (le serveur a converti, mais le champ est carry-able).
Rebrancher `DuelGameLogService` sur `_eventStream`. Tests : 291 specs
`DuelEventProcessor` + specs `DuelGameLogService` vertes ; en PvP live
le journal affiche désormais le badge "Nié", la ligne 🏆 et les cibles
secondaires — la divergence documentée dans CLAUDE.md "Game Log — known
PvP↔Replay divergence" est résolue. *Gain : modèle de flux tranché AVANT
que le `QueueRunner` ne fige son contrat d'entrée au palier C ; P1
game-log livré gratuitement comme critère d'acceptation observable.*

> **Pourquoi le chain overlay n'est PAS impacté** (clarification archi,
> régulièrement mal comprise). Le `pvp-chain-overlay` affiche déjà
> correctement les négations en PvP live aujourd'hui. Cela n'a rien à
> voir avec la file d'animation : l'overlay s'abonne à
> `dataSource.activeChainLinks` (`pvp-chain-overlay.component.ts:89`)
> — un signal d'**état**, où chaque link porte un champ
> `negated: boolean`. Le `DuelEventProcessor` met à jour cet état
> directement à la réception de `MSG_CHAIN_NEGATED`
> (`duel-event-processor.ts:117-119`), sans passer par la file. Deux
> types de surfaces coexistent donc dans l'archi skytrix :
> - **Surfaces d'état** (board, zones, locks, chain overlay, …) →
>   lisent un signal d'état (`activeChainLinks`, `logicalState`/`renderedState`).
>   Le processor met l'état à jour, elles voient le changement. Pas
>   concernées par le palier 0.
> - **Surfaces de flux** (game log, et tout futur consommateur qui a
>   besoin de la *séquence d'événements dans l'ordre* — replay textuel,
>   audit, export) → ont besoin du flux temporel. Aujourd'hui le seul
>   flux exposé est `_animationQueue`, filtré. Le palier 0 ajoute un
>   second canal `_eventStream` pour CETTE catégorie de consommateurs.
>
> Le palier 0 ne touche donc ni l'état, ni l'overlay, ni le board. Il
> ajoute un canal additionnel pour une catégorie distincte de
> consommateurs. **Aucune régression possible** sur les surfaces d'état
> par construction.

> **L'unique inconnue du palier 0 — risque d'ordre.** Le tap actuel
> `notifyGameLog` est appelé depuis l'orchestrateur en `processEvent` —
> donc dans l'ordre **logique réordonné par le buffer de chaîne** (un
> événement bufferé pendant la résolution n'est tappé qu'à son
> re-dispatch via `replayBuffer`, en ordre de résolution logique,
> exactement une fois — cf. §6ter "Pourquoi un fix isolé ne marche
> pas"). Pousser `_eventStream` dans `_processMessageInner` (côté
> processor, ordre WS brut) changerait cet ordre pour le journal.
>
> **Décision tranchée 2026-05-22 — option (a) retenue.** Investigation
> pré-implémentation faite : `BOARD_CHANGING_EVENT_TYPES`
> (`duel-ws-shared.types.ts:219-225`) liste les seuls événements bufferés
> par `bufferIfResolving` — ce set ne contient PAS `MSG_CHAIN_NEGATED`,
> ni `MSG_WIN`, ni `SELECT_CARD`. Donc pour les 3 types qui motivent ce
> chantier, ordre WS == ordre logique par construction. (a) et (b)
> donnent le même résultat pour le journal actuel.
>
> **Option (a) retenue** — pousser dans `_eventStream` au **même point**
> que le tap actuel (côté orchestrateur, post-buffer, ~animation-orchestrator
> ligne 1073). Trois raisons :
> 1. **Identique à (b) pour les 3 consommateurs actuels** — pas de coût.
> 2. **Robuste pour les futurs consommateurs** de `EventStream` (replay
>    textuel, audit, export). Un futur consommateur qui s'abonne et voit
>    des `MSG_MOVE`/`MSG_DRAW` les recevra en ordre logique — la version
>    universellement correcte. (b) introduirait un piège latent : un
>    `MSG_MOVE` bufferé apparaîtrait en ordre WS brut, créant un bug
>    silencieux pour un consommateur futur qui s'attendrait à l'ordre
>    de résolution.
> 3. **Cohérence sémantique** — le journal a toujours été en ordre
>    logique ; on change la source d'abonnement, pas la sémantique.
>
> Implication concrète pour le palier 0 : le push `_eventStream` est
> placé dans `processEvent` de l'orchestrateur, **au même endroit que
> le tap `notifyGameLog` actuel** (qui sera supprimé). Pas dans
> `_processMessageInner` du processor.

**Palier A — extraction + recâblage de frontière.**
Sortir la boucle + `decideNextStep` + les 5 primitifs dans `QueueRunner`
SANS changer le comportement **observable**. Le mot "mécanique" est
écarté volontairement (avis archi 2026-05-22) : ce palier scinde
`_handleEntry` (métier ↔ attente), absorbe 3 primitifs (`guardTimer`,
séquence d'attente, `_isProcessing`), reconcevoit la frontière
attente/dispatch, et rebranche `await-signal` + le chemin inline de
`replayBuffer`. C'est de la chirurgie, pas un déplacement de fichier —
nommer le palier "mécanique" abaisserait la garde au pire endroit. Le
dispatch métier reste des callbacks vers les méthodes restées dans
l'orchestrateur. Brancher la catégorie de log `RUNNER` (cf. §6bis).
**Pré-design (à faire avant d'ouvrir l'éditeur)** : inventaire complet
des call-sites de `_isAnimating` et décision sur la frontière (runner
possède son propre `_isRunning` distinct, OU lit/écrit `_isAnimating`
via le contrat). C'est de la décision de design, pas une découverte
runtime sur la zone la plus critique du projet. Les 191 specs
`decideNextStep` migrent dans `queue-runner.spec.ts` et restent vertes ;
1036 specs pvp toujours vertes ; run harness `debug-replay-harness` vert.
*Gain : le moteur est isolé ; 3 des 7 primitifs déjà absorbés.*

> **Invariant de position — le tap `notifyGameLog`.** Le journal de partie
> est branché par `this.gameLog?.notifyGameLog(event)` dans
> `processEvent` (`animation-orchestrator.service.ts` ~1073), à une place
> chargée de contraintes (commentaire "LOAD-BEARING placement, do not
> move") : APRÈS le guard `bufferIfResolving` (un événement bufferé n'est
> loggé qu'à son re-dispatch, en ordre de résolution logique, exactement
> une fois), APRÈS `updateLogical(boardStateAfter)` (`logicalState()` à
> jour), AVANT le switch de dispatch. `processEvent` reste côté
> orchestrateur, mais le scindage de `_handleEntry` (qui appelle
> `processEvent`) ne doit RIEN changer à l'ordre
> `processEvent → notifyGameLog → switch`. À vérifier explicitement au
> palier A — au même titre que "finalizeAndCommit BEFORE setAnimating".

**Palier B — couverture du runner.**
Écrire les specs `QueueRunner` — les scénarios chassés à la main en mai 2026
deviennent des tests unitaires :
- seek/reset pendant que la boucle est suspendue → pas de boucle rescue, pas
  de ré-entrée parallèle ;
- `notifyEnqueue` re-déclenche proprement ;
- le rescue draine puis s'arrête (jamais infini) ;
- terminaison garantie sous abort. Avec `fakeAsync` — pas de Playwright.

**Palier C (optionnel, à décider après B) — modèle `AnimationRun`.**
Remplacer le token maison `_resetGeneration` + le compteur `_innerLoopDepth`
par un `AbortController` standard : `requestStop()` fait `run.abort()`, la
boucle fait `signal.throwIfAborted()` après chaque `await` (un seul point de
contrôle). `_isProcessing`, `_innerLoopDepth`, `_resetGeneration`, et la
moitié de la logique de rescue **disparaissent** — fondus dans le `signal`.
Refactor désormais **interne au `QueueRunner`, couvert par les specs du
palier B** → sûr.

Après C : on passe de **7 primitifs ad hoc → 2 concepts** : `AnimationRun`
(cycle de vie) + `PollDropWatchdog` (santé des *données* — un MSG_CHAIN_END
qui n'arrive jamais du serveur ; il reste, mais pour la bonne raison, plus
comme filet d'un bug du moteur).

## 6bis. Effet de bord exploité — debuggabilité du moteur

Le harness `debug-replay-harness.ts` capture aujourd'hui les **symptômes**
(screenshots, snapshots, trace `PIPELINE` d'*ingestion* de messages). Il ne
capture pas le **film de la décision de la boucle** — pourquoi le moteur a
fait ce qu'il a fait. Isoler la boucle dans `QueueRunner` ouvre trois gains
de debuggabilité, à saisir **comme effets de bord disciplinés du refactor**
(≈15 lignes au total, pas un sous-chantier — ne pas élargir le scope).

- **Palier A — catégorie de log `RUNNER`.** Le `QueueRunner` prend le
  `DuelLogger` en injection et émet une nouvelle catégorie `RUNNER`
  (verbose, off par défaut — même statut que `PIPELINE`/`RESOLVE`). Une
  ligne par tick : l'`action` retournée par `decideNextStep` + les inputs
  de décision (`isResolving`, `queueLen`, `isWaitingForOverlay`, …) + les
  transitions de cycle de vie (`requestStop`, changement de génération).
  La trace de décision est aujourd'hui éparpillée entre `decideNextStep`,
  le `case finalize` et le `finally` du rescue → illisible. Centralisée
  dans le runner = journal de bord linéaire et causal. Le `report.md` du
  harness montre alors la **suite de décisions** qui a mené au warning,
  pas seulement le warning.

- **Palier B — les scénarios harness deviennent des specs.** Les bugs de
  **timing / cycle de vie** (ré-entrée, rescue infini, reset pendant un
  `await`, terminaison) sortent du domaine Playwright — ils dépendent du
  timing exact, donc fragiles à reproduire via le harness — et entrent
  dans le domaine du test `fakeAsync` instantané. Un `report.md` d'un bug
  passé est littéralement le cahier des charges d'une spec du runner.
  Playwright reste l'outil des bugs **visuels** (perspective, placement) ;
  il n'est pas remplacé, son périmètre est réduit à ce pour quoi il est bon.

- **Palier C — bloc `run` dans le snapshot.** `__skytrixDebug.snapshot()`
  expose un objet `AnimationRun` : `{ id, status: 'running'|'aborted'
  |'settled', startedAt, ticks, aborted }`. Aujourd'hui le cycle de vie
  est 5 variables sans lien apparent dans le dump (`_isProcessing`,
  `_innerLoopDepth`, …) — il faut connaître leur sémantique pour juger
  "la boucle est-elle saine ?". Un `AnimationRun` se lit tout seul. Le
  harness capture déjà `snapshot()` → **zéro changement côté harness**, le
  bloc `run` apparaît automatiquement dans les JSON capturés.

Ce que le chantier **n'améliore pas**, à acter pour ne pas se faire
d'illusion : les bugs **visuels** (perspective, carte mal placée — hors
boucle, dans les handlers + le rendu) et les bugs **serveur** (un
`MSG_CHAIN_END` jamais émis — c'est ce que le `PollDropWatchdog` surveille,
et il reste pour cette raison). Le harness reste l'outil de référence pour
ces deux catégories.

## 6ter. P1 game-log — critère d'acceptation observable du palier 0

> **Statut révisé 2026-05-22** : promu de "exigence rattachée hors scope"
> à **critère d'acceptation du palier 0**. La revue d'archi (Winston) a
> démontré que le palier 0 (`EventStream` dans `DuelEventProcessor`)
> répare P1 par construction — donc P1 devient le critère de réussite
> observable du palier 0, pas une exigence parallèle.
>
> **MàJ 2026-05-22 — la fonctionnalité game-log est LIVRÉE.** Entre le
> 2026-05-20 et le 2026-05-22, tout le game-log a été construit (chantier
> "Lot 0→4", ~21 commits, puis fixes de contenu Lot 1b/1c). Pièces en
> place : `GameLogBuilder` (front+back, byte-synced, pur), le spine
> `DuelGameLogService` (provided au niveau page, drive le builder, expose
> journal + bulle d'effet adverse), `game-log-panel` (Surface 1),
> `effect-bubble` (Surface 2), onglet dev-hub. Le tap `notifyGameLog` est
> en place dans `processEvent`. **Conséquence** : P1 n'est plus une
> exigence sur du code à venir — c'est un défaut de parité sur du code
> **déployé**, avec un consommateur réel et un point de branchement
> précis. La cible archi ci-dessous gagne donc un critère de réussite
> tangible (le journal PvP retrouve ses 3 lignes manquantes), pas
> spéculatif.

**Le symptôme.** Le journal de partie live (`DuelGameLogService`) diverge
entre PvP et Replay. Le `GameLogBuilder` (partagé, pur) sait traiter
`MSG_CHAIN_NEGATED` (badge "Nié"), `MSG_WIN` (ligne 🏆) et `SELECT_CARD`
(résolution secondaire des cibles `MSG_BECOME_TARGET`). En **Replay** ces
branches tournent — le journal est reconstruit depuis les états de
précompute via `rebuildUpTo` → `ingestState`. En **PvP live** elles sont
mortes : le journal n'est alimenté que par le tap `notifyGameLog` dans
`AnimationOrchestratorService.processEvent`, c.-à-d. par la **file
d'animation** — et ces trois-là n'y transitent jamais (`MSG_CHAIN_NEGATED`
consommé silencieusement par le processor ; `SELECT_CARD` est un prompt
hors-file ; `MSG_WIN` converti en `DUEL_END` côté serveur).

**Pourquoi c'est le même problème que ce chantier.** La cause racine est
identique à celle de §2 : *une abstraction manquante*. Ici ce n'est pas
"un run d'animation annulable", c'est la **distinction `EventStream` ↔
`AnimationQueue`**. Le journal a piggy-backé sur la file d'animation faute
de flux d'événements unifié. La file d'animation a un job précis — jouer
des animations (buffering de chaîne, locks, directives) ; tout ce qui n'est
pas animable tombe dans les trous.

**Pourquoi un fix isolé ne marche pas** (analysé 2026-05-22) :
- *Side-channel naïf* (alimenter le builder à la réception WS depuis
  `DuelConnection`) → casse l'ordre `SELECT_CARD` → `MSG_BECOME_TARGET` :
  le tap normal alimente le journal dans l'ordre **logique réordonné** par
  le buffer de chaîne, pas dans l'ordre WS brut.
- *Tout forcer dans la file* (B′) → enfreint l'invariant CLAUDE.md
  "`MSG_CHAIN_NEGATED` is NOT pushed to `animationQueue`" (gardé par le
  spec `should NOT enqueue MSG_CHAIN_NEGATED`), invariant par ailleurs
  **justifié** (négation = effet appliqué à la réception, zéro animation).

**La cible archi.** Séparer deux flux :
- **`EventStream`** — *tous* les événements du duel, ordre logique, source
  de vérité unique. Ce que le journal consomme.
- **`AnimationQueue`** — sous-ensemble *dérivé* : les événements animables.
  Ce que le `QueueRunner` consomme.

Le journal s'abonne à `EventStream`, pas à la file d'animation. La parité
PvP↔Replay devient alors **structurelle** — même flux, même builder des
deux côtés (le pattern déjà éprouvé par `ChainSnapshotTracker` :
"same code path on both sides → parity by construction").

**Point de branchement concret** (le game-log étant livré). Aujourd'hui
`DuelGameLogService.notifyGameLog` est appelé par le tap dans
`processEvent`. Dans la cible, `notifyGameLog` **s'abonne à
`EventStream`** au lieu d'être tappé par l'orchestrateur ; le tap dans
`processEvent` disparaît. Le service a déjà tout ce qu'il faut pour ça :
il retient `tappedEvents[]` et sait se reconstruire (`rebuild`,
`rebuildUpTo`) — il lui manque juste *la bonne source*. Les 3 lignes
manquantes (`MSG_CHAIN_NEGATED`, `MSG_WIN`, `SELECT_CARD`) reviennent
gratuitement dès lors que ces événements entrent dans `EventStream` —
ce qu'ils peuvent faire **sans** enfreindre l'invariant
"`MSG_CHAIN_NEGATED` NOT enqueued" (la file d'animation et l'`EventStream`
sont alors deux choses distinctes : l'invariant ne porte que sur la
première).

**Décision de cadrage (révisée 2026-05-22).** L'analyse du
`DuelEventProcessor` (213 lignes lues lors de la revue archi) a montré
que cette séparation **n'est PAS une refonte** — c'est un signal jumeau
(`_eventStream` à côté de `_animationQueue`), tous deux alimentés par le
même `_processMessageInner` qui tourne déjà. Coût : ~0,5j. Risque :
l'ordre (cf. encadré §6 du palier 0). La séparation est donc **promue
en palier 0**, exécuté AVANT le palier A. Justification :
1. **Coût marginal** : le processor voit déjà tout, ajouter un signal
   jumeau est additif, pas destructif.
2. **Critère d'acceptation observable** : P1 game-log livré = bug
   produit visible réparé, plus utile à valider qu'un refactor interne.
3. **Dérisque le palier C** : le `QueueRunner` naît dans un monde où
   le modèle de flux est déjà tranché. Sans cela, C figerait son
   contrat d'entrée sur `animationQueue()` et il faudrait rouvrir le
   contrat plus tard pour brancher `EventStream` — coût de retour
   beaucoup plus élevé.

L'invariant CLAUDE.md "`MSG_CHAIN_NEGATED` NOT enqueued" reste vrai
(file ≠ EventStream — l'invariant ne porte que sur la première). La
section CLAUDE.md "Game Log — known PvP↔Replay divergence" sera
supprimée à l'issue du palier 0 (la divergence n'est plus "known"
mais "résolue").

## 7. Risques & garde-fous

- **Zone la plus critique du projet** : ~200 lignes de règles invariantes
  dans CLAUDE.md (ordre commit/setAnimating, lock contract, chain state
  machine, sync tiers…). Le palier A ne doit RIEN changer du comportement —
  vérifié par les 1036 specs pvp + un run du harness `debug-replay-harness`.
- **Pipeline partagé PvP ↔ Replay** (`DuelEventProcessor`,
  `AnimationDataSource`) : toute régression touche les deux modes. Tester les
  deux.
- **Parité animation** (CLAUDE.md "Animation Parity Rule") : le `QueueRunner`
  ne doit pas importer `DuelWebSocketService`/`DuelConnection` — il reste
  derrière `AnimationDataSource`, comme l'orchestrateur aujourd'hui.
- Faire le palier C **seulement** si le palier B est solide. Si B révèle que
  le couplage est trop fort, s'arrêter à B (testabilité acquise, c'était
  l'objectif premier).

## 8. Estimation

~3-4 jours de codage, en paliers. Palier 0 ~0,5-1j (signal `_eventStream`
côté orchestrateur + 3 points de push : tap actuel + callback `MSG_CHAIN_NEGATED`
depuis processor + prompt routing pour `SELECT_CARD` + handler `DUEL_END` pour
`MSG_WIN` ; rebranchement `DuelGameLogService`), palier A ~1j
(extraction + recâblage), palier B ~1j (nouvelles specs), palier C ~0,5-1j
si entrepris.

> **Avertissement honnêteté (avis archi 2026-05-22).** Cette estimation
> est du **temps de frappe**, pas du temps de livraison sereine. Chaque
> palier exige : 1036+ specs PvP + harness sur 2 modes + relecture des
> invariants CLAUDE.md impactés. Le temps de validation n'est pas
> budgétisé ci-dessus. Estimation réaliste de livraison : ~4-6 jours.

## 9. Définition de "terminé"

- **Palier 0** : `_eventStream` ajouté au `DuelEventProcessor`,
  `DuelGameLogService` abonné dessus, tap orchestrateur supprimé.
  Journal PvP affiche désormais le badge "Nié", la ligne 🏆 et les
  cibles secondaires (parité Replay vérifiée à la main sur une partie
  de référence). 291 specs `DuelEventProcessor` + specs `DuelGameLogService`
  vertes. Section CLAUDE.md "Game Log — known PvP↔Replay divergence"
  supprimée (la divergence est résolue, plus "known").
- `QueueRunner` extrait, `AnimationOrchestratorService` redevient un
  coordinateur fin (dispatch métier + wiring).
- Specs `QueueRunner` couvrant les scénarios seek/pause/reset/rescue
  (les 191 specs `decideNextStep` migrées + les nouvelles du palier B).
- 1036+ specs pvp vertes, harness replay vert.
- Catégorie de log `RUNNER` opérationnelle (verbose, off par défaut) ;
  bloc `run` dans `__skytrixDebug.snapshot()` si palier C fait.
- CLAUDE.md "Orchestrator Decomposition" mis à jour (le runner devient le 8e
  morceau listé) ; la section "Polling Removal — Regression Surface" et
  "Replay interruption safety" pointent vers le `QueueRunner` ; la section
  "Debugging Animations" gagne la catégorie `RUNNER`.
- Idéalement : les 7 primitifs réduits à 2 concepts (si palier C fait).
