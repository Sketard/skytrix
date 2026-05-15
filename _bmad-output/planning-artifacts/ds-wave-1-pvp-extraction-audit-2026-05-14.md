---
title: DS Wave 1 — Audit d'extraction du code PvP shippé
author: Sally (UX Designer) + Axel
date: 2026-05-14
status: APPROVED — recommandations case-by-case prêtes
scope: Audit du code PvP shippé (lobby + waiting room + dice arena + composants partagés) pour identifier les patterns mûrs à intégrer dans DS Wave 1
sources:
  - front/src/app/pages/pvp/lobby-page/ (shipped 2026-05-13)
  - front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.scss
  - front/src/app/pages/pvp/duel-page/duel-page-ui.scss (waiting room READY state, shipped 2026-05-13)
  - front/src/app/pages/pvp/duel-page/pvp-dice-arena/pvp-dice-arena.component.scss
  - front/src/app/shared/ (avatar, error-banner, bottom-sheet-handle, orientation-lock, skel/, die/)
  - front/src/app/components/ (17 composants — audit placement shared/ vs components/)
related:
  - _bmad-output/planning-artifacts/ds-wave-1-spec-2026-05-14.md
  - _bmad-output/planning-artifacts/replay-hub-rework-2026-05-14.md
  - _bmad-output/planning-artifacts/replay-viewer-rework-2026-05-14.md
---

# DS Wave 1 — Audit d'extraction PvP shippé

## Préambule

L'objectif de cet audit est de **vérifier que la spec DS Wave 1** couvre bien les patterns visuels déjà shippés (donc validés en prod) du PvP. **Quick win scope** : lobby + waiting room + dice arena (cf. mémoire `project_pvp_lobby_rework_plan` shipped 2026-05-13).

**Méthodologie** :
1. Grep des selectors SCSS racine dans chaque fichier
2. Croisement avec la spec DS Wave 1 (§2.1 → §2.12)
3. Identification des patterns **mûrs** (consommés en prod, validés) qui devraient remonter au DS
4. Classification case-by-case : **Promote Wave 1** / **Differ Wave 1.5** / **Keep local** / **Component candidate**

**Statistiques de l'audit** :
- 4 fichiers SCSS audités : 2902 lignes
- 49 keyframes identifiées (dont 4 duplicates avérés)
- 17 composants `components/` vs 6 `shared/`
- 0 token custom local (`--lobby-*` / `--waiting-*`) — tous les composants consomment `_tokens.scss` global ✅

---

## 1. Résultat global

### Bilan de couverture spec DS Wave 1 vs patterns shippés

