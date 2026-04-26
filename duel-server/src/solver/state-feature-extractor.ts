// =============================================================================
// state-feature-extractor.ts — Phase B (graph-ml-v2) feature extraction.
//
// Pure functions that turn (FieldState, Action) into a deck-agnostic numeric
// feature vector consumed by `NeuralFeatureRanker`. Design doc:
// `_bmad-output/solver-data/phase-b/day-1-design-doc.md` (round 2, §3-§4).
//
// Hard constraints:
// - 49 state features + 46 per-action features = 95 dims, fixed order.
// - No `cardId` enumeration. No archetype tags. Every feature derives from
//   `FieldState`, `CardMetadataMap`, or `interruption-tags.json` only.
// - Source-card lookup via `Action.sourceZone` (deterministic; multi-copy-safe).
//   Scanning FieldState for first-occurrence-of-cardId would silently corrupt
//   features for 3× staples (Ash, Maxx) split across hand and GY.
//
// Pre-flight scope notes (Day 1.5):
// - Opponent-zone features (rows 32-35) are zeroed: FieldState as currently
//   surfaced by `queryFieldState` only contains player-0 zones. Day 2 task if
//   pre-flight GO.
// - `normal_summon_used` (deferred per design doc §3) is zeroed; the flag
//   isn't on `FieldState` yet.
// - `is_self_turn` derives from `action.team` (default 0 = self) — not from a
//   FieldState active-player field, which doesn't exist.
// =============================================================================

import { createHash } from 'node:crypto';
import type { ZoneId, Phase } from '../ws-protocol.js';
import type {
  Action,
  FieldCard,
  FieldState,
  InterruptionTag,
  InterruptionType,
} from './solver-types.js';
import type { CardMetadata, CardMetadataMap } from './card-metadata.js';
import {
  TYPE_MONSTER,
  TYPE_SPELL,
  TYPE_TRAP,
  TYPE_FUSION,
  TYPE_RITUAL,
  TYPE_TUNER,
  TYPE_SYNCHRO,
  TYPE_QUICKPLAY,
  TYPE_CONTINUOUS,
  TYPE_FIELD,
  TYPE_COUNTER,
  TYPE_XYZ,
  TYPE_PENDULUM,
  TYPE_LINK,
  ATTRIBUTE_DARK,
  ATTRIBUTE_LIGHT,
  ATTRIBUTE_FIRE,
} from './card-metadata.js';

// =============================================================================
// Zone groups (self-side)
// =============================================================================

const SELF_BOARD_ZONES: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
];
const SELF_MONSTER_ZONES: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
];
const SELF_MAIN_MONSTER_ZONES: readonly ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const SELF_EMZ_ZONES: readonly ZoneId[] = ['EMZ_L', 'EMZ_R'];
const SELF_SZONE_ZONES: readonly ZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

const BATTLE_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'BATTLE_START', 'BATTLE_STEP', 'DAMAGE', 'DAMAGE_CALC', 'BATTLE',
]);

// =============================================================================
// FeatureContext — caller-supplied lookup tables
// =============================================================================

/** Per-fixture context passed to every `extractFeatures` call. Pre-built once
 *  by the ranker (deck sets are immutable across the duel) and reused per
 *  rank() invocation. */
export interface FeatureContext {
  metadata: CardMetadataMap;
  interruptionTags: Record<string, InterruptionTag>;
  /** Per-effect-type weights from `interruption-weights.json`. Used by
   *  feature #43 (`interruption_score_proxy`) and #86 (`act_card_tag_value`)
   *  to roughly mirror the scorer's weighting. */
  interruptionWeights: Record<InterruptionType, number>;
  /** Pre-computed `Set<cardId>` for `act_card_in_main_deck_pool`. */
  mainDeckSet: ReadonlySet<number>;
  /** Pre-computed `Set<cardId>` for `act_card_in_extra_deck_pool`. */
  extraDeckSet: ReadonlySet<number>;
}

// =============================================================================
// Feature names (ordered) — single source of truth for hash + JSON dumps
// =============================================================================

