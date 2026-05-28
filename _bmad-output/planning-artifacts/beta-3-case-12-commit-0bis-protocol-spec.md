---
title: β.3 cas #12 — Commit 0bis (protocole WS overlayMaterials)
status: ready (autonome, mergeable sans attendre la session #13 ni le Commit 1)
parent_spec: beta-3-case-12-xyz-leave-with-materials-spec.md
parent_catalogue: deferred-effects-catalogue.md §1bis cas #12
references:
  - beta-3-case-12-xyz-leave-with-materials-spec.md §4.5 (motivation)
  - beta-3-case-12-xyz-leave-with-materials-spec.md §7.3a (placement dans le plan 3-commits)
  - duel-server/src/ws-protocol-game.ts (mirror back du protocole)
  - front/src/app/pages/pvp/duel-ws-game.types.ts (mirror front)
  - duel-server/src/duel-worker.ts (transformMove + boucle process)
  - duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts (API wasm)
date: 2026-05-26
author: Winston (architect) + Axel (validation)
---

# β.3 cas #12 — Commit 0bis — Spec d'implémentation du protocole `overlayMaterials`

## §0 Pourquoi ce commit existe + investigation R8 close

Le cas #12 (`xyz-leave-with-materials`, spec parent §4.5) a besoin de connaître les `overlayMaterials` d'un XYZ **au moment où il quitte le terrain**. La spec parent confirme par investigation que :

1. **`MoveMsg` n'a pas de champ `overlayMaterials`** aujourd'hui (front + back). Le seul snapshot disponible (`boardStateAfter`) reflète l'état POST-départ → l'XYZ n'est plus en MZONE, ses overlays sont irrécupérables.

2. **`logicalState` côté front** ne peut pas être lu rétroactivement : l'orchestrator appelle `updateLogical(boardStateAfter)` AVANT `pushToStream` ([animation-orchestrator.service.ts:1394](../../front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L1394)), donc le DEP voit déjà l'état post-mouvement quand il observe l'event.

3. **L'investigation R8 (architecture review 2026-05-26)** a élargi la conclusion :
   - `core.duelProcess(duel)` ([duel-worker.ts:1209](../../duel-server/src/duel-worker.ts#L1209)) applique TOUTES les mutations atomiquement.
   - `core.duelGetMessage(duel)` ([duel-worker.ts:1221](../../duel-server/src/duel-worker.ts#L1221)) retourne ensuite le batch de messages générés.
   - La boucle `for (const msg of messages)` ([duel-worker.ts:1226](../../duel-server/src/duel-worker.ts#L1226)) appelle `transformMove` une fois TOUTES les mutations appliquées → une query `OcgQueryFlags.OVERLAY_CARD` post-process retournera vide pour la zone MZONE de l'XYZ parti.
   - `OcgMessageMove` brut ([@n1xx1/ocgcore-wasm/dist/index.d.ts:1031](../../duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts#L1031)) ne contient que `card / from / to` — pas d'overlay info.
   - Audit des 25 query flags OCGCore : aucune autre voie que `OVERLAY_CARD = 65536`.

**Conclusion structurelle (acquis 2026-05-26)** : la seule source de vérité accessible est un **snapshot pré-process** capturé AVANT chaque `duelProcess`. Ce commit pose la mécanique.

## §1 Vue d'ensemble

### 1.1 Trois changements coordonnés

| # | Fichier | Modif |
|---|---------|-------|
| 1 | `front/src/app/pages/pvp/duel-ws-game.types.ts` | Ajout `overlayMaterials?: number[]` à `MoveMsg` |
| 2 | `duel-server/src/ws-protocol-game.ts` | Mirror — même ajout |
| 3 | `duel-server/src/duel-worker.ts` | Capture pré-process + lecture dans `transformMove` |

Le pré-build duel-server (`npm run prebuild`) exécute `scripts/check-ws-protocol-sync.mjs` qui enforce le byte-sync entre 1 et 2 (modulo `.js` import suffix). Toute divergence fail le build.

### 1.2 Diagramme de séquence (côté serveur)

```
Boucle duel-worker :
  ┌── (avant duelProcess) ──────────────────────────────────────────────────┐
  │   capturePreProcessOverlays() — snapshot Map<ZoneKey, number[]>         │
  │   16 queries OVERLAY_CARD (2 players × 8 slots MZONE — 5 régulières + 2 EMZ + 1 OPT) │
  │   coût : ~1-3 ms total (queries simples sans build state complet)        │
  └───────────────────────────────────────────────────────────────────────────┘
  duelProcess(duel)
  duelGetMessage(duel) → messages[]
  for (const msg of messages) {
    if (msg.type === MOVE) {
      transformMove(msg)
        └── lit reasonInfo via query REASON (existant — post-process OK pour la destination)
        └── lit overlayMaterials depuis preProcessOverlays.get(srcKey) si srcKey ∈ MZONE
        └── retourne MoveMsg avec champ overlayMaterials? peuplé
    }
  }
  ┌── (post-batch, fin de boucle) ──────────────────────────────────────────┐
  │   preProcessOverlays.clear() — relâche la mémoire jusqu'au prochain tour │
  └───────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Pourquoi snapshot pré-process et pas autre

| Approche | Coût | Couverture | Notes |
|---|---|---|---|
| **Snapshot overlay-only pré-process (RETENU)** | ~1-3 ms par tour de boucle. 16 queries `OVERLAY_CARD` (simples). | Tous les XYZ qui quittent MZONE entre 2 `duelProcess`. | Léger, ciblé. Si un XYZ change de slot ET le quitte dans le même batch, on a la position de pré-batch — correcte pour le rule cas #12 qui lit `m.fromSequence`. |
| `buildBoardState()` complet pré-process | 10-50 ms par tour de boucle. | Tout — mais on n'a besoin que des overlays. | Disproportionné. Reservé pour l'attache `boardStateAfter` qui sert plus largement. |
| Query post-process sur le `to.location` | Gratuit (la query REASON est déjà faite). | Aucune — les overlays ne sont plus *sur* l'XYZ une fois au GY. | Non viable. |
| Patch OCGCore wasm pour exposer overlays sur `OcgMessageMove` | Très lourd (cf. `docs/ocgcore-wasm-custom-build.md`). | Tout XYZ MOVE. | Disproportionné pour 1 use case ; précédent dangereux. |

---

## §2 Spec front — modif type `MoveMsg`

Fichier : [front/src/app/pages/pvp/duel-ws-game.types.ts](../../front/src/app/pages/pvp/duel-ws-game.types.ts).

Aujourd'hui ([lignes 16-47](../../front/src/app/pages/pvp/duel-ws-game.types.ts#L16-L47)) :

```ts
export interface MoveMsg {
  type: 'MSG_MOVE';
  cardCode: number;
  cardName: string;
  player: Player;
  toPlayer: Player;
  fromLocation: CardLocation;
  fromSequence: number;
  fromPosition: Position;
  toLocation: CardLocation;
  toSequence: number;
  toPosition: Position;
  isToken: boolean;
  reason: number;
  boardStateAfter?: BoardStatePayload;
}
```

Devient :

```ts
export interface MoveMsg {
  // ... champs existants inchangés ...
  reason: number;

  /**
   * β.3 cas #12 (2026-05-26, Commit 0bis) — overlayMaterials de la card
   * source AU MOMENT DU MSG_MOVE (capturés en pré-process serveur, avant
   * que duelProcess n'applique la mutation OCGCore qui retire l'XYZ).
   *
   * Émis uniquement quand :
   *   (a) la card a un overlay non-vide (length > 0), ET
   *   (b) elle quitte une zone field (MZONE) — pas de capture pour les
   *       cards en SZONE / HAND / DECK / EXTRA.
   *
   * Champ optionnel — absent dans la grande majorité des MSG_MOVE pour
   * ne pas alourdir le payload (~99% des moves concernent des
   * non-XYZ ou des cards sans matériaux). Aucune compatibilité ascendante
   * à gérer côté front : un `m.overlayMaterials ?? []` suffit pour les
   * vieux replays sans champ.
   *
   * Lu par le DEP rule `xyzLeaveWithMaterials` pour détecter le départ
   * d'XYZ et synthétiser les MSG_MOVE virtuels OVERLAY→GRAVE
   * (cf. beta-3-case-12-xyz-leave-with-materials-spec.md §4).
   */
  overlayMaterials?: number[];

  boardStateAfter?: BoardStatePayload;
}
```

⚠️ **Position du champ** : entre `reason` et `boardStateAfter` (avant le snapshot board, après le bitmask) — cohérent avec le reste de la structure (champs simples regroupés). Le `scripts/check-ws-protocol-sync.mjs` enforce que back miroite la même position byte-pour-byte (modulo whitespace).

---

## §3 Spec back — mirror du type

Fichier : [duel-server/src/ws-protocol-game.ts](../../duel-server/src/ws-protocol-game.ts).

**Modification strictement identique** à §2, mais en respectant les conventions du back (`import type` avec suffix `.js`, etc.).

```ts
export interface MoveMsg {
  // ... champs existants inchangés ...
  reason: number;

  /**
   * β.3 cas #12 (2026-05-26, Commit 0bis) — overlayMaterials de la card
   * source AU MOMENT DU MSG_MOVE. Peuplé côté duel-worker via le
   * snapshot pré-process. Cf. front mirror duel-ws-game.types.ts.
   */
  overlayMaterials?: number[];

  boardStateAfter?: BoardStatePayload;
}
```

**Validation byte-sync** : exécuter `node scripts/check-ws-protocol-sync.mjs` après modif. Le script doit retourner OK. Sinon, ajuster whitespace/order jusqu'à matcher.

---

## §4 Spec back — capture pré-process + intégration dans `transformMove`

Fichier : [duel-server/src/duel-worker.ts](../../duel-server/src/duel-worker.ts).

### 4.1 Le snapshot pré-process

Nouvelle fonction `capturePreProcessOverlays()` + Map module-scope mise à jour AVANT chaque `duelProcess`.

```ts
// =============================================================================
// β.3 cas #12 (2026-05-26, Commit 0bis) — Pre-process overlay snapshot
// -----------------------------------------------------------------------------
// OCGCore applies all mutations during `duelProcess` BEFORE `duelGetMessage`
// returns the message batch. By the time `transformMove` runs, an XYZ that
// just left MZONE is already gone — querying `OcgQueryFlags.OVERLAY_CARD` on
// its old position returns nothing.
//
// We capture overlays for every MZONE slot BEFORE each `duelProcess` so
// `transformMove` can read them back from the snapshot when the MSG_MOVE
// reports a card leaving MZONE.
//
// Cost: ~16 queries (2 players × 8 slots MZONE) per duelProcess. Each query
// is a single OcgQueryFlags.OVERLAY_CARD lookup — bounded ~50-200 µs each
// per @n1xx1/ocgcore-wasm benchmarks. Total ~1-3 ms per loop iteration.
//
// Scope: module-level closure inside the runDuelLoop function. Cleared
// AFTER the message batch is fully iterated (back to empty for the next
// duelProcess). Pas de fuite mémoire — Map.clear() chaque fin de batch.
// =============================================================================

/** Key for the pre-process overlay map. `{player}-{sequence}` — only MZONE
 *  is captured because the cas #12 rule only triggers on `fromLocation === MZONE`. */
type PreProcessOverlayKey = `${0 | 1}-${number}`;

/** MZONE sequence range: 0-4 (main slots) + 5-6 (EMZ slots, MR5 convention).
 *  Cf. CLAUDE.md « MR5 EMZ convention ». Slot 7 reserved (OcgCore internal). */
const MZONE_SLOT_COUNT = 8;  // captures 0-7 inclusive (covers all observed sequences)

/**
 * Build the snapshot of overlayMaterials for every (player, MZONE slot)
 * before `duelProcess` applies the next batch of mutations. Returns a
 * Map keyed by `${player}-${sequence}`.
 *
 * Empty results (length === 0) are omitted from the Map — keeps the
 * Map small in the common case (most slots are empty or hold non-XYZ).
 */
function capturePreProcessOverlays(
  core: OcgCore,
  duel: OcgDuelHandle,
): Map<PreProcessOverlayKey, number[]> {
  const snapshot = new Map<PreProcessOverlayKey, number[]>();
  for (const player of [0, 1] as const) {
    for (let seq = 0; seq < MZONE_SLOT_COUNT; seq++) {
      const overlayInfo = core.duelQuery(duel, {
        flags: OcgQueryFlags.OVERLAY_CARD as number,
        controller: player,
        location: LOCATION.MZONE as number,
        sequence: seq,
        overlaySequence: 0,
      } as never);
      const overlayCards = overlayInfo?.overlayCards ?? [];
      if (overlayCards.length > 0) {
        snapshot.set(`${player}-${seq}` as PreProcessOverlayKey, overlayCards);
      }
    }
  }
  return snapshot;
}
```

### 4.2 Intégration dans la boucle

Modif du `runDuelLoop` autour de la ligne 1209 :

```ts
// AVANT chaque duelProcess — capture les overlays pré-mutation.
// β.3 cas #12 (Commit 0bis) — see capturePreProcessOverlays comment.
const preProcessOverlays = capturePreProcessOverlays(core, duel);

let status: number;
try {
  status = duelInstr.time('duelProcess', () => core!.duelProcess(duel!));
} catch (err) {
  // ... (gestion d'erreur existante)
}

const messages = core.duelGetMessage(duel);

// Pass `preProcessOverlays` to transformMessage via closure or param.
for (const msg of messages) {
  // ... (existant)
  const dto = transformMessage(msg, preProcessOverlays);
  // ... (existant)
}

// Cleanup — Map dropped à la fin du scope, pas besoin de clear explicite.
```

### 4.3 Modif `transformMove`

`transformMove` ([duel-worker.ts:341-370](../../duel-server/src/duel-worker.ts#L341-L370)) gagne un paramètre optionnel + lit le snapshot quand `fromLocation === MZONE`.

```ts
function transformMove(
  msg: any,
  preProcessOverlays?: Map<PreProcessOverlayKey, number[]>,
): ServerMessage {
  let reason = 0;
  if (core && duel && msg.to.location as number !== 0) {
    const reasonInfo = core.duelQuery(duel, {
      flags: OcgQueryFlags.REASON as number,
      controller: msg.to.controller,
      location: msg.to.location as number,
      sequence: msg.to.sequence,
      overlaySequence: 0,
    } as never);
    reason = reasonInfo?.reason ?? 0;
  }

  // β.3 cas #12 (Commit 0bis) — read overlayMaterials from pre-process snapshot
  // when the card is leaving MZONE. The snapshot was captured BEFORE duelProcess
  // applied the mutation, so the overlays from the now-gone XYZ are accessible.
  let overlayMaterials: number[] | undefined;
  if (preProcessOverlays && msg.from.location === LOCATION.MZONE) {
    const key: PreProcessOverlayKey = `${msg.from.controller}-${msg.from.sequence}`;
    const captured = preProcessOverlays.get(key);
    if (captured && captured.length > 0) {
      overlayMaterials = captured;
    }
  }

  return {
    type: 'MSG_MOVE',
    cardCode: msg.card,
    cardName: getCardName(msg.card),
    player: msg.from.controller,
    toPlayer: msg.to.controller,
    fromLocation: msg.from.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    fromSequence: msg.from.sequence,
    fromPosition: msg.from.position as number as Position,
    toLocation: msg.to.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    toSequence: msg.to.sequence,
    toPosition: msg.to.position as number as Position,
    isToken: isTokenCard(msg.card),
    reason,
    ...(overlayMaterials ? { overlayMaterials } : {}),
  };
}
```

### 4.4 Propagation du param via `transformMessage`

`transformMessage` ([duel-worker.ts:520-530](../../duel-server/src/duel-worker.ts#L520-L530)) doit aussi recevoir + forwarder le snapshot :

```ts
function transformMessage(
  msg: OcgMessage,
  preProcessOverlays?: Map<PreProcessOverlayKey, number[]>,
): ServerMessage | null {
  // ... (logging existant inchangé)
  switch (msg.type) {
    // ... (cas existants inchangés)
    case OcgMessageType.MOVE:
      return transformMove(msg, preProcessOverlays);
    // ... (autres cas inchangés)
  }
}
```

Seul le case `MOVE` consomme le snapshot — les autres cases l'ignorent silencieusement.

### 4.5 Aussi pour le replay precompute

`replay-precompute.ts` ([duel-server/src/replay-precompute.ts](../../duel-server/src/replay-precompute.ts)) duplique la boucle `duelProcess → duelGetMessage → transformMessage`. Il faut y appliquer la même mécanique pour que les vieux replays se voient peuplés du nouveau champ.

⚠️ **Précondition** : le replay precompute n'a pas accès à un `core` / `duel` actif au moment de la lecture — il reconstruit l'historique via une nouvelle simulation OCGCore. Le `capturePreProcessOverlays` y est donc applicable de la même façon qu'en live PvP. À vérifier ligne par ligne en pass 1 que le replay precompute n'a pas une mécanique radicalement différente.

---

## §5 Edge cases + invariants

### 5.1 XYZ qui change de slot dans le même batch

**Scénario** : un effet de réorganisation déplace un XYZ de MZONE-2 à MZONE-3 puis le détruit, le tout dans un seul `duelProcess`.

**Comportement** : le snapshot pré-process capture l'overlay à MZONE-2 (position pré-batch). Le MSG_MOVE du déplacement MZONE-2 → MZONE-3 verra `from.sequence=2`, qui matche la Map → `overlayMaterials` peuplé correctement. Le MSG_MOVE du destroy MZONE-3 → GRAVE verra `from.sequence=3` → key `0-3` ABSENTE de la Map (capturée vide ou non capturée). Donc `overlayMaterials` absent sur le destroy.

→ **Pas de bug fonctionnel** parce que le rule cas #12 ouvre la deferred sur le PREMIER MSG_MOVE (le déplacement), qui porte bien les matériaux. Les settlings GRAVE→GRAVE qui suivent absorbent les matériaux du premier event.

→ **Bug visuel mineur possible** : la position MZONE source des virtuels OVERLAY→GRAVE sera la position **pré-batch** (MZONE-2), pas la position de départ effective vers le GY (MZONE-3). Les floats partiront visuellement de MZONE-2 → GY. Acceptable parce que (a) le scénario est exotique, (b) MZONE-3 est probablement adjacent à MZONE-2, et (c) le visuel reste meilleur que les flashs dans le GY.

→ **À documenter** dans la spec parent §5 (edge cases) — actuellement absent.

### 5.2 Le snapshot capture des XYZ qui ne partent pas

**Scénario** : 4 XYZ sur le board, 1 seul est détruit dans le batch.

**Comportement** : la Map contient 4 entrées, mais seul 1 MSG_MOVE consomme une entrée. Les 3 autres restent dans la Map jusqu'à `Map.clear()` en fin de boucle (next batch). Pas de bug — juste du gaspillage mémoire borné (au pire 16 entrées × ~10 cardCodes = ~160 ints).

### 5.3 Aucun XYZ sur le board

**Comportement** : la Map est vide après `capturePreProcessOverlays`. Tous les MSG_MOVE ont `overlayMaterials: undefined`. Le rule cas #12 ne trigger pas (filtre `matCount === 0`). Comportement nominal.

### 5.4 Snapshot pré-process échoue (query OCGCore throws)

**Comportement** : la query OCGCore n'est pas censée throw — elle retourne `null` ou `{overlayCards: []}` sur une zone vide. Si elle throw néanmoins (race condition wasm), le snapshot est partiel. Mitigation : wrapper `capturePreProcessOverlays` dans un try/catch global qui retourne une Map vide en cas d'exception, avec un `dlog.warn`. Cas de fallback gracieux — pas de XYZ animation, mais pas de crash worker.

### 5.5 Fork mode (worker fork-solo)

`runDuelLoop` est partagé avec le fork mode ([duel-worker.ts:1623](../../duel-server/src/duel-worker.ts#L1623)). Le snapshot pré-process s'applique de la même façon. Pas de divergence à gérer.

### 5.6 Performance worst-case

16 queries × 100 boucles `duelProcess` par turn YGO × 30 turns = 48 000 queries OVERLAY_CARD par duel. Si chaque query coûte 200 µs (estimé), total ~10 secondes cumulées sur tout le duel. À mesurer en pass 1 via `duelInstr` — si > 5 % du temps total de duel, optimiser (ex: skip si aucun MZONE n'a de card).

**Optimisation conditionnelle** (si nécessaire) :

```ts
function capturePreProcessOverlays(...): Map<...> {
  const snapshot = new Map();
  for (const player of [0, 1] as const) {
    for (let seq = 0; seq < MZONE_SLOT_COUNT; seq++) {
      // Skip if slot is empty (no CODE) — avoids the OVERLAY_CARD query.
      const codeInfo = core.duelQuery(duel, {
        flags: OcgQueryFlags.CODE as number,
        controller: player, location: LOCATION.MZONE as number,
        sequence: seq, overlaySequence: 0,
      } as never);
      if (!codeInfo?.code) continue;  // empty slot
      const overlayInfo = core.duelQuery(...);
      if (overlayInfo?.overlayCards?.length > 0) {
        snapshot.set(`${player}-${seq}`, overlayInfo.overlayCards);
      }
    }
  }
  return snapshot;
}
```

→ Ajoute 1 query CODE par slot mais skip l'OVERLAY query pour les slots vides (~ 80% des slots en mid-duel). Net win sur la performance.

→ **À mesurer en pass 1** avant de l'introduire.

---

## §6 Tests

### 6.1 Test back unitaire — `transformMove` avec snapshot

Fichier : nouveau ou ajout à `duel-server/src/duel-worker.spec.ts` (créé si absent).

**T-B1** — transformMove sans snapshot : `overlayMaterials` absent :
```ts
it('β.3 cas #12 — transformMove omits overlayMaterials when snapshot absent', () => {
  const msg = mockOcgMessageMove({ /* ... */ from: { location: LOCATION.MZONE, sequence: 0, controller: 0 } });
  const result = transformMove(msg, undefined);  // pas de snapshot
  expect(result.overlayMaterials).toBeUndefined();
});
```

**T-B2** — transformMove avec snapshot peuplé : `overlayMaterials` présent :
```ts
it('β.3 cas #12 — transformMove reads overlayMaterials from pre-process snapshot', () => {
  const snapshot = new Map([['0-0', [12345, 67890]]]);
  const msg = mockOcgMessageMove({ from: { location: LOCATION.MZONE, sequence: 0, controller: 0 }, /* ... */ });
  const result = transformMove(msg, snapshot);
  expect(result.overlayMaterials).toEqual([12345, 67890]);
});
```

**T-B3** — snapshot ignoré quand `fromLocation !== MZONE` :
```ts
it('β.3 cas #12 — transformMove ignores snapshot for non-MZONE moves', () => {
  const snapshot = new Map([['0-0', [12345]]]);
  const msg = mockOcgMessageMove({ from: { location: LOCATION.HAND, sequence: 0, controller: 0 } });
  const result = transformMove(msg, snapshot);
  expect(result.overlayMaterials).toBeUndefined();
});
```

### 6.2 Test back d'intégration — boucle complète

**T-B4** — full loop : XYZ posé puis détruit → MSG_MOVE émis avec `overlayMaterials` peuplé :
```ts
it('β.3 cas #12 — XYZ destroy emits MSG_MOVE with overlayMaterials populated', async () => {
  // Setup deck avec XYZ summon en 1er tour + Dark Hole en main.
  // Run jusqu'à ce que Dark Hole résolve.
  // Inspect les MSG_MOVE émis : le MSG_MOVE XYZ → GRAVE doit avoir
  // overlayMaterials.length === N (selon le nombre de matériaux).
  // ...
});
```

⚠️ Ce test nécessite un decklist + scénario reproductible. Peut être différé à un test debug-replay-harness manuel si la suite back unit-test n'a pas l'infrastructure pour scripter une partie OCGCore complète.

### 6.3 Test pré-build sync

`scripts/check-ws-protocol-sync.mjs` doit passer après ajout du champ. Si fail, vérifier whitespace front vs back.

```bash
cd duel-server && node scripts/check-ws-protocol-sync.mjs
# Expected output: "ws-protocol sync OK" (ou équivalent)
```

### 6.4 Régression — aucun test existant ne casse

Faire tourner :
- Backend Java tests (pas concernés en théorie — le back Spring ne parse pas `MoveMsg`).
- Duel-server tests : `cd duel-server && npm test`.
- Front tests : `cd front && npm test` (1518 specs au commit `1d59a168` doivent rester verts).

---

## §7 Plan d'exécution

### 7.1 Pré-requis

- ✅ Aucune dépendance avec la session #13 (touche uniquement protocole + duel-worker).
- ✅ Aucune dépendance avec Commit 1 (DEP) ni Commit 2 (orchestrator).
- ✅ Mergeable en master immédiatement.
- ✅ Spec parent à jour (architecture review acquise 2026-05-26).

### 7.2 Étapes

1. **Ajouter `overlayMaterials?: number[]`** dans `front/src/app/pages/pvp/duel-ws-game.types.ts` + mirror back `duel-server/src/ws-protocol-game.ts`.
2. **Faire passer** `check-ws-protocol-sync.mjs`.
3. **Implémenter `capturePreProcessOverlays`** + le `PreProcessOverlayKey` type dans `duel-worker.ts`.
4. **Wirer dans `runDuelLoop`** — appel avant chaque `duelProcess`, propagation à `transformMessage` puis `transformMove`.
5. **Dupliquer la mécanique** dans `replay-precompute.ts` pour que les nouveaux replays portent le champ (vieux replays restent sans, OK).
6. **Tests T-B1 à T-B3** unitaires.
7. **Test T-B4 d'intégration** si infrastructure le permet — sinon validation manuelle via debug-replay-harness.
8. **Vérifier perf** : mesurer le temps cumulé de `capturePreProcessOverlays` via `duelInstr`. Si > 5% du time-budget, appliquer l'optimisation §5.6.
9. **Régression** front + back full pass.

### 7.3 Estimation

- §1-3 protocole + sync byte : 1h.
- §4 implémentation + propagation : 2-3h.
- §5 replay-precompute mirror : 1h.
- §6 tests : 1-2h.
- §7 perf check + tuning conditionnel : 1h.

**Total : 6-8h** (un peu plus que les 2-4h initiaux dans la spec parent, parce que l'investigation R8 a révélé la nécessité du snapshot pré-process plutôt que d'une simple query post-process).

---

## §8 Décisions tactiques

| # | Question | Choix |
|---|----------|-------|
| **D0.1** | Position du champ dans `MoveMsg` (entre `reason` et `boardStateAfter` vs en fin de struct) | **Entre `reason` et `boardStateAfter`** — regroupe les champs simples avant le snapshot board. |
| **D0.2** | Capture overlay-only vs full board state pré-process | **Overlay-only** (§1.3 trade-off) — ciblé, ~1-3 ms vs 10-50 ms. |
| **D0.3** | `MZONE_SLOT_COUNT = 8` (couvre seq 0-7) ou strict 7 (5 main + 2 EMZ) | **8** — défense en profondeur. OCGCore peut techniquement reporter seq=7 pour un slot réservé interne ; capturer ne coûte rien et évite un edge case obscur. |
| **D0.4** | Optimisation skip-empty-slot via query CODE | **Différée** — implémentée seulement si pass 1 mesure > 5% du time-budget. YAGNI sur le simple snapshot d'abord. |
| **D0.5** | Tests d'intégration en JS unit vs debug-replay-harness | **Both selon l'infrastructure** — unit-test si possible (rapide), harness manuel sinon (plus représentatif). |

---

## §9 Risques

| # | Risque | Mitigation |
|---|--------|------------|
| R0.1 | `check-ws-protocol-sync.mjs` fail à cause d'un whitespace divergent entre front et back | Strict diff après modif. Si fail, ajuster manuellement (whitespace + ordre des champs identiques byte par byte modulo `.js` suffix). |
| R0.2 | `capturePreProcessOverlays` ralentit significativement le worker | **Mesurer en pass 1**. Si > 5% du temps, appliquer optimisation §5.6 (skip-empty-slot via CODE query). |
| R0.3 | Replay precompute a une mécanique différente de runDuelLoop qui rend `capturePreProcessOverlays` inapplicable | À auditer en pass 1. Si différence, alternative : injecter le snapshot via le code de précompute (qui re-run lui-même OCGCore). |
| R0.4 | OCGCore wasm change d'API dans une future version et `OVERLAY_CARD` flag change | Hors scope (la version `@n1xx1/ocgcore-wasm@0.1.1` est figée). Si bumping wasm, vérifier dans la matrice de régression. |
| R0.5 | Un futur champ optionnel sur `MoveMsg` brise le `check-ws-protocol-sync.mjs` parce que sa position n'est pas synchronisée | Convention : tout nouveau champ optionnel s'ajoute à la même position dans les deux mirrors. CR review ou hook pre-commit pour enforce. |
| R0.6 | Les vieux replays (pré-Commit 0bis) ne portent pas `overlayMaterials` → le rule cas #12 ne trigger pas sur eux | **Acceptable** — comportement identique au pré-fix. Les nouveaux replays auront le visuel correct. Pour les vieux, le rule lit `m.overlayMaterials ?? []` → `[]` → trigger filtre rejette. |

---

## §10 Hors-scope explicite

- **Toute logique côté front consommant `overlayMaterials`** — c'est le rôle du Commit 1 (DEP). Le Commit 0bis se limite au protocole + serveur.
- **Modification des autres types `MoveMsg`-adjacents** (ex: `ConfirmCardsMsg`, `DrawMsg`). Pas concernés.
- **Capture des overlays pour les zones autres que MZONE** (HAND, SZONE, etc.). Aucune card en SZONE/HAND ne porte d'overlay materials en YGO actuel.
- **Audit du bug pré-existant `REASON_*`** dans `game-log-builder.ts` + `replay-precompute.ts` (cf. spec parent §4.1). Mémo séparé.

---

## §11 Sources

- `_bmad-output/planning-artifacts/beta-3-case-12-xyz-leave-with-materials-spec.md` — spec parent (§4.5 motivation, §7.3a placement plan).
- `duel-server/src/ws-protocol-game.ts` — mirror back.
- `front/src/app/pages/pvp/duel-ws-game.types.ts` — mirror front.
- `duel-server/src/duel-worker.ts:341-370` — `transformMove` existant.
- `duel-server/src/duel-worker.ts:1209-1226` — boucle `duelProcess` / `duelGetMessage`.
- `duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts:1739-1792` — `OcgQueryFlags` (audit ~25 flags, seul `OVERLAY_CARD` viable).
- `duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts:1031` — `OcgMessageMove` (pas d'overlay info brut).
- `duel-server/scripts/check-ws-protocol-sync.mjs` — enforce byte-sync front/back.
