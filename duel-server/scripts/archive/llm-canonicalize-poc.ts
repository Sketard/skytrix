// =============================================================================
// llm-canonicalize-poc.ts — Phase 0 POC for Architecture C (LLM-distilled policy).
//
// Replays a canonical-line trajectory on a fresh OCGCore duel, and at each
// SELECT_IDLECMD prompt, dumps a human-readable Markdown prompt to disk.
// The user manually copy-pastes 1-2 prompts into Claude.ai (or future
// automated API call) to validate that an LLM can pick the right action
// given the YGO state. NO API CALLS in this POC — disk-only output.
//
// Outputs (per fixture, under <out-dir>/<fixture-id>/):
//   step-NN.md           — human-readable prompt with state + legal actions
//   ground-truth.jsonl   — per-step canonical action (for scoring later)
//
// Usage:
//   cd duel-server
//   npx tsx scripts/llm-canonicalize-poc.ts \
//     --trajectory=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener-recorded.json \
//     --out=data/llm-poc
//
// Phase 0 gate: read 1-2 generated prompts, manually test in Claude.ai,
// verify LLM picks match the trajectory's ground-truth action.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  type FixtureFile,
  type HandFixture,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { buildCardMetadataMap, type CardMetadataMap } from '../../src/solver/card-metadata.js';
import type { Action, DuelConfig, FieldCard, FieldState, ZoneId } from '../../src/solver/solver-types.js';

interface TrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
  annotation?: string;
}

interface CanonicalTrajectoryFile {
  fixtureId: string;
  description: string;
  steps: TrajectoryStep[];
}

interface DumpTrajectoryFile {
  schemaVersion: number;
  fixtureId: string;
  trajectory: TrajectoryStep[];
}

type TrajectoryFile = CanonicalTrajectoryFile | DumpTrajectoryFile;

