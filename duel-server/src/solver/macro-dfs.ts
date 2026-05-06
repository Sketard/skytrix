// =============================================================================
// macro-dfs.ts — POC macro-action DFS engine (2026-05-03).
//
// Standalone engine + 2 SubPromptPolicy implementations (Default + Seeded
// canonical raw-replay) + 1 MacroEnumerator implementation backed by
// OCGCore.duelProcess loops. Forking is done via WebAssembly.Memory snapshot
// (same mechanism as OCGCoreAdapter.forkViaSnapshot, replicated here so the
// POC has zero coupling to the production adapter).
//
// Scope: search-side only. Scoring is delegated to the CLI script which owns
// the InterruptionScorer + FieldState builder.
// =============================================================================

import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
} from '@n1xx1/ocgcore-wasm';

import type {
  Action,
  ActivationLog,
  FieldState,
  InterruptionTag,
  PromptType,
} from './solver-types.js';
import { decodeFieldMask } from './ocg-field-query.js';
import { MESSAGE_TO_PROMPT } from './ocg-constants.js';
import {
  disambiguateEffect,
  isFieldActivation,
} from './interruption-disambiguation.js';
import type {
  EnumerationResult,
  MacroAction,
  MacroEnumerator,
  MacroNode,
  PolicyStats,
  SubPromptContext,
  SubPromptPolicy,
  SubPromptResolution,
} from './macro-action-types.js';

// =============================================================================
// Entry-point matching helpers
// =============================================================================

/** Compare two OCGCore response objects for entry-point matching. We compare
 *  only the fields the macro CLI emits: `type`, `action`, `index`. `null`
 *  values match (e.g., CHAIN pass uses `index: null`). Permissive on
 *  undefined-vs-missing so `to_bp`/`to_ep` macros (no `index`) match raw-replay
 *  steps that may or may not include it. */
function entryResponsesEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (!a || !b) return false;
  if (a['type'] !== b['type']) return false;
  if ((a['action'] ?? null) !== (b['action'] ?? null)) return false;
  if ((a['index'] ?? null) !== (b['index'] ?? null)) return false;
  return true;
}


// =============================================================================
// OCGCore handle abstraction — minimal wrapper. The POC keeps types loose
// (`any`) only at the WASM boundary, mirroring `raw-replay-verify.ts`.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Core = any;

/** Public interface a CLI must provide to wire the POC into OCGCore. */
export interface OcgCoreBridge {
  core: Core;
  /** Take a fresh snapshot of WASM linear memory. Returns an opaque handle. */
  snapshot(): ArrayBuffer;
  /** Restore WASM linear memory to a previously taken snapshot. */
  restore(snap: ArrayBuffer): void;
  /** Capture a FieldState from the current OCGCore state. */
  captureFieldState(duelId: number): FieldState;
}

// =============================================================================
// Default policy — mechanical heuristics for sub-prompts.
// =============================================================================

/** Generic baseline policy. Returns `null` for any prompt that should be
 *  treated as a macro entry-point (active SELECT_IDLECMD, branchable own
 *  SELECT_CHAIN). Everything else gets a deterministic default. */
export class DefaultSubPromptPolicy implements SubPromptPolicy {
  resolve(
    msg: Record<string, unknown>,
    promptType: PromptType,
    promptPlayer: 0 | 1,
    _context: SubPromptContext,
  ): SubPromptResolution | null {
    const msgType = msg['type'] as number;

    // Opponent IDLECMD/BATTLECMD/CHAIN/EFFECTYN/YESNO/RPS — auto-pass.
    if (promptPlayer === 1) {
      const oppResp = this.resolveOpponent(msg, msgType);
      if (oppResp) {
        return { promptType, promptPlayer, response: oppResp, source: 'auto-pass' };
      }
    }

    // Own SELECT_IDLECMD = entry-point, never trivial.
    if (promptType === 'SELECT_IDLECMD') return null;

    // Own SELECT_CHAIN: pass-only window collapses to trivial; otherwise entry.
    if (promptType === 'SELECT_CHAIN') {
      const selects = (msg['selects'] ?? []) as unknown[];
      if (selects.length === 0) {
        return {
          promptType,
          promptPlayer,
          response: { type: 8, index: null },
          source: 'auto-pass',
        };
      }
      return null;
    }

    if (promptType === 'SELECT_BATTLECMD') {
      // POC scope: skip BP — go straight to EP.
      const resp = msg['to_ep']
        ? { type: 0, action: 3 }
        : { type: 0, action: 2 };
      return { promptType, promptPlayer, response: resp, source: 'trivial' };
    }

    return this.resolveMechanical(msg, msgType, promptType, promptPlayer);
  }

  private resolveOpponent(
    msg: Record<string, unknown>,
    msgType: number,
  ): Record<string, unknown> | null {
    switch (msgType) {
      case OcgMessageType.SELECT_IDLECMD:
        return msg['to_ep'] ? { type: 1, action: 7 } : { type: 1, action: 6 };
      case OcgMessageType.SELECT_BATTLECMD:
        return msg['to_ep'] ? { type: 0, action: 3 } : { type: 0, action: 2 };
      case OcgMessageType.SELECT_CHAIN:
        return { type: 8, index: null };
      case OcgMessageType.SELECT_EFFECTYN:
        return { type: 2, yes: true };
      case OcgMessageType.SELECT_YESNO:
        return { type: 3, yes: false };
      default:
        return null;
    }
  }

  private resolveMechanical(
    msg: Record<string, unknown>,
    msgType: number,
    promptType: PromptType,
    promptPlayer: 0 | 1,
  ): SubPromptResolution | null {
    let response: Record<string, unknown> | null = null;
    switch (msgType) {
      case OcgMessageType.SELECT_POSITION:
        response = { type: 11, position: OcgPosition.FACEUP_ATTACK };
        break;
      case OcgMessageType.SELECT_PLACE:
        response = {
          type: 10,
          places: decodeFieldMask(msg['field_mask'] as number, msg['count'] as number),
        };
        break;
      case OcgMessageType.SELECT_DISFIELD:
        response = {
          type: 9,
          places: decodeFieldMask(msg['field_mask'] as number, msg['count'] as number),
        };
        break;
      case OcgMessageType.SELECT_TRIBUTE:
        response = {
          type: 12,
          indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i),
        };
        break;
      case OcgMessageType.SELECT_SUM:
        response = {
          type: 14,
          indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i),
        };
        break;
      case OcgMessageType.SELECT_COUNTER:
        response = {
          type: 13,
          counters: ((msg['cards'] ?? []) as unknown[]).map(() => 0),
        };
        break;
      case OcgMessageType.SELECT_CARD: {
        const min = (msg['min'] as number) ?? 1;
        response = { type: 5, indicies: Array.from({ length: min }, (_, i) => i) };
        break;
      }
      case OcgMessageType.SELECT_UNSELECT_CARD:
        response = msg['can_finish'] ? { type: 7, index: null } : { type: 7, index: 0 };
        break;
      case OcgMessageType.SELECT_EFFECTYN:
        response = { type: 2, yes: true };
        break;
      case OcgMessageType.SELECT_YESNO:
        response = { type: 3, yes: true };
        break;
      case OcgMessageType.SELECT_OPTION:
        response = { type: 4, index: 0 };
        break;
      case OcgMessageType.ANNOUNCE_NUMBER: {
        const opts = (msg['options'] as Array<bigint | number> | undefined) ?? [];
        const value = opts.length > 0 ? opts.length - 1 : 0;
        response = { type: 19, value };
        break;
      }
      case OcgMessageType.ROCK_PAPER_SCISSORS:
        response = { type: 20, value: promptPlayer === 0 ? 1 : 3 };
        break;
      default:
        return null;
    }
    return { promptType, promptPlayer, response, source: 'trivial' };
  }
}

