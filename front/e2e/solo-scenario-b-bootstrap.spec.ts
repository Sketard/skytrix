import { test, expect } from '@playwright/test';
import { runSoloPvpDebug } from './solo-pvp-harness';

/**
 * γ Option C PR2 c9 (2026-05-29) — Playwright Scenario B : bootstrap SOLO.
 *
 * POST /api/rooms/quick-duel + 1 socket connect ⇒ `isReadyToStart` SOLO
 * true ⇒ DUEL_STARTING ⇒ 5 MSG_DRAW initiaux ⇒ 5 cartes différentes en
 * main P0. Preuve que la combinaison A1+A6+A19 fonctionne en bout-en-bout
 * (1 socket / 1 token serveur / broadcast omniscient à la même socket).
 *
 * Côté unit la couverture équivalente est T-S9 (DUEL_STARTING SOLO
 * carries bothCardCodes) + T-S12 (reconnect). Ce spec ajoute la preuve
 * visuelle + la confirmation que le `_preActivationBuffer` draine bien
 * les 5 MSG_DRAW après le flip `boardActive=true`.
 *
 * ## Pré-requis
 * - back 8080 + duel-server 3001 + front 4200 UP.
 * - admin user seedé avec ≥1 deck (le harness prend le 1er owned).
 *
 * ## Méthode
 * 1. Bootstrap via harness (login admin + POST quick-duel + nav).
 * 2. Attendre que `HAND-0` contienne 5 cartes via snapshot.
 * 3. Capture frame "5-cards-in-hand" + assertions :
 *    - 0 Lock safety timeout console.
 *    - 0 POLL-DROP REGRESSION console.
 *    - 5 cartes en main P0.
 *    - `chainPhase === 'idle'` (pas de chain en bootstrap).
 */

interface SnapshotZone {
  zoneId: string;
  cards: unknown[];
}

interface Snapshot {
  perspective: number;
  logicalState: {
    turnPlayer: number;
    turnCount: number;
    phase: string;
    players: Array<{
      lp: number;
      deckCount: number;
      zones: SnapshotZone[];
    }>;
  };
  renderedState: Snapshot['logicalState'];
  chain: { phase: string; activeLinks: unknown[] };
  animationQueue: unknown[];
  preActivationBuffer: unknown[];
  locks: string[];
  inFlightFloats: unknown[];
  landedFloats: unknown[];
}

function handCount(
  state: Snapshot['logicalState'] | Snapshot['renderedState'],
  playerIdx: number,
): number {
  const player = state.players[playerIdx];
  const hand = player?.zones.find(z => z.zoneId === 'HAND');
  return hand?.cards.length ?? -1;
}

test('γ Scenario B — bootstrap SOLO + 5 MSG_DRAW initiaux', async ({ browser, page: _ignored }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const { harness, dispose } = await runSoloPvpDebug(ctx, {
      tag: `${new Date().toISOString().slice(0, 10)}-scenario-b`,
      timeoutSec: 90,
      firstPlayer: 0,
      screenshotOn: ['Lock safety timeout', 'POLL-DROP REGRESSION'],
    });

    try {
      // The harness took a baseline capture at bootstrap (frame 0001).
      // Wait for the 5 MSG_DRAW animation to drain :
      //  - LOGICAL state hits HAND.length === 5 the moment all 5 MSG_DRAW
      //    payloads have been ingested by `DuelEventProcessor` (early
      //    pass — usually within 1-2s of bootstrap because the processor
      //    dequeues messages faster than the visual animation plays).
      //  - RENDERED state hits HAND.length === 5 only when the per-card
      //    travel float lands AND `commitZone(HAND)` fires (which itself
      //    requires the early HAND-0/HAND-1 locks acquired by
      //    `launchInitialDraw` to release at ref-count 0).
      //
      // Asserting on the RENDERED state is what proves the bootstrap is
      // visually complete — the user sees 5 cards laid out in their fan.
      // `_preActivationBuffer` drain timer is `BOARD_BREATHE_MS = 500ms`
      // (cf. CLAUDE.md) + per-card animation (~300-600ms) so 5 cards
      // visible ≈ 3-6s on a healthy box.
      const harnessPage = ctx.pages()[0];
      const deadline = Date.now() + 20_000;
      let lastSnap: Snapshot | null = null;
      let renderedHand = -1;
      let logicalHand = -1;
      while (Date.now() < deadline) {
        const snap = await harnessPage.evaluate(() => {
          const w = window as unknown as { __skytrixDebug?: { snapshot?: () => unknown } };
          try { return w.__skytrixDebug?.snapshot?.() ?? null; } catch { return null; }
        }) as Snapshot | null;
        if (snap) {
          lastSnap = snap;
          renderedHand = handCount(snap.renderedState, 0);
          logicalHand = handCount(snap.logicalState, 0);
          const handsUnlocked = !snap.locks.includes('HAND-0') && !snap.locks.includes('HAND-1');
          if (renderedHand === 5 && handsUnlocked && snap.inFlightFloats.length === 0) break;
        }
        await harnessPage.waitForTimeout(200);
      }

      await harness.capture('scenario-b-5-cards-in-hand');

      expect(lastSnap, 'snapshot must be readable').not.toBeNull();
      expect(logicalHand, 'P0 logical HAND must reach 5 (processor ingested all MSG_DRAW)').toBe(5);
      expect(renderedHand, 'P0 rendered HAND must reach 5 (animations + commits all done)').toBe(5);
      expect(lastSnap!.locks.includes('HAND-0'),
        'HAND-0 early lock must release after the 5th MSG_DRAW commits').toBeFalsy();
      expect(lastSnap!.inFlightFloats.length,
        'no floats still in flight after bootstrap').toBe(0);
      expect(lastSnap!.chain.phase, 'no chain active at bootstrap').toBe('idle');
      expect(lastSnap!.chain.activeLinks.length).toBe(0);

      const lockTimeouts = harness.lines.filter(l => l.text.includes('Lock safety timeout'));
      const pollDrops = harness.lines.filter(l => l.text.includes('POLL-DROP'));
      expect(lockTimeouts.length, 'no Lock safety timeout fired').toBe(0);
      expect(pollDrops.length, 'no POLL-DROP REGRESSION fired').toBe(0);

      console.log(`Scenario B report : ${harness.outDir}`);
    } finally {
      await dispose();
    }
  } finally {
    await ctx.close();
  }
});
