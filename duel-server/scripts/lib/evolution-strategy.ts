// =============================================================================
// evolution-strategy.ts — (μ+λ)-ES for graph weight learning (M1).
//
// Part of graph-ml-v1. See memory roadmap
// `project_graph_ml_v1_roadmap_2026_04_24.md`.
//
// Why (μ+λ)-ES and not CMA-ES (M1 scope decision):
//   - No established CMA-ES package on npm (only @oraclaw/cmaes, unknown maintainer).
//   - CMA-ES requires eigendecomposition + covariance matrix adaptation (~400 LOC
//     non-trivial to implement correctly).
//   - (μ+λ)-ES is sufficient to prove M1 convergence on tier-A (30 dims).
//   - Upgrade path in M2 if sample efficiency matters: either adopt the
//     @oraclaw/cmaes lib OR implement proper CMA-ES in-repo.
//
// Algorithm summary:
//   - μ parents → λ offspring via Gaussian mutation (σ adaptive via 1/5 rule).
//   - Selection: keep top-μ from parents ∪ offspring (the "+" semantics).
//   - σ adapts: if success_rate > 1/5, σ *= c_increase; if <, σ *= c_decrease.
//   - Elitism: best parent always survives (in "+" selection this is automatic).
//
// Deterministic: pass a fixed RNG seed via `config.seed` for reproducibility.
// =============================================================================

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

export interface EvolutionStrategyConfig {
  /** Parent population size. Typical: 10-30. */
  mu: number;
  /** Offspring per generation. Typical: 4-8 × mu. */
  lambda: number;
  /** Initial step-size for Gaussian mutation. Typical: 0.3-1.0 (domain-dependent). */
  initialSigma: number;
  /** Min σ — mutation floor to preserve exploration. Typical: 1e-4. */
  sigmaMin: number;
  /** Max σ — mutation ceiling to prevent divergence. Typical: 10.0. */
  sigmaMax: number;
  /** 1/5 rule increase factor when success rate > 1/5. Typical: 1.22. */
  sigmaIncreaseFactor: number;
  /** 1/5 rule decrease factor when success rate < 1/5. Typical: 0.82. */
  sigmaDecreaseFactor: number;
  /** Window size for computing success rate (generations). Typical: 5-10. */
  successWindow: number;
  /** Maximum generations. Early-exit possible via fitness plateau. */
  maxGenerations: number;
  /** RNG seed. Fixed for reproducibility. */
  seed: number;
}

export const DEFAULT_ES_CONFIG: EvolutionStrategyConfig = {
  mu: 10,
  lambda: 40,
  initialSigma: 0.5,
  sigmaMin: 1e-4,
  sigmaMax: 10.0,
  sigmaIncreaseFactor: 1.22,
  sigmaDecreaseFactor: 0.82,
  successWindow: 5,
  maxGenerations: 100,
  seed: 42,
};

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type Vector = readonly number[];

export interface Individual {
  vector: Vector;
  fitness: number;
}

export interface GenerationStats {
  generation: number;
  bestFitness: number;
  meanFitness: number;
  stdFitness: number;
  sigma: number;
  successRate: number;
}

/** User supplies this: evaluate one individual's fitness. Must be monotone
 *  (higher = better). */
export type FitnessFn = (vector: Vector) => Promise<number> | number;

// -----------------------------------------------------------------------------
// RNG — seeded, deterministic
// -----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform using a provided uniform RNG. */
function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// -----------------------------------------------------------------------------
// Evolution Strategy
// -----------------------------------------------------------------------------

export class EvolutionStrategy {
  private readonly rng: () => number;
  private readonly config: EvolutionStrategyConfig;
  private sigma: number;
  private successHistory: boolean[] = []; // per-generation success flag

  constructor(config: Partial<EvolutionStrategyConfig> = {}) {
    this.config = { ...DEFAULT_ES_CONFIG, ...config };
    this.rng = mulberry32(this.config.seed);
    this.sigma = this.config.initialSigma;
  }

  get currentSigma(): number {
    return this.sigma;
  }

  /** Run full training loop. `initialVector` is the starting point (length = dim).
   *  Returns the best individual found across all generations. */
  async run(
    initialVector: Vector,
    fitness: FitnessFn,
    onGeneration?: (stats: GenerationStats, best: Individual) => void,
  ): Promise<{ best: Individual; history: GenerationStats[] }> {
    const dim = initialVector.length;
    const { mu, lambda, maxGenerations } = this.config;

    // Bootstrap: mu parents are perturbations around the initial vector.
    let parents: Individual[] = [];
    for (let i = 0; i < mu; i++) {
      const vec = i === 0 ? [...initialVector] : this.mutate(initialVector, dim);
      const fit = await fitness(vec);
      parents.push({ vector: vec, fitness: fit });
    }
    parents.sort((a, b) => b.fitness - a.fitness);

    const history: GenerationStats[] = [];
    let prevBest = parents[0].fitness;

    for (let gen = 0; gen < maxGenerations; gen++) {
      // Generate lambda offspring by mutating random parents
      const offspring: Individual[] = [];
      for (let i = 0; i < lambda; i++) {
        const parent = parents[Math.floor(this.rng() * parents.length)];
        const child = this.mutate(parent.vector, dim);
        const fit = await fitness(child);
        offspring.push({ vector: child, fitness: fit });
      }

      // "+" selection: keep top-mu from parents ∪ offspring
      const combined = [...parents, ...offspring].sort((a, b) => b.fitness - a.fitness);
      parents = combined.slice(0, mu);

      // 1/5 success rule — success = at least one offspring beat the previous best
      const improved = parents[0].fitness > prevBest;
      this.successHistory.push(improved);
      if (this.successHistory.length > this.config.successWindow) this.successHistory.shift();
      this.adaptSigma();
      prevBest = parents[0].fitness;

      const stats: GenerationStats = {
        generation: gen + 1,
        bestFitness: parents[0].fitness,
        meanFitness: mean(parents.map(p => p.fitness)),
        stdFitness: std(parents.map(p => p.fitness)),
        sigma: this.sigma,
        successRate: this.successRate(),
      };
      history.push(stats);
      if (onGeneration) onGeneration(stats, parents[0]);
    }

    return { best: parents[0], history };
  }

  // -------- internals --------

  private mutate(vector: Vector, dim: number): Vector {
    const out = new Array<number>(dim);
    for (let i = 0; i < dim; i++) out[i] = vector[i] + this.sigma * gaussian(this.rng);
    return out;
  }

  private successRate(): number {
    if (this.successHistory.length === 0) return 0;
    return this.successHistory.filter(Boolean).length / this.successHistory.length;
  }

  /** 1/5 rule (Rechenberg): success > 1/5 → increase σ, < 1/5 → decrease. */
  private adaptSigma(): void {
    if (this.successHistory.length < this.config.successWindow) return;
    const rate = this.successRate();
    if (rate > 0.2) this.sigma *= this.config.sigmaIncreaseFactor;
    else if (rate < 0.2) this.sigma *= this.config.sigmaDecreaseFactor;
    this.sigma = Math.max(this.config.sigmaMin, Math.min(this.config.sigmaMax, this.sigma));
  }
}

// -----------------------------------------------------------------------------
// Stats helpers
// -----------------------------------------------------------------------------

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}