// =============================================================================
// Seeded canonical policy — fingerprint lookup against a raw-replay file.
// =============================================================================

interface RawReplayStep {
  stepIdx: number;
  promptType: number;
  promptTypeName: string;
  promptPlayer: number;
  response: Record<string, unknown>;
}

interface RawReplayFile {
  format: string;
  steps: RawReplayStep[];
}

/** Canonical-line policy: reads a `.raw-replay.json`, indexes its steps by
 *  prompt type, and replays the captured response when the sub-prompt
 *  fingerprint matches. Falls back to `DefaultSubPromptPolicy` on miss. The
 *  fingerprint key is intentionally permissive for the POC — it advances a
 *  per-prompt-type cursor rather than matching on rich state, on the
 *  assumption that the canonical line and the macro enumerator visit
 *  sub-prompts in the same order.
 *
 *  When `fullCanonicalReplay` is set, also exposes `selectEntryPoint`: a
 *  separate monotonic cursor over player-0 entry-point steps (own SELECT_IDLECMD
 *  + own SELECT_CHAIN-with-active-pick) is consumed in raw-replay order to
 *  pin the DFS to the canonical line. Branchable CHAIN passes (own pass) are
 *  also covered (response.index === null). */
export class SeededCanonicalSubPromptPolicy implements SubPromptPolicy {
  private readonly fallback = new DefaultSubPromptPolicy();
  private readonly stepsByPromptType: Map<number, RawReplayStep[]>;
  private readonly cursors: Map<number, number>;
  private readonly fullCanonicalReplay: boolean;

  constructor(rawReplay: RawReplayFile, opts: { fullCanonicalReplay?: boolean } = {}) {
    if (rawReplay.format !== 'raw-replay-v1') {
      throw new Error(`SeededCanonicalSubPromptPolicy: unsupported format ${rawReplay.format}`);
    }
    this.fullCanonicalReplay = opts.fullCanonicalReplay ?? false;
    this.stepsByPromptType = new Map();
    this.cursors = new Map();
    for (const step of rawReplay.steps) {
      const list = this.stepsByPromptType.get(step.promptType) ?? [];
      list.push(step);
      this.stepsByPromptType.set(step.promptType, list);
      this.cursors.set(step.promptType, 0);
    }
  }

  /** Full-canonical mode: select the macro matching the next canonical step
   *  for this prompt type, using the same per-prompt-type cursor that
   *  `resolve` consumes for sub-prompts. Critical alignment property: the
   *  `resolve` path NEVER advances the cursor for own-player branchable
   *  entry-points (returns null before the lookup), so the cursor is parked
   *  on exactly the canonical entry-point step when the engine asks here.
   *  Returns `null` when:
   *   - mode is off, or player !== 0
   *   - cursor exhausted for this prompt type
   *   - the parked canonical step belongs to the other player
   *   - no legal macro matches the captured response
   *  On a hit, advances the cursor and returns the matched index. */
  selectEntryPoint(
    legalMacros: MacroAction[],
    entryPromptType: 'SELECT_IDLECMD' | 'SELECT_CHAIN',
    entryPromptPlayer: 0 | 1,
  ): number | null {
    if (!this.fullCanonicalReplay) return null;
    if (entryPromptPlayer !== 0) return null;

    const expectedMsgType = entryPromptType === 'SELECT_IDLECMD'
      ? OcgMessageType.SELECT_IDLECMD
      : OcgMessageType.SELECT_CHAIN;
    const list = this.stepsByPromptType.get(expectedMsgType);
    if (!list) return null;
    const cursor = this.cursors.get(expectedMsgType) ?? 0;
    if (cursor >= list.length) {
      if (process.env['MACRO_DFS_DEBUG']) {
        console.warn(`[seeded] entry-point cursor exhausted for ${entryPromptType}; ${legalMacros.length} legal macros`);
      }
      return null;
    }

    const step = list[cursor];
    if (step.promptPlayer !== entryPromptPlayer) {
      if (process.env['MACRO_DFS_DEBUG']) {
        console.warn(`[seeded] cursor parked on opponent step (orig stepIdx=${step.stepIdx}) for ${entryPromptType}; ${legalMacros.length} legal macros`);
      }
      return null;
    }

    for (let i = 0; i < legalMacros.length; i++) {
      const macroResp = legalMacros[i].rootAction._response as Record<string, unknown> | undefined;
      if (entryResponsesEqual(macroResp, step.response)) {
        this.cursors.set(expectedMsgType, cursor + 1);
        return i;
      }
    }
    if (process.env['MACRO_DFS_DEBUG']) {
      console.warn(`[seeded] no legal macro matches canonical step (orig stepIdx=${step.stepIdx}) ${entryPromptType} expects ${JSON.stringify(step.response)}`);
      legalMacros.forEach((m, i) => {
        console.warn(`           legal[${i}] = ${m.description} :: ${JSON.stringify(m.rootAction._response)}`);
      });
    }
    return null;
  }


  resolve(
    msg: Record<string, unknown>,
    promptType: PromptType,
    promptPlayer: 0 | 1,
    context: SubPromptContext,
  ): SubPromptResolution | null {
    const msgType = msg['type'] as number;

    // Entry-points (own IDLECMD, own non-trivial CHAIN) are NOT covered by
    // the seed policy — the macro enumerator owns branching there.
    if (promptPlayer === 0 && promptType === 'SELECT_IDLECMD') return null;
    if (promptPlayer === 0 && promptType === 'SELECT_CHAIN') {
      const selects = (msg['selects'] ?? []) as unknown[];
      if (selects.length > 0) return null;
    }

    const list = this.stepsByPromptType.get(msgType);
    if (!list) return this.fallback.resolve(msg, promptType, promptPlayer, context);

    const cursor = this.cursors.get(msgType) ?? 0;
    if (cursor >= list.length) {
      return this.fallback.resolve(msg, promptType, promptPlayer, context);
    }

    const step = list[cursor];
    if (step.promptPlayer !== promptPlayer) {
      return this.fallback.resolve(msg, promptType, promptPlayer, context);
    }

    this.cursors.set(msgType, cursor + 1);
    return {
      promptType,
      promptPlayer,
      response: step.response,
      source: 'seeded',
    };
  }

  /** Reset all per-prompt-type cursors. Called by the macro enumerator on
   *  every fresh DFS branch so seed lookups stay deterministic across forks
   *  (each branch replays the canonical seed from index 0 of every type). */
  reset(): void {
    for (const k of this.cursors.keys()) this.cursors.set(k, 0);
  }

