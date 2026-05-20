import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TimelineStepperComponent } from './timeline-stepper.component';
import type { TurnMeta } from '../../replay-ws.types';

const stubMeta = (n: number, startIndex: number, endIndex: number, evt = endIndex - startIndex + 1): TurnMeta => ({
  turnNumber: n, startIndex, endIndex, p1LP: 8000, p2LP: 8000, eventCount: evt,
});

describe('TimelineStepperComponent', () => {
  let fixture: ComponentFixture<TimelineStepperComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TimelineStepperComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TimelineStepperComponent);
    el = fixture.nativeElement;
  });

  function bind(
    turns: TurnMeta[],
    current: number,
    upTo: number,
    currentEventIndex: number = turns[current]?.startIndex ?? 0,
  ) {
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('currentTurnIndex', current);
    fixture.componentRef.setInput('currentEventIndex', currentEventIndex);
    fixture.componentRef.setInput('computedUpToIndex', upTo);
    fixture.detectChanges();
  }

  it('renders an affordance-only pill (icon + dots + chevron, no T-num/total redundant with transport context-pill)', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    // The pill is a "tap to open picker" button — no more T-num/total text.
    expect(el.querySelector('.timeline-stepper__pill-num')).toBeNull();
    expect(el.querySelector('.timeline-stepper__pill-total')).toBeNull();
    expect(el.querySelector('.timeline-stepper__pill-main')).toBeNull();
    // Picker glyph + chevron are still wired as affordance.
    expect(el.querySelector('.timeline-stepper__pill-icon')).not.toBeNull();
    expect(el.querySelector('.timeline-stepper__chevron')).not.toBeNull();
  });

  it('disables prev on the first turn and next on the last computed turn', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 8);
    const navs = el.querySelectorAll<HTMLButtonElement>('.timeline-stepper__nav .icon-btn__el');
    expect(navs[0].disabled).toBe(true);
    expect(navs[1].disabled).toBe(false);

    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 2, 8);
    const navs2 = el.querySelectorAll<HTMLButtonElement>('.timeline-stepper__nav .icon-btn__el');
    expect(navs2[0].disabled).toBe(false);
    expect(navs2[1].disabled).toBe(true);
  });

  it('disables next when the next turn is not yet computed', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 4); // upTo=4 < turn2.start=6
    const navs = el.querySelectorAll<HTMLButtonElement>('.timeline-stepper__nav .icon-btn__el');
    expect(navs[1].disabled).toBe(true);
  });

  it('emits prevTurn() / nextTurn() / openPicker() on the respective buttons', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    const prevSpy = spyOn(fixture.componentInstance.prevTurn, 'emit');
    const nextSpy = spyOn(fixture.componentInstance.nextTurn, 'emit');
    const pickerSpy = spyOn(fixture.componentInstance.openPicker, 'emit');

    const navs = el.querySelectorAll('.timeline-stepper__nav');
    (navs[0] as HTMLButtonElement).click();
    (navs[1] as HTMLButtonElement).click();
    (el.querySelector('.timeline-stepper__pill') as HTMLButtonElement).click();

    expect(prevSpy).toHaveBeenCalled();
    expect(nextSpy).toHaveBeenCalled();
    expect(pickerSpy).toHaveBeenCalled();
  });

  it('no longer renders a standalone sub-events row (merged into the pill dot-progress)', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5)], 0, 5);
    expect(el.querySelector('.timeline-stepper__sub-events')).toBeNull();
    expect(el.querySelector('.timeline-stepper__sub-event')).toBeNull();
  });

  it('R3 — dots fill progressively as currentEventIndex advances inside the turn', () => {
    // Turn 1 covers events 3..9 (eventCount = 7). Start of turn ⇒ no dot lit.
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 9, 7)], 1, 9, 3);
    const dotsAtStart = el.querySelectorAll('.timeline-stepper__dot');
    expect(Array.from(dotsAtStart).map(d => d.classList.contains('is-active'))).toEqual(
      [false, false, false, false, false, false, false],
    );

    // Mid-turn: 4 events in (offset 4 / 7 ≈ 0.57) ⇒ first ~4 dots lit.
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 9, 7)], 1, 9, 7);
    const dotsMid = el.querySelectorAll('.timeline-stepper__dot');
    const litMid = Array.from(dotsMid).map(d => d.classList.contains('is-active'));
    expect(litMid[0]).toBe(true);
    expect(litMid[6]).toBe(false);

    // End of turn: progress = 1 ⇒ all 7 dots lit.
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 9, 7)], 1, 9, 10);
    const dotsEnd = el.querySelectorAll('.timeline-stepper__dot');
    expect(Array.from(dotsEnd).every(d => d.classList.contains('is-active'))).toBe(true);
  });
});
