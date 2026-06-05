# `ANIMATIONS_READY` — client-controlled worker spawn gate (2026-06-05)

> **Statut** : **livré** sur `feat/anim-pipeline-v2`, Direction B retenue
> après code-review de la Direction A (qui avait pivot vers SESSION_TOKEN
> et ne résolvait pas structurellement la race).
> **Origine** : investigation parité SOLO↔Replay Phase 0
> ([anim-pipeline-v4-phase-0-landed-2026-06-05](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_anim_pipeline_v4_phase_0_landed_2026_06_05.md))
> qui a révélé que le **pre-activation buffer** côté client est une rustine
> fragile, et que le bootstrap SOLO crée une race condition entre l'arrivée
> des MSG_DRAW initial et le moment où `boardActive=true`.
> **Effort réel** : ~6h dev + tests (Direction A puis pivot Direction B).

## 0. Direction B (livrée) — résumé exécutif

Le protocole gate le spawn du worker server-side sur un message
`ANIMATIONS_READY` que le client envoie quand son prefetch d'illustrations
est terminé. La chaîne circulaire identifiée à la review de Direction A
est cassée par un nouveau message serveur `EARLY_DECK_PREFETCH` qui
porte les `cardCodes` immédiatement après `SESSION_PHASE`, avant le
worker spawn. Le client peut donc démarrer son prefetch sans attendre
`BOARD_STATE` (qui n'arriverait jamais sans worker spawn, lequel attend
`ANIMATIONS_READY`).

| Étape | Émetteur | Message | Effet |
|---|---|---|---|
| 1 | server | `SESSION_TOKEN` | client `connectionStatus='connected'` |
| 2 | server | `SESSION_PHASE` | client mount discriminant |
| 3 | **server** | **`EARLY_DECK_PREFETCH`** | **client `_cardCodes` populé** |
| 4 | client (async) | (HTTP `/api/decks/{id}` + Image preloads) | `thumbnailsReady=true` |
| 5 | client | `ANIMATIONS_READY` | server `animationsReady[i]=true` |
| 6 | server | `startFirstPlayerPhase` / `startDuelWithOrder` / `FORK_RESUME` | worker spawn |
| 7 | server | `BOARD_STATE` + `MSG_DRAW × 2` | client `boardReady`, `setBoardActive(true)`, anim propre |

Le pre-activation buffer côté client est **conservé en défense en
profondeur courte** (tick-level microfenêtre Angular entre BOARD_STATE
et `setBoardActive(true)`), pas comme rustine load-bearing.

## 1. Contexte — pourquoi le pre-activation buffer existe

Aujourd'hui, le pipeline d'animation client réagit aux events serveur dès
leur arrivée (`_dispatchEvent` → `processEvent` → `pushToStream`). Le
client n'a aucun contrôle sur **quand** le worker démarre côté serveur.

### Flow PvP normal (sain par hasard)

1. 2 joueurs se connectent → `isReadyToStart(session)` true
2. `startFirstPlayerPhase(session)` → DICE_ROLL prompts envoyés
3. Humains roulent les dés + cliquent SELECT_FIRST_PLAYER (~5-10s)
4. `startDuelWithOrder(session, n)` → **worker spawn**
5. Worker emet MSG_DRAW initial × 2 + BOARD_STATE + SELECT_IDLECMD

La "pause humaine" entre l'étape 1 et 4 (~5-10s) donne au client le temps
de :
- Recevoir le `SESSION_PHASE: PRE_DUEL`
- Monter la dice arena
- Pré-fetch les illustrations (`preFetchCardImages`)
- Flipper `setBoardActive(true)` au passage `duel-loading → active`

Quand les MSG_DRAW arrivent à l'étape 5, `boardActive=true`, ils sont
processés directement → `launchInitialDraw` lance l'anim propre.

### Flow SOLO (cassé structurellement)

1. 1 joueur se connecte → `isReadyToStart(session)` true (SOLO = 1 socket)
2. **Immédiatement** → `startDuelWithOrder(session, 0)` → worker spawn
3. Worker emet MSG_DRAW initial × 2 + BOARD_STATE + SELECT_OPTION (ou autre)
4. Tape player auto-respond → MSG_CHAINING → chain démarre

