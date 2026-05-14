import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TimelineZoomControlComponent, type ZoomLevel } from './timeline-zoom-control.component';

describe('TimelineZoomControlComponent', () => {
  let fixture: ComponentFixture<TimelineZoomControlComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TimelineZoomControlComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TimelineZoomControlComponent);
    el = fixture.nativeElement;
  });

  function bind(level: ZoomLevel) {
    fixture.componentRef.setInput('level', level);
    fixture.detectChanges();
  }

  it('renders 3 level buttons (1× 2× 3×)', () => {
    bind(1);
    const buttons = el.querySelectorAll('button.pill');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent?.trim()).toBe('1×');
    expect(buttons[1].textContent?.trim()).toBe('2×');
    expect(buttons[2].textContent?.trim()).toBe('3×');
  });

  it('applies pill--gold on the active level and pill--neutral elsewhere', () => {
    bind(2);
    const buttons = el.querySelectorAll('button.pill');
    expect(buttons[0].classList.contains('pill--neutral')).toBe(true);
    expect(buttons[1].classList.contains('pill--gold')).toBe(true);
    expect(buttons[2].classList.contains('pill--neutral')).toBe(true);
  });

  it('sets aria-checked on the active button only', () => {
    bind(3);
    const buttons = el.querySelectorAll('button.pill');
    expect(buttons[0].getAttribute('aria-checked')).toBe('false');
    expect(buttons[1].getAttribute('aria-checked')).toBe('false');
    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
  });

  it('emits levelChange when clicking a different level', () => {
    bind(1);
    const spy = spyOn(fixture.componentInstance.levelChange, 'emit');
    (el.querySelectorAll('button.pill')[2] as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledOnceWith(3);
  });

  it('does NOT emit levelChange when clicking the already-active level', () => {
    bind(2);
    const spy = spyOn(fixture.componentInstance.levelChange, 'emit');
    (el.querySelectorAll('button.pill')[1] as HTMLButtonElement).click();
    expect(spy).not.toHaveBeenCalled();
  });

  it('exposes role=radiogroup with aria-label', () => {
    bind(1);
    expect(el.getAttribute('role')).toBe('radiogroup');
    expect(el.getAttribute('aria-label')).toBeTruthy();
  });
});
