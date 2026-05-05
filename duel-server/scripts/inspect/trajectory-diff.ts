// =============================================================================
// trajectory-diff.ts — align two prompt traces on the same fixture initial
// state and report the first divergence point. Designed to diagnose why a
// Path β plan stalls at N/M while a PvP raw-replay reaches the full
// expectedBoard at the same `(seed, hand, deck)`.
//
// Inputs: two JSONL traces produced by either:
//   - `raw-replay-verify.ts --dump-prompt-trace=...` (OCGCore-direct PvP)
//   - `replay-trajectory-cli.ts --dump-trace=...` (adapter, β-1 plan)
//
// The two trace formats differ slightly:
//   - OCGCore-direct: every select-prompt the engine emits, including
//     mechanical sub-prompts the adapter would auto-resolve.
//   - Adapter: only "exploratory" prompts the adapter exposes to the search
//     (SELECT_IDLECMD/BATTLECMD/CHAIN/EFFECTYN/YESNO/OPTION + selected
//     SELECT_CARD when isExploratory).
//
// The diff aligns on the Player-0 exploratory prompts (skipping mechanical
// auto-resolved ones from the OCGCore stream and opponent prompts) and
// compares the picked response. The first cardId or responseIndex mismatch
// is reported as the divergence point with full context (legal options on
// each side, position in the trace, etc.).
//
// Usage:
//   npx tsx scripts/trajectory-diff.ts \
//     --pvp-trace=/tmp/ddd-pvp.trace.jsonl \
//     --adapter-trace=/tmp/ddd-adapter.trace.jsonl \
//     [--out=/tmp/ddd-diff.json]
//
// Limitations:
//   - Cardinality of "exploratory" prompts can differ between traces if the
//     two trajectories diverge structurally (e.g. one fires an extra trigger
//     the other doesn't). The diff reports the first point where the
//     trajectories cease to be alignable.
//   - SELECT_CARD/SELECT_PLACE/SELECT_POSITION on the OCGCore stream are
//     auto-resolved by the adapter and don't appear in adapter trace. The
//     adapter's auto-resolve choice is implicit; this diff currently can't
//     surface those. Adapter would need to log its auto-resolve picks.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const pvpPath = parseArg('pvp-trace');
const adapterPath = parseArg('adapter-trace');
const outPath = parseArg('out');
if (!pvpPath || !adapterPath) {
  console.error('[diff] required: --pvp-trace=<path> --adapter-trace=<path> [--out=<path>]');
  process.exit(2);
}

// -----------------------------------------------------------------------------
// Trace types — each tool dumps its own slightly-different schema.
// -----------------------------------------------------------------------------
interface PvpTraceEntry {
  step: number;
  stepIdx: number | null;
  promptType: string;
  promptPlayer: number;
  response: Record<string, unknown>;
  source: 'pvp' | 'auto';
  options?: number[];
}

interface AdapterTraceEntry {
  step: number;
  promptType: string;
  pickSource: 'plan' | 'raw' | 'target' | 'auto' | 'auto-end-phase';
  legal: Array<{ responseIndex: number; cardId: number; cardName?: string; verb?: string }>;
  picked: { cardId: number; responseIndex: number };
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(resolve(path), 'utf-8');
  return raw.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l) as T);
}

const pvp = readJsonl<PvpTraceEntry>(pvpPath);
const adapter = readJsonl<AdapterTraceEntry>(adapterPath);
console.log(`[diff] loaded ${pvp.length} PvP trace entries`);
console.log(`[diff] loaded ${adapter.length} adapter trace entries`);

// -----------------------------------------------------------------------------
// Filter: keep only Player-0 EXPLORATORY prompts on both sides.
// Exploratory = the prompts the adapter exposes to the search.
// -----------------------------------------------------------------------------
const EXPLORATORY = new Set([
  'SELECT_IDLECMD',
  'SELECT_BATTLECMD',
  'SELECT_CHAIN',
  'SELECT_EFFECTYN',
  'SELECT_YESNO',
  'SELECT_OPTION',
]);

const pvpExploratory = pvp.filter(e => e.promptPlayer === 0 && EXPLORATORY.has(e.promptType));
const adapterExploratory = adapter.filter(e => EXPLORATORY.has(e.promptType));
console.log(`[diff] PvP exploratory (P0): ${pvpExploratory.length}`);
console.log(`[diff] Adapter exploratory: ${adapterExploratory.length}`);

