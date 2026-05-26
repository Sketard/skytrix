---
title: Phase γ — Spec d'implémentation détaillée (refonte SOLO + perspective projector)
status: ready for implementation
branch: feat/anim-pipeline-v2
depends_on:
  - duel-session-chantier.md (§3, §4.3, §5.2)
  - bug-solo-sequence.md (test de victoire T0-T10)
  - _bmad-output/poc-projection/decision.md (stratégie S3 actée)
  - cost-before-overlay-pitfalls-2026-05-25.md (5 consommateurs, anti-patterns)
phase_predecessor: β (DEP + BoundaryProcessor + directive announcement livrés)
phase_successor: δ (post-livraison, backlog résiduel)
date: 2026-05-26
authors:
  - Axel (lead)
---

# Phase γ — Refonte SOLO + couche de projection perspective

## 1. Contexte & motivation

### 1.1 Le bug SOLO

`bug-solo-sequence.md` caractérise un bug reproductible en SOLO PvP : un
`switchPlayer()` déclenché pendant qu'une chain est active (`chainPhase ∈
{building, resolving}`) laisse l'orchestrator pointer sur le mauvais
`DuelEventProcessor`. Deux symptômes observables :

- **Symptôme A** — `Lock safety timeout HAND-0/GY-0 after 5000ms`
- **Symptôme B** — `[POLL-DROP REGRESSION] chain stuck after finalize-during-resolving for 10000ms`

Cause racine documentée par la mémoire `pvp-solo-chain-state-hygiene-2026-05-23` :
le mode SOLO instancie **deux `DuelConnection` parallèles** (`conn0`,
`conn1`), chacune possédant son propre `DuelEventProcessor`. Le
`switchPlayer()` bascule `_activeConnection` d'une instance à l'autre,
mais l'état chain (`activeChainLinks`, `chainPhase`, `_pendingChainEntry`,
buffer chain résolvante, locks) reste sur le processor de la connection
**sortante** — orphelin. Le processor de la connection **entrante** n'a
jamais reçu les `MSG_CHAINING` qui ont alimenté la chain courante, donc
ses signaux sont vides. Les `MSG_CHAIN_SOLVING / SOLVED / END` qui suivent
sont routés vers le processor entrant et s'appliquent à `activeChainLinks
= []` → état désynchronisé → locks pendants → safety timeouts.

### 1.2 Pourquoi γ

Le doc chantier (§1 lignes 96-104, §3.5 lignes 346-354, §4.3 lignes
954-961) statue le mécanisme structurel d'élimination du bug :

> Un seul `DuelEventProcessor` par duel + perspective comme couche de
> projection au-dessus du pipeline = la divergence d'état est éliminée
> par construction (un seul état, pas deux).

γ est la phase qui matérialise ce changement structurel. Elle livre
trois sous-objectifs indissociables :

1. **`SoloDuelOrchestratorService` reformé** — un seul processor, un
   seul flux, un seul RBS. Le switch SOLO devient une émission
   `PerspectiveSwitched` sur le flux, pas une bascule d'instance.
2. **`PerspectiveProjector` implémenté** — la couche de projection
   visuelle (`transform: rotate(180deg)` sur `.board-host`) selon la
   stratégie S3 retenue au POC (`_bmad-output/poc-projection/decision.md`).
3. **Migration des consommateurs cross-connection** — `pendingChainEntry`
   + `activeChainLinks` + `chainPhase` + autres signaux aujourd'hui
   accédés via `wsService` (qui délègue à `_activeConnection`) basculent
   sur une lecture unique au processor du duel.

### 1.3 Pré-requis attendus de β

γ part de l'hypothèse que β a livré :

- `DeferredEffectProcessor` opérationnel avec les 12 règles initiales,
  émettant `DeferredEffect` / `EffectReady` / `EffectAbandoned` sur le
  flux. Notamment la règle `overlay-show` qui sera consommée par le
  composant overlay (la migration de la lecture
  `chainLinksWithPending` se fait *en plus* de cette règle DEP, pas à
  sa place — cf. §3 mécanisme decoupling-signal).
- `BoundaryProcessor` émettant `ChainStarted/Ended`, `TurnStarted/Ended`,
  `PhaseStarted/Ended`.
- `BufferReplayBuilder` jeté (cf. §6 ci-dessous, décision actée).
- Directive `announcement` du `QueueRunner` livrée (cas #13).

Si l'un de ces pré-requis manque au démarrage de γ, le commit qui en
dépend (cf. §7 découpe) doit être réordonné ou différé.

---

## 2. API cible `SoloDuelOrchestratorService` refondu

L'objectif est **single-processor, single-RBS, single-flux**. Le
service devient un *coordinateur de perspective*, pas une machine d'état
dupliquée. Le service garde la responsabilité d'établir deux
**transports WS** distincts (un par identité serveur) — c'est la
contrainte réseau côté serveur — mais ces transports déversent leurs
événements **dans le même processor**.

### 2.1 Squelette TypeScript commenté

```typescript
@Injectable()
export class SoloDuelOrchestratorService {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly animationService = inject(AnimationOrchestratorService);
  private readonly duelCtx = inject(DuelContext);
  private readonly debugLog = inject(DebugLogService);
  private readonly logger = inject(DuelLogger);
  private readonly artService = inject(DuelCardArtService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  enabled = false;

  // ───────────────────────────────────────────────
  //  Transports WS (réseau) — restent dédoublés
  // ───────────────────────────────────────────────
  // Deux *transports* parce que le serveur tient deux identités joueur.
  // Chacun ouvre une socket et reçoit ses propres prompts (un
  // SELECT_IDLECMD ne s'envoie qu'au joueur actif côté serveur).
  // CRITIQUE : ces transports ne portent PLUS de DuelEventProcessor
  // propre. Ils sont de simples adaptateurs WS qui pushent leurs
  // messages dans le processor partagé via `pushFromTransport(msg, transportIdx)`.
  private _transports = signal<[SoloTransport, SoloTransport] | null>(null);
  readonly transports = this._transports.asReadonly();

  // ───────────────────────────────────────────────
  //  Perspective — projection visuelle unique
  // ───────────────────────────────────────────────
  // Source unique de vérité : signal hébergé par DuelContext (cf. POC §4).
  // L'accès lecture/écriture passe par DuelContext.perspective().
  // Exposé en lecture seule ici pour les composants qui veulent réagir
  // au switch sans injecter DuelContext directement.
  readonly perspectiveIndex = computed(() => this.duelCtx.perspective()());

  // Debounce du switch : empêche un double-click pendant la transition CSS
  // (250ms) ou pendant un prompt actif.
  private _switching = signal(false);
  readonly switching = this._switching.asReadonly();

  // ───────────────────────────────────────────────
  //  Connectivité
  // ───────────────────────────────────────────────
  readonly connectionLost = computed(() => {
    const t = this._transports();
    return t !== null && (t[0].connectionStatus() === 'lost'
                       || t[1].connectionStatus() === 'lost');
  });

  // Rematch reset counter — sert au routing des effets de bord (timers,
  // animations) qui doivent se ré-initialiser à chaque nouvelle partie.
  private _rematchReset = signal(0);
  readonly rematchReset = this._rematchReset.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  // ───────────────────────────────────────────────
  //  Initialisation
  // ───────────────────────────────────────────────
  init(token1: string, token2: string): void {
    this.enabled = true;

    // Le DuelEventProcessor unique est créé/possédé par
    // AnimationOrchestratorService. Cette inversion (vs aujourd'hui
    // où chaque DuelConnection en instancie un) est ce qui élimine la
    // divergence d'état documentée par bug-solo-sequence.md §2.
    //
    // L'orchestrator est déjà providered au niveau du composant
    // duel-page → unique pour la session. Aucune injection nouvelle ici.

    // Transports WS — minces wrappers. Chaque transport reçoit le
    // processor partagé via setSharedProcessor() pour pouvoir y pousser
    // ses messages.
    const sharedProcessor = this.animationService.processor;
    const t0 = new SoloTransport(environment.wsUrl, 'duel-reconnect-token-p1',
                                 this.logger, sharedProcessor, /*idx*/0);
    const t1 = new SoloTransport(environment.wsUrl, 'duel-reconnect-token-p2',
                                 this.logger, sharedProcessor, /*idx*/1);

    // Art service partagé (déjà fait aujourd'hui — cf. ligne 41-42
    // existante). Permet le dédup de prefetch entre les deux transports.
    t0.artService = this.artService;
    t1.artService = this.artService;

    // Hooks debug (identiques à l'existant).
    t0.onMessage = msg => this.debugLog.logServerMessage(msg);
    t1.onMessage = msg => this.debugLog.logServerMessage(msg);
    t0.onResponse = (promptType, data) =>
      this.debugLog.logPlayerResponse(promptType, data);
    t1.onResponse = (promptType, data) =>
      this.debugLog.logPlayerResponse(promptType, data);

    // STATE_SYNC est routé au processor unique (déclenche son
    // applyReset(scopes={DUEL,CONNECTION,PERSPECTIVE}, checkpointPayload)).
    // Il n'y a plus deux processors à reset.
    t0.onStateSync = msg => sharedProcessor.applyCheckpoint(msg);
    t1.onStateSync = msg => sharedProcessor.applyCheckpoint(msg);

    this._transports.set([t0, t1]);
    t0.connect(token1);
    t1.connect(token2);

    // Perspective initiale = 0 (own player at bottom).
    this.duelCtx.perspective().set(0);

    // L'ancien _activeConnection disparaît : le wsService ne route plus
    // les lectures vers une connection précise, il lit le processor
    // partagé directement.
    this.wsService.bindSharedProcessor(sharedProcessor);
    this.wsService.bindTransports(t0, t1);

    this.setupRematchEffects();
  }

  // ───────────────────────────────────────────────
  //  Switch de perspective
  // ───────────────────────────────────────────────
  /**
   * Bascule la perspective visuelle (P0 ↔ P1). Sémantique cible
   * (lecture laxiste de bug-solo-sequence.md §3) :
   *
   *  - Processor inchangé : activeChainLinks, chainPhase, pendingChainEntry,
   *    buffer chain, locks, queue d'animation — RIEN n'est touché.
   *  - Émission d'un événement `PerspectiveSwitched(from, to)` sur le
   *    flux. Le ScopeResetDispatcher reset les projections
   *    PERSPECTIVE_LIFETIME (BattleAnimationTracker, animatingLpPlayer,
   *    targetedZoneKeys, etc.).
   *  - DuelContext.perspective() flip → le composant racine board
   *    applique transform CSS (cf. POC S3).
   *
   * NB : ne change PAS le transport "actif" côté serveur. Les deux
   * transports continuent à recevoir leurs messages en parallèle. Ce qui
   * détermine "qui joue" côté UI est la perspective lue par DuelContext,
   * PAS un _activeConnection.
   */
  switchPerspective(): void {
    if (this._switching()) return;
    if (this.wsService.pendingPrompt() !== null) {
      // Convention §5.2 du chantier : pas de switch pendant prompt actif.
      this.logger.log(DuelLogCategory.PIPELINE,
        'switchPerspective skipped: prompt active');
      return;
    }
    const from = this.duelCtx.perspective()();
    const to: 0 | 1 = from === 0 ? 1 : 0;
    this._switching.set(true);

    // Émission sur le flux. C'est le `pushToStream` de l'orchestrator
    // qui matérialise PerspectiveSwitched comme événement de Famille 3
    // (cf. §4 ci-dessous), pas une mutation directe.
    this.animationService.notifyPerspectiveSwitch(from, to);

    // Flip visuel — CSS-driven.
    this.duelCtx.perspective().set(to);

    // Debounce post-transition (durée alignée sur la transition CSS
    // .board-host transform 250ms + marge).
    setTimeout(() => this._switching.set(false), 300);
  }

  // ───────────────────────────────────────────────
  //  Rematch
  // ───────────────────────────────────────────────
  /**
   * Wiring rematch : quand les DEUX transports ont reçu REMATCH_STARTING
   * du serveur, on émet un checkpoint `RematchStarted` sur le processor
   * partagé. Le processor cascade un reset {DUEL, CONNECTION, PERSPECTIVE}
   * via le ScopeResetDispatcher. Pas de double-reset façon ancien code.
   */
  private setupRematchEffects(): void {
    const t = this._transports();
    if (!t) return;

    runInInjectionContext(this.injector, () => {
      // Auto-accept rematch invitation côté transport (un par identité).
      effect(() => {
        if (t[0].rematchState() === 'invited') t[0].sendRematchRequest();
        if (t[1].rematchState() === 'invited') t[1].sendRematchRequest();
      }, { allowSignalWrites: true });

      // Quand les deux transports voient REMATCH_STARTING :
      effect(() => {
        const s0 = t[0].rematchStarting();
        const s1 = t[1].rematchStarting();
        if (s0 && s1) {
          // Un seul checkpoint, un seul reset.
          this.animationService.applyCheckpoint({
            kind: 'RematchStarted',
            source: 'solo-rematch',
            body: null,
          });
          // Perspective P0 par convention en début de nouvelle partie.
          this.duelCtx.perspective().set(0);
          t[0].resetRematchStarting();
          t[1].resetRematchStarting();
          this._rematchReset.update(c => c + 1);
        }
      }, { allowSignalWrites: true });
    });
  }

  // ───────────────────────────────────────────────
  //  Teardown
  // ───────────────────────────────────────────────
  cleanup(): void {
    const t = this._transports();
    if (t) {
      t[0].clearStorageToken();
      t[1].clearStorageToken();
      t[0].cleanup();
      t[1].cleanup();
    }
    // Processor unique : cleanup pris en charge par
    // AnimationOrchestratorService.destroy() (déjà câblé par destroyRef).
  }
}
```

### 2.2 Différences clés vs l'API actuelle

| Aspect | Aujourd'hui | Cible γ |
|---|---|---|
| Nombre de `DuelEventProcessor` | 2 (un par `DuelConnection`) | **1** (possédé par `AnimationOrchestratorService`) |
| Nombre de `RenderedBoardStateService` | 2 | **1** |
| Notion de `_activeConnection` | Bascule lors du switch | **Supprimée**. Les 2 transports déversent en parallèle. |
| Lecture côté wsService | `_activeConnection().pendingChainEntry()` | `sharedProcessor.pendingChainEntry()` |
| API publique de switch | `switchPlayer()` | `switchPerspective()` (renommé pour refléter la sémantique) |
| Méthode `clearAnimationQueueOnly` | Appelée 2× (outgoing + incoming) au switch | **Supprimée** (rien à clear, processor unique) |
| Méthode `clearLastSelections` | Appelée 2× au switch | **À reloger côté transport** (prompt-flow accumulators restent transport-local, cf. §3) |
| Reset orchestrator au switch | `animationService.resetForSwitch()` (purge tout PERSPECTIVE) | `animationService.notifyPerspectiveSwitch(from, to)` → émet l'événement, le ScopeResetDispatcher pilote |

### 2.3 Le nouveau `SoloTransport` (vs `DuelConnection`)

`DuelConnection` est aujourd'hui un *poly-objet* qui combine 3
responsabilités :

1. Transport WS (socket, reconnect, tokens, ping/pong).
2. Adaptation processor (instancie + alimente un `DuelEventProcessor`).
3. Accumulateurs prompt-flow (`_lastConfirmedCards`, `_lastSelectedCards`,
   `_confirmedCardsByChain`, `_hintCardConsumed`, `_justReconnected`,
   `_lastTurnPlayer`, `_lastTurnCount`, etc.).

Pour γ :

- **(1) reste** — chaque identité serveur a sa socket.
- **(2) disparaît** — le transport déverse dans le processor partagé via
  `sharedProcessor.processMessage(msg)`. Plus de processor par transport.
- **(3) reste transport-local** — ces accumulateurs sont liés à
  l'identité serveur (un prompt envoyé à P0 produit un `lastConfirmedCards`
  côté P0 uniquement). Le `wsService` les expose en lisant le transport
  correspondant à la **perspective courante** (pas l'`_activeConnection`
  d'antan, mais un calcul `transports[perspectiveIndex]`).

Décision ouverte (cf. §8 risques) : faut-il **deux classes** distinctes
(`SoloTransport` + `PvPSingleTransport` extends d'une classe abstraite) ou
**une seule classe** `DuelTransport` reconfigurable ? Mes options + reco
dans §8.

---

## 3. Plan de migration des consommateurs

`pendingChainEntry` est lue à 5 endroits (cf. mémoire
`cost-before-overlay-failed-2026-05-25` §"Mécanismes systémiques
sous-estimés" + grep validé sur le repo). Plus 2 autres consommateurs
voisins (`activeChainLinks`, `chainPhase`) doivent être migrés en
cohérence.

### 3.1 `duel-event-processor.ts`

- **Aujourd'hui** : possède le signal `_pendingChainEntry` privé,
  expose `pendingChainEntry` en lecture seule.
- **Post-γ** : **inchangé**. C'est la source. Les tests
  `duel-event-processor.spec.ts:55-60` restent valides.
- **Migration** : triviale (aucune modification). Sauf si la branche
  parallèle "decoupling signal" (cf. §3.7) est retenue, auquel cas
  un second signal `_handRevealChainLinks` est ajouté ici.

### 3.2 `duel-connection.ts:177`

- **Aujourd'hui** : `readonly pendingChainEntry = this.processor.pendingChainEntry;`
  expose le pending du processor *propre* à cette connection.
- **Post-γ** : `DuelConnection` n'existe plus côté SOLO (remplacée par
  `SoloTransport` qui ne porte plus de processor). Côté PvP normal, la
  classe reste — son processor devient celui de l'orchestrator (1 seul
  par duel). Ligne 177 devient une délégation vers le processor partagé
  injecté ou supprimée si la lecture passe désormais directement par
  `wsService`.
- **Migration** : **moyenne**. Demande de revoir l'init de
  `DuelConnection` côté PvP normal aussi (un constructor param
  `sharedProcessor` ou injection). Garde la rétro-compat de l'API
  `duelConnection.pendingChainEntry()` pour ne pas casser les specs
  PvP normales.

### 3.3 `duel-web-socket.service.ts:83`

- **Aujourd'hui** :
  ```typescript
  readonly pendingChainEntry = computed(() => this._activeConnection().pendingChainEntry());
  ```
- **Post-γ** : `_activeConnection` n'existe plus en SOLO. La lecture
  devient :
  ```typescript
  readonly pendingChainEntry = this.sharedProcessor.pendingChainEntry;
  ```
- **Migration** : **moyenne**. `wsService` est consommé partout
  (duel-page, replay-page, hand-row, chain-overlay, prompt-dialog).
  Toute la batterie de `computed(() => this._activeConnection().X())`
  (lignes 70-99 de `duel-web-socket.service.ts`) doit être triée :
  - **Restent transport-dépendantes** (lues du transport courant via
    `perspectiveIndex`) : `pendingPrompt`, `hintContext`, `timerState`,
    `connectionStatus`, `rematchState`, `firstPlayerResult`,
    `inactivityWarning`, `sessionPhase`, `justReconnected`, etc.
  - **Deviennent partagées** (lues du processor unique) :
    `pendingChainEntry`, `activeChainLinks`, `chainPhase`,
    `animationQueue`, `hasPendingChainEntry`, `boardStateView`,
    `cardCodes`.
  - **À reloger** : `lastConfirmedCards` / `confirmedCardsForChainIndex`
    — accumulateurs prompt-flow, restent transport-local mais lus du
    transport courant. Voir §3.7.

### 3.4 `duel-page.component.ts:380`

- **Aujourd'hui** :
  ```typescript
  private readonly chainLinksWithPending = computed(() => {
    const links = this.wsService.activeChainLinks();
    const pending = this.wsService.pendingChainEntry();
    return pending ? [...links, pending] : links;
  });
  ```
- **Post-γ** : **inchangé** dans son contenu. La sémantique des deux
  signaux source change (passe par le processor partagé), mais l'API
  `wsService.activeChainLinks()` / `wsService.pendingChainEntry()` est
  préservée.
- **Migration** : **triviale** (zero diff). C'est exactement le
  bénéfice du choix d'API : la migration est invisible aux consommateurs
  de haut niveau.

### 3.5 `replay-duel-adapter.ts:36`

- **Aujourd'hui** : `readonly pendingChainEntry = this.processor.pendingChainEntry;`
  où `this.processor` est le processor du replay (instancié ligne 26).
- **Post-γ** : **inchangé**. Le replay continue à utiliser SON processor
  (`ReplayDuelAdapter` instancie son propre processor + RBS, indépendants
  du SOLO/PvP). Cf. §4.1 du chantier — l'adapter est `Conservé`. La
  refonte SOLO ne touche pas le replay.
- **Migration** : **triviale** (zero diff). Régression à surveiller :
  vérifier que les tests `replay-duel-adapter.spec.ts` continuent à
  passer (le replay ne devrait jamais voir `PerspectiveSwitched` puisque
  le replay-page n'invoque pas l'orchestrator SOLO).

### 3.6 `replay-page.component.ts:454`

- **Aujourd'hui** :
  ```typescript
  private readonly chainLinksWithPending = computed(() => {
    const links = this.adapter.activeChainLinks();
    const pending = this.adapter.pendingChainEntry();
    return pending ? [...links, pending] : links;
  });
  ```
- **Post-γ** : **inchangé**. Symétrique de §3.4 — l'adapter reste
  l'interface, son contenu pointe le processor du replay.
- **Migration** : **triviale**.

### 3.7 Consommateurs transport-local à reloger

Liste des accumulateurs prompt-flow qui restent côté transport (un par
identité serveur) :

- `_lastConfirmedCards`, `_lastSelectedCards`, `_confirmedCardsByChain`
  (cf. `duel-connection.ts:171-174`)
- `_hintCardConsumed`
- `_justReconnected`
- `_lastTurnPlayer`, `_lastTurnCount`, `_lastDrawAnnouncedHash` (β.3 cas #13)
- `lastPromptType`, `lastPromptStreak`

**Aujourd'hui** : chaque `DuelConnection` les possède en propre.
`wsService` les lit via `_activeConnection().X`.

**Post-γ** : restent dans le `SoloTransport` correspondant.
`wsService.X = computed(() => this._transports()[this.duelCtx.perspective()()].X)`
— la lecture suit la perspective courante, sans changement de transport
"actif" sous-jacent.

**Migration** : **moyenne**. Touche `wsService` (computed à réorienter)
et impose une convention : un computed `wsService.X` qui dépend de
transport-local DOIT déclarer `this.duelCtx.perspective()` comme
dépendance reactive. Anti-pattern à éviter : lire le transport sans
tracer la perspective (le signal ne re-tickerait pas au switch).

**Variante "decoupling signal" (option ouverte)** : la mémoire pitfalls
recommande de séparer `_handRevealChainLinks` (eager) et
`_animatedChainLinks` (deferred) pour résoudre le bug
cost-before-overlay sans toucher au pending FIFO. Cette modification
**n'appartient PAS à γ** — elle est résolue structurellement par le
`DeferredEffectProcessor` de β (règle `overlay-show`). Si β n'a pas
livré la règle, γ ne la livre pas non plus. À acter au démarrage de γ.

### 3.8 Tableau récap

| # | Consommateur | Aujourd'hui | Post-γ | Effort |
|---|---|---|---|---|
| 1 | `duel-event-processor.ts:52` (source) | possède `_pendingChainEntry` | inchangé | trivial |
| 2 | `duel-connection.ts:177` | délégation processor propre | délégation processor partagé | moyen |
| 3 | `duel-web-socket.service.ts:83` | `_activeConnection().X()` | `sharedProcessor.X()` | moyen |
| 4 | `duel-page.component.ts:380` | lit via wsService | inchangé (API préservée) | trivial |
| 5 | `replay-duel-adapter.ts:36` | délégation processor replay | inchangé | trivial |
| 6 | `replay-page.component.ts:454` | lit via adapter | inchangé | trivial |
| 7 | `duel-event-processor.spec.ts:55-60` | mock processor isolé | inchangé | trivial |
| 8 | `duel-page.component.spec.ts:113` | `pendingChainEntry = signal(null)` (mock) | inchangé | trivial |
| 9 | `replay-page.component.spec.ts:118` | idem | inchangé | trivial |

**5 consommateurs prod + 3 specs** = 8 fichiers touchés. Les 6 cités
explicitement par la mémoire (`duel-page, replay-page, replay-adapter,
duel-connection, duel-web-socket` + specs) sont tous couverts.

---

## 4. Événement `PerspectiveSwitched`

### 4.1 Payload exact

```typescript
interface PerspectiveSwitchedEvent {
  kind: 'transport';                          // famille 3 (cf. §3.3 chantier)
  type: 'PerspectiveSwitched';
  from: 0 | 1;
  to: 0 | 1;                                   // toujours différent de `from`
  ref: number;                                 // monotonic, assigné par pushToStream
  // Pas de payload board state — le board est inchangé côté processor.
  // La projection visuelle est gérée séparément par DuelContext.perspective.
}
```

### 4.2 Où il est émis

- **Émetteur unique** : `AnimationOrchestratorService.notifyPerspectiveSwitch(from, to)`,
  appelé par `SoloDuelOrchestratorService.switchPerspective()` après le
  guard `_switching` + prompt active.
- **Mécanique** : la méthode appelle `this.pushToStream({ kind:
  'transport', type: 'PerspectiveSwitched', from, to })`. Le ref est
  assigné dans `pushToStream`, le DEP observe, le ScopeResetDispatcher
  dispatche `applyReset({PERSPECTIVE_LIFETIME})` à tous les
  `ResetTarget` enregistrés.
- **Replay** : non émis. `ReplayPageComponent` peut éventuellement
  changer de perspective via son propre mécanisme (déjà en place :
  `perspectiveIndex()` signal local), mais sans passer par cet
  événement. Si on veut unifier, c'est δ.

### 4.3 Qui le consomme

- **ScopeResetDispatcher** : dispatche `applyReset({PERSPECTIVE_LIFETIME})`
  sur tous les `ResetTarget`. Concrètement (cf. CLAUDE.md "Orchestrator
  Decomposition" + §3.5 chantier) :
  - `BattleAnimationTracker` (scope PERSPECTIVE_LIFETIME) → clear `pendingAttack`
  - `ChainResolutionManager` (scope PERSPECTIVE_LIFETIME pour `chainResolutionAnnounce` + replay timers) → clear bannière + timers
  - `LpAnimationTracker.animatingLpPlayer` (scope PERSPECTIVE_LIFETIME) → clear
  - `targetedZoneKeys` projection (scope PERSPECTIVE_LIFETIME) → empty
  - `swapGraveDeckKeys` projection (PERSPECTIVE_LIFETIME) → empty
  - `animatingZone` projection (PERSPECTIVE_LIFETIME) → null
  - `counterPulse` projection (PERSPECTIVE_LIFETIME) → null
  - `isAnimating` projection (PERSPECTIVE_LIFETIME) → false
  - `chainResolutionAnnounce` projection (PERSPECTIVE_LIFETIME) → false
  - `overlayShowReady` projection (PERSPECTIVE_LIFETIME) → empty set

- **Ne le consomment PAS** (scope ≥ CONNECTION_LIFETIME) :
  - `DuelEventProcessor` (activeChainLinks, chainPhase, _pendingChainEntry,
    buffer chain) — CONNECTION_LIFETIME, survit
  - `RenderedBoardStateService` (locks) — CONNECTION_LIFETIME, survit
  - `DeferredEffectProcessor` (pendingDeferredEffects) — CONNECTION_LIFETIME,
    survit (cf. §3.7bis du chantier "PerspectiveSwitched ne déclenche PAS
    d'abandon")
  - `LpAnimationTracker.trackedLp + _pendingLpCommits` — DUEL_LIFETIME, survit
  - `DuelGameLogService` (journal) — DUEL_LIFETIME, survit (cf. mémoire
    [[game-log-refresh-persistence-2026-05-23]] qui voudrait monter à
    SESSION_LIFETIME pour persister F5 — orthogonal à γ)
  - `BoundaryProcessor` (groupes ouverts) — CONNECTION_LIFETIME, survit
    (un switch ne ferme PAS les `ChainStarted/TurnStarted/PhaseStarted`
    courants)

- **PerspectiveProjector / composants visuels** : consomment via
  `DuelContext.perspective()` (déjà câblé). N'observent PAS l'événement
  flux directement — l'événement sert au dispatch des resets, le visuel
  passe par le signal.

### 4.4 Scope déclaré

- **L'événement** est de famille `transport` (cf. §3.3 chantier
  ordering : events de pipeline en ordre d'émission, ref monotonic).
- **Le reset qu'il déclenche** porte scope `PERSPECTIVE_LIFETIME`
  uniquement. C'est l'invariant central qui élimine le bug SOLO
  (cf. §3.5 chantier + `bug-solo-sequence.md §4`).

### 4.5 Garantie d'ordering

Le `pushToStream(event)` est synchrone et atomique : entre l'émission
de `PerspectiveSwitched` et son observe par le DEP + le dispatch reset,
**aucun WS message ne peut être interlocké**. Les 2 transports
continuent à pousser mais leur `processMessage` s'enfile derrière sur
la macro-tâche. La projection visuelle (`DuelContext.perspective().set(to)`)
est appliquée **après** l'émission stream (cf. ordering ligne `switchPerspective`
ci-dessus : `notifyPerspectiveSwitch` d'abord, `set` ensuite).

Pourquoi cet ordre : le reset PERSPECTIVE_LIFETIME doit voir l'ancienne
valeur de `perspective()` lors de son `applyReset` (au cas où une
projection lit la perspective dans son reset — cas marginal mais
possible). Le `set` final laisse Angular détecter le changement au
prochain tick et applique le transform CSS.

---

## 5. Stratégie de test — séquence T0-T10

10 scénarios à valider automatiquement (Playwright en priorité,
spec unit pour les composants isolés). Chaque test produit un PASS/FAIL
clair contre une assertion d'état post-séquence.

### T0 — Boot SOLO

- **Setup** : ouvrir une session SOLO PvP fresh, decks par défaut, P0 turn.
- **Action** : laisser jouer jusqu'à la première BOARD_STATE + 5 MSG_DRAW
  initiaux.
- **Assertions** :
  - `animationService.processor` existe et est unique (référence stable).
  - `transports[0].sharedProcessor === transports[1].sharedProcessor`.
  - `duelCtx.perspective() === 0`.
  - `activeChainLinks() === []`, `chainPhase() === 'idle'`.
  - Hand P0 visible bas, 5 cartes; Hand P1 visible haut, 5 cartes
    (cardback côté SOLO car omniscient).

### T1 — Switch sans chain

- **Setup** : T0 atteint, idle phase, aucune chain en cours.
- **Action** : `switchPerspective()`.
- **Assertions** :
  - `perspective() === 1` au prochain tick.
  - Transform CSS `rotate(180deg)` appliqué sur `.board-host` (lecture
    `getComputedStyle().transform === 'matrix(-1, 0, 0, -1, 0, 0)'`).
  - Stream contient `PerspectiveSwitched(0, 1)` à ref N.
  - `activeChainLinks() === []` (inchangé).
  - `_switching` reflip à false après 300ms.
  - Re-`switchPerspective()` 100ms après → no-op (`_switching` guard).

### T2 — Switch pendant chain résolvant (test de victoire bug SOLO)

- **Setup** : T0 atteint, P0 active Lukias effect (ou D/D équivalent),
  Ash Blossom ou similaire chaîne CL2. Chain `building → resolving`,
  pending entry CL2 toujours présent.
- **Action** : `switchPerspective()` mid-resolution, avant `MSG_CHAIN_END`.
- **Assertions** :
  - `perspective() === 1` au tick.
  - **`activeChainLinks().length === 2`** (préservé — c'est le point
    cardinal de γ).
  - **`pendingChainEntry()` inchangé** (preuve que le processor n'a pas
    été reset).
  - **`chainPhase() === 'resolving'`** (préservé).
  - Locks RBS préservés (le `assertNoLocks()` ne fire pas).
  - Le `MSG_CHAIN_SOLVING(2)` qui suit s'applique sur le link existant
    (pas de WARN `chainIndex 2 not in active links []`).
  - Le `MSG_MOVE` de cost finit son travel sous la perspective 1
    (atterrit dans le bon référentiel CSS).
  - **Aucun `Lock safety timeout HAND-X/GY-X`** dans la console (cf.
    bug-solo-sequence.md §5 symptôme A).
  - **Aucun `POLL-DROP REGRESSION`** dans la console (cf. symptôme B).
  - À `MSG_CHAIN_END`, `activeChainLinks() === []`, `chainPhase() === 'idle'`.

### T3 — Rematch

- **Setup** : Duel terminé (MSG_WIN reçu), bouton rematch dispo des
  deux côtés.
- **Action** : déclencher REMATCH_REQUEST des deux côtés (auto-accept
  côté `setupRematchEffects`).
- **Assertions** :
  - REMATCH_STARTING reçu sur les 2 transports.
  - `applyCheckpoint({RematchStarted})` appelé sur le processor partagé,
    UNE seule fois (pas de double-reset).
  - Stream contient `EffectAbandoned(reason='checkpoint')` pour tout
    DeferredEffect qui était actif (cf. §3.7bis chantier).
  - `activeChainLinks() === []`, `chainPhase() === 'idle'`,
    `pendingChainEntry() === null`.
  - `perspective() === 0` (convention rematch).
  - Transform CSS retour à `rotate(0deg)`.
  - Boundary processor : tous groupes fermés (`forceClosure('checkpoint')`).
  - Nouveau duel démarre proprement (MSG_NEW_TURN reçu, 5 MSG_DRAW).

### T4 — STATE_SYNC mid-duel (F5 refresh simulé)

- **Setup** : T0 atteint, P0 vient de jouer 1 carte, board ≠ état initial.
- **Action** : simuler refresh (cleanup + re-init avec mêmes tokens →
  serveur renvoie STATE_SYNC).
- **Assertions** :
  - STATE_SYNC reçu sur les 2 transports (séquentiel, pas simultané —
    réseau).
  - **Premier** STATE_SYNC déclenche `applyCheckpoint({STATE_SYNC, body})`.
  - **Second** STATE_SYNC arrive après — assertion à figer : soit
    no-op idempotent (preferred), soit second reset acceptable mais
    silencieux. Choix à acter en commit (cf. §7 risque R4 ci-dessous).
  - Board re-rendu reflète l'état du checkpoint payload.
  - `perspective() === 0` (re-init).
  - Aucun lock orphelin, aucun DeferredEffect orphelin.

### T5 — Switch pendant DeferredEffect actif

- **Setup** : P0 active Ash Blossom (cost MSG_MOVE en cours), DEP a
  émis `DeferredEffect('overlay-show:chain-2', ...)` en attente du
  AnimationCompleted du MOVE.
- **Action** : `switchPerspective()` PENDANT l'animation du cost.
- **Assertions** :
  - Le DeferredEffect SURVIT au switch (CONNECTION_LIFETIME, pas
    PERSPECTIVE).
  - Le MSG_MOVE finit son animation sous la nouvelle perspective.
  - `AnimationCompleted` fire à la fin du travel.
  - DEP émet `EffectReady('overlay-show:chain-2')`.
  - `OverlayShowReadyProjection` reflète l'ajout au prochain tick.
  - L'overlay apparaît sous la perspective 1 (composant chain-overlay
    re-parenté dans `.board-host`, cf. POC §3 Mode A).

### T6 — Switch pendant burst WS de N MSG_CHAIN_SOLVING

- **Setup** : Chain longue 4 liens en cours de résolution, serveur
  envoie SOLVING/SOLVED en burst.
- **Action** : `switchPerspective()` au milieu du burst.
- **Assertions** :
  - Tous les SOLVING/SOLVED arrivent au processor partagé dans l'ordre.
  - Aucun message perdu (chainPhase atteint `idle` à MSG_CHAIN_END).
  - Aucun `chainIndex N not in active links []` WARN.
  - Aucun `POLL-DROP REGRESSION`.

### T7 — Replay non-régression (perspectiveSwitched n'arrive jamais en replay)

- **Setup** : ouvrir un replay arbitraire (e.g.
  `db88ea27-7485-4285-aeae-ae4023f3b9c6`).
- **Action** : play start → end, sans toucher au switch perspective du
  replay-page.
- **Assertions** :
  - Le stream du replay-adapter ne contient AUCUN `PerspectiveSwitched`.
  - Aucune projection PERSPECTIVE_LIFETIME ne reset en cours de replay.
  - L'état final atteint = oracle V1 (snapshot capturé pré-chantier,
    cf. §4.5 chantier).

### T8 — Switch immédiat post-mount (race condition)

- **Setup** : init() vient d'être appelé, `BOARD_STATE` pas encore reçu
  (boardActive=false).
- **Action** : `switchPerspective()` dans la fenêtre `connecting →
  duel-loading`.
- **Assertions** :
  - Pas de crash (pas d'accès à un signal nil).
  - L'événement `PerspectiveSwitched` est émis mais le visual flip
    attend que `.board-host` soit monté.
  - L'ouverture du duel (dice arena → active) procède normalement.
  - Le drainPreActivationBuffer est cohérent (les MSG_DRAW initiaux
    s'animent sous la nouvelle perspective).

### T9 — Double switch rapide (debounce)

- **Setup** : T1 atteint, `switching=false`.
- **Action** : appel rapide `switchPerspective(); switchPerspective(); switchPerspective();`
  dans la même macro-tâche.
- **Assertions** :
  - 1 seul `PerspectiveSwitched` émis (le premier).
  - Les 2 suivants sont logged + skipped.
  - 300ms après, `switching=false`, un nouveau switch est possible.

### T10 — Switch pendant prompt actif

- **Setup** : prompt SELECT_CARD ou autre interactive ouvert pour P0.
- **Action** : `switchPerspective()`.
- **Assertions** :
  - No-op explicite (logged "skipped: prompt active").
  - `perspective()` inchangée.
  - Prompt reste ouvert sur le même transport, intact.
  - Le user doit fermer le prompt avant de pouvoir switch (UX cohérente
    avec convention POC §5.2).

### Implémentation des tests

- **T0, T1, T7, T9** : spec unit pure (mocks de transports). Rapides.
- **T2, T3, T4, T5, T6, T8, T10** : Playwright E2E contre une session
  SOLO live (back/duel-server up). Plus lents mais nécessaires car les
  invariants concernent l'enchaînement temporel de messages WS réels.
- **Harness recommandé** : étendre `debug-replay-harness.ts` (cf.
  CLAUDE.md "Playwright debug harness") avec un mode SOLO. Capture
  console + snapshot état + screenshot au moment du switch. Le snapshot
  + le test absence des 2 symptômes constituent l'oracle de victoire.

---

## 6. Sort du `BufferReplayBuilder`

### 6.1 Statut acté

Le doc chantier (§4.1 ligne 907) statue : **`BufferReplayBuilder` est
jeté** en β. Effort gain net = **−5j**.

### 6.2 Pré-requis ou parallèle ?

**Décision** : **jeté en β, pas en γ**. Raisonnement :

1. Son rôle (replay buffer post-chain-resolution avec 3-pass batch
   construction) est absorbé par le flux unique + les frontières
   `ChainStarted/Ended` + le DEP. Tout ça est livré en β.
2. γ dépend uniquement du flux unique (single processor) — γ ne
   réintroduira pas de buffer construction.
3. Garder le builder en cohabitation avec un single-processor SOLO
   créerait un cas dégénéré : le buffer drain à `chainEnd` chercherait
   les pre-locks sur l'unique RBS, lockés par les 2 transports en
   parallèle — risque de corruption non documenté.

**Conséquence opérationnelle** : si β n'a pas jeté le builder, γ ne
peut PAS démarrer. C'est un blocker. Le commit-0 de γ vérifie l'absence
du fichier `buffer-replay-builder.ts` + l'absence d'imports résiduels.

**Cas de figure parallèle gain ~5j** : la "jetée en parallèle" évoquée
par l'invite veut dire jeter le builder pendant que γ se construit, en
mode opportuniste. Ma reco : **non**. Le builder est intriqué avec
`replayBuffer()` de l'orchestrator et avec le contrat de pre-locks
(cf. CLAUDE.md "Buffer Replay Batch Construction"). Le retirer pendant
qu'on touche le processor SOLO multiplie le risque de régression
silencieuse. Mieux vaut **séquentiel β → γ**.

---

## 7. Découpe en commits

8 commits atomiques, ordre fixé par les dépendances. Chaque commit
laisse `master` (ici `feat/anim-pipeline-v2`) compilable + tests verts.

### Commit 1 — Pré-flight check

**Titre** : `chore(anim-v2): γ — pre-flight check pour single-processor refactor`

- Vérifier que β a livré : DEP, BoundaryProcessor, `BufferReplayBuilder`
  jeté, directive `announcement`. Si manque, échouer en early.
- Fixer l'erreur TS pré-existante
  `solo-duel-orchestrator.service.ts:50-51` (`onStateSync` signature
  `() => void` mais on passe `msg`) — cf. mémoire pitfalls §6. Sinon
  Angular ne compile pas.
- Capturer le snapshot V1 SOLO de référence (3-5 replays canoniques
  rejoués SOLO, état final sérialisé) pour les tests parité.
- Aucun changement structurel.

**Dépend de** : aucun. **Effort** : petit, ~2h.

### Commit 2 — Extraction `DuelEventProcessor` au niveau orchestrator

**Titre** : `refactor(anim-v2): γ — DuelEventProcessor partagé via AnimationOrchestratorService`

- Remonter l'instanciation de `DuelEventProcessor` de `DuelConnection`
  vers `AnimationOrchestratorService` (1 instance par scope orchestrator).
- Exposer `orchestrator.processor` (readonly).
- `DuelConnection` reçoit le processor partagé via setter ou param ctor
  au lieu d'instancier le sien — applicable **PvP normal + replay
  inchangé** (le replay continue à instancier le sien dans
  `ReplayDuelAdapter`).
- Specs : adapter les mocks (`duel-page.component.spec.ts:113`,
  `replay-page.component.spec.ts:118` restent inchangés ; les specs PvP
  qui instancient `DuelConnection` doivent passer un processor partagé).

**Dépend de** : commit 1. **Effort** : moyen, ~6h.

### Commit 3 — `SoloTransport` minimal + `SoloDuelOrchestratorService` refondu

**Titre** : `refactor(anim-v2): γ — SoloDuelOrchestratorService single-processor`

- Créer `SoloTransport` (cf. §2.3). Décision pratique : extraire d'un
  `DuelConnection` une classe abstraite `DuelTransport` qui ne porte
  PAS de processor, puis 2 sous-classes
  (`PvPDuelConnection` ≈ `DuelConnection` actuelle conservée, et
  `SoloTransport` minimaliste). Voir §8 risque R8 pour l'option mono-classe.
- Réécrire `SoloDuelOrchestratorService` selon §2.1.
- `switchPlayer()` → `switchPerspective()` (renommage public, le call
  site `pvp-board-container.component` reste à mettre à jour).
- Émission `PerspectiveSwitched` via
  `orchestrator.notifyPerspectiveSwitch(from, to)`.
- Suppression de `clearAnimationQueueOnly` (le single processor n'en
  a plus besoin) et `clearLastSelections` reloge côté transport.
- Specs : `solo-duel-orchestrator.service.spec.ts` à créer (n'existe
  pas aujourd'hui).

**Dépend de** : commit 2. **Effort** : gros, ~10h.

### Commit 4 — Migration `DuelWebSocketService`

**Titre** : `refactor(anim-v2): γ — DuelWebSocketService lit le processor partagé`

- Suppression de `_activeConnection`.
- Computed du tableau §3.3 réorientés : `pendingChainEntry`,
  `activeChainLinks`, `chainPhase`, `animationQueue`, `boardStateView`,
  `cardCodes` → lecture directe du processor partagé.
- Les autres signals (transport-local) → `_transports[perspectiveIndex]`
  avec dépendance reactive sur `DuelContext.perspective()`.
- `setActiveConnection` supprimée.
- `bindSharedProcessor` + `bindTransports` ajoutés.

**Dépend de** : commit 3. **Effort** : moyen, ~6h.

### Commit 5 — Émission `PerspectiveSwitched` + dispatch reset

**Titre** : `feat(anim-v2): γ — PerspectiveSwitched event + PERSPECTIVE_LIFETIME dispatch`

- Ajouter le type `PerspectiveSwitchedEvent` à
  `pvp/types.ts` (famille transport) ou nouvelle union
  `TransportEvent`.
- `AnimationOrchestratorService.notifyPerspectiveSwitch(from, to)` →
  `pushToStream({...PerspectiveSwitchedEvent})`.
- ScopeResetDispatcher gère déjà PERSPECTIVE_LIFETIME (livré en α.4) —
  vérifier qu'il dispatche `applyReset({PERSPECTIVE_LIFETIME})` sur
  observation de cet event.
- DEP : confirmer que `PerspectiveSwitched` ne déclenche PAS
  d'`EffectAbandoned` (cf. §3.7bis chantier).
- BoundaryProcessor : confirmer que `PerspectiveSwitched` ne ferme PAS
  les groupes (un switch n'est pas un checkpoint).

**Dépend de** : commit 4. **Effort** : moyen, ~4h.

### Commit 6 — `PerspectiveProjector` (refactor `CardTravelEngine` coords container-relative)

**Titre** : `feat(anim-v2): γ — perspective projector (S3 coords container-relative)`

- Modifier `CardTravelEngine.registerContainer(boardHost)` au lieu du
  duel-page host.
- Refactor `card-travel-helpers.ts` deltas viewport → container-local.
- Alignement `BoardEffectsService._container` sur `.board-host`.
- Re-parent `app-pvp-chain-overlay` sous `.board-host` (5-10 lignes
  HTML, cf. POC J3 surprise §8.4).
- `DuelContext.cardBaseRotation` perspective-aware (option B.1 POC §2).
- Mode B sur texte LP + deltas (contre-rotation conditionnée).
- Effect bubble : test CDK re-positioning (cf. POC risques §9).

**Dépend de** : commit 5 (a besoin du signal `perspective` câblé via
DuelContext). **Effort** : gros, ~12h. Cf. POC §5 (5-6.5j estimé total
sur le bloc projection).

### Commit 7 — Tests T0-T10 + parité V1

**Titre** : `test(anim-v2): γ — séquence T0-T10 + parité oracle V1`

- Spec unit pour T0, T1, T7, T9.
- Playwright E2E pour T2, T3, T4, T5, T6, T8, T10.
- Étendre `debug-replay-harness.ts` avec mode SOLO (capture console +
  snapshot + screenshot).
- Re-run du test parité V1 SOLO contre les snapshots du commit 1 —
  diff = 0 sauf le bug SOLO (résolu : diff attendu).

**Dépend de** : commit 6. **Effort** : gros, ~10h.

### Commit 8 — Cleanup + documentation

**Titre** : `docs(anim-v2): γ — CLAUDE.md sync + cleanup résidus`

- Mettre à jour CLAUDE.md section "Animation Parity Rule" + "Orchestrator
  Decomposition" pour refléter le single-processor SOLO.
- Mémoire utilisateur : déprécier `pvp-solo-chain-state-hygiene-2026-05-23`
  (bug fermé), nouveau memo `phase-gamma-shipped`.
- Supprimer le code mort éventuel (`clearAnimationQueueOnly`,
  `setActiveConnection`, etc. — vérifier qu'aucun consommateur résiduel
  n'existe).

**Dépend de** : commit 7. **Effort** : petit, ~2h.

### Récapitulatif effort

| Commit | Taille | Heures |
|---|---|---|
| 1 — pre-flight | petit | 2 |
| 2 — extraction processor | moyen | 6 |
| 3 — SoloTransport + service refondu | gros | 10 |
| 4 — wsService migration | moyen | 6 |
| 5 — PerspectiveSwitched event | moyen | 4 |
| 6 — PerspectiveProjector | gros | 12 |
| 7 — tests T0-T10 | gros | 10 |
| 8 — cleanup + docs | petit | 2 |
| **Total** | | **52h ≈ 7j dev** |

Cohérent avec l'estimation chantier §4.4 : "SoloDuelOrchestratorService
reformé : 5-7j" + POC §5 "5-6.5j" pour le bloc projection. La somme
brute (~12.5j) est tassée par parallélisme conceptuel et réutilisation
de l'infra α/β. **Cible 7-9 jours dev solo**.

---

## 8. Risques & mitigations

### R1 — Ordre de réception STATE_SYNC sur les 2 transports

**Risque** : en SOLO, les 2 sockets reçoivent leur propre STATE_SYNC au
refresh (le serveur les considère comme 2 reconnexions distinctes).
Ordre non garanti. Deux STATE_SYNC consécutifs sur le processor partagé
pourraient cascader 2 resets.

**Mitigation (actée 2026-05-26)** : **mesurer d'abord, déduper ensuite**.
Le commit 4 ajoute un `logger.log(DuelLogCategory.PIPELINE, ...)` à
chaque `applyCheckpoint` avec un résumé du payload (roomId, sessionId,
seq, timestamp). Au premier test T4 réel, observer les 2 STATE_SYNC
consécutifs et figer le predicat de dédup selon le résultat :

- **Payloads strictement identiques** → dédup par hash payload + fenêtre
  500ms (`lastCheckpointHash` + `lastCheckpointAt`).
- **Payloads différents** (un par identité serveur, e.g. seq distinct)
  → accepter les 2, garantir que le 2ème est idempotent (le second
  `applyCheckpoint` applique le même état logique → no-op observable
  côté projections).

Predicat figé à T4 puis intégré au commit 5. Pas d'invention spéculative
avant la mesure.

### R2 — Race switchPerspective ↔ message WS en transit

**Risque** : un `MSG_CHAIN_SOLVING` arrive sur le transport entrant
juste avant le `switchPerspective()`, mais Angular n'a pas encore
ticked. Le processor a déjà l'event mais le ScopeResetDispatcher
n'a pas encore couru. Une projection PERSPECTIVE_LIFETIME pourrait
voir un état post-SOLVING avec une perspective pre-flip.

**Mitigation** : le contrat est que `PerspectiveSwitched` est émis sur
**la même synchronie** que l'événement précédent du flux. Angular tickera
le tout au prochain microtask. Concrètement, `notifyPerspectiveSwitch`
est synchrone et `pushToStream` synchronise les observateurs DEP/BP.
Le risque résiduel est négligeable mais le test T6 (burst SOLVING +
switch) doit le valider.

### R3 — Replay régression (PerspectiveSwitched fuite sur replay-page)

**Risque** : si on émet `PerspectiveSwitched` aussi côté replay (par
souci d'unification future), les projections du replay-page se reset
à chaque flip → animations cassées en cours de replay.

**Mitigation** : γ **n'émet PAS** côté replay. Le `perspectiveIndex()`
signal local du `replay-page.component` continue à piloter son
`PerspectiveProjector` indépendamment. Test T7 garantit la non-régression.
Unification = δ, hors scope γ.

### R4 — Double-reset au rematch

**Risque** : `applyCheckpoint({RematchStarted})` est appelé par
`setupRematchEffects` quand les 2 transports reçoivent
`REMATCH_STARTING`. Si un transport recoit le message 2× (retry serveur),
on cascade 2 checkpoints.

**Mitigation** : applique le mécanisme figé à R1 (mesurer puis déduper
ou idempotence). Couvert par T3 (rematch nominal) + variante
adversariale à ajouter en δ.

### R5 — Transport-local accumulators désynchronisés

**Risque** : `_lastConfirmedCards` côté transport 0 contient les
révélations de P0. Si l'utilisateur switch sur perspective 1 et qu'un
nouveau prompt arrive sur transport 1, le `wsService.lastConfirmedCards`
lit le transport 1 (vide) → la zone "revealed cards" du prompt-dialog
est vide alors qu'elle devrait afficher l'historique P0.

**Mitigation** : c'est le comportement *correct* — les révélations P0
ne s'appliquent pas à un prompt qu'on répond depuis P1. La régression
visuelle observée historiquement (cf. mémoire M16 du `clearLastSelections`)
était l'inverse : les accumulateurs P0 fuitaient vers les prompts P1.
γ préserve l'isolation. Test à ajouter : "prompt P1 après reveal P0
n'affiche pas les cards P0".

### R6 — Locks partagés entre les 2 transports

**Risque** : single RBS = single map de locks. Les MSG_MOVE de
transport 0 et transport 1 peuvent locker la même zone simultanément
en théorie. En pratique le serveur sérialise (un seul transport actif
côté game state à la fois), mais la garantie n'est pas dans le code
front.

**Mitigation** : le ref-counting actuel des locks (`lockZone` +
`commitZone`) le gère naturellement — un lock acquis 2× se commit
après 2 release. Documenter cette propriété dans CLAUDE.md. Aucun
changement code requis. Validation par T2 + T6.

### R7 — Composants qui supposent `_activeConnection`

**Risque** : des composants en dehors de `wsService` lisent directement
une `DuelConnection` (e.g. via DI ou via une autre couche). Grep
exhaustif requis pour ne rien laisser orphelin.

**Mitigation** : avant commit 4, faire un `grep -r "DuelConnection"
front/src/app/pages/pvp/` et trier les call sites. Probablement zéro
en dehors de `SoloDuelOrchestratorService` + `DuelWebSocketService` +
les specs, mais à vérifier.

### R8 — Architecture transport (acté : option C)

**Risque** : extraire une classe abstraite `DuelTransport` partagée
entre PvP normal et SOLO ajoute de l'abstraction. Garder
`DuelConnection` (PvP normal) inchangée et créer `SoloTransport`
indépendant duplique 60% du code (WS, tokens, ping/pong).

**Décision actée (2026-05-26)** : **option C — `DuelConnection`
reconfigurable**. Un flag `usesSharedProcessor: boolean` au constructor.
Si `true`, la connection prend un `DuelEventProcessor` injecté et
s'abstient d'en instancier un. Si `false`, comportement actuel
(processor propre).

Implications pour le commit 3 :
- La nouvelle classe `SoloTransport` est en fait une **instanciation
  configurée** de `DuelConnection` (`usesSharedProcessor: true`), pas
  une classe distincte. Le nommage "SoloTransport" reste comme alias
  conceptuel dans la doc/§2 mais le type runtime est `DuelConnection`.
- Le call site SOLO (`SoloDuelOrchestratorService.init`) instancie
  `new DuelConnection(..., { usesSharedProcessor: true, sharedProcessor })`.
- Le call site PvP normal reste inchangé (flag par défaut `false`).

Options A et B rejetées :
- A (abstraction) — touche PvP normal pour zéro bénéfice fonctionnel.
- B (duplication) — ~150 lignes de WS/tokens/ping copiées = source de
  bugs futurs.

Si δ veut nettoyer en allant vers A post-stabilisation, le passage C→A
se fait par extraction mécanique (les call sites consomment l'API
publique, pas les internes).

### R9 — POC projection : surprise sur un trajet exotique

**Risque** : POC §5 ligne 178 mentionne *"+1j pour gérer surprises sur
des trajets exotiques (Pendulum, Link materials, mass destroy
multi-tribute)"*. La refactor coords container-relative pourrait
casser ces cas non-testés au POC.

**Mitigation** : commit 6 commence par re-exécuter les specs
`poc-projection-board.spec.ts` (U1-U4) contre une session SOLO live.
Si un cas casse, isoler en sous-commit avec test minimal de repro.
Marge effort déjà incluse dans le chiffrage (12h ≈ 1.5j POC + marge).

### R10 — DuelGameLogService au switch (acté : figé à l'émission)

**Risque** : le journal est DUEL_LIFETIME, donc survit au switch. Mais
le journal est aujourd'hui alimenté par le tap sur `orchestrator.eventStream`.
Si la perspective change, les entrées suivantes du journal sont-elles
"vues par P0" ou "vues par P1" ?

**Décision actée (2026-05-26)** : **journal figé à l'émission**. Le
switch ne ré-écrit pas l'historique. Chaque ligne capture la phrase
telle qu'elle a été émise sous la perspective du moment.

Justification : le journal est la chronique causale du duel. Une
réécriture rétroactive ("Opponent: ..." qui devient "You: ..." après
switch) casse l'idée de chronique immuable et est mentalement coûteux
pour le lecteur. Si l'utilisateur veut "lire le duel sous P1", il
switch *avant* de lire ; pas après.

Implications code (à vérifier en commit 7) :
- `DuelGameLogService.notifyGameLog` doit capturer la string formatée
  (ou la perspective relative) à l'append, PAS à lire
  `DuelContext.perspective()` au render. Si le code actuel lit au
  render, c'est un bug latent à corriger au commit 7.
- Test T1 étendu : "switch après un événement de journal, vérifier que
  la ligne préfixée 'Opponent:' reste préfixée 'Opponent:' après le
  flip" (et symétriquement pour 'You:').

**À investiguer en commit 7 (tests), corriger si le code lit au render.**

---

## 9. Estimation effort (récapitulatif)

| Commit | Taille | Heures | Notes |
|---|---|---|---|
| 1 — pre-flight check | petit | 2 | gating ; fix TS error pré-existant inclus |
| 2 — extraction processor | moyen | 6 | inversion d'instanciation ; impact PvP normal |
| 3 — SoloTransport + service refondu | gros | 10 | cœur architectural ; décision R8 à figer |
| 4 — wsService migration | moyen | 6 | tri des 30 computed lignes 70-99 |
| 5 — PerspectiveSwitched event | moyen | 4 | event + dispatch déjà 80% câblé par α.4 |
| 6 — PerspectiveProjector | gros | 12 | coords + re-parent + cardBaseRotation + mode B |
| 7 — tests T0-T10 | gros | 10 | mix unit + Playwright ; harness debug à étendre |
| 8 — cleanup + docs | petit | 2 | CLAUDE.md + memory sync |
| **Total** | | **52h** | **≈ 7 jours dev solo** |

Marge pour surprises (R9 + R10 + adversarial) : **+1.5j**.

**Cible γ : 8-9 jours dev solo**.

Cohérent avec `duel-session-chantier.md §4.4` (5-7j SOLO refondu + 5-6.5j
projection = 10-13j brut, tassé à ~9j par overlap commit 5+6).

---

## 10. Définition de "γ livrée"

γ est livrée ssi :

1. Les 8 commits sont mergés sur `feat/anim-pipeline-v2`.
2. T0-T10 passent tous (PASS strict, pas de skip).
3. Le snapshot V1 SOLO de référence (commit 1) match l'état post-γ
   modulo les 2 deltas attendus :
   - Le bug SOLO (séquence `bug-solo-sequence.md` T0-T10) ne reproduit plus.
   - Les éventuels micro-deltas de timing dus au PerspectiveProjector
     (~250ms transition CSS).
4. Aucun nouveau warning console catégorie `RESOLVE`, `PIPELINE`, `RUNNER`,
   `CHAIN` en dehors des warns existants documentés.
5. CLAUDE.md sections "Animation Parity Rule", "Orchestrator Decomposition",
   "Perspective Convention" mises à jour.
6. Mémoire `pvp-solo-chain-state-hygiene-2026-05-23` marquée résolue,
   nouvelle mémoire `phase-gamma-shipped` créée.

Post-γ : phase **δ** (backlog résiduel, post-livraison) — extensions
PerspectiveProjector pour replay unifié, retrait définitif des classes
abstraites éventuelles, optimisation FPS Safari iOS, etc. Hors scope γ.

---

_Spec close 2026-05-26. Le doc est désormais le référentiel d'implémentation
de la phase γ. Modifications structurelles ultérieures (ajout d'un commit,
changement de l'API publique du service refondu) doivent passer par une
itération de revue avant d'être appliquées au code._
