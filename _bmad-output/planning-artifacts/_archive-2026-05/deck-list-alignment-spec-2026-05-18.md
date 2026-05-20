---
title: Deck List — Alignement DS avec Replay Hub
author: Sally (UX Designer)
date: 2026-05-18
status: ready-for-implementation
scope: front/src/app/pages/deck-page/components/deck-list + front/src/app/components/deck-stats-strip
related: project_design_system_strategy, project_replay_hub_rework_2026_05_14, card-search-mobile-audit-spec-2026-05-18
---

# Deck List — Alignement DS avec Replay Hub

## TL;DR

La page **Deck List** est moins élégante que le **Replay Hub** sur plusieurs axes alors qu'elles partagent la même fonction structurelle (page d'index + stats + liste/grille d'éléments). Replay Hub a été refondu DS en mai 2026, Deck List est resté en arrière. Objectif : aligner Deck List sur le pattern Hub tout en gardant ses spécificités (grille de deck-boxes au lieu d'une liste de cards, pas autant de filtres possibles).

**Direction : Deck List adopte la maturité DS du Hub (stats riches, section-header + count + tri, états DS) tout en gardant sa grille visuelle de deck-boxes (qui elle est déjà bien soignée).**

---

## Cartographie des écarts

| Axe | Replay Hub (référence) | Deck List (actuel) | Verdict |
|---|---|---|---|
| **Icon header** | Icon nue dans `.page-header__icon` | `.deck-list__icon-wrap` 44×44 gold avec drop-shadow | 🟢 Deck List meilleur → **Hub à mettre à jour plus tard** |
| **Stats strip** | 4 cards `surface-card--accent-*` + icon ronde 38px + valeur + label, layout horizontal | 3 items plats verticaux sans icône, sans accent, `--surface-card-low` neutre | 🔴 Deck List **bien en retard** |
| **Search + filtres** | Search-bar + chip-row (4 modes) + sort menu | Search-bar uniquement | 🟡 Decks ont moins d'axes filtre, mais tri et filtre légalité manquent |
| **Section-header** | `.section-header` avec title + badge gold count + sort button | Aucun — la grille démarre directement | 🔴 Manque |
| **Count badge** | Badge gold "12 replays" | Aucun feedback du nombre filtré | 🔴 Manque |
| **Empty no-match** | `<app-empty-state>` avec icon, title, desc, CTA "Effacer filtres" | Texte italique gris centré | 🔴 Sous-spec |
| **État error** | Empty-state avec retry CTA | N/A (le service fetch silencieusement) | 🟡 Probablement OK (decks récup synchronement local) |
| **Skeleton** | `<app-replay-card-skeleton count=4>` + sentinel inline | `<app-deck-stats-strip-skeleton>` + `<app-deck-box-skeleton>` | 🟢 Parité |
| **Items** | `replay-card` grid horizontal avatar/info/pill/meta/actions, hover-reveal gold "Open" pill | `deck-box` carré gradient + gold rail + 3-card fan-out on hover | 🟢 Tous deux soignés, **différents par essence** |

---

## Direction UX — Deck List 2.0

### 1. Stats Strip — refonte intégrale

**Avant** (deck-stats-strip.component) :
```
┌──────────┐ ┌──────────┐ ┌──────────┐
│   12     │ │   847    │ │    9     │
│  DECKS   │ │  CARTES  │ │ LÉGAUX   │
└──────────┘ └──────────┘ └──────────┘
```

**Après** (pattern Hub adopté) :
```
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ ⬢ 📁     12          │ │ ⬢ 🎴     847         │ │ ⬢ ✓      9           │
│        DECKS         │ │      CARTES POSSÉDÉES│ │      DECKS LÉGAUX    │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
   accent-cyan              accent-gold              accent-gold
```

#### Composant : `<app-deck-stats-strip>` refondu

**Type `DeckStat` étendu** :
```ts
export interface DeckStat {
  label: string;          // i18n key — ex: 'deckStats.decks'
  value: number | string; // ex: 12 ou '67%'
  icon: string;           // material icon name — ex: 'folder_special'
  iconVariant: 'cyan' | 'gold' | 'neutral'; // controls icon bg + color
  valueVariant?: 'gold' | 'muted';          // optional value tinting
  surfaceAccent: 'cyan' | 'gold' | 'neutral' | 'warning' | 'danger';
}
```

