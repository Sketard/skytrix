---
title: γ-c Playwright sessions — dette c9
status: deferred (post-merge γ-c)
branch: feat/gamma-option-c
date: 2026-05-29
context: décidé lors du sub-commit c7 (BMad code review + Axel)
---

# γ-c Playwright sessions — dette c9

## Pourquoi un memo

Le sub-commit c7 (PR2 γ-c) livre les **tests unitaires** du multiplex
SOLO :

- **c7a** (commit `40ef4a2d`) : `WebSocketFactoryService` injection
  (A15 + A25). Default = `new WebSocket(url)` quand le ctor option
  `wsFactory` est absent. 3 prod sites migrés (`DuelWebSocketService`,
  `SoloDuelOrchestratorService.init`, `replay-duel-adapter` confirmé
  non-instancié). Spec dédiée 3 tests. 1612/1612 verts.

- **c7b** (commit `6b43f12c`) : T-F6 chain SOLO multiplex via
  `MockWebSocket` EventTarget-based + réécriture
  `phase-gamma-victory.spec.ts`. 5 scenarios T-F6 (chain accumulate +
  drain, fresh chain perspective=1, mono-connection, switch in
  `'resolving'`, double switch). 1612/1612 verts.

Mais les **tests d'intégration live-stack** (Scenarios A-E définis dans
la spec §7.5) restent en dette parce que :

1. Ils exigent la stack complète UP (back 8080 + duel-server 3001 +
   front 4200) — incompatible avec une session unitaire autonome.
2. Chaque scénario nécessite une scripted user action complexe (chain
   activation, rematch, F5 grace, right-click cancel) qui dépend du
   contenu de la base + d'un deck chain-capable seedé.
3. Le harness `front/e2e/solo-pvp-harness.ts` (414 LOC) est en place
   depuis γ commit 7b, mais les scenarios concrets (B-E) demandent un
   debug session dédié pour itérer sur les sélecteurs CSS et les
   timings live.

Une session "γ-c Playwright" dédiée est planifiée post-merge γ-c pour
fermer cette dette.

## Inventaire des scenarios déférés

### Scenario A — chain SOLO basique (template livré c7c)

**Statut** : template livré `front/e2e/solo-scenario-a-chain-basic.spec.ts`
mais **non exécuté** ; le test scripted "click card P0 → wait resolving
→ switch → wait idle → assertions" reste à écrire et à valider live.

**Couverture cible** :
- P0 active une carte ⇒ MSG_CHAINING(1, P0).
- P1 chaîne Maxx C ⇒ MSG_CHAINING(2, P1).
- User switch perspective pendant chain.
- Chain resolve normalement.
- **Assertions** : zéro `Lock safety timeout` console + zéro
  `POLL-DROP REGRESSION` + screenshot frame mid-anim montrant 1 seule
  carte qui voyage par MSG_MOVE (preuve visuelle anti-C1).

**Couverture unit équivalente** : c7b T-F6 #1 + #4 (switch en
`'resolving'`) prouvent l'invariant cardinal en unit. Le live-stack
ajoute la preuve visuelle + l'absence de race lock-timeout.

### Scenario B — bootstrap SOLO

**Statut** : NON livré.

**Couverture cible** :
- POST /api/rooms/quick-duel + 1 socket connect.
- `isReadyToStart` SOLO true ⇒ DUEL_STARTING ⇒ 5 MSG_DRAW initiaux.
- L'utilisateur voit 5 cartes différentes en main (preuve qu'aucun
  double-fire n'a regroupé les draws — pre-activation buffer A1bis +
  c2a OK).

**Couverture unit équivalente** : T-S9 + T-S12 (DUEL_STARTING
`bothCardCodes` initial + reconnect). Le live-stack confirme le
bootstrap visuel complet.

### Scenario C — rematch SOLO

**Statut** : NON livré. ⚠️ Inclut **finding BH-9 c4.4 (2026-05-28)**.

**Couverture cible** :
- End du 1er duel ⇒ REMATCH_STARTING ⇒ nouveau worker spawn ⇒ nouveau
  BOARD_STATE ⇒ 5 MSG_DRAW initiaux du rematch s'animent (A23).
