import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TimelineBarComponent, type ZoomLevel } from './timeline-bar.component';
import { PvpBoardContainerComponent } from '../../duel-page/pvp-board-container/pvp-board-container.component';
import { EMPTY_DUEL_STATE } from '../../types';
import type { PreComputedState, TurnMeta } from '../../replay-ws.types';

// Stub the real board-container — it pulls a full PvP DI cascade
// (CardTravelEngine, DuelContext, …) we don't need for timeline-bar specs.
// We re-declare the inputs the template binds against so strict template
// checking compiles, but render nothing.
@Component({
  selector: 'app-pvp-board-container',
  standalone: true,
  template: '',
})
class StubBoardContainerComponent {
  readonly preview = input<boolean>(false);
  readonly readOnly = input<boolean>(false);
  readonly duelState = input<unknown>(null);
  readonly ownPlayerIndex = input<number>(0);
  readonly highlightedZones = input<ReadonlySet<string>>(new Set());
  readonly revealedZoneKeys = input<ReadonlySet<string>>(new Set());
  readonly targetedZoneKeys = input<ReadonlySet<string>>(new Set());
  readonly preTargetZoneKeys = input<ReadonlySet<string>>(new Set());
  readonly swapGraveDeckKeys = input<ReadonlySet<string>>(new Set());
  readonly activeChainLinks = input<unknown[]>([]);
  readonly chosenZone = input<string | null>(null);
  readonly actionablePrompt = input<unknown>(null);
  readonly animatingZone = input<unknown>(null);
  readonly animatingLp = input<unknown>(null);
  readonly timerState = input<unknown>(null);
  readonly opponentDisconnected = input<boolean>(false);
  readonly displayedPhase = input<unknown>(null);
  readonly displayedTurnPlayer = input<unknown>(null);
  readonly displayedTurnCount = input<unknown>(null);
  readonly counterPulseKey = input<string | null>(null);
  readonly chainPhase = input<string>('idle');
}

const stubMeta = (n: number, startIndex: number, eventCount: number): TurnMeta => ({
  turnNumber: n,
  startIndex,
  endIndex: startIndex + eventCount - 1,
  p1LP: 8000,
  p2LP: 8000,
  eventCount,
});

const stubState = (label: string): PreComputedState => ({
  boardState: EMPTY_DUEL_STATE,
  events: [],
  label,
  responseCount: 0,
});

