// =============================================================================
// solver-verifier.ts — Deterministic replay of a recommended combo line with
// declared opponent handtrap timings. Public function extracted from the
// worker so smoke tests can call it without booting the piscina pool.
// =============================================================================

import type { OCGCoreAdapter } from './ocgcore-adapter.js';
import type { InterruptionScorer } from './interruption-scorer.js';
import type {
  AdversarialTiming,
  DuelConfig,
  SolverAction,
  VerifyResult,
} from './solver-types.js';

/** Tolerance for final-score comparison between the original solve and the
 *  deterministic replay. `expectedScore` is typically `root.bestScore` from
 *  minimax-MCTS — the max observed across stochastic rollouts, which can
 *  diverge from the children[0] deterministic walk by several points because
 *  simulate() uses epsilon-greedy player policy and random opponent activation
 *  timing inside the rollout. A strict `!==` check would make verify fail on
 *  normal MCTS variance. Semantic: verified means "the replay reached at
 *  least the expected score minus tolerance", which is what the user cares
 *  about (did the advertised line actually work?). */
export const VERIFY_SCORE_TOLERANCE = 5;

const VERIFY_DEBUG = process.env['LOG_LEVEL'] === 'debug';

/** Safety ceiling: prevent infinite loop if opponent prompts repeat endlessly.
 *  Real verifies finish in <30 iterations for normal combos; anything past a
 *  few hundred indicates a bug. */
const MAX_VERIFY_ITERATIONS = 2000;

/**
 * Replay a recommended combo line on a fresh adversarial duel and compare
 * the resulting score against the original solve's advertised score.
 *
 * - `verifyPath` must contain **player actions only**. Opponent activations
 *   are injected via `verifyTimings`, not via mainPath entries. See
 *   `MinimaxMctsSolver.walkRecommendedPath` for how the mainPath is built.
 * - Opponent prompts encountered during replay are resolved via timingMap
 *   lookup (activate declared handtrap) or auto-pass (no timing for this step).
 * - After all player actions are replayed, the final board score is compared
 *   with `expectedScore` using `VERIFY_SCORE_TOLERANCE`.
 *
 * Returns `{ verified: true }` on success, or `{ verified: false, reason, divergenceStep }`
 * describing where the replay diverged.
 */