export const STATE_FEATURE_NAMES: readonly string[] = [
  // A. Turn / phase / LP (6)
  'turn_norm',
  'phase_main1',
  'phase_main2',
  'phase_battle_active',
  'is_self_turn',
  'lp_self_norm',
  // B. Hand composition (11)
  'hand_size',
  'hand_monsters_count',
  'hand_extra_deck_in_hand',
  'hand_spells_count',
  'hand_quickplay_count',
  'hand_traps_count',
  'hand_disrupters_count',
  'hand_tuners_count',
  'hand_low_level_count',
  'hand_pendulum_count',
  'hand_has_dupes',
  // C. Self-board composition (14)
  'monsters_self_count',
  'links_self_count',
  'xyz_self_count',
  'synchros_self_count',
  'fusions_self_count',
  'pendulums_active_count',
  'pendulum_scales_set',
  'field_spell_self_present',
  'spell_traps_self_count',
  'spell_traps_facedown_count',
  'total_overlay_units_self',
  'field_value_proxy_self',
  'mzones_open_count',
  'extra_zones_available',
  // D. Opponent-board summary (4)
  'monsters_opp_count',
  'spell_traps_opp_count',
  'field_spell_opp_present',
  'opp_overlay_units',
  // E. Resource pools (6)
  'gy_total_count',
  'gy_monsters_count',
  'banished_self_count',
  'deck_remaining_count',
  'extra_remaining_count',
  'extra_pendulums_count',
  // F. Interruption state (8)
  'interruption_pieces_field_count',
  'interruption_score_proxy',
  'omninegate_count',
  'floodgate_count',
  'negate_total_count',
  'interruption_pieces_hand_count',
  'unique_interruption_types_field',
  'gy_revival_targets_count',
];

export const ACTION_FEATURE_NAMES: readonly string[] = [
  // G. Action-type & prompt context (9)
  'act_promptType_idlecmd',
  'act_promptType_battlecmd',
  'act_promptType_chain',
  'act_promptType_effectyn',
  'act_promptType_card',
  'act_promptType_position',
  'act_promptType_yesno',
  'act_promptType_option',
  'act_is_pass',
  // H. Source card type (14)
  'act_card_isMonster',
  'act_card_isSpell',
  'act_card_isTrap',
  'act_card_isExtraDeck',
  'act_card_isLink',
  'act_card_isXyz',
  'act_card_isFusion',
  'act_card_isSynchro',
  'act_card_isPendulum',
  'act_card_isTuner',
  'act_card_isQuickPlay',
  'act_card_isContinuous',
  'act_card_isCounter',
  'act_card_isField',
  // I. Source card attribute & numerical (6)
  'act_card_attribute_dark',
  'act_card_attribute_light',
  'act_card_attribute_fire',
  'act_card_attribute_other',
  'act_card_level_norm',
  'act_card_summon_rating_norm',
  // J. Source card location (6)
  'act_src_in_hand',
  'act_src_in_mzone',
  'act_src_in_szone',
  'act_src_in_field_zone',
  'act_src_in_gy',
  'act_src_in_banished',
  // K. Source card structural / interruption signal (11)
  'act_card_has_tag',
  'act_card_tag_value',
  'act_card_is_handtrap_class',
  'act_card_tag_has_omninegate',
  'act_card_tag_has_floodgate',
  'act_card_tag_has_targeted_negate',
  'act_card_tag_has_destruction',
  'act_card_tag_has_banish',
  'act_card_in_extra_deck_pool',
  'act_card_in_main_deck_pool',
  'act_card_overlay_count_norm',
];

export const STATE_DIM = STATE_FEATURE_NAMES.length;        // 49
export const ACTION_DIM = ACTION_FEATURE_NAMES.length;      // 46
export const FEATURE_DIM = STATE_DIM + ACTION_DIM;          // 95

// Sanity guards — fail loud at boot if the arrays drift from the design doc.
if (STATE_DIM !== 49) {
  throw new Error(`[state-feature-extractor] STATE_DIM expected 49, got ${STATE_DIM}`);
}
if (ACTION_DIM !== 46) {
  throw new Error(`[state-feature-extractor] ACTION_DIM expected 46, got ${ACTION_DIM}`);
}

