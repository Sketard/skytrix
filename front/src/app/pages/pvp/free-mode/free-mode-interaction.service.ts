import { Injectable, computed, inject, signal } from '@angular/core';
import { BoardStateService } from '../../simulator/board-state.service';
import { CommandStackService } from '../../simulator/command-stack.service';
import { CardInstance, ZoneId as SimZoneId, ZONE_CONFIG } from '../../simulator/simulator.models';
import { ZoneId as PvpZoneId } from '../duel-ws.types';
import { DuelContext } from '../duel-page/duel-context';
import { pvpZoneToSim } from './card-instances-to-payload';

/** Double-tap window — a 2nd tap within this delay = inspect, cancelling the arm. */
const DOUBLE_TAP_MS = 250;

/** A tapped card resolved back to its sim model. */
interface ResolvedCard {
  instanceId: string;
  zone: SimZoneId;
  card: CardInstance;
}

/** The board payload for a card tap (cardInspectRequest, free-mode-extended). */
export interface CardTapEvent {
  cardCode: number;
  zoneId?: PvpZoneId;
  /** True for the board's long-press / right-click gesture (inspect intent).
   *  Routed to the inspect path — it must NEVER arm (§5.3 phantom-arm guard). */
  forceExpanded?: boolean;
}

/**
 * The free-mode interaction state machine (UX §4). Holds the armed card and
 * translates each gesture into a `CommandStackService` call. Mono-player,
 * tap-driven (no drag).
 *
 * Two rules drive everything:
 *  1. tap acts on state — nothing armed → arm; armed + tap slot → pose/swap;
 *     armed + tap pile → deposit; armed + tap another card → re-arm.
 *  2. double-tap / long-press → inspect (never arms; cancels a pending arm).
 *
 * Card identity bridge: the board emits PvP ZoneId + cardCode (no sim
 * instanceId). We map PvP→sim zone, then resolve the rendered card of that zone
 * (single-card zones → index 0; piles → top; HAND → by cardCode). cardCode is
 * NOT unique, so the zone is load-bearing for disambiguation (§ identity).
 */
