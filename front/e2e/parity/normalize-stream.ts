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
 * - `kind: 'boundary'` (TurnStarted/Ended, PhaseStarted/Ended, ChainStarted/Ended)
 *   — emitted by the BoundaryProcessor. v4 Phase 0 investigation 2026-06-05
 *   revealed STRUCTURAL divergences between SOLO and Replay:
 *     · Replay `ReplayDuelAdapter.resetProcessorForTransition` calls
 *       `processor.reset()` at every idle transition, which silentResets
 *       the BoundaryProcessor's `lastTurn`/`lastPhase` state. The next
 *       `observeBoardState` then takes the "first BOARD_STATE" path
 *       (asymmetric, no preceding `*Ended`) and re-emits TurnStarted +
 *       PhaseStarted, even when turn/phase has not actually changed.
 *       Result : Replay emits N pairs of (TurnStarted, PhaseStarted) for
 *       N PreComputedStates, where SOLO emits only on real deltas.
 *     · SOLO emits PhaseEnded/TurnEnded on real phase/turn transitions
 *       (BP delta detection works because BP state survives in PvP/SOLO).
 *       Replay never emits them because the BP is reset between every
 *       PreComputedState before any delta is observable.
 *   Filtered out of the v0 parity test ; the fix (don't reset BP at every
 *   idle transition in the replay adapter) is a Phase 1+ concern. Cf.
 *   the docblock at `replay-duel-adapter.ts:resetProcessorForTransition`.
 *
 * If we want stricter parity later, lift these to a separate stream
 * comparison pass.
 */
function isFilteredOut(event: RawStreamEvent): boolean {
  if (event.kind === 'animation') return true;
  // Étape 2 (2026-06-12) — HARNESS artifact, not a pipeline divergence :
  // the SOLO capture runs with a server-side tape player that answers
  // SELECT_* before they reach the client, so the SOLO stream never sees
  // the SELECT_CARD push the live PvP wire produces ; the replay mock
  // dispatches it normally. Filter on both sides. Lift this if tape mode
  // ever forwards prompts (parity spec doc § Backlog futur).
  if (event.type === 'SELECT_CARD') return true;
  // v4 Phase 0 — boundary events have structurally different emission
  // patterns between Replay (re-emitted per PreComputedState) and SOLO
  // (emitted on actual delta). Defer to Phase 1+ for the pipeline fix.
  if (event.kind === 'boundary') return true;
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
  // D/D/D triage (2026-06-12) — HARNESS artifacts on `kind: 'deferred'`
  // events (DeferredEffect / EffectReady / EffectAbandoned). The DEP keys
  // its deferreds on the orchestrator's monotonic `ref`, which counts
  // EVERY pushed event including mode-specific ones (SELECT_CARD pushes,
  // boundary re-emissions…) — two runs of the same duel legitimately
  // assign different refs to identical deferreds. Three carriers :
  //   · `triggerRef` — the raw ref.
  //   · `awaitingPredicate.ref` — the matcher embeds the same ref.
  //   · `name` — every rule except `overlay-show:chain-N` suffixes the
  //     ref into the name for uniqueness (`trigger-show:CODE:REF`,
  //     `attack-impact:REF`, `lp-cost:REF`, `counter-pulse:REF`,
  //     `xyz-leave:REF`). `overlay-show`'s suffix is the chainIndex
  //     (semantic) and is kept.
  if (out['kind'] === 'deferred') {
    delete out['triggerRef'];
    const pred = out['awaitingPredicate'];
    if (typeof pred === 'object' && pred !== null) {
      const cleaned = { ...(pred as Record<string, unknown>) };
      delete cleaned['ref'];
      out['awaitingPredicate'] = cleaned;
    }
    const name = out['name'];
    if (typeof name === 'string' && !name.startsWith('overlay-show:')) {
      out['name'] = name.replace(/:\d+$/, '');
    }
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
  const normalized = stream
    .filter((e): e is RawStreamEvent => typeof e === 'object' && e !== null)
    .filter(e => !isFilteredOut(e))
    .map(stripVolatileFields);
  // Étape 2 (2026-06-12) — drop the leading initial-draw run. The replay
  // baseline `seekToOffset(0)` restores nav[0] via its boardStateSnapshot
  // and never DISPATCHES entry 0's MSG_DRAWs (by design since Phase 5 —
  // the viewer opens on the post-draw board) ; the SOLO client animates
  // them. Comparing them is comparing the bootstrap UX choice, not the
  // pipeline. Only the head-of-stream consecutive MSG_DRAW run is dropped
  // — mid-duel draws stay compared.
  let firstNonDraw = 0;
  while (firstNonDraw < normalized.length && normalized[firstNonDraw]['type'] === 'MSG_DRAW') firstNonDraw++;
  return canonicalizeResolvingWindows(normalized.slice(firstNonDraw));
}

/**
 * Étape 2 (2026-06-12) — canonicalize the event order INSIDE each chain
 * resolving window ([MSG_CHAIN_SOLVING .. MSG_CHAIN_END]).
 *
 * The order in which buffered board events drain relative to
 * MSG_CHAIN_SOLVED is PACING-dependent, not a contract : with a human /
 * auto-dismiss pause the queue empties and the 4a rescue drains the buffer
 * BEFORE the SOLVED dispatch ; when the server floods (tape pacing, fast
 * responder) the SOLVING banner keeps the queue busy and the drain happens
 * via the overlay AFTER SOLVED. Both are legal executions of the same
 * contract (CLAUDE.md "Mid-chain buffer drain rescue"). The gate therefore
 * compares each window as a CANONICALLY-ORDERED MULTISET : content and
 * multiplicities stay strict, intra-window order does not. The window
 * head (first SOLVING) and the CHAIN_END stay anchored.
 */
function canonicalizeResolvingWindows(events: NormalizedEvent[]): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e['type'] !== 'MSG_CHAIN_SOLVING') {
      out.push(e);
      i++;
      continue;
    }
    // Window: from this SOLVING (kept as anchor) to MSG_CHAIN_END
    // (exclusive ; kept as anchor) — or end-of-stream for truncated
    // captures (duel cut mid-chain).
    let j = i + 1;
    while (j < events.length && events[j]['type'] !== 'MSG_CHAIN_END') j++;
    const window = events.slice(i + 1, j);
    window.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
    out.push(e, ...window);
    if (j < events.length) out.push(events[j]); // the CHAIN_END anchor
    i = j + 1;
  }
  return out;
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