/** sha256 of the ordered concatenation of state + action feature names.
 *  Embedded in trained-weights JSON; loader hard-fails on mismatch to prevent
 *  silent feature-spec drift between training and runtime. */
export function computeFeatureSpecHash(): string {
  const payload = JSON.stringify({
    state: STATE_FEATURE_NAMES,
    action: ACTION_FEATURE_NAMES,
  });
  return 'sha256:' + createHash('sha256').update(payload).digest('hex');
}

// =============================================================================
// State feature extraction (49 dims)
// =============================================================================

/** Build the 49-dim state vector. Constant per `rank()` call — extract once,
 *  reuse for every action in the batch. */
export function extractStateFeatures(state: FieldState, ctx: FeatureContext): number[] {
  const out: number[] = new Array(STATE_DIM).fill(0);
  let i = 0;

  // ---- A. Turn / phase / LP (6) ----
  out[i++] = clamp01(state.turn / 5);
  out[i++] = state.phase === 'MAIN1' ? 1 : 0;
  out[i++] = state.phase === 'MAIN2' ? 1 : 0;
  out[i++] = BATTLE_PHASES.has(state.phase) ? 1 : 0;
  // is_self_turn: action-context not available here — the per-action vector
  // overrides this slot if needed. Default 1 (DFS solves from self perspective;
  // ~all states are self-turn until a SELECT_CHAIN on opp turn).
  out[i++] = 1;
  out[i++] = clamp01(state.lifePoints[0] / 8000);

  // ---- B. Hand composition (11) ----
  const hand = state.zones.HAND ?? [];
  let handMonsters = 0;
  let handExtraInHand = 0;
  let handSpells = 0;
  let handQuickplay = 0;
  let handTraps = 0;
  let handDisrupters = 0;
  let handTuners = 0;
  let handLowLevel = 0;
  let handPendulum = 0;
  const handSeen = new Map<number, number>();
  for (const c of hand) {
    handSeen.set(c.cardId, (handSeen.get(c.cardId) ?? 0) + 1);
    const m = ctx.metadata.get(c.cardId);
    if (!m) continue;
    if (m.isMonster) handMonsters++;
    if (m.isExtraDeckMonster) handExtraInHand++;
    if (m.isSpell) handSpells++;
    if ((m.type & TYPE_QUICKPLAY) !== 0) handQuickplay++;
    if (m.isTrap) handTraps++;
    if (isHandtrapClass(c.cardId, ctx.interruptionTags)) handDisrupters++;
    if ((m.type & TYPE_TUNER) !== 0) handTuners++;
    if (m.isMonster && m.level > 0 && m.level <= 4) handLowLevel++;
    if ((m.type & TYPE_PENDULUM) !== 0) handPendulum++;
  }
  let handHasDupes = 0;
  for (const count of handSeen.values()) {
    if (count >= 2) { handHasDupes = 1; break; }
  }
  out[i++] = clamp01(hand.length / 7);
  out[i++] = clamp01(handMonsters / 7);
  out[i++] = clamp01(handExtraInHand / 7);
  out[i++] = clamp01(handSpells / 7);
  out[i++] = clamp01(handQuickplay / 7);
  out[i++] = clamp01(handTraps / 7);
  out[i++] = clamp01(handDisrupters / 7);
  out[i++] = clamp01(handTuners / 7);
  out[i++] = clamp01(handLowLevel / 7);
  out[i++] = clamp01(handPendulum / 7);
  out[i++] = handHasDupes;

  // ---- C. Self-board composition (14) ----
  let monstersSelf = 0;
  let linksSelf = 0;
  let xyzSelf = 0;
  let synchrosSelf = 0;
  let fusionsSelf = 0;
  let totalOverlay = 0;
  let fieldValueProxy = 0;
  for (const z of SELF_MONSTER_ZONES) {
    const cards = state.zones[z] ?? [];
    for (const c of cards) {
      monstersSelf++;
      totalOverlay += c.overlayCount;
      const m = ctx.metadata.get(c.cardId);
      if (!m) continue;
      if ((m.type & TYPE_LINK) !== 0) linksSelf++;
      if ((m.type & TYPE_XYZ) !== 0) xyzSelf++;
      if ((m.type & TYPE_SYNCHRO) !== 0) synchrosSelf++;
      if ((m.type & TYPE_FUSION) !== 0) fusionsSelf++;
      // Use rating for ED monsters (Link rating, Xyz rank, Fusion/Synchro level
      // share the level field). Default level/12 for main-deck monsters.
      const proxy = m.isExtraDeckMonster ? m.rating : m.level;
      fieldValueProxy += proxy;
    }
  }
  let pendulumsActive = 0;
  for (const z of ['S1', 'S5'] as const) {
    const cards = state.zones[z] ?? [];
    for (const c of cards) {
      const m = ctx.metadata.get(c.cardId);
      if (m && (m.type & TYPE_PENDULUM) !== 0 && isFaceup(c)) pendulumsActive++;
    }
  }
  const scaleS1 = pendulumScalePresent(state.zones.S1, ctx.metadata);
  const scaleS5 = pendulumScalePresent(state.zones.S5, ctx.metadata);
  const pendulumScalesSet = scaleS1 && scaleS5 ? 1 : 0;
  const fieldSelf = state.zones.FIELD ?? [];
  const fieldSpellSelfPresent = fieldSelf.length > 0 ? 1 : 0;
  let spellTrapsSelfCount = 0;
  let spellTrapsFacedownCount = 0;
  for (const z of SELF_SZONE_ZONES) {
    const cards = state.zones[z] ?? [];
    for (const c of cards) {
      spellTrapsSelfCount++;
      if (isFacedown(c)) spellTrapsFacedownCount++;
    }
  }
  let mzonesOccupied = 0;
  for (const z of SELF_MAIN_MONSTER_ZONES) {
    if ((state.zones[z] ?? []).length > 0) mzonesOccupied++;
  }
  let emzOccupied = 0;
  for (const z of SELF_EMZ_ZONES) {
    if ((state.zones[z] ?? []).length > 0) emzOccupied++;
  }
  out[i++] = clamp01(monstersSelf / 7);
  out[i++] = clamp01(linksSelf / 4);
  out[i++] = clamp01(xyzSelf / 4);
  out[i++] = clamp01(synchrosSelf / 4);
  out[i++] = clamp01(fusionsSelf / 4);
  out[i++] = clamp01(pendulumsActive / 2);
  out[i++] = pendulumScalesSet;
  out[i++] = fieldSpellSelfPresent;
  out[i++] = clamp01(spellTrapsSelfCount / 5);
  out[i++] = clamp01(spellTrapsFacedownCount / 5);
  out[i++] = clamp01(totalOverlay / 10);
  out[i++] = clamp01(fieldValueProxy / 30);
  out[i++] = clamp01((5 - mzonesOccupied) / 5);
  out[i++] = clamp01((2 - emzOccupied) / 2);

  // ---- D. Opponent-board summary (4) ----
  // Day 2 wiring (post-pre-flight): reads `state.oppZones` populated by
  // `queryFieldState` (commit b4142292). Backward-compat: if the FieldState
  // doesn't carry oppZones (legacy callers, tests), the 4 slots stay zero —
  // matching the Day 1.5 pre-flight behaviour exactly. featureSpecHash is
  // unchanged because feature names are unchanged.
  let monstersOpp = 0;
  let spellTrapsOpp = 0;
  let fieldSpellOppPresent = 0;
  let oppOverlay = 0;
  const oz = state.oppZones;
  if (oz) {
    for (const z of SELF_MONSTER_ZONES) {
      const cards = oz[z] ?? [];
      for (const c of cards) {
        monstersOpp++;
        oppOverlay += c.overlayCount;
      }
    }
    for (const z of SELF_SZONE_ZONES) {
      spellTrapsOpp += (oz[z] ?? []).length;
    }
    fieldSpellOppPresent = (oz.FIELD ?? []).length > 0 ? 1 : 0;
  }
  out[i++] = clamp01(monstersOpp / 7);
  out[i++] = clamp01(spellTrapsOpp / 5);
  out[i++] = fieldSpellOppPresent;
  out[i++] = clamp01(oppOverlay / 10);

  // ---- E. Resource pools (6) ----
  const gy = state.zones.GY ?? [];
  let gyMonsters = 0;
  let gyRevivalTargets = 0;
  for (const c of gy) {
    const m = ctx.metadata.get(c.cardId);
    if (m?.isMonster) {
      gyMonsters++;
      if (m.level > 0 && m.level <= 8) gyRevivalTargets++;
    }
  }
  const banished = state.zones.BANISHED ?? [];
  const deck = state.zones.DECK ?? [];
  const extra = state.zones.EXTRA ?? [];
  let extraPendulums = 0;
  for (const c of extra) {
    const m = ctx.metadata.get(c.cardId);
    if (m && (m.type & TYPE_PENDULUM) !== 0 && isFaceup(c)) extraPendulums++;
  }
  out[i++] = clamp01(gy.length / 30);
  out[i++] = clamp01(gyMonsters / 30);
  out[i++] = clamp01(banished.length / 30);
  out[i++] = clamp01(deck.length / 50);
  out[i++] = clamp01(extra.length / 15);
  out[i++] = clamp01(extraPendulums / 10);

  // ---- F. Interruption state (8) ----
  let interruptionPiecesField = 0;
  let interruptionScoreProxy = 0;
  let omninegateCount = 0;
  let floodgateCount = 0;
  let negateTotalCount = 0;
  const uniqueTypesOnField = new Set<string>();
  for (const z of SELF_BOARD_ZONES) {
    const cards = state.zones[z] ?? [];
    for (const c of cards) {
      const tag = ctx.interruptionTags[String(c.cardId)];
      if (!tag) continue;
      let matched = false;
      for (const eff of tag.effects) {
        if (!effectActiveInZone(eff.activeZones, z)) continue;
        matched = true;
        const w = ctx.interruptionWeights[eff.type] ?? 0;
        interruptionScoreProxy += w;
        uniqueTypesOnField.add(eff.type);
        if (eff.type === 'omniNegate') omninegateCount++;
        if (eff.type === 'floodgate') floodgateCount++;
        if (eff.type === 'omniNegate' || eff.type === 'typedNegate' || eff.type === 'targetedNegate') {
          negateTotalCount++;
        }
      }
      if (matched) interruptionPiecesField++;
    }
  }
  let interruptionPiecesHand = 0;
  for (const c of hand) {
    if (ctx.interruptionTags[String(c.cardId)]) interruptionPiecesHand++;
  }
  out[i++] = clamp01(interruptionPiecesField / 7);
  out[i++] = clamp01(interruptionScoreProxy / 50);
  out[i++] = omninegateCount;
  out[i++] = floodgateCount;
  out[i++] = negateTotalCount;
  out[i++] = clamp01(interruptionPiecesHand / 7);
  out[i++] = clamp01(uniqueTypesOnField.size / 8);
  out[i++] = clamp01(gyRevivalTargets / 10);

  return out;
}

