import { DestroyRef, effect, Injectable, inject, Signal, untracked, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { RoomStateMachineService } from './room-state-machine.service';
import { DuelCardArtService } from './duel-card-art.service';
import { preloadCardImages } from '../pvp-card.utils';
import type { RoomState } from './room-state-machine.service';
import { RPS_DISMISS_DRAW_MS, RPS_DISMISS_WINNER_MS } from './ui-timing-constants';

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
  private readonly http = inject(HttpClient);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  private prefetchStarted = false;
  private loadingTimeoutRef: ReturnType<typeof setTimeout> | null = null;
  private rpsAutoDismissTimeout: ReturnType<typeof setTimeout> | null = null;

  initEffects(config: {
    boardReady: Signal<boolean>;
    duelLoadingReady: Signal<boolean>;
    roomState: WritableSignal<RoomState>;
    thumbnailsReady: WritableSignal<boolean>;
    loadingTimeout: WritableSignal<boolean>;
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

    // Story 2.4 — Transition to 'duel-loading' on first BOARD_STATE
    effect(() => {
      const ready = config.boardReady();
      const rpsVisible = this.wsService.rpsResult();
      if (ready && !rpsVisible && config.roomState() === 'connecting') {
        untracked(() => config.roomState.set('duel-loading'));
      }
    });

    // Story 2.4 — When entering 'duel-loading', start thumbnail pre-fetch + 15s timeout
    effect(() => {
      const state = config.roomState();
      if (state === 'duel-loading' && !this.prefetchStarted) {
        untracked(() => {
          this.prefetchStarted = true;
          this.preFetchCardImages(config.thumbnailsReady);
          this.loadingTimeoutRef = setTimeout(() => {
            if (config.roomState() === 'duel-loading') {
              config.loadingTimeout.set(true);
            }
          }, 15000);
        });
      }
    });

    // Story 2.4 — Transition 'duel-loading' -> 'active' when loading ready
    effect(() => {
      const ready = config.duelLoadingReady();
      if (ready && config.roomState() === 'duel-loading') {
        untracked(() => {
          if (this.loadingTimeoutRef) {
            clearTimeout(this.loadingTimeoutRef);
            this.loadingTimeoutRef = null;
          }
          config.roomState.set('active');
          this.wsService.setBoardActive(true);
        });
      }
    });

    // Story 2.3 — RPS result auto-dismiss
    effect(() => {
      const rps = this.wsService.rpsResult();
      if (!rps) return;
      untracked(() => {
        if (this.rpsAutoDismissTimeout) clearTimeout(this.rpsAutoDismissTimeout);
        const duration = rps.winner !== null ? RPS_DISMISS_WINNER_MS : RPS_DISMISS_DRAW_MS;
        this.rpsAutoDismissTimeout = setTimeout(() => this.wsService.clearRpsResult(), duration);
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.loadingTimeoutRef) clearTimeout(this.loadingTimeoutRef);
      if (this.rpsAutoDismissTimeout) clearTimeout(this.rpsAutoDismissTimeout);
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
