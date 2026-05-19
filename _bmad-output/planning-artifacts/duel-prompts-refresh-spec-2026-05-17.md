# Duel Prompts Refresh · Implementation Spec

**Date :** 2026-05-17
**Author :** Sally (UX Designer) + Claude review
**For :** dev agent (Amelia / `bmad-quick-dev`)
**Status :** ready to port
**Mockups de référence :**
- `_mockups/mockup-duel-in-game.html` — vue **Prompts** (13 sections + card menu)
- `_mockups/mockup-duel-themes.html` — tokens partagés pour cohérence visuelle

---

## 1. Contexte

Cette spec couvre le **DS-refresh des 13 variantes de prompts** + le
**Card Action Menu** (niveau 1 + 2). Le code Angular existe déjà : tous
les composants sont en place et fonctionnels. La refonte est **purement
visuelle** (remap des valeurs hardcodées vers les tokens DS), aucun
changement de structure ni de logique métier.

**Cible :** 12 fichiers SCSS sous `front/src/app/pages/pvp/duel-page/prompts/`,
~225 occurrences hardcodées (px / rgba / hex) à remplacer par tokens DS.

**Hors scope explicite :**
- Logique métier (PromptDerivationService, AUTO_SELECT, registry, response
  flow) — intacte.
- Refonte structurelle des composants TS — sélecteurs Angular conservés.
- Surrender dialog + Result overlay → spec séparée
  `duel-end-flow-spec-2026-05-17.md`.
- Phase pill + Timer → spec
  `duel-board-enrichment-spec-2026-05-17.md` (déjà validée).

---

## 2. Inventaire des 13 variantes

| # | Variante | Composant Angular | Selector |
|---|---|---|---|
| 1 | Yes / No | `PromptYesNoComponent` | `app-prompt-yes-no` |
| 2 | Option List | `PromptOptionListComponent` | `app-prompt-option-list` |
| 3 | Card Grid — Select Target | `PromptCardGridComponent` | `app-prompt-card-grid` |
| 4 | Card Grid — Select Sum | `PromptCardGridComponent` (variante) | idem |
| 5 | Sort Card | `PromptSortCardComponent` | `app-prompt-sort-card` |
| 6 | Position Select | `PromptPositionSelectComponent` | `app-prompt-position-select` |
| 7 | Numeric — Counter | `PromptNumericInputComponent` (mode counter) | `app-prompt-numeric-input` |
| 8 | Numeric — Declare Attribute | `PromptNumericInputComponent` (mode declare) | idem |
| 9 | Numeric — Multi-Counter | `PromptNumericInputComponent` (mode multi) | idem |
| 10 | Announce Card | `PromptAnnounceCardComponent` | `app-prompt-announce-card` |
| 11 | Passive — Waiting / Action summary | `PromptActionListReadonlyComponent` + passive | `app-prompt-action-list-readonly` |
| 12 | Zone Highlight (floating) | `PromptZoneHighlightComponent` | `app-prompt-zone-highlight` |
| 13 | Shell states (Collapsed / Sending) | `PvpPromptDialogComponent` (host) | `app-pvp-prompt-dialog` |

Le **shell host** (`PvpPromptDialogComponent`) porte les états Collapsed
et Sending (variante 13), ainsi que le hint-header, le collapse-handle
et le portal-container. Les 12 autres sont des sub-components rendus
via `CdkPortalOutlet`.

Mapping types-de-prompts → composants : voir `prompt-registry.ts` (16
types WS → 7 composants). Aucun changement à cette table.

---

## 3. Refresh visuel — règles communes

### 3.1 Substitutions globales

À appliquer dans **tous** les SCSS prompts :