Entre l'étape 1 et 4 : **quelques millisecondes**. Pas le temps pour :
- `setBoardActive(true)` (gated sur `duelLoadingReady` = boardReady + thumbnailsReady)
- Le prefetch async
- Le breathe beat 200ms du drain

→ MSG_DRAW arrivent à `boardActive=false` → **parqués dans `_preActivationBuffer`**.
Quand le drain timer fire 200ms plus tard, la chain est déjà en `resolving`
→ les events drainés tombent dans le chain buffer → wipés par
`handleEnd → reset` → **events perdus définitivement**.

### Symptômes observés
- **Test parité SOLO↔Replay** (`event-stream-parity.spec.ts` sur fixture
  18a55f97) : 3 events absents du stream SOLO (initial MSG_DRAW × 2 +
  MSG_MOVE cost Vision), self-destroy MSG_MOVE aussi perdu.
- **Flash dice arena en SOLO** : la dice arena se monte brièvement parce
  que `sessionPhase` traverse `PRE_DUEL` au connect, avant d'être supplanté
  par `DUELING` au start du worker.
- **Flash "vraies cartes pendant anim initial draw" en SOLO** : observable
  uniquement avec la rustine garde-fou drain mid-chain qui re-injecte les
  events post-`MSG_CHAIN_END`.

### Conclusion
Le pre-activation buffer est un patch qui essaie de compenser le fait que
le client ne contrôle pas le timing du serveur. Plus le client est rapide
(SOLO, tape player), plus le patch échoue.

## 2. Proposition — protocole `ANIMATIONS_READY`

Le client envoie un message `ANIMATIONS_READY` au serveur quand il a
terminé son setup visuel (prefetch + dice arena dismiss). Le serveur
gate `startDuelWithOrder` sur la réception de ce message.

### Contrat du message

**Client → Server** :
```ts
{ type: 'ANIMATIONS_READY' }
```

Pas de payload. Le serveur identifie le joueur via la WS qui l'envoie
(via `resolveLivePlayerIndex` comme tout autre client message).

**Sémantique** : "Je suis prêt à recevoir et animer des events de duel".
Émis exactement **une fois par session de duel** (par joueur en PvP, par
le seul joueur en SOLO). Idempotent côté serveur (les re-émissions sont
no-op).

### Modifications server-side

**Nouveau message `EARLY_DECK_PREFETCH` (Direction B)** :

```ts
export interface EarlyDeckPrefetchMsg {
  type: 'EARLY_DECK_PREFETCH';
  cardCodes: number[];
  bothCardCodes?: [number[], number[]]; // SOLO multiplex
}
```

Émis par `pvp-connection-handler` immédiatement après `SESSION_PHASE`
(donc avant le check `isReadyToStart` qui pourrait déclencher
`startDuelWithOrder` / `startFirstPlayerPhase` / `FORK_RESUME`). PvP
normal envoie son propre deck uniquement (no info-leak). SOLO
multiplex envoie aussi `bothCardCodes` (parité avec `DuelStartingMsg`).

```ts
// pvp-connection-handler.ts, après sendToPlayer(SESSION_PHASE)
const ownCardCodes = extractCardCodesForPlayer(session.decks, playerIndex);
const earlyPrefetchMsg = session.soloMode
  ? {
      type: 'EARLY_DECK_PREFETCH' as const,
      cardCodes: ownCardCodes,
      bothCardCodes: [
        extractCardCodesForPlayer(session.decks, 0),
        extractCardCodesForPlayer(session.decks, 1),
      ] as [number[], number[]],
    }
  : { type: 'EARLY_DECK_PREFETCH' as const, cardCodes: ownCardCodes };
sendToPlayer(session, playerIndex, earlyPrefetchMsg);
```

Cohabite avec `DECK_PREFETCH` (envoyé plus tard en PvP, post-dice,
pre-FIRST_PLAYER_RESULT). Les deux portent la même shape ; l'`EARLY`
arrive plus tôt dans la timeline. Pas de scope-creep — `DECK_PREFETCH`
n'est pas supprimé.

