# Anim Pipeline v4 — Replay unification (backlog 2026-06-05)

> **Statut** : backlog, à attaquer après v3 abort safety landed
> (Phases 3, 4, 5, 5-bis livrées 2026-06-04). Décision actée par Axel
> sur la question "comment fiabiliser la parité PvP↔Replay quand le
> replay est l'outil debug principal".

## Contexte

Le chantier v3 a structurellement éliminé le bug "togglePerspective
mid-chain throws 3 asserts" via `cancelOrphanedLocks` + retrait
`tolerateLocks`. Les paths de cleanup `resetForSoloSwitch` et
`resetForReplaySeek` sont maintenant **structurellement identiques**.

Mais une **divergence architecturale plus profonde** subsiste :
`ReplayDuelAdapter` est un pipeline parallèle au `DuelConnection` PvP.
Conséquences :

- ~500-700 lignes de code replay-specific (`feedTransition`,
  `feedTransitionPhased`, `advanceStep`, `jumpToState`,
  `collapseRemainingSteps`).
- Doctrines de parité "by construction but not by shared mechanism"
  (F10, F29, F9-bis) — chaque évolution PvP doit être manuellement
  répercutée côté replay.
- Aucun gate automatisé détecte les drift silencieux entre les 2 modes.

**Conséquence sur la contrainte debug** : un bug observé en PvP qui ne
se reproduit pas en replay (ou inversement) n'est PAS détectable
mécaniquement — il faut le voir à l'œil nu. C'est précisément ce qui
fragilise le replay comme outil debug principal.

## La doctrine cible

**Replay = PvP readonly** — le replay réutilise le même pipeline anim
que le PvP (`DuelEventProcessor`, `AnimationOrchestratorService`,
`BoundaryProcessor`, `DeferredEffectProcessor`, projections, runner),
modulo les surfaces hors-mode-replay. Le seul point d'injection
différent est une `MockDuelConnection` qui consomme une séquence
`ServerMessage[]` pré-calculée par le serveur au lieu de recevoir des
messages via WS.

**Surfaces volontairement absentes côté mock** (F19 — adversarial review
2026-06-06) — listées explicitement pour qu'un dev qui ajoute un
comportement au `DuelConnection` PvP sache s'il doit le miror ou le
classer hors-scope replay :

- **Lifecycle WS** : `SESSION_TOKEN`, `SESSION_PHASE`, `DUEL_STARTING`,
  `DUEL_END`, `DICE_ROLL`, `DICE_RESULT`, `SELECT_FIRST_PLAYER`,
  `FIRST_PLAYER_RESULT`, `DECK_PREFETCH`, `EARLY_DECK_PREFETCH` — tous
  matchmaking / bootstrap PvP, pas de replay-équivalent. Skip via
  `REPLAY_IGNORED_TYPES`.
- **Timer + presence** : `TIMER_STATE`, `INACTIVITY_WARNING`,
  `WAITING_RESPONSE`, `OPPONENT_DISCONNECTED`, `OPPONENT_RECONNECTED`
  — état runtime live, pas de replay-équivalent.
- **Rematch** : `REMATCH_INVITATION`, `REMATCH_CANCELLED`,
  `REMATCH_STARTING` — séquence post-duel PvP, pas de replay-équivalent
  (le user revient sur le hub).
- **Reconnect handshake** : `STATE_SYNC`, `CHAIN_STATE` — pas nécessaire
  parce que le replay reload tout le stream à la reconnexion WS (vs
  PvP qui resume from snapshot).
- **Error** : `ERROR` — surface PvP-only (le replay a son propre canal
  `REPLAY_ERROR` géré par `ReplayConnectionService`).

**Routées via le mock** (mirror exact du PvP) : `BOARD_STATE`,
`MSG_HINT` (avec accumulator pour le hint header), `MSG_CONFIRM_CARDS`
(avec accumulator pour les confirmed cards), tous les `SELECT_*` /
`SORT_*` / `ANNOUNCE_*` (via `_handleSelectModal` / `_handleSelectSimple`),
toute la chain pipeline (`MSG_CHAINING` / `MSG_CHAIN_*`), les game events
(`MSG_MOVE`, `MSG_DRAW`, `MSG_DAMAGE`, …), `MSG_WIN` (F2/F4 fix
`753e2d70` — synthèse + `forceBoundaryClosure('DuelEnded')` identique
au PvP `_handleDuelEnd`).