| Pattern hardcodé | Remplacement DS |
|---|---|
| `rgba(15, 23, 42, 0.92)` (dialog bg) | `var(--pvp-prompt-dialog-bg)` → définir dans `_tokens.scss` à `var(--overlay-strong)` |
| `rgba(255, 255, 255, 0.05)` (hover bg) | `var(--surface-hover)` (à ajouter au DS si absent) ou `rgba(255, 255, 255, 0.05)` toléré si **strictement** local |
| `rgba(255, 255, 255, 0.08)` / `0.10` / `0.15` (borders soft) | `var(--border-soft)` / `var(--border-medium)` |
| `#c9a84c` / `#C9A84C` | `var(--gold)` |
| `#ffe9a8` | `var(--gold-50)` |
| `rgba(201, 168, 76, 0.20)` etc. | `var(--gold-soft-20)` / `--gold-soft-30` / `--gold-soft-50` |
| `4px` / `6px` / `8px` / `12px` / `16px` (spacing) | `var(--space-1)` / `--space-2` / `--space-3` / `--space-4` |
| `0.625rem` / `0.6875rem` (font-size xs) | `var(--text-xs)` |
| `0.75rem` / `0.8125rem` (font-size sm) | `var(--text-sm)` |
| `0.9375rem` (font-size md) | `var(--text-md)` |
| `1rem` / `1.125rem` (font-size lg) | `var(--text-lg)` |
| `150ms` / `200ms` / `250ms` (transitions) | `var(--transition-fast)` / `--transition-normal` |
| `cubic-bezier(0.25, 0.8, 0.25, 1)` | `var(--ease-out)` |
| `border-radius: 4px` (card slot) | `var(--radius-sm)` — voir note Wave 3 ci-dessous |
| `border-radius: 0.75rem` (dialog) | `var(--radius-md)` |
| `border-radius: 999px` (pill) | `var(--radius-pill)` |
| `z-index: 80` etc. | `z.$z-pvp-prompt-sheet` (déjà utilisé) — **jamais** de littéral |

> **Alignement Wave 3 — radius :** l'audit Wave 3
> (`ds-wave-3-duel-audit-2026-05-15.md`) acte la **fusion**
> `--pvp-radius-sm/-md` → `--radius-sm/-md`. Ne pas réintroduire
> `var(--pvp-radius-md)` dans le refresh prompts. Pour les card-slots et
> les card-frames vintage (corners ronds discrets ≤ 6px), utiliser
> `var(--radius-sm)` (6px) qui couvre exactement le besoin. Aucun
> nouveau token `--pvp-radius-*` à créer.

**Drapeau rouge :** toute valeur hardcodée restante après refresh = à
justifier explicitement dans le commit (geometry locale d'un composant
unique = OK, sinon refus).

### 3.2 Touch targets

Tous les boutons interactifs doivent atteindre `var(--touch-target-min)`
(44px). Audit critique :

- **Yes/No** : btn min-height 36px → **48px** (DS-shift assumé, validé
  mockup).
- **Option-item** : tap area ≥ 44px (souvent déjà OK via padding).
- **Stepper** circle : 48×48 (touch-target-primary).
- **Mini-stepper** (multi-counter) : 32×32 — sous le min, mais validé
  car contexte secondaire (incrément/décrément accessoire). À conserver.
- **Card-slot** dans grids : largeur native (74×105 portrait) — au-dessus
  du min.

### 3.3 Animations / a11y

- `prefers-reduced-motion: reduce` désactive les pulses (`passive-content--waiting`,
  `sending-indicator`).
- `focus-visible` : outline `var(--gold)` 2px partout (déjà en place
  dans le shell, propager aux sub-components).

---

## 4. Détails par composant

### 4.1 Shell — `PvpPromptDialogComponent`

**SCSS :** `pvp-prompt-dialog.component.scss` (39 hardcoded occurrences)

Cibles :
- `bottom: 8dvh` → conserver (geometry de positionnement, légitime)
- `width: var(--pvp-prompt-dialog-width, 50dvw)` → token déjà fallback, OK
- `background: rgba(15, 23, 42, 0.92)` → `var(--pvp-prompt-dialog-bg, var(--overlay-strong))`
- `border-radius: 0.75rem` → `var(--radius-md)`
- `.collapse-handle` : 24×24 → garder (sous touch-target mais visuel sobre,
  pas un control principal — à valider visuellement)
- Couleurs `var(--text-secondary, #9e9e9e)` → retirer le fallback hex
  (le token est garanti défini dans `_tokens.scss`)
- `.hint-header` border-bottom `rgba(255,255,255,0.1)` → `var(--border-soft)`
- `.collapsed-bar` et `.sending-indicator` (variante 13) : padding +
  font-size en tokens

### 4.2 Yes/No

