# PvP Free Mode (éditeur libre / bac à sable)

**Date** : 2026-06-18
**Statut** : PLAN COMPARATIF + REVIEW INTÉGRÉE (rien codé)
**Révisions** : 2026-06-18 review adversariale → chiffrage corrigé, invariants
promus en contrat, décision archi « page dédiée ».
**Scope acté avec Axel** :
- **Éditeur libre / bac à sable** : mono-joueur, PAS de tours, PAS de prompts,
  PAS de victoire. L'utilisateur place/déplace/flip les cartes à la main et profite
  du rendu PvP (animations, indicateurs, plateau).
- **Drag-drop oublié** : interaction via menus/clics (pas de CDK drag).
- Objectif inverse du chantier « unification grille » : au lieu de tirer la qualité
  PvP vers le simulateur, on **ajoute un mode libre DANS le PvP**, qui réutilise le
  board PvP tel quel.
- Ce doc chiffre les **2 options de moteur d'état** (réutiliser le CommandStack du
  simulateur vs écrire un moteur natif `BoardStatePayload`) demandées par Axel.
- **Décisions actées (2026-06-18)** : moteur = **Option A** (réutiliser CommandStack sim) ;
  travel = **v1a** (sauts d'état, pas d'anim) ; archi = **page dédiée** (réutilise le
  composant board + providers, PAS le bootstrap WS de la duel-page).

---

## 1. Le constat structurel décisif

**Le board PvP n'est PAS couplé à WebSocket.** Il consomme un seul signal
`renderedState()` produit par `RenderedBoardStateService` (RBS). La source réelle
est interchangeable :

```
PvP normal :  [worker OCGCore via WS] → RBS.updateLogical() → renderedState() → <app-pvp-board-container>
Mode libre :  [command stack local]    → RBS.updateLogical() → renderedState() → <app-pvp-board-container>
```

Le composant board, le pipeline d'animation, les overlays, le `CardTravelEngine`
**restent identiques et inchangés**. C'est la bonne direction de dépendance : on ne
modifie pas le composant fragile, on lui donne un autre fournisseur d'état.

### Faits du code qui rendent ça viable

| Fait | Source | Conséquence pour le mode libre |
|---|---|---|
| RBS expose `updateLogical(state)` + `syncRendered()` + `commitAll()` | `rendered-board-state.service.ts:154/159/452` | un driver local peut écrire le board sans worker |
| La duel-page monte sur `EMPTY_DUEL_STATE` (8000 LP, zones vides), WS non requis | `duel-state.types.ts:36`, gate `roomState==='active'` (pas un gate WS) | le plateau s'affiche sans connexion |
| Le board est 100% **event-emitting** (`zoneSelected`, `actionResponse`, `menuRequest`, `cardInspectRequest`) | `pvp-board-container.component.ts:271-275` | un handler local absorbe les events et mute le RBS, zéro WS |
| Inputs `readOnly` + `preview` existent déjà | idem:144-180 | découplage interactivité/anim déjà paramétrable |
| Mapping ZoneId ↔ OCGCore location **déjà entièrement codé** | `zoneIdToLocationKey` / `locationSeqToZoneId` (idem:574-607) | la table de conversion existe, à réutiliser |
| Tous les champs riches du board sont lus derrière `@if (… != null)` | template `#indicators` lignes 24-68 | un payload minimal (position + image + overlay count) rend **proprement** ; les indicateurs riches restent masqués |

### Ce qui NE bouge pas (réutilisé verbatim)

`<app-pvp-board-container>`, `AnimationOrchestratorService`, `CardTravelEngine`,
`FloatRegistryService`, `DuelContext`, `RenderedBoardStateService`, tous les overlays
(chaîne, indicateurs, XYZ).

> **Nuance (revue UX 2026-06-18)** : « ne touche AUCUN de ces fichiers » est presque vrai.
> Le doc UX a identifié UN ajout minimal nécessaire au board : un `@Output() emptyZoneTap`
> sur le slot vide `.zone-empty` (qui n'émet aucun event aujourd'hui), pour permettre la
> POSE sur zone vide au tap. Inerte en PvP (aucun abonné). Voir doc UX §7. Tout le reste du
> board reste verbatim.

