import { TestBed } from '@angular/core/testing';
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

  it('opens the hover panel with the effect text for a duplicate entry', () => {
    const c = make(selectChain([chainCard(100, 0, 'Fusion Summon'), chainCard(100, 0, 'Search')]));
    const slot = { getBoundingClientRect: () => ({ left: 200, top: 300, bottom: 444, width: 99 }) } as HTMLElement;
    c.onCardHover(0, slot);
    const hover = c.hoverEffect();
    expect(hover?.text).toBe('Fusion Summon');
    expect(hover?.left).toBe(249.5); // left + width/2
    expect(hover?.flip).toBe(false); // top 300 leaves room above
    c.onCardLeave();
    expect(c.hoverEffect()).toBeNull();
  });

  it('does not open the hover panel for a single-occurrence card', () => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B'), chainCard(200, 1, 'Solo')]));
    const slot = { getBoundingClientRect: () => ({ left: 0, top: 300, bottom: 444, width: 99 }) } as HTMLElement;
    c.onCardHover(2, slot);
    expect(c.hoverEffect()).toBeNull();
  });

  it('flips the hover panel below the card when near the viewport top', () => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B')]));
    const slot = { getBoundingClientRect: () => ({ left: 0, top: 10, bottom: 154, width: 99 }) } as HTMLElement;
    c.onCardHover(0, slot);
    expect(c.hoverEffect()?.flip).toBe(true);
  });

  it('returns null for non-SELECT_CHAIN prompts', () => {
    const c = make(selectChain([chainCard(100, 0, 'A'), chainCard(100, 0, 'B')]));
    c.promptData = { type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [chainCard(100, 0)], cancelable: false };
    expect(c.effectBadge(0)).toBeNull();
  });
});
