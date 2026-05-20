---
title: Design System Skytrix — Wave 1 Specification
author: Sally (UX Designer) + Axel
date: 2026-05-14
status: APPROVED — ready for implementation
scope: 11 partials SCSS + refacto Niveau 1 (BEM cohérent, keyframes préfixées, dialog overrides consolidés, @use migration)
consumers:
  - PvP Lobby (shipped — sera migré dans le même commit)
  - Replay Hub (à venir — consommateur Wave 1 primaire)
  - Replay Viewer (à venir — Wave 2 viewer rework)
  - Tous les écrans refondus ensuite
related:
  - _bmad-output/planning-artifacts/replay-hub-rework-2026-05-14.md
  - memory/project_design_system_strategy.md
  - memory/project_responsive_strategy.md
  - memory/project_skeleton_screens_convention.md
  - memory/project_ghost_scrollbar_convention.md
---

# Design System Skytrix — Wave 1 Specification

## Préambule

Cette spec est la **référence d'implémentation** pour Wave 1 du DS skytrix. Elle est **autonome** (réutilisable par tous les reworks futurs) et complète le doc de stratégie [`memory/project_design_system_strategy.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_design_system_strategy.md) qui fixe la doctrine globale.

**Premier consommateur** : refonte du Replay Hub (cf. [`replay-hub-rework-2026-05-14.md`](./replay-hub-rework-2026-05-14.md)). Tous les partials et règles ici doivent être livrés en Phase F0 de cette refonte.

### Décisions actées 2026-05-14

| # | Décision | Rationale |
|---|---|---|
| **DS-D1** | Option C (Spec DS autonome) | Réutilisable par tous les reworks ; le replay-hub doc reste lisible |
| **DS-D2** | Niveau 1 strict (refacto critique uniquement) | 9h30 effort. Niveau 2/3 différés Wave 1.5 et Wave 2 |
| **DS-D3** | BEM `__` strict pour les nouveaux composants | Cohérence long terme. Legacy kebab-simple migré au passage Niveau 1 |
| **DS-D4** | Préfixe `ds-` obligatoire pour TOUTES les keyframes du DS | Évite conflits avec keyframes locales aux composants |
| **DS-D5** | Migration `@import` → `@use` dans `styles.scss` | Sass modern, ordre d'import strict, namespacing explicite |
| **DS-D6** | Période de coexistence 1 semaine pour les classes legacy | Migration template par template sans casser e2e/snapshot tests |
| **DS-D7** | Dark-only verrouillé (pas de light mode v1) | Documenté + `color-scheme: dark` au `:root` |
| **DS-D8** | Container Queries recommandées pour les composants partagés | `@container` plutôt que `@media` quand un composant est nested dans un layout variable |
| **DS-D9** | Composants Angular différés Wave 2 (rule of three) | Wave 1 = partials SCSS uniquement, sauf `<app-replay-card-skeleton>` (1 consommateur unique) |
| **DS-D10** | Print = `body { display: none }` v1 | Pas de print stylesheet, mais décision documentée |
| **DS-D11** | Pas de logique RTL en Wave 1 | FR + EN seulement. Pas de `margin-inline-start`, `margin-left` direct OK |

---

## 1. Conventions transverses

### 1.1 Nommage BEM

**Convention de référence** :
- **Bloc** : `.button`, `.pill`, `.chip` (mot unique, sans préfixe)
- **Élément** : `.button__icon`, `.search-bar__clear` (double-tiret strict)
- **Modifier** : `.button--primary`, `.pill--gold`, `.icon-btn--sm` (double-tiret strict)
- **État** : `.is-active`, `.is-loading`, `.is-spinning` (préfixe `is-`)

**Exception legacy** : les classes existantes en kebab simple (`.empty-state-icon`, `.lobby-header`, `.screen-bg`) sont **migrées au passage**. Pendant la période de coexistence (cf. §1.6), les anciennes restent comme alias.

**Anti-patterns interdits** :
- ❌ Simple-tiret pour les modifiers (`.btn-primary` au lieu de `.btn--primary`)
- ❌ Imbrication profonde (`.card .header .title` — préférer `.card__header-title`)
- ❌ Nommage par couleur (`.button-gold` — préférer `.button--primary` qui se trouve être gold)

### 1.2 Préfixe `ds-` pour les keyframes

**Toute keyframe déclarée dans `front/src/app/styles/` ou dans un partial DS doit être préfixée `ds-`** :

```scss
// ✅ OK
@keyframes ds-skel-sweep { ... }
@keyframes ds-spin { ... }
@keyframes ds-fade-in { ... }

// ❌ Interdit (conflits avec composants locaux possibles)
@keyframes skel-sweep { ... }
@keyframes spin { ... }
```

**Composants Angular** : ils peuvent déclarer leurs keyframes locales **sans préfixe** dans leur scope `:host`/Angular view encapsulation. Cas typique : animations PvP (`pvp-actionable-pulse`, `target-float-*`) — leur préfixe `pvp-`/`target-float-` les rend implicitement uniques.

**Migration des keyframes existantes** :
- `_holo-arena.scss`: `screen-bg-grid-drift` → `ds-grid-drift`
- `_empty-state.scss`: `empty-state-in` → `ds-empty-state-in`
- `skel.scss` (déjà dans `shared/skel/`): `skel-sweep` → `ds-skel-sweep`
- `styles.scss`: `target-float-reticle-appear`, `target-float-reticle-pulse`, `target-float-demoted-pulse` → restent telles (préfixées `target-float-`, scope global PvP — pas DS Wave 1)

### 1.3 Ordre d'import dans `styles.scss`

**Ordre OBLIGATOIRE** (à appliquer en Niveau 1 refacto) :

```scss
// 1. Foundations (ordre critique : tokens DOIT précéder tout)
@use 'app/styles/tokens';           // Variables CSS au :root
@use 'app/styles/a11y';             // Focus-visible global, reduced-motion bloc *
@use 'app/styles/motion';           // Keyframes ds-* consolidées + utilities
@use 'app/styles/typography';       // Utilities .text-gold-gradient, .text-eyebrow, .text-mono

// 2. Background / surfaces / scroll
@use 'app/styles/holo-arena';       // .screen-bg, .screen-bg-grid, .screen-bg-glow
@use 'app/styles/scrollbar';        // Ghost scroll global * + .ghost-scroll

// 3. Building blocks (composables)
@use 'app/styles/card-surface';     // .surface-card + variants accent
@use 'app/styles/buttons';          // .btn + variants + sizes
@use 'app/styles/pills';            // .pill + variants tonals + sizes
@use 'app/styles/chips';            // .chip + variants
@use 'app/styles/icon-button';      // .icon-btn + sizes + variants

// 4. Composites (utilisent les building blocks)
@use 'app/styles/search-bar';       // .search-bar + .search-bar__*
@use 'app/styles/page-header';      // .page-header + variants
@use 'app/styles/section-header';   // .section-header + .section-header__*
@use 'app/styles/empty-state';      // .empty-state + .empty-state--rich
@use 'app/styles/holo-modal';       // Dialog containers DS + Material overrides dialog

// 5. Legacy (read-only, do not extend)
@use 'app/styles/variable';         // Old SCSS vars ($black, $grey, etc.) — frozen
@use 'app/styles/long-press';       // Legacy long-press utility

// 6. Skel (composite of motion + card-surface — last DS layer)
@use 'app/shared/skel/skel';

// 7. Material overrides (MUST be last to override Material defaults)
@use 'app/styles/material';
```

**Raisons** :
1. `_a11y.scss` doit poser le focus-visible global AVANT que les composants y dérogent
2. `_motion.scss` doit déclarer les keyframes `ds-*` AVANT que les utilities `.is-spinning` y fassent référence
3. `card-surface`/`buttons`/`pills`/`chips`/`icon-button` sont des **building blocks** consommés par les composites
4. `search-bar`, `page-header`, `section-header`, `empty-state` sont des **composites** qui utilisent les building blocks
5. `holo-modal` arrive après `card-surface` pour overrider (`.mat-mdc-dialog-surface` est un `.surface-card--flat`)
6. `variable.scss` reste pour rétrocompatibilité, **gelé** (DS-D2)
7. `material.scss` en dernier pour overrider après que tous les variants DS aient été déclarés

### 1.4 Convention pill vs chip vs badge

| Composant | Rôle | Interactif ? | aria-pressed ? | Cas d'usage |
|---|---|---|---|---|
| **`.pill`** | Status / label / résultat | ❌ Non | ❌ Non | Status d'un duel ("Victoire"), label de phase ("Main Phase 1"), date pill |
| **`.badge`** | Compteur / indicateur numérique | ❌ Non | ❌ Non | Count de résultats ("47 résultats"), nombre de notifications |
| **`.chip`** | Filter actif/inactif, toggle | ✅ Oui | ✅ Oui | Filter chips ("Victoires" / "Défaites"), toggle ON/OFF |
| **`.btn`** | Action explicite | ✅ Oui | ❌ Non | CTA, action button, link button |
| **`.icon-btn`** | Action explicite icon-only | ✅ Oui | Optionnel | Delete, share, options |

**Test pour disambiguer** :
- Si l'élément a `cursor: pointer` + `role="button"` ou `aria-pressed` → **chip ou btn/icon-btn**
- Si l'élément est lu par un screen-reader comme du **statut** ("Victoire") → **pill**
- Si l'élément est lu comme un **chiffre** ("47") → **badge**

### 1.5 Container Queries (recommandé)

