---
title: Phase γ — Option C (1-socket multiplex SOLO) — Spec d'architecture
status: implementation-ready (post-3 adversarial passes)
branch_target: feat/anim-pipeline-v2 (ou une branche dérivée — voir §6 migration)
depends_on:
  - phase-gamma-spec.md (γ déjà mergé)
  - phase-gamma-post-review-findings.md (constat C1–C4)
  - phase-gamma-option-c-adversarial-findings.md (1er passage — 27 findings)
  - phase-gamma-option-c-findings-deep-dive.md (analyse + recommendations)
  - phase-gamma-option-c-second-pass-findings.md (2e passage — 9 findings)
  - phase-gamma-option-c-latent-bugs-review.md (3e passage — 12 findings)
  - pvp-solo-chain-state-hygiene-2026-05-23 (memo des 2 symptômes pré-existants)
phase_predecessor: γ (single-processor SOLO + perspective projector) + cleanup `dcf3330f`
phase_successor: chantier C-suite (élimination des 7 findings restants déclenchée par option C)
date: 2026-05-28 (v1 + amendments A1-A38)
authors:
  - Axel (lead)
  - Winston (architecte)
---

# Phase γ — Option C : 1-socket multiplex SOLO

> **Statut de cette spec** : v1 livrée le 2026-05-28, **38 amendments
> A1-A38 intégrés** après 3 passages d'adversarial review (48 findings
> cumulés). Versions précédentes accessibles via git history. Mapping
> "amendement → section modifiée" en §13.
>
> **Note 3e passe** : la décision architecturale centrale de la 3e
> passe est **A28** — généralisation de la doctrine `sendToPlayer`
> no-op-on-1 en "routing-to-0 selon whitelist" pour 4 messages
> pseudo-pairwise (INACTIVITY_WARNING, ERROR, REMATCH_INVITATION,
> WAITING_RESPONSE). Cette centralisation résout structurellement F2 /
> F4 / F6 + le précurseur A19. Voir §3.2 + §13 Passage 3.

## 1. Objet

Le doc `phase-gamma-post-review-findings.md` documente 23 findings résiduels
après γ + β.3 cas #12, regroupés en 4 clusters. Le cluster C1 (6 findings
BLOCKER) est la **bug-mère** : les 2 sockets SOLO pushent simultanément
dans le même processor partagé, ingérant chaque MSG_* 2× (double-fire
visuel, double-lock, lien de chain fantôme).

3 options de fix ont été identifiées :
- **Option A** — dedup hash au point de convergence (~1j, palliatif).
- **Option B** — 1-socket-actif pré-γ partiel (régression doctrinale, rejetée).
- **Option C** — multiplex serveur : **1 seul WebSocket** en SOLO, le
  filtering per-perspective devient une projection front (~16j incluant
  spec + code + tests + amendments, élimine 8/23 findings par construction
  dont les 6 BLOCKER de C1 + C2.1 + C4.9).

Ce document spécifie l'option C dans le détail : périmètre serveur,
périmètre front, surface de protocole, séquencement de migration, risques,
tests, métrique de succès. Il est conçu pour servir de base à un plan
d'implémentation BMad (`bmad-create-architecture` → epics/stories).

---

## 2. Contexte : pourquoi l'option C élimine 8 findings par construction

### 2.1 Diagnostic de la bug-mère (C1)

```
[OCGCore worker] ──msg──▶ [worker-message-router]
                              │
                              ├──filterMessage(msg, 0)──▶ session.players[0].ws ──▶ conn0 ──▶ sharedProcessor.processMessage(msg)
                              └──filterMessage(msg, 1)──▶ session.players[1].ws ──▶ conn1 ──▶ sharedProcessor.processMessage(msg)
                                                                                                       ▲
                                                                                              MÊME MESSAGE INGÉRÉ 2×
```

`worker-message-router.ts:280-291` itère `for (const playerIndex of [0, 1])`
inconditionnellement — même en SOLO. Côté front,
`solo-duel-orchestrator.service.ts:113-120` instancie 2 `DuelConnection`,
chacune appelant `this.processor.processMessage(message)` dans son
`handleMessage` (`duel-connection.ts:709,738,905,932,938,947,960,985,1007`).
Le `sharedProcessor` partagé reçoit le même MSG_* deux fois.

Aucune garde anti-doublon n'existe (`grep dedupe|deduplic|alreadySeen|
seenMessage|messageHash|processedRefs|_lastMsg` → 0 résultat).

### 2.2 Cible

```
[OCGCore worker] ──msg──▶ [worker-message-router]
                              │
                              └──filterMessage(msg, 0, omniscient=true)──▶ session.players[0].ws ──▶ conn ──▶ sharedProcessor.processMessage(msg)
                                                                                                     ▲
                                                                                            UN SEUL chemin, ingéré 1×
```

En SOLO :
- **1 seul WebSocket physique** (`players[0].ws`).
- **1 seul `DuelConnection` front**.
- **Filtering serveur = omniscient** (mode déjà testé et utilisé en
  prod par `fork-handlers.ts:177-190` et `replay-precompute.ts`).
- **Perspective = projection front** au moment de l'affichage, via le
  signal `DuelContext.perspectiveSource` qui existe déjà depuis γ.
- **Les `PLAYER_RESPONSE` et autres messages client→serveur**
  taggent leur `forPlayer: 0|1` au lieu d'être discriminés par le socket
  d'arrivée.

### 2.3 Findings éliminés par construction

| Finding | Origine | Pourquoi disparaît |
|---|---|---|
| **C1.1 (H1)** — orphan `_defaultConnection.processor` | 3 processors cohabitent en SOLO | 1 connection unique = 1 processor unique, plus de fallback orphelin |
| **C1.2 (H3)** — sérialisation des reads concurrents | 2 sockets `onmessage` interleavés sur 1 processor | 1 socket ⇒ `onmessage` strictement séquentiel par construction WS |
| **C1.3 (H4)** — `_lastDrawAnnouncedHash` per-connection ⇒ DRAW announce ×2 | accumulateurs per-instance dédoublés | 1 connection ⇒ 1 accumulateur, indexé par perspective via la projection |
| **C1.4 (B2)** — `_sharedProcessor` non-signal ⇒ computeds piégés sur l'orphelin | binding indirect via 2 chemins | 1 processor accessible directement, plus de `bindSharedProcessor` |
| **C1.5 (M12)** — `setBoardActive(true)` asymétrique au switch | flippé sur la conn entrante | `switchPerspective` ne touche plus le transport, juste le signal |
| **C1.6 (memo pré-γ)** — Lock timeout / POLL-DROP REGRESSION en SOLO | symptôme observable de C1 | bug-mère éliminée ⇒ symptômes disparus |
| **C2.1 (B1)** — `resetForSwitch` câblé au rematch SOLO | race REMATCH_STARTING entre 2 transports | 1 REMATCH_STARTING reçu par 1 transport ⇒ 1 reset, pas de race |
| **C4.9 (L4)** — `attachOutOfBandSink` câblé sur le mauvais processor | symptôme direct de C1.1 | plus d'orphelin ⇒ plus de mauvais câblage |

Les 8 findings sont **structurellement effacés**, pas mitigés. Pas de
garde, pas de prédicat à raisonner. C'est la différence fondamentale avec
l'option A.

Les 15 findings restants (C2.2 + tout C3 + C4 sauf C4.9) sont
indépendants de C1 et sont à traiter séparément.

---

## 3. Périmètre serveur

### 3.1 Boucle de broadcast — `worker-message-router.ts:280-291`

**Modification** : brancher sur `session.soloMode`.

```ts
// AVANT (lignes 280-291)
for (const playerIndex of [0, 1] as const) {
  const filtered = duelInstr.time('filterMessage', () => filterMessage(message, playerIndex));
  if (filtered) {
    if (isSelectMessage(message) && (message as { player: Player }).player === playerIndex) {
      session.lastSentPrompt[playerIndex] = filtered;
    }
    if (message.type === 'MSG_HINT') {
      session.lastSentHint[playerIndex] = filtered;
    }
    send(session, playerIndex, filtered);
  }
}

// APRÈS
if (session.soloMode) {
  // 1 seul socket en SOLO : filtrage omniscient (mode déjà testé par fork-handlers
  // et replay-precompute). Le perspective sanitization (BOARD_STATE swap) est
  // skippé puisque le front gère la projection. `lastSentPrompt` / `lastSentHint`
  // sont cachés selon `message.player` (et non l'index destinataire), pour
  // garantir que resendPendingPrompt à la reconnect ré-arrive à la bonne perspective.
  const filtered = filterMessage(message, 0, /* omniscient */ true);
  if (filtered) {
    if (isSelectMessage(message)) {
      const p = (message as { player: Player }).player;
      session.lastSentPrompt[p] = filtered;
    }
    if (message.type === 'MSG_HINT') {
      const p = (message as { player: Player }).player;
      session.lastSentHint[p] = filtered;
    }
    send(session, 0, filtered);
  }
} else {
  // Path PvP normal — inchangé.
  for (const playerIndex of [0, 1] as const) { /* legacy unchanged */ }
}
```

**Justification omniscient** : le mode existe déjà
(`message-filter.ts:50`) avec un comportement bien défini — skip routing
drops (SELECT_*, MSG_HINT non-public, MSG_CONFIRM_CARDS private) + skip
field sanitization (card codes, hand contents, face-down stats préservés).
Les transformations de perspective (DICE_RESULT swap, BOARD_STATE
`turnPlayer` remap, BOARD_STATE swap `players[]`) restent appliquées mais
sont **anodines en SOLO** :
- DICE_RESULT : flow dés/RPS skippé en SOLO (`server.ts:578-584` court-circuite
  `startFirstPlayerPhase` quand `soloMode === true`) ⇒ le swap n'est jamais
  exercé en SOLO et **n'est pas un problème à compenser**.
  - 🆕 **A36 (3e passe, future-regression hazard)** : ajouter un
    commentaire load-bearing au site `first-player-coordinator.ts:578-584`
    ou — préférable — un `duelAssert(!session.soloMode, 'first-player-coordinator',
    'unreachable in SOLO')` en tête de `startFirstPlayerPhase`. Si une
    régression future fait passer DICE_RESULT par le path SOLO (e.g. un
    test injecté ou un nouveau mode de duel), le user en perspective=1
    verrait des dés sans swap — A36 surface l'incohérence immédiatement.
- BOARD_STATE : le swap pose un vrai contrat front (cf. §4.5 ci-dessous).

#### 🆕 A10 — Doctrine "Information disclosure under omniscient SOLO"

**Doctrine** : "user is both players in SOLO". Toutes les révélations
(`MSG_DRAW.cards` intactes, `MSG_MOVE.cardCode` des locations privées,
`MSG_CONFIRM_CARDS.private`, `MSG_SHUFFLE_HAND.cards`) sont visibles
indépendamment de la perspective courante. C'est intentionnel : SOLO sert
au testing combo, où l'utilisateur veut voir les 2 mains. **Ce n'est PAS
un bug** même si visuellement asymétrique vs PvP normal (où le filtering
per-player masquerait ces fields).

⚠️ **Subtilité BOARD_STATE en omniscient SOLO** :
`message-filter.ts:235-249` (`sanitizeBoardState`) fait :
```ts
turnPlayer: data.turnPlayer === forPlayer ? 0 : 1,
players: [
  data.players[forPlayer],
  omniscient ? data.players[opponentIndex] : sanitizeOpponentBoard(...),
],
```
Avec `forPlayer=0` figé en SOLO multiplex, `players[]` arrive toujours
dans l'ordre absolu serveur (P0 = index 0, P1 = index 1). Le front
SOLO doit relativiser au moment du rendu via le signal
`DuelContext.perspective()` (déjà la convention γ).

C'est un **vrai changement de contrat** pour le front : aujourd'hui
le `BOARD_STATE.data.players[0]` désigne le viewer (relatif),
demain il désignera P0 absolu en SOLO. Détail traité en §4.5.

### 3.2 `sendToPlayer(session, playerIndex, message)` — 37 call sites

#### 🆕 A1 — Recompte chirurgical des sites pseudo-pairwise

J'ai relu **tous** les sites `sendToPlayer(s, 0, X); sendToPlayer(s, 1, X);`
listés dans la spec d'origine. Verdict révisé :

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
| **DUEL_STARTING (initial)** | `server.ts:634-635` | **cardCodes per-player** | **Pseudo-pairwise** |
| **DUEL_STARTING (reconnect)** | `server.ts:1176` | **cardCodes per-player** | **Pseudo-pairwise** (cf. A20) |
| DECK_PREFETCH | `first-player-coordinator.ts:232-233` | cardCodes per-player | Pseudo-pairwise — **skippé en SOLO** (flow dés/RPS bypassé) |
| FIRST_PLAYER_RESULT | `first-player-coordinator.ts:234-235` | goFirst inversé | Pseudo-pairwise — **skippé en SOLO** (flow dés/RPS bypassé) |

**Conclusion** : 11 vrais broadcasts + **2 vrais pseudo-pairwise en SOLO**
(les 2 sites DUEL_STARTING — initial + reconnect). Les 2 autres
(`DECK_PREFETCH`, `FIRST_PLAYER_RESULT`) ne sont pas atteints en SOLO
car le `first-player-coordinator` n'est jamais invoqué
(`server.ts:578-584`).

#### Décision Q2 — no-op-on-1 dans `sendToPlayer` (révisée par A28 — routing-to-0 selon whitelist)

**Le `broadcastToBoth` helper est rejeté définitivement.** La doctrine
v1 d'origine était : no-op silencieux sur `playerIndex === 1` en SOLO.
**La 3e passe adversariale (2026-05-28) a révélé que cette doctrine
laisse 4 sites silencieusement cassés** (INACTIVITY_WARNING, ERROR,
WORKER_CANCEL_DONE 3-send rollback, REMATCH_INVITATION — cf. Findings
F2, F4, F6 + A27). A28 généralise la doctrine en **"router-to-0 selon
whitelist"** : les messages logiquement destinés au slot 1 SONT
acheminés au socket 0 (le seul existant), avec un tag de slot
destination dans le payload pour que le front route correctement.

#### 🆕 A28 — Doctrine "routing-to-0 selon whitelist `PSEUDO_PAIRWISE_SOLO_ROUTED`"

```ts
// Whitelist des types de messages qui sont logiquement per-perspective
// (un slot 1 a vraiment besoin de les voir) et qu'on doit ROUTER au
// socket 0 en SOLO multiplex au lieu de dropper. Le payload PORTE le
// tag de slot (`targetPlayer`, `player`, …) que le front lit pour router
// vers le bon `_slots[]`.
//
// Les messages NON listés ici qui passent par playerIndex=1 en SOLO
// (broadcasts purs DUEL_END / TIMER_STATE / REMATCH_STARTING /
// REMATCH_CANCELLED) restent en no-op-on-1 — l'écriture sur socket 0 a
// déjà eu lieu via le sendToPlayer(s, 0, X) précédent. Cohérent.
const PSEUDO_PAIRWISE_SOLO_ROUTED = new Set<ServerMessage['type']>([
  'WAITING_RESPONSE',       // A19 — déjà routé via send(0) au site d'émission
  'INACTIVITY_WARNING',     // A28 — Finding F2 (3e passe)
  'ERROR',                  // A32 — Finding F6 (3e passe)
  'REMATCH_INVITATION',     // A27 — Finding F1 (3e passe, BLOCKER)
  // WORKER_CANCEL_DONE produit des STATE_SYNC + CHAIN_STATE + prompt
  // re-broadcast → routés par A30 directement au site d'émission, pas
  // via cette whitelist (le filtering omniscient passe par `forPlayer`,
  // pas par le type).
]);

function sendToPlayer(session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage): void {
  // STATE_SYNC : per-perspective gameLog snapshot — déjà géré.
  if (message.type === 'STATE_SYNC' && !message.gameLogEntries && session.gameLog) {
    message = { ...message, gameLogEntries: entriesForPlayer(session.gameLog, playerIndex) };
  }
  if (session.soloMode && playerIndex === 1) {
    // A28 — routage selon whitelist.
    if (PSEUDO_PAIRWISE_SOLO_ROUTED.has(message.type)) {
      // Le message a un tag de slot dans son payload (player /
      // targetPlayer / …) ; on l'envoie au socket 0, le front route.
      safeSend(session.players[0].ws, message);
      return;
    }
    // Broadcast pur (DUEL_END, TIMER_STATE, REMATCH_STARTING /
    // CANCELLED) : le send précédent sur playerIndex=0 a déjà écrit ;
    // ce 2e send est strictement no-op.
    return;
  }
  safeSend(session.players[playerIndex].ws, message);
}
```

**Conséquence pour les 11 vrais broadcasts** : send 1 fois en SOLO
(2e en no-op), send 2 fois en PvP normal. Cohérent.

**Conséquence pour les 4 messages whitelist** : send 1 fois en SOLO
(au socket 0, avec tag de slot pour routage front), send 2 fois en PvP
normal (un sur chaque socket, tag ignoré côté front qui lit son
identité depuis sa propre identité socket).

**Conséquence pour STATE_SYNC** : la branche STATE_SYNC `gameLogEntries`
attach utilise `playerIndex` pour piocher la slice. En SOLO multiplex,
seul `playerIndex=0` est envoyé ⇒ seule la slice P0 est attachée. **Le
front doit re-relativiser à l'affichage**, exactement comme pour
BOARD_STATE. Le `DuelGameLogService` consomme déjà des entries par
perspective courante (effect dans `duel-page.component.ts:575`).

#### 🆕 A1bis + A20 — DUEL_STARTING cas particulier en SOLO (2 sites)

```ts
// server.ts:634-635 — site initial
if (session.soloMode) {
  // SOLO multiplex: 1 envoi avec les cardCodes des DEUX decks pour que le
  // front puisse prefetch les images des 2 perspectives.
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
  sendToPlayer(session, 0, { type: 'DUEL_STARTING', playerIndex: 0, traceId: session.duelId, cardCodes: extractCardCodesForPlayer(session.decks, 0) });
  sendToPlayer(session, 1, { type: 'DUEL_STARTING', playerIndex: 1, traceId: session.duelId, cardCodes: extractCardCodesForPlayer(session.decks, 1) });
}

