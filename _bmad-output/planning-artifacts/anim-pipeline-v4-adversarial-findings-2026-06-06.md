# Anim Pipeline v4 — adversarial review findings (2026-06-06)

> **Cible** : `_bmad-output/planning-artifacts/anim-pipeline-v4-replay-unification-2026-06-05.md`
> + code livré Phase 0 (`a1db49d5`), Phases 1-5 (`9cb713a6`), Phase 6 (`e9258474`).
>
> **Doctrine évaluée** : "Replay = PvP readonly via MockDuelConnection".
>
> **But de la review** : zéro bug runtime, parité PvP↔Replay maximale,
> code le plus propre possible — tout est remettable en cause, y compris
> les décisions actées et les phases déjà livrées.

## TL;DR

3 bugs runtime CERTAINS (F1, F2, F3) vérifiés par lecture exhaustive
+ grep d'invariants. Ces 3 trouent silencieusement la parité PvP↔Replay
revendiquée et expliquent probablement le `MSG_DRAW asymétriques
perspective=1` mentionné dans la memory `anim-pipeline-v4-phase-0-landed-2026-06-05`
comme "à investiguer en session dédiée". À traiter avant tout autre
travail v4.

3 régressions doctrinales/architecture SÛRES (F4, F6, F20). 6 risques
ou dettes en attente de vérification runtime (F5, F7, F9, F11, F12, F14).
5 findings affaiblis par vérification — listés en bas pour traçabilité.

---

## Findings CERTAINS (vérifiés runtime)

### F1 — BUG : toggle perspective replay ne fait rien sur le board

**Sévérité** : HIGH. Régression UX silencieuse vs comportement v3 (adapter).

**Chaîne de preuve** :

