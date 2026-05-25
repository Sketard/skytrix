// =============================================================================
// game-log-builder.ts — the pure Game Log builder (reusable production brick)
// -----------------------------------------------------------------------------
// Walks a precomputed event stream and emits GameLogEntry[] following the
// five-block grammar of the game-log chantier (§4.2):
//   1 separators · 2 move rows · 3 RNG rows · 4 combat rows · 5 action rows
//
// PURITY CONTRACT: this module imports ONLY protocol types. No replay-*, no
// duel-worker, no `ws`, no `fs`/`net`, no browser API. Input in, entries out.
// The CLI (impure) resolves effect descriptions and feeds them in.
//
// SYNC: byte-synced with duel-server/src/game-log/game-log-builder.ts via
// scripts/check-ws-protocol-sync.mjs (modulo `.js` import suffix). Update BOTH
// copies in the same commit.
// =============================================================================

import type {
  Player,
  BoardStatePayload,
  ZoneId,
  CardInfo,
} from '../duel-ws-shared.types';
import { LOCATION, POSITION } from '../duel-ws-shared.types';
import type { PreComputedState } from '../duel-ws-replay.types';
import type {
  ServerMessage,
} from '../duel-ws.types';
import type {
  GameLogEntry,
  LogCardRef,
  LpLoss,
  MovedCard,
  BoardCell,
  RelPlayer,
  RowHead,
  MoveEntry,
  PostureKind,
} from './game-log-types';

// -----------------------------------------------------------------------------
// MSG_MOVE `reason` bitmask — mirrors replay-precompute.ts (kept local to
// preserve purity; values are OCGCore card_data.h reason flags).
// -----------------------------------------------------------------------------
const REASON_RELEASE = 0x2;
const REASON_FUSION = 0x8;
const REASON_RITUAL = 0x10;
const REASON_SYNCHRO = 0x20;
const REASON_XYZ = 0x40;
const REASON_LINK = 0x80;
const REASON_DISCARD = 0x400;
const REASON_SUMMON = 0x800;
const REASON_SPSUMMON = 0x1000;
const REASON_MATERIAL = 0x10000;

const EXTRA_DECK_SUMMON =
  REASON_FUSION | REASON_SYNCHRO | REASON_XYZ | REASON_LINK;

/**
 * A card candidate from a `SELECT_CARD` prompt — the secondary source for
 * resolving `MSG_BECOME_TARGET` identities. Subset of `CardInfo`: the fields
 * needed to match a targeted field position to a named card.
 */
interface TargetCandidate {
  cardCode: number;
  name: string;
  player: Player;
  location: number;
  sequence: number;
}

/** Telemetry on how well `MSG_BECOME_TARGET` identities resolved. */
export interface TargetResolutionStats {
  total: number;
  unresolved: number;
}

// -----------------------------------------------------------------------------
// LOCATION bitmask → board ZoneId(s). Used to resolve a card identity from a
// board snapshot by (location, sequence) for events that carry only a field
// position (MSG_BECOME_TARGET, …). MZONE/SZONE map to the ordered list of
// physical zones; the `sequence` selects within it for piles, index 0 for
// field zones.
// -----------------------------------------------------------------------------
const LOCATION_TO_ZONE_IDS: Readonly<Record<number, readonly ZoneId[]>> = {
  [LOCATION.MZONE]: ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'],
  [LOCATION.SZONE]: ['S1', 'S2', 'S3', 'S4', 'S5', 'FIELD'],
  [LOCATION.GRAVE]: ['GY'],
  [LOCATION.BANISHED]: ['BANISHED'],
  [LOCATION.EXTRA]: ['EXTRA'],
  [LOCATION.DECK]: ['DECK'],
  [LOCATION.HAND]: ['HAND'],
};

/** Pile zones index their `cards` array by sequence; field zones hold one. */
const PILE_ZONE_IDS: ReadonlySet<ZoneId> = new Set<ZoneId>([
  'GY',
  'BANISHED',
  'EXTRA',
  'DECK',
  'HAND',
]);

function isPileZone(zoneId: ZoneId): boolean {
  return PILE_ZONE_IDS.has(zoneId);
}

/** SZONE sequence reserved for the single Field Spell zone (out of the
 *  5-slot spell/trap row 0..4). */
const FIELD_SPELL_SEQUENCE = 5;

/**
 * Resolves a `MSG_CHAINING.description` code to its effect text.
 *
 * The argument is the raw `description` CODE from the chaining event — NOT
 * the per-chain `chainIndex` (which resets to 0 every chain and would collide
 * across chains). The CLI backs this with a cards.cdb lookup, keeping the
 * builder free of any database dependency.
 */
export type DescriptionResolver = (descriptionCode: number) => string;

/**
 * Resolves a card code to its name. Optional — used to name cards that arrive
 * code-only (notably `MSG_DRAW`, which carries no `cardName`). Injected so the
 * builder stays free of any card-database dependency.
 */
export type CardNameResolver = (cardCode: number) => string | null;

/** Input to the builder. */
export interface BuildInput {
  states: PreComputedState[];
  /** The absolute player index the log is rendered FROM (the viewer). */
  perspective: Player;
  /** Resolves a chaining `description` code to its effect text. Optional. */
  resolveDescription?: DescriptionResolver;
  /** Resolves a card code to its name (for code-only events). Optional. */
  resolveCardName?: CardNameResolver;
}