Pour les composants partagés qui peuvent être placés dans des layouts de tailles variables (sidebar, modal, page principale), préférer `@container (max-width: ...)` à `@media (max-width: ...)`.

**Pattern** :
```scss
.section-header {
  container-type: inline-size;
  container-name: section-header;
  ...

  @container section-header (max-width: 480px) {
    flex-wrap: wrap;
  }
}
```

**Exception** : pour le layout root de la page (ex: `.lobby-container`, `.hub-container`), `@media` reste valide car la page est forcément l'élément racine.

**Reservation des breakpoints `@media`** : layout root + a11y media (reduced-motion, prefers-contrast, forced-colors).

### 1.6 Période de coexistence des classes legacy

**Stratégie de migration sans casse** (DS-D6) :

1. **Phase F0 — Commit 1** : nouveaux partials créés. Anciennes classes (`.lobby-cta--primary`, `.lobby-filter-chip`, `.empty-state-icon`, etc.) **conservées comme alias** dans les nouveaux partials :
   ```scss
   .btn.btn--primary,
   .lobby-cta--primary {  // legacy alias
     /* règles */
   }
   ```

2. **Phase F0 — Commit 2** : templates lobby + hub migrés vers les nouvelles classes (`.btn.btn--primary`). Tests e2e existants restent verts grâce aux alias.

3. **Phase F0 — Commit 3 (après QA visuelle OK)** : grep `lobby-cta--primary` dans front + e2e/ + tests/. Si 0 occurrence, supprimer l'alias dans le partial. Sinon migrer le consommateur restant et reprendre.

**Liste exhaustive des classes legacy à aliaser** (à confirmer par grep avant Phase F0) :
- `.lobby-header`, `.lobby-header-text`, `.lobby-header-title`, `.lobby-title-icon`, `.lobby-subtitle`
- `.lobby-section-header`, `.lobby-section-title-group`, `.lobby-section-title`, `.lobby-section-count`, `.lobby-section-filter`
- `.lobby-search-bar`, `.lobby-search-clear`
- `.lobby-cta`, `.lobby-cta--primary`, `.lobby-cta--solo`, `.lobby-cta-label`
- `.lobby-filter-chip`, `.lobby-filter-divider`
- `.empty-state-icon`, `.empty-state-title`, `.empty-state-desc`, `.empty-state-cta` (kebab simple → BEM `__`)

### 1.7 Convention focus-ring

**Globale via `_a11y.scss`** :
```scss
*:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
  border-radius: inherit;
}
*:focus:not(:focus-visible) {
  outline: none;
}
```

**Composants** : ne re-spécifient le focus-ring **que** si vraiment custom (variant visuel rare, ex: focus inset sur les pills). Sinon laissent la globale jouer.

**Nettoyage Niveau 1** : `_empty-state.scss` ligne 100 (`.empty-state-cta:focus-visible { outline: 2px solid var(--gold-soft-50); }`) supprimé — la règle globale gold-soft-50 fait déjà le job. Réduction du bruit.

### 1.8 Convention reduced-motion

**Globale via `_a11y.scss`** (un seul bloc dans tout le projet) :
```scss
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Composants** : peuvent fournir un fallback custom si besoin (ex: désactiver une animation sans la rendre 0.01ms — passer à `opacity: 1` direct) via `@include respect-reduced-motion` (mixin de `_a11y.scss`).

**Nettoyage Niveau 1** : les blocs `@media (prefers-reduced-motion: reduce)` dispersés dans `_holo-arena.scss`, `_empty-state.scss`, mockups, etc. sont **supprimés** (la globale fait le job). Cas exceptionnels documentés explicitement.

### 1.9 Décisions actives — dark mode, print, RTL

**Dark-only** (DS-D7) :
- `:root { color-scheme: dark; }` dans `_a11y.scss`
- Aucun `@media (prefers-color-scheme)` autorisé dans le projet
- En tête de `_tokens.scss` : commentaire bold "Skytrix v1 = dark-only. Pas de variant light. À reconsidérer v2 si besoin."

**Print** (DS-D10) :
```scss
@media print {
  body { display: none; }  // v1 — pas de print stylesheet
}
```
Dans `_a11y.scss`. À reconsidérer si un cas d'usage légitime émerge (ex: exporter un deck list).

**RTL** (DS-D11) :
- `margin-left` / `padding-left` / `text-align: left` directs OK
- **Pas** de `margin-inline-start` / `text-align: start` (prématuré, ajoute du bruit)
- Si un jour on supporte une langue RTL, on fera une Wave dédiée

### 1.10 Aucun z-index dans les partials Wave 1

Le partial `_z-layers.scss` (déjà existant) est la source de vérité pour les z-index. **Aucun partial Wave 1 ne déclare de z-index**. Les composants qui ont besoin de stacking (modal, sheet, drawer) utilisent `@use 'z-layers' as z;` puis `z-index: z.$z-overlay;`.

**Garde-fou** : critère de PR review "aucun `z-index: <valeur numérique>` dans les fichiers Wave 1".

### 1.11 Aucune valeur hardcodée dans les partials

**Critère grep-able** : `_buttons.scss`, `_pills.scss`, `_chips.scss`, `_icon-button.scss`, `_card-surface.scss`, `_motion.scss`, `_a11y.scss`, `_typography.scss`, `_search-bar.scss`, `_page-header.scss`, `_section-header.scss` ne doivent contenir :
- Aucun `#xxxxxx` (hex)
- Aucun `rgba(\d+, \d+, \d+` (couleur RGB littérale)
- Aucun `\d+px` autre que `1px`, `2px`, `3px`, `4px` (les bords sub-token-grid, tokens vont de 4px à 96px)

Tout passe par des tokens `_tokens.scss`. Si un token manque, **on étend `_tokens.scss`** avant d'écrire le partial.

---

## 2. Inventaire des 12 partials Wave 1

> Partial = utility classes SCSS consommables via `class="..."`. **Aucun composant Angular** créé en Wave 1 sauf `<app-replay-card-skeleton>` (cf. replay-hub-rework Phase F2).

### Code prefix dans les §

- `H` = source extraction = `_mockups/mockup-replay-hub.html`
- `V` = source extraction = `_mockups/mockup-replay-viewer.html`
- `L` = source extraction = `front/src/app/pages/pvp/lobby-page/` (shipped)

---

### 2.1 `_a11y.scss` (NOUVEAU)

**Rôle** : accessibilité globale — focus-visible, reduced-motion, dark-only, print v1, utilities sr-only.

**Contenu** :
```scss
// =============================================================================
// A11y — Accessibility primitives + global rules
// =============================================================================
// Source: DS spec 2026-05-14, §1.7 / §1.8 / §1.9.
// Imported FIRST after _tokens (cf. styles.scss ordre §1.3).
// =============================================================================

:root {
  color-scheme: dark;  // DS-D7 — pas de light mode v1
}

// Global focus ring (gold 2px outline + 2px offset) — DS-D7
*:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
  border-radius: inherit;
}
*:focus:not(:focus-visible) {
  outline: none;
}

// Global reduced-motion — DS-D7
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

// Print v1 — DS-D10
@media print {
  body { display: none; }
}

// Mixin escape-hatch : utilisé par les rares composants qui veulent un
// fallback custom à reduced-motion (ex: passer à opacity:1 direct au lieu
// du 0.01ms global).
@mixin respect-reduced-motion {
  @media (prefers-reduced-motion: reduce) {
    @content;
  }
}

// Screen-reader-only utility
@mixin sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.sr-only { @include sr-only; }
```

**Tokens consommés** : `--focus-ring-color/-width/-offset`.

**Critères d'acceptation** :
- [ ] `*:focus-visible` gold ring 2px appliqué globalement
- [ ] DevTools "Emulate prefers-reduced-motion: reduce" désactive toutes les animations
- [ ] `<html>` lit `color-scheme: dark` dans computed style
- [ ] `@media print` masque le body
- [ ] `<span class="sr-only">label</span>` invisible visuellement mais lu par screen-reader
- [ ] Aucun autre fichier SCSS du projet ne déclare de bloc `@media (prefers-reduced-motion)` global (grep — exceptions documentées inline)
- [ ] Aucun autre fichier SCSS ne pose `*:focus-visible` global

---

### 2.2 `_motion.scss` (NOUVEAU)

**Rôle** : keyframes DS consolidées (`ds-*`) + utilities classes d'animation.

**Variants keyframes** :
| Keyframe | Source migration | Usage |
|---|---|---|
| `ds-skel-sweep` | `skel.scss` (à déplacer) | Skeleton sweep horizontal |
| `ds-spin` | nouveau | Rotation 360° linéaire |
| `ds-pulse-dot` | `mockup-1-holo-arena.html` | Live indicator pulse opacity |
| `ds-state-blink` | mockups (timeline current state) | Blink subtle on current step |
| `ds-shimmer` | mockup deck-picker | Sweep diagonal gold sur surface |
| `ds-grid-drift` | `_holo-arena.scss` (`screen-bg-grid-drift` à renommer) | Drift translationnel grid |
| `ds-beam-sweep` | mockup dice arena | Sweep vertical light beam |
| `ds-duelist-pulse` | mockup waiting room | Pulse box-shadow gold "ready" |
| `ds-fade-in` | nouveau | Opacity 0 → 1 |
| `ds-slide-up` | nouveau | translateY(8px) → 0 + opacity 0 → 1 |
| `ds-slide-down` | nouveau | inverse |
| `ds-empty-state-in` | `_empty-state.scss` (à renommer `empty-state-in`) | Fade + translateY pour empty state apparition |

