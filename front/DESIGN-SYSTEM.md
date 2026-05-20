# Design System — skytrix front

Catalogue canonique des composants UI réutilisables. **À lire avant de
coder une interface.** Les règles de styling sont enforced par stylelint
+ ESLint + un hook pré-commit (voir [`LINTING.md`](./LINTING.md)).

> **Pour un agent :** ne crée jamais un `<button>`, un badge, un champ de
> formulaire ou une classe SCSS de chrome from scratch. Cherche d'abord une
> primitive ci-dessous. Toute couleur passe par un token `var(--…)`.

Maintenance : tout nouveau composant ajouté dans
`front/src/app/components/` doit être ajouté à ce fichier (catégorie +
API). Sans ça la doc dérive — il n'y a pas de script de synchro.

---

## 1. Avant de coder une UI — checklist

1. **Bouton ?** → `<app-button>` ou `<app-icon-button>`. Jamais
   `<button class="…">`, jamais `mat-*-button`.
2. **Badge / étiquette de statut ?** → `<app-pill>` (non-interactif) ou
   `<app-chip>` (toggle de filtre). Jamais `<mat-chip>`.
3. **Champ de formulaire ?** → `<app-input>` / `<app-checkbox>` /
   `<app-toggle-switch>` / `<app-radio-card>`. Tous compatibles
   `[(ngModel)]` ou reactive forms (sauf `toggle-switch`, non-contrôlé).
4. **Couleur ?** → un token (`var(--gold)`, `var(--surface-card)`, …).
   Hex littéral interdit hors `styles/**` (stylelint `color-no-hex`).
5. **Taille d'icône `mat-icon` ?** → mixin `@include icon-size($size)`.
   Jamais le trio `font-size/width/height !important` à la main.
6. **Styler un enfant Material/CDK ?** → `styles/_cdk-overrides.scss`.
   `::ng-deep` est interdit dans un composant.
7. **Espacement ?** → échelle `--space-1..12` (8px-based). Hardcoder un
   `--space-*` en valeur littérale est un drapeau rouge.

---

## 2. Anatomie host-wrapper (button / icon-button / pill / chip /
## seg-button / input / checkbox)

Ces composants ont **deux niveaux** :

- le **host** (`.btn`, `.icon-btn`, `.pill`, `.chip`, `.seg-btn`,
  `.input`, `.checkbox`) — porte les classes de variante et les
  **contraintes de taille** (`min-height`, `width`) ;
- un **élément interne** (`.btn__el`, `.icon-btn__el`, `.chip__el`,
  `.seg-btn__el`, `.input__field`, `.checkbox__box`) — porte le
  **chrome** (padding, fond, hover, `:disabled`).

**Conséquence pour un override de page :** un override de chrome
(padding, background, hover, `:disabled`) DOIT cibler l'élément interne ;
un override de taille reste sur le host. Ne jamais combiner avec la
couche MDC (`mat-*-button`, `mat-chip`).

---

## 3. Primitives DS

Briques génériques, réutilisables partout. **Toujours préférer ces
composants à du HTML/SCSS ad hoc.**

### `<app-button>`
Bouton polymorphe — rend `<button>`, ou `<a routerLink>` si `link`, ou
`<a href>` si `href`.

| Input | Type | Défaut |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `type` | `'button' \| 'submit'` | `'button'` |
| `cta` | `boolean` — uppercase + letter-spacing | `false` |
| `shimmer` | `boolean` — overlay diagonal animé (requiert `cta`) | `false` |
| `full` | `boolean` — largeur 100% | `false` |
| `iconOnly` | `boolean` — padding carré | `false` |
| `flash` | `boolean` — feedback succès transitoire (~1.5-2s) | `false` |
| `loading` | `boolean` — spinner + disabled + `aria-busy` | `false` |
| `disabled` | `boolean` | `false` |
| `autofocus` | `boolean` | `false` |
| `ariaLabel` | `string?` | — |
| `link` | `string \| unknown[]` — route → rend `<a routerLink>` | — |
| `href` | `string` — URL externe → rend `<a href>` | — |

