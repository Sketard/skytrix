# Analyse des faiblesses du mode PVP — 2026-03-16

Audit complet du mode PVP (duel-server, frontend Angular, backend Spring Boot).
Classement par criticité : **CRITIQUE** > **MAJEUR** > **MODERE** > **MINEUR**.

---

## 1. SECURITE & ANTI-TRICHE

### 1.1 [CRITIQUE] Pas de validation serveur des réponses joueur

**Fichier :** `duel-server/src/server.ts:1139-1172`

Le serveur vérifie seulement que `awaitingResponse[playerIndex]` est true et que le `promptType` correspond (M28), puis transmet directement la réponse au worker OCGCore **sans valider le contenu** (`msg.data`).

```typescript
// server.ts:1166-1172
session.worker.postMessage({
  type: 'PLAYER_RESPONSE',
  playerIndex,
  promptType: msg.promptType,
  data: msg.data,  // ← aucune validation du contenu
});
```

**Risque :** Un client malveillant peut envoyer des indices hors limites, des données mal formées, ou tenter de crasher le worker OCGCore. Bien que OCGCore rejette les réponses invalides (RETRY), certains payloads malformés pourraient causer un crash du worker thread (watchdog timeout → forfait).

**Recommandation :** Ajouter une couche de validation par promptType dans `handleClientMessage` :
- `SELECT_CARD` : vérifier que `indices` est un tableau d'entiers dans `[0, cards.length)`, taille entre `min` et `max`
- `SELECT_PLACE` : vérifier que `places` correspond aux options envoyées
- `SELECT_OPTION` : vérifier que `index` est dans la plage des options
- etc.

### 1.2 [MAJEUR] Clé API interne en dur dans le code

**Fichier :** `duel-server/src/server.ts:88`

```typescript
const expected = process.env['INTERNAL_API_KEY'] || 'dev-internal-key';
```

En l'absence de variable d'environnement, la clé par défaut `dev-internal-key` est utilisée. Si le serveur est déployé sans configurer `INTERNAL_API_KEY`, n'importe qui peut appeler les endpoints internes (`/api/duels`, `DELETE /api/duels/:id`, `/api/update-data`).

**Recommandation :** Refuser de démarrer si `INTERNAL_API_KEY` n'est pas défini en production. Logger un warning en dev.

### 1.3 [MODERE] Rate limiting absent sur les WebSocket

**Fichier :** `duel-server/src/server.ts:1024-1034`

Aucun rate limiting sur les messages WebSocket entrants. Un client peut spammer des `PLAYER_RESPONSE`, `ACTIVITY_PING`, ou `REQUEST_STATE_SYNC` en boucle. `REQUEST_STATE_SYNC` a un rate limit de 5s (`STATE_SYNC_RATE_LIMIT_MS`), mais les autres messages n'en ont aucun.

**Recommandation :** Ajouter un rate limiter global par connexion (ex: max 20 messages/seconde). Couper la connexion en cas de dépassement.

### 1.4 [MODERE] Le MAX_PAYLOAD_SIZE n'est appliqué qu'en HTTP

**Fichier :** `duel-server/src/types.ts:8` et `server.ts:879`

Le WebSocketServer utilise `maxPayload: MAX_PAYLOAD_SIZE` (4096 bytes), ce qui est correct. Cependant, le `JSON.parse` côté client ne vérifie pas la taille du message. Un serveur compromis ou un MITM pourrait envoyer des payloads volumineux au client.

**Impact limité** (le serveur est de confiance), mais à noter pour la robustesse.

---

## 2. STABILITE & RESILIENCE

### 2.1 [CRITIQUE] Worker thread peut rester bloqué sans nettoyage

**Fichier :** `duel-server/src/duel-worker.ts:802-806`

Le watchdog timer dans `runDuelLoop()` appelle `process.exit(1)` en cas de timeout :

```typescript
const watchdog = setTimeout(() => {
  port.postMessage({ type: 'WORKER_ERROR', duelId, error: 'Watchdog timeout (30s)' });
  cleanup();
  process.exit(1);  // ← arrêt brutal du worker
}, WATCHDOG_TIMEOUT_MS);
```

Cela termine le worker thread, mais si `duelProcess` bloque indéfiniment dans le WASM, `process.exit(1)` dans un worker thread ne libère pas nécessairement les ressources WASM (memory leak potentiel dans le processus parent).

**Recommandation :** Utiliser `worker.terminate()` côté main thread avec un timeout, plutôt que `process.exit(1)` dans le worker.

### 2.2 [MAJEUR] Préservation 4 heures des sessions déconnectées

