import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { PromptOptionListComponent } from './prompt-option-list.component';
import { DuelCardArtService } from '../../duel-card-art.service';
import { DuelSystemStringsService } from '../../../duel-system-strings.service';
import { CardDataCacheService } from '../../card-data-cache.service';
import type { SelectOptionMsg } from '../../../duel-ws.types';

// SELECT_OPTION codes pack `cardCode << 20 | strIndex`. A non-zero cardCode
// (a card-text effect) is the case where the legacy client path could only
// reach the card NAME, not the per-paragraph effect — the bug `optionTexts`
// fixes.
function pack(cardCode: number, strIndex: number): number {
  return cardCode * 0x100000 + strIndex;
}

function selectOption(
  options: number[],
  optionTexts?: string[],
): SelectOptionMsg {
  return { type: 'SELECT_OPTION', player: 0, options, optionTexts };
}

/** System-string stub — echoes a label per strIndex so resolution is testable. */
function systemStringsStub() {
  return {
    provide: DuelSystemStringsService,
    useValue: {
      preload: () => Promise.resolve(),
      resolveSystemString: (i: number) => (i > 0 ? `System ${i}` : ''),
      resolveWinReason: () => '',
    },
  };
}

describe('PromptOptionListComponent — SELECT_OPTION labels', () => {
  function make(prompt: SelectOptionMsg): PromptOptionListComponent {
    TestBed.configureTestingModule({
      imports: [PromptOptionListComponent, TranslateModule.forRoot()],
      providers: [
        { provide: DuelCardArtService, useValue: { resolveUrl: () => '' } },
        {
          provide: CardDataCacheService,
          // The legacy fallback path resolves a card-text code to its NAME.
          useValue: { getCardData: () => Promise.resolve({ name: 'D/D Savant Kepler' }) },
        },
        systemStringsStub(),
      ],
    });
    const fixture = TestBed.createComponent(PromptOptionListComponent);
    fixture.componentInstance.promptData = prompt;
    fixture.componentInstance.ngOnInit();
    return fixture.componentInstance;
  }

  it('uses the server-resolved optionTexts when present', fakeAsync(() => {
    // Both options are paragraphs of the SAME card (Kepler) — the legacy path
    // would label both "D/D Savant Kepler". `optionTexts` carries the real
    // per-paragraph effect text.
    const c = make(
      selectOption(
        [pack(11609969, 1), pack(11609969, 2)],
        ['Activate 1 of these effects', 'Return 1 other "D/D" card you control'],
      ),
    );
    tick();
    expect(c.options.map(o => o.label)).toEqual([
      'Activate 1 of these effects',
      'Return 1 other "D/D" card you control',
    ]);
  }));

  it('falls back to the generic "Option N" label for an empty optionTexts entry', fakeAsync(() => {
    // optionTexts IS present but an entry is '' — the server dropped a
    // placeholder string. The generic label is shown, never a card name.
    const c = make(
      selectOption([pack(11609969, 1), pack(11609969, 2)], ['Real effect', '']),
    );
    tick();
    const labels = c.options.map(o => o.label);
    expect(labels[0]).toBe('Real effect');
    // The '' entry → generic fallback, NOT the card name (the bug). With no
    // i18n loader the fallback resolves to the raw `optionFallback` key.
    expect(labels[1]).not.toBe('D/D Savant Kepler');
    expect(labels[1]).toContain('optionFallback');
  }));

  it('keeps the legacy client-side path when optionTexts is absent', fakeAsync(() => {
    // A legacy payload (no optionTexts) — a system-string code resolves via
    // the bundled table, a card-text code degrades to the card name.
    const c = make(selectOption([pack(0, 5), pack(11609969, 1)]));
    tick();
    const labels = c.options.map(o => o.label);
    expect(labels[0]).toBe('System 5'); // cardCode 0 → system string
    expect(labels[1]).toBe('D/D Savant Kepler'); // card-text → name fallback
  }));
});
