// =============================================================================
// solver-instrumentation.ts — Env-gated timing counters for empirical
// validation spike (2026-04-13).
//
// Activation: set SOLVER_INSTRUMENT=1 in the environment before the solver
// worker boots. When absent, all helpers are no-ops (single branch check, no
// hrtime, no allocation). Safe to ship in prod unused.
//
// Used by scripts/spike-empirical-validation.ts to measure where time goes
// per solve (fork vs apply vs score) so we can empirically validate the
// hierarchy proposed in solver-structural-constraints.md.
// =============================================================================

const ENABLED = process.env.SOLVER_INSTRUMENT === '1';

type Bucket = 'fork' | 'apply' | 'score' | 'legalActions' | 'fieldState' | 'rank';

interface Counters {
  forks: number;
  forkNsTotal: bigint;
  forkNsMax: bigint;
  forkNsHist: number[]; // buckets: 0-1ms, 1-5ms, 5-10ms, 10-20ms, 20-50ms, 50ms+
  applies: number;
  applyNsTotal: bigint;
  scores: number;
  scoreNsTotal: bigint;
  legalActions: number;
  legalActionsNsTotal: bigint;
  fieldStates: number;
  fieldStateNsTotal: bigint;
  ranks: number;
  rankNsTotal: bigint;
}

export interface InstrumentationSnapshot {
  enabled: boolean;
  forks: number;
  forkMsTotal: number;
  forkMsMean: number;
  forkMsMax: number;
  forkHist: { label: string; count: number }[];
  applies: number;
  applyMsTotal: number;
  applyMsMean: number;
  scores: number;
  scoreMsTotal: number;
  scoreMsMean: number;
  legalActions: number;
  legalActionsMsTotal: number;
  legalActionsMsMean: number;
  fieldStates: number;
  fieldStateMsTotal: number;
  fieldStateMsMean: number;
  ranks: number;
  rankMsTotal: number;
  rankMsMean: number;
}

const FORK_HIST_EDGES_NS: bigint[] = [
  1_000_000n,    // <1ms
  5_000_000n,    // <5ms
  10_000_000n,   // <10ms
  20_000_000n,   // <20ms
  50_000_000n,   // <50ms
];
const FORK_HIST_LABELS = ['<1ms', '1-5ms', '5-10ms', '10-20ms', '20-50ms', '50ms+'];

function emptyCounters(): Counters {
  return {
    forks: 0,
    forkNsTotal: 0n,
    forkNsMax: 0n,
    forkNsHist: new Array(6).fill(0),
    applies: 0,
    applyNsTotal: 0n,
    scores: 0,
    scoreNsTotal: 0n,
    legalActions: 0,
    legalActionsNsTotal: 0n,
    fieldStates: 0,
    fieldStateNsTotal: 0n,
    ranks: 0,
    rankNsTotal: 0n,
  };
}

let counters: Counters = emptyCounters();

export function instrumentationEnabled(): boolean {
  return ENABLED;
}

export function reset(): void {
  counters = emptyCounters();
}

/** Time a synchronous callback under the given bucket. Zero overhead when
 *  instrumentation is disabled — the ENABLED constant is set at module load
 *  so V8 should fold the branch. */
export function time<T>(bucket: Bucket, fn: () => T): T {
  if (!ENABLED) return fn();
  const t0 = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    const dt = process.hrtime.bigint() - t0;
    if (bucket === 'fork') {
      counters.forks++;
      counters.forkNsTotal += dt;
      if (dt > counters.forkNsMax) counters.forkNsMax = dt;
      let bin = FORK_HIST_EDGES_NS.length;
      for (let i = 0; i < FORK_HIST_EDGES_NS.length; i++) {
        if (dt < FORK_HIST_EDGES_NS[i]) { bin = i; break; }
      }
      counters.forkNsHist[bin]++;
    } else if (bucket === 'apply') {
      counters.applies++;
      counters.applyNsTotal += dt;
    } else if (bucket === 'score') {
      counters.scores++;
      counters.scoreNsTotal += dt;
    } else if (bucket === 'legalActions') {
      counters.legalActions++;
      counters.legalActionsNsTotal += dt;
    } else if (bucket === 'fieldState') {
      counters.fieldStates++;
      counters.fieldStateNsTotal += dt;
    } else {
      counters.ranks++;
      counters.rankNsTotal += dt;
    }
  }
}

const NS_PER_MS = 1_000_000;

function nsToMs(ns: bigint): number {
  // bigint -> float ms; we keep 4 decimals of precision via scaled division.
  return Number(ns / 1000n) / 1000; // us -> ms
}

export function snapshot(): InstrumentationSnapshot {
  return {
    enabled: ENABLED,
    forks: counters.forks,
    forkMsTotal: nsToMs(counters.forkNsTotal),
    forkMsMean: counters.forks > 0 ? nsToMs(counters.forkNsTotal) / counters.forks : 0,
    forkMsMax: nsToMs(counters.forkNsMax),
    forkHist: FORK_HIST_LABELS.map((label, i) => ({ label, count: counters.forkNsHist[i] })),
    applies: counters.applies,
    applyMsTotal: nsToMs(counters.applyNsTotal),
    applyMsMean: counters.applies > 0 ? nsToMs(counters.applyNsTotal) / counters.applies : 0,
    scores: counters.scores,
    scoreMsTotal: nsToMs(counters.scoreNsTotal),
    scoreMsMean: counters.scores > 0 ? nsToMs(counters.scoreNsTotal) / counters.scores : 0,
    legalActions: counters.legalActions,
    legalActionsMsTotal: nsToMs(counters.legalActionsNsTotal),
    legalActionsMsMean: counters.legalActions > 0 ? nsToMs(counters.legalActionsNsTotal) / counters.legalActions : 0,
    fieldStates: counters.fieldStates,
    fieldStateMsTotal: nsToMs(counters.fieldStateNsTotal),
    fieldStateMsMean: counters.fieldStates > 0 ? nsToMs(counters.fieldStateNsTotal) / counters.fieldStates : 0,
    ranks: counters.ranks,
    rankMsTotal: nsToMs(counters.rankNsTotal),
    rankMsMean: counters.ranks > 0 ? nsToMs(counters.rankNsTotal) / counters.ranks : 0,
  };
}