// server.ts:1176 — site reconnect (sendStateSnapshot)
// A20 — MÊME BRANCHE qu'au site initial. Découvert en 2e passage adversarial.
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
  sendToPlayer(session, playerIndex, { type: 'DUEL_STARTING', playerIndex, traceId: session.duelId, cardCodes: extractCardCodesForPlayer(session.decks, playerIndex) } as ServerMessage);
}
```

Extension de protocole — `DUEL_STARTING.bothCardCodes?: number[][]` —
détaillé en §5.

**⚠️ Critique** : A20 est l'amendment qui résout N2 du 2e passage. Sans
lui, un reconnect SOLO (F5) avec perspective=1 restored via A5 reçoit
deck0 codes au lieu de deck0+deck1 ⇒ prefetch images cassé pour la
perspective courante.

#### 🆕 A19 — `WAITING_RESPONSE` branch SOLO (`§3.2.ter`)

`WAITING_RESPONSE` est aujourd'hui envoyé via
`send(session, opponentOfTarget, { type: 'WAITING_RESPONSE' })`
(`worker-message-router.ts:267`). En SOLO multiplex, quand
`opponentOfTarget = 1`, le `sendToPlayer(s, 1, X)` est **no-op-on-1**
(A1) ⇒ le message n'arrive jamais au socket SOLO ⇒ `_slots[1].waitingForOpponent`
reste à `false` éternellement ⇒ banner UX (A13) ne fire pas.

**Solution** : brancher en SOLO pour envoyer au socket 0 avec le
`targetPlayer` populé (A8.2) :

```ts
// worker-message-router.ts:266-267 — patch SOLO
if (session.soloMode) {
  // Envoyer WAITING_RESPONSE au seul socket avec targetPlayer pour
  // routage slot front-side. Le no-op-on-1 du sendToPlayer ne s'applique
  // pas ici (on bypass `opponentOfTarget` au profit d'un send direct sur 0).
  send(session, 0, { type: 'WAITING_RESPONSE', targetPlayer: opponentOfTarget });
} else {
  send(session, opponentOfTarget, { type: 'WAITING_RESPONSE', targetPlayer: opponentOfTarget });
}
```

Note : en PvP normal, `targetPlayer` est populé aussi (cohérence
protocole, front ignore en PvP).

**Note A28** : avec la doctrine A28 généralisée (whitelist
`PSEUDO_PAIRWISE_SOLO_ROUTED`), A19 pourrait être trivialement réduit
à `send(session, opponentOfTarget, { type: 'WAITING_RESPONSE',
targetPlayer: opponentOfTarget })` sans branche `if (soloMode)` — le
`sendToPlayer` route automatiquement au socket 0 en SOLO via la
whitelist. **Décision** : garder le `if (soloMode)` explicite pour la
lisibilité du diff (traçabilité commit 2 PR1).

#### 🆕 A27 — Rematch SOLO court-circuit (Finding F1 BLOCKER)

`client-message-router.ts:174-184` (case `REMATCH_REQUEST`) — la gate
"both requested" est cassée en SOLO multiplex : `REMATCH_INVITATION`
est envoyé à `opponentIdx=1` et **n'arrive jamais** (no-op-on-1 ou
routing-to-0 sans correspondant slot 1 côté front). Le front
`_slots[1].rematchState` reste `'idle'`, le 2e `sendRematchRequest`
n'est jamais émis, `startRematch` jamais appelé.

**Solution serveur** :
```ts
// client-message-router.ts:174-184
case 'REMATCH_REQUEST': {
  if (session.endedAt === null) break;
  session.rematchRequested[playerIndex] = true;
  // A27 — SOLO court-circuit : 1 user = 1 click = rematch immédiat.
  // Pas d'opponent à inviter, pas de gate "both requested".
  if (session.soloMode) {
    cfg.startRematch(session);
    break;
  }
  // Path PvP normal — inchangé.
  const opponentIdx: Player = playerIndex === 0 ? 1 : 0;
  if (session.rematchRequested[opponentIdx]) {
    cfg.startRematch(session);
  } else {
    send(session, opponentIdx, { type: 'REMATCH_INVITATION' });
  }
  break;
}
```

**Solution front** (`SoloDuelOrchestratorService.setupRematchEffect`,
A4) : désactiver l'auto-accept `rematchState === 'invited'` en SOLO
car (a) le serveur n'envoie plus REMATCH_INVITATION en SOLO (A27), (b)
le bouton "Rematch" du user déclenche directement `sendRematchRequest`
qui suffit en SOLO.

```ts
private setupRematchEffect(): void {
  const conn = this._connection();
  if (!conn) return;
  runInInjectionContext(this.injector, () => {
    // A27 — auto-accept inutile en SOLO (court-circuit serveur). Skip.
    if (!this.wsService.soloMode) {
      effect(() => {
        if (conn.rematchState() === 'invited') conn.sendRematchRequest();
      }, { allowSignalWrites: true });
    }
    effect(() => {
      if (conn.rematchStarting()) {
        this.animationService.resetForSwitch();
        this.duelCtx.setPerspective(0);
        conn.resetRematchStarting();
        this._rematchReset.update(v => v + 1);
      }
    }, { allowSignalWrites: true });
  });
}
```

**Test** : T-S14 (rematch SOLO court-circuit) + T-F17 (front
sendRematchRequest unique en SOLO déclenche `rematchStarting`).

#### 🆕 A29 — `resendPendingPrompt` × 2 en SOLO reconnect (Finding F3 HIGH)

`server.ts:1072` appelle `resendPendingPrompt(session, playerIndex)`
où `playerIndex` vient du handshake unique en SOLO (= 0). Un F5
perspective=1 avec `lastSentPrompt[1]` actif ne reçoit jamais ce
prompt côté client ⇒ `_slots[1].pendingPrompt` reste null ⇒ banner
A13 "Action requise de P2" jamais affiché ⇒ partie bloquée.

```ts
// server.ts:1072 — patch SOLO
if (session.soloMode) {
  // Les 2 slots du front-side multiplex doivent recevoir leurs prompts
  // respectifs. Le socket 0 reçoit la séquence [hintP0, promptP0,
  // hintP1, promptP1] ; le front route via `message.player`.
  resendPendingPrompt(session, 0);
  resendPendingPrompt(session, 1);
} else {
  resendPendingPrompt(session, playerIndex);
}
```

**Note ordering** : `resendPendingPrompt` envoie hint-then-prompt
par player ⇒ la séquence concaténée respecte l'invariant
"hint AVANT prompt qui l'utilise" par slot (cf. §8.4).

**Test** : T-S13 — SOLO reconnect avec `lastSentPrompt[1]` non-null ⇒
socket 0 reçoit hint+prompt slot 1.

#### 🆕 A30 — `WORKER_CANCEL_DONE` routing-to-0 en SOLO (Finding F4 HIGH)

`worker-message-router.ts:137-186` (`case 'WORKER_CANCEL_DONE'`) émet
3 sends consécutifs (STATE_SYNC, CHAIN_STATE, cached prompt) sur
`send(session, p, …)` où `p = wmsg.playerIndex` = identité OCGCore. En
SOLO multiplex avec un cancel sur slot 1, tous 3 sends → no-op-on-1 →
le front `_slots[1]` ne reçoit jamais le rollback ⇒ desync serveur↔
client immédiat ⇒ strike count → DUEL_END too_many_invalid.

```ts
// worker-message-router.ts:137-186 — patch SOLO
case 'WORKER_CANCEL_DONE': {
  const p = wmsg.playerIndex;
  const cached = session.cancelTargetPrompt[p];
  if (cached) {
    // A30 — SOLO : router au socket 0 (le seul) en gardant le tag
    // logique `p` dans le payload pour que le front route.
    const dest = session.soloMode ? 0 : p;
    // STATE_SYNC : per-perspective game-log slice + omniscient filter
    // pour SOLO (le `filterMessage` regarde `forPlayer=p` même si on
    // envoie au socket dest=0 — l'omniscient flag est ON en SOLO via §3.1).
    if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
      const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
      const filtered = filterMessage(stateSync, p, /* omniscient */ session.soloMode);
      if (filtered) send(session, dest, filtered);
    }
    send(session, dest, {
      type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [],
    } as ServerMessage);
    // … reset chain bookkeeping inchangé …
    session.lastSentPrompt[p] = cached;
    session.awaitingResponse[p] = true;
    send(session, dest, cached);
    session.cancelTargetPrompt[p] = null;
  }
  break;
}
```

**Note** : STATE_SYNC + CHAIN_STATE + cached prompt portent tous le
`player: p` dans leur payload (STATE_SYNC via `gameLogEntries` slice,
CHAIN_STATE via la chain ownership, prompt via `message.player`). Le
front route via `message.player` vers `_slots[p]` — pas de tag
supplémentaire requis.

**Test** : T-S15 — SOLO WORKER_CANCEL_DONE pour `p=1` ⇒ socket 0
reçoit les 3 messages avec `player=1` ; front `_slots[1]` ré-init.

#### 🆕 A31 — Post-duel SOLO grace cleanup (Finding F5 MEDIUM-HIGH)

`server.ts:1136-1144` — post-duel `ws.on('close')` cleanup gate
`!players[0].connected && !players[1].connected`. En SOLO multiplex
avec A3+A18, `players[1].connected` reste `false` à jamais ⇒ un F5
post-duel (avant click "Rematch") déclenche cleanup immédiat ⇒
reconnect impossible ⇒ user revoit le lobby au lieu du dialog rematch.

```ts
// server.ts:1136-1144 — patch SOLO
} else {
  // Post-duel disconnect: notify opponent rematch is cancelled
  const opponentIndex: Player = live === 0 ? 1 : 0;
  sendToPlayer(session!, opponentIndex, { type: 'REMATCH_CANCELLED', reason: 'opponent_left' });

  // If both players disconnected after duel end, cleanup
  if (!session!.players[0].connected && !session!.players[1].connected) {
    // A31 — SOLO : préserver la session pendant la fenêtre rematch grace.
    // Sans ce gate, un F5 post-duel SOLO termine la session avant que le
    // user clique "Rematch" au reconnect.
    if (session!.soloMode
        && session!.endedAt !== null
        && Date.now() - session!.endedAt < cfg.rematchExpiryMs) {
      return;
    }
    cleanupDuelSession(session!);
  }
}
```

**Note** : la session expire naturellement via `session.rematchTimeout`
armé par `handleDuelEnd` (`worker-lifecycle.ts:151`), donc pas de fuite
mémoire — on hérite du timer rematchExpiry existant.

**Test** : T-S16 — SOLO F5 post-duel ⇒ session préservée jusqu'à
`rematchExpiryMs` ; reconnect possible jusqu'à expiration.

#### 🆕 A32 — `client-message-router.ts:95` via `sendToPlayer` (Finding F6 MEDIUM)

La branche promptType mismatch envoie un message d'erreur via
`safeSend(session.players[playerIndex].ws, …)` direct, **bypass
`sendToPlayer`**. En SOLO multiplex avec `forPlayer=1`,
`session.players[1].ws === null` ⇒ silently no-op ⇒ user sans
feedback ⇒ retry loop → DUEL_END too_many_invalid.

```ts
// client-message-router.ts:95-99 — patch
if (expectedPrompt && msg.promptType !== expectedPrompt.type) {
  // A32 — via sendToPlayer pour bénéficier du routing A28 (ERROR
  // est dans la whitelist PSEUDO_PAIRWISE_SOLO_ROUTED).
  cfg.sendToPlayer(session, playerIndex, {
    type: 'ERROR',
    message: `Expected prompt type ${expectedPrompt.type}, got ${msg.promptType}`,
  } as ServerMessage);
  return;
}
```

**Front** : ajouter `case 'ERROR'` dans `duel-connection.handleMessage`
si pas déjà présent ; route vers un toast UX (perspective-agnostique
— affichage immédiat car l'erreur concerne l'action que le user vient
de faire).

**Test** : T-S17 (server) + T-F18 (front toast on ERROR).

### 3.3 Path inbound — `currentPlayerIndex()` (`server.ts:1100-1117`)

**Aujourd'hui** :
```ts
const currentPlayerIndex = (): 0 | 1 => {
  if (session!.players[0].ws === ws) return 0;
  if (session!.players[1].ws === ws) return 1;
  return playerIndex;
};
```
Le serveur discrimine par référence WS. En SOLO multiplex
(`players[0].ws === ws` toujours), cette fonction renvoie toujours 0.
**Le serveur ne sait plus qui est le joueur courant**.

**Solution** : étendre 7 ClientMessage avec un `forPlayer?: 0|1` optionnel
(cf. §5.1).

#### 🆕 A2 — Validation STRICTE de `forPlayer` (correction sécurité)

⚠️ **La décision §12 Q4 d'origine ("ignore silently") est INVERSÉE par
l'amendment A2**. Validation stricte requise sous peine de trou
d'authorization en PvP ranked (impersonation via `forPlayer` triché —
scénario d'attaque détaillé dans `phase-gamma-option-c-findings-deep-dive.md`
section R2).

**Côté serveur** (`server.ts` ws.on('message') handler) :
```ts
ws.on('message', (data: Buffer) => {
  let parsed: ClientMessage;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    logger.error('Invalid JSON from player', { duelId: session!.duelId });
    return;
  }

  // A2 — security: `forPlayer` est SOLO-only. Reject silently en PvP normal
  // avec un warn (compteur d'impersonation potentielle).
  const incomingForPlayer = (parsed as { forPlayer?: 0|1 }).forPlayer;
  if (!session!.soloMode && incomingForPlayer !== undefined) {
    logger.warn('forPlayer field rejected (PvP normal — possible impersonation attempt)', {
      duelId: session!.duelId,
      from: currentPlayerIndex(),
      claimed: incomingForPlayer,
    });
    return;
  }

  const live = session!.soloMode
    ? (incomingForPlayer ?? currentPlayerIndex())
    : currentPlayerIndex();

  handleClientMessage(session!, live, parsed);
});
```

#### 🆕 A2bis — CANCEL_PROMPT_SEQUENCE rate-limit lâche en SOLO (intentionnel)

`lastCancelAt[p]` rate-limit (`client-message-router.ts:234-238`) en SOLO
peut être bypassé en alternant `forPlayer: 0/1`. **Bénin** (c'est la
session de l'utilisateur lui-même), commentaire à ajouter :

```ts
case 'CANCEL_PROMPT_SEQUENCE': {
  // ...
  // A2bis note — in SOLO multiplex, the user could alternate `forPlayer`
  // to bypass this per-player rate limit. Intentional: SOLO is the user's
  // own session, no abuse vector. PvP normal rejects `forPlayer` at the
  // dispatch level (cf. ws.on('message') handler).
  if (now - session.lastCancelAt[playerIndex] < cfg.cancelPromptRateLimitMs) { /* ... */ }
}
```

#### 🆕 A9 + A21 — `ANIMATIONS_DONE.forPlayer` dérivation rule + garde SOLO-only

`timer-management.ts:174-194` arme `pendingTimeout` en attendant `ANIMATIONS_DONE`
du joueur cible. Aujourd'hui le client envoie depuis la conn de ce joueur.
En SOLO multiplex, le user doit tagger `forPlayer` avec le bon player.

**Règle de dérivation A9** : le front trace le dernier `PLAYER_RESPONSE` émis
sur la connection (avec son `forPlayer`). `ANIMATIONS_DONE.forPlayer` =
le `forPlayer` de ce dernier PLAYER_RESPONSE. Si pas de PLAYER_RESPONSE
récent (bootstrap ou after-state-sync), `ANIMATIONS_DONE.forPlayer` =
`duelCtx.perspective()()` par fallback.

⚠️ **A21 — garde SOLO-only critique** : la dérivation A9 ne doit s'appliquer
QU'EN SOLO. Si elle s'applique en PvP normal, A2 strict validation
rejette `ANIMATIONS_DONE` avec `forPlayer` défini ⇒ `pendingTimeout` ne
fire jamais ⇒ turn timer ne démarre pas ⇒ partie bloquée.

```ts
// duel-web-socket.service.ts — wsService.sendAnimationsDone
sendAnimationsDone(): void {
  // A21 — forPlayer tag SOLO-only. PvP normal NE tagge PAS.
  const forPlayer = this.soloMode
    ? (this._lastSentForPlayer ?? this.duelCtx.perspective()())
    : undefined;
  this._connection.sendAnimationsDone(forPlayer);
}
```

Pareil pour les 5 autres `sendXxx` (sauf `sendResponse` qui a déjà la
règle explicite — toujours forPlayer en SOLO, jamais en PvP).

**Comment savoir si SOLO côté wsService ?** Pattern : flag
`wsService.soloMode: boolean` flippé à `true` par
`SoloDuelOrchestratorService.init()`. Par défaut `false` (PvP normal). Le
flag est read-only depuis l'extérieur.

### 3.4 Connexion initiale — handshake

**Aujourd'hui** :
1. `POST /api/rooms/quick-duel` renvoie `{ wsToken1, wsToken2 }`.
2. Le front SOLO ouvre 2 WS, chacun avec son token.

**Demain** (multiplex) :
1. `POST /api/rooms/quick-duel` renvoie `{ wsToken1 }` (le token2
   devient inutile).
2. Le front SOLO ouvre 1 WS avec `wsToken1`.

Modifications :
- `room-api.service.ts` `QuickDuelResponse` (front) : `wsToken2` devient
  optionnel (Q1 → optionnel transitoire, supprimé en δ).
- `server.ts:497` `json(res, 201, { duelId, wsTokens: [token0, token1] })`
  → en SOLO, renvoyer `[token0]` (1 élément).

#### 🆕 A6 — Session register avec 1 token en SOLO

```ts
// server.ts:484
const tokens = soloMode ? [token0] : [token0, token1];
sessionManager.register(session, tokens);
```

Le 2e token est **alloué dans le scope du POST handler** mais **jamais
enregistré** dans `pendingTokens` en SOLO. Pas de fuite.

### 3.5 Lifecycle helpers — la doctrine "1 socket = 1 player" centralisée

#### 🆕 A3 — Helpers `isReadyToStart` et `isFullyDisconnected`

**Le pattern de fond** : le serveur encode "1 socket = 1 player" dans
4 sites critiques. En SOLO multiplex, cette doctrine est fausse — il faut
la centraliser dans des helpers plutôt que la patcher inline 4 fois.

**Découverte critique** (deep dive — non vu par les reviewers) : la gate
"both players connected" (`server.ts:1076`) court-circuite le démarrage
du duel en SOLO multiplex (`players[1].connected` ne devient jamais
true). **Le worker OCGCore n'est jamais spawné, le duel ne démarre
jamais.** C'est la régression bloquante #1 à éviter.

**Solution** : 2 helpers dédiés.

```ts
// duel-server/src/server.ts (ou un nouveau lifecycle-helpers.ts)
function isReadyToStart(session: ActiveDuelSession): boolean {
  if (session.soloMode) return session.players[0].connected;
  return session.players[0].connected && session.players[1].connected;
}