  /** Snapshot the current cursor state. Used by the macro DFS to roll cursors
   *  forward through one child's expansion then restore for the next sibling
   *  — keeps seed lookups consistent with each branch's own sub-prompt path.
   *  Single per-prompt-type map covers BOTH sub-prompt resolutions and
   *  full-canonical entry-point selections (they share cursors so that the
   *  alignment property documented on `selectEntryPoint` holds). */
  snapshotCursors(): Map<number, number> {
    return new Map(this.cursors);
  }

  restoreCursors(snap: Map<number, number>): void {
    for (const [k, v] of snap) this.cursors.set(k, v);
  }
}

// =============================================================================
// G2 — non-trivial sub-prompt detection + cartesian expansion (2026-05-03).
// =============================================================================

/** G2 — message types we treat as "non-trivial" when they offer >1 choice
 *  during macro expansion. SELECT_POSITION / SELECT_EFFECTYN / SELECT_YESNO /
 *  SELECT_OPTION / SELECT_TRIBUTE-min1 / ANNOUNCE_NUMBER / RPS / opp pass
 *  remain absorbed by the policy regardless of cardinality (POC scope per
 *  H1 design). */
const G2_BRANCHABLE_MSG_TYPES: ReadonlySet<number> = new Set([
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SELECT_SUM,
]);

/** G2 hard cap on sub-prompt branchings per candidate macro. When the
 *  cartesian product would exceed this, the enumerator truncates at the
 *  first prefix that fits and logs a warning. */
const G2_MAX_VARIANTS_PER_MACRO = 50;

/** Per-message numeric type → response type expected by OCGCore.duelSetResponse
 *  for the message. Mirrors EXPECTED_RESPONSE_TYPE in raw-replay-verify.ts.
 *  Only the message types we may branch on under G2 are listed; other types
 *  fall through the trivial policy path and never produce branched
 *  variants. */
function buildSelectCardResponse(
  indices: readonly number[],
  msgType: number,
  msg: Record<string, unknown>,
): Record<string, unknown> {
  if (msgType === OcgMessageType.SELECT_CARD) {
    return { type: 5, indicies: [...indices] };
  }
  if (msgType === OcgMessageType.SELECT_TRIBUTE) {
    return { type: 12, indicies: [...indices] };
  }
  if (msgType === OcgMessageType.SELECT_SUM) {
    return { type: 14, indicies: [...indices] };
  }
  if (msgType === OcgMessageType.SELECT_UNSELECT_CARD) {
    if (indices.length === 0 && msg['can_finish']) {
      return { type: 7, index: null };
    }
    return { type: 7, index: indices[0] ?? 0 };
  }
  if (msgType === OcgMessageType.SELECT_PLACE) {
    const places = decodeFieldMask(msg['field_mask'] as number, msg['count'] as number);
    const idx = indices[0] ?? 0;
    return { type: 10, places: idx < places.length ? [places[idx]] : [places[0]] };
  }
  if (msgType === OcgMessageType.SELECT_DISFIELD) {
    const places = decodeFieldMask(msg['field_mask'] as number, msg['count'] as number);
    const idx = indices[0] ?? 0;
    return { type: 9, places: idx < places.length ? [places[idx]] : [places[0]] };
  }
  return { type: 5, indicies: [...indices] };
}

/** G2 — generate the candidate branch indices for a non-trivial prompt. We
 *  enumerate the FIRST `min` cards/places (single-pick branching). For
 *  SELECT_UNSELECT_CARD we additionally include the "finish" branch when
 *  `can_finish` is true. Cardinality > 1 = non-trivial; cardinality === 1
 *  collapses to the single trivial pick. */
function enumerateG2Branches(
  msg: Record<string, unknown>,
  msgType: number,
): { picks: readonly number[]; isFinish: boolean }[] {
  if (msgType === OcgMessageType.SELECT_PLACE
    || msgType === OcgMessageType.SELECT_DISFIELD) {
    const places = decodeFieldMask(msg['field_mask'] as number, msg['count'] as number);
    if (places.length <= 1) return [{ picks: [0], isFinish: false }];
    const out: { picks: readonly number[]; isFinish: boolean }[] = [];
    for (let i = 0; i < places.length; i++) out.push({ picks: [i], isFinish: false });
    return out;
  }
  if (msgType === OcgMessageType.SELECT_UNSELECT_CARD) {
    // SELECT_UNSELECT_CARD has `select_cards[]` (pickable) + `unselect_cards[]`
    // (already-picked, can be toggled out). Branching only on toggle-in
    // candidates here — toggling out is rare in opening-hand combos and
    // would inflate the cartesian product.
    const selects = (msg['select_cards'] ?? []) as unknown[];
    const out: { picks: readonly number[]; isFinish: boolean }[] = [];
    if (msg['can_finish']) out.push({ picks: [], isFinish: true });
    for (let i = 0; i < selects.length; i++) out.push({ picks: [i], isFinish: false });
    if (out.length === 0) return [{ picks: [0], isFinish: false }];
    return out;
  }
  // SELECT_CARD / SELECT_TRIBUTE / SELECT_SUM — `selects` (NOT `select_cards`).
  const cards = (msg['selects'] ?? []) as unknown[];
  const min = (msg['min'] as number) ?? 1;
  if (cards.length <= min) {
    // Forced pick — no choice (same as trivial).
    return [{ picks: Array.from({ length: min }, (_, i) => i), isFinish: false }];
  }
  // Branch on which `min` cards we pick. POC scope: enumerate one-card-at-a-
  // time choices (pick i + smallest j != i + ... up to min). For min=1 this
  // is the natural enumeration; for min>1 we collapse to "pick first min" +
  // "swap one slot per branch" — keeps the branching factor bounded.
  if (min === 1) {
    return cards.map((_, i) => ({ picks: [i] as readonly number[], isFinish: false }));
  }
  // min >= 2: one anchor branch (first min) + per-replacement branches.
  const out: { picks: readonly number[]; isFinish: boolean }[] = [];
  out.push({ picks: Array.from({ length: min }, (_, i) => i), isFinish: false });
  for (let replaceSlot = 0; replaceSlot < min; replaceSlot++) {
    for (let cand = min; cand < cards.length && out.length < cards.length + 1; cand++) {
      const picks = Array.from({ length: min }, (_, i) => i);
      picks[replaceSlot] = cand;
      out.push({ picks, isFinish: false });
    }
  }
  return out;
}

/** G2 — wrapper policy that consumes a pre-decided list of `chosenSubPrompts`
 *  in order, falling back to the underlying policy for any prompt not
 *  pre-decided. Used by the macro DFS to apply branched sub-prompt picks
 *  generated at enumeration time, while still letting trivial prompts go
 *  through the trivial policy path. Cursor advances on each consumption;
 *  exhausted = falls through. */
class ChosenSubPromptsReplayPolicy implements SubPromptPolicy {
  private cursor = 0;
  constructor(
    private readonly chosen: readonly SubPromptResolution[],
    private readonly fallback: SubPromptPolicy,
  ) {}

  resolve(
    msg: Record<string, unknown>,
    promptType: PromptType,
    promptPlayer: 0 | 1,
    context: SubPromptContext,
  ): SubPromptResolution | null {
    if (this.cursor < this.chosen.length) {
      const next = this.chosen[this.cursor];
      // Match by promptType + player to avoid drift if the engine's prompt
      // sequence diverges from what was captured at enumeration time. On
      // mismatch we fall through to the fallback (mirrors raw-replay-verify
      // semantics on responseIdx mismatch).
      if (next.promptType === promptType && next.promptPlayer === promptPlayer) {
        this.cursor++;
        return next;
      }
    }
    return this.fallback.resolve(msg, promptType, promptPlayer, context);
  }
}