**Mapping deck-list** (3 stats) :
| Stat | Icon | iconVariant | valueVariant | surfaceAccent |
|---|---|---|---|---|
| Decks | `folder_special` | cyan | (none → default) | `cyan` |
| Cartes possédées | `style` | gold | `gold` | `gold` |
| Decks légaux | `check_circle` | gold | `gold` | `gold` |

**HTML template** :
```html
<div class="deck-stats-strip" role="list">
  @for (stat of stats(); track stat.label) {
    <div class="surface-card deck-stats-strip__item"
         [class.surface-card--accent-cyan]="stat.surfaceAccent === 'cyan'"
         [class.surface-card--accent-gold]="stat.surfaceAccent === 'gold'"
         [class.surface-card--accent-neutral]="stat.surfaceAccent === 'neutral'"
         role="listitem">
      <span class="deck-stats-strip__icon"
            [class.deck-stats-strip__icon--cyan]="stat.iconVariant === 'cyan'"
            [class.deck-stats-strip__icon--gold]="stat.iconVariant === 'gold'"
            [class.deck-stats-strip__icon--neutral]="stat.iconVariant === 'neutral'">
        <mat-icon>{{ stat.icon }}</mat-icon>
      </span>
      <div class="deck-stats-strip__content">
        <span class="deck-stats-strip__value"
              [class.deck-stats-strip__value--gold]="stat.valueVariant === 'gold'"
              [class.deck-stats-strip__value--muted]="stat.valueVariant === 'muted'">
          {{ stat.value }}
        </span>
        <span class="deck-stats-strip__label">{{ stat.label | translate }}</span>
      </div>
    </div>
  }
</div>
```

**SCSS aligné** :
```scss
.deck-stats-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;        // mobile = 2 cols
  gap: var(--space-3);

  @media (min-width: 720px) {            // tablet+ = 3 cols
    grid-template-columns: repeat(3, 1fr);
  }

  // Hide on landscape compact (same rule as hub)
  @media (orientation: landscape) and (max-height: 500px) {
    display: none;
  }
}

.deck-stats-strip__item {
  display: flex;                          // horizontal layout
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  min-width: 0;
}

.deck-stats-strip__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;

  mat-icon {
    font-size: 20px !important;
    width: 20px !important;
    height: 20px !important;
  }
}

.deck-stats-strip__icon--cyan    { background: var(--cyan-soft-15);     color: var(--cyan-300); }
.deck-stats-strip__icon--gold    { background: var(--gold-soft-12);     color: var(--gold); }
.deck-stats-strip__icon--neutral { background: var(--surface-overlay);  color: var(--text-muted); }

.deck-stats-strip__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-1);
}

.deck-stats-strip__value {
  font: var(--weight-bold) var(--text-xl) / var(--line-tight) var(--font-display);
  letter-spacing: 0.02em;
  color: var(--text-primary);
}
.deck-stats-strip__value--gold  { color: var(--gold-50); }
.deck-stats-strip__value--muted { color: var(--text-secondary); }

.deck-stats-strip__label {
  font: var(--weight-semibold) var(--text-xs) / 1 var(--font-body);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
```

**Convergence** : ce composant peut remplacer `.hub-stat-card` inline du hub plus tard (factorisation Wave 2). Pour ce chantier, on garde les deux séparés — le hub n'a pas besoin d'être touché.

#### Skeleton

Mettre à jour `<app-deck-stats-strip-skeleton>` pour matcher le nouveau layout (icône ronde + content vertical) au lieu du layout vertical actuel. Patience UX : keep le sweep 1.4s + même tokens couleur.

### 2. Section header + count + tri

Insérer **entre la stats-strip et la grille** un section-header DS, exactement comme le hub :

```html
<div class="section-header">
  <div class="section-header__title-group">
    <span class="section-header__title">{{ 'deckList.list.title' | translate }}</span>
    @if (!firstLoad) {
      <span class="badge badge--gold">
        {{ 'deckList.list.count' | translate: { count: filteredDecks().length } }}
      </span>
    }
  </div>
  <button type="button"
          class="btn btn--ghost btn--sm"
          [matMenuTriggerFor]="sortMenu">
    <mat-icon>sort</mat-icon>
    <span>{{ sortLabelKey() | translate }}</span>
  </button>
  <mat-menu #sortMenu="matMenu" xPosition="before">
    @for (mode of sortModes; track mode) {
      <button mat-menu-item type="button"
              [class.is-active]="sortMode() === mode"
              (click)="setSortMode(mode)">
        {{ 'deckList.sort.' + mode | translate }}
      </button>
    }
  </mat-menu>
</div>
```

