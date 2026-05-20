---
title: Pages Homogenization — Findings consolidés (post red-team)
author: Sally (UX Designer)
date: 2026-05-18
status: ready-for-axel-arbitration
inputs:
  - Pass 1 (DS adoption)
  - Pass 2 (Responsive)
  - Pass 3 (Loader → Skeleton)
  - Pass 4 (Composants à extraire)
  - Pass 5 (Red team adversarial)
related:
  - pages-homogenization-audit-2026-05-18.md (audit méthodologique amont)
  - deck-list-alignment-spec-2026-05-18.md
  - card-search-mobile-audit-spec-2026-05-18.md
---

# Pages Homogenization — Findings consolidés

## TL;DR

5 passes (4 parallèles + 1 red team adversarielle) sur les 11 pages skytrix. Sur **~30 findings initiaux** : **8 vrais bugs confirmés**, **9 ambiguïtés à arbitrer**, **13 faux positifs éliminés**. Total cleanup ciblé : **8-12h** au lieu des 25-30h spéculatives initiales.

**Bonne nouvelle structurelle** :
- Pattern Hub déjà bien diffusé (replay-hub + lobby exemplaires)
- Migration loader→skeleton **quasi terminée** (8/11 pages, pas de skeleton manquant)
- Doctrine DS tokens bien respectée (sauf badges PvP tuning local légitime)
- Composants partagés (`ConfirmDialogComponent`, `EmptyStateComponent`, `ErrorBannerComponent`) déjà extraits — risque de sur-extraction redoutée par Pass 4 effectivement présent

**Vraie surface du chantier** : moins large qu'imaginé.

---

## 🔴 BACKLOG ACTIONNABLE (8 vrais bugs)

### Patches simples — ~3h totale

| # | File:Line | Patch | Effort |
|---|---|---|---|
| **B1** | `duel-page.component.scss:10-11` | `background: var(--pvp-bg-dark-navy); color: var(--text-primary);` (remplace `#1a1a2e` + `#eee`) | 5min |
| **B2** | `pvp-lp-badge.component.scss:26` | `background: var(--overlay-strong); padding: var(--space-1) var(--space-2);` (remplace `rgba(0,0,0,0.7)` + `4px 10px`) | 5min |
| **B3** | `pvp-lp-badge.component.scss:34` | `color: var(--text-primary);` (remplace `#eee`) | 5min |
| **B4** | `pvp-timer-badge.component.scss:75` | `gap: var(--space-1);` (remplace `4px`) | 5min |
| **B5** | `card-inspector.component.scss:323` | `@include r.respond-below(r.$bp-tablet) { ... }` (remplace `@media (max-width: 767px)`) | 10min |
| **B7** | Mémoire `project_modern_ux_patterns.md` | Retirer la référence à `LoadingDelayService` (service jamais créé, mémoire obsolète) | 5min |

### Composants à extraire — ~1h

| # | Composant | Sites | Effort |
|---|---|---|---|
| **B5-ext** | `<app-icon-wrap [palette]="'gold'\|'cyan'" [icon]>` 44×44 + drop-shadow | `deck-list__icon-wrap` (gold) + `card-search-page__icon-wrap` (cyan). Vrai pattern 1:1, seul l'hue change. | 1h |

### Spec déjà existante — ~5h (à exécuter)

| # | Item | Spec |
|---|---|---|
| **B-spec-1** | Card-search mobile broken (landscape unreachable filters + LIST mode broken < 768) | [card-search-mobile-audit-spec-2026-05-18.md](_bmad-output/planning-artifacts/card-search-mobile-audit-spec-2026-05-18.md) — ~5h |

**Total backlog actionnable confirmé** : **~9h** (~3h patches + 1h extraction + 5h spec card-search).

---

## ✅ Décisions Axel actées 2026-05-18

| # | Décision actée |
|---|---|
| A1 | Élimine `<app-confirm-delete-dialog>` (sur-extraction confirmée) |
| A2 | Garde adminDeleteRoom one-click sans confirm |
| A3 | Accepte 2 variantes loading-button documentées (parameter custom CSS vs lobby/replay-hub mat-spinner) |
| **A4** | ✅ **BEM cleanup MAINTENANT** — story dédiée Wave 4 polish, ~2h |
| **A5** | ✅ **Token `--cta-inline-height: 36px` créé** — exposé via Wave A `<app-section-header>` pour aligner CTA inline avec search-bar |
| A6 | Pattern back-nav `.page-header > .btn` → intégré nativement dans `<app-page-shell>` Wave C |
| A7 | PvP `rgba(144, 202, 249, 0.55)` reste local, pas de token |
| A8 | Confiance dans card-search-spec, pas de re-pass red team |
| **A9** | ✅ **Extraire `<app-radio-card-group>` + `<app-toggle-switch>`** — anticipation usage futur (settings PvP, dev hub, etc.) |

