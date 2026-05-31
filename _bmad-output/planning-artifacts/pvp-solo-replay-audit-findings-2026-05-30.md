# Audit PvP / SOLO / Replay — Findings à refiner

> **État : DRAFT — à refiner avec Axel.**
> Date : 2026-05-30. Branche : `feat/anim-pipeline-v2`.
> Scope : pipeline d'animation PvP / SOLO multiplex / Replay
> (`front/src/app/pages/pvp/` + `duel-server/src/`).
> Méthode : exploration multi-agents (transport, SOLO, replay, serveur,
> orchestrateur, wiring) puis chasse multi-axes (duplication, parités
> fragiles, logiques étranges, bugs SOLO/perspective, faiblesses serveur,
> invariants chaîne/lock/queue).

Légende sévérité : 🔴 immédiat · 🟠 confirmé/préoccupant · ⚠️ parité fragile ·
🔁 duplication · 🧩 dette load-bearing · ✅ fausse alerte.

Colonne **Décision** à remplir ensemble : `FIX` / `BACKLOG` / `WONTFIX` /
`INVESTIGATE` / `DOC-ONLY`.

---

## 🔴 Action immédiate

### F1 — `console.log` de debug échappés sur le chemin prompt — ✅ FIX (2026-05-30)
- **Constat vérifié** : le `[FLOAT-PROBE]` original (`animation-orchestrator.service.ts:537`)
  avait DÉJÀ été nettoyé entre l'audit et la vérif. Mais 4 vrais probes
  subsistaient :
  - `duel-connection.ts:937-953` — bloc `R8-PROBE` marqué littéralement
    « TO REMOVE before merging Commit 0bis » (champ `_r8Probe` front-only, mort
    côté serveur).
  - `prompt-card-grid.component.ts:102,623` + le `[SELECT_TRIBUTE]` ×2 — fire à
    chaque rendu/confirm de prompt, en prod, non gardés.
  - `pvp-prompt-dialog.component.ts:344` (debug) + `:374` (warn unresolved hint).
- **Décision appliquée** :
  - **Option 1 (suppression)** du `R8-PROBE` + retrait import `MoveMsg` orphelin.
  - **Conversion DuelLogger PIPELINE** des logs prompt (debug → `log(PIPELINE)`,
    le warn « unresolved hint » → `duelLogger.warn` car anomalie réelle).
- **Vérif** : `tsc --noEmit -p tsconfig.app.json` vert. `DuelLogger` confirmé
  providé sur duel-page ET replay-page (injection safe dans les deux contextes).
- **Statut** : DONE.

### F2 — `sanitizeBoardState` fail-OPEN sur zones inconnues + BANISHED face-down — ✅ FIX (2026-05-30)
- **Constat vérifié** : `ZoneId` est une union FERMÉE et le switch couvre déjà
  toutes ses valeurs → le `default: return zone` était **mort aujourd'hui**
  mais constituait un default-OPEN latent : un futur `ZoneId` ajouté à l'union
  n'était PAS forcé dans le switch (TS ne cassait pas) → fuite silencieuse.
- **Sous-finding confirmé (Axel)** : `BANISHED` faisait `return zone` sans
  masquer les cartes bannies **face-down** — or une carte peut être bannie face
  cachée (Gold Sarcophagus, D.D. Capsule, …) et seul le possesseur doit la voir.
- **Décision appliquée** :
  - `default` → **fail-closed** + exhaustiveness `const _exhaustive: never =
    zone.zoneId` (tsc casse le build si un `ZoneId` est ajouté sans case) ;
    fallback runtime masque les face-down.
  - `BANISHED` → `sanitizeFaceDownCard` sur chaque carte (face-up visible,
    face-down masquée côté adversaire ; le possesseur voit son board
    non-sanitizé donc voit les siennes).
  - `GY` reste `return zone` pur (jamais de face-down au GY).
- **Tests** : 2 nouveaux (`HIDE opponent face-down banished` + `owner sees own
  face-down banished`), ancien renommé « face-up BANISHED ». 270/270 vitest
  verts, tsc vert.
- **Statut** : DONE.

---

## 🟠 Bugs confirmés / architecture préoccupante

### F3 — `switchPerspective` SOLO non bloqué pendant board instable — ✅ FIX (2026-05-30)
- **Constat vérifié** : `switchPerspective` ne bloquait que sur prompt modal +
  draw-in-flight. Confirmé par le commentaire de `notifyPerspectiveSwitch`
  (`animation-orchestrator.service.ts:1088-1099`) : un switch NE reset PAS le
  `DuelEventProcessor` (chainPhase/buffer) ni les locks RBS
  (CONNECTION_LIFETIME) mais swappe + re-render le board → asymétrie →
  locks HAND-0/GY-0 orphelins → LOCK_SAFETY_TIMEOUT + POLL-DROP.
