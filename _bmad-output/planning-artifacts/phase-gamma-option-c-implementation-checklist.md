---
title: Phase γ — Option C — Checklist d'implémentation (commit-by-commit)
status: ready (companion de phase-gamma-option-c-multiplex-spec.md)
branch: feat/gamma-option-c (dérivée de feat/anim-pipeline-v2)
date: 2026-05-28
authors:
  - Axel (lead)
  - Winston (architecte)
references:
  - phase-gamma-option-c-multiplex-spec.md (spec source — 2308 lignes, 38 amendments)
  - phase-gamma-option-c-multiplex-spec.md §13 (mapping amendment → section)
---

# Option C — Checklist d'implémentation

> **But** : checklist linéaire pour valider 38/38 amendments sans avoir
> à relire le mapping §13 de la spec. Une ligne par amendment, regroupée
> par commit cible, avec diff attendu + spec ID test. À cocher au fur
> et à mesure ; chaque PR garde la sienne en description.

## Décisions actées avant kick-off (2026-05-28)

- ✅ **Branche** : `feat/gamma-option-c` dérivée de `feat/anim-pipeline-v2`.
- ✅ **A28 dans PR1 = whitelist VIDE**. Le `if (PSEUDO_PAIRWISE_SOLO_ROUTED.has(...))`
  est posé en PR1 commit 2 (mécanique en place), mais `PSEUDO_PAIRWISE_SOLO_ROUTED`
  reste un `Set` vide jusqu'au commit 4 de PR2. Évite la fenêtre de bug
  visuel SOLO inter-PR (γ-clients qui recevraient des tags slot non-routés).
  Cf. spec §6.2 + ma reco.
- ✅ **Pas de BMad story/epic**. La spec EST le plan ([memo steady-state-no-bmad-planning]].
- ✅ **PR1 strictement additif** — déployable en isolation. Aucun comportement
  γ ne change après PR1 (verrou via no-op-on-1 + whitelist vide + forPlayer
  rejected en PvP).

---

## PR1 — Server additif (déployable seul, ~2.0j)

> **Critère de merge** : tous les tests existants PvP normal restent verts.
> Le comportement γ SOLO 2-socket continue de marcher (le 2e send devient
> strictement no-op via A1, la whitelist A28 est vide donc pas de routing
> actif). PR1 mergée + déployée en isolation, on observe zéro régression
> pendant ~1 release cycle avant d'attaquer PR2.

### Commit 1 — `forPlayer` field + STRICT validation (A2 + A2bis) ✅ LIVRÉ 2026-05-28

**Scope** : étendre 7 ClientMessage avec `forPlayer?: 0|1`. Reject en PvP
normal (security A2). SOLO uniquement.

**Fichiers touchés** :
- [x] `duel-server/src/ws-protocol-prompts.ts` — `forPlayer?: 0|1` sur les
      22 variants de l'union discriminée `PlayerResponseMsg`.
- [x] `duel-server/src/ws-protocol-system.ts` — `forPlayer?: 0|1` sur
      `SurrenderMsg`, `RematchRequestMsg`, `RequestStateSyncMsg`,
      `ActivityPingMsg`, `AnimationsDoneMsg`, `CancelPromptSequenceMsg`.
- [x] `front/src/app/pages/pvp/duel-ws-prompts.types.ts` (mirror front) — sync.
- [x] `front/src/app/pages/pvp/duel-ws-system.types.ts` (mirror front) — sync.
- [x] `duel-server/src/server.ts:1107-1127` — `ws.on('message')` délègue à
      `validateClientMessageForPlayer` avant `handleClientMessage`. `parsed`
      typé `unknown` (honnête au runtime, narrowed par le validator).
- [x] **A2bis** — `duel-server/src/client-message-router.ts:234-241` case
      `CANCEL_PROMPT_SEQUENCE` : commentaire load-bearing documentant le
      bypass intentionnel + sa structure (PvP rejette au dispatch level).

**Déviation justifiée (vs spec §3.3 inline)** :
- [x] **Validator extrait** dans `duel-server/src/client-message-validator.ts`
      (NEW, fonction pure `validateClientMessageForPlayer(parsed, soloMode,
      currentPlayerIndex, duelId)`). Motif : testabilité unitaire sans
      bootstrap WS + single call-site = clean code. Sémantique 1:1 avec la spec.
- [x] **Tests T-S2 + T-S6 dans le nouveau spec** `client-message-validator.spec.ts`
      (NEW) au lieu de `client-message-router.spec.ts` + `server.spec.ts`.
      Cohérent avec la localisation du validator extrait.

**Hardening post-review (BMad code review 2026-05-28, P1 + P2 patches)** :
- [x] **Runtime narrow** `forPlayer` strictement `0 | 1` (rejette `2`, `-1`,
      `null`, `false`, `'1'`, `NaN`, etc.) — sinon le cast TS du wire JSON
      mentait et `live: 2` aurait misroute `session.players[2] === undefined`.
- [x] **Non-object payload guard** — `JSON.parse("null")` / primitives /
      arrays rejetés en amont, sinon `null.forPlayer` throws TypeError dans
      `ws.on('message')`.
- [x] **`RejectReason` exporté** comme type nommé pour exhaustiveness check
      au call site (3 reasons : `non-object-payload` | `forPlayer-in-pvp-normal`
      | `forPlayer-invalid`).

**Specs verts** :
- [x] `client-message-validator.spec.ts` (NEW) — T-S2 (5 cas SOLO) + T-S6
      (4 cas PvP) + 4 cas non-object + 16 cas weird-value (`it.each`).
- [x] `npm test` duel-server : **76 fichiers / 1516 specs verts** (+21 vs avant).
- [x] `npm test` front : **1588 specs verts** (inchangé).

**Sync check** : `node scripts/check-ws-protocol-sync.mjs` passe.

**Diff réel** : ~280 LOC, 8 fichiers (6 modifiés + 2 nouveaux).

**Defers acceptés (hors scope commit 1)** :
- **D1** Pas de compteur réel impersonation (seulement log warn) — à
  reconsidérer si la spec ajoute un strike system.
- **D3** `duelAssert(typeof session.soloMode === 'boolean')` — naturel
  à brancher dans le commit 2 (A6 session register SOLO 1-token).

---

### Commit 1b — Extensions protocole additives (A8.1 + A8.2 + A37 + ErrorMsg) ✅ LIVRÉ 2026-05-28

**Scope** : 4 messages serveur étendus avec champs additifs optionnels
(back-compat strict). Pas de logique, juste les types. Préparation pour
PR1 commit 2 + PR2.

**Fichiers touchés** :
- [x] `duel-server/src/ws-protocol-system.ts` :
  - [x] `InactivityWarningMsg` — ajouter `player?: 0|1` (A8.1).
  - [x] `WaitingResponseMsg` — ajouter `targetPlayer?: 0|1` (A8.2).
  - [x] `TimerStateMsg` — ajouter `pendingPlayer?: 0|1` (A37).
  - [x] **`ErrorMsg`** — créer le type (n'existe pas aujourd'hui ;
        `client-message-router.ts:96` envoie un `type:'ERROR'` non-typé).
        Shape : `{ type: 'ERROR'; message: string; player?: 0|1 }`.
        Inclure dans le union `ServerMessage` (`ws-protocol.ts:65`).
- [x] `front/src/app/pages/pvp/duel-ws-system.types.ts` (mirror front) — sync.
- [x] `front/src/app/pages/pvp/duel-ws.types.ts` (front index union) — sync.

**Specs verts** :
- [x] Aucun spec nouveau requis (additif strict, optionnels back-compat).
- [x] `npm test` duel-server : **76 fichiers / 1516 specs verts** (inchangé).
- [x] `npx ng test --watch=false --browsers=ChromeHeadless` front : **1588 specs verts** (inchangé).

**Sync check** : `scripts/check-ws-protocol-sync.mjs` passe (9 fichiers).

