import { Injectable, computed, inject, signal } from '@angular/core';
import { BoardStateService } from './engine/board-state.service';
import { CommandStackService } from './engine/command-stack.service';
import { CardInstance, ZoneId as SimZoneId, ZONE_CONFIG } from './engine/board-models';
import { ZoneId as PvpZoneId } from '../duel-ws.types';
import { DuelContext } from '../duel-page/duel-context';
import { pvpZoneToSim, simZoneToPvp } from './card-instances-to-payload';

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
  /** PvP DOM zone key of the armed card (`${pvpZone}-0`), for element lookup. */
  readonly armedZoneKey = computed(() => {
    const armed = this._armed();
    if (!armed) return null;
    const pvp = simZoneToPvp(armed.zone);
    return pvp ? `${pvp}-0` : null;
  });
  /** Generic counter value on the armed card (0 = none). */
  readonly armedCounterValue = computed(() => {
    const armed = this._armed();
    return armed ? (this._counters().get(armed.instanceId) ?? 0) : 0;
  });

  /** Timestamp of the last card tap, for the double-tap window (no Date.now in
   *  signals; uses performance.now via a plain field — interaction is sync). */
  private lastTapAt = 0;
  private lastTapInstanceId: string | null = null;

  /** Inspect sink — the page registers the PvP inspector here. The service stays
   *  decoupled: it signals "inspect this card" without knowing the inspector. */
  private inspectSink: ((event: CardTapEvent) => void) | null = null;

  /** Register the inspect handler (the page wires it to CardInspectionService). */
  onInspect(sink: (event: CardTapEvent) => void): void {
    this.inspectSink = sink;
  }

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

  /**
   * A HAND card was tapped (hand row `handCardAction`, carrying the positional
   * INDEX). Resolving by index — not cardCode — disambiguates duplicate copies
   * in hand (the étape-4 defer). Arms / re-arms / double-tap-inspects the hand
   * card. Tapping a hand card while another is armed re-arms (§4: hand = re-arm).
   */
  onHandCardTap(index: number): void {
    const cards = this.boardState.boardState()[SimZoneId.HAND];
    const card = cards[index];
    if (!card) return;
    const resolved: ResolvedCard = { instanceId: card.instanceId, zone: SimZoneId.HAND, card };

    const now = performance.now();
    if (
      this.lastTapInstanceId === resolved.instanceId &&
      now - this.lastTapAt < DOUBLE_TAP_MS
    ) {
      this.disarm();
      this.lastTapInstanceId = null;
      this.lastTapAt = 0;
      this.inspect({ cardCode: card.card.card.passcode ?? 0 });
      return;
    }
    this.lastTapAt = now;
    this.lastTapInstanceId = resolved.instanceId;

    // Re-tap the armed hand card → disarm.
    if (this._armed()?.instanceId === resolved.instanceId) {
      this.disarm();
      return;
    }
    // Arm / re-arm (hand always (re-)arms — §4).
    this.arm(resolved);
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
    // Always reset the double-tap window on disarm so a follow-up tap is read as
    // a fresh arm, never as a stale double-tap (covers all disarm paths).
    this.lastTapInstanceId = null;
    this.lastTapAt = 0;
  }

  /** Arm the mini-bar Attacher mode: the next card tap targets an XYZ host. */
  beginAttachPending(): void {
    if (this._armed()) this._attachPending.set(true);
  }

  /**
   * Arm a card by its sim instanceId, re-locating its zone from live state.
   * Used by the overlay→arm bridge (§15 — tap a card inside a pile/search
   * overlay → it arms + the overlay closes). No-op if the id isn't on the board.
   */
  armInstance(instanceId: string): void {
    const board = this.boardState.boardState();
    for (const zone of Object.keys(board) as SimZoneId[]) {
      const card = board[zone].find(c => c.instanceId === instanceId);
      if (card) {
        this.arm({ instanceId, zone, card });
        return;
      }
    }
  }

  // ── Mini-bar CARTE actions (§6.1) — operate on the armed card ──────────────

  /** True if the armed card is currently an XYZ material (gates "Détacher"). */
  readonly armedIsMaterial = computed(() => {
    const armed = this._armed();
    return armed ? this.isMaterial(armed.instanceId) : false;
  });

  /** Flip the armed card face-up ↔ face-down. Reads LIVE state by instanceId —
   *  the `_armed.card` snapshot is captured at arm time and goes stale after a
   *  copy-on-write command, so a 2nd flip would otherwise repeat the 1st. */
  flipArmed(): void {
    const live = this.liveArmedCard();
    if (!live) return;
    const faceDown = !live.card.faceDown;
    this.commandStack.flipCard(live.card.instanceId, live.zone, faceDown);
    this.ctx.announceEvent(faceDown ? 'Face cachée' : 'Face visible', 0);
  }

  /** Toggle the armed card ATK ↔ DEF (reads LIVE state — see flipArmed). */
  togglePositionArmed(): void {
    const live = this.liveArmedCard();
    if (!live) return;
    const target = live.card.position === 'ATK' ? 'DEF' : 'ATK';
    this.commandStack.togglePosition(live.card.instanceId, live.zone, target);
    this.ctx.announceEvent(target === 'ATK' ? 'Position attaque' : 'Position défense', 0);
  }

  /** Destroy the armed card → Graveyard (§5.2 Détruire). */
  destroyArmed(): void {
    const armed = this._armed();
    if (!armed) return;
    this.commandStack.moveCard(armed.instanceId, armed.zone, SimZoneId.GRAVEYARD);
    this.ctx.announceEvent('Détruite', 0);
    this.disarm();
  }

  /** Detach the armed XYZ material → Graveyard (§5.2 Détacher). No-op if the
   *  armed card isn't a material. */
  detachArmed(): void {
    const armed = this._armed();
    if (!armed) return;
    const host = this.findMaterialHost(armed.instanceId);
    if (!host) return;
    this.commandStack.detachMaterial(armed.instanceId, host.hostId, host.zone, SimZoneId.GRAVEYARD);
    this.ctx.announceEvent('Détachée', 0);
    this.disarm();
  }

  // ── Counters (#11 / §5.4) — Map parallel to the sim model, OUTSIDE undo ────
  // Generic single counter per card in v1. Lives here (not in CardInstance, not
  // in CommandStack) → NOT undoable → decrement is MANDATORY (the only recourse
  // after an over-click). The adapter reads this map at payload build time.

  // why: editor counter state outside the animation pipeline taxonomy.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  private readonly _counters = signal<ReadonlyMap<string, number>>(new Map());
  readonly counters = this._counters.asReadonly();

  /** Increment the armed card's generic counter. */
  incrementCounterArmed(): void {
    const armed = this._armed();
    if (!armed) return;
    this.adjustCounter(armed.instanceId, +1);
  }

  /** Decrement the armed card's counter, floored at 0 (MANDATORY recourse — the
   *  counter is outside undo, so a decrement is the only way to fix an over-click). */
  decrementCounterArmed(): void {
    const armed = this._armed();
    if (!armed) return;
    this.adjustCounter(armed.instanceId, -1);
  }

  /**
   * Clear editor state that lives OUTSIDE the command stack: counters + the
   * armed card. Called after a board reset — `CommandStackService.reset()`
   * rebuilds with deterministic instanceIds, so stale counters would otherwise
   * re-bind to reborn cards (phantom counters).
   */
  resetEditorState(): void {
    this._counters.set(new Map());
    this.disarm();
  }

  private adjustCounter(instanceId: string, delta: number): void {
    const next = new Map(this._counters());
    const value = Math.max(0, (next.get(instanceId) ?? 0) + delta);
    this.ctx.announceEvent(value === 0 ? 'Aucun compteur' : `${value} compteur${value > 1 ? 's' : ''}`, 0);
    if (value === 0) {
      next.delete(instanceId);
    } else {
      next.set(instanceId, value);
    }
    this._counters.set(next);
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

  /**
   * Re-resolve the armed card from LIVE board state by instanceId. The
   * `_armed.card` snapshot is captured at arm time and the sim commands are
   * copy-on-write, so it goes stale after any mutation — actions that read
   * mutable card state (faceDown / position) MUST use this, not the snapshot.
   * Returns null if nothing is armed or the card has left the board.
   */
  private liveArmedCard(): { card: CardInstance; zone: SimZoneId } | null {
    const armed = this._armed();
    if (!armed) return null;
    const board = this.boardState.boardState();
    for (const zone of Object.keys(board) as SimZoneId[]) {
      const card = board[zone].find(c => c.instanceId === armed.instanceId);
      if (card) return { card, zone };
    }
    return null;
  }

  private isMaterial(instanceId: string): boolean {
    return this.findMaterialHost(instanceId) !== null;
  }

  /** Find the XYZ host carrying `instanceId` as a material, with its zone. */
  private findMaterialHost(instanceId: string): { hostId: string; zone: SimZoneId } | null {
    const board = this.boardState.boardState();
    for (const zone of Object.keys(board) as SimZoneId[]) {
      const host = board[zone].find(c => c.overlayMaterials?.some(m => m.instanceId === instanceId));
      if (host) return { hostId: host.instanceId, zone };
    }
    return null;
  }

  private inspect(event: CardTapEvent): void {
    // The page owns the PvP inspector — fire the registered sink. The arm was
    // already cleared by the caller, so no phantom survives.
    this.inspectSink?.(event);
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