**Nouvelles données sur `ActiveDuelSession`** :
```ts
interface ActiveDuelSession {
  // ... existing fields ...

  /** Per-player "animations ready" flag. Reset to [false, false] on
   *  rematch via `resetSessionForRematch`. True signals the client has
   *  finished its pre-duel visual setup (dice arena dismiss + prefetch
   *  complete) and can animate the upcoming MSG_* burst.
   *  Cf. animations-ready-protocol-2026-06-05.md. */
  animationsReady: [boolean, boolean];
}
```

**Nouveau gate dans `isReadyToStart`** :
```ts
export function isReadyToStart(session: ActiveDuelSession): boolean {
  if (session.soloMode) {
    return session.players[0].connected && session.animationsReady[0];
  }
  return session.players[0].connected
      && session.players[1].connected
      && session.animationsReady[0]
      && session.animationsReady[1];
}
```

Note : le check connection reste en place — `ANIMATIONS_READY` ne peut
arriver QUE d'un socket connecté, donc c'est redondant mais cohérent.

**Nouveau handler dans `client-message-router.ts`** :
```ts
case 'ANIMATIONS_READY': {
  const idx = resolveLivePlayerIndex(session, ws);
  if (idx === null) return; // stale ws
  if (session.animationsReady[idx]) return; // idempotent
  session.animationsReady[idx] = true;
  // Re-evaluate isReadyToStart — may now trigger startDuelWithOrder /
  // startFirstPlayerPhase.
  if (isReadyToStart(session) && session.phase === 'WAITING_PLAYERS') {
    if (session.soloMode) {
      startDuelWithOrder(session, 0);
    } else {
      startFirstPlayerPhase(session);
    }
  }
  return;
}
```

**Pas de timeout fallback côté server**. Si un client ne supporte pas
`ANIMATIONS_READY`, il est rejeté à la handshake par le mécanisme
protocol version existant (close-code 4426). Cf. CLAUDE.md "Protocol
Version Mismatch (Close-code 4426)" :

> Every WS handshake validates `PROTOCOL_VERSION`. Mismatched clients
> close with 4426. The client surfaces "Client outdated, refresh" UX
> instead of an infinite reconnect loop.

**Bump `PROTOCOL_VERSION` en même temps que l'ajout de
`ANIMATIONS_READY`**. Les clients en cache navigateur d'avant le
déploiement seront fermés au connect → forcés à refresh → reçoivent
le nouveau bundle qui connaît `ANIMATIONS_READY`.

Scénarios sans timeout :
- **Client à jour qui n'envoie pas `ANIMATIONS_READY`** : impossible
  sauf bug code → fixé en dev, attrapé par spec test.
- **Client à jour qui crash avant d'émettre** : la WS se ferme →
  grace period habituelle se déclenche (`isFullyDisconnected` true) →
  pas besoin d'une logique séparée.
- **Vieux client en cache** : rejeté par 4426 au handshake.

Le timeout serait un signal "5s suffisent" qui crée une attente UX
implicite — préférable de laisser le client maître de son timing
(prefetch lent sur 3G ? Le user attend, c'est l'expérience honnête).

### Modifications client-side

**Émetteur (Direction B livrée)** : `DuelLoadingEffectsService`. L'émission
est gated sur deux signaux :
- `thumbnailsReady === true` (prefetch fini)
- `wsService.connectionStatus() === 'connected'` (post-SESSION_TOKEN)

```ts
effect(() => {
  const ready = config.thumbnailsReady();
  const status = this.wsService.connectionStatus();
  if (!ready || status !== 'connected') return;
  untracked(() => {
    if (this._animationsReadySent) return;
    this._animationsReadySent = true;
    this.wsService.sendAnimationsReady();
  });
});
```

**Idempotence client-side** : le flag `_animationsReadySent` bloque une
ré-émission pour la même session. Le rematch effect (voir §rematch
plus bas) le reset.

**Idempotence server-side** : `client-message-router.ts case
'ANIMATIONS_READY'` retourne tôt si `session.animationsReady[i]` est
déjà true. Un re-envoi sur reconnect est logué + ignoré sans effet
secondaire.

