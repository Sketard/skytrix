import { computed, DestroyRef, effect, inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DuelConnection } from './duel-connection';
import { DuelWebSocketService } from './duel-web-socket.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DuelLogger, DuelLogCategory } from './duel-logger';
import { DuelContext } from './duel-context';
import { WebSocketFactoryService } from './websocket-factory.service';
import { SOLO_SWITCH_PLAYER_MS } from './ui-timing-constants';

/**
 * γ Option C c10 (2026-05-29) — whitelist des `Prompt.type` qui n'empêchent
 * PAS un `switchPerspective` SOLO. Ces deux prompts sont l'état stable
 * d'attente du joueur actif pendant respectivement sa Main Phase 1/2 et
 * sa Battle Phase — ils sont émis par le serveur dès l'entrée en phase et
 * restent pending jusqu'à end-phase. Les bloquer revient à interdire le
 * switch tout au long du tour (bug user-facing remonté 2026-05-29 :
 * "je clique P1 et rien ne se passe alors que je n'ai aucun prompt
 * modal ouvert").
 *
 * Les autres prompts (SELECT_CARD, SELECT_CHAIN, SELECT_PLACE, …) restent
 * bloquants car ils représentent une action multi-step en cours dont
 * l'UX de basculement mid-action serait déroutante (le viewer arrive
 * sur P1 alors que P0 attend une réponse pour finir son SELECT_CARD).
 */
