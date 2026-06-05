/**
 * PvP↔Replay event stream normalisation — Phase 0 of chantier v4.
 *
 * Strips volatile fields (refs, timestamps, traceIds) and filters out
 * events that are mechanically different between modes by design, so
 * the remaining events can be compared structurally with toEqual.
 *
 * See `_bmad-output/planning-artifacts/pvp-replay-event-stream-parity-spec-2026-06-05.md`
 * for the underlying decisions ("strip or compare" for SELECT_*,
 * AnimationStarted/Completed, etc.).
 */

export type RawStreamEvent = Record<string, unknown> & {
  type?: string;
  kind?: string;
};

export type NormalizedEvent = Record<string, unknown>;

/**
 * Fields that are stripped from every event because they encode runtime
 * timings or monotonic counters that have no reason to be identical
 * across two independent runs of the same duel.
 *
 * - `ref` — monotonic counter from AnimationOrchestratorService, resets
 *   at each duel. Two independent runs MAY assign different refs to
 *   semantically identical events (different runner timing).
 * - `timestamp` — wall-clock, never identical.
 * - `traceId` — DuelLogger trace, run-specific.
 * - `boardStateAfter` — server-side snapshot for chain-resolving events.
 *   Tested for equality elsewhere ; in the stream we compare the raw
 *   event, not the snapshot it carries.
 * - `lpDelta` — decorated by orchestrator's `decorateLpEventForStream`.
 *   Depends on `LpAnimationTracker.trackedLp` at the moment the event
 *   was emitted ; if the streams agree on the LP base AND the deltas,
 *   keeping the field is fine, but stripping it removes one potential
 *   source of false-positives during the v0 of the test.
 */
const VOLATILE_FIELDS = [
  'ref',
  'timestamp',
  'traceId',
  'boardStateAfter',
  'lpDelta',
  // Boundary events (kind: 'boundary') carry a wall-clock `at` field.
  // Internal transport events also use `at`. Either way it's runtime
  // metadata, not semantic content to compare.
  'at',
] as const;

/**
 * Stream event kinds that are filtered out entirely in v0 of the test
 * because their emission timing is by-construction different between
 * PvP and Replay.
 *
 * - `kind: 'animation'` (AnimationStarted, AnimationCompleted) — emitted
 *   by the QueueRunner around dispatch ; their RELATIVE order depends
 *   on the runner's exact loop timing, not on the semantic content of
 *   the duel. Including them creates false-positives that obscure real
 *   divergences.
 * - InternalTransportEvent (`runner-started`, `runner-stopped`,
 *   `rescue-*`, `watchdog-*`) — pure mechanic of the queue runner ; not
 *   carrying a `kind` field uniformly (some carry a `type` like
 *   `'runner-started'`). Filtered by name prefix.
 *
 * If we want stricter parity later, lift these to a separate stream
 * comparison pass.
 */
function isFilteredOut(event: RawStreamEvent): boolean {
  if (event.kind === 'animation') return true;
  // InternalTransportEvent objects carry their discriminator on `kind`
  // (not `type`) — `runner-started`, `runner-stopped`, `rescue-fired`,
  // `rescue-abandoned`, `watchdog-armed`. Filter all of them : they
  // encode the queue runner's mechanical loop state, not anything
  // semantic about the duel that should be compared.
  if (typeof event.kind === 'string') {
    if (event.kind.startsWith('runner-')) return true;
    if (event.kind.startsWith('rescue-')) return true;
    if (event.kind.startsWith('watchdog-')) return true;
  }
  // Legacy guard — same discriminators may also surface on `type` if a
  // future change uses that shape instead.
  if (typeof event.type === 'string') {
    if (event.type.startsWith('runner-')) return true;
    if (event.type.startsWith('rescue-')) return true;
    if (event.type.startsWith('watchdog-')) return true;
  }
  return false;
}

/**
 * Strip volatile fields from a single event. Returns a NEW object — does
 * not mutate the input.
 *
 * Performs a shallow copy + delete pass. Nested objects (e.g. card
 * payloads) are referenced as-is ; they typically don't carry volatile
 * fields at their level. If a future stream event nests a `ref` or
 * `timestamp` one level deep, extend this helper.
 */
function stripVolatileFields(event: RawStreamEvent): NormalizedEvent {
  const out: NormalizedEvent = { ...event };
  for (const field of VOLATILE_FIELDS) {
    delete out[field];
  }
  return out;
}

/**
 * Normalize a captured EventStream for comparison.
 *
 * Pipeline :
 * 1. Filter out non-comparable events (animation flux, internal transport).
 * 2. Strip volatile fields from each remaining event.
 *
 * Returns a plain array suitable for `expect(a).toEqual(b)`.
 */
export function normalizeStream(stream: readonly unknown[]): NormalizedEvent[] {
  return stream
    .filter((e): e is RawStreamEvent => typeof e === 'object' && e !== null)
    .filter(e => !isFilteredOut(e))
    .map(stripVolatileFields);
}

/**
 * Build a human-readable diff summary between two normalized streams.
 * Used to make test failures actionable — `toEqual` shows ENORMOUS
 * diffs that drown the real divergence, this helper finds the first
 * point of disagreement and prints a compact context window.
 *
 * Returns `null` if the streams are identical.
 */
export function findFirstDivergence(
  a: NormalizedEvent[],
  b: NormalizedEvent[],
): { index: number; context: string } | null {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      return {
        index: i,
        context: formatContext(a, b, i),
      };
    }
  }
  if (a.length !== b.length) {
    return {
      index: minLen,
      context: formatContext(a, b, minLen),
    };
  }
  return null;
}

function formatContext(a: NormalizedEvent[], b: NormalizedEvent[], i: number): string {
  const start = Math.max(0, i - 2);
  const end = Math.min(Math.max(a.length, b.length), i + 3);
  const lines: string[] = [
    `--- divergence at index ${i} ---`,
    `Stream A length: ${a.length} | Stream B length: ${b.length}`,
    '',
  ];
  for (let j = start; j < end; j++) {
    const marker = j === i ? '>>>' : '   ';
    const aStr = j < a.length ? compactEvent(a[j]) : '<absent>';
    const bStr = j < b.length ? compactEvent(b[j]) : '<absent>';
    lines.push(`${marker} [${j}] A: ${aStr}`);
    lines.push(`${marker}     B: ${bStr}`);
  }
  return lines.join('\n');
}

function compactEvent(e: NormalizedEvent): string {
  const type = (e['type'] as string | undefined) ?? (e['kind'] as string | undefined) ?? '?';
  const interesting: string[] = [type];
  if (typeof e['cardCode'] === 'number') interesting.push(`card=${e['cardCode']}`);
  if (typeof e['player'] === 'number') interesting.push(`p=${e['player']}`);
  if (typeof e['chainIndex'] === 'number') interesting.push(`ch=${e['chainIndex']}`);
  if (typeof e['fromLocation'] === 'number') interesting.push(`from=${e['fromLocation']}`);
  if (typeof e['toLocation'] === 'number') interesting.push(`to=${e['toLocation']}`);
  if (typeof e['name'] === 'string') interesting.push(`name=${e['name']}`);
  return interesting.join(' ');
}