---

## 2. Les 3 briques à construire (communes aux 2 options)

1. **Constructeur `BoardStatePayload` à la main** — depuis une decklist, produire le
   format attendu par le board. C'est le cœur du travail : le format PvP encode
   `location`/`sequence` en enums OCGCore. La table de conversion existe déjà
   (`zoneIdToLocationKey`), donc c'est de l'assemblage, pas de la recherche.
2. **Un moteur d'édition local** (place/flip/position/attach XYZ/draw/mill + undo/redo).
   → **C'est le point d'arbitrage des 2 options ci-dessous.**
3. **Le câblage duel-page** — une branche `@if (freeMode)` qui : (a) bypass les effects
   WS au bootstrap, (b) route les outputs du board vers les handlers locaux au lieu de
   `wsService.sendResponse()`, (c) injecte un menu d'édition (palette de cartes, actions
   par zone) puisqu'il n'y a pas de drag.

---

## 3. Option A — réutiliser le `CommandStackService` du simulateur

On garde tel quel le moteur d'édition existant du simulateur :
`CommandStackService` (178 lignes) + 7 commandes (`commands/*.ts`, 372 lignes) +
undo/redo, qui opèrent sur `BoardStateService` (modèle `Record<ZoneId, CardInstance[]>`).
On ajoute **un seul adaptateur** `CardInstance[] → BoardStatePayload` au moment de
nourrir le RBS.

### Architecture
```
deck → BoardStateService (Record<ZoneId, CardInstance[]>)  ← CommandStackService (existant, intact)
                              │
                              │  effect() : à chaque mutation
                              ▼
              cardInstancesToBoardStatePayload()   ← NOUVEL adaptateur (~80-120 lignes)
                              │
                              ▼
              RBS.updateLogical() + syncRendered()
                              │
                              ▼
              <app-pvp-board-container [duelState]="renderedState()">
```

### Travail réel
- **Adaptateur de modèle** (~80-120 lignes) : map chaque `ZoneId` simulateur
  (`MONSTER_1`, `SPELL_TRAP_3`, `EXTRA_MONSTER_L`…) vers le `ZoneId` PvP (`M1`, `S3`,
  `EMZ_L`…) + construire les `CardOnField` (cardCode, location, sequence, position
  bitmask depuis `faceDown`+`ATK/DEF`, overlayMaterials → codes). Le mapping inverse
  de `locationSeqToZoneId` existe déjà comme référence.
- **Effect de synchro** (~20 lignes) : `effect(() => rbs.updateLogical(adapt(boardState())))`.
- **Câblage duel-page** (~80-150 lignes) : branche freeMode + palette d'édition + routage
  des outputs board vers `commandStack.moveCard()` etc.
- **Provider scope** : `BoardStateService` + `CommandStackService` sont `@Injectable()`
  sans `providedIn` → fournis au niveau composant. À provider sur la duel-page en mode libre.

### Coût / risque
| | |
|---|---|
| **Adaptateur + synchro** | ~0,5 j |
| **Câblage duel-page + palette édition** | ~1–1,5 j |
| **Provider scope + specs** | ~0,5 j |
| **Total** | **~2–2,5 j** |
| **Risque** | **Faible** — moteur d'édition déjà testé, on n'ajoute qu'une couche de traduction. Aucune logique métier réécrite. |

### Dette / inconvénient
- **Double modèle en mémoire** : `Record<ZoneId, CardInstance[]>` (source de vérité
  édition) + `BoardStatePayload` (rendu), re-dérivé à chaque mutation. Coût mémoire
  négligeable (un board = ~40 cartes), mais conceptuellement deux représentations.
- L'adaptateur doit rester synchro avec toute évolution du `CardOnField` PvP.

---

## 4. Option B — moteur natif `BoardStatePayload`

On écrit un nouveau command stack qui mute **directement** le format PvP, pas de
couche de traduction au rendu.

### Architecture
```
deck → FreeModeBoardState (BoardStatePayload, source de vérité)  ← FreeModeCommandStack (NOUVEAU)
                              │
                              ▼
              RBS.updateLogical() + syncRendered()   ← branchement direct, pas d'adaptateur
                              │
                              ▼
              <app-pvp-board-container [duelState]="renderedState()">
```

