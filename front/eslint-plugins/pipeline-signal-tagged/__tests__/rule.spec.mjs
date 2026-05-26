// Unit tests for the pipeline-signal-tagged rule.
// Run: `node --test front/eslint-plugins/pipeline-signal-tagged/__tests__/rule.spec.mjs`
//
// Uses ESLint's built-in RuleTester, the canonical way to assert against
// a custom rule without booting the full lint over a fixture directory.

import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const plugin = require('../index.js');
const rule = plugin.rules['pipeline-signal-tagged'];

// Files lint in this test must look as if they came from
// `src/app/pages/pvp/`, otherwise the rule no-ops (scope guard). We pass
// fake filenames + a fake cwd so the rule's `rel` computation maps them
// to the right prefix.
const FAKE_CWD = path.resolve(__dirname, '..', '..', '..');
const pvpFile = (name) => path.join(FAKE_CWD, 'src/app/pages/pvp', name);
const outsideFile = (name) => path.join(FAKE_CWD, 'src/app/pages/deck-builder', name);

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('pipeline-signal-tagged', rule, {
  valid: [
    // (a) — transport prefix
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; const _transport_foo = signal(0);`,
    },
    // (b) — Source suffix
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; const themeSource = signal<'a' | 'b'>('a');`,
    },
    // (c) — class extends BaseProjection (import required)
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        import { BaseProjection } from './projections';
        class FooProj extends BaseProjection<number> {
          readonly anything = signal(0);
          private _alsoFine = signal(true);
        }
      `,
    },
    // (c) — class implements ResetTarget (α.4a — slim contract, import required)
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        import { ResetTarget } from './projections';
        class FooManager implements ResetTarget {
          readonly state = signal(0);
          private internal = signal(false);
        }
      `,
    },
    // (c) — class implements ResetTarget alongside another interface
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        import { ResetTarget } from './projections';
        class FooManager implements OnDestroy, ResetTarget {
          readonly state = signal(0);
        }
      `,
    },
    // (c) — anonymous `return signal()` inside a tagged class method is OK.
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        import { ResetTarget } from './projections';
        class FooManager implements ResetTarget {
          private makeChild() { return signal(0); }
        }
      `,
    },
    // (c) — `this.x = signal()` inside a constructor of a tagged class is OK.
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        import { ResetTarget } from './projections';
        class FooManager implements ResetTarget {
          x: any;
          constructor() { this.x = signal(0); }
        }
      `,
    },
    // Out-of-scope file — rule no-ops, untagged is fine.
    {
      filename: outsideFile('foo.ts'),
      code: `import { signal } from '@angular/core'; const whatever = signal(0);`,
    },
    // Baseline exemption — file listed in allowedFiles is ignored.
    {
      filename: pvpFile('legacy.ts'),
      code: `import { signal } from '@angular/core'; const whatever = signal(0);`,
      options: [{ allowedFiles: ['src/app/pages/pvp/legacy.ts'] }],
    },
  ],
  invalid: [
    // Plain untagged signal inside pvp/
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; const loose = signal(0);`,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'loose' } }],
    },
    // Class that does NOT extend BaseProjection — signal must still be tagged
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        class Regular {
          private foo = signal(0);
        }
      `,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'foo' } }],
    },
    // Class extending something else (not BaseProjection) — not exempt
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        class Foo extends OtherBase {
          private bar = signal(0);
        }
      `,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'bar' } }],
    },
    // Anonymous signal call (no enclosing tagged class)
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; function f() { return signal(0); }`,
      errors: [{ messageId: 'untaggedAnonymousSignal' }],
    },
    // P8 fix #1 — historic `transport_*` (no leading underscore) is NO
    // longer accepted; only the strict `_transport_*` form matches.
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; const transport_foo = signal(0);`,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'transport_foo' } }],
    },
    // P8 fix #2 — `*Source` suffix inside a function body is NOT a valid
    // @Environment tag (the loophole that let local variables get a free pass).
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; function f() { const mySource = signal(0); return mySource; }`,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'mySource' } }],
    },
    // P8 fix #3 — `this.x = signal()` inside a non-tagged class is reported
    // (previously fell through `callTargetName === null` → anonymous).
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        class Regular {
          x: any;
          constructor() { this.x = signal(0); }
        }
      `,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'x' } }],
    },
    // P8 fix #4 — class named `BaseProjection` declared LOCALLY (no import
    // from projections/) does NOT confer the tag on its signal members.
    // Guards against shadowing the canonical type with a same-named class.
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        class BaseProjection<T> { value!: T; }
        class FakeProj extends BaseProjection<number> {
          readonly leak = signal(0);
        }
      `,
      errors: [{ messageId: 'untaggedSignal', data: { name: 'leak' } }],
    },
  ],
});

// RuleTester throws on failure; reaching this line means all asserts passed.
console.log('✓ pipeline-signal-tagged: all RuleTester cases passed');