**Modes de tri** (3 — décision Axel 2026-05-18) :

| Mode | Critère | Source |
|---|---|---|
| `recent` (par défaut) | `updatedAt` desc — modif la plus récente d'abord | 🔧 **À ajouter en back** (migration Flyway + entité + DTO) |
| `name` | Alphabétique A→Z sur `name` | ✅ `ShortDeck.name` |
| `legality` | Légaux d'abord puis invalides, secondaire alphabétique | ✅ `ShortDeck.valid` |

**État actuel du modèle** : l'entité `Deck` (back/.../entity/Deck.java) **n'a aucun timestamp** — ni `createdAt`, ni `updatedAt`. Ajout indispensable pour le tri "récent".

#### Migration back (Phase 0)

1. **Flyway migration** `back/src/main/resources/db/migration/V{n}__deck_timestamps.sql` :
```sql
ALTER TABLE deck
  ADD COLUMN created_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE;

-- Backfill : utiliser NOW() pour les decks existants (pas de meilleure info
-- disponible, l'historique précis est perdu — acceptable car non-critique).
UPDATE deck SET created_at = NOW(), updated_at = NOW() WHERE created_at IS NULL;

ALTER TABLE deck
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX idx_deck_updated_at ON deck (updated_at DESC);
```

2. **Entité `Deck.java`** : ajouter `@CreationTimestamp` + `@UpdateTimestamp` (Hibernate) :
```java
@CreationTimestamp
@Column(nullable = false, updatable = false)
private Instant createdAt;

@UpdateTimestamp
@Column(nullable = false)
private Instant updatedAt;
```

3. **`ShortDeckDTO`** : ajouter `updatedAt: string` (ISO-8601).
4. **`DeckMapper.toShortDeckDTO`** : propager `deck.getUpdatedAt().toString()`.

Coût : ~1h back + tests.

#### i18n keys

- `deckList.list.title` : FR `"Mes decks"`, EN `"My decks"`
- `deckList.list.count` : FR `"{{count}} decks"`, EN `"{{count}} decks"` (pluriel via icu si dispo, sinon string template)
- `deckList.sort.recent` : FR `"Récents"`, EN `"Recent"`
- `deckList.sort.name` : FR `"Nom"`, EN `"Name"`
- `deckList.sort.legality` : FR `"Légalité"`, EN `"Legality"`

### 3. Filter chips (optionnel — décision Axel)

Hub a 4 modes : all / mine / wins / losses. Deck-list pourrait avoir :

| Chip | Filtre |
|---|---|
| `all` | Tous |
| `legal` | Decks valides uniquement |
| `invalid` | Decks invalides uniquement |
| `favorite` | Decks favoris (si la feature existe — sinon skip) |

**Pertinence à challenger** : avec en moyenne 5-20 decks, les chips de filtre risquent d'être plus de bruit qu'utiles. À mon sens, **skip pour la v1 de l'alignement** — la search par nom + le tri couvrent 90% du besoin. Si Axel veut, on ajoute après usage réel.

### 4. Empty state "no match" — utiliser app-empty-state

**Avant** :
```html
@if (filteredDecks().length === 0) {
  <div class="deck-list__no-match">
    {{ 'deckList.noMatch' | translate }}
  </div>
}
```

**Après** (pattern Hub) :
```html
@if (filteredDecks().length === 0 && hasSearchActive()) {
  <div class="empty-state">
    <mat-icon class="empty-state__icon">search_off</mat-icon>
    <p class="empty-state__title">{{ 'deckList.noResults.title' | translate }}</p>
    <p class="empty-state__desc">{{ 'deckList.noResults.desc' | translate }}</p>
    <button type="button" class="btn btn--primary btn--lg btn--cta" (click)="clearSearch()">
      <mat-icon>backspace</mat-icon>
      {{ 'deckList.noResults.clearSearch' | translate }}
    </button>
  </div>
}
```