// =============================================================================
// Macro enumerator — drives OCGCore's prompt loop with a SubPromptPolicy.
// =============================================================================

const MAX_DRAIN_ITERATIONS = 5000;

export class OcgMacroEnumerator implements MacroEnumerator {
  /** G2 toggle. When true, every entry-point's `legalMacros` is post-processed
   *  by `expandMacrosWithG2Branches()` to inline non-trivial sub-prompt
   *  cartesian products. When false, behaviour matches the pre-G2 POC. */
  private readonly g2Enabled: boolean;

  constructor(
    private readonly bridge: OcgCoreBridge,
    opts: { g2Enabled?: boolean } = {},
  ) {
    this.g2Enabled = opts.g2Enabled ?? false;
  }

  enumerateLegalMacros(
    duelId: number,
    policy: SubPromptPolicy,
    context: SubPromptContext,
    stats: PolicyStats,
  ): EnumerationResult {
    const absorbedBefore: SubPromptResolution[] = [];
    let subPromptIdx = context.subPromptIdxInMacro;
    let iter = 0;

    while (iter++ < MAX_DRAIN_ITERATIONS) {
      const status = this.bridge.core.duelProcess(duelId);
      const messages = this.bridge.core.duelGetMessage(duelId) as Record<string, unknown>[];

      for (const msg of messages) {
        const msgType = msg['type'] as number;
        const promptType = MESSAGE_TO_PROMPT[msgType];
        if (!promptType) continue;

        const promptPlayer = ((msg['player'] as number) ?? 0) === 0 ? 0 : 1;
        const subContext: SubPromptContext = {
          ...context,
          subPromptIdxInMacro: subPromptIdx,
        };
        const resolution = policy.resolve(msg, promptType, promptPlayer, subContext);

        if (resolution !== null) {
          this.bridge.core.duelSetResponse(duelId, resolution.response);
          absorbedBefore.push(resolution);
          incrementStats(stats, resolution.source);
          subPromptIdx++;
          continue;
        }

        // Entry-point reached — build legal macros from this prompt. In G2
        // mode, expand each candidate's non-trivial sub-prompts into
        // distinct MacroAction variants (cartesian product, capped at
        // G2_MAX_VARIANTS_PER_MACRO). The expansion uses snapshot/restore
        // around the current WASM state so trial drains are non-destructive.
        const baseMacros = buildLegalMacros(msg, promptType, promptPlayer);
        const legalMacros = this.g2Enabled
          ? this.expandMacrosWithG2Branches(duelId, baseMacros, policy, subContext, stats)
          : baseMacros;
        return {
          kind: 'macros',
          entryPromptType: promptType as 'SELECT_IDLECMD' | 'SELECT_CHAIN',
          entryPromptPlayer: promptPlayer,
          legalMacros,
          absorbedBefore,
        };
      }

      if (status === OcgProcessResult.END) {
        return { kind: 'terminal', reason: 'duel-end', absorbedBefore };
      }
    }

    return {
      kind: 'error',
      reason: `enumerator drained ${MAX_DRAIN_ITERATIONS} iterations without reaching entry-point or terminal`,
    };
  }

  /** G2 expansion: for each base macro candidate, snapshot WASM, apply the
   *  root response, then drive duelProcess until either the next entry-point
   *  or a non-trivial branchable sub-prompt. On each non-trivial sub-prompt,
   *  fork the partial expansion into N variants (one per branchable choice).
   *  Hard cap at G2_MAX_VARIANTS_PER_MACRO per base macro — when exceeded,
   *  truncate and warn (diagnostic-only, doesn't fail the run). */
  private expandMacrosWithG2Branches(
    duelId: number,
    baseMacros: MacroAction[],
    underlyingPolicy: SubPromptPolicy,
    parentContext: SubPromptContext,
    stats: PolicyStats,
  ): MacroAction[] {
    if (baseMacros.length === 0) return baseMacros;

    // Snapshot WASM at the entry-point — every trial expansion forks from
    // here, then we restore for the actual DFS application.
    const entrySnapshot = this.bridge.snapshot();
    const out: MacroAction[] = [];
    let truncatedAny = false;

    for (const baseMacro of baseMacros) {
      // Trial-expand: walk one DFS arm at a time, forking at each non-trivial
      // sub-prompt. Use a worklist of partial chosenSubPrompts prefixes.
      const variants = this.trialExpandMacro(
        duelId, baseMacro, underlyingPolicy, parentContext, entrySnapshot, stats,
      );
      if (variants.truncated) truncatedAny = true;
      for (const v of variants.macros) out.push(v);
    }

    // Restore so the caller still owns the WASM state at the entry-point.
    this.bridge.restore(entrySnapshot);

    if (truncatedAny && process.env['MACRO_DFS_DEBUG']) {
      console.warn(`[g2] truncated some macro expansions at ${G2_MAX_VARIANTS_PER_MACRO} variants`);
    }
    return out;
  }

  /** Per-macro trial expansion. BFS over the sub-prompt branch tree until
   *  cap or all leaves resolved. Each leaf becomes one MacroAction with its
   *  own `chosenSubPrompts` array (the in-order non-trivial picks taken on
   *  that branch). Trivial sub-prompts encountered along the way are NOT
   *  added to chosenSubPrompts (the policy will redo them at DFS time). */
  private trialExpandMacro(
    duelId: number,
    baseMacro: MacroAction,
    underlyingPolicy: SubPromptPolicy,
    parentContext: SubPromptContext,
    entrySnapshot: ArrayBuffer,
    _stats: PolicyStats,
  ): { macros: MacroAction[]; truncated: boolean } {
    interface PartialBranch {
      chosen: SubPromptResolution[];
    }
    const worklist: PartialBranch[] = [{ chosen: [] }];
    const completed: SubPromptResolution[][] = [];
    let truncated = false;

    while (worklist.length > 0 && completed.length < G2_MAX_VARIANTS_PER_MACRO) {
      const branch = worklist.shift()!;

      // Restore + replay branch's chosen prefix from entry-point.
      this.bridge.restore(entrySnapshot);
      this.bridge.core.duelSetResponse(duelId, baseMacro.rootAction._response);

      // Trial drain: feed each chosen sub-prompt in order, then continue
      // until next entry-point / new non-trivial / terminal.
      const trialPolicy = new ChosenSubPromptsReplayPolicy(branch.chosen, underlyingPolicy);
      const drainResult = this.trialDrain(duelId, trialPolicy, parentContext);

      if (drainResult.kind === 'entry-point' || drainResult.kind === 'terminal') {
        // No more non-trivials — branch is complete.
        completed.push(branch.chosen);
      } else if (drainResult.kind === 'non-trivial') {
        // Fork on each candidate pick.
        const branches = enumerateG2Branches(drainResult.msg, drainResult.msgType);
        for (const b of branches) {
          if (worklist.length + completed.length >= G2_MAX_VARIANTS_PER_MACRO) {
            truncated = true;
            break;
          }
          const response = buildSelectCardResponse(b.picks, drainResult.msgType, drainResult.msg);
          worklist.push({
            chosen: [
              ...branch.chosen,
              {
                promptType: drainResult.promptType,
                promptPlayer: drainResult.promptPlayer,
                response,
                source: 'trivial',
              },
            ],
          });
        }
      } else {
        // Error during drain — give up on this branch (treat as completed
        // so we still emit at least the trivial-default variant).
        completed.push(branch.chosen);
      }
    }
    if (worklist.length > 0) truncated = true;

    if (completed.length === 0) {
      // Fallback — emit the base macro unchanged (pre-G2 behaviour).
      return { macros: [baseMacro], truncated };
    }

    const macros: MacroAction[] = completed.map((chosen, idx) => ({
      kind: baseMacro.kind,
      description: chosen.length === 0
        ? baseMacro.description
        : `${baseMacro.description} [g2#${idx}]`,
      rootAction: { ...baseMacro.rootAction },
      absorbedSubPrompts: [...baseMacro.absorbedSubPrompts],
      chosenSubPrompts: chosen,
      promptCount: 1 + baseMacro.absorbedSubPrompts.length + chosen.length,
    }));
    return { macros, truncated };
  }

