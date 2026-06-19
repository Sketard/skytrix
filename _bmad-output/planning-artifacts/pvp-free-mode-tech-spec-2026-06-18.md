# PvP Free Mode — Tech Spec (hand-off implémentation)

**Date** : 2026-06-18
**Statut** : 📐 TECH SPEC — prête pour `bmad-dev-story` (Amelia)
**Docs amont** :
- Décisions UX : [pvp-free-mode-ux-2026-06-18.md](pvp-free-mode-ux-2026-06-18.md) (18 décisions, machine à états §4, couverture OCGCore §9-bis)
- Plan technique / chiffrage : [pvp-free-mode-2026-06-18.md](pvp-free-mode-2026-06-18.md) (Option A, v1a, page dédiée, contrat adaptateur §5-bis)

**Périmètre** : ce doc est le « COMMENT » exécutable. Il ne re-décide rien — il fournit
les signatures exactes (vérifiées code 2026-06-18), l'arbre de fichiers, les tables de
mapping, le routage transition→commande, et le plan de tests. Toute décision de design
renvoie aux docs amont.

**Décision moteur** : Option A (réutilise `CommandStackService` + `BoardStateService` du
simulateur) + v1a (sauts d'état, pas de travel animé). Chiffrage : ~3–3,5 j.

> ### ⭐ Note de trajectoire (décidée 2026-06-19, session archi Winston)
>
> **Ce mode libre est le futur REMPLAÇANT du simulateur, pas une feature à côté.**
> Le simulateur actuel sous sa forme présente sera **supprimé** ; seul le nouveau
> (bâti sur le rendu PvP) survivra. Conséquences load-bearing pour l'implémentation :
>
> - **`BoardStateService` + `CommandStackService` (+ les 7 commandes `simulator/commands/`)
>   sont les SURVIVANTS.** Ce qui meurt, c'est le *rendu* sim (vieux board + overlays maison),
>   pas le *moteur d'édition*. → On les enrichit sans crainte : toute primitive d'édition
>   légitime ajoutée au CommandStack est un **investissement vers la convergence**, pas une
>   dette (cf. `swapCards`, §5.5).
> - **Niveau de parité retenu pour le retrait : ESSENTIELLE** (pas totale). Le simulateur
>   pourra être supprimé dès que le mode libre couvre l'usage réel (monter un endboard) —
>   sans attendre v1b ni le backlog UX. Les fonctions rares du sim (réordonnancement de pile
>   `SORT_CARD`, compteurs typés) sont des **candidats à l'abandon**, pas des dettes : livrées
>   seulement si réclamées à l'usage.
> - Le retrait lui-même est un **chantier 2 distinct**, nommé en §11 — à NE PAS mélanger avec
>   la livraison v1. La v1 coexiste un temps avec le simulateur.

---

## 1. Arbre de fichiers

```
front/src/app/pages/pvp/free-mode/                      ← NOUVEAU dossier
├── free-mode-page.component.ts                          (la page dédiée + providers)
├── free-mode-page.component.html                        (monte <app-pvp-board-container> + overlays parent)
├── free-mode-page.component.scss
├── free-mode-page.component.spec.ts                     (Karma — providers + interactions)
├── free-mode-interaction.service.ts                    (machine à états §4 : armedCard + routage)
├── free-mode-interaction.service.spec.ts
├── card-instances-to-payload.ts                        (adaptateur pur CardInstance[] → BoardStatePayload)
├── card-instances-to-payload.spec.ts                   (table de mapping + invariants)
├── free-mode-action-bar.component.ts                   (mini-barre CARTE : 7 actions, §6.1)
├── free-mode-action-bar.component.spec.ts
├── free-mode-pile-bar.component.ts                      (mini-barre PILE : shuffle/mill/reveal, §6.2 / T4)
└── free-mode-pile-bar.component.spec.ts

MODIFIÉ (1 seul fichier du board partagé) :
front/src/app/pages/pvp/duel-page/pvp-board-container/
├── pvp-board-container.component.ts                     (+ 1 @Output emptyZoneTap)
└── pvp-board-container.component.html                   (+ (click) sur 2 des 3 .zone-empty : L474 propre + L303 EMZ-P0 ; L200 adverse NON câblé — §4)

ROUTE :
front/src/app/app.routes.ts                              (+ route 'decks/:id/free-board', lazy)
```

> **Note d'impl (étape 3, 2026-06-19)** : la route retenue est `decks/:id/free-board`
> (param `:id`, lazy `loadComponent`), PAS `/free-board/:deckId` — pour s'aligner sur
> les routes sœurs `decks/:id/simulator` + `decks/:id/solver` et préparer le reroute
> du simulateur (chantier 2). Le composant lit `params.get('id')`.

**Réutilisé tel quel sous les providers de la page** (audit §9-bis du doc UX) :
`<app-pvp-board-container>`, `AnimationOrchestratorService`, `RenderedBoardStateService`,
`CardTravelEngine`, `FloatRegistryService`, `DuelContext`, `BoardStateService`,
`CommandStackService`, `simulator/pile-overlay.component`, `simulator/control-bar.component`,
`simulator/xyz-material-peek.component`.

---

## 2. L'adaptateur `cardInstancesToBoardStatePayload`

**Fonction pure** (pas de DI, testable isolément). Source = modèle sim
`Record<ZoneId_sim, CardInstance[]>` ; cible = `BoardStatePayload` PvP.

### 2.1 Signatures de référence (vérifiées code)

```ts
// SOURCE — simulator/simulator.models.ts
enum ZoneId {                              // ZoneId SIM (string enum)
  HAND, MONSTER_1..MONSTER_5, SPELL_TRAP_1..SPELL_TRAP_5,
  EXTRA_MONSTER_L, EXTRA_MONSTER_R, FIELD_SPELL,
  MAIN_DECK, EXTRA_DECK, GRAVEYARD, BANISH,
}
interface CardInstance {
  instanceId: string;
  card: CardDetail;                        // .card.passcode → cardCode (optionnel, cf. doc parent §5-bis)
  image: CardImageDTO;
  faceDown: boolean;
  position: 'ATK' | 'DEF';
  overlayMaterials?: CardInstance[];
}

// CIBLE — pvp/duel-ws-shared.types.ts
interface BoardStatePayload {
  turnPlayer: Player; turnCount: number; phase: Phase;
  players: [PlayerBoardState, PlayerBoardState];
}
interface PlayerBoardState { lp: number; deckCount: number; extraCount: number; zones: BoardZone[]; }
interface BoardZone { zoneId: ZoneId_pvp; cards: CardOnField[]; }
interface CardOnField {
  cardCode: number | null;
  name: string | null;
  position: Position;                      // bitmask, voir 2.3
  overlayMaterials: number[];              // codes ; JAMAIS undefined (contrat)
  counters: Record<string, number>;
  // … champs riches tous optionnels (currentAtk, baseLevel, …) — omis par le mode libre
}
const POSITION = { FACEUP_ATTACK:0x1, FACEDOWN_ATTACK:0x2, FACEUP_DEFENSE:0x4, FACEDOWN_DEFENSE:0x8 };
const LOCATION = { DECK:0x01, HAND:0x02, MZONE:0x04, SZONE:0x08, GRAVE:0x10, BANISHED:0x20, EXTRA:0x40 };
```

> ⚠️ **`DuelState` vs `BoardStatePayload`** — l'input du board est `duelState = input.required<DuelState>()`.
> Confirmer à l'impl que `DuelState` est bien `BoardStatePayload` (alias) ou en quoi il diffère
> (champ supplémentaire ?). Si superset, l'adaptateur produit un `BoardStatePayload` et la page
> complète les champs manquants. C'est le SEUL point de signature non 100 % tranché.

### 2.2 Table de mapping ZoneId (sim → PvP → location/sequence OCGCore)

La table PvP `zoneIdToLocationKey` (board:574) donne déjà PvP→OCGCore. L'adaptateur ajoute
sim→PvP en amont :

| ZoneId SIM | ZoneId PvP | location-sequence OCGCore | Cardinalité |
|---|---|---|---|
| `MONSTER_1..5` | `M1..M5` | `MZONE-0..4` | single |
| `SPELL_TRAP_1..5` | `S1..S5` | `SZONE-0..4` | single |
| `EXTRA_MONSTER_L` | `EMZ_L` | `MZONE-5` | single |
| `EXTRA_MONSTER_R` | `EMZ_R` | `MZONE-6` | single |
| `FIELD_SPELL` | `FIELD` | `SZONE-5` | single |
| `GRAVEYARD` | `GY` | `GRAVE-0` | pile |
| `BANISH` | `BANISHED` | `BANISHED-0` | pile |
| `MAIN_DECK` | `DECK` | `DECK-0` | pile (count only) |
| `EXTRA_DECK` | `EXTRA` | `EXTRA-0` | pile |
| `HAND` | `HAND` | `HAND` | ordered |

> Le board consomme `players[].zones[]` + `deckCount`/`extraCount`. Pour DECK/EXTRA, le mode
> libre n'a pas besoin d'émettre les zones (le board lit les counts) — passer
> `deckCount = boardState[MAIN_DECK].length`, `extraCount = boardState[EXTRA_DECK].length`.

### 2.3 Construction d'un `CardOnField` (par carte)

```ts
function toCardOnField(ci: CardInstance): CardOnField {
  const isDef = ci.position === 'DEF';
  return {
    cardCode: ci.card.passcode ?? null,            // null → art placeholder (impact faible, doc parent §5-bis)
    name: ci.card.name ?? null,
    position: ci.faceDown
      ? (isDef ? POSITION.FACEDOWN_DEFENSE : POSITION.FACEDOWN_ATTACK)   // 0x8 : 0x2
      : (isDef ? POSITION.FACEUP_DEFENSE  : POSITION.FACEUP_ATTACK),     // 0x4 : 0x1
    overlayMaterials: (ci.overlayMaterials ?? []).map(m => m.card.passcode ?? 0),  // JAMAIS undefined
    counters: {},                                  // v1 : compteurs gérés via mini-barre, état porté ailleurs (voir 5.4)
  };
}
```

**Invariants durs (contrat doc parent §5-bis — passer outre = crash render / watchdog)** :
- `overlayMaterials` TOUJOURS un tableau (`[]` si aucun) — lu sans garde `.length` dans le template.
- `position` TOUJOURS un des 4 bitmasks valides, jamais `undefined`/`NaN`.
- L'état global ne porte JAMAIS `chainPhase !== 'idle'` (sinon POLL-DROP watchdog après 10 s).
  → la page passe `[chainPhase]="'idle'"` + `[activeChainLinks]="[]"` en dur (cf. §3).
- **Swap inter-types autorisé (#2)** : ces invariants tiennent même pour un monstre en zone S
  ou inversement. Ne PAS valider la légalité de placement dans l'adaptateur.

### 2.4 Assemblage `BoardStatePayload`

Mono-joueur : `players[0]` = le joueur, `players[1]` = vide (le board attend 2 slots).

```ts
function cardInstancesToBoardStatePayload(
  board: Record<ZoneId_sim, CardInstance[]>, lp: number,
): BoardStatePayload {
  const zones: BoardZone[] = SIM_TO_PVP_ZONES.map(([sim, pvp]) => ({
    zoneId: pvp, cards: board[sim].map(toCardOnField),
  }));
  return {
    turnPlayer: 0, turnCount: 1, phase: 'MAIN1',     // valeurs fixes — pas de tours
    players: [
      { lp, deckCount: board[MAIN_DECK].length, extraCount: board[EXTRA_DECK].length, zones },
      EMPTY_PLAYER_BOARD,                             // slot 1 inerte (mono-joueur)
    ],
  };
}
```

---

## 3. Le composant page `FreeModePageComponent`

### 3.1 Providers (recopiés de la duel-page — services component-scoped, PAS `providedIn:root`)

```ts
@Component({
  selector: 'app-free-mode-page',
  providers: [
    // bloc rendu PvP (recopié de duel-page)
    RenderedBoardStateService, AnimationOrchestratorService, CardTravelEngine,
    FloatRegistryService, BoardEffectsService, DuelContext, DuelLogger,
    // moteur d'édition sim
    BoardStateService, CommandStackService,
    // interaction mode libre
    FreeModeInteractionService,
  ],
})
```

> Le bloc exact à recopier est celui de `duel-page.component.ts` (section `providers:`).
> NE PAS hériter du bootstrap WS (raison : doc parent finding #1 — `connectWhenReady` est
> inconditionnel). La page ne réutilise QUE les providers + le composant board.

### 3.2 Bootstrap (constructeur / `ngOnInit`)

Séquence obligatoire (ordre load-bearing) :
```ts
// 1. Configurer DuelContext AVANT tout read RBS/orchestrateur (sinon duelAssert, duel-context.ts:175)
duelCtx.configure({ ownPlayerIndex: () => 0, speedMultiplier: () => 1, isBoardActive: () => true });
// 2. Charger le deck → peupler BoardStateService (main de 5, decklist) via CommandStack.drawCard ×5
// 3. setBoardActive(true) manuellement (PAS de handshake ANIMATIONS_READY — pas de WS)
// 4. Effect de synchro édition → rendu :
effect(() => {
  const payload = cardInstancesToBoardStatePayload(boardState.boardState(), this.lp());
  rbs.updateLogical(payload);
  rbs.commitAll('free-mode:sync');     // v1a : saut d'état, pas de lockZone (sinon assertNoLocks + timeout 30s)
});
```

> ⚠️ **Zéro `lockZone()`** en v1a (contrat doc parent §5-bis). Le travel animé (v1b) viendrait
> synthétiser des MSG_MOVE — hors scope v1.
>
> ⚠️ **`commitAll` est by-design en v1a — et c'est une dette de DIRECTION, pas un bug.**
> CLAUDE.md réserve `commitAll()` à `abort()`/`jumpToState()` (chemin « hard reset »). En
> v1a sans lock c'est correct, mais v1a et v1b sont des chemins **incompatibles** : v1b
> (travel animé) a besoin du chemin `lockZone` → commit-à-l'atterrissage, pas de `commitAll`.
> v1a n'est donc PAS un sous-ensemble de v1b qu'on étendrait : le jour où v1b arrive, ce
> `commitAll` doit être **arraché** et remplacé par la machinerie lock/travel. À garder en
> tête pour quiconque attaque v1b — ne pas croire qu'on « ajoute » par-dessus.
>
> ⚠️ **Ne PAS lire `this.lp()` dans cet effect** si possible — le LP a son propre chemin de
> commit. Le mêler ici rebuild tout le payload board à chaque édition LP (40 cartes,
> négligeable en perf mais conceptuellement sale). Soit sortir le LP de l'effect, soit
> accepter le rebuild complet — arbitrage mineur, à trancher à l'impl.

### 3.3 Template — montage du board

```html
<app-pvp-board-container
  [duelState]="renderedState()"
  [readOnly]="false"
  [preview]="false"
  [ownPlayerIndex]="0"
  [chainPhase]="'idle'"          <!-- DUR : jamais autre chose (watchdog) -->
  [activeChainLinks]="[]"
  [highlightedZones]="emptySet"  <!-- #4 : pas d'illumination de zone en v1 -->
  [actionablePrompt]="null"
  ... tous les inputs d'overlay PvP à vide ...
  (cardInspectRequest)="interaction.onCardTap($event)"
  (menuRequest)="interaction.onCardTap($event)"
  (zonePillRequest)="interaction.onPileTap($event)"
  (emptyZoneTap)="interaction.onEmptyZoneTap($event)"  <!-- NOUVEAU channel -->
/>

<!-- INSPECTOR (audit-miroir T3 — TRANCHÉ : inspector PvP, pas de fallback sim) : le
     double-tap = INSPECT réutilise l'inspector PvP du board (cardInspectRequest est DÉJÀ le
     channel d'inspection PvP). Le parent route le double-tap dessus. L'inspector PvP est
     suffisant — on NE rapatrie PAS l'inspector sim (board.component.inspectorData). Si un
     champ manque à l'usage, on l'AJOUTE à l'inspector PvP (le composant survivant), on ne
     ressuscite pas le rendu sim condamné. -->
<!-- overlays parent : mini-barre carte (§6.1), mini-barre PILE (shuffle/mill/reveal, §6.2/T4),
     éditeur LP, pastille armée, pile-overlay sim, xyz-peek sim -->
```

---

## 4. La modif board : `@Output emptyZoneTap`

**Le seul ajout au composant chaud** (board partagé PvP + replay).

### 4.1 ⚠️ CORRECTION code-vérifiée (2026-06-19) — il y a 3 `.zone-empty`, pas 1

La version précédente du §4 disait « un seul `.zone-empty`, HTML:474 ». **FAUX** — audit code
2026-06-19 : le template a **TROIS** slots vides, un par contexte de rendu :

| Ligne | Contexte | relPlayer |
|---|---|---|
| **L200** | zones ADVERSE | 1 |
| **L303** | zones Extra Monster (EMZ) | `emz.isOpponent ? 1 : 0` |
| **L474** | zones PROPRES (joueur) | 0 |

Aucun des 3 n'a de handler aujourd'hui (les zones occupées / piles ont les leurs sur des
sous-éléments). Vérifié aussi : `emptyZoneTap` n'existe **nulle part** dans `front/src/` →
ajout neuf, zéro conflit.

### 4.2 Le code (1 output, câblé sur les sites P0 seulement)

```ts
// pvp-board-container.component.ts — à côté des 6 outputs existants (~L271-278)
readonly emptyZoneTap = output<ZoneId>();
```
```html
<!-- L474 — zones PROPRES (relPlayer 0) : CÂBLER -->
} @else { <div class="zone-empty" (click)="emptyZoneTap.emit(zone.zoneId)"></div> }

<!-- L303 — EMZ : CÂBLER la moitié P0 uniquement -->
} @else { <div class="zone-empty"
              (click)="emz.isOpponent ? null : emptyZoneTap.emit(emz.zoneId)"></div> }

<!-- L200 — zones ADVERSE (relPlayer 1) : NE PAS CÂBLER (cf. décision 4.3) -->
} @else { <div class="zone-empty"></div> }   <!-- inchangé -->
```

### 4.3 DÉCISION — câbler P0 uniquement (mono-joueur)

**Le mode libre est mono-joueur, slot 1 inerte** (réservé-jamais-connecté, comme un SOLO
multiplex). Poser une carte dans une zone ADVERSE n'a pas de sens en v1 → on câble seulement
les slots où le joueur P0 pose : ses zones propres (L474) + la moitié P0 des EMZ (L303
`!emz.isOpponent`). La zone adverse (L200) reste **non câblée**.

> Conséquence inertie PvP **encore plus forte** : on touche L474 + L303 (les 2 slots P0) et
> on laisse L200 strictement intact. Board adverse / 2e joueur = hors-scope v1 (doc UX §10) —
> cohérent avec ne PAS câbler le slot adverse.

### 4.4 Inertie PvP (pourquoi zéro régression)

- **Aucun parent PvP/replay ne s'abonne à `emptyZoneTap`** (vérifié : duel-page + replay-page
  s'abonnent à 6 outputs, jamais `emptyZoneTap`). Un `output()` Angular **sans abonné est un
  no-op total** — `emit()` n'émet vers personne. Pas de gate `freeMode` nécessaire.
- Le seul risque résiduel non-nul : le `(click)` ajouté sur un élément qui n'en avait pas
  pourrait théoriquement interférer avec la propagation d'événements voisins. `.zone-empty`
  est l'élément le plus inerte du board (div vide de slot libre) → risque minime, mais
  **c'est LE point à pinner** dans la spec de non-régression board (§8).

> ⚠️ Le `zoneId` émis est SANS suffixe `-0/-1` (le parent sait qu'on est P0 en mono-joueur).

---

## 5. Routage interaction (machine à états §4 → commandes)

`FreeModeInteractionService` détient l'état et traduit chaque geste en appel
`CommandStackService`. Signatures `CommandStackService` (vérifiées) :

```ts
moveCard(cardInstanceId, fromZone, toZone, toIndex?)
attachMaterial(cardInstanceId, fromZone, xyzHostId, xyzZoneId)
detachMaterial(materialInstanceId, xyzHostId, xyzZoneId, targetZone)
transferMaterial(materialInstanceId, fromZone, targetXyzHostId, targetZone)
flipCard(cardInstanceId, zoneId, targetFaceDown, targetPosition?)
togglePosition(cardInstanceId, zoneId, targetPosition: 'ATK'|'DEF')
drawCard() / shuffleDeck() / mill(count) / reorderHand(from, to)
undo() / redo() / reset()
swapCards(aInstanceId, bInstanceId)        // ⬅ NOUVELLE commande native — à ajouter (§5.5)
```

### 5.1 État du service

```ts
private readonly armedCard = signal<{ instanceId: string; fromZone: ZoneId_sim } | null>(null);
// + mode transitoire 'attach-xyz-pending' quand l'action mini-barre Attacher est armée
```

### 5.2 Table transition → commande (§4 ÉTAT B)

| Geste (§4) | Condition | Commande appelée |
|---|---|---|
| tap carte (A→B) | `armedCard === null` | `armedCard.set({id, zone})` ; announceEvent (a11y) |
| tap AUTRE carte (B) | `armedCard !== null`, autre carte | RÉ-ARME : `armedCard.set(nouvelle)` (#1) |
| tap zone-slot **vide** (B) | armé, `emptyZoneTap` | `moveCard(armed.id, armed.fromZone, ciblePvP→sim)` |
| tap zone-slot **occupée** (B) | armé, `onCardTap` sur carte cible | SWAP : `commandStack.swapCards(armed.id, cible.id)` — **commande native** (§5.5), undo atomique (#2, types non vérifiés) |
| tap pile (B) | armé | `moveCard(armed.id, armed.fromZone, GRAVEYARD/BANISH/…)` (#13) |
| mini-barre Flip | — | `flipCard(id, zone, !faceDown)` |
| mini-barre ATK↔DEF | — | `togglePosition(id, zone, target)` |
| mini-barre Activer (#17) | — | `BoardEffectsService.activateEffect(el)` — anim seule, PAS de commande état |
| mini-barre Détruire | — | `moveCard(id, zone, GRAVEYARD)` |
| mini-barre Détacher (XYZ) | matériau | `detachMaterial(matId, hostId, xyzZone, GRAVEYARD)` |
| mini-barre Attacher-XYZ (#16) | armé (carte normale), puis tap monstre XYZ | `attachMaterial(armed.id, armed.fromZone, hostId, xyzZone)` |
| mini-barre Attacher-XYZ (T2) | armé = **matériau** (depuis peek XYZ), puis tap AUTRE monstre XYZ | `transferMaterial(matId, fromXyzZone, targetHostId, targetZone)` — atomique (audit-miroir T2). La mini-barre route vers `attachMaterial` OU `transferMaterial` selon que la carte armée est une carte normale ou déjà un matériau. |
| mini-barre +Compteur | — | voir 5.4 |
| re-tap / Échap / tap-vide hors-plateau | — | `armedCard.set(null)` ; announceEvent |
| double-tap | — | inspect (pas de commande) ; sur carte armée : désarme + inspect (§4) |

### 5.3 Distinction tap simple / double-tap (doc UX §9, fenêtre 250 ms)

- Armer au 1er tap **immédiatement** (réactivité).
- Si 2e tap < 250 ms → annuler l'armement (`armedCard.set(null)`) + `cardInspectRequest`.
- Le flash de halo au tap1 est visible (pas « invisible ») — accepté.

**Arbitre des 3 gestes — TRANCHÉ (2026-06-19, session archi)** : trois gestes coexistent sur
la même cible carte, avec des fenêtres temporelles qui se chevauchent. Règle figée :

| Geste | Résultat | Émetteur |
|---|---|---|
| tap simple | ARME | parent (réinterprète `cardInspectRequest`/`menuRequest`) |
| double-tap (<250 ms) | INSPECT (annule l'armement du tap1) | parent (fenêtre 250 ms) |
| **long-press** | **INSPECT** | board `appLongPress` (HTML:431) — **déjà émis, hors contrôle parent** |

→ **long-press = inspect** (cohérent avec double-tap = inspect). Le board émet `appLongPress`
indépendamment ; le parent doit s'assurer qu'un long-press **ne laisse PAS un armement
fantôme** : si `appLongPress` fire après qu'un tap a armé, le parent désarme (`armedCard.set(null)`)
avant de router vers l'inspect. C'est le piège « marche en dev, casse en test tactile » —
à couvrir explicitement dans `free-mode-interaction.service.spec.ts`.

### 5.4 Compteurs (#11) — TRANCHÉ : Map parallèle hors-undo, décrément obligatoire

`CardOnField.counters: Record<string,number>`. v1 : la mini-barre « +Compteur » incrémente
un compteur générique (clé unique, ex. `'counter'`).

**Décision (2026-06-19, session archi)** : les compteurs vivent dans un
`Map<instanceId, Record<string,number>>` côté `FreeModeInteractionService` — **PAS** dans
le modèle sim `CardInstance` (qui n'a pas ce champ aujourd'hui), **PAS** dans le
`CommandStackService`. L'adaptateur lit cette Map et la projette dans `toCardOnField` au
moment du build payload.

**Conséquence DURE — le décrément est OBLIGATOIRE en v1, plus un backlog** :
- Les compteurs étant **hors du CommandStack**, ils sont **hors de l'undo/redo**. Un `Ctrl+Z`
  ne rattrape PAS un sur-clic sur `＋`.
- Donc le seul recours après un sur-clic est un décrément manuel : **bouton `ｰ` séparé OU
  long-press sur `＋`** → décrément, plancher à 0.
- Sans ce décrément, un sur-clic est **irrattrapable** → violation du filet de sécurité
  « l'erreur est triviale à annuler » (doc UX §6). C'est ce qui transforme la note UX §10
  (« v1 doit AU MINIMUM permettre de décrémenter ») en **contrainte de non-négociable v1**.
- Types de compteurs distincts + affichage du total = v1b (candidat abandon si non réclamé,
  cf. note de trajectoire « parité essentielle »).

> ⚠️ Pourquoi hors-undo et pas dans le CommandStack : un compteur n'est pas une « action de
> board » au même titre qu'un déplacement, et le sortir du stack garde le mode libre hors
> du modèle sim sur ce point. Coût accepté = pas d'undo des compteurs, compensé par le
> décrément obligatoire.

### 5.5 Swap — TRANCHÉ : `swapCards` natif dans le `CommandStackService`

**Décision (2026-06-19, session archi)** : ajouter une commande native
`swapCards(aInstanceId, bInstanceId)` au `CommandStackService` (sim) — **PAS** un
`CompositeCommand` à zone-tampon côté mode libre.

**Pourquoi (contexte « sim = remplacé, CommandStack = survivant »)** :
- Le `CommandStackService` est un **survivant** de la convergence (note de trajectoire) :
  enrichir le moteur d'édition est un investissement, pas une dette sur du code condamné.
- Un composite à zone-tampon porterait la logique de swap dans du code mode-libre qui
  devra de toute façon **re-fusionner** dans le CommandStack à la convergence → swap payé
  deux fois.
- `swapCards` est une primitive d'édition légitime : undo atomique **gratuit** (un seul
  `undo()` annule le swap entier), au lieu de garantir l'atomicité d'un composite à la main.

**Spec de la commande** (le naïf « 2× moveCard » est FAUX — collision en zone occupée) :
sortir A vers un buffer interne → poser B dans la zone de A → poser A dans la zone de B.
L'inverse (undo) rejoue la séquence symétrique. À implémenter comme une `Command` à part
entière dans `simulator/commands/` (cohérent avec les 7 existantes).

**Risque de régression sim = NUL** : ajout **purement additif**. Le simulateur solo actuel
n'appelle jamais `swapCards` → rien n'est retiré ni modifié sur le chemin sim existant.

---

## 6. Mini-barres `FreeModeActionBarComponent`

### 6.1 Mini-barre CARTE (sur une carte armée/tapée)

- 7 actions : Flip / ATK↔DEF / Activer / Détruire / Détacher / Attacher-XYZ / +Compteur.
- Desktop : ancrée à la carte (position DOM). Mobile : barre détachée bas d'écran, pleine
  largeur (doc UX §8 — 7×44px = 308px ne tient pas au-dessus d'une carte ~60px).
- Icônes DS `<app-icon-button>` (CLAUDE.md — jamais `<button class>`).
- Actions contextuelles :
  - « Détacher » visible seulement si la carte est un matériau XYZ.
  - « Attacher-XYZ » arme le mode pending puis attend un tap monstre XYZ. **Route vers
    `attachMaterial` si la carte armée est une carte normale, vers `transferMaterial` si
    elle est déjà un matériau** (audit-miroir T2, cf. §5.2).
  - « +Compteur » : incrémente ; le **décrément (`ｰ` ou long-press)** est obligatoire (§5.4).

### 6.2 Mini-barre PILE (audit-miroir T4 — sur une pile)

Le clic-droit sim (menu deck) disparaît avec le drag ; son canal est remplacé par une
mini-barre PILE. Reproduit les actions de pile du simulateur :

- **Shuffle** → `commandStack.shuffleDeck()`.
- **Mill N** → `commandStack.mill(count)` (saisie du N — remplacer le `window.prompt()` sim
  par un input DS, cf. note ci-dessous).
- **Reveal N** → `boardState.openDeckReveal(count)` (ouvre le `pile-overlay` en mode reveal).
- Ouvrir/parcourir (browse) + search restent l'overlay `pile-overlay` réutilisé tel quel.

> ⚠️ Le simulateur saisit N pour mill/reveal via `window.prompt()` (`stacked-zone.component.ts`).
> En mode libre, remplacer par un petit input DS (jamais `window.prompt`, hors DS + bloquant).
> Mineur, mais à ne pas copier verbatim depuis le sim.

> Emplacement / forme (desktop ancré pile vs mobile barre bas) : même doctrine que la
> mini-barre carte (§6.1). À spécifier au câblage.

---

## 7. Réutilisation composants sim (audit §9-bis doc UX — couplés mais OK)

Les 3 composants sim sont pilotés par `BoardStateService` (lisent ses signaux). Comme la
page provisionne ce service, ils marchent **tels quels** sous ses providers :

| Composant | Pilote | Usage mode libre |
|---|---|---|
| `pile-overlay.component` | `BoardStateService.activeOverlay*` + `revealCards()` | recherche-deck (#8) + pile ouverte (#15) |
| `xyz-material-peek.component` | `BoardStateService.activeMaterialPeek` | peek matériaux XYZ |
| `control-bar.component` | `CommandStackService` (undo/redo/reset) + `BoardStateService.isOverlayOpen` | undo/redo + boutons |

⚠️ `control-bar` injecte AUSSI `Router` + `MatDialog` (flux reset → navigation/dialog
de confirmation). Vérifier que le reset ne navigue pas vers une route sim ni n'ouvre un
dialog sim-spécifique.

**Décision (2026-06-19, session archi) — budgéter l'extraction `free-mode-control-bar` dès
le départ, ne PAS attendre de constater la fuite.** Deux raisons :
1. La dépendance Router/MatDialog est presque sûrement contextuelle au simulateur → la fuite
   est probable, pas hypothétique. Si par miracle elle n'existe pas, on a perdu ~1h.
2. **Surtout** : `control-bar`, `pile-overlay`, `xyz-material-peek` vivent dans le dossier
   `simulator/` **voué à mourir** (note de trajectoire). Les extraire hors de `simulator/`
   n'est pas qu'une parade anti-fuite — c'est le **premier pas concret de la migration**
   (chantier 2, §11). À l'extraction, se poser la question : *où* doivent vivre ces
   composants pour **survivre** à la suppression de `simulator/` (dossier `free-mode/` ou
   un `pvp/shared/` ?). C'est une décision de rangement structurel, pas un copier-coller.

---

## 8. Plan de tests (Karma — CLAUDE.md : tout nouveau `inject()` composant → Karma avant commit)

| Spec | Couvre | Pourquoi obligatoire |
|---|---|---|
| `card-instances-to-payload.spec.ts` | table mapping ZoneId, formule position bitmask (4 cas), `overlayMaterials` jamais undefined, swap inter-types (monstre en zone S → payload valide), cardCode null → art placeholder | invariants durs du contrat §5-bis |
| `free-mode-interaction.service.spec.ts` | les 13 transitions §4 (arme/ré-arme/pose/swap/dépôt/attach/détach/flip/position/désarme/double-tap), fenêtre 250 ms, mode attach-pending, **arbitre 3 gestes : long-press ne laisse PAS d'armement fantôme (§5.3)**, **décrément compteur plancher 0 (§5.4)** | la machine à états entière |
| `command-stack.service.spec.ts` (MODIF sim) | `swapCards(a,b)` échange 2 cartes en zones occupées sans collision ; undo atomique restaure l'état exact ; **non-régression : les 7 commandes existantes inchangées** | nouvelle commande native (§5.5), code sim survivant |
| `free-mode-page.component.spec.ts` | **NG0201 check** : tous les providers présents (DuelContext, RBS, orchestrateur, BoardStateService, CommandStackService) ; bootstrap ordre (configure avant read) ; `chainPhase='idle'` jamais violé | CLAUDE.md A6 — un `inject(X)` manquant = NG0201 runtime, invisible au `tsc` |
| `free-mode-action-bar.component.spec.ts` | 7 actions → bonnes commandes ; Détacher visible si matériau ; **Attacher-XYZ route attach vs transfer selon carte normale/matériau (T2)** ; layout desktop/mobile | mini-barre carte |
| `free-mode-pile-bar.component.spec.ts` | shuffle/mill/reveal → bonnes commandes (T4) ; saisie N via input DS (PAS `window.prompt`) | mini-barre pile |
| `pvp-board-container.component.spec.ts` (MODIF) | `emptyZoneTap` émet `zoneId` au click sur `.zone-empty` **propre (L474) ET EMZ-P0 (L303)** ; **n'émet PAS** sur le slot ADVERSE (L200, non câblé) ; **n'émet PAS** en PvP normal (pas d'abonné = no-op) ; **le `(click)` ne perturbe pas la propagation d'événements voisins** (§4.4) | non-régression board chaud |

Commande min (CLAUDE.md A6) :
`ng test --include="**/free-mode/**" --watch=false --browsers=ChromeHeadless`
+ le batch board-container après la modif `emptyZoneTap`.

---

## 9. Points à trancher à l'implémentation (résiduels, non bloquants)

> Les arbitrages de design ont été tranchés en session archi (2026-06-19) : **swap** = commande
> native `swapCards` (§5.5) ; **compteurs** = Map parallèle hors-undo + décrément obligatoire
> (§5.4) ; **gestes** = long-press inspect (§5.3) ; **control-bar** = extraction budgétée (§7) ;
> **commitAll** = by-design v1a (§3.2). Ne restent ouverts que des points d'exécution pure :

1. **`DuelState` vs `BoardStatePayload`** — confirmer alias/superset (cf. 2.1). Si superset,
   compléter les champs en plus côté page.
2. **`effect` synchro + LP** — sortir `this.lp()` de l'effect de sync board ou accepter le
   rebuild complet à chaque édition LP (cf. 3.2). Mineur.
3. **Emplacement cible des composants extraits** (`free-mode-control-bar` + futurs
   `pile-overlay`/`xyz-material-peek` migrés) — `free-mode/` vs `pvp/shared/`. Décision de
   rangement, à prendre au moment de l'extraction (cf. §7 + chantier 2 §11).

---

## 10. Ordre d'implémentation suggéré

1. **Adaptateur + spec** (pur, isolé, testable sans UI) — ~0,5 j. Verrouille le contrat.
2. **`emptyZoneTap` board + spec non-régression** — ~0,5 h. Le seul code chaud, à faire tôt.
3. **Page + providers + bootstrap + effect synchro** — board s'affiche en lecture — ~1 j.
4. **`FreeModeInteractionService` + routage transitions + spec** — ~1 j.
5. **Mini-barres (carte §6.1 + pile §6.2/T4) + intégration overlays sim (pile/peek/control-bar)
   + inspector PvP (T3)** — ~0,5 j.
6. **a11y live-region + polish + tests d'intégration page** — ~0,5 j.

Total cohérent avec le chiffrage doc parent (~3–3,5 j).

> Note : `swapCards` (§5.5) est une commande sim additive — la planifier dans l'étape 4
> (routage transitions) puisque c'est le swap qui la consomme. Le décrément de compteur
> (§5.4) va avec l'étape 5 (mini-barre).

---

## 11. Chantier 2 — Retrait du simulateur (phase suivante, NON couverte par la v1)

> **Distinct de la livraison v1.** La v1 ci-dessus livre le mode libre et **coexiste un temps**
> avec le simulateur actuel. Ce §11 nomme la phase suivante — il ne la détaille pas (elle aura
> sa propre tech spec). Cadre décidé en session archi 2026-06-19.

**Objectif** : supprimer le simulateur sous sa forme actuelle. Seul le nouveau mode (bâti
sur le rendu PvP) survit. Le `BoardStateService` + `CommandStackService` + les commandes
`simulator/commands/` survivent ; le **rendu** sim (vieux board + overlays maison + route)
meurt.

**Niveau de parité retenu : ESSENTIELLE** (pas totale). Le retrait peut démarrer dès que le
mode libre couvre l'usage réel (monter un endboard), sans attendre v1b ni le backlog UX.

### ✅ AUDIT-MIROIR des capacités sim — FAIT (2026-06-19, session archi)

L'audit §9-bis du doc UX vérifiait la couverture des actions **OCGCore du PvP**. L'audit-miroir
(inverse) vérifie : « le mode libre couvre-t-il tout ce que le **simulateur actuel** sait faire ? ».
Réalisé par exploration exhaustive du code sim (20 fichiers, 3 agents : moteur+commandes /
page+board+interactions / overlays+UI secondaire). Classement **couverte ✅ / abandonnée 🟡 /
à rapatrier 🔴**.

**Résultat global : majorité ✅ ou 🟡 ; 4 trous réels (🔴) sortis — tous tranchés ci-dessous.**

#### Capacités ✅ couvertes telles quelles
`moveCard`, `attachMaterial`, `detachMaterial`, `drawCard`, `flipCard`, `togglePosition`,
`undo`/`redo`/`reset` (control-bar réutilisée), ouvrir/parcourir une pile + **search deck**
(`pile-overlay` réutilisé), peek matériaux XYZ (`xyz-material-peek` réutilisé), Ctrl+Z/Ctrl+Y.
**Capacités NOUVELLES** du mode libre (le sim ne les a PAS) : édition LP, compteurs — donc
zéro régression possible dessus.

#### Découverte qui DÉCLASSE un risque
**Le sim ne permet PAS de réordonner DANS une pile** (`pile-overlay` a `cdkDragSortingDisabled
= true`). Donc « abandonner SORT_CARD » n'est **même pas une régression** vs le sim — c'est
déjà absent. Le risque qu'on craignait de perdre n'existait pas.

#### Les 4 trous réels (🔴) — décisions tranchées 2026-06-19

| # | Capacité sim (souvent liée au drag supprimé) | Décision v1 |
|---|---|---|
| T1 | **`reorderHand`** (réordonner la main, drag intra-main en sim) | 🟡 **ABANDONNÉ v1.** Main en ordre d'insertion. Cohérent parité essentielle. Revient v1b si réclamé. |
| T2 | **`transferMaterial`** (XYZ→XYZ direct ; listé en signatures, AUCUNE transition ne le déclenchait) | ✅ **COUVERT** via « Attacher-XYZ sur matériau armé » : armer un matériau depuis le peek → mini-barre Attacher-XYZ → tap autre monstre XYZ = `transferMaterial` atomique (undo 1 coup). Nouvelle transition à spécifier (§5.2). |
| T3 | **Inspector de carte** (double-tap → détails atk/def/desc/banlist) | ✅ **inspector PvP réutilisé** (TRANCHÉ — pas de fallback sim) : double-tap → `cardInspectRequest`. Si un champ manque à l'usage, on l'ajoute à l'inspector PvP (survivant), on ne ressuscite PAS le rendu sim. |
| T4 | **Canal d'accès aux actions de pile** (clic-droit sim → shuffle/mill/reveal disparaît) | ✅ **mini-barre pile complète** (shuffle + mill + reveal). Reproduit le menu sim. → **annule les abandons 🟡 de mill/reveal/shuffle** : ils sont désormais COUVERTS. |

> Note méthodo : ces 4 trous étaient invisibles à l'audit OCGCore ET à la tech spec initiale
> car ils sont **propres au simulateur** — la plupart naissent de la suppression du drag-drop
> (reorderHand, transferMaterial, drag matériau), pas d'une action OCGCore. C'est exactement
> ce que l'audit-miroir était censé attraper.

### Pertes connues et acceptées (parité essentielle, post-décisions)

- **`reorderHand`** (T1) — main en ordre d'insertion seul v1. Revient v1b si réclamé.
- **Types de compteurs distincts + total** — mode libre v1 = compteur générique (§5.4). v1b si réclamé.
- *(SORT_CARD n'est PLUS listé ici : le sim ne le faisait pas — non-régression, pas une perte.)*
- *(mill/reveal/shuffle ne sont PLUS abandonnés : couverts par la mini-barre pile T4.)*

### Items connus du retrait (à détailler dans la tech spec du chantier 2)

1. Supprimer `simulator-page` + son board maison + ses overlays propres + la route sim.
2. **Migrer** les composants survivants hors de `simulator/` : `pile-overlay`,
   `xyz-material-peek`, `control-bar` (→ `free-mode-control-bar`). Cible de rangement à
   décider (`free-mode/` ou `pvp/shared/`). L'extraction de `control-bar` commence DÈS la v1
   (§7) — c'est le premier pas.
3. Vérifier qu'aucun autre consommateur ne dépend du vieux rendu sim.
4. Statuer sur le `CardInstance` / `BoardStateService` : restent-ils tels quels, ou
   convergent-ils vers un modèle unique PvP à terme ? (question ouverte, post-retrait).
