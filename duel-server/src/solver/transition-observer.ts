// =============================================================================
// transition-observer.ts — append-only JSONL logger for graph-ml-v1 / v2.
//
// Records (fromCardId, toCardId, promptType, depth, fixtureId) tuples emitted
// by the runtime `GraphGuidedRanker` when an action is selected. The output
// stream is consumed offline (M1+: metrics; v2 E4: enrichment of the edges
// catalog with empirically observed transitions the mechanical extractor
// missed).
//
// Design constraints :
//   - zero overhead when disabled (the ranker checks `.enabled` once per call).
//   - buffered writes (flush every N events OR on `close()`). Sync fsync is
//     not needed — losses at abort are acceptable for training telemetry.
//   - deterministic: records are plain JSON lines, one per transition.
//
// Enable via `SOLVER_OBSERVE_TRANSITIONS=1` and optionally
// `SOLVER_OBSERVE_PATH=<abs path>` to override the default
// `data/training-logs/transitions.jsonl`.
//
// Roadmap: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TransitionRecord {
  /** UTC ISO stamp for post-hoc ordering / per-session segmentation. */
  t: string;
  /** Fixture (or runtime deck) id — free-form label set by the caller via
   *  `setContext`. Empty string when no context is set. */
  fixtureId: string;
  /** Action's cardId as emitted by DFS (0 for sentinel / no-card prompts). */
  fromCardId: number;
  /** Prompt type at which the action was chosen (e.g., SELECT_IDLECMD). */
  promptType: string;
  /** DFS depth at decision time — set by the caller; 0 if not available. */
  depth: number;
  /** Optional extra payload (score, rankIndex) — kept forward-compat. */
  extra?: Record<string, string | number | boolean>;
}

export class TransitionObserver {
  private readonly path: string;
  private buffer: string[] = [];
  private readonly flushThreshold: number;
  private fixtureId = '';
  /** Writes are silently dropped once this flips (e.g., after fs error). */
  private _enabled: boolean;

  constructor(path: string, flushThreshold = 200) {
    this.path = path;
    this.flushThreshold = flushThreshold;
    this._enabled = true;
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (err) {
      console.warn(`[transition-observer] mkdirSync failed: ${String(err)} — disabling observer`);
      this._enabled = false;
    }
  }

  get enabled(): boolean { return this._enabled; }

  setContext(fixtureId: string): void { this.fixtureId = fixtureId; }

  record(rec: Omit<TransitionRecord, 't' | 'fixtureId'>): void {
    if (!this._enabled) return;
    const entry: TransitionRecord = {
      t: new Date().toISOString(),
      fixtureId: this.fixtureId,
      ...rec,
    };
    this.buffer.push(JSON.stringify(entry));
    if (this.buffer.length >= this.flushThreshold) this.flush();
  }

  flush(): void {
    if (!this._enabled || this.buffer.length === 0) return;
    try {
      appendFileSync(this.path, this.buffer.join('\n') + '\n', 'utf-8');
      this.buffer = [];
    } catch (err) {
      console.warn(`[transition-observer] append failed: ${String(err)} — disabling`);
      this._enabled = false;
      this.buffer = [];
    }
  }

  close(): void { this.flush(); }
}

/** Factory — returns undefined when `SOLVER_OBSERVE_TRANSITIONS` is not 1,
 *  so hot paths can short-circuit via `if (!observer) return`. */
export function maybeCreateObserver(defaultPath: string): TransitionObserver | undefined {
  if (process.env['SOLVER_OBSERVE_TRANSITIONS'] !== '1') return undefined;
  const path = process.env['SOLVER_OBSERVE_PATH'] ?? defaultPath;
  return new TransitionObserver(path);
}
