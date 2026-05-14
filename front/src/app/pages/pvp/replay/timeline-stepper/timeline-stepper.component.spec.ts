import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TimelineStepperComponent } from './timeline-stepper.component';
import type { TurnMeta } from '../../replay-ws.types';
import type { TimelineSegment } from '../timeline-bar/timeline-bar.component';

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

  function bind(turns: TurnMeta[], current: number, upTo: number, subs: TimelineSegment[] = []) {
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('currentTurnIndex', current);
    fixture.componentRef.setInput('computedUpToIndex', upTo);
    fixture.componentRef.setInput('subEvents', subs);
    fixture.detectChanges();
  }

  it('renders T{N} for non-setup turns and T0 for the setup turn', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    expect(el.querySelector('.timeline-stepper__pill-num')?.textContent?.trim()).toBe('T1');

    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5)], 0, 5);
    expect(el.querySelector('.timeline-stepper__pill-num')?.textContent?.trim()).toBe('T0');
  });

  it('disables ◀ on the first turn and ▶ on the last computed turn', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 8);
    const navs = el.querySelectorAll<HTMLButtonElement>('.timeline-stepper__nav');
    expect(navs[0].disabled).toBe(true);
    expect(navs[1].disabled).toBe(false);

    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 2, 8);
    const navs2 = el.querySelectorAll<HTMLButtonElement>('.timeline-stepper__nav');
    expect(navs2[0].disabled).toBe(false);
    expect(navs2[1].disabled).toBe(true);
  });

  it('disables ▶ when the next turn is not yet computed', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 4); // upTo=4 < turn2.start=6
    const navs = el.querySelectorAll<HTMLButtonElement>('.timeline-stepper__nav');
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

  it('renders nothing in the sub-events row when subEvents is empty', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5)], 0, 5);
    expect(el.querySelector('.timeline-stepper__sub-events')).toBeNull();
  });

  it('emits seekSubEvent with the segment index when a sub-bullet is clicked', () => {
    const subs: TimelineSegment[] = [{ type: 'single', idx: 0 }, { type: 'chain', indices: [1, 2] }];
    bind([stubMeta(0, 0, 2)], 0, 2, subs);
    const seekSpy = spyOn(fixture.componentInstance.seekSubEvent, 'emit');
    const bullets = el.querySelectorAll('.timeline-stepper__sub-event');
    (bullets[1] as HTMLButtonElement).click();
    expect(seekSpy).toHaveBeenCalledOnceWith(1); // first index of chain segment
  });
});
