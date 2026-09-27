---
title: Phase γ — Option C — Second-pass review findings
status: review complete — 3rd pass amendments required
target_spec: phase-gamma-option-c-multiplex-spec.md (post-A1-A17)
date: 2026-05-28
authors:
  - Winston (architect, synthesis)
reviewer:
  - Second-pass adversarial sub-agent (9 findings)
---

# Second-pass adversarial review — 9 nouveaux findings

La spec patchée v1+A1-A17 a été soumise à une re-review focalisée sur les
**interactions entre amendments** et les **ambiguïtés laissées par les
patches**. **9 nouveaux findings** identifiés, dont **1 BLOCKER** (N3) +
**3 HIGH** (N1, N2, N4). Vérifications chirurgicales du code menées sur
N2 et N3 — les 2 sont confirmés.

## Triage en clusters

| Finding | Sévérité | Cluster cause-racine | Status |
|---|---|---|---|
| **N1** WAITING_RESPONSE dropped via no-op-on-1 | HIGH | Interaction A1 × A8.2 — patch demi-fait | Confirmation par grep, code-level |
| **N2** DUEL_STARTING reconnect site non patché | HIGH | A1bis incomplet (1/2 emit sites couvert) | **Confirmé chirurgicalement** `server.ts:1176` |
| **N3** F5 SOLO ⇒ DUEL_END draw_both_disconnect | **BLOCKER** | A3bis × startGracePeriod existant | **Confirmé chirurgicalement** `timer-management.ts:333-362` |
| **N4** ANIMATIONS_DONE.forPlayer × A2 strict validation | HIGH | Contradiction A9 ↔ A2 sur path PvP normal | Code-level |
| **N5** `sendResponse` clearing rule pour `_pendingPrompt` slot | MEDIUM | Ambiguïté A8 (write rule incomplet) | Spec-level |
| **N6** `_boardActive` reset au REMATCH_STARTING | MEDIUM | A14 silencieux sur le rematch | Spec-level |
| **N7** `_switching` debounce × banner UX A13 click race | MEDIUM | Nouveau risque UX introduit par A13 | UX-level |
| **N8** WebSocketFactoryService call sites non énumérés | LOW | A15 inventaire incomplet | Spec-level |
| **N9** T-F6 + Playwright à 1.25j sous-estimé | MEDIUM | Estimate inflation persiste | Effort-level |

---

## 🔴 N3 — BLOCKER : Chaque F5 SOLO termine le duel en "draw_both_disconnect"

### Le bug en clair

L'amendment **A3bis** clear `players[1].connected = false` synchroniquement
dans `ws.on('close')` SOLO. Juste après, `startGracePeriod(session, live)`
est appelé (`server.ts:1135`). Cette fonction (`timer-management.ts:333+`)
**vérifie si l'autre joueur est déconnecté** et — s'il l'est — entre dans
la branche **`bothDisconnected`** qui arme `combinedGraceTimer`. Après
`bothDisconnectedCleanupMs`, le serveur **envoie `DUEL_END { winner:null,
reason:'draw_both_disconnect' }`** et terminate la session.

### Confirmation chirurgicale du code

```ts
// timer-management.ts:333+
export function startGracePeriod(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  // ...
  const otherIndex: Player = playerIndex === 0 ? 1 : 0;
  if (!session.players[otherIndex].connected) {     // ← A3bis l'a clearé !
    session.bothDisconnected = true;
    // ...
    if (!session.combinedGraceTimer) {
      session.combinedGraceTimer = setTimeout(() => {
        session.combinedGraceTimer = null;
        const endMsg: ServerMessage = { type: 'DUEL_END', winner: null, reason: 'draw_both_disconnect' };
        logger.log('DUEL_END', { duelId: session.duelId, winner: null, reason: 'draw_both_disconnect' });
        // ... → cleanupDuelSession
      }, c.bothDisconnectedCleanupMs);
    }
  }
  // ...
}
```