**Diff réel** : ~65 LOC, 4 fichiers (back + back-index + front + front-index).
Le coût > ~30 LOC vient des JSDoc WHY (A37 / A8.1 / A8.2 / A32 cités par
nom + invariant "PvP ignore le champ" load-bearing pour les commits aval).

**Defers post-review (BMad code review 2026-05-28, 0 patch / 5 defer / 4 dismiss)** :
- `duelAssert(msg.player !== undefined)` au SOLO read-site → PR2 commit 4b.
- Test "field populated in both modes" → posé alongside la logique de populate (PR1 c2a/c2c/c3).
- Passthrough `INACTIVITY_WARNING` + `ERROR` dans `message-filter.ts` → PR1 c2a (broadcast omniscient SOLO).
- Wire-shape parity assertion pour `ErrorMsg` → meta-tooling, hors scope.
- Rappel A1bis : `DuelStartingMsg.bothCardCodes?: number[][]` à ajouter au TYPE
  EN MÊME TEMPS que la runtime emission au PR1 commit 2c (auditor flag).

---

### Commit 2 — Server SOLO branches (A1 + A1bis + A10 + A11 + A28 vide + A19 + A20 + A36 + A6 + A3)

**Scope** : tout le routage SOLO côté serveur, mais **A28 whitelist VIDE**
(mécanique en place sans contenu). PR1 strictement additif côté PvP normal.

> **⚠️ SOLO QuickDuel cassé temporairement entre PR1 et PR2**.
> A6 fait passer le POST `quick-duel` à 1 token. Le front actuel rejette
> `wsToken2 undefined` (`duel-page.component.ts:599/614 → SOLO_SESSION_EXPIRED`).
> Le SOLO redevient fonctionnel à PR2 commit 6 avec l'orchestrator
> mono-connection. Acté avec Axel le 2026-05-28 : PvP normal + replays +
> autres pages inchangés, et PR1/PR2 vivent dans la même branche
> `feat/gamma-option-c` donc pas de gap en production.
> Le bug E1 (combinedGraceTimer faux positif sur SOLO disconnect) est une
> conséquence du même fait — il ne se déclenche pas en PR1 puisqu'aucun
> SOLO front mono-connection n'existe encore. À auditer formellement
> dans commit 3 (qui réécrit déjà `ws.on('close')` pour SOLO).

**Fichiers touchés** :

#### 2a — Broadcast loop omniscient (A1 + A10 + A11) ✅ 2026-05-28
- [x] `duel-server/src/worker-message-router.ts:280-298` — branche SOLO
      qui appelle `filterMessage(_, 0, true)` et caches indexées par
      `message.player`. Commentaires A10 + A11 inline.
- [x] **A36** — `first-player-coordinator.ts:109` : `throw new Error(...)`
      en tête de `startFirstPlayerPhase` (pas de `duelAssert` côté serveur ;
      throw direct = même effet — surface en tests + bloque la fonction).