**SCSS :** `prompt-yes-no.component.scss` (2 hardcoded, quasi déjà DS)

- Vérifier que `.buttons` utilise `gap: var(--space-3)` et `flex: 1`
  par bouton.
- Boutons `.btn--primary` / `.btn--secondary` doivent venir d'un mixin
  ou utilitaire DS partagé (`_prompt-btn.scss`), pas redéfinis localement.

### 4.3 Option List

**SCSS :** `prompt-option-list.component.scss` (16 hardcoded)

- `.option-item` : hover bg → `var(--surface-hover, rgba(255,255,255,0.05))`
- `.option-item--selected` : bg `var(--gold-soft-20)` + border `var(--gold)`
- Revealed-cards strip : padding + gap en tokens
- Icône option (emoji) : `font-size: var(--text-md)`

### 4.4 Card Grid (Target + Sum)

**SCSS :** `prompt-card-grid.component.scss` (35 hardcoded — plus gros chantier)

- `.card-strip` : gap entre zone-groups → `var(--space-4)`
- `.zone-group__badge` : background `var(--overlay-strong)`, icon size
  `var(--text-lg)`
- `.card-slot` : `transition: transform var(--transition-fast) var(--ease-out)`
- `.card-slot--selected` : scale 1.05 (geometry locale, OK), glow
  `0 0 12px var(--gold-soft-50)`
- `.selection-count` : font-size `var(--text-sm)`, color `var(--text-secondary)`
- `.selection-count--ready` (variante Sum) : color `var(--success)`
- `.card-slot__amount-badge` (Sum) : bg `var(--gold)`, text `var(--text-inverse)`,
  font-size `var(--text-xs)`, border-radius `var(--radius-pill)`

### 4.5 Sort Card

**SCSS :** `prompt-sort-card.component.scss` (15 hardcoded)

- `.sort-card-strip` : justify-content center, gap `var(--space-3)`
- `.card-slot__rank` (cercle gold 24×24) : bg `var(--gold)`, color
  `var(--text-inverse)`, font-weight `var(--weight-bold)`
- `.card-slot--last:hover` : border-color red discret —
  `var(--danger-strong)` avec opacity 0.6 (sémantique "dernier slot,
  remove peu sûr")

### 4.6 Position Select

**SCSS :** `prompt-position-select.component.scss` (32 hardcoded)

- `.position-card__slot` : 105×105 fixe (geometry locale, OK)
- `.position-card__frame` : 72×105 (portrait) ou 105×72 (rotated) —
  geometry, OK
- `.position-card__img.rotated` : `transform: rotate(-90deg) translate(...)` —
  conserver (animation parity-safe, pas dans le travel layer)
- `.position-card--selected` : border `var(--gold)`, glow
  `0 0 8px var(--gold-soft-50)`
- `.position-card__label` : `var(--text-sm)` `var(--font-display)`

### 4.7 Numeric Input (3 modes)

**SCSS :** `prompt-numeric-input.component.scss` (51 hardcoded — **le plus gros**)

- **Mode counter** :
  - `.stepper-btn` : 48×48, border-radius `var(--radius-pill)`,
    bg `var(--surface-hover)`, hover bg `var(--gold-soft-20)`
  - `.stepper-value` : `var(--text-xl)` `var(--gold)` `var(--font-mono)`
    (tabular-nums)
  - `.label` : `var(--text-sm)` `var(--text-secondary)`
- **Mode declare** (Attribute) :
  - `.option-btn` : min 48×48, padding `var(--space-2) var(--space-4)`
  - `.option-btn--selected` : bg `var(--gold)`, color `var(--text-inverse)`
  - Hover : border `var(--gold)`
- **Mode multi-counter** :
  - `.multi-counter__status` : `var(--text-sm)` `var(--text-secondary)`
    (ex. "3 / 5")
  - `.multi-counter__card` : largeur fixe 96px (geometry, OK)
  - `.mini-stepper` : 32×32 (validé sous touch-min, secondaire)
  - `.mini-stepper__value` : `var(--text-md)` `var(--font-mono)`
  - `.mini-stepper__btn` : font-size `var(--text-lg)`

### 4.8 Announce Card

**SCSS :** `prompt-announce-card.component.scss` (14 hardcoded)

- `.search-box` : bg `var(--overlay-strong)`, border `var(--border-medium)`
- `.search-input` : focus border `var(--gold)`, padding `var(--space-2) var(--space-3)`
- `.announce-card-strip` : horizontal scrollable, gap `var(--space-2)`,
  appliquer la convention **Ghost scrollbar**
  ([project_ghost_scrollbar_convention](memory)) : `@include ghost-scroll`
- `.card-slot--selected` : même glow gold que card-grid

### 4.9 Passive / Action Summary

**SCSS :** `prompt-action-list-readonly.component.scss` (5 hardcoded)

- `.passive-content--waiting` : `animation: pulse 1.5s ease-in-out infinite`
  (déjà présent, vérifier `prefers-reduced-motion`)
- `.passive-title` : `var(--text-lg)` `var(--font-display)`
- `.action-label` : `var(--text-sm)` `var(--gold)` uppercase
- `.action-card-name` : `var(--text-md)` `var(--text-primary)`

### 4.10 Zone Highlight (floating)

**SCSS :** `prompt-zone-highlight.component.scss` (4 hardcoded, quasi DS)

- `.floating-instruction` : centré, bg `var(--overlay-strong)`, backdrop
  `blur(2px)`, font `var(--font-display)` `var(--weight-bold)`
- Fallback `@supports not (backdrop-filter: blur())` : bg opaque
  `var(--overlay-strong)`

### 4.11 Card Action Menu

**Location :** inline dans `duel-page.component.html` (lignes 281+) +
SCSS dans `duel-page-ui.scss`.

**Décision d'extraction :** rester inline pour ce sprint (géré par
`pvp-board-container` ou parent). Pas d'extraction en composant
séparé — geometry locale + couplage fort avec les triggers de zone.