**Utilities classes** :
```scss
.fade-in    { animation: ds-fade-in    var(--transition-normal) var(--ease-out) both; }
.slide-up   { animation: ds-slide-up   var(--transition-normal) var(--ease-out) both; }
.slide-down { animation: ds-slide-down var(--transition-normal) var(--ease-out) both; }

.is-spinning { animation: ds-spin 800ms linear infinite; }
.is-pulsing  { animation: ds-pulse-dot 1.6s ease-in-out infinite; }

.transition-fast   { transition: all var(--transition-fast)   var(--ease-out); }
.transition-normal { transition: all var(--transition-normal) var(--ease-out); }
.transition-slow   { transition: all var(--transition-slow)   var(--ease-out); }

// Stagger pattern — le consommateur set --stagger-index via style inline
.stagger-children > * {
  animation: ds-fade-in var(--transition-normal) var(--ease-out) both;
  animation-delay: calc(var(--stagger-index, 0) * 50ms);
}
```

**Tokens consommés** : `--transition-fast/-normal/-slow`, `--ease-out/-inout/-spring`.

**Migration nécessaire (Niveau 1 refacto)** :
1. `_holo-arena.scss` : remplacer `screen-bg-grid-drift` par `ds-grid-drift` (déclaration + référence)
2. `_empty-state.scss` : remplacer `empty-state-in` par `ds-empty-state-in`
3. `shared/skel/skel.scss` : remplacer `skel-sweep` par `ds-skel-sweep` (déclaration source restera dans `skel.scss` car composant — OU déplacer ici. **Recommandation** : déplacer ici, `skel.scss` devient consommateur)

**Ajouts post-audit PvP (2026-05-14)** — patterns shippés à promouvoir :

**Keyframes additionnelles** :
- `ds-cta-shimmer` — shimmer overlay pour CTAs "wow" (source `.lobby-cta--primary`) :
  ```scss
  @keyframes ds-cta-shimmer {
    0%, 100% { background-position: 200% 200%; opacity: 0; }
    50%      { background-position: -50% -50%; opacity: 1; }
  }
  ```
- `ds-card-entry` — animation d'entrée de card dans une liste (SSE push, optimistic add ; source `.room-card--new` + keyframe `room-card-new`) :
  ```scss
  @keyframes ds-card-entry {
    from { opacity: 0; transform: translateY(-10px); box-shadow: 0 0 0 2px var(--gold-soft-50); }
    to   { opacity: 1; transform: translateY(0); box-shadow: var(--elevation-1); }
  }
  ```
- `ds-chosen-pulse` — feedback "choix validé" sur prompt cards (résout duplication 4× : `replay-chosen-pulse` dans `prompt-card-grid`, `prompt-option-list`, `prompt-yes-no`, `prompt-position-select`). Copier exactement le comportement existant.
- `ds-chain-badge-pulse` — pulse badge chain (résout duplication 2× : `chain-badge-pulse` dans `pvp-board-container` et `pvp-hand-row`).

**Utilities additionnelles** :
```scss
.card-entry  { animation: ds-card-entry 600ms var(--ease-out); }
.is-chosen   { animation: ds-chosen-pulse 800ms var(--ease-out); }

// Pulse-dot utility — indicateur live autonome
// La couleur est portée par le parent (color: var(--gold), --cyan, --success, etc.)
// Source : .room-status-dot (lobby) + .waiting-status-tag .pulse-dot (duel-page-ui)
.pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  position: relative;
  flex-shrink: 0;
  box-shadow: 0 0 8px currentColor;

  &::after {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.4;
    animation: ds-pulse-dot 1.6s ease-in-out infinite;
  }
}

.pulse-dot--sm { width: 6px; height: 6px; }
.pulse-dot--lg { width: 10px; height: 10px; }
```

**Migration consolidation** (Niveau 1 refacto, inclus en F0 Hub) :
- `prompts/prompt-card-grid/prompt-card-grid.component.scss:186` — supprimer `@keyframes replay-chosen-pulse`, remplacer `animation: replay-chosen-pulse` par `animation: ds-chosen-pulse` (ou utiliser classe `.is-chosen`)
- `prompts/prompt-option-list/prompt-option-list.component.scss:91` — idem
- `prompts/prompt-yes-no/prompt-yes-no.component.scss:37` — idem
- `prompts/prompt-position-select/prompt-position-select.component.scss:112` — idem
- `duel-page/pvp-board-container/pvp-board-container.component.scss:558` — supprimer `@keyframes chain-badge-pulse`, remplacer par `ds-chain-badge-pulse`
- `duel-page/pvp-hand-row/pvp-hand-row.component.scss:99` — idem
- `duel-page/duel-page-ui.scss:167` — supprimer `@keyframes waiting-pulse-dot`, remplacer par `ds-pulse-dot` (déjà déclaré dans `_motion.scss`)

**Critères d'acceptation** :
- [ ] Toutes les **16 keyframes `ds-*`** déclarées dans `_motion.scss` (12 originelles + 4 post-audit)
- [ ] Grep `@keyframes [^ds-]` dans `front/src/app/styles/**.scss` retourne 0 occurrence (sauf legacy `target-float-*` documenté en exception)
- [ ] Anciens noms (`screen-bg-grid-drift`, `empty-state-in`, `skel-sweep`) supprimés
- [ ] Duplications `replay-chosen-pulse` (4×) et `chain-badge-pulse` (2×) consolidées (grep `@keyframes replay-chosen-pulse\|@keyframes chain-badge-pulse` retourne 0 dans `front/src/app/pages/`)
- [ ] `.is-spinning`, `.fade-in`, `.slide-up`, `.is-pulsing`, `.is-chosen`, `.card-entry`, `.pulse-dot` testables sur la page Hub
- [ ] Reduced-motion désactive toutes les animations via `_a11y.scss` (sans config supplémentaire dans `_motion.scss`)

---

### 2.3 `_typography.scss` (NOUVEAU — ajouté en review)

**Rôle** : utility classes typographiques transverses (sans toucher aux titres locaux des composants).

**Variants** :
- `.text-gold-gradient` — text gold gradient via `background-clip: text`. Pattern dupliqué dans 3 mockups + `_empty-state.scss`. Centralisation.
- `.text-eyebrow` — sur-titre Rajdhani uppercase 0.72rem letter-spacing 0.15em color `--text-muted`. Pattern récurrent ("Tes duels enregistrés", "Open rooms", "Pre-duel actions").
- `.text-mono` — `font-family: 'JetBrains Mono', monospace`. Pour dates, scores, IDs, code refs.
- `.text-rajdhani` — `font-family: 'Rajdhani', sans-serif`. Pour titres / valeurs numériques.
- `.text-balance` — `text-wrap: balance`. Pour les titres/descriptions courtes qui doivent rester équilibrées.

**Classes** :
```scss
.text-gold-gradient {
  background: linear-gradient(135deg, var(--gold-50) 0%, var(--gold) 50%, var(--gold-900) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;  // fallback browsers without -webkit-text-fill-color
}

.text-eyebrow {
  font: var(--weight-bold) var(--text-xs) / 1.1 'Inter', sans-serif;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.text-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.text-rajdhani { font-family: 'Rajdhani', 'Inter', sans-serif; }
.text-balance { text-wrap: balance; }
```

**Ajout post-audit PvP (2026-05-14)** — `.text-code` utility :

**Source** : `.room-code-value` (`duel-page-ui:375-393`) — pattern monospace display pour codes/IDs (room code, deck ID, debug code, replay ID, share link, etc.).

**Inventaire** :
```scss
// Display block large (room code, replay ID, etc.)
.text-code {
  font: var(--weight-bold) clamp(1.3rem, 6vw, 2rem) / 1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: clamp(0.08em, 0.5vw, 0.18em);
  color: var(--gold-50);
  padding: 14px 18px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.4);
  text-align: center;
  border: 1px solid var(--gold-soft-30);
  user-select: all;
  overflow-wrap: anywhere;
  min-width: 0;
}

// Variant inline (debug ID dans un log, code dans une phrase)
.text-code--inline {
  display: inline;
  font: var(--weight-bold) 0.9em / 1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: normal;
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--gold-50);
  user-select: all;
}
```

**Usage attendu** :
- Waiting room room code (`<div class="text-code">XK7-Q9P-2M4</div>`) — variant default
- Debug log IDs, replay share URL inline (`<code class="text-code--inline">a1b2-c3d4</code>`) — variant inline

**Tokens consommés** : `--gold-50/-/-900`, `--weight-bold`, `--text-xs`, `--text-muted`, `--gold-soft-30`, `--radius-md`.

**Critères d'acceptation** :
- [ ] Hub `.hub-header-text h1` migré pour utiliser `.text-gold-gradient` au lieu du gradient inline
- [ ] Viewer (au moment du rework) idem
- [ ] Lobby (existant) migré au passage
- [ ] Waiting room `.room-code-value` migré vers `.text-code` (au passage Phase F0 Hub — la waiting room est touchée parce que partage le lobby SCSS)
- [ ] Toutes les utilities testables sur Hub

---

### 2.4 `_card-surface.scss` (NOUVEAU)

**Sources** : H `.replay-card`, `.hub-stat-card`, `.hub-empty` · V `.turn-picker-card`.

