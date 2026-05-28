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

### Commit 1 — `forPlayer` field + STRICT validation (A2 + A2bis)

**Scope** : étendre 7 ClientMessage avec `forPlayer?: 0|1`. Reject en PvP
normal (security A2). SOLO uniquement.

**Fichiers touchés** :
- [ ] `duel-server/src/ws-protocol-prompts.ts` — ajouter `forPlayer?: 0|1`
      à `PlayerResponseMsg`.
- [ ] `duel-server/src/ws-protocol-system.ts` — ajouter `forPlayer?: 0|1`
      à `SurrenderMsg`, `RematchRequestMsg`, `RequestStateSyncMsg`,
      `ActivityPingMsg`, `AnimationsDoneMsg`, `CancelPromptSequenceMsg`.
- [ ] `front/src/app/pages/pvp/duel-ws-types.ts` (mirror front) — sync
      les mêmes 7 interfaces.
- [ ] `duel-server/src/server.ts:1100-1117` — `ws.on('message')` handler :
      lit `parsed.forPlayer`, valide stricte (A2), calcule `live`.
- [ ] **A2bis** — `duel-server/src/client-message-router.ts:234-238` case
      `CANCEL_PROMPT_SEQUENCE` : ajouter commentaire load-bearing
      documentant que le rate-limit SOLO est bénignement bypassable.

**Specs verts** :
- [ ] `client-message-router.spec.ts` : `T-S2 forPlayer override
      currentPlayerIndex in SOLO`.
- [ ] `server.spec.ts` (nouveau ou extension) : `T-S6 forPlayer rejected
      with warn in PvP normal`.
- [ ] Tous les specs existants front + back verts.

**Sync check** : `scripts/check-ws-protocol-sync.mjs` passe.

**Diff attendu** : ~120 LOC, 5 fichiers touchés.

---

### Commit 1b — Extensions protocole additives (A8.1 + A8.2 + A37 + ErrorMsg)

**Scope** : 4 messages serveur étendus avec champs additifs optionnels
(back-compat strict). Pas de logique, juste les types. Préparation pour
PR1 commit 2 + PR2.

**Fichiers touchés** :
- [ ] `duel-server/src/ws-protocol-system.ts` :
  - [ ] `InactivityWarningMsg` — ajouter `player?: 0|1` (A8.1).
  - [ ] `WaitingResponseMsg` — ajouter `targetPlayer?: 0|1` (A8.2).
  - [ ] `TimerStateMsg` — ajouter `pendingPlayer?: 0|1` (A37).
  - [ ] **`ErrorMsg`** — créer le type (n'existe pas aujourd'hui ;
        `client-message-router.ts:96` envoie un `type:'ERROR'` non-typé).
        Shape : `{ type: 'ERROR'; message: string; player?: 0|1 }`.
        Inclure dans le union `ServerMessage` (`ws-protocol.ts:65`).
- [ ] `front/src/app/pages/pvp/duel-ws-types.ts` (mirror front) — sync.

**Specs verts** :
- [ ] Aucun spec nouveau requis (additif strict, optionnels back-compat).
- [ ] Tous les specs existants verts.

**Sync check** : `scripts/check-ws-protocol-sync.mjs` passe.

**Diff attendu** : ~30 LOC, 2 fichiers.

---

### Commit 2 — Server SOLO branches (A1 + A1bis + A10 + A11 + A28 vide + A19 + A20 + A36 + A6 + A3)

**Scope** : tout le routage SOLO côté serveur, mais **A28 whitelist VIDE**
(mécanique en place sans contenu). PR1 strictement additif.

**Fichiers touchés** :

#### 2a — Broadcast loop omniscient (A1 + A10 + A11)
- [ ] `duel-server/src/worker-message-router.ts:280-291` — brancher
      `if (session.soloMode)` → 1 envoi avec `filterMessage(_, 0, true)`.
- [ ] Commentaire A10 inline : "user is both players in SOLO".
- [ ] **A36** — `first-player-coordinator.ts:578-584` : ajouter
      `duelAssert(!session.soloMode, 'first-player-coordinator',
      'unreachable in SOLO')` en tête de `startFirstPlayerPhase`.

#### 2b — `sendToPlayer` no-op-on-1 + A28 whitelist (vide)
- [ ] `duel-server/src/server.ts:673-689` — `sendToPlayer` :
  - [ ] STATE_SYNC `gameLogEntries` branche (déjà en place — vérifier).
  - [ ] `if (session.soloMode && playerIndex === 1)` :
    - [ ] `if (PSEUDO_PAIRWISE_SOLO_ROUTED.has(message.type)) { safeSend(players[0].ws, message); return; }`
    - [ ] sinon `return` (no-op-on-1 pour broadcasts purs).
  - [ ] **`PSEUDO_PAIRWISE_SOLO_ROUTED` déclaré comme `Set` VIDE en haut
        de fichier**. Commentaire : "Populated in PR2 commit 4 — keeps
        PR1 strictly additive (no routing change for γ clients)".