  /** Single trial drain: drive duelProcess from the post-root-response state,
   *  feeding sub-prompts via `policy`. Stops at:
   *   - new entry-point (own SELECT_IDLECMD / branchable own SELECT_CHAIN)
   *   - non-trivial sub-prompt (G2_BRANCHABLE_MSG_TYPES with cardinality > 1)
   *   - duel terminal
   *   - drain-iteration cap */
  private trialDrain(
    duelId: number,
    policy: SubPromptPolicy,
    parentContext: SubPromptContext,
  ):
    | { kind: 'entry-point' }
    | { kind: 'terminal' }
    | { kind: 'error' }
    | { kind: 'non-trivial';
        msg: Record<string, unknown>;
        msgType: number;
        promptType: PromptType;
        promptPlayer: 0 | 1; }
  {
    let iter = 0;
    let subIdx = parentContext.subPromptIdxInMacro;
    while (iter++ < MAX_DRAIN_ITERATIONS) {
      const status = this.bridge.core.duelProcess(duelId);
      const messages = this.bridge.core.duelGetMessage(duelId) as Record<string, unknown>[];
      for (const msg of messages) {
        const msgType = msg['type'] as number;
        const promptType = MESSAGE_TO_PROMPT[msgType];
        if (!promptType) continue;
        const promptPlayer = ((msg['player'] as number) ?? 0) === 0 ? 0 : 1;
        const subContext: SubPromptContext = {
          ...parentContext,
          subPromptIdxInMacro: subIdx,
        };
        const resolution = policy.resolve(msg, promptType, promptPlayer, subContext);
        if (resolution !== null) {
          this.bridge.core.duelSetResponse(duelId, resolution.response);
          subIdx++;
          continue;
        }
        // Policy returned null → entry-point. But we must distinguish
        // between a "real" entry-point (terminate trial) and a non-trivial
        // sub-prompt that the policy considers branchable.
        if (G2_BRANCHABLE_MSG_TYPES.has(msgType)) {
          // Determine cardinality before declaring it branchable.
          const branches = enumerateG2Branches(msg, msgType);
          if (branches.length > 1) {
            return { kind: 'non-trivial', msg, msgType, promptType, promptPlayer };
          }
          // Cardinality 1 → trivial pick; apply directly and continue.
          const response = buildSelectCardResponse(branches[0].picks, msgType, msg);
          this.bridge.core.duelSetResponse(duelId, response);
          subIdx++;
          continue;
        }
        // True entry-point (IDLECMD / branchable CHAIN).
        return { kind: 'entry-point' };
      }
      if (status === OcgProcessResult.END) return { kind: 'terminal' };
    }
    return { kind: 'error' };
  }
}

function incrementStats(stats: PolicyStats, source: SubPromptResolution['source']): void {
  if (source === 'trivial') stats.trivialResolutions++;
  else if (source === 'seeded') stats.seededResolutions++;
  else stats.autoPassResolutions++;
}

/** Build one MacroAction per legal choice at the entry-point prompt. Mirrors
 *  the relevant cases of `OCGCoreAdapter.enumerateActionsWithResponses` but
 *  collapsed to the two prompts the POC branches on (IDLECMD + CHAIN). */
function buildLegalMacros(
  msg: Record<string, unknown>,
  promptType: PromptType,
  promptPlayer: 0 | 1,
): MacroAction[] {
  if (promptType === 'SELECT_IDLECMD') {
    return buildIdleCmdMacros(msg, promptType, promptPlayer);
  }
  if (promptType === 'SELECT_CHAIN') {
    return buildChainMacros(msg, promptType, promptPlayer);
  }
  return [];
}

function buildIdleCmdMacros(
  msg: Record<string, unknown>,
  promptType: PromptType,
  promptPlayer: 0 | 1,
): MacroAction[] {
  const macros: MacroAction[] = [];
  let idx = 0;
  const summons = (msg['summons'] ?? []) as { code: number }[];
  for (let i = 0; i < summons.length; i++) {
    macros.push(makeMacro('idlecmd', `NS card#${summons[i].code}`,
      makeAction(idx++, summons[i].code, promptType, 'summon', promptPlayer),
      { type: 1, action: 0, index: i }));
  }
  const ssums = (msg['special_summons'] ?? []) as { code: number }[];
  for (let i = 0; i < ssums.length; i++) {
    macros.push(makeMacro('idlecmd', `SS card#${ssums[i].code}`,
      makeAction(idx++, ssums[i].code, promptType, 'ss', promptPlayer),
      { type: 1, action: 1, index: i }));
  }
  const posChanges = (msg['pos_changes'] ?? []) as { code: number }[];
  for (let i = 0; i < posChanges.length; i++) {
    macros.push(makeMacro('idlecmd', `POS card#${posChanges[i].code}`,
      makeAction(idx++, posChanges[i].code, promptType, 'pos', promptPlayer),
      { type: 1, action: 2, index: i }));
  }
  const monsterSets = (msg['monster_sets'] ?? []) as { code: number }[];
  for (let i = 0; i < monsterSets.length; i++) {
    macros.push(makeMacro('idlecmd', `MSET card#${monsterSets[i].code}`,
      makeAction(idx++, monsterSets[i].code, promptType, 'mset', promptPlayer),
      { type: 1, action: 3, index: i }));
  }
  const spellSets = (msg['spell_sets'] ?? []) as { code: number }[];
  for (let i = 0; i < spellSets.length; i++) {
    macros.push(makeMacro('idlecmd', `SSET card#${spellSets[i].code}`,
      makeAction(idx++, spellSets[i].code, promptType, 'sset', promptPlayer),
      { type: 1, action: 4, index: i }));
  }
  // H1.5 (2026-05-03) — propagate `_isEffectActivation` flag from
  // `activates[i].location` exactly like production
  // `OCGCoreAdapter.enumerateActionsWithResponses` does. Required so the
  // macro DFS engine can build a path-local `activationLog` to feed the
  // scorer for OPT-aware evaluation.
  const activates = (msg['activates'] ?? []) as
    { code: number; location?: number }[];
  for (let i = 0; i < activates.length; i++) {
    const action = makeAction(idx++, activates[i].code, promptType, 'activate', promptPlayer);
    action._isEffectActivation = isFieldActivation(activates[i].location);
    macros.push(makeMacro('idlecmd', `ACTIVATE card#${activates[i].code}`,
      action,
      { type: 1, action: 5, index: i }));
  }
  if (msg['to_bp']) {
    macros.push(makeMacro('idlecmd', 'GO TO BP',
      makeAction(idx++, 0, promptType, 'to_bp', promptPlayer),
      { type: 1, action: 6 }));
  }
  if (msg['to_ep']) {
    macros.push(makeMacro('end-phase', 'END phase',
      makeAction(idx++, 0, promptType, 'to_ep', promptPlayer),
      { type: 1, action: 7 }));
  }
  return macros;
}

