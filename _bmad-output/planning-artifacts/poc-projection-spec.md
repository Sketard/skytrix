---
title: Spec de POC — Couche de projection (transform CSS unique + travel mid-switch)
status: ready to execute
parent_chantier: duel-session-chantier.md (§4.2 connexes)
addresses_risks:
  - R1 — POC projection sans seuils chiffrés
  - EC-4 — Switch perspective pendant chain résolvante
  - EC-5 — Switch perspective pendant CardTravelEngine.travel() in-flight
  - EC-33 — getBoundingClientRect performance sous transform cross-browser
date: 2026-05-25
---

# Spec de POC — Couche de projection

Objectif : trancher si **un transform CSS unique sur le container racine + switch in-flight pendant travel de carte** est viable, et si oui, sélectionner la stratégie d'implémentation (cancel+replay vs re-keyframe vs coords container-relative).

Décision Axel actée :
- Modèle = **transform CSS unique** (pas de re-render data).
- Scénario cible = **switch in-flight pendant travel de carte doit marcher** (cas le plus exigeant).

---

## §1 Hypothèse à valider

**H** : Un `transform: rotate(180deg)` sur le container racine du board flippe correctement la perspective, et il existe une stratégie qui permet à `CardTravelEngine.travel()` de gérer un switch in-flight sans jump visuel inacceptable.

Si H est **invalidée** : retour table à dessin sur la couche de projection, le doc cadrage §1 reformulation doit reconnaître que "neutralité du pipeline" est plus coûteuse que prévu, ou abandonner le switch in-flight au profit d'une politique "switch attend la fin des animations".

---

## §2 Stratégies candidates à départager

| # | Nom | Principe | Complexité estimée |
|---|---|---|---|
| **S1** | Cancel + replay | Switch annule les animations en cours, les recrée dans le nouveau référentiel depuis position courante interpolée | 2-3 jours |
| **S2** | Re-keyframe à la volée | Switch appelle `animation.effect.setKeyframes()` avec nouvelles positions absolues, garde `currentTime` | 2-3 jours (mais browser-dependent) |
| **S3** | Coords container-relative | Refactor `CardTravelEngine` pour calculer trajets en coords container-relative — switch devient automatique (browser gère via repaint) | 5-7 jours |

Le POC départage en testant le comportement réel du moteur d'animation et en mesurant le coût de chaque approche sur un cas reproductible.

---

## §3 Méthodologie générale

3 demi-journées séquentielles. Chaque étape peut **court-circuiter** les suivantes si elle apporte un verdict définitif.

- **Demi-jour 1** : POC Playwright isolé hors-Skytrix. Question : que fait Web Animations API quand le transform parent change ?
- **Demi-jour 2** : Application au board PvP réel via DevTools. Question : la rotation des cartes + les éléments hors-container cassent-ils le flip ?
- **Demi-jour 3** : Décision finale + audit des éléments hors-container + écriture de l'algorithme dans le doc cadrage.

---

## §4 Demi-jour 1 — POC isolé Playwright

### 4.1 Setup

Créer `front/e2e/poc-projection-transform.spec.ts` (suit la convention des specs e2e existantes — cf. `debug-replay-harness.ts`).

Page HTML statique servie par le harness (ou inline dans le test) :

```html
<div id="container" style="position:relative; width:800px; height:600px; background:#eee">
  <div id="src" style="position:absolute; left:50px; top:50px; width:80px; height:120px; background:red"></div>
  <div id="dst" style="position:absolute; left:650px; top:450px; width:80px; height:120px; background:green; opacity:0.3"></div>
  <div id="float" style="position:absolute; left:50px; top:50px; width:80px; height:120px; background:blue"></div>
</div>
```

### 4.2 Scénarios à tester

| # | Scénario | Mesure |
|---|---|---|
| **T1** | Animation Web Animations API simple `[{ transform: 'translate(0,0)' }, { transform: 'translate(600px, 400px)' }]` durée 4000ms. Pas de transform parent. | Référence : float arrive à dst après 4s. Capture `getBoundingClientRect()` à 0, 25%, 50%, 75%, 100%. |
| **T2** | Idem T1 mais à 50% (2000ms), `container.style.transform = 'rotate(180deg)'`. | Que devient la trajectoire ? Le float arrive-t-il à dst dans le NOUVEAU référentiel (en bas à droite visuellement = ex-haut-gauche) ou ancien ? Capture rects à 50%, 75%, 100%. |
| **T3** | Idem T2 mais avec `animation.effect.setKeyframes(newKeyframes)` à 50% + `animation.currentTime = 2000` pour reprendre. Les `newKeyframes` sont calculées dans le nouveau référentiel. | `setKeyframes` mid-animation est-il supporté Chrome/Firefox/WebKit ? Y a-t-il un saut visuel ? L'easing redémarre-t-il ? |
| **T4** | Idem T2 mais on cancel l'animation à 50%, on lit `float.getBoundingClientRect()`, on calcule une nouvelle animation `[currentPos → newDst]` et on la lance. | Combien de frames de gap (`requestAnimationFrame` count entre cancel et play) ? La carte fait-elle un saut visible ? |
| **T5** | T1 répété 100x sur 10 floats simultanés avec un transform parent qui flip aléatoirement entre 0° et 180° toutes les 500ms. | Stabilité visuelle. FPS measure via `performance.now()` deltas. |
| **T6** | Coords container-relative : float positionné en `translate(srcX, srcY)` puis animation `[{ transform: 'translate(srcX, srcY)' }, { transform: 'translate(dstX, dstY)' }]` où srcX/srcY/dstX/dstY sont en coords container (pas viewport). Switch parent à 50%. | La trajectoire reste-t-elle valide automatiquement ? Float arrive-t-il visuellement à dst dans le nouveau référentiel ? |

