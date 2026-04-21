import { inject, Injectable } from '@angular/core';
import type { GameEvent } from '../types';
import type { MoveMsg } from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import { locationToZoneId, locationToZoneKey } from '../pvp-zone.utils';
import { getCardImageUrlByCode } from '../pvp-card.utils';
import { ANIMATION_DATA_SOURCE, type QueueEntry } from './animation-data-source';
import { CardTravelService } from './card-travel.service';
import { DrawSequenceManager } from './draw-sequence-manager';
import { DuelContext } from './duel-context';
import { DuelLogCategory, DuelLogger } from './duel-logger';
import type { ZoneLock } from './rendered-board-state.service';

/** Pre-computed context for a single MSG_MOVE event — shared across all branch methods. */
interface MoveContext {
  msg: MoveMsg;
  from: number;
  to: number;
  relPlayer: 0 | 1;
  srcKey: string;
  dstKey: string;
  resolvedCardCode: number;
  cardImage: string;
  isFaceUpFrom: boolean;
  isDefenseFrom: boolean;
  isFaceUpTo: boolean;
  isDefenseTo: boolean;
  isFaceDown: boolean;
  isBanishFaceDown: boolean;
  baseRotateZ: number | undefined;
  travelDuration: number;
  preSrcLock: ZoneLock | undefined;
  preDstLock: ZoneLock | undefined;
  src: string | HTMLElement;
}

// Impact glow colors by destination
const GLOW_GY      = 'rgba(160,160,190,0.6)';
const GLOW_BANISH  = 'rgba(180,100,255,0.6)';
const GLOW_NEUTRAL = 'rgba(180,180,220,0.5)';
const GLOW_DISCARD = 'rgba(255,200,50,0.5)';

const isPile = (loc: number) => loc === LOCATION.GRAVE || loc === LOCATION.BANISHED || loc === LOCATION.EXTRA;

/**
 * Routes MSG_MOVE events to 15 named branch methods and handles
 * XYZ overlay detach, destination zone locking, and source pre-locking.
 * Provided at component level (NOT root).
 */
@Injectable()
export class MoveAnimationRouter {
  private readonly cardTravelService = inject(CardTravelService);
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly ctx = inject(DuelContext);
  private readonly logger = inject(DuelLogger);
  private readonly drawManager = inject(DrawSequenceManager);

  private get rbs() { return this.dataSource.renderedBoardState; }

  /** Pre-acquired ZoneLock handles (src + dst) from preLockQueuedSources. */
  private readonly _preLocks = new Map<string, ZoneLock>();

  /** Tracked timeouts (e.g., overlay detach slide-out) — cleared on reset. */
  private readonly _pendingTimeouts = new Map<ReturnType<typeof setTimeout>, () => void>();

  // --- Public API ---

