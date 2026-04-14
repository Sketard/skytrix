// =============================================================================
// goldfish-chain-ranker.ts — Heuristic action ranker for goldfish DFS
// Reduces branching factor by prioritizing beneficial chain activations
// and filtering SELECT_BATTLECMD to phase transitions only.
// =============================================================================

import type { ActionRanker } from './solver-strategy.js';
import type { Action, FieldState, InterruptionTag, InterruptionType, PromptType } from './solver-types.js';

/** Interruption types that justify promoting a "Set" or "Activate" IDLECMD
 *  action ahead of non-interruption siblings. Cards tagged with any of these
 *  are presumed to be end-board interruption pieces worth the DFS budget to
 *  commit to the board early. */
const INTERRUPTION_PRIORITY_TYPES: ReadonlySet<InterruptionType> = new Set<InterruptionType>([
  'omniNegate', 'typedNegate', 'targetedNegate', 'floodgate', 'destruction',
]);

export class GoldfishChainRanker implements ActionRanker {
  private _descriptionWarnLogged = false;
  private readonly tags: Record<string, InterruptionTag>;

  constructor(tags: Record<string, InterruptionTag> = {}) {
    this.tags = tags;
  }

  /** Reset warn flag so each solve gets at most one warning. */
  resetWarnFlag(): void {
    this._descriptionWarnLogged = false;
  }

  rank(actions: Action[], _state: FieldState): Action[] {
    if (actions.length === 0) return actions;

    const promptType = actions[0].promptType;

    if (promptType === 'SELECT_CHAIN') {
      return this.rankChain(actions);
    }

    if (promptType === 'SELECT_BATTLECMD') {
      return this.rankBattleCmd(actions);
    }

    if (promptType === 'SELECT_IDLECMD') {
      return this.rankIdleCmd(actions);
    }

    // SELECT_EFFECTYN / SELECT_YESNO: OCGCore convention is resp=1=yes,
    // resp=0=no. In goldfish mode, declining a triggered effect is almost
    // never correct (there's no opponent to counter it). Prefer yes.
    // Test 2 from the empirical-validation spike: DFS explored both paths
    // but the "no" branches dominated bestScore because they terminated
    // sooner with equivalent "do nothing" boards. Putting "yes" first
    // does not change what's explored (DFS visits all children) but
    // aligns the enumeration order with the one the heuristic walker uses.
    if (promptType === 'SELECT_EFFECTYN' || promptType === 'SELECT_YESNO') {
      return this.rankYesNo(actions);
    }

    return actions;
  }

  /**
   * Single source of truth for which prompts this ranker actually inspects.
   * Keep in sync with the rank() dispatch above. Note: rank() ignores _state
   * today, but the contract still flags these prompts so future scoring
   * heuristics that DO read state don't silently bypass the FieldState fetch.
   */
  needsState(promptType: PromptType): boolean {
    return promptType === 'SELECT_CHAIN'
      || promptType === 'SELECT_BATTLECMD'
      || promptType === 'SELECT_IDLECMD'
      || promptType === 'SELECT_EFFECTYN'
      || promptType === 'SELECT_YESNO';
  }

  /** True iff `cardId` has at least one tagged effect of a priority type. */
  private hasPriorityTag(cardId: number): boolean {
    const tag = this.tags[String(cardId)];
    if (!tag) return false;
    for (const eff of tag.effects) {
      if (INTERRUPTION_PRIORITY_TYPES.has(eff.type)) return true;
    }
    return false;
  }

  /** Priority score for one IDLECMD action. Higher = explored first.
   *  Stable-sorted within a priority so the OCG raw order is preserved
   *  among ties (no regression for fixtures that do not rely on tag-
   *  promoted actions).
   *
   *  Tier reference:
   *    2 — Set an interruption-tagged spell/trap (e.g. Mitsurugi Purification),
   *        OR activate a main-phase ignition effect of a tagged card
   *    0 — Normal summon, special summon, pos change, monster set, plain set/activate
   *   -1 — Phase advance (to_bp, to_ep) — explore in-phase options first
   *
   *  Note: SS is NOT promoted above NS. Initial tier 1 promotion for SS
   *  caused Mitsurugi regression (-9 score) by commuting the opening from
   *  the Ryzeal NS-first line to a Habakiri reveal-SS line that found one
   *  canonical card but lost the Bagooska end-board tower (empirical
   *  2026-04-15 IDLECMD-ordering run). Baseline raw OCG order is preserved
   *  for all untagged-card paths via stable sort on original index. */
  private idleCmdPriority(a: Action): number {
    const tag = a.actionTag;
    if (tag === 'sset' && this.hasPriorityTag(a.cardId)) return 2;
    if (tag === 'activate' && this.hasPriorityTag(a.cardId)) return 2;
    if (tag === 'to_bp' || tag === 'to_ep') return -1;
    return 0;
  }