- **Affinement (Axel)** : `chainPhase` est l'horloge ANIMATION (pas serveur :
  `applyChainEnd` flippe `idle` quand l'orchestrateur dépile MSG_CHAIN_END de
  la queue, pas à la réception serveur). MAIS `chainPhase === 'idle'` peut
  coexister avec des locks/queue résiduels (`CHAIN_END_SETTLE_MS` + drain).
  → la garde doit couvrir AUSSI ce cas. `isAnimating` subsume `hasLockedZones`
  (finalizeAndCommit AVANT setRunning(false), invariant CLAUDE.md) et est
  réactif (contrairement à `hasLockedZones`/`hasDrawsInFlight` non-réactifs).
- **Décision appliquée** :
  - `AnimationOrchestratorService.isBoardStableForSwitch` = getter réactif
    (`chainPhase()==='idle' && !isAnimating.value()`).
  - `SoloDuelOrchestratorService.canSwitchPerspective` = getter composite
    (prompt modal OK + pas de draw + board stable) — **source unique** pour la
    garde ET l'UX.
  - `switchPerspective` : gardes inline remplacées par
    `if (!canSwitchPerspective) { log; return; }`.
  - **UX** : bouton `[disabled]="!canSwitchPerspective"`, glow conditionné
    `waitingForOpponentOnOtherSlot() && canSwitchPerspective` (pas de glow si
    on ne peut pas switcher), 3ᵉ aria-label `switchPlayerUnavailable` (FR+EN),
    SCSS `&:disabled` DS-conforme (`--opacity-disabled`, `cursor:not-allowed`).
- **Point UX résolu (Axel)** : le bouton n'avait AUCUN `[disabled]` → le user
  cliquait dans le vide + faux feedback `switching=true`. Désormais grisé.
- **Sous-point vérifié** : le glow s'allume bien quand l'AUTRE slot
  (adversaire) a un prompt (`waitingForOpponentOnOtherSlot` lit `other` slot) —
  **déjà correct**, pas de fix nécessaire.
- **T-F6 (option 1)** : le test « chain survives switch » (invariant cardinal
  γ = robustesse transport) stubbe `isBoardStableForSwitch=true` pour forcer le
  switch mid-chain. La garde F3 (UX) et l'invariant γ (transport) sont
  complémentaires : la garde empêche le USER de déclencher, l'invariant
  garantit qu'aucune désync n'arrive si un switch atteint le processor.
- **Tests** : +5 cas `γ F3 — board-stability guard` (block board instable /
  draw / re-allow / prompt / stable), 1 assertion log mise à jour. 20/20
  phase-gamma + 41/41 duel-page verts. tsc app+spec + stylelint verts.
- **Statut** : DONE.

### F4 — `sendAnimationsDone` A37 : triangulation 3-niveaux → mauvais joueur possible
- **Lieu** : `duel-web-socket.service.ts:380-382`
- **Constat** : `lastSentForPlayer ?? timerState.pendingPlayer ?? perspective()`.
  Les 3 sources peuvent légitimement diverger ; à l'émission il n'y a aucune
  source autoritaire de « quelle identité SOLO vient de finir d'animer ».
- **Risque** : mauvais pick → gate serveur (`ctx.pendingPlayer === playerIndex`)
  no-op silencieux → timer de tour jamais libéré. Load-bearing, SOLO-only.
- **Fix de fond** : l'orchestrateur doit savoir quelles animations il vient de
  drainer (pas trianguler après coup).
- **Décision** :

### F5 — fork-solo vs SOLO multiplex : deux mécanismes divergents + `soloMode` surchargé — ✅ FIX partiel (2026-05-31)
- **Lieu** : `fork-handlers.ts` (setupForkWorkerHandlers) vs
  `worker-message-router.ts:311` (broadcastMessage SOLO branch)
- **Constat** : les deux posent `session.soloMode = true` mais routent
  différemment (1 socket vs 2, `broadcastMessage` vs handler bespoke).
  `setupForkWorkerHandlers` réimplémente partiellement `broadcastMessage` et a
  dérivé : omet `ingestIntoSessionGameLog` (le `gameLog` alloué
  `fork-handlers.ts:113` n'est jamais nourri = allocation morte),
  `applyChainTransition`, et `winReasonCode` sur MSG_WIN.
- **Risque** : `soloMode` = deux contrats de routing selon les handlers
  attachés. Toute évolution de `broadcastMessage` ne se propage pas à fork-solo.
- **Sévérité** : MEDIUM (hazard de maintenance + gameLog mort).
- **Décision appliquée (Option C)** : copier les 4 bits manqués dans
  `setupForkWorkerHandlers` :
  1. `ingestIntoSessionGameLog` — le gameLog allocation ligne 113 est
     désormais nourrie → journal repopulé sur F5 mid-fork.
  2. `applyChainTransition` — l'état chaîne côté serveur s'accumule
     identiquement à SOLO multiplex → reconnect path peut ré-émettre
     CHAIN_STATE.
  3. `winReasonCode` sur MSG_WIN → DUEL_END → UX win-reason localisée
     identiquement à SOLO multiplex.
  4. `MSG_CONFIRM_CARDS chainIndex tag` → filter prompt reveals par link
     côté client.
- **Commit en sync** : un commentaire "KEEP IN SYNC WITH `broadcastMessage`
  until F5-bis lands" marque les 4 bits. La dette de fond (2 paths
  parallèles) est tracée dans F5-bis ci-dessous.
