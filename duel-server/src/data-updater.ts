import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as logger from './logger.js';
import Database from 'better-sqlite3';

const CARDS_CDB_URL = 'https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/cards.cdb';
const BABEL_CDB_API_URL = 'https://api.github.com/repos/ProjectIgnis/BabelCDB/contents/';
const STRINGS_CONF_URL = 'https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf';
const SCRIPTS_REPO = 'https://github.com/ProjectIgnis/CardScripts.git';
const SCRIPTS_DIR_NAME = 'scripts_full';
const SQLITE_MAGIC = 'SQLite format 3';
const MIN_CDB_SIZE = 100_000;
// Release CDBs hold a single set's worth of cards — much smaller than the
// main cards.cdb. Magic + a small floor still rejects HTML error pages and
// truncated downloads while allowing legitimate single-set files.
const MIN_RELEASE_CDB_SIZE = 4_096;

/**
 * Validate a downloaded SQLite buffer: rejects truncated downloads, HTML error
 * pages served by misconfigured proxies, and bad magic. Throws on failure so
 * the caller decides whether to abort or skip. Shared by `downloadCardsCdb`
 * and `mergeReleaseCdbs`.
 */
function assertValidSqliteBuffer(buffer: Buffer, label: string, minSize: number): void {
  if (buffer.length < 16 || buffer.toString('utf8', 0, SQLITE_MAGIC.length) !== SQLITE_MAGIC) {
    throw new Error(`Invalid SQLite file (${label}): bad magic header (size=${buffer.length})`);
  }
  if (buffer.length < minSize) {
    throw new Error(`Downloaded ${label} is suspiciously small (${buffer.length} bytes, expected >${minSize})`);
  }
}

interface UpdateResult {
  cardsUpdated: boolean;
  scriptsUpdated: boolean;
  stringsUpdated: boolean;
  cardsSize?: number;
  extraCdbsMerged?: number;
  scriptsMethod?: 'pull' | 'clone';
}

