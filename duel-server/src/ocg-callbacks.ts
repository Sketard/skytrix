import type { OcgCardData } from '@n1xx1/ocgcore-wasm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardDB, ScriptDB } from './types.js';
import * as logger from './logger.js';

// =============================================================================
// Card Reader Factory
// =============================================================================

export function createCardReader(db: CardDB): (code: number) => OcgCardData | null {
  return (code: number): OcgCardData | null => {
    const row = db.stmt.get(code) as Record<string, number | bigint> | undefined;
    if (!row) {
      logger.warn('[CardReader] Card not found in cards.cdb', { code });
      return null;
    }

    // Decode setcodes from packed 64-bit integer
    const setcodes: number[] = [];
    let sc = BigInt(row['setcode'] as number | bigint);
    for (let i = 0; i < 4; i++) {
      const val = Number(sc & 0xFFFFn);
      if (val) setcodes.push(val);
      sc >>= 16n;
    }

    const level = Number(row['level']);
    const type = Number(row['type']);
    const def = Number(row['def']);
    // TYPE_LINK = 0x4000000. For Link monsters, the `def` column stores the
    // link marker bitmask (arrows); their actual defense stat is conventionally
    // 0 since Link monsters don't have DEF. For non-Link monsters, def is the
    // real defense stat and link_marker is 0.
    const isLink = (type & 0x4000000) !== 0;
    const linkMarker = isLink ? def : 0;
    if (isLink && process.env.OCG_DEBUG_LINK_MARKER === '1') {
      logger.debug('[cardReader] Link card', {
        id: row['id'],
        linkMarker,
        linkMarkerHex: '0x' + linkMarker.toString(16),
        level: level & 0xFF,
      });
    }

    return {
      code: Number(row['id']),
      alias: Number(row['alias']),
      setcodes,
      type,
      level: level & 0xFF,
      lscale: (level >> 24) & 0xFF,
      rscale: (level >> 16) & 0xFF,
      attack: Number(row['atk']),
      defense: isLink ? 0 : def,
      race: BigInt(row['race']),
      attribute: Number(row['attribute']),
      link_marker: linkMarker,
    };
  };
}

// =============================================================================
// Script Reader Factory
// =============================================================================

export function createScriptReader(scripts: ScriptDB): (name: string) => string | null {
  return (name: string): string | null => {
    // Check startup scripts first (already in memory)
    const startup = scripts.startupScripts.get(name);
    if (startup !== undefined) return startup;

    // Search on-demand: scripts/{name}, scripts/official/{name}
    const locations = [
      join(scripts.basePath, name),
      join(scripts.basePath, 'official', name),
    ];

    for (const path of locations) {
      if (existsSync(path)) {
        return readFileSync(path, 'utf-8');
      }
    }

    // ocgcore probes `c0.lua` for its internal code-0 sentinel (token template) on every duel init — expected miss, silenced to match errorHandler's `script not found` filter.
    if (name !== 'c0.lua') logger.warn('[ScriptReader] Not found', { name });
    return null;
  };
}
