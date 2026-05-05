// =============================================================================
// verb-policy-loader.ts — Phase 3 Stage 3b verb-class policy loader.
//
// Mirrors `neural-weights-loader.ts`. Reads
// `data/policy-weights/<basename>.json` at boot, gated on
// `SOLVER_USE_VERB_POLICY=1`. Compatible with neural weights — they fill
// different roles (value bonus vs move-ordering prior) and can stack.
//
// Loud failure mode: when the env var is set, any load failure throws —
// silent fallback masks wiring bugs (Phase B's "neural loader was wired
// but quietly returning undefined for weeks" lesson).
// =============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateVerbPolicyWeights, type VerbPolicyWeights } from './verb-policy.js';

export interface VerbPolicyLoadOptions {
  dataDir: string;
  /** Filename (with optional subdir, no extension) under `data/policy-weights/`.
   *  Default: `SOLVER_VERB_POLICY_FILE` env var, else `verb-policy-latest`. */
  basename?: string;
}

type Outcome = 'disabled' | 'loaded' | 'missing' | 'spec-mismatch' | 'parse-error';

interface TraceEntry {
  t: string;
  pid: number;
  kind: 'verb-policy';
  envUsePolicy: string | undefined;
  envFile: string | undefined;
  basename: string | null;
  path: string | null;
  outcome: Outcome;
  arch?: string;
  classes?: string[];
  errorMessage?: string;
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

export function loadVerbPolicyIfEnabled(
  opts: VerbPolicyLoadOptions,
): VerbPolicyWeights | undefined {
  const envUsePolicy = process.env['SOLVER_USE_VERB_POLICY'];
  const envFile = process.env['SOLVER_VERB_POLICY_FILE'];
  const baseTrace = {
    t: new Date().toISOString(),
    pid: process.pid,
    kind: 'verb-policy' as const,
    envUsePolicy,
    envFile,
  };

  if (envUsePolicy !== '1') {
    writeTrace(opts.dataDir, { ...baseTrace, basename: null, path: null, outcome: 'disabled' });
    return undefined;
  }

  const basename = opts.basename ?? envFile ?? 'verb-policy-latest';
  const path = join(opts.dataDir, 'policy-weights', `${basename}.json`);

  if (!existsSync(path)) {
    writeTrace(opts.dataDir, { ...baseTrace, basename, path, outcome: 'missing' });
    throw new Error(
      `[verb-policy-loader] SOLVER_USE_VERB_POLICY=1 but ${path} is missing. ` +
      `Aborting load — silent fallback would mask wiring bugs.`,
    );
  }

  let raw: VerbPolicyWeights;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8')) as VerbPolicyWeights;
  } catch (err) {
    writeTrace(opts.dataDir, {
      ...baseTrace,
      basename,
      path,
      outcome: 'parse-error',
      errorMessage: String(err),
    });
    throw new Error(`[verb-policy-loader] failed to parse ${path}: ${String(err)}`);
  }

  try {
    validateVerbPolicyWeights(raw);
  } catch (err) {
    writeTrace(opts.dataDir, {
      ...baseTrace,
      basename,
      path,
      outcome: 'spec-mismatch',
      errorMessage: String(err),
    });
    throw err;
  }

  writeTrace(opts.dataDir, {
    ...baseTrace,
    basename,
    path,
    outcome: 'loaded',
    arch: raw.arch,
    classes: raw.labelClasses,
  });
  console.warn(
    `[verb-policy-loader] loaded ${raw.arch} policy ` +
    `(classes=[${raw.labelClasses.join(',')}], ` +
    `samples=${raw.metadata?.trainingSamples ?? '?'}, ` +
    `cv=${raw.metadata?.cvMeanAccuracy?.toFixed(3) ?? '?'})`,
  );
  return raw;
}
