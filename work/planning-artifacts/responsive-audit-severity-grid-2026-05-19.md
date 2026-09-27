# Responsive Audit — Grille de classification de sévérité

_Référentiel de triage pour la Phase 3 de l'audit responsive 2026-05-19._
_À appliquer après le run du harness, avant la red team avec Axel._

---

## Échelle de sévérité

| Niveau | Nom | Définition | SLA |
|--------|-----|------------|-----|
| **P0** | Cassé | La page est inutilisable ou une fonction critique est inaccessible sur ce viewport. | Corriger avant tout merge. |
| **P1** | Dégradé | La page fonctionne mais l'UX est nettement compromise. Un utilisateur réel grognerait. | Corriger dans la passe de fix. |
| **P2** | Polish | Imperfection visuelle sans impact fonctionnel. Détectable seulement par un œil exercé. | Backlog, fix opportuniste. |
| **P3** | Non-bug | Faux positif mécanique, comportement attendu, ou hors scope (Track A canvas). | Documenter le rejet, ne rien faire. |

---

## Critères P0 — Cassé

Au moins UN des éléments suivants :

- **Overflow horizontal** créant une scrollbar parasite sur le `<body>` (> 0px non intentionnel).
- **Contenu critique coupé** : un bouton d'action principale, un champ de formulaire, ou une info indispensable est hors viewport et inatteignable.
- **Overlay inutilisable** : modale/dialog qui déborde, dont le bouton de fermeture est hors écran, ou qui empêche le scroll du contenu.
- **Touch target < 24px** sur une action primaire (WCAG 2.1 AA absolu — en-dessous, c'est inutilisable au doigt).
- **Texte illisible** : contraste cassé au resize (axe `color-contrast` critique), ou taille < 12px sur du contenu de lecture.
- **Layout effondré** : éléments superposés qui se masquent, z-index qui rend du contenu cliquable inaccessible.
- **Page blanche / erreur** : la page ne rend pas, console error fatale, route qui plante.

## Critères P1 — Dégradé

- **Texte tronqué** porteur d'information (`text-overflow:ellipsis` ou `line-clamp` actif sur un titre, un nom de deck, un label de bouton).
- **Touch target 24–44px** sur une action secondaire (en-dessous de la cible AAA mais utilisable en visant).
- **`overflow:hidden` qui clippe** du contenu de plus de ~20px (l'utilisateur perd de l'info sans le savoir).
- **Densité cassée** : espacement absent ou doublé, éléments collés, padding asymétrique flagrant.
- **Image cassée** (`naturalWidth === 0`) sur du contenu visible.
- **Hiérarchie visuelle perdue** : le titre ne ressort plus, l'action primaire et secondaire ont le même poids.
- **Landscape mobile spécifique** : header/topbar qui mange > 40% de la hauteur, contenu réduit à une bande inutilisable.
- **Divergence de longueur i18n** : la version EN ou FR casse un layout que l'autre langue tient.

## Critères P2 — Polish

- **Touch target 40–44px** (juste sous la cible AAA, parfaitement cliquable).
- **Espacement légèrement off** : un rythme vertical qui flotte de quelques px.
- **Alignement imparfait** : un élément décalé de < 8px par rapport à sa colonne.
- **Texte tronqué cosmétique** : ellipsis sur un élément où la troncature est acceptable (preview, sous-titre secondaire).
- **a11y `moderate`/`minor`** non-bloquant (landmark dupliqué, heading order discutable).
- **Scrollbar interne** non-Ghost (devrait suivre la convention `ghost-scroll`).

## Critères P3 — Non-bug (rejet documenté)

- **Track A canvas** : tout défaut dans la zone canvas-scaled de Simulator/Deck Builder/Card Search — hors scope par design (le canvas se scale, ce n'est pas du responsive CSS).
- **Faux positif mécanique** : un assert qui flague un comportement attendu (ex : `overflow:hidden` sur un conteneur de carousel, un touch target décoratif non interactif).
- **État de fixture** : une page "vide" parce que le compte de test n'a pas de données — pas un bug responsive.
- **Comportement intentionnel** : ellipsis volontaire sur un preview, virtual-scroll qui ne rend que N items.
- **a11y bruit** : violation axe sur un pattern Angular Material connu et accepté.

---

## Procédure de triage (Phase 3)

1. **Pré-tri mécanique** — pour chaque finding du `findings-mechanical.md`, mapper sur P0–P3 via les critères ci-dessus. Le mécanique ne décide jamais seul un P0/P1 « densité » ou « hiérarchie » — ça demande l'œil.
2. **Pré-tri visuel** — Sally parcourt les ~150-180 captures de `frames/`, viewport par viewport, et lève les findings que le mécanique ne voit pas (densité, rythme, hiérarchie, esthétique).
3. **Consolidation** — un seul `backlog-prioritized.md` : un finding = une ligne (page, viewport, état, locale, sévérité, description, capture liée).
4. **Red team avec Axel** — présentation des P0 + P1 uniquement. Axel valide / rejette / reclasse chaque ligne. Objectif : tuer les hallucinations et la sur-extraction (leçon `pages-homogenization-audit-2026-05-18`).
5. **Fix** — seuls les P0/P1 survivants au red team partent en correction. P2 → backlog. P3 → archivé avec motif de rejet.

## Format de ligne du backlog

```
| ID | Page | Viewport | État | Locale | Sévérité | Description | Capture | Statut red-team |
|----|------|----------|------|--------|----------|-------------|---------|-----------------|
| R-01 | Replay Viewer | 360L | initial | fr | P0 | Topbar mange 55% de la hauteur, board invisible | frames/10-replay-viewer/360L.png | (à valider) |
```

Statut red-team : `(à valider)` → `confirmé` / `rejeté: <motif>` / `reclassé: P0→P2`.