@Injectable()
export class FreeModeInteractionService {
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);
  private readonly ctx = inject(DuelContext);

  // why: editor interaction state outside the animation pipeline taxonomy.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  private readonly _armed = signal<ResolvedCard | null>(null);
  // why: 'attach-xyz pending' — set by the mini-bar Attacher action, awaits a
  // tap on an XYZ host. eslint-disable-next-line below for the same reason.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  private readonly _attachPending = signal(false);

  readonly armedInstanceId = computed(() => this._armed()?.instanceId ?? null);
  readonly armedCardName = computed(() => this._armed()?.card.card.card.name ?? null);
  readonly isAttachPending = computed(() => this._attachPending());

  /** Timestamp of the last card tap, for the double-tap window (no Date.now in
   *  signals; uses performance.now via a plain field — interaction is sync). */
  private lastTapAt = 0;
  private lastTapInstanceId: string | null = null;

  // ── Card tap (the main entry — UX §4 ÉTAT B) ──────────────────────────────

  /**
   * A card was tapped (board `cardInspectRequest`, free-mode-extended with
   * zoneId). Implements arm / re-arm / swap / attach + the double-tap arbiter.
   */
  onCardTap(event: CardTapEvent): void {
    // Long-press / right-click (forceExpanded) is an INSPECT gesture, not a tap.
    // The board funnels it through cardInspectRequest too, so we branch here and
    // route to the inspect path — disarming first so no phantom arm survives (§5.3).
    if (event.forceExpanded) {
      this.onCardLongPress(event);
      return;
    }

    const resolved = this.resolve(event);
    if (!resolved) return;

    // Double-tap arbiter: a 2nd tap on the SAME card within the window =
    // inspect → cancel the arm. The flash of the tap-1 halo is accepted (§5.3).
    const now = performance.now();
    if (
      this.lastTapInstanceId === resolved.instanceId &&
      now - this.lastTapAt < DOUBLE_TAP_MS
    ) {
      this.disarm();
      this.lastTapInstanceId = null;
      this.lastTapAt = 0;
      this.inspect(event);
      return;
    }
    this.lastTapAt = now;
    this.lastTapInstanceId = resolved.instanceId;

    const armed = this._armed();

    // Attach-XYZ pending: the next card tap is the XYZ host target.
    if (this._attachPending() && armed && armed.instanceId !== resolved.instanceId) {
      this.attachArmedTo(armed, resolved);
      return;
    }

    // Nothing armed → arm this card.
    if (!armed) {
      this.arm(resolved);
      return;
    }

    // Re-tap the armed card → disarm (§4).
    if (armed.instanceId === resolved.instanceId) {
      this.disarm();
      return;
    }

    // Tapping a card in HAND re-arms (pick a new card to place) — §4 distinguishes
    // "tap another card (hand) → re-arm" from "tap an occupied field slot → swap".
    if (resolved.zone === SimZoneId.HAND) {
      this.arm(resolved);
      return;
    }

    // Armed + tap another POSED card (field/EMZ/pile) → SWAP (free, no legality).
    this.commandStack.swapCards(armed.instanceId, resolved.instanceId);
    this.ctx.announceEvent(`Échangée avec ${resolved.card.card.card.name ?? 'carte'}`, 0);
    // Arming is no longer sticky after a swap: the armed card moved zones.
    this.disarm();
  }

  /** Long-press on a card → inspect, and NEVER leave a phantom arm (§5.3). */
  onCardLongPress(event: CardTapEvent): void {
    this.disarm();
    this.lastTapInstanceId = null;
    this.inspect(event);
  }

  // ── Empty slot tap (board `emptyZoneTap`, UX §4) ──────────────────────────

  /** Tap an empty field slot → pose the armed card there (no-op if nothing armed). */
  onEmptyZoneTap(pvpZone: PvpZoneId): void {
    const armed = this._armed();
    if (!armed) return;
    const target = pvpZoneToSim(pvpZone);
    if (!target) return;
    this.commandStack.moveCard(armed.instanceId, armed.zone, target);
    this.ctx.announceEvent(`Posée en zone ${pvpZone}`, 0);
    // Hand stays "sticky" — but the armed card just moved, so re-anchor it to
    // its new zone (a follow-up tap on it should still work).
    this._armed.set({ ...armed, zone: target });
    // Reset the double-tap window: the next tap on the just-posed card must NOT
    // be misread as a double-tap of the arming tap (stale lastTapAt/Id).
    this.lastTapInstanceId = null;
    this.lastTapAt = 0;
  }

  // ── Pile tap (deposit when armed; open is owned by the page, UX §13/§14) ──

  /** Tap a pile → deposit the armed card into it. Returns true if it deposited
   *  (the page opens the pile overlay only when this returns false). */
  onPileTap(pvpZone: PvpZoneId): boolean {
    const armed = this._armed();
    if (!armed) return false;
    const target = pvpZoneToSim(pvpZone);
    if (!target) return false;
    this.commandStack.moveCard(armed.instanceId, armed.zone, target);
    this.ctx.announceEvent(`Déposée dans ${pvpZone}`, 0);
    this.disarm();
    return true;
  }

  // ── Disarm (Échap / tap-vide hors-plateau / re-tap) ───────────────────────

  disarm(): void {
    if (this._armed() !== null) {
      this._armed.set(null);
      this._attachPending.set(false);
      this.ctx.announceEvent('Désarmée', 0);
    }
  }

  /** Arm the mini-bar Attacher mode: the next card tap targets an XYZ host. */
  beginAttachPending(): void {
    if (this._armed()) this._attachPending.set(true);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private arm(resolved: ResolvedCard): void {
    this._armed.set(resolved);
    this._attachPending.set(false);
    this.ctx.announceEvent(`${resolved.card.card.card.name ?? 'Carte'} armée`, 0);
  }

  /** Route Attacher-XYZ: armed material → transferMaterial, armed normal card →
   *  attachMaterial, onto the tapped XYZ host (T2 / §5.2). */
  private attachArmedTo(armed: ResolvedCard, host: ResolvedCard): void {
    const isMaterial = this.isMaterial(armed.instanceId);
    if (isMaterial) {
      this.commandStack.transferMaterial(armed.instanceId, armed.zone, host.instanceId, host.zone);
    } else {
      this.commandStack.attachMaterial(armed.instanceId, armed.zone, host.instanceId, host.zone);
    }
    this.ctx.announceEvent(`Attachée à ${host.card.card.card.name ?? 'monstre XYZ'}`, 0);
    this.disarm();
  }

  private isMaterial(instanceId: string): boolean {
    const board = this.boardState.boardState();
    for (const zone of Object.keys(board) as SimZoneId[]) {
      if (board[zone].some(c => c.overlayMaterials?.some(m => m.instanceId === instanceId))) {
        return true;
      }
    }
    return false;
  }

  private inspect(_event: CardTapEvent): void {
    // Inspection is owned by the page (it re-emits to the PvP inspector). The
    // service's role is only to ensure no phantom arm survives — already done
    // by the caller. No state change here.
  }

  /**
   * Resolve a board tap (PvP zone + cardCode) to its sim instance. Single-card
   * zones → index 0; pile zones → top (the rendered card); HAND → by cardCode.
   */
  private resolve(event: CardTapEvent): ResolvedCard | null {
    if (event.zoneId === undefined) return null;
    const simZone = pvpZoneToSim(event.zoneId);
    if (!simZone) return null;
    const cards = this.boardState.boardState()[simZone];
    if (cards.length === 0) return null;

    const kind = ZONE_CONFIG[simZone].type;
    let card: CardInstance | undefined;
    if (kind === 'single') {
      card = cards[0];
    } else if (kind === 'stack') {
      card = cards[cards.length - 1]; // top of pile = what the board renders
    } else {
      // ordered (HAND) — disambiguate by cardCode. No fallback to cards[0]: a
      // miss returns null rather than silently arming the wrong hand card.
      // (HAND taps need a positional key for duplicate cardCodes — étape 5.)
      card = cards.find(c => c.card.card.passcode === event.cardCode);
    }
    if (!card) return null;
    return { instanceId: card.instanceId, zone: simZone, card };
  }
}