function isFullyDisconnected(session: ActiveDuelSession): boolean {
  if (session.soloMode) return !session.players[0].connected;   // seul socket compte
  return !session.players[0].connected && !session.players[1].connected;
}
```

**Sites à migrer** :

| Site | Ligne | Modification |
|---|---|---|
| Gate "both players connected" pour `startDuelWithOrder` | `server.ts:1076` | `if (isReadyToStart(session))` |
| Cleanup post-duel après dual disconnect | `server.ts:1142` | `if (isFullyDisconnected(session))` |
| Connection timeout cleanup (POST handler) | `server.ts:490` | `s.players.every(p => !p.connected)` → `isFullyDisconnected(s)` (déjà équivalent en PvP, devient correct en SOLO) |
| Reconnect "is opponent still here" | `server.ts:1037-1038` | déjà OK (s'applique à `otherIdx` directement, pas une gate symmetric) |

#### 🆕 A3bis-revised + A18 — `ws.on('close')` SOLO sans grace logic

⚠️ **CORRECTION CRITIQUE 2e passage** : l'A3bis d'origine clearait
`players[1].connected = false` synchroniquement, ce qui provoquait
`startGracePeriod(0)` → branche `bothDisconnected` → `combinedGraceTimer`
armé → **DUEL_END `draw_both_disconnect` à chaque F5 SOLO**.

L'A3bis-revised + A18 inverse l'approche : en SOLO, **skip entièrement
la grace logic** (pas d'opponent à attendre, c'est non-sense pour un
mono-user) et laisse `players[1].connected` à son état d'init (false).

`server.ts:1120-1146` :
```ts
ws.on('close', () => {
  const live = currentPlayerIndex();
  session!.players[live].connected = false;
  // A3bis-revised : ne PAS toucher à players[1].connected ici. Le helper
  // `isFullyDisconnected` se branche déjà en SOLO sur players[0] seul (A3).

  if (!session!.endedAt) {
    if (session!.soloMode) {
      // A18 — Pas de grace logic en SOLO (1 user, pas d'opponent).
      // Le user a 30 minutes (configuré par disconnectGraceMs) pour
      // reconnecter via reconnectToken. Aucun timer combiné, aucun
      // DUEL_END automatique.
      pauseTurnTimer(session!);
      clearInactivityTimer(session!, live as Player);
      // OPPONENT_DISCONNECTED non émis (no-op via sendToPlayer A1 dans
      // les 2 cas — opponentIndex=1 et soloMode=true ⇒ no-op-on-1).
    } else {
      pauseTurnTimer(session!);
      clearInactivityTimer(session!, live as Player);
      sendToPlayer(session!, opponentIndex, { type: 'OPPONENT_DISCONNECTED', gracePeriodSec: RECONNECT_GRACE_MS / 1000 });
      startGracePeriod(session!, live);
    }
  } else {
    // Post-duel disconnect: inchangé (logique sans grace pertinente)
  }
});
```

**Conséquence pour `isFullyDisconnected` en SOLO** : ne dépend plus que de
`players[0].connected`. C'est cohérent avec l'invariant SOLO "1 socket =
toute la connectivité du user". Le cleanup `:1142` fire dès que le seul
socket SOLO se ferme — pas de session leak, pas de timer combiné armé.

**⚠️ Sans A18, A3bis ferait shipper un bug PIRE que celui qu'A3bis
voulait éviter (F5 termine le duel en draw)**.

### 3.6 Inventaire complet des sites serveur à modifier

| Site | Fichier | Action |
|---|---|---|
| Boucle broadcast `for (const playerIndex of [0,1])` | `worker-message-router.ts:280-291` | Branche `soloMode` omniscient (§3.1) |
| `sendToPlayer` plumbing | `server.ts:673-689` | Branche `soloMode + playerIndex===1` ⇒ **routing-to-0 selon whitelist** A28 (§3.2) |
| `DUEL_STARTING` émission initiale SOLO | `server.ts:634-635` | Branche `soloMode` ⇒ 1 envoi avec `bothCardCodes` (§3.2.bis A1bis) |
| **DUEL_STARTING émission reconnect SOLO** | `server.ts:1176` | Branche `soloMode` ⇒ 1 envoi avec `bothCardCodes` (§3.2.bis A20) |
| **WAITING_RESPONSE émission SOLO** | `worker-message-router.ts:267` | Branche `soloMode` ⇒ envoi au socket 0 avec `targetPlayer` (§3.2.ter A19) |
| 🆕 **REMATCH_REQUEST court-circuit SOLO** | `client-message-router.ts:174-184` | Branche `soloMode` ⇒ appel direct `startRematch` sans gate "both requested" (§3.2.quater A27) |
| 🆕 **INACTIVITY_WARNING payload + routing** | `timer-management.ts:268-292` | Ajouter `player: p` au payload ; SOLO route au socket 0 (via whitelist A28) ; `InactivityWarningMsg.player` ajouté au protocole (A8.1) (§3.2 A28) |
| 🆕 **resendPendingPrompt × 2 en SOLO reconnect** | `server.ts:1072` | Branche `soloMode` ⇒ appel pour les 2 slots (§3.2.quinto A29) |
| 🆕 **WORKER_CANCEL_DONE routing-to-0 SOLO** | `worker-message-router.ts:137-186` | Branche `soloMode` ⇒ les 3 sends (STATE_SYNC + CHAIN_STATE + prompt) routés au socket 0 ; filterMessage omniscient en SOLO (§3.2.sexto A30) |
| 🆕 **Post-duel cleanup grace SOLO** | `server.ts:1142` | Branche `soloMode` ⇒ préserver la session jusqu'à `rematchExpiryMs` post-`endedAt` (§3.2.septo A31) |
| 🆕 **`client-message-router.ts:95` via sendToPlayer** | `client-message-router.ts:95-99` | Remplacer `safeSend` direct par `cfg.sendToPlayer` (route via whitelist A28 — ERROR) (§3.2.octo A32) |
| `currentPlayerIndex` + handler ws.on('message') | `server.ts:1100-1117` | Lire `forPlayer` field avec validation stricte (§3.3 A2) |
| POST quick-duel response | `server.ts:497` | SOLO renvoie 1 token |
| Session register | `server.ts:484` | SOLO register avec 1 token (§3.4 A6) |
| **Gate "both connected"** | `server.ts:1076` | `isReadyToStart(session)` (§3.5 A3) |
| **Cleanup gate** | `server.ts:1142` | `isFullyDisconnected(session)` (§3.5 A3 — voir aussi A31 grace SOLO post-duel) |
| **`ws.on('close')` SOLO sans grace** | `server.ts:1120-1146` | Skip `startGracePeriod` en SOLO (§3.5 A3bis-revised + A18) |
| `fork-handlers.ts` | identique à PvP loop omniscient | **Inchangé** — déjà omniscient mais 2-socket (convergence post-Option-C, §11) |

**Total ~31 sites serveur modifiés, ~7 fichiers touchés** (+6 sites
issus de la 3e passe : A27, A28+payload INACTIVITY, A29, A30, A31,
A32). Pas de modification des handlers `ClientMessage` eux-mêmes
(juste le routage de `playerIndex` en amont + la validation
`forPlayer`).

---

## 4. Périmètre front

### 4.1 `SoloDuelOrchestratorService.init` — refonte

**Aujourd'hui** (lignes 104-150) — 2 connections :

```ts
const conn0 = new DuelConnection(env.wsUrl, true, 'duel-reconnect-token-p1', this.logger, { sharedProcessor });
const conn1 = new DuelConnection(env.wsUrl, true, 'duel-reconnect-token-p2', this.logger, { sharedProcessor });
// ...
this.wsService.bindSharedProcessor(sharedProcessor);
this.wsService.bindTransports(conn0, conn1);
conn0.connect(token1);
conn1.connect(token2);
```

**Demain** — 1 connection :

```ts
init(token1: string): void {
  this.enabled = true;
  // Plus de sharedProcessor à passer : la DuelConnection unique instancie
  // son processor localement (path PvP-normal réutilisé tel quel).
  const conn = new DuelConnection(env.wsUrl, true, 'duel-reconnect-token-solo', this.logger);
  conn.artService = this.artService;
  conn.onMessage = msg => this.debugLog.logServerMessage(msg);
  conn.onResponse = (pt, data) => this.debugLog.logPlayerResponse(pt, data);
  this._connection.set(conn);

  // A21 — Flag wsService.soloMode pour conditionner forPlayer tag.
  this.wsService.soloMode = true;

  conn.connect(token1);

  // A5 — restore perspective from localStorage (cf. §8.4).
  this.restorePerspectiveFromStorage();

  this.setupRematchEffect();
}
```

**Disparaît** : `bindSharedProcessor`, `bindTransports`, `_connections`
signal de paire, `connectionLost` computed dual-source.

#### 🆕 A4 + A27 — `setupRematchEffect` réécrit pour 1 connection

⚠️ Ma spec d'origine montrait `init()` mais **omettait** la réécriture
de `setupRematchEffect`. Sans ce fix, le rematch SOLO deadlock
silencieusement (l'effect actuel attend `c[0].rematchStarting() &&
c[1].rematchStarting()`, le second ne flippe jamais en 1-socket).

**A27 (3e passe)** : l'auto-accept `if (conn.rematchState() === 'invited')`
était lui-même inutile en SOLO car le serveur ne génère plus de
`REMATCH_INVITATION` en SOLO (court-circuit serveur A27, §3.2.quater).
Skip l'effect en SOLO pour éviter une dépendance circulaire morte.

```ts
private setupRematchEffect(): void {
  const conn = this._connection();
  if (!conn) return;

  runInInjectionContext(this.injector, () => {
    // A27 — auto-accept inutile en SOLO : le serveur court-circuite la
    // gate "both requested" et démarre rematch dès le 1er REMATCH_REQUEST
    // du user. L'invitation REMATCH_INVITATION n'est plus émise en SOLO.
    if (!this.wsService.soloMode) {
      effect(() => {
        if (conn.rematchState() === 'invited') conn.sendRematchRequest();
      }, { allowSignalWrites: true });
    }

    // REMATCH_STARTING reçu une fois ⇒ 1 reset orchestrator. Identique
    // en PvP normal et SOLO (le payload est broadcast pur).
    effect(() => {
      if (conn.rematchStarting()) {
        this.animationService.resetForSwitch();
        this.duelCtx.setPerspective(0);
        conn.resetRematchStarting();
        this._rematchReset.update(v => v + 1);
      }
    }, { allowSignalWrites: true });
  });
}
```

### 4.2 `DuelWebSocketService` — simplification

**Aujourd'hui** (cf. fichier complet `duel-web-socket.service.ts`) :
- `_defaultConnection = new DuelConnection(...)` (orphan en SOLO)
- `_transport_connections = signal<[DuelConnection, DuelConnection]>([_default, _default])`
- `_sharedProcessor: DuelEventProcessor | null` (non-signal — C1.4 B2)
- `bindSharedProcessor()` + `bindTransports()`
- `active()` lit `_transport_connections()[duelCtx.perspective()()]`
- `proc()` lit `_sharedProcessor ?? _defaultConnection.processor`
- 21 computeds transport-local (`pendingPrompt`, `timerState`, etc.)
- 5 computeds shared-state (`animationQueue`, `activeChainLinks`, etc.)

**Demain** :
- `_connection: DuelConnection` unique, set par `init()` (1 chemin SOLO,
  1 chemin PvP normal qui réutilise `_defaultConnection`).
- **`soloMode: boolean`** field (A21) — flippé par `SoloDuelOrchestratorService.init()`.
- Plus de `_transport_connections` signal, plus de `_sharedProcessor`
  field.
- `active()` → `() => this._connection` (constant).
- `proc()` → `() => this._connection.processor`.
- Les **21 computeds transport-local** continuent de lire `active()` —
  mais doivent maintenant être **indexés par perspective** quand
  c'est sémantiquement requis. **C'est le morceau à risque** (cf.
  §4.3).
- Les **5 computeds shared-state** ne changent pas.

**Disparaît structurellement** : `bindSharedProcessor`, `bindTransports`,
`_transport_connections`, `_sharedProcessor`, `checkpointLog` R1
instrumentation (le besoin disparaît avec 1 socket).

### 4.3 Prompt pipeline per-perspective — le morceau à risque

#### 🆕 A8 — Tableau des fields refait (lecture exhaustive du code)

**Inventaire complet** des fields de `DuelConnection` avec leur sort sous
Option C SOLO multiplex :

| Field | Sites de mutation | Routing key | Reset rule |
|---|---|---|---|
| `_pendingPrompt` | `:709, 722, 738, 740, 757, 767, 854 (set null), 885 (set null)` + **`:356` (sendResponse — A22)** | `message.player` pour SELECT_*/ANNOUNCE_*/SORT_*/DICE_ROLL/SELECT_FIRST_PLAYER ; **clear LES DEUX slots** pour DUEL_END + REMATCH_STARTING + STATE_SYNC ; **clear `_slots[forPlayer]` pour sendResponse (A22)** | Per-slot |
| `_hintContext` | `:796-807` (merged write via `_hintContext.set`) | `message.player` du MSG_HINT (`message.player` du payload) | Per-slot ; clear LES DEUX au DUEL_END + REMATCH_STARTING + STATE_SYNC ; **🆕 A34 — `prev` lu depuis `_slots[message.player].hintContext`** (intra-slot, jamais current perspective) |
| `_inactivityWarning` | `:823 (set), :855 (clear DUEL_END)` | **`message.player` est dans payload** (à vérifier dans `InactivityWarningMsg` type — voir 🆕 A8.1 ci-dessous) | Per-slot ; clear LES DEUX au DUEL_END + REMATCH_STARTING |
| `_waitingForOpponent` | `:721, 739, 766, 771, 856, 886, 906 (set)` | **A8.2 — `targetPlayer` du WAITING_RESPONSE** (extension protocole, A19 émet correctement en SOLO) | Per-slot ; clear LES DEUX au DUEL_END + REMATCH_STARTING |
| `_rematchState` | `:866, 870, 891 (set idle au REMATCH_STARTING)` | **REMATCH_INVITATION sans `.player`** — décision : **GLOBAL en SOLO** (1 user = 1 invitation à lui-même) | Global en SOLO |
| `_rematchStarting` | `:621, 654, 754 (clear), :880 (set)` | REMATCH_STARTING broadcast pur ⇒ **set/clear LES DEUX slots** OU global | Global en SOLO (pragmatique) |
| `_lastConfirmedCards` | `:647, 845, 874, 952` + **`:347` (sendResponse — A22)** | `message.player` du MSG_CONFIRM_CARDS | Per-slot ; clear `_slots[forPlayer]` au sendResponse |
| `_lastSelectedCards` | `:651, 716-718` + **`:344, 337 (sendResponse — A22)`** | Suit `_pendingPrompt` | Per-slot ; clear `_slots[forPlayer]` au sendResponse |
| `_lastDrawAnnouncedHash` | `:241 (decl), :981 (set)` | Global (turn-keyed) | **🆕 A33 — GLOBAL (révisé 3e passe)** ; clé `${turnPlayer}:${turnCount}` SANS préfixe slot. Raison : la dédup turn est intrinsèquement globale (omniscient SOLO voit tous les MSG_DRAW). Une clé per-slot re-annonce 2× au switch perspective intra-turn. |
| `_firstPlayerResult` | `:772, 857, 886` | `FIRST_PLAYER_RESULT` per-player | **Dead en SOLO** — flow dés/RPS skippé. Inutile d'indexer en SOLO. |
| `_firstPlayerResponseSent` | `:350, 772, 858, 887` | Suit `_firstPlayerResult` | **Dead en SOLO** (idem) |
| `_hintCardConsumed` | `:219, 349, 653` | Suit `_pendingPrompt` cycle | Per-slot ; **`:349` set true en SOLO sur le slot du forPlayer** (A22) |
| `_confirmedCardsByChain` (`Map<chainIndex, _>`) | `:648, 846, 875, 946, 957-958` | Keyed par `chainIndex` (global) | **Global, OK** |
| `_lastSelectedPromptType` | (idem `_lastSelectedCards`) | Per-slot | Per-slot ; clear `_slots[forPlayer]` au sendResponse (A22) |
| `_lastTurnPlayer`, `_lastTurnCount` | `:633-634` (set BOARD_STATE) | Global BOARD_STATE | **Global, OK** |
| `_lastStateSyncAt` | `:656` | Global | **Global, OK** |
| `_justReconnected` | `:670, 622 (clear)` | Global transport | **Global, OK** |
| `_sessionPhase` | `:928` | Global mount-discriminant | **Global, OK** |
| `_boardActive` | external setter | Global | **Global, OK ; reset à `false` au REMATCH_STARTING — A23** |
| `_protocolMismatch`, `_connectionStatus`, `_opponentDisconnected`, `_disconnectGraceSec`, `_retryCount`, `_totalAutoRetries`, `_hasToken` | (divers) | Global transport | **Global, OK** |
| `_duelResult` | `:859 (set), :881 (clear)` | Terminal global | **Global, OK** |
| `_ocgPlayerIndex`, `_cardCodes` | `:787-788, 882 (clear)` | Global DUEL_STARTING | **Global, OK** |

**Bilan révisé (post-3e passe, A33+A34 appliqués)** :
- **8 fields per-perspective** : `_pendingPrompt`, `_hintContext`,
  `_inactivityWarning`, `_waitingForOpponent`, `_lastConfirmedCards`,
  `_lastSelectedCards`, `_lastSelectedPromptType`, `_hintCardConsumed`.
- **Global** : tout le reste, dont `_rematchState`/`_rematchStarting`
  (décision pragmatique : 1 user en SOLO), **et `_lastDrawAnnouncedHash`
  (A33 — re-classé GLOBAL après 3e passe)**.
- **Dead en SOLO** : `_firstPlayerResult`, `_firstPlayerResponseSent`.

#### 🆕 A33 — `_lastDrawAnnouncedHash` reste GLOBAL (Finding F7)

Initialement classé per-slot avec clé composite `${slotPlayer}:${turnPlayer}:${turnCount}`.
**Reclassé GLOBAL en 3e passe** : la dédup MSG_DRAW est intrinsèquement
globale (1 nouveau turn = 1 annonce, quel que soit le slot qui le voit
en premier). En SOLO multiplex omniscient, les 2 slots reçoivent les
mêmes MSG_DRAW ; un hash per-slot re-annoncerait à chaque switch
intra-turn (slot 0 a déjà hashé `0:P:C`, slot 1 démarre à null →
re-trigger `onDrawNewTurn`). Garder la clé GLOBALE `${turnPlayer}:${turnCount}`
préserve l'invariant β.3 cas #13.

#### 🆕 A34 — `_hintContext` inheritance intra-slot strict (Finding F8)

Le handler MSG_HINT (`duel-connection.ts:796-807`) lit `prev = this._hintContext()`
pour préserver `cardName` à travers des hints successifs type 10/13/15 → 3.
Une implémentation naïve A8 ferait `prev = this._slots[currentPerspective].hintContext()`
⇒ inheritance cassée si l'utilisateur switche perspective entre 2 MSG_HINT
du même slot logique (le `cardName` du hint précédent serait lu dans le
slot d'arrivée, vide).

**Règle** : le `prev` MUST be `_slots[message.player].hintContext`
(lecture du MÊME slot qu'on s'apprête à écrire). Pas
`currentPerspective`. Patch :

```ts
// duel-connection.ts:792-808 — patch A34
case 'MSG_HINT': {
  const slot = message.player as 0|1;
  const isSelectMsg = message.hintType === 3;
  const isCardHint = !isSelectMsg;
  if (isCardHint) this._slots[slot].hintCardConsumed = false;
  // A34 — `prev` lu depuis le MÊME slot que la write cible.
  const prev = this._slots[slot].hintContext();
  const canInherit = isSelectMsg && !this._slots[slot].hintCardConsumed;
  const merged = {
    hintType: message.hintType,
    player: message.player,
    value: message.value,
    cardName: message.cardName || (canInherit ? prev.cardName : ''),
  };
  this._slots[slot].hintContext.set(merged);
  break;
}
```

**Test T-F15** : `MSG_HINT(player=0, cardName='Solemn', type=10)` puis
`switchPerspective` puis `MSG_HINT(player=0, cardName='', type=3)` ⇒
`_slots[0].hintContext.cardName === 'Solemn'` (intra-slot inheritance
préservée malgré le switch intermédiaire).

#### 🆕 A8.1 — `InactivityWarningMsg.player` vérification requise

Le type `InactivityWarningMsg` est défini dans `ws-protocol-system.ts`.
**À vérifier au commit 1** : si le payload n'a pas de `.player`, il faut
l'ajouter (additif, optionnel pour back-compat). Sinon le slot 1 ne
recevra jamais d'INACTIVITY_WARNING en SOLO.

#### 🆕 A8.2 — `WAITING_RESPONSE.targetPlayer` extension

`WAITING_RESPONSE` est envoyé au joueur *opposé* à celui qui prompt
(`worker-message-router.ts:267`). En 2-socket γ, chaque socket reçoit
naturellement le WAITING_RESPONSE pour SA perspective. **En 1-socket
SOLO, le single socket reçoit WAITING_RESPONSE qui doit être routé au
bon slot.**

Solution : étendre le message avec `targetPlayer: 0|1` :
```ts
// ws-protocol-system.ts
export interface WaitingResponseMsg {
  type: 'WAITING_RESPONSE';
  targetPlayer?: 0|1;  // optionnel pour back-compat ; populé par le serveur
}
```
Côté serveur, populer toujours (cf. A19 §3.2.ter — en SOLO le send va
au socket 0 ; en PvP normal au socket destinataire).

Côté front (`duel-connection.ts:904-907`) :
```ts
case 'WAITING_RESPONSE':
  this.processor.processMessage(message);
  const slot = (message.targetPlayer ?? 0) as 0|1;
  this._slots[slot].waitingForOpponent.set(true);
  break;
