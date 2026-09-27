---
title: Phase γ — Option C — Findings deep dive + recommendations
status: review in progress
target_spec: phase-gamma-option-c-multiplex-spec.md
adversarial_review: phase-gamma-option-c-adversarial-findings.md
date: 2026-05-28
authors:
  - Winston (architect)
---

# Option C — Deep dive des findings & recommendations chirurgicales

Doc destiné à toi (Axel) pour trancher cluster par cluster avant de patcher
la spec. Chaque finding est présenté avec **(1) ce qui se passe vraiment dans
le code**, **(2) pourquoi c'est un problème**, **(3) la recommendation
d'architecte argumentée**.

J'ai relu le code à chaque finding pour ne pas répéter mes erreurs
précédentes (j'ai été pris en flag sur `broadcastToBoth` et fork-handlers
omniscient). Pour chaque cluster je signale aussi **les findings NOUVEAUX
que j'ai découverts en relisant** (les reviewers ne les ont pas vus).

---

## 🔴 Cluster R3 — Lifecycle WS (le plus dangereux)

### Le pattern de fond

**Découverte additionnelle (RAS des 2 reviewers)** : le serveur encode
"1 socket = 1 player" dans **4 sites critiques**, pas seulement à
`ws.on('close')`. Quand tu relies les findings entre eux, c'est **le même
défaut architectural répété 4 fois** — pas 4 bugs indépendants :

| Site | Ligne | Doctrine encodée | Effet en SOLO multiplex (sans fix) |
|---|---|---|---|
| **POST handler** | `server.ts:447-448` | `connected: false` initialisé pour `players[1]` | OK au boot |
| **`ws.on('open')` setter** | `server.ts:1004-1006` | `players[playerIndex].connected = true` | Seul `players[0].connected=true`, l'autre reste false |
| **Gate "both players connected"** | `server.ts:1076` | `if (players[0].connected && players[1].connected)` | **JAMAIS true → duel ne démarre jamais** |
| **`ws.on('close')` setter** | `server.ts:1122-1124` | `players[live].connected = false` | Seul `players[0].connected=false`, `players[1]` reste true éternellement |
| **Cleanup grace check** | `server.ts:1142` | `if (!players[0].connected && !players[1].connected)` | Bloqué symétriquement par `players[1]` stale |

### Finding R3.1 — Le duel ne démarre pas (CRITIQUE — non vu par les reviewers)

**Évidence chirurgicale** :
```ts
// server.ts:1075-1083
// Check if both players are connected — trigger pre-duel RPS or fork resume
if (session.players[0].connected && session.players[1].connected) {
  logger.log('Both players connected', { duelId: session.duelId });
  if (session.phase === 'WAITING_PLAYERS') {
    if (session.soloMode) {
      startDuelWithOrder(session, 0);  // ← jamais atteint en multiplex
    } else {
      startFirstPlayerPhase(session);
    }
  }
}
```

