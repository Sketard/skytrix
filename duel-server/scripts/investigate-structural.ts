// =============================================================================
// investigate-structural.ts — W1 empirical measurement harness for the
// structural weights extension plan (2026-04-18).
//
// Loops over every non-draft fixture, runs the solver ONCE, captures the peak
// turn-1 field state and derives a rich set of signals used to answer the
// INVESTIGATION REQUIRED flags in
// `solver-structural-weights-extension-plan.md`:
//
//   - F1/F2/F3 uncapped sum distribution (§1 globalCap)
//   - Pendulum on-field with decoded scales (§5.1, F5)
//   - Xyz overlay counts (F10)
//   - GY/banish zone loading (F12/F13)
//   - EMZ occupancy by summon category (F_EMZ)
//   - Tuner / non-tuner counts on MZONE (F6)
//   - Field spell presence (F8)
//   - Hand size leftover (F14)
//   - Simulated F5-F14 + F_EMZ activation per fixture (§10)
//
// Output: `_bmad-output/solver-data/structural-investigation-<date>.json`.
// Console: per-fixture summary + aggregate distributions.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/investigate-structural.ts \
//     --out=../_bmad-output/solver-data/structural-investigation-2026-04-18.json
//
// Serial — no Piscina pool. One-shot diagnostic, latency is not a concern.
// =============================================================================

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import {
  loadAllSolverConfigs,
  type AllSolverConfigs,
} from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { buildCardMetadataMap, TYPE_PENDULUM, TYPE_TUNER } from '../src/solver/card-metadata.js';
import { computeStructuralValue } from '../src/solver/structural-value-computer.js';
import type {
  StructuralWeights,
  StructuralTutorCards,
} from '../src/solver/structural-value-computer.js';
import type { FieldState, FieldCard, DuelConfig, SolverConfig } from '../src/solver/solver-types.js';
import type { CardMetadataMap } from '../src/solver/card-metadata.js';
import type { HandFixture, FixtureFile } from './evaluate-structural.js';
import { loadFixtureFile, DATA_DIR } from './evaluate-structural.js';

// =============================================================================
// CLI parsing
// =============================================================================

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

// =============================================================================
// Scale extraction (Pendulum monsters encode scales in the level column)
// =============================================================================

interface ScaleRow { id: number; level: number; }
interface Scales { lscale: number; rscale: number; baseLevel: number; }

function buildScaleMap(dbPath: string, cardIds: Iterable<number>): Map<number, Scales> {
  const db = new Database(dbPath, { readonly: true });
  const stmt = db.prepare('SELECT id, level FROM datas WHERE id = ?');
  const map = new Map<number, Scales>();
  for (const cid of cardIds) {
    if (cid === 0) continue;
    const row = stmt.get(cid) as ScaleRow | undefined;
    if (!row) continue;
    const rawLevel = row.level >>> 0;
    map.set(cid, {
      baseLevel: rawLevel & 0xff,
      lscale: (rawLevel >>> 16) & 0xff,
      rscale: (rawLevel >>> 24) & 0xff,
    });
  }
  db.close();
  return map;
}

// =============================================================================
// Measurement types
// =============================================================================

interface PeakMeasurement {
  fixtureId: string;
  deckName: string;
  matched: number;
  matchedTotal: number;
  interruptionScore: number;
  explorationScore: number;
  weightedScore: number;
  latentPoints: number;

  structural: {
    f1: number;
    f2: number;
    f3: number;
    sum_uncapped: number;
    globalCap: number;
    clipped: boolean;
  };

  zones: {
    handSize: number;
    gyCount: number;
    banishCount: number;
    extraFaceDown: number;
    extraFaceUp: number;
    mzoneFaceUp: number;
    szoneFaceUp: number;
  };

  pendulumOnField: Array<{ cardId: number; zone: string; lscale: number; rscale: number; baseLevel: number }>;
  xyzOverlays: Array<{ cardId: number; zone: string; overlayCount: number }>;
  linkMonstersOnField: Array<{ cardId: number; zone: string; rating: number }>;
  mzoneMonsters: Array<{ cardId: number; zone: string; isTuner: boolean; isExtraDeck: boolean; level: number }>;

  emzOccupancy: {
    EMZ_L: { occupied: boolean; category: string | null };
    EMZ_R: { occupied: boolean; category: string | null };
    mzFreeCount: number;
  };

