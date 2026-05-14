import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TurnPickerSheetComponent } from './turn-picker-sheet.component';
import { EMPTY_DUEL_STATE } from '../../types';
import type { PreComputedState, TurnMeta } from '../../replay-ws.types';

const stubMeta = (n: number, startIndex: number, endIndex: number): TurnMeta => ({
  turnNumber: n, startIndex, endIndex, p1LP: 8000, p2LP: 8000, eventCount: endIndex - startIndex + 1,
});

const stubState = (label: string): PreComputedState => ({
  boardState: EMPTY_DUEL_STATE, events: [], label, responseCount: 0,
});

describe('TurnPickerSheetComponent', () => {
  let fixture: ComponentFixture<TurnPickerSheetComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TurnPickerSheetComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TurnPickerSheetComponent);
    el = fixture.nativeElement;
  });

  function bind(turns: TurnMeta[], current: number, upTo: number) {
    // boardStates is indexed by global event index, not by turn — must be
    // sized to cover every `turn.startIndex` referenced by the input set.
    const lastIdx = Math.max(0, ...turns.map(t => t.startIndex));
    const states: PreComputedState[] = Array.from({ length: lastIdx + 1 }, (_, i) => stubState(`s${i}`));
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('currentTurnIndex', current);
    fixture.componentRef.setInput('computedUpToIndex', upTo);
    fixture.componentRef.setInput('boardStates', states);
    fixture.detectChanges();
  }

  it('splits entries into setup (T0) + turns sections', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    const sections = el.querySelectorAll('.turn-picker__section');
    expect(sections.length).toBe(2);
    // Section 1 (setup) has 1 card (T0); section 2 (turns) has 2 cards (T1, T2).
    expect(sections[0].querySelectorAll('.turn-picker__card').length).toBe(1);
    expect(sections[1].querySelectorAll('.turn-picker__card').length).toBe(2);
  });

  it('omits the setup section entirely when no T0 exists', () => {
    bind([stubMeta(1, 0, 2), stubMeta(2, 3, 5)], 0, 5);
    const sections = el.querySelectorAll('.turn-picker__section');
    expect(sections.length).toBe(1);
    expect(sections[0].querySelectorAll('.turn-picker__card').length).toBe(2);
  });

  it('marks the current turn card with --current modifier + aria-current', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    const cards = el.querySelectorAll('.turn-picker__card');
    expect(cards[0].classList.contains('turn-picker__card--current')).toBe(false);
    expect(cards[1].classList.contains('turn-picker__card--current')).toBe(true);
    expect(cards[1].getAttribute('aria-current')).toBe('true');
  });

  it('disables + aria-disables turns whose startIndex is past computedUpToIndex', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 4); // upTo=4 → turn 2 (start=6) not computed
    const cards = el.querySelectorAll('.turn-picker__card');
    expect((cards[2] as HTMLButtonElement).disabled).toBe(true);
    expect(cards[2].getAttribute('aria-disabled')).toBe('true');
    expect(cards[2].classList.contains('turn-picker__card--not-computed')).toBe(true);
  });

  it('emits jumpToTurn with the entry index on click (computed turn only)', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 8);
    const jumpSpy = spyOn(fixture.componentInstance.jumpToTurn, 'emit');
    const cards = el.querySelectorAll('.turn-picker__card');
    (cards[1] as HTMLButtonElement).click();
    expect(jumpSpy).toHaveBeenCalledOnceWith(1);
  });

  it('does NOT emit jumpToTurn when an uncomputed card is clicked', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5)], 0, -1);
    const jumpSpy = spyOn(fixture.componentInstance.jumpToTurn, 'emit');
    (el.querySelectorAll('.turn-picker__card')[0] as HTMLButtonElement).click();
    expect(jumpSpy).not.toHaveBeenCalled();
  });

  it('renders one <app-mini-board-thumbnail variant="picker"> per computed entry', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 5);
    const thumbs = el.querySelectorAll('app-mini-board-thumbnail');
    // 3 cards × 1 mini-board each = 3 (uncomputed still has the @if state guard, so it depends on whether the state exists)
    // boardStates are seeded for every turn here → all 3 render.
    expect(thumbs.length).toBe(3);
  });
});
