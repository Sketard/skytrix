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
        viewer: {
          endOverlay: {
            victory: 'Victory',
            defeat: 'Defeat',
            draw: 'Draw',
            vs: 'vs',
            replay: 'Replay',
            library: 'Library',
            dismissHint: 'Esc or ← to resume',
          },
        },
      },
    });
    translate.use('en');
    fixture = TestBed.createComponent(ReplayEndOverlayComponent);
    el = fixture.nativeElement;
  });

  function bind(outcome: 'victory' | 'defeat' | 'draw', selfLp = 8000, oppLp = 0) {
    fixture.componentRef.setInput('outcome', outcome);
    fixture.componentRef.setInput('selfLp', selfLp);
    fixture.componentRef.setInput('oppLp', oppLp);
    fixture.componentRef.setInput('selfName', 'Me');
    fixture.componentRef.setInput('oppName', 'Opp');
    fixture.detectChanges();
  }

  it('renders exactly 2 CTAs — replay + library — never fork (D18)', () => {
    bind('victory');
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe('Replay');
    expect(buttons[1].textContent?.trim()).toBe('Library');
    expect(el.textContent?.toLowerCase()).not.toContain('fork');
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

  it('emits replay() and library() on the respective buttons', () => {
    bind('victory');
    const replaySpy = spyOn(fixture.componentInstance.replay, 'emit');
    const librarySpy = spyOn(fixture.componentInstance.library, 'emit');
    (el.querySelectorAll('button')[0] as HTMLButtonElement).click();
    (el.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(replaySpy).toHaveBeenCalledOnceWith();
    expect(librarySpy).toHaveBeenCalledOnceWith();
  });

  it('emits dismissed() on Escape', () => {
    bind('victory');
    const dismissSpy = spyOn(fixture.componentInstance.dismissed, 'emit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('emits dismissed() on ArrowLeft', () => {
    bind('victory');
    const dismissSpy = spyOn(fixture.componentInstance.dismissed, 'emit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(dismissSpy).toHaveBeenCalled();
  });
});
