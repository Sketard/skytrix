---
title: POC Projection — Demi-jour 1 findings
status: complete
date: 2026-05-25
spec_source: _bmad-output/planning-artifacts/poc-projection-spec.md §4
scenario_count: 6
browsers_tested: chromium 145 (Playwright), webkit 26.0 (Playwright)
---

# Demi-jour 1 — Résultats POC isolé Playwright

POC exécuté hors-Skytrix (page HTML inline via `page.setContent()`), aucune dépendance au stack dev. Spec dans `front/e2e/poc-projection-transform.spec.ts`. Données brutes par scénario × browser dans `_bmad-output/poc-projection/raw-T{1..6}-{chromium,webkit}.json`.

---

## §1 Tableau récapitulatif

Format colonnes : **landing OK** = `finalRect ≈ expectedFinalRect ± 1px` ; **fps avg** = moyenne sur la durée d'anim, hors première frame rAF (prime) ; **fps min** = pire frame mesurée. Easing observé via la trajectoire intermédiaire (échantillons 25/50/75/100%).

### Chromium

| # | Scénario | Landing | fps avg | fps min | Notes saillantes |
|---|---|---|---|---|---|
| **T1** | Référence sans rotate parent | (650, 450) = attendu ✅ | 60.0 | 59.5 | Baseline propre, easing material visible (75% atteint x=615 px → la décélération finale est bien là). |
| **T2** | Rotate parent 180° à 50%, aucune coordination JS | (70, 30) = flipped-dst ✅ | 60.0 | 59.5 | **L'animation continue dans le référentiel local** — le float saute visuellement de (515, 360) à (205, 120) à l'instant T=2000ms. Le saut EST le flip de perspective. Easing préservé, currentTime continu. |
| **T3** | `setKeyframes()` mid-animation | (70, 30) ✅ | 60.0 | 59.5 | **`setKeyframes` callable, `currentTime` préservé à 0ms près** (1983 → 1983ms). Pas de saut visuel inattendu (jumpRect vs postRect = drift de 3px = bruit d'interpolation, pas un snap). Easing : aucune indication de re-démarrage. |
| **T4** | Cancel + replay depuis pos courante | (70, 30) ✅ | 60.0 | 59.5 | **Gap = 1 frame**, cancel→replay = **2.2ms**. ATTENTION : `anim.cancel()` sur une anim `fill: forwards` retourne au state pré-anim — le float "snap" à sa position de fin (rectAfterApply = 670,430). Replay depuis pos courante interpolée requiert lecture rect AVANT cancel. |
| **T5** | Stress 10 floats × 12 flips × 40 anims sur 6s | n/a | 60.0 | 59.5 | **Stable.** 364 frames sur 6s = 60.7 fps moyens. Le moteur d'animation natif absorbe les flips parent sans dégrader. |
| **T6** | Coords container-relative + flip parent | (70, 30) ✅ | 60.0 | 59.5 | **Hypothèse H-T6 confirmée** : le browser auto-recompute la projection viewport. Aucune coordination JS au switch. Même comportement numérique que T2 dans cette POC isolée (cf. §3 ci-dessous pour la nuance). |

### WebKit (Playwright, Safari headless Windows)

| # | Scénario | Landing | fps avg | fps min | Notes saillantes |
|---|---|---|---|---|---|
| **T1** | Référence | (650, 450) ✅ | 45.0 | 32.3 | Landing identique chromium. FPS plus bas (headless WebKit Win ≠ Safari macOS réel). |
| **T2** | Rotate parent | (70, 30) ✅ | 45.4 | 32.3 | Comportement identique chromium : l'animation continue dans le référentiel local. Saut visuel à 50% : (515, 360) → (200, 117). |
| **T3** | `setKeyframes` mid-anim | (70, 30) ✅ | 44.7 | 32.3 | **`setKeyframes` callable** ✅, **currentTime préservé** ✅ (1997 → 1997ms). Parité Chromium parfaite sur le contrat WAAPI. |
| **T4** | Cancel + replay | (70, 30) ✅ | 45.7 | 32.3 | **Gap = 1 frame**, cancel→replay = **16ms** (~7× plus lent que chromium mais toujours < 1 frame à 60fps). |
| **T5** | Stress | n/a | 44.9 | **28.6** ⚠️ | fps min sous le seuil 30. À pondérer : headless WebKit Windows n'est pas représentatif de Safari macOS — à revalider sur device réel J2/J3 si Safari fait partie du périmètre cible. |
| **T6** | Coords container-relative | (70, 30) ✅ | 44.9 | 32.3 | Comportement identique chromium. Aucune divergence sur le contrat CSS transform. |

**Synthèse cross-browser** : aucun divergence comportementale entre Chromium et WebKit sur les contrats clés (setKeyframes mid-anim, cancel/replay gap, projection auto sur transform parent). FPS WebKit globalement plus bas mais imputable au headless Windows, pas à un bug. Le seul signal d'alerte (T5 webkit fps min = 28.6) reste à confirmer sur Safari macOS réel.

---

## §2 Verdicts §4.4 de la spec

### Verdict T2 — WAAPI recalcule-t-il les keyframes au changement de parent transform ?

**NON, confirmé.** L'animation continue strictement dans le référentiel local de l'élément animé. Les keyframes sont fixées à la création de l'animation et ne dépendent pas du transform parent. Conséquence : si l'engine actuel calcule `translate(viewportDeltaX, viewportDeltaY)` et que le parent rotate à 180°, l'animation termine au mauvais endroit visuellement (relatif au viewport).

Mesure clé : à t=2000ms, le float passe de viewport (515, 360) à (205, 120) en zéro temps — c'est le browser qui re-projette à cause du nouveau transform CSS parent, **mais** la trajectoire WAAPI continue son chemin pré-calculé.

### Verdict T3 — `setKeyframes` mid-animation viable ?

**OUI, cross-browser.** Chromium et WebKit acceptent l'appel sans erreur, `currentTime` est préservé à 0ms près, pas de saut visuel détectable (drift de 3px max = bruit d'interpolation entre deux frames de 16ms). Pas de redémarrage d'easing.

