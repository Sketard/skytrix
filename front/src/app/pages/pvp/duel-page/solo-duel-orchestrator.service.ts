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
 * γ Option C — PR2 c6a (2026-05-29) — SOLO multiplex mono-connection.
 *
 * Le SOLO part désormais d'**une seule** `DuelConnection`. Le serveur
 * broadcast omniscient les 2 identités joueur par cette même socket
 * (PR1 A1 + A10 + A11 + A28). La projection visuelle (qui voit la
 * board P1 vs P2) reste pilotée par `DuelContext.perspective()`, écrit
 * ici par `switchPerspective()`.
 *
 * Le bug `bug-solo-sequence.md` (chain orpheline au switchPlayer)
 * disparaît par construction : il n'y a plus 2 processors à
 * désynchroniser, parce qu'il n'y a plus 2 connections. La
 * `DuelConnection` unique instancie son propre processor (path PvP-normal
 * réutilisé tel quel) ; `sharedProcessor` n'est plus nécessaire.
 *
 * A21 invariant — pair flip des 2 flags soloMode :
 *   · `wsService.setSoloMode(true)` (signal réactif c5b BH-2) : pilote
 *     `slotIndex()` + `sendForPlayer()` côté wsService computeds.
 *   · `conn.soloMode = true` (boolean field c4.4) : pilote le swap
 *     BOARD_STATE pour perspective=1.
 *
 * Les deux DOIVENT être flippés ENSEMBLE avant `connect()`. Refactor
 * possible plus tard (c8 cleanup) : faire de `DuelConnection.soloMode`
 * un getter dérivé du `wsService.soloModeSource`. Pour c6 on garde le
 * flip explicite avec ce commentaire load-bearing.
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
  //  Transport WS — 1 connection multiplex
  // ───────────────────────────────────────────────
  // Le serveur tient les 2 identités joueur derrière la même socket
  // (broadcast omniscient SOLO, PR1 A1+A10). Les `forPlayer` taggués
  // par les sendXxx (c5c) sélectionnent l'identité côté serveur ; la
  // perspective visuelle (`duelCtx.perspective()`) sélectionne quel
  // slot du `DuelConnection._slots[]` (c4.1) le wsService projette.
  // _transport_*: per α.1 tagging convention, internal transport state.
  private readonly _transport_connection = signal<DuelConnection | null>(null);
  readonly connection = this._transport_connection.asReadonly();

  // ───────────────────────────────────────────────
  //  Perspective — projection visuelle unique
  // ───────────────────────────────────────────────
  // Source unique de vérité = `DuelContext.perspective()` (signal
  // ajouté ci-dessous). Le service expose l'indice en lecture seule
  // pour les composants qui ne veulent pas injecter DuelContext.
  readonly perspectiveIndex = computed(() => this.duelCtx.perspective()());

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
    const conn = this._transport_connection();
    return conn !== null && conn.connectionStatus() === 'lost';
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
  init(token1: string): void {
    this.enabled = true;

    // c5b BH-3 — la DuelConnection unique reçoit `duelCtx` pour que
    // le BOARD_STATE swap (perspective=1, c4.4) résolve `_duelCtx`
    // côté `shouldSwapForSolo`. Sans ça l'assertion `duelCtx must be
    // defined` throw au premier BOARD_STATE en SOLO P1.
    const conn = new DuelConnection(
      environment.wsUrl, true, 'duel-reconnect-token-solo', this.logger,
      { duelCtx: this.duelCtx },
    );

    // A21 — pair flip AVANT connect(). Voir doc de classe ci-dessus.
    // Ordre crucial : le premier BOARD_STATE qui arrive après `connect()`
    // doit passer par la branche soloMode du `shouldSwapForSolo` ; si
    // le flip arrive après l'OPEN du socket, on a 1 frame de board non-
    // swappé visible en perspective=1.
    conn.soloMode = true;
    this.wsService.setSoloMode(true);

    conn.artService = this.artService;
    conn.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);

    this._transport_connection.set(conn);

    // c6a — wsService routing : la `DuelConnection` unique SOLO devient
    // la source de vérité pour les 2 indices de `_transport_connections`
    // (le perspective() bascule entre deux slots du même `DuelConnection`,
    // pas entre deux conns). On passe (conn, conn) à `bindTransports`
    // pour que `active()` retourne `conn` quel que soit perspective().
    // `bindSharedProcessor` aligne `proc()` sur le processor de la conn
    // unique (sinon fallback `_defaultConnection.processor` orphelin).
    //
    // c8 cleanup : remplacer cet appel par `bindSoloConnection(conn)`
    // qui set les 2 slots à la même conn ET le sharedProcessor en un
    // seul mouvement ; nettoyer `_defaultConnection` orphan.
    this.wsService.bindSharedProcessor(conn.processor);
    this.wsService.bindTransports(conn, conn);

    conn.connect(token1);

    this.setupRematchEffect();
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
   * Convention §5.2 POC : pas de switch pendant prompt actif. La garde
   * sur `wsService.pendingPrompt()` matérialise la convention dès le
   * commit 3.
   */
  switchPerspective(): void {
    const conn = this._transport_connection();
    if (!conn) return;
    if (this._switching()) return;
    if (this.wsService.pendingPrompt() !== null) {
      this.logger.log(DuelLogCategory.PIPELINE, 'switchPerspective skipped: prompt active');
      return;
    }
    const from = this.duelCtx.perspective()() as 0 | 1;
    const to: 0 | 1 = from === 0 ? 1 : 0;
    this._switching.set(true);

    // Flip CSS-driven (le board-host transform sera ajouté au commit 6).
    // Le wsService re-évalue ses computeds per-perspective via
    // `slotIndex()` qui lit `perspective()` en SOLO.
    //
    // Ordre : signal flip AVANT `notifyPerspectiveSwitch` (post-review
    // H2, 2026-05-28). La dispatch `applyReset({PERSPECTIVE_LIFETIME})`
    // synchrone à l'intérieur de notifyPerspectiveSwitch doit voir la
    // NOUVELLE perspective si une projection lit `perspectiveSource`
    // dans son `applyReset`. Aucune projection ne le fait aujourd'hui,
    // mais le futur-proof zéro coût vaut mieux qu'un bug latent off-
    // by-one très subtil.
    this.duelCtx.setPerspective(to);

    // Émission de PerspectiveSwitched sur le flux + dispatch reset
    // PERSPECTIVE_LIFETIME.
    this.animationService.notifyPerspectiveSwitch(from, to);

    // `setBoardActive(true)` reste en c6a (A14 differé à c6c). Avec
    // 1 connection, l'appel est devenu équivalent à une no-op (la conn
    // est déjà active) mais on le garde pour ne pas merger c6c en c6a.
    conn.setBoardActive(true);

    // Debounce post-transition (durée alignée sur la future
    // transition CSS .board-host transform 250ms + marge).
    setTimeout(() => this._switching.set(false), 300);
  }

  // ───────────────────────────────────────────────
  //  Rematch
  // ───────────────────────────────────────────────
  /**
   * Avec 1 connection, REMATCH_STARTING arrive une fois et un seul
   * effect suffit. On bascule la perspective à 0 (convention début de
   * partie), acquitte le flag transport, et incrémente le compteur de
   * reset rematch. Le STATE_SYNC qui suit (≤300ms, broadcasté par le
   * serveur après `startDuelWithOrder`) déclenche le vrai reset
   * DUEL_LIFETIME via `onStateSync()`.
   *
   * c6b A27 — auto-accept skip en SOLO. Le serveur court-circuite la
   * gate "both requested" (A27 serveur, c6e) et démarre rematch dès le
   * 1er REMATCH_REQUEST. L'invitation REMATCH_INVITATION n'est plus
   * émise en SOLO, donc `rematchState === 'invited'` ne fire jamais.
   * Garde explicite quand même pour matérialiser l'invariant + éviter
   * un coût computed inutile si une régression serveur émettait à tort.
   *
   * c6b — renommé au singulier (`setupRematchEffect`) parce que la
   * sémantique est désormais "un signal, un effect" (la 2e moitié
   * `if (s0 && s1)` du legacy a disparu au c6a, forcée par le shift
   * `_connections` paire → `_transport_connection` singular).
   */
  private setupRematchEffect(): void {
    const conn = this._transport_connection();
    if (!conn) return;

    runInInjectionContext(this.injector, () => {
      // c6b A27 — auto-accept skip en SOLO (le serveur court-circuite
      // déjà, REMATCH_INVITATION pas émis). L'effect reste créé mais
      // sa condition d'entrée est garde-bloquée.
      effect(() => {
        if (this.wsService.soloModeSource()) return;
        if (conn.rematchState() === 'invited') conn.sendRematchRequest();
      });

      // REMATCH_STARTING reçu une fois ⇒ 1 reset orchestrator.
      effect(() => {
        if (conn.rematchStarting()) {
          // Perspective P0 par convention en début de nouvelle partie.
          this.duelCtx.setPerspective(0);
          conn.resetRematchStarting();
          this._rematchReset.update(v => v + 1);
          // Pas d'orchestrator.reset ici : STATE_SYNC qui suit déclenche
          // onStateSync({DUEL_LIFETIME}) qui purge tout proprement.
        }
      });
    });
  }

  // ───────────────────────────────────────────────
  //  Teardown
  // ───────────────────────────────────────────────
  cleanup(): void {
    const conn = this._transport_connection();
    if (conn) {
      conn.clearStorageToken();
      conn.cleanup();
    }
    // c6a — reset le signal + flag pour éviter qu'un consommateur lise
    // une `connection()` morte (signal `connectionStatus` figé sur la
    // dernière valeur, processor potentiellement détruit). Cohérent avec
    // le ré-init possible après navigation.
    this._transport_connection.set(null);
    this.enabled = false;
    // Processor unique : cleanup pris en charge par
    // AnimationOrchestratorService.destroy() (déjà câblé par destroyRef).
  }
}