```

#### 🆕 A22 — Règle `sendResponse` clear slot du `forPlayer`

`sendResponse` aujourd'hui clear `_pendingPrompt` + `_lastSelectedCards`
+ `_lastConfirmedCards` + `_hintCardConsumed` sync après envoi
(`duel-connection.ts:344-356`). En multiplex, ces clears doivent cibler
le slot du `forPlayer` qui a répondu — sinon le banner UX A13 affiche
"Action requise" pour un prompt déjà répondu (`_slots[forPlayer].pendingPrompt`
reste set).

```ts
// duel-connection.ts:325-359 — patch
sendResponse(promptType: string, data: ResponseData, forPlayer?: 0 | 1): void {
  this._lastSentForPlayer = forPlayer;
  const payload: PlayerResponseMsg = { type: 'PLAYER_RESPONSE', promptType, data };
  if (forPlayer !== undefined) payload.forPlayer = forPlayer;
  if (this.safeSend(payload)) {
    // A22 — clear le slot du forPlayer (en PvP normal forPlayer === undefined ⇒
    // clear le slot 0 par convention, ce qui revient au comportement legacy).
    const slot = (forPlayer ?? 0) as 0|1;

    // Capture selected cards before clearing prompt
    const prompt = this._slots[slot].pendingPrompt();
    const accumulate = DuelConnection.ACCUMULATE_SELECTION_TYPES.has(promptType);
    if (prompt && 'cards' in prompt && accumulate) {
      // ... (logique inchangée mais ciblée sur this._slots[slot])
    } else {
      this._slots[slot].lastSelectedCards = [];
      this._slots[slot].lastSelectedPromptType = null;
    }
    this._slots[slot].lastConfirmedCards = [];
    this._confirmedCardsByChain.clear();   // chain map reste global (key chainIndex)
    this._slots[slot].hintCardConsumed = true;
    if (promptType === 'SELECT_FIRST_PLAYER') this._firstPlayerResponseSent.set(true);   // global dead-in-SOLO
    if (promptType === 'DICE_ROLL') this._diceInProgress.set(true);  // global
    this.onResponse?.(promptType, data);
    this._slots[slot].pendingPrompt.set(null);
    this._slots[slot].inactivityWarning.set(null);
  }
}
```

#### Stratégie de migration des fields per-perspective

Extraire les 9 fields per-perspective dans une structure
`PerspectiveSlot` × 2 instances internes à la `DuelConnection` :

```ts
interface PerspectiveSlot {
  pendingPrompt: WritableSignal<Prompt | null>;
  hintContext: WritableSignal<HintContext>;
  inactivityWarning: WritableSignal<InactivityWarningMsg | null>;
  waitingForOpponent: WritableSignal<boolean>;
  lastConfirmedCards: CardInfo[];
  lastSelectedCards: CardInfo[];
  lastSelectedPromptType: string | null;
  lastDrawAnnouncedHash: string;
  hintCardConsumed: boolean;
}

private readonly _slots: [PerspectiveSlot, PerspectiveSlot] = [
  this.makeEmptySlot(),
  this.makeEmptySlot(),
];

// API d'accès : reads per-perspective.
getPendingPromptFor(p: 0 | 1): Signal<Prompt | null> {
  return this._slots[p].pendingPrompt.asReadonly();
}
```

Le `wsService.pendingPrompt` devient un computed sur la perspective
courante :
```ts
readonly pendingPrompt = computed(() => this._connection.getPendingPromptFor(this.duelCtx.perspective()())());
```

**Routing des messages entrants** dans `handleMessage` :
```ts
case 'SELECT_CARD':
case 'SELECT_CHAIN':
case 'SELECT_IDLECMD':
// ... (tous les SELECT_* + ANNOUNCE_* + SORT_*) :
{
  const p = message.player as 0 | 1;
  this._slots[p].pendingPrompt.set(message);
  this._slots[p].waitingForOpponent.set(false);
  // ... reset des accumulateurs du slot p
  this.processor.processMessage(message);  // shared, perspective-agnostic
  break;
}
```

**Effort estimé** :
- Extraction `PerspectiveSlot` + initialisation : ~0.5j.
- Routing 14 branches `handleMessage` + extension WAITING_RESPONSE + vérif
  InactivityWarningMsg + A22 sendResponse clear slot : ~1.75j.
- Adaptation des 21 computeds `wsService` + 40 sites consommateurs
  (7 fichiers) : ~0.5j.
- Tests `duel-connection.spec.ts` couvrant la dualité : ~0.5j.

**Total ~3.25j**.

### 4.4 `sendResponse` et autres `client→server` — tagger `forPlayer`

**Aujourd'hui** :
```ts
sendResponse(promptType: string, data: ResponseData): void {
  if (this.safeSend({ type: 'PLAYER_RESPONSE', promptType, data })) { ... }
}
```

**Demain** :
```ts
sendResponse(promptType: string, data: ResponseData, forPlayer?: 0 | 1): void {
  this._lastSentForPlayer = forPlayer;
  const payload: PlayerResponseMsg = { type: 'PLAYER_RESPONSE', promptType, data };
  if (forPlayer !== undefined) payload.forPlayer = forPlayer;
  if (this.safeSend(payload)) {
    // A22 — clear slot du forPlayer (cf. §4.3 ci-dessus)
    // ...
  }
}
```

Côté `wsService`, on tagge automatiquement en SOLO :
```ts
sendResponse(promptType: string, data: ResponseData): void {
  const forPlayer = this.soloMode ? this.duelCtx.perspective()() : undefined;
  this._connection.sendResponse(promptType, data, forPlayer);
}
```

**A21 — Garde SOLO-only pour les 6 autres `sendXxx`** :
```ts
sendAnimationsDone(): void {
  // A21 — forPlayer tag SOLO-only. PvP normal NE tagge PAS (sinon A2 reject).
  // A37 — fallback corrigé : si pas de PLAYER_RESPONSE récent, lire
  // `pendingPlayer` du timer state (que le serveur expose dans TIMER_STATE)
  // plutôt que `perspective()`. Couvre le cas bootstrap SOLO + switch
  // précoce : si `pendingPlayer=0` mais `perspective()=1`, la gate serveur
  // `ctx.pendingPlayer === playerIndex` fail ⇒ timer ne démarre jamais ⇒
  // INACTIVITY forfeit P0 ~60s plus tard.
  const forPlayer = this.soloMode
    ? (this._connection.lastSentForPlayer
       ?? this.deriveAnimationsDoneFallback()
       ?? this.duelCtx.perspective()())
    : undefined;
  this._connection.sendAnimationsDone(forPlayer);
}

private deriveAnimationsDoneFallback(): 0 | 1 | undefined {
  // A37 — `pendingPlayer` du timer state représente le joueur que le
  // serveur attend. Si défini, c'est forcément la bonne cible.
  const ts = this._connection.timerState();
  return ts?.pendingPlayer ?? undefined;
}

sendSurrender(): void {
  const forPlayer = this.soloMode ? this.duelCtx.perspective()() : undefined;
  this._connection.sendSurrender(forPlayer);
}
// ... idem pour sendRematchRequest, sendCancelPromptSequence, sendRequestStateSync, sendActivityPing
```

**Note A37** : ce fallback suppose que le serveur expose
`pendingPlayer` dans `TIMER_STATE` (au moins en SOLO multiplex).
Protocole à étendre : ajouter `pendingPlayer?: 0|1` au
`TimerStateMsg` (`ws-protocol-system.ts`). Optionnel pour back-compat
PvP normal.

**Total ~1j** (révisé +0.15j vs A21 d'origine pour le fallback A37 +
protocole TIMER_STATE extension).

### 4.5 BOARD_STATE : ordre `players[]` absolu vs relatif

**Subtilité §3.1** : aujourd'hui, le serveur swap `players[]` selon
`forPlayer` ⇒ `data.players[0]` = viewer pour conn0, `data.players[0]`
= viewer pour conn1 (différents !).

En SOLO multiplex (omniscient), `players[]` arrive en ordre absolu :
`data.players[0]` = serveur P0, `data.players[1]` = serveur P1.

**Conséquence** : le composant duel-page assume `players[0] = own,
players[1] = opp` (cf. CLAUDE.md "Perspective Convention" §2). En SOLO,
quand `perspective() === 1`, il faudrait swapper côté front.

#### 🆕 A17 — Swap étendu à TOUS les consommateurs BOARD_STATE

⚠️ **La spec d'origine §4.5 swappait `data` avant `syncAfterBoardState` +
`processor.observeBoardState`**, mais **oubliait que le même payload
alimente d'autres consommateurs** :

- `BoundaryProcessor.observeBoardState` (lit `data.turnPlayer` + `data.phase`) — alimenté via `processor.observeBoardState` ⇒ swap en amont OK.
- `DeferredEffectProcessor` consume l'EventStream qui propage BOARD_STATE — swap en amont OK.
- **`boardStateAfter` per-event snapshot** attaché aux BOARD_CHANGING
  events durant `chainResolving` — passe par
  `processor.processMessage(event)` qui dispatch à l'orchestrator. Le
  snapshot peut contenir `players[]` absolu ⇒ doit être **swappé aussi**
  en perspective=1 SOLO (pattern existant `swapEventBoardStates()` du
  `ReplayDuelAdapter`).

**Solution** : `DuelConnection.handleMessage` en SOLO swappe en amont :

```ts
case 'BOARD_STATE': {
  let data = message.data;
  if (this.soloMode && this.duelCtx.perspective()() === 1) {
    data = swapBoardState(data);  // helper existant — ReplayDuelAdapter
  }
  syncAfterBoardState(this.rbs, ..., data, this._boardActive);
  this.processor.observeBoardState(data);  // BoundaryProcessor relayé
  // ...
}
```

Pour les BOARD_CHANGING events durant `chainResolving`, ajouter un swap
des `boardStateAfter` :

```ts
// duel-connection.ts handleMessage MSG_MOVE/MSG_DRAW/... branche
if (this.soloMode
    && this.duelCtx.perspective()() === 1
    && (message as { boardStateAfter?: BoardStatePayload }).boardStateAfter) {
  (message as { boardStateAfter?: BoardStatePayload }).boardStateAfter =
    swapBoardState((message as { boardStateAfter: BoardStatePayload }).boardStateAfter);
}
this.processor.processMessage(message);
```

**Sans ce swap étendu** : le BoundaryProcessor verrait des `turnPlayer`
alternants au switch ⇒ spurious `TurnEnded`/`TurnStarted` ⇒ journal
corrompu silencieusement.

**Effort : ~0.5j** (révisé +0.25j vs spec d'origine).

### 4.6 `switchPerspective` — devient un setter pur

**Aujourd'hui** (`solo-duel-orchestrator.service.ts:171-206`) — fait 7 choses :
1. Garde `_switching`, `pendingPrompt`.
2. `animationService.notifyPerspectiveSwitch(from, to)` (stub commit 5).
3. `duelCtx.setPerspective(to)`.
4. `c[to].setBoardActive(true)` (le legacy guard de C1.5 / M12).
5. `setTimeout(() => _switching.set(false), 300)`.

**Demain** :
1. Garde `_switching` + `pendingPrompt` **étendue** (cf. A13 ci-dessous).
2. `animationService.notifyPerspectiveSwitch(from, to)` (γ commit 5).
3. `duelCtx.setPerspective(to)`.
4. ~~`setBoardActive`~~ disparu : pas d'asymétrie sur 1 socket (cf. A14).
5. `setTimeout(() => _switching.set(false), 300)`.
6. **🆕 A5 — Persist en localStorage**.

#### 🆕 A13 + A24 — Politique UX switch-during-prompt (banner alternatif + debounce)

En SOLO multiplex, **les 2 slots peuvent avoir `pendingPrompt` non-null
simultanément** (chain Maxx C, par exemple). La garde actuelle
(`wsService.pendingPrompt() !== null`) lit le slot courant ; après une
réponse, l'autre slot peut avoir un prompt en attente.

**Politique retenue** (option c du deep dive) :
- `pendingPromptAny: Signal<boolean>` = `_slots[0].pendingPrompt() !== null || _slots[1].pendingPrompt() !== null`.
- La garde `_switching` ne bloque PAS sur `pendingPromptAny` — l'utilisateur garde la liberté de switch perspective.
- **Banner UX** sur la perspective courante quand `_slots[1-perspective].pendingPrompt() !== null` :
  *"Action requise de P{N+1}"* + bouton "Basculer" qui call `switchPerspective()`.

**A24 — Banner button disabled pendant `switching()`** :
**A35 — Texte i18n** (3e passe, Finding F9) — skytrix supporte FR+EN.
Le texte du banner doit passer par le pipe `| translate` avec une clé
i18n dédiée, pas être hardcodé.

```html
<!-- A35 — i18n keys requises (FR + EN) :
     pvp.solo.actionRequiredP1 = "Action requise de P1" / "Action required from P1"
     pvp.solo.actionRequiredP2 = "Action requise de P2" / "Action required from P2"
     pvp.solo.switchPerspective = "Basculer" / "Switch"
