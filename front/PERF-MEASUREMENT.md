# Frontend — Protocole de mesure de performance

> Phase 0c du chantier perf
> (`_bmad-output/planning-artifacts/perf-audit-instrumentation-chantier.md`).
>
> **Pas de framework, pas de dépendance.** Le frontend skytrix est brownfield
> sans nouvelle dépendance autorisée — l'instrumentation perf est un *protocole
> de mesure reproductible*, pas du code. Outillage : le builder Angular natif,
> Chrome DevTools, Angular DevTools. Ce document est la procédure ; il est
> rejoué tel quel à chaque capture de baseline (Phase 0.5) et à chaque
> validation (Phase 1).

Trois axes de mesure, un par famille de findings frontend. Chaque axe produit
un chiffre qui alimente une ligne du budget perf (§4 du doc de chantier).

---

## Axe 1 — Taille du bundle (findings F-C1, F-C2 — budget #3)

**Question** : combien de JS l'utilisateur télécharge au premier chargement, et
où va le poids ?

### Mesure

```bash
# Build de production avec le rapport de composition.
cd front
npx ng build --configuration production --stats-json
```

Sortie : `front/dist/skytrix/stats.json` + les bundles dans `dist/skytrix/`.

> ⚠️ **Le build prod doit tourner avec un accès réseau.** Le builder Angular
> inline les Google Fonts (`@import url(fonts.googleapis.com…)` dans
> `styles.scss`) au build de prod ; hors-ligne ou derrière un proxy à
> certificat non vérifié, le build échoue (`unable to verify the first
> certificate`). Faire la mesure dans un environnement connecté.
>
> ⚠️ **Ne pas utiliser le build `development` pour le budget #3.** Il a
> `optimization: false` — pas de minification ni de tree-shaking. Son
> `Initial total` (~5 MB) est gonflé et ne reflète PAS la taille perçue par
> l'utilisateur. Le build dev reste utile pour *constater quels chunks sont
> lazy* (les noms de chunks sont préservés), mais le chiffre du budget #3
> vient exclusivement du build **production**.

1. **Poids initial brut** — le résumé de fin de `ng build` liste déjà
   `Initial total` (raw + estimated transfer/gzip). C'est le chiffre direct
   du budget #3.
2. **Composition** — pour savoir *où* va le poids, ouvrir `stats.json` dans un
   visualiseur. Sans nouvelle dépendance npm, deux options :
   - upload de `stats.json` sur https://esbuild.github.io/analyze/ (le builder
     Angular utilise esbuild — le format est nativement compatique) ;
   - ou `npx --yes source-map-explorer dist/skytrix/*.js` (exécution ponctuelle
     via `npx`, **ne pas** l'ajouter à `package.json`).
3. **Lazy vs eager** — vérifier que les routes lourdes sont dans des chunks
   séparés (`chunk-*.js` chargés à la navigation) et non dans `main-*.js`.
   F-C1 = 5 routes encore eager ; F-C2 = jspdf doit disparaître du chunk
   initial après l'`import()` dynamique.

### Garde-fou de régression

Le budget `initial` vit dans [angular.json](angular.json) (`maximumWarning: 1mb`,
`maximumError: 2mb`). Après la capture de baseline (Phase 0.5), **resserrer ces
seuils** sur `baseline × 1.1` pour que le build casse en cas de régression de
lazy-loading. C'est la matérialisation du budget #3 ("gel de la baseline").

---

## Axe 2 — Latence réseau des images (finding F-C4 — budget réseau)

**Question** : combien de requêtes d'images de cartes partent au chargement
d'une liste, et combien sont hors-écran (inutiles) ?

### Mesure

1. `npm start`, ouvrir la **card-search** ou le **deck-builder**.
2. DevTools → onglet **Network**, filtre **Img**, vider le cache
   (`Disable cache` coché).
3. Charger la page **sans scroller**. Relever :
   - le **nombre** de requêtes d'images parties ;
   - combien correspondent à des cartes **hors viewport** (les comparer à ce
     qui est visible à l'écran).
4. Répéter après le fix `loading="lazy"` : seules les images visibles + une
   marge doivent partir.

Chiffre de référence : `requêtes_images_au_load` avant / après. F-C4 est
validé si le nombre passe de "toutes les cartes rendues" à "viewport + marge".

---

## Axe 3 — Coût de change detection (findings F-C3, F-M1, F-M2, F-M5 — budgets #7, #1)

**Question** : combien de temps coûte un cycle de CD sur les écrans à longue
liste (card-search, deck-builder) et le board PvP ?

### Mesure — Angular DevTools

Extension **Angular DevTools** (Chrome) → onglet **Profiler**.

1. `npm start`, ouvrir l'écran cible.
2. Profiler → **Record**.
3. Déclencher l'interaction qui stresse le CD :
   - card-search : **scroller** la liste (stresse F-C3 accumulation DOM,
     F-M2 scroll non throttle, F-M1 `CardNamePipe` impur) ;
   - deck-builder : ajouter / déplacer une carte (stresse F-M5 closure binding) ;
   - board PvP : jouer un tour avec une chaîne (budget #7 board CD time).
4. **Stop**. Lire dans le profiler :
   - la **durée du cycle de CD** le plus lourd (barre la plus haute) ;
   - les composants qui re-vérifient à chaque tick (cherchés F-M1/F-M5) ;
   - le nombre de cycles déclenchés par une seule interaction.

### Mesure — compteur de nœuds DOM (F-C3)

Pour l'accumulation DOM de la card-list sans virtual scroll, DevTools →
**Console**, après plusieurs scrolls :

```js
document.querySelectorAll('app-card').length
```

Chiffre de référence : nombre de `<app-card>` dans le DOM après N pages
scrollées. F-C3 est validé si ce nombre croît linéairement (pas de virtual
scroll) vs reste borné (après fix).

### Mesure — Web Vitals (optionnel, budgets #1, #2)

Pour les métriques perçues (LCP de la card-search, du replay), DevTools →
onglet **Performance** → **Record** d'un chargement de page. Le panneau
**Timings** affiche LCP / CLS / INP sans aucune dépendance. Suffisant pour
une capture de baseline ponctuelle — on n'instrumente pas Web Vitals en
continu dans le bundle (ce serait une dépendance + du code en prod).

---

## Récapitulatif — quoi mesure quoi

| Axe | Outil | Findings | Budget §4 |
|-----|-------|----------|-----------|
| 1 — bundle | `ng build --stats-json` + esbuild analyzer | F-C1, F-C2 | #3 |
| 2 — images | DevTools Network | F-C4 | réseau |
| 3 — CD | Angular DevTools Profiler + console | F-C3, F-M1, F-M2, F-M5 | #7, #1 |

**Discipline** : chaque chiffre capturé en Phase 0.5 / Phase 1 est reporté
dans la colonne `baseline` du tableau §4 du doc de chantier, ou dans le
verdict du finding au §5. Une capture sans chiffre reporté ne compte pas.
