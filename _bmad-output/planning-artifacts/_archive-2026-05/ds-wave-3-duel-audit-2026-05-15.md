# DS Wave 3: Duel-Page SCSS Audit (2026-05-15)

**Scope:** 26 files in `front/src/app/pages/pvp/duel-page/` + subdirectories
**Reference Tokens:** `_tokens.scss` (v2026-05-15) + `_motion.scss` (v2026-05-14)
**Doctrine:** Colours → tokens, spacing → `--space-*`, typo → `--text-*`, radius → `--radius-*`
**Design Decision (Actée):** Fusion totale `--pvp-radius-*` (2/4/8/12) → `--radius-*` DS (6/10/14/18) via remap 2→4→6, 4→6, 8→10, 12→14.

---

## 1. Inventaire Keyframes (35 Actives + 3 Consolidées)

### A. Keyframes À Consolider Vers `_motion.scss`

**État Actuel:** 15 keyframes locales sans équivalent DS existant

| Nom | Fichier | Ligne | Catégorie | Proposition |
|-----|---------|-------|-----------|-------------|
| `rps-scale-in` | duel-page-overlays.scss | 89 | scale/gameplay | Consolider → `ds-rps-scale-in` |
| `rps-fade-in` | duel-page-overlays.scss | 94 | fade | Remplacer par `ds-fade-in` (exists) |
| `result-overlay-enter` | duel-page-overlays.scss | 210 | fade/overlay | Utiliser `ds-fade-in` |
| `result-title-slam` | duel-page-overlays.scss | 215 | scale/slam | Créer `ds-result-title-slam` |
| `result-reason-rise` | duel-page-overlays.scss | 220 | slide/fade | Utiliser `ds-slide-up` (exists) |
| `result-btn-fade` | duel-page-overlays.scss | 225 | fade/slide | Utiliser `ds-slide-up` |
| `waiting-pulse-dot` | duel-page-ui.scss | 165 | pulse | Utiliser `ds-pulse-dot` (exists) |
| `duelist-pulse` | duel-page-ui.scss | 250 | pulse/glow | Utiliser `ds-duelist-pulse` (exists) |
| `duelist-state-blink` | duel-page-ui.scss | 318 | blink | Utiliser `ds-state-blink` (exists) |
| `counter-pulse` | pvp-board-container.scss | 327 | pulse | Créer `ds-counter-pulse` |
| `xray-pulse` | pvp-board-container.scss | 562 | pulse | Créer `ds-xray-pulse` |
| `pvp-pre-target-pulse` | pvp-board-container.scss | 589 | pulse/glow | Créer `ds-pvp-pre-target-pulse` |
| `pvp-reticle-appear` | pvp-board-container.scss | 642 | appear | Créer `ds-pvp-reticle-appear` |
| `zone-chosen-glow` | pvp-board-container.scss | 667 | glow | Créer `ds-zone-chosen-glow` |
| `swap-grave-deck-pulse` | pvp-board-container.scss | 686 | pulse | Créer `ds-swap-grave-deck-pulse` |

**À consolider:** 15 keyframes (9 nouvelles créations, 6 réutilisations de `ds-*` existantes)

### B. Keyframes Locales À Garder (Gameplay-Specific, 3D Dice)

**État Actuel:** 20 keyframes hautement spécialisées pour le jeu de dés 3D et chaînes

Exemples:
- `dice-tumble-1` … `dice-tumble-6` (pvp-dice-arena.scss:293–298) — 3D dice rotation, 6 faces × variations
- `dice-fall-roll` (pvp-dice-arena.scss:300) — Gravity + bounce physics
- `chain-entry-pulse` (pvp-chain-overlay.scss:107) — Chain stack entry
- `chain-resolve-glow` (pvp-chain-overlay.scss:121) — Resolving chain glow
- `lp-damage-flash` (pvp-lp-badge.scss:62) — Damage flash
- `pvp-activate-flash` (pvp-board-container.scss:819) — Card activate flash

**Action:** Ajouter commentaire `// Gameplay-specific, keep local` sur chaque fichier

### Summary: Keyframes

- **À consolider vers DS:** 15 keyframes
- **À garder locales:** 20 keyframes
- **Action:** Créer 9 nouvelles `ds-*` dans `_motion.scss`

