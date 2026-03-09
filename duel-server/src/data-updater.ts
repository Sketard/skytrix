import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const CARDS_CDB_URL = 'https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/cards.cdb';
const STRINGS_CONF_URL = 'https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf';
const SCRIPTS_REPO = 'https://github.com/ProjectIgnis/CardScripts.git';
const SCRIPTS_DIR_NAME = 'scripts_full';
const SQLITE_MAGIC = 'SQLite format 3';
const MIN_CDB_SIZE = 100_000;

interface UpdateResult {
  cardsUpdated: boolean;
  scriptsUpdated: boolean;
  stringsUpdated: boolean;
  cardsSize?: number;
  scriptsMethod?: 'pull' | 'clone';
}

async function downloadCardsCdb(dataDir: string): Promise<{ updated: boolean; size: number }> {
  const targetPath = join(dataDir, 'cards.cdb');
  const tmpPath = join(dataDir, 'cards.cdb.tmp');
  const backupPath = join(dataDir, 'cards.cdb.backup');

  console.log('[UpdateData] Downloading cards.cdb from ProjectIgnis/BabelCDB...');
  const response = await fetch(CARDS_CDB_URL);

  if (!response.ok) {
    throw new Error(`Failed to download cards.cdb: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Validate SQLite header
  if (buffer.length < 16 || buffer.toString('utf8', 0, SQLITE_MAGIC.length) !== SQLITE_MAGIC) {
    throw new Error(`Invalid SQLite file: bad magic header (size=${buffer.length})`);
  }

  // Validate minimum size (a valid cards.cdb should be > 100KB)
  if (buffer.length < MIN_CDB_SIZE) {
    throw new Error(`Downloaded cards.cdb is suspiciously small (${buffer.length} bytes, expected >${MIN_CDB_SIZE})`);
  }

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

  console.log(`[UpdateData] cards.cdb updated (${buffer.length} bytes)`);
  return { updated: true, size: buffer.length };
}

function updateScripts(dataDir: string): { updated: boolean; method: 'pull' | 'clone' } {
  const scriptsPath = join(dataDir, SCRIPTS_DIR_NAME);
  const gitDir = join(scriptsPath, '.git');

  if (existsSync(gitDir)) {
    console.log('[UpdateData] Pulling latest scripts...');
    execSync('git pull --ff-only', { cwd: scriptsPath, timeout: 120_000, stdio: 'pipe' });
    return { updated: true, method: 'pull' };
  }

  console.log('[UpdateData] Cloning CardScripts repository...');
  if (existsSync(scriptsPath)) {
    rmSync(scriptsPath, { recursive: true, force: true });
  }
  mkdirSync(scriptsPath, { recursive: true });
  execSync(`git clone --depth 1 ${SCRIPTS_REPO} ${scriptsPath}`, { timeout: 300_000, stdio: 'pipe' });
  return { updated: true, method: 'clone' };
}

async function downloadStringsConf(dataDir: string): Promise<{ updated: boolean }> {
  const targetPath = join(dataDir, 'strings.conf');

  console.log('[UpdateData] Downloading strings.conf from ProjectIgnis/Distribution...');
  const response = await fetch(STRINGS_CONF_URL);

  if (!response.ok) {
    throw new Error(`Failed to download strings.conf: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.includes('!system')) {
    throw new Error('Downloaded strings.conf appears invalid (missing !system entries)');
  }

  writeFileSync(targetPath, text, 'utf-8');
  console.log(`[UpdateData] strings.conf updated (${text.length} bytes)`);
  return { updated: true };
}

export async function updateData(dataDir: string): Promise<UpdateResult> {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const cardsResult = await downloadCardsCdb(dataDir);
  const stringsResult = await downloadStringsConf(dataDir);
  const scriptsResult = updateScripts(dataDir);

  console.log('[UpdateData] Update complete');

  return {
    cardsUpdated: cardsResult.updated,
    scriptsUpdated: scriptsResult.updated,
    stringsUpdated: stringsResult.updated,
    cardsSize: cardsResult.size,
    scriptsMethod: scriptsResult.method,
  };
}
