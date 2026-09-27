# Responsive Audit — Backlog priorisé

_Run : `responsive-audit-2026-05-20` · 192 captures · 11 pages × 8 viewports + 6 états + EN locale + axe-core._
_Audit visuel : 4 sous-agents parallèles + consolidation/red-team interne Sally._
_Grille de sévérité : [responsive-audit-severity-grid-2026-05-19.md](responsive-audit-severity-grid-2026-05-19.md)._

---

## Verdict global

**skytrix est solide en responsive.** Le run mécanique le confirme par le signal le plus dur :

- **0 overflow horizontal** sur 192 captures — aucune scrollbar parasite, jamais.
- **0 layout cassé** repéré à l'audit visuel des 11 pages.
- **0 image cassée.**
- Les 8 viewports tiennent — y compris mobile landscape (360L/414L) et 360 portrait.

Les compteurs mécaniques élevés (`T192`, `H175`) sont des **faux positifs systémiques** confirmés à l'œil : touch-targets décoratifs et conteneurs à scroll interne. Ils ne sont PAS des bugs.

Reste un **petit lot de finitions** — surtout a11y — listé ci-dessous. Aucun P0.

---

## Backlog (post red-team interne Sally)

| ID | Page | Viewport(s) | Sévérité | Description | Statut red-team Axel |
|----|------|-------------|----------|-------------|----------------------|
| R-01 | Preferences | tous | **P2** | Texte descriptif gris des cartes de thème (CLASSIC/COSMIC/FOREST) sous le seuil de contraste WCAG AA (axe `color-contrast` serious × 3). Lisible mais limite. Page de réglages, texte secondaire. | (à valider) |
| R-02 | Card Search | 360/414/360L/414L | **P2 (à confirmer)** | Bouton "Effacer" filtres mesuré 52×21px (hauteur < 24px WCAG). **NON confirmé visuellement** — le harness n'a pas capturé l'état "filtre actif" où ce bouton apparaît. Basé sur l'assert mécanique seul. | (à valider) |
| R-03 | Replay Hub / Lobby | tous | **P2** | Boutons de tri ("Plus récentes") et filtres : axe `color-contrast` serious. Lisible. Cohérent avec R-01 — même nature. | (à valider) |
| R-04 | Transversal | tous | **P2** | a11y `aria-dialog-name` manquant (16 captures) : modales/dialogs sans nom accessible. Fix simple (`aria-label` sur `mat-dialog`). | (à valider) |
| R-05 | Transversal | tous | **P2** | a11y `image-alt` manquant (24 captures, 182 nœuds) : `<img>` de cartes sans `alt` ni `role="presentation"`. Fix : `alt` = nom carte ou `role="presentation"`. | (à valider) |
| R-06 | Transversal | tous | **P2** | a11y landmarks : `landmark-no-duplicate-main` / `landmark-unique` (32 captures). Plusieurs `<main>` dans le DOM. Fix structurel léger. | (à valider) |
| R-07 | Card Search / Deck Builder | tous | **P2** | a11y `aria-required-attr` / `aria-required-children` (12 + 4 captures) : rôles ARIA incomplets. | (à valider) |
| R-08 | Transversal | tous | **P2** | a11y `scrollable-region-focusable` (23 captures) : conteneurs scrollables non atteignables au clavier. `tabindex="0"` sur les régions scroll. | (à valider) |
| R-09 | Transversal | quelques pages | **P2** | a11y `button-name` (2 captures) : boutons icône sans texte discernable. `aria-label`. | (à valider) |

## Rejetés (P3 — documentés, aucune action)

| Motif | Détail |
|-------|--------|
| **Faux positif mécanique — touch targets** | `T<n>` se déclenche sur 192/192 captures. Boutons icône décoratifs, contrôles de transport, dots de pagination — cliquables en vrai. Aucun problème d'usage vu à l'œil. |
| **Faux positif mécanique — overflow:hidden** | `H<n>` sur 175/192. Ce sont les wrappers à scroll interne (`screen-bg-*`, `deck-list`, zones du board). Pattern voulu, pas un clip de contenu. |
| **Track A canvas** | Défauts dans les zones canvas-scaled de Simulator / Deck Builder / Card Search (grille de cartes) — hors scope par design. |
| **Duel in-game non-auditable** | Les 16 captures de `/pvp/duel/{code}` montrent "Connexion perdue" : le fork-solo créé par API n'a pas le router state Angular. Limite du harness, pas un bug. À auditer autrement (le Replay Viewer partage les composants du board). NB : le dialog d'erreur lui-même est correctement responsive. |
| **Replay Viewer portrait** | Écran "Tournez votre appareil en paysage" sur 360/414/768 — design intentionnel. Seuls les viewports landscape sont auditables, et ils sont propres. |

---

## Notes de méthode (red-team interne)

Les sous-agents ont **sur-classé** 2 findings que j'ai ramenés de P1 → P2 après vérification directe des captures :

1. **Contraste Preferences** : l'agent a raisonné « `serious` n'est pas dans la grille donc par élimination P1 ». Faux raisonnement — `serious` est entre `critical` (P0) et `moderate` (P2). Texte secondaire lisible sur page de réglages = P2.
2. **Bouton "Effacer"** : classé P1 sur la seule foi de l'assert mécanique. Le harness n'a jamais capturé l'état où ce bouton est visible → finding non confirmé visuellement, dégradé à « P2 à confirmer ».

C'est exactement la dérive que la red-team doit corriger (cf. leçon `pages-homogenization-audit-2026-05-18` : la red team a sauvé 50 % du backlog d'être du bullshit).

## Mini-chantier a11y — LIVRÉ 2026-05-20

Red team Axel : verdict validé, mini-chantier a11y groupé acté, scope « fixes sûrs hors board ».

| ID | Fix appliqué | Vérifié axe |
|----|--------------|-------------|
| R-06 | `<main>` dupliqué retiré : card-search → `<div>`, login → `<div>`. | ✅ `landmark-no-duplicate-main` / `landmark-unique` / `landmark-main-is-top-level` → 0 |
| R-04 | `ariaLabelledBy` (id fixe `deck-picker-title`) sur la config du deck-picker dialog. | ✅ `aria-dialog-name` → 0 |
| R-09 | `aria-label` sur chevrons + dots du card-inspector, input `ariaLabelKey` sur `multiple-action-button`. | ✅ `button-name` → 0 |
| R-07 | login tablist : `aria-label` + `aria-controls` + `role="tabpanel"` ; token-select listbox : `aria-label`. | partiel (résiduel `aria-required-attr` ×2) |
| R-08 | `tabindex="0"` + `aria-label` sur la grille de résultats Card Search. | partiel (1 résiduel) |

**8 clés i18n** ajoutées FR+EN (`cardSearchPage.results`, `login.modeTablist`, `a11y.previousImage/nextImage/goToImage/moreActions`).
Build dev OK. Effet de bord `landmark-complementary-is-top-level` détecté au re-check puis évité (la `<section>` labellisée imbriquait le `complementary` du card-inspector → revenue en `<div>`).

### Reste — non traité (volontaire)

- **R-01 / R-03** (color-contrast P2) : texte secondaire sous WCAG AA. Backlog opportuniste.
- **R-05** (image-alt, board dynamique) : zone d'animation régie par CLAUDE.md — hors scope acté.
- **R-02** (bouton "Effacer") : jamais confirmé visuellement. À vérifier si un jour on capture l'état filtre-actif.
- `aria-required-attr/children` résiduel + `presentation-role-conflict` (minor, préexistant) : backlog.
- **Duel in-game** : non audité (proxy Replay Viewer jugé suffisant).
