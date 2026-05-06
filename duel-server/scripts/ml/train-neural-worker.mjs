// =============================================================================
// train-neural-worker.mjs — Piscina worker bootstrap (mirrors
// evaluate-structural-worker.mjs pattern).
//
// Worker threads do NOT inherit tsx's ESM loader from the parent process.
// Register tsx/esm inside the worker's own loader before the first dynamic
// import so subsequent .ts → .js rewrite resolves transparently.
// =============================================================================

import { register } from 'tsx/esm/api';
register();

const mod = await import('./train-neural-worker.ts');
export default mod.default;