// -----------------------------------------------------------------------------
// Decode picked response into (cardId, responseIndex) on the PvP side.
// The PvP response is a raw OcgCore response object; we decode based on
// promptType. For SELECT_CHAIN, the index field == responseIndex (or null
// for pass). For SELECT_IDLECMD, the action+index combo encodes which card
// in the legal list — but without the same legal-action enumeration we
// can't decode the cardId here. We compare the raw response object instead.
// -----------------------------------------------------------------------------
function pvpPickedSummary(e: PvpTraceEntry): string {
  const r = e.response;
  switch (e.promptType) {
    case 'SELECT_IDLECMD':
      return `action=${r.action} index=${r.index ?? '-'}`;
    case 'SELECT_BATTLECMD':
      return `action=${r.action} index=${r.index ?? '-'}`;
    case 'SELECT_CHAIN':
      return r.index === null ? 'PASS' : `chain idx=${r.index}`;
    case 'SELECT_EFFECTYN':
      return r.yes ? 'YES' : 'NO';
    case 'SELECT_YESNO':
      return r.yes ? 'YES' : 'NO';
    case 'SELECT_OPTION':
      return `opt idx=${r.index}`;
    default:
      return JSON.stringify(r);
  }
}

function adapterPickedSummary(e: AdapterTraceEntry): string {
  const cardName = e.picked.cardId > 0
    ? (e.legal.find(a => a.responseIndex === e.picked.responseIndex)?.cardName ?? `#${e.picked.cardId}`)
    : 'PASS/auto';
  switch (e.promptType) {
    case 'SELECT_IDLECMD':
    case 'SELECT_BATTLECMD':
      return `${cardName} (rIdx=${e.picked.responseIndex})`;
    case 'SELECT_CHAIN':
      return e.picked.responseIndex === -1 ? 'PASS' : `chain ${cardName} (rIdx=${e.picked.responseIndex})`;
    case 'SELECT_EFFECTYN':
    case 'SELECT_YESNO':
      return e.picked.responseIndex === 1 ? 'YES' : 'NO';
    case 'SELECT_OPTION':
      return `opt idx=${e.picked.responseIndex}`;
    default:
      return JSON.stringify(e.picked);
  }
}

// -----------------------------------------------------------------------------
// Lightweight semantic equality — true when the picked response is "the same
// decision" on both sides, even if the underlying response object differs.
// -----------------------------------------------------------------------------
function semanticallyEqual(p: PvpTraceEntry, a: AdapterTraceEntry): { equal: boolean; reason?: string } {
  if (p.promptType !== a.promptType) {
    return { equal: false, reason: `promptType mismatch (PvP=${p.promptType}, adapter=${a.promptType})` };
  }
  const r = p.response;
  switch (p.promptType) {
    case 'SELECT_IDLECMD':
    case 'SELECT_BATTLECMD': {
      // PvP: { type, index, action }; adapter: { responseIndex, cardId }
      // Both encode the same logical decision but in different shapes.
      // Without re-enumerating legal actions, we can only compare the action
      // ordinal. action 5 (activate) at index N → adapter responseIndex
      // depends on order of activates in legal list. Best we can do here
      // is compare the action+index pair vs the adapter's picked cardId — if
      // the picked cardId on adapter side appears in the PvP-side enumerated
      // (which we don't have), we'd be precise. Fallback: report a
      // structural diff and let the human inspect.
      const pAction = r.action;
      const pIdx = r.index;
      // Heuristic: if adapter picked PASS-class (action=6/7 to_bp/to_ep) and
      // pvp action is 6 or 7, equal. Otherwise inspect cardId.
      if ((pAction === 6 || pAction === 7) && a.picked.cardId === 0) {
        if (Number(pAction) === (a.picked.responseIndex - (a.legal.length - 1)) + 7) {
          return { equal: true };
        }
      }
      // Coarse: PvP action+index vs adapter cardId. We can't fully decode
      // without re-enumerating. Mark as "indeterminate match" — caller
      // inspects manually.
      return { equal: false, reason: `IDLECMD/BATTLECMD shape differs (PvP action=${pAction} idx=${pIdx}, adapter cardId=${a.picked.cardId})` };
    }
    case 'SELECT_CHAIN': {
      const pPass = r.index === null;
      const aPass = a.picked.responseIndex === -1;
      if (pPass !== aPass) return { equal: false, reason: `CHAIN pass mismatch (PvP pass=${pPass}, adapter pass=${aPass})` };
      if (!pPass && r.index !== a.picked.responseIndex) {
        return { equal: false, reason: `CHAIN index mismatch (PvP=${r.index}, adapter=${a.picked.responseIndex})` };
      }
      return { equal: true };
    }
    case 'SELECT_EFFECTYN':
    case 'SELECT_YESNO': {
      const pYes = r.yes === true;
      const aYes = a.picked.responseIndex === 1;
      if (pYes !== aYes) return { equal: false, reason: `${p.promptType} yes/no mismatch (PvP=${pYes ? 'YES' : 'NO'}, adapter=${aYes ? 'YES' : 'NO'})` };
      return { equal: true };
    }
    case 'SELECT_OPTION': {
      const pIdx = r.index as number;
      if (pIdx !== a.picked.responseIndex) {
        return { equal: false, reason: `OPTION index mismatch (PvP=${pIdx}, adapter=${a.picked.responseIndex})` };
      }
      return { equal: true };
    }
    default:
      return { equal: false, reason: `no semantic comparator for ${p.promptType}` };
  }
}

