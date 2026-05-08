// =============================================================================
// WASM Memory Snapshot — PVP Duel Worker
// =============================================================================
//
// Single-slot WASM linear-memory snapshot/restore primitives for the PVP
// duel worker. Lifted from the solver's `forkViaSnapshot` /
// `restoreTopSnapshot` pattern (see `solver/ocgcore-adapter.ts:2095-2155`)
// but stripped to single-slot semantics — no LIFO stack, no parent/child
// handle accounting. P0-3bis-POC.1 only needs to prove that one snapshot
// can be taken, restored, and re-used in the worker context.
//
// Lifecycle (POC scope):
//   1. installWasmHook() — call BEFORE the FIRST `createCore({ sync: true })`
//   2. createCore runs and the hook captures the WebAssembly.Memory export
//   3. uninstallWasmHook() — restore originals; safe to call from `finally`
//   4. snapshotAvailable() — check if capture succeeded
//   5. takeSnapshot() — copy entire linear memory (single-slot)
//   6. restoreSnapshot(snap) — overwrite linear memory; zero any grown pages
//
// NOT in scope for the POC:
//   - LIFO stack of snapshots
//   - Multi-duel concurrency
//   - Parent/child handle bookkeeping
//
// =============================================================================

import * as logger from './logger.js';

// -----------------------------------------------------------------------------
// Module state
// -----------------------------------------------------------------------------

let capturedInstances: WebAssembly.Instance[] = [];
let wasmMemory: WebAssembly.Memory | null = null;
let hookInstalled = false;
let origInstantiate: typeof WebAssembly.instantiate | null = null;
let origStreaming: typeof WebAssembly.instantiateStreaming | null = null;

// -----------------------------------------------------------------------------
// Hook installation
// -----------------------------------------------------------------------------

/**
 * Install the `WebAssembly.instantiate` / `instantiateStreaming` hook.
 * Captures every instantiated WebAssembly.Instance into a buffer so that
 * after `createCore({ sync: true })` returns, we can scan exports for the
 * `Memory` object and store it for later snapshot/restore.
 *
 * MUST be called once, BEFORE the first `createCore` call. Idempotent —
 * a second call is a no-op (with a warning).
 */
export function installWasmHook(): void {
  if (hookInstalled) {
    logger.warn('[duel-worker] installWasmHook called twice — ignored');
    return;
  }
  capturedInstances = [];
  origInstantiate = WebAssembly.instantiate;
  origStreaming = WebAssembly.instantiateStreaming;

  WebAssembly.instantiate = function patched(this: unknown, ...args: unknown[]): Promise<unknown> {
    const p = (origInstantiate as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown>;
    return Promise.resolve(p).then((result) => {
      const inst = result instanceof WebAssembly.Instance
        ? result
        : (result as { instance?: WebAssembly.Instance })?.instance;
      if (inst) capturedInstances.push(inst);
      return result;
    });
  } as typeof WebAssembly.instantiate;

  if (typeof origStreaming === 'function') {
    WebAssembly.instantiateStreaming = function patched(this: unknown, ...args: unknown[]): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
      const p = (origStreaming as (...a: unknown[]) => unknown).apply(this, args) as Promise<WebAssembly.WebAssemblyInstantiatedSource>;
      return Promise.resolve(p).then((result) => {
        if (result?.instance) capturedInstances.push(result.instance);
        return result;
      });
    } as typeof WebAssembly.instantiateStreaming;
  }

  hookInstalled = true;
}

/**
 * Uninstall the hook and restore originals. Safe to call from `finally`
 * even if `installWasmHook` was never called.
 */
export function uninstallWasmHook(): void {
  if (!hookInstalled) return;
  if (origInstantiate) WebAssembly.instantiate = origInstantiate;
  if (origStreaming) WebAssembly.instantiateStreaming = origStreaming;
  origInstantiate = null;
  origStreaming = null;
  hookInstalled = false;
}

/**
 * Scan captured WebAssembly instances for the `WebAssembly.Memory` export
 * (the OCGCore wasm bundle exports it as `instance.exports.r`, but we
 * scan generically for any Memory). Sets the module-level `wasmMemory`
 * reference. Logs success or failure per AC #1.
 *
 * Call this AFTER `createCore({ sync: true })` returns and AFTER
 * `uninstallWasmHook()`.
 *
 * @returns true if memory was captured, false otherwise.
 */