#### 2c — DUEL_STARTING + WAITING_RESPONSE émissions SOLO
- [ ] **A1bis** — `server.ts:634-635` (site initial) : branche `soloMode`
      ⇒ 1 envoi avec `bothCardCodes: [extract(0), extract(1)]`.
- [ ] **A20** — `server.ts:1176` (site reconnect via `sendStateSnapshot`) :
      même branche SOLO avec `bothCardCodes`.
- [ ] **A19** — `worker-message-router.ts:266-267` : branche `soloMode`
      ⇒ `send(session, 0, { type: 'WAITING_RESPONSE', targetPlayer:
      opponentOfTarget })`. PvP normal : populate `targetPlayer` aussi
      (cohérence protocole).

#### 2d — POST quick-duel + session register SOLO 1-token
- [ ] **A6** — `server.ts:484` : `const tokens = soloMode ? [token0] :
      [token0, token1]; sessionManager.register(session, tokens);`.
- [ ] `server.ts:497` : POST response SOLO → `wsTokens: [token0]`.
- [ ] `front/src/app/pages/pvp/services/room-api.service.ts` : marquer
      `wsToken2?: string` optionnel (back-compat transitoire, supprimé en δ).

#### 2e — Lifecycle helpers (A3)
- [ ] Nouveau fichier `duel-server/src/lifecycle-helpers.ts` (ou inline
      dans `server.ts`) :
  - [ ] `isReadyToStart(session): boolean`.
  - [ ] `isFullyDisconnected(session): boolean`.
- [ ] `server.ts:1076` — `if (isReadyToStart(session))` au lieu de
      `players[0].connected && players[1].connected`.
- [ ] `server.ts:1142` — `if (isFullyDisconnected(session))`.
- [ ] `server.ts:490` — `s.players.every(p => !p.connected)` →
      `isFullyDisconnected(s)`.

**Specs verts** :
- [ ] `T-S1` — soloMode broadcast omniscient (1 send, filterMessage(_,0,true)).
- [ ] `T-S3` — POST SOLO returns 1 token.
- [ ] `T-S4` — lastSentPrompt indexed by message.player.
- [ ] `T-S5` — sendToPlayer no-op-on-1 in SOLO.
- [ ] `T-S7` — isReadyToStart in SOLO with 1 connected player.
- [ ] `T-S9` — DUEL_STARTING in SOLO carries bothCardCodes.
- [ ] `T-S11` — WAITING_RESPONSE in SOLO routed to socket 0.
- [ ] `T-S12` — DUEL_STARTING reconnect in SOLO carries bothCardCodes.
- [ ] Tous les specs PvP normal restent verts.

**Diff attendu** : ~350 LOC, ~5 fichiers serveur.

---

### Commit 3 — Lifecycle SOLO (A18 + A8 + A31 + isFullyDisconnected branché)

**Scope** : `ws.on('close')` SOLO sans grace logic, post-duel grace cleanup.

**Fichiers touchés** :
- [ ] **A18** — `server.ts:1120-1146` `ws.on('close')` handler :
  - [ ] Branche `if (session.soloMode)` : `pauseTurnTimer` +
        `clearInactivityTimer`. **PAS** de `startGracePeriod`, **PAS**
        de `OPPONENT_DISCONNECTED`, **PAS** de touche à `players[1].connected`.
  - [ ] Branche else (PvP normal) : inchangée.
- [ ] **A31** — `server.ts:1142` post-duel cleanup gate :
      `if (session.soloMode && session.endedAt !== null && Date.now()
      - session.endedAt < cfg.rematchExpiryMs) return;` avant le
      `cleanupDuelSession(session)`.
- [ ] Audit grep `players[1].connected` sur tout `duel-server/src/` :
      lister toute lecture. Confirmer qu'aucun site ne fait une
      assomption symétrique implicite qui casserait en SOLO multiplex
      (où `players[1].connected` reste `false` à jamais).

**Specs verts** :
- [ ] `T-S8` — isFullyDisconnected in SOLO.
- [ ] `T-S10` — SOLO close skips grace logic (no combinedGraceTimer armed).
- [ ] `T-S16` — post-duel grace cleanup SOLO.

**Diff attendu** : ~80 LOC, ~2 fichiers.

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