Cibles SCSS :
- `.card-action-menu` : popover, padding `var(--space-1) 0`, min-width
  140px, bg `var(--overlay-strong)`, border `var(--border-medium)`,
  border-radius `var(--radius-md)`, shadow `var(--elevation-2)`
- `.card-action-menu__item` : min-height `var(--touch-target-min)`,
  padding `var(--space-2) var(--space-3)`, font `var(--text-sm)`
- Hover : bg `var(--surface-hover)`
- `.card-action-menu__item--group` : flex space-between, arrow `▶`
  color `var(--text-muted)`
- **Niveau 2 sub-effects** :
  - `.card-action-menu__sub-header` : border-bottom `var(--border-soft)`,
    padding `var(--space-2) var(--space-3)`
  - `.card-action-menu__back` : `← Back` link, color `var(--gold)`,
    font `var(--text-sm)`
  - `.card-action-menu__item--effect` : 2 lignes (num + desc), num
    `var(--text-sm)` `var(--gold)`, desc `var(--text-xs)` `var(--text-secondary)`

---

## 5. Tokens à ajouter au DS (si manquants)

Audit vérifié 2026-05-17 contre `front/src/app/styles/_tokens.scss` :

| Token | Statut | Notes |
|---|---|---|
| `--surface-hover` | ✅ EXISTE (`_tokens.scss:210`, valeur `rgba(255,255,255,0.06)`) | Utiliser tel quel — la valeur réelle est `0.06` pas `0.05` comme tabulé en §3.1, ajuster mentalement |
| `--overlay-strong` | ❌ **N'EXISTE PAS** — bloquant Sprint 1 | **Prérequis** : à créer dans `_tokens.scss`, valeur `rgba(15, 23, 42, 0.92)` (= valeur actuelle de `--pvp-prompt-dialog-bg`) |
| `--pvp-prompt-dialog-bg` | ✅ EXISTE (`_tokens.scss:349`) | Une fois `--overlay-strong` ajouté, repointer : `--pvp-prompt-dialog-bg: var(--overlay-strong);` |
| `--gold-soft-20/30/50` | ✅ EXISTE | OK |
| `--border-soft/-medium` | ✅ EXISTE | OK |
| `--text-xs/sm/md/lg/xl` | ✅ EXISTE | clamp() fluides |
| `--space-1..10` | ✅ EXISTE | OK |
| `--radius-sm/-md/-pill` | ✅ EXISTE | Utiliser à la place de `--pvp-radius-*` (Wave 3) |
| `--transition-fast/-normal/-slow` | ✅ EXISTE | OK |
| `--ease-out` | ✅ EXISTE | OK |
| `--font-display/-body/-mono` | ✅ EXISTE | OK |
| `--success/-warning/-danger-strong` | ✅ EXISTE | OK |
| `--text-inverse` | ✅ EXISTE | OK |
| `--touch-target-min` (44px) | ✅ EXISTE | OK |
| `--weight-bold/-semibold` | ✅ EXISTE | OK |
| `--opacity-disabled` (0.4) | ✅ EXISTE | À préférer aux fallbacks `0.6` ou `0.5` |

