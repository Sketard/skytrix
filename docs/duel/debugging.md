# Moteur de duel — débogage

**Lecture** : les journaux (`DuelLogger`), `window.__skytrixDebug` et le harnais de débogage Playwright ; texte de
l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin `workbench`. Index du moteur de duel
: [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par plage.

## Sommaire

1. Debugging Animations (`DuelLogger` + `DuelDebugService` + harness)

## Debugging Animations (`DuelLogger` + `DuelDebugService` + harness)

The animation pipeline has three layers of instrumentation. Use them in
order — they're additive, not redundant.

### Layer 1 — `DuelLogger` categories

`DuelLogger` is the gated console logger. Eleven categories, each filterable
via `localStorage['duel-log-categories']` (CSV) or the DevHub toggle. Default
set keeps the console readable; the three **verbose** categories are off by
default and must be opted in.

- `QUEUE` / `MOVE` / `DRAW` / `CHAIN` / `SHUFFLE` / `LP` / `PROC` / `REPLAY`
  — the existing animation pipeline categories. Loud but bounded; on by
  default.
- `RESOLVE` (verbose) — every conversion from a string identifier to a
  runtime object: `getZoneElement(zoneKey) → HTMLElement | null`,
  `popLandedFloat(prefix, cardCode) → HTMLElement | null`,
  `findCardOnField → CardOnField | null`. Off by default. **A failing
  resolve auto-promotes to `logger.warn`** so silent skips surface even
  when the category is filtered out.
- `PIPELINE` (verbose) — message ingestion across the WS / Replay adapter /
  `DuelEventProcessor` boundary. One line per WS message received
  (`ws.recv type=…`), per `processMessage` entry/exit with queue-length
  delta, per `advanceStep` step kind. Off by default. Use when diagnosing
  "did the event arrive at all".
- `RUNNER` (verbose, Palier A 2026-05-23) — `QueueRunner` internal trace.
  One line per queue tick (the `action` returned by `decideNextStep` +
  the inputs that drove it: `isResolving`, `queueLen`,
  `isWaitingForOverlay`, `commitMode`). Lifecycle transitions
  (`notifyEnqueue`, `requestStop`, generation bump) and rescue/finalize
  events get their own trace lines. Use when diagnosing re-entry, stalls,
  or stale-loop bugs.

`logger.resolve(method, input, result, note?)` is the canonical helper for
the `RESOLVE` category — it formats consistently and handles the null →
warn promotion automatically. Don't roll your own `console.log` for zone
lookups; use `logger.resolve`.

### Layer 2 — `window.__skytrixDebug`

`DuelDebugService` is provided at the duel-page + replay-page component
level and exposes itself on `window.__skytrixDebug` in dev mode only
(`isDevMode() === true`). No-op + tree-shaken in production.

The console surface:

- `__skytrixDebug.snapshot()` — JSON-serialisable state dump
  (logicalState, renderedState, animationQueue, chain.phase + activeLinks,
  locks, inFlightFloats, landedFloats, preActivationBuffer). The
  `domZones` field is a getter — invoking it forces ~50
  `getBoundingClientRect` reads, so don't call it on every animation tick.
- `__skytrixDebug.dump()` — same as snapshot, but also pretty-prints a
  grouped console block. Cheap.
- `__skytrixDebug.enableAll()` — turn on every log category, including
  RESOLVE + PIPELINE. Persists to localStorage.
- `__skytrixDebug.setLogCategories([...])` — fine-grained set.
- `__skytrixDebug.help()` — lists the above in the console.

The snapshot is the right tool when "the animation looks stalled, what's
the state right now?". From DevTools console, paste:
```
copy(JSON.stringify(__skytrixDebug.snapshot(), null, 2))
```
and the JSON dump goes to your clipboard for bug-report inclusion.

### Layer 3 — Playwright debug harness

Two stacked entry points share the same plumbing (login + optional `ng
build` + static server + screenshot/snapshot capture + Markdown report).
Pick the entry point that matches your scenario:

**A — Play through to end.** `front/e2e/debug-replay-harness.ts` exports
`runReplayDebug(ctx, { replayId, perspective, screenshotOn, buildFirst,
fromEvent, timeoutSec })`. Opens the replay, clicks Play, waits for the
end overlay. Use this when the bug surfaces during natural playback and
you just need a captured trace. First arg is the Playwright
`BrowserContext`.

**B — Scenario-based (seek / toggle / step / assert).** `front/e2e/replay-debug-driver.ts`
exports `setupReplaySession(ctx, opts)` + `ReplayDebugDriver`. Use this
when the bug requires a specific user-driven trajectory — mid-chain
seek, perspective flip, prompt-mode toggle, etc. Pattern:

```ts
const session = await setupReplaySession(ctx, { replayId, perspective: 1 });
try {
  await session.driver.waitForBoardStates(50);
  await session.driver.seek(42);                 // jump into a chain
  await session.capture('after-seek-mid-chain');
  const cs = await session.driver.chainState();   // assert overlay restored
  expect(cs.activeChainLinks.length).toBeGreaterThan(0);
  await session.driver.togglePerspective();
  await session.capture('after-perspective-flip');
} finally {
  await session.finalize();
  await session.page.close();
}
```

`ReplayDebugDriver` methods (all `async`, all go through the SAME
component handlers the transport-bar invokes on click — fires
`abortAndClean()` + `gameLogRebuildTick++` exactly like a real click) :

- **Navigation** : `seek(idx)`, `stepForward()`, `stepBack()`,
  `skipStart()`, `skipEnd()`, `playPause()`.
- **Toggles** : `togglePerspective()`, `toggleAnimations()`,
  `togglePromptMode()`.
- **Read-only inspectors** : `currentIndex()`, `totalBoardStates()`,
  `perspectiveIndex()`, `animationsEnabled()`, `promptMode()`,
  `isPlaying()`, `chainState()` (live read of
  `processor.activeChainLinks` + `chainPhase`),
  `currentStateChainSnapshot()` (the precompute's embedded
  `ReplayStreamNavEntry.chainSnapshot` for the current index — F9-bis
  verification surface), `fullSnapshot()` (whole `__skytrixDebug.snapshot()`).
- **Wait helpers** : `waitForIndex(target)`, `waitForBoardStates(target)`,
  `waitForEndOverlay(timeout)`.

The driver talks to a stable global surface (`window.__skytrixDebug.replay`,
wired in `replay-page.component.ts:bindToWindow` block) instead of DOM
selectors that may shift when the transport-bar / timeline is reworked.
Dev-only by design — the surface is gated on `isDevMode()`. Adding a new
debug action ? Wire it once in the component's `bindToWindow` block AND
add the typed wrapper on `ReplayDebugDriver` so consumers get
auto-completion + tsc drift detection.

**Common to both A and B** — output goes to `work/debug-replay/<tag>/`:

- `report.md` — timeline of captures, warnings, errors, last 100 PIPELINE
  lines. Read this first.
- `console.log` — raw filtered log with timestamps.
- `frames/<idx>-<label>.png` — screenshots at each trigger.
- `snapshots/<idx>-<label>.json` — `__skytrixDebug.snapshot()` dump
  paired with each screenshot.

Two run modes:

1. **`buildFirst: false`** (fast, fragile) — points at the user's running
   `ng serve`. Iterative dev mode. HMR can truncate captures if you edit
   code mid-run.
2. **`buildFirst: true`** (slow, reproducible) — runs `ng build
   --configuration=development`, serves the static output on a free port,
   captures against that. ~30s overhead for the build, then HMR-immune.
   Use for archival captures + regression snapshots.

Run via:
```
npm run debug:replay              # default example spec
npx playwright test e2e/<spec>    # specific spec
```

Copy `debug-replay-example.spec.ts` as the template for the play-to-end
pattern. The trigger pattern that worked for the 2026-05-18 EMZ resolver
bug was `screenshotOn: ['travel skipped']` — every `travel skipped` warn
captures a frame + snapshot at the bug moment. For scenario-based
debugging, write a new spec that imports `setupReplaySession` directly.

### What NOT to instrument

- Bind expensive payloads (board-state dumps, large arrays) behind
  `logger.isEnabled(cat)` checks so the cost is paid only when the
  category is on.
- Don't use `duelAssert()` for new resolve-style failures — the
  warn-on-null path in `logger.resolve()` is already the right
  signal-without-throw mechanism.
- Don't add console.log directly — go through DuelLogger so the output
  is categorised + the prefix + traceId are consistent.