Pas d'output (clic = `(click)` natif sur le host, ou navigation).

```html
<app-button variant="primary" (click)="save()">Enregistrer</app-button>
<app-button variant="ghost" [link]="['/decks']">Mes decks</app-button>
```

### `<app-icon-button>`
Bouton icône seule. `ariaLabel` est **requis** (`input.required`).

| Input | Type | Défaut |
|---|---|---|
| `ariaLabel` | `string` — **requis** | — |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` |
| `variant` | `'ghost' \| 'framed' \| 'primary' \| 'danger'` | `'ghost'` |
| `active` | `boolean` — tinte dorée | `false` |
| `round` | `boolean` — cercle au lieu de `--radius-md` | `false` |
| `disabled` | `boolean` | `false` |
| `type` | `'button' \| 'submit'` | `'button'` |

```html
<app-icon-button ariaLabel="Rafraîchir" (click)="reload()">
  <mat-icon>refresh</mat-icon>
</app-icon-button>
```

### `<app-pill>`
Étiquette de statut **non-interactive**.

| Input | Type | Défaut |
|---|---|---|
| `variant` | `'gold' \| 'cyan' \| 'neutral' \| 'warning' \| 'danger' \| 'success' \| 'valid' \| 'invalid'` | `'neutral'` |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg'` | `'sm'` |
| `live` | `boolean` — pulse-dot intégré (statut live) | `false` |
| `celebrated` | `boolean` — letter-spacing + text-shadow | `false` |
| `icon` | `string?` — `mat-icon` en tête | — |
| `color` | `string?` — fond arbitraire (data-driven, bypasse `variant`) | — |
| `textColor` | `string?` — couleur de texte quand `color` est fixé | — |

```html
<app-pill variant="success" size="sm">Légal</app-pill>
<app-pill [color]="tag.hex" [textColor]="tag.fg">{{ tag.name }}</app-pill>
```

### `<app-chip>`
Toggle **interactif** de filtre — rend `aria-pressed`.

| Input | Type | Défaut |
|---|---|---|
| `variant` | `'gold' \| 'cyan' \| 'neutral'` — tinte l'état actif | `'gold'` |
| `size` | `'sm' \| 'md'` | `'md'` |
| `active` | `boolean` | `false` |
| `disabled` | `boolean` | `false` |
| `type` | `'button' \| 'submit'` | `'button'` |
| `icon` | `string?` — `mat-icon` en tête | — |
| `ariaLabel` | `string?` | — |

```html
<app-chip [active]="filterOn()" variant="cyan" (click)="toggle()">
  Monstres
</app-chip>
```

### `<app-seg-button>`
Cellule d'un contrôle segmenté (toggle de vue grille/liste). `ariaLabel`
**requis**. Passer `checked` pour le mode `role="radio"`.

| Input | Type | Défaut |
|---|---|---|
| `ariaLabel` | `string` — **requis** | — |
| `active` | `boolean` — état sélectionné (tinte dorée) | `false` |
| `disabled` | `boolean` | `false` |
| `type` | `'button' \| 'submit'` | `'button'` |
| `checked` | `boolean?` — rend `role="radio"` + `aria-checked` | — |

```html
<app-seg-button [active]="view()==='grid'" ariaLabel="Vue grille"
                (click)="view.set('grid')">
  <mat-icon>grid_view</mat-icon>
</app-seg-button>
```

### `<app-input>`  *(ControlValueAccessor)*
Champ texte compatible `[(ngModel)]` + reactive forms.