### Travail réel
- **Réécrire les 7 commandes** en termes `BoardStatePayload` : move (avec sous-cas
  attach/detach XYZ), flip, togglePosition, draw, shuffle, mill, + composite. La logique
  XYZ attach/detach/transfer est non-triviale (cf. `command-stack.service.ts:94-140`,
  le transfer fait un detach+undo+attach atomique). C'est **372 lignes de logique métier
  à retranscrire**, pas à copier (le modèle cible diffère).
- **Réécrire l'undo/redo** : le stack lui-même est simple (~50 lignes), mais chaque
  commande doit savoir s'inverser sur le nouveau modèle.
- **Constructeur initial** depuis decklist (commun avec A).
- **Câblage duel-page** (commun avec A, ~80-150 lignes).

### Coût / risque
| | |
|---|---|
| **Réécriture 7 commandes + undo sur BoardStatePayload** | ~2–3 j |
| **Constructeur + câblage duel-page** | ~1–1,5 j |
| **Specs (réécrire la couverture des commandes)** | ~1 j |
| **Total** | **~4–5,5 j** |
| **Risque** | **Moyen** — on réécrit de la logique métier (XYZ attach/detach) déjà subtile et déjà testée ailleurs. Risque de régression de comportement par rapport au simulateur, sans bénéfice fonctionnel. |

### Avantage
- **Modèle unique** : un seul `BoardStatePayload`, pas de double représentation ni
  d'adaptateur à maintenir. Plus propre à l'arrivée.
- Pas de dépendance du mode libre PvP envers le code `simulator/`.

### Inconvénient
- **Duplication de logique métier** : les 7 commandes + l'undo existent déjà,
  fonctionnels et testés, dans `simulator/commands/`. Les réécrire viole DRY pour un
  gain purement esthétique (modèle unique). Si un bug XYZ est trouvé un jour, il faudra
  le corriger à deux endroits.

---

## 5. Récap comparatif

| Critère | Option A (réutiliser CommandStack sim) | Option B (moteur natif) |
|---|---|---|
| **Coût** | ~2–2,5 j | ~4–5,5 j |
| **Risque** | Faible | Moyen |
| **Logique métier réécrite** | 0 (adaptateur seul) | 372 lignes (7 commandes + undo) |
| **Modèles en mémoire** | 2 (sim + payload dérivé) | 1 (payload) |
| **DRY** | ✅ réutilise l'existant | ❌ duplique le moteur d'édition |
| **Couplage au code `simulator/`** | oui (dépend de CommandStack + BoardState) | non |
| **Dette** | adaptateur à garder synchro | aucune (mais code dupliqué) |

### Recommandation

**Option A.** Le moteur d'édition (place/flip/XYZ/undo) est **exactement** celui dont le
mode libre a besoin, il existe, il est testé. Le seul travail spécifique au mode libre
est la couche de traduction + le câblage — et c'est inévitable dans les deux options.
L'option B paie ~2-3 jours de plus pour réécrire de la logique métier subtile, au seul
bénéfice d'un « modèle unique » qui n'a aucune valeur fonctionnelle pour l'utilisateur.

