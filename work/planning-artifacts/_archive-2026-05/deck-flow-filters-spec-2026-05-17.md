# Deck Flow Filters · Implementation Spec

**Date :** 2026-05-17
**Author :** Claude (with Axel validation)
**For :** dev agent (Amelia / `bmad-quick-dev`)
**Status :** ready to port (UX validated, doctrine fixée)
**Mockup de référence :** `_mockups/mockup-deck-flow.html` (4575 lignes)

---

## 1. Contexte

Refonte des composants de **filtres** pour les 3 écrans Deck Flow (Deck List, Deck Builder searcher, Card Search standalone). Le code Angular existant — `CardFiltersComponent` + ses 5 sous-composants — est largement Material-driven et n'est pas DS-conforme. La refonte introduit :

- **Un nouveau composant `<app-token-select>`** qui remplace `<app-multiselect-autocomplete-filter>` (Material) pour les enums multi-sélection ≥ 10 options.
- **Une doctrine de patterns clarifiée** (token-select / attr-row / range-row / search-bar / chip-group) qui standardise la matrice "taille d'enum × type d'interaction".
- **Trois nouveaux filtres backend** : `race` (multi-sélection), exposés en front comme token-select.
- **Une barre des filtres actifs** (`active-filters-bar`) au-dessus des résultats avec chips supprimables individuellement.

**Hors scope explicite :**
- Refonte du `<app-card-list>` (mode liste vs grille). Le mockup affiche un mode liste simplifié mais le composant existant est gardé tel quel pour l'instant — seul son SCSS sera retoqué DS dans une étape Wave 2 distincte.
- Refonte du `<app-card-inspector>`. Spec séparée pré-existante (`project_card_inspector_premium_spec`, deferred).
- Backend Spring Boot — sauf l'ajout du champ `race` (1 ligne DTO + 6 lignes FilterService) qui est inclus dans cette spec parce que minimal.
- Mode liste mobile : skip Wave 1, garder grille uniquement sur mobile.

---

## 2. Doctrine — matrice patterns × enum size

Référence pour tout futur filtre. À épingler en mémoire (`project_filter_patterns_doctrine`).

| Taille enum | Pattern DS | Composant Angular | Cas d'usage skytrix |
|---|---|---|---|
| Mono-sélection icône, ≤ 8 options | `attr-row` | `<app-toggle-icon-filter>` (mat-chip-listbox reskin) | **Attribut** (7 valeurs) |
| Range numérique | `range-row` | `<app-between-filter>` | **ATK, DEF, Scale Pendulum, Link rating** |
| Texte libre + suggestions optionnelles | `search-bar` | `<app-autocomplete-filter>` ou `<app-card-set-search-filter>` | **Archétype, Extension** |
| Multi-sélection ≥ 10 options | **`token-select`** (nouveau) | **`<app-token-select>`** (nouveau) | **Type (17), Race (32)** |
| Multi-sélection < 10 options, vocabulaire stable | `chip-group` | (réservé futur) | (aucun usage actuel) |
| Toggle booléen | `toggle` | `mat-button-toggle` | **Favoris** (étoile topbar) |

**Pourquoi la bascule à 10 :**
- Au-delà de 10 options, un `chip-group` force le wrap sur 3+ lignes et explose la hauteur du panneau filtres. Un `token-select` reste compact (1 ligne fermée).
- En-deçà de 10, un `token-select` ajoute un clic inutile pour ouvrir le panel.

**Type a 17 valeurs** (`CardType` enum, `SKILL` filtré dans `card-filters.component.ts:36`) → **multiselect obligatoire**.
**Race a 32 valeurs** (`/assets/images/races/*.webp` count, mappé sur `card_race.*` i18n) → **multiselect obligatoire**.

---

## 3. Composant `<app-token-select>` — nouveau

### 3.1 API publique