### 4.3 Mesures à capturer (pour chaque scénario)

- **Position visuelle finale** du float vs position attendue (`getBoundingClientRect()` à t=duration)
- **Trajectoire intermédiaire** (rects à 25/50/75/100%)
- **FPS** durant l'animation (via `requestAnimationFrame` deltas)
- **Comportement easing** (visuel : la carte décélère-t-elle aux deux endroits attendus, ou y a-t-il un saut ?)
- **Cross-browser** : Chrome desktop, Chrome mobile (DevTools throttling), WebKit (via Playwright `webkit`)

### 4.4 Output Demi-jour 1

Fichier `_bmad-output/poc-projection/day1-findings.md` contenant :

1. Tableau récapitulatif des 6 scénarios × 3 browsers × résultat
2. **Verdict T2** : Web Animations API recalcule-t-il les keyframes au changement de parent transform ? (réponse théorique : non, à confirmer)
3. **Verdict T3** : `setKeyframes` mid-animation est-il viable ? (browser-dependent)
4. **Verdict T4** : cancel+replay produit-il un gap visuel acceptable ? (1-2 frames OK, > 3 frames = problème)
5. **Verdict T6** : coords container-relative résout-il automatiquement ? (réponse théorique : oui, à confirmer)
6. **Stratégie pré-sélectionnée** parmi S1/S2/S3 + raison

Si T6 marche cross-browser → S3 quasi-imposée (le browser fait le boulot). Si T6 échoue mais T4 OK → S1. Si T4 et T6 tous deux échouent → reconsidérer l'objectif "switch in-flight".

---

## §5 Demi-jour 2 — Application au board PvP réel

### 5.1 Setup