## Arbitrages détaillés (référence)

### A1 — `<app-confirm-delete-dialog>` extraction ?
**Contexte** : Pass 4 priorité 🔴. Red team : faux positif. `ConfirmDialogComponent` existe déjà, data-driven (`destructive: boolean`, `confirmLabel`), utilisé par deck-list + replay-hub.
**Question** : tu confirmes qu'on n'extrait PAS de couche supplémentaire ? Le composant existant suffit.
**Recommandation Sally** : Confirmer l'élimination. C'est de la sur-extraction.

### A2 — adminDeleteRoom sans confirm dialog
**Contexte** : Lobby admin force-close one-click sans dialog (vs deck-list/replay-hub qui confirment).
**Question** : on garde le pattern admin one-click (rapide), ou on aligne sur le confirm-destructive pour cohérence ?
**Recommandation Sally** : Garder one-click admin. Force-close est un acte admin déjà gated par un rôle, double confirmation = friction.

### A3 — `<app-loading-button>` extraction
**Contexte** : Parameter custom CSS spinner gold-soft (inline-text "Updating...") vs lobby/replay-hub `mat-progress-spinner 16px` (standalone-button delete/join). **2 sémantiques différentes**, pas une vraie duplication.
**Question** : on unifie ou on accepte 2 variantes documentées ?
**Recommandation Sally** : Accepter les 2 variantes. Sémantiquement différentes (text inline vs icon-button). Re-éval si une 3e variante apparaît.

### A4 — BEM camelCase cleanup (`deckPage`, `deckBuilder`, `handTest`)
**Contexte** : ~28 occurrences total. Cleanup mécanique mais peut casser des sélecteurs si certains sont consommés par CSS ::ng-deep ou tests.
**Question** : story dédiée Wave 4 polish, ou backlog low-prio ?
**Recommandation Sally** : Backlog low-prio. Pas urgent visuellement. À grouper avec une story de "BEM convention pass" plus tard.

### A5 — `--cta-inline-height: 36px` token ?
**Contexte** : `deck-list.component.scss:69` a `min-height: 36px !important;` pour aligner CTA avec `.search-bar`. Commentaire explicatif présent.
**Question** : créer un token `--cta-inline-height: 36px` (pair search-bar + CTA inline), ou laisser local ?
**Recommandation Sally** : Créer token si on l'utilise dans Wave A (`<app-section-header>` pourrait l'exposer). Sinon laisser local — 1 site = pas un token.

### A6 — `<app-page-shell>` + back-nav natif (pattern replay-hub mobile)
**Contexte** : `replay-hub-page.component.scss:46-62` a un override `.page-header > .btn { order: -1 }` pour transformer le back-button en icon-only mobile. Pattern qui resservira sur d'autres pages avec back-nav.
**Question** : on intègre nativement dans `<app-page-shell>` (Wave C), ou on l'élève en utility `.page-header--with-back-nav` à part ?
**Recommandation Sally** : Intégrer nativement dans `<app-page-shell>` quand on l'écrit. Pas d'extraction intermédiaire.

### A7 — PvP badges hardcoded `rgba(144, 202, 249, 0.55)` (repeating gradient)
**Contexte** : Doublons à 2× dans un repeating-linear-gradient (technique CSS standard). Pas une vraie duplication factorable. Mais pourrait devenir un token `--pvp-timer-opp-hatch-color`.
**Question** : tokeniser (+1 token) ou laisser local ?
**Recommandation Sally** : Laisser local. Doctrine accepte les valeurs uniques en local. 1 token de plus pour 1 site = bruit.

### A8 — Card-search re-pass red team sur la spec ?
**Contexte** : `card-search-mobile-audit-spec-2026-05-18.md` existe. Red team a confirmé Z2/Z3 cassés, spec présumée couvrir.
**Question** : tu fais confiance à la spec ou tu veux un re-pass red team dessus avant exécution ?
**Recommandation Sally** : Faire confiance à la spec — j'ai écrit + relue. Re-pass red team = perte de temps.

### A9 — `<app-radio-card-group>` + `<app-toggle-switch>` (preferences uniquement)
**Contexte** : Pass 4 priorité 🟡. 1 seul consommateur (preferences-page).
**Question** : extraction préventive maintenant, ou YAGNI ?
**Recommandation Sally** : YAGNI. Préférences est la seule à les utiliser. Re-évaluer si 2e usage apparaît.