-->
@if (pendingPromptForOtherSlot()) {
  <app-banner [text]="('pvp.solo.actionRequiredP' + (otherSlot() + 1)) | translate">
    <app-button
      (click)="switchToOtherSlot()"
      [disabled]="orchestrator.switching()">
      {{ 'pvp.solo.switchPerspective' | translate }}
    </app-button>
  </app-banner>
}
```

Sans `[disabled]` (A24), un user qui spam-clique pendant une cascade
de prompts voit son 2e clic silencieusement dropé (`_switching`
debounce 300ms) ⇒ banner reste affichée alors qu'aucun switch n'a lieu.

Sans `| translate` (A35), un user EN voit du français dans une feature
livrée ⇒ régression i18n. ~5 min d'oubli sans cette ligne.

#### 🆕 A14 — `setBoardActive` semantics clarifiées

`_boardActive` est un **transport-flag global** en SOLO multiplex (un
seul, sur la `DuelConnection` unique). Il est set à `true` UNE FOIS au
bootstrap par `DuelLoadingEffectsService` (après la première
BOARD_STATE). `switchPerspective` ne touche PAS ce flag — c'est une
projection visuelle, pas un changement de transport.

C1.5 (M12) effacé par construction.

#### 🆕 A23 — `_boardActive` reset au REMATCH_STARTING

⚠️ **Découverte 2e passage** : A14 ne couvrait pas le rematch.
REMATCH_STARTING tear down le duel et re-spawn le worker. Le nouveau
BOARD_STATE doit re-déclencher `syncAfterBoardState` tier 1
(`!boardActive → syncPileCounts`) pour que le bootstrap du nouveau duel
fonctionne (avec le pre-activation buffer drain).

`duel-connection.ts:873-892` (handler REMATCH_STARTING) clear beaucoup de
state mais **ne touche pas à `_boardActive`** ⇒ le flag reste `true` ⇒
le prochain BOARD_STATE ne passe pas par tier 1 ⇒ le pre-activation
buffer ne se drain pas ⇒ les 5 MSG_DRAW initiaux du nouveau duel ne
s'animent pas.

**Patch** : ajouter à la branche REMATCH_STARTING (`duel-connection.ts:880`
ou adjacent) :
```ts
this._boardActive = false;
// (le DuelLoadingEffectsService re-flip à true quand le nouveau BOARD_STATE arrive,
// via la chaîne duel-loading → active du roomState)
```

#### 🆕 A5 — Persist perspective en localStorage

```ts
// solo-duel-orchestrator.service.ts
private readonly SOLO_PERSPECTIVE_KEY = 'solo-duel-perspective';

switchPerspective(): void {
  // ... garde, switching ...
  this.duelCtx.setPerspective(to);
  try { localStorage.setItem(this.SOLO_PERSPECTIVE_KEY, String(to)); } catch {}
  // ...
}

restorePerspectiveFromStorage(): void {
  try {
    const stored = Number(localStorage.getItem(this.SOLO_PERSPECTIVE_KEY));
    if (stored === 0 || stored === 1) this.duelCtx.setPerspective(stored as 0|1);
  } catch {}
}
```

**Clear au DUEL_END** : ajouter à la branche `:862`
`localStorage.removeItem(SOLO_PERSPECTIVE_KEY)` à côté du
`removeItem(this.storageKey)` existant (**seulement en SOLO** — guard
via `this.soloMode` flag injecté ou via try/catch).

### 4.7 Inventaire des sites front à modifier

| Site | Fichier | Action |
|---|---|---|
| `SoloDuelOrchestratorService.init` | `solo-duel-orchestrator.service.ts:104-150` | 1 connection au lieu de 2 + flag `wsService.soloMode = true` (A21) |
| **`setupRematchEffect` réécrit** | id. `:218-247` | Effect 1-signal (A4) + **garde `!soloMode` sur l'auto-accept (A27)** |
| `SoloDuelOrchestratorService.switchPerspective` | id. `:171-206` | Suppression `setBoardActive` (A14), localStorage persist (A5) |
| `DuelWebSocketService` | `duel-web-socket.service.ts` | Suppression `bindSharedProcessor`, `bindTransports`, `_transport_connections`, `_sharedProcessor`, `_defaultConnection` orphan ; ajout `soloMode` field (A21) |
| `DuelConnection._slots` PerspectiveSlot × 2 | `duel-connection.ts` (nouveau) | Extraction des **8 fields** en slot indexé (A8, **révisé 3e passe — `_lastDrawAnnouncedHash` reste GLOBAL par A33**) |
| `DuelConnection.handleMessage` | id. `:597-1013` | Routing per-perspective via `_slots[message.player]` + clear LES DEUX au DUEL_END/REMATCH_STARTING + **reset `_boardActive=false` au REMATCH_STARTING (A23)** + **MSG_HINT inheritance intra-slot (A34)** |
| 🆕 **MSG_HINT inheritance intra-slot** | `duel-connection.ts:792-808` | A34 — `prev = _slots[message.player].hintContext()`, jamais current perspective |
| **`WAITING_RESPONSE` extension + routing** | `ws-protocol-system.ts` (back+front) + handler | A8.2 — `targetPlayer?: 0|1` field ; A19 émission SOLO |
| **`InactivityWarningMsg.player` ajout** | `ws-protocol-system.ts` | A8.1 — ajouter si manquant (requis par A28 routing) |
| 🆕 **`TimerStateMsg.pendingPlayer` ajout** | `ws-protocol-system.ts` | A37 — `pendingPlayer?: 0|1` field. Optionnel back-compat ; populé serveur pour le fallback front A37. |
| 🆕 **`ErrorMsg.player` ajout (si pas déjà présent)** | `ws-protocol-system.ts` | A32 — `player: 0|1` pour routage A28 routing-to-0. À vérifier sur le type ERROR actuel ; ajouter sinon. |
| `DuelConnection.sendResponse` + 6 autres `sendXxx` | id. `:325-400` | `forPlayer?: 0|1` field + memoize last (A9) + **clear `_slots[forPlayer]` (A22)** + **fallback `pendingPlayer` du timer state (A37)** |
| `DuelConnection.handleMessage` BOARD_STATE swap | id. `:620-635` | A17 — swap étendu (BoundaryProcessor + boardStateAfter) |
| 🆕 **`DuelConnection.handleMessage` ERROR** | id. | A32 — ajouter `case 'ERROR'` qui affiche un toast UX immédiat (perspective-agnostique) |
| `wsService` 21 computeds | `duel-web-socket.service.ts:199-223` | Reroutage via `getXxxFor(p)` |
| `wsService` 7 `sendXxx` methods | id. `:241-283` | **A21 — Tagger `forPlayer` SEULEMENT en SOLO** (garde explicite) + **A37 fallback `pendingPlayer`** sur sendAnimationsDone |
| `duel-page.component.ts` 22 reads de `wsService.xxx` | id. | Aucune modification (les computeds s'adaptent) |
| `duel-prompt-effects.service.ts` 3 reads | id. | Aucune |
| `pvp-prompt-dialog.component.ts` 6 reads | id. | Aucune |
| **Banner UX switch-during-prompt** | `duel-page.component.html` + tpl | A13 + **A24 [disabled]="switching()"** + 🆕 **A35 — i18n keys** `pvp.solo.actionRequiredP{1,2}` + `pvp.solo.switchPerspective` (FR+EN) |
| 🆕 **Toast UX sur ERROR** | `duel-page.component.html` + service toast existant | A32 — afficher message d'erreur du serveur (replace silently-dropped feedback en SOLO multiplex slot 1) |
| Tests `phase-gamma-victory.spec.ts` (vacuous, M9/C4.5) | id. | Réécriture complète (`WebSocketFactory` mock) |
| Tests `solo-duel-orchestrator.service.spec.ts` | id. | Adapter au mono-connection |
| `room-api.service.ts` `QuickDuelResponse` | id. | `wsToken2?: string` (transitoire) |
| **`WebSocketFactoryService` injection token** | `duel-connection.ts` constructor | A15 — pour tester proprement (cf. A25 inventaire) |

#### 🆕 A25 — `WebSocketFactoryService` call sites inventaire complet

Avant le commit 7 (tests), tous les sites construisant un `DuelConnection`
doivent passer par le factory injection :

| Site | Action |
|---|---|
| `duel-web-socket.service.ts:51` (`_defaultConnection`) | inject factory dans ctor, le passer à `new DuelConnection` |
| `solo-duel-orchestrator.service.ts:113,117` (γ legacy) | **supprimé par commit 6** ; remplacé par 1 site mono-conn `init()` qui inject factory |
| `replay-duel-adapter.ts` | **À VÉRIFIER au commit 7** — CLAUDE.md dit que c'est une concrete WebSocket class séparée (`DuelConnection` est NOT abstraction layer). Si pas de `DuelConnection`, pas de modif. |
| `duel-connection.spec.ts:*` (~4 sites de test) | inject mock factory via `TestBed.overrideProvider` |

**Total ~6 sites front pour A15+A25**.

**Total ~17 fichiers touchés côté front, ~58 sites modifiés**.

---

## 5. Surface de protocole — modifications

### 5.1 ClientMessage (`ws-protocol-system.ts` + `ws-protocol-prompts.ts`)

7 messages gagnent un `forPlayer?: 0 | 1` optionnel :

```ts
export interface PlayerResponseMsg {
  type: 'PLAYER_RESPONSE';
  promptType: string;
  data: ResponseData;
  forPlayer?: 0 | 1;       // SOLO uniquement — validation stricte côté serveur (A2)
}

