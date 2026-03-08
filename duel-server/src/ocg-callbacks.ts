import type { OcgCardData } from '@n1xx1/ocgcore-wasm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardDB, ScriptDB } from './types.js';

// =============================================================================
// Card Reader Factory
// =============================================================================

export function createCardReader(db: CardDB): (code: number) => OcgCardData | null {
  return (code: number): OcgCardData | null => {
    const row = db.stmt.get(code) as Record<string, number | bigint> | undefined;
    if (!row) {
      console.warn(`[CardReader] Card not found in cards.cdb: ${code}`);
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

    return {
      code: Number(row['id']),
      alias: Number(row['alias']),
      setcodes,
      type: Number(row['type']),
      level: level & 0xFF,
      lscale: (level >> 24) & 0xFF,
      rscale: (level >> 16) & 0xFF,
      attack: Number(row['atk']),
      defense: Number(row['def']),
      race: BigInt(row['race']),
      attribute: Number(row['attribute']),
      link_marker: 0,
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

    console.warn(`[ScriptReader] Not found: ${name}`);
    return null;
  };
}
