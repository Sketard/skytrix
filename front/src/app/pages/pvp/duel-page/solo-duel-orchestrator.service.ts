import { computed, DestroyRef, effect, inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DuelConnection } from './duel-connection';
import { DuelWebSocketService } from './duel-web-socket.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DebugLogService } from './debug-log.service';
import { DuelLogger, DuelLogCategory } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelContext } from './duel-context';

/**
 * γ commit 3 (2026-05-26) — single-processor SOLO refondu (§2 phase-gamma-spec.md).
 *
 * Refonte structurelle : les 2 `DuelConnection` instanciées en SOLO
 * partagent désormais le `DuelEventProcessor` unique de
 * `AnimationOrchestratorService.processor` (commit 2). Plus de double
 * processor désynchronisé au switch — c'est ce qui élimine par
 * construction le bug `bug-solo-sequence.md` (chain orpheline sur la
 * connection sortante).
 *
 * Sémantique du switch :
 *   - `switchPerspective()` (anciennement `switchPlayer`) ne bascule
 *     PAS de processor : il modifie la valeur courante de
 *     `DuelContext.perspective()`.
 *   - L'état chain (activeChainLinks, chainPhase, pendingChainEntry,
 *     buffer chain) survit au switch (CONNECTION_LIFETIME).
 *   - Les projections PERSPECTIVE_LIFETIME (LP animatingPlayer, battle
 *     attack, target reticles, etc.) seront reset par le dispatch
 *     `applyReset({PERSPECTIVE_LIFETIME})` câblé au commit 5
 *     (PerspectiveSwitched event sur le flux + ScopeResetDispatcher).
 *
 * Pour ce commit 3, `notifyPerspectiveSwitch` est un stub volontairement
 * vide (TODO commit 5). Le service expose déjà `switchPerspective()` +
 * le signal de perspective sur `DuelContext`, ce qui permet aux
 * consommateurs (composant duel-page, effect d'historique, futur
 * `PerspectiveProjector` au commit 6) de tracer le signal dès maintenant.
 *
 * R8 acté : pas de classe `SoloTransport` distincte. La même
 * `DuelConnection` se reconfigure via l'option `sharedProcessor` (§8
 * spec). Les 30 lignes de WS/tokens/ping/pong restent partagées entre
 * PvP normal et SOLO.
 */
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
  // 2 sockets parce que le serveur tient 2 identités joueur (un
  // SELECT_IDLECMD ne s'envoie qu'au joueur actif côté serveur).
  // CRITIQUE : ces 2 DuelConnection partagent le DuelEventProcessor
  // unique de l'orchestrator via l'option `sharedProcessor` (§2.3 +
  // §8 R8). Plus de divergence d'état possible au switch.
  private _connections = signal<[DuelConnection, DuelConnection] | null>(null);
  readonly connections = this._connections.asReadonly();

  // ───────────────────────────────────────────────
  //  Perspective — projection visuelle unique
  // ───────────────────────────────────────────────
  // Source unique de vérité = `DuelContext.perspective()` (signal
  // ajouté ci-dessous). Le service expose l'indice en lecture seule
  // pour les composants qui ne veulent pas injecter DuelContext.
  // Back-compat : l'ancien `activePlayerIndex` est un alias en
  // lecture seule sur le même signal, le temps que le commit 4
  // migre les consommateurs vers `perspectiveIndex` / le wsService.
  readonly perspectiveIndex = computed(() => this.duelCtx.perspective()());
  readonly activePlayerIndex = this.perspectiveIndex;

  // Debounce post-switch : empêche un double-click pendant la
  // transition CSS (~250ms, commit 6). Le composant duel-page tient
  // aussi son propre `switching` signal pour le bouton — celui-ci
  // protège l'orchestrator des ré-entrées programmées (rematch
  // restoration consécutive, par exemple).
  private _switching = signal(false);
  readonly switching = this._switching.asReadonly();

  // ───────────────────────────────────────────────
  //  Connectivité
  // ───────────────────────────────────────────────
  readonly connectionLost = computed(() => {
    const c = this._connections();
    return c !== null && (c[0].connectionStatus() === 'lost'
                       || c[1].connectionStatus() === 'lost');
  });

  // Rematch reset counter — sert au routing des effets de bord
  // (timers, animations) qui doivent se ré-initialiser à chaque
  // nouvelle partie.
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

    // Le processor unique vit sur AnimationOrchestratorService
    // (commit 2). On le passe aux deux connections via l'option
    // ctor `sharedProcessor` — chacune l'utilise au lieu d'en
    // instancier un. C'est l'inversion d'instanciation qui rend le
    // bug SOLO impossible par construction (§1 + §4 bug-solo-sequence.md).
    const sharedProcessor = this.animationService.processor;
    const conn0 = new DuelConnection(
      environment.wsUrl, true, 'duel-reconnect-token-p1', this.logger,
      { sharedProcessor },
    );
    const conn1 = new DuelConnection(
      environment.wsUrl, true, 'duel-reconnect-token-p2', this.logger,
      { sharedProcessor },
    );

    // Art service partagé pour le dédup de prefetch entre les 2 sockets.
    conn0.artService = this.artService;
    conn1.artService = this.artService;

    // Hooks debug.
    conn0.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn1.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn0.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);
    conn1.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);

    this._connections.set([conn0, conn1]);
    conn0.connect(token1);
    conn1.connect(token2);

    // γ commit 4 — wsService routing :
    //   · bindSharedProcessor → les lectures partagées (chain machine
    //     + animation queue) viennent du processor unique.
    //   · bindTransports → les lectures transport-local
    //     (pendingPrompt, timerState, rematchState, …) viennent de
    //     `_transports[perspective()]`, et le wsService câble lui-même
    //     les `onStateSync` des 2 connections avec un log PIPELINE
    //     pour R1 (mesure dédup checkpoint).
    // Perspective initiale = 0 (own player at bottom, default du
    // signal DuelContext.perspectiveSource).
    this.wsService.bindSharedProcessor(sharedProcessor);
    this.wsService.bindTransports(conn0, conn1);

    this.setupRematchEffects();
  }

  // ───────────────────────────────────────────────
  //  Switch de perspective
  // ───────────────────────────────────────────────
  /**
   * Bascule la perspective visuelle (P0 ↔ P1). Le processor n'est
   * PAS muté — ni `activeChainLinks`, ni `chainPhase`, ni les locks,
   * ni la queue d'animation. C'est la sémantique cible du chantier
   * (§1.2 spec). La projection visuelle complète arrive au commit 6
   * (PerspectiveProjector, rotate(180deg) sur `.board-host`).
   *
   * Le payload d'événement `PerspectiveSwitched` + le dispatch
   * `applyReset({PERSPECTIVE_LIFETIME})` arrivent au commit 5 ; ici
   * `notifyPerspectiveSwitch` est un stub volontairement vide.
   *
   * Convention §5.2 POC : pas de switch pendant prompt actif. La
   * garde sur `wsService.pendingPrompt()` est ajoutée ici pour
   * matérialiser la convention dès le commit 3 (test T10 sera vert
   * sans modif au commit 7).
   */
  switchPerspective(): void {
    const c = this._connections();
    if (!c) return;
    if (this._switching()) return;
    if (this.wsService.pendingPrompt() !== null) {
      this.logger.log(DuelLogCategory.PIPELINE, 'switchPerspective skipped: prompt active');
      return;
    }
    const from = this.duelCtx.perspective()() as 0 | 1;
    const to: 0 | 1 = from === 0 ? 1 : 0;
    this._switching.set(true);

    // Stub commit 5 : émission de PerspectiveSwitched sur le flux +
    // dispatch reset PERSPECTIVE_LIFETIME. Aujourd'hui no-op — le
    // call site existe et matérialise le contrat.
    this.animationService.notifyPerspectiveSwitch(from, to);

    // Flip CSS-driven (le board-host transform sera ajouté au commit 6).
    // Le wsService re-évalue ses computed transport-local sur cette
    // mutation (via `active()` qui lit `_transport_connections[perspective()]`).
    this.duelCtx.perspective().set(to);

    // Pas de `setActiveConnection` — supprimé au commit 4. Pas de
    // `clearAnimationQueueOnly` (le processor est unique, rien à
    // clear). Pas de `clearLastSelections` (accumulateurs prompt-flow
    // transport-local — restent attachés à leur identité serveur, le
    // wsService les lira via `_transports[perspective()]`).
    // `setBoardActive(true)` reste pour le transport entrant : sans
    // cet appel, une connection qui n'a jamais reçu son BOARD_STATE
    // initial garderait `_boardActive=false` et bufferiserait ses
    // BOARD_CHANGING events au lieu de les jouer.
    c[to].setBoardActive(true);

    // Debounce post-transition (durée alignée sur la future
    // transition CSS .board-host transform 250ms + marge).
    setTimeout(() => this._switching.set(false), 300);
  }

  /**
   * Back-compat : ancien nom public. Délègue à `switchPerspective`.
   * Les call sites consommateurs (duel-page.component.ts:622, 828)
   * sont migrés vers le nouveau nom dans le même commit ; cet alias
   * reste pour les éventuels appels résiduels et les specs en
   * transition. À retirer au commit 8 (cleanup).
   */
  switchPlayer(): void {
    this.switchPerspective();
  }

  // ───────────────────────────────────────────────
  //  Rematch
  // ───────────────────────────────────────────────
  /**
   * Quand les 2 transports reçoivent REMATCH_STARTING, on déclenche
   * un seul reset orchestrator (`resetForSwitch` aujourd'hui, sera
   * remplacé par `applyCheckpoint({RematchStarted})` au commit 5).
   * Plus de double-reset façon ancien code (1 par connection × 2 =
   * 2 cascades indépendantes).
   */
  private setupRematchEffects(): void {
    const c = this._connections();
    if (!c) return;

    runInInjectionContext(this.injector, () => {
      // Auto-accept rematch invitation côté transport (un par identité).
      effect(() => {
        if (c[0].rematchState() === 'invited') c[0].sendRematchRequest();
        if (c[1].rematchState() === 'invited') c[1].sendRematchRequest();
      }, { allowSignalWrites: true });

      // Quand les deux transports voient REMATCH_STARTING :
      effect(() => {
        const s0 = c[0].rematchStarting();
        const s1 = c[1].rematchStarting();
        if (s0 && s1) {
          // Un seul reset orchestrator (PERSPECTIVE_LIFETIME aujourd'hui ;
          // sera étendu en DUEL_LIFETIME cascade au commit 5).
          this.animationService.resetForSwitch();
          // Perspective P0 par convention en début de nouvelle partie.
          // Le wsService re-route ses lectures transport-local sur
          // _transports[0] via active() ; aucune `setActiveConnection`
          // requise (commit 4).
          this.duelCtx.perspective().set(0);
          c[0].resetRematchStarting();
          c[1].resetRematchStarting();
          this._rematchReset.update(v => v + 1);
        }
      }, { allowSignalWrites: true });
    });
  }

  // ───────────────────────────────────────────────
  //  Teardown
  // ───────────────────────────────────────────────
  cleanup(): void {
    const c = this._connections();
    if (c) {
      c[0].clearStorageToken();
      c[1].clearStorageToken();
      c[0].cleanup();
      c[1].cleanup();
    }
    // Processor unique : cleanup pris en charge par
    // AnimationOrchestratorService.destroy() (déjà câblé par destroyRef).
  }
}
