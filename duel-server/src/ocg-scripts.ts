import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CardDB, ScriptDB } from './types.js';

// =============================================================================
// Startup Scripts — 20 Lua files loaded before startDuel()
// =============================================================================

export const STARTUP_SCRIPTS = [
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
    const path = join(scriptDir, name);
    if (existsSync(path)) {
      startupScripts.set(name, readFileSync(path, 'utf-8'));
    } else {
      console.warn(`[Scripts] Startup script not found: ${name}`);
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
    console.warn(`[Scripts] strings.conf not found: ${filePath}`);
    return map;
  }
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^!system\s+(\d+)\s+(.+)/);
    if (match) {
      map.set(Number(match[1]), match[2].trimEnd());
    }
  }
  console.log(`[Scripts] Loaded ${map.size} system strings from strings.conf`);
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
