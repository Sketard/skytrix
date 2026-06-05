import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { PromptSortCardComponent } from './prompt-sort-card.component';
import { DuelCardArtService } from '../../duel-card-art.service';
import { CardInfo, LOCATION, SortCardMsg } from '../../../duel-ws.types';

function sortPrompt(cards: CardInfo[]): SortCardMsg {
  return { type: 'SORT_CARD', player: 0, cards };
}

function card(cardCode: number): CardInfo {
  return { cardCode, name: `Card ${cardCode}`, player: 0, location: LOCATION.HAND, sequence: 0 };
}

function make(prompt: SortCardMsg): PromptSortCardComponent {
  TestBed.configureTestingModule({
    imports: [PromptSortCardComponent, TranslateModule.forRoot()],
    providers: [{ provide: DuelCardArtService, useValue: { resolveUrl: () => '' } }],
  });
  const fixture = TestBed.createComponent(PromptSortCardComponent);
  fixture.componentInstance.promptData = prompt;
  return fixture.componentInstance;
}

describe('PromptSortCardComponent — Direction B gestures (2026-06-05)', () => {
  it('tap (toggleCard) does not emit inspect', () => {
    const c = make(sortPrompt([card(100), card(200)]));
    let emitted = false;
    c.longPressInspect.subscribe(() => { emitted = true; });
    c.toggleCard(0);
    expect(emitted).toBeFalse();
    expect(c.orderedIndices()).toEqual([0]); // sort logic still works
  });

  it('onCardLongPress emits inspect with the card code', () => {
    const c = make(sortPrompt([card(100), card(200)]));
    const events: { cardCode: number }[] = [];
    c.longPressInspect.subscribe(e => events.push(e));
    c.onCardLongPress(1);
    expect(events).toEqual([{ cardCode: 200 }]);
  });

  it('onCardContextMenu emits inspect and preventDefaults the event', () => {
    const c = make(sortPrompt([card(100), card(200)]));
    const events: { cardCode: number }[] = [];
    c.longPressInspect.subscribe(e => events.push(e));
    let prevented = false;
    const ev = { preventDefault: () => { prevented = true; } } as unknown as MouseEvent;
    c.onCardContextMenu(0, ev);
    expect(prevented).toBeTrue();
    expect(events).toEqual([{ cardCode: 100 }]);
  });
});