```typescript
@Component({ selector: 'app-token-select', standalone: true, ... })
export class TokenSelectComponent<T> {
  @Input({ required: true }) form!: FormArray<FormControl<T>>;
  @Input({ required: true }) options$!: Observable<Array<IconedAutocompleteOption<T>>>;
  @Input({ required: true }) inputLabel!: string;
  @Input() placeholder = 'cardFilters.tokenSelect.placeholder';
  @Input() searchPlaceholder = 'cardFilters.tokenSelect.searchPlaceholder';
  @Input() maxVisibleChips = 2; // au-delà, affiche "+N" overflow
}
```

Étendre `AutocompleteOption<T>` dans `front/src/app/core/model/commons/short-resource.ts` :

```typescript
export type AutocompleteOption<T> = {
  id: T;
  name: string;
};

export type IconedAutocompleteOption<T> = AutocompleteOption<T> & {
  icon?: string; // path absolu, ex: 'assets/images/races/DRAGON.webp'
};
```

Type signature volontairement co-variante (`IconedAutocompleteOption` *est* un `AutocompleteOption`) pour réutiliser les pipes existants.

### 3.2 Anatomie HTML

```html
<div class="token-select" [class.open]="isOpen()" (clickOutside)="close()">
  <button
    class="token-select-trigger"
    type="button"
    [attr.aria-haspopup]="'listbox'"
    [attr.aria-expanded]="isOpen()"
    (click)="toggle()"
    (keydown)="onTriggerKeydown($event)">
    @if (selectedOptions().length === 0) {
      <span class="token-select-placeholder">{{ placeholder | translate }}</span>
    } @else {
      <div class="token-select-chips">
        @for (opt of visibleChips(); track opt.id) {
          <span class="token-select-mini-chip">
            @if (opt.icon) {
              <img class="token-select-mini-chip-icon" [src]="opt.icon" alt="">
            }
            <span class="token-select-mini-chip-label">{{ opt.name | translate }}</span>
            <span
              class="token-select-mini-chip-remove"
              role="button"
              [attr.aria-label]="'cardFilters.tokenSelect.removeLabel' | translate"
              (click)="$event.stopPropagation(); deselect(opt)">
              <mat-icon>close</mat-icon>
            </span>
          </span>
        }
        @if (overflowCount() > 0) {
          <span class="token-select-overflow">+{{ overflowCount() }}</span>
        }
      </div>
    }
    <mat-icon class="token-select-trigger-caret">expand_more</mat-icon>
  </button>

  @if (isOpen()) {
    <div class="token-select-panel" role="listbox" [attr.aria-multiselectable]="true">
      <div class="token-select-panel-search">
        <div class="search-bar">
          <mat-icon>search</mat-icon>
          <input
            #searchInput
            type="text"
            [placeholder]="searchPlaceholder | translate"
            [formControl]="searchControl"
            (keydown)="onSearchKeydown($event)">
        </div>
      </div>
      <div class="token-select-panel-options ghost-scroll">
        @for (opt of filteredOptions(); track opt.id; let i = $index) {
          <div
            class="token-select-option"
            role="option"
            [class.selected]="isSelected(opt)"
            [class.focused]="focusedIndex() === i"
            [attr.aria-selected]="isSelected(opt)"
            (click)="toggleSelection(opt)">
            <span class="token-select-option-check">
              <mat-icon>check</mat-icon>
            </span>
            @if (opt.icon) {
              <img class="token-select-option-icon" [src]="opt.icon" alt="">
            }
            <span class="token-select-option-label">{{ opt.name | translate }}</span>
          </div>
        }
        @if (filteredOptions().length === 0) {
          <div class="token-select-option-empty">
            {{ 'cardFilters.tokenSelect.noResults' | translate }}
          </div>
        }
      </div>
      <div class="token-select-panel-footer">
        <span>{{ 'cardFilters.tokenSelect.selectedCount' | translate:{count: selectedOptions().length} }}</span>
        @if (selectedOptions().length > 0) {
          <button type="button" (click)="clearAll()">
            {{ 'cardFilters.tokenSelect.clearAll' | translate }}
          </button>
        }
      </div>
    </div>
  }
</div>
```

### 3.3 Comportements