function buildChainMacros(
  msg: Record<string, unknown>,
  promptType: PromptType,
  promptPlayer: 0 | 1,
): MacroAction[] {
  const macros: MacroAction[] = [];
  const selects = (msg['selects'] ?? []) as { code: number; location?: number }[];
  for (let i = 0; i < selects.length; i++) {
    const action = makeAction(i, selects[i].code, promptType, 'activate', promptPlayer);
    // H1.5 — same `isFieldActivation` gate as production SELECT_CHAIN
    // enumerator: filters out summon procedures (location === EXTRA).
    action._isEffectActivation = isFieldActivation(selects[i].location);
    macros.push(makeMacro('chain', `CHAIN-ACTIVATE card#${selects[i].code}`,
      action,
      { type: 8, index: i }));
  }
  if (!msg['forced']) {
    macros.push(makeMacro(
      promptPlayer === 0 ? 'chain' : 'opp-pass',
      'PASS chain',
      makeAction(-1, 0, promptType, 'pass', promptPlayer),
      { type: 8, index: null },
    ));
  }
  return macros;
}

function makeAction(
  responseIndex: number,
  cardId: number,
  promptType: PromptType,
  actionTag: string,
  player: 0 | 1,
): Action {
  return {
    responseIndex,
    cardId,
    promptType,
    isExploratory: true,
    actionTag,
    team: player,
  };
}

function makeMacro(
  kind: MacroAction['kind'],
  description: string,
  rootAction: Action,
  rootResponse: Record<string, unknown>,
): MacroAction {
  rootAction._response = rootResponse;
  return {
    kind,
    description,
    rootAction,
    absorbedSubPrompts: [],
    chosenSubPrompts: [],
    promptCount: 1,
  };
}

// =============================================================================
// Macro DFS engine
// =============================================================================

export interface MacroDfsConfig {
  nodeBudget: number;
  timeBudgetMs: number;
  maxDepth?: number;
  expectedBoardCardIds: readonly number[];
  policy: SubPromptPolicy;
  enumerator: MacroEnumerator;
  bridge: OcgCoreBridge;
  /** Tag table — when provided, the DFS engine builds a path-local
   *  `activationLog` and `distinctActivations` set as macros are applied,
   *  and forwards both to `scoreState`. Mirrors the production scorer
   *  contract (`InterruptionScorer.scoreWithCards(fs, log, distinct)`).
   *  When omitted, the engine passes `undefined` to `scoreState` —
   *  legacy POC behaviour. H1.5 (2026-05-03). */
  tags?: Record<string, InterruptionTag>;
  /** Score a captured FieldState. The engine forwards the path-local
   *  activationLog + distinctActivations when `tags` is configured;
   *  otherwise both are `undefined`. */
  scoreState: (
    fieldState: FieldState,
    activationLog?: ActivationLog,
    distinctActivations?: ReadonlySet<number>,
  ) => { score: number; matched: number };
  /** Optional cursor-snapshot hook for policies that maintain advance/rewind
   *  state (SeededCanonicalSubPromptPolicy). The DFS engine calls
   *  `snapshotCursors` before expanding the first child, then `restoreCursors`
   *  before each subsequent sibling — keeps seed lookups consistent with each
   *  branch's own sub-prompt path instead of leaking cursor advancement across
   *  siblings. Both must be defined together, or both omitted. */
  snapshotPolicyCursors?: () => unknown;
  restorePolicyCursors?: (snap: unknown) => void;
  /** Strict mode: when an entry-point provides `selectEntryPoint` BUT it
   *  returns `null` (no canonical match), terminate the branch immediately
   *  instead of falling back to DFS branching. Used by the full-canonical
   *  replay mode so a divergence between the macro engine's enumeration and
   *  the seeded canonical line surfaces as an evaluated terminal at the
   *  divergence point — not a 1000× DFS explosion that scrambles cursors. */
  strictEntryPointSelection?: boolean;
}

export interface MacroDfsResult {
  bestScore: number;
  bestMatched: number;
  bestMatchedCardIds: number[];
  bestMissingCardIds: number[];
  bestPath: MacroAction[];
  bestFieldState?: FieldState;
  totalNodesExplored: number;
  totalPromptsTraversed: number;
  wallTimeMs: number;
  stoppedReason: 'budget-exhausted' | 'time-exhausted' | 'depth-cap' | 'tree-exhausted';
  policyStats: PolicyStats;
}

interface DfsState {
  cfg: MacroDfsConfig;
  rootSnapshot: ArrayBuffer;
  duelId: number;
  startedAtMs: number;
  nodesExplored: number;
  promptsTraversed: number;
  bestScore: number;
  bestMatched: number;
  bestNode: MacroNode | null;
  bestFieldState: FieldState | undefined;
  policyStats: PolicyStats;
  stoppedReason: MacroDfsResult['stoppedReason'];
  /** Set to true when budget/time exhausts mid-recursion — unwinds the stack
   *  without further work. */
  shouldStop: boolean;
  /** H1.5 — path-local activation log + distinct activations set. Mutated
   *  in-place during `expand()` recursion; snapshotted/restored at branch
   *  boundaries so siblings see independent path histories. Undefined when
   *  `cfg.tags` is omitted (legacy POC mode). */
  activationLog: Map<number, number[]> | undefined;
  distinctActivations: Set<number> | undefined;
}

export function runMacroDfs(
  initialDuelId: number,
  cfg: MacroDfsConfig,
): MacroDfsResult {
  const policyStats: PolicyStats = {
    trivialResolutions: 0,
    seededResolutions: 0,
    autoPassResolutions: 0,
    entryPointSelections: { seeded: 0, dfsBranched: 0 },
  };
  const rootSnapshot = cfg.bridge.snapshot();

  const state: DfsState = {
    cfg,
    rootSnapshot,
    duelId: initialDuelId,
    startedAtMs: Date.now(),
    nodesExplored: 0,
    promptsTraversed: 0,
    bestScore: -Infinity,
    bestMatched: -1,
    bestNode: null,
    bestFieldState: undefined,
    policyStats,
    stoppedReason: 'tree-exhausted',
    shouldStop: false,
    activationLog: cfg.tags ? new Map() : undefined,
    distinctActivations: cfg.tags ? new Set() : undefined,
  };

  const root: MacroNode = {
    depth: 0,
    macro: null,
    parent: null,
    children: [],
    promptsTraversedTotal: 0,
  };

  expand(root, state, 0);

  const bestPath = state.bestNode ? collectPath(state.bestNode) : [];
  const expectedSet = new Set(cfg.expectedBoardCardIds);
  const onField = state.bestFieldState ? collectOnFieldCardIds(state.bestFieldState) : new Set<number>();
  const bestMatchedCardIds = [...expectedSet].filter(id => onField.has(id));
  const bestMissingCardIds = [...expectedSet].filter(id => !onField.has(id));

  return {
    bestScore: state.bestScore === -Infinity ? 0 : state.bestScore,
    bestMatched: state.bestMatched < 0 ? 0 : state.bestMatched,
    bestMatchedCardIds,
    bestMissingCardIds,
    bestPath,
    bestFieldState: state.bestFieldState,
    totalNodesExplored: state.nodesExplored,
    totalPromptsTraversed: state.promptsTraversed,
    wallTimeMs: Date.now() - state.startedAtMs,
    stoppedReason: state.stoppedReason,
    policyStats,
  };
}