**Fichier :** `duel-server/src/types.ts:17`

```typescript
export const BOTH_DISCONNECTED_CLEANUP_MS = 4 * 60 * 60 * 1000; // 4 hours
```

Quand les deux joueurs se déconnectent, le worker thread est conservé pendant **4 heures**. Si plusieurs duels sont abandonnés, les workers s'accumulent et consomment de la mémoire (chaque worker charge OCGCore WASM + SQLite + scripts Lua).

**Recommandation :** Réduire à 30-60 minutes. Ou terminer le worker immédiatement et stocker uniquement le résultat du duel (déjà fait via `storedDuelResult`).

### 2.3 [MAJEUR] Pas de limite sur le nombre de duels actifs

**Fichier :** `duel-server/src/server.ts:324`

```typescript
activeDuels.set(duelId, session);
```

Aucune vérification du nombre de duels actifs. Chaque duel spawne un worker thread avec OCGCore WASM. Sans limite, un attaquant ou un pic de charge peut épuiser la mémoire/CPU.

**Recommandation :** Ajouter un `MAX_CONCURRENT_DUELS` (ex: 50 comme mentionné dans NFR3). Retourner 503 si la limite est atteinte.

### 2.4 [MODERE] LP tracking redondant et sujet à la dérive

**Fichier :** `duel-worker.ts:56,519-530,722`

Le worker maintient manuellement `lp[0]` et `lp[1]` via `updateState()`, avec un TODO à la ligne 721 :

```typescript
// TODO: Read LP from fieldState if available (fp.lp) to avoid manual tracking drift
return { lp: lp[controller], ... };
```

Si un message LP est manqué (edge case OCGCore), le LP affiché diverge de l'état réel.

**Recommandation :** Utiliser `fieldState.players[controller].lp` (si disponible dans `duelQueryField`) au lieu du tracking manuel.

---

## 3. PERFORMANCE

### 3.1 [MAJEUR] BOARD_STATE fait des dizaines de queries individuelles

**Fichier :** `duel-worker.ts:538-729`

`buildBoardState()` appelle `queryFlag()` individuellement pour chaque flag (CODE, POSITION, OVERLAY, COUNTERS, ATK, DEF, etc.) **par carte, par zone**. Pour un board avec 10 monstres face-up, cela fait ~16 queries × 10 = **160 appels WASM** par BOARD_STATE.

Commentaire dans le code :
```typescript
// WASM bug workaround: combining multiple OcgQueryFlags in a single query
// returns null/corrupt data. Query each flag individually and merge results.
```

**Impact :** Latence accrue sur chaque BOARD_STATE (émis après chaque prompt). Probablement acceptable en pratique (<50ms) mais sous-optimal.

**Recommandation :** Tester périodiquement si le bug `@n1xx1/ocgcore-wasm` a été corrigé. Sinon, envisager de batch les queries au minimum (ex: CODE|POSITION dans un seul appel, ATK|DEF dans un autre).

### 3.2 [MODERE] Timer tick toutes les 250ms envoie des messages à tous les clients

**Fichier :** `duel-server/src/server.ts:629-656`

Le `setInterval` du timer tourne toutes les 250ms et envoie un `TIMER_STATE` aux deux clients **à chaque tick**, même si la valeur n'a changé que de 250ms.

**Impact :** ~8 messages/seconde par duel, soit ~16 messages/seconde (2 clients). Pour 50 duels = 800 messages/seconde juste pour les timers.

**Recommandation :** Envoyer le TIMER_STATE seulement toutes les secondes (ou quand le changement > 1s). Le client peut interpoler localement.

### 3.3 [MODERE] Polling du lobby toutes les 10 secondes

**Fichier :** `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts:69`

```typescript
interval(10000).pipe(
  switchMap(() => this.roomApi.getRooms().pipe(...)),
)
```

Polling HTTP toutes les 10s n'est pas scalable. Si 100 utilisateurs regardent le lobby = 10 requêtes/seconde au backend.

**Recommandation :** Envisager Server-Sent Events (SSE) ou WebSocket pour les mises à jour du lobby.

---

## 4. ARCHITECTURE & MAINTENABILITE

### 4.1 [MAJEUR] Duplication du protocole WebSocket (ws-protocol.ts / duel-ws.types.ts)

Les types du protocole sont dupliqués manuellement :
- `duel-server/src/ws-protocol.ts` (backend)
- `front/src/app/pages/pvp/duel-ws.types.ts` (frontend, 714 lignes)

**Risque :** Toute modification du protocole doit être répétée dans les deux fichiers. Un oubli cause des bugs silencieux (message mal typé, champ manquant).