**Sélection :**
- Clic trigger → toggle panel ouvert/fermé.
- Clic option → toggle sélection (push/remove dans le FormArray).
- Clic croix mini-chip → deselect (sans ouvrir le panel).
- Clic "Tout effacer" footer → vide le FormArray.
- Clic outside (cdkOverlay backdrop OR document listener) → ferme le panel.

**Search interne :**
- Input filter via `searchControl: FormControl<string>` débounced 0ms (sync, options déjà chargées en mémoire).
- Filtre case + accent-insensitive via `formattedWithoutCaseAndAccent` existant (`front/src/app/core/utilities/functions.ts`).
- Reset à la fermeture du panel.

**Tri :**
- `sortOptions()` via `translateService.instant(opt.name).localeCompare(...)` au moment du fetch initial.
- Sélectionnés en haut ou tri alpha pur ? **Tri alpha pur** (cohérent avec le multiselect existant et plus prévisible pour 32 options).

**Clavier (a11y) :**
- Trigger focus + `Enter`/`Space` → ouvre le panel + focus search input.
- `Esc` → ferme le panel + focus trigger.
- `↓` dans search → focus première option du panel.
- `↑`/`↓` dans panel → navigue les options (`focusedIndex` signal).
- `Enter` sur option focused → toggle sélection (panel reste ouvert).
- `Tab` depuis panel → ferme le panel.

**Reset via service :**
- Listen `searchService.filtersCleared$` → vide le FormArray (sans `emitEvent`).

**Pas porté depuis multiselect-autocomplete existant :**
- Le pattern "tape ` / ` dans le trigger pour désélectionner par texte" est **abandonné**. Validé avec Axel — comportement obscur, non testé, complexifie le composant. La croix sur mini-chip remplit le même besoin de façon explicite.

### 3.4 SCSS

Tous les styles dans `front/src/app/components/card-filters/components/token-select/token-select.component.scss`. **0 hardcode** — tout via tokens DS (`--gold-*`, `--surface-*`, `--border-*`, `--space-*`, `--text-*`, `--radius-*`, `--transition-*`).

