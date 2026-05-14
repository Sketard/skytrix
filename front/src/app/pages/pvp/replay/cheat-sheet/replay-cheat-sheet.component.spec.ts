import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplayCheatSheetComponent } from './replay-cheat-sheet.component';

describe('ReplayCheatSheetComponent', () => {
  let fixture: ComponentFixture<ReplayCheatSheetComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ReplayCheatSheetComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(ReplayCheatSheetComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('renders the 3 sections (playback / viewing / actions)', () => {
    const sections = el.querySelectorAll('.replay-cheat-sheet__section');
    expect(sections.length).toBe(3);
  });

  it('renders each shortcut item with a <kbd> per key', () => {
    const playPause = Array.from(el.querySelectorAll('.replay-cheat-sheet__item'))
      .find(it => it.textContent?.includes('replay.viewer.cheatSheet.playPause'));
    expect(playPause).toBeDefined();
    expect(playPause!.querySelectorAll('kbd').length).toBe(1);

    const stepEvent = Array.from(el.querySelectorAll('.replay-cheat-sheet__item'))
      .find(it => it.textContent?.includes('replay.viewer.cheatSheet.stepEvent'));
    expect(stepEvent!.querySelectorAll('kbd').length).toBe(2);
  });

  it('uses .text-code--inline for the kbd styling (DS Wave 1)', () => {
    const kbd = el.querySelector('kbd');
    expect(kbd?.classList.contains('text-code')).toBe(true);
    expect(kbd?.classList.contains('text-code--inline')).toBe(true);
  });

  it('emits close() when Escape pressed', () => {
    const closeSpy = spyOn(fixture.componentInstance.close, 'emit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closeSpy).toHaveBeenCalled();
  });

  it('emits close() when the X button is clicked', () => {
    const closeSpy = spyOn(fixture.componentInstance.close, 'emit');
    const xBtn = el.querySelector('.replay-cheat-sheet__header button') as HTMLButtonElement;
    xBtn.click();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('uses DS utility classes for the title + section headers', () => {
    expect(el.querySelector('.text-gold-gradient')).not.toBeNull();
    el.querySelectorAll('.replay-cheat-sheet__section h3').forEach(h => {
      expect(h.classList.contains('section-header__title')).toBe(true);
      expect(h.classList.contains('section-header__title--no-bar')).toBe(true);
    });
  });
});