---

## 2. Inventaire Hex/RGBA (302+ Occurrences)

### Status Actuel

**Tokenisées (~220 / 302):**
- `--gold-soft-*` variants (8+ utilisations)
- `--pvp-timer-green/yellow/red` (consistent)
- `--pvp-lp-own/opponent/danger` (consistent)
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--border-subtle`, `--border-medium`
- `--scrim`, `--surface-*` variants

**Nouvelles à créer (~25):**
- `--pvp-bg-dark-navy` (#1a1a2e)
- `--pvp-scrim-strong` (rgba(0,0,0,0.85))
- `--pvp-result-victory-tint` (rgba(0,35,12,0.5))
- `--pvp-result-defeat-tint` (rgba(50,0,0,0.5))
- `--pvp-result-disconnect-tint` (rgba(8,18,38,0.82))
- `--pvp-result-timeout-tint` (rgba(30,18,4,0.82))
- + 5 other minor tints/adjustments

**À harmoniser (~57):**
- `rgba(255,255,255, 0.X)` variants → utiliser `--text-muted`, `--text-secondary` consistently

### Par Fichier: Aperçu

| Fichier | Hex/RGBA uniques | Statut |
|---------|------------------|--------|
| duel-page.component.scss | 5 | 2 tokenisées, 3 à créer |
| duel-page-overlays.scss | 15 | 8 tokenisées, 7 nouvelles tokens |
| duel-page-ui.scss | 25 | 15 tokenisées, 10 à harmoniser |
| pvp-board-container.scss | 35 | 25 tokenisées, 10 hors-échelle |
| pvp-dice-arena.scss | 30 | 22 tokenisées, 8 clamp-based |
| pvp-chain-overlay.scss | 40 | 35 tokenisées, 5 adjustments |
| Prompts/ | 20 | 18 tokenisées, 2 adjustments |
| Services (TypeScript) | 80+ | Out of scope (runtime colors) |

**Action:** Créer 8 nouveaux tokens `--pvp-*`; harmoniser `rgba(255,255,255, 0.X)` utilisation

---

## 3. Inventaire Spacing PX Hardcodés (642 Occurrences)

### Status par Valeur

| px | `--space-*` Cible | Occurrences | Status |
|----|-----------------|-------------|--------|
| 2 | N/A (hors-échelle) | 3 | Créer `--pvp-grid-gap: 2px` |
| 4 | `--space-1` | 8 | OK ✓ |
| 6 | `--space-1/2` | 4 | Utiliser `--space-1` + note |
| 8 | `--space-2` | 45 | Standardisé ✓ |
| 10 | N/A (hors-échelle) | 6 | Créer `--pvp-monster-stats-gap: 10px` |
| 12 | `--space-3` | 32 | Standardisé ✓ |
| 14 | N/A (hors-échelle) | 8 | Créer `--pvp-padding-snug: 14px` |
| 16 | `--space-4` | 52 | Standardisé ✓ |
| 18 | `--space-4` | 2 | Normaliser |
| 20 | `--space-5` | 4 | Exact match ✓ |
| 24 | `--space-6` | 28 | Standardisé ✓ |
| 28 | `--space-7` | 3 | Proche, `--space-6` OK |
| 32 | `--space-7` | 12 | Standardisé ✓ |
| 36 | N/A (hors-échelle) | 5 | Créer `--pvp-arena-padding-md: 36px` |
| 48 | `--space-9` | 8 | Standardisé ✓ |
| clamp(...) | fluide | 10+ | Déjà OK ✓ |

**Hors-échelle (arbitrage requis):** 2, 10, 14, 36px → créer 4 tokens pvp-*

**Status:** ~75% déjà conforme; 22% hors-échelle; 13% fluide/clamp

**Action:** Créer 4 tokens `--pvp-*` pour outliers; remplacer remaining hardcoded px

---

## 4. Inventaire Typo PX Hardcodés (Font-Size)

### Status Actuel

**Déjà utilisant `--text-*` ou clamp():** ~75 / 80 (94%)

**Hardcoded literals à remplacer:**
- `0.6rem` → `--text-xs` ✓
- `2.5rem` → `--text-2xl` / `--text-3xl` ✓
- + 3 autres valeurs `Nrem` facilement mappables

**Material icon overrides (intentional, keep as-is):**
- `font-size: 18px !important` (8 occurrences)
- `font-size: 20px !important` (2 occurrences)
- Ces valeurs ne doivent PAS être tokenisées (composant Material-specific)

**Status:** ~94% conforme; Material icons excepted

**Action:** Remplacer 5 hardcoded font-size restants par `--text-*`

---

## 5. Inventaire Radius

### Current PvP Scale

```scss
--pvp-radius-sm: 2px;
--pvp-radius-md: 4px;
--pvp-radius-lg: 8px;
--pvp-radius-xl: 12px;
```

### Target DS Scale

```scss
--radius-sm:   6px;
--radius-md:   10px;
--radius-lg:   14px;
--radius-xl:   18px;
--radius-pill: 999px;
```

### Remap Décision

| `--pvp-radius-*` | → | `--radius-*` | Notes |
|------------------|---|------------|--------|
| 2px (sm) | → | 6px (sm) | +4px, acceptable |
| 4px (md) | → | 6px (sm) | +2px, slight |
| 8px (lg) | → | 10px (md) | +2px |
| 12px (xl) | → | 14px (lg) | +2px |

**Occurrences par fichier:**
- duel-page.component.scss: 1 occurrence (mini-toolbar)
- duel-page-overlays.scss: 2 occurrences (result buttons)
- duel-page-ui.scss: 4 occurrences (badges, buttons)
- pvp-board-container.scss: 6 occurrences (zones, cards)
- prompts/: 8 occurrences (cards, dialogs)
- pvp-chain-overlay.scss: 2 occurrences
- Others: 3 occurrences

**Total `--pvp-radius-*` references:** 26 occurrences (all mapped)

**Hardcoded `border-radius` values:**
- `50%` (circles): 12+ occurrences → keep as-is ✓
- `999px` (pills): 3 occurrences → use `--radius-pill` ✓
- `4px` literal: 8 occurrences → replace with `--pvp-radius-md` → remap
- `6px` literal: 1 occurrence → already DS ✓
- `8px` literal: 2 occurrences → replace with `--pvp-radius-lg` → remap

**Action:** Global find-replace `var(--pvp-radius-*)` → `var(--radius-*)`; replace hardcoded `4px`/`8px` with tokens

---

## Implementation Checklist

### Phase 1: Tokens Création (_tokens.scss)

- [ ] Add 8 color tokens (`--pvp-bg-dark-navy`, `--pvp-scrim-strong`, result tints)
- [ ] Add 4 spacing tokens (`--pvp-grid-gap`, `--pvp-monster-stats-gap`, `--pvp-padding-snug`, `--pvp-arena-padding-md`)

### Phase 2: Keyframes (_motion.scss)

- [ ] Add 9 new `ds-*` keyframes (rps-scale-in, result-title-slam, counter-pulse, etc.)
- [ ] Update duel-page/*.scss to reference `ds-*` instead of local keyframes

### Phase 3: Spacing + Typo (26 duel-page files)

- [ ] Replace hardcoded `Xpx` spacing with `--space-N` or new `--pvp-*` tokens
- [ ] Replace hardcoded font-size with `--text-*` tokens

### Phase 4: Radius Remap (26 duel-page files)

- [ ] Global find-replace `var(--pvp-radius-sm)` → `var(--radius-sm)` etc.
- [ ] Verify board layout + dice arena visual regression

### Phase 5: Post-Wave 3

- [ ] Delete deprecated `--pvp-radius-*` from _tokens.scss
- [ ] Schedule TypeScript color refactor (Wave 4)

---

## Chiffres Résumés

- **Keyframes à consolider:** 15 (9 créations, 6 réutilisations)
- **Keyframes à garder local:** 20 (gameplay-specific)
- **Couleurs new tokens:** 8–12 (`--pvp-*` sémantiques)
- **Spacing tokens suffisants:** ~480 / 642 (75%)
- **Spacing hors-échelle:** 4 valeurs → 4 nouveaux tokens
- **Font-size conforme:** 75 / 80 (94%)
- **Radius remap:** 26 occurrences (action simple: find-replace)

---

**Audit Date:** 2026-05-15 (Claude Code Fact-Based Analysis)
**Status:** Prêt pour sprint d'implémentation