describe('TimelineBarComponent — D21 zoomLevel input + emits', () => {
  let fixture: ComponentFixture<TimelineBarComponent>;
  let component: TimelineBarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TimelineBarComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    })
      .overrideComponent(TimelineBarComponent, {
        remove: { imports: [PvpBoardContainerComponent] },
        add:    { imports: [StubBoardContainerComponent] },
      })
      .compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TimelineBarComponent);
    component = fixture.componentInstance;
  });

  function bind(turns: TurnMeta[], currentIndex: number, upTo: number, zoom: ZoomLevel = 1) {
    const lastIdx = Math.max(0, ...turns.map(t => t.startIndex + t.eventCount - 1));
    const states: PreComputedState[] = Array.from({ length: lastIdx + 1 }, (_, i) => stubState(`s${i}`));
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('currentIndex', currentIndex);
    fixture.componentRef.setInput('computedUpTo', upTo);
    fixture.componentRef.setInput('totalEvents', lastIdx + 1);
    fixture.componentRef.setInput('boardStates', states);
    fixture.componentRef.setInput('zoomLevel', zoom);
    fixture.detectChanges();
  }

  function forceDesktop(comp: TimelineBarComponent): void {
    (comp as unknown as { isDesktop: { set: (v: boolean) => void } }).isDesktop.set(true);
  }

  it('emits zoomLevelChange (not mutating internal state) on wheel up', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 2, 3)], 1, 4, 1);
    const spy = spyOn(component.zoomLevelChange, 'emit');
    forceDesktop(component);
    component.onWheel(new WheelEvent('wheel', { deltaY: -100 }));
    expect(spy).toHaveBeenCalledOnceWith(2 as ZoomLevel);
  });

  it('emits zoomLevelChange on wheel down (positive direction)', () => {
    bind([stubMeta(0, 0, 2)], 0, 1, 3);
    const spy = spyOn(component.zoomLevelChange, 'emit');
    forceDesktop(component);
    component.onWheel(new WheelEvent('wheel', { deltaY: 100 }));
    expect(spy).toHaveBeenCalledOnceWith(2 as ZoomLevel);
  });

  it('does NOT emit zoomLevelChange when already at the bound (1× wheel down)', () => {
    bind([stubMeta(0, 0, 2)], 0, 1, 1);
    const spy = spyOn(component.zoomLevelChange, 'emit');
    forceDesktop(component);
    component.onWheel(new WheelEvent('wheel', { deltaY: 100 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT emit zoomLevelChange when already at the bound (3× wheel up)', () => {
    bind([stubMeta(0, 0, 2)], 0, 1, 3);
    const spy = spyOn(component.zoomLevelChange, 'emit');
    forceDesktop(component);
    component.onWheel(new WheelEvent('wheel', { deltaY: -100 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('chainSegmentIsSelf returns true when turnPlayer matches perspective', () => {
    bind([stubMeta(0, 0, 2)], 0, 1);
    fixture.componentRef.setInput('ownPlayerIndex', 0);
    fixture.detectChanges();
    // EMPTY_DUEL_STATE.turnPlayer === 0 by default → matches perspective 0 → self
    expect(component.chainSegmentIsSelf(0)).toBe(true);
  });

  it('chainSegmentIsSelf returns false when turnPlayer differs from perspective', () => {
    bind([stubMeta(0, 0, 2)], 0, 1);
    fixture.componentRef.setInput('ownPlayerIndex', 1);
    fixture.detectChanges();
    expect(component.chainSegmentIsSelf(0)).toBe(false);
  });

  it('respects isComputed / isCurrentTurn helpers', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 2, 3), stubMeta(2, 5, 2)], 3, 4);
    expect(component.isComputed({ startIndex: 0 } as TurnMeta)).toBe(true);
    expect(component.isComputed({ startIndex: 5 } as TurnMeta)).toBe(false); // 5 > upTo=4
    expect(component.isCurrentTurn({ startIndex: 2, endIndex: 4 } as TurnMeta)).toBe(true); // 3 in [2,4]
    expect(component.isCurrentTurn({ startIndex: 0, endIndex: 1 } as TurnMeta)).toBe(false);
  });

  it('subEventSegments groups chain indices together', () => {
    const turns = [stubMeta(0, 0, 4)];
    const lastIdx = 3;
    const states: PreComputedState[] = [
      { boardState: EMPTY_DUEL_STATE, events: [], label: 'a', responseCount: 0 },
      { boardState: EMPTY_DUEL_STATE, events: [], label: 'b', responseCount: 0, chainIndex: 0 },
      { boardState: EMPTY_DUEL_STATE, events: [], label: 'c', responseCount: 0, chainIndex: 1 },
      { boardState: EMPTY_DUEL_STATE, events: [], label: 'd', responseCount: 0 },
    ];
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('currentIndex', 0);
    fixture.componentRef.setInput('computedUpTo', lastIdx);
    fixture.componentRef.setInput('totalEvents', lastIdx + 1);
    fixture.componentRef.setInput('boardStates', states);
    fixture.componentRef.setInput('zoomLevel', 1 as ZoomLevel);
    fixture.detectChanges();
    const segs = component.subEventSegments(turns[0]);
    expect(segs.length).toBe(3); // single, chain[1,2], single
    expect(segs[0].type).toBe('single');
    expect(segs[1].type).toBe('chain');
    if (segs[1].type === 'chain') expect(segs[1].indices).toEqual([1, 2]);
    expect(segs[2].type).toBe('single');
  });
});
