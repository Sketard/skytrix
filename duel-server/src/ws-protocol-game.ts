// =============================================================================
// ws-protocol-game.ts — Skytrix WS protocol — game messages (server → client)
// Single source of truth for the 19 MSG_* events emitted by the duel worker.
// Sync rule: same content as front/src/app/pages/pvp/duel-ws-game.types.ts
// (modulo `.js` import suffix on the back side — the sync script normalizes
// before comparison).
// =============================================================================

import type { Player, CardLocation, Position, BoardStatePayload, CardInfo } from './ws-protocol-shared.js';

export interface BoardStateMsg {
  type: 'BOARD_STATE';
  data: BoardStatePayload;
}

export interface MoveMsg {
  type: 'MSG_MOVE';
  cardCode: number;
  cardName: string;
  /** Controller of the SOURCE location (OCGCore `from.controller`). */
  player: Player;
  /**
   * Controller of the DESTINATION location (OCGCore `to.controller`). For a
   * pile destination (GRAVE / BANISHED / EXTRA) this is the card's OWNER —
   * OCGCore routes a card to its owner's pile. The client MUST resolve the
   * destination zone key from `toPlayer`, not `player`: a card you took
   * control of, then lost (e.g. it was destroyed), goes to ITS OWNER's
   * graveyard, not yours.
   */
  toPlayer: Player;
  fromLocation: CardLocation;
  fromSequence: number;
  fromPosition: Position;
  toLocation: CardLocation;
  toSequence: number;
  toPosition: Position;
  isToken: boolean;
  reason: number;
  /**
   * β.3 cas #12 (2026-05-26, Commit 0bis) — overlayMaterials of the SOURCE
   * card AT THE MOMENT OF THE MSG_MOVE. Captured server-side in a
   * pre-`duelProcess` snapshot, BEFORE OCGCore applies the mutation that
   * removes the XYZ from MZONE. Without this field, the materials cannot be
   * recovered: a post-process OVERLAY_CARD query on the source MZONE returns
   * [] because the XYZ is already gone (R8 invariant, validated empirically
   * 2026-05-26).
   *
   * Emitted only when:
   *   (a) the card has a non-empty overlay (length > 0), AND
   *   (b) it leaves a MZONE field zone (no capture for SZONE / HAND / DECK /
   *       EXTRA — those locations never hold XYZ materials).
   *
   * Optional — absent in the vast majority of MSG_MOVE payloads so the
   * common case stays cheap (~99% of moves concern non-XYZ cards or cards
   * without materials). Backward-compatible: replays predating this commit
   * have no field; `m.overlayMaterials ?? []` covers them.
   *
   * Read by the DEP rule `xyzLeaveWithMaterials` (Commit 1) to synthesize
   * the OVERLAY→GRAVE virtual MSG_MOVE events that drive the float
   * animation. See `beta-3-case-12-xyz-leave-with-materials-spec.md §4`.
   */
  overlayMaterials?: number[];
  /**
   * β.3 cas #12 post-review B3 (2026-05-28) — MZONE sequence of the
   * XYZ that USED to carry this matériau, when this MSG_MOVE is the
   * settling event of an ex-overlay-material (GRAVE→GRAVE,
   * reason=0x600). Tagged server-side in `transformMove` via a FIFO
   * map built from the pre-process snapshot.
   *
   * Without this field, two XYZ destroyed in the same chain that
   * share a cardCode in their materials produce settlings that the
   * front-side `xyzLeaveWithMaterials` rule cannot discriminate :
   * both deferreds match the same predicate, both decrement their
   * expectedCardCodes on the first settling → the second settling
   * falls through to the pile→pile router (B3 visual regression).
   * With `sourceMzoneSeq`, each deferred narrows its predicate to
   * its own XYZ source seq → 1 settling = 1 deferred match.
   *
   * Limit (Q1 acknowledged) : if OCGCore emits the settlings in the
   * reverse order of the FIFO source sequence (rare), the assigned
   * `sourceMzoneSeq` is swapped between settlings. Visually the
   * material animates from the wrong XYZ zone — less catastrophic
   * than the original pile→pile flash. Flagged for instance-id
   * extension if observed.
   *
   * Optional + graceful : pre-B3 replays have no field ; the rule
   * falls back to the cardCode-only match (= the pre-B3 behaviour,
   * possibly mis-attributed but visually identical to the original
   * "no fix" state). Backward-compatible.
   */
  sourceMzoneSeq?: number;
  /**
   * Board-state snapshot captured immediately AFTER this event was applied
   * server-side. Populated by the replay precompute for BOARD_CHANGING events
   * that fire during `chainPhase === 'resolving'`, so the client's buffer
   * replay can progressively update logical state per event instead of
   * jumping to the chain's final state at commit. Absent in live PvP.
   */
  boardStateAfter?: BoardStatePayload;
}

export interface DrawMsg {
  type: 'MSG_DRAW';
  player: Player;
  cards: (number | null)[];
  boardStateAfter?: BoardStatePayload;
}

export interface DamageMsg {
  type: 'MSG_DAMAGE';
  player: Player;
  amount: number;
  boardStateAfter?: BoardStatePayload;
}

export interface RecoverMsg {
  type: 'MSG_RECOVER';
  player: Player;
  amount: number;
  boardStateAfter?: BoardStatePayload;
}

