---
title: Phase γ Option C — Latent bugs review (3e passe adversariale)
status: review-complete
date: 2026-05-28
parent_spec: phase-gamma-option-c-multiplex-spec.md
reviewer: Claude (contexte frais)
findings_total: 12
severity_max: BLOCKER
---

# Phase γ Option C — Latent bugs review

**Date** : 2026-05-28
**Reviewer** : Claude (contexte frais, 3e passe)
**Findings totaux** : 12
**Sévérité max** : BLOCKER

## Méthode

Lu intégralement la spec (1719 lignes) + 10 fichiers source. Cibles principales : [server.ts:460-1200](duel-server/src/server.ts), [worker-message-router.ts](duel-server/src/worker-message-router.ts), [client-message-router.ts](duel-server/src/client-message-router.ts), [timer-management.ts](duel-server/src/timer-management.ts), [message-filter.ts](duel-server/src/message-filter.ts), [first-player-coordinator.ts](duel-server/src/first-player-coordinator.ts), [duel-connection.ts](front/src/app/pages/pvp/duel-page/duel-connection.ts), [duel-web-socket.service.ts](front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts), [solo-duel-orchestrator.service.ts](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts), [http-helpers.ts](duel-server/src/http-helpers.ts). 15 greps croisés sur `.connected`, `players[]`, `lastSentPrompt`, `WAITING_RESPONSE`, `sendToPlayer`, `safeSend`, `REMATCH_INVITATION`, `soloMode`, `sendXxx`, `opponentIndex`, `pendingPlayer`, `ANIMATIONS_DONE`.

---

## Findings

### Finding 1 — Rematch SOLO multiplex dead-locked par construction
- **Angle** : B (composition A1 × spec §4.1 A4) + D (site oublié)
- **Sévérité** : **BLOCKER**
- **Le bug** : `client-message-router.ts:174-184` — la gate REMATCH_REQUEST nécessite `session.rematchRequested[opponentIdx]=true` pour appeler `startRematch`. Le serveur envoie d'abord `REMATCH_INVITATION` à l'opponent ligne 182. En SOLO multiplex avec `forPlayer=0`, `opponentIdx=1`, `send(session, 1, REMATCH_INVITATION)` → **no-op-on-1 (A1) drop silent**. Le front `_slots[1].rematchState` reste `'idle'` à jamais ⇒ pas de 2e `sendRematchRequest` ⇒ `rematchRequested[1]` jamais `true` ⇒ `startRematch` jamais appelé. La spec A4 setupRematchEffect compte sur l'auto-accept déclenché par `rematchState === 'invited'` qui n'arrive jamais.
- **Évidence** : `client-message-router.ts:177-183` + spec §3.2 A1 (no-op-on-1) + spec §4.1 A4.
- **Why it matters** : Le user SOLO clique "Rematch", rien ne se passe. Bug bloquant feature SOLO core (chaînage de duels pour testing combo).
- **Remediation A27** : court-circuit serveur en SOLO :
  ```ts
  case 'REMATCH_REQUEST': {
    if (session.endedAt === null) break;
    session.rematchRequested[playerIndex] = true;
    if (session.soloMode) { cfg.startRematch(session); break; }
    const opponentIdx: Player = playerIndex === 0 ? 1 : 0;
    if (session.rematchRequested[opponentIdx]) cfg.startRematch(session);
    else send(session, opponentIdx, { type: 'REMATCH_INVITATION' });
  }
  ```
  Front : désactiver l'auto-accept A4 en SOLO (`if (this.wsService.soloMode) return;`).

---

### Finding 2 — INACTIVITY_WARNING slot 1 perdu en SOLO multiplex
- **Angle** : A (effet de bord A1 × A8.1) + D (site oublié de §3.6)
- **Sévérité** : **HIGH**
- **Le bug** : `timer-management.ts:268-292` — `sendWarning: (p, remainingSec) => c.sendToPlayer(session, p, INACTIVITY_WARNING)`. Quand le slot 1 est inactif en SOLO, `sendToPlayer(session, 1, …)` → no-op-on-1 (A1) → warning jamais reçu. Forfeit ligne 283-284 broadcast 0+1 = arrive au socket 0 mais le user voit un DUEL_END inactivity surprise sans avoir eu le warning préalable.
- **Évidence** : `timer-management.ts:274-277` + spec A8.1 (`InactivityWarningMsg.player` à ajouter).
- **Why it matters** : Forfeit slot 1 sans préavis → user SOLO perd un duel sans comprendre.
- **Remediation A28** : router au socket 0 en SOLO + ajouter `player` au payload :
  ```ts
  sendWarning: (p, remainingSec) => {
    const dest = session.soloMode ? 0 : p;
    c.sendToPlayer(session, dest, { type: 'INACTIVITY_WARNING', remainingSec, player: p });
  }
  ```