  fieldSpell: { present: boolean; cardId: number | null };

  simulated: {
    F5_scaleSetup: { present: boolean; pairs: Array<{ lscale: number; rscale: number; gap: number }> };
    F6_synchro: { tuners: number; nonTuners: number; pairs: number };
    F8_fieldSpellActive: boolean;
    F10_totalOverlays: number;
    F11_totalLinkRating: number;
    F12_gyLoadingRaw: number;
    F13_banishLoadingRaw: number;
    F14_handLeftoverRaw: number;
    F_EMZ_penaltyCandidate: boolean;
  };
}

interface InvestigationOutput {
  _meta: {
    timestamp: string;
    budgetMs: number;
    fixtureCount: number;
    note: string;
  };
  fixtures: PeakMeasurement[];
  aggregates: {
    f1f2f3_sumDistribution: { min: number; p50: number; p75: number; p90: number; max: number; countAboveGlobalCap: number; totalCount: number };
    pendulumFixtureCount: number;
    xyzWithOverlays: number;
    linkOnFieldCount: number;
    emzOccupiedByNonLinkWithFreeMZ: number;
    fieldSpellFixtureCount: number;
    gyCountDistribution: { min: number; p50: number; p75: number; p90: number; max: number };
    banishCountDistribution: { min: number; p50: number; p75: number; p90: number; max: number };
    handSizeDistribution: { min: number; p50: number; p75: number; p90: number; max: number };
    perFeatureActivation: Record<string, number>;
  };
}

// =============================================================================
// Helpers
// =============================================================================

const MZONE_KEYS = ['M1', 'M2', 'M3', 'M4', 'M5'] as const;
const EMZ_KEYS = ['EMZ_L', 'EMZ_R'] as const;
const SZONE_KEYS = ['S1', 'S2', 'S3', 'S4', 'S5'] as const;

const MZONE_EXPANSION = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R']);
const SZONE_EXPANSION = new Set(['S1', 'S2', 'S3', 'S4', 'S5']);

function zoneMatches(expectedZone: string, actualZone: string): boolean {
  if (expectedZone === actualZone) return true;
  if (expectedZone === 'MZONE') return MZONE_EXPANSION.has(actualZone);
  if (expectedZone === 'SZONE') return SZONE_EXPANSION.has(actualZone);
  return false;
}

function positionMatches(
  expectedPosition: 'attack' | 'defense' | 'set' | undefined,
  actualPosition: string,
): boolean {
  if (!expectedPosition) return true;
  if (expectedPosition === 'attack') return actualPosition === 'faceup-atk';
  if (expectedPosition === 'defense') return actualPosition === 'faceup-def';
  if (expectedPosition === 'set') {
    return actualPosition === 'facedown' || actualPosition === 'facedown-def';
  }
  return false;
}

function isFaceUp(card: FieldCard): boolean {
  return card.position === 'faceup-atk' || card.position === 'faceup-def';
}

function summonCategoryOf(cardId: number, metadata: CardMetadataMap): string | null {
  const meta = metadata.get(cardId);
  return meta?.summonCategory ?? null;
}

// =============================================================================
// Single-pass solve + measure
// =============================================================================

interface FixtureSolveResult {
  matched: number;
  matchedTotal: number;
  interruptionScore: number;
  explorationScore: number;
  weighted: number;
  latentPoints: number;
  peakState: FieldState | undefined;
}