- **Vérifier en particulier** : la transition `roomState:
  'duel-loading' → 'active'` doit se déclencher après REMATCH_STARTING
  pour que `DuelLoadingEffectsService` re-flippe `_boardActive = true`
  (A23 reset au REMATCH_STARTING dépend de cette chaîne).
- Si le rematch saute la dice arena, vérifier que la chaîne
  `duel-loading → active` est néanmoins activée par le BOARD_STATE du
  nouveau duel ; sinon les BOARD_CHANGING events restent parqués dans
  `_preActivationBuffer` indéfiniment.

### Scenario D — rematch court-circuit + F5 grace (A27 + A31)

**Statut** : NON livré. **Inclut T-S13 deferred c6bis** (SOLO reconnect
× 2 server-side).

**Couverture cible** :
- End du 1er duel ⇒ user F5 immédiatement (avant click "Rematch").
- Reconnect réussit (A31 grace cleanup post-duel SOLO).
- User click "Rematch" 1 fois ⇒ rematch démarre sans gate "both
  requested" (A27 serveur court-circuit).
- Preuve A27+A31 fonctionnent en combinaison + T-S13 (serveur
  `resendPendingPrompt × 2` au reconnect SOLO).

### Scenario E — cancel-rollback slot 1 SOLO (A30)

**Statut** : NON livré.

**Couverture cible** :
- Chain Maxx C (slot 1 prompt) ⇒ user switch perspective vers 1 ⇒
  right-click pour cancel ⇒ WORKER_CANCEL_DONE.
- Socket 0 reçoit STATE_SYNC + CHAIN_STATE + prompt avec `player=1`.
- `_slots[1]` ré-init proprement, aucune desync, aucun strike count.
- Preuve A30 (WORKER_CANCEL_DONE routing-to-0 SOLO + filterMessage
  omniscient) fonctionne en bout-en-bout.

### T-S13 — SOLO reconnect × 2 (server-side e2e)

**Statut** : NON livré. **Référencé en c6bis** (A29 server-side).

**Couverture cible** :
- SOLO reconnect avec `lastSentPrompt[1]` non-null.
- Socket 0 reçoit hint + prompt slot 1 (A29 serveur
  `resendPendingPrompt × 2`).
- Vérifie que la logique triviale (`if soloMode: 2 calls`) marche en
  pratique en bout-en-bout, vs unit testée trivialement.

Couvert plus richement par Scenario D ci-dessus (F5 mid-prompt).

## Pré-requis pour la session c9

1. **Stack complète UP** : back 8080 + duel-server 3001 + front 4200.
2. **Admin user seedé** avec au moins 1 deck chain-capable (D/D,
   Eldlich, Spright, ou équivalent — recommandé : "D/D" pour la
   reproductibilité de bug-solo-sequence.md §2).
3. **Harness en place** : `solo-pvp-harness.ts` (livré γ commit 7b),
   `solo-pvp-harness-smoke.spec.ts` (smoke check du module), template
   `solo-scenario-a-chain-basic.spec.ts` (livré c7c, à compléter).

## Pattern de session

1. Copier le template Scenario A pour B/C/D/E.
2. Identifier les sélecteurs CSS via DevTools (la chain card P1, le
   bouton "Rematch", le menu right-click pour cancel).
3. Scripter l'action utilisateur dans le spec (`page.click`,
   `page.keyboard.press`, etc.).
4. Utiliser les helpers `harness.waitForChainResolving` /
   `waitForChainIdle` / `capture` / `switchPerspective`.
5. Vérifier `_bmad-output/debug-solo/<tag>/report.md` après chaque run
   pour les warnings + `Lock safety timeout` + `POLL-DROP REGRESSION`.

## Référence

- Spec source : `_bmad-output/planning-artifacts/phase-gamma-option-c-multiplex-spec.md §7.5`.
- Checklist : `_bmad-output/planning-artifacts/phase-gamma-option-c-implementation-checklist.md` commit 7d.
- Harness : `front/e2e/solo-pvp-harness.ts` (γ commit 7b).
- Bug original : `_bmad-output/planning-artifacts/bug-solo-sequence.md`.
- Audit BH-9 c4.4 : `_bmad-output/planning-artifacts/phase-gamma-option-c-post-review-findings.md` (rematch transition `roomState`).