### Commit 5 — `DuelWebSocketService` computeds + `sendXxx` (A21 + A37)

**Scope** : `wsService` lit les 21 computeds transport-local via
`_connection.getXxxFor(perspective())()`. Les 7 `sendXxx` taggent
`forPlayer` **SOLO-only** (A21).

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

#### 6a — `init()` refondu mono-connection
- [ ] `solo-duel-orchestrator.service.ts:104-150` :
  - [ ] 1 seul `new DuelConnection(...)`, plus de `sharedProcessor` arg.
  - [ ] **A21** — `this.wsService.soloMode = true` flag.
  - [ ] **A5** — `restorePerspectiveFromStorage()` appelé après le connect.
  - [ ] `setupRematchEffect()` (singular).

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

- [ ] **A1** — PR1 c2b — `sendToPlayer` no-op-on-1.
- [ ] **A1bis** — PR1 c2c — DUEL_STARTING SOLO initial `bothCardCodes`.
- [ ] **A2** — PR1 c1 — Validation stricte `forPlayer` PvP rejected.
- [ ] **A2bis** — PR1 c1 — CANCEL rate-limit lâche SOLO documenté.
- [ ] **A3** — PR1 c2e — Lifecycle helpers.
- [ ] **A4** — PR2 c6b — setupRematchEffect 1-connection.
- [ ] **A5** — PR2 c6c, c6d — Perspective localStorage persist + clear.
- [ ] **A6** — PR1 c2d — Session register 1 token SOLO.
- [ ] **A7** — Méta (découpe 2 PRs) — acté.
- [ ] **A8** — PR2 c4a — PerspectiveSlot 8 fields (A33 reclasse `_lastDrawAnnouncedHash` global).
- [ ] **A8.1** — PR1 c1b — `InactivityWarningMsg.player`.
- [ ] **A8.2** — PR1 c1b — `WaitingResponseMsg.targetPlayer`.
- [ ] **A9** — PR2 c4c, c5 — `lastSentForPlayer` memoize.
- [ ] **A10** — PR1 c2a — Doctrine omniscient SOLO commentée.
- [ ] **A11** — PR1 c2a — DICE_RESULT skip SOLO clarifié.
- [ ] **A12** — Méta (PR2 atomique) — acté.
- [ ] **A13** — PR2 c6f — Banner cross-slot.
- [ ] **A14** — PR2 c6c — `setBoardActive` supprimé.
- [ ] **A15** — PR2 c7a — `WebSocketFactoryService`.
- [ ] **A16** — Méta (estimate) — n/a code.
- [ ] **A17** — PR2 c4e — BOARD_STATE swap étendu.

### Passage 2 (A18-A26)

- [ ] **A18** — PR1 c3 — `ws.on('close')` SOLO sans grace.
- [ ] **A19** — PR1 c2c — WAITING_RESPONSE émission SOLO.
- [ ] **A20** — PR1 c2c — DUEL_STARTING reconnect SOLO.
- [ ] **A21** — PR2 c5 — `sendXxx` garde SOLO-only.
- [ ] **A22** — PR2 c4c — `sendResponse` clear slot.
- [ ] **A23** — PR2 c4d — REMATCH_STARTING `_boardActive=false`.
- [ ] **A24** — PR2 c6f — Banner button disabled.
- [ ] **A25** — PR2 c7b — WebSocketFactory sites inventaire.
- [ ] **A26** — Méta (estimate) — n/a code.

### Passage 3 (A27-A38)

- [ ] **A27** — PR2 c6b + c6e — Rematch SOLO court-circuit (front + server).
- [ ] **A28** — PR1 c2b (vide) + PR2 c4f (peuplé) — Whitelist routing.
- [ ] **A29** — PR2 c6bis — resendPendingPrompt × 2.
- [ ] **A30** — PR2 c6bis — WORKER_CANCEL_DONE routing.
- [ ] **A31** — PR1 c3 — Post-duel grace cleanup SOLO.
- [ ] **A32** — PR1 c1b (ErrorMsg type) + PR2 c4g (toast) + PR2 c6e (sendToPlayer).
- [ ] **A33** — PR2 c4a — `_lastDrawAnnouncedHash` reste GLOBAL.
- [ ] **A34** — PR2 c4b — MSG_HINT inheritance intra-slot.
- [ ] **A35** — PR2 c6f — i18n keys banner.
- [ ] **A36** — PR1 c2a — `duelAssert(!soloMode)` first-player-coordinator.
- [ ] **A37** — PR1 c1b (proto) + PR2 c5 (fallback front).
- [ ] **A38** — Méta (estimate ~18.75j) — n/a code.

**38 amendments. À cocher 38 fois.**

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
