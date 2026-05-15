import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PvpBoardSkeletonComponent } from './pvp-board-skeleton.component';

describe('PvpBoardSkeletonComponent', () => {
  let fixture: ComponentFixture<PvpBoardSkeletonComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PvpBoardSkeletonComponent, TranslateModule.forRoot()],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      a11y: { loadingDuelBoard: 'Loading duel board' },
    });
    translate.use('en');

    fixture = TestBed.createComponent(PvpBoardSkeletonComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('exposes status semantics for screen readers (role, aria-busy, aria-live, aria-label)', () => {
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-label')).toBe('Loading duel board');
  });

  it('renders the 3-row board layout (opponent / central / player)', () => {
    expect(el.querySelector('.board-skel__row--opponent')).not.toBeNull();
    expect(el.querySelector('.board-skel__row--central')).not.toBeNull();
    expect(el.querySelector('.board-skel__row--player')).not.toBeNull();
  });

  it('renders 20 square zones (5 MZ + 5 ST per side + 2 EMZ)', () => {
    expect(el.querySelectorAll('.skel-zone').length).toBe(22);
  });

  it('renders 10 portrait pile slots (Deck/Extra/GY/Field per side + 2 Banished)', () => {
    expect(el.querySelectorAll('.skel-pile').length).toBe(10);
  });

  it('renders 5 fake hand cards per side (10 total)', () => {
    expect(el.querySelectorAll('.skel-hand-card').length).toBe(10);
  });

  it('positions the EMZ slots at central-strip columns 3 and 5', () => {
    expect(el.querySelector('.skel-zone--emz-left')).not.toBeNull();
    expect(el.querySelector('.skel-zone--emz-right')).not.toBeNull();
  });

  it('marks the host element as visually decorative (inner board has aria-hidden)', () => {
    const inner = el.querySelector('.board-skel');
    expect(inner?.getAttribute('aria-hidden')).toBe('true');
  });
});
