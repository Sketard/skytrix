// Documentation fixture for the pipeline-signal-tagged rule. The actual
// test cases live in `__tests__/rule.spec.mjs` and use ESLint's
// `RuleTester` (in-memory, doesn't read this file). This file exists so
// a human can scan the four shapes the rule recognises without firing up
// the tester.
//
// This file is INTENTIONALLY in `eslint-plugins/`, NOT in `src/`. The
// rule is scoped to `src/app/pages/pvp/`. Moving this file under `src/`
// would make production builds fail on the deliberate violation below.

import { signal } from '@angular/core';

// Case (a) — should pass: prefix `_transport_`.
const _transport_foo = signal(0);

// Case (b) — should pass: suffix `Source`.
const themeSource = signal<'light' | 'dark'>('dark');

// Case (d) — should pass: explicit eslint-disable.
// eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
const escapedBecauseReasons = signal(0);

// VIOLATION — should fail: no tag, no class, no escape.
const looseAndUntagged = signal(0);

// Mark the consts as used so other lints don't complain in unrelated runs.
export const _exports = { _transport_foo, themeSource, escapedBecauseReasons, looseAndUntagged };