// =============================================================================
// i18n key vocabulary (O9 — the builder is LANGUAGE-AGNOSTIC)
// -----------------------------------------------------------------------------
// The builder emits STABLE i18n keys, never French strings. The Angular
// component (future lots) translates them; EN comes free. The CLI's dev
// renderers translate via `game-log-fr-strings.ts`'s `KEY_TO_FR` table. The
// keys here mirror the `gameLog.*` namespace the front-end's i18n bundle uses.
// =============================================================================
const VERB = {
  draw: 'gameLog.verb.draw',
  add: 'gameLog.verb.add',
  discard: 'gameLog.verb.discard',
  sendGy: 'gameLog.verb.sendGy',
  banish: 'gameLog.verb.banish',
  returnDeck: 'gameLog.verb.returnDeck',
  returnHand: 'gameLog.verb.returnHand',
  returnExtra: 'gameLog.verb.returnExtra',
  normalSummon: 'gameLog.verb.normalSummon',
  specialSummon: 'gameLog.verb.specialSummon',
  fusionSummon: 'gameLog.verb.fusionSummon',
  ritualSummon: 'gameLog.verb.ritualSummon',
  synchroSummon: 'gameLog.verb.synchroSummon',
  xyzSummon: 'gameLog.verb.xyzSummon',
  linkSummon: 'gameLog.verb.linkSummon',
  set: 'gameLog.verb.set',
  flip: 'gameLog.verb.flip',
  attach: 'gameLog.verb.attach',
  move: 'gameLog.verb.move',
  tribute: 'gameLog.verb.tribute',
  material: 'gameLog.verb.material',
  changePos: 'gameLog.verb.changePos',
} as const;

// OCGCore phase token → i18n key. Several Battle-Phase tokens fold to the same
// key on purpose: a phase separator only emits on a KEY change, so the whole
// Battle Phase yields one separator (the pre-O9 behaviour, key-based now).
const PHASE_LABEL: Record<string, string> = {
  DRAW: 'gameLog.phase.draw',
  STANDBY: 'gameLog.phase.standby',
  MAIN1: 'gameLog.phase.main1',
  BATTLE_START: 'gameLog.phase.battle',
  BATTLE_STEP: 'gameLog.phase.battle',
  DAMAGE: 'gameLog.phase.battle',
  DAMAGE_CALC: 'gameLog.phase.battle',
  BATTLE: 'gameLog.phase.battle',
  MAIN2: 'gameLog.phase.main2',
  END: 'gameLog.phase.end',
};

// MSG_WIN reason code → i18n key — OCGCore win-reason enum (subset that matters).
const WIN_REASON: Record<number, string> = {
  0: 'gameLog.winReason.lpZero',
  1: 'gameLog.winReason.deckOut',
  2: 'gameLog.winReason.exodia',
  3: 'gameLog.winReason.surrender',
  4: 'gameLog.winReason.timeout',
};

// Separator label keys — the key-pure separator kinds (phase / chain-*).
const SEPARATOR_KEY = {
  chainStart: 'gameLog.separator.chainStart',
  chainResolve: 'gameLog.separator.chainResolve',
  chainEnd: 'gameLog.separator.chainEnd',
} as const;

// Zone tag keys — the short source/destination labels of a move-row flow
// (`MovedCard.fromZone` / `destZone`).
const ZONE_KEY = {
  deck: 'gameLog.zone.deck',
  hand: 'gameLog.zone.hand',
  monster: 'gameLog.zone.monster',
  spellTrap: 'gameLog.zone.spellTrap',
  grave: 'gameLog.zone.grave',
  banished: 'gameLog.zone.banished',
  extra: 'gameLog.zone.extra',
  overlay: 'gameLog.zone.overlay',
  field: 'gameLog.zone.field',
} as const;

// Action-row label keys (`ActionEntry.labelKey`).
const ACTION_KEY = {
  equip: 'gameLog.action.equip',
  counter: 'gameLog.action.counter',
  gyDeckSwap: 'gameLog.action.gyDeckSwap',
  shuffleHand: 'gameLog.action.shuffleHand',
  shuffleDeck: 'gameLog.action.shuffleDeck',
  shuffleSetCard: 'gameLog.action.shuffleSetCard',
  swap: 'gameLog.action.swap',
} as const;

// Combat label / placeholder keys and RNG result-token keys. The combat
// attacker/defender placeholders fill `LogCardRef.cardName` — the builder has
// no field position to resolve a real identity, so it emits a key.
const COMBAT_KEY = {
  directAttack: 'gameLog.combat.directAttack',
  attacker: 'gameLog.combat.attacker',
  defender: 'gameLog.combat.defender',
  equippedMonster: 'gameLog.combat.equippedMonster',
} as const;

const RNG_KEY = {
  heads: 'gameLog.rng.heads',
  tails: 'gameLog.rng.tails',
} as const;

// =============================================================================
// Builder
// =============================================================================

/**
 * Build the game log from a precomputed replay state stream.
 *
 * @param input states + viewer perspective + optional description resolver
 * @returns the ordered GameLogEntry[] (five-block grammar)
 */
export function buildGameLog(input: BuildInput): GameLogEntry[] {
  return buildGameLogWithStats(input).entries;
}

/** Result of a build — the log entries plus target-resolution telemetry. */
export interface GameLogBuildResult {
  entries: GameLogEntry[];
  targetStats: TargetResolutionStats;
}

/** Build the game log AND return target-resolution telemetry — the CLI uses
 *  the stats to report how many `MSG_BECOME_TARGET` identities resolved. */
export function buildGameLogWithStats(input: BuildInput): GameLogBuildResult {
  const builder = new GameLogBuilder(
    input.perspective,
    input.resolveDescription,
    input.resolveCardName,
  );
  for (const state of input.states) {
    builder.ingestState(state);
  }
  builder.finish();
  return {
    entries: builder.entries,
    targetStats: builder.getTargetResolutionStats(),
  };
}

/**
 * Stateful walker. One instance per build. Exposed (not just `buildGameLog`)
 * so the future DuelGameLogService can drive it incrementally event-by-event.
 */
export class GameLogBuilder {
  readonly entries: GameLogEntry[] = [];

