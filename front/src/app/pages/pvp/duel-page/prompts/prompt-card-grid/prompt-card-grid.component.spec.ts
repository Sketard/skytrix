import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { PromptCardGridComponent } from './prompt-card-grid.component';
import { DuelCardArtService } from '../../duel-card-art.service';
import { DuelSystemStringsService } from '../../../duel-system-strings.service';
import { CardDataCacheService } from '../../card-data-cache.service';
import { DuelLogger } from '../../duel-logger';
import { CardInfo, LOCATION, SelectChainMsg } from '../../../duel-ws.types';

// `description` is the 64-bit OCGCore code (cardCode << 20 | strIndex). The
// fixtures below use cardCode-0 system codes, so `description === strIndex` and
// the stub resolver below echoes "Effect <strIndex>" for each — deterministic
// without an async card-data fetch.
function chainCard(cardCode: number, sequence: number, description?: number): CardInfo {
  return { cardCode, name: `Card ${cardCode}`, player: 0, location: LOCATION.MZONE, sequence, description };
}

function selectChain(cards: CardInfo[]): SelectChainMsg {
  return { type: 'SELECT_CHAIN', player: 0, cards, forced: false, hintTiming: 0 };
}

/** System-string stub: echoes a label per strIndex so resolution is testable. */
function systemStringsStub() {
  return {
    provide: DuelSystemStringsService,
    useValue: {
      preload: () => Promise.resolve(),
      resolveSystemString: (strIndex: number) => strIndex > 0 ? `Effect ${strIndex}` : '',
      resolveWinReason: () => '',
    },
  };
}

