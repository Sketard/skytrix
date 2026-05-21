import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { PromptCardGridComponent } from './prompt-card-grid.component';
import { DuelCardArtService } from '../../duel-card-art.service';
import { CardInfo, LOCATION, SelectChainMsg } from '../../../duel-ws.types';

function chainCard(cardCode: number, sequence: number, description?: string): CardInfo {
  return { cardCode, name: `Card ${cardCode}`, player: 0, location: LOCATION.MZONE, sequence, description };
}

function selectChain(cards: CardInfo[]): SelectChainMsg {
  return { type: 'SELECT_CHAIN', player: 0, cards, forced: false, hintTiming: 0, hintTimingLabel: '' };
}

describe('PromptCardGridComponent — effect discriminator', () => {
  function make(prompt: SelectChainMsg): PromptCardGridComponent {
    TestBed.configureTestingModule({
      imports: [PromptCardGridComponent, TranslateModule.forRoot()],
      providers: [{ provide: DuelCardArtService, useValue: { resolveUrl: () => '' } }],
    });
    const fixture = TestBed.createComponent(PromptCardGridComponent);
    fixture.componentInstance.promptData = prompt;
    return fixture.componentInstance;
  }

  it('numbers each entry of a duplicated cardCode group (Effet 1 / Effet 2)', () => {
    const c = make(selectChain([
      chainCard(100, 0, 'Effect A'),
      chainCard(100, 0, 'Effect B'),
    ]));
    expect(c.effectBadge(0)).toBe(1);
    expect(c.effectBadge(1)).toBe(2);
  });

  it('returns null for a single-occurrence cardCode', () => {
    const c = make(selectChain([
      chainCard(100, 0, 'Effect A'),
      chainCard(100, 0, 'Effect B'),
      chainCard(200, 1, 'Other'),
    ]));
    expect(c.effectBadge(2)).toBeNull();
  });

  it('shows the badge even when a duplicate entry has no description (badge-only fallback)', () => {
    const c = make(selectChain([
      chainCard(100, 0, 'Effect A'),
      chainCard(100, 0, undefined),
    ]));
    expect(c.effectBadge(1)).toBe(2);
    expect(c.effectTitle(c.cards[1])).toBeNull();
  });

  it('numbers a triple duplicate in raw prompt order', () => {
    const c = make(selectChain([
      chainCard(100, 0, 'A'),
      chainCard(100, 0, 'B'),
      chainCard(100, 0, 'C'),
    ]));
    expect([c.effectBadge(0), c.effectBadge(1), c.effectBadge(2)]).toEqual([1, 2, 3]);
  });

  it('does NOT badge two physical copies of the same card (same cardCode, different zone)', () => {
    // One copy in hand, one on the field — same cardCode but distinct cards,
    // each with a single effect. They must not read as "Effet 1 / Effet 2".
    const inHand: CardInfo = { cardCode: 100, name: 'Card 100', player: 0, location: LOCATION.HAND, sequence: 0, description: 'A' };
    const onField: CardInfo = { cardCode: 100, name: 'Card 100', player: 0, location: LOCATION.MZONE, sequence: 2, description: 'A' };
    const c = make(selectChain([inHand, onField]));
    expect(c.effectBadge(0)).toBeNull();
    expect(c.effectBadge(1)).toBeNull();
  });

  it('exposes effect text via effectTitle, null when empty', () => {
    const c = make(selectChain([
      chainCard(100, 0, 'Fusion Summon'),
      chainCard(100, 0, ''),
    ]));
    expect(c.effectTitle(c.cards[0])).toBe('Fusion Summon');
    expect(c.effectTitle(c.cards[1])).toBeNull();
  });

  it('numbers contiguously over displayed entries when a duplicate is excluded', () => {
    const dupA = chainCard(100, 0, 'A');
    const dupB = chainCard(100, 0, 'B');
    const other = chainCard(200, 1, 'Other');
    const c = make(selectChain([dupA, dupB, other]));
    // dupA excluded → only dupB + other remain visible; dupB must read "Effet 1", not "2"
    c.excludedCards = [dupA];
    expect(c.effectBadge(0)).toBeNull(); // dupA excluded, not displayed
    expect(c.effectBadge(1)).toBeNull(); // dupB now single-occurrence among displayed
  });

  it('opens the hover panel with the effect text for any chain entry', () => {
    const c = make(selectChain([chainCard(100, 0, 'Fusion Summon'), chainCard(100, 0, 'Search')]));
    c.onCardHover(0);
    expect(c.hoverIndex()).toBe(0);
    expect(c.hoverText()).toBe('Fusion Summon');
    c.onCardLeave();
    expect(c.hoverIndex()).toBeNull();
    expect(c.hoverText()).toBeNull();
  });

  it('opens the hover panel for a single-occurrence chain card (not duplicate-only)', () => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B'), chainCard(200, 1, 'Solo')]));
    c.onCardHover(2);
    expect(c.hoverIndex()).toBe(2);
    expect(c.hoverText()).toBe('Solo');
  });

  it('does not open the hover panel for a chain entry with no effect text', () => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(200, 1, undefined)]));
    c.onCardHover(1);
    expect(c.hoverIndex()).toBeNull();
  });

  it('opens the panel on touch long-press and closes it on release', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 'Fusion Summon'), chainCard(100, 0, 'Search')]));
    c.onCardPointerDown(0, { pointerType: 'touch', clientX: 50, clientY: 50 } as PointerEvent);
    expect(c.hoverIndex()).toBeNull(); // not yet — timer pending
    tick(500);
    expect(c.hoverIndex()).toBe(0);
    c.onCardPointerUp();
    expect(c.hoverIndex()).toBeNull();
  }));

  it('a fired long-press suppresses the trailing toggleCard selection', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B')]));
    c.onCardPointerDown(0, { pointerType: 'touch', clientX: 0, clientY: 0 } as PointerEvent);
    tick(500);
    c.onCardPointerUp();
    c.toggleCard(0); // the synthetic click after the long press
    expect(c.selectedIndices().size).toBe(0); // selection suppressed
  }));

  it('a mouse pointerdown does not arm the long-press timer', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B')]));
    c.onCardPointerDown(0, { pointerType: 'mouse', clientX: 0, clientY: 0 } as PointerEvent);
    tick(500);
    expect(c.hoverIndex()).toBeNull();
  }));

  it('movement beyond tolerance cancels the long-press', fakeAsync(() => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B')]));
    c.onCardPointerDown(0, { pointerType: 'touch', clientX: 0, clientY: 0 } as PointerEvent);
    c.onCardPointerMove({ clientX: 40, clientY: 0 } as PointerEvent); // 40px > tolerance
    tick(500);
    expect(c.hoverIndex()).toBeNull();
  }));

  it('returns null for non-SELECT_CHAIN prompts', () => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B')]));
    c.promptData = { type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [chainCard(100, 0)], cancelable: false };
    expect(c.effectBadge(0)).toBeNull();
  });
});