  private rankIdleCmd(actions: Action[]): Action[] {
    // Attach sort key + original index, stable-sort by descending priority,
    // tie-break by original index so OCG raw order is preserved for equal
    // priorities. Prevents regressions on fixtures where no card is tagged.
    const keyed = actions.map((a, i) => ({ a, i, p: this.idleCmdPriority(a) }));
    keyed.sort((x, y) => (y.p - x.p) || (x.i - y.i));
    return keyed.map(k => k.a);
  }

  private rankYesNo(actions: Action[]): Action[] {
    // Put resp=1 (yes) first, resp=0 (no) second. If the list has other
    // shapes (shouldn't for Y/N), leave untouched.
    const yes = actions.filter(a => a.responseIndex === 1);
    const no = actions.filter(a => a.responseIndex === 0);
    const other = actions.filter(a => a.responseIndex !== 0 && a.responseIndex !== 1);
    if (yes.length === 0 && no.length === 0) return actions;
    return [...yes, ...no, ...other];
  }

  private rankChain(actions: Action[]): Action[] {
    const activations = actions.filter(a => a.actionTag !== 'pass');
    const pass = actions.filter(a => a.actionTag === 'pass');

    // Phase C — SELECT_CHAIN pass-first ordering.
    //
    // Previous behavior (round 5 and earlier): activations-first with a
    // single-activation auto-prune (if only 1 activation + 1 pass, drop
    // pass entirely and force the activation). That heuristic assumed any
    // activatable chain effect is beneficial — which is true for the core
    // combo line (Cartesia, Branded Fusion activate in chain), but FALSE
    // for turn-start trigger-chain effects (Fuwalos, Maxx "C", Ash Blossom,
    // other handtrap-style mandatory-offer cards that appear in the
    // player's SELECT_CHAIN list without being beneficial on the player's
    // own turn). D/D/D and Mitsurugi were stuck in
    // `mainPath=[Fuwalos, Fuwalos, pass, ...]` because the auto-prune
    // force-activated Fuwalos twice before the DFS ever reached the first
    // IDLECMD where Savant Kepler could be Normal Summoned (synthesis
    // Appendix A).
    //
    // Phase C fix: pass FIRST, activations after. DFS still explores
    // every activation because both branches are returned, but `pass` is
    // tried first — which means time-budget-constrained searches reach
    // the post-chain IDLECMD sooner. Beneficial activations (Cartesia,
    // Branded Fusion) still get picked later in the enumeration if they
    // outscore pass, because tree propagation uses `max` over children
    // regardless of order.
    //
    // Single-activation prune removed entirely: the 2x chain-window cost
    // is acceptable because (a) TT dedupes equivalent post-chain states,
    // (b) the DFS time budget is 60 s and even Branded (heavy chain-
    // window load) completes without depth cap at this config.
    this.warnMissingDescriptions(activations);
    return [...pass, ...activations];
  }

  private rankBattleCmd(actions: Action[]): Action[] {
    // Goldfish: skip individual attacks (permutations waste budget with zero score impact)
    // Keep only to_m2, or to_ep if to_m2 unavailable
    const toM2 = actions.find(a => a.actionTag === 'to_m2');
    if (toM2) return [toM2];

    const toEp = actions.find(a => a.actionTag === 'to_ep');
    if (toEp) return [toEp];

    return actions;
  }

  private warnMissingDescriptions(activations: Action[]): void {
    if (this._descriptionWarnLogged) return;
    for (const a of activations) {
      if (typeof a.description !== 'string') {
        console.log(`[Solver] WARN: SELECT_CHAIN action missing description, cardId=${a.cardId}`);
        this._descriptionWarnLogged = true;
        return;
      }
    }
  }
}