---

## 🟢 ÉLIMINÉS (13 faux positifs / décisions légitimes)

Détails dans le rapport red team. Synthèse :

| # | Finding éliminé | Raison |
|---|---|---|
| E1 | `lobby-page.component.html:173 mat-raised-button` | Pas combiné avec `.btn--*`, donc pas la régression Wave 1 redoutée |
| E2 | `pvp-phase-badge font-size: 0.55rem` | Doctrine : geometry composant = local OK. Tuning fin board game. |
| E3 | `pvp-timer-badge font-size: 0.85rem` | Idem E2 |
| E4 | `deck-list.component.scss:69 !important` | Commentaire explicatif présent. Suivi via A5. |
| E5 | `card-search-page.component.scss:63 #c0e0ff` gradient | Aucun token cyan-100/200 n'existe. Couleur unique pour text-clip gradient. Local OK. |
| E6 | `login-page.component.scss:131 rgba(0,0,0,0.5) drop-shadow` | Doctrine : ombres = local OK. |
| E7 | `replay-card-skeleton skel--w-60 ne s'applique pas` (P3 BUG CRITIQUE) | **HALLUCINATION P3**. Vérifié `skel.scss:51-54` — classe définie globalement. Pas de layout-shift. |
| E8 | `<app-confirm-delete-dialog>` (P4 priorité 🔴) | **SUR-EXTRACTION P4**. `ConfirmDialogComponent` existe déjà, data-driven. |
| E9 | `<app-radio-card-group>` / `<app-toggle-switch>` (P4 🟡) | YAGNI — 1 seul consommateur (preferences). |
| E10 | `.card-ds`/`.pref-card`/`.room-card` variantes | Divergences intentionnelles (padding form vs animation lobby vs blur strength). |
| E11 | Search bar inline P4 anti-candidat | Déjà DS partial. |
| E12 | Spinner divergence P4 anti-candidat | Suivi via A3. |
| E13 | Preferences/replay-hub/login `@media` 720px/landscape-short | Tous documentés en code, cas spéciaux légitimes. |

---

## Patterns transversaux confirmés (signaux forts)

1. **Pattern Hub = référence solide** — le hub + lobby + preferences sont les 3 pages exemplaires. Toute future page d'index doit s'y aligner.
2. **`<app-icon-wrap>` 44×44** — duplication confirmée gold + cyan. Solide pour Wave A. Le red team valide.
3. **Tuning fin board UI** — pattern PvP `0.55rem`, `0.85rem`, gaps locaux est **légitime** par doctrine. Ne PAS tokeniser. Confirme la doctrine "geometry composant = local OK".
4. **`mobile-portrait` mixin** = bottom-sheet trigger Track A. Utilisé correctement. **`mobile-full` n'existe pas** — c'est un nom proposé par la spec card-search à créer (ou utiliser `respond-below($bp-tablet)` direct).
5. **Skeletons sont sains** — pas de bug réel, pas de skeleton manquant. La migration loader→skeleton est quasi finie.
6. **`ConfirmDialogComponent` est la bonne factorisation** — à protéger contre sur-extraction.

---

## Recommandations méta pour les futures passes

Issues détectées dans les 4 passes elles-mêmes :

1. **Pass 3 a halluciné un bug** non vérifiable dans le code. Procédure future : **Read avant claim**.
2. **Pass 4 a sur-extrait** — il a proposé un composant alors qu'un équivalent data-driven existait. Procédure future : `grep -ri "ExistingPattern"` avant proposition.
3. **Pass 1 a sur-violé la doctrine** — n'a pas distingué "vraie violation" de "tuning local légitime par doctrine ds-token-doctrine". Procédure future : inclure colonne "doctrine penche local OK ? oui/non" avant verdict.
4. **Mémoire `project_modern_ux_patterns` obsolète** — mentionne `LoadingDelayService` jamais créé. Action : nettoyer la mémoire (B7).

Pour les futures passes adversarielles : **doubler systématiquement les passes "détection" par une passe "vérification de plausibilité"** — c'est exactement ce que le red team a fait ici, et c'est ce qui a sauvé 50% du backlog d'être bullshit.

---

## Synthèse opérationnelle pour Axel

### Ce qui change vs la spec d'audit initiale [pages-homogenization-audit-2026-05-18.md](_bmad-output/planning-artifacts/pages-homogenization-audit-2026-05-18.md)