function solveAndMeasure(
  adapter: OCGCoreAdapter,
  scorer: InterruptionScorer,
  ranker: GoldfishChainRanker,
  fixture: FixtureFile,
  hand: HandFixture,
  allConfigs: AllSolverConfigs,
  timeLimitMs: number,
): FixtureSolveResult {
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`Deck '${hand.deck}' not found`);

  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) throw new Error(`Hand card ${cid} not in ${hand.deck}`);
    mainDeck.splice(idx, 1);
  }

  const preferredSearchTargets = [
    ...(hand.expectedBoard ?? []).map(e => e.cardId),
    ...(hand.preferredIntermediates ?? []),
  ];

  const duelConfig: DuelConfig = {
    mainDeck,
    extraDeck: deck.extra,
    hand: hand.hand,
    deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 1,
    preferredSearchTargets,
  };

  const maxDepth = hand.maxDepth ?? allConfigs.solverConfig.maxDepth;
  const perFixtureConfig = {
    ...allConfigs.solverConfig,
    maxDepth,
    maxResultNodes: Math.max(allConfigs.solverConfig.maxResultNodes, maxDepth * 20),
  };
  const hasher = new ZobristHasher();
  const table = new TranspositionTable(perFixtureConfig.transpositionMaxEntries);
  const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, perFixtureConfig);
  const startHandle = adapter.createDuel(duelConfig);
  const signal = AbortSignal.timeout(timeLimitMs + 5000);
  const solverConfig: SolverConfig = {
    mode: 'goldfish',
    speed: 'optimal',
    timeLimitMs,
  };

  const result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
  const peakFs = result.stats.diagnostic?.bestTurn1FieldState;

  // Matched computation mirrors evaluate-structural.ts runFixture().
  const expected = hand.expectedBoard ?? [];
  let matched = 0;
  if (peakFs) {
    for (const e of expected) {
      let found = false;
      for (const [zoneName, zs] of Object.entries(peakFs.zones)) {
        const zoneOk = zoneMatches(e.zone, zoneName);
        for (const c of zs) {
          if (c.cardId !== e.cardId) continue;
          if (!zoneOk) continue;
          if (!positionMatches(e.position, c.position ?? '')) continue;
          found = true;
          break;
        }
        if (found) break;
      }
      if (found) matched++;
    }
  }

  return {
    matched,
    matchedTotal: expected.length,
    interruptionScore: result.score,
    explorationScore: result.scoreBreakdown.explorationScore,
    weighted: result.scoreBreakdown.weighted,
    latentPoints: result.scoreBreakdown.latentPoints,
    peakState: peakFs as FieldState | undefined,
  };
}