  processMoveEvent(msg: MoveMsg): number | Promise<void> {
    const mc = this.buildMoveContext(msg);
    if (!mc) return 0;

    // Re-attachment to overlay: no animation
    if (mc.to === LOCATION.OVERLAY) { mc.preSrcLock?.release(); mc.preDstLock?.release(); return 0; }

    // XYZ overlay detach: OVERLAY -> GRAVE/BANISHED
    if (mc.from === LOCATION.OVERLAY && (mc.to === LOCATION.GRAVE || mc.to === LOCATION.BANISHED)) {
      return this.overlayDetach(mc);
    }

    const isToMZONE = mc.to === LOCATION.MZONE
      && (mc.from === LOCATION.HAND || mc.from === LOCATION.EXTRA || mc.from === LOCATION.DECK
          || mc.from === LOCATION.GRAVE || mc.from === LOCATION.BANISHED);
    const isToSZONE = mc.to === LOCATION.SZONE
      && (mc.from === LOCATION.HAND || mc.from === LOCATION.GRAVE || mc.from === LOCATION.BANISHED
          || mc.from === LOCATION.DECK || mc.from === LOCATION.EXTRA);
    if (isToMZONE || isToSZONE) return this.summonToField(mc);

    if (mc.msg.isToken && (mc.from === LOCATION.MZONE || mc.from === LOCATION.SZONE)
      && (mc.to === LOCATION.GRAVE || mc.to === LOCATION.BANISHED)) return this.tokenDissolve(mc);

    if ((mc.from === LOCATION.MZONE || mc.from === LOCATION.SZONE)
      && (mc.to === LOCATION.GRAVE || mc.to === LOCATION.BANISHED || mc.to === LOCATION.EXTRA)) {
      const isDestroy = (mc.msg.reason & 0x1) !== 0;
      return isDestroy ? this.leaveFieldDestroy(mc) : this.leaveFieldNonDestroy(mc);
    }

    if ((mc.from === LOCATION.MZONE || mc.from === LOCATION.SZONE) && mc.to === LOCATION.HAND)
      return this.bounceToHand(mc);

    if ((mc.from === LOCATION.MZONE || mc.from === LOCATION.SZONE) && mc.to === LOCATION.DECK)
      return this.returnToDeck(mc);

    if ((mc.from === LOCATION.MZONE || mc.from === LOCATION.SZONE)
      && (mc.to === LOCATION.MZONE || mc.to === LOCATION.SZONE))
      return this.fieldToField(mc);

    if (mc.from === LOCATION.HAND && (mc.to === LOCATION.GRAVE || mc.to === LOCATION.BANISHED))
      return this.discardFromHand(mc);

    if (mc.from === LOCATION.HAND && mc.to === LOCATION.DECK)
      return this.handToDeck(mc);

    if ((mc.from === LOCATION.DECK || mc.from === LOCATION.EXTRA)
      && (mc.to === LOCATION.GRAVE || mc.to === LOCATION.BANISHED))
      return this.deckOrExtraToPile(mc);

    if (isPile(mc.from) && mc.to === LOCATION.HAND)
      return this.pileToHand(mc);

    if (isPile(mc.from) && mc.to === LOCATION.DECK)
      return this.pileToDeck(mc);

    if (isPile(mc.from) && isPile(mc.to))
      return this.pileToPile(mc);

    // Generic fallback
    return this.fallback(mc);
  }

  private processOverlayDetachEvent(msg: MoveMsg): number | Promise<void> {
    if (this.ctx.reducedMotion()) return 0;
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const srcKey = locationToZoneKey(LOCATION.OVERLAY, msg.fromSequence, relPlayer);
    const dstKey = locationToZoneKey(msg.toLocation, msg.toSequence, relPlayer);
    const slideOutDuration = this.ctx.scaledDuration(200, 100);
    const travelDuration = this.ctx.scaledDuration(400, 200);
    const cardBackImage = this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');

    const srcElement = this.cardTravelService.getZoneElement(srcKey);
    this.ctx.announceEvent('Material detached', msg.player);
    if (!srcElement) return 0;

    srcElement.style.setProperty('--pvp-detach-duration', `${slideOutDuration}ms`);
    srcElement.classList.add('pvp-xyz-detach');

    return new Promise<void>(resolve => {
      const id = setTimeout(() => {
        this._pendingTimeouts.delete(id);
        srcElement.classList.remove('pvp-xyz-detach');
        srcElement.style.removeProperty('--pvp-detach-duration');
        this.cardTravelService.travel(srcKey, dstKey, cardBackImage, {
          duration: travelDuration,
          showBack: true,
          departureGlowColor: 'rgba(0, 150, 255, 0.4)',
          impactGlowColor: msg.toLocation === LOCATION.GRAVE ? GLOW_GY : GLOW_BANISH,
          landingStyle: msg.toLocation === LOCATION.GRAVE ? 'soft' : 'banish',
          baseRotateZ: this.ctx.cardBaseRotation(relPlayer),
          dstZoneKey: dstKey,
        }).then(resolve);
      }, slideOutDuration);
      this._pendingTimeouts.set(id, resolve);
    });
  }