Conséquences architecturales :

- `ReplayDuelAdapter` disparaît.
- `feedTransition` / `feedTransitionPhased` / `advanceStep` /
  `jumpToState` / `collapseRemainingSteps` disparaissent.
- F10 (intermediate BOARD_STATE parity) devient triviale : c'est le
  même flux côté serveur et côté client.
- F29 (forceClosure asymmétrie) disparaît : le replay seek devient un
  cas particulier de `resetForReplaySeek` PvP-equivalent.
- F9-bis (mid-chain seek chainSnapshot) devient triviale : le seek
  est juste un cursor reset + restore via le helper PvP-shared.

**Bénéfice net pour la contrainte debug** : un bug observé en PvP est
GARANTI reproductible en replay parce que c'est strictement le même
code path après `mockConn.dispatch(msg)` ≡ `realConn._handleMessage(msg)`.

## Décisions actées (ne pas re-débattre)

| Décision | Choix | Raison |
|---|---|---|
| Architecture | Variante intermédiaire (mockConn + précompute streamée) | Évite worker live par viewer (coût RAM serveur), garde seek instantané |
| Prompts visibles | Option B — visibles avec auto-respond | Préserve la visualisation debug "qu'est-ce que le joueur voyait" |
| Timing | Délais fixes (`REPLAY_PROMPT_DELAY_MS`, `REPLAY_INTER_MESSAGE_MS`) | Déterminisme = tests e2e fiables, code client simplifié, format replay réduit |
| Format de stockage replay | Inchangé (`playerResponses[]` + metadata) | Rétrocompatibilité totale, anciens replays consommables sans migration |
| Format de stream précompute → client | `{messages: ServerMessage[], autoResponseOffsets: Set<number>, navIndex: NavEntry[]}` | Triple séparé pour ne pas polluer `ServerMessage` discriminated union |
| Granularité de seek | `navIndex[]` (équivalent aux PreComputedState actuels) | Garde le scrubber UI inchangé fonctionnellement |
| Code path après dispatch | Strictement le même que PvP | C'est tout le bénéfice du chantier |

## Pré-requis avant Phase 1 — filets de sécurité

### Pré-requis A — Test de parité événementielle

Spec dédiée : [pvp-replay-event-stream-parity-spec-2026-06-05.md](pvp-replay-event-stream-parity-spec-2026-06-05.md).

- Capture le `_eventStream` d'un run PvP + d'un run Replay du même duel.
- Compare structurellement (modulo BoundaryEvent timestamps).
- Sert de **golden reference** pour valider que le chantier ne casse rien.
- À écrire AVANT de toucher au code production.

### Pré-requis B — Fixture de duels stables

5-6 replays courts couvrant les cas tordus :

| # | Cas | Replay candidat |
|---|---|---|
| 1 | Chain multi-link simple | À choisir (chain ≥3 links) |
| 2 | Cost discard + self-destroy | `18a55f97` (Radiant Typhoon Vision) — déjà utilisé pour `af3195fa` |
| 3 | XYZ détach + destroy | À choisir |
| 4 | Mid-chain prompt | À choisir (SELECT_CARD pendant resolving) |
| 5 | Perspective switch SOLO | À capturer (post-v3 Phase 5-bis disponible) |
| 6 | Skip-to-end + replay mode | À capturer |

Effort : 1-2h (probablement existants en partie).

### Pré-requis C — Décision sur le format de stockage

**Décidé** : garder le format actuel (`playerResponses[]`). Précompute
serveur génère le nouveau format à la volée, ne le persiste pas en DB.
**Conséquence** : tous les replays existants restent compatibles, aucun
travail de migration.

## Plan d'attaque — 7 phases

### Phase 0 — Filets de sécurité ✅ LIVRÉ 2026-06-05 (`a1db49d5`)

Cf. Pré-requis A + B ci-dessus.

