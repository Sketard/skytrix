import { TestBed } from '@angular/core/testing';
import { DuelGameLogService } from './duel-game-log.service';
import type { DuelState, GameEvent } from '../types';
import type { ChainingMsg, DrawMsg } from '../duel-ws.types';
import type { PreComputedState } from '../duel-ws-replay.types';

// -----------------------------------------------------------------------------
// Board fixture — a viewer-relative `BoardStatePayload` (`players[0]` = "you").
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

function chaining(
  player: 0 | 1,
  cardCode: number,
  cardName: string,
  descriptionText?: string,
): ChainingMsg {
  return {
    type: 'MSG_CHAINING',
    cardCode,
    cardName,
    player,
    location: 0x4 /* SZONE */ as ChainingMsg['location'],
    sequence: 0,
    chainIndex: 0,
    description: 0,
    descriptionText,
  };
}

/** A precomputed replay state carrying a board snapshot + its events — the
 *  unit `rebuildUpTo` consumes after a seek. */
function state(
  events: GameEvent[],
  turnCount = 1,
  phase = 'MAIN1',
): PreComputedState {
  return {
    boardState: board(turnCount, phase),
    events,
    label: '',
    responseCount: 0,
  };
}

describe('DuelGameLogService', () => {
  let service: DuelGameLogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DuelGameLogService] });
    service = TestBed.inject(DuelGameLogService);
    // Default perspective is 0; attach a board source so the builder can
    // synthesise turn/phase separators.
    service.attachBoardSource(() => board());
  });

  it('starts empty', () => {
    expect(service.gameLogEntries()).toEqual([]);
    expect(service.lastOpponentActivation()).toBeNull();
  });

  it('accumulates entries as events are fed through notifyGameLog', () => {
    service.notifyGameLog(draw(0, [1001, 1002, 1003, 1004, 1005]));

    const entries = service.gameLogEntries();
    // A turn + phase separator are synthesised, then the draw row.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some(e => e.block === 'move')).toBe(true);
  });

  it('publishes a fresh array reference on each notify (OnPush safety)', () => {
    service.notifyGameLog(draw(0, [1001]));
    const first = service.gameLogEntries();
    service.notifyGameLog(draw(0, [1002]));
    const second = service.gameLogEntries();
    expect(second).not.toBe(first);
  });

  it('sets lastOpponentActivation only for an opponent MSG_CHAINING', () => {
    // Self activation (perspective 0, player 0) — must NOT trigger the bubble.
    service.notifyGameLog(chaining(0, 5001, 'Mon effet', 'Effet du joueur'));
    expect(service.lastOpponentActivation()).toBeNull();

    // Opponent activation (player 1) — triggers the bubble.
    service.notifyGameLog(chaining(1, 5002, 'Effet adverse', 'Texte adverse'));
    expect(service.lastOpponentActivation()).toEqual({
      cardCode: 5002,
      cardName: 'Effet adverse',
      descriptionText: 'Texte adverse',
    });
  });

  it('last opponent activation wins', () => {
    service.notifyGameLog(chaining(1, 5002, 'Premier', 'A'));
    service.notifyGameLog(chaining(1, 5003, 'Second', 'B'));
    expect(service.lastOpponentActivation()?.cardCode).toBe(5003);
  });

  it('tolerates a MSG_CHAINING without descriptionText', () => {
    service.notifyGameLog(chaining(1, 5004, 'Sans texte'));
    expect(service.lastOpponentActivation()?.descriptionText).toBe('');
  });

  it('reset() clears entries and lastOpponentActivation', () => {
    service.notifyGameLog(draw(0, [1001, 1002, 1003, 1004, 1005]));
    service.notifyGameLog(chaining(1, 5002, 'Effet adverse', 'X'));
    expect(service.gameLogEntries().length).toBeGreaterThan(0);
    expect(service.lastOpponentActivation()).not.toBeNull();

    service.reset();

    expect(service.gameLogEntries()).toEqual([]);
    expect(service.lastOpponentActivation()).toBeNull();
  });

  it('setPerspective rebuilds the journal from retained events', () => {
    const events: GameEvent[] = [
      draw(0, [1001]),
      chaining(1, 5002, 'Effet adverse', 'X'),
    ];
    for (const e of events) service.notifyGameLog(e);
    const before = service.gameLogEntries().length;

    // Flip perspective — the journal is rebuilt from the retained raw events.
    service.setPerspective(1);
    expect(service.gameLogEntries().length).toBe(before);

    // Under perspective 1 the player-1 chaining is now the viewer ("you"),
    // so it must no longer feed the opponent bubble on a fresh event.
    service.notifyGameLog(chaining(1, 5005, 'Mien maintenant', 'Y'));
    // lastOpponentActivation still reflects whatever was set BEFORE the flip —
    // the rebuild does not re-run the bubble feed (it only re-feeds the
    // builder), so assert the post-flip self-chaining did not overwrite it.
    expect(service.lastOpponentActivation()?.cardCode).not.toBe(5005);
  });

  it('setPerspective is a no-op when the perspective is unchanged', () => {
    service.notifyGameLog(draw(0, [1001]));
    const entries = service.gameLogEntries();
    service.setPerspective(0);
    expect(service.gameLogEntries()).toBe(entries);
  });

  // ── rebuildUpTo (Bug 1 — seek-rebuild: the journal is a full history) ───────
  describe('rebuildUpTo', () => {
    it('rebuilds the journal from the precomputed states [0..N]', () => {
      // Simulate a seek to step 2: abortAndClean empties the journal, then
      // rebuildUpTo re-feeds the history of states 0, 1, 2.
      const states: PreComputedState[] = [
        state([draw(0, [1001, 1002, 1003, 1004, 1005])], 1),
        state([chaining(0, 5001, 'Effet 1', 'A')], 1),
        state([chaining(1, 5002, 'Effet 2', 'B')], 2),
      ];

      service.reset(); // the seek path empties the journal first
      expect(service.gameLogEntries()).toEqual([]);

      service.rebuildUpTo(states);

      // The journal now reflects every event of states 0..2 — not just the
      // events of the seek target.
      const entries = service.gameLogEntries();
      expect(entries.length).toBeGreaterThan(0);
      // Both chained activations made it in (state 1 AND state 2).
      const moves = entries.filter(e => e.block === 'move');
      expect(moves.length).toBeGreaterThanOrEqual(2);
    });

    it('a seek BACKWARD reflects only the events up to the target', () => {
      const states: PreComputedState[] = [
        state([draw(0, [1001])], 1),
        state([draw(0, [1002])], 1),
        state([draw(0, [1003])], 1),
        state([draw(0, [1004])], 1),
      ];

      // Seek forward to the end…
      service.reset();
      service.rebuildUpTo(states);
      const fullCount = service.gameLogEntries().length;

      // …then seek backward to step 1 — the journal must shrink to [0..1].
      service.reset();
      service.rebuildUpTo(states.slice(0, 2));
      const backwardCount = service.gameLogEntries().length;

      expect(backwardCount).toBeLessThan(fullCount);
      expect(backwardCount).toBeGreaterThan(0);
    });

    it('bumps journalRebuiltTick so the panel can jump to the bottom', () => {
      // A wholesale rebuild signals the panel to scroll to the latest entry
      // (a seek lands the user on step N — they want its row, not the top).
      const before = service.journalRebuiltTick();
      service.rebuildUpTo([state([draw(0, [1001])], 1)]);
      expect(service.journalRebuiltTick()).toBe(before + 1);
    });

    it('the silent rebuild does NOT flash the opponent bubble', () => {
      // A seek-rebuild replays MSG_CHAINING events through the batch
      // ingestState path — it must NOT feed `lastOpponentActivation` (the
      // bubble is driven exclusively by the live `notifyGameLog` path).
      const states: PreComputedState[] = [
        state([chaining(1, 5002, 'Effet adverse', 'B')], 1),
      ];

      service.reset();
      service.rebuildUpTo(states);

      expect(service.gameLogEntries().length).toBeGreaterThan(0);
      expect(service.lastOpponentActivation()).toBeNull();
    });

    it('clears retained tappedEvents (the perspective rebuild owns the states)', () => {
      // `rebuildUpTo` clears `tappedEvents`: after a seek the live feed
      // resumes from N, and in replay a perspective flip is rebuilt by the
      // page re-calling `rebuildUpTo` with the states — never from a stale
      // partial `tappedEvents` slice. The internal `setPerspective` rebuild
      // (which re-feeds `tappedEvents`) therefore finds it empty.
      const states: PreComputedState[] = [
        state([draw(0, [1001])], 1),
        state([draw(0, [1002])], 1),
      ];
      service.reset();
      service.rebuildUpTo(states);
      expect(service.gameLogEntries().length).toBeGreaterThan(0);

      // The page (replay-page) is responsible for re-feeding the states on a
      // perspective flip — calling rebuildUpTo again restores the journal.
      service.setPerspective(1);
      service.rebuildUpTo(states);
      expect(service.gameLogEntries().length).toBeGreaterThan(0);
    });
  });

  // ── injectDevChaining (Lot 3d — dev-hub effect-bubble trigger) ──────────────
  describe('injectDevChaining', () => {
    it('feeds the bubble without adding a journal row', () => {
      service.injectDevChaining(chaining(1, 9001, 'Effet dev', 'Texte dev'));

      // The bubble feed fires…
      expect(service.lastOpponentActivation()).toEqual({
        cardCode: 9001,
        cardName: 'Effet dev',
        descriptionText: 'Texte dev',
      });
      // …but the journal stays empty — a dev event must not pollute it.
      expect(service.gameLogEntries()).toEqual([]);
    });

    it('does not show the bubble for a self activation', () => {
      // player 0 = the viewer under perspective 0 — opponent-only filter
      // must suppress the bubble.
      service.injectDevChaining(chaining(0, 9002, 'Mon effet dev', 'X'));
      expect(service.lastOpponentActivation()).toBeNull();
      expect(service.gameLogEntries()).toEqual([]);
    });

    it('honours last-wins across a burst', () => {
      service.injectDevChaining([
        chaining(1, 9101, 'Link 1', 'A'),
        chaining(1, 9102, 'Link 2', 'B'),
        chaining(1, 9103, 'Link 3', 'C'),
      ]);
      expect(service.lastOpponentActivation()?.cardCode).toBe(9103);
      expect(service.gameLogEntries()).toEqual([]);
    });

    it('does not retain dev events for a perspective-flip rebuild', () => {
      service.notifyGameLog(draw(0, [1001]));
      const realEntries = service.gameLogEntries().length;
      service.injectDevChaining(chaining(1, 9201, 'Effet dev', 'X'));

      // Flipping perspective rebuilds from retained events — the dev event
      // was never retained, so the rebuilt journal matches the real one.
      service.setPerspective(1);
      expect(service.gameLogEntries().length).toBe(realEntries);
    });
  });
});