- [x] **Bonus (defer review #3 PR1 c1b)** — `message-filter.ts` :
      passthrough `INACTIVITY_WARNING` + `ERROR` (défensif, PR2 c4f les
      enverra par broadcast via A28).

#### 2b — `sendToPlayer` no-op-on-1 + A28 whitelist (vide) ✅ 2026-05-28
- [x] `duel-server/src/server.ts:sendToPlayer` : utilise `decideSoloRouting`
      (fonction pure dans `lifecycle-helpers.ts`) qui retourne `'send'`,
      `'route-to-0'` ou `'noop'`. Logique unit-testée sans booter le serveur.
- [x] **`PSEUDO_PAIRWISE_SOLO_ROUTED`** déclaré dans `lifecycle-helpers.ts`
      comme `ReadonlySet<ServerMessage['type']>` vide. Test verrouille
      `.size === 0` pour catcher un bump accidentel.

#### 2c — DUEL_STARTING + WAITING_RESPONSE émissions SOLO ✅ 2026-05-28
- [x] **A1bis** + **A20** — `buildDuelStartingMessage(session, playerIndex)`
      dans `lifecycle-helpers.ts` (fonction pure, single source of truth).
      Site initial + site reconnect (`sendStateSnapshot`) l'utilisent.
- [x] **A1bis** type — `DuelStartingMsg.bothCardCodes?: [number[], number[]]`
      (tuple plus strict que le `number[][]` de la spec — assignable et
      protocole-significatif). Mirror front sync.
- [x] **A19** — `worker-message-router.ts` populate `targetPlayer` sur
      `WAITING_RESPONSE` **dans les 2 modes** (cohérence protocole).

#### 2d — POST quick-duel + session register SOLO 1-token ✅ 2026-05-28
- [x] **A6** — `server.ts:POST /api/duels` :
      `const tokens: readonly [string] | readonly [string, string] =
      soloMode ? [token0] : [token0, token1];`
- [x] `sessionManager.register` signature élargie à
      `readonly [string] | readonly [string, string]`. 2e token registered
      seulement si présent.
- [x] POST response : `wsTokens: tokens` (tableau de 1 ou 2).
- [x] `front/src/app/pages/pvp/room-api.service.ts` : `wsToken2?: string`
      optionnel avec JSDoc "transitional, dropped in δ".
- [x] **Spring Boot** (`back/.../RoomService.java`) :
      `validateDuelResponse(response, minTokens)` overloadé.
      `quickDuel` lit `wsTokens.length == 1` pour le bypass SOLO + écrit
      `wsToken2 = null` (entity nullable). PvP `startDuel` reste minTokens=2.

#### 2e — Lifecycle helpers (A3) ✅ 2026-05-28
- [x] Nouveau fichier `duel-server/src/lifecycle-helpers.ts` :
      `isReadyToStart`, `isFullyDisconnected`, `PSEUDO_PAIRWISE_SOLO_ROUTED`,
      `decideSoloRouting`, `buildDuelStartingMessage`.
- [x] `server.ts:491` — connection timeout : `isFullyDisconnected(s)`.
- [x] `server.ts:1078` — both-connected gate : `isReadyToStart(session)`.
- [x] `server.ts:1153` — post-duel disconnect cleanup : `isFullyDisconnected`.
- [x] Sites `timer-management.ts:352` + `fork-handlers.ts:120` audités :
      timer-management est SOLO-reachable en PR2 (bug E1 differé au c3) ;
      fork-handlers n'est PAS SOLO-reachable. **Pas de bug en PR1**.

**Specs verts** :
- [x] `T-S1` — SOLO broadcast omniscient (1 send, MSG_DRAW preserves
      cardCodes when target=1, proving `omniscient=true` was passed).
- [x] `T-S3` — `DuelSessionManager.register` accepts 1 token in SOLO ;
      "would-be-token-1" stays unknown.
- [x] `T-S4` — `lastSentPrompt[message.player]` cached (target=0 AND
      target=1 verified).
- [x] `T-S5` — `decideSoloRouting` returns `'send' | 'route-to-0' | 'noop'`
      correctly. Whitelist size = 0 locked.
- [x] `T-S7` — `isReadyToStart` SOLO: socket 0 alone is enough.
- [x] `T-S9` — `buildDuelStartingMessage` SOLO emits `bothCardCodes` tuple.
- [x] `T-S11` — `WAITING_RESPONSE` populates `targetPlayer` (opponent of
      prompted) in BOTH modes.
- [x] `T-S12` — `buildDuelStartingMessage` SOLO with `playerIndex=1`
      (reconnect path) still emits `bothCardCodes`.
- [x] **Bonus T-S8** — `isFullyDisconnected` (originally c3 scope).
- [x] **A36** — `startFirstPlayerPhase` throws on SOLO + 0 DICE_ROLL emitted.
- [x] Tous les specs existants verts : **76 fichiers / 1516 → 77 fichiers /
      1536 specs duel-server, +20 nouveaux**. Front : **1588 specs (inchangé)**.
      Spring Boot : **17 specs (inchangé)**.

**Diff réel** : ~460 LOC, 14 fichiers (10 duel-server + 1 Java + 2 front + 1
checklist). Plus que ~350 attendus à cause :
- `lifecycle-helpers.ts` + `.spec.ts` (~230 LOC) — choisi pour la testabilité ;
- 4 specs étendues côté duel-server au lieu d'inline dans 1 fichier ;
- JSDoc WHY load-bearing sur le protocole + Spring.

---

### Commit 3 — Lifecycle SOLO (A18 + A31 + audit `players[1].connected`) ✅ LIVRÉ 2026-05-28

**Scope** : `ws.on('close')` SOLO sans grace logic, rematch grace en SOLO,
audit `players[1].connected` clos.

**Fichiers touchés** :
- [x] **A18** — `server.ts:ws.on('close')` handler :
  - [x] Branche pré-end : `if (session.soloMode) return;` après
        `pauseTurnTimer` + `clearInactivityTimer`. **Pas** de
        `OPPONENT_DISCONNECTED`, **pas** de `startGracePeriod`, **pas** de
        touche à `players[1].connected`. Le user solo n'a personne à
        notifier ; la reconnexion passe par le handshake normal.
  - [x] Branche post-end : `if (session.soloMode) return;` également. Le
        cleanup post-duel SOLO est délégué au `rematchTimeout` (cf. A31).
        Bypasser ici racerait contre une reconnexion légitime.
  - [x] Branche else (PvP normal) : inchangée.

- [x] **A31** — `worker-lifecycle.ts:handleDuelEnd` arme le `rematchTimeout`
      **aussi en SOLO** (était skip pré-γ). Avec A18 qui bloque le cleanup
      au close SOLO, c'est le seul mécanisme qui nettoie une session SOLO
      post-duel : `onRematchExpired` → `rematchExpired` → `cleanupDuelSession`
      au bout de `rematchExpiryMs` (5 min). En SOLO le `REMATCH_CANCELLED`
      envoyé à socket 1 est no-op (whitelist A28 vide en PR1).

- [x] **Constante magique extraite** — `server.ts` : `REMATCH_EXPIRY_MS = 5 * 60 * 1000`
      au module-scope, utilisée par la `configureWorkerLifecycle` au lieu
      du literal inline (pas d'incidence runtime, juste DRY).

- [x] **Audit grep `players[1].connected`** sur `duel-server/src/` :
  - [x] `server.ts:1077` → `isReadyToStart` (c2 ✅).
  - [x] `server.ts:1153` → `isFullyDisconnected` (c2 ✅).
  - [x] `server.ts:491` → `isFullyDisconnected` (c2 ✅).
  - [x] **`fork-handlers.ts:120`** — fork-solo flow, **PAS SOLO-reachable**
        (les forks utilisent leur propre lifecycle, jamais soloMode multiplex).
        Aucune action requise.
  - [x] **`timer-management.ts:352`** — `combinedGraceTimer` fallback. En
        SOLO multiplex, `players[1].connected` est toujours `false` → le
        prédicat évalue toujours vrai. **Bug E1 (BMad code review c2)
        résolu par construction** : `startGracePeriod` n'est plus appelé
        en SOLO grâce à A18, donc `combinedGraceTimer` n'est plus armé,
        et la ligne 352 devient inatteignable. Pas de modif requise.

**Specs verts** :
- [x] `T-S8` — `isFullyDisconnected` SOLO (déjà livré au c2 dans
      `lifecycle-helpers.spec.ts`).
- [x] `T-S16` — `handleDuelEnd` arme rematchTimer en SOLO
      (`worker-lifecycle.spec.ts` ligne 297, test reécrit).
- [ ] **T-S10** (SOLO `ws.on('close')` skips grace logic) — **defer e2e**.
      Le close-handler est inline dans `server.ts ws.on('close')`, non
      isolable sans booter le WS. La logique vit derrière 2 early returns
      simples (`if (session.soloMode) return;`) ; couvrir par e2e Playwright
      en PR2 c7 quand le harness intégration arrive.

**Diff réel** : ~70 LOC, 3 fichiers (server.ts + worker-lifecycle.ts +
worker-lifecycle.spec.ts).

**Patches post-review (BMad code review 2026-05-28, 3 layers)** :
- **E5 idempotency** — `handleDuelEnd` guard `if (session.endedAt !== null) return;`
  en tête. Sinon un race TIMEOUT-after-MSG_WIN re-rentrait, overwrite
  `rematchTimeout` et leakait le timer précédent. Le commentaire ligne 141-143
  affirmait l'idempotence mais le body ne l'imposait pas. +1 test
  `worker-lifecycle.spec.ts` "is idempotent on endedAt".
- **L1** — restauration d'un one-liner `// PvP normal needs both sockets
  down; SOLO has its own path above.` au-dessus du `isFullyDisconnected`
  PvP branch (grep-ability pour les futurs audits SOLO/PvP).

**Defers (hors scope c3 / PR1)** :
- **E2 / E6** — `cleanupDuelSession` ne call PAS `safeTerminateWorker`,
  et `MSG_WIN` naturel ne déclenche pas `requestReplayFromWorker`. Donc
  un OCGCore worker survit jusqu'à `'exit'` naturel (rare) ou expiration
  de `rematchTimeout` via `cleanupDuelSession` qui ne le tue pas non plus.
  **Pré-existant** côté PvP normal. Aggravé en SOLO par γ A31 (5 min de
  fenêtre rematch là où SOLO pré-γ vivait moins longtemps). À traiter
  séparément hors PR1 — pas un blocage de merge.
- **E4 (pas de TTL eviction)** — `DuelSessionManager` n'a pas de TTL ni
  de `maxActiveDuels`. Une DoS surface existe (un attaquant qui boucle
  quick-duel + close gonfle l'état serveur). Pré-existant ; γ ne crée
  pas la surface, juste l'allonge légèrement. À adresser hors PR1.

**Code review verdict** : 1 BLOCKER analysé (B1 — pas un leak, vérifié) +
6 HIGH analysés (5 pré-existants hors scope ; E5 patché) + 3 MED/LOW
patchés ou dismiss justifiés. 0 régression PvP normal. Tests : 1539
specs verts (+3 vs c2 : T-S16 + idempotency + worker-message-router déjà
au c2).

---

### Acceptance PR1

- [ ] Tous specs front + back verts (1518+ specs cumulés).
- [ ] T-S1, T-S3, T-S4, T-S5, T-S6, T-S7, T-S8, T-S9, T-S10, T-S11,
      T-S12, T-S16 verts (12 nouveaux specs serveur).
- [ ] `scripts/check-ws-protocol-sync.mjs` passe à chaque commit.
- [ ] **Vérification déploiement** : un γ-client SOLO 2-socket connecte
      en PR1, joue un duel complet, observe zéro changement de comportement.
      Le 2e send est strictement no-op via A1, la whitelist A28 est vide.
- [ ] **Audit grep** : `PSEUDO_PAIRWISE_SOLO_ROUTED` est bien un `Set`
      vide à la fin de PR1 (peuplé en PR2 commit 4).

**Rollback PR1** : revert intégral. γ-client SOLO continue de marcher
(comportement strictement identique grâce à l'additivité).

---

## PR2 — Multiplex complet (server + front atomique, ~13.25j)

> **Critère de merge** : front + back déployés ensemble (lockstep release).
> Pas de rollback partiel possible — c'est le coût du multiplex SOLO.

### Commit 4 — `DuelConnection` PerspectiveSlot × 2 (A8 + A22 + A23 + A34 + A28 contenu)

**Scope** : refactor structurel `DuelConnection` pour héberger 2 slots
per-perspective. **Le commit le plus dense de PR2** (~3.5j).

> **Découpe interne actée 2026-05-28 (Amelia + Axel)** — 5 sub-commits
> au lieu de 7 a-g checklist (les sub-commits a-g sont des scopes spec,
> pas des frontières compile/test) :
>
> - **c4.1 ✅ 2026-05-28** (commit `182bd634`) — PerspectiveSlot extracted + `_slots: [Slot, Slot]` + 8 getters `getXxxFor(p)` + `soloMode` public field + optional `duelCtx?` ctor injection + **dual-write strict** sur 14 mutation sites. Legacy reste source de vérité. Code review BMad : 4 patches appliqués (F1 `_slotFor` bound check helper + F3 FIRST_PLAYER_RESULT clear-both + F10 REMATCH_STARTING hintContext/inactivityWarning clear slot + F12 DUEL_END hintContext clear slot). 1588 specs verts. A39 escaladé (cf. c5 ci-dessous).
> - **c4.2 ✅ 2026-05-28** (commit `6d8be003`) — bascule dual-write → slot-only sur handleMessage + A34 intra-slot consumé + A8.1/A8.2 consume. Public aliases re-implémentés en `computed(() => _slots[0].xxx())`. Code review BMad : 0 patches, 1 escalade A39-bis (HINT broadcast public, cf. c5).
> - **c4.3 ✅ 2026-05-28** (commit `fea91a2c`) — sendResponse(`forPlayer`) slot-clear (A22) + `_lastSentForPlayer` memoize (A9) + 7 signatures sendXxx. Helper privé `_tagForPlayer`. Auditor 0 findings.
> - **c4.4 ✅ 2026-05-28** (commit `23ee7d60`) — REMATCH_STARTING `_boardActive=false` (A23) + BOARD_STATE swap (A17) + `case 'ERROR'` (A32 front). Extraction `swapBoardState` helper partagé (`pvp/board-state-swap.ts`). Code review BMad : 3 patches (BH-1 swap avant onMessage + BH-3 duelAssert invariant + BH-6 logger.warn ERROR). 1 defer BH-9 → PR2 c7 Playwright Scenario C.
> - **c4.5 ✅ 2026-05-28** — serveur `PSEUDO_PAIRWISE_SOLO_ROUTED` peuplé (A28 contenu) avec 4 types : WAITING_RESPONSE, INACTIVITY_WARNING, ERROR, REMATCH_INVITATION. Test verrou contenu + size=4. 1540 duel-server tests verts (+1).

**Fichiers touchés** :

#### 4a — Extraction `PerspectiveSlot`
- [ ] `front/src/app/pages/pvp/duel-page/duel-connection.ts` :
  - [ ] Définir `interface PerspectiveSlot` avec **8 fields per-perspective**
        (A33 : `_lastDrawAnnouncedHash` reste **GLOBAL**, pas dans le slot) :
        `pendingPrompt`, `hintContext`, `inactivityWarning`,
        `waitingForOpponent`, `lastConfirmedCards`, `lastSelectedCards`,
        `lastSelectedPromptType`, `hintCardConsumed`.
  - [ ] `private readonly _slots: [PerspectiveSlot, PerspectiveSlot] =
        [this.makeEmptySlot(), this.makeEmptySlot()];`
  - [ ] API d'accès : `getPendingPromptFor(p)`, `getHintContextFor(p)`,
        `getInactivityWarningFor(p)`, etc. (8 getters Signal).
  - [ ] Garder les 8 anciens fields **commentés/supprimés** progressivement
        — ne pas laisser de mort-code.

#### 4b — Routing per-perspective dans `handleMessage`
- [ ] Branches SELECT_*/ANNOUNCE_*/SORT_* (14 cases lignes 703-741) :
      router via `_slots[message.player]`. Garder `duelAssert(message.player
      === 0 || message.player === 1, ...)`.
- [ ] **A34** — MSG_HINT (`:792-808`) : `prev = this._slots[message.player].hintContext()`
      (intra-slot strict, JAMAIS current perspective).
- [ ] MSG_CONFIRM_CARDS (`:845-846`) : router via `_slots[message.player]`.
- [ ] INACTIVITY_WARNING (`:822-823`) : lire `message.player`, router via
      `_slots[player]`.
- [ ] WAITING_RESPONSE (`:904-907`) : lire `message.targetPlayer` (A8.2),
      router via `_slots[targetPlayer]`.
- [ ] DUEL_END (`:854-859`) + REMATCH_STARTING (`:885-890`) + STATE_SYNC :
      **clear LES DEUX slots**.

#### 4c — `sendResponse` slot-clear (A22)
- [ ] `duel-connection.ts:325-359` `sendResponse(promptType, data, forPlayer?: 0|1)` :
  - [ ] Capture `this._lastSentForPlayer = forPlayer` (A9 memoize).
  - [ ] `slot = (forPlayer ?? 0) as 0|1`.
  - [ ] Clear `_slots[slot].lastSelectedCards`, `lastSelectedPromptType`,
        `lastConfirmedCards`, `hintCardConsumed`, `pendingPrompt`,
        `inactivityWarning` (ciblé sur le slot du forPlayer).
  - [ ] `_confirmedCardsByChain.clear()` reste **global** (key chainIndex).
- [ ] Appliquer pareil pour `sendActivityPing`, `sendAnimationsDone`,
      `sendCancelPromptSequence` etc. avec param `forPlayer?` (signature
      extension).

#### 4d — REMATCH_STARTING `_boardActive=false` (A23)
- [ ] `duel-connection.ts:880` (branche REMATCH_STARTING) : ajouter
      `this._boardActive = false`. Le `DuelLoadingEffectsService` re-flippe
      à `true` quand le nouveau BOARD_STATE arrive.

#### 4e — BOARD_STATE swap étendu (A17)
- [ ] `duel-connection.ts:620-635` (branche BOARD_STATE) :
  - [ ] `if (this.soloMode && this.duelCtx.perspective()() === 1)
        data = swapBoardState(data);` avant `syncAfterBoardState`.
  - [ ] **boardStateAfter swap** sur les BOARD_CHANGING events durant
        `chainResolving` : avant `processor.processMessage(message)`,
        swap si SOLO + perspective=1 + `boardStateAfter` présent.
- [ ] Import `swapBoardState` depuis `replay-duel-adapter.ts` (helper
      partagé — NE PAS dupliquer).

#### 4f — Whitelist A28 peuplée
- [ ] `duel-server/src/server.ts` (déplacement depuis PR1 commit 2 vide
      → peuplé maintenant) :
      ```ts
      const PSEUDO_PAIRWISE_SOLO_ROUTED = new Set<ServerMessage['type']>([
        'WAITING_RESPONSE',
        'INACTIVITY_WARNING',
        'ERROR',
        'REMATCH_INVITATION',
      ]);
      ```
- [ ] **Note** : ce changement vit côté serveur, pas front. Mais l'effet
      utilisateur arrive avec PR2 front (les `_slots[]` consomment les
      tags routés).

#### 4g — ERROR case handler front (A32)
- [ ] `duel-connection.ts handleMessage` : ajouter `case 'ERROR'` qui
      route vers un toast UX (perspective-agnostique).
- [ ] **Important** : ce case n'existait pas avant — c'est la première
      consommation front de `type: 'ERROR'`.

**Specs verts** :
- [ ] `T-F1` — PerspectiveSlot routing (`SELECT_CARD.player=1` met à jour
      `_slots[1]`, pas `_slots[0]`).
- [ ] `T-F2` — DRAW announce dedup GLOBAL (A33 — pas re-announce au switch).
- [ ] `T-F3` — BOARD_STATE swap on perspective=1 SOLO.
- [ ] `T-F7` — WAITING_RESPONSE.targetPlayer routes to correct slot.
- [ ] `T-F10` — DUEL_END clears BOTH slots.
- [ ] `T-F12` — sendResponse clears slot of forPlayer.
- [ ] `T-F15` — MSG_HINT inheritance intra-slot (A34).
- [ ] PvP normal : `_slots[0]` alimenté seul, `_slots[1]` vide jamais lu,
      comportement identique.

**Diff attendu** : ~600 LOC, principalement `duel-connection.ts` +
extensions ws-protocol.

---

### Commit 5 — `DuelWebSocketService` computeds + `sendXxx` (A21 + A37 + 🆕 A39 + 🆕 A39-bis) ✅ LIVRÉ 2026-05-29

**Découpe interne actée 2026-05-29 (Amelia + Axel)** — 4 sub-commits :

- **c5a ✅ 2026-05-29** (commit `2fd436dc`) — Server populate
  TIMER_STATE.pendingPlayer aux 4 sites d'émission de timer-management.ts
  (sendTimerStateToAll, sendTimerStateToPlayer, startTurnTimer tick,
  pauseTurnTimer post-pause). +5 specs A37 propagation, 1545 duel-server
  verts. Type `TimerStateMsg.pendingPlayer?: Player` déjà livré PR1 c1b.
- **c5b ✅ 2026-05-29** (commit `fb2564b9`) — `soloModeSource: WritableSignal<boolean>`
  + `setSoloMode()` API + `slotIndex(): 0|1` helper (SOLO ? perspective :
  ownPlayerIndex narrowed via duelAssert + clamp défensif prod). 4 computeds
  per-perspective re-routés (pendingPrompt, hintContext, inactivityWarning,
  waitingForOpponent) + 2 getters non-signal (lastSelectedCards,
  lastConfirmedCards). 17 autres computeds restent transport-global.
  _defaultConnection déplacé field-init→ctor pour passer {duelCtx}.
  Code review BMad 3 agents : APPROVE_WITH_PATCHES — 2 patches appliqués
  (BH-2 soloMode signal vs boolean → readonly soloModeSource: WritableSignal ;
  BH-3 prod clamp `idx === 1 ? 1 : 0` au lieu de `as 0|1`). 1588 specs
  verts.
- **c5c ✅ 2026-05-29** (commit `89dd68bc`) — `sendForPlayer(): 0|1|undefined`
  helper distinct de slotIndex (sendside vs readside, sémantique différente).
  7 sendXxx propagent `sendForPlayer()` (sendResponse, sendActivityPing,
  sendSurrender, sendRematchRequest, sendCancelPromptSequence,
  sendRequestStateSync, sendAnimationsDone). PvP normal → undefined
  (A2 garde stricte). A37 fallback `sendAnimationsDone` SOLO 3-niveaux :
  `_lastSentForPlayer ?? timerState.pendingPlayer ?? perspective()`.
  Code review BMad combiné Blind+Edge Hunter : APPROVE_WITH_PATCHES, 0
  patch appliqué (F-X1 P2 ordre fallback conforme à la spec — à acter
  c6 si symptômes ; F-X2 P3 dead code SOLO jusqu'à c6 ; F-X3/F-X4 P3
  pré-existants hors scope). 1588 specs verts.
- **c5d ✅ 2026-05-29** (commit `e509ea80`) — A39-bis MSG_HINT broadcast
  intra-slot. Whitelist `SAFE_PUBLIC_HINT_TYPES = [1, 2, 6, 7, 9]`
  dupliquée côté front (commentaire pointe vers message-filter.ts:32
  comme source de vérité). Branche broadcast écrit LES 2 SLOTS avec
  même merged. `prev` lu depuis slot d'origine dans les 2 branches
  (cohérence A34). Correction d'un bug pré-existant PvP normal (P0
  recevait HINT broadcast originé P1 → _slots[1] → invisible).
  +5 specs A39-bis. Code review BMad Auditor : APPROVE. 1593 specs verts.

**Bonus c5 (hors scope mais corrigé en flux)** :
- **fix(tests) ✅ 2026-05-29** (commit `2126f4cd`) — Fix TS2352 dans
  `worker-message-router.spec.ts:558` (test `MSG_DRAW.cards` payload
  mockait `[{ cardCode, ... }]` au lieu de `[1234]` conforme au type
  `(number | null)[]`). Pré-existant PR1 c2, exposé par check TS hook.

**Scope original** (réf. spec §4.2-4.4) : `wsService` lit les 21 computeds
transport-local via `_connection.getXxxFor(perspective())()`. Les 7
`sendXxx` taggent `forPlayer` **SOLO-only** (A21).

> **🚨 A39 — BUG SPEC PvP-normal P1 (découvert par BMad code review c4.1,
> 2026-05-28).** La spec §4.3 ligne 1178 fait
> `pendingPrompt = computed(() => _connection.getPendingPromptFor(duelCtx.perspective()()))`.
> Mais `DuelContext.perspectiveSource` reste `0` en PvP normal
> (`duel-context.ts:43-44` "En PvP normal / replay, le signal reste à 0").
> Et `message.player` reste **absolu** côté serveur (CLAUDE.md
> "Perspective Convention" §3 + `message-filter.ts:145` qui n'altère pas
> `message.player`). Conséquence : en PvP P1, `_slots[1]` reçoit les
> prompts mais le reader fait `_slots[perspective()=0]` → vide → **PvP P1
> cassé structurellement**.
>
> **Résolution actée Axel + Amelia 2026-05-28** — **Option 1 (helper
> `slotIndex` qui branche sur `soloMode`)** :
>
> ```ts
> // duel-web-socket.service.ts (c5)
> private slotIndex(): 0 | 1 {
>   return this.soloMode
>     ? this.duelCtx.perspective()()
>     : (this.duelCtx.ownPlayerIndex() as 0 | 1);
> }
> readonly pendingPrompt = computed(() => this._connection.getPendingPromptFor(this.slotIndex())());
> // ... 21 computeds total
> ```
>
> **Sémantique** : en PvP normal/replay, `slotIndex = ownPlayerIndex`
> (l'identité serveur absolue du viewer). En SOLO multiplex,
> `slotIndex = perspective()` (le volet visuel projeté qui flippe).
> Replay : `ownPlayerIndex` est fed `perspectiveIndex()` côté
> `replay-page.component.ts` (cf. CLAUDE.md "Perspective Convention"
> §2), donc le replay flip suit naturellement.
>
> **Précédent dans la codebase** : `DuelGameLogService.setPerspective(absolute: Player)`
> (cf. `duel-game-log.service.ts:242`) — le journal a déjà ce pattern de
> "perspective absolute" exposé. Le journal flippe via
> `effect(() => gameLog.setPerspective(ownPlayerIndex()))`.
>
> **Sendside** — helper DISTINCT pour `sendXxx forPlayer` :
>
> ```ts
> private sendForPlayer(): 0 | 1 | undefined {
>   return this.soloMode ? this.duelCtx.perspective()() : undefined;
> }
> ```
>
> PvP normal envoie `forPlayer = undefined` (A2 serveur rejetterait sinon).
> SOLO envoie `forPlayer = perspective()`. Pas le même helper que
> `slotIndex` car la sémantique diffère (readside indexe un slot, sendside
> tag un payload pour le serveur).
>
> **Edge case vérifié** : `ownPlayerIndex` typé `number` dans `DuelContext`
> (`duel-context.ts:62`). Narrow `as 0|1` au call site `slotIndex` —
> alternatives : changer le typing `DuelContext` (impact plus large) ou
> ajouter un `duelAssert(idx === 0 || idx === 1)` (préféré, défensif).
>
> **A39-bis — MSG_HINT broadcast public (découvert par BMad code review
> c4.2, 2026-05-28).** Les `SAFE_PUBLIC_HINT_TYPES` (cf.
> `message-filter.ts:16-26`) sont des HINT broadcast envoyés à TOUS, mais
> le payload garde `message.player = sourcePlayer` (l'origine, pas le
> destinataire). En PvP normal P0 qui reçoit un HINT broadcast avec
> `player=1` (originé par l'opponent), c4.2 écrit `_slots[1].hintContext`,
> et la résolution Option 1 ferait `slotIndex = ownPlayerIndex = 0` →
> lit `_slots[0]` = vide → le HINT broadcast est invisible.
>
> **Résolution EC-2** : à `MSG_HINT` côté `DuelConnection.handleMessage`,
> dupliquer la whitelist `SAFE_PUBLIC_HINT_TYPES` côté front (constante
> partagée idéale, sinon recopie) et :
> ```ts
> if (SAFE_PUBLIC_HINT_TYPES.has(message.hintType)) {
>   // Broadcast : write LES DEUX slots (consumer reads via slotIndex).
>   for (const s of this._slots) s.hintContext.set(merged);
> } else {
>   // Routed : write the targeted slot only.
>   slot.hintContext.set(merged);
> }
> ```
> Pour la lecture de `prev` (intra-slot A34), garder `prev = slot.hintContext()`
> pour la branche routée ; pour broadcast, lire `_slots[ownPlayerIndex].hintContext()`
> (la perspective du viewer) — mais comme `DuelConnection` n'a pas
> `ownPlayerIndex`, soit on relit le slot du writer (`_slots[message.player]`,
> i.e. l'origine), soit on passe par le `duelCtx` injecté en c4.1 si on
> peut résoudre `ownPlayerIndex` via lui. À arbitrer au démarrage c5.

**Fichiers touchés** :
- [ ] `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` :
  - [ ] Ajouter `soloMode: boolean = false` field public (flippé par
        `SoloDuelOrchestratorService.init`).
  - [ ] 21 computeds (`pendingPrompt`, `hintContext`, `timerState`,
        `rematchState`, …) : lecture via `_connection.getXxxFor(perspective())()`.
  - [ ] 7 `sendXxx` (`sendResponse`, `sendActivityPing`, `sendSurrender`,
        `sendRematchRequest`, `sendCancelPromptSequence`, `sendRequestStateSync`,
        `sendAnimationsDone`) :
    - [ ] **A21 garde stricte** : `const forPlayer = this.soloMode ?
          this.duelCtx.perspective()() : undefined;`
    - [ ] PvP normal `forPlayer === undefined` (A2 serveur rejetterait sinon).
  - [ ] **A37 fallback `sendAnimationsDone`** :
        ```ts
        const forPlayer = this.soloMode
          ? (this._connection.lastSentForPlayer
             ?? this.timerState()?.pendingPlayer
             ?? this.duelCtx.perspective()())
          : undefined;
        ```
- [ ] **Note A37 serveur** : `TimerStateMsg.pendingPlayer` populé serveur
      depuis `session.timerContext.pendingPlayer`. Validation : populating
      **inconditionnel** (pas SOLO-only) — comme ça PvP normal ignore le
      champ mais ne crée pas d'inconsistance.

**Specs verts** :
- [ ] `T-F4` — pendingPrompt reactive on perspective flip.
- [ ] `T-F11` — PvP normal sendXxx NO forPlayer tag.
- [ ] `T-F16` — ANIMATIONS_DONE fallback on pendingPlayer.

**Diff attendu** : ~250 LOC, 1 fichier.

---

### Commit 6 — `SoloDuelOrchestratorService` mono-connection (A4 + A5 + A13 + A14 + A24 + A27 + A32 + A35)

**Scope** : refonte de `SoloDuelOrchestratorService` pour 1 connection.
Banner UX cross-slot. i18n.

**Fichiers touchés** :

#### 6a — `init()` refondu mono-connection ✅ LIVRÉ 2026-05-29
- [x] `solo-duel-orchestrator.service.ts:99-142` :
  - [x] 1 seul `new DuelConnection(...)`, plus de `sharedProcessor` arg
        (la conn instancie son processor localement, path PvP-normal).
  - [x] **A21** — pair flip avant `connect()` : `conn.soloMode = true` +
        `wsService.setSoloMode(true)` (signal réactif c5b BH-2). Ordre
        load-bearing documenté dans la doc de classe.
  - [x] **A5 + setupRematchEffect singular** — **DÉFERRÉ** à c6b/c6c
        (purement périmètre c6a = structure init, pas la localStorage
        ni la garde A27).
- [x] **`duel-page.component.ts`** — 2 call sites `orchestrator.init(t1, t2)` →
      `init(t1)` ; SOLO branch garde `if (!wsToken1)` au lieu de
      `!wsToken1 || !wsToken2` (débloque SOLO QuickDuel cassé depuis PR1 c2).
- [x] **`solo-mode-effects.service.ts`** — sessionStorage SOLO drop `wsToken2`.
- [x] **`displayedTimerState`** (duel-page) — adapté `connection()` singular.
- [x] **3 specs migrés** : `solo-duel-orchestrator.service.spec.ts`,
      `duel-page.component.spec.ts`, `phase-gamma-victory.spec.ts`.
- [x] **wsService bindTransports(conn, conn) + bindSharedProcessor(conn.processor)** —
      transitionnel jusqu'au c8 cleanup (le `_defaultConnection` orphan
      reste, juste plus consommé en SOLO). Patch instrumentation R1
      `if (t0 === t1)` pour éviter de tagger STATE_SYNC `via transport 1`
      à tort en mono-conn.
- [x] **`cleanup()`** reset `_transport_connection.set(null)` + `enabled = false`.

**Specs verts** : 1596 front (+1 test order assertion A21) / 1603 duel-server (inchangé).

**Patches post-review (BMad code review 2026-05-29, 3 layers)** :
- **P1 BlindHunter** — test order assertion via `spyOn(DuelConnection.prototype, 'connect')`
  + `toHaveBeenCalledBefore` + capture `conn.soloMode` à connect-time. Le pair-flip
  AVANT connect() est désormais verrouillé par test, pas seulement par code review.
- **P2 BlindHunter** — instrumentation R1 dans `bindTransports(conn, conn)` mono-conn.
- **P2 BlindHunter** — `cleanup()` reset signal + flag (évite zombie state).
- **Auditor REQUEST_CHANGES** — A14 (drop `setBoardActive`) restaurée → reportée c6c.
  La collapse `if (s0 && s1)` → `if (conn.rematchStarting())` reste en c6a parce
  qu'elle est forcée par le shift structurel `_connections` paire → singular ; la
  garde A27 reste en c6b.

**Defers** :
- **P2 BlindHunter fork gate 2-tokens** — by design (`fork-handlers.ts` serveur
  émet toujours 2 tokens, on garde la cohérence ; le 2e token est dead-data
  côté front mais signale "session fork OK"). Pas de patch.

#### 6b — `setupRematchEffect` 1-signal (A4 + A27)
- [ ] `solo-duel-orchestrator.service.ts:218-247` :
  - [ ] **A27** — garde `if (!this.wsService.soloMode)` autour de
        l'auto-accept `rematchState === 'invited'` (désactivé en SOLO).
  - [ ] Effect REMATCH_STARTING : conn unique, plus de `c[0] && c[1]`.

#### 6c — `switchPerspective` simplifié (A5 + A14)
- [ ] `solo-duel-orchestrator.service.ts:171-213` :
  - [ ] **A14** — supprimer `c[to].setBoardActive(true)` (plus d'asymétrie
        transport sur 1 socket).
  - [ ] **A5** — `localStorage.setItem(SOLO_PERSPECTIVE_KEY, String(to))`
        après le `setPerspective(to)`.
  - [ ] Garde `_switching` (300ms) inchangée.

#### 6d — Clear localStorage au DUEL_END
- [ ] `solo-duel-orchestrator.service.ts` : `effect()` qui écoute
      `wsService.duelResult()` ; quand non-null + SOLO → `localStorage.removeItem(SOLO_PERSPECTIVE_KEY)`.

#### 6e — REMATCH SOLO court-circuit (A27 serveur)
- [ ] `duel-server/src/client-message-router.ts:174-184` (case `REMATCH_REQUEST`) :
  - [ ] `if (session.soloMode) { cfg.startRematch(session); break; }` avant
        la gate "both requested".

#### 6f — Banner UX cross-slot (A13 + A24 + A35)
- [ ] `duel-page.component.html` : ajouter `@if (pendingPromptForOtherSlot())`
      banner avec `<app-banner>` + `<app-button>`.
- [ ] `duel-page.component.ts` : computeds `pendingPromptForOtherSlot()`,
      `otherSlot()`, `switchToOtherSlot()`.
- [ ] **A24** — `[disabled]="orchestrator.switching()"` sur le bouton.
- [ ] **A35** — i18n keys :
  - [ ] `front/src/assets/i18n/fr.json` : `pvp.solo.actionRequiredP1 = "Action requise de P1"`, `actionRequiredP2`, `switchPerspective = "Basculer"`.
  - [ ] `front/src/assets/i18n/en.json` : `"Action required from P1"`, `"Action required from P2"`, `"Switch"`.

#### 6g — Toast UX ERROR (A32 front)
- [ ] `duel-page.component.html` (ou service toast existant) : afficher
      le `ErrorMsg.message` reçu via `wsService` (perspective-agnostique).

**Specs verts** :
- [ ] `T-F5` — single connection in SOLO.
- [ ] `T-F8` — perspective persisted to localStorage.
- [ ] `T-F9` — setupRematchEffect fires on single signal.
- [ ] `T-F13` — REMATCH_STARTING resets `_boardActive`.
- [ ] `T-F14` — banner button disabled during switching.
- [ ] `T-F17` — REMATCH_REQUEST single send in SOLO.
- [ ] `T-F18` — ERROR message → toast UX.
- [ ] **Server-side** : T-S14 — REMATCH_REQUEST SOLO court-circuit.

**Diff attendu** : ~400 LOC, ~6 fichiers (orchestrator, duel-page,
client-message-router, 2 i18n).

---

### Commit 6bis — Lifecycle SOLO additionnels (A29 + A30)

**Scope** : `resendPendingPrompt × 2` au reconnect + `WORKER_CANCEL_DONE`
routing-to-0. Côté serveur, mais arrive logiquement après commit 6
parce qu'il dépend du front PerspectiveSlot pour être testable end-to-end.

**Fichiers touchés** :
- [ ] **A29** — `server.ts:1072` (reconnect) :
      ```ts
      if (session.soloMode) {
        resendPendingPrompt(session, 0);
        resendPendingPrompt(session, 1);
      } else { resendPendingPrompt(session, playerIndex); }
      ```
- [ ] **A30** — `worker-message-router.ts:137-186` (`case 'WORKER_CANCEL_DONE'`) :
      branche `dest = session.soloMode ? 0 : p` ; `filterMessage` en
      mode omniscient en SOLO ; 3 sends (STATE_SYNC + CHAIN_STATE +
      cached prompt) routés au socket 0 avec `player=p` dans les payloads.

**Specs verts** :
- [ ] `T-S13` — resendPendingPrompt × 2 in SOLO reconnect.
- [ ] `T-S15` — WORKER_CANCEL_DONE SOLO routed to socket 0.

**Diff attendu** : ~80 LOC, ~2 fichiers serveur.

---

### Commit 7 — Tests : `WebSocketFactory` + rewrite `phase-gamma-victory.spec` + Playwright (A15 + A25)

**Scope** : refactor injection `WebSocket` pour permettre mock propre.
Réécriture `phase-gamma-victory.spec.ts` (T-F6). Playwright Scenarios A-E.

**Fichiers touchés** :

#### 7a — Injection `WebSocketFactoryService`
- [ ] Nouveau `duel-connection.factory.ts` (ou inline en haut de
      `duel-connection.ts`) :
      ```ts
      @Injectable({ providedIn: 'root' })
      export class WebSocketFactoryService {
        create(url: string): WebSocket { return new WebSocket(url); }
      }
      ```
- [ ] `duel-connection.ts` ctor : `inject(WebSocketFactoryService)`.
- [ ] `openConnection()` : `this.ws = this.factory.create(...)`.

#### 7b — Sites de construction `DuelConnection` (A25)
- [ ] `duel-web-socket.service.ts:51` (`_defaultConnection` PvP normal).
- [ ] `solo-duel-orchestrator.service.ts:init()` (1 site post-commit 6).
- [ ] `replay-duel-adapter.ts` : **vérifier** (selon CLAUDE.md, n'utilise
      PAS `DuelConnection`. Confirmer au commit.).
- [ ] Tests `duel-connection.spec.ts` (~4 sites) : `TestBed.overrideProvider`.

#### 7c — Réécriture `phase-gamma-victory.spec.ts` (T-F6 nouveau)
- [ ] **Supprimer** T2 / T7 / T10 vacuous (C4.5 M9, C4.6 M10, C4.7 M11)
      qui mockent `notifyPerspectiveSwitch`.
- [ ] **Supprimer** T4 R1 checkpointLog (instrumentation disparaît).
- [ ] **Ajouter T-F6** `solo-multiplex.spec.ts` : scénario chain complet
      (MSG_CHAINING + MSG_CHAIN_SOLVING + switchPerspective + MSG_CHAIN_END)
      via `MockWebSocket`, vérif zéro Lock safety timeout + zéro
      POLL-DROP REGRESSION + `activeChainLinks` cohérent.

#### 7d — Playwright Scenarios A-E
- [ ] Scenario A — chain SOLO basique + screenshot (preuve 1 carte voyage).
- [ ] Scenario B — bootstrap SOLO (5 MSG_DRAW initiaux s'animent 1× chacun).
- [ ] Scenario C — rematch SOLO (5 MSG_DRAW du nouveau duel s'animent).
      **Vérifier en particulier le finding BH-9 du code review c4.4 (2026-05-28)** :
      la transition `roomState: 'duel-loading' → 'active'` doit se déclencher
      après REMATCH_STARTING pour que `DuelLoadingEffectsService` re-flippe
      `_boardActive = true` (A23 reset au REMATCH_STARTING dépend de cette
      chaîne pour fonctionner). Si le rematch saute la dice arena, vérifier
      que la chaîne `duel-loading → active` est néanmoins activée par le
      BOARD_STATE du nouveau duel. Sinon les BOARD_CHANGING events restent
      parqués dans `_preActivationBuffer` indéfiniment.
- [ ] Scenario D — rematch court-circuit + F5 grace (A27 + A31).
- [ ] Scenario E — cancel-rollback slot 1 (A30).

**Specs verts** :
- [ ] T-F6 vert avec vrai pipeline via MockWebSocket.
- [ ] Tous les Scenarios A-E passent sans warn console.

**Diff attendu** : ~600 LOC, ~10 fichiers (factory + tests + Playwright).

---

### Commit 8 — Cleanup (drop code mort)

**Scope** : retirer `_sharedProcessor`, `bindTransports`,
`bindSharedProcessor`, `_defaultConnection` orphan, `_transport_connections`,
`checkpointLog` R1 instrumentation.

**Fichiers touchés** :
- [ ] `duel-web-socket.service.ts` : drop tous les fields/méthodes listés.
- [ ] `solo-duel-orchestrator.service.ts` : drop les appels obsolètes.
- [ ] `room-api.service.ts` : `wsToken2?: string` → marquer deprecated
      avec commentaire "supprimé en δ" (suppression effective en phase δ
      séparée, hors PR2).

**Audit grep final** :
- [ ] `grep -r "_sharedProcessor" front/src/` → 0 résultat.
- [ ] `grep -r "bindTransports" front/src/` → 0 résultat.
- [ ] `grep -r "bindSharedProcessor" front/src/` → 0 résultat.
- [ ] `grep -r "_defaultConnection" front/src/` → 0 résultat (ou alias propre).
- [ ] `grep -r "_transport_connections" front/src/` → 0 résultat.
- [ ] `grep -r "checkpointLog" front/src/` → 0 résultat.
- [ ] `grep -r "broadcastToBoth" duel-server/src/` → 0 résultat (n'a jamais
      existé, vérif paranoïaque).

**Specs verts** :
- [ ] Tous les tests précédents restent verts.

**Diff attendu** : -300 LOC, ~3 fichiers.

---

### Acceptance PR2 (= acceptance finale Option C)

- [ ] **Tous tests existants PvP normal verts** (1518+ specs).
- [ ] **T-S1 à T-S17 verts** (17 nouveaux specs serveur).
- [ ] **T-F1 à T-F18 verts** (18 nouveaux specs front).
- [ ] **Scenarios Playwright A-E passent** sans Lock safety timeout, sans
      POLL-DROP REGRESSION, sans warn console.
- [ ] **Audit grep final clean** (cf. commit 8).
- [ ] **CLAUDE.md updated** :
  - [ ] Doctrine "1 processor par duel" reformulée en "1 connection par duel".
  - [ ] Mentions R1/R8 retirées.
  - [ ] Doctrine "Information disclosure under omniscient SOLO" (A10).
  - [ ] Doctrine "routing-to-0 selon whitelist en SOLO" (A28).
- [ ] **Findings clos** dans :
  - [ ] `phase-gamma-post-review-findings.md` : Cluster C1 (6 BLOCKER)
        + C2.1 + C4.9 marqués clos.
  - [ ] `phase-gamma-option-c-latent-bugs-review.md` : 12 findings 3e
        passe marqués clos.

**Rollback PR2** : revert intégral en lockstep (front + back ensemble).
PR1 reste en prod (additif strict, n'affecte pas γ).

---

## Mapping amendments → commits (vérification croisée)

Pour chaque amendment de la spec §13, le commit cible. Cocher chaque
ligne au fil de l'implémentation pour garantir 38/38.

### Passage 1 (A1-A17)

- [x] **A1** — PR1 c2b — `sendToPlayer` no-op-on-1. ✅ 2026-05-28
- [x] **A1bis** — PR1 c2c — DUEL_STARTING SOLO initial `bothCardCodes`. ✅ 2026-05-28
- [x] **A2** — PR1 c1 — Validation stricte `forPlayer` PvP rejected. ✅ 2026-05-28
- [x] **A2bis** — PR1 c1 — CANCEL rate-limit lâche SOLO documenté. ✅ 2026-05-28
- [x] **A3** — PR1 c2e — Lifecycle helpers. ✅ 2026-05-28
- [ ] **A4** — PR2 c6b — setupRematchEffect 1-connection.
- [ ] **A5** — PR2 c6c, c6d — Perspective localStorage persist + clear.
- [x] **A6** — PR1 c2d — Session register 1 token SOLO. ✅ 2026-05-28
- [ ] **A7** — Méta (découpe 2 PRs) — acté.
- [ ] **A8** — PR2 c4a — PerspectiveSlot 8 fields (A33 reclasse `_lastDrawAnnouncedHash` global).
- [x] **A8.1** — PR1 c1b — `InactivityWarningMsg.player`. ✅ 2026-05-28
- [x] **A8.2** — PR1 c1b — `WaitingResponseMsg.targetPlayer`. ✅ 2026-05-28
- [ ] **A9** — PR2 c4c, c5 — `lastSentForPlayer` memoize.
- [x] **A10** — PR1 c2a — Doctrine omniscient SOLO commentée. ✅ 2026-05-28
- [x] **A11** — PR1 c2a — DICE_RESULT skip SOLO clarifié. ✅ 2026-05-28
- [ ] **A12** — Méta (PR2 atomique) — acté.
- [ ] **A13** — PR2 c6f — Banner cross-slot.
- [ ] **A14** — PR2 c6c — `setBoardActive` supprimé.
- [ ] **A15** — PR2 c7a — `WebSocketFactoryService`.
- [ ] **A16** — Méta (estimate) — n/a code.
- [ ] **A17** — PR2 c4e — BOARD_STATE swap étendu.

### Passage 2 (A18-A26)

- [x] **A18** — PR1 c3 — `ws.on('close')` SOLO sans grace. ✅ 2026-05-28
- [x] **A19** — PR1 c2c — WAITING_RESPONSE émission SOLO. ✅ 2026-05-28
- [x] **A20** — PR1 c2c — DUEL_STARTING reconnect SOLO. ✅ 2026-05-28
- [x] **A21** — PR2 c5b (soloModeSource + slotIndex ✅ 2026-05-29) + c5c (sendForPlayer + 7 sendXxx tagging ✅ 2026-05-29) + c6a (pair flip in init() : conn.soloMode + wsService.setSoloMode AVANT connect() ✅ 2026-05-29).
- [x] **A22** — PR2 c4.3 (sendResponse slot-clear ✅ 2026-05-28) — `sendResponse` clear slot.
- [x] **A23** — PR2 c4.4 (REMATCH_STARTING _boardActive=false ✅ 2026-05-28) — REMATCH_STARTING `_boardActive=false`.
- [ ] **A24** — PR2 c6f — Banner button disabled.
- [ ] **A25** — PR2 c7b — WebSocketFactory sites inventaire.
- [ ] **A26** — Méta (estimate) — n/a code.

### Passage 3 (A27-A38)

- [ ] **A27** — PR2 c6b + c6e — Rematch SOLO court-circuit (front + server).
- [x] **A28** — PR1 c2b (vide ✅ 2026-05-28) + PR2 c4.5 (peuplé ✅ 2026-05-28) — Whitelist routing.
- [ ] **A29** — PR2 c6bis — resendPendingPrompt × 2.
- [ ] **A30** — PR2 c6bis — WORKER_CANCEL_DONE routing.
- [x] **A31** — PR1 c3 — Post-duel grace cleanup SOLO (via `rematchTimeout` armé en SOLO). ✅ 2026-05-28
- [ ] **A32** — PR1 c1b (ErrorMsg type ✅ 2026-05-28) + PR2 c4g (toast) + PR2 c6e (sendToPlayer).
- [ ] **A33** — PR2 c4a — `_lastDrawAnnouncedHash` reste GLOBAL.
- [ ] **A34** — PR2 c4b — MSG_HINT inheritance intra-slot.
- [ ] **A35** — PR2 c6f — i18n keys banner.
- [x] **A36** — PR1 c2a — `throw` (pas de `duelAssert` côté serveur) first-player-coordinator. ✅ 2026-05-28
- [x] **A37** — PR1 c1b (proto ✅ 2026-05-28) + PR2 c5a (server populate ✅ 2026-05-29) + PR2 c5c (fallback front 3-niveaux ✅ 2026-05-29).
- [ ] **A38** — Méta (estimate ~18.75j) — n/a code.
- [x] **A39** — PR2 c5b (helper slotIndex SOLO ? perspective : ownPlayerIndex avec narrow duelAssert + clamp défensif prod ✅ 2026-05-29).
- [x] **A39-bis** — PR2 c5d (MSG_HINT broadcast intra-slot via SAFE_PUBLIC_HINT_TYPES dupliquée front, écrit les 2 slots quand broadcast ✅ 2026-05-29). Découvert via BMad code review c4.2 (2026-05-28).

**39 amendments. À cocher 39 fois.**

---

## Gardes globaux à honorer à chaque commit

- [ ] Pas de `--no-verify` (hook pré-commit lint stylelint+eslint+DS).
- [ ] `scripts/check-ws-protocol-sync.mjs` passe (pré-build duel-server).
- [ ] `npm test` (front) + `npm test` (duel-server) verts.
- [ ] Pas d'amendement A non-coché en fin de commit ciblé.
- [ ] Pas de TODO/FIXME laissé dans le code (annoter dans la checklist
      si différé volontairement).

---

## Notes méthodologiques

- Le mapping §13 de la spec est **la source de vérité**. Cette checklist
  est une **vue projetée par commit** pour faciliter l'exécution. En cas
  de divergence, la spec gagne.
- Si un commit est gros (~3.5j pour c4), il peut être splitté en commits
  internes sans changer le compte. Garde le scope, garde le mapping
  amendments → commit.
- À chaque PR (1 et 2), copier cette checklist dans la PR description et
  cocher au fur et à mesure des reviews.
- Si un finding nouveau émerge en cours de route, l'ajouter en bas comme
  "A39+" avec ID + commit cible + spec ID test. Pas de fix silencieux.