function getSteps(traj: TrajectoryFile): TrajectoryStep[] {
  if ('trajectory' in traj) return traj.trajectory;
  return traj.steps;
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

// =============================================================================
// Card description rendering
// =============================================================================

interface CardDB {
  getCardText(cardId: number): { name: string; type: string; level?: number; atk?: number; def?: number };
}

function describeCard(c: FieldCard, metadata: CardMetadataMap, getName: (id: number) => string): string {
  const m = metadata.get(c.cardId);
  const name = c.cardName || getName(c.cardId);
  if (!m) return `${name}`;
  const parts: string[] = [name];
  if (m.isMonster) {
    const stats: string[] = [];
    if (m.level > 0) stats.push(`Lv${m.level}`);
    if (m.atk >= 0) stats.push(`ATK ${m.atk}`);
    if (m.def >= 0) stats.push(`DEF ${m.def}`);
    if (stats.length > 0) parts.push(`(${stats.join('/')})`);
  }
  if (c.position === 'facedown' || c.position === 'facedown-def') parts.push('[face-down]');
  if (c.overlayCount > 0) parts.push(`[${c.overlayCount} overlay materials]`);
  return parts.join(' ');
}

// =============================================================================
// State serialization to Markdown
// =============================================================================

const ZONE_GROUPS = {
  'Self Monsters (M1-M5 + EMZ)': ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'] as ZoneId[],
  'Self Spell/Trap (S1-S5)': ['S1', 'S2', 'S3', 'S4', 'S5'] as ZoneId[],
  'Self Field Spell': ['FIELD'] as ZoneId[],
  'Hand': ['HAND'] as ZoneId[],
  'Graveyard': ['GY'] as ZoneId[],
  'Banished': ['BANISHED'] as ZoneId[],
};

function renderFieldState(state: FieldState, metadata: CardMetadataMap, deckRemaining: number, extraRemaining: number, getName: (id: number) => string): string {
  const lines: string[] = [];
  lines.push(`**Phase**: ${state.phase}  **Turn**: ${state.turn}  **LP**: self=${state.lifePoints[0]} opp=${state.lifePoints[1]}`);
  lines.push('');

  for (const [groupName, zones] of Object.entries(ZONE_GROUPS)) {
    const cards: string[] = [];
    for (const z of zones) {
      const zoneCards = state.zones[z] ?? [];
      for (const c of zoneCards) {
        cards.push(`  - ${z}: ${describeCard(c, metadata, getName)}`);
      }
    }
    if (cards.length === 0) {
      lines.push(`**${groupName}**: (empty)`);
    } else {
      lines.push(`**${groupName}**:`);
      lines.push(...cards);
    }
  }

  lines.push(`**Deck remaining**: ${deckRemaining} cards`);
  lines.push(`**Extra Deck remaining**: ${extraRemaining} cards`);

  if (state.oppZones) {
    const oppCards: string[] = [];
    for (const z of [...ZONE_GROUPS['Self Monsters (M1-M5 + EMZ)'], ...ZONE_GROUPS['Self Spell/Trap (S1-S5)']]) {
      const zoneCards = state.oppZones[z] ?? [];
      for (const c of zoneCards) {
        oppCards.push(`  - ${z}: ${describeCard(c, metadata, getName)}`);
      }
    }
    if (oppCards.length > 0) {
      lines.push('**Opponent Field**:');
      lines.push(...oppCards);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Action rendering
// =============================================================================

function renderLegalActions(legal: Action[], getName: (id: number) => string): string {
  const lines: string[] = [];
  for (let i = 0; i < legal.length; i++) {
    const a = legal[i];
    const verbTag = a.actionVerb ? ` [verb: ${a.actionVerb}]` : '';
    const sourceTag = a.sourceZone ? ` [from: ${a.sourceZone}]` : '';
    const desc = a.cardId !== 0
      ? `${a.promptType} response ${a.responseIndex} (${getName(a.cardId)})`
      : `${a.promptType} response ${a.responseIndex} (pass / no card)`;
    lines.push(`  ${i}. ${desc}${verbTag}${sourceTag}`);
  }
  return lines.join('\n');
}

// =============================================================================
// Prompt builder
// =============================================================================

function buildPrompt(
  fixture: HandFixture,
  deckMain: readonly number[],
  deckExtra: readonly number[],
  metadata: CardMetadataMap,
  state: FieldState,
  legal: Action[],
  stepIndex: number,
  expectedBoard: { cardName: string; zone: string; position?: string }[],
  getName: (id: number) => string,
  noHint: boolean,
): string {
  const promptType = legal[0].promptType;

  const expectedSummary = noHint
    ? '  (HIDDEN — your task is to discover the optimal endboard from card text alone)'
    : expectedBoard.length > 0
      ? expectedBoard.map(e => `  - ${e.cardName} @ ${e.zone}${e.position ? `/${e.position}` : ''}`).join('\n')
      : '  (no fixture-defined expected board)';

  const handCardNames = (state.zones.HAND ?? []).map(c => describeCard(c, metadata, getName));

  const deckCardNames = deckMain
    .map(id => getName(id))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();
  const extraCardNames = deckExtra
    .map(id => getName(id))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();

  return `# Yu-Gi-Oh Combo Decision — ${fixture.id} step ${stepIndex} (${promptType})

## Task

You are a Yu-Gi-Oh combo expert. The player is solving for the optimal turn-1 endboard given a deck and starting hand. At each strategic decision (this prompt), pick the action that best leads toward the optimal endboard.

The optimal endboard maximizes interruption value (omninegates, floodgates, targeted negates, destruction, banish, recovery prevention) while building combo continuity (resources for next turn).

## Deck (40-card main + 15-card extra)

**Main deck (unique cards)**: ${deckCardNames.join(', ')}

**Extra deck**: ${extraCardNames.join(', ')}

## Fixture-defined optimal endboard (reference)

${expectedSummary}

## Current state

${renderFieldState(state, metadata, (state.zones.DECK ?? []).length, (state.zones.EXTRA ?? []).length, getName)}

## Hand details

${handCardNames.length === 0 ? '  (empty)' : handCardNames.map(c => `  - ${c}`).join('\n')}

## Legal actions at this prompt (${promptType})

${renderLegalActions(legal, getName)}

## Your task

Pick the action that best advances toward the optimal endboard. Consider:
- Card-text dependencies (what does each card actually do?)
- Combo continuity (does this preserve resources?)
- Endboard alignment (does this lead to the expected interruption pieces?)

Return your answer as JSON:

\`\`\`json
{
  "best_action_index": <integer 0..${legal.length - 1}>,
  "best_action_card": "<card name>",
  "reasoning": "<1-3 sentences>",
  "ranked_actions": [<list of indices, best first>],
  "expected_endboard_after_this_play": ["<card 1>", "<card 2>", "..."],
  "confidence": "high|medium|low"
}
\`\`\`
`;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const trajectoryPath = parseStringArg('trajectory');
  const outDir = parseStringArg('out');
  const noHint = process.argv.includes('--no-hint');
  if (!trajectoryPath || !outDir) {
    console.error('Usage: --trajectory=<path> --out=<output-dir> [--no-hint]');
    process.exit(2);
  }

  const traj = JSON.parse(readFileSync(resolve(trajectoryPath), 'utf-8')) as TrajectoryFile;
  const fixture = loadFixtureFile();
  const hand = fixture.hands.find(h => h.id === traj.fixtureId);
  if (!hand) throw new Error(`Fixture ${traj.fixtureId} not found`);
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`Deck ${hand.deck} not found`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  adapter.exposeMultiPickMechanical = true;

  const allCards = [...deck.main, ...deck.extra, ...hand.hand];
  const metadata = buildCardMetadataMap(cardDB, allCards);

  // Card-name lookup via cardDB SQLite prepared statement (same path as
  // OCGCoreAdapter.getCardName). Cached locally to avoid hot-path SQL roundtrip
  // when rendering large deck lists.
  const nameCache = new Map<number, string>();
  const getName = (code: number): string => {
    if (!code) return '';
    const cached = nameCache.get(code);
    if (cached !== undefined) return cached;
    const row = cardDB.nameStmt.get(code) as { name: string } | undefined;
    const name = row?.name ?? `#${code}`;
    nameCache.set(code, name);
    return name;
  };

  // Setup duel
  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) throw new Error(`Hand card ${cid} not in main deck`);
    mainDeck.splice(idx, 1);
  }
  const duelConfig: DuelConfig = {
    mainDeck,
    extraDeck: deck.extra,
    hand: hand.hand,
    deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 1,
  };
  const handle = adapter.createDuel(duelConfig);

  const fixtureOutDir = resolve(outDir, traj.fixtureId);
  mkdirSync(fixtureOutDir, { recursive: true });
  console.log(`[poc] writing prompts to ${fixtureOutDir}`);

  const groundTruthLines: string[] = [];
  let promptsGenerated = 0;
  const expectedBoard = hand.expectedBoard ?? [];
  const steps = getSteps(traj);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const legal = adapter.getLegalActions(handle);
    if (legal.length === 0) {
      console.error(`[poc] step ${i}: no legal actions`);
      process.exit(1);
    }
    const matched = legal.find(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId);
    if (!matched) {
      console.error(`[poc] step ${i}: drift — no matching legal action for ${step.cardName}`);
      process.exit(1);
    }

    const promptType = legal[0].promptType;

    // Generate Markdown prompt only for strategic prompts.
    // SELECT_IDLECMD = main strategic decisions.
    // SELECT_CARD = target picks (also strategic but more numerous).
    // SELECT_CHAIN with -1 (pass) is mechanical, skip.
    const isStrategic = promptType === 'SELECT_IDLECMD' || promptType === 'SELECT_CARD';
    if (isStrategic) {
      const state = adapter.getFieldState(handle);
      const prompt = buildPrompt(hand, deck.main, deck.extra, metadata, state, legal, i, expectedBoard, getName, noHint);
      const filename = `step-${String(i).padStart(2, '0')}-${promptType.toLowerCase()}.md`;
      writeFileSync(join(fixtureOutDir, filename), prompt, 'utf-8');
      const groundTruthIdx = legal.findIndex(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId);
      groundTruthLines.push(JSON.stringify({
        step: i,
        promptType,
        groundTruthIndex: groundTruthIdx,
        groundTruthCard: step.cardName,
        groundTruthCardId: step.cardId,
        legalActionCount: legal.length,
        promptFile: filename,
      }));
      promptsGenerated++;
      console.log(`[poc] step ${i} (${promptType}): wrote ${filename} — ground truth = action ${groundTruthIdx} (${step.cardName})`);
    }

    adapter.applyAction(handle, matched);
  }

  writeFileSync(join(fixtureOutDir, 'ground-truth.jsonl'), groundTruthLines.join('\n') + '\n', 'utf-8');
  adapter.destroyAll();
  console.log(`\n[poc] generated ${promptsGenerated} prompts for ${traj.fixtureId}`);
  console.log(`[poc] ground truth: ${join(fixtureOutDir, 'ground-truth.jsonl')}`);
}

main().catch(err => {
  console.error('[poc] error:', err);
  process.exit(1);
});
