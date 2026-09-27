# Deck Flow Full Inventory · Implementation Roadmap

**Date :** 2026-05-17
**Author :** Claude
**For :** Axel (validation + priorisation), puis dev agent (Amelia)
**Status :** inventaire complet — décisions de portée à prendre
**Mockup :** `_mockups/mockup-deck-flow.html` (4575 lignes, 4 vues, ~33 token-selects, 6 device-frames)
**Spec compagnon :** `deck-flow-filters-spec-2026-05-17.md` (filtres uniquement)

---

## Objet

La spec filtres couvre **uniquement le bloc filtres** (token-select, briques DS, race backend, active filters bar). Le mockup va beaucoup plus loin — 4 écrans complets. Ce document inventorie **tout ce qui doit bouger côté code** pour atteindre la maquette, écran par écran.

Format : pour chaque bloc, on liste **(a) ce qui existe déjà**, **(b) ce qu'il manque**, **(c) effort estimé**, **(d) Wave proposée**.

---

## 1. Deck List — page galerie

**Code existant :** `pages/deck-page/deck-page.component` (host minimal) + `pages/deck-page/components/deck-list/deck-list.component` + `components/deck-box/deck-box.component`.

### 1.1 Layout & chrome
| Élément | Existe ? | À faire |
|---|---|---|
| App navbar latéral gold (Wave 1.5) | ✅ `components/navbar` DS-conforme | Rien |
| Header de page "Mes Decks" + icône + subtitle | ❌ pas d'en-tête, juste la grille | **Créer** `deck-list-header` (h1 + icon-bubble + subtitle + actions) |
| Search bar "Filtrer mes decks…" (filtre client-side sur `decks$`) | ❌ aucun filtre | **Créer** computed `filteredDecks` + binding |
| Bouton CTA "Nouveau deck" en header | ❌ uniquement via le tile `[add]` dans la grille | **Ajouter** bouton primary `[routerLink]="/decks/builder"` |
| Stats strip 3 KPI (Decks / Cartes possédées / Légaux) | ❌ aucune stat affichée | **Créer** composant `<app-deck-stats-strip>` — **tout calculable côté front** |

**Stats backend : aucun endpoint à créer** (décision Axel — skip "Plus joué").
- `deckCount` : `decks.length` côté front.
- `cardsOwned` : exposé par `OwnedCardService` (déjà existant — somme).
- `legalDeckCount` : `decks.filter(d => d.valid).length` — `valid` déjà dans `ShortDeckDTO`.

Le composant `<app-deck-stats-strip>` consomme ces 3 valeurs en `@Input()` (computed signals dans le parent).

### 1.2 Carte de deck (deck-box)
| Élément | Existe ? | À faire |
|---|---|---|
| Image `deckbox.webp` (Ultra Pro photo) | ✅ legacy | **Remplacer** par silhouette vectorielle CSS DS (5 teintes : gold/green/cyan/purple/rose) |
| Preview 3 cartes en survol/permanent | ✅ `urls[]` partiel | Ajouter le **fan-out** au hover (legacy : statique) |
| Nom du deck | ✅ | Rien |
| Pills Légal / Incomplet + Main count | ❌ texte plat | **Créer** computed `legalPill()` et `mainCountPill()` qui renvoient `{variant, text}` + binder dans le template |
| Bouton supprimer (icône poubelle) | ✅ overlay top-right | **Garder** mais reskin DS (Material → ghost icon button gold) |
| Tile "Nouveau deck" `[add]=true` | ✅ | **Reskin** (legacy mat-icon `library_add`, mockup = pill DS gold pointillée) |
| RouterLink vers `/decks/{id}` | ✅ | Rien |
| Tooltip + a11y delete label | ✅ | Rien |

**Décision asset deckbox** : la silhouette vectorielle DS du mockup est composée en CSS (lid + body en gradient teinté). **Pas d'asset image** — c'est un avantage net : 5 teintes via `deck-silhouette--{gold,green,cyan,purple,rose}`.

