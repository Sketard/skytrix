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
 *   3. **Owned by a class that extends `BaseProjection` or implements
 *      `ResetTarget`** — every other signal must be part of a class
 *      that participates in the dispatcher contract (α.2 + α.4a + α.4b).
 *      `ResetTarget` is the slim interface; `BaseProjection<T>` is the
 *      strict superset for pure read-only projections (β.3+).
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
        '(c) declare the host class `extends BaseProjection` or ' +
        '`implements ResetTarget`. ' +
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
     * Track whether the file imports `BaseProjection` and/or `ResetTarget`
     * from the canonical `projections/` barrel. Used as a guard against
     * a local class declaration shadowing the type names (e.g. a test
     * file that defines its own `class BaseProjection { ... }` would
     * otherwise be auto-tagged silently). If neither symbol is imported,
     * `classIsProjectionLike` returns false regardless of class shape.
     *
     * Populated by the `ImportDeclaration` visitor.
     */
    const importedProjectionNames = new Set();

    /**
     * Return true if the signal call is allowed by tag conventions.
     * `name` is the declarator/property identifier; `parentClassBody` is
     * the enclosing class body (or null for module-scope declarations);
     * `isModuleScope` says the signal is declared at top level (not
     * inside a function/method body) — required for option (b).
     */
    function isTaggedSignal(name, parentClassBody, isModuleScope) {
      // (c) projection-owned — enclosing class is tagged. Works for both
      // named-declarator signals AND anonymous ones (return / argument)
      // inside such a class.
      if (parentClassBody && classBodyIsProjection.get(parentClassBody)) return true;
      // Without a name, options (a)+(b) can't apply.
      if (!name) return false;
      // (a) transport state — strict `_transport_` prefix. The historic
      // alternative `transport_*` (no leading underscore) was rejected
      // 2026-05-26 — it never appeared in practice and matched the
      // convention's documented form less precisely.
      if (/^_transport_/.test(name)) return true;
      // (b) environment source — name ends with `Source`. ONLY valid at
      // module scope (or as a class field that's NOT inside a method).
      // A local `const mySource = signal(...)` inside a method body is
      // the most common false-pass; restricting to module-scope kills it
      // without hurting the documented use case (top-level @Environment
      // hooks).
      if (isModuleScope && /Source$/.test(name)) return true;
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

    /**
     * True when `node` is declared at module scope — i.e. no enclosing
     * function/method/arrow between the call and the Program node. A
     * class PropertyDefinition counts as module-scope for this purpose
     * (it executes once at instantiation, like a top-level const, and
     * is a place where `*Source` legitimately appears).
     */
    function isModuleScope(node) {
      let cur = node.parent;
      while (cur) {
        if (cur.type === 'FunctionDeclaration'
          || cur.type === 'FunctionExpression'
          || cur.type === 'ArrowFunctionExpression'
          || cur.type === 'MethodDefinition') return false;
        if (cur.type === 'Program') return true;
        cur = cur.parent;
      }
      return false;
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
      // `this.foo = signal(...)` / `foo = signal(...)` — late-bound
      // assignment, surfaces inside constructors / initialisers. Reports
      // the LHS member/identifier name so the tag check can run.
      if (parent.type === 'AssignmentExpression' && parent.right === callExpr) {
        const lhs = parent.left;
        if (lhs?.type === 'MemberExpression' && lhs.property?.type === 'Identifier') {
          return lhs.property.name;
        }
        if (lhs?.type === 'Identifier') {
          return lhs.name;
        }
      }
      return null;
    }

    /**
     * Return true if a class node either extends `BaseProjection` or
     * implements `ResetTarget`. The two participate in the same
     * dispatcher contract (α.4a split): `BaseProjection<T>` is a strict
     * superset of `ResetTarget`, and the lint treats both as the same
     * "class membership is the tag" signal (option c in the rule's
     * docstring).
     *
     * Guard against name shadowing: if the file does not import the
     * referenced symbol from `projections/`, a local declaration with
     * the same name does NOT auto-tag the class.
     */
    function classIsProjectionLike(node) {
      const sc = node.superClass;
      const extendsBaseProjection =
        (sc?.type === 'Identifier' && sc.name === 'BaseProjection') ||
        (sc?.type === 'CallExpression' && sc.callee?.name === 'BaseProjection') ||
        (sc?.type === 'TSInstantiationExpression' && sc.expression?.name === 'BaseProjection');
      if (extendsBaseProjection && importedProjectionNames.has('BaseProjection')) return true;
      // `implements ResetTarget` — TypeScript-ESLint surfaces this as
      // node.implements: TSClassImplements[] with .expression?.name.
      const impls = /** @type {Array<{expression?: {name?: string}}>|undefined} */ (node.implements);
      if (impls?.some(impl => impl.expression?.name === 'ResetTarget')
          && importedProjectionNames.has('ResetTarget')) {
        return true;
      }
      return false;
    }

    return {
      'ImportDeclaration'(node) {
        // Count imports of `BaseProjection` / `ResetTarget` from canonical
        // sources. Accept either the barrel (`.../projections`) or the
        // module files themselves (`./base-projection`, `./reset-target`)
        // so files INSIDE `projections/` (specs, internal modules) are
        // not falsely treated as shadowing. Cross-package imports
        // (`@angular/core`, `rxjs`, …) cannot bring these symbols.
        const src = node.source?.value;
        if (typeof src !== 'string') return;
        const isProjectionSource = src.includes('projections')
          || src.includes('base-projection')
          || src.includes('reset-target');
        if (!isProjectionSource) return;
        for (const spec of node.specifiers ?? []) {
          if (spec.type === 'ImportSpecifier' && spec.imported?.type === 'Identifier') {
            const importedName = spec.imported.name;
            if (importedName === 'BaseProjection' || importedName === 'ResetTarget') {
              // We index by the *imported* name (not the local alias) —
              // the class declarations reference the original name unless
              // aliased, which is the case in practice across pvp/.
              importedProjectionNames.add(importedName);
            }
          }
        }
      },

      'ClassDeclaration'(node) {
        if (!node.body) return;
        classBodyIsProjection.set(node.body, classIsProjectionLike(node));
      },
      'ClassExpression'(node) {
        if (!node.body) return;
        classBodyIsProjection.set(node.body, classIsProjectionLike(node));
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
        const moduleScoped = isModuleScope(node);
        if (name === null) {
          // Anonymous `signal()` — passed directly as an argument or
          // returned from a function. Tag-by-class-membership still
          // applies (a projection class may return `signal()` from a
          // helper method). If the enclosing class is tagged we pass.
          if (isTaggedSignal(null, parentClassBody, moduleScoped)) return;
          context.report({ node, messageId: 'untaggedAnonymousSignal' });
          return;
        }
        if (isTaggedSignal(name, parentClassBody, moduleScoped)) return;
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