**Action bloquante Sprint 0 (commune aux 3 specs) :** ajouter
`--overlay-strong: rgba(15, 23, 42, 0.92);` dans `_tokens.scss`
avant tout autre refresh. Sans ce token, ~10 sélecteurs de cette spec
+ les radial tints d'`end-flow` cassent.

---

## 6. Contraintes architecturales

### 6.1 Animation Parity

Aucune. Les prompts ne sont pas touchés par l'orchestrator. Refresh
CSS-only.

### 6.2 Replay Parity

Les prompts n'existent pas en replay (read-only, pas d'interaction).
Vérifié : aucun `<app-pvp-prompt-dialog>` dans `front/src/app/pages/pvp/replay/`.

### 6.3 i18n

Tous les libellés viennent déjà de `ngx-translate` (clés `duel.prompt.*`,
`common.*`). Le refresh ne touche pas les clés. Si une chaîne hardcodée
est trouvée dans un template, c'est un bug à corriger en passage.

### 6.4 DS Token Doctrine

Strict respect de [project_ds_token_doctrine](memory) :
- Couleurs/gradients → toujours tokens
- Spacing → toujours `--space-*`
- Geometry de composant unique (105×105 position card, 72×96 card slot)
  → local autorisé
- Pas de nouveau token `--prompt-*` à créer (déjà couvert par
  `--pvp-prompt-dialog-*` existants + DS générique)

---

## 7. Checklist de test en vrai

### Variantes (rendu visuel)
- [ ] Toutes les 13 variantes affichent correctement avec le refresh
- [ ] `--gold-soft-*` glow visible sur selected (card-slot, option-item,
  position-card)
- [ ] Boutons primary/secondary cohérents avec le reste du DS skytrix
- [ ] Search input (Announce Card) focus state gold visible
- [ ] Multi-counter mini-stepper reste utilisable (taille 32px)
- [ ] Stepper-value mono-font tabular-nums (pas de saut largeur sur "9" → "10")

### Interactions
- [ ] Touch targets ≥ 44px sur Yes/No, Option List, Position Select,
  Numeric Counter, Card Action Menu items
- [ ] Hover states cohérents (bg `--surface-hover`, border `--gold`)
- [ ] focus-visible outline gold partout
- [ ] Sending state (variante 13) disable bien tous les boutons +
  affiche indicator gold sous portal

### Card Action Menu
- [ ] Popover positionné correctement vs carte cliquée
- [ ] Niveau 2 (sub-effects) lisible avec num gold + desc gris
- [ ] Back ← retourne au niveau 1 sans fermer le menu

### A11y
- [ ] `prefers-reduced-motion: reduce` désactive le pulse passif
- [ ] `aria-label` conservés (déjà OK, pas modifiés)
- [ ] focus-visible visible dans tous les sub-components

### Replay
- [ ] N/A — prompts inexistants en replay (vérifié 2026-05-17)

---

## 8. Recommandations d'ordre de travail

**Sprint 0 — Prérequis cross-specs (1 jour, partagé avec board + end-flow) :**
1. Ajouter `--overlay-strong: rgba(15, 23, 42, 0.92);` dans `_tokens.scss`
2. Repointer `--pvp-prompt-dialog-bg: var(--overlay-strong);`
3. Créer `DuelDevHubComponent` (coquille + onglets vides) + `DuelDevStateService`
   (cf `duel-board-enrichment-spec` §8) — owner cross-specs