export interface PayLpCostMsg {
  type: 'MSG_PAY_LPCOST';
  player: Player;
  amount: number;
  boardStateAfter?: BoardStatePayload;
}

export interface ChainingMsg {
  type: 'MSG_CHAINING';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  chainIndex: number;
  description: number;
  // Resolved effect text for `description` — populated server-side via
  // `resolveDescription` (cards.cdb). Optional: absent on legacy payloads.
  descriptionText?: string;
}

export interface ChainSolvingMsg {
  type: 'MSG_CHAIN_SOLVING';
  chainIndex: number;
}

export interface ChainSolvedMsg {
  type: 'MSG_CHAIN_SOLVED';
  chainIndex: number;
}

export interface ChainEndMsg {
  type: 'MSG_CHAIN_END';
}

export interface ChainNegatedMsg {
  type: 'MSG_CHAIN_NEGATED';
  chainIndex: number;
}

export interface HintMsg {
  type: 'MSG_HINT';
  hintType: number;
  player: Player;
  value: number;
  cardName: string;
}

export interface ConfirmCardsMsg {
  type: 'MSG_CONFIRM_CARDS';
  player: Player;
  cards: CardInfo[];
  /** When true, the reveal is private (CONFIRM_DECKTOP — peek/scry/excavate)
   *  and only `player` sees the cardCodes. The filter masks cards (cardCode=0,
   *  name='') for the opponent. Absent or false = public reveal (CONFIRM_CARDS),
   *  passthrough to both players. */
  private?: boolean;
  /** M22 — Index of the chain link whose resolution emitted this reveal.
   *  Tagged server-side in `handleWorkerMessage` when `chainPhase === 'resolving'`
   *  (= `session.activeChainLinks.length - 1`). Absent for reveals fired
   *  outside chain resolution (e.g. cost prompts, draw phase). The client
   *  uses it to filter `revealedCards` per-link in `pvp-prompt-dialog`,
   *  preventing reveals from previously-resolved links from leaking into a
   *  later link's prompt header (notably after a mid-chain reload). */
  chainIndex?: number;
  boardStateAfter?: BoardStatePayload;
}

export interface ShuffleHandMsg {
  type: 'MSG_SHUFFLE_HAND';
  player: Player;
  cards: (number | null)[];
  boardStateAfter?: BoardStatePayload;
}

export interface ShuffleDeckMsg {
  type: 'MSG_SHUFFLE_DECK';
  player: Player;
  boardStateAfter?: BoardStatePayload;
}

export interface FlipSummoningMsg {
  type: 'MSG_FLIP_SUMMONING';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  position: Position;
  boardStateAfter?: BoardStatePayload;
}

export interface ChangePosMsg {
  type: 'MSG_CHANGE_POS';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  previousPosition: Position;
  currentPosition: Position;
  boardStateAfter?: BoardStatePayload;
}

export interface SetMsg {
  type: 'MSG_SET';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  position: Position;
  boardStateAfter?: BoardStatePayload;
}

export interface SwapMsg {
  type: 'MSG_SWAP';
  card1: CardInfo;
  card2: CardInfo;
}

export interface BecomeTargetMsg {
  type: 'MSG_BECOME_TARGET';
  cards: { player: Player; location: CardLocation; sequence: number }[];
}

export interface AttackMsg {
  type: 'MSG_ATTACK';
  attackerPlayer: Player;
  attackerSequence: number;
  defenderPlayer: Player | null;
  defenderSequence: number | null;
}

export interface BattleMsg {
  type: 'MSG_BATTLE';
  attackerPlayer: Player;
  attackerSequence: number;
  attackerDamage: number;
  defenderPlayer: Player;
  defenderSequence: number;
  defenderDamage: number;
}

export interface TossCoinMsg {
  type: 'MSG_TOSS_COIN';
  player: Player;
  results: boolean[];
  boardStateAfter?: BoardStatePayload;
}

export interface TossDiceMsg {
  type: 'MSG_TOSS_DICE';
  player: Player;
  results: number[];
  boardStateAfter?: BoardStatePayload;
}

export interface EquipMsg {
  type: 'MSG_EQUIP';
  equipPlayer: Player;
  equipLocation: CardLocation;
  equipSequence: number;
  targetPlayer: Player;
  targetLocation: CardLocation;
  targetSequence: number;
  boardStateAfter?: BoardStatePayload;
}

export interface AddCounterMsg {
  type: 'MSG_ADD_COUNTER';
  counterType: number;
  player: Player;
  location: CardLocation;
  sequence: number;
  count: number;
  boardStateAfter?: BoardStatePayload;
}

export interface RemoveCounterMsg {
  type: 'MSG_REMOVE_COUNTER';
  counterType: number;
  player: Player;
  location: CardLocation;
  sequence: number;
  count: number;
  boardStateAfter?: BoardStatePayload;
}

export interface ShuffleSetCardMsg {
  type: 'MSG_SHUFFLE_SET_CARD';
  cards: { fromPlayer: Player; fromSequence: number; toPlayer: Player; toSequence: number; location: CardLocation }[];
  boardStateAfter?: BoardStatePayload;
}

export interface SwapGraveDeckMsg {
  type: 'MSG_SWAP_GRAVE_DECK';
  player: Player;
  boardStateAfter?: BoardStatePayload;
}

export interface WinMsg {
  type: 'MSG_WIN';
  player: Player;
  reason: number;
}
