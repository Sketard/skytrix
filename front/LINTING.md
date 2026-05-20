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
- **stylelint** : 2 règles DS actives en `error` —
  - `color-no-hex` (hors `styles/**` qui *définit* les tokens)
  - anti-`::ng-deep` (en `warning`)

  `npm run lint:styles` reste **rouge** tant que la dette SCSS du DS
  existe : c'est volontaire, c'est le **compteur de dette** de l'étape 3.
  Le garde-fou réel est le hook (fichiers stagés uniquement).

## Baseline de dette DS — état 2026-05-20

`npm run lint:styles` : **111 problèmes / 29 fichiers**
— 90 couleurs hex hardcodées + 21 `::ng-deep`.

Concentration : ~70 % dans `src/app/pages/pvp/duel-page/**`. Cette dette
est le périmètre de l'**étape 3** du chantier DS (résorption PvP/duel).
Quand un fichier de la baseline est rouvert pour une autre raison, le hook
impose de le nettoyer — c'est la règle du boy-scout, alignée sur l'étape 3.
