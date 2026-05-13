import type { ServerMessage } from '../ws-protocol.js';
import * as logger from '../logger.js';

export type ValidationResult = { ok: true } | { ok: false; error: string };

const OK: ValidationResult = { ok: true };
const err = (error: string): ValidationResult => ({ ok: false, error });

/**
 * Validates the shape and bounds of a player's response data against the
 * pending SELECT_* / SORT_* / ANNOUNCE_* prompt before forwarding it to
 * OCGCore. Returns a `Result<void, string>` discriminated union: `{ ok: true }`
 * on success, `{ ok: false, error }` with a human-readable violation otherwise.
 *
 * This is the last guard before the FFI call into the WASM core: a
 * malformed response (out-of-bounds index, wrong shape, duplicate entry,
 * disallowed cancel) would crash ocgcore. We fail fast with a readable
 * error and surface it as a RETRY upstream.
 *
 * Pure function — no side effects except a single `logger.warn` for
 * SELECT_TRIBUTE diagnostics. Audit finding H8 (test coverage) + L3 (Result type).
 */
export function validateResponseData(prompt: ServerMessage, data: Record<string, unknown>): ValidationResult {
  const p = prompt as unknown as Record<string, unknown>;
  const cards = p['cards'] as unknown[] | undefined;
  const cardsLen = cards?.length ?? 0;

  switch (prompt.type) {
    case 'SELECT_CARD': {
      const indices = data['indices'];
      if (indices === null) {
        return p['cancelable'] ? OK : err('cancel not allowed for this prompt');
      }
      if (!Array.isArray(indices)) return err('indices must be an array');
      const min = (p['min'] as number) ?? 1;
      const max = (p['max'] as number) ?? cardsLen;
      if (indices.length < min || indices.length > max) return err(`indices length ${indices.length} not in [${min}, ${max}]`);
      for (const idx of indices) {
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= cardsLen) {
          return err(`index ${idx} out of bounds [0, ${cardsLen})`);
        }
      }
      if (new Set(indices).size !== indices.length) return err('duplicate indices');
      return OK;
    }

    case 'SELECT_TRIBUTE': {
      // min/max from OCGCore are TRIBUTE COUNTS, not card counts.
      // Each card has an `amount` (release_param) indicating how many tributes it provides.
      // A single card with amount=2 satisfies min=2 by itself.
      const indices = data['indices'];
      if (indices === null) {
        return p['cancelable'] ? OK : err('cancel not allowed for this prompt');
      }
      if (!Array.isArray(indices)) return err('indices must be an array');
      if (indices.length === 0) return err('indices must not be empty');
      if (indices.length > cardsLen) return err(`indices length ${indices.length} exceeds cards length ${cardsLen}`);
      for (const idx of indices) {
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= cardsLen) {
          return err(`index ${idx} out of bounds [0, ${cardsLen})`);
        }
      }
      if (new Set(indices).size !== indices.length) return err('duplicate indices');
      // Validate tribute count (sum of release_param of selected cards)
      const cardsList = cards as Array<Record<string, unknown>> | undefined;
      if (cardsList) {
        const min = (p['min'] as number) ?? 1;
        const max = (p['max'] as number) ?? cardsLen;
        const tributeSum = (indices as number[]).reduce((sum, idx) => {
          const amount = cardsList[idx]?.['amount'] as number | undefined;
          return sum + (typeof amount === 'number' ? amount : 1);
        }, 0);
        logger.warn('SELECT_TRIBUTE validation', { indicesLen: (indices as number[]).length, tributeSum, min, max });
        if (tributeSum < min || tributeSum > max) return err(`tribute sum ${tributeSum} not in [${min}, ${max}]`);
      }
      return OK;
    }

    case 'SELECT_SUM': {
      const indices = data['indices'];
      const mustLen = (p['mustSelect'] as unknown[])?.length ?? 0;
      const totalLen = mustLen + cardsLen;
      if (!Array.isArray(indices)) return err('indices must be an array');
      for (const idx of indices) {
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= totalLen) {
          return err(`index ${idx} out of bounds [0, ${totalLen})`);
        }
      }
      if (new Set(indices).size !== indices.length) return err('duplicate indices');
      return OK;
    }

    case 'SELECT_CHAIN': {
      const idx = data['index'];
      if (idx === null || idx === -1) return OK; // decline chain
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= cardsLen) {
        return err(`index ${idx} out of bounds [0, ${cardsLen})`);
      }
      return OK;
    }

    case 'SELECT_UNSELECT_CARD': {
      const idx = data['index'];
      if (idx === null) return OK; // finish selection
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= cardsLen) {
        return err(`index ${idx} out of bounds [0, ${cardsLen})`);
      }
      return OK;
    }

    case 'SELECT_OPTION': {
      const options = p['options'] as unknown[] | undefined;
      const optLen = options?.length ?? 0;
      const idx = data['index'];
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= optLen) {
        return err(`index ${idx} out of bounds [0, ${optLen})`);
      }
      return OK;
    }

    case 'SORT_CARD':
    case 'SORT_CHAIN': {
      const order = data['order'];
      if (order === null) return OK; // auto-sort
      if (!Array.isArray(order)) return err('order must be an array');
      if (order.length !== cardsLen) return err(`order length ${order.length} !== cards length ${cardsLen}`);
      const seen = new Set<number>();
      for (const idx of order) {
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= cardsLen) {
          return err(`order value ${idx} out of bounds [0, ${cardsLen})`);
        }
        if (seen.has(idx)) return err(`duplicate order value ${idx}`);
        seen.add(idx);
      }
      return OK;
    }

    case 'SELECT_COUNTER': {
      const counts = data['counts'];
      if (!Array.isArray(counts)) return err('counts must be an array');
      if (counts.length !== cardsLen) return err(`counts length ${counts.length} !== cards length ${cardsLen}`);
      const total = (p['count'] as number) ?? 0;
      let sum = 0;
      for (const c of counts) {
        if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) return err(`invalid count value ${c}`);
        sum += c;
      }
      if (sum !== total) return err(`counts sum ${sum} !== required ${total}`);
      return OK;
    }

    case 'SELECT_POSITION': {
      const pos = data['position'];
      if (typeof pos !== 'number') return err('position must be a number');
      const positions = p['positions'] as number[] | undefined;
      if (positions && !positions.includes(pos)) return err(`position ${pos} not in allowed set`);
      return OK;
    }

    case 'SELECT_EFFECTYN':
    case 'SELECT_YESNO': {
      const yes = data['yes'];
      if (typeof yes !== 'boolean') return err('yes must be a boolean');
      return OK;
    }

    case 'SELECT_PLACE':
    case 'SELECT_DISFIELD': {
      const places = data['places'];
      if (!Array.isArray(places)) return err('places must be an array');
      const count = (p['count'] as number) ?? 1;
      if (places.length !== count) return err(`places length ${places.length} !== required ${count}`);
      const allowed = p['places'] as Array<{ player: number; location: number; sequence: number }> | undefined;
      if (allowed) {
        for (const pl of places as Array<{ player: number; location: number; sequence: number }>) {
          if (!allowed.some(a => a.player === pl.player && a.location === pl.location && a.sequence === pl.sequence)) {
            return err(`place p${pl.player}/loc${pl.location}/seq${pl.sequence} not in allowed set`);
          }
        }
      }
      return OK;
    }

    case 'ANNOUNCE_RACE': {
      const value = data['value'];
      if (typeof value !== 'number') return err('value must be a number');
      return OK;
    }

    case 'ANNOUNCE_ATTRIB': {
      const value = data['value'];
      if (typeof value !== 'number') return err('value must be a number');
      return OK;
    }

    case 'ANNOUNCE_NUMBER': {
      const value = data['value'];
      if (typeof value !== 'number') return err('value must be a number');
      const options = p['options'] as number[] | undefined;
      if (options && !options.includes(value)) return err(`value ${value} not in options`);
      return OK;
    }

    case 'SELECT_BATTLECMD':
    case 'SELECT_IDLECMD': {
      const action = data['action'];
      if (typeof action !== 'string' && typeof action !== 'number') return err('action must be string or number');
      return OK;
    }

    // Pre-duel coordinator prompts (since 2026-05-13). The server is the
    // source of truth for the random dice values, so DICE_ROLL accepts any
    // (typically empty) payload. SELECT_FIRST_PLAYER requires a boolean
    // `goFirst` flag and is otherwise rejected so the coordinator never
    // sees a malformed pick.
    case 'DICE_ROLL':
      return OK;

    case 'SELECT_FIRST_PLAYER': {
      const goFirst = data['goFirst'];
      if (typeof goFirst !== 'boolean') return err('goFirst must be a boolean');
      return OK;
    }

    default:
      return OK;
  }
}
