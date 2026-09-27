# Phase γ + β.3 cas #12 — Post-Review Findings

**Date** : 2026-05-28
**Auteur** : Adversarial review (2 sub-agents) + investigation chirurgicale Axel + Claude
**Statut** : Constat seulement (pas de spec de fix)
**Périmètre** : 14 commits de `feat/anim-pipeline-v2` (γ commits 1-8 + β.3 cas #12 commits 1.1-1.4 + 0bis + R8 + R9 + 116438d0)
**Fixes déjà livrés** : `dcf3330f` chore(anim-v2): γ + β.3 cas #12 — post-review cleanup (6 findings — M6, L1, L2, M4, M7, H5)

---

## Vue d'ensemble — 23 findings restants

29 findings issus de la review adversariale. 6 mécaniques shippés en `dcf3330f`. **23 restent**, regroupés en 4 clusters par cause racine :

| Cluster | # findings | Sévérité max | Statut |
|---|---|---|---|
| **C1 — Double-push 2-sockets → 1-processor en SOLO γ** | 6 (B2 + H1 + H3 + H4 + M12 + memo pré-existant) | BLOCKER | non triagé |
| **C2 — Surface de reset PERSPECTIVE incomplète au rematch** | 2 (B1 + H2) | BLOCKER | non triagé |
| **C3 — Cas #12 (xyz-leave) edge cases non couverts** | 6 (B3 + M1 + M2 + H7 + M13 + L5) | BLOCKER | non triagé |
| **C4 — Findings isolés (sans cause racine commune)** | 9 (H6 + M3 + M5 + M8 + M9 + M10 + M11 + L3 + L4 + L6) | HIGH | non triagé |

**Note** : C1 est probablement le BUG-MÈRE qui chapeaute les 2 symptômes pré-existants du memo `pvp-solo-chain-state-hygiene-2026-05-23` (Lock safety timeout HAND-0/GY-0 + POLL-DROP REGRESSION). γ n'a pas résolu le bug solo — il a **déplacé** la classe de bug du "switchPerspective route vers mauvais processor" vers "2 sockets pushent simultanément dans le même processor".

---

## Cluster C1 — Double-push 2-sockets → 1-processor en SOLO γ

### Diagnostic chirurgical

#### Côté serveur — broadcast per-player

[duel-server/src/worker-message-router.ts:280-291](duel-server/src/worker-message-router.ts#L280-L291) — pour CHAQUE message émis par le worker OCGCore :

```ts
for (const playerIndex of [0, 1] as const) {
  const filtered = filterMessage(message, playerIndex);
  if (filtered) {
    send(session, playerIndex, filtered);
  }
}
```

Et [duel-server/src/server.ts:688](duel-server/src/server.ts#L688) — `sendToPlayer` :

```ts
safeSend(session.players[playerIndex].ws, message);
```

→ **Chaque event OCGCore traverse 2 sockets distincts** (`session.players[0].ws` et `session.players[1].ws`), avec une version filtrée per-perspective. Le `soloMode` flag du serveur ne change rien à cette boucle.

#### Côté front — les 2 sockets poussent dans le MÊME processor en γ SOLO

[front/src/app/pages/pvp/duel-page/duel-connection.ts:709,738,905,932,938,947,960,985,1007](front/src/app/pages/pvp/duel-page/duel-connection.ts#L738) — dans chaque branche du switch de `handleMessage` :

```ts
this.processor.processMessage(message);
```

Et en γ SOLO, `conn0.processor === conn1.processor === sharedProcessor` (via `{ sharedProcessor }` ctor option à [solo-duel-orchestrator.service.ts:113-120](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L113-L120)).

#### Conséquence : chaque MSG_* est ingéré 2× dans le processor partagé

Pour un MSG_MOVE de P0 jouant Snake-Eye Ash en MZONE :
- Socket 0 reçoit `MSG_MOVE(cardCode=Ash, fromLoc=HAND-0, toLoc=MZONE-0, …)` (les hand de P1 sont masqués mais ça concerne pas ce move-ci) → `sharedProcessor.processMessage(...)`
- Socket 1 reçoit le **même** MSG_MOVE (Snake-Eye est public, atterit face-up MZONE → `landsPublic` true dans [message-filter.ts:92-103](duel-server/src/message-filter.ts#L92-L103) → pas de masquage) → `sharedProcessor.processMessage(...)`

**Résultat** : le `_animationQueue` reçoit 2× ce MSG_MOVE (cf. `enqueue(msg)` au default branch de [_processMessageInner](front/src/app/pages/pvp/duel-page/duel-event-processor.ts#L130-L184)). L'animation **double-fire** : un seul Snake-Eye se déplace 2× visuellement.

**Aucune garde anti-doublon** dans `DuelEventProcessor`, `DuelConnection`, ou `AnimationOrchestratorService` (grep `dedupe|deduplic|alreadySeen|seenMessage|messageHash|processedRefs|_lastMsg` → 0 résultat).

### Triage par classe de message

| Classe | Comportement | Sévérité doublon |
|---|---|---|
| **A — Enqueued dans `_animationQueue`** | MSG_MOVE, MSG_DRAW, MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST, MSG_SHUFFLE_HAND, MSG_CHAIN_SOLVING/SOLVED/END, MSG_BECOME_TARGET, MSG_FLIP_SUMMONING, MSG_CHANGE_POS, MSG_ATTACK, MSG_ADD_COUNTER, MSG_REMOVE_COUNTER, MSG_CONFIRM_CARDS, MSG_SWAP_GRAVE_DECK, etc. | **CRITIQUE** — double-fire visuel + double-lock |
| **B — Mute chain state + enqueue** | MSG_CHAINING (`commitPendingChainEntry()` + `_pendingChainEntry.set(...)` + `enqueue(msg)`) | **CRITIQUE** — `activeChainLinks` reçoit un lien fantôme |
| **B' — Mute chain state seulement** | MSG_CHAIN_NEGATED (idempotent par chance : `negated: true` 2× = pareil que 1×) | LOW |
| **C — Routed per-player (filterMessage returns null)** | SELECT_* (20 types), ANNOUNCE_*, SORT_*, MSG_HINT non-public, DICE_ROLL, SELECT_FIRST_PLAYER | **ZÉRO** — 1 seul socket reçoit |
| **D — MSG_HINT public** | hintType ∈ {1, 2, 6, 7, 9} (SAFE_PUBLIC_HINT_TYPES) | MEDIUM — double notification |

### Bugs observables que ça explique

Du memo `pvp-solo-chain-state-hygiene-2026-05-23` :

- **"Lock safety timeout HAND-0 / GY-0"** → double-MSG_MOVE acquiert 2× `HAND-0` lock, le commit ne le décrémente qu'1× → safety timeout après `LOCK_SAFETY_TIMEOUT_MS`
- **"POLL-DROP REGRESSION"** → chain state désynchronisé (`activeChainLinks` contient un lien fantôme qui ne sera jamais résolu) → `chainPhase` reste `'resolving'` → POLL-DROP watchdog fire
- **"activeChainLinks=[] AVANT MSG_CHAIN_SOLVED"** → 2 `commitPendingChainEntry` consécutifs sur le même `pendingEntry`, le 2e voit `pending=null` (consommé par le 1er), donc rien à commit → entretemps MSG_CHAIN_SOLVED arrive sur `activeChainLinks=[]`

### Pourquoi le bug reste partiellement masqué

1. **Beaucoup d'events sont idempotents** quand re-poussés en pile (MSG_CHAIN_NEGATED, MSG_FLIP_SUMMONING sur une carte déjà flip, …)
2. **`commitUnlocked()` resync au BOARD_STATE** — beaucoup de désync visuel sont écrasés par le BOARD_STATE suivant
3. **Le test de victoire T2 phase-γ est mocké** ([phase-gamma-victory.spec.ts:82-87](front/src/app/pages/pvp/duel-page/phase-gamma-victory.spec.ts#L82-L87) — `animService.notifyPerspectiveSwitch = jasmine.createSpy(...)`) — n'exerce JAMAIS le vrai pipeline avec 2 sockets pushant dans 1 processor

### Findings rattachés à C1

#### C1.1 — H1 : Orphan `_defaultConnection.processor` en SOLO

[duel-web-socket.service.ts:51](front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts#L51) field-init crée `_defaultConnection = new DuelConnection(...)` sans `sharedProcessor` → instancie son propre `DuelEventProcessor` + `RenderedBoardStateService`. En SOLO, 3 processors cohabitent (l'orphan + 2 conns pointant vers le shared). `proc()` retourne `_sharedProcessor` donc l'orphan dort. Le claim doctrine "1 processor par duel" est faux stricto sensu. Boot order fragile (le wsService ne SAIT pas qu'il sera SOLO au field-init). Cleanup asymétrique (`ngOnDestroy` cleanup uniquement l'orphan, conns réelles cleanup via `SoloDuelOrchestratorService.cleanup()`).

#### C1.2 — H3 : 2 transports → 1 processor, zéro sérialisation des reads concurrents

[duel-connection.ts:738+](front/src/app/pages/pvp/duel-page/duel-connection.ts#L738). Les 2 sockets appellent `this.processor.processMessage(message)` sur le MÊME processor. WebSocket `onmessage` est single-threaded par socket mais 2 émissions serveur concurrentes (MSG_CHAINING sur t0 + MSG_MOVE sur t1) peuvent s'interleaver à des points arbitraires dans `_processMessageInner`. `DuelEventProcessor` a été écrit pour 1 feed. R6 du spec γ acknowledge le risque mais mitigation = "ref-counting suffit" + "documenter" — pas de primitive de sérialisation, pas de test, pas d'assert.

#### C1.3 — H4 : `_lastDrawAnnouncedHash` per-connection → DRAW announce fire 2× par tour

[duel-connection.ts:234,1007-1012](front/src/app/pages/pvp/duel-page/duel-connection.ts#L234). conn0 ET conn1 reçoivent chaque MSG_DRAW (γ partage uniquement le processor — les fields transport-local comme `_lastTurnPlayer`, `_lastDrawAnnouncedHash` restent per-instance). Les deux fire le MÊME `_drawNewTurnSink` ([duel-animation-bridge.service.ts:39+](front/src/app/pages/pvp/duel-page/duel-animation-bridge.service.ts#L39)). Invariant β.3 cas #13 violé, zéro test γ ne le couvre. **Cas particulier du double-push C1 mais sur un sink transport-local plutôt que sur le processor partagé**.

#### C1.4 — B2 : `DuelWebSocketService.proc()` n'est pas un signal — computeds peuvent bind sur le mauvais processor pour toujours

[duel-web-socket.service.ts:65,152-154](front/src/app/pages/pvp/duel-page/duel-websocket.service.ts#L65). `_sharedProcessor` est un champ privé non-signal muté par `bindSharedProcessor`. Les computeds `animationQueue / activeChainLinks / chainPhase / hasPendingChainEntry` (lignes 192-196) lisent `this.proc().X()` — leur edge réactive mémoise le PREMIER processor résolu. Si quoi que ce soit lit ces computeds avant `SoloDuelOrchestratorService.init()` ligne 624 (effect d'injection, binding template), ils restent attachés à `_defaultConnection.processor.X` à jamais. Fragile par chance aujourd'hui. **Symptôme de la double existence orphelin + shared causée par C1.1**.

#### C1.5 — M12 : `setBoardActive(true)` asymétrique au switch

[solo-duel-orchestrator.service.ts:207](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L207). Flip `true` sur toute conn entrante — y compris avant son 1er BOARD_STATE. Le legacy guard `processDrawEvent` ([duel-connection.ts:1007](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1007)) laisse passer MSG_DRAW avant que `_lastTurnPlayer` soit seeded — `_lastDrawAnnouncedHash` hash `0:0` et swallow la 1ère vraie annonce DRAW. **Aggrave H4**.

#### C1.6 — Memo pré-existant `pvp-solo-chain-state-hygiene-2026-05-23`

2 bugs SOLO PvP observés au test palier 0 : Lock safety timeout HAND-0/GY-0 + POLL-DROP REGRESSION. `activeChainLinks=[]` AVANT MSG_CHAIN_SOLVED → état désynchronisé pendant chain en SOLO. **Probablement la manifestation observable de C1**.

---

## Cluster C2 — Surface de reset PERSPECTIVE incomplète au rematch

### Diagnostic chirurgical

CLAUDE.md doctrine ("Chain Event Processing & State Machine") :
> Les locks survivent à un PerspectiveSwitch (PERSPECTIVE_LIFETIME, deeper) ne reset PAS la queue, le processor reste intact.

Vérifié : `notifyPerspectiveSwitch` ([animation-orchestrator.service.ts:1109-1145](front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L1109)) dispatche `{PERSPECTIVE_LIFETIME}` qui via les ResetTargets épargne `ChainResolutionManager` (DUEL_LIFETIME) et `LpAnimationTracker` (DUEL_LIFETIME). OK.

**MAIS** [solo-duel-orchestrator.service.ts:242](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L242) — le rematch SOLO appelle encore `resetForSwitch()` ([animation-orchestrator.service.ts:975-1018](front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L975-L1018)) qui dispatche `{PERSPECTIVE_LIFETIME}` MAIS fait AUSSI :
- `this.rbs.commitAll()` — purge tous les locks
- `this._eventStream.set([])` — vide le journal
- `this._transport_nextStreamRef = 0` — reset les refs
- `this._transport_lastDispatchedRef = null` — reset le ref counter

→ Le claim "PERSPECTIVE_LIFETIME préserve les locks" tient pour `switchPerspective` mais PAS pour le rematch. Une race REMATCH_STARTING entre les 2 transports (cf. C1) rouvre la classe de bug SOLO sur un chemin moins testé.

Commit 8 (`5d08d211`) admet le problème dans son message ("`resetForSwitch` reste comme escape hatch") mais ne le supprime pas.

### Findings rattachés à C2

#### C2.1 — B1 : `resetForSwitch` toujours câblé au rematch SOLO

(Diagnostic ci-dessus.) Doctrine "locks survivent au switch" fausse pour le rematch path. Si une race REMATCH_STARTING fire avant que les 2 transports aient consommé tous les events en queue, on perd des animations + des locks orphelins.

#### C2.2 — H2 : `notifyPerspectiveSwitch` émet l'event AVANT le flip du signal

[solo-duel-orchestrator.service.ts:191-196](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L191-L196) push `PerspectiveSwitched` puis set le signal. `applyReset({PERSPECTIVE_LIFETIME})` fire sync DANS `notifyPerspectiveSwitch` → projections lisant `perspectiveSource()` voient l'ancien index. Demi-microtask plus tard, 2e vague de réactivité. `AnimatingZoneProjection` capture déjà `relativePlayer` en closure indirectement. Docblock `animation-orchestrator.service.ts:1109-1115` ment sur l'ordering garanti.

**Liens vers C1** : le ré-binding des computeds lors du flip pourrait aussi être affecté par le pattern non-signal de C1.4 (B2).

---

## Cluster C3 — Cas #12 (xyz-leave-with-materials) edge cases non couverts

### Diagnostic chirurgical

Le cas #12 introduit `RewriterRule.xyzLeaveWithMaterials` ([deferred-effect-rules.ts:286+](front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts#L286)) qui :
1. Détecte un XYZ quittant MZONE avec ≥1 matériau (`isXyzLeaveWithMaterials`)
2. Ouvre un deferred `xyz-leave:<ref>` avec payload `{ xyzZoneLock, expectedCardCodes: Set<number>, remaining: number }`
3. Le `chainTo` consomme chaque settling event (GRAVE→GRAVE `reason=0x600`) qui matche le predicate

[deferred-effect-processor.ts:498-529](front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts#L498-L529) — `drainMatchingDeferreds` itère sur **TOUS** les deferreds actifs et appelle leur `chainTo` sur le 1er event qui matche leur predicate.

### Cas non couverts (chacun fait revenir le bug visuel original)

#### C3.1 — B3 : Destruction massive XYZ avec cardCodes partagés

Si 2 XYZ détruits dans la même chain portent un matériau avec le même `cardCode` (ex. 2 Number 41 avec même Mermail), le 1er settling event matche les DEUX prédicats (`drainMatchingDeferreds` ne filtre pas), les deux `chainTo` décrémentent leur `expectedCardCodes` et closent sur le même event. Le 2e settling tombe dans `pileToPile` → flash visuel pour la moitié des matériaux.

Test T-V14 ([deferred-effect-processor.spec.ts:799-823](front/src/app/pages/pvp/duel-page/deferred-effect-processor.spec.ts#L799-L823)) **démontre** le pathological case mais n'asserte que "no crash + locks released" — le commentaire dit "BOTH close on the same event because both have it in expectedCardCodes", codifiant l'outcome erroné comme contrat.

#### C3.2 — M2 : Mind Control / controller-vs-owner

[deferred-effect-rules.ts:308-317](front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts#L308-L317). Le predicate matche les settlings via `player: m.player` = `from.controller`. Mais les matériaux en GRAVE après destruction d'un XYZ Mind-Controlled sont owned par leur propriétaire original. Leave event = `player: P1` (controller emprunté), settling = `player: P0` (owner). Le predicate fail. Zéro test contrôle-swap.

#### C3.3 — M1 : Snapshot pris pre-batch, pas pre-event

[duel-server/src/duel-worker.ts:1229-1237](duel-server/src/duel-worker.ts#L1229-L1237). `duelProcess` applique un batch atomique avant que `duelGetMessage` retourne. Snapshot pris 1× avant le batch. Spec §5.1 acknowledge ("bug visuel mineur possible") mais aucune défense. Cas concret : pendant le batch, une carte entre puis sort de MZONE-2 → son `overlayMaterials` sera celui de l'occupant précédent. Zéro test multi-event batch.

#### C3.4 — H7 : Snapshot indexing assumption non validée contre le binding wasm réel

[duel-server/src/pre-process-overlays.ts:91-96](duel-server/src/pre-process-overlays.ts#L91-L96). Le code itère `for seq < cards.length` et utilise `seq` comme MZONE sequence. Les fixtures de test fabriquent des arrays denses 7 éléments avec index===seq, mais zéro test contre la sémantique réelle de `duelQueryLocation`. Si le binding renvoie des arrays DENSES (slots occupés uniquement) — fréquent en OCGCore — `cards[0]` = 1er slot occupé peu importe son MZONE seq. Plus grave : mémoire `mr5-emz-convention` dit "both EMZ slots exist for player 0" — EMZ_R pour player 1 n'apparaît peut-être pas du tout sous `controller: 1`. T-B5 fait des assumptions qui contredisent la propre mémoire projet sans aucun test d'intégration wasm.

#### C3.5 — M13 : T-V14 codifie le mauvais comportement (redondant avec C3.1 — déjà mentionné)

#### C3.6 — L5 : T-B5 fixture contredit `mr5-emz-convention` (déjà mentionné dans C3.4)

---

## Cluster C4 — Findings isolés

Sans cause racine commune avec C1/C2/C3. Chacun est indépendant et fixable en isolation.

### C4.1 — H6 : `cardName: ''` sur MSG_MOVE virtuels va polluer le game log

[deferred-effect-rules.ts:350](front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts#L350). Les virtuels synthétisés sont des MSG_MOVE avec `cardName: ''`. Le `virtual-event-registry.tagAsVirtual` n'a ZÉRO consommateur en prod (grep `isVirtual` → spec uniquement). `DuelGameLogService.notifyGameLog` ne filtre pas — chaque XYZ destroy produit N+1 lignes de journal avec identité vierge.

### C4.2 — M3 : `ActiveDeferredView.payload: readonly` est un mensonge contractuel

[deferred-effect-processor.ts:316-329](front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts#L316-L329). Le commentaire claim "Read-only view... without mutating the DEP's internal state" mais `xyzLeaveWithMaterials.chainTo` mute le payload (`payload.expectedCardCodes.delete(...)`, `payload.remaining -= 1`). TS `readonly` bloque uniquement la réassignation, pas la mutation profonde.

### C4.3 — M5 : `virtual-event-registry` infrastructure spéculative

35 LOC + 18 LOC spec pour un marqueur que personne ne lit. `DuelDebugService.snapshot()` ne consomme pas `isVirtual`. Si Commit 2 a besoin de différencier virtuels (queue priority, log filtering, replay parity), le wiring sera inventé ad-hoc.

### C4.4 — M8 : `DuelContext.perspective(): WritableSignal<0|1>` leak mutator à tout consommateur

[duel-context.ts:58-59](front/src/app/pages/pvp/duel-context.ts#L58-L59). Le docblock concède le risque. Surface duale `perspectiveSource` + `perspective()` — "source unique de vérité" est faux. 14 sites avec idiome `duelCtx.perspective()()` double-call.

### C4.5 — M9 : `T2 phase-gamma-victory` spec n'exerce RIEN

[phase-gamma-victory.spec.ts:246-313](front/src/app/pages/pvp/duel-page/phase-gamma-victory.spec.ts#L246-L313). Mock complet de `AnimationOrchestratorService` (lignes 82-87) — la cascade `resetAllState / _eventStream.set([]) / rbs.commitAll()` n'est jamais exercée. Prouve "calling a stub ne mute pas de l'état que personne ne touche". Vacuous. Le vrai test (no `Lock safety timeout`, no `POLL-DROP REGRESSION`) est déféré à une checklist manuelle non-exécutée. **C'est ce qui a permis à C1 de passer inaperçu**.

### C4.6 — M10 : T7 "replay non-régression" = no-op

[phase-gamma-victory.spec.ts:319-340](front/src/app/pages/pvp/duel-page/phase-gamma-victory.spec.ts#L319-L340). `expect(adapterModule.ReplayDuelAdapter).toBeDefined()`. Le commentaire admet que l'invariant doit être grep-statique — mais le test ne le vérifie pas. Un futur caller peut ajouter `notifyPerspectiveSwitch` dans `ReplayDuelAdapter`, le test passe.

### C4.7 — M11 : SOLO debug harness = infra only, zéro scénario T2-T10 scripté

[front/e2e/solo-pvp-harness.ts](front/e2e/solo-pvp-harness.ts) (414 lignes) + `solo-pvp-harness-smoke.spec.ts` vérifie les exports. Commit `b2a5803b` admet "~3-4 jours de harness = no marginal value over operator + checklist". Le test de victoire de l'invariant γ cardinal a ZÉRO couverture CI. **C'est aussi ce qui a permis à C1 de passer inaperçu**.

### C4.8 — L3 : R9 commit message blame le test "validant le mauvais comportement" mais n'ajoute aucun garde anti-régression

Commit `0e5ae0a4` + [game-log-builder.spec.ts:282-306](front/src/app/pages/pvp/duel-page/game-log/game-log-builder.spec.ts#L282-L306). Le seul fix (`expect(isExtraDeckSummon(0x10000000)).toBe(true)`) serait passé silencieusement avec les anciennes constantes si `EXTRA_DECK_SUMMON` était aussi faux. Spec structurellement identique aux specs "wrong value" précédentes. Un test lisant le réel `OcgQueryFlags.REASON` via le binding wasm serait le vrai garde.

### C4.9 — L4 : `attachOutOfBandSink` câblé sur le mauvais processor pendant la fenêtre d'init

[duel-page.component.ts:570](front/src/app/pages/pvp/duel-page/duel-page.component.ts#L570). Appelé AVANT `orchestrator.init` ligne 624. `active()` retourne `_defaultConnection` → sink set sur l'orphelin. SOLO rewire via `bindTransports`, fenêtre brève mais non testée pour fork-restore. **Symptôme de C1.1 (orphan _defaultConnection)**.

### C4.10 — L6 : Front `move-animation-router` était correct-par-coïncidence (0x1)

[move-animation-router.ts:16](front/src/app/pages/pvp/duel-page/move-animation-router.ts#L16). R9 acknowledge mais aucune evidence grep que c'est le SEUL consumer animation-related ("I checked" = seule justification).

---

## Liens entre clusters

- **C4.5 + C4.7 ont caché C1** : aucun test ne pousse 2 sockets réels dans 1 processor partagé. Le harness existe mais n'est pas scripté.
- **C4.9 (L4 attachOutOfBandSink window) est un symptôme direct de C1.1 (H1 orphan)**. Fixer C1.1 efface C4.9.
- **C1.4 (B2 _sharedProcessor non-signal) est un symptôme de l'instanciation pessimiste C1.1 (H1)**. Si `_defaultConnection` était instancié paresseusement uniquement en PvP normal, `_sharedProcessor` serait l'unique source en SOLO dès le départ et le pattern signal/non-signal serait sans risque.
- **C2 (rematch annulation) interagit avec C1** : la race REMATCH_STARTING entre les 2 sockets passe par `resetForSwitch` qui purge tout, ce qui CACHE les bugs C1 sur le path rematch mais en INTRODUIT des nouveaux (locks orphelins si une animation était en cours).

---

## Recommandation de séquencement (constat seulement)

L'ordre des décisions à prendre dépend du choix de fix pour C1 (le bug-mère). Selon la voie choisie :

- **Si dedup hash** (option a) : C1.1/C1.4/C4.9 deviennent moins critiques (un seul processor reste mais avec garde). C1.2/C1.3/C1.5 restent à fixer séparément.
- **Si 1-socket-actif** (option b — retour pré-γ partiel) : C1 + C1.2 + C1.3 + C1.5 disparaissent par construction. C1.1/C1.4 persistent. Risque de ré-introduire la divergence γ voulait éliminer.
- **Si multiplex serveur** (option c) : C1 + C1.1 + C1.2 + C1.3 + C1.4 + C1.5 + C4.9 disparaissent. Refactor lourd. C2/C3/C4 indépendants restent.

Les clusters C2 et C3 sont indépendants de la décision C1 et peuvent être traités en parallèle ou après.

Le cluster C4 contient les findings autonomes — chacun peut être fixé indépendamment quand la fenêtre se présente.

---

## Bilan adversarial review

**29 findings** initiaux, **6 livrés** dans `dcf3330f` (cleanup mécanique), **23 documentés** dans ce doc.

**Doctrine γ "single-processor élimine bug-solo-sequence.md par construction"** : faux dans la pratique, le bug-mère a été déplacé. Le claim doit être révisé dans CLAUDE.md après le fix C1.

**Doctrine cas #12 "fix la classe entière xyz-leave-with-materials"** : faux, 3 edge cases identifiés (B3 shared cardCodes, M2 Mind Control, M1 multi-event batch).

**Couverture test** : les 3 tests "de victoire" du commit message γ commit 7 (M9 phase-gamma-victory, M10 replay non-regression, M11 SOLO harness) sont vacuous / no-op / infra-only. **Aucun test ne valide que le bug-mère C1 n'existe pas**.