| Input | Type | Défaut |
|---|---|---|
| `type` | `'text' \| 'number' \| 'password' \| 'email' \| 'search'` | `'text'` |
| `label` | `string?` — label empilé | — |
| `placeholder` | `string` | `''` |
| `ariaLabel` | `string?` | — |
| `disabled` | `boolean` | `false` |
| `invalid` | `boolean` — bordure rouge + `aria-invalid` | `false` |

```html
<app-input label="Pseudo" placeholder="Votre nom" [(ngModel)]="name" />
```

### `<app-checkbox>`  *(ControlValueAccessor)*
Checkbox compatible `[(ngModel)]` + reactive forms (valeur booléenne).
Input natif caché mais présent (focus + a11y).

| Input | Type | Défaut |
|---|---|---|
| `disabled` | `boolean` | `false` |
| `ariaLabel` | `string?` — nom accessible si pas de texte projeté | — |

```html
<app-checkbox [(ngModel)]="accepte">J'accepte les conditions</app-checkbox>
```

### `<app-toggle-switch>`
Switch de préférence booléenne **non-contrôlé** — l'hôte possède l'état.

| Input | Type | Défaut |
|---|---|---|
| `checked` | `boolean` — non-contrôlé | `false` |
| `labelKey` | `string` — **requis** — clé i18n | — |
| `hintKey` | `string?` — texte secondaire | — |

Output : `toggled: void`.

```html
<app-toggle-switch [checked]="motion()" labelKey="prefs.motion"
                   (toggled)="motion.set(!motion())" />
```

### `<app-icon-wrap>`
Carré décoratif 44×44 avec icône tintée (fond + glow).

| Input | Type | Défaut |
|---|---|---|
| `icon` | `string` — **requis** — `mat-icon` | — |
| `palette` | `'gold' \| 'cyan'` | `'gold'` |

```html
<app-icon-wrap icon="dashboard" palette="cyan" />
```

### `<app-back-fab>`
FAB flottant haut-gauche pour revenir en arrière.

| Input | Type | Défaut |
|---|---|---|
| `visible` | `boolean` | `true` |
| `ariaLabelKey` | `string` — **requis** — clé i18n | — |

Output : `back: void`.

```html
<app-back-fab ariaLabelKey="a11y.back" (back)="goBack()" />
```

### `<app-stats-strip>`
Grille de stats responsive (4-col → 2-col → 1-col).

| Input | Type | Défaut |
|---|---|---|
| `stats` | `StatItem[]` — **requis** — `{ icon?, iconVariant?, value, labelKey, valueVariant?, surfaceAccent? }[]` | — |
| `ariaLabelKey` | `string?` | — |

```html
<app-stats-strip [stats]="[
  { icon: 'star', value: 82, labelKey: 'stats.winrate', surfaceAccent: 'gold' }
]" />
```

### `<app-multiple-action-button>`
Trigger + Material Menu d'actions multiples.

| Input | Type | Défaut |
|---|---|---|
| `icon` | `string` — icône du trigger | `''` |
| `buttons` | `ActionButton[]` — `{ label, callback }[]` | `[]` |
| `ariaLabelKey` | `string` | `'a11y.moreActions'` |

```html
<app-multiple-action-button icon="more_vert"
  [buttons]="[{ label: 'Éditer', callback: edit }]" />
```

### `<app-deck-silhouette>`
Silhouette visuelle d'un deck (3 bandes couleur thématiques).

| Input | Type | Défaut |
|---|---|---|
| `deckId` | `number \| null` — détermine le thème auto | — |
| `theme` | `DeckTheme \| null` — override du thème auto | `null` |

### `[appScalingContainer]`  *(directive)*
Applique un `transform: scale()` réactif à l'hôte d'après un
`ResizeObserver` du parent (Track A — canvas scaling).

| Input | Type | Défaut |
|---|---|---|
| `aspectRatio` | `number` | `16/9` |
| `referenceWidth` | `number` — largeur de référence avant scale | `1920` |

Output : `scale: number`.

---

## 4. Composites domain

