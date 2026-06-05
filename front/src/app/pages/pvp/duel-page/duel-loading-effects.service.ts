import { effect, Injectable, inject, Signal, untracked, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { RoomStateMachineService } from './room-state-machine.service';
import { DuelCardArtService } from './duel-card-art.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { PhaseAnnouncementService } from './phase-announcement.service';
import { preloadCardImages } from '../pvp-card.utils';
import type { RoomState } from './room-state-machine.service';

interface IndexedCardDetailDTO {
  card: {
    card: { passcode: number };
    images: { id: number; smallUrl: string }[];
  };
  selectedImageId?: number;
}

interface DeckDTO {
  mainDeck: IndexedCardDetailDTO[];
  extraDeck: IndexedCardDetailDTO[];
  sideDeck: IndexedCardDetailDTO[];
}

@Injectable()
export class DuelLoadingEffectsService {

  private readonly wsService = inject(DuelWebSocketService);
  private readonly roomService = inject(RoomStateMachineService);
  private readonly artService = inject(DuelCardArtService);
  private readonly orchestrator = inject(AnimationOrchestratorService);
  private readonly phaseService = inject(PhaseAnnouncementService);
  private readonly http = inject(HttpClient);
  private readonly notify = inject(NotificationService);

  private prefetchStarted = false;

  /** animations-ready-protocol-2026-06-05 — one-shot flag set when
   *  ANIMATIONS_READY has been emitted for the current duel session.
   *  Cleared on REMATCH_STARTING so the rematch flow re-emits after
   *  the next thumbnailsReady flip. */
  private _animationsReadySent = false;

  initEffects(config: {
    boardReady: Signal<boolean>;
    duelLoadingReady: Signal<boolean>;
    roomState: WritableSignal<RoomState>;
    thumbnailsReady: WritableSignal<boolean>;
  }): void {
    // Story 2.1 — Countdown timer tick + expiration (delegates to roomService)
    effect(() => {
      const state = config.roomState();
      untracked(() => {
        if (state === 'waiting' || state === 'creating-duel') {
          this.roomService.startCountdown();
        } else {
          this.roomService.stopCountdown();
        }
      });
    });

    effect(() => {
      const cd = this.roomService.countdown();
      if (cd?.expired) {
        untracked(() => {
          this.notify.error('error.ROOM_EXPIRED');
          this.roomService.leaveRoom();
        });
      }
    });

    // Story 2.4 — Transition to 'duel-loading' on first BOARD_STATE.
    // No longer gated on `diceResult` — the dice arena is mounted across
    // creating-duel/connecting/active and self-dismisses 2.5s after the
    // FIRST_PLAYER_RESULT banner. It overlays the board independently;
    // gating roomState on it would deadlock since diceResult is never
    // cleared at runtime (only between sessions on a new DICE_ROLL).
    effect(() => {
      const ready = config.boardReady();
      if (ready && config.roomState() === 'connecting') {
        untracked(() => config.roomState.set('duel-loading'));
      }
    });

    // animations-ready-protocol-2026-06-05 (Direction B) — start
    // thumbnail prefetch as soon as `cardCodes` is populated. The server
    // emits EARLY_DECK_PREFETCH right after SESSION_PHASE (before the
    // worker spawns), so cardCodes lands well ahead of any BOARD_STATE.
    // The previous gate `state === 'duel-loading'` was the deadlock root
    // cause: roomState→duel-loading requires boardReady requires
    // BOARD_STATE requires worker spawn requires ANIMATIONS_READY
    // requires thumbnailsReady requires prefetch. EARLY_DECK_PREFETCH
    // delivers cardCodes ahead of the worker, breaking the cycle.
    effect(() => {
      const codes = this.wsService.cardCodes();
      if (codes.length > 0 && !this.prefetchStarted) {
        untracked(() => {
          this.prefetchStarted = true;
          this.preFetchCardImages(config.thumbnailsReady);
        });
      }
    });

    // Story 2.4 — Transition 'duel-loading' -> 'active' when loading ready.
    // Order matters:
    //  1. setBoardActive(true) — gates downstream animation handlers.
    //  2. roomState=active — dismisses the dice arena (holdFinal flips false).
    //  3. drainPreActivationBuffer() — waits BOARD_BREATHE_MS, then replays
    //     the initial-draw + opening-board events queued during duel-loading.
    //     Without this drain, those events were silently skipped by the
    //     per-event `!isBoardActive` guard in draw-sequence-manager (the
    //     "cartes déjà en main" symptom).
    effect(() => {
      const ready = config.duelLoadingReady();
      if (ready && config.roomState() === 'duel-loading') {
        untracked(() => {
          this.wsService.setBoardActive(true);
          config.roomState.set('active');
          // β.3 cas #13 (2026-05-26) — opening DRAW announce. Au boot,
          // les 5 MSG_DRAW de la main d'ouverture sont parqués dans le
          // pre-activation buffer (boardActive=false) et la DuelConnection
          // skip leur intercept `onDrawNewTurn`. Le serveur landed
          // directement en MAIN1 → la bridge effect n'annonce que MAIN1
          // → l'utilisateur ne voit jamais "Draw Phase". On l'enqueue
          // explicitement ici, juste avant le drain, pour que le banner
          // DRAW soit synchronisé avec l'animation de pioche initiale
          // (nonBlocking → parallèle). La phase logique courante est
          // déjà MAIN1 — on force phase='DRAW' car la sémantique YGO de
          // l'ouverture est "tu pioches ta main de départ pendant la
          // phase DRAW", même si OCGCore squash STANDBY et passe direct
          // en MAIN1.
          const state = this.wsService.boardStateView.logicalState();
          const label = this.phaseService.phaseDisplayName('DRAW');
          this.phaseService.show(label, state.turnPlayer !== 0, 'DRAW', state.turnPlayer, state.turnCount);
          this.orchestrator.drainPreActivationBuffer();
        });
      }
    });

    // (Story 2.3's RPS auto-dismiss was removed when the pre-duel flow
    // moved from RPS to 2D6 dice in Phase 3.14 — pvp-dice-arena.component
    // now owns the full overlay lifecycle, including the post-`final`
    // dismiss timer (scheduleFinalDismiss). Auto-clearing diceResult here
    // would race against the user's SELECT_FIRST_PLAYER pick and hide the
    // turn-choice buttons after 3s — root cause of the "dice end → duel
    // launches immediately" regression.)

    // animations-ready-protocol-2026-06-05 (Direction B) — emit
    // ANIMATIONS_READY once (a) thumbnails are fully prefetched and
    // (b) the WS handshake is complete. The dual gate ensures the
    // frame is not dropped silently by safeSend (which requires
    // ws.readyState === OPEN) AND the server has already accepted
    // this session via SESSION_TOKEN (`connectionStatus === 'connected'`
    // is set in `_handleSessionToken`).
    //
    // The server-side `isReadyToStart` gate waits for every required
    // slot's `animationsReady` flag before triggering worker spawn /
    // dice flow / FORK_RESUME. Without this emission the duel never
    // starts.
    //
    // Idempotence : `_animationsReadySent` blocks a second emission
    // for the same duel. Reset to false by the rematch effect below
    // so the rematch flow re-emits after the next thumbnailsReady
    // flip.
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

    // animations-ready-protocol-2026-06-05 (Direction B) — rematch
    // reset. The server-side `resetSessionForRematch` flips
    // `animationsReady = [false, false]` so the rematch worker spawn
    // re-gates on a fresh ANIMATIONS_READY. The client must therefore
    // re-emit. Triggers:
    //  - reset `_animationsReadySent` to false (so the emission effect
    //    above can fire again)
    //  - reset `prefetchStarted` to false + `thumbnailsReady=false`
    //    (so the prefetch effect re-runs — though in practice cardCodes
    //    are still cached, this guarantees the chain restarts cleanly)
    // The chain then re-fires: cardCodes still set → prefetch re-runs
    // → thumbnailsReady flips true → ANIMATIONS_READY emitted again →
    // server flips animationsReady[i]=true → worker spawn proceeds.
    effect(() => {
      if (this.wsService.rematchStarting()) {
        untracked(() => {
          this._animationsReadySent = false;
          this.prefetchStarted = false;
          config.thumbnailsReady.set(false);
        });
      }
    });

  }

  private async preFetchCardImages(thumbnailsReady: WritableSignal<boolean>): Promise<void> {
    const artMap = await this.buildArtMap();
    this.artService.setArtMap(artMap);
    const codes = this.wsService.cardCodes();
    if (codes.length > 0) {
      await preloadCardImages(codes, artMap);
    }
    thumbnailsReady.set(true);
  }

  private async buildArtMap(): Promise<Map<number, string>> {
    const decklistId = this.roomService.decklistId;
    if (!decklistId) return new Map();
    try {
      const deck = await firstValueFrom(this.http.get<DeckDTO>(`/api/decks/${decklistId}`));
      const map = new Map<number, string>();
      const allSlots = [...deck.mainDeck, ...deck.extraDeck, ...deck.sideDeck];
      for (const slot of allSlots) {
        if (!slot.selectedImageId) continue;
        const image = slot.card.images.find(img => img.id === slot.selectedImageId);
        if (image) map.set(slot.card.card.passcode, image.smallUrl);
      }
      return map;
    } catch {
      return new Map();
    }
  }
}