Le « double modèle » de l'option A n'est pas une dette réelle : c'est exactement le
pattern du simulateur actuel (modèle d'édition `Record<ZoneId, …>` ≠ format de rendu).
Et ça **prépare** une éventuelle convergence future où simulateur et mode-libre-PvP
partageraient le même `BoardStateService` + `CommandStackService`, ne divergeant que par
le composant de rendu (sim-board vs pvp-board-container).

---

## 5-bis. Corrections issues de la review adversariale (2026-06-18)

La review a vérifié les 6 hypothèses porteuses contre le code. Le constat fondamental
(board découplé de WS, piloté par RBS) est **confirmé**, mais 3 hypothèses étaient
fausses ou partielles. Impact :

### Chiffrage corrigé

| | Plan initial | Après review |
|---|---|---|
| Coût Option A + v1a | ~2–2,5 j | **~3–3,5 j** |
| Risque | Faible | **Faible-moyen** |
| Cause | — | +0,5–1 j de neutralisation du bootstrap WS (non budgété), promu propre par le choix « page dédiée » |

### Hypothèses réfutées / corrigées

1. **« La duel-page monte sans WS » → FAUX.** `duel-page.component.ts:728` →
   `room-state-machine:276` : `fetchRoom() → connectWhenReady() → wsService.connect()`
   est **inconditionnel**, et le handshake `ANIMATIONS_READY`
   (`duel-loading-effects.service.ts:175`) bloque l'activation du board sur un message
   serveur qui n'arrivera jamais. **→ Conséquence : page dédiée (§7-bis), pas un `@if`
   dans la duel-page.** On ne réutilise que le composant board + les providers, jamais
   le bootstrap.

2. **Le watchdog POLL-DROP s'arme si `chainPhase !== 'idle'`**
   (`animation-orchestrator.service.ts:236` + `poll-drop-watchdog.ts`) → `duelAssert`
   après 10s sans re-wake WS. **Gérable en v1a** car le mode libre n'émet que des états
   `chainPhase: 'idle'` — mais c'est désormais un **invariant dur** (cf. contrat ci-dessous).

3. **`overlayMaterials: number[]` n'est PAS optionnel** (`duel-ws-shared.types.ts:159`,
   lu sans garde `card.overlayMaterials.length` dans le template). Un payload qui l'omet
   → `TypeError` au render, pas un masquage gracieux.

### CONTRAT D'ADAPTATEUR (invariants durs — passer outre = crash runtime)

L'adaptateur `cardInstancesToBoardStatePayload` DOIT, sur **chaque** `CardOnField` produit :
- initialiser `overlayMaterials: []` (jamais `undefined`) ;
- fournir une `position` bitmask valide (jamais `undefined`/`NaN` →
  `faceDown ? (DEF ? FD_DEF : FD_ATK) : (DEF ? FU_DEF : FU_ATK)`) ;
- ne JAMAIS produire un état avec `chainPhase !== 'idle'` (sinon watchdog).

Le bootstrap du mode libre DOIT, avant tout read RBS/orchestrateur :
- appeler `duelCtx.configure({ ownPlayerIndex: () => 0, speedMultiplier: () => 1,
  isBoardActive: () => true })` (`duel-context.ts:175` fire un `duelAssert` sinon —
  échec invisible au typage) ;
- piloter le board par **sauts d'état seulement** : `updateLogical(state)` + `commitAll()`,
  **zéro `lockZone()`** (sinon timeout sécurité 30s + `assertNoLocks` à la transition
  suivante).

### Vérifié sain (la review ne conteste pas)

- `updateLogical` + `commitAll`/`syncRendered` fonctionnent sans pipeline d'anim actif
  (sous réserve des invariants ci-dessus).
- `cardCode` dispo via `CardDetail.card.passcode` (`card-dto.ts:15`) — mais **optionnel** :
  une carte sans passcode → art placeholder (impact faible).
- Le mapping ZoneId existe (`zoneIdToLocationKey` / `locationSeqToZoneId`).
- **Option A reste le bon choix** — aucun finding ne le conteste.

---

## 7-bis. Architecture retenue — page dédiée

**Décision** : le mode libre est une **page Angular dédiée** (route propre, ex.
`/free-board/:deckId`), PAS une branche `@if (freeMode)` dans la duel-page.

