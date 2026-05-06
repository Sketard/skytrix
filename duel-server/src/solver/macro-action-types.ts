// =============================================================================
// macro-action-types.ts — POC types for macro-action DFS (2026-05-03).
//
// A "macro" = one IDLECMD/CHAIN entry-point + every mechanical sub-prompt that
// can be auto-resolved by a SubPromptPolicy until OCGCore reaches the next
// branch point. Compresses ~5-10× the prompt count of a canonical D/D/D line
// into a tractable search horizon.
//
// 100% standalone — no production solver file imports this module.
// =============================================================================

import type { Action, FieldState, PromptType } from './solver-types.js';

/** Resolution applied to a single mechanical sub-prompt encountered while
 *  expanding a macro. `source` distinguishes default heuristic from canonical
 *  raw-replay seeding (so the POC can report policy mix in stats). */
export interface SubPromptResolution {
  promptType: PromptType;
  promptPlayer: 0 | 1;
  response: Record<string, unknown>;
  /** 'trivial' = single-choice or DefaultSubPromptPolicy heuristic.
   *  'seeded'  = lookup hit on a canonical raw-replay step.
   *  'auto-pass' = opponent fall-through (CHAIN pass, IDLECMD end-phase). */
  source: 'trivial' | 'seeded' | 'auto-pass';
}

/** Macro-action — one branchable entry-point in the compressed DFS tree.
 *
 *  Invariant: every MacroAction returned by `MacroEnumerator.enumerateLegalMacros`
 *  represents one of the legal choices at the SAME entry-point prompt; siblings
 *  are differentiated only by `rootAction.responseIndex`.
 *
 *  `absorbedSubPrompts` carries any pre-entry sub-prompts the enumerator had
 *  to drain (typically empty at IDLECMD; populated when the engine yielded a
 *  trivial CHAIN window that auto-passed before the next branchable prompt).
 *  Sub-prompts AFTER the entry-point are resolved on the NEXT enumerate call,
 *  not stored here. */
export interface MacroAction {
  kind: 'idlecmd' | 'chain' | 'end-phase' | 'opp-pass';
  description: string;
  rootAction: Action;
  absorbedSubPrompts: SubPromptResolution[];
  /** G2 (2026-05-03) — sub-prompts non-triviaux pré-décidés au moment de
   *  l'énumération. Appliqués séquentiellement après le root response.
   *  Distinct de `absorbedSubPrompts` (qui sont les triviaux PRÉ-entry).
   *  Each entry's `response` is fed to OCGCore.duelSetResponse on the next
   *  matching prompt encountered after the root response. Empty array =
   *  pre-G2 behaviour (only root response, sub-prompts resolved on-the-fly
   *  by the policy during the next enumeration call). */
  chosenSubPrompts: SubPromptResolution[];
  /** `1 + absorbedSubPrompts.length + chosenSubPrompts.length`. Cached for
   *  stats aggregation. */
  promptCount: number;
}

/** DFS node in the macro tree. `score` / `matched` / `fieldStateAfter` are
 *  populated only at evaluated leaves — interior nodes stay undefined to keep
 *  memory bounded. */
export interface MacroNode {
  depth: number;
  /** null at the synthetic root only. */
  macro: MacroAction | null;
  parent: MacroNode | null;
  children: MacroNode[];
  fieldStateAfter?: FieldState;
  score?: number;
  matched?: number;
  /** Sum of `macro.promptCount` along the path-to-root. */
  promptsTraversedTotal: number;
}

/** Per-resolution context passed to `SubPromptPolicy.resolve` so seeded
 *  policies can fingerprint a sub-prompt against a canonical raw-replay. */
export interface SubPromptContext {
  /** 0-based index of the macro currently being expanded in the DFS path. */
  currentMacroIdx: number;
  /** 0-based index of this sub-prompt within the current macro expansion. */
  subPromptIdxInMacro: number;
  /** `responseIndex` of the most recent IDLECMD/CHAIN entry-point. -1 before
   *  the first entry. Used by SeededCanonicalSubPromptPolicy to differentiate
   *  identical sub-prompt fingerprints across distinct macro contexts. */
  rootResponseIndex: number;
  parentMacroDescription: string;
}

/** Pluggable resolver for mechanical sub-prompts. Returning `null` signals
 *  that the prompt is NOT mechanical — the macro enumerator must treat it as
 *  a new entry-point and branch.
 *
 *  Optional `selectEntryPoint` is consulted by the macro DFS at every
 *  branchable entry-point (own SELECT_IDLECMD or own non-trivial SELECT_CHAIN).
 *  When defined and returning a non-negative index, the DFS skips branching
 *  and follows that single macro deterministically — this powers the
 *  full-canonical replay mode used to validate that the macro pipeline can
 *  reproduce a known canonical line. Returning `null` (or omitting the
 *  method) keeps full DFS branching at the entry-point. */
export interface SubPromptPolicy {
  resolve(
    msg: Record<string, unknown>,
    promptType: PromptType,
    promptPlayer: 0 | 1,
    context: SubPromptContext,
  ): SubPromptResolution | null;
  selectEntryPoint?(
    legalMacros: MacroAction[],
    entryPromptType: 'SELECT_IDLECMD' | 'SELECT_CHAIN',
    entryPromptPlayer: 0 | 1,
  ): number | null;
}

/** Counters reported by the macro DFS for diagnostics. Fields are mutated
 *  in-place by the engine; CLI snapshots them at the end of a run.
 *  `entryPointSelections` tracks how many entry-points were resolved by the
 *  policy (`seeded`) versus left to DFS branching (`dfsBranched`). */
export interface PolicyStats {
  trivialResolutions: number;
  seededResolutions: number;
  autoPassResolutions: number;
  entryPointSelections: {
    seeded: number;
    dfsBranched: number;
  };
}

export interface EnumerationMacrosResult {
  kind: 'macros';
  entryPromptType: 'SELECT_IDLECMD' | 'SELECT_CHAIN';
  entryPromptPlayer: 0 | 1;
  legalMacros: MacroAction[];
  /** Sub-prompts the enumerator drained BEFORE reaching the entry-point.
   *  Counted in stats but not attached to any specific macro. */
  absorbedBefore: SubPromptResolution[];
}

export interface EnumerationTerminalResult {
  kind: 'terminal';
  reason: 'duel-end' | 'main-phase-exit';
  /** Sub-prompts drained while reaching the terminal. */
  absorbedBefore: SubPromptResolution[];
}

export interface EnumerationErrorResult {
  kind: 'error';
  reason: string;
}

export type EnumerationResult =
  | EnumerationMacrosResult
  | EnumerationTerminalResult
  | EnumerationErrorResult;

/** Enumerator interface — implementations bridge OCGCore's prompt loop with
 *  the macro abstraction. The POC ships one implementation in `macro-dfs.ts`. */
export interface MacroEnumerator {
  /** Advance OCGCore until a branchable entry-point or terminal state.
   *
   *  Contract:
   *   1. Caller passes a `duelId` already restored to the parent state.
   *   2. Enumerator drains mechanical sub-prompts via `policy`.
   *   3. On entry-point hit, returns one MacroAction per legal choice.
   *   4. Caller MUST fork the duel BEFORE applying any macro — applying a
   *      macro mutates OCGCore's WASM state in-place. */
  enumerateLegalMacros(
    duelId: number,
    policy: SubPromptPolicy,
    context: SubPromptContext,
    stats: PolicyStats,
  ): EnumerationResult;
}