- 0.1 — Écrire la spec `pvp-replay-event-stream-parity.spec.ts`.
- 0.2 — Sélectionner les 5-6 replays cas-tordus + persister les fixtures.
- 0.3 — Capturer les `_eventStream` golden pour chacun.
- 0.4 — Assert les 2 streams sont identiques (modulo BoundaryEvent timestamps).

**Sortie** : 1 spec qui sert de gate à chaque phase suivante.
**Effort** : 4-6h.

#### Findings Phase 0 ouverts (F5 — adversarial review 2026-06-06)

Bug racine fixé au merge Phase 0 : double-`transformResponse` (`indices→indicies` 2x).

2 divergences réelles observées sur fixture `18a55f97` post-Phase 0 :

1. **TurnStarted/PhaseStarted dupliqués replay** — sur seek mid-phase,
   le replay émet `TurnStarted` + `PhaseStarted` (asymmetric "First
   BOARD_STATE" branche de `BoundaryProcessor.observeBoardState`) pour
   un turn déjà visité par les BOARD_STATE pre-seek. Cause : `seekToOffset`
   appelle `processor.reset()` → `boundary.silentReset()` qui wipe
   `lastTurn`/`lastPhase`. Le prochain BOARD_STATE retraverse la branche
   "First BOARD_STATE" line 164-174.
   - **Statut** : à trancher en session dédiée — soit (a) asymmetry
     doctrinale acceptable (le test parité doit ignorer les boundaries
     post-silentReset), soit (b) précompute émet plus de BOARD_STATE
     intermédiaires que PvP et un seek mid-phase amplifie l'asymétrie.
   - **Adversarial review** :
     [anim-pipeline-v4-adversarial-findings-2026-06-06.md](anim-pipeline-v4-adversarial-findings-2026-06-06.md)
     section F5.

2. **MSG_DRAW asymétriques perspective=1** — symptôme du bug F1
   (toggle perspective replay ne propageait pas au mock parce que le
   mock lisait `duelCtx.perspectiveSource` toujours à 0).
   - **Statut** : ✅ FIXÉ commit `753e2d70` (2026-06-06). Le toggle
     replay écrit désormais `duelCtx.setPerspective(...)`, le mock
     swap board state correctement.

**Mitigation initiale** : tolérer initialement des différences mineures
(ordre dans même tick, timestamps absents en replay), documenter chaque
différence comme finding. Fix opportunistes ou audit pre-chantier.

### Phase 1 — Concevoir `MockDuelConnection` (sans la brancher) ✅ LIVRÉ (`9cb713a6`)

- 1.1 — ~~Extraire l'interface formelle `IDataConnection` que consomme le
  pipeline anim~~. **DÉCISION ACTÉE 2026-06-06 (F20 adversarial review)** :
  partiellement extrait — `AnimationDataSource` couvre les 8 méthodes
  consommées par l'orchestrator. Le reste (`pendingPrompt`,
  `activeHint`, `activeResponse`, `activePlayer`, `activeConfirmedCards`,
  `busy`) reste consommé par-name sur le concrete type
  (`MockDuelConnection` / `DuelConnection`). Bénéfice d'une interface
  formelle étendue : marginal (1 site de chaque côté, refactor de
  ~20 propriétés). Coût : non négligeable (template + spec stubs touchent
  ces propriétés via le type concret). **Accepté comme dette
  architecturale documentée** ; promoteur naturel = un 3ème consommateur
  hypothétique (fork-solo intermediate state, deck preview replay, etc.)
  qui justifierait l'abstraction.
