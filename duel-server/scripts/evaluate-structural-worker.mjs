// =============================================================================
// evaluate-structural-worker.mjs — Piscina worker bootstrap.
//
// Worker threads do NOT inherit tsx's ESM loader from the parent process:
// `--import tsx/dist/loader.mjs` (injected by the tsx CLI) registers hooks
// on the parent's module loader only. A worker thread starts with an empty
// hook registry, so bare `./foo.js` imports inside .ts files fail with
// ERR_MODULE_NOT_FOUND because the `.js → .ts` rewrite hook is absent.
//
// Fix: register tsx/esm inside the worker's own loader before the first
// dynamic import. Once registered, subsequent imports through that loader
// resolve .ts files transparently. The default export is forwarded so
// Piscina's call-per-task contract is preserved.
// =============================================================================

// tsx ships a first-class `register()` for Node's module.register() API; it
// wraps the loader registration with the correct parent URL and validates
// the Node version. Calling `module.register('tsx/esm', ...)` directly trips
// tsx's legacy `--loader` detection on Node 20+, hence this indirection.
import { register } from 'tsx/esm/api';

register();

const mod = await import('./evaluate-structural-worker.ts');
export default mod.default;
