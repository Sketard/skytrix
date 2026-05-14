import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MiniBoardThumbnailComponent } from './mini-board-thumbnail.component';
import { EMPTY_DUEL_STATE } from '../../types';
import type { DuelState } from '../../types';
import type { BoardZone, CardOnField, PlayerBoardState } from '../../duel-ws-shared.types';

function makeCard(): CardOnField {
  return {
    cardCode: 12345,
    name: 'X',
    position: 0x1, // FACEUP_ATTACK
    overlayMaterials: [],
    counters: {},
  };
}

function makeZone(zoneId: BoardZone['zoneId'], cardCount: number): BoardZone {
  return {
    zoneId,
    cards: Array.from({ length: cardCount }, () => makeCard()),
  };
}

function makePlayer(overrides: Partial<PlayerBoardState> = {}): PlayerBoardState {
  return {
    lp: 8000,
    deckCount: 40,
    extraCount: 15,
    zones: [makeZone('HAND', 5)],
    ...overrides,
  };
}

function makeState(p0: PlayerBoardState, p1: PlayerBoardState): DuelState {
  return {
    ...EMPTY_DUEL_STATE,
    players: [p0, p1],
  };
}

describe('MiniBoardThumbnailComponent', () => {
  let fixture: ComponentFixture<MiniBoardThumbnailComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MiniBoardThumbnailComponent] }).compileComponents();
    fixture = TestBed.createComponent(MiniBoardThumbnailComponent);
    el = fixture.nativeElement;
  });

  it('renders 4 rows × 7 cells field rows', () => {
    fixture.componentRef.setInput('state', makeState(makePlayer(), makePlayer()));
    fixture.detectChanges();
    const fieldRows = el.querySelectorAll('.mini-field-row');
    expect(fieldRows.length).toBe(2);
    fieldRows.forEach(r => expect(r.querySelectorAll('.mini-zone').length).toBe(7));
  });

  it('caps hand ghost-card count at 7 (avoid grid overflow)', () => {
    const p = makePlayer({
      zones: [makeZone('HAND', 15)],
    });
    fixture.componentRef.setInput('state', makeState(p, makePlayer()));
    fixture.detectChanges();
    expect(el.querySelectorAll('.mini-hand')[1].querySelectorAll('.mini-hand-card').length).toBe(7);
  });

  it('marks .has-card on occupied main-monster slots + EMZ', () => {
    // Self has cards at M1, M3 and EMZ_L; M2, M4, M5 and EMZ_R are empty (no zone entry).
    const p1Zones: BoardZone[] = [
      makeZone('HAND', 3),
      makeZone('M1', 1),
      makeZone('M3', 1),
      makeZone('EMZ_L', 1),
    ];
    fixture.componentRef.setInput('state', makeState(makePlayer({ zones: p1Zones }), makePlayer()));
    fixture.detectChanges();
    const selfRow = el.querySelectorAll('.mini-field-row')[1];
    const zones = selfRow.querySelectorAll('.mini-zone');
    expect(zones[0].classList.contains('has-card')).toBe(true);  // M1
    expect(zones[1].classList.contains('has-card')).toBe(false); // M2
    expect(zones[2].classList.contains('has-card')).toBe(true);  // M3
    expect(zones[3].classList.contains('has-card')).toBe(false); // M4
    expect(zones[4].classList.contains('has-card')).toBe(false); // M5
    expect(zones[5].classList.contains('has-card')).toBe(true);  // EMZ_L
    expect(zones[6].classList.contains('has-card')).toBe(false); // EMZ_R
  });

  it('swaps top/bottom rows when perspectiveIndex=1', () => {
    const p0 = makePlayer({ zones: [makeZone('HAND', 2), makeZone('M1', 1)] });
    const p1 = makePlayer({ zones: [makeZone('HAND', 5)] });

    fixture.componentRef.setInput('state', makeState(p0, p1));
    fixture.componentRef.setInput('perspectiveIndex', 0);
    fixture.detectChanges();
    // perspective=0 — self at bottom: bottom hand has 2 cards, top has 5
    expect(el.querySelectorAll('.mini-hand')[1].querySelectorAll('.mini-hand-card').length).toBe(2);
    expect(el.querySelectorAll('.mini-hand')[0].querySelectorAll('.mini-hand-card').length).toBe(5);

    fixture.componentRef.setInput('perspectiveIndex', 1);
    fixture.detectChanges();
    // perspective=1 flipped: bottom hand now p1 (5), top now p0 (2)
    expect(el.querySelectorAll('.mini-hand')[1].querySelectorAll('.mini-hand-card').length).toBe(5);
    expect(el.querySelectorAll('.mini-hand')[0].querySelectorAll('.mini-hand-card').length).toBe(2);
  });

  it('applies .mini-board--picker variant class when variant=picker', () => {
    fixture.componentRef.setInput('state', makeState(makePlayer(), makePlayer()));
    fixture.componentRef.setInput('variant', 'picker');
    fixture.detectChanges();
    const board = el.querySelector('.mini-board');
    expect(board?.classList.contains('mini-board--picker')).toBe(true);
  });

  it('renders fine on the EMPTY_DUEL_STATE sentinel (no crash, all rows empty)', () => {
    fixture.componentRef.setInput('state', EMPTY_DUEL_STATE);
    fixture.detectChanges();
    expect(el.querySelectorAll('.mini-zone').length).toBe(14);
    expect(el.querySelectorAll('.mini-hand-card').length).toBe(0);
  });
});