1. `mockConn._currentPerspective()` ([mock-duel-connection.ts:227-229](front/src/app/pages/pvp/replay/mock-duel-connection.ts#L227-L229))
   lit `_duelCtx.perspective()()`, qui résout vers `DuelContext.perspectiveSource`
   ([duel-context.ts:64](front/src/app/pages/pvp/duel-page/duel-context.ts#L64)).

2. `DuelContext.perspectiveSource` est doctrinalement "reste à 0 — la
   perspective y est figée à l'identité serveur du viewer"
   ([duel-context.ts:48-49](front/src/app/pages/pvp/duel-page/duel-context.ts#L48-L49)).

3. `replay-page.onTogglePerspective()` ([replay-page.component.ts:1003-1012](front/src/app/pages/pvp/replay/replay-page.component.ts#L1003-L1012))
   écrit `this.perspectiveIndex.update(...)` + `this.mockConn.perspectiveIndex.set(...)`
   MAIS jamais `duelCtx.setPerspective(...)`.

4. Grep exhaustif sur `front/src/app/pages/pvp/replay/` : **0 appel à
   `duelCtx.setPerspective`**. Le seul `setPerspective` du replay est
   `gameLog.setPerspective` (service différent, signal différent).

5. `mockConn.perspectiveIndex` (la signal flippée par le toggle) est
   **dead-write** — 0 consommateur dans tout `front/` (grep confirme :
   2 sites d'écriture, 0 site de lecture aval).

6. Conséquence mécanique : `_maybeSwapBoardState` ligne 231 et
   `_maybeSwapBoardStateAfter` ligne 235 reçoivent toujours
   `perspective=0` → `swapBoardState(bs, 0)` retourne `bs` inchangé
   ([board-state-swap.ts:27](front/src/app/pages/pvp/board-state-swap.ts#L27))
   → board ne pivote PAS au toggle.

**Coverage** :
- Spec `mock-duel-connection.spec.ts:179` couvre "perspective initiale = 1"
  (instancie `MockDuelConnection({ duelCtx: { perspective: () => signal(1) } })`).
- **Aucun spec** ne couvre "toggle runtime depuis 0 vers 1 via la page".
- Les tests page (`replay-page.component.spec.ts:607`) utilisent
  `StubMockDuelConnection` → la logique de swap réelle n'est pas exercée.

**Impact runtime** :
- Le board ne pivote pas au toggle perspective replay.
- `replayDisplayedTurnPlayer` (computed local page line 332-337) se met
  bien à jour parce qu'il lit `perspectiveIndex()` localement, pas via
  duelCtx. Idem pour `replayHighlightedZones` / `replayChosenZone` qui
  passent par `duelCtx.relativePlayer` (lit `ownPlayerIndex`, qui est
  configuré ligne 905 sur `perspectiveIndex`).
- Conclusion : le toggle modifie l'UI relative (zones surlignées,
  badges) mais NE swap PAS le board → désynchro visuelle. La memory
  `MSG_DRAW asymétriques perspective=1` sur 18a55f97 est très
  probablement le symptôme.

**Fix possible** :
- Option A : `onTogglePerspective` appelle `this.duelCtx.setPerspective(this.perspectiveIndex())`.
- Option B (préférée — collapse la dette F6) : retirer `mockConn.perspectiveIndex`
  + `replay-page.perspectiveIndex` ; rendre `duelCtx.perspectiveSource`
  l'unique source ; la page lit/écrit via `duelCtx.perspective()` /
  `duelCtx.setPerspective(...)` ; le mock continue de lire via
  `_duelCtx.perspective()()`.

### F2 — BUG : MSG_WIN skip silencieux côté mock → 🏆 absent du journal replay

**Sévérité** : HIGH. Régression de parité Game Log directement
visible par l'utilisateur sur le dernier état du replay.

**Chaîne de preuve** :

1. Côté serveur, OCG émet `OcgMessageType.WIN`.
2. `ocg-message-transforms.ts:676` produit `{ type: 'MSG_WIN', player, reason }`.
3. `message-filter.ts:199` passe `MSG_WIN` en passthrough (filtered truthy).
4. `replay-precompute.ts` branche else default lignes 682-686 →
   `events.push(filtered)` + `ingestStream(filtered)` → MSG_WIN
   atterrit dans `messages: ServerMessage[]` du stream.
5. Côté client, `mock-duel-connection.ts:610` ajoute `'MSG_WIN'` dans
   `REPLAY_IGNORED_TYPES`.
6. `_dispatch` ligne 486-490 log "skipping replay-irrelevant type" et
   return.
7. `pushToStream` / `_outOfBandSink` / `DuelGameLogService` ne voient
   **JAMAIS** MSG_WIN.

**Côté PvP, pour comparaison** :
- `_handleDuelEnd` ([duel-connection.ts:1564-1616](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1564-L1616))
  SYNTHÉTISE MSG_WIN ligne 1575-1582 quand `winner !== null && winReasonCode !== undefined`,
  push via `_outOfBandSink?.(synthetic)`.
- Puis `processor.forceBoundaryClosure('DuelEnded')` ligne 1589 ferme
  ChainEnded/PhaseEnded/TurnEnded dans le bon ordre causal.

**Impact runtime** :
- Le journal replay ne reçoit pas la ligne `MSG_WIN` → pas de 🏆 ni de
  `winReasonCode` rendu.
- Les boundaries finales (Chain/Phase/Turn ouvertes au moment du WIN)
  ne sont jamais fermées en replay → projections `OverlayShowReadyProjection`
  + autres consommateurs du `BoundaryProcessor` restent dans un état
  intermédiaire (jamais re-set parce que le test de parité Phase 0
  s'arrête manifestement avant le DUEL_END / MSG_WIN).

**Fix possible** :
- Le mock dispatche `MSG_WIN` au lieu de le skip : router vers
  `processor.processMessage(message)` + push via `_outOfBandSink?.(message)`
  (mirror du synthétique PvP).
- ET appeler `this.processor.forceBoundaryClosure('DuelEnded')` quand
  MSG_WIN arrive (pas via DUEL_END qui n'existe pas en replay).

**Note doctrine** : le spec ligne 217 promet "Phase 5.4 — Retirer la
doctrine F29 forceClosure asymmétrie (le replay seek rebuild le journal
via mockConn.seekToOffset, identique au reset PvP via STATE_SYNC)".
La doctrine F29 a été transformée (justifiée par le rebuild journal au
seek), pas vraiment retirée. Mais le DUEL_END / MSG_WIN final, qui
N'EST PAS un seek, perd quand même `forceBoundaryClosure`. Le rebuild
journal au seek ne couvre PAS le DUEL_END naturel.

### F3 — BUG : `syncAfterBoardState` jamais branché côté mock (régression Phase 1→5 silencieuse)

**Sévérité** : MEDIUM-HIGH. Régression doctrinale documentée comme
"Phase 3 will re-introduce" — Phase 3, 4, 5, 6 livrées sans le branchement.

**Chaîne de preuve** :

1. PvP : `duel-connection.ts:1244` appelle
   `syncAfterBoardState(this.rbs, this.processor.chainPhase(), ...)` à
   chaque BOARD_STATE.
2. Mock : `mock-duel-connection.ts:495-505` `_handleBoardState` fait
   seulement `rbs.updateLogical(data)` + `processor.observeBoardState(data)`.
3. Commentaire ligne 497-502 (verbatim) :
   > "Note (Phase 1): we intentionally skip `syncAfterBoardState` here.
   > The PvP path calls it to drive sync-tier decisions while a live WS
   > streams events ; in replay v4 the BOARD_STATE is just the source of
   > truth for `updateLogical` and `observeBoardState`. Phase 3 will
   > re-introduce `syncAfterBoardState` once the auto-advance scheduler
   > is in place so the tier semantics match PvP exactly."
4. État au 2026-06-06 : Phases 1-5 + Phase 6 livrées (`9cb713a6` +
   `e9258474`). `syncAfterBoardState` PAS rebranché.
5. `processor.observeBoardState` ne fait que driver `boundary.observeBoardState`
   ([duel-event-processor.ts:280-281](front/src/app/pages/pvp/duel-page/duel-event-processor.ts#L280-L281))
   — ne touche pas le sync rendered.

**Impact runtime** :
- Un BOARD_STATE replay déclenche `updateLogical` + boundary observation
  mais **aucun sync vers rendered**.
- Le PvP, au même moment, aurait fait :
  - tier 1 (`!boardActive`) → `syncPileCounts` (bootstrap)
  - tier 2 (`chainPhase=idle && queueLength=0`) → `syncRendered` (full sync)
  - tier 3 (`chainPhase ∈ {idle,building} && queue>0`) → `syncPileCounts` (counts + meta)
  - tier 4 (`resolving`) → defer
- En replay, aucun de ces tiers ne s'exécute → DECK/EXTRA pile counts +
  global metadata (turnCount, phase) sur `renderedState` peuvent rester
  stales tant qu'aucun lockZone/commit n'a fired entre 2 BOARD_STATE.
- Symptômes attendus : `pvp-board-container.deckCount()` affiché à 0
  pendant le bootstrap initial replay (avant le 1er lockZone d'un
  MSG_DRAW), DECK pile invisible un frame avant le draw, ou
  `renderedState.turnCount` qui lag d'un BOARD_STATE par rapport à
  `logicalState.turnCount`.

**Fix possible** :
- Brancher `syncAfterBoardState(this.rbs, this.processor.chainPhase(),
  this.processor.animationQueue().length, this._duelCtx?.isBoardActive?.() ?? true)`
  dans `_handleBoardState` du mock — pré-existant + exporté depuis
  `animation-data-source.ts`.
- Le commentaire "Phase 3 will re-introduce" devient obsolète, à
  supprimer.

**Note** : cette régression peut être masquée par le fait que la majorité
des BOARD_STATE replay arrivent durant chain `resolving` (tier 4 = defer)
ou en bootstrap (tier 1 = syncPileCounts, dégénère facilement). Le cas
visible serait probablement : "le tour passe sans animation mais le
deckCount UI ne décroît pas jusqu'au prochain draw". À chercher dans
les replays test.

---

## Findings CERTAINS (sans test runtime nécessaire — pure lecture code)

### F4 — Régression de parité : `forceBoundaryClosure('DuelEnded')` absent côté replay

**Sévérité** : MEDIUM. Dépendance de F2.

PvP : `_handleDuelEnd` ligne 1589 → `processor.forceBoundaryClosure('DuelEnded')`
émet les `*Ended` finaux pour Chain → Phase → Turn dans le bon ordre
causal AVANT `processor.reset()`.

Replay mock : `DUEL_END` est dans `REPLAY_IGNORED_TYPES` ligne 603 et
`MSG_WIN` ne déclenche aucune fermeture boundary. Donc le replay
n'émet **jamais** la séquence finale `ChainEnded/PhaseEnded/TurnEnded`
sur le dernier state du duel.

**Coupling avec F2** : un fix correct de F2 (dispatch MSG_WIN +
forceBoundaryClosure côté mock) résout F4 simultanément.

### F6 — Anti-pattern : la perspective signal est dupliquée en 3 sources de vérité

**Sévérité** : MEDIUM. Cause racine de F1.

3 signaux différents pour le même concept :
- `mockConn.perspectiveIndex` (writable signal, [mock-duel-connection.ts:121](front/src/app/pages/pvp/replay/mock-duel-connection.ts#L121))
- `DuelContext.perspectiveSource` (writable signal, [duel-context.ts:63](front/src/app/pages/pvp/duel-page/duel-context.ts#L63))
- `replay-page.perspectiveIndex` (local signal, écrite [replay-page.component.ts:1006](front/src/app/pages/pvp/replay/replay-page.component.ts#L1006))

CLAUDE.md "Doctrine 3-bis — Dual-purpose signal — reactive UI + sync
predicate" interdit explicitement ce pattern : "NE PAS dupliquer en
projection + miroir privé — deux writers en lockstep est fragile par
construction. F-bugB4 2026-05-31 surfaced an infinite re-deferred loop
caused by exactly this skew."

Le spec ligne 121 commente `mockConn.perspectiveIndex` comme "PvP
equivalent : the SOLO orchestrator's perspectiveSource signal" — mais
la doctrine SOLO PvP était précisément l'inverse : UNE source via
`setPerspective`.

**Fix** : voir F1 Option B — collapse à une seule source
(`duelCtx.perspectiveSource`), retirer `mockConn.perspectiveIndex` et
`replay-page.perspectiveIndex`.

### F13 — `loadStream` dead code en production

**Sévérité** : LOW. Cleanup.

`mock-duel-connection.ts:311-319` `loadStream(stream: ReplayStream): void`
documenté "Phase 1 back-compat — load a complete stream in one shot.
Kept for tests that don't go through the chunked path."

Phase 3-5-6 livrées. Production utilise `appendChunk` + `loadStreamInit`.
`loadStream` consommé uniquement par les unit tests.

**Fix** : déplacer dans `__test__` export (mirror de `replay-precompute.ts:801-811`)
ou inliner dans les tests.

### F20 — `IDataConnection` formelle jamais extraite (promesse Phase 1 partielle)

**Sévérité** : MEDIUM. Dette architecturale.

Spec ligne 119-121 promet :
> "Phase 1.1 — Extraire l'interface formelle `IDataConnection` que
> consomme le pipeline anim (orchestrator, page, prompt-dialog,
> chain-overlay). Probablement un sous-ensemble strict de l'API publique
> de `DuelConnection`."

Réalité livrée :
- `MockDuelConnection implements AnimationDataSource` ([mock-duel-connection.ts:58](front/src/app/pages/pvp/replay/mock-duel-connection.ts#L58)).
- `AnimationDataSource` couvre seulement les 8 méthodes que
  l'orchestrator consomme (`processor`, `renderedBoardState`,
  `boardStateView`, `animationQueue`, `activeChainLinks`, `chainPhase`,
  `enqueueDirective`, `dequeueAnimation`, etc.).
- Tout ce que `pvp-prompt-dialog`, `chain-overlay`, `pvp-board-container`,
  `topbar` consomment (`pendingPrompt`, `activeHint`, `activeResponse`,
  `activePlayer`, `activeConfirmedCards`, `busy`) passe par les concrete
  types `MockDuelConnection` / `DuelConnection` — pas par une interface.
- Conséquence : un futur composant qui consomme `mockConn.someNewField`
  doit le typer en `MockDuelConnection`, pas en `IDataConnection`. La
  doctrine d'abstraction est cassée.

**Fix** : soit acter "AnimationDataSource est suffisant + on accepte
le couplage par-name", soit extraire la vraie `IDataConnection`.

### F5 — Phase 0 findings ouverts non documentés

**Sévérité** : MEDIUM. Dette de doc.

Spec ligne 115 : "Documenter chaque différence comme finding (chantier
v4 préliminaire). Fix opportunistes."

Memory `anim-pipeline-v4-phase-0-landed-2026-06-05` :
> "Divergences réelles observées sur 18a55f97 (TurnStarted/PhaseStarted
> dupliqués replay, MSG_DRAW asymétriques) — à investiguer en session
> dédiée."

Donc :
- Des divergences confirmées EXISTAIENT avant Phase 1.
- Elles n'ont PAS été résolues avant de passer Phase 1-5.
- Le spec ne mentionne ni leur existence ni leur statut.
- La promesse "le test reste vert à chaque phase suivante" (ligne 111)
  est creuse — soit le test fail silencieusement sur ces 2 cas connus
  et acceptés, soit il les masque par tolérance.

Note : `MSG_DRAW asymétriques perspective=1` est probablement F1 (le
bug toggle perspective). `TurnStarted/PhaseStarted dupliqués replay`
est un finding séparé à investiguer.

**Cause plausible (analyse à confirmer sur la trace Phase 0)** : le
BoundaryProcessor `observeBoardState` ([boundary-processor.ts:159-209](front/src/app/pages/pvp/duel-page/boundary-processor.ts#L159-L209))
ne double-fire PAS naturellement — `lastTurn` + `lastPhase` gardes
empêchent les redondances. MAIS `processor.reset()` ([duel-event-processor.ts:300-311](front/src/app/pages/pvp/duel-page/duel-event-processor.ts#L300-L311))
fait `boundary.silentReset()` qui wipe `lastTurn`/`lastPhase` sans
émettre `*Ended`. Le prochain BOARD_STATE branche "First BOARD_STATE"
(line 164-174 — "asymmetric by design") → re-émet `TurnStarted` +
`PhaseStarted` pour le même turn déjà visité. Côté replay le seek
appelle `processor.reset()` ; le test parité capture probablement
cette ré-émission comme "duplicate". À trancher : soit (a) c'est
l'asymmetry doctrinale et le test parité doit l'ignorer, soit (b)
la précompute émet plus de BOARD_STATE intermédiaires que PvP et un
seek mid-phase amplifie l'asymétrie. À investiguer sur la trace Phase 0
du 18a55f97.

**Fix** : ajouter section "Phase 0 findings ouverts" au spec avec les
2 divergences connues + statut (in-progress / accepted-debt / fixed).

---

## Finding F22 — découvert en session diagnostic 2026-06-07

### F22 — SOLO multiplex from-replay : initial hand "5+5 puis -5"

**Sévérité** : MEDIUM. Bug visuel SOLO, observé par Axel via harness
Phase 0 lorsque le SOLO live démarre depuis `/api/duels/from-replay`.

**Scope précisé (2026-06-07 Axel)** : bug **SOLO multiplex live**
(`/pvp/duel/{id}?solo=true` post-from-replay endpoint), PAS le replay
viewer. Le replay viewer n'a pas d'initial draw animation, donc pas
de bug visuel équivalent.

**Symptôme observé** : au démarrage du SOLO, la HAND du joueur 0
affiche déjà 5 cartes (board pré-rendu). Puis l'animation `MSG_DRAW`
joue → **rajoute** 5 cartes visuellement (la hand a 10 cartes pendant
l'animation). À la fin de l'animation, les 5 cartes ajoutées
**disparaissent** pour ne laisser que 5 cartes (état correct final).

**Comportement attendu** : la hand devrait commencer **vide** (0
cartes), puis la draw animation ajoute les 5 cartes une par une jusqu'à
arriver à 5.

**Cause technique probable (à investiguer)** :

C'est le symétrique du tier 1 PvP `boardActive=false` documenté dans
CLAUDE.md "syncAfterBoardState" :

> "A full `commitAll()` here would copy the server's post-draw zones
> (HAND already populated) straight into the rendered state, so when
> the buffer drains the animation plays ON TOP of cards already visible
> in hand."

Le SOLO multiplex live a un bootstrap particulier post-`ANIMATIONS_READY` :
1. Worker spawn et émet `MSG_DRAW × 5 + BOARD_STATE` rapidement.
2. Le client reçoit ces messages dans le même batch WS.
3. Le pre-activation buffer (`_preActivationBuffer`) est censé absorber
   les MSG_DRAW jusqu'à `setBoardActive(true)`.
4. `BOARD_STATE` déclenche `syncAfterBoardState` tier 1 → `syncPileCounts()`
   (cf. CLAUDE.md doctrine — PAS un commitAll, justement pour éviter ce bug).

**Hypothèse à valider** : peut-être que le from-replay bootstrap diffère
du SOLO normal — l'ordre des messages ou le timing de `setBoardActive`
est différent et le tier 1 est skip. OU le `decklistId: null` du
sessionStorage injecté par le harness change le comportement.

**Action diagnostic** : ajouter logs `[F22]` côté SOLO bootstrap
(`syncAfterBoardState` tier 1 fire ?, `setBoardActive(true)` timing,
`_preActivationBuffer` content). Reproduire avec le harness, capturer
console export.

**Statut** : finding OUVERT, à investiguer après F21 validé.

---

## Finding F21 — découvert en session diagnostic 2026-06-07

### F21 — Replay auto-play stalle silencieusement sur pausedAtBoundary (pré-existant)

**Sévérité** : MEDIUM. Bug runtime pré-existant à mes fixes adversarial,
révélé par tentative de relance harness Phase 0 sur stack user.

**Symptôme observé** : ouverture replay 18a55f97 → auto-play démarre →
**la fenêtre se bloque silencieusement au milieu**. Pause manuelle puis
play relance le playback. Le harness Phase 0 voit ça comme un timeout
30s sur `waitForNaturalEnd` ou `waitForQueueDrain` (le scrubber est
arrêté mais `currentIndex < total - 1`).

**Cause technique (analyse)** : `ReplayTransportService.scheduleNext`
([replay-transport.service.ts:329-342](front/src/app/pages/pvp/replay/replay-transport.service.ts#L329-L342))
flip `isPlaying.set(false) + pausedAtBoundary.set(true)` quand
`currentIndex >= computedUpTo()`. `computedUpTo` = `navIndex().length - 1`
qui croît au fur et à mesure des `appendChunk()`. Si la playback rattrape
le streaming, on entre en pausedAtBoundary. Le `resumeIfBoundaryWaiting`
effect ([replay-page.component.ts:707-712](front/src/app/pages/pvp/replay/replay-page.component.ts#L707-L712))
doit auto-resume quand `computedUpTo` augmente, MAIS l'utilisateur
observe que ça ne se produit PAS → soit l'effect ne fire pas, soit la
condition `computedUpTo > currentIndex` n'est jamais vérifiée parce que
le scheduler n'arrive jamais à `pausedAtBoundary=true` au bon moment.

**Hypothèses à valider en session dédiée** :
1. Race condition entre `appendChunk` (qui update navIndex) et l'effect
   `resumeIfBoundaryWaiting` (qui doit le détecter).
2. `pausedAtBoundary` flip n'est pas observé par l'effect parce qu'il
   subscribe à `computedUpTo` mais celui-ci n'a pas changé entre la
   pause et la reprise potentielle.
3. Bug pré-existant à Phase 0/1-6 mais latent — devient visible quand
   la playback est rapide vs la précompute (env e2e ou stack lente).

**Investigation menée pendant la session** :
- Revert temporaire F3 (`syncAfterBoardState`) → stall reproduit. F3
  N'EST PAS la cause.
- Mes 6 fixes adversarial touchent uniquement replay-side ; aucun
  fichier SOLO/duel-page/duel-connection.
- Phase 0 livré (`a1db49d5`) post-`659a5974` qui stabilisait le
  harness, donc la stabilisation a fonctionné à un moment.

**Statut** : finding ouvert, à investiguer en session dédiée avec
accès console duel-server user + browser inspector. Workaround manuel
documenté par Axel : pause/play pour relancer.

**Action** : NE PAS bloquer le push des 6 fixes adversarial à cause
de ce finding. Le bug est pré-existant et n'affecte pas la correction
des P0/P1 livrés.

---

## Findings vérifiés runtime (mise à jour 2026-06-06)

### F7 — MSG_HINT cleared at seek + reconstruction absente → **CONFIRMÉ**

**Statut** : bug runtime confirmé par analyse mécanique. Sévérité
MEDIUM (UX dégradée, pas un crash).

**Chaîne de preuve** :

1. Mock `seekToOffset` ligne 418 : `_transport_lastHint.set(null)`.
2. Précompute ingère MSG_HINT dans le stream comme messages distincts
   ([replay-precompute.ts:632-638](duel-server/src/replay-precompute.ts#L632-L638))
   AVANT le SELECT_* auquel ils s'appliquent.
3. Mock `_dispatch` MSG_HINT ligne 446-457 set `_lastHint` à chaque
   réception.
4. Mock `_handleSelectModal` / `_handleSelectSimple` set
   `pendingPrompt` → `activeHint = _lastHint.asReadonly()` capture la
   valeur courante.
5. Cas problématique : seek atterrit pile sur un nav entry dont le
   SELECT_* est précédé d'un MSG_HINT.
   - Seek wipe `_lastHint` ligne 418.
   - Cursor saute à `entry.messageOffset` (l'offset du SELECT_*, pas
     du MSG_HINT antérieur).
   - `dispatchNext` dispatch SELECT_* → `pendingPrompt.set(...)` →
     `activeHint` reste `null`.
6. `pvp-prompt-dialog.component.ts` consomme `hintContext` (grep
   confirmé : 2 fichiers prompt-dialog). Le header du prompt sera
   donc vide post-seek mid-prompt vs rempli en lecture séquentielle.

**Fix possible** : à `seekToOffset`, AVANT de saute le cursor,
rewinder dans `_messages[]` depuis l'offset cible vers l'arrière
pour trouver le dernier MSG_HINT non encore consommé et le rejouer.
Ou : capturer le hint sur le `ReplayStreamNavEntry` côté précompute
(`navEntry.hint?: HintContext`) et le restaurer à `seekToOffset`.

### F9 — Seek out-of-range silencieux + désynchro UI → **CONFIRMÉ**

**Statut** : bug runtime confirmé. Sévérité MEDIUM (UI désynchro
visible).

**Chaîne de preuve** :

1. `ReplayTransportService.jumpTo(index)` lignes 102-114 :
   - ligne 105 : `this.currentIndex.set(index);` — modifié inconditionnellement.
   - ligne 113 : `this.getCfg().mockConn.seekToOffset(index);` — peut no-op.
2. `mockConn.seekToOffset` ligne 386-390 : si `index < 0 || index >= nav.length`,
   log + return silencieusement.
3. Le commentaire jumpTo ligne 100 promet "bounds-check on the *high*
   end is enforced by the caller (out-of-range index simply leaves the
   rendered state at the last known step)". Mais aucun caller ne fait
   ce check : `onSeek(index)` / `onScrub(index)` ligne 974-975 →
   `transport.seek(index)` → `jumpTo(index)` direct, pas de bound.

**Cas pratiques** :
- (a) stream pas encore chargé jusqu'à l'index ciblé (course condition
  démarrage replay).
- (b) clic sur sub-event au-delà de `computedUpTo` (UI possible si le
  picker affiche des positions futures).

**Symptôme** : `currentIndex` UI affiche N, board figé sur N-1 ou
ancien index. Pas de log error UI-visible.

**Fix possible** : `jumpTo` swap l'ordre — vérifier si nav contient
l'index AVANT de set `currentIndex` :
```ts
const nav = this.getCfg().mockConn.navIndex();
if (index >= nav.length) {
  // log + bail without touching currentIndex
  return;
}
this.currentIndex.set(index);
this.getCfg().mockConn.seekToOffset(index);
```

### F11 — Cursor advance sur MSG_HINT → **INVALIDÉ (vérifié OK)**

**Statut** : pas un bug. L'analyse a survi vérification.

**Raisonnement complet** :

Côté précompute, `lastSelectOffset` ([replay-precompute.ts:519-525](duel-server/src/replay-precompute.ts#L519-L525))
n'est mis à jour QUE si `PROMPT_TYPES_STREAM.has(msg.type)`. MSG_HINT
n'est PAS dans `PROMPT_TYPES_STREAM` (line 81-88 — uniquement SELECT_*
/ SORT_* / ANNOUNCE_*). Donc le MSG_HINT n'écrase pas
`lastSelectOffset` ; le SELECT_* suivant écrasera bien avec son
propre offset global.

Côté client mock, `_autoResponses` Map keyed by offset GLOBAL. Le
transport `schedulePromptDismiss` lit `getAutoResponseAt(cursor - 1)`
APRÈS le dispatch du SELECT_* — à ce moment cursor pointe sur
`offset_SELECT + 1`, donc `cursor - 1 = offset_SELECT` match
exactement.

Séquences testées par lecture :
- `[MSG_HINT, SELECT_CARD]` ✓ (cursor=N+2 après SELECT, lookup à N+1 = SELECT)
- `[SELECT_CARD, MSG_HINT]` impossible — la précompute ingère MSG_HINT
  AVANT le SELECT_* auquel il s'applique (chronologie OCG).

**Pas d'action requise**. Retirer F11 du backlog.

### F12 — `cleanup()` mock partiel ET jamais appelé en production → **AGGRAVÉ**

**Statut** : bug confirmé + nouveau finding additionnel. Sévérité
MEDIUM (memory leak potentiel sur navigation).

**Chaîne de preuve** :

1. Partie originale : `mockConn.cleanup()` ligne 425-427 fait
   seulement `this.rbs.destroy()`. NE clear PAS `_messages`,
   `_autoResponses`, `_transport_navIndex`, `_transport_messageCursor`,
   `_transport_lastHint`, `_transport_lastConfirmedCards`,
   `pendingPrompt`, `_totalMessages`.
2. **Nouveau** : grep `mockConn\.cleanup|this\.cleanup` dans
   `front/src/app/pages/pvp/replay/` :
   - 0 match dans `replay-page.component.ts` ngOnDestroy.
   - Seuls les `mock-duel-connection.spec.ts` appellent `cleanup()`.
3. `replay-page.ngOnDestroy()` ([replay-page.component.ts:941-946](front/src/app/pages/pvp/replay/replay-page.component.ts#L941-L946))
   appelle `this.transport.destroy()`, `this.abortAndClean()`,
   `this.orchestrator.destroy()`, `this.fork.cleanup()`,
   `this.replayConnection.disconnect()` — **PAS** `this.mockConn.cleanup()`.

**Conséquence runtime** :
- Le `RenderedBoardStateService` du mock n'est jamais détruit
  explicitement. **Vérifié** : `destroy()` ([rendered-board-state.service.ts:565-567](front/src/app/pages/pvp/duel-page/rendered-board-state.service.ts#L565-L567))
  fait seulement `this.commitAll()` — pas de listener global,
  pas d'`addEventListener`. Donc Angular GC propre, **pas de memory
  leak réel**. La sévérité du finding tombe à LOW.
- La dette persiste : `cleanup()` documenté comme point d'entrée
  ("Safe to call multiple times") mais 0 appel en production = dead
  promise. Phase 7.5 fork-solo round-trip (spec ligne 290) le réveille
  potentiellement parce qu'un swap `mockConn ↔ realConn` sans
  cleanup du buffer mock laisse l'ancien stream actif.
- Navigation hors viewer → revenir = nouvelle instance mock (provider
  scope) ; pas de pollution stream-à-stream pour le scope actuel.

**Fix minimal** : ajouter `this.mockConn.cleanup();` dans
`replay-page.ngOnDestroy()`, completer `cleanup()` pour clear tout le
state (buffer, signals, cursor, totalMessages).

### F14 — `REPLAY_IGNORED_TYPES` non couvert → **CONFIRMÉ**

**Statut** : dette de test confirmée. Sévérité LOW (régression future
silencieuse possible).

**Vérification** : grep `REPLAY_IGNORED_TYPES|REMATCH_|OPPONENT_|INACTIVITY|TIMER_STATE`
sur `duel-server/src/replay-precompute.spec.ts` → 0 match.

Aucun test n'asserte que la précompute n'émet PAS les types dans
`REPLAY_IGNORED_TYPES`. Si demain un dev ajoute une émission de
`INACTIVITY_WARNING` dans la précompute (légitime ou pas), le mock le
skip silencieusement sans warn (parce qu'il est dans le set ignoré).

**Fix** : ajouter test `replay-precompute.spec.ts` : "stream ne contient
aucun des types listés dans `REPLAY_IGNORED_TYPES`". Le set côté mock
+ le set côté précompute test sont DEUX listes — la doctrine "Replay =
PvP readonly" doit garantir leur disjonction.

---

## Findings AFFAIBLIS par vérification (traçabilité)

### F8 — Doctrine F29 "forceClosure asymmétrie"

**Statut** : reformulée, pas un risque actif. Garder comme dette de
doc mineure (pas de gate automatisé).

Le spec ligne 217 dit "Retirer la doctrine F29". CLAUDE.md actuel
préserve la doctrine F29 reformulée — la justification ("the journal
would only see those closures briefly because gameLog is fully wiped +
rebuilt the same tick") est valide tant que le rebuild journal au seek
reste en place. Pas de bug.

### F10 — `REPLAY_PROMPT_DELAY_MS = 1200ms` vs métaphore "max-rate"

**Statut** : ambiguïté doctrinale acceptable.

La métaphore CLAUDE.md "max rate" parle de "client = source du minimum
tempo" — 1200ms est en pratique la borne inf imposée par UX (lisibilité
du prompt), cohérent avec la formulation. Le spec Décision 1 (ligne 60-61)
acte le choix. Pas de bug.

### F15 — `_postRequestStopWindow` couplage mock

**Statut** : invariant préservé par chemin alternatif.

La page appelle `orchestrator.resetForReplaySeek` → `clearTimersAndPolling`
→ `runner.requestStop` côté orchestrator, indépendamment du mock. Le
`_postRequestStopWindow` est armé par cette voie. Le mock n'a pas
besoin de `requestStop`. Pas de bug.

### F16 — `simulatePlayerResponse({ promptType: 'UNKNOWN' })` fallback

**Statut** : code defensive mineur, pas un bug.

Le fallback ([replay-transport.service.ts:371](front/src/app/pages/pvp/replay/replay-transport.service.ts#L371))
clear seulement `pendingPrompt` + accumulators. Aucun consommateur
n'écoute `promptType: 'UNKNOWN'` pour brancher dessus. Renommer en
`dismissPendingPrompt()` serait propre mais ce n'est pas un bug.

### F17 — Pas de test pour la fix F9-bis "defensive shallow copy"

**Statut** : risk OK, dette de test mineure.

Le bug original (shared array reference) est corrigé. Le risque
"futur refactor inline le spread" est réel mais faible (le commentaire
explicatif `F9-bis bug fix (2026-06-04)` est dissuasif). Un test pin
serait propre mais non bloquant.

### F18 — Effort estimé non audité vs réel

**Statut** : pas un finding code, observation méta.

Le spec a livré 1-5 + 6 en `9cb713a6` + `e9258474`. Pas de moyen de
mesurer l'écart d'effort sans données. Pas un blocker.

### F19 — "STRICTEMENT le même pipeline" est factuellement faux

**Statut** : reformulation requise mais pas un bug.

Le spec ligne 33-34 est trop affirmatif (le mock skip 17 types + N
surfaces PvP-only). Plus exact : "modulo les surfaces hors-mode-replay".
La liste explicite des surfaces volontairement absentes serait propre.
Pas un bug runtime.

---

## Priorisation des actions (mise à jour après vérification)

### P0 — Bugs runtime à fixer avant tout autre travail v4

1. **F1** — Fix toggle perspective via Option B (collapse à une seule
   source). Résout F6 simultanément. **Sévérité HIGH**.
2. **F2 + F4** — Dispatch MSG_WIN dans le mock + `forceBoundaryClosure('DuelEnded')`.
   **Sévérité HIGH**.
3. **F3** — Brancher `syncAfterBoardState` dans `mock._handleBoardState`,
   retirer le commentaire "Phase 1 — Phase 3 will re-introduce".
   **Sévérité MEDIUM-HIGH**.

### P1 — Bugs runtime confirmés à fixer ensuite

4. **F7** — MSG_HINT non restauré au seek mid-prompt. **Sévérité MEDIUM**.
   Fix : capturer hint sur `ReplayStreamNavEntry` côté précompute, le
   restaurer à `seekToOffset`.
5. **F9** — Seek out-of-range désynchro UI. **Sévérité MEDIUM**.
   Fix : swap l'ordre dans `jumpTo` (bounds-check avant
   `currentIndex.set`).
### P2 — Documentation / dette de test

6. **F5** — Documenter les 2 divergences Phase 0 (TurnStarted/PhaseStarted
   dupliqués, MSG_DRAW asymétriques) + statut dans le spec. Bonus :
   investiguer le duplicate boundary sur la trace 18a55f97 pour
   trancher entre asymmetry doctrinale et vrai bug.
7. **F12** — `mockConn.cleanup()` jamais appelé + incomplet. **Sévérité
   LOW** (pas de leak réel — `RenderedBoardStateService.destroy` est
   trivial, vérifié). Fix opportuniste : appeler dans
   `replay-page.ngOnDestroy` + completer le clear pour préparer
   Phase 7.5 fork-solo transition.
8. **F14** — Ajouter test "stream sans `REPLAY_IGNORED_TYPES`" côté
   `replay-precompute.spec.ts`.

### P3 — Cleanup / dette architecturale

9. **F13** — Déplacer `loadStream` dans `__test__`.
10. **F20** — Décider : extraire `IDataConnection` formelle ou acter
    le couplage par-name.
11. **F19** — Reformuler "STRICTEMENT le même" en "modulo les surfaces
    hors-mode-replay" + liste explicite.

### Classés sans action

- **F11** — Vérifié OK (analyse mécanique survi vérification).
- **F8, F10, F15, F16, F17, F18** — Affaiblis, traçabilité seulement
  (voir section "Findings AFFAIBLIS").

---

## Liens

- Spec v4 : [anim-pipeline-v4-replay-unification-2026-06-05.md](anim-pipeline-v4-replay-unification-2026-06-05.md)
- Spec parité Phase 0 : [pvp-replay-event-stream-parity-spec-2026-06-05.md](pvp-replay-event-stream-parity-spec-2026-06-05.md)
- Inventaire pré-Phase 1 : [replay-adapter-inventory-2026-06-05.md](replay-adapter-inventory-2026-06-05.md)
- CLAUDE.md sections concernées : "Replay = PvP readonly via MockDuelConnection",
  "Perspective Convention", "syncAfterBoardState Sync Tiers",
  "EventStream vs AnimationQueue", "Doctrine 3-bis — Dual-purpose signal".
- Memory déclarative : `anim-pipeline-v4-phase-0-landed-2026-06-05`,
  `anim-pipeline-v4-replay-unification-2026-06-05`.