// =============================================================================
// Action feature extraction (46 dims)
// =============================================================================

/** Build the 46-dim per-action vector. Concatenated with state vector to
 *  form the 95-dim input. */
export function extractActionFeatures(
  action: Action,
  state: FieldState,
  ctx: FeatureContext,
): number[] {
  const out: number[] = new Array(ACTION_DIM).fill(0);
  let i = 0;

  // ---- G. Action-type & prompt context (9) ----
  out[i++] = action.promptType === 'SELECT_IDLECMD' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_BATTLECMD' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_CHAIN' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_EFFECTYN' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_CARD' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_POSITION' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_YESNO' ? 1 : 0;
  out[i++] = action.promptType === 'SELECT_OPTION' ? 1 : 0;
  out[i++] = action.responseIndex === -1 ? 1 : 0;

  // Source card metadata. cardId === 0 represents pass / sentinel actions —
  // all card-derived features stay 0.
  const meta: CardMetadata | undefined =
    action.cardId === 0 ? undefined : ctx.metadata.get(action.cardId);

  // ---- H. Source card type (14) ----
  if (meta) {
    out[i++] = meta.isMonster ? 1 : 0;
    out[i++] = meta.isSpell ? 1 : 0;
    out[i++] = meta.isTrap ? 1 : 0;
    out[i++] = meta.isExtraDeckMonster ? 1 : 0;
    out[i++] = (meta.type & TYPE_LINK) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_XYZ) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_FUSION) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_SYNCHRO) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_PENDULUM) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_TUNER) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_QUICKPLAY) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_CONTINUOUS) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_COUNTER) !== 0 ? 1 : 0;
    out[i++] = (meta.type & TYPE_FIELD) !== 0 ? 1 : 0;
  } else {
    i += 14;
  }

  // ---- I. Source card attribute & numerical (6) ----
  if (meta) {
    out[i++] = meta.attribute === ATTRIBUTE_DARK ? 1 : 0;
    out[i++] = meta.attribute === ATTRIBUTE_LIGHT ? 1 : 0;
    out[i++] = meta.attribute === ATTRIBUTE_FIRE ? 1 : 0;
    const isOther =
      meta.isMonster &&
      meta.attribute !== ATTRIBUTE_DARK &&
      meta.attribute !== ATTRIBUTE_LIGHT &&
      meta.attribute !== ATTRIBUTE_FIRE &&
      meta.attribute !== 0;
    out[i++] = isOther ? 1 : 0;
    out[i++] = clamp01(meta.level / 12);
    out[i++] = meta.isExtraDeckMonster ? clamp01(meta.rating / 12) : 0;
  } else {
    i += 6;
  }

  // ---- J. Source card location (6) ----
  // sourceZone is the deterministic source-card zone (replaces a silently-
  // corrupting "scan FieldState for first occurrence of cardId" strategy that
  // broke on multi-copy cards). Undefined when the source can't be cleanly
  // mapped (opp-controlled, unhandled prompt) — all act_src_in_* slots stay 0.
  const sz = action.sourceZone;
  out[i++] = sz === 'HAND' ? 1 : 0;
  out[i++] = sz !== undefined && isMonsterZone(sz) ? 1 : 0;
  out[i++] = sz !== undefined && isSZone(sz) ? 1 : 0;
  out[i++] = sz === 'FIELD' ? 1 : 0;
  out[i++] = sz === 'GY' ? 1 : 0;
  out[i++] = sz === 'BANISHED' ? 1 : 0;

  // ---- K. Source card structural / interruption signal (11) ----
  const tag = action.cardId === 0 ? undefined : ctx.interruptionTags[String(action.cardId)];
  if (tag) {
    let tagValueSum = 0;
    let isHandtrap = false;
    let hasOmni = false;
    let hasFloodgate = false;
    let hasTargetedNegate = false;
    let hasDestruction = false;
    let hasBanish = false;
    for (const eff of tag.effects) {
      tagValueSum += ctx.interruptionWeights[eff.type] ?? 0;
      if (eff.activeZones && eff.activeZones.includes('HAND')) isHandtrap = true;
      if (eff.type === 'omniNegate') hasOmni = true;
      if (eff.type === 'floodgate') hasFloodgate = true;
      if (eff.type === 'targetedNegate') hasTargetedNegate = true;
      if (eff.type === 'destruction') hasDestruction = true;
      if (eff.type === 'banish' || eff.type === 'banishFacedown') hasBanish = true;
    }
    out[i++] = 1;                                  // act_card_has_tag
    out[i++] = clamp01(tagValueSum / 50);          // act_card_tag_value
    out[i++] = isHandtrap ? 1 : 0;
    out[i++] = hasOmni ? 1 : 0;
    out[i++] = hasFloodgate ? 1 : 0;
    out[i++] = hasTargetedNegate ? 1 : 0;
    out[i++] = hasDestruction ? 1 : 0;
    out[i++] = hasBanish ? 1 : 0;
  } else {
    i += 8;
  }
  // act_card_in_extra_deck_pool / act_card_in_main_deck_pool — mechanical
  // facts about whether this cardId is in our deck (vs an opponent card we're
  // responding to). Deterministic; deck composition doesn't change mid-duel.
  out[i++] = action.cardId !== 0 && ctx.extraDeckSet.has(action.cardId) ? 1 : 0;
  out[i++] = action.cardId !== 0 && ctx.mainDeckSet.has(action.cardId) ? 1 : 0;
  // act_card_overlay_count_norm — overlay material count of the source card,
  // when it's on the field. 0 for hand/GY/banished/undefined-zone sources.
  out[i++] = sourceOverlayCount(state, sz) / 3;

  return out;
}

