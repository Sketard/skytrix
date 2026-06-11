// =============================================================================
// message-type-sets.ts — canonical message-type lists shared by the two
// AnimationDataSource transports (audit 2026-06-11 #19).
//
// `DuelConnection` (live PvP/SOLO) and `MockDuelConnection` (replay) used to
// carry byte-identical copies of these lists, "kept in sync by inspection".
// The single source below makes the 20-type core un-driftable ; the mock's
// two intentional deviations (MSG_CHAINING/MSG_CHAIN_END routed through the
// chain-pipeline set, MSG_DRAW/MSG_CONFIRM_CARDS routed through the
// game-event set — PvP gives those four dedicated handler methods) stay
// visible at the mock's composition site instead of hiding inside a fork
// of the whole list.
// =============================================================================

/** SELECT prompt types that share the modal-prompt branch (processor +
 *  pendingPrompt + auto-respond empty-cards + accumulator resets). */
export const SELECT_MODAL_MESSAGE_TYPES = [
  'SELECT_CARD', 'SELECT_CHAIN', 'SELECT_TRIBUTE', 'SELECT_SUM',
  'SELECT_UNSELECT_CARD', 'SELECT_COUNTER',
] as const;

/** SELECT / ANNOUNCE / SORT prompt types that share the simple branch
 *  (processor + pendingPrompt, no auto-respond, no accumulator reset). */
export const SELECT_SIMPLE_MESSAGE_TYPES = [
  'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_EFFECTYN', 'SELECT_YESNO',
  'SELECT_PLACE', 'SELECT_DISFIELD', 'SELECT_POSITION', 'SELECT_OPTION',
  'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_NUMBER',
  'SORT_CARD', 'SORT_CHAIN', 'ANNOUNCE_CARD',
] as const;

/** Chain-pipeline MSG_* types silently forwarded to the processor with no
 *  extra transport side-effect (the chain state machine drives them).
 *  MSG_CHAINING and MSG_CHAIN_END are NOT here — PvP gives them dedicated
 *  handler methods ; the mock adds them to its own set at composition. */
export const CHAIN_PIPELINE_CORE_TYPES = [
  'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_CHAIN_NEGATED',
] as const;

/** Game-event MSG_* types forwarded to the processor with no extra
 *  transport side-effect. MSG_DRAW, MSG_CONFIRM_CARDS, MSG_CHAINING have
 *  dedicated PvP handler methods and are not in the core list.
 *
 *  U20 E2 review-fix : MSG_SET present. It was missing from the pre-U20
 *  switch, so face-down Sets were silently dropped — the processor never
 *  saw them and chain-resolution buffering missed them. */
export const GAME_EVENT_FORWARD_TYPES = [
  'MSG_MOVE', 'MSG_SET', 'MSG_SHUFFLE_HAND', 'MSG_SHUFFLE_DECK',
  'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
  'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_BECOME_TARGET',
  'MSG_SWAP', 'MSG_ATTACK', 'MSG_BATTLE',
  'MSG_TOSS_COIN', 'MSG_TOSS_DICE', 'MSG_EQUIP',
  'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER',
  'MSG_SHUFFLE_SET_CARD', 'MSG_SWAP_GRAVE_DECK',
] as const;
