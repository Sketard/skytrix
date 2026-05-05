// =============================================================================
// neural-weights-loader.ts — Phase B (graph-ml-v2) trained weights loader.
//
// Mirrors `graph-weights-loader.ts` but for `NeuralWeights` (linear or MLP
// over the 95-dim deck-agnostic feature vector). Reads
// `data/trained-weights/<basename>.json` at boot, gated on
// `SOLVER_USE_NEURAL_WEIGHTS=1`. Mutually exclusive with `SOLVER_USE_TUNED_WEIGHTS=1`
// (graph-ml-v1) — the harness picks neural over graph when both are set.
//
// Loud failure mode: when the env var is set, any load failure throws —
// silent fallback masks wiring bugs (Phase B ships with that lesson learnt).
// =============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateFeatureSpec, type NeuralWeights } from './neural-ranker.js';

export interface NeuralWeightsLoadOptions {
  dataDir: string;
  /** Filename (without extension) under `data/trained-weights/`. Default:
   *  `SOLVER_NEURAL_WEIGHTS_FILE` env var, else `neural-tier-a-latest`. */
  basename?: string;
}

type Outcome = 'disabled' | 'loaded' | 'missing' | 'spec-mismatch' | 'parse-error';

interface TraceEntry {
  t: string;
  pid: number;
  kind: 'neural';
  envUseNeural: string | undefined;
  envFile: string | undefined;
  basename: string | null;
  path: string | null;
  outcome: Outcome;
  arch?: string;
  bonusScale?: number;
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

export function loadNeuralWeightsIfEnabled(
  opts: NeuralWeightsLoadOptions,
): NeuralWeights | undefined {
  const envUseNeural = process.env['SOLVER_USE_NEURAL_WEIGHTS'];
  const envFile = process.env['SOLVER_NEURAL_WEIGHTS_FILE'];
  const baseTrace = {
    t: new Date().toISOString(),
    pid: process.pid,
    kind: 'neural' as const,
    envUseNeural,
    envFile,
  };

  if (envUseNeural !== '1') {
    writeTrace(opts.dataDir, { ...baseTrace, basename: null, path: null, outcome: 'disabled' });
    return undefined;
  }

  const basename = opts.basename ?? envFile ?? 'neural-tier-a-latest';
  const path = join(opts.dataDir, 'trained-weights', `${basename}.json`);

  if (!existsSync(path)) {
    writeTrace(opts.dataDir, { ...baseTrace, basename, path, outcome: 'missing' });
    throw new Error(
      `[neural-weights-loader] SOLVER_USE_NEURAL_WEIGHTS=1 but ${path} is missing. ` +
      `Aborting load — silent fallback would mask wiring bugs.`,
    );
  }

  let raw: NeuralWeights;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8')) as NeuralWeights;
  } catch (err) {
    writeTrace(opts.dataDir, {
      ...baseTrace,
      basename,
      path,
      outcome: 'parse-error',
      errorMessage: String(err),
    });
    throw new Error(`[neural-weights-loader] failed to parse ${path}: ${String(err)}`);
  }

  try {
    validateFeatureSpec(raw);
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

  const archStr = raw.arch.hidden.length === 0 ? 'linear' : `mlp[${raw.arch.hidden.join(',')}]`;
  writeTrace(opts.dataDir, {
    ...baseTrace,
    basename,
    path,
    outcome: 'loaded',
    arch: archStr,
    bonusScale: raw.params.bonusScale,
  });
  console.warn(
    `[neural-weights-loader] loaded ${archStr} weights ` +
    `(tier=${raw.tier}, bonusScale=${raw.params.bonusScale}, ` +
    `seed=${raw.metadata?.seed ?? '?'}, gens=${raw.metadata?.generations ?? '?'})`,
  );
  return raw;
}