**Scénario reproductible** : l'utilisateur fait un F5 sur la page SOLO PvP.
1. WebSocket close.
2. `ws.on('close')` SOLO patché (A3bis) clear `players[1].connected = false`.
3. `startGracePeriod(session, 0)` (live=0).
4. `otherIndex=1`, `!players[1].connected === true` → branche bothDisconnected.
5. `combinedGraceTimer` armé.
6. Front tente reconnect via reconnectToken.
7. **Race** : si le reconnect arrive AVANT `bothDisconnectedCleanupMs`,
   `server.ts:1049` (`if (reconnect && session.bothDisconnected)`) clear le
   timer et restore — **OK**. Si le reconnect échoue ou est lent
   (réseau lent, F5 en double, browser freeze), le timer fire et **le
   duel est terminé `draw_both_disconnect`**.

### Impact

- F5 SOLO ⇒ session **terminée définitivement** si le browser met >
  `bothDisconnectedCleanupMs` à reconnecter.
- L'utilisateur perd son état de duel pour avoir refresh.
- C'est EXACTEMENT le scénario "SOLO PvP refresh F5" qui motivait le
  mémo `pvp-solo-chain-state-hygiene-2026-05-23` et qui a poussé toute
  cette démarche γ.
- **Le fix d'origine A3bis introduit donc un bug pire que celui qu'on
  voulait éviter (session leak vs session perdue)**.

### Remediation A18

A3bis doit être **inversé pour `startGracePeriod`** : en SOLO multiplex,
ne PAS clear `players[1].connected` AVANT le grace check. La solution
propre = **skip entièrement `startGracePeriod` en SOLO** (il n'y a pas
d'opponent à attendre, la grace logic est non-sense en mono-user).

```ts
ws.on('close', () => {
  const live = currentPlayerIndex();
  session!.players[live].connected = false;
  // A3bis-revised : en SOLO, ne PAS toucher à players[1].connected ici.
  // (Le clear symétrique pour isFullyDisconnected se fait au moment du
  // cleanup post-duel, pas au socket close.)

  if (!session!.endedAt) {
    if (session!.soloMode) {
      // A3bis-revised : pas de grace logic en SOLO (1 user, pas d'opponent).
      // Simple : on a `players[0].connected=false` ; le user a 30 minutes
      // pour reconnect via reconnectToken. Aucun timer combiné, aucun
      // DUEL_END automatique.
      pauseTurnTimer(session!);
      clearInactivityTimer(session!, live as Player);
      // (Pas de OPPONENT_DISCONNECTED envoyé : no-op via §3.2.)
    } else {
      pauseTurnTimer(session!);
      clearInactivityTimer(session!, live as Player);
      sendToPlayer(session!, opponentIndex, { type: 'OPPONENT_DISCONNECTED', gracePeriodSec: RECONNECT_GRACE_MS / 1000 });
      startGracePeriod(session!, live);
    }
  }
  // ...
});
```

**`isFullyDisconnected` revisité** : sans le clear symétrique, le helper
doit aussi se brancher en SOLO :
```ts
function isFullyDisconnected(session: ActiveDuelSession): boolean {
  if (session.soloMode) return !session.players[0].connected;  // seul socket
  return !session.players[0].connected && !session.players[1].connected;
}
```

C'était ma proposition initiale en deep dive. **A3 était correct, c'est
A3bis qui était mauvais et a introduit N3**.

**Effort spec** : 0.25j (réécrire A3bis + clarifier `isFullyDisconnected`).
**Effort code** : trivial.

**Test** : `T-S10` — SOLO close ⇒ pas de `combinedGraceTimer`, pas de
`bothDisconnected=true`, reconnect possible jusqu'à un timeout long.

---

## 🟠 N1 — HIGH : WAITING_RESPONSE dropped en SOLO via no-op-on-1

### Le bug en clair

A8.2 spécifie `WAITING_RESPONSE.targetPlayer` pour que le front route au
bon slot. **Mais le message lui-même n'arrive jamais au socket en SOLO**
quand `targetPlayer=0` :

```ts
// worker-message-router.ts:266-267 :
const opponentOfTarget: 0 | 1 = targetPlayer === 0 ? 1 : 0;
send(session, opponentOfTarget, { type: 'WAITING_RESPONSE' });
```

Quand `targetPlayer=0` (le slot 0 doit répondre), `opponentOfTarget=1`,
et `sendToPlayer(session, 1, WAITING_RESPONSE)` est **no-op-on-1 en SOLO
(A1)**. Le slot 1 du front ne reçoit jamais le message.

### Remediation A19

Le serveur doit envoyer **WAITING_RESPONSE au socket 0 toujours en SOLO**,
avec le `targetPlayer` populé pour le routage front :

```ts
// worker-message-router.ts:266-267 — patch SOLO
if (session.soloMode) {
  // Envoyer WAITING_RESPONSE au seul socket avec targetPlayer pour routing slot.
  send(session, 0, { type: 'WAITING_RESPONSE', targetPlayer: opponentOfTarget });
} else {
  send(session, opponentOfTarget, { type: 'WAITING_RESPONSE' });
}
```

**Effort spec** : 0.1j (compléter A8.2 dans §3.1 et §3.6).
**Effort code** : trivial.

**Test** : `T-S11` — SOLO `SELECT_CARD.player=0` ⇒ `WAITING_RESPONSE` reçu
sur socket 0 avec `targetPlayer=1`.

---

## 🟠 N2 — HIGH : DUEL_STARTING reconnect site non patché

### Le bug en clair

A1bis modifie `server.ts:634-635` pour ajouter `bothCardCodes` en SOLO.
**Mais le 2e site d'émission de DUEL_STARTING** (`server.ts:1176`, dans le
reconnect path `sendStateSnapshot`) **n'est pas patché** :