function expand(node: MacroNode, state: DfsState, currentMacroIdx: number): void {
  if (state.shouldStop) return;
  if (state.nodesExplored >= state.cfg.nodeBudget) {
    state.shouldStop = true;
    state.stoppedReason = 'budget-exhausted';
    return;
  }
  if (Date.now() - state.startedAtMs >= state.cfg.timeBudgetMs) {
    state.shouldStop = true;
    state.stoppedReason = 'time-exhausted';
    return;
  }
  const maxDepth = state.cfg.maxDepth ?? 50;
  if (node.depth >= maxDepth) {
    evaluateLeaf(node, state);
    return;
  }

  const enumeration = state.cfg.enumerator.enumerateLegalMacros(
    state.duelId,
    state.cfg.policy,
    {
      currentMacroIdx,
      subPromptIdxInMacro: 0,
      rootResponseIndex: node.macro?.rootAction.responseIndex ?? -1,
      parentMacroDescription: node.macro?.description ?? '<root>',
    },
    state.policyStats,
  );

  if (enumeration.kind === 'error') {
    evaluateLeaf(node, state);
    return;
  }

  // Account for sub-prompts absorbed before reaching the entry-point — they
  // count as "consumed by the next macro to be applied", added once per
  // child since each sibling re-pays them after restore.
  const absorbedBeforeCount = enumeration.kind === 'macros'
    ? enumeration.absorbedBefore.length
    : enumeration.absorbedBefore.length;

  if (enumeration.kind === 'terminal') {
    node.promptsTraversedTotal += absorbedBeforeCount;
    state.promptsTraversed += absorbedBeforeCount;
    evaluateLeaf(node, state);
    return;
  }

  const allMacros = enumeration.legalMacros;
  if (allMacros.length === 0) {
    evaluateLeaf(node, state);
    return;
  }

  // Entry-point selection: if the policy provides one and returns a hit, the
  // DFS follows it deterministically (zero branching at this node). On miss
  // (null), we fall back to full branching — unless strictEntryPointSelection
  // is true (full-canonical mode), in which case the branch terminates here.
  // Counters drive the `entryPointSelections` diagnostic so the CLI can
  // report the seeded vs branched ratio.
  let macros = allMacros;
  const hasSelectHook = typeof state.cfg.policy.selectEntryPoint === 'function';
  const seededIdx = hasSelectHook
    ? (state.cfg.policy.selectEntryPoint!(
        allMacros,
        enumeration.entryPromptType,
        enumeration.entryPromptPlayer,
      ) ?? null)
    : null;
  if (seededIdx !== null && seededIdx >= 0 && seededIdx < allMacros.length) {
    macros = [allMacros[seededIdx]];
    state.policyStats.entryPointSelections.seeded++;
  } else {
    state.policyStats.entryPointSelections.dfsBranched++;
    if (hasSelectHook && state.cfg.strictEntryPointSelection) {
      // Strict full-canonical mode: surface the divergence as a leaf so the
      // diagnostic shows where the macro engine and the canonical line
      // disagree, instead of exploding into DFS branches.
      evaluateLeaf(node, state);
      return;
    }
  }

  // Snapshot the engine state at the entry-point. Each child restores from
  // this snapshot before applying its own macro, so siblings start from
  // bit-identical OCGCore state. Same discipline for the seed policy's
  // per-prompt-type cursors when present.
  const branchSnapshot = state.cfg.bridge.snapshot();
  const cursorSnapshot = state.cfg.snapshotPolicyCursors?.();
  // H1.5 — snapshot the path-local activation log + distinct set so each
  // sibling restarts from the parent's state, not from the previous
  // sibling's leaked mutations. Mirrors `cloneActivationLog` discipline
  // used by `OCGCoreAdapter.forkViaReplay`.
  const activationLogSnapshot = state.activationLog
    ? cloneMacroActivationLog(state.activationLog)
    : undefined;
  const distinctActivationsSnapshot = state.distinctActivations
    ? new Set(state.distinctActivations)
    : undefined;

  for (let i = 0; i < macros.length; i++) {
    if (state.shouldStop) break;
    if (state.nodesExplored >= state.cfg.nodeBudget) {
      state.shouldStop = true;
      state.stoppedReason = 'budget-exhausted';
      break;
    }

    if (i > 0) {
      state.cfg.bridge.restore(branchSnapshot);
      if (cursorSnapshot !== undefined && state.cfg.restorePolicyCursors) {
        state.cfg.restorePolicyCursors(cursorSnapshot);
      }
      if (activationLogSnapshot && state.activationLog) {
        state.activationLog = cloneMacroActivationLog(activationLogSnapshot);
      }
      if (distinctActivationsSnapshot && state.distinctActivations) {
        state.distinctActivations = new Set(distinctActivationsSnapshot);
      }
    }

    const macro = macros[i];
    macro.absorbedSubPrompts = enumeration.absorbedBefore;
    macro.promptCount = 1 + enumeration.absorbedBefore.length + macro.chosenSubPrompts.length;

    state.cfg.bridge.core.duelSetResponse(state.duelId, macro.rootAction._response);
    state.nodesExplored++;
    state.promptsTraversed += macro.promptCount;
    // H1.5 — record this macro's root activation into the path-local log
    // (mirrors `OCGCoreAdapter.recordActivation` semantics: own-side flag,
    // cardId>0, _isEffectActivation gate). Sub-prompts absorbed during
    // enumeration / replay never carry activation semantics in the POC
    // (DefaultSubPromptPolicy resolves them mechanically), so we don't
    // walk `absorbedSubPrompts` / `chosenSubPrompts`.
    if (state.cfg.tags && state.activationLog && state.distinctActivations) {
      recordMacroActivation(macro.rootAction, state.cfg.tags, state.activationLog, state.distinctActivations);
    }

    // G2: replay pre-decided chosen sub-prompts inline after the root response,
    // before recursing. Trivial sub-prompts that interleave with non-trivials
    // are resolved on the fly via the underlying policy. Any failure / engine
    // divergence terminates the branch as a leaf (defensive — should not
    // happen in practice since chosenSubPrompts came from a successful trial
    // expansion at enumeration time).
    if (macro.chosenSubPrompts.length > 0) {
      const replayOk = replayChosenSubPrompts(state, macro.chosenSubPrompts);
      if (!replayOk) {
        const child: MacroNode = {
          depth: node.depth + 1, macro, parent: node, children: [],
          promptsTraversedTotal: node.promptsTraversedTotal + macro.promptCount,
        };
        node.children.push(child);
        evaluateLeaf(child, state);
        continue;
      }
    }

    const child: MacroNode = {
      depth: node.depth + 1,
      macro,
      parent: node,
      children: [],
      promptsTraversedTotal: node.promptsTraversedTotal + macro.promptCount,
    };
    node.children.push(child);

    if (macro.kind === 'end-phase') {
      // POC scope: end-phase is a search-tree leaf. We still drain to terminal
      // for the field snapshot, but we don't expand children.
      drainAndEvaluate(child, state);
      continue;
    }

    expand(child, state, currentMacroIdx + 1);
  }
}