**Sprint 1 — Tokens + shell (1-2 jours) :**
1. Refresh `pvp-prompt-dialog.component.scss` (shell + variante 13)
2. Refresh `_prompt-btn.scss` + `_prompt-card.scss` (partials partagés)
3. Vérifier que `_prompt-btn.scss` / `_prompt-card.scss` ne sont
   consommés QUE par les sub-components prompts (`grep -r` avant refactor)
4. Implémenter onglet Prompts du hub avec 5 fixtures (Y/N, Option List,
   Card Grid Target, Numeric Counter, Passive Waiting)

**Sprint 2 — Sub-components batch 1 (2 jours) :**
1. Yes/No (trivial, 2 occurrences)
2. Option List
3. Sort Card
4. Passive / Action Summary
5. Zone Highlight

**Sprint 3a — Sub-components batch 2.1 (1-2 jours) :**
1. Card Grid (Target + Sum)
2. Numeric Input (3 modes : counter, declare, multi-counter)

**Sprint 3b — Sub-components batch 2.2 (1-2 jours) :**
1. Position Select
2. Announce Card (avec ghost scrollbar)

**Sprint 4 — Card Action Menu + polish (1 jour) :**
1. Refresh inline dans `duel-page-ui.scss`
2. Tests d'intégration sur les triggers

Total estimé : **7-9 jours** (1 dev). Sprint 0 partagé compte une
seule fois sur les 3 specs. Parallélisation possible entre Sprint 2 et
Sprint 3a si 2 devs.

---

## 9. Dev Hub — onglet Prompts (extension de `duel-board-enrichment-spec` §8)

**Owner du hub :** `duel-board-enrichment-spec-2026-05-17.md` §8. Cette
section décrit **uniquement l'onglet Prompts** + ses fixtures.

### 9.1 Composant onglet

**Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/tabs/prompts-tab.component.{ts,html,scss}`

**Selector :** `app-duel-dev-hub-prompts-tab`

Rendu uniquement quand l'onglet `Prompts` est actif dans le hub. Aucun
gating ni listener clavier indépendant — le hub parent gère ça.

### 9.2 Signal `forcedPrompt` consommé via `override()`

Le service `DuelDevStateService` (§8.3 spec board) expose déjà
`forcedPrompt: WritableSignal<Prompt | null>`. Le composant
`PvpPromptDialogComponent` consomme via le helper unifié :

```ts
private readonly devState = inject(DuelDevStateService);

readonly effectivePrompt = computed(() =>
  this.devState.override(this.devState.forcedPrompt, () =>
    this.wsService.pendingPrompt()
  )
);
```

**Note prod-safety :** en prod, `forcedPrompt.set()` est neutralisé par
la factory `_signal()` du service (cf §8.3 spec board) → le signal reste
à `null` → `override()` retourne toujours le real `pendingPrompt()`.
Zéro impact sur le data flow réel.

### 9.3 Contrôles — Catégorie F (variantes prompt)

Liste verticale de 15 entrées (13 prompt types + 2 shell states) :

```
[ Y/N              ] [ Show ]
[ Option List      ] [ Show ]
[ Card Grid Target ] [ Show ]
[ Card Grid Sum    ] [ Show ]
[ Sort Card        ] [ Show ]
[ Position Select  ] [ Show ]
[ Numeric Counter  ] [ Show ]
[ Numeric Declare  ] [ Show ]
[ Numeric Multi    ] [ Show ]
[ Announce Card    ] [ Show ]
[ Passive Waiting  ] [ Show ]
[ Action Summary   ] [ Show ]
[ Zone Highlight   ] [ Show ]
[ Shell Collapsed  ] [ Show ]
[ Shell Sending    ] [ Show ]
─────────────────────────────
[ Hide all (reset) ]
```

Action `Show` : `devState.forcedPrompt.set(fixture)`. `Hide all` :
`devState.forcedPrompt.set(null)`.

### 9.4 Catégorie G — Passive mock

Quand variant `Passive Waiting` ou `Action Summary` est actif, sous-toggle :

- ☐ `Custom title` (input texte) → permet de tester le wrap long
- ☐ `Pulse on/off` → désactive l'animation pour screenshot

(implémenté par modification directe de la fixture envoyée, pas via
nouveau signal sur le service)

### 9.5 Fixtures — pattern factory + réutilisation des specs

**Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/tabs/prompt-fixtures.ts`

