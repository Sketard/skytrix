// Playwright globalSetup hook — invoked once before the e2e suite.
// Delegates to dev-stack ensureStack() which is idempotent: if the stack
// is already up (because the user ran `node scripts/dev-stack.mjs up` in
// a separate terminal), this returns in ~50ms after probing TCP ports.

import { ensureStack } from './dev-stack.mjs';

export default async function globalSetup() {
  await ensureStack();
}
