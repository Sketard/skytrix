// =============================================================================
// mechanical-default-oracle.ts — terminal oracle in the PromptResolver chain.
//
// Verbatim migration of OCGCoreAdapter.autoRespondMechanical
// (ocgcore-adapter.ts:1571-1674) + OCGCoreAdapter.autoRespondOpponent
// (ocgcore-adapter.ts:1676-1692) — Phase 0 inventory Track A §"Mechanical
// default layer" + §"Opponent layer".
//
// Coverage discipline (refactor design doc §8): every case currently in the
// adapter is migrated; UNHANDLED cases (ANNOUNCE_RACE/ANNOUNCE_CARD/
// ANNOUNCE_ATTRIB/SORT_CARD/SORT_CHAIN/RPS) keep the legacy solverAssert
// throw. Adding a new default requires a fixture+test backing it (3-step
// process: identify fixture → choose default → add test).
//
// "Always answers" contract: this oracle is terminal in the chain; it MUST
// NOT return `pass`. If the underlying switch falls into the unknown branch,
// it returns the same fallback as the legacy adapter ({type:4, index:0}) so
// the resolver chain produces a result.
// =============================================================================

import { OcgLocation, OcgMessageType, OcgPosition } from '@n1xx1/ocgcore-wasm';
import type { DuelConfig } from './solver-types.js';
import { decodeFieldMask } from './ocg-field-query.js';
import { solverAssert } from './solver-assert.js';
import type { DecisionContext, DecisionOracle, OracleResult } from './prompt-resolver.js';

export class MechanicalDefaultOracle implements DecisionOracle {
  readonly name = 'MechanicalDefaultOracle';

  decide(ctx: DecisionContext): OracleResult {
    if (ctx.player === 1) {
      const opponentResp = autoRespondOpponentImpl(ctx.msg);
      if (opponentResp !== null) {
        return { kind: 'response', response: opponentResp };
      }
      // Opponent fall-through delegates to autoRespondMechanical (legacy
      // behavior at ocgcore-adapter.ts:1690).
    }
    const resp = autoRespondMechanicalImpl(ctx.msg, ctx.config);
    return { kind: 'response', response: resp };
  }
}

/** Verbatim migration of ocgcore-adapter.ts:1571-1674. Must remain bit-exact
 *  with the legacy switch — Phase 3 bit-exact gate compares pre/post on every
 *  fixture in `_bmad-output/solver-data/phase-1-baselines/`. */
export function autoRespondMechanicalImpl(
  msg: Record<string, unknown>,
  config?: DuelConfig,
): unknown {
  const type = (msg as { type: number }).type;
  switch (type) {
    case OcgMessageType.SELECT_POSITION:
      return { type: 11, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.SELECT_PLACE:
      return { type: 10, places: decodeFieldMask(msg['field_mask'] as number, msg['count'] as number) };
    case OcgMessageType.SELECT_DISFIELD:
      return { type: 9, places: decodeFieldMask(msg['field_mask'] as number, msg['count'] as number) };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: 12, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
    case OcgMessageType.SELECT_SUM:
      return { type: 14, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
    case OcgMessageType.SELECT_COUNTER:
      return { type: 13, counters: ((msg['cards'] ?? []) as unknown[]).map(() => 0) };
    case OcgMessageType.SELECT_CARD: {
      const min = (msg['min'] as number) ?? 1;
      const selects = (msg['selects'] as { code?: number; location?: number }[] | undefined) ?? [];
      // Spike-only DECK-only gate (Phase G-iv preferred-targets logic). See
      // ocgcore-adapter.ts:1589-1638 for full rationale (broadening to
      // GY/FIELD caused regressions on Arthalion / GY-sourced selections).
      const preferred = config?.preferredSearchTargets;
      const allFromDeck = selects.length > 0
        && selects.every(s => s.location === OcgLocation.DECK);
      if (allFromDeck && preferred && preferred.length > 0) {
        const preferredIdx: number[] = [];
        for (const prefCode of preferred) {
          if (preferredIdx.length >= min) break;
          for (let i = 0; i < selects.length; i++) {
            if (selects[i].code === prefCode && !preferredIdx.includes(i)) {
              preferredIdx.push(i);
              break;
            }
          }
        }
        if (preferredIdx.length < min) {
          for (let i = 0; i < selects.length && preferredIdx.length < min; i++) {
            if (!preferredIdx.includes(i)) preferredIdx.push(i);
          }
        }
        return { type: 5, indicies: preferredIdx };
      }
      return { type: 5, indicies: Array.from({ length: min }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (msg['can_finish']) return { type: 7, index: null };
      return { type: 7, index: 0 };
    case OcgMessageType.ANNOUNCE_NUMBER: {
      // ANNOUNCE_NUMBER: response `value` is the INDEX of the chosen option,
      // consistent with duel-worker.ts:947 (lastAnnounceNumberOptions.indexOf).
      // Default: index of LAST option = max announced value (combo decks
      // typically want max level-up to enable higher-rank Xyz/Synchro).
      const opts = (msg['options'] as Array<bigint | number> | undefined) ?? [];
      const value = opts.length > 0 ? opts.length - 1 : 0;
      if (process.env.SOLVER_DEBUG_ANNOUNCE === '1') {
        console.log(`[MechanicalDefaultOracle] ANNOUNCE_NUMBER opts=[${opts.map(Number).join(',')}] picked-idx=${value} picked-value=${Number(opts[value] ?? 0)}`);
      }
      return { type: 19, value };
    }
    default:
      // Latent risk on OCGCore upgrades. Throw in dev to surface; fallback
      // in prod so live solves don't crash. Same fail-safe as legacy.
      solverAssert(
        false,
        'MechanicalDefaultOracle.autoRespondMechanical',
        `unhandled msg.type=${type} — falling back to SELECT_OPTION first choice`,
        { msg },
      );
      return { type: 4, index: 0 };
  }
}

/** Verbatim migration of ocgcore-adapter.ts:1676-1692. Returns null when the
 *  message type is not in the opponent goldfish set — caller falls through
 *  to autoRespondMechanicalImpl (matching legacy line 1690). */
export function autoRespondOpponentImpl(msg: Record<string, unknown>): unknown {
  const type = (msg as { type: number }).type;
  switch (type) {
    case OcgMessageType.SELECT_IDLECMD:
      return (msg['to_ep']) ? { type: 1, action: 7 } : { type: 1, action: 6 };
    case OcgMessageType.SELECT_BATTLECMD:
      return (msg['to_ep']) ? { type: 0, action: 3 } : { type: 0, action: 2 };
    case OcgMessageType.SELECT_CHAIN:
      return { type: 8, index: null };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: 2, yes: true };
    case OcgMessageType.SELECT_YESNO:
      return { type: 3, yes: false };
    default:
      // Caller delegates to autoRespondMechanicalImpl.
      return null;
  }
}
