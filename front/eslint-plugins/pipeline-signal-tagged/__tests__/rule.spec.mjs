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
    // (c) — class extends BaseProjection
    {
      filename: pvpFile('foo.ts'),
      code: `
        import { signal } from '@angular/core';
        class FooProj extends BaseProjection<number> {
          readonly anything = signal(0);
          private _alsoFine = signal(true);
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
    // Anonymous signal call
    {
      filename: pvpFile('foo.ts'),
      code: `import { signal } from '@angular/core'; function f() { return signal(0); }`,
      errors: [{ messageId: 'untaggedAnonymousSignal' }],
    },
  ],
});

// RuleTester throws on failure; reaching this line means all asserts passed.
console.log('✓ pipeline-signal-tagged: all RuleTester cases passed');
