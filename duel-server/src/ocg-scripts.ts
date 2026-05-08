import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { CardDB, ScriptDB } from './types.js';
import * as logger from './logger.js';

// =============================================================================
// Scripts Hash — cached at startup for replay metadata
// =============================================================================

let cachedScriptsHash: string | null = null;

export function initScriptsHash(scriptDir: string): void {
  if (cachedScriptsHash) return;
  const hash = createHash('sha256');
  hash.update(POLYFILL_LUA_SOURCE);
  const entries = readdirSync(scriptDir, { recursive: true }) as string[];
  const files = entries.filter(f => f.endsWith('.lua')).sort();
  for (const file of files) {
    hash.update(readFileSync(join(scriptDir, file)));
  }
  cachedScriptsHash = hash.digest('hex');
  logger.log('[Scripts] Scripts hash computed', { prefix: cachedScriptsHash.slice(0, 12) });
}

export function getScriptsHash(): string {
  if (!cachedScriptsHash) throw new Error('Scripts hash not initialized — call initScriptsHash() or setScriptsHash() first');
  return cachedScriptsHash;
}

export function setScriptsHash(hash: string): void {
  cachedScriptsHash = hash;
}

export function setOcgcoreVersion(version: string): void {
  cachedOcgcoreVersion = version;
}

// =============================================================================
// OCGCore Version — cached at import time
// =============================================================================

const require = createRequire(import.meta.url);
const pkgPath = join(require.resolve('@n1xx1/ocgcore-wasm'), '..', 'package.json');
let cachedOcgcoreVersion: string = (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }).version;

export function getOcgcoreVersion(): string {
  return cachedOcgcoreVersion;
}

// =============================================================================
// Startup Scripts — 20 Lua files loaded before startDuel()
// =============================================================================

// Inlined polyfill loaded BEFORE proc_workaround.lua. Stubs Duel.GetReasonEffect
// and Duel.GetReasonPlayer which are bound in upstream edo9300/ygopro-core
// (libduel.cpp 4154/4158) but missing in @n1xx1/ocgcore-wasm 0.1.1. Without
// them, the recent CardScripts wrapper for Card.IsRelateToEffect crashes
// silently (see proc_workaround.lua line ~29 in current upstream), causing
// Duel.SpecialSummon to be skipped — e.g. "Fallen of the White Dragon" pays
// its cost but never special-summons.
//
// Inlined (not on disk) so `git pull` of scripts_full can't blow it away.
// Strip when ocgcore-wasm exposes the native bindings.
export const POLYFILL_LUA_NAME = '__skytrix_polyfill.lua';
export const POLYFILL_LUA_SOURCE = `if not Duel.GetReasonEffect then Duel.GetReasonEffect=function() return nil end end
if not Duel.GetReasonPlayer then Duel.GetReasonPlayer=function() return PLAYER_NONE end end
`;

export const STARTUP_SCRIPTS = [
  POLYFILL_LUA_NAME,
  'constant.lua',
  'utility.lua',
  'archetype_setcode_constants.lua',
  'card_counter_constants.lua',
  'cards_specific_functions.lua',
  'deprecated_functions.lua',
  'proc_equip.lua',
  'proc_fusion.lua',
  'proc_fusion_spell.lua',
  'proc_gemini.lua',
  'proc_link.lua',
  'proc_maximum.lua',
  'proc_normal.lua',
  'proc_pendulum.lua',
  'proc_compat.lua',
  'proc_persistent.lua',
  'proc_ritual.lua',
  'proc_spirit.lua',
  'proc_synchro.lua',
  'proc_union.lua',
  'proc_workaround.lua',
  'proc_xyz.lua',
] as const;

// =============================================================================
// Data Loading
// =============================================================================

export function loadDatabase(dbPath: string): CardDB {
  const db = new Database(dbPath, { readonly: true });
  const stmt = db.prepare(
    'SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?'
  );
  const nameStmt = db.prepare('SELECT name FROM texts WHERE id = ?');
  const descStmt = db.prepare('SELECT str1,str2,str3,str4,str5,str6,str7,str8,str9,str10,str11,str12,str13,str14,str15,str16 FROM texts WHERE id = ?');
  return { db, stmt, nameStmt, descStmt };
}

export function loadScripts(scriptDir: string): ScriptDB {
  const startupScripts = new Map<string, string>();

  for (const name of STARTUP_SCRIPTS) {
    if (name === POLYFILL_LUA_NAME) {
      startupScripts.set(name, POLYFILL_LUA_SOURCE);
      continue;
    }
    const path = join(scriptDir, name);
    if (existsSync(path)) {
      startupScripts.set(name, readFileSync(path, 'utf-8'));
    } else {
      logger.warn('[Scripts] Startup script not found', { name });
    }
  }

  return { startupScripts, basePath: scriptDir };
}

/**
 * Parses a strings.conf file (ProjectIgnis format) and returns system strings
 * as a Map from numeric ID to display text.
 * Lines like `!system 1160 Activate it as a Pendulum Spell` → Map { 1160 → "Activate it as a Pendulum Spell" }
 */
export function loadSystemStrings(filePath: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!existsSync(filePath)) {
    logger.warn('[Scripts] strings.conf not found', { filePath });
    return map;
  }
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^!system\s+(\d+)\s+(.+)/);
    if (match) {
      map.set(Number(match[1]), match[2].trimEnd());
    }
  }
  logger.log('[Scripts] Loaded system strings from strings.conf', { count: map.size });
  return map;
}

/**
 * Checks which passcodes exist in the cards.cdb database.
 * Returns the list of passcodes that were NOT found.
 */
export function findMissingPasscodes(dbPath: string, passcodes: number[]): number[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const stmt = db.prepare('SELECT id FROM datas WHERE id = ?');
    return passcodes.filter(code => !stmt.get(code));
  } finally {
    db.close();
  }
}

export function validateData(dbPath: string, scriptDir: string): { ok: boolean; reason?: string } {
  // Lightweight validation — no full data load
  try {
    const db = new Database(dbPath, { readonly: true });
    db.close();
  } catch {
    return { ok: false, reason: `Cannot open cards.cdb at ${dbPath}` };
  }

  if (!existsSync(scriptDir)) {
    return { ok: false, reason: `Scripts directory not found: ${scriptDir}` };
  }

  const entries = readdirSync(scriptDir);
  if (entries.length === 0) {
    return { ok: false, reason: `Scripts directory is empty: ${scriptDir}` };
  }

  return { ok: true };
}