/** Concatenated state + action vector (95 dims). Convenience wrapper for
 *  Phase 3 trajectory dumps; the ranker prefers calling extractStateFeatures
 *  once and extractActionFeatures per action to amortize the state pass. */
export function extractFeatures(
  state: FieldState,
  action: Action,
  ctx: FeatureContext,
): number[] {
  const stateVec = extractStateFeatures(state, ctx);
  const actionVec = extractActionFeatures(action, state, ctx);
  // Override is_self_turn (state vector slot 4) with action.team-derived value
  // — only the action knows whether this prompt is on opp turn (team:1 chain
  // interrupt). The state-only path defaulted to 1.
  stateVec[4] = action.team === 1 ? 0 : 1;
  return stateVec.concat(actionVec);
}

// =============================================================================
// Helpers
// =============================================================================

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function isFaceup(c: FieldCard): boolean {
  return c.position === 'faceup-atk' || c.position === 'faceup-def';
}

function isFacedown(c: FieldCard): boolean {
  return c.position === 'facedown' || c.position === 'facedown-def';
}

function pendulumScalePresent(
  cards: FieldCard[] | undefined,
  metadata: CardMetadataMap,
): boolean {
  if (!cards) return false;
  for (const c of cards) {
    const m = metadata.get(c.cardId);
    if (m && (m.type & TYPE_PENDULUM) !== 0 && isFaceup(c)) return true;
  }
  return false;
}