  /**
   * Pre-lock all zones that will be animated by queued events.
   * - MSG_MOVE: locks source AND destination zones.
   * - MSG_DRAW: locks HAND (destination) AND DECK (source) for both players.
   *
   * This prevents commitUnlocked() from syncing zones that have pending
   * animations, regardless of whether the caller is PvP or replay.
   */
  preLockQueuedSources(events: readonly QueueEntry[] = this.dataSource.animationQueue()): void {
    for (const event of events) {
      if ('kind' in event) continue; // skip directives
      if (event.type === 'MSG_DRAW') {
        // Lock HAND only — DECK is intentionally NOT locked because its count
        // decreasing during draw is visually natural, and locking it before
        // BOARD_STATE arrives would freeze deckCount=0 (from EMPTY_DUEL_STATE).
        const relPlayer = this.ctx.relativePlayer((event as { player: number }).player);
        const handKey = `HAND-${relPlayer}`;
        if (!this._preLocks.has(handKey)) this._preLocks.set(handKey, this.rbs.lockZone(handKey));
        continue;
      }
      if (event.type !== 'MSG_MOVE') continue;
      const msg = event as MoveMsg;
      const relPlayer = this.ctx.relativePlayer(msg.player);

      const from = msg.fromLocation;
      const srcKey = locationToZoneKey(from, msg.fromSequence, relPlayer);
      if (srcKey && !this._preLocks.has(srcKey)
        && (from === LOCATION.MZONE || from === LOCATION.SZONE
          || from === LOCATION.GRAVE || from === LOCATION.BANISHED || from === LOCATION.EXTRA
          || from === LOCATION.HAND)) {
        this._preLocks.set(srcKey, this.rbs.lockZone(srcKey));
      }

      const to = msg.toLocation;
      const dstKey = locationToZoneKey(to, msg.toSequence, relPlayer);
      if (dstKey && !this._preLocks.has(dstKey)
        && (to === LOCATION.MZONE || to === LOCATION.SZONE
          || to === LOCATION.GRAVE || to === LOCATION.BANISHED || to === LOCATION.EXTRA
          || to === LOCATION.HAND)) {
        this._preLocks.set(dstKey, this.rbs.lockZone(dstKey));
      }
    }
  }

  releaseAllPreLocks(): void {
    for (const lock of this._preLocks.values()) lock.release();
    this._preLocks.clear();
  }

  clearTimeouts(): void {
    for (const [id, resolve] of this._pendingTimeouts) {
      clearTimeout(id);
      resolve();
    }
    this._pendingTimeouts.clear();
  }

  /** Release only pre-locks for specific source keys. */
  releasePreLocksForKeys(keys: Set<string>): void {
    for (const key of keys) {
      const lock = this._preLocks.get(key);
      if (lock) { lock.release(); this._preLocks.delete(key); }
    }
  }

  /** Consume a pre-acquired lock (returns it and removes from map). */
  private consumePreLock(zoneKey: string): ZoneLock | undefined {
    const lock = this._preLocks.get(zoneKey);
    if (lock) this._preLocks.delete(zoneKey);
    return lock;
  }

  // --- Private branch methods ---