**Décision Axel — pas de back, hash front sur `deck.id`** :
```typescript
// Helper utility (à placer dans front/src/app/core/utilities/deck-theme.ts)
const DECK_THEMES = ['gold', 'green', 'cyan', 'purple', 'rose'] as const;
export type DeckTheme = typeof DECK_THEMES[number];

export function pickDeckTheme(deckId: number | undefined): DeckTheme {
  if (deckId == null) return 'gold'; // fallback création
  // Simple hash stable : deckId * Math.PI (mod 5) → entier déterministe.
  return DECK_THEMES[Math.abs(Math.floor(deckId * Math.PI)) % 5];
}
```

→ Le composant `<app-deck-silhouette>` prend `[deckId]` et calcule `theme()` via `computed()`. Pas de champ backend, pas d'endpoint, pas de migration BDD. **Wave 3 reconsidère** si on veut un picker utilisateur (peu probable selon Axel).

### 1.3 Empty state
| Élément | Existe ? | À faire |
|---|---|---|
| `<app-empty-state>` "Aucun deck pour le moment" + CTA "Créer un deck" | ✅ | **Vérifier DS-conformité** du composant `empty-state` (héritage Wave 1.5) |
| Variante "Première création" (mockup mobile frame 3 : pleine page centered + grand pictogramme) | ❌ pas une variante distincte | **Ajouter** `[variant]="welcome"` qui agrandit le picto + ajoute une baseline |

### 1.4 Effort Deck List

| Item | h |
|---|---|
| Header de page (h1 + icon + subtitle + search-bar + CTA) | 2 |
| Stats strip (3 KPI + computeds) | 2 |
| Silhouette deck-box CSS + theme picker | 3 |
| Pills statut deck-box (legal/count) | 1 |
| Filtre client-side `filteredDecks` | 1 |
| Reskin DS bouton delete + tile [add] | 1 |
| Empty state variante welcome | 1 |
| Tests + i18n | 2 |
| **Total** | **13h** |

---

## 2. Deck Builder — éditeur

**Code existant :** `pages/deck-page/components/deck-builder/deck-builder.component` + sub `deck-viewer` + `hand-test` + global `components/card-searcher` + `components/card-inspector` + `components/bottom-sheet`.

### 2.1 Layout & chrome

| Élément | Existe ? | À faire |
|---|---|---|
| Header unifié top (deck name editable + counts + actions) | ❌ legacy = header **dans le side panel** | **Refactor structurel** — sortir le bloc `deckBuilder-side-header-deckName` du side panel pour en faire un header pleine largeur. Casse compatibilité visuelle. |
| Pills counts `Main 40/60 / Extra 15/15 / Side 12/15` | ❌ legacy = crochets `[40]` | **Remplacer** par 3 pills DS sémantiques (valid/gold/neutral selon count) |
| Bouton "Test main" inline | ❌ legacy = sous more_vert | **Sortir** du menu → button ghost inline |
| Bouton "Duel PvP" inline | ❌ legacy = sous more_vert | **Sortir** du menu → button ghost inline (gating `[disabled]="!deck.valid || !deck.id"`) |
| More-menu `more_vert` (Proxies / Export×2 / Import / Sort / Simulator) | ✅ | **Garder** mais nettoyer (les 2 sortis ne sont plus dedans) |
| Bouton Sauvegarder primary | ✅ avec dirty-dot | **Reskin DS** (mat-icon-button → btn--primary) |
| Indicator "Modifications non sauvegardées" (dirty dot) | ✅ | **Reskin** (legacy dot rouge → halo gold pulsant DS) |

### 2.2 Viewer 3 zones