- **Tests** : 1615/1615 vitest duel-server verts.
- **Statut** : FIX partiel — la divergence structurelle reste, voir F5-bis.

### F5-bis — unifier fork-solo dans le pattern SOLO multiplex (refonte architecturale)
- **Origine** : F5 a corrigé les 4 omissions immédiates, mais la dette
  de fond reste : deux mécanismes parallèles avec `setupForkWorkerHandlers`
  qui réimplémente une logique parallèle à `broadcastMessage`. Toute
  évolution future de `broadcastMessage` doit être mirrorée à la main.
- **Cible** : collapser fork-solo dans le pattern SOLO multiplex (1
  socket, multiplexing via `forPlayer` tag, `attachWorkerHandlers`
  partagé avec un flag `forkMode` qui skip cancel/timer/etc.).
- **Coût estimé** : 1-2 demi-journées, touche ~10-15 fichiers :
  - Backend : `createForkSoloSession` retourne 1 token au lieu de 2 ;
    `attachWorkerHandlers` accepte un `forkMode: boolean` ; retirer
    `setupForkWorkerHandlers` ; le flag dispatche conditionnellement
    cancel/timer/cancelTargetPrompt côté `broadcastMessage`.
  - Frontend : retirer la branche fork-solo de `duel-page.component.ts`
    qui consomme `wsToken2` ; `solo-mode-effects.service.ts initFork`
    aligne avec `initSolo`.
  - Tests : MAJ des specs front + e2e qui ont des wsToken2 / fork-solo
    paths.
- **Bénéfice** : élimine la classe de bug "fork-solo dérive de SOLO
  multiplex" par construction. Un seul code path = une seule maintenance.
- **Risque** : régression sur le flux fork-solo (mode user-facing
  existant). Refactor end-to-end qui mérite sa propre session dédiée
  avec test e2e Playwright complémentaire.
- **Sévérité** : MEDIUM (dette architecturale).
- **Décision** : BACKLOG. À planifier comme chantier dédié quand la
  priorité audit principale sera close.

---

## ⚠️ Parités fragiles (sync par convention, pas par type/test)

### F6 — Convention Perspective (absolu vs relatif) — la plus fragile — ✅ FIX (2026-05-31)
- **Lieu** : `message-filter.ts:247` (TODO Story 4.2) ; idiome copié-collé ~11
  sites ; suspect : `target-indicator-manager.ts:59` (inline ternaire) vs
  `battle-animation-tracker.ts:50` (`ctx.relativePlayer()`).
- **Constat** : relativisation serveur PARTIELLE (`sanitizeBoardState` swappe
  `players[]`+`turnPlayer`, PAS les `player`/`controller` dans cartes/zones/
  chain-links/prompts). Restent absolus : `LinkedCardRef.controller`,
  `CardInfo.player`, `PlaceOption.player`, `HintContext.player` (mort). Swap
  replay aussi partiel (`swapBoardState` + `swapEventBoardStates` seulement).
