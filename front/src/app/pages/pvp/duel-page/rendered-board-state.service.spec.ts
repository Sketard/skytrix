import { TestBed } from '@angular/core/testing';
import { RenderedBoardStateService, ZoneLock } from './rendered-board-state.service';
import { DuelState, EMPTY_DUEL_STATE } from '../types';
import { POSITION } from '../duel-ws.types';
import type { Player, PlayerBoardState, BoardZone, ZoneId } from '../duel-ws.types';

/** Build a minimal DuelState with overrides per player. */
function makeState(overrides?: {
  p0?: Partial<PlayerBoardState>;
  p1?: Partial<PlayerBoardState>;
  turn?: number;
  phase?: DuelState['phase'];
}): DuelState {
  const base: PlayerBoardState = { lp: 8000, deckCount: 40, extraCount: 15, zones: [] };
  return {
    turnPlayer: 0,
    turnCount: overrides?.turn ?? 1,
    phase: overrides?.phase ?? 'MAIN1',
    players: [
      { ...base, ...overrides?.p0 },
      { ...base, ...overrides?.p1 },
    ],
  };
}

function zone(zoneId: ZoneId, cardCode: number | null = null): BoardZone {
  return {
    zoneId,
    cards: cardCode != null
      ? [{ cardCode, name: null, position: POSITION.FACEUP_ATTACK, overlayMaterials: [], counters: {} }]
      : [],
  };
}