  private lastTurnCount = -1;
  private lastPhase: string | null = null;
  /** Activation rows of the current chain, keyed by their `chainIndex`. */
  private readonly chainRows = new Map<number, MoveEntry>();
  /** Resolution rows of the current chain, keyed by the resolving link's
   *  `chainIndex` — emitted once per link as it resolves. */
  private readonly resolutionRows = new Map<number, MoveEntry>();
  private chainOpen = false;
  /**
   * The `chainIndex` of the link currently RESOLVING, or `null` while the
   * chain is still BUILDING (before the first MSG_CHAIN_SOLVING). Chains
   * resolve last-link-first, so this is NOT monotonic.
   */
  private resolvingLink: number | null = null;
  /**
   * Pending MSG_CHAIN_NEGATED that arrived before the matching activation
   * row existed. Consumed (and cleared) when `onChaining` creates the row.
   */
  private readonly pendingNegations = new Set<number>();
  private currentTurn = 0;
  /**
   * True once the duel has advanced past its opening setup window (turnCount
   * has reached 2). Opening-hand draws only occur during the setup turn
   * (turnCount 0 or 1); once this flips, a 5+ card draw can only be an
   * effect draw. Combined with `!chainOpen`, a draw inside a chain is NEVER
   * an opening hand — robust to a one-sided opening draw (no per-count flag).
   */
  private openingWindowClosed = false;
  /**
   * The most recent `SELECT_CARD` candidate list — the secondary source for
   * resolving `MSG_BECOME_TARGET` identities when the board snapshot has
   * already lost the card (a SELECT_CARD immediately precedes the targeting).
   */
  private lastSelectCardCandidates: readonly TargetCandidate[] = [];
  /** Target-resolution telemetry — total targets seen and how many stayed
   *  unresolved (for the human to judge the fallback policy). */
  private targetTotal = 0;
  private targetUnresolved = 0;

  constructor(
    private readonly perspective: Player,
    private readonly resolveDescription?: DescriptionResolver,
    private readonly resolveCardName?: CardNameResolver,
  ) {}

  /**
   * Ingest one precomputed state: its board snapshot then its events.
   * Thin batch wrapper over the public incremental API (`syncTurnAndPhase`
   * + `ingestEvent`) — the CLI and the spec drive the builder through this;
   * the live `DuelGameLogService` drives the two finer methods directly.
   */
  ingestState(state: PreComputedState): void {
    this.syncTurnAndPhase(state.boardState);
    for (const event of state.events) {
      this.ingestEvent(event, state.boardState);
    }
  }

  /** Flush anything pending. Currently a no-op; kept for the incremental API. */
  finish(): void {
    /* nothing buffered across states in the current grammar */
  }

