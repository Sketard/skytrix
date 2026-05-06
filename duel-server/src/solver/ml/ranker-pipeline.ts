// =============================================================================
// ranker-pipeline.ts — single source of truth for ML ranker composition + wiring.
//
// Both `solver-worker.ts` and `scripts/eval/evaluate-structural.ts` previously
// duplicated the boot-time decorator stack and per-solve setter dispatch.
// This pipeline centralizes:
//
//   1. Decorator composition order (innermost → outermost):
//        Goldfish → RouteAware → (Neural XOR Graph) → Policy → PathBiased
//   2. Mutual exclusion of Neural and Graph weights (Neural wins).
//   3. Per-fixture wiring (cardMetadata, mainDeck, extraDeck, expertise).
//
// Callers instantiate once at boot, then call `configurePerFixture()` per solve.
// =============================================================================

import type { InterruptionTag, InterruptionType } from '../solver-types.js';
import type { CardMetadataMap } from '../card-metadata.js';
import type { ActionRanker } from '../solver-strategy.js';
import type { ArchetypeExpertise } from '../strategic-grammar.js';
import { GoldfishChainRanker } from '../goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../route-aware-ranker.js';
import { NeuralFeatureRanker, type NeuralWeights } from './neural-ranker.js';
import { GraphGuidedRanker } from './graph-guided-ranker.js';
import { PolicyGuidedRanker } from './policy-guided-ranker.js';
import { PathBiasedRanker } from './path-biased-ranker.js';
import { loadNeuralWeightsIfEnabled } from './neural-weights-loader.js';
import { loadTunedWeightsIfEnabled } from './graph-weights-loader.js';
import { loadVerbPolicyIfEnabled } from './verb-policy-loader.js';
import type { GraphWeights } from './graph-weights-types.js';
import type { VerbPolicyWeights } from './verb-policy.js';

export interface PipelineDeps {
  interruptionTags: Record<string, InterruptionTag>;
  interruptionWeights: Record<InterruptionType, number>;
  dataDir: string;
}

export interface PerFixtureContext {
  cardMetadata: CardMetadataMap;
  mainDeck: readonly number[];
  extraDeck: readonly number[];
  /** Pre-filtered expertise (caller invokes `filterExpertiseByDeck` once). */
  filteredExpertise: readonly ArchetypeExpertise[];
}

export interface PipelineWeights {
  neural: NeuralWeights | undefined;
  graph: GraphWeights | undefined;
  verbPolicy: VerbPolicyWeights | undefined;
}

export class RankerPipeline {
  /** Outermost ranker — the one to inject into DfsSolver / MCTSSolver. */
  readonly outerRanker: ActionRanker;
  /** Innermost expertise host. Some harnesses (cross-eval, diag-train-vs-eval)
   *  reach into this to wrap an alternate decorator manually. */
  readonly routeAware: RouteAwareRanker;
  /** Loaded weights, exposed for harnesses that want to log basenames etc. */
  readonly weights: PipelineWeights;

  // Internal refs to instances needing per-fixture wiring. Undefined when their
  // gating env flag was OFF (loader returned undefined).
  private readonly neural: NeuralFeatureRanker | undefined;
  private readonly policy: PolicyGuidedRanker | undefined;
  private readonly path: PathBiasedRanker | undefined;

  constructor(deps: PipelineDeps) {
    const { interruptionTags, interruptionWeights, dataDir } = deps;

    this.weights = {
      neural: loadNeuralWeightsIfEnabled({ dataDir }),
      graph: undefined,
      verbPolicy: loadVerbPolicyIfEnabled({ dataDir }),
    };
    // Mutual exclusion: graph weights only loaded if neural is OFF.
    if (!this.weights.neural) {
      this.weights.graph = loadTunedWeightsIfEnabled({ dataDir });
    }

    this.routeAware = new RouteAwareRanker(new GoldfishChainRanker(interruptionTags));
    let stack: ActionRanker = this.routeAware;

    if (this.weights.neural) {
      const nr = new NeuralFeatureRanker(stack);
      nr.setInterruptionTags(interruptionTags);
      nr.setInterruptionWeights(interruptionWeights);
      nr.setNeuralWeights(this.weights.neural);
      this.neural = nr;
      stack = nr;
    } else if (this.weights.graph) {
      const gr = new GraphGuidedRanker(stack);
      gr.setWeights(this.weights.graph);
      stack = gr;
    }

    if (this.weights.verbPolicy) {
      const pgr = new PolicyGuidedRanker(stack);
      pgr.setInterruptionTags(interruptionTags);
      pgr.setInterruptionWeights(interruptionWeights);
      pgr.setVerbPolicyWeights(this.weights.verbPolicy);
      this.policy = pgr;
      stack = pgr;
    }

    if (process.env.SOLVER_USE_PATH_RANKER === '1') {
      this.path = new PathBiasedRanker(stack);
      stack = this.path;
    }

    this.outerRanker = stack;
  }

  configurePerFixture(ctx: PerFixtureContext): void {
    if (this.neural) {
      this.neural.setMetadata(ctx.cardMetadata);
      this.neural.setMainDeck(ctx.mainDeck);
      this.neural.setExtraDeck(ctx.extraDeck);
    }
    if (this.policy) {
      this.policy.setMetadata(ctx.cardMetadata);
      this.policy.setMainDeck(ctx.mainDeck);
      this.policy.setExtraDeck(ctx.extraDeck);
    }
    this.routeAware.setArchetypeExpertise(ctx.filteredExpertise);
    if (this.path) {
      this.path.setArchetypeExpertise(ctx.filteredExpertise);
    }
  }
}