export function verifyAdversarialPath(
  oracle: OCGCoreAdapter,
  scorer: InterruptionScorer,
  duelConfig: DuelConfig,
  verifyPath: SolverAction[],
  verifyTimings: AdversarialTiming[],
  expectedScore: number,
): VerifyResult {
  if (verifyPath.length === 0) return { verified: true };

  // NOTE: we can't easily assert "verifyPath is player-only" at this layer
  // because a LEGITIMATE player SELECT_CHAIN pass has the same signature
  // as an opponent SELECT_CHAIN pass (cardId=0, responseIndex=-1,
  // actionTag='pass'). The discriminator is the `team` field on the
  // Action, but SolverAction throws it away. The real C1 correctness
  // check happens naturally during replay: a mis-placed opponent-pass
  // entry fails the player-prompt cardId+responseIndex match and surfaces
  // as a regular "expected X but not in legal actions" divergence.

  // Build a timing lookup: playerStepIndex → AdversarialTiming
  const timingMap = new Map<number, AdversarialTiming>();
  for (const t of verifyTimings) {
    timingMap.set(t.stepIndex, t);
  }

  if (VERIFY_DEBUG) {
    console.log('[Solver:verify] start', {
      verifyPathLen: verifyPath.length,
      verifyPath: verifyPath.map(a => `${a.cardName}#${a.responseIndex}`),
      timings: verifyTimings.map(t => `step${t.stepIndex}:${t.handtrapCardName}#${t.responseIndex}`),
      expectedScore,
    });
  }

  const handle = oracle.createDuel(duelConfig);
  try {
    let playerStepIndex = 0;
    let pathIndex = 0;
    let iterations = 0;

    while (pathIndex < verifyPath.length) {
      if (++iterations > MAX_VERIFY_ITERATIONS) {
        return {
          verified: false,
          divergenceStep: pathIndex,
          reason: `Verification loop exceeded ceiling (${MAX_VERIFY_ITERATIONS} iterations)`,
        };
      }

      const legalActions = oracle.getLegalActions(handle);

      // Empty actions means duel ended
      if (legalActions.length === 0) {
        return {
          verified: false,
          divergenceStep: pathIndex,
          reason: `Step ${pathIndex}: duel ended prematurely (expected ${verifyPath.length - pathIndex} more actions)`,
        };
      }

      // Opponent prompt (team === 1): handle via timings or auto-pass
      if (legalActions[0]?.team === 1) {
        const timing = timingMap.get(playerStepIndex);
        if (timing) {
          // Inject the handtrap activation at this timing — dual-check
          // responseIndex + cardId (same discipline as goldfish verifier)
          const match = legalActions.find(
            a => a.responseIndex === timing.responseIndex && a.cardId === timing.handtrapCardId,
          );
          if (!match) {
            if (VERIFY_DEBUG) {
              console.log('[Solver:verify] opponent-timing-not-found', {
                pathIndex, playerStepIndex,
                timingRI: timing.responseIndex, timingCard: timing.handtrapCardName,
                legalRI: legalActions.map(a => `${a.cardId}#${a.responseIndex}`),
              });
            }
            return {
              verified: false,
              divergenceStep: pathIndex,
              reason: `Step ${pathIndex}: opponent timing responseIndex ${timing.responseIndex} (${timing.handtrapCardName}) not in legal actions`,
            };
          }
          if (VERIFY_DEBUG) console.log('[Solver:verify] opp-inject', { playerStepIndex, card: timing.handtrapCardName });
          oracle.applyAction(handle, match);
        } else {
          // No timing for this step — auto-pass (decline chain)
          const pass = legalActions.find(a => a.responseIndex === -1);
          if (pass) {
            if (VERIFY_DEBUG) console.log('[Solver:verify] opp-pass', { playerStepIndex });
            oracle.applyAction(handle, pass);
          } else {
            // No pass option — pick first action (shouldn't happen for SELECT_CHAIN)
            if (VERIFY_DEBUG) console.log('[Solver:verify] opp-forced-first', { playerStepIndex, action: legalActions[0] });
            oracle.applyAction(handle, legalActions[0]);
          }
        }
        continue; // Don't increment pathIndex or playerStepIndex for opponent prompts
      }

      // Player prompt: match against verifyPath
      const expected = verifyPath[pathIndex];
      const match = legalActions.find(
        a => a.responseIndex === expected.responseIndex && a.cardId === expected.cardId,
      );
      if (!match) {
        if (VERIFY_DEBUG) {
          console.log('[Solver:verify] player-action-not-found', {
            pathIndex, playerStepIndex,
            expected: `${expected.cardName}#${expected.responseIndex}(cardId=${expected.cardId})`,
            legal: legalActions.map(a => `${a.cardId}#${a.responseIndex}`),
          });
        }
        return {
          verified: false,
          divergenceStep: pathIndex,
          reason: `Step ${pathIndex}: expected ${expected.cardName} (idx ${expected.responseIndex}) but not in legal actions`,
        };
      }
      if (VERIFY_DEBUG) console.log('[Solver:verify] player-apply', { pathIndex, card: expected.cardName });
      oracle.applyAction(handle, match);
      playerStepIndex++;
      pathIndex++;
    }

    // All actions replayed — compare final board score with tolerance.
    // Must pass the activation log so OPT-aware scoring matches the original
    // solve (which always supplies it via `cloneActivationLog(getActivationLog)`).
    // Without it, any OPT-tracked effect (Baronne, Apollousa, Masquerade, etc.)
    // activated during the combo re-scores at full tariff here → false mismatch.
    const fieldState = oracle.getFieldState(handle);
    const { score: finalScore } = scorer.score(fieldState, oracle.getActivationLog(handle));
    if (VERIFY_DEBUG) console.log('[Solver:verify] final-score', { expectedScore, finalScore, tolerance: VERIFY_SCORE_TOLERANCE });
    if (finalScore < expectedScore - VERIFY_SCORE_TOLERANCE) {
      return {
        verified: false,
        divergenceStep: verifyPath.length,
        reason: `Final board score below expected: got ${finalScore}, expected at least ${expectedScore - VERIFY_SCORE_TOLERANCE} (advertised ${expectedScore})`,
      };
    }
    return { verified: true };
  } catch (err) {
    return {
      verified: false,
      divergenceStep: -1,
      reason: `Verification threw: ${String(err)}`,
    };
  } finally {
    oracle.destroyDuel(handle);
  }
}
