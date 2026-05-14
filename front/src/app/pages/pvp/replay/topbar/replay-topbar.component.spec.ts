import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplayTopbarComponent } from './replay-topbar.component';
import type { ReplayMetadataMsg } from '../../duel-ws.types';

function makeMeta(overrides: Partial<ReplayMetadataMsg> = {}): ReplayMetadataMsg {
  return {
    type: 'REPLAY_METADATA',
    playerUsernames: ['AxelDuel', 'YubelMaster'],
    deckNames: ['Snake-Eye Fiendsmith', 'Yubel'],
    turnCount: 11,
    result: 'victory',
    divergenceWarning: false,
    totalResponses: 0,
    cardCodes: [],
    ...overrides,
  } as ReplayMetadataMsg;
}

describe('ReplayTopbarComponent', () => {
  let fixture: ComponentFixture<ReplayTopbarComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ReplayTopbarComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(ReplayTopbarComponent);
    el = fixture.nativeElement;
  });

  function bind(meta: ReplayMetadataMsg | null, mySide: 0 | 1 = 0, copyJustSucceeded = false) {
    fixture.componentRef.setInput('metadata', meta);
    fixture.componentRef.setInput('mySide', mySide);
    fixture.componentRef.setInput('copyJustSucceeded', copyJustSucceeded);
    fixture.detectChanges();
  }

  it('renders the compact bordered page header (DS Wave 1)', () => {
    bind(makeMeta());
    const header = el.querySelector('header');
    expect(header?.classList.contains('page-header')).toBe(true);
    expect(header?.classList.contains('page-header--compact')).toBe(true);
    expect(header?.classList.contains('page-header--bordered')).toBe(true);
  });

  it('renders both player chips with self deck name displayed for mySide=0', () => {
    bind(makeMeta(), 0);
    const chips = el.querySelectorAll('.replay-topbar__chip');
    expect(chips.length).toBe(2);
    expect(chips[0].querySelector('.replay-topbar__chip-name')?.textContent?.trim()).toBe('AxelDuel');
    expect(chips[1].querySelector('.replay-topbar__chip-name')?.textContent?.trim()).toBe('YubelMaster');
  });

  it('flips chip names when mySide=1', () => {
    bind(makeMeta(), 1);
    const chips = el.querySelectorAll('.replay-topbar__chip-name');
    expect(chips[0].textContent?.trim()).toBe('YubelMaster');
    expect(chips[1].textContent?.trim()).toBe('AxelDuel');
  });

  it('tags the winning side with pill--gold (via deriveOutcome)', () => {
    bind(makeMeta({ result: 'victory' }), 0);
    const chips = el.querySelectorAll('.replay-topbar__chip');
    const selfGold = chips[0].querySelector('.pill--gold');
    const oppNeutral = chips[1].querySelector('.pill--neutral');
    expect(selfGold).not.toBeNull();
    expect(oppNeutral).not.toBeNull();
  });

  it('omits result pills entirely on draw', () => {
    bind(makeMeta({ result: 'draw' }), 0);
    expect(el.querySelector('.pill--gold')).toBeNull();
    expect(el.querySelector('.pill--neutral')).toBeNull();
  });

  it('renders durationLabel as M:SS when durationSec provided', () => {
    bind(makeMeta({ durationSec: 872 }), 0);
    expect(el.querySelector('.replay-topbar__meta .text-mono')?.textContent?.trim()).toBe('14:32');
  });

  it('omits the meta pill entirely when durationSec is missing', () => {
    bind(makeMeta(), 0);
    expect(el.querySelector('.replay-topbar__meta')).toBeNull();
  });

  it('emits back / copyLink / openDetails on respective button clicks', () => {
    bind(makeMeta(), 0);
    const backSpy = spyOn(fixture.componentInstance.back, 'emit');
    const copySpy = spyOn(fixture.componentInstance.copyLink, 'emit');
    const detailsSpy = spyOn(fixture.componentInstance.openDetails, 'emit');

    (el.querySelector('.replay-topbar__back') as HTMLButtonElement).click();
    (el.querySelector('.icon-btn') as HTMLButtonElement).click();
    (el.querySelector('.replay-topbar__details-btn') as HTMLButtonElement).click();

    expect(backSpy).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalled();
    expect(detailsSpy).toHaveBeenCalled();
  });

  it('toggles btn--success-flash on the copy-link icon when copyJustSucceeded is true', () => {
    bind(makeMeta(), 0, true);
    const copyBtn = el.querySelector('.icon-btn');
    expect(copyBtn?.classList.contains('btn--success-flash')).toBe(true);

    bind(makeMeta(), 0, false);
    const copyBtnAfter = el.querySelector('.icon-btn');
    expect(copyBtnAfter?.classList.contains('btn--success-flash')).toBe(false);
  });

  it('renders nothing in summary when metadata is null', () => {
    bind(null);
    expect(el.querySelector('.replay-topbar__summary')).toBeNull();
  });
});