i18n keys :
- `deckList.noResults.title` : FR `"Aucun deck ne correspond"`, EN `"No matching decks"`
- `deckList.noResults.desc` : FR `"Essayez un autre nom ou créez un nouveau deck."`, EN `"Try another name or create a new deck."`
- `deckList.noResults.clearSearch` : FR `"Effacer la recherche"`, EN `"Clear search"`

### 5. Header — un détail mineur

L'icon-wrap gold de deck-list est déjà bien — on le **garde tel quel**. Note pour plus tard : étendre ce pattern au hub (qui a une icon nue actuellement). C'est l'inverse de ce chantier, hors-scope ici, à archiver.

### 6. Grille de deck-boxes — pas touchée

La deck-box elle-même est très soignée (gradient surface-card, gold rail, 3-card fan-out on hover, hover-lift). **Aucune intervention**. Si quelque chose paraît "terne" autour, c'est parce que l'entourage (stats + section-header absent) tire le set vers le bas. Une fois ces deux corrigés, la deck-box se trouve bien encadrée.

### 7. Mobile/responsive — vérifications

- **Stats** : 2 colonnes en mobile (comme hub). Hide en landscape compact (≤500px tall). ✅ déjà dans la spec ci-dessus.
- **Section-header** : DS partial gère sa propre responsivité. Le sort button reste icon-only en mobile via la cascade `.section-header` existante.
- **Search-bar + CTA** : actuellement `flex-wrap: wrap` dans `.deck-list__actions`. En mobile portrait, ça wrap déjà correctement. À vérifier dans la PR.

---

## Plan d'implémentation

### Phase 1 — Refonte `deck-stats-strip` (M)

1. **Étendre `DeckStat`** dans `deck-stats-strip.component.ts` avec `icon`, `iconVariant`, `valueVariant`, `surfaceAccent`.
2. **Refondre `deck-stats-strip.component.html`** selon le template ci-dessus (icon ronde + content vertical à droite).
3. **Refondre `deck-stats-strip.component.scss`** avec le layout horizontal + variantes icon/value.
4. **Adapter `deck-stats-strip-skeleton.component`** pour matcher le nouveau layout.
5. **Mettre à jour `DeckListComponent.stats` computed** pour fournir `icon`/`iconVariant`/`surfaceAccent` :
```ts
readonly stats = computed<Array<DeckStat>>(() => {
  const all = this.decksSignal();
  const ownedSum = Array.from(this.ownedCardService.ownedMap().values()).reduce((acc, n) => acc + n, 0);
  return [
    { label: 'deckStats.decks',       value: all.length,
      icon: 'folder_special', iconVariant: 'cyan', surfaceAccent: 'cyan' },
    { label: 'deckStats.cardsOwned',  value: ownedSum,
      icon: 'style',          iconVariant: 'gold', valueVariant: 'gold', surfaceAccent: 'gold' },
    { label: 'deckStats.legalDecks',  value: all.filter(d => d.valid).length,
      icon: 'check_circle',   iconVariant: 'gold', valueVariant: 'gold', surfaceAccent: 'gold' },
  ];
});
```

### Phase 0 — Migration back `updatedAt` (S, prérequis tri "récent")

1. **Flyway migration** `V{n}__deck_timestamps.sql` (cf. SQL ci-dessus).
2. **Entité `Deck.java`** : ajouter `@CreationTimestamp createdAt` + `@UpdateTimestamp updatedAt`.
3. **`ShortDeckDTO`** : ajouter `updatedAt: string` (ISO-8601).
4. **`DeckMapper.toShortDeckDTO`** : propager le champ.
5. **Tests back** : vérifier que `updatedAt` change après modification d'un deck (save + reload).
6. **Front DTO** : mettre à jour `short-deck-dto.ts` pour exposer `updatedAt: string`.

### Phase 2 — Section header + tri (M)