```ts
// server.ts:1176 — site oublié
sendToPlayer(session, playerIndex, {
  type: 'DUEL_STARTING',
  playerIndex,
  traceId: session.duelId,
  cardCodes: extractCardCodesForPlayer(session.decks, playerIndex)
} as ServerMessage);
```

En reconnect SOLO, `playerIndex = currentPlayerIndex() = 0`, donc :
- `cardCodes` = deck 0 uniquement
- Pas de `bothCardCodes`
- Si A5 (perspective persistée localStorage) restore perspective=1,
  l'utilisateur a besoin des images de deck 1 pour son rendu → JIT prefetch
  manquant pour ces cards.

### Remediation A20

Étendre A1bis au site 1176 :
```ts
// server.ts:1176 — patch
if (session.soloMode) {
  sendToPlayer(session, 0, {
    type: 'DUEL_STARTING',
    playerIndex: 0,
    traceId: session.duelId,
    cardCodes: extractCardCodesForPlayer(session.decks, 0),
    bothCardCodes: [
      extractCardCodesForPlayer(session.decks, 0),
      extractCardCodesForPlayer(session.decks, 1),
    ],
  });
} else {
  sendToPlayer(session, playerIndex, { /* legacy */ });
}
```

**Effort spec** : 0.1j (compléter §3.2.bis et §3.6 pour lister les 2 sites).
**Effort code** : trivial.

**Test** : `T-S12` — reconnect SOLO ⇒ `sendStateSnapshot` émet
DUEL_STARTING avec `bothCardCodes`.

---

## 🟠 N4 — HIGH : ANIMATIONS_DONE.forPlayer × A2 strict validation

### Le bug en clair

A9 propose `ANIMATIONS_DONE.forPlayer = lastSendResponse.forPlayer` avec
fallback sur `duelCtx.perspective()()` si pas de réponse récente.

