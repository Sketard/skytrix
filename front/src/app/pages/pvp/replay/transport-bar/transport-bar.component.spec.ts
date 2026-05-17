import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TransportBarComponent } from './transport-bar.component';

describe('TransportBarComponent — F3 refonte 3 zones', () => {
  let fixture: ComponentFixture<TransportBarComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TransportBarComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TransportBarComponent);
    el = fixture.nativeElement;
  });

  function bind(overrides: Partial<{
    isPlaying: boolean;
    atEnd: boolean;
    forking: boolean;
    animationsEnabled: boolean;
    promptMode: 'result' | 'decision';
    perspectiveIndex: number;
    turnLabel: string;
    phaseLabel: string;
    eventLabel: string;
    zoomLevel: 1 | 2 | 3;
    hasNonDefaultOption: boolean;
  }> = {}) {
    fixture.componentRef.setInput('turnLabel', overrides.turnLabel ?? 'Tour 3 / 11');
    fixture.componentRef.setInput('phaseLabel', overrides.phaseLabel ?? 'Main 1');
    fixture.componentRef.setInput('eventLabel', overrides.eventLabel ?? null);
    fixture.componentRef.setInput('isPlaying', overrides.isPlaying ?? false);
    fixture.componentRef.setInput('atEnd', overrides.atEnd ?? false);
    fixture.componentRef.setInput('forking', overrides.forking ?? false);
    fixture.componentRef.setInput('animationsEnabled', overrides.animationsEnabled ?? false);
    fixture.componentRef.setInput('promptMode', overrides.promptMode ?? 'result');
    fixture.componentRef.setInput('perspectiveIndex', overrides.perspectiveIndex ?? 0);
    fixture.componentRef.setInput('zoomLevel', overrides.zoomLevel ?? 1);
    fixture.componentRef.setInput('hasNonDefaultOption', overrides.hasNonDefaultOption ?? false);
    fixture.detectChanges();
  }

  it('renders the 3 layout zones: context, controls, options', () => {
    bind();
    expect(el.querySelector('.transport-bar__context')).not.toBeNull();
    expect(el.querySelector('.transport-bar__controls')).not.toBeNull();
    expect(el.querySelector('.transport-bar__options')).not.toBeNull();
  });

  it('renders the <app-context-pill> with the 3 sub-fields wired', () => {
    bind({ turnLabel: 'Tour 5', phaseLabel: 'Main 2', eventLabel: 'Effect: Ash' });
    const pill = el.querySelector('app-context-pill');
    expect(pill).not.toBeNull();
    // The player-position label was removed — same info already lives on the
    // perspective swap button, no point duplicating it next to the turn pill.
    expect(pill?.textContent).toContain('Tour 5');
    expect(pill?.textContent).toContain('Main 2');
    expect(pill?.textContent).toContain('Effect: Ash');
  });

  it('renders 5 transport step buttons + 1 play button (52px gold)', () => {
    bind();
    const buttons = el.querySelectorAll('.transport-bar__controls button');
    expect(buttons.length).toBe(5); // skipStart + stepBack + play + stepForward + skipEnd
    const play = el.querySelector('.transport-bar__play');
    expect(play).not.toBeNull();
    // Composition DS depuis 2026-05-17 : `.icon-btn--xl` (52px) + `--round`
    // (border-radius 50%) + `--primary` (gold gradient + shadow). Le composite
    // gold custom inline a été remonté dans `_icon-button.scss`.
    expect(play?.classList.contains('icon-btn--xl')).toBe(true);
    expect(play?.classList.contains('icon-btn--round')).toBe(true);
    expect(play?.classList.contains('icon-btn--primary')).toBe(true);
    // No `btn--cta-shimmer` here — the infinite gold sweep was distracting on
    // the always-visible transport bar, see fix(replay) 2026-05-16.
    expect(play?.classList.contains('btn--cta-shimmer')).toBe(false);
  });

  it('renders <app-timeline-zoom-control> inside the options zone (D7)', () => {
    bind();
    const zoom = el.querySelector('.transport-bar__options app-timeline-zoom-control');
    expect(zoom).not.toBeNull();
  });

  it('emits zoomLevelChange when the child zoom-control bubbles up', () => {
    bind({ zoomLevel: 1 });
    const spy = spyOn(fixture.componentInstance.zoomLevelChange, 'emit');
    // Find the 2× pill button inside the zoom-control and click it.
    const buttons = el.querySelectorAll('app-timeline-zoom-control button.pill');
    expect(buttons.length).toBe(3);
    (buttons[2] as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledOnceWith(3);
  });

  it('disables the play button when atEnd && !isPlaying', () => {
    bind({ atEnd: true, isPlaying: false });
    const play = el.querySelector('.transport-bar__play') as HTMLButtonElement;
    expect(play.disabled).toBe(true);
  });

  it('keeps the play button enabled while playing even at end (so pause works)', () => {
    bind({ atEnd: true, isPlaying: true });
    const play = el.querySelector('.transport-bar__play') as HTMLButtonElement;
    expect(play.disabled).toBe(false);
  });

  it('marks the animations toggle .is-active when enabled', () => {
    bind({ animationsEnabled: true });
    const toggles = el.querySelectorAll('.transport-bar__toggle');
    expect(toggles[0].classList.contains('is-active')).toBe(true);
  });

  it('marks the prompt-mode toggle .is-active when in decision mode', () => {
    bind({ promptMode: 'decision' });
    const toggles = el.querySelectorAll('.transport-bar__toggle');
    expect(toggles[1].classList.contains('is-active')).toBe(true);
  });

  it('shows the dot indicator on ⋯ More when hasNonDefaultOption=true', () => {
    bind({ hasNonDefaultOption: true });
    const more = el.querySelector('.transport-bar__more');
    expect(more?.classList.contains('transport-bar__more--has-non-default')).toBe(true);
  });

  it('emits skipStart / stepBack / playPause / stepForward / skipEnd on respective clicks', () => {
    bind();
    const spies = {
      skipStart: spyOn(fixture.componentInstance.skipStart, 'emit'),
      stepBack: spyOn(fixture.componentInstance.stepBack, 'emit'),
      playPause: spyOn(fixture.componentInstance.playPause, 'emit'),
      stepForward: spyOn(fixture.componentInstance.stepForward, 'emit'),
      skipEnd: spyOn(fixture.componentInstance.skipEnd, 'emit'),
    };
    const buttons = el.querySelectorAll('.transport-bar__controls button');
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    (buttons[2] as HTMLButtonElement).click();
    (buttons[3] as HTMLButtonElement).click();
    (buttons[4] as HTMLButtonElement).click();
    expect(spies.skipStart).toHaveBeenCalled();
    expect(spies.stepBack).toHaveBeenCalled();
    expect(spies.playPause).toHaveBeenCalled();
    expect(spies.stepForward).toHaveBeenCalled();
    expect(spies.skipEnd).toHaveBeenCalled();
  });

  it('emits toggleAnimations / togglePromptMode / togglePerspective / fork / openCheatSheet / openMoreOptions', () => {
    bind();
    const spies = {
      toggleAnimations: spyOn(fixture.componentInstance.toggleAnimations, 'emit'),
      togglePromptMode: spyOn(fixture.componentInstance.togglePromptMode, 'emit'),
      togglePerspective: spyOn(fixture.componentInstance.togglePerspective, 'emit'),
      fork: spyOn(fixture.componentInstance.fork, 'emit'),
      openCheatSheet: spyOn(fixture.componentInstance.openCheatSheet, 'emit'),
      openMoreOptions: spyOn(fixture.componentInstance.openMoreOptions, 'emit'),
    };
    (el.querySelectorAll('.transport-bar__toggle')[0] as HTMLButtonElement).click();
    (el.querySelectorAll('.transport-bar__toggle')[1] as HTMLButtonElement).click();
    (el.querySelector('.transport-bar__perspective') as HTMLButtonElement).click();
    (el.querySelector('.transport-bar__fork') as HTMLButtonElement).click();
    (el.querySelector('.transport-bar__cheat') as HTMLButtonElement).click();
    (el.querySelector('.transport-bar__more') as HTMLButtonElement).click();
    expect(spies.toggleAnimations).toHaveBeenCalled();
    expect(spies.togglePromptMode).toHaveBeenCalled();
    expect(spies.togglePerspective).toHaveBeenCalled();
    expect(spies.fork).toHaveBeenCalled();
    expect(spies.openCheatSheet).toHaveBeenCalled();
    expect(spies.openMoreOptions).toHaveBeenCalled();
  });
});