  private buildMoveContext(msg: MoveMsg): MoveContext | null {
    const from = msg.fromLocation;
    const to = msg.toLocation;
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const dstKey = locationToZoneKey(to, msg.toSequence, relPlayer);
    const srcKey = locationToZoneKey(from, msg.fromSequence, relPlayer);
    const fromPos = msg.fromPosition;
    const toPos = msg.toPosition;
    const isFaceUpFrom = (fromPos & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    const isDefenseFrom = (fromPos & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const isFaceUpTo = (toPos & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    const isDefenseTo = (toPos & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;

    const locName = (v: number) => Object.keys(LOCATION).find(k => LOCATION[k as keyof typeof LOCATION] === v) ?? String(v);
    this.logger.log(DuelLogCategory.MOVE, '%s→%s card=%d reason=0x%s relPlayer=%d(msgPlayer=%d/own=%d) fromSeq=%d toSeq=%d | from:%s%s → to:%s%s | src=%s dst=%s',
      locName(from), locName(to), msg.cardCode, msg.reason.toString(16),
      relPlayer, msg.player, this.ctx.ownPlayerIndex(),
      msg.fromSequence, msg.toSequence,
      isFaceUpFrom ? 'face-up' : 'face-down', isDefenseFrom ? '/defense' : '/attack',
      isFaceUpTo ? 'face-up' : 'face-down', isDefenseTo ? '/defense' : '/attack',
      srcKey, dstKey);
    const _boardZoneId = (loc: number, seq: number) =>
      loc === LOCATION.GRAVE ? 'GY' : loc === LOCATION.BANISHED ? 'BANISHED' : loc === LOCATION.EXTRA ? 'EXTRA' : locationToZoneId(loc, seq);
    const _pZones = this.rbs.logicalState().players[relPlayer]?.zones ?? [];
    const _srcZone = _pZones.find(z => z.zoneId === _boardZoneId(from, msg.fromSequence));
    const _dstZone = _pZones.find(z => z.zoneId === _boardZoneId(to, msg.toSequence));
    this.logger.log(DuelLogCategory.MOVE, 'relPlayer=%d | src=%s cards=%o | dst=%s cards=%o',
      relPlayer,
      srcKey, (_srcZone?.cards ?? []).map(c => c.cardCode ?? 0),
      dstKey, (_dstZone?.cards ?? []).map(c => c.cardCode ?? 0));
    const resolvedCardCode = msg.cardCode || (_dstZone?.cards.at(-1)?.cardCode ?? 0);

    const preSrcLock = this.consumePreLock(srcKey);
    const preDstLock = this.consumePreLock(dstKey);

    const isFaceDown = (msg.fromPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const isBanishFaceDown = to === LOCATION.BANISHED
      && (msg.toPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const baseRotateZ = this.ctx.cardBaseRotation(relPlayer);
    const travelDuration = this.ctx.scaledDuration(400, 200);
    const cardImage = this.cardTravelService.toAbsoluteUrl(getCardImageUrlByCode(resolvedCardCode));

    const src: string | HTMLElement = from === LOCATION.HAND
      ? this.drawManager.resolveHandTarget(srcKey, msg.fromSequence)
      : srcKey;

    return {
      msg, from, to, relPlayer, srcKey, dstKey, resolvedCardCode, cardImage,
      isFaceUpFrom, isDefenseFrom, isFaceUpTo, isDefenseTo,
      isFaceDown, isBanishFaceDown, baseRotateZ, travelDuration,
      preSrcLock, preDstLock, src,
    };
  }

  /**
   * Commit `dstLock` and — if the zone is now fully unlocked (commitZone just
   * fired on this commit) — clear any landed float overlay at `dstKey`. For
   * multi-event groups sharing a destination (Link materials → GY, mass
   * destroy, etc.) the intermediate commits only decrement the ref-count;
   * the floats MUST stay visible as overlays so the user sees each card
   * piling up instead of disappearing while the rendered pile waits for the
   * final commit. Only the last commit (ref=0) triggers commitZone, at
   * which point the rendered zone now shows the real cards and the floats
   * are redundant → safe to clear in one sweep.
   *
   * HAND destinations skip this helper entirely — floats are kept for
   * `processShuffleEvent` / `confirmCardsInHand` reveal.
   */
  private commitAndClearFloat(dstLock: { commit(): void }, dstKey: string): void {
    dstLock.commit();
    const stillLocked = this.rbs.lockedZoneKeys().includes(dstKey);
    if (!stillLocked) this.cardTravelService.clearLandedByDstPrefix(dstKey);
  }

  private overlayDetach(mc: MoveContext): number | Promise<void> {
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const p = this.processOverlayDetachEvent(mc.msg);
    if (!(p instanceof Promise)) { mc.preSrcLock?.release(); dstLock.release(); return p; }
    return p.then(
      () => { mc.preSrcLock?.commit(); this.commitAndClearFloat(dstLock, mc.dstKey); },
      () => { mc.preSrcLock?.release(); dstLock.release(); },
    );
  }

  private summonToField(mc: MoveContext): Promise<void> {
    const isMonsterDefense = mc.to === LOCATION.MZONE
      && (mc.msg.toPosition & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const isSet = (mc.msg.toPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    this.ctx.announceEvent('Card summoned', mc.msg.player);
    mc.preSrcLock?.commit();
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const summonP = this.cardTravelService.travel(mc.src, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration,
      destRotateZ: isMonsterDefense ? -90 : undefined,
      showBack: isSet, baseRotateZ: mc.baseRotateZ,
      landingStyle: 'slam',
    });
    return summonP.then(
      () => this.commitAndClearFloat(dstLock, mc.dstKey),
      () => dstLock.release(),
    );
  }

  private tokenDissolve(mc: MoveContext): number | Promise<void> {
    if (this.ctx.reducedMotion()) { mc.preSrcLock?.release(); mc.preDstLock?.release(); return 0; }
    const srcElement = this.cardTravelService.getZoneElement(mc.srcKey);
    this.ctx.announceEvent('Token removed', mc.msg.player);
    if (!srcElement) { mc.preSrcLock?.release(); mc.preDstLock?.release(); return 0; }
    const anim = srcElement.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.7)' }],
      { duration: this.ctx.scaledDuration(300, 100), easing: 'ease-out', fill: 'forwards' },
    );
    return anim.finished.then(() => {
      srcElement.getAnimations().forEach(a => a.cancel());
      mc.preSrcLock?.commit();
      mc.preDstLock?.commit();
    });
  }

  private leaveFieldDestroy(mc: MoveContext): Promise<void> {
    const impactGlow = mc.to === LOCATION.GRAVE ? GLOW_GY
      : mc.to === LOCATION.BANISHED ? GLOW_BANISH : undefined;
    this.ctx.announceEvent('Card destroyed', mc.msg.player);
    const srcEl = this.cardTravelService.getZoneElement(mc.srcKey);
    const preEffect = (srcEl && !this.ctx.reducedMotion())
      ? this.cardTravelService.preDestroyEffect(srcEl, mc.isFaceDown ? null : mc.cardImage, this.ctx.scaledDuration(400, 200))
      : Promise.resolve();
    const srcLock = mc.preSrcLock ?? this.rbs.lockZone(mc.srcKey);
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    return preEffect.then(async () => {
      const p = this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
        duration: mc.travelDuration,
        showBack: mc.isFaceDown,
        flipDuringTravel: mc.isBanishFaceDown,
        impactGlowColor: impactGlow,
        landingStyle: mc.to === LOCATION.BANISHED ? 'banish' : 'soft',
        srcRotateZ: mc.isDefenseFrom ? -90 : undefined,
        baseRotateZ: mc.baseRotateZ,
      });
      srcLock.commit();
      await p;
      this.commitAndClearFloat(dstLock, mc.dstKey);
    }).catch(() => { srcLock.release(); dstLock.release(); });
  }

  private leaveFieldNonDestroy(mc: MoveContext): Promise<void> {
    const impactGlow = mc.to === LOCATION.GRAVE ? GLOW_GY
      : mc.to === LOCATION.BANISHED ? GLOW_BANISH : undefined;
    this.ctx.announceEvent('Card sent off field', mc.msg.player);
    const srcLock = mc.preSrcLock ?? this.rbs.lockZone(mc.srcKey);
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const travelP = this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration,
      showBack: mc.isFaceDown,
      flipDuringTravel: mc.isBanishFaceDown,
      impactGlowColor: impactGlow,
      landingStyle: mc.to === LOCATION.BANISHED ? 'banish' : 'soft',
      srcRotateZ: mc.isDefenseFrom ? -90 : undefined,
      baseRotateZ: mc.baseRotateZ,
    });
    srcLock.commit();
    return travelP.then(
      () => this.commitAndClearFloat(dstLock, mc.dstKey),
      () => dstLock.release(),
    );
  }

  private bounceToHand(mc: MoveContext): Promise<void> {
    const srcLock = mc.preSrcLock ?? this.rbs.lockZone(mc.srcKey);
    srcLock.commit();
    // Reuse preDstLock as travelToHand's handLock — releasing here would drop
    // HAND ref-count to 0 and flash the bounced card before animation starts.
    const batchIdx = this.drawManager.consumeHandBatchSlot(mc.relPlayer);
    return this.drawManager.travelToHand(mc.srcKey, mc.relPlayer, mc.cardImage, {
      duration: mc.travelDuration, srcRotateZ: mc.isDefenseFrom ? -90 : undefined, baseRotateZ: mc.baseRotateZ,
    }, batchIdx, mc.preDstLock, mc.resolvedCardCode);
  }

  private returnToDeck(mc: MoveContext): Promise<void> {
    mc.preSrcLock?.commit();
    mc.preDstLock?.release(); // DECK not locked by design
    const dstKey = mc.dstKey;
    return this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration, flipDuringTravel: true, impactGlowColor: GLOW_NEUTRAL,
      srcRotateZ: mc.isDefenseFrom ? -90 : undefined, baseRotateZ: mc.baseRotateZ,
    }).then(() => { this.cardTravelService.clearLandedByDstPrefix(dstKey); });
  }

  private fieldToField(mc: MoveContext): Promise<void> {
    const isMonsterDefenseTo = mc.to === LOCATION.MZONE && mc.isDefenseTo;
    const srcLock = mc.preSrcLock ?? this.rbs.lockZone(mc.srcKey);
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const travelP = this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration, impactGlowColor: GLOW_NEUTRAL,
      srcRotateZ: mc.isDefenseFrom ? -90 : undefined,
      destRotateZ: isMonsterDefenseTo ? -90 : undefined,
      baseRotateZ: mc.baseRotateZ,
    });
    srcLock.commit();
    return travelP.then(
      () => this.commitAndClearFloat(dstLock, mc.dstKey),
      () => dstLock.release(),
    );
  }

  private discardFromHand(mc: MoveContext): Promise<void> {
    const isHiddenCard = !mc.msg.cardCode;
    const shouldFlip = mc.isBanishFaceDown || (mc.to === LOCATION.GRAVE && isHiddenCard);
    const showBack = isHiddenCard && mc.to === LOCATION.GRAVE;
    const impactGlow = mc.to === LOCATION.GRAVE ? GLOW_GY : GLOW_BANISH;
    mc.preSrcLock?.commit();
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const discardP = this.cardTravelService.travel(mc.src, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration,
      flipDuringTravel: shouldFlip,
      showBack,
      departureGlowColor: GLOW_DISCARD,
      impactGlowColor: impactGlow,
      landingStyle: mc.to === LOCATION.BANISHED ? 'banish' : 'soft',
      baseRotateZ: mc.baseRotateZ,
    });
    return discardP.then(
      () => this.commitAndClearFloat(dstLock, mc.dstKey),
      () => dstLock.release(),
    );
  }

  private handToDeck(mc: MoveContext): Promise<void> {
    mc.preSrcLock?.commit();
    mc.preDstLock?.release(); // DECK not locked by design
    const dstKey = mc.dstKey;
    return this.cardTravelService.travel(mc.src, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration, flipDuringTravel: true, impactGlowColor: GLOW_NEUTRAL, baseRotateZ: mc.baseRotateZ,
    }).then(() => { this.cardTravelService.clearLandedByDstPrefix(dstKey); });
  }

  private deckOrExtraToPile(mc: MoveContext): Promise<void> {
    const srcLock = mc.preSrcLock ?? this.rbs.lockZone(mc.srcKey);
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const travelP = this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration,
      showBack: mc.isFaceDown,
      flipDuringTravel: mc.isFaceDown && !mc.isBanishFaceDown,
      impactGlowColor: mc.to === LOCATION.GRAVE ? GLOW_GY : GLOW_BANISH,
      landingStyle: mc.to === LOCATION.BANISHED ? 'banish' : 'soft',
      baseRotateZ: mc.baseRotateZ,
    });
    srcLock.commit();
    return travelP.then(
      () => this.commitAndClearFloat(dstLock, mc.dstKey),
      () => dstLock.release(),
    );
  }

  private pileToHand(mc: MoveContext): Promise<void> {
    mc.preSrcLock?.commit();
    // Reuse preDstLock as travelToHand's handLock — releasing here would drop
    // HAND ref-count to 0 and flash the searched card before animation starts.
    const batchIdx = this.drawManager.consumeHandBatchSlot(mc.relPlayer);
    return this.drawManager.travelToHand(mc.srcKey, mc.relPlayer, mc.cardImage, {
      duration: mc.travelDuration, baseRotateZ: mc.baseRotateZ,
    }, batchIdx, mc.preDstLock, mc.resolvedCardCode);
  }

  private pileToDeck(mc: MoveContext): Promise<void> {
    mc.preSrcLock?.commit();
    mc.preDstLock?.release(); // DECK not locked by design
    const dstKey = mc.dstKey;
    return this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration, flipDuringTravel: true, impactGlowColor: GLOW_NEUTRAL, baseRotateZ: mc.baseRotateZ,
    }).then(() => { this.cardTravelService.clearLandedByDstPrefix(dstKey); });
  }

  private pileToPile(mc: MoveContext): Promise<void> {
    const srcLock = mc.preSrcLock ?? this.rbs.lockZone(mc.srcKey);
    const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
    const travelP = this.cardTravelService.travel(mc.srcKey, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration,
      showBack: mc.isFaceDown,
      flipDuringTravel: mc.isBanishFaceDown,
      impactGlowColor: mc.to === LOCATION.BANISHED ? GLOW_BANISH : GLOW_GY,
      landingStyle: mc.to === LOCATION.BANISHED ? 'banish' : 'soft',
      baseRotateZ: mc.baseRotateZ,
    });
    srcLock.commit();
    return travelP.then(
      () => this.commitAndClearFloat(dstLock, mc.dstKey),
      () => dstLock.release(),
    );
  }

  private fallback(mc: MoveContext): number | Promise<void> {
    if (mc.to === LOCATION.HAND) {
      mc.preSrcLock?.commit();
      // Reuse preDstLock as travelToHand's handLock — releasing here would drop
      // HAND ref-count to 0 and flash the tutored card before animation starts.
      const batchIdx = this.drawManager.consumeHandBatchSlot(mc.relPlayer);
      return this.drawManager.travelToHand(mc.src, mc.relPlayer, mc.cardImage, {
        duration: mc.travelDuration, baseRotateZ: mc.baseRotateZ,
      }, batchIdx, mc.preDstLock, mc.resolvedCardCode);
    }
    const fallbackP = this.cardTravelService.travel(mc.src, mc.dstKey, mc.cardImage, {
      duration: mc.travelDuration, baseRotateZ: mc.baseRotateZ,
    });
    if (mc.to === LOCATION.MZONE || mc.to === LOCATION.SZONE) {
      mc.preSrcLock?.commit();
      const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
      return fallbackP.then(
        () => { dstLock.commit(); },
        () => dstLock.release(),
      );
    }
    if (isPile(mc.to)) {
      mc.preSrcLock?.commit();
      const dstLock = mc.preDstLock ?? this.rbs.lockZone(mc.dstKey);
      return fallbackP.then(
        () => { dstLock.commit(); },
        () => dstLock.release(),
      );
    }
    mc.preSrcLock?.release();
    mc.preDstLock?.release();
    return fallbackP;
  }

}