export function locateWasmMemory(): boolean {
  for (const inst of capturedInstances) {
    for (const exp of Object.values(inst.exports)) {
      if (exp instanceof WebAssembly.Memory) {
        wasmMemory = exp;
        break;
      }
    }
    if (wasmMemory) break;
  }
  // Drop instance refs so they can be GC'd; we only kept the Memory.
  capturedInstances = [];

  if (wasmMemory) {
    const mb = (wasmMemory.buffer.byteLength / 1024 / 1024).toFixed(1);
    logger.log(`[duel-worker] WASM memory captured (${mb} MB)`);
    return true;
  } else {
    logger.warn('[duel-worker] WASM memory NOT captured — snapshot unavailable');
    return false;
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function snapshotAvailable(): boolean {
  return wasmMemory !== null;
}

/**
 * Test-only accessor for the captured WebAssembly.Memory. Used by the
 * POC smoke test to size assertions; not for production callers.
 */
export function _testGetWasmMemory(): WebAssembly.Memory | null {
  return wasmMemory;
}

/**
 * Test-only reset for the module state. Used by tests that exercise
 * the hook lifecycle multiple times in one process.
 */
export function _testResetState(): void {
  uninstallWasmHook();
  capturedInstances = [];
  wasmMemory = null;
}

export interface SnapshotMetrics {
  bytes: number;
  ms: number;
}

/**
 * Take a single-slot snapshot of the WASM linear memory.
 *
 * Mirrors `solver/ocgcore-adapter.ts:2099` (`mem.buffer.slice(0)`).
 *
 * NOTE: Only one snapshot is supported at a time in this POC. Holding
 * multiple snapshots is the caller's responsibility — but the solver's
 * LIFO discipline is OUT of scope. Each call returns a fresh ArrayBuffer
 * that the caller owns. Drop the reference after `restoreSnapshot()`
 * to free memory (AC #6).
 *
 * @throws if the WASM memory was never captured (call after `locateWasmMemory`)
 */
export function takeSnapshot(): { buffer: ArrayBuffer; metrics: SnapshotMetrics } {
  if (!wasmMemory) {
    throw new Error('[duel-worker] takeSnapshot called but WASM memory unavailable');
  }
  const t0 = performance.now();
  const buffer = wasmMemory.buffer.slice(0);
  const ms = performance.now() - t0;
  const bytes = buffer.byteLength;
  logger.debug(`[duel-worker] snapshot taken (${(bytes / 1024 / 1024).toFixed(1)} MB, ${ms.toFixed(2)}ms)`);
  return { buffer, metrics: { bytes, ms } };
}

/**
 * Restore a previously taken snapshot. Overwrites the WASM linear memory
 * byte-for-byte and zeros any pages the OCG allocator grew while the
 * snapshot was outstanding (mirroring
 * `solver/ocgcore-adapter.ts:2147-2152`).
 *
 * After this call, `core.duelProcess(handle)` and `core.duelQueryField(handle)`
 * MUST behave as if no events past the snapshot point had ever happened —
 * subject to the non-WASM module-state caveats documented in the report
 * (Task 5).
 *
 * @throws if WASM memory shrunk (we never observed this in practice but it
 *         indicates allocator corruption)
 * @throws if WASM memory unavailable
 */
export function restoreSnapshot(snapshot: ArrayBuffer): SnapshotMetrics {
  if (!wasmMemory) {
    throw new Error('[duel-worker] restoreSnapshot called but WASM memory unavailable');
  }
  const t0 = performance.now();
  const snapView = new Uint8Array(snapshot);
  const curBuf = wasmMemory.buffer;
  if (curBuf.byteLength < snapshot.byteLength) {
    throw new Error(`[duel-worker] WASM memory shrunk: ${curBuf.byteLength} < ${snapshot.byteLength}`);
  }
  new Uint8Array(curBuf, 0, snapView.byteLength).set(snapView);
  if (curBuf.byteLength > snapshot.byteLength) {
    // Zero any pages that grew — OCG's allocator bookkeeping lives in
    // the snapshot, and post-restore it doesn't know these pages exist.
    // Zeroing avoids surprises if the allocator re-grows and re-claims
    // these pages later.
    new Uint8Array(curBuf, snapshot.byteLength).fill(0);
  }
  const ms = performance.now() - t0;
  const bytes = snapshot.byteLength;
  logger.debug(`[duel-worker] snapshot restored (${(bytes / 1024 / 1024).toFixed(1)} MB, ${ms.toFixed(2)}ms)`);
  return { bytes, ms };
}
