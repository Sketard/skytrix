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

## Conventions DS issues du chantier (2026-05-20)

Le chantier d'assainissement (étapes 1-3 + SCSS legacy + `!important`)
a posé ces conventions — à respecter pour tout nouveau style :

- **Couleurs** → toujours un token `var(--…)`. Les hex littéraux ne sont
  permis que dans les fichiers *définisseurs de tokens* (`styles/**`,
  `_sim-tokens.scss`, `simulator-page.component.scss`). `color-no-hex`
  l'impose.
- **Sizing d'icône `mat-icon`** → mixin `icon-size($size, $line-height?)`
  de `styles/mixin.scss`. Ne PAS réécrire le trio
  `font-size/width/height !important` à la main — Material impose 24px,
  le `!important` est centralisé dans le mixin.
- **`::ng-deep`** → interdit dans un composant. Pour styler un élément
  non encapsulé par Angular (placeholder CDK, interne Material), mettre
  la règle dans `styles/_cdk-overrides.scss` (feuille globale). Pour
  styler un composant enfant, lui ajouter un `input` de variante
  (cf. `embedded` sur `pvp-timer-badge`/`pvp-lp-badge`).
- **Composants DS** → boutons / pills / bascules sont des composants
  Angular, plus des classes SCSS globales (composantisation 2026-05-20) :
  `<app-button>`, `<app-icon-button>`, `<app-pill>`, `<app-seg-button>`
  (dans `components/`). Les partials `_buttons.scss` / `_icon-button.scss`
  / `_pills.scss` / `_segmented.scss` ont été supprimés. Ne PAS combiner
  avec `mat-raised-button`/`mat-*-button` (la couche MDC force des
  `!important`). Chaque composant a un host (porte les classes de
  variante) + un élément interne (`.btn__el` / `.icon-btn__el` /
  `.seg-btn__el`) : un override de chrome côté page (padding, fond, hover,
  `:disabled`) DOIT cibler l'élément interne ; les contraintes de taille
  (`min-height`, `width`) restent sur le host. `.badge` reste une classe
  globale (`_badge.scss`, un seul consommateur).
- **`!important`** → réservé aux cas structurels : override Material/CDK,
  `prefers-reduced-motion`, état devant primer sur un `:hover` plus
  spécifique, style inline à battre. Tout `!important` hors mixin doit
  porter un commentaire `// !important : <pourquoi>`.
- **Tokens dorés** → `--gold` pour fond/accent/bordure/glow,
  `--gold-on-surface` pour le `color:` d'un texte/icône doré (doctrine
  light mode — alias de `--gold` en dark).
- **Radius** → échelle unique `--radius-{sm,md,lg,xl,pill}` (l'échelle
  PvP `--pvp-radius-*` a été fusionnée).