---

### Finding 3 — `resendPendingPrompt` reconnect SOLO ne re-émet qu'1 slot
- **Angle** : C (testabilité §8.4) + B (A20 oublie le pendant code)
- **Sévérité** : **HIGH**
- **Le bug** : §8.4 mentionne en passant "appeler `resendPendingPrompt(session, 0)` ET `(session, 1)`" mais **aucun amendment** n'inscrit cette correction dans §3.6 ou §6.2 (PR2). `server.ts:1072` appelle `resendPendingPrompt(session, playerIndex)` — en SOLO multiplex `playerIndex` = 0 (handshake unique). Un F5 perspective=1 avec `lastSentPrompt[1]` actif perd ce prompt côté client ⇒ `_slots[1].pendingPrompt` reste null après reconnect ⇒ banner A13 "Action requise de P2" jamais affiché ⇒ partie bloquée.
- **Évidence** : `server.ts:1149-1156`. §3.6 ne liste pas ce site.
- **Why it matters** : F5 SOLO mid-duel perspective=1 = partie silencieusement bloquée.
- **Remediation A29** : patcher au commit 3 (PR2) :
  ```ts
  if (session.soloMode) {
    resendPendingPrompt(session, 0);
    resendPendingPrompt(session, 1);
  } else {
    resendPendingPrompt(session, playerIndex);
  }
  ```

---

### Finding 4 — Cancel-rollback STATE_SYNC slot 1 perdu en SOLO multiplex
- **Angle** : A (effet de bord A1) + B (composition A22 × WORKER_CANCEL_DONE)
- **Sévérité** : **HIGH**
- **Le bug** : `worker-message-router.ts:137-186` `case WORKER_CANCEL_DONE` — `const p = wmsg.playerIndex` puis 3 `send(session, p, …)` (STATE_SYNC, CHAIN_STATE, cached prompt). Le worker tague `p` selon identité OCGCore. En SOLO avec cancel sur slot 1 (right-click slot 1), tous 3 sends → no-op-on-1 → le front `_slots[1]` ne reçoit jamais le rollback ⇒ serveur (ligne 178 `awaitingResponse[1]=true` avec NOUVEAU prompt) vs client (`_slots[1]` toujours sur OLD prompt) desync immédiat. Le user re-clique, l'invalid count monte, DUEL_END too_many_invalid.
- **Évidence** : `worker-message-router.ts:143-179`.
- **Why it matters** : Right-click cancel slot 1 SOLO = DUEL_END automatique après quelques essais.
- **Remediation A30** : router en SOLO au socket 0 pour les 3 sends de WORKER_CANCEL_DONE. Le `STATE_SYNC` filtered passe par `filterMessage(stateSync, p, /* omniscient */ session.soloMode)`.

---

### Finding 5 — Post-duel SOLO F5 pendant grace rematch ⇒ session cleanup prématuré
- **Angle** : D (sites NON listés dans §3.6) + B (composition A3 × ligne 1142 cleanup)
- **Sévérité** : **MEDIUM-HIGH**
- **Le bug** : `server.ts:1136-1144` — post-duel `ws.on('close')` envoie `sendToPlayer(s, opponentIndex, REMATCH_CANCELLED:opponent_left)` puis si `!players[0].connected && !players[1].connected` cleanup. En SOLO multiplex avec A3 `isFullyDisconnected` branché sur `players[0]` seul + A18 `players[1].connected` jamais flipé à true : un F5 post-duel (avant que le user clique "Rematch") ferme le socket 0 → la condition cleanup ligne 1142 devient `true` immédiatement → `cleanupDuelSession` → `sessionManager.terminate` → reconnect impossible. Le user revoit le lobby au lieu du dialog rematch.
- **Évidence** : `server.ts:1136-1144` + `server.ts:490` (connection timeout déjà OK car PvP cas équivalent).
- **Why it matters** : Régression UX critique : F5 post-duel SOLO empêche le rematch. Cas typique = "j'ai fini un combo test, je rafraîchis, je veux refaire le même match".
- **Remediation A31** : adapter ligne 1142 :
  ```ts
  if (!session!.players[0].connected && !session!.players[1].connected) {
    if (session!.soloMode && Date.now() - (session!.endedAt ?? 0) < rematchExpiryMs) {
      return;  // SOLO — preserve session for rematch grace window
    }
    cleanupDuelSession(session!);
  }
  ```

---