function measurePeak(
  fixtureId: string,
  deckName: string,
  solve: FixtureSolveResult,
  metadata: CardMetadataMap,
  scaleMap: Map<number, Scales>,
  structuralWeights: StructuralWeights,
  tutorCards: StructuralTutorCards | undefined,
): PeakMeasurement | null {
  if (!solve.peakState) return null;
  const peakState = solve.peakState;

  const structuralResult = computeStructuralValue(
    peakState, undefined, metadata, structuralWeights, tutorCards,
  );
  const sumUncapped =
    structuralResult.featureScores.F1_ritualUnlock +
    structuralResult.featureScores.F2_tutorChain +
    structuralResult.featureScores.F3_materialPool;

  const pendulumOnField: PeakMeasurement['pendulumOnField'] = [];
  const xyzOverlays: PeakMeasurement['xyzOverlays'] = [];
  const linkMonstersOnField: PeakMeasurement['linkMonstersOnField'] = [];
  const mzoneMonsters: PeakMeasurement['mzoneMonsters'] = [];

  let mzoneFaceUp = 0;
  for (const zone of [...MZONE_KEYS, ...EMZ_KEYS] as const) {
    const cards = peakState.zones[zone] ?? [];
    for (const card of cards) {
      if (!isFaceUp(card)) continue;
      mzoneFaceUp++;
      const meta = metadata.get(card.cardId);
      if (!meta) continue;

      const isPendulum = (meta.type & TYPE_PENDULUM) !== 0;
      if (isPendulum) {
        const scale = scaleMap.get(card.cardId);
        if (scale) pendulumOnField.push({ cardId: card.cardId, zone, ...scale });
      }
      if (meta.summonCategory === 'XYZ' && card.overlayCount > 0) {
        xyzOverlays.push({ cardId: card.cardId, zone, overlayCount: card.overlayCount });
      }
      if (meta.summonCategory === 'LINK') {
        linkMonstersOnField.push({ cardId: card.cardId, zone, rating: meta.rating });
      }
      const isTuner = (meta.type & TYPE_TUNER) !== 0;
      mzoneMonsters.push({
        cardId: card.cardId,
        zone,
        isTuner,
        isExtraDeck: meta.isExtraDeckMonster,
        level: meta.level & 0xff,
      });
    }
  }

  let szoneFaceUp = 0;
  for (const zone of SZONE_KEYS) {
    const cards = peakState.zones[zone] ?? [];
    for (const card of cards) {
      if (isFaceUp(card)) szoneFaceUp++;
      const meta = metadata.get(card.cardId);
      if (!meta) continue;
      const isPendulum = (meta.type & TYPE_PENDULUM) !== 0;
      if (isPendulum && isFaceUp(card) && (zone === 'S1' || zone === 'S5')) {
        const scale = scaleMap.get(card.cardId);
        if (scale) pendulumOnField.push({ cardId: card.cardId, zone, ...scale });
      }
    }
  }

  const handSize = peakState.zones.HAND?.length ?? 0;
  const gyCount = peakState.zones.GY?.length ?? 0;
  const banishCount = peakState.zones.BANISHED?.length ?? 0;
  const extraFaceDown = (peakState.zones.EXTRA ?? []).filter(c => !isFaceUp(c)).length;
  const extraFaceUp = (peakState.zones.EXTRA ?? []).filter(c => isFaceUp(c)).length;

  const emzL = peakState.zones.EMZ_L?.[0];
  const emzR = peakState.zones.EMZ_R?.[0];
  let mzFreeCount = 0;
  for (const mz of MZONE_KEYS) {
    if ((peakState.zones[mz]?.length ?? 0) === 0) mzFreeCount++;
  }
  const emzOccupancy = {
    EMZ_L: {
      occupied: emzL !== undefined,
      category: emzL ? summonCategoryOf(emzL.cardId, metadata) : null,
    },
    EMZ_R: {
      occupied: emzR !== undefined,
      category: emzR ? summonCategoryOf(emzR.cardId, metadata) : null,
    },
    mzFreeCount,
  };

  const fieldSpellCard = peakState.zones.FIELD?.[0];
  const fieldSpell = {
    present: fieldSpellCard !== undefined && isFaceUp(fieldSpellCard),
    cardId: fieldSpellCard?.cardId ?? null,
  };

  // Simulated features.
  const scalePairs: Array<{ lscale: number; rscale: number; gap: number }> = [];
  const s1Pendulum = pendulumOnField.find(p => p.zone === 'S1');
  const s5Pendulum = pendulumOnField.find(p => p.zone === 'S5');
  if (s1Pendulum && s5Pendulum) {
    const lo = Math.min(s1Pendulum.lscale, s5Pendulum.lscale);
    const hi = Math.max(s1Pendulum.rscale, s5Pendulum.rscale);
    scalePairs.push({ lscale: lo, rscale: hi, gap: hi - lo });
  }
  const F5_scaleSetup = { present: scalePairs.length > 0, pairs: scalePairs };

  const tunersMZ = mzoneMonsters.filter(m => !m.isExtraDeck && m.isTuner);
  const nonTunersMZ = mzoneMonsters.filter(m => !m.isExtraDeck && !m.isTuner);
  const F6 = { tuners: tunersMZ.length, nonTuners: nonTunersMZ.length, pairs: tunersMZ.length * nonTunersMZ.length };

  const emzHasNonLink =
    (emzOccupancy.EMZ_L.occupied && emzOccupancy.EMZ_L.category !== 'LINK' && emzOccupancy.EMZ_L.category !== null) ||
    (emzOccupancy.EMZ_R.occupied && emzOccupancy.EMZ_R.category !== 'LINK' && emzOccupancy.EMZ_R.category !== null);
  const F_EMZ_penaltyCandidate = emzHasNonLink && mzFreeCount > 0;

  const F10_totalOverlays = xyzOverlays.reduce((a, x) => a + x.overlayCount, 0);
  const F11_totalLinkRating = linkMonstersOnField.reduce((a, l) => a + l.rating, 0);
  const F12_gyLoadingRaw = Math.max(0, gyCount - 3);
  const F13_banishLoadingRaw = Math.max(0, banishCount - 2);
  const F14_handLeftoverRaw = Math.max(0, handSize - 1);

  return {
    fixtureId, deckName,
    matched: solve.matched, matchedTotal: solve.matchedTotal,
    interruptionScore: solve.interruptionScore,
    explorationScore: solve.explorationScore,
    weightedScore: solve.weighted,
    latentPoints: solve.latentPoints,

    structural: {
      f1: structuralResult.featureScores.F1_ritualUnlock,
      f2: structuralResult.featureScores.F2_tutorChain,
      f3: structuralResult.featureScores.F3_materialPool,
      sum_uncapped: sumUncapped,
      globalCap: structuralWeights.globalCap,
      clipped: sumUncapped > structuralWeights.globalCap,
    },
    zones: { handSize, gyCount, banishCount, extraFaceDown, extraFaceUp, mzoneFaceUp, szoneFaceUp },
    pendulumOnField, xyzOverlays, linkMonstersOnField, mzoneMonsters,
    emzOccupancy, fieldSpell,

    simulated: {
      F5_scaleSetup,
      F6_synchro: F6,
      F8_fieldSpellActive: fieldSpell.present,
      F10_totalOverlays,
      F11_totalLinkRating,
      F12_gyLoadingRaw,
      F13_banishLoadingRaw,
      F14_handLeftoverRaw,
      F_EMZ_penaltyCandidate,
    },
  };
}