**Problème en PvP normal** : il n'y a pas de SOLO multiplex, donc le
front PvP ne doit JAMAIS tagger `forPlayer`. Mais le `wsService.sendAnimationsDone`
ne sait pas distinguer SOLO vs PvP normal sans une garde explicite.

A2 (validation stricte côté serveur) **rejetterait l'ANIMATIONS_DONE
PvP avec un `forPlayer` accidentel** :
```ts
if (!session.soloMode && incomingForPlayer !== undefined) {
  logger.warn('forPlayer field rejected (PvP normal — possible impersonation attempt)', ...);
  return;
}
```
⇒ Le `ANIMATIONS_DONE` est dropé silencieusement ⇒ le `pendingTimeout`
serveur ne fire jamais ⇒ le turn timer ne démarre pas ⇒ partie bloquée.

### Remediation A21

Le front doit **conditionner le tag forPlayer sur le mode SOLO** :

```ts
// wsService.sendAnimationsDone
sendAnimationsDone(): void {
  const forPlayer = this.soloMode ? this._lastSentForPlayer ?? this.duelCtx.perspective()() : undefined;
  this._connection.sendAnimationsDone(forPlayer);
}
```

Pareil pour les 5 autres `sendXxx` (sauf `sendResponse` qui a déjà la
règle explicite).

**Comment savoir si SOLO ?** Pattern existant : la `SoloDuelOrchestratorService.enabled`
flag. Mais le `wsService` ne dépend pas du SoloOrchestrator (DI inverse).
Solution simple : `SoloDuelOrchestratorService.init()` flippe une property
`wsService.soloMode = true` à l'initialisation. Le `wsService` reste
agnostique sinon (PvP normal = false par défaut).

**Effort spec** : 0.1j (compléter §4.4 avec la garde + ajouter T-F11).
**Effort code** : trivial.

**Test** : `T-F11` — PvP normal `sendAnimationsDone()` ⇒ payload sans
`forPlayer` field.

---

## 🟡 N5 — MEDIUM : `sendResponse` clearing rule pour `_pendingPrompt` slot

### Le bug en clair

A8 dit "clear LES DEUX slots pour DUEL_END / REMATCH_STARTING /
STATE_SYNC". **Mais ne dit rien sur le clear après `sendResponse`**.

Aujourd'hui, le code `duel-connection.ts:356` clear `_pendingPrompt` sync
après `sendResponse`. En multiplex, le slot à clearer = celui auquel le
prompt appartient. Sinon : le banner A13 montre "Action requise de P1"
pour un prompt déjà répondu, car `_slots[1].pendingPrompt` reste set.

### Remediation A22

§4.4 doit dire explicitement :

> Quand `sendResponse(promptType, data, forPlayer)` est appelé en SOLO, il
> clear sync `_slots[forPlayer].pendingPrompt`, `_slots[forPlayer].lastSelectedCards`,
> `_slots[forPlayer].lastSelectedPromptType` (la logique existante mais
> ciblée). Le `_hintCardConsumed = true` reste per-slot.

**Effort spec** : 0.1j.
**Effort code** : trivial (extension du `sendResponse` existant).

**Test** : `T-F12` — `sendResponse(forPlayer=1)` ⇒ `_slots[1].pendingPrompt() === null`,
`_slots[0].pendingPrompt()` inchangé.

---

## 🟡 N6 — MEDIUM : `_boardActive` reset au REMATCH_STARTING

### Le bug en clair

A14 dit "`_boardActive` set ONCE au bootstrap". Mais REMATCH_STARTING
**tear down le duel et re-spawn le worker**. Le nouveau BOARD_STATE doit
re-déclencher `syncAfterBoardState` tier 1 (`!boardActive → syncPileCounts`)
pour que le bootstrap fonctionne correctement (avec le pre-activation
buffer drain).