  /**
   * Pre-load `entries` from a server-built snapshot (the STATE_SYNC restore
   * path) and seed internal turn/phase trackers so the next live event does
   * not re-emit duplicate separators.
   *
   * Two effects:
   *  - Copies the snapshot rows into `this.entries` so subsequent ingest
   *    paths append to the full history (callers read `[...builder.entries]`
   *    after each ingest; without this copy the snapshot would be lost the
   *    moment the first live event lands).
   *  - Scans the snapshot right-to-left for the most recent turn separator
   *    and the most recent phase separator, fixing `lastTurnCount` +
   *    `lastPhase` so `syncTurnAndPhase` no-ops on the next equal board.
   *
   * Chain state is intentionally NOT seeded — a snapshot taken mid-chain is
   * rare (STATE_SYNC happens at stable boundaries) and the chain processor's
   * `restoreChainState` is the authoritative path for that.
   */
  seedFromSnapshot(entries: readonly GameLogEntry[]): void {
    this.entries.push(...entries);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.block !== 'separator') continue;
      if (e.kind === 'turn' && this.lastTurnCount < 0) {
        this.lastTurnCount = e.turnNumber ?? 0;
        this.currentTurn = this.lastTurnCount;
        if (this.lastTurnCount >= 2) this.openingWindowClosed = true;
      }
      if (e.kind === 'phase' && this.lastPhase === null) {
        this.lastPhase = e.labelKey ?? null;
      }
      if (this.lastTurnCount >= 0 && this.lastPhase !== null) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Turn / phase separator synthesis (§5.5 — derived from board-state deltas)
  // ---------------------------------------------------------------------------
  /**
   * Synthesise turn/phase separators from a board snapshot delta. Public for
   * the incremental live feed — the driver must call this with the current
   * board snapshot BEFORE `ingestEvent` for the events of that snapshot
   * (the ordering contract — see game-log-integration-analysis.md §1.2).
   * No-ops when turn and phase are unchanged.
   */
  syncTurnAndPhase(board: BoardStatePayload): void {
    if (board.turnCount !== this.lastTurnCount) {
      this.lastTurnCount = board.turnCount;
      this.currentTurn = board.turnCount;
      // The opening window covers the setup turn only (turnCount 0 or 1).
      // Once turnCount reaches 2, no further draw can be an opening hand.
      if (board.turnCount >= 2) this.openingWindowClosed = true;
      this.entries.push({
        block: 'separator',
        kind: 'turn',
        // O9 — STRUCTURED kind: no pre-composed `label`. "Tour N" needs the
        // turn number interpolated, which a pure i18n key cannot do — the
        // renderer composes it from a fixed key + `turnNumber`.
        turnNumber: board.turnCount,
        // O5 / C2 contract: the board snapshot is ALREADY relative-to-viewer
        // (`players[0]` = "you"). The builder never swaps it — `players[]` is
        // read verbatim. See game-log-integration-analysis.md §4.3.
        lp: [board.players[0].lp, board.players[1].lp],
      });
      // A new turn invalidates any unclosed chain bookkeeping (H3): a chain
      // never legitimately straddles a turn boundary, and stale chain state
      // would mis-route the next turn's moves into a dead activation row.
      this.lastPhase = null;
      this.resetChainState();
    }
    // O9 — key-pure kind: `phaseKey` IS the i18n key. An unmapped OCGCore
    // phase token passes through as its own key (loud fallback in `frString`).
    // Dedup on the key, so the whole Battle Phase still yields one separator.
    const phaseKey = PHASE_LABEL[board.phase] ?? board.phase;
    if (phaseKey !== this.lastPhase) {
      this.lastPhase = phaseKey;
      this.entries.push({
        block: 'separator',
        kind: 'phase',
        labelKey: phaseKey,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Event dispatch
  // ---------------------------------------------------------------------------
  /**
   * Ingest one event against a board snapshot. Public for the incremental
   * live feed — the `board` is the viewer-relative snapshot the event was
   * dispatched against (the live driver's `logicalState()`); it is only
   * read by the `MSG_BECOME_TARGET` path to resolve targeted field cells.
   * Call `syncTurnAndPhase` first to honour the ordering contract (§1.2).
   */
  ingestEvent(event: ServerMessage, board: BoardStatePayload): void {
    switch (event.type) {
      case 'MSG_DRAW':
        this.onDraw(event);
        break;
      case 'MSG_MOVE':
        this.onMove(event);
        break;
      case 'MSG_SET':
        this.onSet(event);
        break;
      case 'MSG_FLIP_SUMMONING':
        this.onFlip(event);
        break;
      case 'MSG_CHANGE_POS':
        this.onChangePos(event);
        break;
      case 'MSG_CHAINING':
        this.onChaining(event);
        break;
      case 'MSG_CHAIN_SOLVING':
        this.onChainSolving(event);
        break;
      case 'MSG_CHAIN_SOLVED':
        this.onChainSolved(event);
        break;
      case 'MSG_CHAIN_END':
        this.onChainEnd();
        break;
      case 'MSG_CHAIN_NEGATED':
        this.markNegated(event.chainIndex);
        break;
      case 'MSG_TOSS_COIN':
        this.onCoin(event);
        break;
      case 'MSG_TOSS_DICE':
        this.onDice(event);
        break;
      case 'MSG_ATTACK':
        this.onAttack(event);
        break;
      case 'MSG_BATTLE':
        this.onBattle(event);
        break;
      case 'MSG_EQUIP':
        this.onEquip(event);
        break;
      case 'MSG_ADD_COUNTER':
        this.onCounter(event, true);
        break;
      case 'MSG_REMOVE_COUNTER':
        this.onCounter(event, false);
        break;
      case 'MSG_BECOME_TARGET':
        this.onBecomeTarget(event, board);
        break;
      case 'MSG_SWAP_GRAVE_DECK':
        this.onGyDeckSwap(event);
        break;
      case 'MSG_SHUFFLE_HAND':
        this.onShuffle(event.player, 'hand');
        break;
      case 'MSG_SHUFFLE_DECK':
        this.onShuffle(event.player, 'deck');
        break;
      case 'MSG_SWAP':
        this.onSwap(event);
        break;
      case 'MSG_SHUFFLE_SET_CARD':
        this.onShuffleSetCard(event);
        break;
      case 'MSG_WIN':
        this.onWin(event);
        break;
      // Not a log row itself, but its candidate list is the secondary
      // source for resolving the MSG_BECOME_TARGET that immediately follows.
      case 'SELECT_CARD':
        this.lastSelectCardCandidates = event.cards;
        break;
      // Silent events — no log row (per §4.3 audit + O1).
      case 'MSG_DAMAGE':
      case 'MSG_RECOVER':
      case 'MSG_PAY_LPCOST':
      case 'MSG_CONFIRM_CARDS':
      case 'MSG_HINT':
      case 'BOARD_STATE':
        break;
      default:
        /* prompts, system, solver — not game-log events */
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Move rows
  // ---------------------------------------------------------------------------
  private onDraw(e: { player: Player; cards: (number | null)[] }): void {
    // The opening 5-card draws become the initial-hand rows. Robust guard
    // (finding #5): an opening hand can ONLY occur in the setup window
    // (turnCount 0 or 1) AND never inside a chain. There is no per-count
    // "both players drew" flag, so a one-sided opening draw can't leave the
    // builder stuck mis-classifying later 5+ card effect draws — once the
    // window closes (turnCount 2) this branch is dead.
    if (
      !this.openingWindowClosed &&
      this.currentTurn <= 1 &&
      !this.chainOpen &&
      e.cards.length >= 5
    ) {
      this.entries.push({
        block: 'move',
        variant: 'initial-hand',
        ...this.headlessRowHead(e.player),
        movedCards: e.cards.map(code => ({
          card: this.cardRef(code, null),
          verb: VERB.draw,
        })),
      });
      return;
    }
    // A draw with no active chain is the mandatory Draw-Phase draw: no head.
    if (!this.chainOpen) {
      this.entries.push({
        block: 'move',
        variant: 'draw-phase',
        ...this.headlessRowHead(e.player),
        movedCards: e.cards.map(code => ({
          card: this.cardRef(code, null),
          verb: VERB.draw,
          destZone: ZONE_KEY.hand,
        })),
      });
      return;
    }
    // An effect-driven draw inside a chain attaches to the contextually
    // correct row: the building activation row or the resolving link's row.
    const row = this.activeChainRow();
    if (row) {
      for (const code of e.cards) {
        row.movedCards.push({
          card: this.cardRef(code, null),
          verb: VERB.draw,
          destZone: ZONE_KEY.hand,
        });
      }
    }
  }

  private onMove(e: {
    cardCode: number;
    cardName: string;
    player: Player;
    toPlayer: Player;
    fromLocation: number;
    toLocation: number;
    toSequence: number;
    reason: number;
  }): void {
    const moved = this.describeMove(e);
    const row = this.chainOpen ? this.activeChainRow() : null;
    if (row) {
      row.movedCards.push(moved);
      return;
    }
    // Standalone move (outside a chain) — its own headless-ish move row using
    // the moved card as the visible subject.
    this.entries.push({
      block: 'move',
      ...this.rowHead(e.player, null, null),
      movedCards: [moved],
    });
  }

  /** Decode a MSG_MOVE into a MovedCard (verb + origin + destination). */
  private describeMove(e: {
    cardCode: number;
    cardName: string;
    player: Player;
    toPlayer: Player;
    fromLocation: number;
    toLocation: number;
    toSequence: number;
    reason: number;
  }): MovedCard {
    const card = this.cardRef(e.cardCode, e.cardName);
    const { reason, toLocation, fromLocation, toPlayer, toSequence } = e;
    // Origin label — MSG_MOVE carries `fromLocation` (the category, not a
    // sequence) so a field origin collapses to its row tag. Drawn by the
    // bare-row renderer as the `source` half of a `source → dest` flow.
    const fromZone = zoneLabel(fromLocation);

    if (toLocation === LOCATION.MZONE) {
      // A summon that lands while a chain is RESOLVING is always a Special
      // Summon — a Normal Summon can never occur mid-chain. OCGCore reuses
      // the `REASON_SUMMON` bit (0x800) for "Special Summon in attack
      // position", so the `reason` bitmask alone mislabels it; the chain
      // phase is the authoritative signal.
      const verb = summonVerb(reason, this.resolvingLink !== null);
      return {
        card,
        verb,
        fromZone,
        destCell: this.fieldCell(toPlayer, 'M', toSequence),
        isMaterial: false,
      };
    }
    if (toLocation === LOCATION.SZONE) {
      return { card, verb: VERB.set, fromZone, destCell: this.fieldCell(toPlayer, 'S', toSequence) };
    }
    if (toLocation === LOCATION.OVERLAY) {
      return { card, verb: VERB.attach, fromZone, destZone: ZONE_KEY.overlay, isMaterial: true };
    }
    if (toLocation === LOCATION.GRAVE) {
      const verb =
        reason & REASON_MATERIAL ? VERB.material
        : reason & REASON_DISCARD ? VERB.discard
        : reason & REASON_RELEASE ? VERB.tribute
        : VERB.sendGy;
      return { card, verb, fromZone, destZone: ZONE_KEY.grave, isMaterial: !!(reason & REASON_MATERIAL) };
    }
    if (toLocation === LOCATION.BANISHED) {
      return { card, verb: VERB.banish, fromZone, destZone: ZONE_KEY.banished };
    }
    if (toLocation === LOCATION.HAND) {
      return {
        card,
        verb: fromLocation === LOCATION.DECK ? VERB.add : VERB.returnHand,
        fromZone,
        destZone: ZONE_KEY.hand,
      };
    }
    if (toLocation === LOCATION.DECK) {
      return { card, verb: VERB.returnDeck, fromZone, destZone: ZONE_KEY.deck };
    }
    if (toLocation === LOCATION.EXTRA) {
      // Pendulum monster destroyed from the field, Fusion returning, etc.
      return { card, verb: VERB.returnExtra, fromZone, destZone: ZONE_KEY.extra };
    }
    return { card, verb: VERB.move, fromZone, destZone: ZONE_KEY.field };
  }

  private onSet(e: {
    cardCode: number;
    cardName: string;
    player: Player;
    sequence: number;
  }): void {
    this.entries.push({
      block: 'move',
      ...this.rowHead(e.player, null, null),
      movedCards: [
        {
          // A Set is face-down — the card is intentionally hidden.
          card: { revealed: false, cardCode: null, cardName: null },
          verb: VERB.set,
          destCell: this.fieldCell(e.player, 'S', e.sequence),
        },
      ],
    });
  }

  private onFlip(e: {
    cardCode: number;
    cardName: string;
    player: Player;
    sequence: number;
  }): void {
    this.entries.push({
      block: 'move',
      ...this.rowHead(e.player, this.cardRef(e.cardCode, e.cardName), null),
      movedCards: [
        {
          card: this.cardRef(e.cardCode, e.cardName),
          verb: VERB.flip,
          destCell: this.fieldCell(e.player, 'M', e.sequence),
        },
      ],
    });
  }

  private onChangePos(e: {
    cardCode: number;
    cardName: string;
    player: Player;
    previousPosition: number;
    currentPosition: number;
  }): void {
    // Position change → a move row carrying a structured posture transition,
    // so the renderer can give ATK and DEF their distinct visual identity.
    this.entries.push({
      block: 'move',
      ...this.rowHead(e.player, this.cardRef(e.cardCode, e.cardName), null),
      movedCards: [
        {
          card: this.cardRef(e.cardCode, e.cardName),
          verb: VERB.changePos,
          posChange: {
            from: postureKind(e.previousPosition),
            to: postureKind(e.currentPosition),
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Chain handling
  // ---------------------------------------------------------------------------
  private onChaining(e: {
    cardCode: number;
    cardName: string;
    player: Player;
    chainIndex: number;
    description: number;
    /** Effect text resolved server-side (`duel-worker` via `resolveDescription`).
     *  Present on live PvP + replay payloads — the ONLY description source the
     *  browser has (it carries no cards.cdb). Absent on legacy payloads. */
    descriptionText?: string;
  }): void {
    if (!this.chainOpen) {
      this.chainOpen = true;
      this.resetChainState(/* keepOpen */ true);
      this.entries.push({
        block: 'separator',
        kind: 'chain-start',
        labelKey: SEPARATOR_KEY.chainStart,
      });
    }
    // Prefer the server-resolved `descriptionText` — it is present on every
    // live PvP + replay payload and is the only text the browser can show
    // (no cards.cdb client-side). `resolveDescription` is the CLI-only
    // fallback: that path injects a cards.cdb-backed resolver for the raw
    // `description` CODE (not chainIndex, which collides across chains).
    const description =
      e.descriptionText || this.resolveDescription?.(e.description) || '';
    const row: MoveEntry = {
      block: 'move',
      ...this.rowHead(e.player, this.cardRef(e.cardCode, e.cardName), description),
      chainLink: e.chainIndex + 1,
      movedCards: [],
    };
    // Apply a negation that arrived before this row existed.
    if (this.pendingNegations.delete(e.chainIndex)) {
      row.negated = true;
    }
    this.chainRows.set(e.chainIndex, row);
    this.entries.push(row);
  }

  private onChainSolving(e: { chainIndex: number }): void {
    if (!this.chainOpen) return;
    this.resolvingLink = e.chainIndex;
    // First link to resolve gets the "Résolution de la chaîne" separator;
    // every resolving link gets its own resolution row.
    if (this.resolutionRows.size === 0) {
      this.entries.push({
        block: 'separator',
        kind: 'chain-resolve',
        labelKey: SEPARATOR_KEY.chainResolve,
      });
    }
    this.emitResolutionRow(e.chainIndex);
  }

  private onChainSolved(_e: { chainIndex: number }): void {
    // The resolution row is emitted at MSG_CHAIN_SOLVING and stays the active
    // attach target until the next link starts solving. Nothing to do here —
    // kept explicit (not in the silent set) for clarity of the state machine.
  }

  private onChainEnd(): void {
    if (!this.chainOpen) return;
    this.entries.push({
      block: 'separator',
      kind: 'chain-end',
      labelKey: SEPARATOR_KEY.chainEnd,
    });
    this.resetChainState();
  }

  /**
   * Emit a resolution row for the link that just started resolving. It reuses
   * the activating card's source + description, carries the same `chainLink`
   * badge, and becomes the attach target for any effect events that fire
   * during this link's resolution.
   */
  private emitResolutionRow(chainIndex: number): void {
    if (this.resolutionRows.has(chainIndex)) return;
    const activation = this.chainRows.get(chainIndex);
    const row: MoveEntry = {
      block: 'move',
      player: activation?.player ?? this.rel(this.perspective),
      turnNumber: this.currentTurn,
      source: activation?.source ?? null,
      description: activation?.description ?? null,
      chainLink: chainIndex + 1,
      negated: activation?.negated,
      movedCards: [],
      variant: undefined,
    };
    this.resolutionRows.set(chainIndex, row);
    this.entries.push(row);
  }

  private markNegated(chainIndex: number): void {
    const row = this.chainRows.get(chainIndex);
    if (row) {
      row.negated = true;
      const resolution = this.resolutionRows.get(chainIndex);
      if (resolution) resolution.negated = true;
    } else {
      // Row not built yet — remember and apply it in `onChaining`.
      this.pendingNegations.add(chainIndex);
    }
  }

  /**
   * The chain row that effect events (MSG_MOVE / MSG_DRAW) should attach to.
   * BUILDING phase (no link resolving yet) → the most-recent activation row.
   * RESOLVING phase → the currently-resolving link's resolution row.
   */
  private activeChainRow(): MoveEntry | null {
    if (this.resolvingLink !== null) {
      return this.resolutionRows.get(this.resolvingLink) ?? null;
    }
    return this.mostRecentActivationRow();
  }

  /** The activation row with the highest `chainIndex` (last to activate). */
  private mostRecentActivationRow(): MoveEntry | null {
    let best: MoveEntry | null = null;
    let bestIndex = -1;
    for (const [index, row] of this.chainRows) {
      if (index > bestIndex) {
        bestIndex = index;
        best = row;
      }
    }
    return best;
  }

  /** Reset all per-chain bookkeeping. `keepOpen` retains the open flag (used
   *  when a fresh chain is starting and we only want clean maps). */
  private resetChainState(keepOpen = false): void {
    this.chainOpen = keepOpen;
    this.chainRows.clear();
    this.resolutionRows.clear();
    this.pendingNegations.clear();
    this.resolvingLink = null;
  }

  // ---------------------------------------------------------------------------
  // RNG rows
  // ---------------------------------------------------------------------------
  private onCoin(e: { player: Player; results: boolean[] }): void {
    this.entries.push({
      block: 'rng',
      ...this.rowHead(e.player, null, null),
      rng: 'coin',
      // O9 — heads/tails are emitted as i18n keys; the renderer translates.
      results: e.results.map(r => (r ? RNG_KEY.heads : RNG_KEY.tails)),
    });
  }

  private onDice(e: { player: Player; results: number[] }): void {
    this.entries.push({
      block: 'rng',
      ...this.rowHead(e.player, null, null),
      rng: 'dice',
      results: e.results.map(String),
    });
  }

  // ---------------------------------------------------------------------------
  // Combat rows
  // ---------------------------------------------------------------------------
  private onAttack(e: {
    attackerPlayer: Player;
    attackerSequence: number;
    defenderPlayer: Player | null;
    defenderSequence: number | null;
  }): void {
    const direct = e.defenderPlayer === null;
    this.entries.push({
      block: 'combat',
      ...this.rowHead(e.attackerPlayer, null, null),
      combat: 'attack',
      // The attacker/defender placeholders are i18n keys — MSG_ATTACK carries
      // only a field position, no `cardCode`, so the builder cannot name them.
      attacker: {
        card: { revealed: true, cardCode: null, cardName: COMBAT_KEY.attacker },
      },
      defender: direct
        ? undefined
        : { card: { revealed: true, cardCode: null, cardName: COMBAT_KEY.defender } },
      // The renderer supplies the visual arrow/icon — the label is an i18n key.
      directLabel: direct ? COMBAT_KEY.directAttack : undefined,
    });
  }

  private onBattle(e: {
    attackerPlayer: Player;
    attackerDamage: number;
    defenderPlayer: Player;
    defenderDamage: number;
  }): void {
    // LP loss is a dedicated structured field — one entry per player who
    // actually lost LP. A 0-damage battle yields an empty list and the
    // renderer shows nothing. Players are relativized for the viewer.
    const lpLoss: LpLoss[] = [];
    if (e.attackerDamage > 0) {
      lpLoss.push({ player: this.rel(e.attackerPlayer), amount: e.attackerDamage });
    }
    if (e.defenderDamage > 0) {
      lpLoss.push({ player: this.rel(e.defenderPlayer), amount: e.defenderDamage });
    }
    this.entries.push({
      block: 'combat',
      ...this.rowHead(e.attackerPlayer, null, null),
      combat: 'battle',
      // i18n-key placeholders — MSG_BATTLE carries no `cardCode` for the
      // combatants.
      attacker: { card: { revealed: true, cardCode: null, cardName: COMBAT_KEY.attacker } },
      defender: { card: { revealed: true, cardCode: null, cardName: COMBAT_KEY.defender } },
      lpLoss,
    });
  }

  // ---------------------------------------------------------------------------
  // Action rows
  // ---------------------------------------------------------------------------
  private onEquip(e: { equipPlayer: Player }): void {
    this.entries.push({
      block: 'action',
      ...this.rowHead(e.equipPlayer, null, null),
      action: 'equip',
      labelKey: ACTION_KEY.equip,
      equipTargets: [
        { revealed: true, cardCode: null, cardName: COMBAT_KEY.equippedMonster },
      ],
    });
  }

  private onCounter(
    e: { player: Player; counterType: number; count: number },
    add: boolean,
  ): void {
    this.entries.push({
      block: 'action',
      ...this.rowHead(e.player, null, null),
      action: add ? 'counter-add' : 'counter-remove',
      labelKey: ACTION_KEY.counter,
      counterBadge: `${add ? '+' : '−'}${e.count}`,
      // Structured: the builder only knows the numeric counter type — the
      // renderer composes "Type {{n}}" from `gameLog.action.counterType`.
      counterType: e.counterType,
    });
  }

  /**
   * A targeting is a PROPERTY of the effect that caused it, not a standalone
   * log row. Fold the resolved target cards onto the active chain row (the
   * activation or resolution row in flight) as a `targets` annotation.
   *
   * Identity resolution runs two passes per target position:
   *   1. the state's board snapshot (`resolveBoardCard`);
   *   2. the most recent `SELECT_CARD` candidate list — it carries
   *      `cardCode` + `name` and immediately precedes the targeting.
   */
  private onBecomeTarget(
    e: { cards: { player: Player; location: number; sequence: number }[] },
    board: BoardStatePayload,
  ): void {
    const resolved = e.cards.map(c => {
      this.targetTotal++;
      // `c.player` is ABSOLUTE (MSG_BECOME_TARGET event field) — relativise
      // it before indexing the relative-to-viewer board snapshot (O5 / C2).
      const fromBoard = this.resolveBoardCard(
        board,
        this.rel(c.player),
        c.location,
        c.sequence,
      );
      if (fromBoard.revealed) return fromBoard;
      const fromSelect = this.resolveFromSelectCard(c.location, c.sequence);
      if (fromSelect) return fromSelect;
      this.targetUnresolved++;
      return { revealed: false, cardCode: null, cardName: null } as LogCardRef;
    });
    // Attach to the effect's row. If no chain row is in flight, the targeting
    // has no host — drop it silently rather than emit an orphan row.
    const row = this.activeChainRow();
    if (row) {
      row.targets = [...(row.targets ?? []), ...resolved];
    }
  }

  /** Secondary target resolution — match a field position against the last
   *  `SELECT_CARD` candidate list. Returns null when no candidate matches. */
  private resolveFromSelectCard(
    location: number,
    sequence: number,
  ): LogCardRef | null {
    const match = this.lastSelectCardCandidates.find(
      c => c.location === location && c.sequence === sequence,
    );
    return match
      ? { revealed: true, cardCode: match.cardCode, cardName: match.name }
      : null;
  }

  /** Target-resolution telemetry for the CLI to report. */
  getTargetResolutionStats(): TargetResolutionStats {
    return { total: this.targetTotal, unresolved: this.targetUnresolved };
  }

  private onGyDeckSwap(e: { player: Player }): void {
    this.entries.push({
      block: 'action',
      ...this.rowHead(e.player, null, null),
      action: 'gy-deck-swap',
      labelKey: ACTION_KEY.gyDeckSwap,
    });
  }

  /** MSG_SHUFFLE_HAND / MSG_SHUFFLE_DECK → a shuffle action row (§4.3). */
  private onShuffle(player: Player, what: 'hand' | 'deck'): void {
    this.entries.push({
      block: 'action',
      ...this.rowHead(player, null, null),
      action: 'shuffle',
      labelKey: what === 'hand' ? ACTION_KEY.shuffleHand : ACTION_KEY.shuffleDeck,
    });
  }

  /** MSG_SWAP — two cards exchange controllers/zones (§4.3). The row is
   *  attributed to the controller of `card1` (the swap initiator's card), not
   *  the viewer — an opponent-initiated control swap must render on the
   *  opponent's side. */
  private onSwap(e: { card1: CardInfo; card2: CardInfo }): void {
    this.entries.push({
      block: 'action',
      ...this.rowHead(this.rel(e.card1.player), null, null),
      action: 'swap',
      labelKey: ACTION_KEY.swap,
    });
  }

  /** MSG_SHUFFLE_SET_CARD — set Spell/Traps shuffled in place (§4.3). */
  private onShuffleSetCard(e: {
    cards: { fromPlayer: Player }[];
  }): void {
    const owner = (e.cards[0]?.fromPlayer ?? this.perspective) as Player;
    this.entries.push({
      block: 'action',
      ...this.rowHead(owner, null, null),
      action: 'shuffle',
      labelKey: ACTION_KEY.shuffleSetCard,
    });
  }

  // ---------------------------------------------------------------------------
  // Duel over
  // ---------------------------------------------------------------------------
  private onWin(e: { player: Player; reason: number }): void {
    // O9 — STRUCTURED kind: the winner line interpolates which side won, so a
    // pure key cannot carry it. Emit `winnerSide` (relative) + a `reasonKey`;
    // the renderer composes "🏆 Toi/Adversaire — Victoire" + the reason line.
    // An unmapped reason code passes through as its own key (loud fallback).
    // OCGCore emits `player === 2` for a draw (double-KO / simultaneous
    // deck-out) — `rel(2)` would resolve to side 1 and mislabel it an
    // opponent victory, so map any non-{0,1} player to `'draw'`.
    const winnerSide: RelPlayer | 'draw' =
      e.player === 0 || e.player === 1 ? this.rel(e.player) : 'draw';
    this.entries.push({
      block: 'separator',
      kind: 'duel-over',
      winnerSide,
      reasonKey: WIN_REASON[e.reason] ?? `gameLog.winReason.${e.reason}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  /**
   * Relativise an ABSOLUTE event player field (server P0/P1) for the viewer.
   * O5 / C2: this stays — `MSG_CHAINING.player`, `MSG_MOVE.player`/`toPlayer`,
   * `MSG_DRAW.player`, attack/battle players ARE absolute on both sides. Only
   * the board *snapshot* is relative and is never swapped.
   */
  private rel(absolute: Player): RelPlayer {
    return absolute === this.perspective ? 0 : 1;
  }

  private cardRef(code: number | null, name: string | null): LogCardRef {
    // OCGCore reveals identity only for public information; code 0/null = hidden.
    if (!code) return { revealed: false, cardCode: null, cardName: null };
    // Fall back to the injected name resolver when the event carried no name
    // (e.g. MSG_DRAW, which ships card codes only).
    const resolved = name ?? this.resolveCardName?.(code) ?? null;
    return { revealed: true, cardCode: code, cardName: resolved };
  }

  /**
   * Resolve a card identity from a board snapshot by `(player, location,
   * sequence)`. Events like `MSG_BECOME_TARGET` / `MSG_ATTACK` carry only a
   * field position, not a `cardCode` — the board state holds the identity.
   * Returns a hidden `LogCardRef` when the slot can't be resolved.
   *
   * O5 / C2: the board is relative-to-viewer, so `relativePlayer` MUST be a
   * RELATIVE index. Callers relativise the absolute event field via `rel()`
   * before the lookup.
   */
  private resolveBoardCard(
    board: BoardStatePayload,
    relativePlayer: RelPlayer,
    location: number,
    sequence: number,
  ): LogCardRef {
    const zoneIds = LOCATION_TO_ZONE_IDS[location];
    const player = board.players[relativePlayer];
    if (zoneIds && player) {
      const first = zoneIds[0];
      // A pile location is a single zone whose `cards` array is indexed by
      // sequence. A field location (MZONE/SZONE) is a LIST of zones — the
      // sequence selects which one, and that zone holds a single card.
      if (first && isPileZone(first)) {
        const zone = player.zones.find(z => z.zoneId === first);
        const card = zone?.cards[sequence];
        if (card?.cardCode) {
          return { revealed: true, cardCode: card.cardCode, cardName: card.name };
        }
      } else {
        const zoneId = zoneIds[sequence];
        const zone = zoneId
          ? player.zones.find(z => z.zoneId === zoneId)
          : undefined;
        const card = zone?.cards[0];
        if (card?.cardCode) {
          return { revealed: true, cardCode: card.cardCode, cardName: card.name };
        }
      }
    }
    return { revealed: false, cardCode: null, cardName: null };
  }

  private fieldCell(absolute: Player, row: 'M' | 'S', sequence: number): BoardCell {
    const player = this.rel(absolute);
    // EMZ sequences (5,6) map to the shared Extra Monster Zone band.
    if (row === 'M' && sequence >= 5) {
      return { player, row: 'EMZ', sequence: sequence - 5 };
    }
    // SZONE sequence 5 is the singleton Field Spell zone — out of the 5-slot
    // spell/trap row (0..4). Map it to the distinct 'FIELD' cell.
    if (row === 'S' && sequence >= FIELD_SPELL_SEQUENCE) {
      return { player, row: 'FIELD', sequence: 0 };
    }
    return { player, row, sequence };
  }

  private rowHead(
    absolute: Player,
    source: LogCardRef | null,
    description: string | null,
  ): RowHead {
    return {
      player: this.rel(absolute),
      turnNumber: this.currentTurn,
      source,
      description,
    };
  }

  /** Row head for rule-driven rows with no originating card (draws). */
  private headlessRowHead(absolute: Player): RowHead {
    return this.rowHead(absolute, null, null);
  }
}

// =============================================================================
// Pure local helpers
// =============================================================================

/**
 * Map a MSG_MOVE-to-MZONE `reason` bitmask to the French summon verb.
 *
 * @param reason         the OCGCore `reason` bitmask
 * @param duringChainRes true when the move lands while a chain link is
 *                       resolving — then a `REASON_SUMMON` move is really a
 *                       Special Summon (a Normal Summon never occurs
 *                       mid-chain; OCGCore reuses the 0x800 bit).
 */
function summonVerb(reason: number, duringChainRes: boolean): string {
  // Method-specific bits are unambiguous — check them first.
  if (reason & REASON_FUSION) return VERB.fusionSummon;
  if (reason & REASON_RITUAL) return VERB.ritualSummon;
  if (reason & REASON_SYNCHRO) return VERB.synchroSummon;
  if (reason & REASON_XYZ) return VERB.xyzSummon;
  if (reason & REASON_LINK) return VERB.linkSummon;
  if (reason & REASON_SPSUMMON) return VERB.specialSummon;
  if (reason & REASON_SUMMON) {
    // 0x800 mid-chain = Special Summon; otherwise a true Normal Summon.
    return duringChainRes ? VERB.specialSummon : VERB.normalSummon;
  }
  // No summon bit set at all — this is a plain relocation onto MZONE
  // (control swap, return from temporary banish), NOT a special summon.
  return VERB.move;
}

/** True when a move's reason marks an Extra-Deck summon. */
export function isExtraDeckSummon(reason: number): boolean {
  return (reason & EXTRA_DECK_SUMMON) !== 0;
}

/**
 * i18n key for a `LOCATION` bitmask value — the origin/destination zone-tag
 * vocabulary shared by the move-row renderers. A field LOCATION (MZONE/SZONE)
 * carries no sequence in `fromLocation`, so it collapses to its row tag.
 * Keys stay consistent with the `destZone` keys used in `describeMove`.
 */
function zoneLabel(location: number): string {
  switch (location) {
    case LOCATION.DECK:
      return ZONE_KEY.deck;
    case LOCATION.HAND:
      return ZONE_KEY.hand;
    case LOCATION.MZONE:
      return ZONE_KEY.monster;
    case LOCATION.SZONE:
      return ZONE_KEY.spellTrap;
    case LOCATION.GRAVE:
      return ZONE_KEY.grave;
    case LOCATION.BANISHED:
      return ZONE_KEY.banished;
    case LOCATION.EXTRA:
      return ZONE_KEY.extra;
    case LOCATION.OVERLAY:
      return ZONE_KEY.overlay;
    default:
      return ZONE_KEY.field;
  }
}

/** Battle posture (ATK / DEF) of a POSITION bitmask value — drives the
 *  ATK/DEF visual distinction. Defaults to ATK for unknown values. */
function postureKind(position: number): PostureKind {
  switch (position) {
    case POSITION.FACEUP_DEFENSE:
    case POSITION.FACEDOWN_DEFENSE:
      return 'DEF';
    default:
      return 'ATK';
  }
}
