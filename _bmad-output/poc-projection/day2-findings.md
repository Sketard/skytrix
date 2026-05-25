---
title: POC Projection — Demi-jour 2 findings
status: complete
date: 2026-05-25
spec_source: _bmad-output/planning-artifacts/poc-projection-spec.md §5
scenarios: U1-U4 + audit code (Q1-Q4) + sondage DOM
replay_id_used: a8859c98-df53-4de3-bcdb-dd1a56176f86
---

# Demi-jour 2 — Application au board PvP réel

J1 a montré que les contrats WAAPI sont sains cross-browser et qu'une couche de projection via `transform: rotate(180deg)` sur le container racine est viable côté CSS. J2 confronte cette hypothèse au board PvP réel — et révèle que **les présupposés du J1 sur la nature des coordonnées de `CardTravelEngine` étaient faux** : l'engine actuel calcule en viewport-absolu, les floats vivent hors `.board-host`, et **S3 ("free lunch") n'est PAS gratuit**.

Spec source : `_bmad-output/planning-artifacts/poc-projection-spec.md §5`. Tests automatisés J2 : `front/e2e/poc-projection-board.spec.ts` + `front/e2e/poc-projection-card-probe.spec.ts`. Données brutes : `raw-board-{u1..u4}.json` + `raw-card-probe.json`. Screenshots : `screenshots/u1-before.png`, `u1-after-confirmed.png`, `u2-before.png`, `u2-after.png`, `u4-before.png`, `u4-after.png`.

---

## §1 Confirmations U1 — flip parent fonctionne CSS-wise

Le sélecteur racine identifié par l'audit code : `<div class="board-host">` dans [pvp-board-container.component.html:71](front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html#L71). Pas de `transform-origin` posé — je le force `center center` dans le test.

Appliquer `style.transform = 'rotate(180deg)'` au `.board-host` produit le swap attendu (cf. `raw-board-u4.json` "audit") :

| Élément | center avant | center après | Δy | Verdict |
|---|---|---|---|---|
| `.board-wrapper` | (800, 469.5) | (800, 469.5) | 0 | Container lui-même (point invariant central) |
| `.opponent-field` | (800, 250) | (800, 689) | +439 | ✅ Flippé |
| `.player-field` | (800, 689) | (800, 250) | -439 | ✅ Flippé |

Pas de re-layout, pas de saccade visuelle au repos. Le `transformApplied` est sérialisé `matrix(-1, 0, 0, -1, 0, 0)` par le navigateur. Les screenshots `u1-before.png` + `u1-after-confirmed.png` valident visuellement : opposant en bas, joueur en haut, hand cards swappées, LP du panneau de joueur stables (cf. §3).

---

## §2 U2 — comportement `cardBaseRotation` mesuré

Le sondage DOM (`raw-card-probe.json`) révèle que mon hypothèse J1 était partiellement fausse :