`duel-connection.ts:873-892` (handler REMATCH_STARTING) clear beaucoup de
state mais **ne touche pas à `_boardActive`**. Le flag reste `true`,
donc le prochain BOARD_STATE ne passe pas par tier 1, et le pre-activation
buffer ne se drain pas (les 5 MSG_DRAW initiaux du nouveau duel ne
s'animent pas).

### Remediation A23

Ajouter au handler REMATCH_STARTING (`duel-connection.ts:880` ou
adjacent) :
```ts
this._boardActive = false;
// (le DuelLoadingEffectsService re-flip à true quand le nouveau BOARD_STATE arrive)
```

**Effort spec** : 0.05j.
**Effort code** : 1 ligne.

**Test** : `T-F13` (Playwright) — Scenario C "rematch SOLO" : les 5 MSG_DRAW
du nouveau duel s'animent (preuve buffer drainage correct).

---

## 🟡 N7 — MEDIUM : `_switching` debounce × banner UX click race

### Le bug en clair

A13 propose une banner "Action requise de P{N+1}" avec un bouton
"Basculer". Click → `switchPerspective()`. Mais `_switching` debounce
les switches à 300ms. Si le user clique pendant une cascade de prompts
(chain Maxx C avec switch enchaînés), le 2e click est silencieusement
ignoré et la banner reste affichée.

### Remediation A24

Template HTML : `disabled` quand `switching()` :
```html
@if (pendingPromptForOtherSlot()) {
  <app-banner [text]="'Action requise de P' + (otherSlot() + 1)">
    <app-button (click)="switchToOtherSlot()" [disabled]="orchestrator.switching()">
      Basculer
    </app-button>
  </app-banner>
}
```

**Effort spec** : 0.1j (préciser §4.6/A13).
**Effort code** : trivial template.

**Test** : `T-F14` — click pendant `switching=true` ⇒ pas d'effet, banner
stays.

---

## 🟢 N8 — LOW : WebSocketFactoryService call sites non énumérés

A15 introduit l'injection token mais §4.7 ne liste pas tous les call
sites à adapter. Inventaire chirurgical :

| Site | Action |
|---|---|
| `duel-web-socket.service.ts:51` (`_defaultConnection` PvP normal) | passer le factory en ctor |
| `solo-duel-orchestrator.service.ts:113,117` (γ legacy) | supprimé par commit 6 ; remplacé par 1 site mono-conn |
| `replay-duel-adapter.ts` | **À VÉRIFIER** — utilise-t-il `DuelConnection` ? Selon CLAUDE.md non (concrete WebSocket class). |
| Tests `duel-connection.spec.ts:*` (~4 sites) | mock factory injection |

**Remediation A25** : ajouter cet inventaire à §7.3 + §4.7.

**Effort spec** : 0.05j.

---

## 🟡 N9 — MEDIUM : Estimate inflation persistant

T-F6 vrai pipeline (chain complet) + Playwright A+B + Scenario C
(REMATCH) à 1.25j est sous-estimé.

**Plus réaliste** : 2-2.5j combiné.

**Buffer §9 actuel** = 1j. Consommé par N3 fix + N6 (rematch BOARD_STATE)
+ N7 (banner debounce). **Plus de buffer pour les imprévus**.

### Remediation A26

§9 estimate révisé :

| Phase | Avant N1-N9 | Après amendments N1-N9 | Justification |
|---|---|---|---|
| **Serveur (PR1)** | 1.5j | **1.75j** | +N1 WAITING_RESPONSE branch SOLO |
| **Serveur (PR2 lifecycle)** | 0.75j | **1j** | +N2 DUEL_STARTING reconnect site + N3 grace SOLO skip + isFullyDisconnected revisited |
| **Front PerspectiveSlot (commit 4)** | 3j | **3.25j** | +N5 sendResponse slot-clear |
| **Front wsService (commit 5)** | 0.75j | **0.85j** | +N4 forPlayer SOLO-only guard |
| **Front mono-connection (commit 6)** | 1.5j | **1.75j** | +N6 _boardActive REMATCH reset + N7 banner debounce |
| **Tests (commit 7)** | 1.25j | **2.5j** | T-F6 + Playwright A+B+C + 5 nouveaux T-S/T-F (T-S10-12, T-F11-14) |
| **Cleanup (commit 8)** | 0.25j | 0.25j | inchangé |
| **Buffer risques** | 1j | **1.5j** | absorption +0.5j pour imprévus restants |
| **TOTAL CODE** | 10j | **~13j** | |
| **Amendements doc (déjà appliqués)** | 2.6j | **3.1j** | +0.5j pour 9 nouveaux amendments A18-A26 |
| **GRAND TOTAL** | 12.6j | **~16.1j** | |

---

## Things les patches A1-A17 ont fait RIGHT (confirmé par re-review)

- **A2 strict validation** ferme le trou d'impersonation PvP — vrai fix.
- **A3 lifecycle helpers** centralisent la doctrine correctement, modulo
  la N3 que A3bis a introduite.
- **A17 BOARD_STATE swap étendu** au BoundaryProcessor + boardStateAfter
  était exactement le bon call — pas de spurious turn boundaries au switch.
- **A1 no-op-on-1** est plus clean que le rejeté `broadcastToBoth` — gère
  uniformément 11 broadcasts.
- **A12/A7 2-PR split** est correct : PR1 vraiment isolable, contrainte
  rollback honnêtement énoncée.

---

## Plan de remediation A18-A26

| ID | Cluster | Amendment | Effort spec | Effort code |
|---|---|---|---|---|
| **A18** | N3 BLOCKER | A3bis inversé — skip grace en SOLO + `isFullyDisconnected` revisité | 0.25j | trivial |
| **A19** | N1 HIGH | `WAITING_RESPONSE` branch SOLO `send(0, {targetPlayer})` | 0.1j | trivial |
| **A20** | N2 HIGH | DUEL_STARTING reconnect site `server.ts:1176` patché | 0.1j | trivial |
| **A21** | N4 HIGH | `sendXxx` forPlayer SOLO-only via `wsService.soloMode` flag | 0.1j | trivial |
| **A22** | N5 MEDIUM | `sendResponse` clear slot du `forPlayer` répondant | 0.1j | trivial |
| **A23** | N6 MEDIUM | REMATCH_STARTING reset `_boardActive = false` | 0.05j | trivial |
| **A24** | N7 MEDIUM | Banner button disabled pendant `switching()` | 0.1j | trivial |
| **A25** | N8 LOW | WebSocketFactory call sites inventaire complet | 0.05j | n/a |
| **A26** | N9 MEDIUM | Estimate révisé à ~16.1j | 0.05j | n/a |
| **TOTAL** | | | **~0.9j** | **~0.5j** |

Après A18-A26 : spec **implementation-ready**.

---

## Verdict global après deux passes adversariales

- **1er passage** : 27 findings, dont 2 BLOCKER + 5 CRITIQUES. Amendments
  A1-A17 livrés.
- **2e passage** : 9 findings sur les amendments, dont **1 BLOCKER (N3)**
  + 3 HIGH (N1, N2, N4). Amendments A18-A26 nécessaires.

**Le core architecture (1 socket multiplex + omniscient + per-slot front
state) reste sound**. Les 36 findings cumulés ont tous une remediation
chirurgicale, aucun ne remet en cause l'approche.

**Estimate révisé final : ~16.1j** (vs 6.5j initial — multiplicateur ×2.5).

**Décision recommandée** : appliquer A18-A26 puis acter la spec comme
"implementation-ready". **Pas de 3e re-review** — la convergence est
atteinte (les findings de 2e passage sont tous des extensions/oublis
ponctuels des amendments, pas des problèmes structurels nouveaux).

---

## Prochaine étape

Appliquer A18-A26 dans la spec (~0.9j de doc). Ensuite découpe BMad
`bmad-create-epics-and-stories` sur la spec finale.
