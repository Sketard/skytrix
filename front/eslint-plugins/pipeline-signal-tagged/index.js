// @ts-check
/**
 * Custom ESLint plugin for the anim-pipeline-v2 chantier
 * (cf. `_bmad-output/planning-artifacts/duel-session-chantier-implementation-plan.md §1 α.1`,
 * `_bmad-output/planning-artifacts/duel-session-chantier.md §3.2`).
 *
 * The chantier requires every signal in `src/app/pages/pvp/` to declare
 * its nature so a future code-reviewer can answer the §3.2 algorithm
 * question ("projection / @Environment / transport state?") without
 * archaeology. The lint rule below enforces that declaration mechanically:
 *
 *   1. **`_transport_*` prefix** — internal transport state (queue
 *      pointers, timer flags). Never read by UI templates.
 *   2. **`*Source` suffix** — @Environment input (OS / user setting /
 *      session config). Read-only from the pipeline's POV.
 *   3. **Owned by a class that extends `BaseProjection`** — every other
 *      signal must be part of a registered projection (α.2 + α.4).
 *   4. **`// eslint-disable-next-line pipeline-signal-tagged`** — escape
 *      hatch for the rare legitimate exception (must include a `// why:`
 *      sibling comment per code-review convention).
 *
 * Plus a baseline mechanism: a `allowedFiles` option lists files exempted
 * because they were written before the lint landed. Each allowed file is
 * a relative path from the project root. The story α.7 ("tag the existing
 * code") empties that list as it migrates the legacy signals.
 *
 * The rule is scoped to `src/app/pages/pvp/**` — the rest of the codebase
 * (deck builder, simulator, etc.) is out of scope for this chantier.
 */

/** @type {import('eslint').Rule.RuleModule} */
const pipelineSignalTagged = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every signal() in the pvp pipeline to declare its nature ' +
        '(transport / environment / projection-owned).',
    },
    schema: [{
      type: 'object',
      properties: {
        allowedFiles: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
        },
      },
      additionalProperties: false,
    }],
    messages: {
      untaggedSignal:
        'Untagged signal `{{name}}`. Pick one: ' +
        '(a) prefix `_transport_` for transport state, ' +
        '(b) suffix `Source` for @Environment input, ' +
        '(c) declare the host class extends `BaseProjection`. ' +
        'See duel-session-chantier.md §3.2.',
      untaggedAnonymousSignal:
        'Untagged anonymous signal() — assign to a named declaration ' +
        'so the rule can verify its tag.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const opts = context.options[0] ?? {};
    /** @type {string[]} */
    const allowedFiles = opts.allowedFiles ?? [];

    // Normalise the filename to a project-relative POSIX path so the
    // baseline list is OS-independent.
    const cwd = context.cwd ?? context.getCwd();
    const rel = require('path').relative(cwd, filename).split(require('path').sep).join('/');

    // Out-of-scope file → no-op.
    if (!rel.startsWith('src/app/pages/pvp/')) return {};
    // Baseline exemption → no-op.
    if (allowedFiles.includes(rel)) return {};

    /**
     * Track which classes in the current file extend `BaseProjection`.
     * A signal declared as a class property of such a class is implicitly
     * tagged (option c). Built up via class enter/exit visitors.
     *
     * @type {WeakMap<object, boolean>} Map<ClassBody, isProjection>
     */
    const classBodyIsProjection = new WeakMap();

    /**
     * Return true if the signal call is allowed by tag conventions.
     * `name` is the declarator/property identifier; `parentClassBody` is
     * the enclosing class body (or null for module-scope declarations).
     */
    function isTaggedSignal(name, parentClassBody) {
      if (!name) return false;
      // (a) transport state — leading underscore + transport_ marker.
      if (/^_?transport_/.test(name) || /^_transport_/.test(name)) return true;
      // (b) environment source — name ends with `Source`.
      if (/Source$/.test(name)) return true;
      // (c) projection-owned — enclosing class extends BaseProjection.
      if (parentClassBody && classBodyIsProjection.get(parentClassBody)) return true;
      return false;
    }

    /** Walk up the ancestor chain to find the nearest enclosing ClassBody. */
    function findEnclosingClassBody(node) {
      let cur = node.parent;
      while (cur) {
        if (cur.type === 'ClassBody') return cur;
        cur = cur.parent;
      }
      return null;
    }

    /** Get the identifier name a signal() call is assigned to. */
    function callTargetName(callExpr) {
      const parent = callExpr.parent;
      if (!parent) return null;
      // `const foo = signal(...)` / `let foo = signal(...)` / `var foo = signal(...)`
      if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
        return parent.id.name;
      }
      // `private foo = signal(...)` / `readonly foo = signal(...)`
      if (parent.type === 'PropertyDefinition' && parent.key?.type === 'Identifier') {
        return parent.key.name;
      }
      // `propertyKey: signal(...)` — object literal, rare in this codebase.
      if (parent.type === 'Property' && parent.key?.type === 'Identifier') {
        return parent.key.name;
      }
      return null;
    }

    return {
      'ClassDeclaration'(node) {
        if (!node.body) return;
        const sc = node.superClass;
        // Match `extends BaseProjection<X>` (TSAsExpression / TypeReference)
        // or `extends BaseProjection` (Identifier).
        const isProj =
          (sc?.type === 'Identifier' && sc.name === 'BaseProjection') ||
          (sc?.type === 'CallExpression' && sc.callee?.name === 'BaseProjection') ||
          (sc?.type === 'TSInstantiationExpression' && sc.expression?.name === 'BaseProjection');
        classBodyIsProjection.set(node.body, !!isProj);
      },
      'ClassExpression'(node) {
        if (!node.body) return;
        const sc = node.superClass;
        const isProj = sc?.type === 'Identifier' && sc.name === 'BaseProjection';
        classBodyIsProjection.set(node.body, !!isProj);
      },

      'CallExpression'(node) {
        // Match the bare `signal(...)` call. We intentionally do NOT match
        // `signal.something(...)` (no such API today), nor
        // `Signal.foo(...)`. We match `signal<T>(...)` because that's just
        // `CallExpression(callee=Identifier('signal'), typeArguments=...)`
        // — the callee is still an Identifier.
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'signal') return;
        const name = callTargetName(node);
        const parentClassBody = findEnclosingClassBody(node);
        if (name === null) {
          // Anonymous `signal()` — e.g. passed directly as an argument or
          // returned from a function. Either is suspicious in this chantier;
          // flag it with the dedicated message so the user knows to assign
          // it to a named declaration before tagging.
          context.report({ node, messageId: 'untaggedAnonymousSignal' });
          return;
        }
        if (isTaggedSignal(name, parentClassBody)) return;
        context.report({ node, messageId: 'untaggedSignal', data: { name } });
      },
    };
  },
};

module.exports = {
  rules: {
    'pipeline-signal-tagged': pipelineSignalTagged,
  },
};