describe('PromptCardGridComponent — effect discriminator', () => {
  function make(prompt: SelectChainMsg): PromptCardGridComponent {
    TestBed.configureTestingModule({
      imports: [PromptCardGridComponent, TranslateModule.forRoot()],
      providers: [
        { provide: DuelCardArtService, useValue: { resolveUrl: () => '' } },
        { provide: CardDataCacheService, useValue: { getCardData: () => Promise.resolve({ name: '' }) } },
        systemStringsStub(),
        // F1 routed the grid's debug logs through DuelLogger (injected) — provide
        // it (real, dependency-light) so the component instantiates in tests.
        DuelLogger,
      ],
    });
    const fixture = TestBed.createComponent(PromptCardGridComponent);
    fixture.componentInstance.promptData = prompt;
    return fixture.componentInstance;
  }

  it('numbers each entry of a duplicated cardCode group (Effet 1 / Effet 2)', () => {
    const c = make(selectChain([
      chainCard(100, 0, 0x101),
      chainCard(100, 0, 0x102),
    ]));
    expect(c.effectBadge(0)).toBe(1);
    expect(c.effectBadge(1)).toBe(2);
  });

  it('returns null for a single-occurrence cardCode', () => {
    const c = make(selectChain([
      chainCard(100, 0, 0x101),
      chainCard(100, 0, 0x102),
      chainCard(200, 1, 0x103),
    ]));
    expect(c.effectBadge(2)).toBeNull();
  });

  it('shows the badge even when a duplicate entry has no description (badge-only fallback)', () => {
    const c = make(selectChain([
      chainCard(100, 0, 0x101),
      chainCard(100, 0, undefined),
    ]));
    expect(c.effectBadge(1)).toBe(2);
    expect(c.effectTitle(c.cards[1])).toBeNull();
  });

  it('numbers a triple duplicate in raw prompt order', () => {
    const c = make(selectChain([
      chainCard(100, 0, 0x101),
      chainCard(100, 0, 0x102),
      chainCard(100, 0, 0x103),
    ]));
    expect([c.effectBadge(0), c.effectBadge(1), c.effectBadge(2)]).toEqual([1, 2, 3]);
  });

  it('does NOT badge two physical copies of the same card (same cardCode, different zone)', () => {
    // One copy in hand, one on the field — same cardCode but distinct cards,
    // each with a single effect. They must not read as "Effet 1 / Effet 2".
    const inHand: CardInfo = { cardCode: 100, name: 'Card 100', player: 0, location: LOCATION.HAND, sequence: 0, description: 0x101 };
    const onField: CardInfo = { cardCode: 100, name: 'Card 100', player: 0, location: LOCATION.MZONE, sequence: 2, description: 0x101 };
    const c = make(selectChain([inHand, onField]));
    expect(c.effectBadge(0)).toBeNull();
    expect(c.effectBadge(1)).toBeNull();
  });

  it('exposes effect text via effectTitle once resolved, null when empty', fakeAsync(() => {
    const c = make(selectChain([
      chainCard(100, 0, 0x101),
      chainCard(100, 0, undefined),
    ]));
    c.ngOnInit();
    tick();
    expect(c.effectTitle(c.cards[0])).toBe('Effect 257');
    expect(c.effectTitle(c.cards[1])).toBeNull();
  }));

  it('numbers contiguously over displayed entries when a duplicate is excluded', () => {
    const dupA = chainCard(100, 0, 0x101);
    const dupB = chainCard(100, 0, 0x102);
    const other = chainCard(200, 1, 0x103);
    const c = make(selectChain([dupA, dupB, other]));
    // dupA excluded → only dupB + other remain visible; dupB must read "Effet 1", not "2"
    c.excludedCards = [dupA];
    expect(c.effectBadge(0)).toBeNull(); // dupA excluded, not displayed
    expect(c.effectBadge(1)).toBeNull(); // dupB now single-occurrence among displayed
  });

  it('opens the hover panel with the effect text for any chain entry', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    c.ngOnInit();
    tick();
    c.onCardHover(0);
    expect(c.hoverIndex()).toBe(0);
    expect(c.hoverText()).toBe('Effect 257');
    c.onCardLeave();
    expect(c.hoverIndex()).toBeNull();
    expect(c.hoverText()).toBeNull();
  }));

  it('opens the hover panel for a single-occurrence chain card (not duplicate-only)', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102), chainCard(200, 1, 0x104)]));
    c.ngOnInit();
    tick();
    c.onCardHover(2);
    expect(c.hoverIndex()).toBe(2);
    expect(c.hoverText()).toBe('Effect 260');
  }));

  it('does not open the hover panel for a chain entry with no effect text', () => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(200, 1, undefined)]));
    c.onCardHover(1);
    expect(c.hoverIndex()).toBeNull();
  });

  // Direction B (Master Duel-style, 2026-06-05) — onCardPointer* handlers
  // were replaced by the [appLongPress] directive (covered in
  // long-press.directive.spec.ts). What this component owns is the
  // `onCardLongPress` dispatcher that picks effect-panel vs inspect based on
  // prompt type. Pinning the dispatcher contract is enough at this layer.
  it('SELECT_CHAIN + effect text → onCardLongPress opens the effect panel', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    c.ngOnInit();
    tick();
    let emitted = false;
    c.longPressInspect.subscribe(() => { emitted = true; });
    c.onCardLongPress(0);
    expect(c.hoverIndex()).toBe(0);
    expect(emitted).toBeFalse(); // effect panel branch, NOT inspect
  }));

  it('SELECT_CHAIN + no effect text → onCardLongPress emits inspect', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(200, 1, undefined)]));
    c.ngOnInit();
    tick();
    const events: { cardCode: number }[] = [];
    c.longPressInspect.subscribe(e => events.push(e));
    c.onCardLongPress(1);
    expect(c.hoverIndex()).toBeNull(); // no effect text, no panel
    expect(events).toEqual([{ cardCode: 200 }]);
  }));

  it('a fired long-press suppresses the trailing toggleCard selection', () => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    c.onCardLongPress(0);
    c.toggleCard(0); // the synthetic click after the long press
    expect(c.selectedIndices().size).toBe(0); // selection suppressed
  });

  it('onCardContextMenu emits inspect and preventDefaults the event', () => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    const events: { cardCode: number }[] = [];
    c.longPressInspect.subscribe(e => events.push(e));
    let prevented = false;
    const ev = { preventDefault: () => { prevented = true; } } as unknown as MouseEvent;
    c.onCardContextMenu(0, ev);
    expect(prevented).toBeTrue();
    expect(events).toEqual([{ cardCode: 100 }]);
  });

  it('dblclickCard on SELECT_CHAIN emits inspect (no selection / confirm)', () => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    const events: { cardCode: number }[] = [];
    c.longPressInspect.subscribe(e => events.push(e));
    c.dblclickCard(0);
    expect(events).toEqual([{ cardCode: 100 }]);
    expect(c.selectedIndices().size).toBe(0);
  });

  it('tap (toggleCard) on SELECT_CHAIN no longer emits inspect', () => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    let emitted = false;
    c.longPressInspect.subscribe(() => { emitted = true; });
    c.toggleCard(0);
    expect(emitted).toBeFalse();
    expect(c.selectedIndices().size).toBe(1); // selection went through
  });

  it('returns null for non-SELECT_CHAIN prompts', () => {
    const c = make(selectChain([chainCard(100, 0, 0x101), chainCard(100, 0, 0x102)]));
    c.promptData = { type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [chainCard(100, 0)], cancelable: false };
    expect(c.effectBadge(0)).toBeNull();
  });
});