| Élément | Existe ? | À faire |
|---|---|---|
| 3 zones MAIN / EXTRA / SIDE | ✅ `deck-viewer` | Rien sur la structure |
| 3 teintes différenciées (legacy = tout gold) | ❌ | **Ajouter** modifier `--extra` (cyan) et `--side` (neutre) sur `deck-zone` |
| Sticky `.deck-zone-header` | ❌ legacy = `overflow: hidden` parent bloque | **Retirer** overflow + ajouter `position: sticky` + backdrop-filter blur |
| Drop preview placeholder dashed | ❌ legacy = `visibility: hidden` | **Refactor** ghost source via `cdkDragStarted` listener + override `.cdk-drag-preview` global |
| Pills count inline dans header zone | ❌ legacy = chiffre nu | **Ajouter** pill DS `40 / 60` avec variant valid/invalid |
| Hint "Glissez ou double-cliquez pour ajouter" (zone vide) | ✅ texte simple | **Reskin** (typo display + couleur muted DS) |
| Just-added animation (`.just-added` glow) | ✅ | **Vérifier** alignement DS (gold pulse) |

### 2.3 Side panel — searcher

| Élément | Existe ? | À faire |
|---|---|---|
| Mini "Aperçu du deck" (3 slots horizontal) | ✅ `deck-card-zone slotNumber=3` | **Reskin** (label "Aperçu" + 3 slots compact 45×66) |
| Card searcher latéral (search-bar + filtres + grille résultats) | ✅ `card-searcher` | **Reskin DS** + branchement nouveau token-select |
| Bouton filtres `tune` avec badge count | ❌ legacy = filter_alt **dans** la search-bar | **Sortir** le bouton à côté de la search-bar avec badge actif gold |
| Slide-down filtres (`grid-template-rows: auto 0fr 1fr` → `auto 1fr 1fr`) | ✅ animation | **Vérifier** alignement timing DS (`--transition-normal`) |
| Owned overlay `×N` sur les résultats | ✅ legacy | **Reskin DS** (badge bottom-right gold-soft) |
| Ban-badge `0/1/2` sur les résultats | ✅ legacy | **Reskin DS** (cercle gold/warning/success selon valeur) |

### 2.4 Hand-test overlay

| Élément | Existe ? | À faire |
|---|---|---|
| Backdrop noir 0.5 + overlay panel | ✅ | **Reskin** backdrop → `--scrim-medium`, panel → `--gradient-card-ds` |
| Bouton "Mélanger" | ✅ mat-flat-button | **Reskin** → btn ghost DS |
| Toggle "Aller deuxième" | ✅ mat-slide-toggle | **Reskin** → toggle DS custom (mockup `.toggle.toggle--on`) |
| 5 cartes affichées | ✅ | **Garder** mais size token (`--pvp-inspector-card-width` ou local) |

**Note** : pas de close button visible — l'overlay se ferme au clic backdrop. Conserver.

### 2.5 PvP room creation loading overlay

| Élément | Existe ? | À faire |
|---|---|---|
| Overlay full-screen avec spinner + "Création de la room…" | ✅ `pvpLoading()` signal | **Reskin** → `--scrim-deep` + spinner DS (skeleton dot pulse ou `mat-progress-spinner` reskin) |

### 2.6 Confirmation suppression deck (modal)

Visible dans Vue 1 (Détails) du mockup. Modal centrée avec icône warning rouge + texte + 2 boutons.