/** Mirror of `interruption-scorer.ts`'s `effectiveActiveZones`: a tagged
 *  effect without explicit `activeZones` defaults to on-field only. */
function effectActiveInZone(
  activeZones: readonly ZoneId[] | undefined,
  zone: ZoneId,
): boolean {
  if (activeZones && activeZones.length > 0) {
    return activeZones.includes(zone);
  }
  // Default: on-field zones only (matches scorer convention).
  return SELF_BOARD_ZONES.includes(zone);
}

function isHandtrapClass(
  cardId: number,
  tags: Record<string, InterruptionTag>,
): boolean {
  const tag = tags[String(cardId)];
  if (!tag) return false;
  for (const eff of tag.effects) {
    if (eff.activeZones && eff.activeZones.includes('HAND')) return true;
  }
  return false;
}

function isMonsterZone(z: ZoneId): boolean {
  return z === 'M1' || z === 'M2' || z === 'M3' || z === 'M4' || z === 'M5'
      || z === 'EMZ_L' || z === 'EMZ_R';
}

function isSZone(z: ZoneId): boolean {
  return z === 'S1' || z === 'S2' || z === 'S3' || z === 'S4' || z === 'S5';
}

function sourceOverlayCount(state: FieldState, sz: ZoneId | undefined): number {
  if (sz === undefined) return 0;
  if (!isMonsterZone(sz) && !isSZone(sz) && sz !== 'FIELD') return 0;
  const cards = state.zones[sz] ?? [];
  return cards[0]?.overlayCount ?? 0;
}

// =============================================================================
// FeatureContext factory
// =============================================================================

/** Build a FeatureContext from per-fixture inputs. Pre-computes deck Sets
 *  for O(1) lookup on every action.cardId membership check. */
export function buildFeatureContext(args: {
  metadata: CardMetadataMap;
  interruptionTags: Record<string, InterruptionTag>;
  interruptionWeights: Record<InterruptionType, number>;
  mainDeck: readonly number[];
  extraDeck: readonly number[];
}): FeatureContext {
  return {
    metadata: args.metadata,
    interruptionTags: args.interruptionTags,
    interruptionWeights: args.interruptionWeights,
    mainDeckSet: new Set(args.mainDeck),
    extraDeckSet: new Set(args.extraDeck),
  };
}