| Pattern shippé | Couvert par DS Wave 1 ? | Source PvP | Action |
|---|---|---|---|
| `.lobby-cta--primary` (gold gradient + shimmer animation) | ⚠️ Partiel (shimmer manquant) | lobby:141-168 | **Étendre `_buttons.scss`** — ajouter `.btn--primary.btn--cta-shimmer` |
| `.lobby-cta--solo` (cyan stroked) | ✅ Couvert | lobby:170-180 | `.btn--secondary.btn--lg.btn--cta` |
| `.lobby-section-header` (titre + count + accent bar) | ✅ Couvert | lobby:193-227 | `.section-header` (spec §2.11) |
| `.lobby-section-count` (gold badge) | ✅ Couvert | lobby:229-236 | `.badge.badge--gold` (spec §2.6) |
| `.lobby-section-filter` (button ghost sort/filter) | ✅ Couvert | lobby:244-276 | `.btn.btn--ghost.btn--sm` |
| `.lobby-search-bar` + clear | ✅ Couvert | lobby:286-344 | `.search-bar` (spec §2.9) |
| `.room-card` (surface + accent + hover) | ✅ Couvert | lobby:382-461 | `.surface-card.surface-card--interactive.surface-card--accent-gold` |
| `.room-card--new` (entrée animation) | ❌ Manquant | lobby:443-445, keyframe 553 | **Ajouter dans `_motion.scss`** — `ds-card-entry` + utility `.card-entry` |
| `.room-admin-badge` (avatar shield) | ❌ Manquant | lobby:474-496 | **Component candidate** — `<app-avatar-badge>` (Wave 2 si 2+ consumers) |
| `.room-admin-delete` (icon-btn ghost + danger hover + hover-revealed desktop) | ✅ Couvert | lobby:501-551 | `.icon-btn.icon-btn--md.icon-btn--danger.icon-btn--ghost-hover-only` |
| `.room-status-dot` (pulse animation) | ❌ Manquant — pattern récurrent | lobby (+ duel-page-ui:147-164 pulse-dot) | **Promote Wave 1** — `<app-status-dot>` ou utility `.pulse-dot` dans `_motion.scss` |
| `.alpha-chip` (badge alpha/beta) | ❌ Spécifique | lobby:85-96 | **Keep local** (1 consommateur, sémantique très spécifique) |
| `.waiting-status-tag` (gold pill + pulse-dot intégré) | ⚠️ Partiel (`.pill--gold` couvre, mais pas l'intégration pulse-dot) | duel-page-ui:134-165 | **Étendre `_pills.scss`** — ajouter `.pill--live` (modifier qui inclut pulse-dot via `::before`) |
| `.waiting-title` (gradient gold direct) | ✅ Couvert | duel-page-ui:172-183 | `.text-gold-gradient` (spec §2.3) |
| `.waiting-back-btn` (ghost button vertical) | ✅ Couvert | duel-page-ui:108-132 | `.btn.btn--ghost.btn--sm` |
| `.room-code-value` (monospace gold display) | ❌ Manquant — pattern réutilisable | duel-page-ui:375-393 | **Promote Wave 1** — `.text-code` utility dans `_typography.scss` |
| `.code-copy-btn` (gold pill button avec état "copied") | ⚠️ Partiel (`.btn--primary` couvre, mais pas l'état success) | duel-page-ui:395-434 | **Étendre `_buttons.scss`** — ajouter `.btn--success-flash` modifier (transition vers success-soft pendant 2s) |
| `.code-action-btn` (icon button square) | ✅ Couvert | duel-page-ui:436-460 | `.icon-btn.icon-btn--lg` |
| `.duelist-state` (eyebrow + blink waiting) | ⚠️ Partiel | duel-page-ui:299-323 | `.text-eyebrow` couvre + ajouter utility `.is-blinking` dans `_motion.scss` |
| `.dice-screen-tag` (gold pill animé) | ✅ Couvert | dice-arena:45-60 | `.pill.pill--gold` |
| `.dice-screen-title` (gradient gold) | ✅ Couvert | dice-arena:61-72 | `.text-gold-gradient` |
| `.dice-launch-btn` (cta primary lg) | ✅ Couvert | dice-arena:471-507 | `.btn.btn--primary.btn--cta.btn--lg` |
| Dice tumble / fall / spin keyframes | ❌ N/A — domain-specific | dice-arena:248-647 | **Keep local** (3D scene, pas utility transverse) |
| `.deck-card` (deck-picker dialog) | ⚠️ Partiel | deck-picker-dialog:518 | `.surface-card.surface-card--interactive` + spécificités layout deck |
| `.qd-toggle` / `.qd-row` / `.qd-slider` (quick-duel options dialog) | ❌ Spécifique dialog | deck-picker-dialog | **Keep local** (settings forms, pas utility transverse) |
| `.replay-chosen-pulse` keyframe **DUPLIQUÉE 4× ** | ❌ Manquant (dette consolidation) | prompts/* | **Promote Wave 1** — `ds-chosen-pulse` dans `_motion.scss` + utility `.is-chosen` |
| `chain-badge-pulse` keyframe **DUPLIQUÉE 2×** | ❌ Manquant (dette consolidation) | pvp-board-container + pvp-hand-row | **Promote Wave 1** — `ds-chain-badge-pulse` dans `_motion.scss` |
| `.connecting-fallback` (loading skeleton + spinner) | ⚠️ Couvert différemment | duel-page-ui:652-666 | Migrable vers `<app-skel>` composite Wave 2 |

### Résumé décisionnel

| Catégorie | Compteur | Action |
|---|---|---|
| ✅ **Couvert par DS Wave 1** | 13 patterns | Migrer au passage F0 avec les classes DS (rien à ajouter à la spec) |
| ⚠️ **Étendre DS Wave 1** | 5 patterns | **+1h** ajouts à F0 Hub — modifiers et variants à ajouter (cf. §2 ci-dessous) |
| 🆕 **Promote Wave 1 (nouveaux ajouts)** | 4 patterns | **+1h** ajouts à F0 Hub — `pulse-dot`, `.text-code`, `ds-chosen-pulse`, `ds-chain-badge-pulse` |
| 🔮 **Component candidate Wave 2** | 2 patterns | `<app-avatar-badge>`, `<app-status-dot>` (Wave 2 si 2-3+ consumers) |
| 🧊 **Keep local** | 5 patterns | Domain-specific ou 1 consommateur (alpha-chip, qd-*, dice tumble, etc.) |

**Effort additionnel Wave 1 Hub** : **+2h** (passage F0 : 9h → 11h).

---

## 2. Détail des extensions/ajouts à la spec DS Wave 1

### 2.1 Étendre `_buttons.scss` (spec §2.5)

#### `.btn--cta-shimmer` modifier (NEW)

**Source** : `.lobby-cta--primary` (lobby:150-158) — shimmer animation overlay sur le CTA gold.

**Quand** : CTAs primary "wow" (lobby Create Room, Hub empty CTA "Play PvP", waiting room "Start Duel"). **Pas** sur les boutons utilitaires.

**Inventaire** :
```scss
.btn--cta-shimmer {
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
```

**Keyframe** (à ajouter dans `_motion.scss` §2.2) :
```scss
@keyframes ds-cta-shimmer {
  0%, 100% { background-position: 200% 200%; opacity: 0; }
  50%      { background-position: -50% -50%; opacity: 1; }
}
```

**Pré-requis** : `.btn--primary` doit avoir `position: relative; overflow: hidden;` (déjà dans `_buttons.scss` spec §2.5 — vérifier au moment de l'impl).

#### `.btn--success-flash` modifier (NEW)

**Source** : `.code-copy-btn.copied` (duel-page-ui:424-428) — transition visuelle après action de copie réussie.

**Quand** : feedback success transitoire sur button (copy URL, copy code, share, etc.). À combiner avec une logique JS qui ajoute/retire la classe après 1.5-2s.

**Inventaire** :
```scss
.btn.btn--success-flash {
  background: var(--success-soft) !important;
  border-color: rgba(76, 175, 80, 0.6) !important;
  color: #66bb6a !important;
  // L'!important est légitime ici car on override un autre variant (primary/secondary) temporairement
}
```

**Note** : c'est une exception au garde-fou "no !important" (cf. spec §6 critère 3). Documenter explicitement en commentaire SCSS.

### 2.2 Étendre `_pills.scss` (spec §2.6)

#### `.pill--live` modifier (NEW)

**Source** : `.waiting-status-tag` (duel-page-ui:134-165) — pill gold avec pulse-dot animé intégré.

**Quand** : indicateur "en cours" / "live" (waiting room status, duel-in-progress, dice rolling, etc.). Sémantiquement = pill + indicator pulsant.

**Inventaire** :
```scss
.pill.pill--live {
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;  // hérite de la color variant
    box-shadow: 0 0 8px currentColor;
    position: relative;
    flex-shrink: 0;
    animation: ds-pulse-dot 1.6s ease-in-out infinite;
  }
}

// Le ds-pulse-dot existe déjà dans _motion.scss spec §2.2.
// La pill récupère la couleur de son variant (gold, cyan, etc.).
```

**Usage** : `<span class="pill pill--gold pill--md pill--live">EN ATTENTE</span>` — l'animation reprend la couleur de la variant.

### 2.3 Étendre `_typography.scss` (spec §2.3)

#### `.text-code` utility (NEW)

**Source** : `.room-code-value` (duel-page-ui:375-393) — affichage monospace d'un code/ID (room code, deck ID, debug code, replay ID, etc.).

**Inventaire** :
```scss
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

// Variant : .text-code--inline (sans bg, sans border, juste mono color)
.text-code--inline {
  background: none;
  border: none;
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 0.9em;
  letter-spacing: normal;
}
```

**Usage** :
- Room code in waiting room → `.text-code` (display block, large)
- Debug ID inline dans un log → `.text-code--inline`

### 2.4 Étendre `_motion.scss` (spec §2.2)

#### `ds-card-entry` keyframe (NEW)

**Source** : `.room-card--new` (lobby:443-445) + `room-card-new` keyframe (lobby:553-559) — animation d'entrée d'une nouvelle card dans une liste (SSE lobby push, optimistic add, etc.).

**Inventaire** :
```scss
@keyframes ds-card-entry {
  from {
    opacity: 0;
    transform: translateY(-10px);
    box-shadow: 0 0 0 2px var(--gold-soft-50);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    box-shadow: var(--elevation-1);
  }
}

.card-entry {
  animation: ds-card-entry 600ms var(--ease-out);
}
```

#### `ds-chosen-pulse` keyframe (NEW — résout duplication 4×)

**Source** : keyframe `replay-chosen-pulse` dupliquée dans :
- `prompts/prompt-card-grid/prompt-card-grid.component.scss:186`
- `prompts/prompt-option-list/prompt-option-list.component.scss:91`
- `prompts/prompt-yes-no/prompt-yes-no.component.scss:37`
- `prompts/prompt-position-select/prompt-position-select.component.scss:112`

**Inventaire** :
```scss
@keyframes ds-chosen-pulse {
  // Récupérer l'exact même comportement que replay-chosen-pulse existant
  // (à copier au moment de l'impl pour fidélité visuelle)
}

.is-chosen {
  animation: ds-chosen-pulse 800ms var(--ease-out);
}
```

**Migration** : les 4 fichiers consommateurs migrent vers `.is-chosen` + suppression des 4 déclarations locales `@keyframes replay-chosen-pulse`. **Gain de dette** : 4 keyframes → 1.

#### `ds-chain-badge-pulse` keyframe (NEW — résout duplication 2×)

**Source** : keyframe `chain-badge-pulse` dupliquée dans :
- `duel-page/pvp-board-container/pvp-board-container.component.scss:558`
- `duel-page/pvp-hand-row/pvp-hand-row.component.scss:99`

**Migration** : déclarer `ds-chain-badge-pulse` dans `_motion.scss`, supprimer les 2 locales.

#### `.pulse-dot` utility (NEW — composant visuel récurrent)

**Source** : pattern récurrent dans lobby `.room-status-dot` (lobby:600-622) + duel-page-ui `.waiting-status-tag .pulse-dot` (134-164) + dice arena ready indicators.

**Inventaire** :
```scss
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

**Usage** : `<span class="pulse-dot" style="color: var(--gold)"></span>` ou `<span class="pulse-dot" style="color: var(--success)"></span>`. La couleur est portée par le parent ou `style="color: ..."`.

**Note** : le keyframe `ds-pulse-dot` est déjà dans la spec §2.2. C'est seulement l'utility class qui est ajoutée.

### 2.5 Composants Angular candidats — DIFFÉRÉ Wave 2

#### `<app-avatar-badge>` — overlay sur avatar (1 consumer actuel)

**Source** : `.room-admin-badge` (lobby:474-496) — badge gold pur, positionné `right: -2px; bottom: -2px` sur le wrapper avatar, contenant une icône Material 10px.

**Pourquoi pas Wave 1** : un seul consommateur (lobby admin shield). En attendre un 2ème (probable : waiting room creator badge, replay viewer player1 indicator, leaderboard top-3 badges) avant d'extraire.

**Décision** : **différé Wave 2**. Documenter le pattern dans la spec mais ne pas créer le composant maintenant.

#### `<app-status-dot>` — indicateur live (pulse-dot autonome)

**Pourquoi pas Wave 1** : le pattern `.pulse-dot` utility class couvre 90% des cas. Un composant Angular n'apporte de valeur que si on veut une API typée `<app-status-dot color="gold|cyan|success" size="sm|md|lg" />`. Décision Wave 2 si on a 3+ usages distincts.

**Décision** : **différé Wave 2**.

---

## 3. Composants `components/` mal placés — décision case-by-case

Le dossier `front/src/app/components/` (17 entrées) cohabite avec `front/src/app/shared/` (6 entrées). La doctrine DS dit : **`shared/` = réutilisable cross-feature, `components/` = scoped à une feature ou legacy**. Audit :

| Composant `components/` | Description | Reusable transverse ? | Décision |
|---|---|---|---|
| `bottom-sheet/` | Wrapper bottom sheet generic | ✅ Oui (PvP duel + replay viewer + futurs mobile) | **Migrer vers `shared/`** (Wave 2) |
| `card/` | Composant card Yu-Gi-Oh! | ✅ Oui (deck builder + sim + PvP + replay) | **Migrer vers `shared/`** (Wave 2) |
| `card-filters/` | Filtres recherche cards | 🟡 Spécifique deck builder + card search | **Keep `components/`** (scope feature-specific) |
| `card-inspector/` | Zoom fullscreen card | ✅ Oui (Wave Phase 3 — card-inspector-premium-spec memory) | **Migrer vers `shared/`** lors du rework inspector |
| `card-list/` | Liste paginée cards | 🟡 Spécifique deck builder | **Keep `components/`** |
| `card-searcher/` | Combiné search + filters | 🟡 Composite feature-specific | **Keep `components/`** |
| `confirm-dialog/` | Material confirm modal | ✅ Oui (déjà utilisé partout : PvP, replay, deck, settings) | **Migrer vers `shared/`** (Wave 2) — priorité haute |
| `custom-tooltip/` | Tooltip custom | ✅ Oui | **Migrer vers `shared/`** (Wave 2) |
| `deck-box/` | Composant deck box (slot) | 🟡 Spécifique deck builder | **Keep `components/`** |
| `deck-card-zone/` | Zone d'organisation cards deck | 🟡 Spécifique deck builder/sim | **Keep `components/`** |
| `empty-state/` | Composant Angular empty state | ⚠️ Présent mais sous-utilisé (cf. doc Hub D10 : `<app-empty-state>` ne supporte qu'1 CTA) | **À retirer ou redesigner** Wave 2 — la utility class `.empty-state` (spec §2.12) couvre. Composant à supprimer si redondant. |
| `loader/` | Loader plein écran | ⚠️ Loader plein écran (anti-pattern selon memory `universal-hydration-strategy`) | **À retirer progressivement** — remplacé par `<app-skel>` + skeletons |
| `multiple-action-button/` | Bouton avec menu actions | 🟡 Spécifique simulator | **Keep `components/`** |
| `navbar/` | Top navbar app | 🟡 App shell | **Keep `components/`** |
| `scaling-container/` | Canvas scaling directive | 🟡 Spécifique simulator/deck builder | **Keep `components/`** |
| `search-bar/` | Search bar (cards) | ⚠️ Existe ET conflit avec `_search-bar.scss` Wave 1 | **Renommer en `<app-card-search-bar>`** Wave 2 ou unifier — décision case-by-case |
| `snackbar/` | Custom snackbar | ✅ Oui | **Migrer vers `shared/`** (Wave 2) |
| `system-overlay/` | Overlay system messages | ✅ Oui | **Migrer vers `shared/`** (Wave 2) |

**Résumé** : **8 composants à migrer vers `shared/`** progressivement Wave 2 (pas Wave 1 — pas de Wave 1 de composants). **2 composants à reconsidérer** (`empty-state/`, `loader/`).

---

## 4. Audit des keyframes — dette de consolidation

L'audit révèle **49 keyframes** réparties dans le code PvP. La spec DS Wave 1 prescrit le préfixe `ds-` pour les nouvelles keyframes — mais l'existant a une dette :

### Keyframes à **promote dans `_motion.scss`** (déduplications)

| Keyframe | Source | Compteur duplication | Wave |
|---|---|---|---|
| `replay-chosen-pulse` | 4× prompt-* | **CRITIQUE** | Wave 1 (cf. §2.4) — renommer `ds-chosen-pulse` |
| `chain-badge-pulse` | 2× board-container + hand-row | Moyen | Wave 1 (cf. §2.4) |
| `room-card-new` | 1× lobby | Singleton mais pattern réutilisable (Hub aura besoin pour `card-entry` SSE-like si fork PR shipped) | Wave 1 (cf. §2.4) — renommer `ds-card-entry` |
| `waiting-pulse-dot` + `room-status-pulse` + `duelist-pulse` | 3× — patterns pulse-dot multiples avec valeurs proches | Moyen-haut | Wave 1 — unifier en `ds-pulse-dot` (déjà spec §2.2) |
| `duelist-state-blink` | 1× | Singleton | **Keep local** OU promote utility `.is-blinking` Wave 1.5 |

### Keyframes à **garder locales** (domain-specific, pas DS)

| Keyframe | Source | Raison |
|---|---|---|
| `opponent-thinking-pulse` | `_pvp-overlays.scss` | Spécifique duel UX (opponent indicator) |
| `phase-announce-in` | `_pvp-overlays.scss` | Spécifique phase change |
| `duel-toast-in` | `_pvp-overlays.scss` | Spécifique duel toast |
| `lobby-cta-shimmer` | lobby:187 | À migrer vers `ds-cta-shimmer` (cf. §2.1) — alias possible |
| `counter-pulse` / `chain-badge-pulse` / `xray-pulse` / etc. (board-container) | pvp-board-container | Animations zones board — pas DS |
| `pvp-shuffle-fan-*` / `pvp-xyz-detach-slide` / `pvp-flip-flash` / `pvp-activate-flash` | board-container | Animations cards mouvement — pas DS |
| `zone-browser-slide-in/out` | zone-browser-overlay | Spécifique browser |
| `rps-*` / `result-overlay-*` / `result-title-slam` etc. | duel-page-overlays | Spécifique overlay résultat |
| `chain-entry-pulse` / `chain-resolve-glow` / `chain-resolve-exit` / `chain-negated-shake` / `chain-negated-exit` / `chain-overflow-exit` | chain-overlay | Spécifique chain animation |
| `lp-damage-flash` / `lp-recover-flash` | lp-badge | Spécifique LP feedback |
| `passive-pulse` / `passive-result-in` | prompt-dialog | Spécifique prompt passive |
| `dice-tumble-*` (×6) / `dice-fall-roll` / `dice-shadow-fall` / `dice-reveal-pop` / `dice-spin` / `dice-announce-pop` / `dice-final-progress` | dice-arena | Spécifique 3D scene |
| `dice-arena-fade-in` | dice-arena | Singleton fade-in, garder local |

**Total** : ~7-8 keyframes à promouvoir dans `_motion.scss`, ~30 à garder locales.

---

## 5. Tokens locaux PvP — promotion DS différée (Wave 3)

Audit grep dans les 4 SCSS PvP shippés : **aucun token CSS custom local** (`--lobby-*`, `--waiting-*`, `--dice-*`). ✅ **Discipline parfaite** — tous les tokens sont déjà dans `_tokens.scss` global.

Cependant, les tokens **`--pvp-*`** (cf. `_tokens.scss` lignes 226-330) cohabitent avec les tokens DS. Promotion vers DS générique = **Wave 3** (différé, cf. spec §5).

---

## 6. Recommandations finales

### Pour la spec DS Wave 1 — ajouts à incorporer

| Ajout | Localisation | Effort |
|---|---|---|
| `.btn--cta-shimmer` modifier | `_buttons.scss` §2.5 | +10 min |
| `.btn--success-flash` modifier | `_buttons.scss` §2.5 | +10 min |
| `.pill--live` modifier | `_pills.scss` §2.6 | +10 min |
| `.text-code` + `.text-code--inline` | `_typography.scss` §2.3 | +15 min |
| `ds-cta-shimmer` keyframe | `_motion.scss` §2.2 | +5 min |
| `ds-card-entry` keyframe + `.card-entry` utility | `_motion.scss` §2.2 | +10 min |
| `ds-chosen-pulse` keyframe + `.is-chosen` utility | `_motion.scss` §2.2 | +10 min |
| `ds-chain-badge-pulse` keyframe | `_motion.scss` §2.2 | +5 min |
| `.pulse-dot` utility | `_motion.scss` §2.2 (suite ds-pulse-dot) | +15 min |
| **Total ajouts spec** | | **+1h30** |

### Pour la Phase F0 du Hub — migrations supplémentaires

| Migration | Source | Effort |
|---|---|---|
| Lobby `.lobby-cta--primary` → `.btn.btn--primary.btn--cta-shimmer.btn--lg.btn--cta` | lobby:141 | inclus dans migration lobby |
| Lobby `.lobby-cta--solo` → `.btn.btn--secondary.btn--lg.btn--cta` | lobby:170 | inclus |
| Lobby `.lobby-section-*` → `.section-header` etc. | lobby:193 | inclus |
| Lobby `.room-card` → `.surface-card.surface-card--interactive.surface-card--accent-gold` | lobby:382 | inclus |
| Lobby `.room-card--new` → ajouter classe `.card-entry` (animation entrance) | lobby:443 | +5 min |
| Lobby `.room-status-dot` → `.pulse-dot` utility | lobby:600 | +10 min |
| Waiting `.waiting-status-tag` → `.pill.pill--gold.pill--md.pill--live` | duel-page-ui:134 | +10 min |
| Waiting `.waiting-title` → ajouter classe `.text-gold-gradient` | duel-page-ui:172 | +5 min |
| Waiting `.room-code-value` → `.text-code` | duel-page-ui:375 | +5 min |
| Waiting `.code-copy-btn` → `.btn.btn--primary.btn--md` + JS pour `.btn--success-flash` toggle | duel-page-ui:395 | +15 min |
| Dédoublonnage `replay-chosen-pulse` (4 fichiers → `ds-chosen-pulse`) | prompts/* | +20 min |
| Dédoublonnage `chain-badge-pulse` (2 fichiers → `ds-chain-badge-pulse`) | board + hand | +10 min |
| **Total migrations supplémentaires** | | **+1h30** |

### Effort Wave 1 final post-audit PvP

| Sous-tâche | Effort |
|---|---|
| Spec DS Wave 1 originale (12 partials + refacto Niveau 1) | ~9h |
| **Ajouts spec post-audit (modifiers + keyframes + utilities)** | **+1h30** |
| **Migrations PvP supplémentaires (consolidation keyframes + waiting room migration)** | **+1h30** |
| **TOTAL Phase F0 Hub revu** | **~12h** |

### Pour Wave 2 — composants Angular à anticiper

| Composant | Trigger d'extraction |
|---|---|
| `<app-avatar-badge>` | 2ème consommateur (probable : creator badge waiting room, leaderboard top-3) |
| `<app-status-dot>` | Si `.pulse-dot` utility class atteint 5+ usages distincts (Wave 1.5 audit) |
| `<app-card-search-bar>` | Renommer/scoper `components/search-bar/` pour distinguer de `_search-bar.scss` partial |
| Migration `components/` → `shared/` | 8 composants identifiés (confirm-dialog, snackbar, system-overlay, bottom-sheet, card, card-inspector, custom-tooltip, etc.) |
| Suppression `components/empty-state/` | Si la utility class `.empty-state.empty-state--rich` couvre 100% des besoins post-Hub |
| Migration `components/loader/` → suppression | Stratégie universal-hydration-strategy (mémoire) — remplacer plein écran par skeletons |

---

## 7. Conclusion

**Bonne nouvelle** : la spec DS Wave 1 couvre **~70%** des patterns shippés PvP dès sa version actuelle. Les **30% restants** sont :
- ~5 modifiers / utilities à ajouter (effort +1h30 spec)
- ~5 migrations supplémentaires Hub (effort +1h30)
- ~4 keyframes à dédupliquer (effort inclus dans la migration)

**Risque évité** : sans cet audit, on aurait découvert les manques en cours de Phase F0/F1, avec deux options désagréables :
1. Stopper F1 pour étendre la spec → retard
2. Patcher en local dans le Hub → dette + divergence avec lobby existant

**Bénéfice indirect** : on **dédoublonne 6 keyframes** au passage (4× `replay-chosen-pulse` + 2× `chain-badge-pulse`) — c'est du nettoyage gratuit qui aurait traîné pendant des mois.

**Décision recommandée** : intégrer les ajouts §2 à la spec DS Wave 1 + les migrations §6 à la Phase F0 du Hub. Effort total **~12h** au lieu de 9h. Bénéfice : DS Wave 1 cohérent avec ce qui est shippé, zéro divergence en prod après livraison.

---

## 8. Annexe — fichiers audités

| Fichier | Lignes | Patterns extraits |
|---|---|---|
| `pages/pvp/lobby-page/lobby-page.component.scss` | 685 | 23 sélecteurs racine, 3 keyframes |
| `pages/pvp/lobby-page/deck-picker-dialog.component.scss` | 721 | 35 sélecteurs racine, 0 keyframes |
| `pages/pvp/duel-page/duel-page-ui.scss` | 833 | 29 sélecteurs racine, 3 keyframes (waiting room READY state) |
| `pages/pvp/duel-page/pvp-dice-arena/pvp-dice-arena.component.scss` | 663 | 32 sélecteurs racine, 12 keyframes (3D scene) |

**Fichiers PvP non audités (hors scope quick win)** :
- `_pvp-overlays.scss` (snippet duel overlays)
- `pages/pvp/duel-page/duel-page.component.scss`
- `pages/pvp/duel-page/duel-page-overlays.scss`
- `pages/pvp/replay/replay-page.component.scss`
- `pages/pvp/replay/timeline-bar/timeline-bar.component.scss`
- `pages/pvp/replay/transport-bar/transport-bar.component.scss`
- `pages/pvp/duel-page/prompts/_prompt-btn.scss` (partial scopé prompts)
- `pages/pvp/duel-page/prompts/_prompt-card.scss` (partial scopé prompts)
- `pages/pvp/duel-page/pvp-*` 10+ composants duel

Ces fichiers seront couverts par l'audit Viewer rework + Wave 1.5 (audit full PvP).

---

**Document maintenu par** : Sally (UX Designer) + Axel
**Dernière mise à jour** : 2026-05-14 (audit quick win lobby + waiting + dice — 10 patterns à promote/extend Wave 1, 8 composants à migrer Wave 2, 4 keyframes à dédupliquer)