- Lancer `ng serve`
- Ouvrir un replay (n'importe lequel) pour avoir un board réel avec animations potentielles
- Via DevTools, injecter via console : `document.querySelector('[CONTAINER_SELECTOR]').style.transform = 'rotate(180deg)'`
- Observer

### 5.2 Scénarios à tester

| # | Scénario | Mesure |
|---|---|---|
| **U1** | Board statique au repos. Apply transform 180° au container. | Le plateau flip-il visuellement ? Les **cartes** sont-elles dans le bon sens (côté joueur en bas après flip = ex-haut visuellement) ? |
| **U2** | Idem U1 + observer comportement de `cardBaseRotation`. Les cartes du joueur étaient à 0° avant flip — elles sont à 180° après. Inversement pour l'opposant. | **Comportement attendu** : option A (retirer cardBaseRotation) ou option B (recalculer post-flip). Quelle est la moins invasive ? |
| **U3** | Pendant un travel de carte (timing : pause replay sur frame d'animation, ou observer en live), apply le transform. | Le float continue-t-il dans le nouveau référentiel (S3) ou dans l'ancien (S1/S2 nécessaires) ? Confirme la décision Demi-jour 1. |
| **U4** | Audit visuel : quels éléments **ne flippent pas** ? | Liste à compléter (cf. §6 ci-dessous) |

### 5.3 Output Demi-jour 2

Fichier `_bmad-output/poc-projection/day2-findings.md` contenant :

1. **Confirmation** que la stratégie sélectionnée Demi-jour 1 fonctionne (ou non) sur le board réel
2. **Décision rotation carte** : option A vs B
3. **Liste des éléments hors-container** qui ne flippent pas + sous-action requise pour chacun
4. **Captures d'écran** avant/après pour communication

---

## §6 Demi-jour 3 — Audit hors-container + décision finale

### 6.1 Audit code des éléments hors-container

Lister tous les composants/services qui :
- Utilisent `cdk-overlay` (Angular Material CDK Overlay attaché au body)
- Ont `position: fixed` dans leur SCSS
- Appendent du DOM directement à `document.body` ou hors du container board

Candidats à auditer :

| Composant | Vérification | Décision si hors-container |
|---|---|---|
| Chain overlay (banner première multi-link) | Probable cdk-overlay → body | Déplacer dans container OU flip séparé |
| Target indicator (reticles GY/Banished/ED) | `TargetIndicatorManager` — vérifier DOM parent | Idem |
| Slam dust particles | `BoardEffectsService.slamDustParticles` — vérifier DOM parent | Probablement OK si dans container |
| Pre-destroy effect | `BoardEffectsService.preDestroyEffect` | Idem |
| Activate effect | `BoardEffectsService.activateEffect` | Idem |
| Card travel float | `FloatRegistryService` — DOM parent ? | Doit être dans container pour S3 |
| Attack line + clash impact | `BattleAnimationTracker` | À vérifier |
| LP counter animation | `LpAnimationTracker` | À vérifier (probablement DOM par-joueur, attaché à un panel UI) |
| Prompt dialog (`pvp-prompt-dialog`) | cdk-dialog → body. Switch interdit pendant prompt actif | Convention : pas de switch pendant prompt |
| DuelLogger / DevHub overlays | Hors-jeu | Non concerné |

Pour chaque hors-container : décider **mode A** (déplacer dans container), **mode B** (flip séparé via observer du perspective signal), **mode A+B mixed**.

### 6.2 Décision finale stratégie

Croisement Demi-jour 1 + Demi-jour 2 + audit :

| Critère | S1 (cancel+replay) | S2 (re-keyframe) | S3 (coords container-relative) |
|---|---|---|---|
| Switch in-flight visuellement clean | ⚠️ Gap 1-2 frames | ⚠️ Easing redémarre | ✅ Automatique |
| Coût implémentation | 2-3j | 2-3j | 5-7j |
| Risque cross-browser | Faible | Modéré (setKeyframes) | Faible (translate CSS) |
| Refactor `CardTravelEngine` | Léger | Léger | Lourd |
| Robustesse long terme | Bonne | Moyenne | Excellente |

### 6.3 Output Demi-jour 3

Fichier `_bmad-output/poc-projection/decision.md` contenant :

1. **Stratégie sélectionnée** (S1, S2, ou S3) + raison
2. **Mode rotation carte** (A ou B)
3. **Plan de traitement des éléments hors-container** : liste avec décision par item
4. **Pseudo-code** de l'algorithme de switch perspective (à intégrer dans le doc cadrage §1 reformulation ou §3.X)
5. **Effort d'implémentation estimé** (jours-homme totaux)
6. **Tests obligatoires** à couvrir : les 6 scénarios T1-T6 du Demi-jour 1 + les 4 scénarios U1-U4 du Demi-jour 2 deviennent des tests de non-régression

---

## §7 Critères de succès du POC

Le POC est **concluant** si tous les critères suivants sont vrais :

- ✅ Une stratégie permet le travel mid-switch sans saut visuel > 2 frames
- ✅ Cross-browser Chrome / WebKit (mobile WebKit non bloquant mais à signaler si fail)
- ✅ FPS ≥ 55 sur board réel desktop Chrome avec animations en cours + switch
- ✅ FPS ≥ 30 sur mobile Chrome (DevTools throttling 4x)
- ✅ La rotation des cartes a une option viable (A ou B) qui ne casse pas les conventions existantes
- ✅ Les éléments hors-container ont chacun un mode de traitement défini

Le POC est **non concluant** si :

- ❌ Aucune stratégie ne donne un gap visuel < 3 frames au switch in-flight → réviser l'objectif : "switch attend la fin des animations" devient acceptable ?
- ❌ FPS < 30 desktop sur board réel → la couche de projection a un coût prohibitif → reconsidérer le modèle (peut-être Modèle 2 re-render data après tout)
- ❌ WebKit casse complètement → impact UX sur Safari à acter

---

## §8 Livrables finaux du POC

À la fin des 3 demi-journées :

1. `_bmad-output/poc-projection/day1-findings.md` — résultats Playwright isolé
2. `_bmad-output/poc-projection/day2-findings.md` — résultats board PvP réel
3. `_bmad-output/poc-projection/decision.md` — stratégie sélectionnée + algorithme
4. `_bmad-output/poc-projection/screenshots/` — captures avant/après pour communication
5. **Section ajoutée au doc cadrage** `duel-session-chantier.md` §1 reformulation ou §3.X — algorithme de switch perspective figé
6. **Mise à jour** `duel-session-chantier-critiques.md` §1bis ajoutant R1 statué

---

## §9 Risques du POC lui-même

- **Risque 1** : Web Animations API a des subtilités cross-browser non documentées. Mitigation : Demi-jour 1 isolé hors-Skytrix permet d'identifier sans biais.
- **Risque 2** : Le board PvP a tellement de spécificités (z-index, overflow, transform-style: preserve-3d ?) que le POC isolé n'extrapole pas. Mitigation : Demi-jour 2 valide sur le board réel.
- **Risque 3** : Le POC prend > 3 demi-journées. Mitigation : timebox dur — si J2 n'a pas validé une stratégie, l'objectif "switch in-flight" est revisité.

---

## §10 Comment lancer

3 options pour exécuter ce POC :

1. **Toi-même** : 3 demi-journées étalées sur 1-2 semaines selon disponibilité. Recommandé si tu veux internaliser la mécanique CSS.
2. **Sous-agent Claude** : déléguer Demi-jour 1 (POC isolé) à un agent (peut écrire et exécuter le Playwright spec, capturer les résultats). Demi-jour 2 + 3 par toi (impliquent du jugement UX).
3. **Mixte** : sous-agent pour le code Playwright et le run, toi pour l'analyse + Demi-jour 2 + 3.

Recommandation : option 3. Le code Playwright est mécanique, l'analyse est créative.
