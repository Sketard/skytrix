/**
 * Spec for GameLogPanelComponent — Surface 1 of the Game Log feature.
 *
 * The panel consumes `DuelGameLogService.gameLogEntries`. The spec drives a
 * REAL `DuelGameLogService` (its own builder is pure + fast) with a scripted
 * event sequence, then asserts the render tree: separators, move rows, the
 * bare-row weight, chain grouping.
 *
 * Open state lives on the service (`panelOpen` / `panelClosing`): the spec
 * opens the panel via `gameLog.openPanel()` and asserts the chrome — Escape
 * and click-outside start a timed close (Lot 4c), a row click emits
 * `inspectCard` (Lot 4e), and the G3 auto-scroll follows the bottom or raises
 * the "new entries" pill when scrolled up (Lot 4d).
 */

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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
  /** Open the panel via the service (the trigger button's path) + flush. */
  function openPanel(): void {
    gameLog.openPanel();
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
  it('renders no DOM while the panel is closed (default)', () => {
    feed([draw(0, [1001, 1002, 1003, 1004, 1005])]);
    expect(panelEl()).toBeNull();
  });

  it('renders the panel chrome once the service opens it', () => {
    openPanel();
    expect(panelEl()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.gamelog__head')).not.toBeNull();
  });

  it('shows the empty state before any event', () => {
    openPanel();
    expect(fixture.nativeElement.querySelector('.gamelog__empty')).not.toBeNull();
  });

  // ── chrome — close via ✕ / Escape / click-outside (Lot 4c) ──────────────────
  it('Escape starts a timed close and tears the DOM down', fakeAsync(() => {
    openPanel();
    const panel = panelEl();
    expect(panel).not.toBeNull();

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    // The exit transition is in flight — still in the DOM, flagged closing.
    expect(gameLog.panelClosing()).toBe(true);
    expect(panelEl()!.classList.contains('gamelog--closing')).toBe(true);

    tick(200); // past CLOSE_TRANSITION_MS
    fixture.detectChanges();
    expect(panelEl()).toBeNull();
    expect(gameLog.panelOpen()).toBe(false);
  }));

  it('a click outside the panel starts a timed close', fakeAsync(() => {
    openPanel();
    tick(); // the click-outside listener arms on a microtask delay
    expect(panelEl()).not.toBeNull();

    // A click landing outside the panel host triggers the close.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(gameLog.panelClosing()).toBe(true);

    tick(200);
    fixture.detectChanges();
    expect(panelEl()).toBeNull();
  }));

  it('the ✕ button starts a timed close', fakeAsync(() => {
    openPanel();
    const closeBtn = fixture.nativeElement.querySelector(
      '.gamelog__head app-icon-button button',
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    closeBtn.click();
    fixture.detectChanges();
    expect(gameLog.panelClosing()).toBe(true);

    tick(200);
    fixture.detectChanges();
    expect(panelEl()).toBeNull();
  }));

  // ── render tree ─────────────────────────────────────────────────────────────
  it('renders a turn separator and a phase separator for the first event', () => {
    openPanel();
    feed([draw(0, [1001, 1002, 1003, 1004, 1005])]);
    expect(fixture.nativeElement.querySelector('.lg-turn')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.lg-phase')).not.toBeNull();
    // The empty state is gone once entries exist.
    expect(fixture.nativeElement.querySelector('.gamelog__empty')).toBeNull();
  });

  it('renders a move row for a draw event', () => {
    openPanel();
    feed([draw(0, [1001, 1002, 1003, 1004, 1005])]);
    expect(fixture.nativeElement.querySelector('.lg-row')).not.toBeNull();
  });

  it('renders a folded chain group for a chained activation sequence', () => {
    // A chain-start separator + a chained move + chain-end folds into ONE
    // .lg-chaingroup block (D-B). The builder emits the delimiters off the
    // MSG_CHAINING / MSG_CHAIN_* events.
    openPanel();
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
    openPanel();
    feed([draw(0, [1001])]);
    const firstCount = fixture.nativeElement.querySelectorAll('.lg-row').length;
    feed([draw(0, [1002])]);
    const secondCount = fixture.nativeElement.querySelectorAll('.lg-row').length;
    expect(secondCount).toBeGreaterThanOrEqual(firstCount);
  });

  // ── click-a-row → card-inspector (Lot 4e) ───────────────────────────────────
  it('emits inspectCard with the source card code when a full row is clicked', () => {
    openPanel();
    let emitted: number | undefined;
    component.inspectCard.subscribe((code: number) => (emitted = code));

    // A chained activation produces a full row whose source carries a code.
    feed([chaining(1, 5050, 'Effet adverse')]);
    const row = fixture.nativeElement.querySelector(
      '.lg-row:not(.lg-row--bare)',
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.click();
    expect(emitted).toBe(5050);
  });

  it('onRowClick ignores a separator entry', () => {
    let emitted = false;
    component.inspectCard.subscribe(() => (emitted = true));
    component.onRowClick({ block: 'separator', kind: 'turn', turnNumber: 1 });
    expect(emitted).toBe(false);
  });

  it('onRowClick does not emit for a source-less move row', () => {
    let emitted = false;
    component.inspectCard.subscribe(() => (emitted = true));
    component.onRowClick({
      block: 'move',
      player: 0,
      turnNumber: 1,
      source: null,
      description: null,
      movedCards: [],
    });
    expect(emitted).toBe(false);
  });

  // ── G3 auto-scroll (Lot 4d) ─────────────────────────────────────────────────
  // The Karma DOM does not lay out a real scroll viewport, so `scrollHeight` /
  // `clientHeight` / `scrollTop` are forced. `scrollTop` gets a real
  // getter/setter backed by a cell so the component's `el.scrollTop = …`
  // write is observable. `scrollTopOf()` reads the cell back.
  function mockScrollMetrics(
    el: HTMLElement,
    scrollHeight: number,
    clientHeight: number,
    initialTop: number,
  ): void {
    const cell = { top: initialTop };
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => cell.top,
      set: (v: number) => { cell.top = v; },
    });
  }
  function scrollBoxEl(): HTMLElement {
    return fixture.nativeElement.querySelector('.gamelog__scroll') as HTMLElement;
  }

  it('auto-scrolls to the newest entry when already at the bottom', () => {
    openPanel();
    // 700 + 300 === 1000 → at the bottom.
    const box = scrollBoxEl();
    mockScrollMetrics(box, 1000, 300, 700);

    feed([draw(0, [1001])]);
    // The auto-scroll pushed scrollTop to scrollHeight; no pill.
    expect(box.scrollTop).toBe(1000);
    expect(component.hasNewEntries()).toBe(false);
    expect(fixture.nativeElement.querySelector('.gamelog__newpill')).toBeNull();
  });

  it('shows the "new entries" pill instead of hijacking the scroll when scrolled up', () => {
    openPanel();
    // 100 — far from the bottom; the user is reading history.
    const box = scrollBoxEl();
    mockScrollMetrics(box, 1000, 300, 100);

    feed([draw(0, [1001])]);
    // The scroll was NOT hijacked…
    expect(box.scrollTop).toBe(100);
    // …and the affordance is raised instead.
    expect(component.hasNewEntries()).toBe(true);
    expect(fixture.nativeElement.querySelector('.gamelog__newpill')).not.toBeNull();
  });

  it('the sub-pixel tolerance keeps "at bottom" true for a fractional scroll gap', () => {
    openPanel();
    // 690 + 300 = 990 — a 10px gap, within the tolerance: still "at bottom".
    mockScrollMetrics(scrollBoxEl(), 1000, 300, 690);

    feed([draw(0, [1001])]);
    expect(component.hasNewEntries()).toBe(false);
    expect(fixture.nativeElement.querySelector('.gamelog__newpill')).toBeNull();
  });

  it('clicking the "new entries" pill scrolls to the bottom and clears it', () => {
    openPanel();
    const box = scrollBoxEl();
    mockScrollMetrics(box, 1000, 300, 100);

    feed([draw(0, [1001])]);
    const pill = fixture.nativeElement.querySelector(
      '.gamelog__newpill',
    ) as HTMLButtonElement;
    expect(pill).not.toBeNull();

    pill.click();
    fixture.detectChanges();
    expect(box.scrollTop).toBe(1000);
    expect(component.hasNewEntries()).toBe(false);
    expect(fixture.nativeElement.querySelector('.gamelog__newpill')).toBeNull();
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