Référence visuelle : mockup `_mockups/mockup-deck-flow.html` lignes 2087-2240 (CSS bloc `.token-select*`). À porter quasi-verbatim, sauf :
- `font-size: 0.65rem` (mini-chip) → `var(--text-xs)` (la clamp DS s'occupe du resize fluide).
- `width: 14px; height: 14px` (mini-chip-icon) → garder hardcodé, geometry composant locale.
- `max-width: 110px` (mini-chip) → garder hardcodé OU exposer via `@Input() chipMaxWidth = '110px'` si on veut customiser par usage. **Reco : hardcodé.**

### 3.5 Tests requis

- `should bind FormArray<FormControl<T>> two-way`
- `should display N mini-chips up to maxVisibleChips, then "+overflow"`
- `should remove selection when clicking mini-chip close button without opening panel`
- `should filter options on search input (case + accent insensitive)`
- `should support Enter/Esc/↑↓/Tab keyboard navigation`
- `should clear FormArray on filtersCleared$ emission`
- `should render icon when option has icon, no img when absent`
- `should sort options via localeCompare on translated names`

---

## 4. Backend — ajout du filtre Race

Trois changements minimaux côté `back/`.

### 4.1 `CardFilterDTO.java`

Ajouter un champ `List<Race> races` :

```java
// back/src/main/java/com/skytrix/model/dto/card/CardFilterDTO.java
private List<Race> races; // ← ajouter, après types ligne 22
```

### 4.2 `FilterService.cardSpecification()`

Ajouter un predicate (après le bloc `types` autour de la ligne 70-80) :

```java
if (filterDTO.getRaces() != null && !filterDTO.getRaces().isEmpty()) {
    List<String> raceNames = filterDTO.getRaces().stream()
        .map(Race::name)
        .toList();
    predicate = criteriaBuilder.and(predicate, root.get("race").in(raceNames));
}
```

Validation : la colonne `race` de l'entité `Card` est `String`, les valeurs sont déjà alignées sur l'enum `Race` (ex: `"DRAGON"`, `"AQUA"`).

### 4.3 Tests backend

Ajouter un test paramétré dans `FilterServiceTest` (si existant) qui vérifie :
- `races=[DRAGON]` → renvoie uniquement les cartes Dragon
- `races=[DRAGON, AQUA]` → renvoie cartes Dragon OU Aqua (union)
- `races=null` ou `races=[]` → pas de filtre appliqué

---

## 5. Front — refonte de `CardFiltersComponent`

### 5.1 Nouveau template `card-filters.component.html`

Ordre des sections (fréquence d'usage décroissante validée avec Axel) :

```html
@if (searchService()) {
  <div class="cardFilters">
    <div class="cardFilters-panel-header">
      <div class="cardFilters-panel-title">{{ 'cardFilters.title' | translate }}</div>
      <button
        class="cardFilters-panel-clear"
        type="button"
        [disabled]="activeFilterCount() === 0"
        (click)="clearAllFilters()">
        {{ 'cardFilters.clear' | translate }} ({{ activeFilterCount() }})
      </button>
    </div>

    <!-- 1. Type — token-select (17 options sans icônes) -->
    <div class="filter-group">
      <div class="filter-label">{{ 'cardFilters.cardType' | translate }}</div>
      <app-token-select
        [form]="localForm.controls.types"
        [options$]="types$ "
        [inputLabel]="'cardFilters.cardType' | translate">
      </app-token-select>
    </div>

    <!-- 2. Archétype — search input (existant à reskinner) -->
    <div class="filter-group">
      <div class="filter-label">{{ 'cardFilters.archetype' | translate }}</div>
      <!-- input text simple, pas d'autocomplete (pas d'index back) -->
      <input
        type="text"
        class="filter-text-input"
        [formControl]="localForm.controls.archetype"
        [placeholder]="'cardFilters.archetypePlaceholder' | translate">
    </div>

    <!-- 3. Attribut — attr-row (toggle-icon-filter existant) -->
    <div class="filter-group">
      <app-toggle-icon-filter
        [form]="localForm.controls.attribute"
        [toggleIcons]="toggleIcons"
        [inputLabel]="'cardFilters.attribute' | translate">
      </app-toggle-icon-filter>
    </div>

    <!-- 4. ATK / DEF — range-row × 2 -->
    <div class="filter-group">
      <app-between-filter
        [minForm]="localForm.controls.minAtk"
        [maxForm]="localForm.controls.maxAtk"
        [inputLabel]="'ATK'">
      </app-between-filter>
    </div>
    <div class="filter-group">
      <app-between-filter
        [minForm]="localForm.controls.minDef"
        [maxForm]="localForm.controls.maxDef"
        [inputLabel]="'DEF'">
      </app-between-filter>
    </div>

    <!-- 5. Race — token-select (32 options avec icônes webp) -->
    <div class="filter-group">
      <div class="filter-label">{{ 'cardFilters.race' | translate }}</div>
      <app-token-select
        [form]="localForm.controls.races"
        [options$]="races$"
        [inputLabel]="'cardFilters.race' | translate">
      </app-token-select>
    </div>

    <!-- 6. Scale Pendulum — range (rare mais utile pour decks Pendulum) -->
    <div class="filter-group">
      <app-between-filter
        [minForm]="localForm.controls.minScale"
        [maxForm]="localForm.controls.maxScale"
        [inputLabel]="('cardFilters.scale' | translate)">
      </app-between-filter>
    </div>

    <!-- 7. Link rating — range (rare mais utile pour Extra Deck) -->
    <div class="filter-group">
      <app-between-filter
        [minForm]="localForm.controls.minLinkval"
        [maxForm]="localForm.controls.maxLinkval"
        [inputLabel]="('cardFilters.linkval' | translate)">
      </app-between-filter>
    </div>

    <!-- 8. Extension — search input via card-set-search-filter -->
    <div class="filter-group">
      <app-card-set-search-filter [form]="localForm.controls.cardSetFilter">
      </app-card-set-search-filter>
    </div>
  </div>
}
```

### 5.2 Refonte `SearchServiceCore.buildSearchForm()`

Ajouter les FormControls manquants pour Scale/Linkval **range** (actuellement scalaires) + Race FormArray :

```typescript
public static buildSearchForm(): TypedForm<CardFilterDTO> {
  return {
    minAtk: new FormControl<number | null>(null),
    maxAtk: new FormControl<number | null>(null),
    minDef: new FormControl<number | null>(null),
    maxDef: new FormControl<number | null>(null),
    name: new FormControl<string>(''),
    attribute: new FormControl<CardAttribute | null>(null),
    archetype: new FormControl<string>(''),
    // CHANGEMENT : scale scalaire → range
    minScale: new FormControl<number | null>(null),
    maxScale: new FormControl<number | null>(null),
    // CHANGEMENT : linkval scalaire → range
    minLinkval: new FormControl<number | null>(null),
    maxLinkval: new FormControl<number | null>(null),
    types: new FormArray<FormControl<CardType>>([]),
    races: new FormArray<FormControl<CardRace>>([]), // NOUVEAU
    favorite: new FormControl<boolean>(false, { nonNullable: true }),
    cardSetFilter: new FormGroup<TypedForm<CardSetFilterDTO>>({
      cardSetName: new FormControl<string>(''),
      cardSetCode: new FormControl<string>(''),
      cardRarityCode: new FormControl<string>(''),
    }),
  };
}
```

**Note backend :** la passage scale/linkval scalaire → range est un **break compat DTO**. Soit on aligne le backend (`Short scale` → `Short minScale, Short maxScale`), soit on adapte côté front avec un mapper (`(minScale, maxScale) → request scale=min OR scale=max`). **Recommandation : aligner backend** (10 lignes, plus propre).

### 5.3 Reset signal

Ajouter au `resetFilters()` du service les nouveaux contrôles :

```typescript
this.filterForm.controls.races.clear({ emitEvent: false });
this.filterForm.controls.minScale.reset(null, { emitEvent: false });
this.filterForm.controls.maxScale.reset(null, { emitEvent: false });
this.filterForm.controls.minLinkval.reset(null, { emitEvent: false });
this.filterForm.controls.maxLinkval.reset(null, { emitEvent: false });
```

### 5.4 Options observables

```typescript
// dans CardFiltersComponent
public readonly races = Object.values(CardRace).filter(r => r !== CardRace.OTHER);
public readonly types = Object.values(CardType).filter(t => t !== CardType.SKILL);

public readonly races$: Observable<Array<IconedAutocompleteOption<CardRace>>> =
  of(this.races.map(r => ({
    id: r,
    name: `card_race.${r}`,
    icon: `assets/images/races/${r}.webp`,
  })));

public readonly types$: Observable<Array<IconedAutocompleteOption<CardType>>> =
  of(this.types.map(t => ({
    id: t,
    name: `card_type.${t}`,
    // pas d'icône — /assets/images/types/ ne contient que SPELL et TRAP, pas les 17
  })));
```

Vérifier qu'un enum `CardRace` existe côté front (`front/src/app/core/enums/card-race.ts`). S'il manque, le créer avec les 34 valeurs de `card_race.*` i18n.

### 5.5 Assets races

`/assets/images/races/` contient **33 webp** (ajout `ILLUSION.webp` 2026-05-17 par Axel). L'enum `card_race` en a 34. Restant :
- **`OTHER`** : race "fallback" backend, ne doit pas apparaître en filtre. **Exclure de la liste via `.filter(r => r !== CardRace.OTHER)`** (cf. snippet §5.4, même pattern que `SKILL` pour CardType).

Aucun asset manquant côté implémentation.

---

## 6. Active Filters Bar — nouveau

### 6.1 Position

Insérée dans `<app-card-searcher>` et `<app-card-search-page>` entre la `search-page-toolbar` (compteur résultats) et la `search-page-grid`. **Visible uniquement quand `activeFilterCount() > 0`.**

### 6.2 Anatomie

```html
@if (activeFilters().length > 0) {
  <div class="active-filters-bar">
    <span class="active-filters-bar-label">
      {{ 'cardFilters.activeFilters' | translate }}
    </span>
    @for (filter of activeFilters(); track filter.key) {
      <button class="chip active" type="button" (click)="removeFilter(filter)">
        {{ filter.label | translate }}{{ filter.suffix }}
        <mat-icon>close</mat-icon>
      </button>
    }
    <button class="active-filters-bar-clear" type="button" (click)="clearAllFilters()">
      {{ 'cardFilters.clearAll' | translate }}
    </button>
  </div>
}
```

### 6.3 Signal `activeFilters()` — computed depuis le form

```typescript
readonly activeFilters = computed<ActiveFilter[]>(() => {
  const f = this.filterForm.value;
  const out: ActiveFilter[] = [];

  if (f.types?.length) {
    out.push({
      key: 'types',
      label: 'cardFilters.cardType',
      suffix: ` : ${f.types.map(t => this.t(`card_type.${t}`)).join(', ')}`,
      remove: () => this.filterForm.controls.types.clear(),
    });
  }
  if (f.races?.length) {
    out.push({
      key: 'races',
      label: 'cardFilters.race',
      suffix: ` : ${f.races.map(r => this.t(`card_race.${r}`)).join(', ')}`,
      remove: () => this.filterForm.controls.races.clear(),
    });
  }
  if (f.attribute) {
    out.push({
      key: 'attribute',
      label: `card_attribute.${f.attribute}`,
      suffix: '',
      remove: () => this.filterForm.controls.attribute.setValue(null),
    });
  }
  if (f.minAtk != null || f.maxAtk != null) {
    out.push({
      key: 'atk',
      label: 'cardFilters.atk',
      suffix: this.formatRange(f.minAtk, f.maxAtk),
      remove: () => {
        this.filterForm.controls.minAtk.setValue(null);
        this.filterForm.controls.maxAtk.setValue(null);
      },
    });
  }
  // ... idem pour DEF, scale, linkval, archetype, cardSetFilter
  return out;
});

private formatRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return ` ${min}–${max}`;
  if (min != null) return ` ≥ ${min}`;
  if (max != null) return ` ≤ ${max}`;
  return '';
}
```

**Type :**
```typescript
interface ActiveFilter {
  key: string;     // identifiant pour `track`
  label: string;   // i18n key
  suffix: string;  // texte concaténé après le label
  remove: () => void; // clear le ou les FormControl
}
```

### 6.4 Comportement mobile

**Décision design (validée Axel) :** la barre filtres actifs **ne s'affiche pas** dans le bottom-sheet mobile. Au lieu, on garde le badge "+N" sur le bouton tune/FAB et l'utilisateur ferme le sheet pour voir la barre au-dessus de la grille.

Rationale : sur mobile portrait, l'espace est précieux, et la barre cumulerait avec les chips actifs visibles **dans** le panneau (les options sélectionnées du token-select). Redondance évitable.

---

## 7. i18n — clés à ajouter

`front/src/assets/i18n/fr.json` :

```json
{
  "cardFilters": {
    "title": "Filtres",
    "cardType": "Type de carte",
    "attribute": "Attribut",
    "min": "Min.",
    "max": "Max.",
    "cardSet": "Extension",
    "race": "Race",
    "archetype": "Archétype",
    "archetypePlaceholder": "Tearlaments, Branded…",
    "scale": "Scale Pendulum",
    "linkval": "Lien (rating)",
    "atk": "ATK",
    "def": "DEF",
    "clear": "Effacer",
    "clearAll": "Tout effacer",
    "activeFilters": "Filtres actifs",
    "tokenSelect": {
      "placeholder": "Sélectionner…",
      "searchPlaceholder": "Filtrer…",
      "noResults": "Aucun résultat",
      "selectedCount": "{{count}} sélectionnés",
      "clearAll": "Tout effacer",
      "removeLabel": "Retirer cette option"
    }
  }
}
```

Idem pour `en.json` (à traduire).

---

## 8. Composant `<app-multiselect-autocomplete-filter>` — déprécié

Le composant existant (`front/src/app/components/card-filters/components/multiselect-autocomplete-filter/`, ~250 lignes) est **remplacé en bloc** par `<app-token-select>`.

**Plan :**
1. Étape 1 : implémenter `<app-token-select>` à côté, sans toucher l'existant.
2. Étape 2 : refondre `<app-card-filters>` pour pointer vers `<app-token-select>` (1 occurrence à changer : `card-filters.component.html:4`).
3. Étape 3 : supprimer le dossier `multiselect-autocomplete-filter/` (3 fichiers).
4. Étape 4 : retirer l'import dans `card-filters.component.ts:3`.

**Validation préalable :** grep `MultiselectAutocompleteFilterComponent` dans le repo. Si zéro usage hors `card-filters.component.ts`, la suppression est safe. Sinon, migrer les autres usages en même temps.

---

## 9. Responsive

Mockup couvre 4 device-frames. Toutes les cibles d'impl :

| Breakpoint | Comportement filtres |
|---|---|
| **Desktop ≥ 1280px** | Panel sidebar 280px sticky à gauche, full filtres visibles |
| **Tablet portrait 768-1024px** | Panel drawer 240px à gauche, full filtres, navbar masqué |
| **Landscape compact 1024×600** | Panel inline dans le `searcher-filters` 140px max-height (Builder uniquement) |
| **Mobile ≤ 767px** | Bottom-sheet via `<app-bottom-sheet>` existant, full filtres scrollables |

**Token-select panel sur mobile :**
- Le panel dropdown s'ouvre **vers le haut** si pas la place en dessous (cdkOverlay `positions` flexible).
- Sur très petits écrans (≤ 360px), le panel prend `min-width: calc(100vw - 32px)` pour éviter qu'il sorte du viewport.

**Sticky filter panel desktop :**
- `position: sticky; top: var(--space-4); max-height: calc(100vh - 100px); overflow-y: auto;` (cf. mockup ligne 2010).
- Le `position: sticky` ne fait rien sur tablet portrait (hauteur fixe 1024px = pas de scroll long). C'est OK, comportement attendu.

---

## 10. Migration côté code — checklist

### 10.1 Backend (1 fichier, ~10 lignes)
- [ ] `CardFilterDTO.java` : ajouter `private List<Race> races;` + getter/setter (lombok auto).
- [ ] `FilterService.cardSpecification()` : ajouter le predicate races (cf. §4.2).
- [ ] `FilterServiceTest` : 3 cas paramétrés (cf. §4.3).
- [ ] `CardFilterDTO.java` : remplacer `Short scale` / `Short linkval` → `Short minScale, Short maxScale, Short minLinkval, Short maxLinkval` (décision Axel : alignement backend).
- [ ] `FilterService.cardSpecification()` : remplacer les 2 `equal` scale/linkval par des predicates `greaterThanOrEqualTo` + `lessThanOrEqualTo` (4 blocs, ~10 lignes).

### 10.2 Front (3 nouveaux fichiers + 4 fichiers modifiés)

**Nouveaux :**
- [ ] `front/src/app/components/card-filters/components/token-select/token-select.component.ts`
- [ ] `.../token-select.component.html`
- [ ] `.../token-select.component.scss`
- [ ] `.../token-select.component.spec.ts`
- [ ] `front/src/app/core/enums/card-race.ts` (si absent — vérifier d'abord)

**Modifiés :**
- [ ] `front/src/app/core/model/commons/short-resource.ts` : ajouter `IconedAutocompleteOption<T>`.
- [ ] `front/src/app/services/search-service-core.service.ts` : refondre `buildSearchForm()` + `resetFilters()`.
- [ ] `front/src/app/components/card-filters/card-filters.component.ts` : ajouter `races$`, `types$` observables typés.
- [ ] `front/src/app/components/card-filters/card-filters.component.html` : refonte template selon §5.1.
- [ ] `front/src/app/components/card-filters/card-filters.component.scss` : refonte DS (filter-panel-header, filter-group, filter-label).
- [ ] `front/src/assets/i18n/fr.json` + `en.json` : ajouter les clés §7.
- [ ] `front/src/app/components/card-searcher/card-searcher.component.{html,ts,scss}` : ajouter `<active-filters-bar>` au-dessus du grid + computed `activeFilters()`.
- [ ] `front/src/app/pages/card-search-page/card-search-page.component.{html,scss}` : pareil.

**Supprimés (étape finale) :**
- [ ] `front/src/app/components/card-filters/components/multiselect-autocomplete-filter/` (3 fichiers).

### 10.3 Tests

- [ ] Tests unitaires `<app-token-select>` (cf. §3.5, 8 cas).
- [ ] Tests `<app-card-filters>` mis à jour pour la nouvelle structure.
- [ ] Test backend `FilterServiceTest` (cf. §4.3).
- [ ] Test e2e Cypress (si existant) : sélection multi races + check URL params ou results refresh.

---

## 11. Hors scope confirmé

- Compteur d'occurrences par option dans le panel (`token-select-option-count`). Nécessiterait un endpoint backend `/api/cards/count-by-race` non prévu. **Si Axel veut l'ajouter plus tard**, c'est un slot dédié dans `.token-select-option` après le label, sans casser l'API du composant.
- Mode liste sur mobile (gardé en desktop uniquement via mat-button-toggle-group).
- Refresh visuel du `<app-card-inspector>` — autre spec.
- Pattern "tape ` / ` dans le trigger" (multiselect-autocomplete legacy) — abandonné.

---

## 12. Validation visuelle

Avant de lancer l'impl :
1. Ouvrir `_mockups/mockup-deck-flow.html` dans un navigateur.
2. Naviguer les 4 onglets : **Liste / Builder / Recherche / Détails**.
3. En vue **Détails**, vérifier les 2 cards token-select (trois états + panel ouvert).
4. En vue **Recherche** Desktop, vérifier l'ordre des 8 sections du panneau filtres (cf. §5.1).
5. Tester l'interactivité (clic trigger / option / mini-chip close / outside click).

Tout ce qui n'est pas dans le mockup ou dans cette spec est **à reclarifier** avant impl.

---

## 13. Risques & inconnues

- **Race assets** : 33/34 disponibles, `OTHER` exclu par filtre code (pas un asset à créer). ✅ résolu.
- **Scale/Linkval range backend** : changement de DTO ~10 lignes Java, à aligner avec le déploiement back. Validé Axel : on aligne le backend.
- **Performance du token-select** avec 32 races : pas de pagination, tout chargé en mémoire. OK pour ≤ 100 options, à monitorer si on ajoute des filtres > 100 options dans le futur.
- **`<app-bottom-sheet>` sur mobile** : le token-select panel rend bien dans un sheet ? Tester en early phase, le z-index et le scroll lock du sheet peuvent interférer avec un dropdown nested.

---

## 14. Effort estimé

| Bloc | Effort |
|---|---|
| `<app-token-select>` (TS + HTML + SCSS + spec) | 6-8 h |
| Backend filtre races + tests | 1 h |
| Front search-service-core refonte form | 1 h |
| `<app-card-filters>` refonte template + SCSS | 2 h |
| Active filters bar (computed + insertion 2 endroits) | 2 h |
| i18n keys FR + EN | 30 min |
| Migration multiselect-autocomplete → token-select | 1 h |
| Tests unitaires complets | 2 h |
| **Total** | **15-18 h** soit 2 jours dev focus |

Hors :
- Validation visuelle finale (Axel).

Décisions actées 2026-05-17 :
- ✅ Scale/Linkval scalaire → range : **alignement backend** (10 lignes Java).
- ✅ Race assets : ILLUSION.webp ajouté par Axel, OTHER exclu par filtre code.