**Doctrine** : `_card-surface.scss` fournit **l'apparence uniquement** (background, border, shadow, accent-line, blur, hover). Le **layout** du contenu reste à la charge du consommateur (`display: grid/flex` + leur propre `grid-template-areas`/`flex-direction`). **Aucun slot, aucune structure d'enfant prescrite.**

**Classes** :
- `.surface-card` — base apparence :
  ```scss
  position: relative;
  overflow: hidden;
  background: var(--gradient-card-ds);  // déjà dans _tokens.scss
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-1);
  backdrop-filter: blur(8px);
  ```
- `.surface-card--interactive` — ajoute hover :
  ```scss
  cursor: pointer;
  transition: all var(--transition-fast) var(--ease-out);

  &:hover {
    transform: translateY(-1px);
    border-color: var(--gold-soft-40);
    box-shadow: var(--elevation-3), 0 0 0 1px var(--gold-soft-25);
  }
  ```
- `.surface-card--accent-gold` — pseudo `::before` accent-line gauche :
  ```scss
  &::before {
    content: '';
    position: absolute;
    left: 0; top: 12%; bottom: 12%;
    width: 3px;
    background: linear-gradient(to bottom, transparent, var(--gold), transparent);
    opacity: 0.6;
    transition: opacity var(--transition-fast) var(--ease-out),
                width var(--transition-fast) var(--ease-out);
  }
  ```
- `.surface-card--accent-cyan` — idem avec cyan
- `.surface-card--accent-neutral` — idem avec `--text-muted` (loss)
- `.surface-card--accent-warning` — idem avec `--warning`
- `.surface-card--accent-danger` — idem avec `--danger-strong`
- `.surface-card--low` — variant background `--surface-card-low` (skeleton, dimmed states)
- `.surface-card--flat` — supprime shadow + backdrop-filter (cas dialog content interne)

**Hover sur accent** :
```scss
.surface-card--interactive:hover {
  &.surface-card--accent-gold::before,
  &.surface-card--accent-cyan::before,
  &.surface-card--accent-neutral::before,
  &.surface-card--accent-warning::before,
  &.surface-card--accent-danger::before {
    opacity: 1;
    width: 4px;
  }
}
```

**Tokens consommés** : `--gradient-card-ds` (existant), `--border-subtle`, `--radius-lg`, `--elevation-1/-3`, `--gold-*/-cyan-*/-warning/-danger*`, `--text-muted`, `--transition-fast`, `--ease-out`.

**Garde-fou** : aucun `display: grid` / `display: flex` / `grid-template-*` dans `_card-surface.scss`. Grep doit retourner 0.

**Critères d'acceptation** :
- [ ] Hub `.replay-card` → `.surface-card.surface-card--interactive.surface-card--accent-gold` (ou `--accent-neutral` si loss, `--accent-cyan` si draw, `--accent-warning` si timeout, `--accent-danger` si surrender)
- [ ] Hub `.hub-stat-card` → `.surface-card.surface-card--accent-{gold,neutral,cyan,gold}`
- [ ] Hub `.hub-empty` → `.surface-card` (sans accent)
- [ ] Viewer `.turn-picker-card` (au moment rework viewer) → `.surface-card.surface-card--interactive`
- [ ] Aucun layout dans le partial (grep doit retourner 0)
- [ ] Documenté en tête : "Apparence uniquement — layout à la charge du consommateur"

---

### 2.5 `_buttons.scss` (NOUVEAU)

**Sources** : L `.lobby-cta--primary/--solo` · H `.hub-empty-cta` + `.replay-open-cta` · V `.end-overlay-btn--primary/--secondary/--ghost` + `.replay-back-btn`.

**Convention** : `<button class="btn btn--<variant> btn--<size>">` + Material en interne (`mat-button`/`mat-raised-button`) **uniquement si besoin de ripple**. Les partials ciblent une `<button>` native ou un `<a>` ; les overrides Material vivent dans `material.scss`.

**Base** :
```scss
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Inter', sans-serif;
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast) var(--ease-out);
  text-decoration: none;  // pour les <a>

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
}
```

**Variants** :
```scss
.btn--primary {
  background: linear-gradient(135deg, var(--gold-100), var(--gold), var(--gold-700));
  color: var(--text-inverse);
  box-shadow: 0 4px 12px var(--gold-soft-25),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);

  &:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow: 0 6px 16px var(--gold-soft-40),
                inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
}

.btn--secondary {
  background: var(--cyan-soft-15);
  border: 1px solid var(--cyan-soft-40);
  color: var(--cyan-300);

  &:hover:not(:disabled) {
    background: var(--cyan-soft-25);
    border-color: var(--cyan-soft-50);
    color: var(--cyan-300);
  }
}

.btn--ghost {
  background: transparent;
  border: 1px solid var(--border-soft);
  color: var(--text-secondary);

  &:hover:not(:disabled) {
    color: var(--gold);
    border-color: var(--gold-soft-40);
    background: var(--gold-soft-08);
  }
}

.btn--danger {
  background: var(--danger-soft);
  border: 1px solid rgba(255, 82, 82, 0.3);
  color: var(--danger-strong);

  &:hover:not(:disabled) {
    background: rgba(255, 82, 82, 0.25);
    border-color: var(--danger-strong);
  }
}
```

**Sizes** :
```scss
.btn--sm  { padding: 6px 12px;  font-size: var(--text-xs); min-height: 32px; }
.btn--md  { padding: 10px 16px; font-size: var(--text-sm); min-height: var(--touch-target-min); }  // default
.btn--lg  { padding: 12px 22px; font-size: var(--text-md); min-height: 48px; }
```

**Modifiers** :
- `.btn--cta` — uppercase + letter-spacing renforcé (pour les CTAs forts type "Jouer un duel")
  ```scss
  text-transform: uppercase;
  letter-spacing: 0.06em;
  ```
- `.btn--full` — `width: 100%`
- `.btn--icon-leading` / `.btn--icon-trailing` — alignement icône, mat-icon child direct

