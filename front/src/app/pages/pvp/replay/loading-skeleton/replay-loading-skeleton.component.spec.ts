import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplayLoadingSkeletonComponent } from './replay-loading-skeleton.component';

describe('ReplayLoadingSkeletonComponent', () => {
  let fixture: ComponentFixture<ReplayLoadingSkeletonComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplayLoadingSkeletonComponent, TranslateModule.forRoot()],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      replay: {
        viewer: {
          loading: 'Loading replay…',
          loadingProgressDetailed: 'Loaded {{current}} / {{total}} turns',
        },
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(ReplayLoadingSkeletonComponent);
    el = fixture.nativeElement;
  });

  it('omits the loading pill when total is unknown (skeleton carries the signal)', () => {
    // No metadata yet → no pill. The wireframe shimmer alone communicates
    // "loading" — avoids the redundant pill stacking on the skeleton.
    fixture.detectChanges();
    expect(el.querySelector('.pill--live')).toBeNull();
  });

  it('renders the detailed progress pill when current and total are set', () => {
    fixture.componentRef.setInput('current', 6);
    fixture.componentRef.setInput('total', 11);
    fixture.detectChanges();
    const pill = el.querySelector('.pill--live');
    expect(pill?.textContent?.trim()).toBe('Loaded 6 / 11 turns');
    expect(pill?.classList.contains('pill--gold')).toBe(true);
    expect(pill?.classList.contains('pill--live')).toBe(true);
  });

  it('omits the pill when total is set but current is still 0', () => {
    // `hasProgress` requires total!=null AND current>0 — pre-first-state
    // window keeps the pill hidden so the wireframe alone shows loading.
    fixture.componentRef.setInput('current', 0);
    fixture.componentRef.setInput('total', 11);
    fixture.detectChanges();
    expect(el.querySelector('.pill--live')).toBeNull();
  });

  it('exposes status semantics for screen readers', () => {
    fixture.detectChanges();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('uses <app-skel> primitives, never custom .skel-* classes', () => {
    fixture.detectChanges();
    const skels = el.querySelectorAll('app-skel');
    expect(skels.length).toBeGreaterThan(10);
    expect(el.querySelector('.skel-avatar, .skel-action, .skel-pill')).toBeNull();
  });
});