/** G2 — apply each chosenSubPrompt to OCGCore in order. Between consumed
 *  picks, drain any number of trivial sub-prompts via the underlying policy.
 *  Returns false if an entry-point appears before all chosenSubPrompts are
 *  consumed (engine divergence) or if iteration cap exhausts. */
function replayChosenSubPrompts(
  state: DfsState,
  chosen: readonly SubPromptResolution[],
): boolean {
  let cursor = 0;
  let iter = 0;
  while (cursor < chosen.length && iter++ < MAX_DRAIN_ITERATIONS) {
    const status = state.cfg.bridge.core.duelProcess(state.duelId);
    const messages = state.cfg.bridge.core.duelGetMessage(state.duelId) as Record<string, unknown>[];
    for (const msg of messages) {
      const msgType = msg['type'] as number;
      const promptType = MESSAGE_TO_PROMPT[msgType];
      if (!promptType) continue;
      const promptPlayer = ((msg['player'] as number) ?? 0) === 0 ? 0 : 1;
      // Try to consume the next chosen pick first if the type/player matches.
      if (cursor < chosen.length
        && chosen[cursor].promptType === promptType
        && chosen[cursor].promptPlayer === promptPlayer) {
        state.cfg.bridge.core.duelSetResponse(state.duelId, chosen[cursor].response);
        cursor++;
        continue;
      }
      // Otherwise let the underlying policy resolve it (trivial inter-leave).
      const subContext: SubPromptContext = {
        currentMacroIdx: 0, subPromptIdxInMacro: 0,
        rootResponseIndex: -1, parentMacroDescription: 'g2-replay',
      };
      const resolution = state.cfg.policy.resolve(msg, promptType, promptPlayer, subContext);
      if (resolution !== null) {
        state.cfg.bridge.core.duelSetResponse(state.duelId, resolution.response);
        incrementStats(state.policyStats, resolution.source);
        continue;
      }
      // Entry-point reached before all chosen picks consumed — divergence.
      return false;
    }
    if (status === OcgProcessResult.END) {
      // Duel ended mid-replay — only OK if all picks already consumed.
      return cursor === chosen.length;
    }
  }
  return cursor === chosen.length;
}

function drainAndEvaluate(node: MacroNode, state: DfsState): void {
  const drainResult = state.cfg.enumerator.enumerateLegalMacros(
    state.duelId,
    state.cfg.policy,
    {
      currentMacroIdx: 0,
      subPromptIdxInMacro: 0,
      rootResponseIndex: node.macro?.rootAction.responseIndex ?? -1,
      parentMacroDescription: 'end-phase-drain',
    },
    state.policyStats,
  );
  if (drainResult.kind !== 'error') {
    state.promptsTraversed += drainResult.absorbedBefore.length;
  }
  evaluateLeaf(node, state);
}

function evaluateLeaf(node: MacroNode, state: DfsState): void {
  const fieldState = state.cfg.bridge.captureFieldState(state.duelId);
  // H1.5 — forward the path-local activation log + distinct set to the
  // scorer. `scoreState` accepts undefined for legacy POC mode (no tags
  // configured), in which case the scorer falls back to non-OPT-aware
  // tag credit.
  const { score, matched } = state.cfg.scoreState(
    fieldState,
    state.activationLog,
    state.distinctActivations,
  );
  node.fieldStateAfter = fieldState;
  node.score = score;
  node.matched = matched;

  const isBetter = matched > state.bestMatched
    || (matched === state.bestMatched && score > state.bestScore);
  if (isBetter) {
    state.bestScore = score;
    state.bestMatched = matched;
    state.bestNode = node;
    state.bestFieldState = fieldState;
  }
}

function collectPath(leaf: MacroNode): MacroAction[] {
  const out: MacroAction[] = [];
  let n: MacroNode | null = leaf;
  while (n && n.macro) {
    out.unshift(n.macro);
    n = n.parent;
  }
  return out;
}

function collectOnFieldCardIds(fs: FieldState): Set<number> {
  const ids = new Set<number>();
  const fieldZones = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
                      'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD'] as const;
  for (const z of fieldZones) {
    for (const c of fs.zones[z]) {
      ids.add(c.cardId);
      // overlayCount is just a count; raw OCGCore overlay material codes are
      // not on FieldCard. The CLI's matched count therefore covers main cards
      // only — overlay materials are a known POC limitation, called out in
      // the final report.
    }
  }
  return ids;
}

// =============================================================================
// H1.5 — path-local activation log helpers (2026-05-03).
//
// Mirror the production semantics of `OCGCoreAdapter.recordActivation` and
// `cloneActivationLog` (solver-types.ts) without coupling to the adapter.
// =============================================================================

/** Clone a path-local activation log into a fresh standalone Map. Each
 *  entry's array is reallocated so mutations on the clone do not leak back
 *  to the source. Used at every DFS branch boundary so siblings see the
 *  parent state, not the previous sibling's mutations. */
function cloneMacroActivationLog(src: Map<number, number[]>): Map<number, number[]> {
  const dst = new Map<number, number[]>();
  for (const [k, v] of src) dst.set(k, [...v]);
  return dst;
}

/** Record a single macro's root activation into the path-local log + distinct
 *  set. Mirrors `OCGCoreAdapter.recordActivation` exactly:
 *   - skip when `_isEffectActivation !== true`
 *   - skip when `cardId <= 0` (defensive — pass actions carry cardId=0)
 *   - bump `distinctActivations` only for own-side activations (`team !== 1`)
 *   - look up the tag table and append the disambiguated effect index to
 *     `activationLog[cardId]`; opponent-side tagged activations DO go into
 *     the OPT log (HOPT enforcement is cross-team).
 *  See ocgcore-adapter.ts:2180-2215 for the source of truth. */
function recordMacroActivation(
  action: Action,
  tags: Record<string, InterruptionTag>,
  activationLog: Map<number, number[]>,
  distinctActivations: Set<number>,
): void {
  if (action._isEffectActivation !== true) return;
  if (action.cardId <= 0) return;
  if (action.team !== 1) {
    distinctActivations.add(action.cardId);
  }
  const tag = tags[String(action.cardId)];
  if (!tag) return;
  const effectIndex = disambiguateEffect(tag, action.cardId, action.promptType, action.description);
  const log = activationLog.get(action.cardId);
  if (log) {
    log.push(effectIndex);
  } else {
    activationLog.set(action.cardId, [effectIndex]);
  }
}

// Re-export `OcgLocation` so consumers don't need a second import path.
export { OcgLocation };
