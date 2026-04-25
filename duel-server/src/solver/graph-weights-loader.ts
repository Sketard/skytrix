// =============================================================================
// graph-weights-loader.ts — boot-time loader for graph-ml-v1 trained weights.
//
// Reads `data/trained-weights/<basename>.json` at worker startup, gated on the
// `SOLVER_USE_TUNED_WEIGHTS` env var. Returns `undefined` when disabled.
// **Throws** when enabled but the file is missing/malformed — silent fallback
// previously masked a wiring bug that bypassed the loader entirely.
//
// Diagnostic trace : every call to this loader appends a JSON line to
// `data/training-logs/loader-trace.jsonl` regardless of outcome. The trace
// lets us verify post-hoc which workers loaded which weights and when, without
// relying on stderr propagation through Piscina (which is unreliable).
//
// Roadmap: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  WEIGHTS_SCHEMA_VERSION,
  type GraphWeights,
} from './graph-weights-types.js';

export interface WeightsLoadOptions {
  /** Absolute `data/` dir (resolved by the worker from its own dirname). */
  dataDir: string;
  /** Filename (without extension) under `data/trained-weights/`.
   *  Default: whatever `SOLVER_TUNED_WEIGHTS_FILE` env var is, else `tier-a-latest`. */
  basename?: string;
}

type Outcome = 'disabled' | 'loaded' | 'missing' | 'version-mismatch' | 'parse-error';

interface TraceEntry {
  t: string;
  pid: number;
  envUseTuned: string | undefined;
  envFile: string | undefined;
  basename: string | null;
  path: string | null;
  outcome: Outcome;
  edgeCount?: number;
  tier?: string;
  bestFitness?: number;
  errorMessage?: string;
}

function writeTrace(dataDir: string, entry: TraceEntry): void {
  const tracePath = join(dataDir, 'training-logs', 'loader-trace.jsonl');
  try {
    mkdirSync(dirname(tracePath), { recursive: true });
    appendFileSync(tracePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Tracing must never break a solver boot. Failures here are silent.
  }
}

/** Load trained weights IFF `SOLVER_USE_TUNED_WEIGHTS=1`.
 *
 * **Loud failure mode**: when the env var is set, any load failure throws.
 * Previously the loader silently fell back to untuned, which masked a wiring
 * bug where the `evaluate-structural` worker bypassed the loader entirely
 * (yielding "tuned" gates that were actually untuned).
 *
 * Always emits a JSON trace line to `data/training-logs/loader-trace.jsonl`. */
export function loadTunedWeightsIfEnabled(opts: WeightsLoadOptions): GraphWeights | undefined {
  const envUseTuned = process.env['SOLVER_USE_TUNED_WEIGHTS'];
  const envFile = process.env['SOLVER_TUNED_WEIGHTS_FILE'];
  const baseTrace = {
    t: new Date().toISOString(),
    pid: process.pid,
    envUseTuned,
    envFile,
  };

  if (envUseTuned !== '1') {
    writeTrace(opts.dataDir, { ...baseTrace, basename: null, path: null, outcome: 'disabled' });
    return undefined;
  }

  const basename = opts.basename ?? envFile ?? 'tier-a-latest';
  const path = join(opts.dataDir, 'trained-weights', `${basename}.json`);

  if (!existsSync(path)) {
    writeTrace(opts.dataDir, { ...baseTrace, basename, path, outcome: 'missing' });
    throw new Error(
      `[graph-weights-loader] SOLVER_USE_TUNED_WEIGHTS=1 but ${path} is missing. ` +
      `Aborting load — silent fallback would mask wiring bugs.`,
    );
  }

  let raw: GraphWeights;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8')) as GraphWeights;
  } catch (err) {
    writeTrace(opts.dataDir, {
      ...baseTrace,
      basename,
      path,
      outcome: 'parse-error',
      errorMessage: String(err),
    });
    throw new Error(`[graph-weights-loader] failed to parse ${path}: ${String(err)}`);
  }

  if (raw.version !== WEIGHTS_SCHEMA_VERSION) {
    writeTrace(opts.dataDir, {
      ...baseTrace,
      basename,
      path,
      outcome: 'version-mismatch',
      errorMessage: `expected ${WEIGHTS_SCHEMA_VERSION}, got ${raw.version}`,
    });
    throw new Error(
      `[graph-weights-loader] version mismatch at ${path}: ` +
      `expected ${WEIGHTS_SCHEMA_VERSION}, got ${raw.version}`,
    );
  }

  const edgeCount = Object.keys(raw.edges).length;
  writeTrace(opts.dataDir, {
    ...baseTrace,
    basename,
    path,
    outcome: 'loaded',
    edgeCount,
    tier: raw.tier,
    bestFitness: raw.metadata.bestFitness,
  });
  console.warn(
    `[graph-weights-loader] loaded ${edgeCount} edge weights ` +
    `(tier=${raw.tier}, generations=${raw.metadata.generations}, ` +
    `bestFitness=${raw.metadata.bestFitness.toFixed(3)})`,
  );
  return raw;
}