const IDLE_PHASE_PROMPT_TYPES: ReadonlySet<string> = new Set([
  'SELECT_IDLECMD',
  'SELECT_BATTLECMD',
  // SELECT_CHAIN is the stable wait-state during chain building — the engine
  // walks each player's response window in sequence and the viewer NEEDS to
  // switch perspective precisely to answer for the other side (e.g. activate
  // Ash Blossom on opponent's NS-trigger). Allowing the switch here is the
  // SOLO multiplex raison d'être. v3 Phase 5 (2026-06-05) — safety is now
  // structural : `notifyPerspectiveSwitch` clears the runner + drops orphaned
  // locks before the dispatch (Phase 3 wire). No upstream board-stability gate
  // is needed.
  'SELECT_CHAIN',
]);

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
 * A21 invariant — une seule source de vérité (γ-c cleanup F-2.3) :
 *   `wsService.soloModeSource` (signal réactif c5b BH-2). Il pilote :
 *     · `perspectiveSlot()` + `sendForPlayer()` côté wsService computeds
 *       (lecture directe du signal) ;
 *     · `DuelConnection.soloMode` getter (lit le MÊME signal injecté via
 *       l'option `soloModeSource` du ctor). Donc le swap BOARD_STATE
 *       pour perspective=1 dans `_shouldSwapForSolo` propage
 *       automatiquement quand `setSoloMode(true)` flippe le signal.
 *
 * Le flip DOIT précéder `connect()` — sinon le 1er BOARD_STATE après
 * l'OPEN du socket ne passerait pas par la branche soloMode du
 * `shouldSwapForSolo` et on aurait 1 frame de board non-swappé visible
 * en perspective=1.
 *
 * Pré-cleanup : c'était un "pair flip" `conn.soloMode = true` +
 * `wsService.setSoloMode(true)` à faire ENSEMBLE — risque d'oubli sur
 * un futur 3ᵉ point d'init SOLO. Le getter dérivé ferme structurellement
 * le risque : il n'y a plus qu'un flip à faire.
 */
@Injectable()
export class SoloDuelOrchestratorService {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly animationService = inject(AnimationOrchestratorService);
  private readonly duelCtx = inject(DuelContext);
  private readonly logger = inject(DuelLogger);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  /** γ Option C PR2 c7a (A15) — factory indirection forwarded to the SOLO
   *  multiplex `DuelConnection` so the SOLO chain spec (T-F6 c7b) can feed
   *  frames through a MockWebSocket. */
  private readonly wsFactory = inject(WebSocketFactoryService);

  // F18 (2026-05-31) — `SOLO_PERSPECTIVE_KEY` localStorage retired.
  // The perspective is now persisted in sessionStorage under
  // `solo-duel-tokens-${code}` `.activePlayer` (kept in sync with
  // `perspectiveIndex` by `SoloModeEffectsService.initSolo`'s effect).
  // Restoration is owned by `DuelPageComponent.ngOnInit` (line ~659:
  // `if (restoredPlayer === 1) this.orchestrator.switchPerspective()`),
  // the single point of perspective restore. The previous localStorage
  // path was a duplicate write surface — global to all tabs/sessions
  // instead of per-duel — and could leak a SOLO perspective into an
  // unrelated fork-solo session.

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

  // Anti-réentrance programmatique : protège un appel `switchPerspective`
  // synchrone consécutif (rematch restoration → switch → switch). Le
  // composant `duel-page` tient son propre `switching` signal qui pilote
  // l'opacité 0.3 du board-container + l'état désactivé du bouton — c'est
  // l'anti-double-click UX. Ce signal-ci est interne ; aucun consommateur
  // hors orchestrator ne le lit.
  private _switching = signal(false);

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
    //
    // γ-c cleanup F-2.3 (audit) — `soloModeSource` partagé entre conn
    // et wsService. Le getter `conn.soloMode` lit `wsService.soloModeSource()`
    // donc le flip `setSoloMode(true)` ci-dessous propage AUTOMATIQUEMENT
    // sur la conn. Le pair flip A21 (`conn.soloMode = true` manuel) qui
    // existait pré-cleanup est devenu structurellement impossible à
    // oublier — il n'y a plus qu'UN flip à faire.
    const conn = new DuelConnection(
      environment.wsUrl, true, 'duel-reconnect-token-solo', this.logger,
      {
        duelCtx: this.duelCtx,
        wsFactory: this.wsFactory,
        soloModeSource: this.wsService.soloModeSource,
      },
    );

    // Le flip DOIT précéder `connect()` : sinon le premier BOARD_STATE
    // après l'OPEN du socket ne passerait pas par la branche soloMode
    // du `shouldSwapForSolo` et on aurait 1 frame de board non-swappé
    // visible en perspective=1.
    this.wsService.setSoloMode(true);

    // U31 (audit-4-modes-2026-06-01) — debug-sink wiring (cardArt + debugLog)
    // moved into `wsService.applySinks(conn)` called by `bindSoloConnection`
    // below. The orchestrator no longer needs to know about debug sinks ;
    // adding a 5th sink is now a single edit in `applySinks`.

    this._transport_connection.set(conn);

    // c8 — wsService SOLO bind : remplace l'ancien pair
    // `bindSharedProcessor(conn.processor) + bindTransports(conn, conn)`
    // par une seule API atomique. Swap le `_transport_connection` signal
    // côté wsService + re-applique les sinks Palier 0 / β.3 sur la
    // nouvelle conn. Le `_transport_connection` unique sert maintenant
    // PvP normal et SOLO (default conn vs SOLO multiplex conn).
    this.wsService.bindSoloConnection(conn);

    conn.connect(token1);

    // F18 (2026-05-31) — perspective restoration moved out of init().
    // The orchestrator no longer reads any storage; the duel-page
    // component reads `sessionStorage[soloTokensKey].activePlayer` and
    // calls `switchPerspective()` AFTER `init()` returns (cf.
    // duel-page.component.ts ~line 659). This makes the orchestrator
    // perspective-agnostic at bootstrap and prevents the global
    // localStorage from leaking a SOLO perspective into an unrelated
    // session (fork-solo, future SOLO tab).

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
   * Convention §5.2 POC — révisée γ-c c10 (2026-05-29) : pas de switch
   * pendant prompt MODAL actif. La whitelist `IDLE_PHASE_PROMPT_TYPES`
   * autorise explicitement `SELECT_IDLECMD` et `SELECT_BATTLECMD` — ces
   * deux prompts sont l'état stable d'attente du joueur actif pendant
   * toute sa Main Phase / Battle Phase, donc bloquer le switch sur eux
   * équivaut à bloquer le switch tout au long du tour.
   */
  /**
   * F3 (2026-05-30) — single source of truth for "can the viewer switch
   * perspective right now?". Drives BOTH `switchPerspective`'s early-return
   * guard AND the toolbar button's `[disabled]` + urgent-glow gate, so the UX
   * and the safety guard can never disagree (clicking a glowing button that
   * silently no-ops was the "I click P1 and nothing happens" frustration).
   *
   * v3 Phase 5 (2026-06-05) — relaxed to `promptBlocks` only. The doctrine
   * "Replay-as-max-rate-PvP" (CLAUDE.md) prescribes SOLO converging toward
   * replay : replay's `togglePerspective` button is always cliquable, SOLO's
   * must follow. The earlier gates (`hasDrawsInFlight`, `isBoardStableForSwitch`)
   * are no longer load-bearing because :
   *   · `notifyPerspectiveSwitch` now calls `clearTimersAndPolling()` in head
   *     (v3 Phase 5 wire), which fires `runner.requestStop()` →
   *     `dropOrphanedLocks('runner-requestStop')` (Phase 3). The locks held
   *     by in-flight handlers are vacated by construction.
   *   · `_abort.abort()` interrupts any suspended async handler at its next
   *     `await` ; the post-cleanup `.then(commit, release)` hits the zombie-
   *     safe path (Option G, af3195fa).
   *   · `conn.onPerspectiveSwitched()` re-feeds the cached absolute BOARD_STATE
   *     via `syncRendered()` so the board lands on the target state immediately
   *     even if the worker is in WAITING_RESPONSE (no fresh BOARD_STATE coming).
   *
   * Only blocking modal prompts remain. `IDLE_PHASE_PROMPT_TYPES` whitelist
   * (SELECT_IDLECMD / SELECT_BATTLECMD / SELECT_CHAIN) is preserved : these
   * are the legitimate per-phase wait states where switching is the raison
   * d'être of SOLO multiplex (answer for the other side).
   */
  get canSwitchPerspective(): boolean {
    const prompt = this.wsService.pendingPrompt();
    if (prompt !== null && !IDLE_PHASE_PROMPT_TYPES.has(prompt.type)) return false;
    return true;
  }

  switchPerspective(): void {
    const conn = this._transport_connection();
    if (!conn) return;
    if (this._switching()) return;
    // v3 Phase 5 — single gate `canSwitchPerspective` reduced to modal-prompt
    // block (whitelist excepts IDLE_PHASE_PROMPT_TYPES). Mid-anim + mid-draw
    // switches are now safe by construction via `notifyPerspectiveSwitch` →
    // `clearTimersAndPolling` → `dropOrphanedLocks`.
    if (!this.canSwitchPerspective) {
      const prompt = this.wsService.pendingPrompt();
      this.logger.log(DuelLogCategory.PIPELINE,
        'switchPerspective skipped: %s', `prompt=${prompt?.type ?? 'null'}`);
      return;
    }
    const from = this.duelCtx.perspective()() as 0 | 1;
    const to: 0 | 1 = from === 0 ? 1 : 0;
    this._switching.set(true);

    // Flip data-only : pas d'anim CSS (cf. F22 — le `rotate(180deg)` sur
    // `.board-host` a été retiré, les données sont déjà relativisées par
    // `DuelConnection._maybeSwapBoardState`). Le wsService re-évalue ses
    // computeds per-perspective via `slotIndex()` qui lit `perspective()`
    // en SOLO.
    //
    // Ordre : signal flip AVANT `notifyPerspectiveSwitch` (post-review
    // H2, 2026-05-28). La dispatch `applyReset({PERSPECTIVE_LIFETIME})`
    // synchrone à l'intérieur de notifyPerspectiveSwitch doit voir la
    // NOUVELLE perspective si une projection lit `perspectiveSource`
    // dans son `applyReset`. Aucune projection ne le fait aujourd'hui,
    // mais le futur-proof zéro coût vaut mieux qu'un bug latent off-
    // by-one très subtil.
    this.duelCtx.setPerspective(to);

    // F18 (2026-05-31) — perspective persistence moved to sessionStorage
    // (single source). `SoloModeEffectsService.initSolo` holds a reactive
    // `effect(() => orchestrator.perspectiveIndex())` that writes
    // `sessionStorage[soloTokensKey].activePlayer` on every change — the
    // setPerspective above invalidates `perspectiveIndex`, the effect
    // fires synchronously, persistence happens with zero coupling here.

    // Émission de PerspectiveSwitched sur le flux + dispatch reset
    // PERSPECTIVE_LIFETIME.
    this.animationService.notifyPerspectiveSwitch(from, to);

    // γ-c cleanup F-2.2 (audit) — clear `_lastDrawAnnouncedHash` on the
    // conn. The hash is built from BOARD_STATE's `turnPlayer` which is
    // RELATIVE after `_maybeSwapBoardState` ; a switch invalidates the
    // dedup since the new perspective sees a different relative
    // `turnPlayer`. Without this, a switch mid-tour can either re-fire
    // the DRAW announce on the same logical tour OR silently swallow
    // a fresh tour announce if old + new perspectives coincidentally
    // produce the same hash.
    conn.onPerspectiveSwitched();

    // c6c A14 — `setBoardActive(true)` SUPPRIMÉ. Avec 1 connection
    // multiplex il n'y a plus d'asymétrie transport entre perspectives ;
    // `_boardActive` est un transport-flag global flippé une fois au
    // bootstrap par `DuelLoadingEffectsService` puis re-flippé à
    // REMATCH_STARTING par `duel-connection.ts` (A23, c4.4). Le rappeler
    // au switch serait redondant et brouillerait la sémantique du flag.

    // Debounce post-transition aligné sur `SOLO_SWITCH_PLAYER_MS` =
    // 150ms `--transition-fast` du board-container (opacity 0.3) + 50ms
    // marge. Avant F22 cette valeur était calibrée sur un `rotate(180deg)`
    // CSS sur `.board-host` qui n'a jamais été implémenté ; F17 (2026-05-31)
    // a aligné sur la SEULE transition CSS désormais en jeu.
    setTimeout(() => this._switching.set(false), SOLO_SWITCH_PLAYER_MS);
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

      // REMATCH_STARTING reçu une fois ⇒ resync perspective + déclenche la
      // transition UI SOLO via `_rematchReset`. Le signal `rematchStarting`
      // est PRÉSERVÉ (pas de `conn.resetRematchStarting()` ici) — il vit
      // jusqu'au 1er BOARD_STATE du nouveau duel (ligne ~1216 de
      // DuelConnection) afin que :
      //
      //  1. L'overlay « Starting new duel… » reste visible pendant la
      //     fenêtre de transition (~RTT serveur) — masque le board vide.
      //  2. Le bridge effect Story 5.1 fire correctement → reset DUEL_LIFETIME
      //     (drawManager._initialDrawDone repasse à [false, false]) → les
      //     MSG_DRAW initiaux du nouveau duel routent vers
      //     `launchInitialDraw` (pas `processMidGameDraw`).
      //
      // Le `resetRematchStarting()` historique court-circuitait le bridge
      // effect via une course dans le drain Angular (le SOLO effect fire
      // avant le bridge → flippe le signal → le bridge voit `false` et ne
      // déclenche jamais `onStateSync`). Bug réservoir « initial draw mid-
      // game » au rematch SOLO observé 2026-06-02.
      effect(() => {
        if (conn.rematchStarting()) {
          // Perspective P0 par convention en début de nouvelle partie.
          this.duelCtx.setPerspective(0);
          this._rematchReset.update(v => v + 1);
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