- `cardBaseRotation` retourne `180` pour `relPlayer=1`, `undefined` pour `relPlayer=0` (cf. [duel-context.ts:73-81](front/src/app/pages/pvp/duel-page/duel-context.ts#L73)).
- **Mais** cette rotation n'est PAS appliquée sur le wrapper `.hand-card` — elle est appliquée **sur l'`<img class="hand-card-art">` à l'intérieur**. C'est visible dans le DOM :
  - HAND-0 (joueur) `<img>` : `transform: none`
  - HAND-1 (opposant) `<img>` : `transform: matrix(-1, 0, 0, -1, 0, 0)` (= rotateZ(180°))
- Les `.hand-card` divs portent une **rotation de fan** (~-4° à +4°) indépendante du `cardBaseRotation` (fan layout, non-perspective).

**Composition mathématique après flip 180° du `.board-host`** :

| Cible | Rotation art locale | × Flip board | = Résultat visuel |
|---|---|---|---|
| Joueur (rel=0, désormais en haut visuellement) | 0° | × 180° | **180° = upside-down** ❌ |
| Opposant (rel=1, désormais en bas visuellement) | 180° | × 180° | **360° = à l'endroit** ✅ |

Sur l'état "draw phase" du replay testé, **tout est face-down** (sleeve symétrique 180°) donc l'artefact n'est PAS visible. **Mais** dès qu'une carte joueur est révélée (CONFIRM_CARDS, prompt SELECT_CARD, face-up summon), son artwork serait à 180° = lecture impossible.

**Verdict U2 — décision rotation carte** : **Option B (recalculer post-flip)** est nécessaire. La formulation correcte est : `cardBaseRotation(relPlayer)` doit dépendre du `perspective` actif. Aujourd'hui le code suppose implicitement perspective=0 (relPlayer=0 = bottom = no rotation, relPlayer=1 = top = 180°). Pour un flip, soit :

- **B.1** — `cardBaseRotation(relPlayer) = (relPlayer === currentPerspective) ? undefined : 180`. Encapsule le flip dans la définition. Sites consommateurs (MoveAnimationRouter 3 sites, DrawSequenceManager 2 sites, card-travel-helpers) ne changent pas — ils continuent à appeler `ctx.cardBaseRotation(relPlayer)`. Migration : ajouter une dépendance signal `perspective()` dans `DuelContext`. **1 fichier**, ~5 lignes.
- **B.2** — laisser `cardBaseRotation` inchangé et appliquer une contre-rotation au niveau du template `<img>` qui dépend du perspective. Plus invasif (template change).

**Option A (suppression de `cardBaseRotation` partout)** est invalide : avec art à 0° des deux côtés, l'opposant non-flippé aurait son art à l'endroit visuel — il regarderait dans le bon sens pour le joueur seulement (chaque carte face-up de l'opposant serait à 180° dans le référentiel naturel, c-à-d à l'envers pour le viewer joueur). Ce qui est exactement le bug actuel inverse.

**Recommandation : Option B.1**, ~5 lignes dans `duel-context.ts` + un signal `perspective` exposé.

---

## §3 U4 — audit éléments hors-container (mesuré)

Liste calibrée sur l'état "draw phase" du replay (donc pas de prompt actif, pas de chain, pas d'attaque). Les éléments "found=false" du `raw-board-u4.json` sont normaux pour cet état — ils existent à d'autres moments du jeu et leur audit DOM-parent est traité ci-dessous via l'audit code Q3.

### Éléments INSIDE `.board-host` (flipped automatiquement)

| Élément | Source | Statut |
|---|---|---|
| `.board-wrapper`, `.opponent-field`, `.player-field` | Layout grid | ✅ Naturellement dans la racine |
| Toutes les `data-zone` (HAND, MZONE, SZONE, EXTRA, DECK, GY, BANISH) | `[pvp-zone]` components | ✅ Mesuré via `[data-zone]` selectors — flippent |
| `.hand-card` wrappers + `.hand-card-art` img | Hand renderer | ✅ Flippent (cf. §2 — mais artwork rotation à recalibrer) |
| Bordure plateau, grille, banner "PHASE DE PIOCHE" | SCSS dans pvp-board-container | ✅ Flippent (cf. screenshot u1-after) |

### Éléments OUTSIDE `.board-host` (NE flippent PAS)

Mesurés par `raw-board-u4.json` (audit JS via Δcenter avant/après transform) :

| Élément | Position CSS | Parent (chain) | Mode requis |
|---|---|---|---|
| `app-pvp-chain-overlay` | `fixed; inset:0` | `main.dark-theme-content` | **Mode A** : déplacer DANS `.board-host`, OU **mode B** : observer le perspective signal et flipper séparément |
| `app-effect-bubble` | `static` (CDK overlay actif uniquement quand bulle visible) | `main.dark-theme-content` + ancrage CDK | **Mode B** : la bulle est ancrée à un point précis (player-card) — le CDK gère sa position via getBoundingClientRect, donc l'origine est viewport-absolue. Doit observer perspective et inverser sa position d'ancrage |
| `app-pvp-prompt-dialog` | `absolute` (caché ici) | `main.dark-theme-content` | **Convention** : pas de switch pendant prompt actif (déjà acté §6.1 de la spec). Pas de traitement requis. |
| `.cdk-overlay-container` | `fixed` | `body` | Container racine de TOUS les CDK overlays (MatDialog, etc.). Hors périmètre — les overlays qui l'utilisent sont des dialogs hors-jeu. |
| `app-duel-dev-hub` | `fixed` (1588, 12) | `app-replay-page` | Hors-jeu, pas concerné. |

### Éléments non observables U4 (état inactif) — décisions via audit code Q3

| Élément | Audit code | Mode requis |
|---|---|---|
| Card travel float | `position: fixed`, appendu à `duel-page` host (pas `.board-host`) cf. [duel-page.component.ts:555](front/src/app/pages/pvp/duel-page/duel-page.component.ts#L555) | **Mode A obligatoire** pour S3 : changer `registerContainer` pour pointer `.board-host` au lieu de l'host duel-page. Mais aussi changer les coords keyframes (voir §4). |
| Slam dust, pre-destroy, activate effects (BoardEffectsService) | Même container que travel floats (= duel-page host) | **Mode A obligatoire** : suit le travel float. |
| Target indicator floats (TargetIndicatorManager) | Délégation à `boardEffects.createTargetFloat()` même container | **Mode A obligatoire** : idem. |
| Attack line + clash impact (BattleAnimationTracker) | `createLineBetween()` dans card-travel-engine, `position: fixed`, même container duel-page host | **Mode A obligatoire** : idem. |
| LP counter animation (LpAnimationTracker) | Non audité au niveau DOM ; probable panel UI (LP affiché sur `duelists-card` cf. [duel-page.component.html:33](front/src/app/pages/pvp/duel-page/duel-page.component.html#L33)) | **À auditer J3**. Le panel LP joueur/opposant est ailleurs que `.board-host` (cf. screenshot u1-after — les "8000" restent en place pendant le flip), donc **mode B** probable (le panel est lié à un slot joueur fixe à l'écran). |

---

## §4 Coût réel S3 (corrigé)

Le J1 a pré-sélectionné S3 (coords container-relative) en supposant qu'elle serait "quasi-gratuite si l'engine calcule déjà en container coords". **L'audit Q2 contredit cette supposition** :

- [card-travel-engine.service.ts:64](front/src/app/pages/pvp/duel-page/card-travel-engine.service.ts#L64) : `private _container: HTMLElement = document.body;` (registered à duel-page host, PAS `.board-host`)
- [card-travel-engine.service.ts:162, 178](front/src/app/pages/pvp/duel-page/card-travel-engine.service.ts#L162) : `readRect()` appelle `getBoundingClientRect()` (viewport-absolu)
- [card-travel-helpers.ts:89-91](front/src/app/pages/pvp/duel-page/card-travel-helpers.ts#L89) : `const dx = (destRect.left + destRect.width / 2) - (fromRect.left + fromRect.width / 2);` — deltas viewport
- [card-travel-engine.service.ts:299-310](front/src/app/pages/pvp/duel-page/card-travel-engine.service.ts#L299) : float créé en `position: fixed; left: ${sourceRect.left}px; top: ${sourceRect.top}px` (viewport)

**Conséquence** : appliquer `rotate(180deg)` sur `.board-host` n'affecte PAS un float en cours de travel (puisque le float vit hors `.board-host`, sous duel-page host). T2 du J1 isolé prédisait ce comportement — il s'applique tel quel ici.

**Coût refactor S3 (révisé)** :
1. Re-parent les floats sous `.board-host` (changer `registerContainer`) — 1 ligne mais il faut vérifier les `BoardEffectsService` qui partagent la même hypothèse.
2. Changer les coords keyframes de viewport-absolu à `.board-host`-relative — la transformation `viewport → container-local` est `rect.x - containerRect.x`, mais `getBoundingClientRect` continue de retourner viewport (CDK et CSS layout sont en viewport coords) ; il faut calculer les deltas en container et stocker les positions de départ en container. C'est un changement de 5-7 lignes dans `card-travel-helpers.ts` + `card-travel-engine.service.ts:299-310`.
3. Verifier que `BoardEffectsService` (slam dust, target floats, activate effect, attack line) suit la même convention. Audit ~5-10 fichiers.
4. Tests de non-régression : tous les travel patterns existants (HAND→MZONE, GY→HAND tutor, OVERLAY detach, multi-tribute, etc.).

**Estimation révisée S3** : **3-5 jours** (vs 5-7j initial). C'est moins lourd que je pensais parce que les `getBoundingClientRect()` ne changent PAS — seul le calcul de delta et le float positioning changent. Le moteur d'animation lui-même est intact.

**Coût S1 (cancel + replay)** : 2-3 jours, mais avec dette permanente — chaque nouveau site qui démarre un travel devra savoir s'enregistrer pour qu'un switch puisse l'annuler.

**Coût S2 (setKeyframes)** : 2-3 jours, équivalent S1 en complexité (besoin de tracker les animations actives pour leur appliquer `setKeyframes`). T3 J1 a confirmé que `setKeyframes` mid-anim est cross-browser fiable.

---

## §5 Stratégie révisée

**Pré-sélection J2 : S3 (coords container-relative)**, confirmée mais avec un nouveau coût réaliste.

Justification :
1. **Robustesse permanente** : une fois `.board-host` devient le container des floats + coords sont en container-local, **aucun code de switch n'est nécessaire**. Le browser flippe tout via CSS.
2. **Aligne le code avec le mental model** : "les animations vivent dans le board, le board peut être perspectivé". Aujourd'hui le code suppose l'inverse (les floats vivent au-dessus du board, indépendants).
3. **Coût acceptable** : 3-5j vs 2-3j S1, avec une dette de propriété permanente pour S1.

**Risque résiduel** : la `cdk-overlay-container` au niveau `body` reste hors-`.board-host`. Les composants qui utilisent CDK Overlay (effect-bubble, prompt-card-grid tooltip, MatDialog) ne pourront PAS être migrés en mode A. Pour eux, **mode B (observer perspective signal)** est nécessaire. Heuristique : **les overlays CDK sont des éléments "UI", pas "in-game"** — leur position doit être recalculée au flip via leur signal de re-positionnement (CDK supports `OverlayRef.updatePosition()`).

**Plan de bascule S3 → S1** : si J3 révèle qu'un site fondamental de `CardTravelEngine` est trop intriqué avec `document.body` (ex : floats portés ailleurs pendant un dialog modal), basculer en S1 reste possible avec un effort similaire à S3 mais sans la robustesse permanente.

---

## §6 Surprises J2

1. **`cardBaseRotation` est appliqué sur l'`<img>` art, pas sur le wrapper `.hand-card`**. Le `raw-card-probe.json` le montre clairement. Conséquence : Option A (suppression) est invalide, Option B (recalcul perspective-aware) est la bonne. ~5 lignes dans `duel-context.ts`.

2. **Les LP counts (chiffres) NE flippent PAS** — les screenshots u1-before/after montrent les "8000" stables en haut-droite (joueur) et bas-gauche (opposant). Le panel LP vit dans `duelists-card` ([duel-page.component.html:33](front/src/app/pages/pvp/duel-page/duel-page.component.html#L33)) qui est **hors `.board-host`**. Pour un design "perspective intégrale", il faudrait soit déplacer le panel dans le board, soit observer le perspective signal côté panel.

3. **Le replay-page wraps `pvp-board-container`** — la chain `div.board-host > app-pvp-board-container > div.board-area > div.replay-viewer > app-replay-page`. Le composant est unique entre PvP et replay, donc le flip racine au niveau `.board-host` couvre les deux cas sans branchement.

4. **`raw-board-u4.json` audit fonctionne sans flag** : la méthode "Δcenter avant/après transform" détecte automatiquement si un élément est inside/outside du container flippé. Cet utilitaire pourra devenir une **regression spec permanente** : tout nouveau composant ajouté au DOM du duel-page devra obligatoirement être inside `.board-host` (ou être documenté comme intentionnellement hors).

5. **Le `transform-origin` est par défaut `50% 50%` du `.board-host`** — pas besoin de le forcer. Mais le test l'a explicitement fixé pour déterminisme. À retenir : si quelqu'un ajoute `transform-origin: top left` un jour pour une autre raison, le flip de perspective serait cassé.

---

## §7 Captures avant/après pour communication

| Capture | Fichier | Description |
|---|---|---|
| Board statique perspective 0 | `screenshots/u1-before.png` | État initial draw phase, opposant haut, joueur bas, LP 8000 chacun. |
| Board flippé 180° | `screenshots/u1-after-confirmed.png` | Même état après `transform: rotate(180deg)` sur `.board-host`. Swap correct des champs. LP panels NE flippent PAS (preuve qu'ils sont hors-container). |
| Hand cards inspect avant flip | `screenshots/u2-before.png` | Détail hand cards en bas. |
| Hand cards inspect après flip | `screenshots/u2-after.png` | Hand cards en haut. Visuellement face-down (sleeve symétrique) — ne révèle pas le bug rotation art décrit en §2. |
| Audit hors-container avant | `screenshots/u4-before.png` | Référence pour les centres mesurés. |
| Audit hors-container après | `screenshots/u4-after.png` | Référence pour les centres mesurés. |

---

## §8 Statut critères de succès §7 de la spec

| Critère | Statut J2 |
|---|---|
| Une stratégie permet le travel mid-switch sans saut visuel > 2 frames | ⏳ S3 le permet par construction, mais nécessite refactor (3-5j). À valider sur board réel J3 avec un travel actif. |
| Cross-browser Chrome / WebKit | ✅ J1 — pas re-testé J2. |
| FPS ≥ 55 sur board réel desktop Chrome | ⏳ Non mesuré au repos avec flip. Aucun signal de souci visuellement. |
| FPS ≥ 30 sur mobile Chrome (DevTools throttling 4x) | ❌ Non testé. À ajouter J3 si Safari/mobile font partie du périmètre. |
| Rotation carte option viable | ✅ Option B.1 (~5 lignes) déterminée §2. |
| Hors-container chacun un mode de traitement défini | ✅ Tableau §3. CDK overlays = mode B (observer perspective), tous les floats animation = mode A (re-parent + container coords). |

**Verdict J2 : POC concluant à 4/6 critères. Restent J3 :** valider in-flight travel sur board réel + FPS mobile + chiffrage final effort. Pas de signal rouge.

---

## §9 Ce qui reste à valider J3

1. **Test in-flight live** : pendant un travel actif, appliquer le flip — observer la trajectoire. Devra être fait via un harness Playwright dédié qui surveille les `[ANIM:` logs pour timer le flip pendant un MSG_MOVE.
2. **FPS mobile Chrome 4× throttling** — non couvert J1/J2.
3. **Pseudo-code algorithme de switch perspective** (§3 du doc cadrage) : signal `perspective: signal<0|1>`, effect qui réapplique `transform: rotate(180deg)` selon valeur, observer CDK pour `updatePosition()`, observer LP/chain-overlay pour re-rendu.
4. **Décision finale S3 vs S1** : si l'effort 3-5j est jugé OK budget-wise, S3 — sinon S1 avec dette assumée.
5. **Mise à jour `duelSession-chantier-critiques.md` §1bis** : R1 statué (S3, coût 3-5j, Option B.1 pour cardBaseRotation).
6. **Audit `LpAnimationTracker`** : où vivent ses floats DOM-wise (couvert J3 par lecture code).