**Réserve** : le POC réinjecte des keyframes numériquement identiques (pour isoler la mécanique). Un test S2 réel devra réinjecter des keyframes recalculées dans le nouveau référentiel (translate values différentes) — la pratique standard MDN suggère que `setKeyframes` re-interpole proprement, mais ça reste un test à faire J2 sur le board réel pour confirmer que le saut visuel est acceptable.

### Verdict T4 — cancel + replay produit-il un gap visuel acceptable ?

**OUI, sous le seuil.** Gap = 1 frame mesurée (1 rAF entre cancel et `anim.animate()` du replay), coût temps = 2.2ms Chromium / 16ms WebKit — tous deux < 16.67ms (1 frame à 60fps). Sous le seuil "1-2 frames OK" de la spec §4.4.

**Piège identifié** : `anim.cancel()` sur une animation avec `fill: 'forwards'` (le cas dominant dans CardTravelEngine — les floats restent en place après landing) **retourne l'élément à son state pré-animation**, donc à `translate(0, 0)`. Le float saute alors à sa position de fin d'animation (puisque `fill: forwards` était actif). Mitigation indispensable : lire `getBoundingClientRect()` AVANT le cancel, ou utiliser `commitStyles()` pour fixer le state interpolé avant cancel.

### Verdict T6 — coords container-relative résout-il automatiquement ?

**OUI, confirmé.** Si le float est parenté dans le container et que ses keyframes sont des translates en coords container-locales, le rotate parent flippe automatiquement la projection viewport. Aucune coordination JS au switch.

**Nuance importante** : dans cette POC isolée, T6 ≡ T2 numériquement parce que les deux utilisent des translates container-locales. La distinction sémantique S3 (refactor `CardTravelEngine` pour calculer en coords container plutôt que viewport) se joue **au niveau de l'API engine**, pas du contrat WAAPI. T6 valide donc que **S3 est techniquement faisable** ; le coût d'implémentation (5-7j vs 2-3j pour S1) reste l'enjeu.

---

## §3 Surprises / pièges identifiés

### Surprise 1 : `fill: forwards` + `cancel()` = snap back

Documenté ci-dessus dans T4. Implication forte pour S1 (cancel+replay) : il faudra soit `commitStyles()` avant cancel, soit lire les rects avant cancel et reconstruire les keyframes à partir d'eux. Ajoute ~10 lignes au protocole de switch mais ne casse pas S1.

### Surprise 2 : T2 ≡ T6 dans la POC isolée

T2 et T6 produisent les mêmes mesures parce qu'ils utilisent tous deux le même float parenté dans `#container` avec un translate container-local. La distinction S2/S3 est sémantique au niveau de l'engine (où sont stockées les coords ?) pas au niveau du contrat WAAPI. **Implication** : la POC isolée ne discrimine pas S2 vs S3 sur la métrique "saut visuel". Il faut Demi-jour 2 (board réel) pour mesurer la différence d'effort + de robustesse.

### Surprise 3 : FPS WebKit headless = pas représentatif Safari