### Finding 6 — `client-message-router.ts:95` bypass `sendToPlayer` → ERROR silently dropped en SOLO slot 1
- **Angle** : A (effet de bord A1) + D (site direct safeSend non listé)
- **Sévérité** : **MEDIUM**
- **Le bug** : `client-message-router.ts:95-99` — la branche promptType mismatch fait `safeSend(session.players[playerIndex].ws, { type: 'ERROR', message: … })` direct (bypass `sendToPlayer`). En SOLO multiplex avec `forPlayer=1` qui envoie une réponse mismatch, `session.players[1].ws === null` (jamais attaché en SOLO multiplex post-A6) → `http-helpers.ts:29` silently no-op. Le user n'a aucun feedback d'erreur ; WORKER_RETRY re-broadcast cache, l'invalid count monte, DUEL_END too_many_invalid.
- **Évidence** : `client-message-router.ts:95-99`.
- **Why it matters** : Bug silencieux en debug + DUEL_END inattendu côté user.
- **Remediation A32** : remplacer par `cfg.sendToPlayer(session, playerIndex, { type: 'ERROR', … })` et inclure ERROR dans la liste routing-to-0 SOLO.

---

### Finding 7 — `_lastDrawAnnouncedHash` per-slot (A8) re-annonce sur switch perspective
- **Angle** : F (UX omniscient) + A (effet de bord A8 schéma de clé)
- **Sévérité** : **MEDIUM**
- **Le bug** : `duel-connection.ts:242, 979-984` — le hash est global aujourd'hui (`${turnPlayer}:${turnCount}`). Spec §4.3 A8 propose la clé per-slot composite `${slotPlayer}:${turnPlayer}:${turnCount}`. **Avec cette clé, en SOLO multiplex omniscient** où les 2 slots voient tous les MSG_DRAW, switcher de perspective entre 2 MSG_DRAW d'un même turn produit deux annonces (slot 0 a déjà hashé `0:P:C`, slot 1 commence avec hash null → nouvelle annonce). Double "Nouveau tour" visuel.
- **Évidence** : `duel-connection.ts:240-242, 978-984` + spec §4.3 A8 row `_lastDrawAnnouncedHash`.
- **Why it matters** : Régression visuelle subtile non couverte par T-F2 (qui ne switch pas perspective au milieu).
- **Remediation A33** : `_lastDrawAnnouncedHash` reste **GLOBAL** (la dédup turn est intrinsèquement globale), retirer la ligne `_lastDrawAnnouncedHash` du tableau A8 "9 fields per-perspective" et la mettre dans "Global, OK". Préciser que la clé reste `${turnPlayer}:${turnCount}`.

---

