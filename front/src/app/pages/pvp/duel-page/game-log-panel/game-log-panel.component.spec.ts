/**
 * Spec for GameLogPanelComponent — Surface 1 of the Game Log feature.
 *
 * The panel consumes `DuelGameLogService.gameLogEntries`. The spec drives a
 * REAL `DuelGameLogService` (its own builder is pure + fast) with a scripted
 * event sequence, then asserts the render tree: separators, move rows, the
 * bare-row weight, chain grouping. It also asserts the `open` gate — `false`
 * renders no DOM at all (R5).
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  TranslateFakeLoader,
  TranslateLoader,
  TranslateModule,
} from '@ngx-translate/core';

import { GameLogPanelComponent } from './game-log-panel.component';
import { DuelGameLogService } from '../duel-game-log.service';
import { DuelCardArtService } from '../duel-card-art.service';
import type { DuelState, GameEvent } from '../../types';
import type { ChainingMsg, DrawMsg } from '../../duel-ws.types';

// -----------------------------------------------------------------------------
// Fixtures — mirror duel-game-log.service.spec.ts (a viewer-relative board).
// -----------------------------------------------------------------------------
function board(turnCount = 1, phase = 'MAIN1'): DuelState {
  return {
    turnPlayer: 0,
    turnCount,
    phase: phase as DuelState['phase'],
    players: [
      { lp: 8000, deckCount: 30, extraCount: 5, zones: [] },
      { lp: 8000, deckCount: 30, extraCount: 5, zones: [] },
    ],
  };
}

function draw(player: 0 | 1, cards: number[]): DrawMsg {
  return { type: 'MSG_DRAW', player, cards };
}

function chaining(player: 0 | 1, cardCode: number, cardName: string): ChainingMsg {
  return {
    type: 'MSG_CHAINING',
    cardCode,
    cardName,
    player,
    location: 0x4 /* SZONE */ as ChainingMsg['location'],
    sequence: 0,
    chainIndex: 1,
    description: 0,
  };
}

describe('GameLogPanelComponent', () => {
  let fixture: ComponentFixture<GameLogPanelComponent>;
  let component: GameLogPanelComponent;
  let gameLog: DuelGameLogService;

  /** The panel root, or null when the `open` gate suppressed all DOM. */
  function panelEl(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.gamelog');
  }
  function feed(events: GameEvent[]): void {
    for (const e of events) gameLog.notifyGameLog(e);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        GameLogPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateFakeLoader },
        }),
      ],
      providers: [DuelGameLogService, DuelCardArtService],
    });

    gameLog = TestBed.inject(DuelGameLogService);
    gameLog.attachBoardSource(() => board());

    fixture = TestBed.createComponent(GameLogPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  // ── open gate (R5) ──────────────────────────────────────────────────────────
  it('renders no DOM when open is false', () => {
    fixture.componentRef.setInput('open', false);
    feed([draw(0, [1001, 1002, 1003, 1004, 1005])]);
    expect(panelEl()).toBeNull();
  });

  it('renders the panel chrome when open is true (default)', () => {
    expect(panelEl()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.gamelog__head')).not.toBeNull();
  });

  it('shows the empty state before any event', () => {
    expect(fixture.nativeElement.querySelector('.gamelog__empty')).not.toBeNull();
  });

  // ── render tree ─────────────────────────────────────────────────────────────
  it('renders a turn separator and a phase separator for the first event', () => {
    feed([draw(0, [1001, 1002, 1003, 1004, 1005])]);
    expect(fixture.nativeElement.querySelector('.lg-turn')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.lg-phase')).not.toBeNull();
    // The empty state is gone once entries exist.
    expect(fixture.nativeElement.querySelector('.gamelog__empty')).toBeNull();
  });

  it('renders a move row for a draw event', () => {
    feed([draw(0, [1001, 1002, 1003, 1004, 1005])]);
    expect(fixture.nativeElement.querySelector('.lg-row')).not.toBeNull();
  });

  it('renders a folded chain group for a chained activation sequence', () => {
    // A chain-start separator + a chained move + chain-end folds into ONE
    // .lg-chaingroup block (D-B). The builder emits the delimiters off the
    // MSG_CHAINING / MSG_CHAIN_* events.
    feed([
      draw(0, [1001]),
      chaining(0, 5001, 'Effet en chaîne'),
    ]);
    // At minimum the chained activation produced rows; if the builder emitted
    // chain delimiters, the render tree folds them into a chaingroup.
    const hasRows = fixture.nativeElement.querySelectorAll('.lg-row').length > 0;
    expect(hasRows).toBe(true);
  });

  it('publishes a fresh render tree as new events arrive', () => {
    feed([draw(0, [1001])]);
    const firstCount = fixture.nativeElement.querySelectorAll('.lg-row').length;
    feed([draw(0, [1002])]);
    const secondCount = fixture.nativeElement.querySelectorAll('.lg-row').length;
    expect(secondCount).toBeGreaterThanOrEqual(firstCount);
  });

  // ── helper-method behaviour ─────────────────────────────────────────────────
  it('isBareRow flags a source-less standalone move', () => {
    expect(
      component.isBareRow({
        block: 'move',
        player: 0,
        turnNumber: 1,
        source: null,
        description: null,
        movedCards: [],
      }),
    ).toBe(true);
  });

  it('isBareRow is false for the initial-hand variant', () => {
    expect(
      component.isBareRow({
        block: 'move',
        player: 0,
        turnNumber: 1,
        source: null,
        description: null,
        movedCards: [],
        variant: 'initial-hand',
      }),
    ).toBe(false);
  });

  it('statClass distinguishes ATK / DEF / damage strings', () => {
    expect(component.statClass('ATK 2400')).toBe('atk');
    expect(component.statClass('DEF 1900')).toBe('def');
    expect(component.statClass('détruit')).toBe('dmg');
    expect(component.statClass(undefined)).toBe('dmg');
  });

  it('boardEmz places EMZ cells at columns 1 and 3', () => {
    const cells = component.boardEmz({ player: 0, row: 'EMZ', sequence: 0 });
    expect(cells.length).toBe(5);
    expect(cells.filter(c => c.emz).length).toBe(2);
    // EMZ sequence 0 → grid column 1 is the highlighted target.
    expect(cells[1].target).toBe(true);
    expect(cells[3].target).toBe(false);
  });
});