| Élément | Existe ? | À faire |
|---|---|---|
| Méthode `confirmDelete()` dans `deck-list.component` | ✅ avec mat-dialog | **Reskin** : créer une variante de `<app-confirm-dialog>` (s'il existe) ou créer un composant `<app-destructive-confirm>` aligné mockup (border danger, icône warning, CTA "Supprimer" rouge) |

### 2.7 Bottom-sheet mobile (recherche)

| Élément | Existe ? | À faire |
|---|---|---|
| `<app-bottom-sheet>` avec snap states | ✅ | **Vérifier DS conformity** + drag-handle pill DS |
| FAB recherche avec badge filtres actifs `+3` | ❌ legacy = bouton search transparent | **Créer** FAB gold gradient avec computed badge count |
| Frame "Recherche ouverte" mobile (search-bar + filtres token-select + grille 4 cols) | ✅ contenu existe | **Reskin** alignement mockup |

### 2.8 Inspector mobile flottant (carte sélectionnée)

| Élément | Existe ? | À faire |
|---|---|---|
| `<app-card-inspector mode="dismissable">` (panel latéral persistant) | ✅ | **Reskin DS** (notamment l'art-switcher + le bloc Possédées + bouton favori) |
| Position mobile (top:12 / left:12 / right:12, pas plein écran) | ❌ legacy = side panel attaché | **Ajouter** breakpoint `@media (max-width: 768px)` qui repositionne en flottant |

### 2.9 Effort Deck Builder

| Item | h |
|---|---|
| Header unifié top (refactor structurel) | 4 |
| 3 zones différenciées (modifier flags + sticky header) | 3 |
| Pills counts sémantiques (3 computed signals) | 1 |
| Drop preview placeholder dashed (CDK refactor) | 3 |
| Reskin actions (save, more_vert, test-hand, pvp) | 2 |
| Reskin searcher (bouton tune externe + badge) | 2 |
| Reskin hand-test (backdrop + toggle DS) | 1 |
| Reskin PvP loading | 0.5 |
| Confirmation suppression DS | 1 |
| Bottom-sheet mobile FAB + reskin | 2 |
| Inspector mobile repositionné | 2 |
| Tests + i18n | 3 |
| **Total** | **24.5h** |

---

## 3. Card Search standalone

**Code existant :** `pages/card-search-page/card-search-page.component` + reuse de `components/card-searcher` + `components/card-filters`.

### 3.1 Header de page

| Élément | Existe ? | À faire |
|---|---|---|
| Icône cyan + h1 "Recherche de cartes" + subtitle "13 200 cartes" | ❌ legacy = pas de header | **Créer** `search-page-header` aligné sur le `deck-list-header` pour cohérence visuelle inter-pages |
| Search bar centralisée (min-width 360px) | ✅ via `card-searcher` | **Reskin** + sortir de `card-searcher` au niveau page pour le mettre dans le header |
| Toggle GRID/LIST `mat-button-toggle-group` | ✅ | **Reskin DS** + déplacer à côté de la search-bar |
| Bouton favoris `star_border` toggle | ✅ | **Reskin** (mat-icon-button → btn--ghost btn--icon) |

### 3.2 Panel filtres sidebar

Couvert intégralement par `deck-flow-filters-spec-2026-05-17.md`. Ajout principal : panel sidebar 280px sticky à gauche (legacy = filtres inline dans `card-searcher`).

**Conséquence structurelle :** la `card-search-page.component.html` devient un layout 2-cols (filtres / résultats) au lieu d'un wrapper autour de `card-searcher`. Le composant `card-searcher` actuel est utilisé en deckBuildMode (mobile + builder side panel) mais **plus en standalone Card Search**.

→ **Recommandation** : extraire un composant `<app-card-search-layout>` qui prend en charge filtres-sidebar-desktop + bottom-sheet-mobile, avec `<app-card-searcher>` uniquement utilisé en mode embarqué (builder + mobile fallback).

### 3.3 Toolbar résultats

| Élément | Existe ? | À faire |
|---|---|---|
| Compteur `387 résultats` | ❌ legacy = scroll infini sans compteur | **Acté Axel — scroll infini conservé**. Ajouter uniquement le compteur `{{ total }} résultats` dans la toolbar (pas de page X / Y). |
| Active filters bar (chips supprimables) | ✅ couvert par spec filtres | Rien à ajouter ici |

### 3.4 Grille résultats

| Élément | Existe ? | À faire |
|---|---|---|
| Grille auto-fill min 110px | ✅ `card-list` | **Vérifier** breakpoints (mobile 3 cols, tablet 4-5 cols, desktop 6+ cols) |
| Mode LIST (image + nom + attribut/race icons + ATK/DEF + ban) | ✅ template existe | **Reskin DS** des rows (aligner sur le code complet, pas le mockup minimal). **Masquer le toggle GRID/LIST sous breakpoint 768** (décision Axel — mode liste desktop+tablet uniquement). |
| Lightbox image zoom 1×→4× | ✅ via `card-inspector` lightboxOpen | **Vérifier DS** (legacy = backdrop noir 0.92, ok) |

### 3.5 Inspector modal centré (mode click)

| Élément | Existe ? | À faire |
|---|---|---|
| `<app-card-inspector mode="click">` | ✅ avec image cliquable + lightbox | **Reskin DS** (alignement mockup : image header 280px + body padding `--space-3` + bloc Possédées en bas) |
| Art-switcher dots (≤ seuil) ou counter | ✅ logique existe | **Reskin** (mockup `.art-switcher-dot.active` gold + chevrons reskinned) |
| Bloc Possédées −/N/+ + favori | ✅ template `inspector-personal` | **Reskin DS** (boutons ghost icon + count mono) |
| Effect text (description carte) | ✅ via `cardDesc` pipe | **Vérifier** alignement DS (typo + line-height) |

### 3.6 Effort Card Search

| Item | h |
|---|---|
| Header de page (h1 + subtitle + search déplacée) | 2 |
| Layout 2-cols filtres sidebar / résultats (refactor structurel) | 4 |
| Toolbar résultats + pagination (selon décision Axel) | 2-4 |
| Reskin GRID/LIST toggle + favoris | 1 |
| Reskin mode LIST DS | 3 |
| Reskin inspector modal click | 3 |
| Tests + i18n | 3 |
| **Total** | **18-20h** |

---

## 4. Composants partagés à reskin/créer

### 4.1 Nouveaux composants

| Composant | Rôle | h estim |
|---|---|---|
| **`<app-token-select>`** | Multi-select avec icônes (Type, Race) | 8 (couvert spec filtres) |
| **`<app-deck-stats-strip>`** | 3-4 KPI cards inline (Deck List header) | 1.5 |
| **`<app-search-page-header>`** | h1 + icon-bubble + subtitle réutilisable (Deck List + Card Search) | 1.5 |
| **`<app-destructive-confirm>`** | Modal confirmation (avec icône warning + CTA danger) | 2 |
| **`<app-deck-silhouette>`** | Composant visual deck-box avec teintes 5 variantes | 2 |
| **`<app-active-filters-bar>`** | Chips supprimables au-dessus résultats | 2 (couvert spec filtres) |

### 4.2 Composants existants à reskin DS

| Composant | État | h estim |
|---|---|---|
| `deck-box` | reskin silhouette + pills + reskin add tile | 2 |
| `deck-card-zone` | sticky header + placeholder dashed + ban-badge DS | 3 |
| `deck-viewer` | modifier flags 3 teintes | 1 |
| `card-searcher` | bouton tune externe + reskin badge + bottom-sheet FAB | 3 |
| `card-list` (mode GRID) | gap + owned-count + ban-badge DS | 2 |
| `card-list` (mode LIST) | reskin rows DS | 3 |
| `card-inspector` (mode click) | reskin panel modal DS | 3 |
| `card-inspector` (mode dismissable) | reskin side panel + mobile repositioning | 2 |
| `card-filters` | refondu intégralement (couvert spec filtres) | 0 |
| `hand-test` | reskin backdrop + toggle DS | 1 |
| `between-filter` | reskin DS (range-row) | 0.5 |
| `toggle-icon-filter` | reskin DS (attr-row look) | 1 |
| `card-set-search-filter` | reskin DS (search-bar look) | 0.5 |
| `bottom-sheet` | déjà DS-conforme, vérifier handle DS | 0.5 |
| `empty-state` | déjà DS-conforme, ajouter variant welcome | 1 |
| `search-bar` (composant existant) | déjà DS-conforme, vérifier integration | 0 |

### 4.3 Composants à supprimer

| Composant | Raison |
|---|---|
| `multiselect-autocomplete-filter` | Remplacé par `token-select` (couvert spec filtres) |
| `app-snackbar` legacy (si Material) | Vérifier qu'on utilise déjà `<app-snackbar>` DS — sinon migrer |

---

## 5. Backend Spring Boot

### 5.1 Endpoint Race filter (couvert spec filtres)
- `CardFilterDTO.java` : `+ private List<Race> races`
- `FilterService` : predicate `IN`
- Effort : 1h (incluant tests)

### 5.2 Endpoint Scale/Linkval range (couvert spec filtres)
- `CardFilterDTO.java` : `Short scale` → `Short minScale, Short maxScale` + idem `linkval`
- `FilterService` : 4 blocs predicates `gte/lte`
- Effort : 1h

### 5.3 Endpoint Deck theme (optionnel Wave 1)
- `Deck.java` : `+ private String theme` (default `'gold'`)
- `ShortDeckDTO.java` : `+ private String theme`
- Migration BDD : `ALTER TABLE decks ADD COLUMN theme VARCHAR(16) NOT NULL DEFAULT 'gold'`
- Effort : 1.5h (incluant tests + migration)
- **Décision Axel** : Wave 1 ou Wave 2 ?

### 5.4 Endpoint Deck playCount (optionnel — pour stat "Plus joué")
- `Deck.java` : `+ private int playCount`
- Incrément à la création de room PvP côté `RoomController.createRoom()`
- Endpoint stat `GET /decks/stats` qui renvoie `{deckCount, legalCount, mostPlayed}`
- Effort : 3h
- **Décision Axel** : Wave 1 ou skip ?

---

## 6. i18n

Clés nouvelles, alignées sur le mockup. À ajouter dans `fr.json` + `en.json`.

```json
{
  "deckList": {
    "title": "Mes Decks",
    "subtitle": "Constructions enregistrées",
    "filterPlaceholder": "Filtrer mes decks…",
    "newDeck": "Nouveau deck",
    "empty": "Aucun deck pour le moment",     // existe déjà
    "createDeck": "Créer un deck",             // existe déjà
    "welcomeTitle": "Crée ton premier deck",
    "welcomeSubtitle": "Glisse-dépose tes cartes préférées pour démarrer."
  },
  "deckStats": {
    "decks": "Decks",
    "cardsOwned": "Cartes possédées",
    "legalDecks": "Decks légaux",
    "mostPlayed": "Plus joué"
  },
  "deckBuilder": {
    "namePlaceholder": "Nom du deck",         // existe déjà
    "actions": "Actions",                      // existe déjà
    "save": "Sauvegarder",
    "testHand": "Test main",
    "pvpDuel": "Duel PvP",
    "creatingRoom": "Création de la room…",
    "removeFromDeck": "Retirer du deck",
    "addToDeck": "Ajouter au deck",
    "deleteConfirmTitle": "Supprimer ce deck ?",
    "deleteConfirmMessage": "Cette action est irréversible.",
    "deleteConfirmCta": "Supprimer",
    "viewer": {
      "main": "MAIN",   // existe déjà
      "extra": "EXTRA", // existe déjà
      "side": "SIDE"    // existe déjà
    },
    "handTest": {
      "shuffle": "Mélanger",      // existe déjà
      "goSecond": "Aller deuxième" // existe déjà
    }
  },
  "cardSearchPage": {
    "title": "Recherche de cartes",
    "subtitle": "Base complète",
    "totalCards": "{{count}} cartes",
    "resultsCount": "{{count}} résultats",
    "pageOf": "page {{current}} / {{total}}"
  }
}
```

Effort total i18n : **1h** (clés FR + traduction EN).

---

## 7. Responsive — checklist d'implémentation

Pour chaque écran, valider sur les 6 breakpoints skytrix (cf. `project_responsive_strategy`) :

| BP | Deck List | Deck Builder | Card Search |
|---|---|---|---|
| 360 | grille 1 col + stats 2 KPI | sheet recherche fullscreen | grille 2 cols + FAB filtres |
| 414 | grille 1 col + stats 2 KPI | sheet recherche fullscreen | grille 3 cols + FAB filtres |
| 768 | grille 3 cols + stats 2 KPI + drawer nav | drawer side searcher 320px + nav drawer | drawer filtres 240px + nav drawer |
| 1024 | grille 4 cols + stats 4 KPI + nav rail collapsed | side searcher 38% + nav rail | filtres 240px + nav rail |
| 1280 | grille 5 cols + stats 4 KPI + nav rail expanded | side searcher 32% + nav rail expanded | filtres 280px + nav rail expanded |
| 1920 | grille 6 cols + stats 4 KPI + nav rail expanded | side searcher 28% + nav rail expanded | filtres 280px + nav rail expanded |

**Décision design** : faut-il un breakpoint "ultra-wide" (≥2560) ? Pour skytrix, **non** — la page reste centrée avec `max-width: 1440` (cf. mockup `device-frame--desktop`). Pas de scaling au-delà.

---

## 8. Découpage en Waves — scope final acté

**Stratégie validée Axel** : Wave 1 et Wave 2 **séparées**. Wave 1 mergée et validée visuellement avant d'engager Wave 2. Permet de capter des feedbacks DS sur le visuel pur avant le refactor structurel (qui casse compat visuelle header Builder).

### Wave 1 — DS-refresh visuel (sans changement comportement)

Objectif : tous les écrans Deck Flow deviennent DS-conformes sans refactor structurel ni nouvelles features. **Pas de changement de layout** — juste reskin DS + filtres refondus + helper theme front.

| Bloc | h |
|---|---|
| Refonte filtres (token-select, race back, scale/linkval range) — voir spec filtres | 15-18 |
| Reskin DS composants partagés (deck-box, deck-card-zone, card-inspector, card-list mode GRID, hand-test) | 13 |
| Mode liste DS (desktop+tablet uniquement, masquer toggle sous 768) | 3 |
| Stats strip 3 KPI (calcul côté front, pas de back) | 1.5 |
| Helper `pickDeckTheme(deckId)` + intégration `<app-deck-silhouette>` | 1 |
| i18n des nouvelles clés | 1 |
| Tests + a11y de base | 2 |

**Total Wave 1 : ~32-35h soit 4 jours.**

### Wave 2 — Refactor structurel
Objectif : casser la compat visuelle ancienne (header Builder, layout Card Search) pour atteindre 100% du mockup.

| Bloc | h |
|---|---|
| Header unifié Deck Builder (sortir du side panel) | 4 |
| Layout 2-cols Card Search standalone (extraction `<app-card-search-layout>`) | 4 |
| Deck List : header + search bar client + reorg layout | 4 |
| Confirmation suppression DS (`<app-destructive-confirm>`) | 1 |
| Tests intégration cross-écrans | 3 |

**Total Wave 2 : ~16h soit 2 jours.**

### Wave 3 — Polish + a11y
Objectif : finition + a11y complète. **Très léger après les 4 décisions Axel** (Plus joué + theme picker retirés).

| Bloc | h |
|---|---|
| Animation drag-drop CDK ambitieuse (placeholder dashed + ghost gold) | 3 |
| Variante welcome empty state | 1 |
| Audit a11y complet (focus rings, ARIA, keyboard nav) | 3 |

**Total Wave 3 : ~7h soit 1 jour.**

### Grand total Deck Flow : **~55-58h soit ~7 jours dev focus.**

Réduction de 10h vs estim initial grâce aux 4 simplifications Axel.

---

## 9. Décisions Axel — ACTÉES 2026-05-17

1. ✅ **Stat "Plus joué"** : **skip définitif**. Deck List affiche 3 KPI (Decks / Cartes possédées / Décks légaux). Pas de compteur `playCount` backend à ajouter. Économie ~3h scope.

2. ✅ **Pagination Card Search** : **scroll infini conservé**, juste afficher `N résultats` dans la toolbar (sans `page X / Y`). Économie ~2h scope.

3. ✅ **Theme deck-box** : **hash front sur `deck.id`** (5 teintes déterministes). Pas de champ back, pas de picker UI. Économie ~3.5h scope. Helper utility `pickDeckTheme(deck.id): 'gold' | 'green' | 'cyan' | 'purple' | 'rose'` via `hash(id) % 5`.

4. ✅ **Mode liste mobile Card Search** : **désactivé** sur mobile. Mobile = grille uniquement (3 cols), pas de mat-button-toggle-group GRID/LIST visible sous breakpoint 768. Économie ~2h scope.

5. ✅ **Wave découpage** : **Wave 1 puis Wave 2 séparées**. Wave 1 mergée et validée visuellement avant d'engager Wave 2 (refactor structurel header Builder + layout 2-cols Card Search).

### Impact des décisions sur les efforts §8

| Wave | Estim initial | Après décisions | Δ |
|---|---|---|---|
| **Wave 1** | 34-37h | **32-35h** | −2h (skip mode liste mobile, scroll infini conservé) |
| **Wave 2** | 17h | **17h** | inchangé |
| **Wave 3** | 13h | **6-8h** | −7h (skip Plus joué + theme picker UI) |
| **Grand total** | 64-67h | **55-60h** soit **7-8 jours** | −9h |

→ Scope réduit, Wave 3 devient légère (juste polish + a11y).

---

## 10. Validation visuelle finale

Avant de lancer Wave 1 :
1. Ouvrir `_mockups/mockup-deck-flow.html` dans un navigateur
2. Parcourir les 4 onglets dans l'ordre (Liste / Builder / Search / Détails)
3. Pour chaque écran, valider :
   - Desktop hero (1440 max)
   - Bande tablette (768 portrait + 1024 landscape pour Builder)
   - Bande mobile (3 frames de 390 + frame 360 pour Card Search)
4. En vue Détails, valider en particulier :
   - Token-select 3 états + panel ouvert
   - Active filters bar
   - Filtres dépliés (annotation animation)
   - États drag, deck invalide, hand-test, PvP loading, delete confirm
   - Composants (boutons, pills, vignettes, search-bar, deck-box, zones, inspector, art-switcher, filtres, toggle)

Tout ce qui n'est pas dans le mockup ou dans cette spec est **à reclarifier** avant impl.

---

## 11. Risques

- **Refactor header Builder** : casse compat visuelle, devra peut-être passer par un feature flag temporaire ou un changelog UX explicite. Sinon les utilisateurs perdront leurs repères.
- **Mode liste DS** : le mockup est minimal vs le composant réel (qui a icônes attribut/race, link rating, ban-badge, owned-count). Le porter à 100% côté DS demande plus de soin qu'il n'y paraît dans le mockup.
- **Drag-drop refactor** : `cdkDrag` + `cdkDropList` ont des contraintes spécifiques (e.g. `cdkDragPreviewClass`, `cdkDragPlaceholder` template). Le pattern mockup (placeholder dashed visible) demande de ne PAS utiliser `visibility: hidden` mais un template placeholder explicite. À tester tôt.
- **Inspector mobile repositioning** : le breakpoint actuel du `card-inspector` est tout-ou-rien selon `mode`. Ajouter une variante mobile flottante demande un 4e mode ou un `[isMobile]` input.
- **Bottom-sheet token-select dropdown** : le panel du token-select dans un sheet doit jongler avec le scroll lock du sheet. À tester tôt — peut nécessiter un mode "fullscreen" du token-select sur mobile (au lieu du dropdown), comparable au `mat-select` panel mobile.

---

## 12. Reprise en contexte frais

Pour reprendre ce travail dans une nouvelle session :
1. Lire `MEMORY.md` → entrées `[deck-flow-filters-spec-2026-05-17]` + `[mockup-deck-flow-2026-05-17]`.
2. Lire ce document (deck-flow-full-inventory).
3. Lire la spec filtres `deck-flow-filters-spec-2026-05-17.md`.
4. Ouvrir le mockup dans le navigateur.
5. Vérifier l'état des 5 décisions Axel pendantes (§9). Si toutes actées → démarrer Wave 1.