async function downloadCardsCdb(dataDir: string): Promise<{ updated: boolean; size: number }> {
  const targetPath = join(dataDir, 'cards.cdb');
  const tmpPath = join(dataDir, 'cards.cdb.tmp');
  const backupPath = join(dataDir, 'cards.cdb.backup');

  logger.log('[UpdateData] Downloading cards.cdb from ProjectIgnis/BabelCDB...');
  const response = await fetch(CARDS_CDB_URL);

  if (!response.ok) {
    throw new Error(`Failed to download cards.cdb: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Validate SQLite header + minimum size as a sanity check on the download.
  // We do NOT verify a checksum or signature against ProjectIgnis — this
  // codebase trusts BabelCDB as its upstream (no signed releases published).
  // The magic + size guard catches truncated downloads, HTML error pages
  // served by a misconfigured proxy, and partial writes; supply-chain
  // integrity relies on the HTTPS connection to raw.githubusercontent.com.
  // Audit finding L8.
  assertValidSqliteBuffer(buffer, 'cards.cdb', MIN_CDB_SIZE);

  writeFileSync(tmpPath, buffer);

  // Verify written file matches what we downloaded
  const written = readFileSync(tmpPath);
  if (written.length !== buffer.length) {
    rmSync(tmpPath, { force: true });
    throw new Error(`Write verification failed: wrote ${written.length} bytes, expected ${buffer.length}`);
  }

  // Backup current file before replacing
  if (existsSync(targetPath)) {
    renameSync(targetPath, backupPath);
  }

  try {
    renameSync(tmpPath, targetPath);
    // Clean up backup on success
    if (existsSync(backupPath)) {
      rmSync(backupPath, { force: true });
    }
  } catch (err) {
    // Restore backup if atomic swap failed
    if (existsSync(backupPath)) {
      renameSync(backupPath, targetPath);
    }
    throw err;
  }

  logger.log(`[UpdateData] cards.cdb updated (${buffer.length} bytes)`);
  return { updated: true, size: buffer.length };
}

function updateScripts(dataDir: string): { updated: boolean; method: 'pull' | 'clone' } {
  const scriptsPath = join(dataDir, SCRIPTS_DIR_NAME);
  const gitDir = join(scriptsPath, '.git');

  if (existsSync(gitDir)) {
    logger.log('[UpdateData] Pulling latest scripts...');
    // Discard any local edits to tracked files. ProjectIgnis/CardScripts is
    // upstream-only — we never author here. Local diffs only appear from
    // older patch attempts (e.g. retired P4) and would block ff-only pulls.
    execSync('git checkout -- .', { cwd: scriptsPath, timeout: 30_000, stdio: 'pipe' });
    execSync('git pull --ff-only', { cwd: scriptsPath, timeout: 120_000, stdio: 'pipe' });
    return { updated: true, method: 'pull' };
  }

  logger.log('[UpdateData] Cloning CardScripts repository...');
  if (existsSync(scriptsPath)) {
    rmSync(scriptsPath, { recursive: true, force: true });
  }
  mkdirSync(scriptsPath, { recursive: true });
  execSync(`git clone --depth 1 ${SCRIPTS_REPO} ${scriptsPath}`, { timeout: 300_000, stdio: 'pipe' });
  return { updated: true, method: 'clone' };
}

async function mergeReleaseCdbs(dataDir: string, mainCdbPath: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(BABEL_CDB_API_URL, { headers: { Accept: 'application/vnd.github.v3+json' } });
  } catch (err) {
    logger.warn('[UpdateData] Cannot reach GitHub API — skipping extra CDBs', { err: err instanceof Error ? err.message : String(err) });
    return 0;
  }

  if (!res.ok) {
    logger.warn(`[UpdateData] GitHub API returned HTTP ${res.status} — skipping extra CDBs`);
    return 0;
  }

  const files = await res.json() as Array<{ name: string; download_url: string }>;
  const EXCLUDED_CDBS = new Set([
    'cards.cdb',
    'cards-rush.cdb',
    'cards-skills.cdb',
    'cards-skills-unofficial.cdb',
    'cards-unofficial.cdb',
    'goat-entries.cdb',
    'prerelease-cards-rush.cdb',
  ]);
  const releaseCdbs = files.filter(f => f.name.endsWith('.cdb') && !EXCLUDED_CDBS.has(f.name));

  if (releaseCdbs.length === 0) {
    logger.log('[UpdateData] No release-*.cdb files found in BabelCDB');
    return 0;
  }

  logger.log(`[UpdateData] Merging ${releaseCdbs.length} release CDB(s): ${releaseCdbs.map(f => f.name).join(', ')}`);

  let totalMerged = 0;
  const db = new Database(mainCdbPath);
  try {
    for (const file of releaseCdbs) {
      const tmpPath = join(dataDir, `${file.name}.tmp`);
      let attached = false;
      try {
        const cdbRes = await fetch(file.download_url);
        if (!cdbRes.ok) {
          logger.warn(`[UpdateData] Failed to download ${file.name}: HTTP ${cdbRes.status}`);
          continue;
        }
        const buffer = Buffer.from(await cdbRes.arrayBuffer());
        assertValidSqliteBuffer(buffer, file.name, MIN_RELEASE_CDB_SIZE);
        writeFileSync(tmpPath, buffer);
        // Escape single quotes in path for SQLite ATTACH
        const safePath = tmpPath.replace(/\\/g, '/').replace(/'/g, "''");
        db.exec(`ATTACH '${safePath}' AS extra`);
        attached = true;
        const { changes } = db.prepare('INSERT OR IGNORE INTO datas SELECT * FROM extra.datas').run();
        db.prepare('INSERT OR IGNORE INTO texts SELECT * FROM extra.texts').run();
        logger.log(`[UpdateData] ${file.name}: ${changes} new card(s) merged`);
        totalMerged += changes;
      } catch (err) {
        // Skip individual CDB on validation / ATTACH / SQL failure — keep
        // processing the rest of the release set. A single corrupt or
        // unexpectedly-shaped file should not abort the whole merge.
        logger.warn(`[UpdateData] Skipping ${file.name}`, { err: err instanceof Error ? err.message : String(err) });
      } finally {
        if (attached) {
          try { db.exec('DETACH extra'); } catch { /* connection state already broken — db.close() in outer finally handles it */ }
        }
        if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
      }
    }
  } finally {
    db.close();
  }

  return totalMerged;
}

async function downloadStringsConf(dataDir: string): Promise<{ updated: boolean }> {
  const targetPath = join(dataDir, 'strings.conf');

  logger.log('[UpdateData] Downloading strings.conf from ProjectIgnis/Distribution...');
  const response = await fetch(STRINGS_CONF_URL);

  if (!response.ok) {
    throw new Error(`Failed to download strings.conf: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.includes('!system')) {
    throw new Error('Downloaded strings.conf appears invalid (missing !system entries)');
  }

  writeFileSync(targetPath, text, 'utf-8');
  logger.log(`[UpdateData] strings.conf updated (${text.length} bytes)`);
  return { updated: true };
}

export async function updateData(dataDir: string): Promise<UpdateResult> {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const cardsResult = await downloadCardsCdb(dataDir);
  const extraCdbsMerged = await mergeReleaseCdbs(dataDir, join(dataDir, 'cards.cdb'));
  const stringsResult = await downloadStringsConf(dataDir);
  const scriptsResult = updateScripts(dataDir);

  logger.log('[UpdateData] Update complete');

  return {
    cardsUpdated: cardsResult.updated,
    scriptsUpdated: scriptsResult.updated,
    stringsUpdated: stringsResult.updated,
    cardsSize: cardsResult.size,
    extraCdbsMerged,
    scriptsMethod: scriptsResult.method,
  };
}