### Finding 8 — `_hintContext` per-slot sous-spécifié : inheritance cross-hint
- **Angle** : C (testabilité) + D (oubli §4.3 A8 nuance)
- **Sévérité** : **MEDIUM**
- **Le bug** : `duel-connection.ts:796-807` — handler MSG_HINT lit `prev = this._hintContext()` pour `canInherit` (préservation `cardName` à travers hints successifs de TYPE 10/13/15 → 3). Une implémentation naïve A8 lirait `this._slots[currentPerspective].hintContext` ⇒ inheritance cassée si l'utilisateur switch perspective entre 2 MSG_HINT du même slot. Le `prev` doit lire `_slots[message.player].hintContext`, pas le slot courant.
- **Évidence** : `duel-connection.ts:792-807`.
- **Why it matters** : Effects "card-naming" (Solemn Judgment qui hérite du nom de la cible Maxx C) perdent leur cardName en mid-chain. Subtil, non couvert par T-F1.
- **Remediation A34** : préciser §4.3 A8 — le `prev` MUST be `_slots[message.player].hintContext` (read of the SAME slot we're about to write). Ajouter T-F15 : `MSG_HINT(player=0, cardName='X', type=10)` puis `MSG_HINT(player=0, cardName='', type=3)` ⇒ `_slots[0].hintContext.cardName === 'X'`.

---

### Finding 9 — Banner A13 "Action requise de P{N+1}" non i18n
- **Angle** : F (UX réelle, i18n omis)
- **Sévérité** : **LOW**
- **Le bug** : Spec §4.6 A13 hardcode FR. skytrix supporte FR + EN (login-parameters-refresh-2026-05-16 mentionne 11 i18n keys récents). Aucun amendment ne mentionne `app-i18n` key pour ce banner.
- **Évidence** : Spec §4.6 snippet HTML.
- **Why it matters** : User EN voit FR dans une feature livrée.
- **Remediation A35** : ajouter une clé i18n `pvp.solo.actionRequiredP{n}` et utiliser le pipe `| translate`. ~5 min, mais omis = oublié au commit 6.

---

### Finding 10 — DICE_RESULT swap omniscient confus pour perspective=1 SOLO
- **Angle** : E (transition mode) + A (effet de bord §3.1 A10/A11)
- **Sévérité** : **LOW** (skippé en SOLO selon spec, mais protocole subsiste)
- **Le bug** : §3.1 A11 dit "DICE_RESULT skippé en SOLO car flow dés bypassé". Vrai pour le path `startFirstPlayerPhase` (`server.ts:578-584`). **Mais** `message-filter.ts:155-165` traite encore DICE_RESULT avec `forPlayer === 0 ? message : { swap }`. Avec A1 omniscient `filterMessage(_, 0, true)` (§3.1), le swap conditionne sur `forPlayer === 0` — donc en SOLO multiplex omniscient le DICE_RESULT n'est jamais swappé. Si jamais une régression future fait passer DICE_RESULT par le path SOLO, le user en perspective=1 verrait des dés sans swap. C'est juste un "future regression hazard" — pas un bug live.
- **Évidence** : `message-filter.ts:155-165` + spec A11.
- **Why it matters** : Filet de sécurité futur si l'A11 garde est levée par accident.
- **Remediation A36** (LOW) : ajouter une assertion en SOLO `duelAssert(!session.soloMode, 'DICE_RESULT in SOLO is unexpected')` au site d'émission, ou simplement noter la garde A11 dans `first-player-coordinator.ts` comme commentaire load-bearing.

---

### Finding 11 — Estimate §9 sous-évalue la cascade A27-A35
- **Angle** : G (estimate vs réalité)
- **Sévérité** : **MEDIUM** (gestion projet)
- **Le bug** : Spec §9 totalise 16.1j (~13j code + 3.1j doc). Les 10 nouveaux findings ajoutent ~2.0j cumulés.
- **Évidence** : Spec §9 (16.1j) vs somme nouveaux findings = ~2.0j additionnels.
- **Remediation** : ajouter **+2j** au tableau §9 → **~18.1j**, et documenter A27-A37 dans le mapping §13.

---

### Finding 12 — `_lastSentForPlayer` mémoire pour ANIMATIONS_DONE non spécifié pour les boundary cases
- **Angle** : C (testabilité A9/A21)
- **Sévérité** : **LOW**
- **Le bug** : A9 dit "le front trace le dernier `PLAYER_RESPONSE` émis avec son `forPlayer`. Sinon fallback `duelCtx.perspective()()`." Mais si l'utilisateur switche perspective vers 1 AVANT le premier prompt, et que le premier `SELECT_IDLECMD` arrive sur `player=0` ⇒ `scheduleTimerStart(0)` ⇒ `pendingPlayer=0`. Le front envoie alors `ANIMATIONS_DONE.forPlayer = perspective() = 1` ⇒ gate fail ⇒ timer ne démarre jamais ⇒ INACTIVITY forfeit P0 dans ~60s.
- **Évidence** : `client-message-router.ts:196-208` + spec A9 fallback rule.
- **Why it matters** : Cas edge bootstrap SOLO + switch précoce.
- **Remediation A37** : préciser A9 — le fallback doit être `pendingPlayer` du timer state (que le serveur expose dans TIMER_STATE) plutôt que `perspective()`.

---

## Things la spec a déjà bien couvert

- **F5 SOLO ⇒ DUEL_END draw_both_disconnect** : A18 résout proprement.
- **Impersonation PvP via `forPlayer`** : A2 strict validation. T-S6 couvre.
- **BOARD_STATE swap front perspective=1 + `boardStateAfter`** : A17 étend correctement.
- **`first-player-coordinator`** court-circuité SOLO ligne 578-584.
- **PvP normal ne tagge jamais `forPlayer`** : A21 garde explicite.
- **TIMER_STATE broadcast** : double-send sur 0+1 via sendTimerStateToAll → no-op-on-1 OK.

---

## Verdict

- **1 BLOCKER (F1)** : rematch SOLO cassé par construction.
- **3 HIGH (F2, F3, F4)** : régressions UX silencieuses.
- **1 MEDIUM-HIGH (F5)** : F5 post-duel SOLO empêche le rematch.
- **3 MEDIUM (F6, F7, F8)** : effets de bord A1 + sous-spec hash/hint.
- **1 MEDIUM (F11)** : sous-estimation effort.
- **3 LOW (F9, F10, F12)** : i18n + future regression hazard + bootstrap timer edge case.

Doctrine centralisée recommandée : "router-to-0 en SOLO selon whitelist" (PSEUDO_PAIRWISE_SOLO_ROUTED) couvrant 4 sites (WAITING_RESPONSE déjà via A19, + INACTIVITY_WARNING, + WORKER_CANCEL_DONE, + ERROR).