// =============================================================================
// Aggregates
// =============================================================================

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function summarize(values: number[]): { min: number; p50: number; p75: number; p90: number; max: number } {
  if (values.length === 0) return { min: 0, p50: 0, p75: 0, p90: 0, max: 0 };
  return {
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    max: Math.max(...values),
  };
}

function buildAggregates(measurements: PeakMeasurement[]): InvestigationOutput['aggregates'] {
  const f123Sums = measurements.map(m => m.structural.sum_uncapped);
  const globalCap = measurements[0]?.structural.globalCap ?? 15;

  const perFeatureActivation: Record<string, number> = {
    F5_scaleSetup: 0,
    F6_anySynchroPair: 0,
    F8_fieldSpell: 0,
    F10_anyOverlay: 0,
    F11_anyLink: 0,
    F12_anyGyLoading: 0,
    F13_anyBanishLoading: 0,
    F14_anyHandLeftover: 0,
    F_EMZ_penaltyCandidate: 0,
    structuralClipped: 0,
  };
  for (const m of measurements) {
    if (m.simulated.F5_scaleSetup.present) perFeatureActivation.F5_scaleSetup++;
    if (m.simulated.F6_synchro.pairs > 0) perFeatureActivation.F6_anySynchroPair++;
    if (m.simulated.F8_fieldSpellActive) perFeatureActivation.F8_fieldSpell++;
    if (m.simulated.F10_totalOverlays > 0) perFeatureActivation.F10_anyOverlay++;
    if (m.simulated.F11_totalLinkRating > 0) perFeatureActivation.F11_anyLink++;
    if (m.simulated.F12_gyLoadingRaw > 0) perFeatureActivation.F12_anyGyLoading++;
    if (m.simulated.F13_banishLoadingRaw > 0) perFeatureActivation.F13_anyBanishLoading++;
    if (m.simulated.F14_handLeftoverRaw > 0) perFeatureActivation.F14_anyHandLeftover++;
    if (m.simulated.F_EMZ_penaltyCandidate) perFeatureActivation.F_EMZ_penaltyCandidate++;
    if (m.structural.clipped) perFeatureActivation.structuralClipped++;
  }

  return {
    f1f2f3_sumDistribution: {
      ...summarize(f123Sums),
      countAboveGlobalCap: f123Sums.filter(v => v > globalCap).length,
      totalCount: f123Sums.length,
    },
    pendulumFixtureCount: measurements.filter(m => m.pendulumOnField.length > 0).length,
    xyzWithOverlays: measurements.filter(m => m.simulated.F10_totalOverlays > 0).length,
    linkOnFieldCount: measurements.filter(m => m.linkMonstersOnField.length > 0).length,
    emzOccupiedByNonLinkWithFreeMZ: measurements.filter(m => m.simulated.F_EMZ_penaltyCandidate).length,
    fieldSpellFixtureCount: measurements.filter(m => m.simulated.F8_fieldSpellActive).length,
    gyCountDistribution: summarize(measurements.map(m => m.zones.gyCount)),
    banishCountDistribution: summarize(measurements.map(m => m.zones.banishCount)),
    handSizeDistribution: summarize(measurements.map(m => m.zones.handSize)),
    perFeatureActivation,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const outPath = parseStringArg('out');
  const fixtureFilter = parseStringArg('only');

  console.log('[investigate] booting...');
  const fixture = loadFixtureFile();
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const timeLimitMs = allConfigs.solverConfig.timeBudgetOptimalMs;
  console.log(`[investigate] time budget per fixture: ${timeLimitMs}ms`);

  const allCardIds: number[] = [];
  for (const h of fixture.hands) {
    if (h._draft === true) continue;
    const deck = fixture.decks[h.deck];
    if (!deck) continue;
    allCardIds.push(...deck.main, ...deck.extra, ...h.hand);
  }
  const cardMetadata = buildCardMetadataMap(cardDB, allCardIds);
  const scaleMap = buildScaleMap(join(DATA_DIR, 'cards.cdb'), allCardIds);
  console.log(`[investigate] metadata built for ${cardMetadata.size} unique cards; scales for ${scaleMap.size}`);

  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMetadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const ranker = new GoldfishChainRanker(allConfigs.interruptionTags);

  const fixturesToRun = fixture.hands.filter(h => {
    if (h._draft === true) return false;
    if (fixtureFilter && h.id !== fixtureFilter) return false;
    return true;
  });

  console.log(`[investigate] running ${fixturesToRun.length} fixtures...`);
  const measurements: PeakMeasurement[] = [];

  for (const hand of fixturesToRun) {
    process.stdout.write(`  ${hand.id.padEnd(48)} `);
    const t0 = Date.now();
    const solve = solveAndMeasure(adapter, scorer, ranker, fixture, hand, allConfigs, timeLimitMs);
    const wallMs = Date.now() - t0;

    const m = measurePeak(
      hand.id, hand.deck, solve,
      cardMetadata, scaleMap,
      allConfigs.structuralWeights, allConfigs.structuralTutorCards,
    );
    if (!m) {
      console.log(`SKIP (no peak state) score=${solve.interruptionScore} matched=${solve.matched}/${solve.matchedTotal}`);
      continue;
    }
    measurements.push(m);
    console.log(
      `score=${solve.interruptionScore} matched=${solve.matched}/${solve.matchedTotal} ` +
      `F123=${m.structural.sum_uncapped.toFixed(1)}${m.structural.clipped ? '(CLIP)' : ''} ` +
      `pend=${m.pendulumOnField.length} ovl=${m.simulated.F10_totalOverlays} ` +
      `link=${m.simulated.F11_totalLinkRating} tuner=${m.simulated.F6_synchro.tuners} ` +
      `gy=${m.zones.gyCount} bn=${m.zones.banishCount} hand=${m.zones.handSize} ` +
      `[${wallMs}ms]`,
    );
  }

  const aggregates = buildAggregates(measurements);

  const output: InvestigationOutput = {
    _meta: {
      timestamp: new Date().toISOString(),
      budgetMs: timeLimitMs,
      fixtureCount: measurements.length,
      note: 'W1 empirical measurement — peak-only. Answers INVESTIGATION REQUIRED flags in solver-structural-weights-extension-plan.md.',
    },
    fixtures: measurements,
    aggregates,
  };

  console.log('\n[investigate] ═══ AGGREGATE SUMMARY ═══');
  console.log(`  fixtures measured: ${measurements.length}`);
  const d = aggregates.f1f2f3_sumDistribution;
  console.log(`  F1+F2+F3 uncapped:  min=${d.min} p50=${d.p50} p75=${d.p75} p90=${d.p90} max=${d.max}  clipped=${d.countAboveGlobalCap}/${d.totalCount}`);
  console.log(`  per-feature activation:`);
  for (const [k, v] of Object.entries(aggregates.perFeatureActivation)) {
    console.log(`    ${k.padEnd(30)} ${v} / ${measurements.length}`);
  }
  const gy = aggregates.gyCountDistribution;
  const bn = aggregates.banishCountDistribution;
  const hd = aggregates.handSizeDistribution;
  console.log(`  GY count:     min=${gy.min} p50=${gy.p50} p75=${gy.p75} p90=${gy.p90} max=${gy.max}`);
  console.log(`  Banish count: min=${bn.min} p50=${bn.p50} p75=${bn.p75} p90=${bn.p90} max=${bn.max}`);
  console.log(`  Hand size:    min=${hd.min} p50=${hd.p50} p75=${hd.p75} p90=${hd.p90} max=${hd.max}`);

  if (outPath) {
    const absOut = resolve(outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, JSON.stringify(output, null, 2) + '\n', 'utf-8');
    console.log(`\n[investigate] wrote ${absOut}`);
  }

  adapter.destroyAll();
}

await main();