1. **Ajouter `sortModes`, `sortMode` signal, `setSortMode()`, `sortLabelKey()`** dans `DeckListComponent` (mirroring `replay-hub-page.component.ts`).
2. **Étendre `filteredDecks` computed** pour appliquer le tri sélectionné en plus du filtre par nom :
```ts
readonly sortMode = signal<'recent' | 'name' | 'legality'>('recent');
readonly sortModes = ['recent', 'name', 'legality'] as const;

readonly filteredDecks = computed<Array<ShortDeck>>(() => {
  const term = this.searchTerm() ?? '';
  const all = this.decksSignal();
  const filtered = term
    ? all.filter(d => formattedWithoutCaseAndAccent(d.name).includes(formattedWithoutCaseAndAccent(term)))
    : all;
  const mode = this.sortMode();
  const sorted = [...filtered];
  switch (mode) {
    case 'recent':   sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); break;
    case 'name':     sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); break;
    case 'legality': sorted.sort((a, b) => (Number(b.valid) - Number(a.valid)) || a.name.localeCompare(b.name)); break;
  }
  return sorted;
});
```
3. **Insérer le `<div class="section-header">`** dans le template entre la stats-strip et `.deckPage`.
4. **i18n** : ajouter 5 keys (title, count, sort.recent, sort.name, sort.legality) en FR + EN.

### Phase 3 — Empty state no-match (S)

1. **Remplacer `.deck-list__no-match`** par `<app-empty-state>` avec `search_off` + CTA `clearSearch`.
2. **Garder l'ancienne classe** comme fallback pour les tests, supprimer après green.
3. **i18n** : ajouter 3 keys (`noResults.title`, `noResults.desc`, `noResults.clearSearch`) en FR + EN.

### Phase 5 — DeckListStore extraction (M)

**Pourquoi** : `DeckListComponent` mélange aujourd'hui state UI (searchTerm, filteredDecks, sortMode à venir) avec des appels au `DeckBuildService` partagé (`decks$`, `fetchDecks()`, `deleteById`). Le hub a montré qu'extraire ces responsabilités dans un store dédié, providé au scope route, clarifie tout : composant = vue + bindings, store = state machine.

**Pattern** : mirror `ReplayHubStore`. Signature publique attendue :

```ts
@Injectable()
export class DeckListStore {
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly ownedCardService = inject(OwnedCardService);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly decks = signal<ShortDeck[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly sortMode = signal<DeckSortMode>('recent');

  readonly filteredDecks = computed(() => { /* filter + sort */ });
  readonly stats = computed<DeckStat[]>(() => { /* 3 stats avec icon/variant */ });
  readonly hasSearchActive = computed(() => this.searchQuery().length > 0);

  readonly showEmptyState = computed(() =>
    !this.loading() && !this.error() && this.decks().length === 0);
  readonly showNoResultsState = computed(() =>
    !this.loading() && !this.error()
    && this.decks().length > 0
    && this.filteredDecks().length === 0);

  start(): void { /* subscribe decks$ → decks signal */ }
  setSearchQuery(q: string): void { /* ... */ }
  setSortMode(m: DeckSortMode): void { /* ... */ }
  clearSearch(): void { /* ... */ }

  async deleteDeck(id: number): Promise<void> {
    // Optimistic delete with rollback on error (mirror replay-hub-store)
    const before = this.decks();
    this.decks.update(arr => arr.filter(d => d.id !== id));
    try {
      await firstValueFrom(/* deleteById HTTP call */);
      this.notify.success('success.DECK_DELETED');
    } catch (err) {
      this.decks.set(before); // rollback
      this.notify.error(err);
    }
  }
}
```

`DeckListComponent` provide le store : `providers: [DeckListStore]` au @Component.

### Phase 6 — Error state (S)

`<app-empty-state>` variant error avec retry CTA, exactement comme le hub :

```html
@if (store.error()) {
  <div class="empty-state empty-state--error">
    <mat-icon class="empty-state__icon">wifi_off</mat-icon>
    <p class="empty-state__title">{{ 'deckList.error.title' | translate }}</p>
    <button type="button" class="btn btn--primary btn--lg btn--cta" (click)="store.fetchDecks()">
      <mat-icon>refresh</mat-icon>
      {{ 'deckList.error.retry' | translate }}
    </button>
  </div>
}
```

i18n :
- `deckList.error.title` : FR `"Impossible de charger les decks"`, EN `"Failed to load decks"`
- `deckList.error.retry` : FR `"Réessayer"`, EN `"Retry"`

Le `DeckListStore.fetchDecks()` pose `error.set('...')` sur catch + remet `loading.set(false)`. Le service `DeckBuildService.fetchDecks()` actuel swallow probablement les erreurs ; à vérifier et adapter si besoin pour propager au store.

### Phase 7 — Restructure mobile stats compacte (S)