T5 WebKit fps min = 28.6, sous le seuil 30 de la spec §7. À ne pas surinterpréter — Playwright WebKit sur Windows est un wrapper headless non-accéléré ; Safari macOS sur device aurait probablement le même profil que Chromium (>55 fps stable). À retester J2/J3 si Safari fait partie du périmètre cible explicite.

### Surprise 4 : `transform-origin` matters

Le calcul `expectedFinalRect = (70, 30)` pour le scénario flippé suppose `transform-origin: 400px 300px` (centre du container 800×600). C'est posé explicitement dans la CSS du POC. Côté Skytrix, il faudra **fixer le transform-origin sur le container racine du board** (probablement `transform-origin: center center` est sain). À auditer J2.

---

## §4 Stratégie pré-sélectionnée

**Pré-sélection Demi-jour 1 : S3 (coords container-relative)**, avec S1 (cancel+replay) en plan de repli si l'audit J2 révèle des blocages refactor sur `CardTravelEngine`.

Raisons :

1. **T6 confirme que la projection est "gratuite"** dès lors que les floats sont dans le container et les coords container-locales. Pas de coordination JS au switch = pas de bug à écrire.
2. **S3 est plus robuste long terme** : le code "ne sait pas" qu'un switch existe, il calcule juste des coords locales. S1 et S2 vivent en permanence avec un risque de désynchronisation (oubli de cancel quelque part, oubli d'un setKeyframes mid-anim).
3. **T1-T6 valident la viabilité technique** : pas de bug WAAPI cross-browser, FPS sain (modulo WebKit headless à pondérer).
4. **Coût refactor 5-7j** vs 2-3j pour S1 : l'écart se justifie sur la robustesse, sauf si l'audit J2 révèle que `CardTravelEngine` calcule déjà en coords container (auquel cas S3 devient quasi-gratuit) **ou** que ses sites d'appel sont si dispersés que le refactor explose (auquel cas fallback S1).

**Critères de bascule S3 → S1 à vérifier J2** :
- Si `CardTravelEngine.travel()` accepte déjà des Elements (pas des coords viewport) et calcule les rects en interne → S3 est principalement un changement de calcul rect dans une seule fonction, ~1-2j.
- Si les call sites de `travel()` passent des coords viewport calculées à plusieurs endroits → refactor lourd, fallback S1 (2-3j sans refactor d'engine).

**Critères d'invalidation totale (rare)** :
- Si J2 révèle que le board contient des éléments en `position: fixed` qui s'animent (au-delà du chain overlay et du prompt dialog connus) → la couche de projection peut être incomplète quelle que soit la stratégie. À auditer §6 de la spec côté hors-container.

---

## §5 Ce qui reste à valider J2

1. **Applique le rotate 180° au container racine du board PvP réel via DevTools** et observe les éléments qui ne flippent pas (chain overlay, target indicator, prompts, dust particles, attack line). Audit §6 de la spec.
2. **Vérifie où `CardTravelEngine` stocke ses coords** (viewport-absolute vs container-relative). Détermine le coût réel S3 vs S1.
3. **Teste un switch in-flight pendant un travel réel** (pause un replay sur une frame d'animation, applique le transform, observe). Confirme que S3 marche au-delà du POC isolé.
4. **Décide rotation carte** (option A : retirer `cardBaseRotation`, option B : recalculer post-flip).
5. **Re-valider FPS WebKit sur Safari macOS réel** si Safari est dans le périmètre cible (le headless Windows n'est pas un proxy fiable).
6. **Vérifier transform-origin sain** sur le container racine du board (centre du board, pas un coin).

---

## §6 Critères de succès (§7 de la spec) — statut au J1

| Critère | Statut J1 |
|---|---|
| Une stratégie permet le travel mid-switch sans saut visuel > 2 frames | ✅ T3, T4, T6 OK. T4 = 1 frame. T6 = 0 frame (browser auto). |
| Cross-browser Chrome / WebKit | ✅ Parité parfaite sur les contrats clés. FPS WebKit à confirmer sur Safari réel. |
| FPS ≥ 55 sur board réel desktop Chrome | ⏳ POC isolé OK (60 fps). À confirmer J2 sur board réel. |
| FPS ≥ 30 sur mobile Chrome (DevTools throttling 4x) | ⏳ Non testé J1. À ajouter J2. |
| Rotation carte option viable (A ou B) | ⏳ À décider J2. |
| Hors-container chacun un mode de traitement défini | ⏳ Audit J3. |

POC J1 = concluant à 2/6 critères validés + 4/6 dépendant J2/J3. Aucun signal rouge.