**Recommandation :** Extraire les types dans un package partagé (monorepo ou package npm privé). Ou générer les types depuis une source unique (JSON Schema, Protocol Buffers).

### 4.2 [MAJEUR] server.ts est un fichier monolithique de 1285 lignes

**Fichier :** `duel-server/src/server.ts`

Ce fichier contient :
- Configuration
- HTTP request handling
- WebSocket connection management
- Worker lifecycle management
- Timer logic (turn timer, inactivity)
- Grace period / reconnection
- Rematch logic
- Broadcast / message routing
- Heartbeat
- Shutdown

**Recommandation :** Séparer en modules : `http-handler.ts`, `ws-handler.ts`, `timer-manager.ts`, `session-manager.ts`, `rematch-manager.ts`.

### 4.3 [MODERE] Console.log de debug omniprésents en production

**Fichiers :** `duel-worker.ts` et `duel-connection.ts`

De nombreux `console.log` avec prefix `[DBG:...]`, `[WORKER]`, `[MSG_HINT]` sont présents :

```typescript
console.log('[DBG:CONN] MSG_CHAIN_SOLVING chainIndex=%d | links=%o', ...);
console.log('[WORKER][MSG] %s raw=%o', ...);
console.log('[DBG:BADGE] applyChainSolved idx=%d → remaining links=%o', ...);
```

**Recommandation :** Utiliser un logger avec des niveaux (debug/info/warn/error) et désactiver le niveau debug en production.

---

## 5. FONCTIONNALITES MANQUANTES / INCOMPLETES

### 5.1 [MAJEUR] Pas de validation TCG banlist

**PRD FR2 :** « deck validation before room entry: TCG format, TCG banlist compliance »

**Fichier :** `back/src/main/java/com/skytrix/service/RoomService.java:223-252`

La validation du deck vérifie seulement :
- Le deck existe et appartient à l'utilisateur
- Taille main deck (40-60), extra deck (0-15), side deck (0-15)
- Les passcodes existent dans la base de données

**Il n'y a pas de vérification de la banlist TCG** (cartes interdites, limitées, semi-limitées). Un joueur peut utiliser 3 exemplaires d'une carte limitée à 1, ou des cartes bannies.

**Recommandation :** Ajouter la validation banlist dans `validateDeck()`.

### 5.2 [MAJEUR] Pas de système de matchmaking automatique

Le PRD mentionne « Matchmaking finds an opponent within 30 seconds ». Actuellement, le système est basé sur des rooms manuelles (créer/rejoindre). Il n'y a pas de file d'attente automatique type « Quick Match ».

**Recommandation :** Phase 2 — Ajouter un endpoint "Quick Match" qui place le joueur dans une file d'attente et crée une room automatiquement quand un adversaire est trouvé.

### 5.3 [MODERE] Rematch ne swape pas les decks/positions

**Fichier :** `duel-server/src/server.ts:421-461`

```typescript
worker.postMessage({
  type: 'INIT_DUEL',
  duelId: session.duelId,
  decks: session.decks,  // ← mêmes positions
  skipRps: session.skipRps,
});
```

Le rematch relance le duel avec les mêmes decks dans les mêmes positions. Le joueur 0 a toujours le même avantage/désavantage qu'au premier duel.

**Recommandation :** Swapper l'ordre des decks au rematch, ou relancer le RPS.

### 5.4 [MODERE] SORT_CARD et SORT_CHAIN auto-répondus côté client

**Fichier :** `front/src/app/pages/pvp/duel-page/duel-connection.ts:350-351`

```typescript
private autoSelectSort(message: SortCardMsg | SortChainMsg): void {
  this.sendResponse(message.type, { order: null });
}
```