- **Wave A** : `<app-icon-wrap>` à ajouter (~1h) en plus des 3 composants déjà actés. Reste pertinente.
- **Wave B** : reste sur card-search (5h) et deck-list (8h30). Solver hors-scope confirmé.
- **Wave C** : reste pertinente (`<app-page-shell>` + `ListStore<T>`). Le pattern `.page-header > .btn` mobile back-nav (A6) y sera intégré nativement.
- **Wave D** : `<app-back-fab>` à reconfirmer (peut-être plus pertinent qu'évalué initialement — Z2 landscape replay-page l'utilise).

### Décisions immédiates demandées (~5 min de ta part)

| # | Q | Recommandation Sally |
|---|---|---|
| A1 | Élimine `<app-confirm-delete-dialog>` ? | ✅ Éliminer (sur-extraction) |
| A2 | adminDeleteRoom one-click sans confirm ? | ✅ Garder one-click |
| A3 | `<app-loading-button>` 2 variantes ? | ✅ Garder 2 variantes documentées |
| A4 | BEM cleanup quand ? | 🟡 Backlog low-prio |
| A5 | `--cta-inline-height: 36px` token ? | 🟡 Si Wave A l'utilise, sinon non |
| A6 | back-nav mobile pattern : `<app-page-shell>` natif ? | ✅ Intégrer dans Wave C |
| A7 | `rgba(144, 202, 249, 0.55)` token PvP ? | ✅ Laisser local |
| A8 | Re-pass red team sur card-search-spec ? | ✅ Faire confiance |
| A9 | `<app-radio-card-group>` + toggle ? | ✅ YAGNI |

### Prochaine étape — Roadmap finale post-arbitrage (2026-05-18)

#### Wave A — Composants partagés (~7h, autonome)

Composants à extraire :
1. `<app-empty-state>` enrichi (variantes error/no-results/rich + descKey + ctaAction) — ~1h30
2. `<app-section-header>` — ~1h (expose `--cta-inline-height: 36px` token)
3. `<app-stats-strip>` (factorise hub-stats + deck-stats-strip) — ~2h
4. `<app-icon-wrap [palette]="'gold'\|'cyan'" [icon]>` 44×44 + drop-shadow — ~1h
5. `<app-radio-card-group>` + `<app-toggle-switch>` (depuis preferences) — ~1h30

**Tokens à ajouter** : `--cta-inline-height: 36px` (Q2 Axel).

#### Patches simples (~3h, peut tourner en parallèle Wave A)

- B1-B4 : tokens hardcoded → tokens DS (duel-page + 3 badges PvP) — ~20min
- B5 : card-inspector magic number 767px → mixin `respond-below($bp-tablet)` — ~10min
- B7 : nettoyer mémoire `project_modern_ux_patterns` (retirer `LoadingDelayService` inexistant) — ~5min

#### Wave 4 polish — BEM cleanup (~2h, à programmer)

- Renommer `deckPage` → `deck-page`
- Renommer `deckBuilder` → `deck-builder`
- Renommer `handTest` → `hand-test`
- ~28 occurrences total. Vérifier sélecteurs CSS, tests, ::ng-deep.

#### Wave B — Pages broken (~14h, sériel post-A)

- card-search-mobile-audit-spec-2026-05-18.md (~5h)
- deck-list-alignment-spec-2026-05-18.md (~8h30, sera révisée pour consommer Wave A composants)

#### Wave C — Extraction structurelle (~6h, post-B)

- `<app-page-shell>` avec **back-nav natif intégré** (pattern A6 actée)
- `ListStore<T, FilterMode, SortMode>` classe abstraite

#### Wave D — Polish (~1h30, opportuniste)

- `<app-back-fab>` (replay-page + duel-page Z2 landscape)
- `<app-skeleton-list>` template wrapper

### Effort total révisé : ~33h30

| Wave | Effort | Statut |
|---|---|---|
| A (5 composants + token) | ~7h | 🎯 Prochaine |
| Patches simples (B1-B7) | ~3h | Parallèle Wave A |
| Wave 4 polish (BEM) | ~2h | Programmer |
| B (card-search + deck-list) | ~14h | Post-A |
| C (page-shell + ListStore) | ~6h | Post-B |
| D (back-fab + skeleton-list) | ~1h30 | Opportuniste |
| **Total** | **~33h30** | |

### Handoff Amelia

3 chantiers autonomes pouvant démarrer en parallèle :
1. **Wave A** (5 composants) — `bmad-quick-dev` avec ce doc + spec d'audit initiale en input
2. **Patches B1-B7** (~3h) — story rapide `bmad-quick-dev`
3. **Wave 4 BEM cleanup** (~2h) — story rapide `bmad-quick-dev`