// -----------------------------------------------------------------------------
// Walk both filtered streams in parallel.
// -----------------------------------------------------------------------------
const N = Math.min(pvpExploratory.length, adapterExploratory.length);
console.log(`\n[diff] walking ${N} aligned exploratory prompts (PvP=${pvpExploratory.length}, adapter=${adapterExploratory.length}):\n`);

interface DiffEntry {
  alignedStep: number;
  pvpPromptType: string;
  pvpStepIdx: number | null;
  pvpPicked: string;
  adapterStep: number;
  adapterPicked: string;
  pickSource: AdapterTraceEntry['pickSource'];
  divergent: boolean;
  reason?: string;
}

const diffEntries: DiffEntry[] = [];
let firstDivergence: DiffEntry | null = null;

for (let i = 0; i < N; i++) {
  const p = pvpExploratory[i];
  const a = adapterExploratory[i];
  const cmp = semanticallyEqual(p, a);
  const entry: DiffEntry = {
    alignedStep: i,
    pvpPromptType: p.promptType,
    pvpStepIdx: p.stepIdx,
    pvpPicked: pvpPickedSummary(p),
    adapterStep: a.step,
    adapterPicked: adapterPickedSummary(a),
    pickSource: a.pickSource,
    divergent: !cmp.equal,
    reason: cmp.reason,
  };
  diffEntries.push(entry);
  if (!cmp.equal && !firstDivergence) firstDivergence = entry;
}

// -----------------------------------------------------------------------------
// Print summary
// -----------------------------------------------------------------------------
console.log('aligned#  PvP                                 adapter                              source     diff');
console.log('────────  ──────────────────────────────────  ──────────────────────────────────  ─────────  ────');
for (const e of diffEntries.slice(0, firstDivergence ? firstDivergence.alignedStep + 5 : 30)) {
  const pvpCol = `[${String(e.pvpStepIdx ?? '?').padStart(3)}] ${e.pvpPromptType.slice(0, 16).padEnd(16)} ${e.pvpPicked.slice(0, 14).padEnd(14)}`;
  const adapterCol = `[${String(e.adapterStep).padStart(3)}] ${e.pvpPromptType.slice(0, 16).padEnd(16)} ${e.adapterPicked.slice(0, 14).padEnd(14)}`;
  const mark = e.divergent ? '  ⚠ DIFF' : '';
  console.log(`${String(e.alignedStep).padStart(8)}  ${pvpCol}  ${adapterCol}  ${e.pickSource.padEnd(9)}${mark}`);
}

console.log('');
if (firstDivergence) {
  console.log(`[diff] FIRST DIVERGENCE at aligned step ${firstDivergence.alignedStep}:`);
  console.log(`         promptType:    ${firstDivergence.pvpPromptType}`);
  console.log(`         PvP picked:    ${firstDivergence.pvpPicked} (raw stepIdx=${firstDivergence.pvpStepIdx})`);
  console.log(`         adapter picked:${firstDivergence.adapterPicked} (adapter step=${firstDivergence.adapterStep}, source=${firstDivergence.pickSource})`);
  console.log(`         reason:        ${firstDivergence.reason}`);
} else {
  console.log(`[diff] no divergence in the first ${N} aligned prompts. PvP=${pvpExploratory.length} adapter=${adapterExploratory.length}.`);
  if (pvpExploratory.length !== adapterExploratory.length) {
    console.log(`         cardinality mismatch — adapter trajectory ${adapterExploratory.length < pvpExploratory.length ? 'stopped early' : 'has more prompts'}`);
  }
}

if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify({
    pvpTotal: pvpExploratory.length,
    adapterTotal: adapterExploratory.length,
    aligned: N,
    firstDivergence,
    entries: diffEntries,
  }, null, 2) + '\n', 'utf-8');
  console.log(`[diff] wrote ${outPath}`);
}

process.exit(firstDivergence ? 1 : 0);
