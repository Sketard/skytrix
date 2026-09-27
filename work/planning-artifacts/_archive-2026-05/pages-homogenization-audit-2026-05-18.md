---
title: Pages Homogenization — Audit & Roadmap
author: Sally (UX Designer)
date: 2026-05-18
status: ready-for-validation
scope: front/src/app/pages/* + composants partagés DS à extraire
related: project_design_system_strategy, project_replay_hub_rework_2026_05_14, deck-list-alignment-spec-2026-05-18
---

# Pages Homogenization — Audit transversal & Roadmap d'extraction DS

## Pourquoi maintenant

Toutes les pages ont eu leur refonte DS Wave 1 → 3 (Login refresh, Lobby rework, Replay Hub rework, Replay Viewer rework, Wave 3 duel refresh, Card Search mobile audit en cours). Plusieurs patterns récurrents apparaissent maintenant clairement — le moment idéal pour extraire des composants partagés et homogénéiser. **Référence retenue : Replay Hub**, identifiée comme la page la plus aboutie (analyse 2026-05-18).

## Méthode

1. Audit des 11 pages contre **8 patterns Hub-référence** + 3 décorations DS canoniques.
2. Identification des **composants partagés à extraire**.
3. Check-list "niveau Hub" applicable selon catégorie de page.
4. Roadmap d'extraction en **3 waves** ordonnées par effet de levier.

---

## Catégorisation des 11 pages

### Catégorie A — Pages d'index (5)
Header + stats/info + liste/grille + filtres. La check-list Hub s'applique pleinement.

| Page | Statut DS |
|---|---|
| `replay-hub-page` | 🟢 Référence |
| `lobby-page` | 🟢 Niveau Hub |
| `deck-list` (sous `deck-page`) | 🟡 Spec en cours (deck-list-alignment-2026-05-18) |
| `card-search-page` | 🟡 Spec en cours (card-search-mobile-audit-2026-05-18) |
| `solver-page` | 🔴 Pas DS-conforme (R&D paused, à acter) |

### Catégorie B — Pages "édition" (3)
Workflow utilisateur centré sur un canvas/board. Header DS pertinent, mais pas de stats/filtres/liste.

| Page | Statut DS |
|---|---|
| `deck-builder` (sous `deck-page`) | 🟡 Hérite du shell deck-page + screen-bg, mais structure éditeur spécifique |
| `simulator-page` | 🔴 Pas DS-conforme (canvas scaling spécifique, hérité legacy) |
| `duel-page` | 🟢 Refondu Wave 3 (board + chrome) |

### Catégorie C — Pages "paramètres / authent" (2)
Layout simple, header + sections empilées. Sous-ensemble Hub applicable.

| Page | Statut DS |
|---|---|
| `parameter-page` | 🟢 DS-conforme (refresh 2026-05-16) |
| `preferences-page` | 🟢 DS-conforme (Wave 3 livraison) |

### Catégorie D — Pages "spéciales" (1)
Identité visuelle propre, hors DS standard.

| Page | Statut DS |
|---|---|
| `login-page` | 🟢 Refondu Card Constellation 2026-05-16 |

### Pages techniques hors scope direct
- `deck-page` : router shell (contient deck-list ou deck-builder selon route), pas de chrome propre
- `replay-page` : viewer board fullscreen, mode immersif sans header DS — légitime

---

## Audit matrice (11 pages × 8 patterns Hub + 3 décorations)

### Légende
- 🟢 conforme  · 🟡 partiel · 🔴 absent · ⚫ non applicable

### Tableau

| Page | screen-bg | page-header | Store dédié | search+filter+sort | section-header + count | États (loading/error/empty/no-results) | Skeleton DS | Mobile restructure | Empty-state component | Error-banner DS | Confirm-dialog destructif |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **replay-hub** | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 (4 états) | 🟢 | 🟢 | 🟡 inline partial | ⚫ | 🟢 |
| **lobby** | 🟢 | 🟢 | 🟢 | 🟡 (search+sort, pas filter) | 🟢 | 🟡 (loading + empty, pas error UI dédié) | 🟢 | 🟡 | 🟡 inline partial | 🟢 | 🟢 |
| **deck-list** | 🟢 | 🟢 | 🔴 | 🟡 (search only) | 🔴 | 🔴 (welcome + no-match italique) | 🟡 (skel décomposé) | 🔴 | 🟡 partial usage | ⚫ | 🟢 |
| **card-search** | 🟢 | 🟢 | 🔴 (split serveur+ filtres) | 🟢 (search + chips + favorites) | 🔴 | 🟡 | 🔴 | 🟡 (spec en cours) | 🔴 | ⚫ | ⚫ |
| **solver-page** | 🔴 | 🔴 | 🟡 (SolverService partagé) | ⚫ | ⚫ | 🟡 | 🔴 | 🔴 (desktop-only) | 🔴 | 🔴 | ⚫ |
| **parameter** | 🟢 | 🟢 | 🟡 (state inline OK pour scope) | ⚫ | 🟡 (sections sans count) | 🟡 (job-by-job status) | 🟡 | 🟢 | ⚫ | ⚫ | ⚫ |
| **preferences** | 🟢 | 🟢 | 🟡 | ⚫ | 🟡 | ⚫ | ⚫ | 🟢 | ⚫ | ⚫ | ⚫ |
| **login** | 🟡 (constellation custom) | 🟡 (logo custom, no page-header) | ⚫ | ⚫ | ⚫ | 🟡 (form errors) | ⚫ | 🟢 | ⚫ | 🟡 inline | ⚫ |
| **deck-builder** | 🟢 (hérite shell) | 🔴 (édition, no page-header) | 🟡 (DeckBuildService) | ⚫ | ⚫ | 🟡 | 🟡 | 🟡 | ⚫ | ⚫ | 🟢 |
| **duel-page** | ⚫ (board immersif) | ⚫ | 🟢 (DuelConnection) | ⚫ | ⚫ | 🟢 (loading + end) | ⚫ | 🟢 | ⚫ | ⚫ | 🟢 |
| **replay-page** | ⚫ | ⚫ (topbar custom) | 🟡 | ⚫ | ⚫ | 🟢 (loading skeleton + end) | 🟢 | 🟢 | ⚫ | ⚫ | 🟢 (delete) |

### Observations clés

1. **screen-bg + page-header sont presque universels** (catégories A+C) — déjà bien standardisé.
2. **Store dédié** : seulement 2 pages (hub + lobby) sur 5 candidats. Manque criant sur deck-list, card-search, solver.
3. **États empty/error/no-results** : seulement le hub a la trinité complète. Lobby a un error-banner intégré mais pas d'empty-state dédié. Les autres ont du **partial** ou rien.
4. **`<app-empty-state>` existe mais est sous-spec'd** : il manque `variant: 'error' | 'no-results' | 'rich'`, `descKey`, `ctaAction`. → 4 pages inline le partial CSS au lieu d'utiliser le composant.
5. **`<app-error-banner>` existe** mais n'est utilisé que par lobby. Login devrait l'utiliser pour ses erreurs de form.
6. **Mobile restructure** : seulement hub + duel-page + preferences ont vraiment restructuré (pas juste shrink) — c'est le pattern le plus difficile à transférer parce qu'il demande de re-penser le grid par viewport.

---

## Check-list "niveau Hub" applicable par catégorie

### Catégorie A — Pages d'index (5)
**Cible** : toutes les colonnes du tableau doivent être 🟢.

1. ✅ `screen-bg` + `screen-bg-grid` + `screen-bg-glow--gold` + `screen-bg-glow--cyan`
2. ✅ `<header class="page-header">` avec `__title-group` (icon-wrap optionnel) + `__title` `text-gold-gradient` + `__subtitle`
3. ✅ Store dédié `@Injectable()` providé au scope component, contenant : signals state, computed `filteredItems`/`stats`, méthodes async avec rollback optimiste
4. ✅ Trio **search + filter + sort** ortho : `<label class="search-bar">` + `<div class="chip-row">` + `<button matMenuTriggerFor>`. Tous peuvent être ⚫ si non-pertinent (justifier dans le code).
5. ✅ `<div class="section-header">` avec title + `<span class="badge badge--gold">` count + sort button
6. ✅ 4 états distincts : loading skeleton, error empty-state, empty empty-state, no-results empty-state (chacun avec icon + title + desc + CTA si action possible)
7. ✅ Skeleton DS (`<app-replay-card-skeleton>`-style) avec **sentinel inline** si pagination
8. ✅ Mobile restructure : grids différents par breakpoint (`mobile-portrait`, `respond-below($bp-pvp-narrow)`), pas juste shrink

### Catégorie B — Pages "édition" (3)
**Cible** : sous-ensemble pertinent pour un canvas/workflow.

1. ✅ `screen-bg` (ou équivalent immersif comme duel-page)
2. ⚫/✅ `page-header` ou `topbar` custom (duel-page, deck-builder) — pas obligatoire mais doit suivre le DS
3. ✅ Store dédié ou service partagé bien isolé
4. ⚫ search/filter/sort non applicable
5. ⚫ section-header non applicable
6. ✅ États loading/error pour les async opérations
7. ✅ Skeleton DS pour le chargement initial
8. ✅ Mobile restructure si workflow tactile

### Catégorie C — Pages "paramètres"
**Cible** : header DS + sections empilées propres.

1. ✅ `screen-bg`
2. ✅ `page-header`
3. ⚫ Store optional (state local peut suffire si simple)
4. ⚫ search/filter/sort non applicable
5. ✅ `section-header` répété par bloc de paramètres
6. ✅ États error per-job (parameter-page le fait bien avec status-pills)
7. ⚫
8. ✅ Mobile : sections empilées, plein-largeur (déjà OK)

---

## Composants partagés DS à extraire (proposés)

### Priorité 1 — Extraction immédiate (gros levier, peu de risque)

#### `<app-empty-state>` ENRICHI (refonte du composant existant)

**État actuel** : `variant: 'default' | 'welcome'`, props `message`, `subtitle`, `ctaLabel`, `ctaLink`, `icon`. CTA navigue via `routerLink` seulement.

**Cible** :
```ts
export type EmptyStateVariant = 'default' | 'welcome' | 'error' | 'no-results' | 'rich';

@Component({ ... })
export class EmptyStateComponent {
  readonly variant      = input<EmptyStateVariant>('default');
  readonly icon         = input.required<string>();
  readonly titleKey     = input.required<string>();  // i18n key
  readonly descKey      = input<string>();           // i18n key
  readonly ctaLabel     = input<string>();           // i18n key
  readonly ctaIcon      = input<string>();
  readonly ctaLink      = input<string>();           // navigation
  readonly ctaAction    = output<void>();            // alt: imperative callback
}
```

**Bénéfice** : hub + lobby + deck-list + card-search peuvent tous le consommer. Suppression du 4× duplication du partial CSS inline. ~30-50 lignes de SCSS gagnées par page consommatrice.

**Effort** : ~1h30 (refactor + adaptation 4 sites consommateurs + tests).

#### `<app-section-header>` (extraction nouveau)

Aujourd'hui `_section-header.scss` est un partial CSS consommé via classes. À factoriser comme composant utilisable partout :

```ts
@Component({
  selector: 'app-section-header',
  template: `
    <div class="section-header__title-group">
      @if (icon()) { <mat-icon class="section-header__icon">{{ icon() }}</mat-icon> }
      <span class="section-header__title">{{ titleKey() | translate }}</span>
      @if (count() !== null) {
        <span class="badge badge--gold">{{ countKey() | translate: { count: count() } }}</span>
      }
    </div>
    <ng-content></ng-content>
  `,
})
export class SectionHeaderComponent {
  readonly titleKey  = input.required<string>();
  readonly icon      = input<string>();
  readonly count     = input<number | null>(null);
  readonly countKey  = input<string>('common.count');
}
```

**Bénéfice** : hub + lobby + parameter + preferences + (deck-list ajouté) consomment la même API. Le contenu projeté (`<ng-content>`) accueille les sort buttons / actions à droite.

**Effort** : ~1h.

#### `<app-stats-strip>` (extraction nouveau, factorise hub-stats + deck-stats-strip)

```ts
export interface StatItem {
  icon: string;
  iconVariant: 'cyan' | 'gold' | 'neutral' | 'warning' | 'danger';
  value: string | number;
  labelKey: string;
  valueVariant?: 'default' | 'gold' | 'muted';
  surfaceAccent: 'cyan' | 'gold' | 'neutral' | 'warning' | 'danger';
}

@Component({ selector: 'app-stats-strip', ... })
export class StatsStripComponent {
  readonly stats          = input.required<StatItem[]>();
  readonly compactBelow   = input<number>(480);  // px — restructure en strip monobloc en dessous
  readonly hideOnCompactLandscape = input<boolean>(true);
}
```

Restructure mobile gérée par le composant : grid → container monobloc compact.

**Bénéfice** :
- Hub : 4 stats. Migration des `.hub-stat-card` inline.
- Deck-list : 3 stats. Plus besoin du composant `deck-stats-strip` actuel.
- Futures pages (Cards favorites, History, etc.) auront le pattern out-of-the-box.

**Effort** : ~2h (composant + migration hub + migration deck-list).

### Priorité 2 — Extraction structurelle (gros levier mais touche tous les sites)

#### `<app-page-shell>` (template wrapper pour catégories A et C)

```html
<app-page-shell
  [titleKey]="'replay.hub.title'"
  [subtitleKey]="'replay.hub.subtitle'"
  icon="play_circle"
  [iconVariant]="'gold'"
  (backNav)="goToLobby()">
  <!-- contenu projeté : stats, filters, list, etc. -->
</app-page-shell>
```

Le shell fournit : `screen-bg` complet, `page-header` complet, container max-width + padding fluid, gestion auto du back-button mobile (cf. lobby ll. 46-62 pattern d'override). Wave 1.5 a déjà standardisé l'apparence — le composant capture la **structure** pour qu'aucune page ne réinvente.

**Bénéfice** : 8 pages perdent leur boilerplate screen-bg + header répétitif. Réduit ~30-50 lignes HTML + ~20 lignes SCSS par page.

**Risque** : refactor invasif, à valider après livraison des Priorités 1.

**Effort** : ~3-4h (composant + migration progressive 8 pages).

#### `<app-list-store>` (mixin TypeScript / classe abstraite générique)

Pas vraiment un composant — plutôt une **classe abstraite** que `ReplayHubStore`, `LobbyRoomsStore`, futur `DeckListStore`, futur `CardSearchStore` étendent :

```ts
export abstract class ListStore<T, FilterMode, SortMode> {
  abstract readonly items: WritableSignal<T[]>;
  abstract readonly loading: WritableSignal<boolean>;
  abstract readonly error: WritableSignal<string | null>;

  readonly searchQuery = signal('');
  readonly activeFilter: WritableSignal<FilterMode>;
  readonly sortMode: WritableSignal<SortMode>;

  readonly hasSearchActive = computed(() => this.searchQuery().length > 0);
  readonly showEmptyState = computed(() => /* canonical */);
  readonly showNoResultsState = computed(() => /* canonical */);

  abstract readonly filteredItems: Signal<T[]>; // implémente le filter + sort

  setSearchQuery(q: string): void { this.searchQuery.set(q); }
  clearSearch(): void { this.searchQuery.set(''); }
  clearFilters(): void { /* reset filter + sort */ }
  // ...
}
```

**Bénéfice** : la "formule store" est codifiée, pas dupliquée mentalement entre devs. Garde-fou contre la dérive (un futur store qui oublie `showNoResultsState` sera rappelé à l'ordre par la classe).

**Effort** : ~2h (classe + refonte hub + lobby pour hériter + tests parité).

### Priorité 3 — Polish & cohérence (effet de levier modeste, pas urgent)

#### `<app-back-fab>` (FAB de back mobile, pour catégorie B immersive)

Replay-page (l. 22-28) + duel-page (probable) ont chacun leur FAB de back custom. À factoriser.

**Effort** : ~30 min.

#### `<app-skeleton-list>` (wrapper standardisé pour `*[count]` skeletons)

Aujourd'hui chaque page importe `<app-replay-card-skeleton>` ou `<app-deck-box-skeleton>` ou `<app-deck-stats-strip-skeleton>` avec son propre count. Un wrapper générique avec slot template clarifierait :

```html
<app-skeleton-list [count]="4">
  <ng-template>
    <app-replay-card-skeleton />
  </ng-template>
