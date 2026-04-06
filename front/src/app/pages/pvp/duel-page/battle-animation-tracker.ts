import { inject, Injectable, signal } from '@angular/core';
import type { AttackMsg, BattleMsg } from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';
import { locationToZoneKey } from '../pvp-zone.utils';
import { CardTravelService } from './card-travel.service';
import { DuelContext } from './duel-context';

interface PendingAttack {
  attackerKey: string;
  defenderKey: string;
  lineEl: HTMLDivElement;
}

/**
 * Tracks in-progress attack animations (attack line + clash impact).
 * Provided at component level (NOT root) — same pattern as LpAnimationTracker.
 */
@Injectable()
export class BattleAnimationTracker {
  private readonly cardTravelService = inject(CardTravelService);
  private readonly ctx = inject(DuelContext);

  private readonly pendingAttack = signal<PendingAttack | null>(null);
  private _releaseTimer: ReturnType<typeof setTimeout> | null = null;

  async processAttackEvent(msg: AttackMsg): Promise<void> {
    // Clear any previous pending attack (e.g. back-to-back attacks)
    this.releasePendingAttack();
    this.clearReleaseTimer();
    const relAttacker = this.ctx.relativePlayer(msg.attackerPlayer);
    const attackerKey = locationToZoneKey(LOCATION.MZONE, msg.attackerSequence, relAttacker);

    let defenderKey: string;
    if (msg.defenderPlayer !== null && msg.defenderSequence !== null) {
      const relDefender = this.ctx.relativePlayer(msg.defenderPlayer);
      defenderKey = locationToZoneKey(LOCATION.MZONE, msg.defenderSequence, relDefender);
    } else {
      // Direct attack → target opponent's side (use HAND zone as visual proxy)
      const opponentRel = relAttacker === 0 ? 1 : 0;
      defenderKey = `HAND-${opponentRel}`;
    }

    const attackerEl = this.cardTravelService.getZoneElement(attackerKey);
    const defenderEl = this.cardTravelService.getZoneElement(defenderKey);
    if (!attackerEl || !defenderEl) return;

    const lineEl = this.createAttackLine(attackerEl, defenderEl);
    if (!lineEl) return;
    const duration = this.ctx.scaledDuration(400, 200);

    // Lunge attacker slightly toward defender
    const aRect = attackerEl.getBoundingClientRect();
    const dRect = defenderEl.getBoundingClientRect();
    const dx = (dRect.left + dRect.width / 2) - (aRect.left + aRect.width / 2);
    const dy = (dRect.top + dRect.height / 2) - (aRect.top + aRect.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const lungeX = (dx / dist) * 12;
    const lungeY = (dy / dist) * 12;

    const cardEl = attackerEl.querySelector<HTMLElement>('.zone-card');
    if (cardEl) {
      const savedTransform = cardEl.style.transform;
      cardEl.animate([
        { transform: `${savedTransform} translate(${lungeX}px, ${lungeY}px)` },
        { transform: savedTransform || 'none' },
      ], { duration: duration * 0.6, easing: 'ease-out' });
    }

    // Extend line from attacker to defender
    await lineEl.animate([
      { clipPath: 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0% 0 0)' },
    ], { duration, easing: 'ease-out', fill: 'forwards' }).finished;

    this.pendingAttack.set({ attackerKey, defenderKey, lineEl });

    // Auto-release after 8s if MSG_BATTLE never arrives (attack negated).
    this._releaseTimer = setTimeout(() => this.releasePendingAttack(), 8000);
  }

  async processBattleEvent(_msg: BattleMsg): Promise<void> {
    this.clearReleaseTimer();
    const pending = this.pendingAttack();
    if (!pending) return; // queue collapse safety

    const defenderEl = this.cardTravelService.getZoneElement(pending.defenderKey);
    const duration = this.ctx.scaledDuration(350, 175);

    // Fade line
    pending.lineEl.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration, easing: 'ease-in',
    });

    // Clash impact on defender
    if (defenderEl) {
      this.playClashImpact(defenderEl, duration);
    }

    await new Promise<void>(r => setTimeout(r, duration));
    pending.lineEl.remove();
    this.pendingAttack.set(null);
  }

  /** Fade out and remove pending attack line (queue-empty / finalize path). */
  releasePendingAttack(): void {
    const pending = this.pendingAttack();
    if (!pending) return;
    const fadeMs = 200;
    pending.lineEl.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: fadeMs, easing: 'ease-out',
    }).finished.then(() => pending.lineEl.remove()).catch(() => pending.lineEl.remove());
    this.pendingAttack.set(null);
  }

  /** Immediate cleanup without animation (duel reset/reconnect). */
  reset(): void {
    this.clearReleaseTimer();
    const pending = this.pendingAttack();
    if (pending) {
      pending.lineEl.remove();
      this.pendingAttack.set(null);
    }
  }

  private clearReleaseTimer(): void {
    if (this._releaseTimer !== null) {
      clearTimeout(this._releaseTimer);
      this._releaseTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  private createAttackLine(attackerEl: HTMLElement, defenderEl: HTMLElement): HTMLDivElement | null {
    return this.cardTravelService.createLineBetween(attackerEl, defenderEl, {
      color: 'linear-gradient(90deg, rgba(255,80,80,0.9), rgba(255,200,60,0.9))',
      shadow: '0 0 6px rgba(255,100,50,0.6)',
    });
  }

  private playClashImpact(targetEl: HTMLElement, duration: number): void {
    const rect = targetEl.getBoundingClientRect();
    const container = this.cardTravelService.getContainer();

    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 51;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border-radius: 4px;
      background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,200,60,0.4) 50%, transparent 70%);
    `;
    container.appendChild(flash);

    flash.animate([
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.4)' },
    ], { duration, easing: 'ease-out' }).finished
      .then(() => flash.remove())
      .catch(() => flash.remove());
  }
}