- 1.2 — Créer `front/src/app/pages/pvp/replay/mock-duel-connection.ts`
  qui implémente `AnimationDataSource` (couvre l'usage orchestrator) ;
  les surfaces UI-facing (`pendingPrompt`, `activeHint`, …) sont des
  propriétés directes du `MockDuelConnection` mirror du concrete
  `DuelConnection`.
- 1.3 — API spécifique mockConn :
  ```ts
  loadStream(stream: ReplayStream): void;
  seekToOffset(offset: number): void;
  dispatchNext(): boolean;  // true si message dispatched, false si fin/blocked
  simulatePlayerResponse(response: PlayerResponseMsg): void;
  readonly messageCursor: Signal<number>;
  ```
- 1.4 — Tests unitaires : `mockConn.dispatchNext()` doit déclencher
  `orchestrator.processEvent` exactement comme `DuelConnection._handleMessage`.

**Sortie** : `MockDuelConnection` testable indépendamment, pas branché.
**Effort** : 4-6h.

### Phase 2 — Adapter la précompute serveur

- 2.1 — Identifier où `replay-precompute.ts` flushe ses `PreComputedState`.
- 2.2 — Remplacer le flush par "stream into `messages: ServerMessage[]`".
  Réutilise `transformMessage` existant.
- 2.3 — À chaque prompt visible (`SELECT_*`), noter l'offset dans
  `autoResponseOffsets: Set<number>` ET capturer la `PLAYER_RESPONSE`
  qui suit (depuis `playerResponses[]`).
- 2.4 — Construire `navIndex[]` : pour chaque "point d'intérêt"
  (équivalent du `PreComputedState` actuel), capturer
  `{messageOffset, label, boardStateSnapshot, chainSnapshot?, perspectiveLifetime}`.
- 2.5 — Nouveau format de stream WS :
  ```
  REPLAY_STREAM_INIT { metadata, totalMessages, navIndexSize }
  REPLAY_STREAM_NAV  { entries: NavEntry[] }  (avant les messages)
  REPLAY_STREAM_CHUNK { offset, messages: ServerMessage[], autoResponseOffsets: number[], autoResponses: {offset, response}[] }
  ```
  Streamer `navIndex` en priorité avant `messages` (scrubber UI immédiatement utilisable).
- 2.6 — `replay-handlers.ts` consomme le nouveau format dans le flux WS.

**Sortie** : précompute serveur produit le nouveau format. Anciens
replays consommables sans migration.
**Effort** : 8-12h.

### Phase 3 — Brancher `mockConn` dans la replay-page

- 3.1 — `ReplayTransportService` consomme `messages: ServerMessage[]`
  au lieu de `PreComputedState[]`. `maybeAdvance()` devient : "si pas
  animating + pas overlay + cursor < messages.length →
  `mockConn.dispatchNext()`".
- 3.2 — Auto-respond : quand le cursor pointe sur un `SELECT_*`,
  dispatch normal, puis `setTimeout(REPLAY_PROMPT_DELAY_MS * speedMultiplier)`
  qui simule la réponse via `mockConn.simulatePlayerResponse(...)`.
- 3.3 — `replay-page.component.ts` : remplacer `ReplayDuelAdapter` par
  `MockDuelConnection` dans le DI. Le token `ANIMATION_DATA_SOURCE`
  pointe sur `mockConn`.
- 3.4 — Faire passer le test de parité Phase 0 sur tous les 5-6 replays.

**Sortie** : replay tourne via `mockConn`, pipeline anim strictement
partagé avec PvP.
**Effort** : 6-10h.

### Phase 4 — Reimplémenter le seek

- 4.1 — `mockConn.seekToOffset(navIndex[N].messageOffset)` :
  ```ts
  this.runner.requestStop();                              // déclenche cancelOrphanedLocks (v3 Phase 3)
  orchestrator.resetForReplaySeek({DUEL_LIFETIME});       // déjà existant post-v3
  rbs.updateLogical(navIndex[N].boardStateSnapshot);
  rbs.commitAll('seek');
  if (navIndex[N].chainSnapshot) {
    processor.restoreChainState(                          // helper shared F9-bis
      chainingMsgsToLinkStates(navIndex[N].chainSnapshot.links),
      navIndex[N].chainSnapshot.phase
    );
    if (navIndex[N].chainSnapshot.currentSolvingChainIndex !== undefined) {
      processor.applyChainSolving(navIndex[N].chainSnapshot.currentSolvingChainIndex);
    }
  }
  gameLogService.reset();
  gameLogService.rebuildUpTo(messages.slice(0, navIndex[N].messageOffset));
  this._messageCursor.set(navIndex[N].messageOffset);
  ```
- 4.2 — Tests : seek mid-chain restore overlay + badges (cas F9-bis actuel).
- 4.3 — Tests : seek arrière + avant + skip-to-end via boucle de seek.

**Sortie** : seek 100% identique pattern à perspective switch SOLO post-v3.
**Effort** : 4-6h.

### Phase 5 — Retirer `ReplayDuelAdapter` et code mort côté client

- 5.1 — Retirer `front/src/app/pages/pvp/replay/replay-duel-adapter.ts`.
- 5.2 — Retirer la branche replay-specific de `ANIMATION_DATA_SOURCE` token
  (mockConn = juste un autre `IDataConnection`).
- 5.3 — Retirer les call-sites de `feedTransition`, `feedTransitionPhased`,
  `advanceStep`, `collapseRemainingSteps`, `jumpToState` partout.
- 5.4 — Retirer la doctrine F29 forceClosure asymmétrie (le replay seek
  rebuild le journal via `mockConn.seekToOffset`, identique au reset PvP
  via STATE_SYNC).
- 5.5 — Mettre à jour CLAUDE.md : section "Replay-as-max-rate-PvP doctrine"
  → "Replay = PvP readonly via MockDuelConnection".

**Sortie** : ~500-700 lignes retirées, complexité conceptuelle réduite.
**Effort** : 3-4h.

### Phase 6 — Nettoyage précompute server-side ✅ LIVRÉ 2026-06-06

Décisions actées avant code (via AskUserQuestion) :
- **Enrichir `ReplayStreamNavEntry`** avec `events: ServerMessage[]` +
  `responseCount: number` (3 options évaluées ; enrichir était le plus
  propre — doctrine pure, 1 seul format de données transporté).
- **Supprimer `PreComputedState` + `DecisionMoment` + `ReplayBoardStatesMsg`**
  du protocole WS et du back. `DecisionMoment` n'avait plus de consommateur
  (l'adapter qui le lisait est mort Phase 5 ; le timing humain a été
  remplacé par `REPLAY_PROMPT_DELAY_MS = 1200ms` fixe).
- **Garder `chainSnapshot` sur `navIndex`** (load-bearing pour F9-bis
  mid-chain seek restore — Phase 4 livrée).

Livraison :
- 6.1 — Unifié les paths legacy / v4 dans `replay-precompute.ts` :
  suppression de `flushState`, `emitTurnBatch`, `finalizeChainGroups`,
  `turnStates`, `currentDecisions`, `lastHint`, `lastConfirmedCards`.
  Introduit `flushNavEntry()` (helper unique appelé à chaque
  segmentation boundary), `finalizeChainGroupsForNav` (sur
  `ReplayStreamNavEntry[]`). `ReplayStreamBuilder.recordNavEntry`
  signature étendue : `(label, turn, bs, events, responseCount,
  chainSnapshot?, chainIndex?)`. `finalizeCurrentTurnChainGroups`
  appelé avant `flushTurn`.
- 6.2 — `chainSnapshot` conservé sur `ReplayStreamNavEntry` ;
  `PreComputedState.chainSnapshot` retiré avec le type lui-même.
- 6.3 — `replay-handlers.ts` ne stream plus que `REPLAY_STREAM_*` ;
  branche `WORKER_REPLAY_BOARD_STATES` retirée.
- 6.4 — Specs adaptées : `replay-precompute.spec.ts` (3 tests
  finalizeChainGroups/emitTurnBatch portés vers `finalizeChainGroupsForNav`,
  emitTurnBatch supprimé), `replay-precompute-v4-stream.spec.ts`
  (signature `recordNavEntry`), `worker-message-validation.spec.ts`
  (retire WORKER_REPLAY_BOARD_STATES tests), `duel-worker-emit.spec.ts`
  + `duel-worker-fork.spec.ts` (retirent `replayBoardStates` method),
  `game-log-builder.spec.ts` (introduit `BuilderState` structural).
- 6.5 — Front : `boardStates` → `navIndex` partout. `replay-page`,
  `replay-connection.service` (supprime signal `boardStates`), `replay-transport.service`
  (config `navIndex`), `replay-fork.service` (`cachedNavIndex` +
  `fork(idx, navIndex, replayId)`), `timeline-bar` + html, `turn-picker-sheet`
  + html, `sub-event-picker-sheet` + html. `duel-game-log.service.rebuildUpTo`
  signature `{events, boardStateSnapshot}[]` structurel (helper `navEntryToRebuildState`).
  `GameLogBuilder.ingestState` accepte `BuilderState = {events, boardState}`
  (découplé de `PreComputedState`).

Tests finaux :
- Karma front pvp : **1586/1586 verts**
- Vitest duel-server : **1907/1908 verts** (1 pré-existant `dist/`)
- tsc front + back : OK
- check-ws-protocol-sync : OK

**Sortie** : précompute simplifiée. `ReplayStreamNavEntry` est
maintenant le successeur 1:1 du retired `PreComputedState`. La doctrine
"Replay = PvP readonly via MockDuelConnection" est atteinte —
`mockConn.navIndex()` est la seule structure de données timeline,
exposée comme `ReadonlyArray<ReplayStreamNavEntry>` directement aux
consommateurs UI.
**Effort réel** : ~5-6h (incl. front fan-out 8 fichiers + specs).

### Phase 7 — Validation et finition

- 7.1 — Test de parité événementielle Phase 0 ✅.
- 7.2 — Tous les replay specs existants ✅.
- 7.3 — e2e harness (debug-radiant-typhoon, autres specs e2e replay) ✅.
- 7.4 — Manuel : seek mid-chain, perspective switch en replay, pause/resume,
  skip-to-end, playback speed x0.5/x2/x4.
- 7.5 — fork-solo : depuis un replay au state N, démarrer fork-solo.
  Vérifier que la transition est propre (le fork-solo prend le worker
  live et remplace mockConn par realConn).

**Sortie** : chantier validé.
**Effort** : 2-3h.

## Effort total estimé

| Phase | Durée |
|---|---|
| 0 (filets de sécurité) | 4-6h |
| 1 (MockDuelConnection design) | 4-6h |
| 2 (précompute serveur) | 8-12h |
| 3 (branchement client) | 6-10h |
| 4 (seek) | 4-6h |
| 5 (cleanup client) | 3-4h |
| 6 (cleanup serveur) | 3-5h |
| 7 (validation) | 2-3h |
| **Total** | **34-52h** |

## Risques identifiés

### Risque 1 — Le test de parité Phase 0 révèle des divergences pré-existantes

Si le `_eventStream` PvP et Replay actuels ne sont pas strictement
identiques pour les 5-6 fixtures, le test fail dès l'écriture. C'est une
**bonne nouvelle** — ça révèle des bugs existants non détectés. Mais ça
peut bloquer le chantier.

**Mitigation** : tolérer initialement des différences mineures (ordre dans
même tick, timestamps absents en replay), documenter chaque différence
comme finding. Fix opportunistes ou audit pre-chantier.

### Risque 2 — `MockDuelConnection` ne satisfait pas exactement l'interface de `DuelConnection`

`DuelConnection` a probablement des méthodes spécifiques au transport WS
(reconnect, ping, STATE_SYNC request, ACTIVITY_PING). `mockConn` n'en a
pas besoin.

**Mitigation** : Phase 1 doit dégager une interface `IDataConnection`
minimale qui contient ce que l'orchestrator + page consomment vraiment.
`DuelConnection` et `MockDuelConnection` implémentent toutes les deux.

### Risque 3 — Volume du payload `messages[]` plus gros que `PreComputedState[]`

`PreComputedState[]` agrège plusieurs events par state. `messages[]` les
liste un à un. Volume payload potentiellement 2-3x.

**Mitigation** : mesurer en Phase 2. Si problématique, compresser côté
serveur (gzip déjà actif probablement). À pire, segmenter `messages[]`
en chunks (`REPLAY_STREAM_CHUNK` × N).

### Risque 4 — Seek vers offset au-delà du chunk streamé

Si le client cherche à seek vers une zone pas encore streamée, attendre.
Pareil qu'aujourd'hui avec `PreComputedState[]`.

**Mitigation** : `navIndex[]` streamé en priorité avant `messages[]`
(l'index est petit). Le scrubber affiche les points de seek possibles +
le seek attend si la zone n'est pas chargée.

### Risque 5 — fork-solo doit interagir avec mockConn

Fork-solo aujourd'hui : on quitte le replay et on spawn un worker live.
Demain : on doit faire que le worker live commence dans l'état actuel du
`mockConn`, puis on remplace `mockConn` par `realConn`.

**Mitigation** : la transition fork-solo devient "snapshot OCGCore au
point de fork + spawn worker avec ce snapshot + swap d'instance dans
`ANIMATION_DATA_SOURCE`". Côté serveur, c'est ce que fait déjà
`INIT_FORK`. Côté client, c'est juste un swap DI.

### Risque 6 — Cache serveur des précomputes obsolète

Si un cache de précompute serveur existe (Redis avec `PreComputedState[]`),
il devient invalide.

**Mitigation** : vérifier l'existence d'un cache. Si oui, invalider lors
du déploiement. Pas un blocker.

### Risque 7 — Doctrine "Replay-as-max-rate-PvP" change de sens

Aujourd'hui : "replay est conceptuellement un PvP rapide". Demain :
"replay EST un PvP readonly". Ce n'est plus une doctrine, c'est une
implémentation.

**Mitigation** : section CLAUDE.md à réécrire en Phase 5. La doctrine
devient simplement la description architecturale.

## Décisions ouvertes

### Décision 1 — Valeurs des constantes de timing

- `REPLAY_PROMPT_DELAY_MS` : suggestion 1200ms (clamp humain moyen).
- `REPLAY_INTER_MESSAGE_MS` : suggestion 100ms (pour qu'on voie les
  transitions BOARD_STATE intermédiaires).

À finaliser en Phase 3 après tests manuels. Les 2 scalent par
`playbackSpeed` standard.

### Décision 2 — Sort des modes "pause sur chaque prompt" et "skip-to-end"

- **Pause sur chaque prompt** (`togglePromptMode`) : facile à garder —
  le `setTimeout` auto-respond est conditionné sur le mode. 2-3 lignes
  de patch.
- **Skip-to-end** (`collapseRemainingSteps`) : retirer ou réécrire ?
  Réécriture trivale via boucle `mockConn.seekToOffset(navIndex[last])`
  sans armer le `setTimeout` auto-respond. À décider en Phase 4.

### Décision 3 — Tape player côté serveur vs client

L'auto-respond simule la réponse au prompt. Deux options :

- **Option a** (recommandée) : auto-respond géré côté client via
  `mockConn.simulatePlayerResponse()`. Le serveur ne re-précompute
  rien, il envoie `messages[]` + `autoResponses[]`. Le client matche.
- **Option b** : tape player serveur. Le serveur re-précompute à la
  volée à chaque prompt. Plus de RAM serveur + couplage live nécessaire.

Recommandation Option a — simplicité + indépendance vis-à-vis du serveur
une fois le stream chargé.

### Décision 4 — Garder le `_postRequestStopWindow` instrumental ?

Aujourd'hui (post-v3) `_postRequestStopWindow` détecte les `lockZone`
post-`requestStop`. En v4 le `mockConn.requestStop` réutilise le même
mécanisme — la window reste pertinente. À garder.

## Liens

- Chantier précédent : [anim-pipeline-v3-abort-safety-2026-06-04.md](anim-pipeline-v3-abort-safety-2026-06-04.md).
- Spec test parité (Phase 0) : [pvp-replay-event-stream-parity-spec-2026-06-05.md](pvp-replay-event-stream-parity-spec-2026-06-05.md).
- **Inventaire `ReplayDuelAdapter`** (pré-Phase 1) : [replay-adapter-inventory-2026-06-05.md](replay-adapter-inventory-2026-06-05.md) — détaille chaque méthode/comportement de l'adapter + transport et son sort en v4 (porté, retiré, modifié). Pin les 6 comportements implicites à vérifier avant suppression + 4 décisions ouvertes pour Phase 1.
- CLAUDE.md "Replay-as-max-rate-PvP doctrine" (à retirer en Phase 5).
- CLAUDE.md "Replay Board State Parity Rule" (simplifier en Phase 5).
- F10 / F29 / F9-bis doctrines (à simplifier ou retirer en Phase 5/6).