</app-skeleton-list>
```

Pas urgent. Effort : ~1h.

---

## Roadmap d'extraction — 3 Waves

### Wave A — Composants partagés Priorité 1 (~5h, autonome)

Objectif : extraire les 3 composants à gros levier sans toucher aux pages "broken" (deck-list, card-search restent pour leurs specs respectives).

1. **`<app-empty-state>` enrichi** (~1h30)
2. **`<app-section-header>`** (~1h)
3. **`<app-stats-strip>`** (~2h, intègre migration hub + future deck-list)
4. **Tests parité visuelle** (hub + lobby + parameter inchangés visuellement après migration des composants existants)

**Livre** : 3 composants DS canoniques. Doc d'usage dans `front/src/app/components/<name>/README.md` ou dans `CLAUDE.md`. Pages consommatrices : hub, lobby, parameter, preferences (consomment progressivement).

### Wave B — Pages "broken" alignement Hub (~14h, sériel)

Une fois la Wave A livrée, les specs en cours peuvent consommer les nouveaux composants :

1. **deck-list** — spec deck-list-alignment-spec-2026-05-18 (~8h30 — révisée avec composants partagés Wave A)
2. **card-search-page** — spec card-search-mobile-audit-spec-2026-05-18 (~5h)
3. **solver-page audit** — à décider (R&D paused) : soit on l'aligne DS minimalement (screen-bg + page-header), soit on l'accepte comme outil expert hors DS. **Question à Axel.**

### Wave C — Extraction structurelle Priorité 2 (~6h, optionnel)

À valider après Wave B :

1. **`<app-page-shell>`** (~3-4h, migration progressive 8 pages)
2. **`ListStore<T>` abstract** (~2h, refonte hub + lobby + futurs stores)

Cette Wave est optionnelle — le bénéfice est de la **codification** du pattern Hub pour les futures pages (Cards favorites, archive, etc.). Si tu prévois peu de nouvelles pages, skip ou repousser.

### Wave D — Polish Priorité 3 (~1h30, plus tard)

- `<app-back-fab>` 
- `<app-skeleton-list>` template wrapper

---

## Effort total

| Wave | Effort | Type |
|---|---|---|
| A — Composants Priorité 1 | ~5h | Autonome (commence quand tu veux) |
| B — Pages broken (deck-list + card-search + solver) | ~14h | Sériel post-A |
| C — Extraction structurelle | ~6h | Optionnel post-B |
| D — Polish | ~1h30 | À glisser quand l'occasion se présente |
| **Total max** | **~26h30** | |

Si on skip Wave C : ~19h30. Si on skip Wave D aussi : ~19h.

---

## Décisions actées par Axel (2026-05-18)

1. ✅ **Wave A en premier** — confirmé.
2. ✅ **Solver-page = HORS SCOPE** — accepté comme outil expert R&D paused. La cellule 🔴 du tableau reste informative, aucune action prévue.
3. ✅ **Wave C — extraction structurelle FAITE** (pas optionnelle). `<app-page-shell>` + `ListStore<T>` codifient le pattern pour les futures pages d'index.
4. ✅ **Doc DS** : étendre `docs/component-inventory-front.md` avec une section dédiée par nouveau composant DS (API + exemple d'usage + écrans consommateurs). Pas de nouveau fichier — on évite la fragmentation. La doc foundationnelle reste `ds-wave-1-spec-2026-05-14.md`.

## Conséquences sur la roadmap

- **Wave B** retire le solver de son scope → ~13h au lieu de ~14h (récup les 1h prévues pour solver).
- **Wave C n'est plus optionnel** → tjs ~6h, planifiée après Wave B.
- **Wave D** maintenue à ~1h30, après Wave C.
- **Total révisé : ~25h30**.

## Plan de doc consolidé

Chaque livraison de composant DS (Wave A + C) doit s'accompagner :
- Section nouvelle dans `docs/component-inventory-front.md` (API + usage + consommateurs)
- Lien depuis `ds-wave-1-spec-2026-05-14.md` (référence canonique amont)
- Memory ponctuel si décision d'API non-évidente ([[ds-component-name-decisions]])

---

## Annexe — Pattern "Page niveau Hub" codifié

À ajouter à `CLAUDE.md` une fois validé (section "DS Page Patterns") :

```markdown
## DS Page Patterns — Category A (Index pages)

Toute nouvelle page d'index (listing avec stats + filtres) doit consommer :

- `<app-page-shell [titleKey] [subtitleKey] icon>` (Wave C, sinon HTML manuel screen-bg + page-header)
- `<app-stats-strip [stats]>` pour stats KPI horizontales avec icon ronde + accent
- `<app-section-header [titleKey] [count]>` au-dessus de la liste, contenu projeté pour sort/actions
- `<label class="search-bar">` (partial DS)
- `<div class="chip-row">` (partial DS) si filtre par mode
- `<button matMenuTriggerFor>` pour sort
- `<app-empty-state variant>` pour les 4 états canoniques
- Store dédié héritant de `ListStore<T, FilterMode, SortMode>` (Wave C)
- Restructure mobile via `mobile-portrait` ou `respond-below($bp-pvp-narrow)`
```
