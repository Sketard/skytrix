# Linting — front skytrix

Garde-fous mis en place le 2026-05-20 (étape 1 du chantier Design System).

## Outils

| Outil | Config | Portée |
|---|---|---|
| **stylelint** | `.stylelintrc.json` | `src/**/*.scss` |
| **ESLint** | `eslint.config.js` (flat config) | `src/**/*.{ts,html}` |
| **lint-staged** | bloc `lint-staged` du `package.json` | fichiers stagés |

## Scripts

```bash
npm run lint            # ESLint sur tout le front
npm run lint:fix        # ESLint --fix
npm run lint:styles     # stylelint sur tout le SCSS
npm run lint:styles:fix # stylelint --fix
```

## Hook pré-commit

Un hook git versionné (`scripts/hooks/pre-commit`, activé via
`core.hooksPath`) lance `lint-staged` sur les fichiers du `front/`
réellement stagés.

Activation après un clone :

```bash
sh scripts/setup-hooks.sh
```

Bypass ponctuel : `git commit --no-verify`.

## Stratégie « strict + baseline »

Le **code nouveau ou modifié** est strictement vérifié (le hook bloque
le commit). La **dette préexistante** non touchée n'est pas bloquante :

- **ESLint** : les règles de dette (constructor injection, a11y des
  templates, `any`, selectors non préfixés…) sont en `warn`. `npm run lint`
  sort `0 error` — les ~230 warnings sont la dette visible. Les règles
  restent actives : tout nouveau composant mal nommé est signalé.
- **stylelint** : 2 règles DS actives —
  - `color-no-hex` (`error`, hors `styles/**` + fichiers définisseurs de
    tokens qui *définissent* la palette)
  - anti-`::ng-deep` (`warning`)

## État de la dette DS — 2026-05-20

`npm run lint:styles` : **0 problème.** La baseline historique
(111 problèmes / 29 fichiers — 90 hex hardcodés + 21 `::ng-deep`) a été
intégralement résorbée par les étapes 3a (hors-duel) et 3b (duel) du
chantier DS. `lint:styles` est désormais **vert** ; le hook pré-commit
maintient cet état pour tout nouveau code.

`debug-log-panel` est exclu du lint (dev-tooling, cf. `ignoreFiles`).
Les `::ng-deep` légitimes (éléments CDK/Material non encapsulés par
Angular) vivent regroupés dans `src/app/styles/_cdk-overrides.scss`.
