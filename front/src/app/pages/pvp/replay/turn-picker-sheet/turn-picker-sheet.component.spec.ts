import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TurnPickerSheetComponent } from './turn-picker-sheet.component';
import { PvpBoardContainerComponent } from '../../duel-page/pvp-board-container/pvp-board-container.component';
import { EMPTY_DUEL_STATE } from '../../types';
import type { PreComputedState, TurnMeta } from '../../replay-ws.types';

const stubMeta = (n: number, startIndex: number, endIndex: number): TurnMeta => ({
  turnNumber: n, startIndex, endIndex, p1LP: 8000, p2LP: 8000, eventCount: endIndex - startIndex + 1,
});

const stubState = (label: string): PreComputedState => ({
  boardState: EMPTY_DUEL_STATE, events: [], label, responseCount: 0,
});

// Stub for `<app-pvp-board-container>` — the real component pulls in the
// full PvP DI graph (CardTravelEngine, BoardEffectsService, etc.) which is
// way too heavy for a unit test of the turn-picker's own behavior. We just
// need the element to render so the picker can count its preview wrappers.
// All inputs the picker binds are declared so the template compiles, but
// they're inert — the stub never reads them.
@Component({
  selector: 'app-pvp-board-container',
  standalone: true,
  template: '',
})
class PvpBoardContainerStubComponent {
  readonly preview = input<boolean>(false);
  readonly readOnly = input<boolean>(false);
  readonly duelState = input<unknown>(null);
  readonly ownPlayerIndex = input<unknown>(null);
  readonly highlightedZones = input<unknown>(null);
  readonly revealedZoneKeys = input<unknown>(null);
  readonly targetedZoneKeys = input<unknown>(null);
  readonly preTargetZoneKeys = input<unknown>(null);
  readonly swapGraveDeckKeys = input<unknown>(null);
  readonly activeChainLinks = input<unknown>(null);
  readonly chosenZone = input<unknown>(null);
  readonly actionablePrompt = input<unknown>(null);
  readonly animatingZone = input<unknown>(null);
  readonly animatingLp = input<unknown>(null);
  readonly timerState = input<unknown>(null);
  readonly opponentDisconnected = input<boolean>(false);
  readonly displayedPhase = input<unknown>(null);
  readonly displayedTurnPlayer = input<unknown>(null);
  readonly displayedTurnCount = input<unknown>(null);
  readonly counterPulseKey = input<unknown>(null);
  readonly chainPhase = input<unknown>('idle');
}

describe('TurnPickerSheetComponent', () => {
  let fixture: ComponentFixture<TurnPickerSheetComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TurnPickerSheetComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
    })
      // Swap the heavy board container for a stub before component creation.
      // Angular's `overrideComponent` rewrites the component metadata in
      // place — the picker sees our stub instead of the real container.
      .overrideComponent(TurnPickerSheetComponent, {
        remove: { imports: [PvpBoardContainerComponent] },
        add:    { imports: [PvpBoardContainerStubComponent] },
      })
      .compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(TurnPickerSheetComponent);
    el = fixture.nativeElement;
  });

  function bind(turns: TurnMeta[], current: number, upTo: number) {
    // boardStates is indexed by global event index, not by turn — must be
    // sized to cover every `turn.startIndex` referenced by the input set.
    const lastIdx = Math.max(0, ...turns.map(t => t.startIndex));
    const states: PreComputedState[] = Array.from({ length: lastIdx + 1 }, (_, i) => stubState(`s${i}`));
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('currentTurnIndex', current);
    fixture.componentRef.setInput('computedUpToIndex', upTo);
    fixture.componentRef.setInput('boardStates', states);
    fixture.detectChanges();
  }

  it('splits entries into setup (T0) + turns sections', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    const sections = el.querySelectorAll('.turn-picker__section');
    expect(sections.length).toBe(2);
    // Section 1 (setup) has 1 card (T0); section 2 (turns) has 2 cards (T1, T2).
    expect(sections[0].querySelectorAll('.turn-picker__card').length).toBe(1);
    expect(sections[1].querySelectorAll('.turn-picker__card').length).toBe(2);
  });

  it('omits the setup section entirely when no T0 exists', () => {
    bind([stubMeta(1, 0, 2), stubMeta(2, 3, 5)], 0, 5);
    const sections = el.querySelectorAll('.turn-picker__section');
    expect(sections.length).toBe(1);
    expect(sections[0].querySelectorAll('.turn-picker__card').length).toBe(2);
  });

  it('marks the current turn card with --current modifier + aria-current', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 1, 8);
    const cards = el.querySelectorAll('.turn-picker__card');
    expect(cards[0].classList.contains('turn-picker__card--current')).toBe(false);
    expect(cards[1].classList.contains('turn-picker__card--current')).toBe(true);
    expect(cards[1].getAttribute('aria-current')).toBe('true');
  });

  it('disables turns whose startIndex is past computedUpToIndex', () => {
    // The native `disabled` attribute on a <button> already conveys
    // a11y state — `aria-disabled` would be redundant (and contradictory:
    // the WAI-ARIA spec forbids `aria-disabled` on a `disabled` button).
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 4); // upTo=4 → turn 2 (start=6) not computed
    const cards = el.querySelectorAll('.turn-picker__card');
    expect((cards[2] as HTMLButtonElement).disabled).toBe(true);
    expect(cards[2].classList.contains('turn-picker__card--not-computed')).toBe(true);
  });

  it('emits jumpToTurn with the entry index on click (computed turn only)', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 8);
    const jumpSpy = spyOn(fixture.componentInstance.jumpToTurn, 'emit');
    const cards = el.querySelectorAll('.turn-picker__card');
    (cards[1] as HTMLButtonElement).click();
    expect(jumpSpy).toHaveBeenCalledOnceWith(1);
  });

  it('does NOT emit jumpToTurn when an uncomputed card is clicked', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5)], 0, -1);
    const jumpSpy = spyOn(fixture.componentInstance.jumpToTurn, 'emit');
    (el.querySelectorAll('.turn-picker__card')[0] as HTMLButtonElement).click();
    expect(jumpSpy).not.toHaveBeenCalled();
  });

  it('renders one preview wrapper with <app-pvp-board-container> per computed entry', () => {
    bind([stubMeta(0, 0, 2), stubMeta(1, 3, 5), stubMeta(2, 6, 8)], 0, 5);
    const previews = el.querySelectorAll('.turn-picker__preview app-pvp-board-container');
    // 3 cards × 1 board-container each = 3 (uncomputed still has the @if
    // state guard, but boardStates are seeded for every turn here → all 3).
    expect(previews.length).toBe(3);
  });
});