export interface SurrenderMsg { type: 'SURRENDER'; forPlayer?: 0 | 1; }
export interface RematchRequestMsg { type: 'REMATCH_REQUEST'; forPlayer?: 0 | 1; }
export interface RequestStateSyncMsg { type: 'REQUEST_STATE_SYNC'; forPlayer?: 0 | 1; }
export interface ActivityPingMsg { type: 'ACTIVITY_PING'; forPlayer?: 0 | 1; }
export interface AnimationsDoneMsg { type: 'ANIMATIONS_DONE'; forPlayer?: 0 | 1; }
export interface CancelPromptSequenceMsg { type: 'CANCEL_PROMPT_SEQUENCE'; forPlayer?: 0 | 1; }
```

**Back-compat** : le champ optionnel, **rejeté avec warn côté serveur si
présent en PvP normal** (A2 — validation stricte). Pas de bump de
`PROTOCOL_VERSION` requis (additif strict).

⚠️ **Le front PvP normal NE DOIT JAMAIS tagger `forPlayer`** (A21) — sinon
le serveur strict reject le message, ce qui bloque la partie. Garde
explicite côté `wsService.sendXxx`.

### 5.2 ServerMessage — 5 ajouts mineurs (A1bis + A8.1 + A8.2 + A20 + A37)

#### 🆕 A1bis + A20 — `DUEL_STARTING.bothCardCodes` extension

```ts
export interface DuelStartingMsg {
  type: 'DUEL_STARTING';
  playerIndex: 0 | 1;
  traceId: string;
  cardCodes: number[];
  bothCardCodes?: number[][];   // SOLO uniquement — cardCodes des 2 decks pour prefetch
}
```

Le front SOLO multiplex utilise `bothCardCodes` pour pre-fetch les
images des 2 perspectives. PvP normal ignore (champ absent). **Populé
aux 2 sites d'émission** : initial (`server.ts:634`) + reconnect
(`server.ts:1176`).

#### 🆕 A8.1 — `InactivityWarningMsg.player`

Le payload actuel `InactivityWarningMsg` n'a pas de `player` field
([vérifié `ws-protocol-system.ts:183-186`](duel-server/src/ws-protocol-system.ts#L183-L186)).
**À ajouter** (additif, optionnel back-compat) — requis par A28 routing-to-0 :

```ts
export interface InactivityWarningMsg {
  type: 'INACTIVITY_WARNING';
  remainingSec: number;
  player?: 0 | 1;   // ajouter — populé serveur-side (A28), lu front-side pour routing slot
}
```

#### 🆕 A8.2 — `WaitingResponseMsg.targetPlayer`

```ts
export interface WaitingResponseMsg {
  type: 'WAITING_RESPONSE';
  targetPlayer?: 0 | 1;   // populé toujours par le serveur (cohérence)
}
```

Le serveur populate **dans les 2 modes** (PvP normal aussi pour
cohérence ; front ignore en PvP). En SOLO multiplex le `targetPlayer`
est essentiel pour router au bon slot (A19 émet sur socket 0 en SOLO).

#### 🆕 A37 — `TimerStateMsg.pendingPlayer` extension

```ts
export interface TimerStateMsg {
  type: 'TIMER_STATE';
  player: 0 | 1;
  remainingMs: number;
  totalMs: number;
  pendingPlayer?: 0 | 1;   // 🆕 A37 — populé en SOLO si timerContext.pendingPlayer non-null
}
```

Le serveur populate `pendingPlayer` à partir de
`session.timerContext.pendingPlayer` (parked timer en attente d'`ANIMATIONS_DONE`).
Le front SOLO multiplex lit ce champ comme fallback pour
`sendAnimationsDone.forPlayer` quand `_lastSentForPlayer` est null
(cas bootstrap SOLO + switch précoce — cf. A37 §4.4 Finding F12).

#### 🆕 A35 — i18n keys (front-only, pas de protocole)

3 nouvelles clés i18n requises (FR + EN), à ajouter dans
`front/src/assets/i18n/{fr,en}.json` :

```json
{
  "pvp": {
    "solo": {
      "actionRequiredP1": "Action requise de P1" | "Action required from P1",
      "actionRequiredP2": "Action requise de P2" | "Action required from P2",
      "switchPerspective": "Basculer" | "Switch"
    }
  }
}
```

Référencées par le template du banner A13 + A24 + A35 (cf. §4.6).

### 5.3 POST `/api/rooms/quick-duel`

**Réponse** :
```ts
interface QuickDuelResponse {
  roomCode: string;
  wsToken1: string;
  wsToken2?: string;       // omis en SOLO multiplex
}
```

**Décision Q1 acté** : champ optionnel **transitoire**, supprimé en phase
δ post-livraison Option C.

---

## 6. Migration

### 6.1 Principes

- **Pas de PR monolithique**. Découpe en commits qui peuvent chacun
  tourner verts seuls (γ pattern déjà acquis).
- **2 PRs distinctes** (cf. A12 et A7 — corrections de la spec d'origine).
- **Tests CI must-pass à chaque commit** + au moins 1 spec nouvelle
  par commit qui exerce une partie du multiplex.

### 6.2 🆕 A12 + A7 — Découpe en 2 PRs (correction)

⚠️ La spec d'origine §6.2 prétendait que commits 1-3 étaient
"safe in isolation" (server-side additif). **Faux** :
- Commit 4 (PerspectiveSlot) ne peut PAS shipper en isolation côté front
  (les 2 connections γ ont chacune leur `_slots[0..1]` mal alimenté).
- Commit 3 (1-token POST) déployé avant commit 6 (front 1-connection)
  casse les γ-clients qui ouvrent encore 2 sockets ⇒ le 2e socket
  cherche un token jamais issu ⇒ close 4001 ⇒ "connection lost".

**Découpe corrigée en 2 PRs** :

**PR1 — Server additif (déployable seul, additif strict, sans cassure)**

| # | Commit | Sites touchés | Tests verts |
|---|---|---|---|
| 1 | `feat(γ-c): server — add forPlayer optional field on 7 ClientMessage + STRICT validation in ws.on('message')` | `ws-protocol-{system,prompts}.ts` (front+back), `client-message-router.ts`, `server.ts:1107-1117` | front+back specs verts (additif, rejeté en PvP normal) |
| 2 | `feat(γ-c): server — branch soloMode in worker-message-router broadcast + sendToPlayer no-op-on-1 + WAITING_RESPONSE branch SOLO + DUEL_STARTING bothCardCodes (initial + reconnect)` | `worker-message-router.ts:267, 280-291`, `server.ts:634-635, 673-689, 1176` | back specs vert (SOLO existant 2-socket continue d'envoyer 2× mais le 2e est no-op-on-1 ⇒ comportement strict identique) |
| 1b | `feat(γ-c): server — extend WAITING_RESPONSE.targetPlayer + InactivityWarningMsg.player (if missing)` | `ws-protocol-system.ts` back+front | additif, back-compat |

PR1 peut être déployée en prod **immédiatement** sans toucher front. Aucun
comportement γ change (le 2e send est strictement no-op en SOLO).

**PR2 — Multiplex complet (server + front atomique)**

| # | Commit | Sites touchés | Tests verts |
|---|---|---|---|
| 3 | `feat(γ-c): server — POST quick-duel SOLO renvoie 1 token + register avec 1 token + lifecycle helpers (isReadyToStart, isFullyDisconnected) + ws.on('close') SOLO sans grace logic (A18)` | `server.ts:484, 497, 1076, 1120-1146, 1142` | back specs vert |
| 4 | `refactor(γ-c): front — DuelConnection PerspectiveSlot × 9 fields + per-perspective routing in handleMessage + sendResponse slot-clear (A22) + REMATCH_STARTING _boardActive reset (A23)` | `duel-connection.ts` (extraction + 14 branches handler + sendResponse cleanup ciblé) | front specs vert ; **PvP normal inchangé** (slot 0 alimenté uniquement, slot 1 vide jamais lu) |
| 5 | `refactor(γ-c): front — wsService 21 computeds via getXxxFor(perspective) + 7 sendXxx tagge forPlayer SOLO-ONLY (A21) + memoize lastSentForPlayer for ANIMATIONS_DONE` | `duel-web-socket.service.ts` | front specs vert |
| 6 | `feat(γ-c): front — SOLO multiplex orchestrator (1 connection) + setupRematchEffect 1-signal + persist perspective localStorage + BOARD_STATE swap extended + setBoardActive removal + banner UX switch-during-prompt + disabled-while-switching` | `solo-duel-orchestrator.service.ts`, `duel-web-socket.service.ts`, `duel-page.component.ts:585-630` SOLO branch, `duel-page.component.html` banner, `room-api.service.ts` | front specs vert + nouvelle spec multiplex `solo-multiplex.spec.ts` (T-F6 vérifie 1 socket + activeChainLinks cohérent au switch) |
| 7 | `test(γ-c): WebSocketFactory injection token + rewrite phase-gamma-victory.spec.ts — exercises real multiplex pipeline (M9 / C4.5)` | `duel-connection.ts` ctor, `phase-gamma-victory.spec.ts`, ~6 sites WebSocketFactory (A25) | spec passe avec vrai pipeline via mock |
| 8 | `chore(γ-c): cleanup — drop _sharedProcessor / bindTransports / R1 checkpointLog / orphan defaultConnection` | `duel-web-socket.service.ts`, `solo-duel-orchestrator.service.ts` | code mort retiré, specs vert |

PR2 doit être **mergée + déployée en 1 release** (front + back ensemble).

### 6.3 Plan de rollback

Si une régression critique apparaît après merge de PR2 :
- **Rollback de la release entière** (PR2 reverted intégralement, back +
  front en cohérence).
- PR1 reste en prod (additif strict, n'affecte pas γ).
- Le γ-client continue de marcher : le `forPlayer` field n'est jamais
  envoyé, le serveur PR1 le rejette si jamais envoyé.

**Note** : "no-rollback past PR2 deploy" — une fois le 1-token POST live,
γ-clients qui tentent de se connecter avec 2 sockets cassent. Plan de
déploiement standard "front+back en lockstep" sur les services WS.

### 6.4 Synergie fork-solo

`fork-handlers.ts` utilise déjà le pattern omniscient (2 sockets +
filtering omniscient). C'est **un précédent structurel positif** : si
omniscient marche pour fork-solo, marche pour SOLO multiplex. **Mais**
fork-solo garde aujourd'hui 2 sockets (1 par identité) — c'est une
opportunité de **converger** : après l'option C livrée, on peut faire
passer fork-solo à 1 socket aussi (~1-1.5j additionnel — Q3 répondu
post-livraison, hors scope direct).

---

## 7. Tests

### 7.1 Tests serveur ajoutés

| ID | Nom | Couverture |
|---|---|---|
| **T-S1** | `worker-message-router.spec.ts:soloMode broadcast omniscient` | 1 seul `send` appelé par message en SOLO ; payload passé par `filterMessage(_, 0, true)` |
| **T-S2** | `client-message-router.spec.ts:forPlayer field overrides currentPlayerIndex` | `PLAYER_RESPONSE` avec `forPlayer: 1` route bien vers le slot P1 même si le socket est `players[0].ws` |
| **T-S3** | `server.spec.ts:POST quick-duel SOLO returns 1 token` | Réponse contient `wsTokens: [tok0]` quand `soloMode: true` |
| **T-S4** | `worker-message-router.spec.ts:lastSentPrompt indexed by message.player` | Le cache reconnect tagge selon `SELECT_*.player`, pas selon le destinataire socket |
| **T-S5** | `server.spec.ts:sendToPlayer no-op-on-1 in SOLO` | `REMATCH_STARTING` envoyé en SOLO via 2 `sendToPlayer(s, 0/1, X)` ⇒ 1 seul `safeSend` |
| **🆕 T-S6** | `server.spec.ts:forPlayer in PvP normal is rejected with warning` | `PLAYER_RESPONSE` avec `forPlayer` en PvP normal ⇒ rejected, warn logged, no dispatch |
| **🆕 T-S7** | `server.spec.ts:isReadyToStart in SOLO with 1 connected player` | SOLO `players[0].connected=true, [1]=false` ⇒ `isReadyToStart` true ; `startDuelWithOrder` invoqué |
| **🆕 T-S8** | `server.spec.ts:isFullyDisconnected in SOLO` | SOLO 1 socket close ⇒ `isFullyDisconnected(session) === true`, cleanup fire ; **AUCUN combinedGraceTimer armé** |
| **🆕 T-S9** | `server.spec.ts:DUEL_STARTING in SOLO carries bothCardCodes` | SOLO POST ⇒ `DUEL_STARTING.bothCardCodes` contient les 2 decks (au site initial) |
| **🆕 T-S10** | `server.spec.ts:SOLO close skips grace logic (A18)` | SOLO `ws.on('close')` ⇒ pas de `combinedGraceTimer` armé, pas de `bothDisconnected=true`, reconnect possible jusqu'à `disconnectGraceMs` long timeout |
| **🆕 T-S11** | `worker-message-router.spec.ts:WAITING_RESPONSE in SOLO routed to socket 0` | SOLO `SELECT_CARD.player=0` ⇒ `WAITING_RESPONSE` reçu sur socket 0 avec `targetPlayer=1` (A19) |
| **🆕 T-S12** | `server.spec.ts:DUEL_STARTING reconnect in SOLO carries bothCardCodes` | SOLO reconnect via `sendStateSnapshot` ⇒ DUEL_STARTING avec `bothCardCodes` (A20) |
| **🆕 T-S13** | `server.spec.ts:resendPendingPrompt × 2 in SOLO reconnect` | SOLO reconnect avec `lastSentPrompt[1]` non-null ⇒ socket 0 reçoit hint+prompt slot 1 (A29) |
| **🆕 T-S14** | `client-message-router.spec.ts:REMATCH_REQUEST SOLO court-circuit` | SOLO `REMATCH_REQUEST` 1 fois ⇒ `startRematch` appelé immédiatement (sans gate "both requested"), pas de `REMATCH_INVITATION` émis (A27) |
| **🆕 T-S15** | `worker-message-router.spec.ts:WORKER_CANCEL_DONE SOLO routed to socket 0` | SOLO `WORKER_CANCEL_DONE{playerIndex:1}` ⇒ socket 0 reçoit STATE_SYNC + CHAIN_STATE + cached prompt avec `player=1` ; filterMessage omniscient (A30) |
| **🆕 T-S16** | `server.spec.ts:post-duel grace cleanup SOLO` | SOLO F5 post-duel (endedAt set, `now - endedAt < rematchExpiryMs`) ⇒ `cleanupDuelSession` PAS appelé ; reconnect possible ; après `rematchExpiryMs` ⇒ cleanup fire (A31) |
| **🆕 T-S17** | `client-message-router.spec.ts:ERROR via sendToPlayer in SOLO` | SOLO `PLAYER_RESPONSE` mismatch sur `forPlayer=1` ⇒ socket 0 reçoit `{ type: 'ERROR', message, player: 1 }` (A32 routing via whitelist A28) |

### 7.2 Tests front ajoutés

| ID | Nom | Couverture |
|---|---|---|
| **T-F1** | `duel-connection.spec.ts:PerspectiveSlot routing` | `SELECT_CARD.player=1` met à jour `_slots[1].pendingPrompt`, pas `_slots[0]` |
| **T-F2** | `duel-connection.spec.ts:DRAW announce dedup global` | **🆕 A33 (3e passe)** — `_lastDrawAnnouncedHash` reste GLOBAL avec clé `${turnPlayer}:${turnCount}` ; switch perspective intra-turn ne re-déclenche PAS l'annonce (test : MSG_DRAW(turn=3, player=0) ⇒ announce ; switchPerspective ; MSG_DRAW(turn=3, player=0) ⇒ pas de re-announce). β.3 cas #13 préservé. |
| **T-F3** | `duel-connection.spec.ts:BOARD_STATE swap on perspective=1 SOLO` | Le payload passé à `syncAfterBoardState` a `players[]` swappé si `perspective=1` |
| **T-F4** | `duel-web-socket.service.spec.ts:pendingPrompt reactive on perspective flip` | Flipper `duelCtx.setPerspective(1)` re-route `pendingPrompt` sur le slot 1 |
| **T-F5** | `solo-duel-orchestrator.service.spec.ts:single connection in SOLO` | `_connection()` est unique, pas de paire |
| **T-F6** | `solo-multiplex.spec.ts:NEW — phase-gamma victory test (replaces M9 vacuous)` | Scénario : MSG_CHAINING + MSG_CHAIN_SOLVING + switchPerspective + MSG_CHAIN_END ⇒ pas de Lock safety timeout, pas de POLL-DROP REGRESSION, `activeChainLinks` cohérent à chaque étape |
| **🆕 T-F7** | `duel-connection.spec.ts:WAITING_RESPONSE.targetPlayer routes to correct slot` | `WAITING_RESPONSE{targetPlayer:1}` flip `_slots[1].waitingForOpponent` only |
| **🆕 T-F8** | `solo-duel-orchestrator.spec.ts:perspective persisted to localStorage` | `switchPerspective()` write SOLO_PERSPECTIVE_KEY ; bootstrap reads it back |
| **🆕 T-F9** | `solo-duel-orchestrator.spec.ts:setupRematchEffect fires on single signal` | `_connection().rematchStarting()` flip true ⇒ reset orchestrator + perspective 0 + counter++ |
| **🆕 T-F10** | `duel-connection.spec.ts:DUEL_END clears BOTH slots` | DUEL_END → `_slots[0].pendingPrompt() === null && _slots[1].pendingPrompt() === null` |
| **🆕 T-F11** | `duel-web-socket.service.spec.ts:PvP normal sendXxx NO forPlayer tag` | PvP normal `sendAnimationsDone()` + `sendSurrender()` + autres ⇒ payload SANS `forPlayer` field (A21) |
| **🆕 T-F12** | `duel-connection.spec.ts:sendResponse clears slot of forPlayer` | `sendResponse(_, _, forPlayer=1)` ⇒ `_slots[1].pendingPrompt() === null`, `_slots[0].pendingPrompt()` inchangé (A22) |
| **🆕 T-F13** | `solo-multiplex.spec.ts:REMATCH_STARTING resets _boardActive` | Scenario REMATCH ⇒ `_boardActive === false` après REMATCH_STARTING, 5 MSG_DRAW initiaux du nouveau duel s'animent (A23) |
| **🆕 T-F14** | `duel-page.component.spec.ts:banner button disabled during switching` | `pendingPromptForOtherSlot()=true && switching()=true` ⇒ button disabled (A24) |
| **🆕 T-F15** | `duel-connection.spec.ts:MSG_HINT inheritance intra-slot` | `MSG_HINT(player=0, cardName='Solemn', type=10)` puis `switchPerspective(0→1)` puis `MSG_HINT(player=0, cardName='', type=3)` ⇒ `_slots[0].hintContext.cardName === 'Solemn'` (A34 lecture intra-slot, pas current perspective) |
| **🆕 T-F16** | `duel-web-socket.service.spec.ts:ANIMATIONS_DONE fallback on pendingPlayer` | SOLO bootstrap (`_lastSentForPlayer=null`) + `timerState.pendingPlayer=0` + `perspective()=1` ⇒ `sendAnimationsDone` envoie `forPlayer=0` (lit pendingPlayer, pas perspective) (A37) |
| **🆕 T-F17** | `solo-duel-orchestrator.spec.ts:REMATCH_REQUEST single send in SOLO` | SOLO `sendRematchRequest` 1 fois ⇒ payload PLAYER_RESPONSE/REMATCH_REQUEST avec `forPlayer=0`, pas de 2e `sendRematchRequest`, auto-accept effect désactivé en SOLO (A27 corollaire front) |
| **🆕 T-F18** | `duel-page.component.spec.ts:ERROR message → toast UX` | `ERROR` reçu via WS ⇒ toast affiché (perspective-agnostique), pas de routage per-slot — l'erreur concerne l'action immédiate (A32 front) |

### 7.3 🆕 A15 — `WebSocketFactoryService` injection pour tests propres

```ts
// duel-connection.ts (et duel-web-socket.service.ts en cascade)
@Injectable({ providedIn: 'root' })
export class WebSocketFactoryService {
  create(url: string): WebSocket { return new WebSocket(url); }
}

// DuelConnection constructor :
constructor(wsUrlBase: string, ..., private readonly factory = inject(WebSocketFactoryService)) { ... }
private openConnection(): void {
  this.ws = this.factory.create(this.wsUrlBase + '?token=...');
}
```

**Mock pour T-F6** :
```ts
class MockWebSocket extends EventTarget {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];
  send(data: string) { this.sentMessages.push(data); }
  close() { this.dispatchEvent(new CloseEvent('close')); }
  simulateServerMessage(payload: object) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