**Pourquoi** : la duel-page a 3-4 points de bootstrap WS inconditionnels (finding #1).
Les garder avec des gardes `freeMode` truffe une page déjà lourde et risque la
régression PvP. La page dédiée **ne réutilise que ce qui est sain** : le composant
`<app-pvp-board-container>` + le bloc de providers (orchestrateur, RBS, CardTravelEngine,
FloatRegistry, DuelContext). Elle n'hérite JAMAIS du bootstrap WS, donc rien à neutraliser.

**Ce que la page dédiée doit faire** :
1. Recopier le bloc `providers: [...]` de la duel-page (orchestrateur + RBS + travel +
   DuelContext) — ces services sont component-scoped, pas `providedIn: root`.
2. Provider AUSSI `BoardStateService` + `CommandStackService` (le moteur d'édition sim).
3. Au constructeur : `duelCtx.configure(...)` (cf. contrat) + `setBoardActive(true)`
   manuellement (pas de handshake ANIMATIONS_READY).
4. `effect(() => rbs.updateLogical(adapt(boardState())))` + `commitAll()` — la synchro
   édition → rendu.
5. Monter `<app-pvp-board-container [duelState]="renderedState()" [readOnly]="false"
   [preview]="false" [chainPhase]="'idle'" [activeChainLinks]="[]" ...>` avec tous les
   inputs d'overlay PvP à vide.
6. Router les outputs du board (`menuRequest`, `cardInspectRequest`, `zoneSelected`)
   vers un menu d'édition local (flip / position / move-to / destroy) au lieu de
   `wsService.sendResponse()`.

**Coût providers** : ~recopie de 10-15 lignes du bloc providers + le constructeur de
config. Bien moins risqué que les gardes inline. C'est l'inverse du compromis du plan
initial — et c'est le bon, vu le finding #1.

---

## 8. Points de vigilance résiduels (à trancher en exécution)

> Les invariants durs (overlayMaterials, position, chainPhase idle, DuelContext.configure,
> zéro lock) sont désormais dans le **CONTRAT D'ADAPTATEUR** (§5-bis) — ce ne sont plus
> des « vigilances » mais des conditions de non-crash. Ci-dessous, ce qui reste vraiment
> ouvert.

1. **Position bitmask — ✅ CONFIRMÉ (audit 2026-06-18).** L'enum `POSITION`
   (`duel-ws-shared.types.ts:63`) : `FACEUP_ATTACK: 0x1`, `FACEDOWN_ATTACK: 0x2`,
   `FACEUP_DEFENSE: 0x4`, `FACEDOWN_DEFENSE: 0x8`. La formule du contrat d'adaptateur
   (`faceDown ? (DEF ? 0x8 : 0x2) : (DEF ? 0x4 : 0x1)`) mappe exactement. Plus une inconnue.
2. **Interaction sans drag — ✅ RÉSOLU par le doc UX (2026-06-18).** Le modèle est « tap =
   arme, re-tap zone = pose », spécifié intégralement dans le doc UX (machine à états §4).
   La POSE sur zone vide passe par le nouvel `@Output emptyZoneTap` (le seul ajout board) ;
   la pose/swap sur zone occupée et l'armement réutilisent `cardInspectRequest`/`menuRequest`
   réinterprétés par le parent. Plus un inconnu — voir doc UX §7.
3. **Détail des matériaux XYZ pour le peek** — `overlayMaterials` doit être `[]` (contrat)
   mais peut être rempli de codes (`overlayMaterials.map(m => m.cardCode)`) si on veut que
   le peek XYZ affiche les vrais matériaux. Nice-to-have, pas requis au rendu de base.

## 9. (RÉSOLU) Travel animé — décision v1a

L'incertitude travel (sauts d'état v1a vs MSG_MOVE synthétiques v1b) est **tranchée :
v1a**. Le board fait des sauts d'état (`updateLogical` + `commitAll`), pas de glissement
animé. v1b reste une amélioration ultérieure possible (synthèse de MSG_MOVE dans le
processor, +1–2 j).

### Contexte technique de la décision

Le board anime les déplacements via des **événements `MSG_MOVE` dans l'AnimationQueue**,
pas via un diff entre deux `BoardStatePayload`. `updateLogical()` change l'état logique ;
le travel animé (la carte qui glisse) est déclenché par le **processor** qui consomme un
MSG_MOVE. D'où les deux niveaux :
- **v1a — sauts d'état sans travel animé** : `updateLogical` + `commitAll`, la carte
  apparaît à destination sans glisser. Simple, estimation §3 tient (~2–2,5 j option A).
- **v1b — avec travel animé** : synthétiser des `MSG_MOVE` et les pousser dans le processor
  (comme le worker). Plus lourd (contrat d'entrée du processor + events valides). Surcoût
  estimé **+1–2 j**.

**→ DÉCISION (2026-06-18)** : **v1a** — sauts d'état, pas de travel animé. La carte
apparaît à destination via `updateLogical` + `commitAll`. Indicateurs/overlays riches
conservés, seul le glissement animé est omis. v1b reste une amélioration ultérieure
possible. Estimation retenue : **Option A + v1a ≈ 2–2,5 j**.