- **Enforcement** : aucune vérif machine (`check-perspective-isolation.mjs` ne
  vérifie qu'un truc étroit : caller unique de `notifyPerspectiveSwitch`).
  Seule la connaissance du reviewer protège.
- **Risque** : tout nouveau builder `${zoneId}-${X}` lisant `controller`/`player`
  sans `=== ownPlayerIndex` → board flippé. Classe de bug
  `perspective-bug-hunt-2026-05-20`.
- **Catégorisation des sites (issue de l'investigation)** :
  · 8 sites = vraies conversions absolu→relatif pour construire des zone keys.
    Tous refactorés vers `ctx.relativePlayer()` ci-dessous.
  · ~7 sites = tests booléens "is mine" (`player === ownIdx` sans
    `? 0 : 1`) — légitimes inline, pas une conversion.
  · ~5 sites = inversion relatif→opposé (`mySide() === 0 ? 1 : 0`) ou
    relatif→absolu (`absoluteTurnPlayer`) — sémantique orthogonale,
    pas refactorables vers `ctx.relativePlayer`.
  · Utility functions pures avec `ownPlayerIndex` en param (chain-badge.utils) —
    absolute-agnostic by design.
- **Décision** : **FIX unifié sur 8 sites** (refactor minimal des sites
  qui font vraiment de la conversion absolu→relatif, scope animation
  pipeline + replay) :
  · [target-indicator-manager.ts:82](front/src/app/pages/pvp/duel-page/target-indicator-manager.ts#L82) → `this.ctx.relativePlayer(target.player)`
  · [duel-page.component.ts:988](front/src/app/pages/pvp/duel-page/duel-page.component.ts#L988) → `this.duelCtx.relativePlayer(c.player)`
  · [duel-page.component.ts:1093](front/src/app/pages/pvp/duel-page/duel-page.component.ts#L1093) → `this.duelCtx.relativePlayer(pl.player)`
  · [pvp-board-container.component.ts:348](front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts#L348) → `this.toRelativePlayer(link.controller)` (nouveau helper privé qui inject DuelContext optional + fallback sur input idiom pour preview specs)
  · [pvp-board-container.component.ts:555](front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts#L555) → `this.toRelativePlayer(link.player)`
  · [replay-page.component.ts:257](front/src/app/pages/pvp/replay/replay-page.component.ts#L257) → `this.duelCtx.relativePlayer(pl.player)`
  · [replay-page.component.ts:272](front/src/app/pages/pvp/replay/replay-page.component.ts#L272) → `this.duelCtx.relativePlayer(place.player)`
  · [prompt-derivation.service.ts:121](front/src/app/pages/pvp/duel-page/prompt-derivation.service.ts#L121) — laissé inline (pattern two-phase init par closures, pas DI) avec commentaire-pointeur expliquant la doctrine : si un 2e site arrive, ajouter `relativePlayer: (abs) => 0 | 1` au config.
- **Pivot architectural** : `pvp-board-container` injecte maintenant
  `DuelContext` en `{ optional: true }` — préserve l'embeddabilité
  preview hors-duel (le composant continue de marcher sans DuelContext
  provider via le fallback input idiom). Pattern confirmé par le
  même `inject(DuelLogger, { optional: true })` déjà en place.
- **Doctrine** : section CLAUDE.md "Relativizer routing discipline (F6)"
  qui liste les 8 sites refactorés + tous les sites intentionnellement
  laissés inline avec leur justification.
- **Tests** : tsc green. Karma 162/162 pass sur les 4 specs
  touchées (target-indicator + board-container + duel-page + prompt-
  derivation + replay-page).
- **Statut** : DONE.

### F7 — Sync protocole WS front↔back : script existe mais trou CI
- **Lieu** : `scripts/check-ws-protocol-sync.mjs`, `duel-server/package.json:10`
  (prebuild), `scripts/hooks/pre-commit`
- **Constat** : byte-compare 9 fichiers, mais lancé UNIQUEMENT par le prebuild
  duel-server. Pas de CI (aucun `.github/`). Le hook pré-commit ne lance que
  stylelint/ESLint sur `front/`. `ng build` front aveugle. Un commit qui édite
  SEULEMENT un `front/duel-ws-*.types.ts` passe et reste divergent jusqu'au
  prochain build duel-server. Barrels (`ws-protocol.ts`/`duel-ws.types.ts`)
  NON byte-checkés → dérive silencieuse possible.
- **Fix proposé** : câbler le check en pré-commit (ou CI front).
- **Décision** :

### F8 — 3ᵉ ensemble non-synchronisé : `GAME_EVENT_TYPES ⊇ BOARD_CHANGING_EVENT_TYPES`
- **Lieu** : `duel-event-processor.ts:12`
- **Constat** : `GAME_EVENT_TYPES` (superset, gate l'enqueue) séparé de
  `BOARD_CHANGING_EVENT_TYPES` (byte-syncé). Aucun test ni commentaire ne lie
  les deux.
- **Risque** : ajouter un type board-changing sans l'ajouter à
  `GAME_EVENT_TYPES` → event bufferisé par `bufferIfResolving` puis droppé par
  `enqueue` avec simple `logger.warn` → perte d'animation silencieuse pendant
  résolution.
- **Fix proposé** : test d'invariant `GAME_EVENT_TYPES ⊇ BOARD_CHANGING_EVENT_TYPES`.
- **Décision** :

### F9 — Machine chainPhase client `DuelEventProcessor` vs serveur `ChainStateTracker` — ✅ DOC-ONLY (2026-05-31)
- **Lieu** : `duel-event-processor.ts:136-184,209-244` vs
  `chain-state-tracker.ts:52-69`
- **Constat** : transitions matchent aujourd'hui mais rien ne les cross-check.
  Client splitte la machine (`building` sync dans processor, `resolving`/`idle`
  pilotés par orchestrateur) ; serveur fait tout dans une fonction pure.
- **Risque** : évolution d'un côté désync le handshake de reconnect mid-chaîne
  — détecté seulement au runtime sur un reconnect.
- **Investigation Option B (Karma front + import serveur)** : impossible
  sans casser l'isolation front↔serveur enforced par `check-ws-protocol-sync.mjs`
  — pas d'alias TS vers `duel-server/`. Trois sous-variantes envisagées
  (copier le tracker dans front, import relatif, ré-implémenter inline)
  toutes plus lourdes que le gain.
- **Décision** : **DOC-ONLY**. Section CLAUDE.md "Cross-side `chainPhase`
  parity (F9)" qui :
  · pose l'invariant "les 2 machines doivent matcher aux frontières"
  · liste la transition matrix (5 messages × 2 côtés)
  · documente l'asymétrie intentionnelle (server = wire state, client =
    animation state) + le window borné
  · pointe les 2 specs existantes comme gates par-côté (pas de cross-check)
  · pointe les 2 risques (drift sur reconnect, détection runtime only)
  Commentaires-pointeurs ajoutés dans les 2 fichiers (`chain-state-tracker.ts`
  + `duel-event-processor.ts`) qui pointent vers la section CLAUDE.md.
- **Statut** : DONE.

### F10 — `ChainSnapshotTracker` parité PvP↔Replay : bien enforced sauf BOARD_STATE intermédiaire — ✅ DOC-ONLY (2026-05-31)
- **Lieu** : `chain-snapshot-tracker.ts` (partagé, OK) ;
  `duel-worker.ts:1350-1354` (BOARD_STATE intermédiaire pré-chain-solving sur
  `hasCostMoves`) SANS équivalent dans `replay-precompute.ts`
- **Constat** : la classe partagée garantit prédicat/flag/champ identiques. Mais
  le BOARD_STATE intermédiaire n'existe qu'en PvP ; replay s'appuie sur
  `boardStateAfter` + `replayBuffer` client. Chaque call-site écrit
  indépendamment le closure `() => buildBoardState().data`.
- **Risque** : si le client (DEP β.2 cost-before-overlay) suppose l'existence du
  BOARD_STATE intermédiaire, divergence de timing replay vs PvP. Lien memo
  `faimena-activate-cost-overlap-2026-05-24`.
- **Investigation** : les 2 modes ont en réalité **un sync intermédiaire
  fonctionnellement équivalent**, via 2 mécanismes différents :
  · PvP — BOARD_STATE explicite émis avant MSG_CHAIN_SOLVING quand
    `hasCostMoves`.
  · Replay — segmentation du PreComputedState sur MSG_CHAINING
    (`replay-precompute.ts:394-399`), qui capture un boardState
    post-cost via `buildBoardState()` au moment du flush.
  Différence d'ordre vs MSG_CHAINING (PvP after, replay before) → tier
  de sync différent (3 vs 2) mais effet pratique équivalent (DECK/EXTRA
  pile counts + metadata à jour avant resolving). La DEP β.2 cost-
  before-overlay regarde `AnimationCompleted` du MSG_MOVE, pas le board
  intermédiaire — pas concernée par cet ordre.
- **Investigation Option 2 (light gate cross-loop)** : `runDuelLoop`
  n'est pas exportée (privée, depend de variables module-scope, watchdog
  `process.exit`). Pas testable en isolation sans refactor invasif
  (Option 4 / extraction) qu'Axel a déjà écarté pour ne pas introduire
  un state "Chain Cost" visible dans le timeline replay.
- **Décision** : **DOC-ONLY**. Section CLAUDE.md "Intermediate post-cost
  board sync (F10)" qui :
  · documente les 2 mécanismes en détail (PvP BOARD_STATE explicit vs
    replay PreComputedState segmenté sur MSG_CHAINING)
  · explique la différence d'ordre vs MSG_CHAINING (tier 3 vs tier 2)
  · pose la parité de fait et pourquoi elle marche (cost moves commit
    leurs zones via le handler, la DEP regarde AnimationCompleted)
  · liste les 2 modes de régression possibles (split serveur sans MAJ
    replay ; nouveau consommateur qui branche sur chainPhase au sync)
  · note la décision Axel "pas de state 'Chain Cost' user-visible dans
    le timeline replay" — si fix structurel un jour, hoister la logique
    dans une utility partagée, pas dupliquer le message PvP en replay
  Commentaires-pointeurs ajoutés dans les 2 call-sites (`duel-worker.ts`
  + `replay-precompute.ts`) qui pointent vers la section CLAUDE.md.
- **Statut** : DONE.

---

## 🔁 Duplications de code

### F11 — `attachEventStream` : duplication exacte du drain loop (déjà flaggée CLAUDE.md)
- **Lieu** : `base-projection.ts:117-144` (`_transport_streamConsumedLength`)
  vs `duel-game-log.service.ts:336-358` (`_streamConsumedLength`)
- **Constat** : drain incrémental byte-identique (même garde de régression,
  même boucle, même re-attach guard) — divergent seulement par préfixe de champ
  + callback. Point de sync UNIQUE alimentant journal + 8 projections.
- **Risque** : un fix sur une copie ne touche pas l'autre → journal et
  projections pourraient diverger sur les events consommés.
- **Fix proposé** : extraire `drainStream(stream, cursor, consume, injector)`.
- **Décision** :

### F12 — `TargetIndicatorManager` hors pattern `ResetTarget`/dispatcher
- **Lieu** : `target-indicator-manager.ts:132-152`
- **Constat** : `reset()`/`cleanup()` manuel au lieu de `applyReset(scopes)`,
  ne s'enregistre pas auprès du `ScopeResetDispatcher`. Son pendant FIELD
  `TargetedZoneKeysProjection` est une vraie projection → reset de
  MSG_BECOME_TARGET splitté sur deux disciplines.
- **Risque** : sur switch SOLO, dispatcher clear réticules FIELD mais pas les
  pile floats du manager. Si l'orchestrateur cesse un jour d'appeler `reset()`
  explicitement → fuite de floats à travers le switch.
- **Note voisine** : trick `set(null); set(key)` (anti-dedup Object.is) dupliqué
  `counter-pulse.projection.ts:81-82` + `swap-grave-deck.projection.ts:79-80`.
- **Décision** :

---

## 🧩 Logiques étranges / dette acceptée (load-bearing)

### F13 — `_innerLoopDepth` défendu sur 3 côtés (cicatrice infinite-rescue)
- **Lieu** : `queue-runner.ts:362` (zero-on-reset), `:455-461` (assert),
  `:573` (`Math.max(0,…)` floor)
- **Constat** : triple défense = tell que increment/decrement ne pairent pas à
  travers les resets. Survit en doublon de l'AbortController (palier C) qui
  devait le rendre inutile.
- **Load-bearing** : le floor OUI (sans lui, loop suspendu drive négatif →
  assert throw → infinite-rescue original).
- **Action possible** : passe de simplification maintenant que AbortController
  existe.
- **Décision** :

### F14 — Gap STATE_SYNC↔CHAIN_STATE gardé par un assert wall-clock
- **Lieu** : `duel-connection.ts:1035-1040`
- **Constat** : `duelAssert(sinceSync < 1000ms)` — seuil wall-clock magique
  remplaçant une garantie d'ordre que le transport ne fait pas. Si TCP/proxy
  splitte les 2 messages >1s, `processor.reset()` du STATE_SYNC retardé wipe la
  chaîne restaurée. En prod l'assert ne fait que `console.error` puis continue
  avec état chaîne corrompu.
- **Fix de fond** : séquencer/coalescer les 2 messages côté serveur.
- **Décision** :

### F15 — Split-brain `chainResolutionAnnounce` (projection + mirror privé)
- **Lieu** : `chain-resolution-manager.ts:160-181` +
  `animation-orchestrator.service.ts:1622-1637`
- **Constat** : un signal splitté en projection réactive + `_announcePending`
  privé, nourris par le MÊME callback « à ≤1 microtask ». État canonique a deux
  maisons (pattern 3-bis documenté, mais c'est de la dette).
- **Risque** : tout code futur qui flippe un sans l'autre (ou lit la projection
  là où le predicat sync est requis) désync silencieusement.
- **Décision** :

### F16 — `perspectiveSlot()` clamp prod post-assert + fenêtre pré-BOARD_STATE
- **Lieu** : `duel-web-socket.service.ts:135-141`
- **Constat** : clamp `idx === 1 ? 1 : 0` convertit une corruption
  d'`ownPlayerIndex` en lecture silencieuse du slot 0 (board flippé) au lieu de
  fail loud. Plus la fenêtre pré-BOARD_STATE F-2.5 (P1 voit slot 0 ~RTT,
  auto-résorbée). Memo `pvp-pre-board-state-slot-routing-pre-gamma-2026-05-29`.
- **Sévérité** : LOW (dette acceptée documentée).
- **Décision** :

### F17 — Debounce `_switching` 300ms calibré sur anim « future »
- **Lieu** : `solo-duel-orchestrator.service.ts:307-309`
- **Constat** : « durée alignée sur la future transition CSS .board-host » —
  mais le flip board a depuis été implémenté (cf. F20). Constante magique hors
  `animation-constants.ts`. Load-bearing faiblement (anti double-click).
- **Note** : un 2ᵉ debounce indépendant existe côté composant
  (`duel-page.component.ts:874-879`, `SOLO_SWITCH_PLAYER_MS`) — deux timers pour
  une action = cleanup possible.
- **Décision** :

### F18 — Double source de restore perspective F5
- **Lieu** : `solo-duel-orchestrator.service.ts:190` (localStorage) +
  `duel-page.component.ts:646` (sessionStorage)
- **Constat** : deux mécanismes de restore. DUEL_END ne clear que `localStorage`
  (`solo-duel-orchestrator.service.ts:217`) → désync possible (double-flip
  laissant le mauvais côté). Pas de source unique de vérité.
- **Fix proposé** : collapser sur une seule source.
- **Sévérité** : LOW, latent.
- **Décision** :

### F19 — `assertNoLocks()` = code mort relatif à son rôle documenté
- **Lieu** : `rendered-board-state.service.ts:221-224`
- **Constat** : zéro appelant prod (grep). `commitAll()` au reset clear les
  locks inconditionnellement → masque toute fuite au lieu de la surfacer. Le
  CLAUDE.md dit pourtant qu'il « surface les lock leaks aux frontières de
  transition ».
- **Fix proposé** : soit câbler `assertNoLocks` avant `commitAll()` dans
  `resetAllState`, soit corriger le doc.
- **Décision** :

---

## ✅ Fausse alerte (memo à mettre à jour)

### F20 — `gamma-c-badge-you-solo-switch-bug` : plus reproductible
- **Lieu** : `pvp-board-container.component.html:71-73` +
  `pvp-board-container.component.ts:101-105` + `pvp-player-card.component.scss:31-33`
- **Constat** : le memo (2026-05-29) dit que le flip 180° board n'a pas été
  implémenté et que le badge You/Opponent ne s'inverse pas. **Les deux sont
  faux** : le flip existe (`boardFlipped = perspectiveSource() === 1` +
  contre-rotation player-cards SCSS), chaîne réactive badge/LP/pseudo dérive de
  `ownPlayerIndex → perspectiveIndex → perspective()`.
- **Action** : vérifier visuellement une fois puis clore le memo.
- **Décision** : ⚠️ INVALIDÉ par F22 — le flip n'était pas « déjà fixé », il était
  EN TROP. Le vrai fix = retirer le flip CSS (cf. F22). Mon analyse F20 était fausse
  (j'avais lu le code statiquement sans tester le rendu réel).

---

## 🐛 Bugs découverts en cours de refinement

### F21 — Glow du bouton switch SOLO inversé — ✅ FIX (2026-05-30)
- **Découvert par** : Axel pendant le refinement de F3 (« quand je suis sur P1,
  le bouton glow quand P1=moi a une action, pas quand l'adversaire en a »).
  Contredit mon « déjà correct » de F3 — c'était une erreur d'analyse.
- **Constat vérifié (preuve serveur)** : `WAITING_RESPONSE.targetPlayer` =
  le joueur **qui ATTEND** (pas qui décide). Preuves :
  `worker-message-router.ts:290` (`send(opponentOfTarget, {targetPlayer:
  opponentOfTarget})`) + `first-player-coordinator.ts:217-218` (le perdant RPS
  reçoit WAITING_RESPONSE). Donc `_slots[X].waitingForOpponent = true` signifie
  « slot X attend, l'AUTRE a l'action ».
- **Bug** : `waitingForOpponentOnOtherSlot` lisait
  `waitingForOpponentForSlot(other)` → double inversion → glow quand le joueur
  COURANT a l'action (au lieu de l'adversaire). Vérité :
  « l'autre slot a l'action » ⟺ « mon slot courant attend » ⟺
  `waitingForOpponentForSlot(cur)`.
- **Cause profonde** : les tests `c6f` pinaient le bug — le mock interprétait
  `waitingForOpponent[X]` comme « slot X a le prompt » (inverse de la réalité
  serveur), donc les tests passaient en validant le mauvais comportement.
- **Décision appliquée** : computed lit `cur` au lieu de `other` (one-liner) +
  commentaire « semantics trap » détaillé + 4 tests `c6f` réécrits avec la
  vraie sémantique.
- **Tests** : 41/41 duel-page verts. Commit `3cddde27`.
- **Statut** : DONE.

---

### F22 — Board SOLO entièrement à l'envers en perspective=1 — ✅ FIX (2026-05-31)
- **Découvert par** : Axel (screenshot perspective=1 : HUD Opponent, badge TURN/phase,
  stats monstres en miroir, main — tout upside-down ; seul le HUD "You" correct).
  Invalide F20 (qui disait « flip déjà fixé ») : le flip était en TROP, pas manquant.
- **Constat vérifié** : DEUX mécanismes de flip s'entrechoquaient.
  - Mécanisme A (statique, pré-γ) : contenu adverse tourné 180° selon la moitié de
    board (`.opponent-field`, `side`, `relPlayer:1`). Correct, couvre terrain/stats/
    badges/main/piles.
  - Mécanisme B (γ commit 6) : `rotate(180deg)` CSS sur `.board-host` quand
    `perspectiveSource()===1`. Redondant — les DONNÉES sont DÉJÀ relativisées
    (`DuelConnection._maybeSwapBoardState` = même `swapBoardState()` partagé que
    replay). Le flip CSS double-appliquait → tout cassé sauf player-cards (qui
    avaient un pansement de contre-rotation).
- **Preuve clé** : replay change de perspective SANS flip CSS (jamais de
  `setPerspective`, `perspectiveSource` reste 0) — juste data relativisée +
  `ownPlayerIndex=perspectiveIndex`. Et replay n'a aucun bug de rotation. SOLO
  câble les données à l'identique → le flip CSS était la seule divergence.
- **Décision appliquée (alignement sur replay)** :
  - retiré `[style.transform]`/`[class.board-host--flipped]` (board-container.html) ;
  - supprimé computeds `boardTransform`/`boardFlipped` + inject/import `DuelContext`
    (board-container.ts) ;
  - supprimé la contre-rotation `.player-card` (player-card.scss) ;
  - `cardBaseRotation`/`cardBaseRotateCSS` → forme statique (`relPlayer` seul),
    branche `flipped` retirée (duel-context.ts) ;
  - `perspectiveSource` reste l'index de DONNÉES (swap `players[]`, slots,
    `ownPlayerIndex`, journal) — load-bearing, intact. Commentaire mis à jour.
- **Validation** : visuelle par Axel (perspective=1 tout à l'endroit). tsc app+spec
  + 136 tests verts (duel-context, board-container, move-router, draw, phase-gamma).
- **Statut** : DONE.

### F23 — SOLO : modale prompt figée sur "Sending…" + re-offer SELECT_CHAIN — ✅ FIX partiel (2026-05-31)
- **Découvert par** : Axel (console-export-2026-5-31). SOLO, P2 commence, P1 peut
  activer pendant draw/standby/main de P2 ; user cancel à répétition puis finit
  bloqué sur la vue prompt d'activation avec "Sending…" jusqu'au timeout.
- **Constat vérifié (log + code)** : TROIS phénomènes distincts :
  1. **Re-offer SELECT_CHAIN = engine OCGCore, PAS un bug de routing.** Deux
     `ws.recv SELECT_CHAIN` chacun précédé d'un `MSG_HINT` dont la `value`
     incrémente (20→21) = l'engine ré-offre une activation optionnelle à chaque
     fenêtre de timing. Le routing `forPlayer` est CORRECT (perspective=1 ET
     prompt.player=1 coïncident). Comportement de carte, aggravé en SOLO (user
     décline les deux côtés). **Pas un bug transport.**
  2. **`[PROMPT]` qui spam le log = simple re-éval change-detection** (le
     `setAnimating(false)` de l'announcement par phase re-déclenche l'effect).
     Inoffensif. Visible car converti en DuelLogger PIPELINE en F1.
  3. **VRAI bug client : "Sending…" bloqué sur la DERNIÈRE itération.**
     `isSending` (pvp-prompt-dialog.ts:124) mis true au submit, reset SEULEMENT
     si nouveau prompt (`openForPrompt`) / branche passive / `closeDialog`.
     Quand le dernier decline part et l'engine ne ré-offre plus, aucun nouveau
     prompt pour le slot → `isSending` reste true → modale figée.
- **Décision appliquée** :
  - **Fix A** : dans l'effect lifecycle (pvp-prompt-dialog.ts:158), `isSending
    .set(false)` INCONDITIONNEL dès que `prompt()` est falsy (sorti de la seule
    branche passive). Un slot vidé après envoi retombe toujours l'indicateur.
  - **Fix B** : log send-side `ws.send PLAYER_RESPONSE type=%s forPlayer=%s` dans
    `DuelConnection.sendResponse` (PIPELINE) — `safeSend` ne logguait que les
    drops, zéro visibilité outbound. Diagnostic pour la suite.
- **Tests** : 70/70 (prompt-dialog + duel-connection) + tsc app+spec verts.
- **À valider en SOLO par Axel** (changement comportemental subtil).
- **Reste à confirmer (piste secondaire)** : `prompt-card-grid.cancel()` a un
  guard `if (answered) return` — un 2ᵉ cancel rapide pourrait être avalé si la
  grille n'est pas re-créée → decline jamais envoyé. À trancher avec les logs
  Fix B. Fix C serveur (UX "ne plus demander") = hors scope.
- **Statut** : FIX A+B livrés, validation + piste secondaire en attente.

## Cases NON-findings (vérifiés sains — ne pas re-creuser)

- `swapBoardState`/`swapEventBoardStates` déjà DRY dans `board-state-swap.ts`.
- `syncAfterBoardState` free function partagée PvP↔Replay.
- Token consumption races (`DuelSessionManager`) : pas de TOCTOU (Node
  single-thread, pas d'await entre get/delete), tous les call-sites gèrent le
  discriminator `unknown`/`session-gone`/`ok`.
- Solver replace race : fermée (`detach` guard `get(userId) !== ws`).
- Worker lifecycle `safeTerminateWorker` : idempotent (flag-guard). Asymétrie
  fork exit handler = LOW.
- Replay persist back-off : borné (`maxRetries=3`).
- Queue collapse LP-only : prédicat `!('kind' in e)` + whitelist = blindé,
  testé.
- QueueRunner abort/reset (AbortController swap + ceiling) : sain, testé.
- POLL-DROP watchdog : pur, re-check à fire, pause+prompt aware, testé.
- `boardStateAfter` ordering (`updateLogical` avant dispatch) : correct partout.
- Pre-lock handle ownership (15 branches `move-animation-router`) : chaque
  branche reuse ou release proprement, testé (`lock-leak.integration.spec.ts`).
- Boot invariant `createConfigurable` : les 10 modules enregistrés (gap LOW =
  liste hand-maintained sans test de count).

---

## Récap priorités proposées (à arbitrer)

| Ordre | Finding | Type | Effort | Décision |
|---|---|---|---|---|
| 1 | F1 `[FLOAT-PROBE]` | 🔴 cleanup | trivial | |
| 2 | F2 sanitizer fail-OPEN | 🔴 sécu | faible | |
| 3 | F3 switch mid-chain SOLO | 🟠 bug | faible-moyen | |
| 4 | F7+F8 sync protocole + invariant | ⚠️ CI | faible | |
| 5 | F11 DRY drain stream | 🔁 | faible | |
| 6 | F20 clore memo périmé | ✅ doc | trivial | |
| 7 | F4 sendAnimationsDone | 🟠 fond | moyen | |
| 8 | F5 fork-solo dédup | 🟠 archi | moyen-élevé | |
| 9 | F6 perspective relativizer | ⚠️ archi | moyen | |
| 10 | F13/F15 simplif dette | 🧩 | moyen | |

---

## Notes de refinement (à remplir ensemble)

> _(espace libre pour les arbitrages, regroupements en chantiers, mises de côté)_