En SOLO 1-socket : `players[1].connected` reste `false`. La condition est
fausse. `startDuelWithOrder` n'est jamais appelé. Le worker OCGCore n'est
jamais spawné. Le BOARD_STATE initial n'arrive jamais. L'utilisateur voit
"Connexion établie" et reste en arène de dés (qui ne s'affichera même pas
parce que `DUEL_STARTING` n'est jamais envoyé).

**Recommandation A — la plus propre** : introduire un computed virtuel
`isReadyToStart(session)` qui en SOLO retourne `players[0].connected`
seul. Centralise la doctrine dans 1 helper.

```ts
function isReadyToStart(session: ActiveDuelSession): boolean {
  if (session.soloMode) return session.players[0].connected;
  return session.players[0].connected && session.players[1].connected;
}
```

Et le site `:1076` devient `if (isReadyToStart(session))`. Idem pour le
cleanup `:1142` — symétrie `isFullyDisconnected(session)`.

**Pourquoi cette approche** : la doctrine "qu'est-ce que ça veut dire d'être
prêt à démarrer en SOLO multiplex" est non-triviale. La cacher dans `if`
inline répand la connaissance ; en helper, on a UN endroit qui sait, et
le reste du code reste lisible.

### Finding R3.2 — `players[1].connected = true` éternel au close (EC#3, CRITIQUE)

**Évidence chirurgicale** :
```ts
// server.ts:1120-1124
ws.on('close', () => {
  const live = currentPlayerIndex();   // toujours 0 en SOLO multiplex
  session!.players[live].connected = false;
  // ...
});
```

**Conséquences en cascade** (que les reviewers ont énumérées, je
confirme par lecture du code) :
- **OPPONENT_DISCONNECTED** : `sendToPlayer(session, opponentIndex=1, {OPPONENT_DISCONNECTED})` à la ligne 1133. En SOLO via le `sendToPlayer` patché (no-op-on-1), c'est silencieusement dropé. **OK** mais il faut le déclarer explicitement.
- **Grace timer** : `startGracePeriod(session, live)` à la ligne 1135. Démarre un timer sur `players[0]` (le slot vrai). OK.
- **Cleanup check post-duel** : `if (!players[0].connected && !players[1].connected)` ligne 1142. Bloqué par `players[1].connected` stale. **Session leak garantie**.

**Recommandation** : au `ws.on('close')` en SOLO, faire les **deux**
side-effects en parallèle :
```ts
session!.players[live].connected = false;
if (session!.soloMode) session!.players[1 - live as 0|1].connected = false;
```

Et remplacer le check `:1142` par `isFullyDisconnected(session)` du helper
proposé en R3.1.

### Finding R3.3 — REMATCH effect deadlock SOLO (EC#1, HIGH)

**Évidence chirurgicale** :
```ts
// solo-duel-orchestrator.service.ts:230-247
effect(() => {
  const s0 = c[0].rematchStarting();
  const s1 = c[1].rematchStarting();
  if (s0 && s1) {
    this.animationService.resetForSwitch();
    this.duelCtx.setPerspective(0);
    c[0].resetRematchStarting();
    c[1].resetRematchStarting();
    this._rematchReset.update(v => v + 1);
  }
}, { allowSignalWrites: true });
```

En SOLO multiplex 1-connection, il n'y a plus de `c[1]`. L'effect doit être
**réécrit pour la nouvelle topology** :
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

**Pourquoi c'est important** : ma spec §4.1 montrait `init()` mais
**pas** `setupRematchEffect`. L'absence aurait été un bug silencieux à
implementation — le rematch ne marcherait jamais et personne ne saurait
pourquoi. Doit être ajouté au texte de spec.

### Finding R3.4 — Reconnect perspective restore (EC#13, HIGH)

**Le bug** : aujourd'hui la perspective est reset à 0 au boot
(`DuelContext.perspectiveSource = signal<0|1>(0)`). En SOLO multiplex,
si user était sur perspective=1 quand il a refresh F5, après
reconnect il revient sur perspective=0 → voit P0 alors qu'il jouait
P1.

**Recommandation** : persister la perspective en localStorage.
Pattern existant pour `reconnectToken` (`duel-connection.ts:920`,
`storageKey`). Ajoute un 2e slot :
```ts
// Dans solo-duel-orchestrator.service.ts switchPerspective :
this.duelCtx.setPerspective(to);
try { localStorage.setItem(SOLO_PERSPECTIVE_KEY, String(to)); } catch {}

// Au bootstrap (init après connexion) :
const stored = (() => { try { return Number(localStorage.getItem(SOLO_PERSPECTIVE_KEY)); } catch { return 0; } })();
if (stored === 0 || stored === 1) this.duelCtx.setPerspective(stored);
```

Edge case : storage clearé au DUEL_END (cf. `duel-connection.ts:862` qui
déjà fait `localStorage.removeItem(this.storageKey)` au DUEL_END). On
ajoute le clear de SOLO_PERSPECTIVE_KEY à la même ligne.

### Finding R3.5 — Token P1 alloué et orphelin (EC#4, MEDIUM)

**Évidence chirurgicale** :
```ts
// server.ts:484 — POST handler
sessionManager.register(session, [token0, token1]);
```
Les 2 tokens sont enregistrés dans `pendingTokens`. En SOLO multiplex,
`token1` ne sera jamais consommé (le front ne fait qu'1 socket). Il
reste dans `pendingTokens` jusqu'au `cleanupDuelSession` → `terminate()`.

**Mitigation** : en SOLO, register avec 1 token seul :
```ts
const tokens = soloMode ? [token0] : [token0, token1];
sessionManager.register(session, tokens);
// ...
const wsTokens = soloMode ? [token0] : [token0, token1];
json(res, 201, { duelId, wsTokens });
```

Le `reconnectToken` rotation se passe en `ws.on('open')` (ligne 1016),
donc seul `players[0].reconnectToken` est rotaté — déjà OK par accident.

### Récap R3 — recommendation globale

C'est **le cluster qui doit être corrigé en premier dans la spec**.
Introduire **2 helpers** : `isReadyToStart(session)` +
`isFullyDisconnected(session)`. Tous les sites qui encodent "1 socket =
1 player" passent par ces helpers. C'est de la doctrine consolidée,
pas du patchwork.

**Effort spec** : 0.5j (rédiger §3.5bis "Lifecycle helpers" + amender les
4 sites énumérés).
**Effort code** : 0.5j (les helpers sont 6 lignes chacun, les sites
existent déjà).

---

## 🔴 Cluster R1 — `broadcastToBoth` mal calibré (BLOCKER)

### Inventaire chirurgical des 14 sites pseudo-pairwise

J'ai relu **tous** les sites `sendToPlayer(s, 0, X); sendToPlayer(s, 1, X);`
listés dans la spec. Verdict :

| Site | Fichier:ligne | Payload | Catégorie |
|---|---|---|---|
| REMATCH_STARTING | `server.ts:543-544` | identique | **Broadcast pur** |
| REMATCH_CANCELLED | `server.ts:595-596` | identique | **Broadcast pur** |
| DUEL_END timeout | `timer-management.ts:128-129` | identique | **Broadcast pur** |
| DUEL_END inactivity | `timer-management.ts:283-284` | identique | **Broadcast pur** |
| DUEL_END disconnect | `timer-management.ts:379-380` | identique | **Broadcast pur** |
| DUEL_END too_many_invalid | `client-message-router.ts:119-120` | identique | **Broadcast pur** |
| DUEL_END surrender | `client-message-router.ts:167-168` | identique | **Broadcast pur** |
| DUEL_END too_many_invalid 2 | `worker-message-router.ts:124-125` | identique | **Broadcast pur** |
| DUEL_END MSG_WIN | `worker-message-router.ts:237-238` | identique | **Broadcast pur** |
| DUEL_END worker_error | `worker-message-router.ts:193-194` | identique | **Broadcast pur** |
| TIMER_STATE | `timer-management.ts:117-118, 165-166` | identique (carries `player: activePlayer`) | **Broadcast pur** |
| DUEL_STARTING | `server.ts:634-635` | **cardCodes per-player** | **Pseudo-pairwise** |
| DECK_PREFETCH | `first-player-coordinator.ts:232-233` | **cardCodes per-player** | **Pseudo-pairwise** |
| FIRST_PLAYER_RESULT | `first-player-coordinator.ts:234-235` | **goFirst inversé** | **Pseudo-pairwise** |

**Bilan inversé par rapport au reviewer** : **11 vrais broadcasts + 3
pseudo-pairwise**, pas "5 + 9" comme la review l'estimait. Et — **plus
important** — sur les 3 pseudo-pairwise :

1. **DECK_PREFETCH + FIRST_PLAYER_RESULT** sont émis depuis
   `first-player-coordinator.ts` qui **N'EST PAS APPELÉ EN SOLO**
   (`server.ts:578-584` court-circuite `startFirstPlayerPhase` quand
   `soloMode === true`). **Ces 2 sites sont NO-OPS en SOLO**. Ils ne posent
   AUCUN problème pour Option C.

2. **DUEL_STARTING** (`server.ts:634-635`) est l'unique vrai pseudo-pairwise
   en SOLO. Aujourd'hui le payload `playerIndex` + `cardCodes` est
   différent par destinataire. En SOLO multiplex, on a 2 options :
   - **Option C.1.a** — n'envoyer que `playerIndex=0`'s DUEL_STARTING en
     SOLO et ignorer `playerIndex=1`. **Problème** : le front en SOLO
     multiplex doit connaître les cardCodes des 2 decks pour pouvoir
     préfetch les images des 2 perspectives.
   - **Option C.1.b** — étendre DUEL_STARTING avec un champ
     `bothCardCodes?: number[][]` envoyé uniquement en SOLO. Le front
     SOLO prefetch les 2 decks ; le front PvP normal ignore le champ.
     **Recommandé** — 5 lignes de code, pas d'ambiguïté.

### Conclusion R1

**Mon constat est plus optimiste que le reviewer** : la majorité des sites
"pseudo-pairwise" identifiés par BH#1 ne sont pas atteints en SOLO car le
flow dés/RPS est skippé. **Le bon design = no-op-on-1 dans `sendToPlayer`
SOLO** :

```ts
function sendToPlayer(session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage): void {
  // ... existing STATE_SYNC gameLogEntries attach ...
  if (session.soloMode && playerIndex === 1) {
    // SOLO: no second socket. The playerIndex=1 send is dropped silently.
    // Pure broadcasts (DUEL_END, TIMER_STATE, REMATCH_*) duplicate to the
    // single socket and the 2nd write is a no-op. DUEL_STARTING needs
    // special handling (cf. §C.1.b).
    return;
  }
  safeSend(session.players[playerIndex].ws, message);
}
```

**1 seul cas particulier** : DUEL_STARTING en SOLO doit envoyer un payload
étendu (cardCodes des 2 decks) via le `playerIndex=0` send. Modification
de l'émission dans `server.ts:634` :
```ts
if (session.soloMode) {
  sendToPlayer(session, 0, {
    type: 'DUEL_STARTING', playerIndex: 0, traceId: session.duelId,
    cardCodes: extractCardCodesForPlayer(session.decks, 0),
    bothCardCodes: [extractCardCodesForPlayer(session.decks, 0), extractCardCodesForPlayer(session.decks, 1)],
  });
} else {
  sendToPlayer(session, 0, {/* legacy */});
  sendToPlayer(session, 1, {/* legacy */});
}
```

**`broadcastToBoth` helper** que j'avais proposé en §3.2.b : **rejeté
définitivement**. L'option no-op-on-1 + 1 cas particulier DUEL_STARTING est
plus simple et plus sûre.

**Effort spec** : 0.25j.
**Effort code** : trivial (sendToPlayer + 1 site DUEL_STARTING).

---

## 🔴 Cluster R2 — `forPlayer` validation (BLOCKER sécurité)

### L'attaque concrète

Scénario d'attaque en PvP ranked (le reviewer l'a sketchée, je la complète) :

1. Adversaire P1 ouvre son client modifié. Socket attaché à `players[1].ws`.
2. P0 reçoit `SELECT_CHAIN` pour répondre à Maxx C de P1.
3. Pendant que P0 réfléchit, P1 envoie depuis SA socket :
   ```json
   { "type": "PLAYER_RESPONSE", "promptType": "SELECT_CHAIN", "data": { "index": null }, "forPlayer": 0 }
   ```
4. Serveur lit avec **§12 Q4 "ignore silently"** :
   ```ts
   const live = (parsed as { forPlayer?: 0|1 }).forPlayer ?? currentPlayerIndex();
   // live = 0 (le forPlayer override le currentPlayerIndex=1)
   handleClientMessage(session, 0, parsed);
   ```
5. `client-message-router.ts:79-159` traite comme une vraie réponse de P0.
6. Vérification `expectedPrompt = session.lastSentPrompt[0]` (ligne 93) : OK,
   c'est le SELECT_CHAIN.
7. Validation de `data` : OK, `{index: null}` est valide pour SELECT_CHAIN.
8. `session.awaitingResponse[0] = false` (ligne 132).
9. **Worker reçoit `PLAYER_RESPONSE playerIndex:0 ...` → tour Maxx C esquivé.**
10. P0 reçoit la suite du duel comme si elle avait répondu `null`. **Match
    perdu en silence.**

### Le fix correct

§12 Q4 **doit être inversé** : validation stricte.

```ts
// server.ts ws.on('message') handler (autour ligne 1107)
ws.on('message', (data: Buffer) => {
  let parsed: ClientMessage;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    logger.error('Invalid JSON from player', { duelId: session!.duelId });
    return;
  }

  // R2 — security: `forPlayer` is SOLO-only. Reject silently in PvP normal.
  const incomingForPlayer = (parsed as { forPlayer?: 0|1 }).forPlayer;
  if (!session!.soloMode && incomingForPlayer !== undefined) {
    logger.warn('forPlayer field in PvP normal — possible impersonation attempt', {
      duelId: session!.duelId, from: currentPlayerIndex(), claimed: incomingForPlayer,
    });
    return;
  }

  const live = session!.soloMode
    ? (incomingForPlayer ?? currentPlayerIndex())
    : currentPlayerIndex();

  handleClientMessage(session!, live, parsed);
});
```

### Cas dégénéré CANCEL_PROMPT_SEQUENCE (EC#11)

`lastCancelAt[p]` rate-limit (`client-message-router.ts:234-238`) en SOLO
peut être bypassé en alternant `forPlayer: 0/1`. **Bénin** (c'est la
session de l'utilisateur lui-même), MAIS doit être commenté pour ne pas
être pris pour un bug :

```ts
case 'CANCEL_PROMPT_SEQUENCE': {
  // ...
  // R2 note — in SOLO multiplex, the user could alternate `forPlayer`
  // to bypass this per-player rate limit. Intentional: SOLO is the
  // user's own session, no abuse vector. PvP normal rejects `forPlayer`
  // at the dispatch level (cf. ws.on('message') handler).
  if (now - session.lastCancelAt[playerIndex] < cfg.cancelPromptRateLimitMs) { /* ... */ }
}
```

**Effort spec** : 0.1j (réécriture §12 Q4 + ajout T-S6 + commentaire CANCEL).
**Effort code** : 0.1j.

---

## 🟠 Cluster R4 — PerspectiveSlot inventaire (HIGH)

### Le tableau §4.3 refait, basé sur lecture exhaustive

J'ai listé **tous** les sites de `_pendingPrompt.set`, `_hintContext.set`,
etc. dans `duel-connection.ts:handleMessage`. Voici le tableau corrigé :

| Field | Sites de mutation | Routing key | Reset rule |
|---|---|---|---|
| `_pendingPrompt` | `:709, 722, 738, 740, 757, 767, 854 (set null), 885 (set null)` | `message.player` pour SELECT_*/ANNOUNCE_*/SORT_*/DICE_ROLL/SELECT_FIRST_PLAYER ; **clear LES DEUX slots** pour DUEL_END + REMATCH_STARTING + STATE_SYNC | Per-slot |
| `_hintContext` | `:796-807` (merged write via `_hintContext.set`) | `message.player` du MSG_HINT (`message.player` du payload) | Per-slot ; clear LES DEUX au DUEL_END + REMATCH_STARTING + STATE_SYNC |
| `_inactivityWarning` | `:823 (set message), :855 (clear DUEL_END)` | **`message.player` est dans payload** (cf. `InactivityWarningMsg` type) | Per-slot ; clear LES DEUX au DUEL_END + REMATCH_STARTING |
| `_waitingForOpponent` | `:721, 739, 766, 771, 856 (clear), 886 (clear), 906 (set)` | **Pas dans message** — `WAITING_RESPONSE` est destiné au joueur *opposé* à celui qui prompt ; en SOLO multiplex il faut lire `(lastSelectMessage.player === 0 ? 1 : 0)` ou stocker explicitement | Per-slot ; clear LES DEUX au DUEL_END + REMATCH_STARTING |
| `_rematchState` | `:866, 870, 891 (set idle au REMATCH_STARTING)` | **REMATCH_INVITATION n'a pas `.player`** (envoyé uniquement à l'opposite du requester) — en SOLO multiplex, c'est ambigu | **À discuter** — voir §R4.X ci-dessous |
| `_rematchStarting` | `:621 (clear BOARD_STATE), :654 (clear STATE_SYNC), :754 (clear DICE_ROLL), :880 (set)` | REMATCH_STARTING est broadcast pur ⇒ **set LES DEUX slots** | Per-slot mais coordonné |
| `_lastConfirmedCards` | `:647 (clear STATE_SYNC), :845 (clear DUEL_END), :874 (clear REMATCH_STARTING), :952 (set)` | `message.player` du MSG_CONFIRM_CARDS | Per-slot |
| `_lastSelectedCards` | `:651 (clear STATE_SYNC), :716-718 (clear si type change)` | Suit `_pendingPrompt` | Per-slot |
| `_lastDrawAnnouncedHash` | `:241 (decl), :981 (set)` | `MSG_DRAW.player` | Per-slot ; **clé hash doit inclure le slot index** : `${slotPlayer}:${turnPlayer}:${turnCount}` (cf. BH#9) |
| `_firstPlayerResult` | `:772, 857, 886` | `FIRST_PLAYER_RESULT` est per-player (different `goFirst`) | Per-slot mais... **en SOLO le flow est skippé** ⇒ ces fields ne sont jamais touchés en SOLO. Optimisation : ne pas les indexer en SOLO. |
| `_firstPlayerResponseSent` | `:350 (set true sur send), :772 (clear), :858, :887` | Suit `_firstPlayerResult` | Idem ci-dessus |
| `_hintCardConsumed` | `:653, :219 (clear), :349 (set)` | Suit `_pendingPrompt` cycle | Per-slot |
| `_confirmedCardsByChain` | `:648, :846, :875, :946, :957-958` | Keyed par `chainIndex` (global). **PAS per-perspective**. | Global, OK. |
| `_lastSelectedPromptType` | (idem `_lastSelectedCards`) | Per-slot | Per-slot |
| `_lastTurnPlayer`, `_lastTurnCount` | `:633-634` (set BOARD_STATE) | Global BOARD_STATE | Global, OK. |
| `_lastStateSyncAt` | `:656` | Global | Global, OK. |
| `_justReconnected` | `:670 (set), :622 (clear BOARD_STATE)` | Global (transport) | Global, OK. |
| `_sessionPhase` | `:928` | Global mount-discriminant | Global, OK. |
| `_boardActive` | external setter | Global | Global, OK. |

### Nouvelles trouvailles vs §4.3 original

1. **`_waitingForOpponent` — routing implicite** : ce signal flip à
   `true` quand l'opposite joueur reçoit `WAITING_RESPONSE`. Le message
   lui-même n'a pas de `.player`. **En 2-socket γ**, le serveur envoyait
   `WAITING_RESPONSE` au joueur opposé du prompt ⇒ chaque socket recevait
   pour LA bonne perspective. **En SOLO multiplex 1-socket**, le serveur
   envoie `WAITING_RESPONSE` à `opponentOfTarget` (cf. `worker-message-router.ts:267`)
   mais via `sendToPlayer(session, opponentOfTarget, X)` qui en SOLO patché
   serait no-op-on-1 si opponentOfTarget=1 — **WAITING_RESPONSE jamais reçu
   pour le slot 1**.

   **Conséquence** : `_slots[1].waitingForOpponent` ne flip jamais → UI
   incohérente sur perspective=1.

   **Solution** : `WAITING_RESPONSE` doit être **étendu avec `targetPlayer: 0|1`**
   pour que le front route au bon slot, OU le front dérive le slot depuis
   le dernier SELECT_*.player (l'opposite de). Recommandation : ajout du
   field, plus explicite.

2. **`_rematchState` — pas dans le message** : REMATCH_INVITATION est
   envoyé à `opponentIdx` du requester (`client-message-router.ts:182`).
   Pas de `.player` dans le payload. En SOLO multiplex, l'utilisateur est
   les 2 joueurs ; **un seul `_rematchState` global suffit** (l'invitation
   est sa propre invitation à lui-même). **Décision** : ne PAS indexer
   `_rematchState` per-slot en SOLO. Garder global. C'est asymétrique mais
   cohérent doctrinalement.

3. **`_firstPlayerResult` / `_firstPlayerResponseSent` — dead en SOLO** :
   le flow `first-player-coordinator` n'est jamais appelé en SOLO
   (`server.ts:578`). Ces fields restent NULL en SOLO. **Aucun besoin
   d'indexer**.

4. **`_inactivityWarning` — confirmation routing** : le payload
   `InactivityWarningMsg` a-t-il un `.player` ? Je dois vérifier :

<details>
<summary>Vérification ws-protocol</summary>

Le type est défini dans `ws-protocol-system.ts`. À vérifier en post-spec : si
`InactivityWarningMsg` a un `player: Player` field, alors routing facile par
slot. Sinon, c'est le serveur qui décide quand l'envoyer (`timer-management.ts:276`
le tagge déjà par joueur dans son contexte, mais le payload sortant pourrait
ne pas le porter).
</details>

### Bilan R4 — Fields *réellement* per-perspective en SOLO

**Avant** (spec §4.3 originale) : 8 fields YES, 13 NO.
**Après deep dive** :

- **Per-perspective requis** : `_pendingPrompt`, `_hintContext`,
  `_inactivityWarning`, `_waitingForOpponent`, `_lastConfirmedCards`,
  `_lastSelectedCards`, `_lastSelectedPromptType`, `_lastDrawAnnouncedHash`,
  `_hintCardConsumed`. **9 fields**.
- **Global** : tout le reste, **et notamment `_rematchState` qu'on garde global
  par décision pragmatique** (1 user en SOLO).
- **Dead en SOLO** : `_firstPlayerResult`, `_firstPlayerResponseSent`. Aucun
  besoin d'indexer.

**Modifications protocole inattendues** :
- **`WAITING_RESPONSE` doit porter `targetPlayer: 0|1`** (ou le front
  dérive depuis le dernier SELECT). Recommendation : étendre le message,
  plus simple.

**Effort spec** : 0.5j (refonte du tableau §4.3).
**Effort code** : ~2j (estimate révisé +0.5j car WAITING_RESPONSE extension
+ vérif InactivityWarningMsg).

---

## 🟠 Cluster R5 — Surface omniscient non auditée

### Le verdict du reviewer était juste, mais j'élargis

**BH#2 démontré** : fork-handlers loop `for ([idx]) filterMessage(_, idx, true)`
donc DICE_RESULT swap, BOARD_STATE turnPlayer remap, players[] swap fire par
destinataire. Option C dispatch `filterMessage(_, 0, true)` UNE FOIS. **Cette
configuration n'a jamais été exercée**.

### Les transformations per-perspective skippées en SOLO multiplex

Lecture exhaustive de `message-filter.ts` :

| Type | Comportement avec `forPlayer=0, omniscient=true` | OK pour SOLO ? |
|---|---|---|
| BOARD_STATE | swap `turnPlayer` (0 si match), swap `players[]` selon `forPlayer` | **Forced perspective=0** → front doit re-swap si perspective=1 (§4.5 OK) |
| STATE_SYNC | idem BOARD_STATE | idem |
| DICE_RESULT | swap dés + sums + winner si `forPlayer===1`. En `forPlayer=0` : passthrough | **DICE_RESULT skippé en SOLO entièrement** (server.ts:578) ⇒ N/A |
| MSG_DRAW omniscient | `cards` intact | Cohérent SOLO (user = both) |
| MSG_SHUFFLE_HAND omniscient | `cards` intact | Cohérent SOLO |
| MSG_MOVE depuis private omniscient | `cardCode` intact | Cohérent SOLO |
| MSG_CONFIRM_CARDS private omniscient | `cardCode` intact | Cohérent SOLO |
| MSG_HINT non-public omniscient | passthrough | Cohérent SOLO |
| SELECT_* omniscient | passthrough (skip drop) | Cohérent SOLO — c'est CE QU'ON VEUT (front voit les 2) |

**Bilan** : 1 vraie transformation à compenser côté front = **BOARD_STATE/STATE_SYNC
swap** (déjà §4.5 + ajout BoundaryProcessor R7). DICE_RESULT swap est skippé en
SOLO car `first-player-coordinator` non invoqué. **Le reviewer BH#2 a sur-estimé
la surface — DICE_RESULT n'est pas un problème en SOLO**.

### Doctrine "Information disclosure under omniscient SOLO" (BH#3)

À ajouter en §3.1, paragraphe explicite :

> **Information disclosure under omniscient SOLO** : doctrine = "user is
> both players in SOLO". Toutes les révélations (MSG_DRAW.cards intactes,
> MSG_MOVE.cardCode des privés, MSG_CONFIRM_CARDS.private, MSG_SHUFFLE_HAND.cards)
> sont visibles indépendamment de la perspective courante. C'est intentionnel —
> SOLO sert au testing combo, où l'utilisateur veut voir les 2 mains.
> Ce N'EST PAS un bug même si visuellement asymétrique vs PvP normal.

**Effort spec** : 0.1j.
**Effort code** : aucun (déjà géré par le mode omniscient existant).

---

## 🟡 Cluster R6 — Migration + tests + estimate

### R6.1 — Commit 4 ne shippe PAS en isolation (BH#6, confirmé)

Mon claim §6.2 ligne 4 *"commit 4 isolable"* était faux. En γ pré-multiplex,
conn0 et conn1 sont 2 instances séparées. Chacune aurait son `_slots[0..1]`.
Filtering serveur per-player ⇒ conn0._slots[1] vide, conn1._slots[0] vide.

**Mais** : si on rajoute le PerspectiveSlot extraction sans changer le
flow γ, **PvP normal continue de marcher** parce que le `_defaultConnection`
unique a son slot 0 alimenté correctement (slot 1 vide mais jamais lu — en
PvP normal `perspective === 0` toujours, le `getPendingPromptFor(0)` lit
slot 0).

**Le problème est strictement SOLO** : pendant les 2 commits suivants
(5+6), SOLO est dans un état mixte. **Décision** : commits 4+5+6 **PR
atomique unique**, comme le reviewer le recommande.

### R6.2 — Commits 1-3 server ne shippent PAS avant front (EC#7 + EC#8)

Confirmé. Le déploiement doit être atomique sur les 2 côtés OU passer par
une version transitoire qui garde `wsTokens: [token0, token1]` (avec
`token1` alloué mais jamais consommé).

**Recommandation** : pousser les 8 commits dans **2 PRs** :
- **PR1** = commits 1+2 (server : forPlayer field + broadcast omniscient
  + sendToPlayer no-op-on-1). Déployable indépendamment, additif.
- **PR2** = commits 3+4+5+6+7+8 (server : 1-token POST. Front : tout).
  Déployable ensemble en 1 release.

Cf. §6.2 corrigé.

### R6.3 — T-F6 setup non décrit (EC#14)

Spec §7.2 ne dit pas comment monter un WebSocket mock pour T-F6. Sans
direction, le test va re-mock (vacuous round 2).

**Recommandation** : injection d'un `WebSocketFactory` token. Pattern
qu'on connaît bien (cf. `RoomApiService` injection HttpClient). En tests,
un `MockWebSocket` qui expose `simulateServerMessage(payload)` et un
buffer des messages envoyés par le client.

```ts
@Injectable()
export class WebSocketFactoryService {
  create(url: string): WebSocket { return new WebSocket(url); }
}

// Dans DuelConnection constructor :
this.ws = inject(WebSocketFactoryService).create(this.wsUrl);
```

En test :
```ts
TestBed.overrideProvider(WebSocketFactoryService, { useValue: mockFactory });
```

**Effort spec** : 0.1j (ajout §7.2).
**Effort code** : 0.25j (refactor mineur DuelConnection).

### R6.4 — Estimate à 11-13j cohérent

Je confirme l'estimate révisé du doc adversarial-findings. Voir §9 spec
amendée.

### Effort spec total

| Cluster | Amendement | Effort spec |
|---|---|---|
| R3 | §3.5 lifecycle helpers + 4 sites + amendement §4.1 setupRematchEffect + §8.4 perspective restore + §3.4 SOLO register 1 token | **0.75j** |
| R1 | §3.2 no-op-on-1 + DUEL_STARTING bothCardCodes | **0.25j** |
| R2 | §3.3 strict validation + §12 Q4 inverse + T-S6 | **0.1j** |
| R4 | §4.3 refait tableau + WAITING_RESPONSE.targetPlayer extension + InactivityWarningMsg vérif | **0.5j** |
| R5 | §3.1 doctrine omniscient SOLO | **0.1j** |
| R6 | §6.2 commits regroupés en 2 PRs + §7.2 WebSocketFactory + §9 estimate | **0.25j** |
| R7 | §4.5 étendre BoundaryProcessor + boardStateAfter | **0.25j** |
| R8 | §4.6 banner UX switch-during-prompt | **0.25j** |
| R9 | §4.6 `setBoardActive` semantics clarifiées | **0.05j** |
| R10 | §3.3 `ANIMATIONS_DONE` derivation rule | **0.05j** |
| R11 | §7 spec TIMER_STATE per-player | **0.05j** |
| **TOTAL** | | **~2.6j** |

**Effort code total estimate** : 8.5-10j + amendments doc 2.6j = **~11-13j**.

---

## 🟢 Things je RECONFIRME après deep dive (spec right)

- **Structural elimination over palliation** — vrai et confirmé.
- **`swapBoardState` reuse from ReplayDuelAdapter** — pattern réutilisable
  sans rien réinventer. Confirmé.
- **Migration additivity commits 1-2 server-side** — confirmé (en
  reformatant en PR1).
- **`omniscient` mode flag existant déjà testé sur le subset MSG_** —
  vrai pour les MSG_DRAW/MOVE/CONFIRM/HINT/SHUFFLE. La couverture BOARD_STATE
  avec un seul `forPlayer` est nouvelle mais le pattern est solide.

---

## 🎯 Recommandation d'architecte — chemin à suivre

### Étape 1 — Patcher la spec (2.6j)

Je peux te livrer la spec patchée avec les 17 amendements (A1-A17) du doc
adversarial-findings. Je travaille **dans la même spec** plutôt que de
créer un v2 séparé — ça garde la traçabilité.

### Étape 2 — Re-review adversariale (0.5j)

Une fois la spec patchée, **relancer 1 sub-agent adversarial** (pas 2,
le 2e n'a pas apporté énormément de nouveau sur les amendments). Pour
chasser ce que les amendments auraient pu casser.

### Étape 3 — Décisions ouvertes (Q1-Q5 du §12)

Acter les 5 décisions, certaines déjà décidées par le deep dive :

| Q | Décision recommandée |
|---|---|
| **Q1** — wsToken2 dans QuickDuelResponse | **Optionnel** au début (transitoire), **supprimé en δ** post-livraison |
| **Q2** — broadcastToBoth vs no-op-on-1 | **No-op-on-1 dans sendToPlayer** (R1 deep dive) — `broadcastToBoth` rejeté |
| **Q3** — Convergence fork-solo | **Différée** post-Option C (1-1.5j additionnels) |
| **Q4** — Validation forPlayer | **Stricte** — drop avec warn en PvP normal si présent (R2 deep dive) |
| **Q5** — Nom du field | **`forPlayer`** — consistent avec `filterMessage(msg, forPlayer)` côté serveur |

### Étape 4 — Découpe BMad et code

Une fois la spec finale et reviewée :
- 2 PRs (PR1 server additif, PR2 multiplex complet).
- Commits visés ~8-10j de code + 0.5j de tests CI scenarios A&B.

### Question pour toi avant que je patche la spec

Tu veux que je :

1. **Patche la spec maintenant** avec les 17 amendments dans le même
   fichier (préserve traçabilité, spec passe de ~625 → ~900 lignes) ?
2. **Crée une spec v2 séparée** (`phase-gamma-option-c-multiplex-spec-v2.md`)
   pour garder l'original intact comme témoin du "premier jet" ?
3. **On creuse encore 1 cluster spécifique** avant de patcher (par
   exemple R4 PerspectiveSlot mérite peut-être un schéma de séquence
   illustré pour le `WAITING_RESPONSE.targetPlayer` extension) ?

Mon read d'architecte : **option 1**, parce qu'on a déjà beaucoup de
matériel et qu'un v2 risque la dérive doc. La spec v1 reste reachable via
git history si besoin.