Composants assemblés ou couplés à un domaine (cartes / decks /
recherche). Réutilisables **dans leur domaine** ; ne pas généraliser.

| Composant | Sélecteur | Rôle | API clé |
|---|---|---|---|
| Empty state | `<app-empty-state>` | Placeholder vide/erreur/accueil avec CTA | `titleKey*`, `variant` (`default\|welcome\|error\|no-results\|rich`), `descKey?`, `ctaLabelKey?`, `ctaLink?` / output `ctaAction` |
| Section header | `<app-section-header>` | En-tête de section + badge count + slot actions | `titleKey*`, `icon?`, `count`, `countKey?` |
| Page shell | `<app-page-shell>` | Chrome de page (fond holo-arena + header + back-nav) | `titleKey*`, `subtitleKey?`, `icon?`, `iconWrapPalette?`, `backRoute?` / `backActionEnabled` (+ output `backAction`), `compact`, `bordered`, `contentMaxWidth?` |
| Radio card | `<app-radio-card>` | Bouton radio en carte (label + desc) | `labelKey*`, `descKey?`, `active` / output `select` |
| Radio card group | `<app-radio-card-group>` | Conteneur `radiogroup` (clavier WAI-ARIA) | `columns` (`2\|3\|4`), `ariaLabel` |
| Search bar | `<search-bar>` | Barre de recherche + toggle filtres | `form` (`FormControl<string>`), `searchService?`, `showFilters` / output `filterToggled` |
| Active filters bar | `<app-active-filters-bar>` | Pills des filtres actifs (suppression unitaire) | `searchService*` |
| Card filters | `<app-card-filters>` | Formulaire de filtres carte complet | `searchService?` |
| Card searcher | `<app-card-searcher>` | Composite SearchBar+Filters+List | `deckBuildMode`, `externalFilters`, `searchService?` / outputs `cardClicked`, `filtersExpanded` |
| Card | `<app-card>` | Rendu image d'une carte YGO | `card*` (`SharedCardData`), `faceDown`, `position` (`ATK\|DEF`), `showOverlayMaterials`, `overlayMaterialCount` / output `clicked` |
| Card list | `<card-list>` | Grille/liste de cartes (lazy-load, drag&drop) | `displayMode`, `deckBuildMode`, `searchService?` / output `cardClicked` |
| Card inspector | `<app-card-inspector>` | Panneau détail carte + zoom lightbox | `card`, `mode` (`dismissable\|click\|permanent`), `position` (`left\|right\|top`), `ownedCount` (model), `isFavorite` / outputs `dismissed`, `favoriteChange`, `imageChange` |
| Deck box | `<deck-box>` | Tuile deck (silhouette + nom + légalité) | `deck?`, `add` (tuile "+Nouveau") |
| Deck card zone | `<deck-card-zone>` | Zone de drop deck-builder (CDK drag-drop) | `label`, `slotNumber`, `cardDetails`, `deckZone` (`MAIN\|EXTRA\|SIDE`) / output `cardClicked` |

`*` = `input.required`.

---

## 5. Composants orchestrés par service / one-shot

Pas instanciés directement dans un template métier, ou usage unique.

| Composant | Sélecteur | Comment l'utiliser |
|---|---|---|
| Loader | `<app-loader>` | Spinner global, piloté par `LoaderService`. Placé une fois dans le shell. |
| Confirm dialog | `confirm-dialog` | `dialog.open(ConfirmDialogComponent, { data: ConfirmDialogData })` — `{ title, message, confirmLabel?, cancelLabel?, destructive? }`. Retourne `true`/`false`. |
| Snackbar | `app-snackbar` | `snackBar.openFromComponent(SnackbarComponent, { data: { message, type: 'success'\|'error', icon } })`. |
| Bottom sheet | `<app-bottom-sheet>` | Panneau draggable à snap points. `opened`, `requestedSnap`, `contained` / output `closed`. |
| Custom tooltip | `custom-tooltip` | Conteneur tooltip — `contentTemplate` (`TemplateRef`, requis) ou `text`. |
| Navbar | `<navbar>` | Navigation principale. Placée une fois dans le shell. |
| System overlay | `<app-system-overlay>` | Overlay d'état réseau. `variant` (`lost\|reconnecting\|grace\|blocked`, requis), `title`, `subtitle`, `pulseTitle`. |