**Décision casse** (résolu d'incohérence b de la review) :
- **Default** : casse normale (lowercase mixte). Ex: bouton "Lobby", "Retour", "Ouvrir"
- **Avec `.btn--cta`** : uppercase. Ex: "Jouer un duel", "Lancer la partie", "Ouvrir"
- Les CTAs primary/secondary d'un empty state utilisent `.btn--cta` par convention

**Ajouts post-audit PvP (2026-05-14)** — modifiers additionnels confirmés par lobby shipped :

**`.btn--cta-shimmer`** — overlay shimmer pour CTAs "wow" (source `.lobby-cta--primary` lobby:150-158) :
```scss
.btn--cta-shimmer {
  // Pré-requis : .btn--primary doit avoir position: relative; overflow: hidden;
  // (déjà le cas dans la base .btn ci-dessus)
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, transparent 30%, rgba(255, 255, 255, 0.4), transparent 70%);
    background-size: 200% 200%;
    animation: ds-cta-shimmer 4s ease-in-out infinite;
    pointer-events: none;
  }
}

// Keyframe ds-cta-shimmer déclarée dans _motion.scss §2.2
```

**Usage** : combiner avec `.btn--primary` pour les CTAs visuellement "premium" — lobby Create Room, Hub empty state "Play PvP", waiting room "Start Duel". **Pas** sur les CTAs utilitaires (ex: search clear, action button discret).

**`.btn--success-flash`** — feedback success transitoire (source `.code-copy-btn.copied` `duel-page-ui:424-428`) :
```scss
.btn.btn--success-flash {
  background: var(--success-soft) !important;
  border-color: rgba(76, 175, 80, 0.6) !important;
  color: #66bb6a !important;
  // !important légitime ici car on override un variant (primary/secondary) temporairement.
  // Documenté en commentaire de tête du partial comme exception au garde-fou §6 critère 3.
}
```

**Usage** : ajouter `.btn--success-flash` via JS pendant 1.5-2s après une action de copie/save réussie, puis la retirer. Cas usage : copy room code, copy share URL, copy deck list, etc.

**Tokens consommés** : `--gold-*`, `--cyan-*`, `--danger*`, `--text-inverse/-secondary`, `--border-soft`, `--radius-md`, `--transition-fast`, `--ease-out`, `--touch-target-min`, `--weight-bold`, `--text-xs/-sm/-md`, `--success-soft`.

**Critères d'acceptation** :
- [ ] 4 variants × 3 sizes testables en isolation (page Hub OK pour vérif visuelle)
- [ ] Modifiers `.btn--cta`, `.btn--cta-shimmer`, `.btn--success-flash`, `.btn--full`, `.btn--icon-leading/-trailing` testables
- [ ] Lobby `.lobby-cta--primary` aliasé → migré vers `.btn.btn--primary.btn--cta-shimmer.btn--lg.btn--cta`
- [ ] Lobby `.lobby-cta--solo` aliasé → migré vers `.btn.btn--secondary.btn--lg.btn--cta`
- [ ] Hub `.hub-empty-cta` → `.btn.btn--primary.btn--cta-shimmer.btn--lg.btn--cta`
- [ ] Hub `.replay-open-cta` → `.btn.btn--primary.btn--sm.btn--cta.btn--icon-trailing` (PAS de shimmer — bouton list-item discret)
- [ ] Waiting room `.code-copy-btn` migré vers `.btn.btn--primary.btn--md` + logique JS pour toggle `.btn--success-flash` 1.5s après copie
- [ ] Disabled state visible et non-cliquable (pointer-events none)
- [ ] `:focus-visible` gold ring 2px appliqué via globale `_a11y.scss` (pas re-spécifié)
- [ ] Min-height respecte `--touch-target-min` (44px) en md/lg

---

### 2.6 `_pills.scss` (NOUVEAU)

**Sources** : H `.hub-list-count` (badge en réalité) · H `.replay-result--win/--loss/--draw/--timeout/--surrender` · V `.context-turn-pill`, `.context-phase`, `.replay-meta-pill`, `.player-chip-result--win/--loss`.

**Doctrine** : `.pill` = **status / label / résultat** non-interactif. Cf. §1.4 pour distinguer pill / chip / badge.

**Base** :
```scss
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-family: 'Rajdhani', 'Inter', sans-serif;
  font-weight: var(--weight-bold);
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
}

.pill__icon { font-size: 14px !important; }  // mat-icon child
```

**Variants tonals** :
```scss
.pill--gold {
  background: var(--gold-soft-12);
  border: 1px solid var(--gold-soft-25);
  color: var(--gold-50);
  .pill__icon { color: var(--gold); }
}

.pill--cyan {
  background: var(--cyan-soft-15);
  border: 1px solid var(--cyan-soft-25);
  color: var(--cyan-300);
}

.pill--neutral {
  background: var(--surface-overlay);
  border: 1px solid var(--border-soft);
  color: var(--text-muted);
}

.pill--warning {
  background: var(--warning-soft);
  border: 1px solid rgba(255, 193, 7, 0.3);
  color: var(--warning);
}

.pill--danger {
  background: var(--danger-soft);
  border: 1px solid rgba(255, 82, 82, 0.3);
  color: var(--danger-strong);
}

.pill--success {
  background: var(--success-soft);
  border: 1px solid rgba(76, 175, 80, 0.3);
  color: var(--success);
}
```

**Sizes** :
```scss
.pill--xs { padding: 3px 8px;  font-size: 0.62rem; }  // counts inline
.pill--sm { padding: 4px 10px; font-size: 0.7rem; }   // default
.pill--md { padding: 7px 14px; font-size: 0.75rem; }  // status pills card
.pill--lg { padding: 8px 16px; font-size: 0.85rem; }  // end-overlay celebrated
```

**Modifier celebrated** (résolu d'incohérence c) :
```scss
.pill--celebrated {
  letter-spacing: 0.18em;

  &.pill--gold    { text-shadow: 0 0 12px var(--gold-soft-50); }
  &.pill--cyan    { text-shadow: 0 0 12px var(--cyan-soft-50); }
  &.pill--success { text-shadow: 0 0 12px rgba(76, 175, 80, 0.4); }
}
```

**Distinction `.pill` vs `.badge`** : créer une classe séparée `.badge` (résolu incohérence c) :
```scss
.badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 12px;  // moins arrondi qu'une pill
  background: var(--gold-soft-12);
  border: 1px solid var(--gold-soft-25);
  color: var(--gold);
  font: var(--weight-bold) 0.7rem / 1 'Inter', sans-serif;  // Inter, pas Rajdhani
  letter-spacing: normal;  // pas de spacing renforcé
  text-transform: none;    // pas de uppercase
  white-space: nowrap;
}

.badge--gold    { /* default ci-dessus */ }
.badge--cyan    { background: var(--cyan-soft-15); border-color: var(--cyan-soft-25); color: var(--cyan-300); }
.badge--neutral { background: var(--surface-overlay); border-color: var(--border-soft); color: var(--text-muted); }
```

**Ajout post-audit PvP (2026-05-14)** — modifier `.pill--live` (source `.waiting-status-tag` `duel-page-ui:134-165`) :

```scss
.pill.pill--live {
  // Pulse-dot intégré via ::before — couleur héritée de la variant courante
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
    position: relative;
    flex-shrink: 0;
    animation: ds-pulse-dot 1.6s ease-in-out infinite;
  }
}
```

**Usage** : indicateur "en cours / live / waiting" — `<span class="pill pill--gold pill--md pill--live">EN ATTENTE</span>`. La couleur de l'animation suit la variant (gold, cyan, success, warning, danger). Cas usage : waiting room status, duel-in-progress badge, dice rolling, replay live-following indicator.

**Distinction `.pill--live` vs `.pulse-dot` standalone** : `.pill--live` est un **modifier** qui ajoute un `::before` à une pill (le label texte reste, ex: "EN ATTENTE"). `.pulse-dot` (cf. §2.2) est une utility class **standalone** pour placer un indicateur sans label texte (ex: dans un statut sur une card list-item).

**Tokens consommés** : `--gold-*`, `--cyan-*`, `--success/-soft`, `--warning/-soft`, `--danger*/-soft`, `--text-muted`, `--border-soft`, `--radius-pill`, `--surface-overlay`, `--weight-bold`.

**Critères d'acceptation** :
- [ ] Hub `.hub-list-count` → `.badge.badge--gold` (PAS pill — c'est un compteur)
- [ ] Hub `.replay-result--win` → `.pill.pill--gold.pill--md`
- [ ] Hub `.replay-result--loss` → `.pill.pill--neutral.pill--md`
- [ ] Hub `.replay-result--draw` → `.pill.pill--cyan.pill--md`
- [ ] Hub `.replay-result--timeout` → `.pill.pill--warning.pill--md`
- [ ] Hub `.replay-result--surrender` → `.pill.pill--danger.pill--md`
- [ ] Waiting room `.waiting-status-tag` → `.pill.pill--gold.pill--md.pill--live` + suppression du `.pulse-dot` inline + suppression du `@keyframes waiting-pulse-dot` (utilise `ds-pulse-dot` de `_motion.scss`)
- [ ] Mapping result → variant documenté côté Angular comme `computed signal` du store/component
- [ ] Viewer `.context-turn-pill` `.context-phase` etc. migrables au moment du rework viewer
- [ ] `.pill--celebrated` testée sur end-overlay (au moment du Wave Viewer)

---

### 2.7 `_chips.scss` (NOUVEAU)

**Sources** : L `.lobby-filter-chip` · H `.hub-filter-chip`.

**Doctrine** : chip = **interactif** (filter, toggle, état pressed). Cf. §1.4. `cursor: pointer`, `role="button"` ou `aria-pressed` obligatoire côté HTML.

**Base** :
```scss
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--radius-pill);
  background: var(--surface-overlay);
  border: 1px solid var(--border-soft);
  color: var(--text-secondary);
  font: var(--weight-semibold) var(--text-xs) / 1 'Inter', sans-serif;
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: all var(--transition-fast) var(--ease-out);

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-medium);
  }
}

.chip__icon { font-size: 14px !important; }
```

**État actif (modifier variant + actif)** :
```scss
.chip.chip--active {
  // Default actif → gold
  background: var(--gold-soft-12);
  border-color: var(--gold-soft-50);
  color: var(--gold-50);
  .chip__icon { color: var(--gold); }
}

.chip.chip--active.chip--cyan {
  background: var(--cyan-soft-15);
  border-color: var(--cyan-soft-50);
  color: var(--cyan-300);
}

.chip.chip--active.chip--neutral {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--border-medium);
  color: var(--text-primary);
}
```

**Sizes** :
```scss
.chip--sm { padding: 6px 10px; font-size: 0.65rem; }
.chip--md { /* default — padding 8×14 */ }
```

**Divider visuel inline** (pas un chip lui-même) :
```scss
.chip-divider {
  display: inline-block;
  width: 1px;
  height: 20px;
  background: var(--border-soft);
  align-self: center;
}
```

**Container row** :
```scss
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);

  @container chip-row (max-width: 480px) {  // si parent a container-type
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-mask-image: linear-gradient(to right, #000 0%, #000 calc(100% - 24px), transparent 100%);
    mask-image: linear-gradient(to right, #000 0%, #000 calc(100% - 24px), transparent 100%);
  }
}
```

**Tokens consommés** : `--gold-*`, `--cyan-*`, `--surface-overlay/-hover`, `--border-soft/-medium`, `--text-*`, `--radius-pill`, `--weight-semibold`, `--text-xs`, `--space-2`.

**Critères d'acceptation** :
- [ ] Lobby filter chips aliasés → migrés vers `.chip.chip--active`
- [ ] Hub filter chips utilisent `.chip` + `.chip--active.chip--gold` (default)
- [ ] `aria-pressed` géré par le composant qui consomme (critère de PR review)
- [ ] Mobile : `.chip-row` en horizontal scroll avec fade-right (via container query)

---

### 2.8 `_icon-button.scss` (NOUVEAU)

**Sources** : H `.replay-action-btn` (delete) · V `.replay-icon-btn` (header actions) · V `.transport-toggle`.

**Doctrine** : icon-button = **icône seule** (label aria attendu). Carré ou rond. Pas de texte visible.

**Base** :
```scss
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast) var(--ease-out);

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  .material-icons-round,
  mat-icon { font-size: 16px; }  // default — overridden per size
}
```

**Sizes** :
```scss
.icon-btn--sm { width: 28px; height: 28px;
  .material-icons-round, mat-icon { font-size: 14px; }
}
.icon-btn--md { width: 34px; height: 34px;
  .material-icons-round, mat-icon { font-size: 16px; }
}  // default
.icon-btn--lg { width: 44px; height: 44px;  // touch-target-min
  .material-icons-round, mat-icon { font-size: 20px; }
}
```

**Variants** :
```scss
.icon-btn--danger:hover:not(:disabled) {
  color: var(--danger-strong);
  border-color: rgba(255, 82, 82, 0.3);
  background: rgba(255, 82, 82, 0.08);
}

.icon-btn--active {
  background: var(--gold-soft-12);
  border-color: var(--gold-soft-50);
  color: var(--gold-50);
  .material-icons-round, mat-icon { color: var(--gold); }
}

.icon-btn--round { border-radius: 50%; }

.icon-btn--ghost-hover-only {
  opacity: 0;
  transition: opacity var(--transition-fast) var(--ease-out);
}
// Le parent qui veut ce comportement applique :
// .parent:hover .icon-btn--ghost-hover-only { opacity: 1; }
```

**Tokens consommés** : `--radius-md`, `--surface-hover`, `--text-muted/-primary`, `--danger-strong`, `--gold-*`, `--transition-fast`, `--ease-out`.

**Critères d'acceptation** :
- [ ] Hub delete-btn → `.icon-btn.icon-btn--md.icon-btn--danger.icon-btn--ghost-hover-only`
- [ ] Viewer back-btn migré (utilisera A0.5 button ghost si label visible, sinon icon-btn)
- [ ] `aria-label` obligatoire — critère de PR review (linter HTML idéal mais hors scope Wave 1)
- [ ] Min-size lg respecte 44px touch target

---

### 2.9 `_search-bar.scss` (NOUVEAU)

**Sources** : L `.lobby-search-bar` · H `.hub-search-bar`.

**Classes** :
```scss
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--surface-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast) var(--ease-out),
              background var(--transition-fast) var(--ease-out);

  &:focus-within {
    border-color: var(--gold-soft-50);
    background: var(--surface-hover);
  }
}

.search-bar__icon {
  color: var(--text-muted);
  font-size: 18px !important;
  flex-shrink: 0;
}

.search-bar__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: var(--weight-normal) var(--text-sm) 'Inter', sans-serif;
  color: var(--text-primary);

  &::placeholder { color: var(--text-disabled); }
}

.search-bar__clear {
  // alias de .icon-btn --sm — pas de duplication, on étend
  @extend .icon-btn, .icon-btn--sm;
}

// Modifier mobile / full-width
.search-bar--full { width: 100%; }
```

**Tokens consommés** : `--surface-overlay/-hover`, `--border-subtle`, `--radius-md`, `--gold-soft-50`, `--text-sm/-muted/-disabled/-primary`, `--weight-normal`, `--transition-fast`, `--ease-out`.

**Critères d'acceptation** :
- [ ] Lobby `.lobby-search-bar` aliasé → migré
- [ ] Hub utilise `.search-bar` (filtrer par pseudo OU deck)
- [ ] Focus-within border gold visible
- [ ] `.search-bar--full` à 100% width sur mobile

---

### 2.10 `_page-header.scss` (NOUVEAU)

**Sources** : L `.lobby-header` · H `.hub-header` · V `.replay-topbar` (variant compact).

**Base** :
```scss
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.page-header__title-group {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.page-header__icon {
  font-size: 38px !important;
  color: var(--gold);
  filter: drop-shadow(0 0 14px var(--gold-soft-50));
}

.page-header__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.page-header__title {
  font-family: 'Rajdhani', 'Inter', sans-serif;
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  letter-spacing: 0.04em;
  line-height: 1.1;
  // Le gold gradient est appliqué via .text-gold-gradient (cf. §2.3)
  // → consommer ainsi : <h1 class="page-header__title text-gold-gradient">
}

.page-header__subtitle {
  @extend .text-eyebrow;  // de _typography.scss
}

.page-header__back-btn {
  // Alias structurel — applique les bonnes classes directement côté template :
  // <a class="btn btn--ghost btn--sm">
}
```

**Variants** :
```scss
.page-header--bordered {
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-3);
}

.page-header--compact {
  // Sticky horizontal — pour viewer + écrans pleine page futurs
  position: sticky;
  top: 0;
  z-index: 10;  // si conflit, utiliser z-layers.scss
  flex-direction: row;
  background: linear-gradient(180deg, rgba(15, 15, 28, 0.96), rgba(15, 15, 28, 0.78));
  backdrop-filter: blur(12px);
  padding: var(--space-3) var(--space-4);

  .page-header__icon { font-size: 24px !important; }
  .page-header__title { font-size: var(--text-md); }
  .page-header__subtitle { display: none; }
}
```

**Mobile** (via container query si parent a container-type, sinon @media) :
```scss
@media (max-width: 480px) {
  .page-header {
    gap: var(--space-2);
  }
  .page-header__icon { font-size: 28px !important; }
  .page-header__title { font-size: 1.15rem; line-height: 1.05; }
  .page-header__subtitle { font-size: 0.65rem; letter-spacing: 0.12em; }
  // back-btn label hidden — handled via .btn--sm @media if needed
}
```

**Tokens consommés** : `--text-xl/-md`, `--gold/-soft-50`, `--text-muted`, `--space-2/-3/-4`, `--border-subtle`, `--weight-bold`.

**Critères d'acceptation** :
- [ ] Lobby `.lobby-header` aliasé → migré vers `.page-header` + `.page-header__title` + `.text-gold-gradient`
- [ ] Hub utilise `.page-header` + nouveau back-btn `.btn.btn--ghost.btn--sm`
- [ ] Viewer (au moment du rework) `.replay-topbar` migré vers `.page-header.page-header--compact.page-header--bordered`
- [ ] Mobile : label back-btn masqué, icône seule (handled par btn--sm + container width)

---

### 2.11 `_section-header.scss` (NOUVEAU)

**Sources** : L `.lobby-section-header` · H `.hub-list-header`.

**Classes** :
```scss
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.section-header__title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-header__title {
  position: relative;
  padding-left: 14px;
  font: var(--weight-bold) 0.75rem / 1 'Rajdhani', sans-serif;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-muted);

  // Accent bar gold à gauche (opt-out via --no-bar)
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 14px;
    background: var(--gold);
    border-radius: 2px;
    box-shadow: 0 0 8px var(--gold-soft-50);
  }
}

.section-header__title--no-bar {
  padding-left: 0;
  &::before { display: none; }
}

// Count = .badge.badge--gold (cf. §2.6)
// Action = .btn.btn--ghost.btn--sm (cf. §2.5)
// Pas de classe spécifique — le template compose
```

**Tokens consommés** : `--text-muted`, `--gold/-soft-50`, `--weight-bold`, `--space-3`.

**Critères d'acceptation** :
- [ ] Lobby section-header aliasé → migré
- [ ] Hub utilise `.section-header` + `.badge.badge--gold` pour count + `.btn.btn--ghost.btn--sm` pour sort/filter
- [ ] Accent bar `::before` désactivable via `--no-bar` modifier
- [ ] Mobile : flex-wrap correct sur 2 lignes si nécessaire

---

### 2.12 `_empty-state.scss` (REFACTO Niveau 1 — fichier existant)

**Refacto BEM strict** (résolu incohérence f) :
- **`.empty-state-icon` → `.empty-state__icon`** (BEM)
- **`.empty-state-title` → `.empty-state__title`**
- **`.empty-state-desc` → `.empty-state__desc`**
- **`.empty-state-cta` → `.empty-state__cta`** OU mieux : **supprimer la classe et utiliser `.btn.btn--primary.btn--lg.btn--cta`** (DRY avec `_buttons.scss`)

**Période de coexistence** : les anciennes classes kebab-simple restent comme alias 1 semaine, puis suppression au commit 3.

**Variant `--rich`** (nouveau, pour Hub) :
```scss
.empty-state--rich {
  min-height: 320px;
  padding: var(--space-8) var(--space-4);

  .empty-state__icon {
    font-size: 96px !important;
    width: 96px !important;
    height: 96px !important;
    filter: drop-shadow(0 0 24px var(--gold-soft-12));
  }

  .empty-state__title {
    font: var(--weight-bold) var(--text-lg) 'Rajdhani', sans-serif;
    letter-spacing: 0.05em;
  }
}
```

**Variant `--simple`** : c'est l'état actuel — pas de modifier explicite nécessaire, c'est `.empty-state` tout court. **Décision** : ne pas créer `.empty-state--simple` (résolu incohérence f).

**Variant `--error`** existant : conservé tel quel.

**Nettoyage Niveau 1** :
- Supprimer `:focus-visible` redéclaré ligne 100 — la globale `_a11y.scss` fait le job
- Supprimer `!important` x6 → ne garder que ceux strictement nécessaires (icône Material `font-size: 96px !important` reste — c'est un override Material légitime)
- Animation `empty-state-in` → `ds-empty-state-in` (préfixe `ds-`)

**Décisions UX validées 2026-05-14** :
- **Hub** = `.empty-state.empty-state--rich` + 2 CTAs (`.btn.btn--primary.btn--lg.btn--cta` + `.btn.btn--secondary.btn--lg.btn--cta`)
- **Lobby** = `.empty-state` simple (état fréquent, ne pas saturer)

**Tokens consommés** : `--text-disabled/-muted`, `--gold-soft-12`, `--text-lg/-md/-sm`, `--space-3/-4/-6/-8`, `--weight-bold`.

**Critères d'acceptation** :
- [ ] Hub empty → `.empty-state.empty-state--rich` + 2 CTAs via `.btn`
- [ ] Lobby empty conserve son rendu existant via alias
- [ ] Refacto BEM appliqué (`.empty-state__icon` etc.)
- [ ] `:focus-visible` re-spécifié supprimé
- [ ] Au moins 4 des 6 `!important` retirés (les 2 restants documentés comme overrides Material)
- [ ] Keyframe renommée `ds-empty-state-in`

---

## 3. Refacto Niveau 1 — Liste exhaustive

> Ce qui doit être fait **dans le même commit** que la création des partials, pour éviter de coder contre le système.

### 3.1 Migration `@import` → `@use` dans `styles.scss`

**Fichier** : `front/src/styles.scss`

**Changements** :
1. Convertir tous les `@import 'app/styles/xxx';` en `@use 'app/styles/xxx';`
2. Appliquer l'ordre d'import strict défini en §1.3
3. Les composants qui utilisent `$blue`, `$black`, `$white`, `$grey` (cf. lignes 47, 121-135 de `styles.scss`) doivent passer par `@use 'variable' as v;` puis `v.$blue` — **OU** migrer vers les tokens DS si possible (recommandé)
4. Supprimer le `@import` de skel ligne 9 — il devient `@use 'app/shared/skel/skel';`

**Effort** : 30 min

**Risques** : `$blue`, `$white` etc. utilisés en interpolation `#{$blue}` doivent rester compatibles. À tester en isolation.

### 3.2 Renommage keyframes legacy → `ds-` préfixe

| Fichier | Ancien nom | Nouveau nom |
|---|---|---|
| `_holo-arena.scss` | `screen-bg-grid-drift` | `ds-grid-drift` |
| `_empty-state.scss` | `empty-state-in` | `ds-empty-state-in` |
| `shared/skel/skel.scss` | `skel-sweep` | `ds-skel-sweep` (déplacer la déclaration dans `_motion.scss`, `skel.scss` consomme) |

**Pas renommés** (préfixe déjà unique) :
- `target-float-*` (3 keyframes globales dans `styles.scss`) — gardent leur nom
- `pvp-*` (multiples keyframes locales PvP) — gardent leur nom
- `chain-resolving-pulse` et autres animations scoped composants — gardent leur nom

**Effort** : 20 min

### 3.3 Migration `.pvp-dialog-panel` de `styles.scss` → `_holo-modal.scss`

**Fichier source** : `front/src/styles.scss` lignes 154-205 (52 lignes)

**Cible** : `front/src/app/styles/_holo-modal.scss` (ajout d'une section "Dialog overrides Material")

**Pourquoi** : `styles.scss` doit rester un fichier "entrypoint" minimal. Tous les styles modulaires vivent dans des partials. La cohabitation actuelle est de la dette.

**Vérifier au passage** :
- `.pvp-dialog-panel--danger`, `.pvp-dialog-panel--warning` sont utilisés où ? Grep `pvp-dialog-panel` dans front/ avant de bouger
- Aucun import circulaire (holo-modal n'utilise pas styles.scss)

**Effort** : 30 min (grep + déplacement + test)

### 3.4 Nettoyage `prefers-reduced-motion` redondants

**Fichiers à nettoyer** (suppression des blocs `@media (prefers-reduced-motion: reduce)` redondants une fois `_a11y.scss` posé) :
- `_holo-arena.scss` ligne 78-80 → supprimer
- `_empty-state.scss` ligne 34-36 → supprimer
- `styles.scss` ligne 308-317 → supprimer (target-float — la globale gère)

**Cas conservés** (logique custom légitime, pas un simple 0.01ms) :
- `_tokens.scss` `@media (prefers-reduced-motion: reduce) { :root { --pvp-*-animation: 0ms; }}` (lignes 351-362) — surcharge tokens, pas redondant
- Composants Angular qui ont une logique custom (à vérifier au cas par cas, pas un objectif Wave 1)

**Effort** : 15 min

### 3.5 Nettoyage `:focus-visible` redondants

**Fichiers à nettoyer** :
- `_empty-state.scss` ligne 100 → supprimer (`empty-state-cta:focus-visible { outline: ... }`)
- Mockups : conservés (mockups standalone, pas dans le bundle Angular — pas concernés)

**Effort** : 5 min

### 3.6 Documentation `variable.scss` legacy

**Fichier** : `front/src/app/styles/variable.scss`

**Ajouter en tête** :
```scss
// =============================================================================
// LEGACY — SCSS variables historiques (light theme era pré-2026-02)
// =============================================================================
// **DO NOT EXTEND** — ne pas ajouter de nouvelles variables ici.
// **DO NOT DELETE** — utilisé par `mixin.scss` (ban-info) et `styles.scss`
// (autofill, mdc-button overrides). Migration vers tokens CSS @ `_tokens.scss`
// se fait au cas par cas lors des reworks d'écran (cf. memory:
// project_design_system_strategy.md migration mapping).
//
// Variables actives :
//   $black  — referenced lobby-styles legacy + sim background
//   $blue   — referenced styles.scss autofill
//   $grey   — referenced styles.scss disabled state
//   $white  — referenced styles.scss autofill
//
// Audit 2026-05-14 (Niveau 1 refacto) : 3 références dans styles.scss,
// 1 dans mixin.scss (ban-info), 0 dans nouveaux partials Wave 1.
// =============================================================================
```

**Effort** : 5 min

### 3.7 Audit grep pré-Phase F0 (verrou)

**Commandes obligatoires AVANT d'écrire le moindre alias** :

```bash
# Anciennes classes lobby (à aliaser ou migrer)
grep -rn 'lobby-header\|lobby-section\|lobby-search\|lobby-cta\|lobby-filter-chip\|lobby-filter-divider' front/ e2e/ scripts/

# Anciennes classes empty-state kebab-simple
grep -rn 'empty-state-icon\|empty-state-title\|empty-state-desc\|empty-state-cta' front/ e2e/ scripts/

# Anciennes keyframes
grep -rn '@keyframes screen-bg-grid-drift\|@keyframes empty-state-in\|@keyframes skel-sweep' front/

# Hex hardcodés dans les pages (audit Niveau 2 — informatif)
grep -rn '#[0-9a-fA-F]\{6\}\b\|#[0-9a-fA-F]\{3\}\b' front/src/app/pages/

# !important dans les styles
grep -rn '!important' front/src/app/
```

**Effort** : 20 min

**Action attendue** : produire un mini-rapport "Audit pré-F0" dans le commit message ou la PR.

---

## 4. Effort Wave 1 — calibrage final (post-audit PvP)

| Sous-tâche | Effort |
|---|---|
| §2.1 `_a11y.scss` création | 20 min |
| §2.2 `_motion.scss` création (16 keyframes `ds-*` + utilities incl. `.pulse-dot`/`.card-entry`/`.is-chosen`) | **55 min** *(était 40 min)* |
| §2.3 `_typography.scss` création (incl. `.text-code` + `.text-code--inline`) | **45 min** *(était 30 min)* |
| §2.4 `_card-surface.scss` création | 30 min |
| §2.5 `_buttons.scss` création (incl. `.btn--cta-shimmer` + `.btn--success-flash`) | **1h15** *(était 1h)* |
| §2.6 `_pills.scss` + `.badge` création (incl. `.pill--live`) | **1h** *(était 50 min)* |
| §2.7 `_chips.scss` création | 30 min |
| §2.8 `_icon-button.scss` création | 30 min |
| §2.9 `_search-bar.scss` création | 20 min |
| §2.10 `_page-header.scss` création | 45 min |
| §2.11 `_section-header.scss` création | 20 min |
| §2.12 `_empty-state.scss` refacto BEM + variant `--rich` | 40 min |
| §3.1 `@import` → `@use` styles.scss | 30 min |
| §3.2 Renommage keyframes legacy `ds-*` | 20 min |
| §3.3 Migration `.pvp-dialog-panel` → `_holo-modal.scss` | 30 min |
| §3.4 Nettoyage reduced-motion redondants | 15 min |
| §3.5 Nettoyage focus-visible redondants | 5 min |
| §3.6 Doc `variable.scss` legacy | 5 min |
| §3.7 Audit grep pré-F0 + rapport | 20 min |
| **Migration PvP supplémentaires (post-audit 2026-05-14)** | |
| — Lobby `.lobby-cta--primary` → `.btn.btn--primary.btn--cta-shimmer.btn--lg.btn--cta` | inclus migration lobby |
| — Lobby `.room-status-dot` → `.pulse-dot` utility | +10 min |
| — Lobby `.room-card--new` → ajouter `.card-entry` | +5 min |
| — Waiting room `.waiting-status-tag` → `.pill.pill--gold.pill--md.pill--live` | +10 min |
| — Waiting room `.waiting-title` → `.text-gold-gradient` | +5 min |
| — Waiting room `.room-code-value` → `.text-code` | +5 min |
| — Waiting room `.code-copy-btn` → `.btn.btn--primary.btn--md` + JS `.btn--success-flash` | +15 min |
| — Dédoublonnage `replay-chosen-pulse` 4× → `ds-chosen-pulse` | +20 min |
| — Dédoublonnage `chain-badge-pulse` 2× → `ds-chain-badge-pulse` | +10 min |
| Migration lobby (templates + SCSS) | 1h |
| Tests QA visuels screenshot before/after | 30 min |
| **TOTAL Wave 1** | **~12h** *(était 9h, +3h post-audit PvP)* |

> **Important** : ces 12h **incluent la création des partials, le refacto Niveau 1, ET les migrations PvP confirmées par l'audit** (cf. [`ds-wave-1-pvp-extraction-audit-2026-05-14.md`](./ds-wave-1-pvp-extraction-audit-2026-05-14.md)). C'est l'investissement structurant qui rend toutes les futures refontes 3-5× plus rapides ET garantit cohérence Lobby + Hub + Waiting Room dès la livraison Hub.

**Bénéfice audit PvP** :
- 5 modifiers/utilities ajoutés à la spec, confirmés par 1+ consommateur shippé
- 4 keyframes consolidées (6 déclarations → 4 dans `_motion.scss`)
- 0 divergence visuelle attendue entre Lobby existant et nouveaux écrans
- Spec DS Wave 1 cohérente avec l'état réel du codebase

---

## 5. Roadmap des waves suivantes

### Wave 1.5 — DS Catalogue + Niveau 2 refacto

**Trigger** : après livraison Replay Hub, avant rework Viewer.

**Effort estimé** : 6-8h

**Contenu** :
- Page `/dev/ds` (Angular) qui rend tous les partials avec leurs variants — devient le **catalogue exécutable**
- Migration des 56 hex hardcodés dans `front/src/app/pages/**/*.scss` vers tokens
- Audit des 46 `!important` : retirer ceux qui ne sont pas des overrides Material
- Décommissionnement progressif des vieux tokens (`--accent-primary` = `--gold`, `--surface-card-ds` vs `--surface-card`, `--text-secondary` vs `--text-muted`) — choisir UN nom, alias l'autre

### Wave 2 — Componentisation Angular + outils

**Trigger** : au 3ème écran refondu (deck-builder ou simulator probable), quand chaque partial a ≥3 consommateurs réels (rule of three).

**Effort estimé** : 15h

**Contenu** :
- Extraction des composants Angular :
  - `<app-page-header>` (avec slots back/center/actions)
  - `<app-section-header>` (avec slots count/action)
  - `<app-button>` (wrap `<button>` + Material ripple si besoin)
  - `<app-chip>` + `<app-chip-group>`
  - `<app-pill>` + `<app-badge>` + `<app-result-pill>`
  - `<app-icon-button>`
  - `<app-stats-card>` (extracted du Hub si 2 consumers identifiés)
  - `<app-search-bar>` (unifier avec celui existant `components/search-bar/` qui sert pour les cards)
- Migration des composants existants `components/*` → `shared/*` selon convention
- Configuration `stylelint` + règles ("no hex outside tokens", "no !important outside material.scss")
- Documentation README `front/src/app/styles/README.md` + `front/src/app/shared/README.md`

### Wave 3 — Promotion tokens PvP/Solver → DS global

**Trigger** : opportuniste, lors d'un rework PvP/Solver.

**Effort estimé** : 4-6h

**Contenu** :
- Renommer `--pvp-radius-*` en alias des `--radius-*` DS
- Renommer `--pvp-timer-green` etc. en sémantique DS (`--state-success-strong`)
- Renommer `--solver-chip-*` en sémantique DS (`--tag-*`)
- Aucune casse — les anciens tokens restent comme `var(--pvp-radius-md, var(--radius-md))` (fallback) puis suppression dans une Wave ultérieure

---

## 6. Garde-fous d'invariance (critères de PR review)

Tout futur PR qui touche `front/src/app/styles/` doit respecter :

1. **Aucune nouvelle keyframe non préfixée `ds-`** (sauf composant Angular avec préfixe unique documenté)
2. **Aucun nouveau hex `#xxxxxx`** dans les partials Wave 1 (uniquement via tokens `_tokens.scss`)
3. **Aucun `!important` ajouté** sauf dans `material.scss` ou avec commentaire `// !important: override Material XXX`
4. **Aucun `z-index: <nombre>`** dans les partials Wave 1 (via `_z-layers.scss`)
5. **Aucune classe BEM en simple-tiret** dans les nouveaux composants (`.btn--primary` ✅, `.btn-primary` ❌)
6. **Aucun nouveau bloc `@media (prefers-reduced-motion)`** global (utiliser `@include respect-reduced-motion` ou la globale `_a11y.scss`)
7. **Aucune nouvelle règle `*:focus-visible`** ou `:focus-visible` redéclarée sauf justification
8. **Aucun nouveau `@media (prefers-color-scheme)`** (dark-only verrouillé DS-D7)
9. **Aucun `@import` Sass** ajouté — uniquement `@use`
10. **Aucun layout (`display: grid`, `grid-template-*`, `flex-direction`) dans `_card-surface.scss`** (apparence uniquement)
11. **Aucun token nouveau dans un partial** — toujours ajouter dans `_tokens.scss` d'abord

---

## 7. Risques + mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Keyframe `ds-skel-sweep` casse les composants skel existants | Moyenne | Déplacer la déclaration dans `_motion.scss`, garder `skel.scss` comme consommateur. Test screenshot avant/après. |
| Migration `@import` → `@use` casse des interpolations `#{$var}` | Moyenne | Audit grep `#{$` dans tous les SCSS du projet avant migration. Tester en CI. |
| Alias 1-semaine traîne au-delà du commit 3 (oubli de suppression) | Faible | Date butoir documentée + commit 3 conditionné à grep zéro |
| `.pvp-dialog-panel` consommé par des dialogs qu'on n'a pas vu | Moyenne | Grep exhaustif AVANT déplacement. Tester chaque dialog Material visible. |
| Migration lobby casse les e2e existants | Moyenne | Période de coexistence (DS-D6) + e2e run avant/après commit 1, 2, 3 |
| `_a11y.scss` reduced-motion global trop agressif (casse une animation critique) | Faible | Tester avec DevTools "Emulate prefers-reduced-motion: reduce" sur lobby, hub, duel-page. Utiliser `@include respect-reduced-motion` pour cas custom. |
| Refacto Niveau 1 fait dériver le scope (envie de faire Niveau 2) | Moyenne | Discipline : tout ce qui n'est pas dans §3.1-3.7 est différé Wave 1.5. Critère de revue strict. |
| `.empty-state__cta` cassé pendant alias | Faible | Tester empty state lobby + hub explicitement |

---

## 8. Décisions ouvertes (à acter avant Wave 2)

Liste des questions non tranchées Wave 1, à traiter en Wave 1.5 ou Wave 2 :

1. **Containment Queries** — adopter à partir de quels composants ? Décider lors du premier composant qui en a vraiment besoin (probable : `_section-header.scss` si nested dans modal vs page).
2. **Stylelint** — config minimale Wave 2 (no-hex-outside-tokens, no-!important) — décision à acter Wave 2 quand on a 30+ partials.
3. **Storybook vs page `/dev/ds`** — page Angular interne moins lourde, mais moins isolée. Décision Wave 1.5.
4. **Icon family** — Material Icons Round (mockups) vs Material Symbols Outlined (`<mat-icon>` default Angular). Audit visuel à faire pour décider — tracker en `decision-open-icon-family-2026-05-14`.
5. **Print stylesheet** — v1 `body { display: none }`. Reconsidérer si un user demande "imprimer ma deck list".
6. **Container queries vs media queries** — convention DS-D8 dit "recommandé pour composants partagés". À promouvoir en règle dure ou laisser au case-by-case ?

---

## 9. Annexes

### A1. Tokens manquants à ajouter à `_tokens.scss` (si besoin)

Audit 2026-05-14 : tous les tokens nécessaires aux 12 partials Wave 1 sont **déjà présents** dans `_tokens.scss`. Aucun ajout requis.

**Cas marginal** : si besoin d'un `--success-strong` (pour pill celebrated), ajouter au passage.

### A2. Vue grep "santé du DS" — commandes de monitoring

À exécuter en fin de Phase F0 pour vérifier l'invariance :

```bash
# Hex en dehors de tokens.scss
grep -rn '#[0-9a-fA-F]\{6\}\b' front/src/app/styles/ | grep -v _tokens.scss

# !important hors material.scss
grep -rn '!important' front/src/app/styles/ | grep -v material.scss

# Keyframes non-préfixées dans styles/
grep -rn '@keyframes [a-zA-Z][a-zA-Z-]*' front/src/app/styles/ | grep -v 'ds-'

# Classes BEM simple-tiret (à reviewer)
grep -rn '\.btn-[a-z]\|\.pill-[a-z]\|\.chip-[a-z]\|\.icon-btn-[a-z]' front/

# z-index hardcodé dans les partials
grep -rn 'z-index: [0-9]' front/src/app/styles/
```

Cible : tous retournent **vide** (sauf exceptions documentées) après Phase F0.

### A3. Sources de référence

- [memory:project_design_system_strategy](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_design_system_strategy.md) — Doctrine globale DS
- [memory:project_skeleton_screens_convention](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_skeleton_screens_convention.md) — Skeletons
- [memory:project_ghost_scrollbar_convention](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_ghost_scrollbar_convention.md) — Scrollbar
- [memory:project_responsive_strategy](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_responsive_strategy.md) — Responsive
- [memory:project_modern_ux_patterns](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_modern_ux_patterns.md) — Patterns UX 2026
- [replay-hub-rework-2026-05-14.md](./replay-hub-rework-2026-05-14.md) — Premier consommateur Wave 1
- [_mockups/mockup-replay-hub.html](../../_mockups/mockup-replay-hub.html) — Hub HiFi
- [_mockups/mockup-replay-viewer.html](../../_mockups/mockup-replay-viewer.html) — Viewer HiFi
- [_mockups/mockup-1-holo-arena.html](../../_mockups/mockup-1-holo-arena.html) — Lobby HiFi (shipped)

---

**Document maintenu par** : Sally (UX Designer) + Axel
**Dernière mise à jour** : 2026-05-14 (création initiale post-review adversariale, 20 points adressés)
**Statut** : APPROVED — Niveau 1 strict scope, Spec autonome (DS-D1, DS-D2)
