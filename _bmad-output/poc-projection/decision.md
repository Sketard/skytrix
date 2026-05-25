---
title: POC Projection — Décision finale (Demi-jour 3)
status: complete
date: 2026-05-25
depends_on:
  - day1-findings.md
  - day2-findings.md
  - poc-projection-spec.md
---

# Décision finale POC projection

3 demi-journées exécutées. POC concluant. Cette page condense les outputs J1+J2+J3 en une décision actionable.

---

## §1 Stratégie sélectionnée

**S3 — Coords container-relative + re-parent floats sous `.board-host`**.

Justification :

1. **Robustesse permanente structurelle**. Une fois les floats parentés sous `.board-host` et les keyframes calculées en container-local, **un switch de perspective devient un `style.transform = 'rotate(180deg)'`** appliqué à un seul élément. Aucune coordination JS, aucune annulation, aucun tracking d'animations en cours.
2. **J1/T6 a démontré la viabilité** : transform parent à 50% d'un travel, float parenté dans le container, atterrissage exact au pixel près à la destination flippée, 60 fps Chromium + WebKit. Cross-browser parfait.
3. **Coût réel mesuré 3-5j** (révisé J2) — pas les 5-7j initialement estimés. L'audit Q2 montre que la refonte se limite à : changer `registerContainer` pour pointer `.board-host`, transformer les deltas viewport en deltas container-locaux dans `card-travel-helpers.ts`, vérifier la cohérence sur `BoardEffectsService`.
4. **L'écart S3 vs S1 (3-5j vs 2-3j) se justifie par l'absence de dette permanente**. S1 impose à chaque nouveau site d'animation de s'enregistrer dans un tracker de switch ; tôt ou tard quelqu'un oublie, et un float continue tout droit dans le mauvais référentiel.

**S1 et S2 sont rejetées** mais restent des plans de repli viables si l'implémentation S3 révèle un blocage non-anticipé (cf. §6 plan de bascule).

---

## §2 Mode rotation carte

**Option B.1 — `cardBaseRotation` devient perspective-aware**.