Les prompts de tri (ex: choisir l'ordre des effets trigger simultanés en SEGOC) sont automatiquement répondus avec `null` (ordre par défaut). Le joueur n'a **aucun contrôle** sur l'ordre.

**Recommandation :** Implémenter un dialog de tri (drag & drop ou numérotation).

### 5.5 [MODERE] ANNOUNCE_CARD auto-répondu avec la première valeur

**Fichier :** `duel-connection.ts:371-374`

```typescript
private autoSelectAnnounceCard(message: AnnounceCardMsg): void {
  const value = message.opcodes.length > 0 ? message.opcodes[0] : 0;
  this.sendResponse(message.type, { value });
}
```

Le prompt "Annoncer un nom de carte" (ex: Prohibition, D.D. Designator) est auto-répondu avec le premier opcode. Le joueur ne peut pas choisir quelle carte annoncer.

**Recommandation :** Implémenter un dialog de recherche de carte (texte libre avec auto-complete).

### 5.6 [MINEUR] Pas de side decking entre les matchs du rematch

Le side deck existe dans la validation mais n'est jamais utilisé en PVP. En tournoi officiel Yu-Gi-Oh!, les joueurs échangent des cartes entre le main deck et le side deck entre les matchs d'un même round.

---

## 6. UX / FRONTEND

### 6.1 [MAJEUR] Pas d'indication sonore

Aucun son dans le mode PVP : pas de notification quand c'est le tour du joueur, pas de son pour les attaques, les activations, ou la fin du duel. Sur un second écran ou un onglet en arrière-plan, le joueur ne sait pas quand c'est son tour.

**Recommandation :** Ajouter au minimum un son de notification quand un prompt apparaît (c'est au tour du joueur d'agir).

### 6.2 [MODERE] Pas de gestion mobile explicite

Le PRD mentionne le support mobile avec verrouillage en paysage, mais aucun code spécifique au responsive/mobile n'a été identifié dans les composants PVP.

### 6.3 [MODERE] Messages d'erreur en français hardcodés

**Fichier :** `lobby-page.component.ts:60-63`

```typescript
displayError(this.snackBar, 'Echec du rafraichissement');
this.error.set('Impossible de charger les rooms');
```

Les messages sont en français hardcodé, pas via `ngx-translate`. Incohérent si le reste de l'app est internationalisé.

### 6.4 [MINEUR] Pas de replay / historique des duels

Le PRD Phase 2 mentionne un système de replay, mais aucune infrastructure (sauvegarde des messages, etc.) n'est en place. Cela rend le debugging des problèmes en production difficile.

---

## 7. RESUME PAR PRIORITE

| # | Criticité | Faiblesse | Effort estimé |
|---|-----------|-----------|---------------|
| 1.1 | CRITIQUE | Pas de validation des réponses joueur (data) | Moyen |
| 2.1 | CRITIQUE | Worker thread bloqué → process.exit dans worker | Faible |
| 5.1 | MAJEUR | Pas de validation banlist TCG | Moyen |
| 1.2 | MAJEUR | Clé API interne en dur | Faible |
| 2.2 | MAJEUR | Préservation 4h des workers abandonnés | Faible |
| 2.3 | MAJEUR | Pas de limite de duels concurrents | Faible |
| 4.1 | MAJEUR | Duplication types protocole WS | Moyen |
| 4.2 | MAJEUR | server.ts monolithique (1285 lignes) | Élevé |
| 5.2 | MAJEUR | Pas de matchmaking automatique | Élevé |
| 6.1 | MAJEUR | Pas de sons / notifications | Moyen |
| 3.1 | MAJEUR | Queries WASM individuelles (buildBoardState) | Faible* |
| 1.3 | MODERE | Rate limiting WS absent | Faible |
| 2.4 | MODERE | LP tracking manuel sujet à dérive | Faible |
| 3.2 | MODERE | Timer tick 250ms → messages excessifs | Faible |
| 3.3 | MODERE | Polling lobby 10s | Moyen |
| 4.3 | MODERE | Console.log debug en production | Faible |
| 5.3 | MODERE | Rematch sans swap positions | Faible |
| 5.4 | MODERE | SORT_CARD/SORT_CHAIN auto-répondus | Moyen |
| 5.5 | MODERE | ANNOUNCE_CARD auto-répondu | Moyen |
| 6.2 | MODERE | Pas de gestion mobile | Élevé |
| 6.3 | MODERE | Messages français hardcodés | Faible |
| 5.6 | MINEUR | Pas de side decking | Moyen |
| 6.4 | MINEUR | Pas de replay / historique | Élevé |

*\* Faible si le bug WASM est corrigé dans une nouvelle version de `@n1xx1/ocgcore-wasm`*

---

## 8. QUICK WINS RECOMMANDES (Top 5)

1. **Validation des réponses joueur** (1.1) — Ajouter des guards par promptType dans `handleClientMessage`. Empêche les crashes worker et les inputs malformés.

2. **Limite de duels concurrents** (2.3) — `if (activeDuels.size >= MAX_CONCURRENT_DUELS) return 503`. Une ligne de code.

3. **Réduire la préservation à 30 min + terminer le worker** (2.2) — Le `storedDuelResult` suffit pour la reconnexion. Pas besoin de garder le worker.

4. **Clé API obligatoire en production** (1.2) — `if (!process.env['INTERNAL_API_KEY']) throw new Error('...')`.

5. **Rate limiting WebSocket** (1.3) — Compteur par connexion, reset toutes les secondes. Déconnexion à 30 msg/s.