**Comment le deadlock est cassé** : le serveur émet
`EARLY_DECK_PREFETCH` immédiatement après `SESSION_PHASE`, ce qui
peuple `cardCodes` côté client. Le `DuelLoadingEffectsService` a un
effet sur `cardCodes()` non-empty qui démarre `preFetchCardImages` —
PAS gaté sur `roomState === 'duel-loading'` (qui dépendrait de
`boardReady`, qui dépend du worker spawn, qui dépend de
`ANIMATIONS_READY`).

**Mode-spécifique** :

| Mode | Tag `forPlayer` |
|---|---|
| PvP normal | omis (A2 strict — la présence est rejetée comme impersonation attempt) |
| SOLO multiplex | `0` (cf. `DuelWebSocketService.sendAnimationsReady`) |
| Fork-solo | `0` (idem SOLO) |

**Rematch** : `resetSessionForRematch` côté serveur reset
`animationsReady=[false,false]`. Le client doit donc ré-émettre. Un
effet additionnel dans le service réagit à `wsService.rematchStarting()` :
- reset `_animationsReadySent=false`
- reset `prefetchStarted=false`
- reset `thumbnailsReady=false` (les cardCodes restent set —
  `_cardCodes` ne s'efface pas, donc le prefetch effect se ré-trigger
  tout de suite, flip `thumbnailsReady=true`, et l'émission ré-fire)

**Sécurité** : émettre `ANIMATIONS_READY` avant la fin de la dice arena
n'est pas un problème en PvP. Le worker ne spawn pas tant que :
- Les 2 joueurs ont émis `ANIMATIONS_READY` ET
- Le flow `first-player-coordinator` est complet (DICE_ROLL + SELECT_FIRST_PLAYER
  résolus par les humains ou les timeouts du coordinator).

Donc l'anim initial draw ne peut pas démarrer pendant que la dice arena
tourne — le pipeline d'animation ne reçoit rien tant que le worker n'a
pas spawned.

**Tape player (SOLO multiplex)** : le `SoloDuelOrchestratorService.init`
runs à la duel-page bootstrap (avant le 1er BOARD_STATE). Le tape
player s'arme côté serveur (auto-response sur slot 1 réservé) à
travers la chaîne `worker-message-router → broadcastMessage`. Comme
le worker n'est pas encore spawned (gated sur `ANIMATIONS_READY`), il
n'y a **rien à répondre** côté tape player tant que le client n'a pas
émis. Une fois le worker spawned, le tape player auto-respond au
premier SELECT_OPTION qui sort du worker — pas de race condition
possible parce que les messages worker → routing → tape player → WS
sont tous séquentiels au sein du process serveur.

**Pre-activation buffer côté client — conservé** (révision 2026-06-05,
cf. §5 décision 3 ci-dessous) :

Le buffer reste en place et garde tous ses sites consommateurs
(`_preActivationBuffer`, `drainPreActivationBuffer`,
`bufferPreActivationForTesting`, `isPreActivationBufferActive`,
`preActivationBufferSnapshot`, `preActivationBufferLength`,
`_dispatchEvent` divert branch, `clearTimersAndPolling` wipe, l'effet
`duel-loading → active` avec `phaseService.show('DRAW', ...)` +
`drainPreActivationBuffer()`, `duel-debug.service.ts` accessors).

Le commentaire du `_preActivationBuffer` dans
`animation-orchestrator.service.ts` est amendé pour refléter le
nouveau rationale : "défense en profondeur courte" au lieu de "rustine
initial draw breathe beat".

À adapter (additif uniquement, pas de suppression) :
- `DuelLoadingEffectsService.initEffects` : **ajouter** l'effet
  `thumbnailsReady→ANIMATIONS_READY` avec flag local
  `_animationsReadySent` pour idempotence. **Conserver** l'effet
  `duel-loading → active` existant.

### Flux post-restructure

**PvP normal** :
1. 2 joueurs connect → `isReadyToStart` false (animationsReady = [false, false])
2. Pour chaque joueur : `SESSION_PHASE: PRE_DUEL` envoyé → dice arena mount client
3. Chaque client : `preFetchCardImages` async → `thumbnailsReady=true`
4. Chaque client : envoie `ANIMATIONS_READY` → `session.animationsReady[i] = true`
5. Quand les 2 sont true → `isReadyToStart` true → `startFirstPlayerPhase`
6. DICE_ROLL prompts → humains cliquent
7. SELECT_FIRST_PLAYER → `startDuelWithOrder` → worker spawn
8. Worker emet MSG_DRAW initial × 2 + BOARD_STATE
9. Client reçoit → `boardActive=true` → anim propre

**SOLO multiplex** :
1. 1 joueur connect → `isReadyToStart` false (animationsReady[0] = false)
2. `SESSION_PHASE: DUELING` envoyé (shortcut SOLO, cf. spec actuelle ligne 22)
3. Client monte le skeleton (cf. `showBoardSkeleton`)
4. `preFetchCardImages` async → `thumbnailsReady=true`
5. Client envoie `ANIMATIONS_READY` → `session.animationsReady[0] = true`
6. `isReadyToStart` true → `startDuelWithOrder(session, 0)` → worker spawn
7. Worker emet MSG_DRAW initial × 2 + BOARD_STATE + SELECT_OPTION
8. Tape player auto-respond → MSG_CHAINING etc.
9. Client reçoit → `boardActive=true` → anim propre, chain joue ensuite

**Fork-solo** : identique au SOLO multiplex (un seul socket, déclenche
`FORK_RESUME` au lieu de `startDuelWithOrder` quand prêt).

**Replay** : aucun changement (pas concerné par le worker spawn — le
précompute est déjà fait avant que le client n'ouvre la replay viewer).

## 3. Backward compatibility

**Bump `PROTOCOL_VERSION`** dans `ws-protocol-shared.ts` au même commit
que l'ajout de `ANIMATIONS_READY`. Les clients en cache navigateur
d'avant le déploiement seront fermés au handshake avec close-code 4426 →
forced refresh → reçoivent le nouveau bundle.

Le mécanisme existant (`checkProtocolVersion` dans
`pvp-connection-handler.ts`, surface UX côté client dans chaque
`onclose` handler) couvre ce cas par construction. Pas besoin d'un
timeout fallback côté server.

### Known limitation — rematch pendant transition de version

Un utilisateur en duel **actif** au moment du déploiement garde une
connexion WS ouverte avec le bundle pré-déploiement. Tant que la WS
reste ouverte, son bundle ne sait pas émettre `ANIMATIONS_READY`. Si
ce duel se termine et que l'utilisateur clique "rematch" :
- `resetSessionForRematch` re-init `animationsReady: [false, false]`
- Le serveur attend `ANIMATIONS_READY` des 2 joueurs
- Le bundle vieux ne sait pas émettre → la session reste bloquée à
  `WAITING_PLAYERS` jusqu'à ce que la WS se ferme (timeout client,
  refresh manuel, ou fermeture d'onglet)

**Mitigation acceptée** : pas de logique serveur spécifique. La
prochaine reconnexion (après refresh manuel ou fermeture) est rejetée
par 4426 → forced refresh → bundle à jour. Le rematch suivant fonctionne.

**Trade-off** : un user vit un rematch raté en transition de
déploiement. Fenêtre étroite (durée de session active × fréquence de
déploiement), pas de data loss, le user reprend après refresh.

Si on voulait fermer cette fenêtre, il faudrait soit (a) fermer toutes
les WS actives au déploiement (interruption visible pour les duels en
cours), soit (b) ajouter un timeout fallback côté server qui re-enable
le vieux comportement (ce que §5 décision 2 a explicitement écarté).
Les deux remèdes sont pires que la maladie.

## 4. Plan de test

### Specs server

| Fichier | Tests à ajouter | Pinning |
|---|---|---|
| `lifecycle-helpers.spec.ts` | `isReadyToStart` retourne false tant que `animationsReady` false | Le gate fonctionne |
| `lifecycle-helpers.spec.ts` | `isReadyToStart` true quand connect+ready (SOLO) ou connect+ready×2 (PvP) | Cas nominal |
| `client-message-router.spec.ts` (nouveau ou existant) | `ANIMATIONS_READY` flip le flag + re-evaluate start | Handler correct |
| `client-message-router.spec.ts` | `ANIMATIONS_READY` idempotent (2× appels = pas de re-spawn) | Idempotence |
| `client-message-router.spec.ts` | `ANIMATIONS_READY` ignoré si stale ws (resolveLivePlayerIndex null) | Robustesse |
| `protocol-version-check.spec.ts` (existant) | Bump `PROTOCOL_VERSION` quand on ajoute `ANIMATIONS_READY` — vieux clients close 4426 | Backward compat |
| `session-factory.spec.ts` | `createInitialSessionState` init `animationsReady: [false, false]` | Init |
| `session-factory.spec.ts` | `resetSessionForRematch` reset `animationsReady: [false, false]` | Rematch |

### Specs client

| Fichier | Tests à ajouter | Pinning |
|---|---|---|
| `duel-loading-effects.service.spec.ts` | Émet `ANIMATIONS_READY` quand `thumbnailsReady` flippe true | Trigger |
| `duel-loading-effects.service.spec.ts` | N'émet PAS 2× si flag déjà set (idempotent côté client) | Idempotence |
| `animation-orchestrator.projections.spec.ts` (existant) | Pre-activation buffer conservé — méthodes inchangées | Garde-fou contre la suppression accidentelle du buffer pendant un refactor futur |

### Tests e2e

| Test | Validation |
|---|---|
| `event-stream-parity.spec.ts` (fixture 18a55f97) | Stream SOLO = Stream Replay (modulo boundary strip) — **doit passer** |
| Test manuel SOLO bootstrap | Pas de flash dice arena, skeleton visible, anim initial draw propre, pas de "vraies cartes apparaissent dessous" |
| Test manuel PvP normal bootstrap | Comportement inchangé (dice → first player → board → anim) |
| Test manuel reconnect mid-duel | Bootstrap saute à DUELING direct (pas de `ANIMATIONS_READY` à attendre — la session est déjà en DUELING) |

**Note CI parity harness** : `capture-solo-stream.ts` n'a pas besoin
de modification fonctionnelle (le client front émet `ANIMATIONS_READY`
naturellement via le flow `thumbnailsReady=true`). **Mais** le délai
total bootstrap SOLO augmente du temps prefetch (qui dépend de la
taille du deck + de la latence asset CDN/Spring). En CI, le prefetch
peut être plus lent (cold cache, throttling). Vérifier que le timeout
global du harness laisse au moins **+2s de marge** par rapport au
temps de bootstrap observé en local. Si CI flake : monter le timeout
plutôt que rusher le prefetch (qui est délibérément asynchrone).

## 5. Décisions figées (revue 2026-06-05)

1. **Émission `ANIMATIONS_READY` PvP + SOLO** : sur `thumbnailsReady=true`
   seul, sans gating supplémentaire. Cohérent entre les 2 modes.
   - Justification PvP : le worker ne spawn pas avant que les 2 humains
     aient résolu le flow dice (DICE_ROLL prompts + SELECT_FIRST_PLAYER,
     ou les timeouts de `first-player-coordinator`). Émettre
     `ANIMATIONS_READY` au moment du prefetch fini ne déclenche pas
     prématurément l'anim initial draw — il n'y a rien à animer tant
     que le worker n'a pas spawned.
   - Justification SOLO : pas de dice arena, le worker peut spawn dès
     que le client est prêt visuellement.

2. **~~Timeout fallback~~** : abandonné. Backward compat via bump
   `PROTOCOL_VERSION` (close-code 4426).

3. **Pre-activation buffer** : **conservé en mode défense en profondeur
   courte** (révision 2026-06-05 lors de l'implémentation — Winston/Amelia).
   La version initiale de la spec disait "suppression complète" en
   considérant le buffer comme code mort par construction post-
   restructure. Mais l'audit code montre que le BOARD_STATE et les
   MSG_DRAW peuvent arriver dans le même batch WS (Node + ws lib
   délivrent les frames TCP-groupées dans le même tick), tandis que
   `setBoardActive(true)` est flipé par un effet Angular dans le **tick
   suivant**. Le buffer absorbe cette fenêtre microtask.
   - **Avant `ANIMATIONS_READY`** : le buffer était load-bearing en
     SOLO (fenêtre large = durée du prefetch ~5-10s).
   - **Après `ANIMATIONS_READY`** : le buffer est défensif, fenêtre
     réduite à 1-2 ticks Angular (~ms).
   - Le code (`_preActivationBuffer`, `drainPreActivationBuffer`,
     `bufferPreActivationForTesting`, `isPreActivationBufferActive`,
     `_dispatchEvent` divert branch) reste en place. Le commentaire
     du `_preActivationBuffer` est amendé pour refléter le nouveau
     rationale "défense en profondeur courte" au lieu de "rustine
     initial draw breathe beat".
   - `CLAUDE.md` section "Pre-activation Buffer" est amendée en
     conséquence.

4. **Reconnect mid-duel** : la session est déjà en `phase === 'DUELING'`,
   donc `isReadyToStart` ne re-evalue pas `startDuelWithOrder` (il check
   `phase === 'WAITING_PLAYERS'`). Pas de besoin de re-émettre
   `ANIMATIONS_READY` sur reconnect. À pinner dans un test : un client
   qui reconnect ne déclenche pas un nouveau worker spawn.

5. **Worker `INIT_DUEL` order** : OK. Le client maîtrise son timing
   (prefetch lent = client attend). Un client qui n'émet pas
   `ANIMATIONS_READY` est rejeté au handshake par 4426.

6. **Tape player parity test** : aucune modif nécessaire dans
   `capture-solo-stream.ts`. Le client front Angular émet
   `ANIMATIONS_READY` naturellement via le flow `thumbnailsReady=true`.

## 6. Migration

1. Implémenter server-side : ajout du gate dans `isReadyToStart` +
   handler `ANIMATIONS_READY` dans `client-message-router.ts` + init
   `animationsReady: [false, false]` dans `createInitialSessionState`
   et `resetSessionForRematch`. **Pas de timeout fallback** (cf. §5
   décision 2).
2. Implémenter client-side : émission depuis `DuelLoadingEffectsService`
   sur `thumbnailsReady=true` + suppression du pre-activation buffer
   complet (cf. §5 décision 3) + amendement `CLAUDE.md` "Pre-activation
   Buffer (initial draw breathe beat)" → suppression de la section.
3. **Déploiement atomique** : server + client + bump `PROTOCOL_VERSION`
   doivent partir ensemble (pas server-first rétrocompatible). Sans le
   bump, les vieux clients en cache navigateur (qui n'émettent pas
   `ANIMATIONS_READY`) bloqueraient leurs sessions au "waiting_players"
   indéfiniment côté serveur. AVEC le bump, ils sont rejetés au
   handshake (close-code 4426) → forced refresh → reçoivent le nouveau
   bundle qui sait émettre `ANIMATIONS_READY`. Le couplage atomique
   est ce qui rend le retrait du timeout fallback safe.
4. Pas de monitoring `ANIMATIONS_READY_TIMEOUT` (il n'y a pas de
   timeout). Le monitoring utile post-déploiement est :
   - `protocolMismatchCount` (déjà exposé via `/status`) : pic
     attendu au déploiement, qui décroît en quelques minutes au fur et
     à mesure que les bundles en cache se refresh.
   - Log côté server `ANIMATIONS_READY received from player X` (au
     niveau debug) : pour confirmer en prod que les clients émettent
     bien le message.

## 7. Liens

- Memory parent : [[anim-pipeline-v4-phase-0-landed-2026-06-05]]
- Spec parité : [pvp-replay-event-stream-parity-spec-2026-06-05.md](pvp-replay-event-stream-parity-spec-2026-06-05.md)
- CLAUDE.md "Pre-activation Buffer (initial draw breathe beat)" :
  section à mettre à jour / supprimer post-restructure.
- CLAUDE.md "Modes — vue d'ensemble" : le SOLO multiplex shortcut
  `derivePhase` reste en place (gating le flash dice).