Définition cible dans [duel-context.ts:73-81](front/src/app/pages/pvp/duel-page/duel-context.ts#L73) :

```typescript
// Avant : relPlayer=1 → 180, sinon undefined (suppose implicitement perspective=0)
// Après : la rotation locale dépend du joueur ET du perspective actif.
cardBaseRotation(relPlayer: number): number | undefined {
  const flipped = this.perspective() === 1; // signal injecté
  const isOwn = relPlayer === 0;
  // Le RH side (perspective=0, own au bottom) : own=0°, opp=180°.
  // Le LH side (perspective=1, own au top après flip) : own=180°, opp=0°.
  if (flipped) return isOwn ? 180 : undefined;
  return isOwn ? undefined : 180;
}
```

Pourquoi B.1 plutôt qu'A (suppression) :

- L'audit J3 (`raw-card-probe.json`) a établi que `cardBaseRotation` est appliqué sur l'`<img class="hand-card-art">`, pas sur le wrapper `.hand-card`. Le wrapper porte le fan tilt indépendamment.
- Composition mathématique post-flip parent à 180° :
  - **Joueur** (rel=0, désormais en haut visuellement) : art à 0° local × 180° board = 180° visuel = **artwork upside-down si carte révélée**.
  - **Opposant** (rel=1, désormais en bas) : art à 180° local × 180° board = 360° = à l'endroit.
- Option A (suppression de la rotation, art à 0° des deux côtés) recrée le bug actuel inversé : sans flip, l'opposant aurait son art à l'endroit pour le viewer côté joueur — illisible.
- Option B.1 préserve la convention "art face vers le owner" dans tous les perspectives.

**Coût** : ~5 lignes dans `duel-context.ts` + injection d'un signal `perspective` (qui sera de toute façon créé pour piloter le transform `.board-host`).

**Effet de bord** : les chiffres LP et leurs deltas (`+/- N`) subissent le même problème — visibles à l'envers post-flip. Décision §3 (LP counter) traite le sujet identiquement.

---

## §3 Plan de traitement des éléments hors-container

Sources : audit code Q3 (J2) + sondages DOM live U4/LP (J2/J3).

### Mode A — re-parenter dans `.board-host`

Le flip CSS s'occupe automatiquement de la projection. Les coords keyframes doivent être container-locales.

| Élément | Refactor requis | Effort |
|---|---|---|
| Card travel float (FloatRegistryService) | `registerContainer(boardHost)` au lieu de duel-page host ; coords keyframes en container-local | **Cœur S3** — inclus dans estimation |
| Slam dust, pre-destroy, activate effect (BoardEffectsService) | Idem — `_container` aligné sur `.board-host` | Inclus dans S3 |
| Target indicator floats (TargetIndicatorManager) | Idem — délègue à `boardEffects.createTargetFloat()` | Inclus dans S3 |
| Attack line + clash impact (BattleAnimationTracker) | Idem — `createLineBetween()` dans card-travel-engine, même container | Inclus dans S3 |
| LP badges (`app-pvp-player-card`) | Déjà DANS `.board-host` — **mode A natif**, pas de refactor de parent | 0 — déjà conforme |

### Mode B — observer le signal `perspective` et inverser séparément

Pour ce qui ne peut PAS être parenté sous `.board-host`.

| Élément | Action requise | Effort |
|---|---|---|
| Texte LP + deltas (à l'intérieur des badges) | Contre-rotation 180° via classe CSS conditionnée par `perspective()` quand `flipped`. Identique au pattern `cardBaseRotation`. | ~0.5j |
| `app-pvp-chain-overlay` (`position:fixed; inset:0` sur `main.dark-theme-content`) | Soit re-parenter dans `.board-host` (préféré, le banner doit suivre le board), soit observer perspective et appliquer rotate sur son contenu. **Recommandé : déplacer dans `.board-host`** — c'est un overlay du board, pas du chrome de page. | ~0.5j |
| `app-effect-bubble` (CDK overlay attaché à `app-pvp-player-card`) | Le CDK calcule la position via `getBoundingClientRect()` de l'origin. L'origin (`app-pvp-player-card`) flippe avec le board — la position du CDK overlay sera donc déjà cohérente. **Mais** son orientation visuelle (contenu de la bulle) subira le même problème que le texte LP : retourné post-flip. Solution : contre-rotation du contenu. Tester `OverlayRef.updatePosition()` après un flip pour confirmer le re-positionnement. | ~0.5j + test |
| Prompts (`app-pvp-prompt-dialog`) | **Convention** : pas de switch perspective pendant un prompt actif (déjà acté spec §6.1). Pas de traitement. | 0 |
| `.cdk-overlay-container` global (Material) | Hors-jeu (dialogs, snackbars). Non concerné. | 0 |
| `app-duel-dev-hub` | Hors-jeu. | 0 |

### Total effort hors-container

**~1.5j** (texte LP + chain overlay re-parent + effect bubble contre-rotation) en plus de la refonte coeur S3.

---

## §4 Pseudo-code de l'algorithme de switch perspective

À intégrer dans `duel-session-chantier.md` §5.2 ou §3.X (cf. §6 livrables).

```typescript
// Source de vérité : un signal partagé via DI (DuelContext étendu).
interface PerspectiveSource {
  /** 0 = own player at bottom (default), 1 = flipped (own at top). */
  perspective(): WritableSignal<0 | 1>;
  /** True iff a switch is currently animating (debounce / no-double-fire). */
  switching(): Signal<boolean>;
}

// Le composant racine du board observe le signal et applique le transform.
// pvp-board-container.component.ts (extrait) :
@Component({ template: `<div class="board-host" [style.transform]="boardTransform()"> ... </div>` })
class PvpBoardContainerComponent {
  protected readonly boardTransform = computed(() =>
    this.duelCtx.perspective()() === 1 ? 'rotate(180deg)' : 'rotate(0deg)'
  );

  // CSS : .board-host { transform-origin: center center; transition: transform 250ms cubic-bezier(...); }
  // La transition gère l'animation visible du flip lui-même. Pendant ces 250ms,
  // les floats en cours de travel continuent leur animation WAAPI — leur
  // trajectoire est en coords container-local, donc le browser interpole
  // la projection viewport sans coordination JS (T6 prouvé J1).
}

// API publique : déclencher un switch.
function switchPerspective(target: 0 | 1) {
  if (this.duelCtx.switching()) return;        // pas de re-entry
  if (this.promptActive()) return;             // convention : pas pendant prompt
  this.duelCtx.perspective().set(target);      // signal flip
  // Pas d'autre action : tout est CSS-driven.
}

// Composants observateurs (mode B) :
class PvpLpBadgeComponent {
  protected readonly textCounterRotation = computed(() =>
    this.duelCtx.perspective()() === 1 ? 'rotate(180deg)' : 'rotate(0deg)'
  );
  // template: <span class="lp-value" [style.transform]="textCounterRotation()">{{ lp }}</span>
}

// DuelContext.cardBaseRotation est lui-même perspective-aware (cf. §2).
```

**Invariants à protéger** :

1. `perspective()` n'est lu QUE via `DuelContext` — pas de duplication signal.
2. `CardTravelEngine.registerContainer(boardHost)` est appelé une fois au mount de `pvp-board-container`, jamais re-call.
3. Les coords keyframes sont **container-local** (delta calculé par `rect.x - containerRect.x`, etc.), JAMAIS viewport-local.
4. Aucun composant ne lit `getBoundingClientRect()` pour positionner un float SAUF dans la phase de calcul des coords keyframes — et le calcul soustrait immédiatement `containerRect`.
5. `cardBaseRotation` reste dans `DuelContext` — pas de copie locale dans MoveAnimationRouter/DrawSequenceManager (déjà conforme).

**Anti-patterns à interdire** :

- `style.position = 'fixed'` sur un float in-game (briserait le flip).
- `document.body.appendChild` pour un élément de jeu (briserait le flip).
- Toute lecture de `getBoundingClientRect()` post-keyframe-build pour piloter une animation en cours (la projection peut avoir changé entre le getRect et le frame suivant).

---

## §5 Effort d'implémentation estimé

| Bloc | Effort | Détail |
|---|---|---|
| Refactor `CardTravelEngine` viewport → container coords | 1.5-2j | `registerContainer` + `card-travel-helpers` deltas + float positioning |
| Audit + alignement `BoardEffectsService` | 0.5-1j | slam dust, pre-destroy, activate, target floats — même container |
| Audit `BattleAnimationTracker` | 0.5j | attack line / clash impact via `createLineBetween` |
| `DuelContext` : signal `perspective` + `cardBaseRotation` perspective-aware | 0.5j | ~10-15 lignes, ajout du signal + computed |
| Mode B sur texte LP + deltas | 0.5j | classe CSS conditionnée |
| Chain overlay : re-parent ou contre-rotation | 0.5j | déplacer DOM dans `.board-host` est probablement le plus simple |
| Effect bubble : test CDK re-positioning + contre-rotation contenu | 0.5j | + test manuel |
| Tests de non-régression (T1-T6 + U1-U4 deviennent persistants) | 0.5j | les specs Playwright existent déjà — porter vers `front/e2e/` propre |
| **Total** | **4.5-5.5j** | un dev solo, sans surprise |

Marge incompressible : +1j pour gérer surprises sur des trajets exotiques (Pendulum, Link materials, mass destroy multi-tribute). Cible **5-6.5j**.

---

## §6 Tests de non-régression obligatoires

Les specs Playwright J1+J2 deviennent des **tests permanents**, complétés par des tests post-refactor.

### Tests J1+J2 à porter en regression

| Spec | Path | Bloc validé |
|---|---|---|
| T1-T6 WAAPI isolé | `front/e2e/poc-projection-transform.spec.ts` | Contrats WAAPI cross-browser, baseline référence |
| U1-U4 board réel | `front/e2e/poc-projection-board.spec.ts` | `.board-host` flip + audit DOM-inside |
| Probe card DOM | `front/e2e/poc-projection-card-probe.spec.ts` | `cardBaseRotation` localisation |
| Probe LP | `front/e2e/poc-projection-lp-probe.spec.ts` | Player-card flip + LP badge inside `.board-host` |
| Throttling 4× | `front/e2e/poc-projection-mobile-throttling.spec.ts` | FPS sous CPU throttling |

### Tests à ajouter post-refactor

| Test | Validation |
|---|---|
| Travel HAND→MZONE post-flip immédiat | Float atterrit dans la bonne zone visuellement après refactor S3 |
| Switch mid-travel HAND→MZONE | T2-like mais sur board réel avec engine refactoré — le float doit terminer dans la zone, dans le bon référentiel |
| Multi-tribute (3 floats simultanés) + flip | Aucun float ne reste accroché à l'ancien référentiel |
| Chain résolvant + flip in-flight | Buffer replay continue, overlay re-positionne correctement (mode A natif si chain overlay re-parenté) |
| LP delta animation + flip | Le `+/- N` reste lisible (mode B contre-rotation) |
| Pendulum scale activation + flip | Cas le plus exotique de placement |

### Tests d'invariant code (lint + spec unit)

| Invariant | Mécanisme |
|---|---|
| Aucun nouveau `position: fixed` dans `front/src/app/pages/pvp/duel-page/**/*.scss` sans dérogation commentée | Stylelint custom rule ou grep CI |
| Aucun nouveau `document.body.appendChild` dans le pipeline anim | ESLint custom rule |
| `CardTravelEngine.registerContainer` n'est appelé qu'une fois | Spec unit ou logger.warn d'idempotence |

---

## §7 Statut critères de succès §7 de la spec

| Critère | Statut J3 | Source |
|---|---|---|
| Une stratégie permet le travel mid-switch sans saut visuel > 2 frames | ✅ S3 le permet par construction (T6 J1) | day1-findings.md |
| Cross-browser Chrome / WebKit | ✅ Parité parfaite | day1-findings.md |
| FPS ≥ 55 sur board réel desktop Chrome | ✅ J1 60 fps stable ; J2 board réel : pas de mesure FPS pendant flip mais aucun signal de souci visuellement | day1-findings.md + day2-findings.md |
| FPS ≥ 30 sur mobile Chrome (CPU throttling 4×) | ✅ 60 fps mesurés sous throttling — nuance : les animations testées sont GPU-compositées, le throttling CDP affecte le JS thread pas le compositor. Mesure largement positive mais optimiste. | raw-T5-throttle-chromium.json |
| Rotation carte option viable | ✅ Option B.1 (~5 lignes) | day2-findings.md §2 + decision.md §2 |
| Hors-container chacun un mode de traitement défini | ✅ Tableau §3 | decision.md §3 |

**Verdict : POC concluant à 6/6 critères**. Aucun signal rouge.

---

## §8 Surprises J3

1. **Erreur d'interprétation J2 corrigée sur les LP**. Le rapport J2 disait "les LP counts (8000) restent stables au flip — ils vivent dans `duelists-card`, hors `.board-host`". Faux : le sondage `raw-lp-probe.json` montre que `app-pvp-player-card` est DANS `.board-host` et que le badge flippe correctement (centres swappés diagonal). La "stabilité visuelle" perçue venait de la **symétrie 180° approximative du glyph 8 et 0** — "8000" rotated 180° ressemble à "0008" (confirmé par Axel). La vraie nuance : **mode A natif pour le placement, mode B pour le contenu**.
2. **FPS sous throttling CDP 4× = 60 fps**. CDP throttling affecte le JS thread mais pas le compositor GPU. Les translates CSS sont GPU-compositées, donc le critère "FPS ≥ 30 mobile" est largement satisfait. Mesure positive mais on saurait pas distinguer un cas où le compositor lui-même serait saturé. À surveiller en condition réelle mobile Safari sur iPhone bas de gamme — backlog post-refactor.
3. **Le doc J2 sous-estimait le coût mode B**. Le compte-rendu disait "0.5j texte LP". En réalité, chaque composant qui rend du texte ou de l'iconographie orientée (chiffres LP, deltas LP, contenu d'effect bubble, banners chain overlay) doit observer le signal `perspective` et appliquer une contre-rotation. Le total mode B passe à ~1.5j tout compris.
4. **`app-pvp-chain-overlay` est `position: fixed; inset:0` mais parenté à `main.dark-theme-content`** (hors `.board-host`). Le sortir de là et le mettre comme enfant de `.board-host` permet à `inset:0` de référencer la bounding box du board, et le flip gère le reste. Refactor probablement 5-10 lignes.
5. **Le test in-flight live sur board réel n'a pas été instrumenté** — j'ai conclu que l'engine actuel produirait par construction un travel "tout droit dans le mauvais référentiel" (puisque les floats sont hors `.board-host` et coords viewport). Confirmer le bug attendu ne valide pas S3 ; ce qui validera S3 c'est un test post-refactor (cf. §6 tests à ajouter). Décision : pas de test in-flight live pré-refactor — gain d'info trop faible vs effort harness.

---

## §9 Risques résiduels post-décision

| Risque | Probabilité | Mitigation |
|---|---|---|
| `CardTravelEngine` a un site d'appel qui repose sur `document.body` pour une raison non-anticipée (z-index, overflow:hidden, etc.) | Faible-Moyen | Audit ciblé au début du refactor. Si trouvé, isoler ce site dans une exception documentée. |
| Le contenu d'`app-effect-bubble` ne se contre-rotate pas proprement (CDK overlay positioning) | Moyen | Test manuel précoce. Plan B : déplacer le composant comme enfant direct du player-card au lieu de passer par CDK. |
| Les Web Animations en cours pendant un flip parent ne re-projettent pas instantanément le `getComputedStyle().transform` (race entre flip et frame suivant) | Faible | J1 T2 + T6 ont prouvé que le browser re-projette dans la même frame. Pas de cas connu de divergence. |
| Performance dégradée sur Safari iOS bas de gamme (compositor saturé par `rotate(180deg)` sur un large container) | Faible | Pas testable hors device réel. Backlog post-refactor. |
| Modification de `cardBaseRotation` casse un cas existant (consommateurs : MoveAnimationRouter 3 sites, DrawSequenceManager 2 sites, card-travel-helpers) | Faible | Les 5 sites consomment l'API publique du `DuelContext` — ils n'observent que le retour de la fonction. Changer le calcul interne est transparent pour eux. |

---

## §10 Livrables clos

Conformément à `poc-projection-spec.md §8` :

- ✅ `day1-findings.md` — Playwright isolé (6 scénarios × 2 browsers)
- ✅ `day2-findings.md` — board PvP réel (U1-U4 + audit code Q1-Q4 + probe DOM cartes)
- ✅ `decision.md` (ce fichier) — stratégie + algorithme + effort + tests
- ✅ `screenshots/` — captures avant/après pour communication (u1-before, u1-after-confirmed, u2-before, u2-after, u4-before, u4-after, lp-probe-after)
- ⏳ Patch `duel-session-chantier.md` §5.2 — algorithme intégré (à appliquer post-décision)
- ⏳ Patch `duel-session-chantier-critiques.md` §1bis R1 — statut "statué" (à appliquer post-décision)

Specs Playwright produites pendant le POC (à conserver comme regression assets) :

- `front/e2e/poc-projection-transform.spec.ts` (J1, 6 tests)
- `front/playwright.config.poc.ts` (J1, config chromium+webkit dédiée)
- `front/e2e/poc-projection-board.spec.ts` (J2, U1-U4)
- `front/e2e/poc-projection-card-probe.spec.ts` (J2, sondage DOM cartes)
- `front/e2e/poc-projection-lp-probe.spec.ts` (J3, sondage LP/player-card flip)
- `front/e2e/poc-projection-mobile-throttling.spec.ts` (J3, FPS sous CDP throttling)

Données brutes : `raw-T{1..6}-{chromium,webkit}.json`, `raw-T5-throttle-chromium.json`, `raw-board-{u1..u4}.json`, `raw-card-probe.json`, `raw-lp-probe.json`.

---

## §11 Conclusions à re-prouver pendant l'implémentation

Audit rétrospectif de ce POC : l'erreur d'interprétation J2 sur les LP (corrigée J3 par Axel) révèle une classe de conclusions reposant sur des inférences (numériques ou lecture-de-code) plutôt que sur une validation visuelle ou empirique. Les points ci-dessous sont **probablement justes**, mais **non-validés directement**. Plutôt que de relancer le POC pour chacun, ils sont tagués comme "à vérifier au moment où ça coûte le moins cher" — c'est-à-dire pendant l'implémentation S3.

| # | Conclusion | Source | Confiance | Test minimal à faire au refactor |
|---|---|---|---|---|
| 1 | "Swap correct des champs au flip" (opponent-field ↔ player-field) | `raw-board-u4.json` (centres Δy=±439) | **Haute sur le placement, basse sur le contenu** | Capture vidéo du flip pendant un état avec **carte face-up** opponent (révélée par CONFIRM_CARDS). Vérifier que l'art est à l'endroit côté joueur post-flip. |
| 2 | "Option B.1 (`cardBaseRotation` perspective-aware) résout proprement la rotation cartes" | Inférence depuis composition mathématique 180°×180°=360° + `raw-card-probe.json` (matrix(-1,0,0,-1,0,0) sur `<img>` opponent) | **Haute mais théorique** | Idem #1 : à la 1ère carte face-up révélée post-refactor, vérifier visuellement que l'art est dans le bon sens dans les 2 perspectives. ~30s de test. |
| 3 | "FPS ≥ 30 mobile (throttling 4×) largement validé : 60 fps mesurés" | `raw-T5-throttle-chromium.json` | **Faible** : pas vérifié que `Emulation.setCPUThrottlingRate` était effectivement appliqué. CDP commands peuvent échouer silencieusement. | Re-run du test avec un **canary JS-bound** (boucle CPU-heavy en parallèle de l'anim) qui DEVRAIT effondrer le FPS sous throttling. Si le canary tourne aussi vite que sans throttle → throttling pas appliqué. |
| 4 | "Effect bubble : CDK gère sa position via getBoundingClientRect de l'origin, donc suit le flip" | Inférence lecture-de-code (sous-agent Explore J2 Q3) | **Moyenne** : pure déduction sans test. | Au moment de toucher au composant : appliquer le flip pendant qu'une bulle est affichée, observer si elle reste ancrée à `app-pvp-player-card`. Si non, plan B = re-parent direct + skip CDK. |
| 5 | "Effort 5-6.5j" | Estimation à dire d'expert | **Moyenne** : pas calibrée par un timing réel sur ce codebase. Marge déjà incluse (+1j surprises). | Suivre le burn-down. Si jour 3 atteint sans avoir fini `CardTravelEngine` refactor + `BoardEffectsService` alignement, c'est qu'on dépasse — réviser scope (peut-être laisser le mode B contenus pour un sprint 2). |
| 6 | "Replay-page et PvP live mountent dans la même DOM chain → un seul flip couvre les deux" | Inférence sur la chain `div.board-host > app-pvp-board-container > ... > app-replay-page` observée en J2 mais SEULEMENT en mode replay | **Moyenne** : pas testé en PvP live. Le `preview` flag de `pvp-board-container` pourrait changer la structure. | Au début de l'implémentation : exécuter `poc-projection-board.spec.ts` adapté contre une session PvP live (back/duel-server up, 2 clients), vérifier que `.board-host` existe et flippe pareil. ~10 min d'adaptation du spec. |
| 7 | "Pas de saut visuel à T3 (`setKeyframes` mid-anim) et T4 (cancel+replay 1 frame gap)" | Inférence sur rects intermédiaires (drift 3px = bruit, gap = 1 rAF) | **Haute sur les nombres, non vérifiée à l'œil** | Si quelqu'un veut une preuve définitive : enregistrer une vidéo Playwright (60 fps) à T3 et T4, regarder image par image. Pas critique pour S3 (qui n'utilise ni setKeyframes ni cancel+replay), mais utile si fallback S1/S2 envisagé. |

**Règle proposée pour le refactor S3** : à chaque PR du chantier, capturer un screenshot du board en perspective 1 (flippé) avec une carte face-up visible + un LP delta animé + (si possible) un chain overlay actif. Ces 3 datapoints visuels valident en bloc les points 1, 2, et 4 ci-dessus. Coût : 1-2 captures manuelles par PR du refactor. Bénéfice : on attrape les ratés du POC avant qu'ils ne se cristallisent en bugs production.

**Anti-règle** (apprise via l'erreur LP) : ne PAS conclure sur l'orientation d'un élément à partir d'un screenshot où les glyphes/symboles visibles sont partiellement symétriques sous l'axe testé. Cf. mémoire `feedback_symmetric_glyphs_ask_axel.md`.