Sous `≤ $bp-pvp-narrow` (480px), même pattern que hub : passer du grid 2-cols (3 cards individuelles) à **un container compact monobloc** avec dividers verticaux entre stats. Hauteur ~48px au lieu de ~180px. Icon ronde cachée, label tronqué.

```scss
.deck-stats-strip {
  @include r.respond-below(r.$bp-pvp-narrow) {
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-overlay);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-md);
  }
}

.deck-stats-strip__item {
  @include r.respond-below(r.$bp-pvp-narrow) {
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;

    &:not(:first-child) {
      border-left: 1px solid var(--border-soft);
    }
  }
}

.deck-stats-strip__icon {
  @include r.respond-below(r.$bp-pvp-narrow) {
    display: none;
  }
}

.deck-stats-strip__value {
  @include r.respond-below(r.$bp-pvp-narrow) {
    font-size: var(--text-md);
  }
}

.deck-stats-strip__label {
  @include r.respond-below(r.$bp-pvp-narrow) {
    font-size: 9px;
    letter-spacing: 0.06em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
```

Et même `display: none` en landscape compact (`max-height: 500px`) déjà spec'd plus haut.

### Phase 4 — Tests & validation (M)

Tests existants à mettre à jour :
- `deck-list.component.spec.ts` — adapter pour nouveau template (count badge, section-header, sort)
- `deck-stats-strip.component.spec.ts` — vérifier les variantes (cyan/gold/neutral) + l'icon
- Snapshots si présents

Tests à ajouter :
- `setSortMode(mode)` change `sortMode` et réordonne `filteredDecks`
- `clearSearch()` reset le `searchControl` + repasse à l'état empty-state initial
- Empty state no-match s'affiche quand `searchControl.value && filteredDecks.length === 0`

Acceptance UX :
- AC1 — Stats strip rendue avec icones colorées et accents surface-card cohérents avec hub
- AC2 — Section-header montre "Mes decks (12)" + bouton de tri fonctionnel
- AC3 — Tri par récent/nom/taille/légalité disponible
- AC4 — Empty state "no-match" utilise `<app-empty-state>` avec CTA clear-search
- AC5 — Le rendu mobile portrait est cohérent (stats 2-cols, section-header s'adapte)
- AC6 — Skeleton stats-strip reflète le nouveau layout
- AC7 — Aucune régression sur la grille de deck-boxes (hover, fan-out, gold rail)

---

## Hors scope

- **Refonte hub icon-wrap** (deck-list est mieux ici) — chantier inverse, à planifier séparément.
- **Filter chips deck-list** — décision Axel : skip pour v1, ré-évaluer après usage.
- **Refonte de la deck-box elle-même** — déjà bien DS-conforme.
- **Unification `deck-stats-strip` + `hub-stat-card` en composant DS générique** — Wave 2 factorisation, pas dans ce chantier.

---

## Effort estimé

| Phase | Effort |
|---|---|
| 0. Migration back `updatedAt` (Flyway + entity + DTO + mapper + tests) | ~1h |
| 1. Refonte deck-stats-strip + skeleton | ~1h30 |
| 2. Section header + sort (3 modes) | ~1h30 |
| 3. Empty state no-match | ~30 min |
| 5. `DeckListStore` extraction | ~1h30 |
| 6. Error state + retry | ~30 min |
| 7. Restructure mobile stats compacte | ~30 min |
| 4. Tests + validation visuelle | ~1h30 |
| **Total** | **~8h30** |

Implementation handoff: Amelia (`bmad-dev-story` ou `bmad-quick-dev`).

---

## Annexe — Décisions actées

| Décision | Choix Axel 2026-05-18 |
|---|---|
| Approche stats | Généraliser `deck-stats-strip` |
| Mapping icônes/accents | Standard réassurant (cyan=decks, gold=cards/legal) |
| Scope | Audit complet (stats + section-header + empty + tri) |
| Filter chips | Skip v1 (décision spec, ré-évaluer après usage) |
| Modes de tri | 3 modes — `recent` (défaut), `name`, `legality`. Ajout migration back `updatedAt` (pas de timestamps actuellement sur l'entité Deck). |
| Ambition spec | **Montée à niveau Hub** — ajout `DeckListStore` (Phase 5), error state (Phase 6), restructure mobile stats (Phase 7). Patterns issus de l'analyse du Hub référence 2026-05-18. |