---

## 6. Tokens — règles d'or

Source : `front/src/app/styles/_tokens.scss` (dark, foundation) +
`_tokens-light.scss` (overrides light). ~150 tokens.

- **Couleurs** — toujours `var(--…)`. Hex littéral interdit hors
  `styles/**` (+ `_sim-tokens.scss`, `simulator-page.component.scss`).
  Enforced par stylelint `color-no-hex`.
- **Doré** — `--gold` pour fond/accent/bordure/glow ; `--gold-on-surface`
  pour le `color:`/`fill:` d'un texte ou d'une icône dorée (en light
  mode, un gold clair en texte sur fond clair est illisible — d'où le
  token distinct ; alias de `--gold` en dark).
- **Surfaces** — `--surface-base/card/elevated/nav` + `--surface-bg*`
  (holo-arena). Backdrops plein écran : famille `--scrim-*`. Badge/FAB
  sur image : `--surface-badge` (thémé).
- **Texte** — `--text-primary/secondary/muted/disabled/inverse`.
- **Espacement** — échelle `--space-1..12` (8px-based) + `--space-fluid-*`
  pour les conteneurs de page. Hardcoder un `--space-*` = drapeau rouge.
- **Radius** — échelle unique `--radius-{sm,md,lg,xl,pill}`
  (6/10/14/18/999). L'échelle PvP `--pvp-radius-*` a été fusionnée.
- **Élévation** — `--elevation-0..4`. Pas d'ombre en dur.
- **Typo** — fluide : `--text-xs..3xl` (clamp). Poids
  `--weight-normal..black`. Familles `--font-display/body/mono`.
- **Transitions** — `--transition-fast/normal/slow`. Easings
  `--ease-out/inout/spring/in/bounce/expo`.

Quand tokeniser : couleurs/gradients → quasi toujours. Spacing →
échelle DS. Géométrie spécifique à un composant → local (sauf 3+
usages).

---

## 7. Règles de styling (rappel — détail dans `LINTING.md`)

- **`mat-icon`** → `@include icon-size($size, $line-height?)` de
  `styles/mixin.scss`. Le `!important` (imposé par Material) y est
  centralisé — ne pas le réécrire à la main.
- **`::ng-deep`** → interdit dans un composant. Élément CDK/Material
  non encapsulé → `styles/_cdk-overrides.scss`. Enfant Angular → lui
  ajouter un `input` de variante.
- **`!important`** → cas structurels seulement (override Material/CDK,
  `prefers-reduced-motion`, état devant primer un `:hover` plus
  spécifique, style inline à battre). Tout `!important` hors mixin
  porte un commentaire `// !important : <pourquoi>`.
- **`.badge`** → reste une classe SCSS globale (`_badge.scss`, un seul
  consommateur). Tout le reste du chrome (boutons/pills/chips/toggles/
  form controls) est composantisé.

---

## 8. Conventions transverses

- **i18n** — beaucoup de composants prennent des `*Key` (clés de
  traduction) plutôt que du texte brut : `titleKey`, `labelKey`,
  `descKey`, `ariaLabelKey`. Fournir une clé, pas une string littérale.
- **Skeletons** — état de chargement = skeleton screen (`<app-skel>` +
  `ListStore` + `@if(store.loading())`), pas de spinner. Voir la
  convention skeleton-screens.
- **Responsive** — mobile-first strict, container queries, tester
  360/414/768/1024/1280/1920.
