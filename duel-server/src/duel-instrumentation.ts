// =============================================================================
// duel-instrumentation.ts — Env-gated timing counters for the duel hot path.
//
// Phase 0b of the perf-audit chantier
// (_bmad-output/planning-artifacts/perf-audit-instrumentation-chantier.md).
//
// Generalizes the pattern proven by `solver/solver-instrumentation.ts` (Rule of
// Three: the solver wrote it once, the duel side is the second use → generalize
// now). Same contract:
//   - Activation: set DUEL_INSTRUMENT=1 in the worker environment before boot.
//   - When absent, every helper is a no-op — a single branch check on a
//     module-load constant V8 folds. Zero hrtime, zero allocation. Safe to
//     ship in prod unused.
//
// Buckets cover the findings the audit flagged on the duel-server hot path:
//   buildBoardState — D-C2/D-M7 (~100 WASM FFI calls per chain event)
//   getCardName     — D-C1/D-M1 (un-memoized SQLite lookup per OCG message)
//   filterMessage   — D-C3      (per-player message sanitization)
//   serialize       — D-C3      (JSON.stringify of the WS payload)
//   duelProcess     — OCGCore step cost (context for the others)
//   workerColdStart — D-M8      (per-duel WASM + cdb + scripts load)
//
// The accumulated snapshot lives in the worker thread. It is surfaced to the
// main process (and thence to GET /status) by the worker posting a WORKER_PERF
// message — see duel-worker.ts. The module itself stays transport-agnostic.
// =============================================================================

const ENABLED = process.env['DUEL_INSTRUMENT'] === '1';

export type DuelBucket =
  | 'buildBoardState'
  | 'getCardName'
  | 'filterMessage'
  | 'serialize'
  | 'duelProcess'
  | 'preProcessOverlays'
  | 'workerColdStart';

const BUCKETS: DuelBucket[] = [
  'buildBoardState',
  'getCardName',
  'filterMessage',
  'serialize',
  'duelProcess',
  'preProcessOverlays',
  'workerColdStart',
];

// Histogram edges in nanoseconds — shared across buckets. Wide enough to cover
// a sub-microsecond SQLite cache hit and a 50ms+ buildBoardState in one scale.
const HIST_EDGES_NS: bigint[] = [
  1_000n,        // <1µs
  10_000n,       // <10µs
  100_000n,      // <100µs
  1_000_000n,    // <1ms
  10_000_000n,   // <10ms
  50_000_000n,   // <50ms
];
const HIST_LABELS = ['<1µs', '1-10µs', '10-100µs', '100µs-1ms', '1-10ms', '10-50ms', '50ms+'];

interface BucketCounters {
  count: number;
  nsTotal: bigint;
  nsMax: bigint;
  nsHist: number[]; // length HIST_LABELS.length
}

function emptyBucket(): BucketCounters {
  return { count: 0, nsTotal: 0n, nsMax: 0n, nsHist: new Array(HIST_LABELS.length).fill(0) };
}

function emptyCounters(): Record<DuelBucket, BucketCounters> {
  const c = {} as Record<DuelBucket, BucketCounters>;
  for (const b of BUCKETS) c[b] = emptyBucket();
  return c;
}

let counters = emptyCounters();

export interface BucketSnapshot {
  bucket: DuelBucket;
  count: number;
  msTotal: number;
  msMean: number;
  msMax: number;
  hist: { label: string; count: number }[];
}

export interface DuelInstrumentationSnapshot {
  enabled: boolean;
  buckets: BucketSnapshot[];
}

export function instrumentationEnabled(): boolean {
  return ENABLED;
}

export function reset(): void {
  counters = emptyCounters();
}

/** Record a measured duration (in ns) under a bucket. Internal — exported for
 *  the rare call site that already has its own hrtime span (e.g. an async
 *  region `time()` cannot wrap). No-op when instrumentation is disabled. */
export function record(bucket: DuelBucket, ns: bigint): void {
  if (!ENABLED) return;
  const c = counters[bucket];
  c.count++;
  c.nsTotal += ns;
  if (ns > c.nsMax) c.nsMax = ns;
  let bin = HIST_EDGES_NS.length;
  for (let i = 0; i < HIST_EDGES_NS.length; i++) {
    if (ns < HIST_EDGES_NS[i]) { bin = i; break; }
  }
  c.nsHist[bin]++;
}

/** Time a synchronous callback under the given bucket. Zero overhead when
 *  instrumentation is disabled — the ENABLED constant is set at module load
 *  so V8 folds the branch. */
export function time<T>(bucket: DuelBucket, fn: () => T): T {
  if (!ENABLED) return fn();
  const t0 = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    record(bucket, process.hrtime.bigint() - t0);
  }
}

function nsToMs(ns: bigint): number {
  // bigint -> float ms. Convert to Number FIRST, then divide — the old
  // `Number(ns / 1000n) / 1000` floored any sub-microsecond span to 0ms via
  // the integer bigint division, which zeroed the mean/total of fast hot
  // paths (e.g. a memoized getCardName cache hit). Number(bigint) is exact
  // up to 2^53 ns (~104 days) — far beyond any measured span here.
  return Number(ns) / 1_000_000;
}

export function snapshot(): DuelInstrumentationSnapshot {
  return {
    enabled: ENABLED,
    buckets: BUCKETS.map((bucket) => {
      const c = counters[bucket];
      return {
        bucket,
        count: c.count,
        msTotal: nsToMs(c.nsTotal),
        msMean: c.count > 0 ? nsToMs(c.nsTotal) / c.count : 0,
        msMax: nsToMs(c.nsMax),
        hist: HIST_LABELS.map((label, i) => ({ label, count: c.nsHist[i] })),
      };
    }),
  };
}
