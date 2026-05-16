import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplayEndOverlayComponent } from './replay-end-overlay.component';

describe('ReplayEndOverlayComponent', () => {
  let fixture: ComponentFixture<ReplayEndOverlayComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplayEndOverlayComponent, TranslateModule.forRoot()],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      replay: {
        timeline: { turn: 'Turn {{n}}' },
        viewer: {
          endOverlay: {
            victory: 'Victory',
            defeat: 'Defeat',
            draw: 'Draw',
            vs: 'vs',
            replay: 'Restart',
          },
        },
      },
    });
    translate.use('en');
    fixture = TestBed.createComponent(ReplayEndOverlayComponent);
    el = fixture.nativeElement;
  });

  function bind(
    outcome: 'victory' | 'defeat' | 'draw',
    selfLp = 8000,
    oppLp = 0,
    turnCount: number | null = null,
    durationSec: number | null = null,
  ) {
    fixture.componentRef.setInput('outcome', outcome);
    fixture.componentRef.setInput('selfLp', selfLp);
    fixture.componentRef.setInput('oppLp', oppLp);
    fixture.componentRef.setInput('selfName', 'Me');
    fixture.componentRef.setInput('oppName', 'Opp');
    fixture.componentRef.setInput('turnCount', turnCount);
    fixture.componentRef.setInput('durationSec', durationSec);
    fixture.detectChanges();
  }

  it('renders a single Restart CTA (Fork + Library reachable elsewhere)', () => {
    bind('victory');
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent?.trim()).toBe('Restart');
  });

  it('renders the meta line `Tour N · MM:SS` when turnCount + durationSec provided', () => {
    bind('victory', 8000, 0, 11, 14 * 60 + 32);
    const meta = el.querySelector('.replay-end-overlay__meta');
    expect(meta?.textContent?.trim()).toBe('Turn 11 · 14:32');
  });

  it('omits the meta line entirely when turnCount AND durationSec are null', () => {
    bind('victory'); // defaults turnCount=null, durationSec=null
    expect(el.querySelector('.replay-end-overlay__meta')).toBeNull();
  });

  it('renders only the available meta segment when one is missing', () => {
    bind('defeat', 0, 8000, 7, null);
    const meta = el.querySelector('.replay-end-overlay__meta');
    expect(meta?.textContent?.trim()).toBe('Turn 7');
  });

  it('applies pill--gold for victory', () => {
    bind('victory');
    const pill = el.querySelector('.pill--celebrated');
    expect(pill?.classList.contains('pill--gold')).toBe(true);
  });

  it('applies pill--neutral for defeat', () => {
    bind('defeat');
    const pill = el.querySelector('.pill--celebrated');
    expect(pill?.classList.contains('pill--neutral')).toBe(true);
  });

  it('applies pill--cyan for draw', () => {
    bind('draw');
    const pill = el.querySelector('.pill--celebrated');
    expect(pill?.classList.contains('pill--cyan')).toBe(true);
  });

  it('highlights the self LP via text-gold-gradient on victory', () => {
    bind('victory', 8000, 0);
    const sides = el.querySelectorAll('.replay-end-overlay__score-side');
    expect(sides[0].querySelector('.text-gold-gradient')).not.toBeNull();
    expect(sides[1].querySelector('.text-gold-gradient')).toBeNull();
  });

  it('highlights the opp LP via text-gold-gradient on defeat', () => {
    bind('defeat', 0, 8000);
    const sides = el.querySelectorAll('.replay-end-overlay__score-side');
    expect(sides[0].querySelector('.text-gold-gradient')).toBeNull();
    expect(sides[1].querySelector('.text-gold-gradient')).not.toBeNull();
  });

  it('does not highlight either side on draw', () => {
    bind('draw', 1500, 1500);
    expect(el.querySelector('.text-gold-gradient')).toBeNull();
  });

  it('emits replay() on the Restart button click', () => {
    bind('victory');
    const replaySpy = spyOn(fixture.componentInstance.replay, 'emit');
    const button = el.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(replaySpy).toHaveBeenCalledOnceWith();
  });

  it('emits dismissed() on Escape', () => {
    bind('victory');
    const dismissSpy = spyOn(fixture.componentInstance.dismissed, 'emit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('does NOT listen ArrowLeft (parent routes it to avoid double stepBack — H1 fix)', () => {
    bind('victory');
    const dismissSpy = spyOn(fixture.componentInstance.dismissed, 'emit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(dismissSpy).not.toHaveBeenCalled();
  });
});
