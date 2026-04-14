// =============================================================================
// goldfish-chain-ranker.ts — Heuristic action ranker for goldfish DFS
// Reduces branching factor by prioritizing beneficial chain activations
// and filtering SELECT_BATTLECMD to phase transitions only.
// =============================================================================

import type { ActionRanker } from './solver-strategy.js';
import type { Action, FieldState, PromptType } from './solver-types.js';

export class GoldfishChainRanker implements ActionRanker {
  private _descriptionWarnLogged = false;

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
      || promptType === 'SELECT_EFFECTYN'
      || promptType === 'SELECT_YESNO';
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