**Anti-pattern à éviter :** 15 fixtures complètes inlinées = ~300-400
lignes de mock data qui dérivent silencieusement quand le type `Prompt`
évolue.

**Pattern factory** :

```ts
import { Prompt } from '../../../types';

type PromptType = Prompt['type'];

// Factory : crée un prompt valide minimal pour un type donné.
// Le caller fournit les overrides spécifiques au scénario.
export function makePrompt<T extends PromptType>(
  type: T,
  overrides: Partial<Prompt> = {},
): Prompt {
  const base: Prompt = {
    type,
    hintContext: { type: 'generic', text: `${type} prompt` },
    data: {} as Prompt['data'],
    ...overrides,
  };
  return base;
}

// Fixtures : déclaratives, courtes, lisent comme une story.
export const FIXTURE_YES_NO = makePrompt('SELECT_YESNO', {
  hintContext: { type: 'activate', cardName: 'Branded Fusion', cardCode: 12345 },
});

export const FIXTURE_CARD_GRID_TARGET = makePrompt('SELECT_CARD', {
  hintContext: { type: 'target', count: 2, where: 'on the field' },
  data: {
    cards: [/* 5 cartes mock — réutiliser MOCK_CARDS du spec test */],
    min: 2,
    max: 2,
  },
});

// ... 15 fixtures
```

**Réutilisation des mocks existants :** les `*.spec.ts` sous
`prompts/**/` ont déjà des mocks de cartes / hintContext / etc.
Auditer avant d'écrire de nouveaux mocks (cf
`pvp-prompt-dialog.component.spec.ts`, `prompt-card-grid.component.spec.ts`,
etc.). Idéalement, exporter ces mocks depuis un fichier partagé
`prompts/test-mocks.ts` que le dev hub et les specs unit consomment
ensemble — single-source.

### 9.6 Critères qualité

Identique aux autres onglets du hub (§8.5 spec board) :
- Pas de tests unitaires (jetable)
- Marquer chaque fichier : `// DEV ONLY — to be removed before final ship.`
- State in-memory uniquement

### 9.7 Ordre de livraison

1. **Sprint 1 Prompts** : implémenter l'onglet avec 5 fixtures (Y/N,
   Option List, Card Grid Target, Numeric Counter, Passive Waiting).
2. **Sprint 2-3** : enrichir avec les 10 autres fixtures au fur et à
   mesure que les composants sont refresh.
3. **Sprint 4** : onglet complet, validation finale.
4. **Après ship complet (3 specs)** : suppression du dossier
   `duel-dev-hub/` (intégral) — cf §8.6 spec board.

---

## 10. Points ouverts

- **Refresh `_prompt-card.scss` / `_prompt-btn.scss`** : ces partials
  sont-ils consommés ailleurs que dans les sub-components prompts ?
  À vérifier (`grep -r '_prompt-btn\|_prompt-card' front/src/app/styles/`)
  avant refactor pour éviter regression cross-composant. **Sprint 1
  prereq.**
- **Card Action Menu — extraction future ?** Si une 2ᵉ surface
  (deck-builder, simulator) en a besoin, extraire en composant
  partagé. Pour l'instant, in-line dans `duel-page-ui.scss` suffit.
- **Mocks partagés specs unit ↔ dev hub** : valider la pertinence du
  fichier `prompts/test-mocks.ts` partagé. Bénéfice = single-source ;
  risque = couplage dev/test. À trancher au Sprint 1.

---

## 11. Refs

- Mockup prompts : `_mockups/mockup-duel-in-game.html` (vue Prompts +
  vue Composants)
- DS tokens : `front/src/app/styles/_tokens.scss`
- DS doctrine : [project_ds_token_doctrine](../../C:\Users\Axel\.claude\projects\c--Users-Axel-Desktop-code-skytrix\memory\project_ds_token_doctrine.md)
- Ghost scrollbar : [project_ghost_scrollbar_convention](../../C:\Users\Axel\.claude\projects\c--Users-Axel-Desktop-code-skytrix\memory\project_ghost_scrollbar_convention.md)
- Wave 3 audit : `_bmad-output/planning-artifacts/ds-wave-3-duel-audit-2026-05-15.md`
- Spec liée : `duel-board-enrichment-spec-2026-05-17.md`