// Dans T-F6 spec :
const mockWs = new MockWebSocket();
TestBed.overrideProvider(WebSocketFactoryService, { useValue: { create: () => mockWs } });
// ...puis simulateServerMessage avec un scenario chain complet.
```

**A25 — Sites de construction `DuelConnection` à adapter** :

| Site | Action |
|---|---|
| `duel-web-socket.service.ts:51` (`_defaultConnection` PvP normal) | inject factory + passer au ctor |
| `solo-duel-orchestrator.service.ts:113,117` (γ legacy) | **supprimé par commit 6** ; remplacé par 1 call mono-conn dans `init()` |
| `replay-duel-adapter.ts` | **À vérifier** — selon CLAUDE.md `DuelConnection` n'est PAS une abstraction layer, donc `ReplayDuelAdapter` n'utilise probablement PAS `DuelConnection`. Confirmer au commit 7. |
| Tests `duel-connection.spec.ts:*` (~4 sites) | mock factory via `TestBed.overrideProvider` |

### 7.4 Tests à supprimer

| ID | Nom | Raison |
|---|---|---|
| `phase-gamma-victory.spec.ts:T2 / T7 / T10` | mock `notifyPerspectiveSwitch`, no-op assertions | Vacuous (C4.5 M9, C4.6 M10, C4.7 M11) — remplacés par T-F6 |
| `phase-gamma-victory.spec.ts:T4 R1 checkpointLog` | instrumentation R1 | Disparaît avec `checkpointLog` |

### 7.5 Stratégie test-end-to-end Playwright

Le harness `front/e2e/solo-pvp-harness.ts` (414 lignes infra-only) doit
être **complété de 3 scénarios scriptés** :

- **Scenario A** — chain SOLO basique : P0 active une carte ⇒ P1 chaîne
  Maxx C ⇒ switch perspective pendant chain ⇒ resolve ⇒ vérifier zéro
  warn dans console (DuelLogger PIPELINE + console.warn) + zéro Lock
  safety timeout. **Bonus** : screenshot frame middle-anim ⇒ 1 seule
  carte qui voyage par MSG_MOVE, pas 2 superposées (preuve visuelle C1
  éliminé).
- **Scenario B** — bootstrap SOLO : POST quick-duel + 1 socket connect
  ⇒ `isReadyToStart` true ⇒ DUEL_STARTING ⇒ 5 MSG_DRAW initiaux ⇒
  l'utilisateur voit 5 cartes différentes en main (preuve qu'aucun
  double-fire n'a regroupé les draws).
- **🆕 Scenario C** — rematch SOLO : end du 1er duel ⇒ REMATCH_STARTING
  ⇒ nouveau worker spawn ⇒ nouveau BOARD_STATE ⇒ 5 MSG_DRAW initiaux du
  rematch s'animent correctement (`_boardActive=false` reset garantit
  tier 1 de `syncAfterBoardState`) ⇒ preuve A23 fonctionne.
- **🆕 Scenario D (3e passe)** — rematch SOLO court-circuit + F5 grace :
  end du 1er duel ⇒ user F5 immédiatement (avant click "Rematch") ⇒
  reconnect réussit (A31 grace cleanup) ⇒ user click "Rematch" 1 fois
  ⇒ rematch démarre sans gate "both requested" (A27) ⇒ preuve A27+A31
  fonctionnent en combinaison.
- **🆕 Scenario E (3e passe)** — cancel-rollback slot 1 SOLO : chain
  Maxx C (slot 1 prompt) ⇒ user switch perspective vers 1 ⇒ right-click
  pour cancel ⇒ WORKER_CANCEL_DONE ⇒ socket 0 reçoit STATE_SYNC +
  CHAIN_STATE + prompt avec `player=1` ⇒ `_slots[1]` ré-init proprement
  ⇒ aucune desync, aucun strike count ⇒ preuve A30 fonctionne.

Tests CI-gating via Playwright (pas Karma — incompatible avec un vrai
WS).

---

## 8. Risques

### 8.1 Régressions PvP normal

**Risque** : la branche `if (session.soloMode)` côté serveur ouvre une
porte de régression sur PvP normal si elle est mal délimitée.

**Mitigation** :
- Tous les tests existants PvP normal doivent rester verts à chaque
  commit (CI gate).
- Le commit 4 (PerspectiveSlot front) introduit une dualité qui marche
  AUSSI en PvP normal (un seul slot est alimenté, l'autre reste vide).
  Pas de modification du comportement PvP.
- Le `forPlayer?` field étant **strictement rejeté en PvP normal**
  (A2), PvP normal ne peut pas être impacté par une fuite SOLO.
- **A21 — garde SOLO-only des `sendXxx`** : empêche le front PvP normal
  de tagger `forPlayer` accidentellement.

### 8.2 BOARD_STATE swap front en SOLO perspective=1

**Risque** : le swap front-side est invisible aux tests existants
(`renderedBoardState` reflète l'état post-swap, donc indistinguable de
l'état pre-swap arrivé déjà swappé serveur). Une régression de swap
crée un bug visuel "board entier flippé" silencieusement.

**Mitigation** :
- T-F3 spec dédié.
- Spec d'intégration : `solo-multiplex.spec.ts:perspective=1 BOARD_STATE`
  vérifie que `rbs.logicalState().players[0]` correspond bien à la
  perspective courante (et non au P0 absolu).
- **A17 — swap étendu** au BoundaryProcessor + `boardStateAfter`
  per-event ⇒ pas de spurious `TurnStarted/Ended` au switch.
- Pattern réutilisé de `ReplayDuelAdapter` qui le fait correctement
  depuis la chasse perspective bug-hunt 2026-05-20 — éprouvé en prod.

### 8.3 SELECT_* du joueur non-perspective qui apparaissent

**Risque** : en SOLO multiplex, le serveur envoie les `SELECT_*` des 2
joueurs au seul socket. Si le routing per-slot est buggué (un SELECT_*
pour P1 atterrit dans `_slots[0]`), l'utilisateur SOLO voit un prompt
pour l'autre perspective avec aucun contexte visuel.

**Mitigation** :
- T-F1 + T-F4.
- Garde `duelAssert` dans `handleMessage` : `duelAssert(message.player ===
  0 || message.player === 1, 'handleMessage', 'invalid player index')`.
- **A13 + A24 — banner UX** : la perspective courante voit "Action requise
  de P{N+1}" + bouton "Basculer" (disabled pendant `switching()`) si
  l'autre slot a un prompt actif. UX pédagogique, pas de prompt invisible.

### 8.4 Reconnect mid-duel en SOLO multiplex

**Risque** : reconnect aujourd'hui = client reçoit STATE_SYNC + CHAIN_STATE
+ resendPendingPrompt. Avec 1 seul socket en SOLO, reconnect = 1 cycle.
Mais `session.lastSentPrompt[0]` et `session.lastSentPrompt[1]` doivent
TOUS DEUX être re-émis (si SOLO a switched et que le prompt courant
appartient au joueur "non-front" du moment).

**Mitigation** :
- `resendPendingPrompt(session, playerIndex)` (`server.ts:1150-1156`)
  est appelé pour `playerIndex` calculé via `currentPlayerIndex()` =
  toujours 0 en SOLO multiplex. **Bug en attente.**
- Correction : en SOLO, appeler `resendPendingPrompt(session, 0)` ET
  `resendPendingPrompt(session, 1)` après reconnect. Le front reçoit
  les 2 prompts, ses 2 slots se remplissent, la perspective courante
  affiche le bon.
- **A5 — perspective persistée en localStorage** : au reconnect, la
  perspective courante est restaurée depuis storage ⇒ user revient à
  son point.
- **A8.2 WAITING_RESPONSE.targetPlayer** : le `waitingForOpponent` du
  slot non-réponseur est correctement set.
- **A20 — DUEL_STARTING reconnect carries `bothCardCodes`** : le prefetch
  d'images des 2 perspectives est restauré au reconnect.

**HINT ordering subtilité** : `resendPendingPrompt` envoie
hint-then-prompt par player ⇒ en SOLO, la séquence est
`[hintP0, promptP0, hintP1, promptP1]`. Le `_hintContext` per-slot
résolve : chaque slot reçoit le hint AVANT le prompt qui l'utilise.
**Ordering preserved**.

À ajouter au commit 6 (front multiplex) + 2 (server soloMode broadcast)
comme parties d'un même contrat.

### 8.5 Convergence vers fork-solo

**Non-risque mais à acter** : fork-solo aujourd'hui fonctionne en 2-socket
omniscient et n'a JAMAIS eu le bug C1 (parce qu'il ne reçoit pas de
MSG_CHAINING — c'est un replay précomputé). Migrer fork-solo à 1 socket
multiplex est cohérent doctrinalement mais hors scope direct de
l'option C (post-livraison, ~1-1.5j additionnel).

### 8.6 Bug γ qui se manifestait HORS chain

**À investiguer** : le memo `pvp-solo-chain-state-hygiene-2026-05-23`
parle de Lock safety timeout HAND-0/GY-0 — typiquement liés à
MSG_MOVE. Mais MSG_DRAW est aussi BOARD_CHANGING. **Le double-fire C1
existe sur TOUS les BOARD_CHANGING_EVENT_TYPES**, pas seulement chain.
L'option C élimine ça partout par construction. Test à scripter dans le
harness Playwright (Scenario B) : "5 MSG_DRAW initiaux n'animent qu'une
fois chacun en SOLO" (et pas 2× chacun).

### 8.7 — Le duel ne démarre pas en SOLO multiplex (risque critique éliminé par A3)

**Risque éliminé par A3** : sans les helpers `isReadyToStart` /
`isFullyDisconnected`, la gate `players[0].connected && players[1].connected`
restait `false` éternellement en SOLO multiplex ⇒ worker jamais spawné ⇒
duel jamais démarré. **A3 résout le risque par construction**.

Test : T-S7.

### 8.8 — Session leak post-duel en SOLO multiplex (risque critique éliminé par A3)

**Risque éliminé par A3 + A18** : sans `isFullyDisconnected` branché SOLO
+ sans la skip de grace logic, la session restait en mémoire ou
terminait prématurément. **A3 + A18 résolvent le risque par construction**.

Test : T-S8 + T-S10.

### 8.9 — Impersonation PvP via `forPlayer` triché (risque critique éliminé par A2)

**Risque éliminé par A2** : sans la validation stricte, un client PvP
malicieux pouvait répondre aux prompts de son opposant. **A2 résout le
risque par construction** (rejet avec warn).

Test : T-S6.

### 🆕 8.10 — F5 SOLO termine le duel en "draw_both_disconnect" (risque BLOCKER éliminé par A18)

**Risque éliminé par A18** : sans le skip explicite de grace logic en
SOLO, le pattern A3bis d'origine clearait `players[1].connected = false`
synchroniquement, provoquant `startGracePeriod(0)` → branche
`bothDisconnected` → `combinedGraceTimer` armé → **DUEL_END
`draw_both_disconnect` à chaque F5 SOLO**.

A18 inverse l'approche : **skip entièrement la grace logic en SOLO**
(non-sense pour un mono-user). `players[1].connected` reste à son état
d'init (false), `isFullyDisconnected` se branche en SOLO sur
`players[0]` seul. **A18 résout le risque par construction**.

Test : T-S10.

### 🆕 8.11 — ANIMATIONS_DONE rejected en PvP normal (risque HIGH éliminé par A21)

**Risque éliminé par A21** : sans la garde SOLO-only, le front PvP normal
pourrait tagger `forPlayer` accidentellement sur `sendAnimationsDone`,
ce qui serait **rejeté par A2 strict validation** ⇒ `pendingTimeout`
serveur ne fire jamais ⇒ turn timer ne démarre pas ⇒ partie bloquée.

A21 conditionne le tag `forPlayer` sur `wsService.soloMode === true`.
PvP normal n'envoie jamais `forPlayer`. **A21 résout le risque par
construction**.

Test : T-F11.

### 🆕 8.12 — Rematch SOLO multiplex dead-locked (risque BLOCKER éliminé par A27)

**Risque éliminé par A27** (Finding F1, 3e passe) : sans le
court-circuit serveur SOLO, la gate `client-message-router.ts:179`
"both requested" attendrait éternellement le 2e `REMATCH_REQUEST` qui
n'arrive jamais (REMATCH_INVITATION est envoyé à `opponentIdx=1` →
drop par no-op-on-1 → `rematchState='idle'` à jamais → pas d'auto-accept
A4 → pas de 2e sendRematchRequest). User SOLO bloqué post-duel.

A27 inverse la doctrine en SOLO : 1 user = 1 click = `startRematch`
direct. Auto-accept A4 désactivé en SOLO (`!soloMode` guard).
**A27 résout le risque par construction**.

Test : T-S14 + T-F17 + Scenario D Playwright.

### 🆕 8.13 — INACTIVITY_WARNING slot 1 perdu en SOLO multiplex (risque HIGH éliminé par A28)

**Risque éliminé par A28** (Finding F2, 3e passe) : sans la whitelist
`PSEUDO_PAIRWISE_SOLO_ROUTED`, `sendToPlayer(session, 1, INACTIVITY_WARNING)`
était no-op-on-1 ⇒ user slot 1 forfeit inactivity sans préavis.

A28 généralise la doctrine no-op-on-1 en "routing-to-0 selon whitelist".
INACTIVITY_WARNING + ERROR + REMATCH_INVITATION (A27) + WAITING_RESPONSE
(A19) tous routés au socket 0 avec tag de slot dans le payload.
**A28 résout le risque par construction**.

Test : T-S17 + (T-F18 toast ERROR).

### 🆕 8.14 — F5 SOLO mid-duel perspective=1 prompt slot 1 perdu (risque HIGH éliminé par A29)

**Risque éliminé par A29** (Finding F3, 3e passe) : `resendPendingPrompt`
n'était appelé qu'avec `playerIndex` du handshake (= 0 en SOLO). Un F5
perspective=1 avec `lastSentPrompt[1]` actif ne re-recevait jamais ce
prompt ⇒ `_slots[1].pendingPrompt = null` ⇒ banner A13 "Action requise
de P2" jamais affiché ⇒ partie silencieusement bloquée.

A29 appelle `resendPendingPrompt(0)` + `(1)` en SOLO.
**A29 résout le risque par construction** + A5 persistance perspective
+ A20 `bothCardCodes` reconnect garantissent un reconnect fidèle.

Test : T-S13.

### 🆕 8.15 — Cancel-rollback slot 1 silent desync (risque HIGH éliminé par A30)

**Risque éliminé par A30** (Finding F4, 3e passe) : `WORKER_CANCEL_DONE`
émettait 3 sends consécutifs sur `playerIndex=p` (identité OCGCore). En
SOLO multiplex avec cancel slot 1, tous 3 sends → no-op-on-1 → `_slots[1]`
desync ⇒ retry loop → DUEL_END too_many_invalid.

A30 route les 3 sends en SOLO sur socket 0 ; le `player=p` dans les
payloads permet le routage front. `filterMessage` passe en mode
omniscient en SOLO (§3.1).
**A30 résout le risque par construction**.

Test : T-S15 + Scenario E Playwright.

### 🆕 8.16 — F5 post-duel SOLO empêche le rematch (risque MEDIUM-HIGH éliminé par A31)

**Risque éliminé par A31** (Finding F5, 3e passe) : la gate cleanup
ligne 1142 fire dès qu'`isFullyDisconnected` (A3 SOLO = `!players[0].connected`)
post-duel ⇒ session terminée avant que le user click "Rematch" au
reconnect.

A31 ajoute un gate `Date.now() - endedAt < rematchExpiryMs` en SOLO
pour préserver la session pendant la fenêtre rematch grace. Pas de
fuite mémoire : le `rematchTimeout` armé par `handleDuelEnd` gère
l'expiration naturelle.
**A31 résout le risque par construction**.

Test : T-S16 + Scenario D Playwright.

---

## 9. 🆕 A16 + A26 + A38 — Effort total révisé après 3 passes adversariales

| Phase | v1 | v1+A1-A17 | v1+A1-A26 | v1+A1-A37 (3e passe) | Détail 3e passe |
|---|---|---|---|---|---|
| **Serveur (PR1)** | 1j | 1.5j | 1.75j | **2.0j** | +A28 whitelist routing-to-0 (refactor `sendToPlayer`) + payload INACTIVITY_WARNING.player |
| **Serveur (PR2 lifecycle)** | 0.5j | 0.75j | 1j | **1.5j** | +A27 rematch court-circuit + A29 resendPendingPrompt × 2 + A30 WORKER_CANCEL_DONE routing + A31 post-duel grace + A32 ERROR via sendToPlayer |
| **Front PerspectiveSlot refactor (commit 4)** | 1.5j | 3j | 3.25j | **3.5j** | +A34 MSG_HINT inheritance intra-slot (`_slots[message.player]`) + A33 `_lastDrawAnnouncedHash` reclasse GLOBAL (-1 field per-slot, simplification) |
| **Front wsService computeds + sendXxx (commit 5)** | 0.5j | 0.75j | 0.85j | **1.0j** | +A37 fallback `pendingPlayer` du timer state + extension TimerStateMsg.pendingPlayer |
| **Front mono-connection SOLO (commit 6)** | 1j | 1.5j | 1.75j | **2.0j** | +A27 garde `!soloMode` auto-accept + A32 toast UX ERROR + A35 i18n keys banner |
| **Tests (commit 7)** | 0.75j | 1.25j | 2.5j | **3.25j** | +T-S13-17 (5 nouveaux serveur) + T-F15-18 (4 nouveaux front) + Playwright Scenario D + E |
| **Cleanup (commit 8)** | 0.25j | 0.25j | 0.25j | 0.25j | inchangé |
| **Buffer risques** | 0.75j | 1j | 1.5j | **1.75j** | +0.25j pour la cascade A27-A37 (interactions A27×A4, A28×A19 dédoublonnage, A37×TimerStateMsg) |
| **TOTAL CODE** | 5.5j | 10j | ~13j | **~15.25j** | |
| **Amendements doc (déjà appliqués)** | - | 2.6j | 3.1j | **3.5j** | +0.4j pour 11 nouveaux amendments A27-A37 |
| **GRAND TOTAL** | 6.5j | 12.6j | ~16.1j | **~18.75j** | |

**🆕 A38 (3e passe)** — l'estimate v1+A1-A37 totalise ~18.75j. Le delta
+2.65j vs v1+A1-A26 se décompose comme suit :
- **+0.75j PR1 server** (A28 refactor whitelist + 1 protocole add) ;
- **+0.5j PR2 server lifecycle** (5 amendments serveur : A27 / A29 /
  A30 / A31 / A32) ;
- **+0.5j PR2 front** (3 amendments front : A33 simplif + A34 intra-slot
  + A37 fallback + A27 garde + A32 toast + A35 i18n) ;
- **+0.75j tests** (9 nouveaux specs + 2 scenarios Playwright) ;
- **+0.25j buffer** (cascade A27-A37) ;
- **+0.4j doc** (11 nouveaux amendments documentés).

**Recommandation** : si l'estimate ~18.75j dépasse l'appétit risque, la
**Option A (dedup hash palliatif ~1j)** reste un fallback acceptable —
mais elle ne résout que les 6 BLOCKER de C1, pas les findings F1-F12
de la 3e passe (qui sont des effets de bord du multiplex, pas du
double-fire). L'Option C reste préférable car elle élimine **par
construction** les 8 findings initiaux + les 12 findings 3e passe.

---

## 10. Critères de succès (acceptance)

L'option C est mergeable quand :

1. ✅ **Tous les tests existants PvP normal restent verts** (1518+ specs).
2. ✅ **T-S1 à T-S17 (17 nouveaux specs serveur) verts**, dont T-S6 sécurité
   `forPlayer`, T-S7 bootstrap SOLO, T-S8 fullyDisconnected SOLO, T-S10
   close SOLO sans grace, T-S11 WAITING_RESPONSE routing, T-S12
   DUEL_STARTING reconnect, **🆕 T-S13 resendPendingPrompt × 2**,
   **🆕 T-S14 rematch SOLO court-circuit**, **🆕 T-S15 WORKER_CANCEL_DONE
   SOLO routing**, **🆕 T-S16 post-duel grace cleanup**, **🆕 T-S17
   ERROR via sendToPlayer**.
3. ✅ **T-F1 à T-F18 (18 nouveaux specs front) verts**, dont T-F6 vrai
   pipeline via `WebSocketFactory` mock, T-F11 PvP normal sans forPlayer,
   T-F12 sendResponse slot-clear, T-F13 REMATCH _boardActive, T-F14
   banner disabled, **🆕 T-F15 MSG_HINT inheritance intra-slot**,
   **🆕 T-F16 ANIMATIONS_DONE fallback pendingPlayer**, **🆕 T-F17
   REMATCH_REQUEST single send SOLO**, **🆕 T-F18 ERROR toast UX**.
4. ✅ **Scenarios Playwright A à E passent** (chain SOLO + bootstrap
   SOLO + rematch SOLO + **🆕 D rematch court-circuit + F5 grace** +
   **🆕 E cancel-rollback slot 1**) sans Lock safety timeout ni
   POLL-DROP REGRESSION ni warn console.
5. ✅ **`grep` audit** : `_sharedProcessor`, `bindTransports`,
   `bindSharedProcessor`, `_defaultConnection`, `_transport_connections`,
   `checkpointLog` retirés du codebase. Seul `_connection` unique
   subsiste. `broadcastToBoth` n'existe nulle part.
6. ✅ **CLAUDE.md updated** : doctrine "1 processor par duel" reformulée
   en "1 connection par duel" ; `R8`/`R1` mentions retirées ; doctrine
   "Information disclosure under omniscient SOLO" documentée ;
   **🆕 doctrine "routing-to-0 selon whitelist en SOLO"** (A28)
   documentée.
7. ✅ **Cluster C1 (6 findings BLOCKER) + C2.1 + C4.9 marqués clos**
   dans `phase-gamma-post-review-findings.md` + **🆕 12 findings 3e
   passe marqués clos** dans `phase-gamma-option-c-latent-bugs-review.md`.

---

## 11. Hors scope (à traiter ailleurs)

- **C2.2 (H2)** — `notifyPerspectiveSwitch` ordering avant flip signal.
  Indépendant de l'option C, à traiter séparément (~0.25j).
- **C3 entier** (xyz-leave edge cases B3, M2, M1, M13, L5). Indépendant,
  ~2j.
- **C4 (sauf C4.9)** — 8 findings isolés. À fixer opportunistically.
- **Convergence fork-solo vers 1 socket multiplex**. Bonus
  d'unification, ~1-1.5j additionnel post-option-C (Q3 acté).
- **PerspectiveProjector S3** (γ commit 6 prévu) — orthogonal. L'option
  C n'attend pas le PerspectiveProjector pour livrer, mais le swap
  BOARD_STATE §4.5 est cohérent avec le pattern S3.

---

## 12. Décisions actées (mise à jour post-3 passes adversariales)

1. **Q1 — `wsToken2` dans `QuickDuelResponse`** : **optionnel
   transitoire**, supprimé en δ post-livraison.
2. **Q2 — `broadcastToBoth` vs no-op `playerIndex=1` SOLO** : **no-op-on-1
   + routing-to-0 selon whitelist** (A1 + A28). `broadcastToBoth`
   rejeté définitivement. **Révisé 3e passe** : la doctrine no-op-on-1
   pure laissait 4 sites cassés silencieusement ; A28 généralise en
   routing-to-0 via `PSEUDO_PAIRWISE_SOLO_ROUTED` whitelist.
3. **Q3 — Convergence fork-solo dans la même PR ?** : **séparée**, livrer
   Option C d'abord, fork-solo en post-suite (~1-1.5j additionnel).
4. **Q4 — `forPlayer` validation côté serveur strict ou laxe ?** :
   **STRICTE** — rejected with warn en PvP normal si présent (A2 inverse
   la décision d'origine "ignore silently" — risque d'impersonation
   identifié).
5. **Q5 — Nom du field : `forPlayer` ou `asPlayer` ou `perspective` ?** :
   **`forPlayer`** (consistent avec le pattern `forPlayer` utilisé dans
   `filterMessage`).
6. **🆕 Q6 (3e passe) — Rematch SOLO : gate "both requested" maintenue
   ou court-circuitée ?** : **COURT-CIRCUITÉE** (A27). En SOLO, 1 user
   = 1 click = `startRematch` direct. Pas de REMATCH_INVITATION émis.
   Auto-accept A4 désactivé en SOLO (`!soloMode` guard).
7. **🆕 Q7 (3e passe) — `_lastDrawAnnouncedHash` : per-slot ou global ?** :
   **GLOBAL** (A33). La dédup MSG_DRAW est intrinsèquement turn-keyed,
   pas perspective-keyed. Clé `${turnPlayer}:${turnCount}` sans
   préfixe slot. Évite le re-announce au switch perspective intra-turn
   en SOLO multiplex omniscient.
8. **🆕 Q8 (3e passe) — `_hintContext` inheritance : current perspective
   ou intra-slot strict ?** : **INTRA-SLOT STRICT** (A34). Le `prev` lu
   pour `canInherit` MUST be `_slots[message.player].hintContext`, pas
   `currentPerspective`. Préserve l'inheritance cardName cross-hint
   malgré un switch intermédiaire.

---

## 13. Mapping amendments A1-A38 → sections modifiées

Pour traçabilité — chaque amendment des **3 passages adversariaux** est
appliqué dans une section spécifique :

### Passage 1 (A1-A17)

| ID | Cluster origine | Section spec modifiée | Description |
|---|---|---|---|
| **A1** | R1 | §3.2 | `broadcastToBoth` rejeté ; no-op-on-1 dans `sendToPlayer` |
| **A1bis** | R1 | §3.2 + §5.2 | DUEL_STARTING SOLO initial étendu avec `bothCardCodes` |
| **A2** | R2 | §3.3 + §12 Q4 | Validation stricte `forPlayer` (warn + drop en PvP normal) |
| **A2bis** | R2 | §3.3 | CANCEL rate-limit lâche en SOLO documenté |
| **A3** | R3 | §3.5 + §3.6 + §8.7 | Helpers `isReadyToStart` / `isFullyDisconnected` |
| ~~A3bis~~ | R3 | (annulé par A18) | ~~`ws.on('close')` symétrique SOLO~~ (introduisait N3 BLOCKER) |
| **A4** | R3 | §4.1 | `setupRematchEffect` réécrit pour 1 connection |
| **A5** | R3 | §4.1 + §4.6 | Perspective persistée en localStorage |
| **A6** | R3 | §3.4 | Session register avec 1 token en SOLO |
| **A7** | R6 | §6.2 + §6.3 | Commits regroupés en 2 PRs ; rollback granularité |
| **A8** | R4 | §4.3 | Tableau des fields refait (9 per-perspective, recompte exhaustif) |
| **A8.1** | R4 | §4.3 + §5.2 | `InactivityWarningMsg.player` à vérifier/ajouter |
| **A8.2** | R4 | §4.3 + §5.2 | `WaitingResponseMsg.targetPlayer` extension |
| **A9** | R4 | §3.3 + §4.4 | `ANIMATIONS_DONE.forPlayer` dérivation rule |
| **A10** | R5 | §3.1 | Doctrine "Information disclosure under omniscient SOLO" |
| **A11** | R5 | §3.1 | DICE_RESULT skippé en SOLO clarifié (pas un swap à compenser) |
| **A12** | R6 | §6.2 | Commits 4+5+6 PR atomique unique (PR2) |
| **A13** | R6 | §4.6 + §8.3 | UX banner "Action requise de P{N+1}" |
| **A14** | R6 | §4.6 | `setBoardActive` semantics clarifiées |
| **A15** | R6 | §7.3 + §4.7 | `WebSocketFactoryService` injection token pour tests |
| **A16** | R6 | §9 | Effort révisé à ~12.6j |
| **A17** | R7 | §4.5 | Swap étendu à BoundaryProcessor + `boardStateAfter` |

### Passage 2 (A18-A26)

| ID | Cluster origine | Section spec modifiée | Description |
|---|---|---|---|
| **A18** | N3 BLOCKER | §3.5 + §3.6 + §8.10 | A3bis-revised : **skip grace logic en SOLO** (évite F5 ⇒ draw_both_disconnect) ; `isFullyDisconnected` branche SOLO sur `players[0]` seul |
| **A19** | N1 HIGH | §3.2.ter + §3.6 + §4.3 + §5.2 | `WAITING_RESPONSE` émission SOLO branchée : send au socket 0 avec `targetPlayer` populé |
| **A20** | N2 HIGH | §3.2 + §3.6 + §8.4 | DUEL_STARTING **2e site reconnect** (`server.ts:1176`) patché avec `bothCardCodes` |
| **A21** | N4 HIGH | §3.3 + §4.2 + §4.4 + §4.7 + §8.11 | `wsService.soloMode` flag + garde SOLO-only sur 7 `sendXxx` (PvP normal NE TAGGE PAS `forPlayer`) |
| **A22** | N5 MEDIUM | §4.3 + §4.4 | `sendResponse` clear `_slots[forPlayer]` (banner UX A13 cohérent) |
| **A23** | N6 MEDIUM | §4.3 + §4.6 + §4.7 + §7.5 | REMATCH_STARTING reset `_boardActive=false` (5 MSG_DRAW initiaux du nouveau duel s'animent) |
| **A24** | N7 MEDIUM | §4.6 + §4.7 + §8.3 | Banner button `[disabled]="switching()"` |
| **A25** | N8 LOW | §4.7 + §7.3 | WebSocketFactory call sites inventaire complet (~6 sites) |
| **A26** | N9 MEDIUM | §9 | Estimate révisé à ~16.1j |

### Passage 3 (A27-A38) — 2026-05-28

Issu de la 3e passe adversariale (`phase-gamma-option-c-latent-bugs-review.md`,
12 findings : 1 BLOCKER, 3 HIGH, 1 MEDIUM-HIGH, 4 MEDIUM, 3 LOW).

| ID | Finding origine | Section spec modifiée | Description |
|---|---|---|---|
| **A27** | F1 BLOCKER | §3.2.quater + §3.6 + §4.1 + §4.7 + §8.12 + §12 Q6 | Rematch SOLO court-circuit serveur (1 click = `startRematch`) + désactivation auto-accept A4 en SOLO (front) |
| **A28** | F2 HIGH (+ généralisation A19/A30/A32) | §3.2 (refactor) + §3.6 + §5.2 + §8.13 + §12 Q2 | Whitelist `PSEUDO_PAIRWISE_SOLO_ROUTED` : `sendToPlayer` route au socket 0 pour 4 types (INACTIVITY_WARNING, ERROR, REMATCH_INVITATION, WAITING_RESPONSE) avec tag de slot dans payload. Doctrine no-op-on-1 généralisée. |
| **A29** | F3 HIGH | §3.2.quinto + §3.6 + §8.14 | `resendPendingPrompt(0)` + `(1)` en SOLO reconnect (mitigation §8.4 codifiée) |
| **A30** | F4 HIGH | §3.2.sexto + §3.6 + §8.15 | `WORKER_CANCEL_DONE` SOLO : 3 sends routés au socket 0, filterMessage omniscient |
| **A31** | F5 MEDIUM-HIGH | §3.2.septo + §3.6 + §8.16 | Post-duel cleanup gate `endedAt + rematchExpiryMs` en SOLO (préserve session pendant grace rematch) |
| **A32** | F6 MEDIUM | §3.2.octo + §3.6 + §4.7 | `client-message-router.ts:95` via `sendToPlayer` (route via whitelist A28) + toast UX ERROR côté front |
| **A33** | F7 MEDIUM | §4.3 (tableau) + §7.2 T-F2 + §12 Q7 | `_lastDrawAnnouncedHash` reste GLOBAL (clé `${turnPlayer}:${turnCount}` sans préfixe slot). 8 fields per-perspective (au lieu de 9). |
| **A34** | F8 MEDIUM | §4.3 + §4.7 + §12 Q8 | MSG_HINT `prev` lu depuis `_slots[message.player].hintContext` (intra-slot, jamais current perspective) |
| **A35** | F9 LOW | §4.6 + §5.2 | i18n keys `pvp.solo.actionRequiredP{1,2}` + `pvp.solo.switchPerspective` pour le banner A13 (FR+EN) |
| **A36** | F10 LOW | §3.1 A11 (commentaire load-bearing) | DICE_RESULT future-regression hazard : assertion `duelAssert(!session.soloMode, …)` ou commentaire `first-player-coordinator.ts:578-584` |
| **A37** | F12 LOW | §4.4 + §4.7 + §5.2 | `sendAnimationsDone` fallback : `_lastSentForPlayer ?? timerState.pendingPlayer ?? perspective()` (cas bootstrap SOLO + switch précoce) + extension `TimerStateMsg.pendingPlayer` |
| **A38** | F11 MEDIUM (gestion projet) | §9 | Estimate révisé à ~18.75j (cascade +2.65j vs A26) |

**Findings 1er passage résolus** : 17/17 amendments intégrés (A3bis
annulé et remplacé par A18).
**Findings 2e passage résolus** : 9/9 amendments intégrés.
**Findings 3e passage résolus** : 12/12 amendments intégrés (A27-A38,
A36 = commentaire défensif).
**Total findings adversariaux** : 48, **48 résolus**.
**Nouveaux risques identifiés en 3 passes et résolus** : §8.7 (duel
jamais démarré), §8.8 (session leak post-duel), §8.9 (impersonation
PvP), §8.10 (F5 SOLO ⇒ DUEL_END draw_both_disconnect), §8.11
(ANIMATIONS_DONE rejected en PvP normal), **§8.12 (rematch SOLO
dead-lock)**, **§8.13 (INACTIVITY_WARNING slot 1 perdu)**, **§8.14 (F5
mid-duel prompt slot 1 perdu)**, **§8.15 (cancel-rollback slot 1 silent
desync)**, **§8.16 (F5 post-duel SOLO empêche rematch)**.

**Décision architecturale centrale de la 3e passe — A28 routing-to-0
whitelist** : 4 findings F2/F4/F6 + le déjà-existant A19 partageaient
le même pattern "send au socket 0 avec tag de slot dans payload, en
SOLO multiplex". A28 **centralise** la doctrine dans une whitelist
`PSEUDO_PAIRWISE_SOLO_ROUTED` au cœur de `sendToPlayer` plutôt que
patcher 4 sites inline. Avantages :
- 1 seule branche `if (session.soloMode)` au lieu de 4 ;
- Ajout d'un nouveau message pseudo-pairwise = 1 ligne dans la
  whitelist, pas un nouveau patch site ;
- Symétrie avec A1 no-op-on-1 (les 2 cas — drop pur vs route — sont
  jugés dans le même `sendToPlayer`) ;
- Régression-test couvert par 1 spec dédié (T-S17) qui exerce la
  whitelist, pas N specs par site.

---

## 14. Prochaines étapes recommandées

1. ✅ **Spec patchée 3 fois** (ce doc).
2. **OPTIONNEL : 4e re-review légère** (~0.5j). Pattern de diminishing
   returns confirmé : la 3e passe a trouvé 12 findings (1 BLOCKER, 3
   HIGH) tous issus d'effets de bord du pattern multiplex sur des sites
   non énumérés dans §3.6/§4.7 ou de sous-spécification d'A8/A9. Une
   4e review trouverait probablement <2 findings LOW (interactions de
   3e ordre). **Non recommandée** — passer à l'implémentation.
3. **Recommandé** : passer à la découpe BMad
   (`bmad-create-epics-and-stories`) pour produire les stories
   d'implémentation PR1 + PR2 (estimate ~18.75j).
4. **Implementation start** : Q1 acted ⇒ on commence par PR1 (server
   additif, déployable seul, **inclut maintenant A28 refactor whitelist
   + A29 resendPendingPrompt × 2 + payload extensions A8.1/A8.2/A37**)
   ⇒ on déploie ⇒ on confirme zéro régression PvP normal ⇒ on attaque
   PR2 (multiplex complet front + server final + A27/A30/A31/A32/A33/
   A34/A35/A37 front).
5. **Acceptance** : merge bloqué tant que les 17 specs serveur + 18
   specs front + 5 scenarios Playwright (A à E) ne sont pas tous verts.
   Voir §10.

L'option A (dedup hash palliatif ~1j) reste un fallback si on a besoin
de débloquer SOLO immédiatement, mais Axel a acté qu'on prend le temps
de faire C proprement.