describe('RenderedBoardStateService', () => {
  let rbs: RenderedBoardStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RenderedBoardStateService] });
    rbs = TestBed.inject(RenderedBoardStateService);
  });

  describe('initial state', () => {
    it('should start with EMPTY_DUEL_STATE for both logical and rendered', () => {
      expect(rbs.logicalState()).toEqual(EMPTY_DUEL_STATE);
      expect(rbs.renderedState()).toEqual(EMPTY_DUEL_STATE);
      expect(rbs.hasLockedZones()).toBeFalse();
    });
  });

  describe('updateLogical + syncRendered (no locks)', () => {
    it('should sync rendered to logical when no locks', () => {
      const state = makeState({ p0: { lp: 5000 } });
      rbs.updateLogical(state);
      rbs.syncRendered();
      expect(rbs.renderedState()).toEqual(state);
    });

    it('should not auto-sync rendered on updateLogical alone', () => {
      rbs.updateLogical(makeState({ p0: { lp: 3000 } }));
      expect(rbs.renderedState()).toEqual(EMPTY_DUEL_STATE);
    });
  });

  describe('lockZone + commit', () => {
    it('should set hasLockedZones to true when a lock is active', () => {
      rbs.lockZone('M1-0');
      expect(rbs.hasLockedZones()).toBeTrue();
    });

    it('should protect locked zone from syncRendered', () => {
      const initial = makeState({ p0: { zones: [zone('M1', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      const lock = rbs.lockZone('M1-0');
      const updated = makeState({ p0: { zones: [zone('M1', 999)] } });
      rbs.updateLogical(updated);
      rbs.syncRendered();

      // M1 should still show card 100 (locked)
      const renderedZone = rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M1');
      expect(renderedZone!.cards[0].cardCode).toBe(100);

      lock.commit();
      // After commit, zone should show logical state (999)
      const afterCommit = rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M1');
      expect(afterCommit!.cards[0].cardCode).toBe(999);
    });

    it('should sync unlocked zones while keeping locked zones frozen', () => {
      const initial = makeState({ p0: { zones: [zone('M1', 100), zone('M2', 200)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.lockZone('M1-0');
      const updated = makeState({ p0: { zones: [zone('M1', 111), zone('M2', 222)] } });
      rbs.updateLogical(updated);
      rbs.syncRendered();

      const p0Zones = rbs.renderedState().players[0].zones;
      expect(p0Zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(100); // locked
      expect(p0Zones.find(z => z.zoneId === 'M2')!.cards[0].cardCode).toBe(222); // unlocked → synced
    });

    it('should set hasLockedZones to false after commit', () => {
      const lock = rbs.lockZone('M1-0');
      lock.commit();
      expect(rbs.hasLockedZones()).toBeFalse();
    });
  });

  describe('lockZone + release', () => {
    it('should release without committing (zone stays at old rendered state)', () => {
      const initial = makeState({ p0: { zones: [zone('M1', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      const lock = rbs.lockZone('M1-0');
      rbs.updateLogical(makeState({ p0: { zones: [zone('M1', 999)] } }));
      lock.release();

      // Zone should still show old value (100), not logical (999)
      const renderedZone = rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M1');
      expect(renderedZone!.cards[0].cardCode).toBe(100);
      expect(rbs.hasLockedZones()).toBeFalse();
    });
  });

  describe('ref-counting (nested locks)', () => {
    it('should require all nested locks to release before zone unlocks', () => {
      const initial = makeState({ p0: { zones: [zone('M1', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      const outer = rbs.lockZone('M1-0');
      const inner = rbs.lockZone('M1-0');

      rbs.updateLogical(makeState({ p0: { zones: [zone('M1', 999)] } }));

      inner.commit();
      // Still locked (outer holds)
      expect(rbs.hasLockedZones()).toBeTrue();

      outer.commit();
      // Now fully unlocked and committed
      expect(rbs.hasLockedZones()).toBeFalse();
      expect(rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(999);
    });
  });

  describe('idempotent commit/release', () => {
    it('should be safe to call commit twice', () => {
      const lock = rbs.lockZone('M1-0');
      lock.commit();
      lock.commit(); // should not throw or double-decrement
      expect(rbs.hasLockedZones()).toBeFalse();
    });

    it('should be safe to call release twice', () => {
      const lock = rbs.lockZone('M1-0');
      lock.release();
      lock.release();
      expect(rbs.hasLockedZones()).toBeFalse();
    });

    it('should be safe to commit after release (no-op)', () => {
      const lock = rbs.lockZone('M1-0');
      lock.release();
      lock.commit(); // already released, should be no-op
      expect(rbs.hasLockedZones()).toBeFalse();
    });

    it('should be safe to release after commit (no-op)', () => {
      const lock = rbs.lockZone('M1-0');
      lock.commit();
      lock.release(); // already committed, should be no-op
      expect(rbs.hasLockedZones()).toBeFalse();
    });
  });

  describe('LP commit discipline', () => {
    it('should preserve LP from rendered during mergeUnlockedZones', () => {
      const initial = makeState({ p0: { lp: 8000 } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.lockZone('M1-0');
      rbs.updateLogical(makeState({ p0: { lp: 5000, zones: [zone('M1', 100)] } }));
      rbs.syncRendered();

      // LP should stay at 8000 (rendered), not 5000 (logical)
      expect(rbs.renderedState().players[0].lp).toBe(8000);
    });

    it('commitLp should sync LP from logical to rendered', () => {
      rbs.updateLogical(makeState({ p0: { lp: 3000 } }));
      rbs.syncRendered();
      rbs.updateLogical(makeState({ p0: { lp: 1000 } }));
      rbs.commitLp(0 as Player);
      expect(rbs.renderedState().players[0].lp).toBe(1000);
      // Player 1 LP unchanged
      expect(rbs.renderedState().players[1].lp).toBe(8000);
    });
  });

  describe('syncPileCounts', () => {
    it('should sync deckCount and extraCount from logical, preserve zones and LP', () => {
      const initial = makeState({ p0: { lp: 8000, deckCount: 40, extraCount: 15, zones: [zone('M1', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      const updated = makeState({
        p0: { lp: 3000, deckCount: 38, extraCount: 14, zones: [zone('M1', 999)] },
        turn: 2, phase: 'BATTLE_START',
      });
      rbs.updateLogical(updated);
      rbs.syncPileCounts();

      const p0 = rbs.renderedState().players[0];
      expect(p0.deckCount).toBe(38);    // synced
      expect(p0.extraCount).toBe(14);   // synced
      expect(p0.lp).toBe(8000);         // preserved from rendered
      expect(p0.zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(100); // zone NOT synced
      expect(rbs.renderedState().turnCount).toBe(2);  // global metadata synced
      expect(rbs.renderedState().phase).toBe('BATTLE_START');
    });

    it('should respect EXTRA lock during syncPileCounts', () => {
      const initial = makeState({ p0: { extraCount: 15 } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.lockZone('EXTRA-0');
      rbs.updateLogical(makeState({ p0: { extraCount: 13 } }));
      rbs.syncPileCounts();

      expect(rbs.renderedState().players[0].extraCount).toBe(15); // locked, not synced
    });
  });

  describe('commitAll', () => {
    it('should force sync rendered to logical, clearing all locks', () => {
      rbs.updateLogical(makeState({ p0: { lp: 1000, zones: [zone('M1', 999)] } }));
      rbs.lockZone('M1-0');
      rbs.commitAll();

      expect(rbs.renderedState().players[0].lp).toBe(1000);
      expect(rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(999);
      expect(rbs.hasLockedZones()).toBeFalse();
    });
  });

  describe('commitUnlocked', () => {
    it('should sync unlocked zones, skip locked zones', () => {
      const initial = makeState({ p0: { zones: [zone('M1', 100), zone('M2', 200)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.lockZone('M1-0');
      rbs.updateLogical(makeState({ p0: { zones: [zone('M1', 111), zone('M2', 222)] } }));
      rbs.commitUnlocked();

      const p0Zones = rbs.renderedState().players[0].zones;
      expect(p0Zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(100); // locked
      expect(p0Zones.find(z => z.zoneId === 'M2')!.cards[0].cardCode).toBe(222); // unlocked
    });

    it('should full-sync when no locks', () => {
      const state = makeState({ p0: { lp: 5000, zones: [zone('M1', 999)] } });
      rbs.updateLogical(state);
      rbs.commitUnlocked();
      expect(rbs.renderedState()).toEqual(state);
    });
  });

  describe('commitZone', () => {
    it('should commit a specific zone from logical to rendered', () => {
      const initial = makeState({ p0: { zones: [zone('M1', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.updateLogical(makeState({ p0: { zones: [zone('M1', 999)] } }));
      rbs.commitZone('M1-0');

      expect(rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(999);
    });

    it('should commit DECK count separately', () => {
      rbs.updateLogical(makeState({ p0: { deckCount: 40 } }));
      rbs.syncRendered();

      rbs.updateLogical(makeState({ p0: { deckCount: 35 } }));
      rbs.commitZone('DECK-0');
      expect(rbs.renderedState().players[0].deckCount).toBe(35);
    });

    it('should commit EXTRA zone and extraCount together', () => {
      const initial = makeState({ p0: { extraCount: 15, zones: [zone('EXTRA', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.updateLogical(makeState({ p0: { extraCount: 13, zones: [zone('EXTRA', 200)] } }));
      rbs.commitZone('EXTRA-0');

      expect(rbs.renderedState().players[0].extraCount).toBe(13);
      expect(rbs.renderedState().players[0].zones.find(z => z.zoneId === 'EXTRA')!.cards[0].cardCode).toBe(200);
    });

    it('should add zone to rendered if it did not exist before', () => {
      rbs.updateLogical(makeState({ p0: { zones: [] } }));
      rbs.syncRendered();

      rbs.updateLogical(makeState({ p0: { zones: [zone('M3', 500)] } }));
      rbs.commitZone('M3-0');

      expect(rbs.renderedState().players[0].zones.find(z => z.zoneId === 'M3')!.cards[0].cardCode).toBe(500);
    });
  });

  describe('lockedZoneKeys', () => {
    it('should return all currently locked zone keys', () => {
      rbs.lockZone('M1-0');
      rbs.lockZone('S2-1');
      expect(rbs.lockedZoneKeys().sort()).toEqual(['M1-0', 'S2-1']);
    });
  });

  describe('assertNoLocks', () => {
    it('should not throw when no locks exist', () => {
      expect(() => rbs.assertNoLocks('test-site')).not.toThrow();
    });

    it('should throw when locks are active (dev mode)', () => {
      rbs.lockZone('M1-0');
      expect(() => rbs.assertNoLocks('test-site')).toThrowError(/DUEL-ASSERT.*test-site.*1 locks still active.*M1-0/);
    });
  });

  describe('lockZone with source parameter', () => {
    it('should accept optional source string without error', () => {
      const lock = rbs.lockZone('M1-0', 'test-source');
      expect(rbs.hasLockedZones()).toBeTrue();
      lock.release();
    });
  });

  describe('player 1 zone locking', () => {
    it('should protect player 1 locked zone from syncRendered', () => {
      const initial = makeState({ p1: { zones: [zone('M1', 100)] } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      const lock = rbs.lockZone('M1-1');
      rbs.updateLogical(makeState({ p1: { zones: [zone('M1', 999)] } }));
      rbs.syncRendered();

      expect(rbs.renderedState().players[1].zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(100);
      lock.commit();
      expect(rbs.renderedState().players[1].zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(999);
    });

    it('should commitZone for player 1', () => {
      rbs.updateLogical(makeState({ p1: { zones: [zone('S2', 300)] } }));
      rbs.syncRendered();
      rbs.updateLogical(makeState({ p1: { zones: [zone('S2', 777)] } }));
      rbs.commitZone('S2-1');
      expect(rbs.renderedState().players[1].zones.find(z => z.zoneId === 'S2')!.cards[0].cardCode).toBe(777);
    });
  });

  describe('syncPileCounts — player 1', () => {
    it('should sync player 1 deckCount and extraCount', () => {
      const initial = makeState({ p1: { deckCount: 40, extraCount: 15 } });
      rbs.updateLogical(initial);
      rbs.syncRendered();

      rbs.updateLogical(makeState({ p1: { deckCount: 36, extraCount: 12 } }));
      rbs.syncPileCounts();

      expect(rbs.renderedState().players[1].deckCount).toBe(36);
      expect(rbs.renderedState().players[1].extraCount).toBe(12);
    });

    it('should respect EXTRA-1 lock during syncPileCounts', () => {
      rbs.updateLogical(makeState({ p1: { extraCount: 15 } }));
      rbs.syncRendered();

      rbs.lockZone('EXTRA-1');
      rbs.updateLogical(makeState({ p1: { extraCount: 11 } }));
      rbs.syncPileCounts();

      expect(rbs.renderedState().players[1].extraCount).toBe(15);
    });
  });

  describe('destroy', () => {
    it('should clear all locks and sync rendered', () => {
      rbs.updateLogical(makeState({ p0: { lp: 1000 } }));
      rbs.lockZone('M1-0');
      rbs.destroy();
      expect(rbs.hasLockedZones()).toBeFalse();
      expect(rbs.renderedState().players[0].lp).toBe(1000);
    });
  });
});
