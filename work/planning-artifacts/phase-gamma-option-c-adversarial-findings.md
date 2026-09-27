---
title: Phase γ — Option C — Adversarial Review Findings
status: triage in progress
target_spec: phase-gamma-option-c-multiplex-spec.md
date: 2026-05-28
authors:
  - Winston (architect, synthesis)
reviewers:
  - Blind Hunter sub-agent (12 findings)
  - Edge Case Hunter sub-agent (15 findings + 3 state-machine gaps)
---

# Adversarial Review — Option C Multiplex SOLO

## Vue d'ensemble — 27 findings cumulés, triagés en 6 clusters

| Cluster | # findings | Sévérité max | Impact sur la spec |
|---|---|---|---|
| **R1 — `broadcastToBoth` invalide** | 1 (BH#1) | BLOCKER | §3.2.b à refonder |
| **R2 — `forPlayer` sécurité PvP normal** | 2 (BH#4, EC#11) | BLOCKER | §3.3 + §12 Q4 doivent inverser |
| **R3 — Lifecycle WS edges (close/reconnect/rematch)** | 5 (EC#1, EC#3, EC#4, EC#7, EC#13) | CRITIQUE | §3.5 + §4.1 + §6.2 + §8.4 incomplets |
| **R4 — PerspectiveSlot inventaire + sémantique** | 4 (BH#5, BH#9, EC#9, EC#12) | HIGH | §4.3 sous-spécifié |
| **R5 — Omniscient surface non auditée** | 3 (BH#2, BH#3, EC#10) | HIGH | §3.1 à compléter |
| **R6 — Migration ordering + tests + estimate** | 6 (BH#6, BH#10, BH#11, BH#12, EC#8, EC#14, EC#15) | HIGH | §6 + §7 + §9 à patcher |
| **R7 — BOARD_STATE swap incomplet** | 1 (BH#8) | MEDIUM | §4.5 à étendre |
| **R8 — UX switch-during-prompt undefined** | 1 (BH#11 / EC#5) | MEDIUM | §4.6 à acter |
| **R9 — `setBoardActive` semantics** | 1 (BH#10) | MEDIUM | §4.6 incomplet |
| **R10 — `ANIMATIONS_DONE` per-perspective tag dérivation** | 1 (EC#12) | MEDIUM | §3.3 à compléter |
| **R11 — Timer TIMER_STATE per-player** | 1 (EC#2) | LOW (confirm only) | §7 ajouter spec |

**Verdict des 2 reviewers** : spec **non-shippable as-is**. **2 BLOCKER + 5 CRITIQUE/HIGH** demandent une révision avant écriture de code. L'estimate doit passer de **6.5j → 8.5-10j** après amendments.

---

## Cluster R1 — `broadcastToBoth` est structurellement invalide

### BH#1 (BLOCKER)

Le helper `broadcastToBoth` proposé §3.2.b est construit sur une fausse prémisse : la majorité des appels "pairwise" envoient des payloads **différents** par destinataire — ce ne sont PAS des broadcasts.

**Évidence chirurgicale** :
- `server.ts:634-635` — `DUEL_STARTING` avec `playerIndex: 0|1` ET `cardCodes` per-player extraits via `extractCardCodesForPlayer(decks, 0)` vs `..., 1)`. Le commentaire ligne 632 dit explicitement *"sending the union would let the opponent's deck be reconstructed"*.
- `first-player-coordinator.ts:118-119` — `prompt0: {type:'DICE_ROLL', player:0}` vs `prompt1: {type:'DICE_ROLL', player:1}` (player field différent).
- `first-player-coordinator.ts:232-235` — DECK_PREFETCH + FIRST_PLAYER_RESULT, les deux per-player.
- `server.ts:685-686` — `sendToPlayer` lui-même réécrit STATE_SYNC avec `entriesForPlayer(session.gameLog, playerIndex)`. Routier via `broadcastToBoth` perdrait le journal per-perspective.

**Comptage réel des broadcasts pairwise-identiques** :
- ✅ Vrais broadcasts identiques : `REMATCH_STARTING`, `REMATCH_CANCELLED`, `DUEL_END` (terminaux), `TIMER_STATE`, `INACTIVITY_WARNING` — **~5 sites**.
- ❌ Pseudo-pairwise (payload différent) : `DUEL_STARTING`, `DECK_PREFETCH`, `FIRST_PLAYER_RESULT`, `DICE_ROLL` prompts, STATE_SYNC `gameLogEntries` — **~9 sites** qui DOIVENT rester sur `sendToPlayer`.

**Conséquence** : §3.2.b mal calibré. La bonne solution = **option 3.2.c modifiée** : `sendToPlayer` fait un **no-op silencieux quand `playerIndex === 1 && session.soloMode`**. Les ~5 vrais broadcasts deviennent naturellement 1 send en SOLO ; les ~9 pseudo-pairwise envoient le payload du `playerIndex=0` (le plus typique) et SKIP le `playerIndex=1` qui aurait dupliqué le 2e socket de toute façon — et qui en SOLO multiplex aurait écrit le **mauvais** payload.

**Amendement spec requis** : §3.2 — remplacer `broadcastToBoth` par no-op-on-1 dans `sendToPlayer`. Auditer les 9 sites pseudo-pairwise pour vérifier que le `playerIndex=0` send est suffisant en SOLO (et que le `playerIndex=1` perdu est dégénéré sans valeur).

**Cas particulier `DUEL_STARTING` cardCodes** : en SOLO, l'utilisateur EST les deux joueurs ⇒ le `cardCodes` du joueur 1 ne devrait pas être un secret. **Mais le payload utilisé sera celui du `playerIndex=0`** dans la stratégie no-op. Le front en SOLO multiplex devra recevoir l'UNION des deux cardCodes, ou les 2 messages successifs. **Décision nécessaire** : soit on étend `DUEL_STARTING` avec un champ `bothDecks?` en SOLO, soit on laisse passer les 2 sends en SOLO (réintroduit la double émission). Recommandation : étendre le payload (~0.1j).

---

## Cluster R2 — Validation `forPlayer` insuffisante = trou de sécurité PvP

### BH#4 (BLOCKER) + EC#11 (HIGH)

§12 Q4 recommande "ignore silently" pour le champ `forPlayer` quand il arrive en PvP normal. **C'est exactement la mauvaise décision**.

**Scénario d'attaque concret** :
1. Match PvP ranked. Client adversaire P1 ouvre son socket et obtient `players[1].ws`.
2. Pendant un prompt critique de P0 (SELECT_CHAIN pour Maxx C, par exemple), le client adverse P1 envoie `{ type: 'PLAYER_RESPONSE', promptType: 'SELECT_CHAIN', data: { index: null }, forPlayer: 0 }`.
3. Serveur lit `parsed.forPlayer ?? currentPlayerIndex()` = `0`. Dispatch comme si c'était P0 qui avait répondu.
4. **P0 a perdu son tour de Maxx C** — P1 vient de répondre à sa place avec `null`.

**Amendement spec requis** :
- §3.3 : `const live = session.soloMode ? (parsed.forPlayer ?? currentPlayerIndex()) : currentPlayerIndex();`
- §12 Q4 inverser : **strict validation** — si `!soloMode && forPlayer !== undefined`, **drop le message avec un `logger.warn`** + incrément du compteur `invalidResponseCount[currentPlayerIndex()]` (existe déjà côté client-message-router).
- Ajouter T-S6 spec : "PvP normal — `PLAYER_RESPONSE` avec `forPlayer` set est rejeté avec warning".

### EC#11 (cas similaire CANCEL_PROMPT_SEQUENCE)

`lastCancelAt[p]` rate-limit indexé par `forPlayer`. En SOLO, le user peut bypasser le rate-limit en alternant `forPlayer: 0/1`. **Bénin en SOLO** (c'est sa propre session) mais doit être documenté comme intentionnel. **Amendement spec** : §3.3 ajouter note "en SOLO le rate-limit per-perspective est lâche by design".

---

## Cluster R3 — Lifecycle WS edges (5 findings — CRITIQUE non couvert)

### EC#3 — `ws.on('close')` leak `players[1].connected=true` forever (CRITIQUE)

`server.ts:1120-1145` utilise `currentPlayerIndex() = 0` toujours en SOLO multiplex. Seulement `players[0].connected` est set à false. **`players[1].connected` reste true éternellement** (set au connect, jamais clear).

3 conséquences :
- (a) Cleanup grace-period ligne 1142 (`!players[0].connected && !players[1].connected`) **ne fire jamais post-duel** → session leak.
- (b) `OPPONENT_DISCONNECTED` envoyé à `opponentIndex=1` → routé via `sendToPlayer(s, 1, ...)` qui en SOLO multiplex écrit sur `players[0].ws` qui est la socket morte.
- (c) Reconnect path check `session.players[live].connected` — stale true bloque les reconnexions légitimes.

**Amendement spec requis** : §3.5 inventaire ajouter `ws.on('close')` (`server.ts:1120-1146`) — en SOLO le close unique marque `players[0].connected = players[1].connected = false` ; les `OPPONENT_DISCONNECTED` ne sont PAS envoyés en SOLO (no-op explicite) ; cleanup paths fire normalement.

### EC#1 — REMATCH_STARTING effect deadlock (HIGH)

`solo-duel-orchestrator.service.ts:230-247` gate le rematch reset sur `c[0].rematchStarting() && c[1].rematchStarting()` (BOTH true). En SOLO multiplex, REMATCH_STARTING arrive **1 fois** (1 socket) ⇒ seul `c[0].rematchStarting` flip à true, `c[1]` reste false **éternellement**. Le rematch ne reset jamais l'orchestrator → state-machine bloquée.

**Amendement spec requis** : §4.1 décrire explicitement le nouveau `setupRematchEffect` (1 connection) :
```ts
effect(() => {
  if (this._connection().rematchStarting()) {
    this.animationService.resetForSwitch();
    this.duelCtx.setPerspective(0);
    this._connection().resetRematchStarting();
    this._rematchReset.update(v => v + 1);
  }
}, { allowSignalWrites: true });
```

### EC#13 — Reconnect perspective restore (HIGH)

Aujourd'hui : front ouvre 1 socket SOLO. Serveur envoie `SESSION_TOKEN` + `BOARD_STATE` + `lastSentPrompt[0]` + `lastSentPrompt[1]`. Mais si le user était sur perspective=1 au disconnect, la perspective est reset à 0 par défaut au bootstrap ⇒ user voit le mauvais slot après reconnect.

**Amendement spec requis** : §8.4 étendre — persister la perspective courante en `localStorage` au moment de chaque `setPerspective`, restaurer au bootstrap SOLO multiplex.

### EC#4 — `players[1].reconnectToken` orphan (MEDIUM)

Tokens alloués pour `players[1]` jamais consommés en SOLO multiplex. `cleanupDuelSession` les drop à la fin, mais ils s'accumulent pendant le duel.

**Amendement spec requis** : §3.4 — en SOLO, **ne pas alloquer** `wsToken2` côté serveur (`sessionManager.register(session, [token0])` sans 2e token). Voir aussi finding EC#7 ci-dessous (migration order).

### EC#7 — γ-client + Option-C-server : 2e socket fail (HIGH)

Si commits 1-3 (serveur) déployés avant commits 4-6 (front), un γ-client encore en prod ouvre 2 sockets ; le 2e cherche `wsToken2` qui n'existe pas ⇒ serveur close avec 4001 ⇒ UI affiche "connection lost".

**Amendement spec requis** : §6.2 — **commits 1-3 NE peuvent PAS être déployés indépendamment** du commit 6. Soit on les groupe, soit on garde transitoirement `wsTokens: [token0, token1]` (token1 alloué mais inutile) pendant la fenêtre de déploiement, et le commit 3 (1-token POST) est différé en post-livraison.

### EC#8 — Option-C-client + γ-server : SELECT_* perdus (HIGH)

Symétrique : front Option-C en avance sur le serveur. Front ouvre 1 socket comme `players[0]`. γ-server filtre per-player ⇒ `SELECT_*` pour P1 part vers `players[1].ws` qui n'existe pas. User peut jouer P0 mais switchPerspective montre un panneau vide pour P1, sans erreur visible.

**Amendement spec requis** : §6.2 + §6.3 — explicitement **"no-rollback past commit 6"** — une fois la migration front shippée, on ne peut pas downgrader le serveur sans casser SOLO.

---

## Cluster R4 — PerspectiveSlot : inventaire incomplet, sémantique sous-spécifiée

### BH#5 (HIGH) — Fields manqués + sites ambigus

Le tableau §4.3 a au moins **3 erreurs ou omissions** :

1. **`_lastTurnPlayer` / `_lastTurnCount`** marqués NO ("BOARD_STATE global"). **Faux** : en SOLO multiplex les 2 perspectives passent par la MÊME connection ⇒ ces fields sont overwritten par chaque BOARD_STATE et la β.3 cas #13 DRAW announce hash devient incohérente pour le slot non-courant (cf. finding BH#9 / EC#9 ci-dessous).

2. **`_pendingPrompt.set(null)` sites sans `message.player`** : `duel-connection.ts:854` (DUEL_END handler), `:885` (REMATCH_STARTING handler). Spec silencieuse sur quel(s) slot(s) clearer. Comportement attendu : DUEL_END clear LES DEUX slots (terminal). REMATCH_STARTING idem.

3. **`INACTIVITY_WARNING` handler** (`:822-824`) écrit `_inactivityWarning` avec le payload — le message porte `.player` mais le tableau §4.3 oublie de spécifier la clef de routing.

**Amendement spec requis** : §4.3 — tableau complet refait avec colonnes **"Routing key"** + **"Reset rule"** (quel(s) slot(s) clearer sur DUEL_END / REMATCH_STARTING / STATE_SYNC).

### BH#9 / EC#9 — `_lastDrawAnnouncedHash` per-slot incohérent (MEDIUM)

Hash = `${_lastTurnPlayer}:${_lastTurnCount}` (turn coords globaux). Si on indexe per-slot par `MSG_DRAW.player` :
- Turn 5 P0 draws : `_lastTurnPlayer=0, _lastTurnCount=5` (globals). MSG_DRAW.player=0 → slot 0 hash flip à `0:5`. Slot 1 hash reste `null`.
- User switch à perspective=1 mid-turn. Aucun MSG_DRAW P1 (c'est le turn de P0). OK.
- Turn 6 P1's turn. `_lastTurnPlayer=1, _lastTurnCount=6`. MSG_DRAW.player=1 → slot 1 flip à `1:6`. OK.
- **Bug subtil** : slot 0 hash garde `0:5` (vieux). Si pour une raison X le serveur ré-émet un MSG_DRAW.player=0 (réplay debug, cas extreme), slot 0 ne re-annoncerait pas avec un `0:5` second draw. Bénin en pratique mais sémantique floue.

**Amendement spec requis** : §4.3 — clarifier que la clef de routing `_lastDrawAnnouncedHash` est `MSG_DRAW.player` ET le hash inclut le slot index : `${slotPlayer}:${turnPlayer}:${turnCount}`.

### EC#12 — `ANIMATIONS_DONE` per-perspective tag dérivation (MEDIUM)

`timer-management.ts:174-194` arme `pendingTimeout` en attendant `ANIMATIONS_DONE` du joueur cible. Aujourd'hui le client envoie depuis la conn de ce joueur. En multiplex, le SOLO user doit tagger `forPlayer` avec... qui ? Le `lastSentSelectMessage.player` (perspective dont la prompt vient de fermer) est le seul candidat fiable. Le front DOIT tracker ça.

**Amendement spec requis** : §3.3 ajouter règle de dérivation : `ANIMATIONS_DONE.forPlayer = lastSentPlayerResponse.forPlayer` (le tag du dernier PLAYER_RESPONSE émis sur cette connection). Sinon le timer ne s'arme jamais correctement.

---

## Cluster R5 — Surface omniscient non auditée (3 findings HIGH)

### BH#2 — `fork-handlers` ne prouve pas que omniscient SINGLE-perspective marche (HIGH)

§3.1 et §6.4 s'appuient sur `fork-handlers.ts:177-190` comme preuve que omniscient est testé en prod. **Mais fork-handlers loop `for ([idx, ps] of session.players.entries())` et appelle `filterMessage(message, idx, true)` pour idx 0 ET 1** — les transformations per-perspective (DICE_RESULT swap, BOARD_STATE turnPlayer remap, players[] swap) **continuent de fire par destinataire**. Option C dispatch `filterMessage(_, 0, true)` UNE FOIS. **Configuration jamais exercée en prod.**

**Conséquence** : DICE_RESULT en SOLO multiplex perspective=1 affichera des valeurs mal swappées (le swap se fait dans `filterMessage` lui-même conditionnellement sur `forPlayer`, jamais déclenché si on appelle toujours avec `forPlayer=0`).

**Amendement spec requis** : §3.1 + §4.5 — étendre le swap front au DICE_RESULT en SOLO perspective=1 (même pattern que BOARD_STATE).

### BH#3 — `MSG_SHUFFLE_HAND` / `MSG_DRAW` / MSG_MOVE depuis private location : identité révélée (HIGH)

`message-filter.ts:67-72` : `MSG_DRAW` / `MSG_SHUFFLE_HAND` en omniscient retournent `cards` intact. `:99-103` : MSG_MOVE depuis location privée garde `cardCode` en omniscient. **Sémantiquement correct en SOLO** (1 user = pas de secret) mais la spec n'a JAMAIS énuméré ce que le user gagne en visibilité après une perspective flip.

UX implications : pendant un duel SOLO perspective=0, l'utilisateur voit P0 picot une carte qu'il connaissait → puis switch perspective=1 → voit P1 picot ce qui aurait été masqué en duel réel. **C'est intentionnel en SOLO testing** mais nulle part documenté.

**Amendement spec requis** : §3.1 — paragraphe explicite "Information disclosure under omniscient SOLO : doctrine = `user is both players`, donc toutes les révélations sont visibles indépendamment de la perspective courante. Ce n'est PAS un bug, c'est le mode SOLO".

### EC#10 — `_confirmedCardsByChain` partagé global = leak des reveals privés (MEDIUM)

`MSG_CONFIRM_CARDS` avec `private: true` en omniscient ne masque pas le `cardCode`. Le `_confirmedCardsByChain` global (toutes perspectives) accumule. Switch perspective=0→1 et le user voit les reveals du chain link de l'autre.

Same doctrinal verdict : intentionnel en SOLO. **Amendement spec requis** : ajouter au paragraphe de R5/BH#3 mention explicite de MSG_CONFIRM_CARDS private.

---

## Cluster R6 — Migration, tests, estimate (6 findings)

### BH#6 — Commit 4 ne peut PAS shipper en isolation (HIGH)

§6.2 ligne 4 prétend que commit 4 (PerspectiveSlot front) est isolable des commits 5-6. **Faux** : avant le multiplex, conn0 et conn1 sont 2 instances DIFFÉRENTES de `DuelConnection`. Chaque instance aurait ses propres `_slots[0..1]`. `conn0._slots[1]` reste vide éternellement (le filtering serveur per-player envoie les P1 prompts à conn1 uniquement). `wsService.active()` lit `_transport_connections[perspective]` puis `.getPendingPromptFor(perspective)` ⇒ croise des indices incompatibles.

**Amendement spec requis** : §6.2 — commits 4+5+6 = **un seul PR atomique**. Granularité de rollback redécrite en §6.3.

### EC#7 + EC#8 — Migration ordering inverse (HIGH, déjà couvert R3)

Cf. cluster R3 ci-dessus.

### BH#10 — `setBoardActive(true)` retrait sans considérer le bootstrap (MEDIUM)

§4.6 retire l'appel `c[to].setBoardActive(true)` au switch en justifiant "1 socket, pas d'asymétrie". Mais le `_boardActive` flag gate le pre-activation buffer drain. Si l'user switch pendant l'initialisation, le drain reste mal gateé.

**Amendement spec requis** : §4.6 — explicitement décrire que `_boardActive` est un transport-flag (global, un seul) en SOLO multiplex, que `setBoardActive(true)` est appelé UNE FOIS au bootstrap (par `DuelLoadingEffectsService`), que `switchPerspective` ne touche PAS ce flag.

### BH#11 / EC#5 — UX switch-during-prompt undefined (MEDIUM)

Spec §4.6 préserve la garde `wsService.pendingPrompt() !== null` qui bloque le switch quand un prompt est actif. **Mais** : en SOLO multiplex, les 2 slots peuvent avoir `pendingPrompt` non-null simultanément. La garde lit lequel ?

UX implications : P0 a un SELECT_CHAIN actif (slot 0). P1 émet aussi un SELECT_CHAIN à cause de la chain (slot 1). User est sur perspective=0, voit la prompt P0. Réponds. Slot 0 prompt clear. Slot 1 prompt toujours active. User reste sur perspective=0 ⇒ ne voit aucun prompt mais le système attend P1.

**Amendement spec requis** : §4.6 décrire la politique :
- **Option a** — `pendingPromptAny()` computed = `_slots[0].pendingPrompt() || _slots[1].pendingPrompt()`. Switch bloqué si l'un OU l'autre actif. UX : user doit manuellement basculer perspective pour voir la prompt en attente.
- **Option b** — Auto-flip perspective à l'arrivée d'un prompt si la perspective courante n'a pas de prompt actif. UX : système gère la perspective ; user ne s'occupe que des réponses.
- **Option c** — Banner "Action requise de P1" sur perspective=0 quand `_slots[1].pendingPrompt()` actif. Click → switch perspective.

Recommandation : **option c** (la plus pédagogique, garde le user maître de sa perspective).

### EC#14 — T-F6 setup de test non décrit (MEDIUM)

§7.2 dit "T-F6 remplace M9 vacuous" sans décrire le scaffold. Karma+Jasmine ne fait pas de WebSocket réel. Sans approche définie, le test re-mock (vacuous round 2) ou s'évade en Playwright (pas CI-gating).

**Amendement spec requis** : §7.2 — définir l'approche : injection d'un `WebSocketFactory` token + `MockWebSocket` helper qui simule l'arrival sequence. Asserts : `processor.activeChainLinks().length === 1` (pas 2) après un `MSG_CHAINING`.

### BH#12 — Effort sous-estimé de 30-50% (LOW mais important)

§9 sum à 6.5j mais plusieurs lignes sous-budgétisent :
- Commit 2 (serveur broadcast) : audit des 14+ sites pseudo-pairwise (cf. R1) ajoute ~0.5j.
- Commit 4 (PerspectiveSlot) : avec les amendments R4 (routing complet) + R10 (`ANIMATIONS_DONE` derivation) → 2-2.5j (§4.3 revise déjà à 2.5j en interne mais headline reste 1.5j).
- Commit 7 (tests) : T-F6 vrai pipeline nécessite scaffold WebSocket mock — ~1.25j au lieu de 0.75j. Playwright scenario A & B avec fixtures = ~1j additionnel.

**Estimate révisé** : **8.5-10j** (au lieu de 6.5j).

### EC#15 — fork-solo convergence sous-estimée (LOW)

§11 "bonus 0.5j post-option-C" pour fork-solo. Réalité : le path fork-solo a aussi un `replay-page` composant structurellement différent de `duel-page`. Realiste 1-1.5j si on veut vraiment converger. **Amendement spec requis** : §11 réviser ou explicitement reporter la convergence au-delà du scope Option C.

---

## Cluster R7 — BOARD_STATE swap incomplet (BH#8)

§4.5 propose un swap front avant `syncAfterBoardState` + `processor.observeBoardState`. **Mais le processor passe aussi le payload à `BoundaryProcessor.observeBoardState`** + le BOARD_STATE alimente le DEP via l'EventStream.

Après un switch perspective 1→0→1, le BoundaryProcessor voit des `turnPlayer` alternants pour le MÊME turn serveur ⇒ émet des `TurnEnded`/`TurnStarted` spurious. Idem `boardStateAfter` per-event (snapshot durant chain résolvante) qui doit être swappé aussi (CLAUDE.md `swapEventBoardStates()` pattern replay).

**Amendement spec requis** : §4.5 — étendre le swap à :
- Le BoundaryProcessor (qui consume `data.turnPlayer` + `data.phase`). Le swap arrive en amont.
- `event.boardStateAfter` per-event en perspective=1 SOLO via `swapEventBoardStates()` (pattern existant ReplayDuelAdapter, lignes copy-paste-able).
- Le DEP qui consume l'EventStream — pareil, swap en amont suffit.

Spec à expliciter pour éviter "silent journal corruption sur switch".

---

## Cluster R8/R9/R10/R11 — Findings ponctuels

Couverts dans R3-R6 ci-dessus :
- R8 (UX switch-during-prompt) → BH#11 / EC#5 (cluster R6).
- R9 (`setBoardActive`) → BH#10 (cluster R6).
- R10 (`ANIMATIONS_DONE` derivation) → EC#12 (cluster R4).
- R11 (TIMER_STATE per-player) → EC#2 (cluster R6, simple confirmation test à ajouter).

---

## State machine gaps (récapitulatif EC)

1. **REMATCH_STARTING signal multiplicity** (R3 / EC#1) — transition `[rematchStarting=false, rematchStarting=false] → reset trigger` à redécrire pour 1 signal.
2. **`ws.on('close')` cleanup transition** (R3 / EC#3) — graphe `connected=true → connected=false` à recâbler en SOLO.
3. **Perspective at reconnect** (R3 / EC#13) — transition `perspective=1 (pre-disconnect) → perspective=??? (post-reconnect)` undefined.

---

## Things the spec got RIGHT (confirmé par les 2 reviewers)

- **Structural elimination over palliation** (§2.3) — le raisonnement "1 socket élimine 7 findings par construction" est correct, même si le scope downstream est plus large que prévu.
- **Migration sequencing additivity** (commits 1-3 server-side) — le back-compat du `forPlayer` optional est solide *à condition* d'ajouter la validation stricte (R2).
- **`swapBoardState` reuse from ReplayDuelAdapter** (§4.5) — bon pattern reuse identifié, à étendre (R7).
- **M9/M11 dette acknowledgée** (§7.4) — culture fix réel.
- **fork-solo convergence opportunity** (§6.4) — direction doctrinale cohérente même si l'estimate est optimiste (EC#15).

---

## Plan de remediation — checklist avant code

| ID | Cluster | Amendment | Effort |
|---|---|---|---|
| **A1** | R1 | §3.2 — remplacer `broadcastToBoth` par no-op-on-1 dans `sendToPlayer` ; auditer les ~9 sites pseudo-pairwise ; décider du sort de `DUEL_STARTING.cardCodes` en SOLO | 0.25j |
| **A2** | R2 | §3.3 + §12 Q4 — validation stricte `forPlayer` (drop en PvP normal si présent) + T-S6 spec | 0.1j |
| **A3** | R3 | §3.5 — ajouter `ws.on('close')` (clear `players[1].connected` en SOLO ; no-op `OPPONENT_DISCONNECTED`) | 0.25j |
| **A4** | R3 | §4.1 — réécrire `setupRematchEffect` pour 1 connection | 0.1j |
| **A5** | R3 | §8.4 étendre — perspective restore via localStorage | 0.1j |
| **A6** | R3 | §3.4 — SOLO register avec 1 token seulement (skip `rotateReconnectToken` pour P1) | 0.1j |
| **A7** | R3 | §6.2 — commits 1-3 NE déploient PAS avant commit 6 ; option transitoire 2-tokens documentée ; §6.3 "no-rollback past commit 6" | 0.1j |
| **A8** | R4 | §4.3 — tableau complet refait avec colonnes "Routing key" + "Reset rule" pour les 21 fields ; couverture explicite des `set(null)` sites | 0.5j |
| **A9** | R4 | §3.3 — règle `ANIMATIONS_DONE.forPlayer = lastSentPlayerResponse.forPlayer` | 0.1j |
| **A10** | R5 | §3.1 — paragraphe "Information disclosure under omniscient SOLO" doctrinal | 0.1j |
| **A11** | R5 | §4.5 — étendre swap au DICE_RESULT | 0.1j |
| **A12** | R6 | §6.2 — commits 4+5+6 atomic PR ; §6.3 rollback granularity revue | 0.1j |
| **A13** | R6 | §4.6 — politique UX switch-during-prompt (recommandation : option c banner) | 0.25j |
| **A14** | R6 | §4.6 — `setBoardActive` semantics clarifiées (1 flag global, 1 set au bootstrap) | 0.1j |
| **A15** | R6 | §7.2 — `WebSocketFactory` + `MockWebSocket` infrastructure pour T-F6 | 0.25j |
| **A16** | R6 | §9 — réviser estimate à 8.5-10j | 0.05j |
| **A17** | R7 | §4.5 — étendre swap au BoundaryProcessor + `boardStateAfter` | 0.25j |
| | | **TOTAL amendements doc** | **~2.5j** |

Après amendments : spec implementation-ready. Effort total chantier C = **~8.5-10j de code + 0.25j de tests + 2.5j d'amendments spec = ~11-13j**.

---

## Décision finale recommandée

L'option C reste **architecturalement la bonne solution doctrinalement** — elle élimine par construction les findings BLOCKER de C1 + C2.1 + C4.9. Les findings adversariaux **ne remettent PAS en cause l'approche**, ils révèlent que la spec initiale a sous-spécifié les edges lifecycle (cluster R3), la sémantique PerspectiveSlot (R4), la surface omniscient (R5), et le sequencing migration (R6).

**Prochain pas suggéré** :
1. Acter les 17 amendments (A1-A17) sur la spec.
2. Re-trancher les 5 décisions ouvertes §12 (Q1-Q5) à la lumière des findings (notamment Q4 inversé).
3. Confirmer l'estimate révisé 11-13j.
4. Décider du sequencing : option C maintenant ? ou option A en quick-fix puis option C ? (l'option A à 1j reste un palliatif valide si on a besoin de débloquer SOLO en attendant une fenêtre dispo de 2 semaines).

Cette dernière question — A vs C maintenant — mérite une discussion séparée si tu veux qu'on l'attaque.
