// =============================================================================
// weight-loader-base.ts — Generic ML weights loader factory.
//
// All three ML loaders (graph, neural, verb-policy) share the same boot
// recipe: env-flag check → file existence → JSON parse → schema validate →
// trace + console summary → return weights. This factory absorbs the recipe
// so each concrete loader is ~10 lines of declarative config.
//
// Loud failure mode preserved: when the env-enable flag is set, any load
// failure throws. Silent fallback would mask wiring bugs (Phase B lesson).
// =============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LoadOutcome = 'disabled' | 'loaded' | 'missing' | 'parse-error' | 'validation-failed';

export interface LoaderConfig<T> {
  /** Tag for log prefix + trace `kind` field. e.g. `'neural'`, `'graph'`. */
  loaderName: string;
  /** Env var that gates loading (must equal `'1'` to enable). */
  envEnableVar: string;
  /** Env var to override the default basename. */
  envFileVar: string;
  /** Default basename (without `.json`) when no env override is set. */
  defaultBasename: string;
  /** Subdirectory under `dataDir` containing the weight files. */
  weightsSubdir: string;
  /** Validate parsed JSON. Should throw on schema mismatch. */
  validate: (raw: unknown) => T;
  /** Build the human-readable summary line printed via console.warn on success. */
  summarize: (weights: T) => string;
  /** Optional trace metadata extractor (added to the JSONL trace entry on load). */
  traceMetadata?: (weights: T) => Record<string, unknown>;
}

export interface WeightsLoadOptions {
  dataDir: string;
  basename?: string;
}

interface TraceEntry {
  t: string;
  pid: number;
  kind: string;
  envEnable: string | undefined;
  envFile: string | undefined;
  basename: string | null;
  path: string | null;
  outcome: LoadOutcome;
  errorMessage?: string;
  [extra: string]: unknown;
}

function writeTrace(dataDir: string, entry: TraceEntry): void {
  const tracePath = join(dataDir, 'training-logs', 'loader-trace.jsonl');
  try {
    mkdirSync(dirname(tracePath), { recursive: true });
    appendFileSync(tracePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Tracing must never break solver boot.
  }
}

export function createWeightLoader<T>(cfg: LoaderConfig<T>) {
  return function loadWeightsIfEnabled(opts: WeightsLoadOptions): T | undefined {
    const envEnable = process.env[cfg.envEnableVar];
    const envFile = process.env[cfg.envFileVar];
    const baseTrace = {
      t: new Date().toISOString(),
      pid: process.pid,
      kind: cfg.loaderName,
      envEnable,
      envFile,
    };

    if (envEnable !== '1') {
      writeTrace(opts.dataDir, { ...baseTrace, basename: null, path: null, outcome: 'disabled' });
      return undefined;
    }

    const basename = opts.basename ?? envFile ?? cfg.defaultBasename;
    const path = join(opts.dataDir, cfg.weightsSubdir, `${basename}.json`);

    if (!existsSync(path)) {
      writeTrace(opts.dataDir, { ...baseTrace, basename, path, outcome: 'missing' });
      throw new Error(
        `[${cfg.loaderName}-weights-loader] ${cfg.envEnableVar}=1 but ${path} is missing. ` +
        `Aborting load — silent fallback would mask wiring bugs.`,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      writeTrace(opts.dataDir, { ...baseTrace, basename, path, outcome: 'parse-error', errorMessage: String(err) });
      throw new Error(`[${cfg.loaderName}-weights-loader] failed to parse ${path}: ${String(err)}`);
    }

    let weights: T;
    try {
      weights = cfg.validate(raw);
    } catch (err) {
      writeTrace(opts.dataDir, { ...baseTrace, basename, path, outcome: 'validation-failed', errorMessage: String(err) });
      throw err;
    }

    writeTrace(opts.dataDir, {
      ...baseTrace,
      basename,
      path,
      outcome: 'loaded',
      ...(cfg.traceMetadata?.(weights) ?? {}),
    });
    console.warn(`[${cfg.loaderName}-weights-loader] ${cfg.summarize(weights)}`);
    return weights;
  };
}
