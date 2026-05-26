---
title: β.3 cas #12 — Commit 0bis — Audit pré-implémentation
status: ready (audit gate avant que le code Commit 0bis ne parte)
audited_spec: beta-3-case-12-commit-0bis-protocol-spec.md
parent_spec: beta-3-case-12-xyz-leave-with-materials-spec.md
parent_catalogue: deferred-effects-catalogue.md §1bis cas #12
references:
  - duel-server/src/duel-worker.ts (transformMove + runDuelLoop)
  - duel-server/src/replay-precompute.ts (mirror replay)
  - duel-server/src/ws-protocol-game.ts (mirror back du protocole)
  - front/src/app/pages/pvp/duel-ws-game.types.ts (mirror front)
  - duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts:1722-1797 (OcgQuery / OcgQueryFlags)
  - duel-server/src/solver/ocg-field-query.ts:251-273 (pattern try/catch existant)
  - scripts/check-ws-protocol-sync.mjs (sync byte-check actuel)
date: 2026-05-26
author: Claude (audit) + Axel (validation gate)
---

# β.3 cas #12 — Commit 0bis — Audit pré-implémentation

## §1 Résumé exécutif du commit 0bis

Le Commit 0bis pose **l'infrastructure protocole** dont les Commits 1
(DEP rule) et 2 (orchestrator wiring) dépendent pour résoudre le bug
visuel des matériaux d'XYZ qui flashent dans le GY quand l'XYZ quitte
le terrain. Il fait trois choses, et seulement trois :

1. **Ajoute `overlayMaterials?: number[]`** à l'interface `MoveMsg` côté
   front (`duel-ws-game.types.ts`) ET back (`ws-protocol-game.ts`),
   strictement byte-sync par `scripts/check-ws-protocol-sync.mjs`.
2. **Capture les overlays pré-`duelProcess`** dans une `Map<player-seq,
   number[]>` au niveau du `runDuelLoop` de `duel-worker.ts`, puis
   propage la Map à `transformMessage` → `transformMove` qui lit
   l'entrée correspondant à `(msg.from.controller, msg.from.sequence)`
   quand `msg.from.location === LOCATION.MZONE` et a un overlay
   non-vide.
3. **Réplique le mécanisme** dans `replay-precompute.ts` pour que les
   nouveaux replays portent le champ (vieux replays restent sans, OK).

**Pourquoi pré-process** : l'investigation R8 a montré qu'OCGCore
applique TOUTES les mutations dans `core.duelProcess(duel)` AVANT que
`core.duelGetMessage(duel)` retourne le batch — au moment où
`transformMove` court, la zone MZONE de l'XYZ parti est déjà vide,
donc une query `OcgQueryFlags.OVERLAY_CARD` post-mutation retourne `[]`.
Le snapshot pré-process est la seule source de vérité accessible sans
patcher le wasm OCGCore.

Commit autonome, mergeable indépendamment des Commits 1 et 2, sans
dépendance avec la session #13.

## §2 Audit point par point

### §0 Investigation R8 — ✓ OK avec une nuance

✓ Les pointeurs vers le code (`duelProcess`, `duelGetMessage`,
`transformMove`) sont précis et alignés avec la lecture indépendante
du worker. L'audit des 25 flags `OcgQueryFlags` est correct — seul
`OVERLAY_CARD = 65536` retourne `overlayCards: number[]`.

✓ La conclusion "la seule source de vérité accessible est un snapshot
pré-process" tient. Le solver-side `queryOverlayCount`
([ocg-field-query.ts:251-273](../../duel-server/src/solver/ocg-field-query.ts#L251-L273))
confirme le pattern d'usage de `OVERLAY_CARD` sur MZONE.

⚠️ **Nuance non explicite dans la spec** : `duelQueryLocation` (cf.
[index.d.ts:362](../../duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts#L362))
retourne `(Partial<OcgCardQueryInfo> | null)[]` pour TOUS les slots
d'une location, en UNE seule call. Pour MZONE c'est ~7-8 entrées par
player en 1 query au lieu de 8 queries `duelQuery`. À envisager comme
optimisation alternative au §5.6 — couvert plus bas en §4.

### §1.1 Trois changements coordonnés — ✓ OK

✓ Inventaire exact. Les 3 fichiers cités existent et les chemins sont
corrects.

⚠️ Le tableau ne mentionne PAS `replay-precompute.ts` qui apparaît
ensuite en §4.5 comme "5e fichier". À déplacer dans le tableau §1.1
pour ne pas créer l'impression que le mirror replay est optionnel.

### §1.2 Diagramme de séquence — ✓ OK structurellement

✓ L'ordre `capturePreProcessOverlays` → `duelProcess` →
`duelGetMessage` → boucle `transformMessage` → `clear` est correct.

⚠️ Le commentaire "16 queries (2 players × 8 slots MZONE — 5
régulières + 2 EMZ + 1 OPT)" est **incorrect arithmétiquement** :
2 × 8 = 16, mais l'explication "5 régulières + 2 EMZ + 1 OPT" = 8
slots par player en additionnant un slot OPT qui n'existe pas dans le
modèle. La vérité MR5 (cf. CLAUDE.md « MR5 EMZ convention » +
`link-arrows.json`) :

  - **Slots 0-4** : 5 MZONE principales (M1-M5).
  - **Slots 5-6** : 2 EMZ partagés (EMZ_L, EMZ_R) — chacun peut être
    contrôlé par P0 ou P1, mais OCGCore les expose comme appartenant
    au player qui les occupe (cf. memory [[mr5-emz-convention]]).
  - **Slot 7** : pas un slot standard. La doc OCGCore ne documente pas
    de slot 7 utile. Le `MZONE_SLOT_COUNT = 8` de la spec est de la
    défense en profondeur (D0.3) — OK, mais pas "1 OPT".

→ **Fix recommandé** : remplacer le commentaire par `2 players × 8
slots MZONE (slots 0-4 réguliers + 5-6 EMZ + 7 réservé OCGCore)`.

### §1.3 Tableau "pourquoi snapshot pré-process" — ✓ OK

✓ Le trade-off des 4 approches est honnête. Le coût "1-3 ms" de
l'overlay-only est cohérent avec ce qu'on peut estimer du wasm
(queries unitaires ~50-200 µs).

### §2 Spec front MoveMsg — ✓ OK avec une nuance position

✓ La position "entre `reason` et `boardStateAfter`" est défendable. Le
champ est sémantiquement plus proche du payload card-state que du
snapshot board complet.

⚠️ **Question Axel-Q1** : la position importe-t-elle vraiment ? Le
script `check-ws-protocol-sync.mjs` (cf. §3 audit ci-dessous) ne fait
PAS une comparaison byte-pour-byte tolérante aux différences d'ordre —
il compare le contenu normalisé. Donc front et back DOIVENT avoir le
champ EXACTEMENT au même endroit, mais l'endroit lui-même est libre.
Pas besoin de fortifier "entre reason et boardStateAfter" comme une
règle — c'est juste un choix de cohérence.

### §3 Spec back mirror — ✓ OK

✓ "Modification strictement identique à §2" est juste. Le script
`check-ws-protocol-sync.mjs` (vérifié ci-dessous) normalise les
suffixes `.js` et les stems de path, puis fait une comparaison de
contenu strict.

❌ **Fragile — path du script** : la spec écrit
`scripts/check-ws-protocol-sync.mjs` (sans préfixe) ET `cd duel-server
&& node scripts/check-ws-protocol-sync.mjs`. Le script vit en réalité
à `scripts/check-ws-protocol-sync.mjs` au ROOT du repo (vérifié 2026-05-26).
Le `prebuild` de `duel-server/package.json` l'appelle via `node
../scripts/check-ws-protocol-sync.mjs`. Le `cd duel-server && node
scripts/check-ws-protocol-sync.mjs` que la spec propose en §6.3 FAIL —
le path est `../scripts/...` depuis duel-server.

→ **Fix recommandé spec §3 + §6.3** : utiliser la commande exacte du
prebuild : `cd duel-server && npm run prebuild` ou depuis le root
`node scripts/check-ws-protocol-sync.mjs`.

### §4.1 capturePreProcessOverlays — ⚠️ Plusieurs points fragiles

✓ La structure générale (Map keyed par `${player}-${seq}`, scan des 2
× 8 slots, omission des résultats vides) est correcte.

❌ **Fragilité 1 — gestion d'erreur absente** : `core.duelQuery`
peut throw selon le binding wasm. Le pattern existant
[ocg-field-query.ts:251-273](../../duel-server/src/solver/ocg-field-query.ts#L251-L273)
montre un try/catch retournant 0 sur exception. `buildBoardState`
([duel-worker.ts:881-883](../../duel-server/src/duel-worker.ts#L881-L883))
n'en a PAS — il assume que la query ne throw jamais en mode "duel
loop". Choix à faire :

  - **Option A (recommandée)** : wrapper try/catch au niveau du `for`
    loop, log warn, continue avec la Map partielle. Mode dégradation
    gracieuse — si une query throw, on n'a pas TOUS les overlays,
    mais on n'arrête pas le worker.
  - **Option B** : laisser propager comme le reste de la boucle. Si
    une query throw, le watchdog tape. Cohérent avec
    `duelProcess threw` ([duel-worker.ts:1213](../../duel-server/src/duel-worker.ts#L1213))
    qui termine le worker.

→ **Question Axel-Q2** : Option A ou B ? Mon penchant Option A — un
edge case bénin (overlay manqué = visuel imparfait sur 1 XYZ) ne doit
pas crash un duel entier.

❌ **Fragilité 2 — clé string vs clé tuple** : la spec utilise une
template literal type `\`${0 | 1}-${number}\`` comme clé. Lookup en
hot path = serialization à chaque lecture/écriture (`\`${m.from.controller}-${m.from.sequence}\``).
Alternative : `Map<number, number[]>` avec clé `controller * 8 + seq`
(packed int). 16 entrées max, lookup pur entier. Coût négligeable
mais pattern plus simple à inspecter en debugger.

→ **Question Axel-Q3** : prendre le packed-int (perf marginal) ou
laisser le template literal (lisibilité) ? Pas critique — flag en
"nit", let it ride.

⚠️ **Fragilité 3 — `LOCATION.MZONE` vs `OcgLocation.MZONE`** : la
spec fait `controller: player, location: LOCATION.MZONE as number, ...`.
LOCATION vient de `ws-protocol-shared.ts:66` (`MZONE: 0x04`),
OcgLocation vient de `@n1xx1/ocgcore-wasm` (`MZONE: 4`). Aujourd'hui
les deux valent 4, alignement maintenu PAR CONVENTION. Si un futur
refactor désynchronise (réordonnance des flags du protocole skytrix),
les queries OCGCore passeraient un mauvais bit. Le code existant
`queryFlag` ([duel-worker.ts:881](../../duel-server/src/duel-worker.ts#L881))
a la même fragilité mais aucun guard.

→ **Mitigation suggérée** : ajouter une assertion au boot du worker :
`if (LOCATION.MZONE !== OcgLocation.MZONE) throw new Error('LOCATION/OcgLocation drift')`.
Hors scope strict du Commit 0bis mais à mentionner. Voir §8 R0.7.

### §4.2 Intégration dans la boucle — ✓ OK

✓ L'ordre `capturePreProcessOverlays(...)` AVANT `duelProcess(...)`
est correct. Le snapshot existe pendant toute la boucle pour
`transformMessage` ; il sort de scope à la prochaine itération.

⚠️ **Détail** : la spec écrit "Cleanup — Map dropped à la fin du
scope, pas besoin de clear explicite". Mais la Map est redéclarée
`const preProcessOverlays = capture...` à CHAQUE tour de la boucle
`while (true)`. C'est correct — chaque tour crée une nouvelle Map.
Wording un peu trompeur mais le code est OK.

### §4.3 Modif `transformMove` — ✓ OK

✓ Le branchement `if (preProcessOverlays && msg.from.location ===
LOCATION.MZONE)` est correct. Le spread conditionnel
`...(overlayMaterials ? { overlayMaterials } : {})` évite de pousser
`undefined` dans le payload — bonne pratique JSON.

⚠️ Vérifier que `msg.from.controller` est `0 | 1` (pas un BigInt). Le
type `OcgMessageMove.from` est `OcgCardLocPos` avec `controller: 0 |
1`. ✓ OK.

### §4.4 Propagation `transformMessage` — ⚠️ Risque de couplage

✓ Le second paramètre optionnel est rétrocompatible.

⚠️ **Note couplage** : `transformMessage` est appelé en 2 endroits :
`duel-worker.ts:1254` (live PvP) et `replay-precompute.ts:355` (replay
precompute). Les deux callers doivent passer le snapshot. Si un futur
caller (test, fork) oublie, la régression est silencieuse — le champ
sera juste absent. **Mitigation** : pas un bug bloquant. Documenter
en commentaire au-dessus de `transformMessage` que le snapshot DOIT
être passé pour Cas #12 mais qu'omettre est rétrocompatible.

### §4.5 Replay precompute mirror — ⚠️ Faille de wording

✓ Le pattern s'applique à `replay-precompute.ts` parce que c'est la
même boucle `duelProcess → duelGetMessage → transformMessage`
([replay-precompute.ts:302-355](../../duel-server/src/replay-precompute.ts#L302-L355)).
J'ai vérifié — l'architecture est strictement parallèle.

❌ **Wording fragile** : "À vérifier ligne par ligne en pass 1 que le
replay precompute n'a pas une mécanique radicalement différente."
Cette vérification a déjà été faite par l'audit — pas besoin de la
laisser comme TODO floue. Le replay precompute appelle `core.duelProcess`
puis `core.duelGetMessage` puis itère via `transformMessage(rawMsg)`
exactement comme le live loop. Le pattern est APPLICABLE TEL QUEL.

→ **Fix recommandé** : remplacer la phrase par "Confirmé 2026-05-26
par audit ligne par ligne : `replay-precompute.ts:302-355` suit le
pattern `duelProcess → duelGetMessage → transformMessage` à
l'identique. Le snapshot pré-process se branche au même endroit."

### §5 Edge cases + invariants — ⚠️ Incomplet, voir §5 audit ci-dessous

✓ Les cas §5.1-5.6 sont raisonnables.

⚠️ Cas non couverts :
- (a) XYZ qui change de slot ET part — `§5.1` couvre le déplacement
  intra-MZONE mais pas le scénario réel de Mind Control.
- (b) Mass destruction touchant >1 XYZ — pas couvert.
- (c) XYZ contrôlé via Mind Control au moment du destroy — turn-switch
  fugace, controller au moment du snapshot vs au moment du settling.
- (d) XYZ banni face-down (Different Dimension Capsule) — pas couvert.
- (e) Replays anciens sans `overlayMaterials` — la spec parent §6 R0.6
  l'évoque mais sans test ni assertion explicite.

Couverts dans le §5 de l'audit ci-dessous.

### §6 Tests — ⚠️ Manque coverage intégration + perf

✓ T-B1/T-B2/T-B3 sont bien posés.

❌ T-B4 dit "peut être différé à un test debug-replay-harness manuel" —
trop laxiste. Une couche d'intégration manque entre l'unit test
`transformMove` et la validation manuelle.

❌ **Test manquant — T-B5 perf** : la spec §5.6 promet "à mesurer en
pass 1" mais aucun test ne mesure réellement le coût. Voir §4 audit.

❌ **Test manquant — T-B6 R8** : aucun test ne vérifie la conclusion
R8 elle-même (query post-process retourne []). Sans ce test, on
ne peut pas catch une éventuelle régression future où OCGCore wasm
serait patché pour exposer les overlays sur OcgMessageMove. Voir §3
audit pour code exact.

### §7 Plan d'exécution — ✓ OK avec timebox réaliste

✓ Estimation 6-8h cohérente.

⚠️ L'étape 5 "Dupliquer la mécanique dans `replay-precompute.ts`"
mérite un sous-step explicite : "Extraire `capturePreProcessOverlays`
en module helper partagé pour éviter la duplication de 30 lignes." Le
duel-worker et replay-precompute partagent déjà `ChainSnapshotTracker`
selon ce pattern (cf. CLAUDE.md "Server Chain Helpers").

### §8 Décisions tactiques — ✓ OK

✓ D0.1 à D0.5 cohérentes.

### §9 Risques — ⚠️ Manque R0.7

✓ R0.1 à R0.6 couverts.

❌ Manque **R0.7 — LOCATION drift** (cf. §2 audit "Fragilité 3"). À
ajouter dans la table avec mitigation "assertion au boot worker".

❌ Manque **R0.8 — info-leak** : `overlayMaterials` contient les
cardCodes des matériaux. Si l'XYZ adverse avait des matériaux
face-down (théoriquement impossible en YGO mais possible en variant
"Reverse Xyz Material"), la liste leak l'info à l'adversaire. À
auditer en pass 1 via `filterMessage.ts`. Plus une assurance qu'un
risque sérieux.

### §10 Hors-scope explicite — ✓ OK

✓ Bornes claires.

### §11 Sources — ✓ OK

✓ Les pointeurs précis et à jour.

---

## §3 Validation R8 (invariant temporel)

Pour vérifier empiriquement en ~30 min que la query `OVERLAY_CARD`
**post-`duelProcess`** retourne bien `[]` pour la zone MZONE d'un XYZ
qui vient de partir, ajouter un log temporaire dans `transformMove`
**SANS** le snapshot pré-process — uniquement la query post-process.
Confirmer empiriquement le résultat vide. Si la query renvoie des
overlays, c'est que l'invariant R8 est faux et il faut reconsidérer
toute la stratégie (peut-être pas besoin du snapshot pré-process).

### §3.1 Log à insérer

À placer en haut de `transformMove` ([duel-worker.ts:341](../../duel-server/src/duel-worker.ts#L341)),
AVANT la query REASON existante :

```ts
function transformMove(msg: any): ServerMessage {
  // β.3 cas #12 — R8 INVARIANT VALIDATION TRACE (TEMPORARY)
  // Goal: confirm that querying OVERLAY_CARD on the source MZONE AFTER
  // duelProcess returns [] for an XYZ that just left the field.
  // To remove after validation.
  if (core && duel && msg.from.location === LOCATION.MZONE) {
    try {
      const probe = core.duelQuery(duel, {
        flags: OcgQueryFlags.OVERLAY_CARD as number,
        controller: msg.from.controller,
        location: msg.from.location as number,
        sequence: msg.from.sequence,
        overlaySequence: 0,
      } as never);
      const overlays = (probe?.overlayCards ?? []) as number[];
      dlog.warn('R8-PROBE post-process OVERLAY_CARD on source MZONE', {
        card: getCardName(msg.card),
        cardCode: msg.card,
        fromCtrl: msg.from.controller,
        fromSeq: msg.from.sequence,
        toLoc: msg.to.location,
        toSeq: msg.to.sequence,
        reasonRaw: '(not queried yet)',
        overlayCount: overlays.length,
        overlayCodes: overlays,
      });
    } catch (err) {
      dlog.warn('R8-PROBE threw', { err: String(err) });
    }
  }
  // --- end R8 probe ---

  let reason = 0;
  // ... existing code unchanged ...
```

### §3.2 Protocole de capture

1. `cd duel-server && npm run build` — pour s'assurer que le worker est
   recompilé avec le probe.
2. Lancer `npm run dev` (le worker doit logger `dlog.warn` visibles).
3. Front : démarrer un duel (PvP solo suffit, ou n'importe quel mode
   PvP).
4. Jouer un scénario XYZ destroy reproductible :
   - **Scénario minimal recommandé** : poser un XYZ rank 4 (n'importe
     lequel — Number 39 Utopia, Tornado Dragon, etc.) avec 2 matériaux.
     Activer Dark Hole ou un autre destroy mass-target.
   - **Scénario alternatif moins reproductible** : un Tribute pour
     summon d'un autre monstre.
5. Capture les `R8-PROBE` lines dans la console du worker. Critères :
   - **Si `overlayCount === 0`** sur le MSG_MOVE de l'XYZ (toLoc = GRAVE
     ou BANISHED) → R8 confirmé, snapshot pré-process nécessaire (spec
     prend la bonne route).
   - **Si `overlayCount > 0`** sur le MSG_MOVE de l'XYZ → R8 invalide,
     reconsidérer toute la stratégie.

### §3.3 Cleanup

Le probe est `dlog.warn` (pas `dlog.debug`) pour qu'il sorte sans
opt-in. Retirer **avant merge** du Commit 0bis. Pas dans `git stash` —
delete sec.

### §3.4 Alternative offline (si harness Playwright disponible)

Le harness `front/e2e/debug-replay-harness.ts` (cf. CLAUDE.md "Layer 3 —
Playwright debug harness") peut capturer un replay XYZ existant. Le
replay précompute appelle aussi `transformMessage` → le probe se
déclenche pareil. `screenshotOn: ['R8-PROBE']` capturerait chaque
moment. Avantage : sans nouvelle partie à jouer. Inconvénient : aucun
replay XYZ-destroy n'est encore catalogué dans le harness exemplar
spec — il faudrait fabriquer un fixture.

→ **Reco** : faire d'abord le test PvP solo manuel (15 min), garder
le harness pour la régression future.

---

## §4 Estimation du coût `OVERLAY_CARD`

### §4.1 Combien de slots réellement ?

Réf. CLAUDE.md « MR5 EMZ convention » + memory
[[mr5-emz-convention]] + [[mr5-extra-deck-summon-destination]].

| Slot | Usage | Existe pour P0 ? | Existe pour P1 ? |
|-----:|-------|:---:|:---:|
| 0 | M1 (Main Monster Zone) | ✓ | ✓ |
| 1 | M2 | ✓ | ✓ |
| 2 | M3 | ✓ | ✓ |
| 3 | M4 | ✓ | ✓ |
| 4 | M5 | ✓ | ✓ |
| 5 | EMZ_L (partagé) | ✓ (si occupé par P0) | ✓ (si occupé par P1) |
| 6 | EMZ_R (partagé) | ✓ (si occupé par P0) | ✓ (si occupé par P1) |
| 7 | Réservé OCGCore | (?) | (?) |

**Décompte réaliste** : 2 players × 7 slots = **14 queries**. La spec
parle de "16 queries" (= 2 × 8). 14 vs 16 — la différence est mineure
(2 queries supplémentaires à ~150 µs = ~300 µs ajouté). Pas de raison
de tomber à 7 — le `MZONE_SLOT_COUNT = 8` couvre le edge case d'un
binding wasm qui exposerait un slot 7.

→ **Question Axel-Q4** : Slot 7 existe-t-il ? Test rapide : ajouter
au probe ci-dessus une boucle `for (seq = 0; seq < 10; seq++)` et
logger si `OVERLAY_CARD` revient `null` ou `{overlayCards: []}` pour
seq=7+. `null` = slot inexistant ; `{overlayCards: []}` = slot vide.
Pourrait répondre la question définitivement.

### §4.2 Coût ms réel

Estimation lower bound (spec) : 50-200 µs par query unitaire wasm.
14-16 queries → **~700 µs à ~3.2 ms par tour de boucle**.

Mesure cible : `duelInstr.time('preProcessOverlays', ...)` autour de
`capturePreProcessOverlays(...)`. La machinerie `duelInstr` existe
déjà ([duel-worker.ts:1209](../../duel-server/src/duel-worker.ts#L1209)
pour `duelProcess`).

→ **Question Axel-Q5** : seuil d'alerte ? Mon penchant : si moyen
> 5 % de `duelProcess` (typiquement 1-5 ms) ou si total cumulé > 1s
sur un duel de 30 tours, escalader vers l'optimisation §5.6. Sinon
ne pas optimiser (YAGNI).

### §4.3 Benchmark proposé — micro-suite

Ajout à `duel-server/src/duel-worker.spec.ts` (ou un nouveau
`pre-process-overlays.bench.ts`) :

```ts
import { performance } from 'perf_hooks';

it('β.3 cas #12 — capturePreProcessOverlays cost benchmark', async () => {
  // Setup : un duel synthétique avec 7 monstres XYZ sur le board
  // (chacun avec 2 matériaux), tous les EMZ occupés, etc. Pour
  // worst-case les 14-16 queries returnent toutes des overlays.
  const { core, duel } = await setupWorstCaseBoard();

  // Mesure : 100 captures consécutives, prendre le median.
  const samples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    capturePreProcessOverlays(core, duel);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[50];
  const p95 = samples[95];
  console.log(`capturePreProcessOverlays p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
  expect(p50).toBeLessThan(5);  // soft cap, ajuster sur la mesure réelle
});
```

→ **Alternative `duelQueryLocation`** : remplacer 8 `duelQuery` par 1
`duelQueryLocation` :

```ts
const cards = core.duelQueryLocation(duel, {
  flags: OcgQueryFlags.OVERLAY_CARD as number,
  controller: player,
  location: LOCATION.MZONE as number,
} as never);
// cards = (Partial<OcgCardQueryInfo> | null)[] — 1 entrée par slot
cards.forEach((c, seq) => {
  const mats = c?.overlayCards ?? [];
  if (mats.length > 0) snapshot.set(...);
});
```

→ 1 query × 2 players = **2 queries** au lieu de 14-16. **À vérifier
en pass 1** que `duelQueryLocation` couvre les slots EMZ (5-6) — le
flag `MZONE = 4` est-il un superset incluant EMZ ? Si oui, c'est la
voie économique de 8× la perf. **C'est l'optimisation à proposer en
priorité plutôt que le skip-empty-slot via CODE de §5.6** (qui ajoute
une query pour en sauter une autre — gain marginal).

→ **Question Axel-Q implicite incluse** : préférer cette optimisation
dès le commit initial, ou viser la simplicité (8 queries) et optimiser
sur mesure ? Mon penchant : appeler une fois `duelQueryLocation` car
le code n'est PAS plus complexe et la perf x8 est gratuite. Mais
respecter D0.4 (YAGNI sur le snapshot d'abord) signifie partir avec
les 8 queries et migrer si mesure dépasse seuil.

---

## §5 Edge cases supplémentaires non couverts

### §5.a XYZ qui change de slot ET part dans le même batch

**Scénario** : un XYZ en M2 est déplacé en M3 par un effet (rare —
typiquement le contraire, c'est OCGCore qui re-séquence après
suppression). Puis dans la même `duelProcess`, un destroy le retire.

**Comportement avec le snapshot pré-process** : `capturePreProcessOverlays`
capture les overlays à M2 (position pré-batch). Le MSG_MOVE de
déplacement M2 → M3 verra `from.sequence=2` ; la Map a une entrée
`(player, 2)` → overlay-attached. Le MSG_MOVE de destroy M3 →
GRAVE verra `from.sequence=3` ; la Map a `(player, 3)` (vide ou
non-capturée) → pas d'overlay.

**Bug visuel mineur possible** : le rule cas #12 ouvre la deferred au
PREMIER MSG_MOVE (le déplacement), pas au destroy. Le rule attend
des settling GRAVE→GRAVE qui n'arriveront qu'au destroy ; entre
les deux, l'XYZ existe encore en M3, les matériaux sont liés. Le
rule pourrait ne pas matcher les settlings parce que la deferred est
encore en attente du predicate "MOVE GRAVE→GRAVE reason=0x600" qui
n'arrivera qu'après le destroy.

Couvert par la spec parent §5.1 du commit 1 (note "documenté").

→ **À ajouter dans la spec parent §5** : le commentaire que ce
scenario est exotique mais que le snapshot est cohérent avec la
position pré-batch — visuel partira de M2 au lieu de M3.

### §5.b Mass destruction (>1 XYZ ensemble)

**Scénario** : Dark Hole sur 2 XYZ adverses.

**Comportement** : `capturePreProcessOverlays` capture les overlays
des 2 XYZ. La boucle messages traite les 2 MSG_MOVE (XYZ#1 → GRAVE,
XYZ#2 → GRAVE) en séquence. Chacun ouvre sa propre deferred (cas #12
commit 1). Côté snapshot, **pas de problème** — la Map a les 2
entrées indépendamment. Couvert.

⚠️ **Sub-edge non couvert** : si OCGCore émet les 2 MSG_MOVE et que
le destroy par batch fait que les matériaux du XYZ#1 sortent avant
ceux du XYZ#2, les settlings GRAVE→GRAVE peuvent s'entrelacer. La
règle `chainTo` du commit 1 absorbe par `cardCode` (cf. spec parent
§4.4.3) — robuste à l'ordre. Mais la spec 0bis (donc ce commit) n'a
RIEN à faire ici ; juste vérifier que le snapshot capture les 2 XYZ.

### §5.c XYZ contrôlé via Mind Control (turn-switch fugace)

**Scénario** : XYZ originellement P0, Mind Control fait que P1 le
contrôle pendant 1 turn. Pendant ce turn P0 le détruit (ou vice
versa).

**Comportement** : `msg.from.controller` reflète le contrôleur **au
moment du MSG_MOVE**. Si Mind Control est actif, le contrôleur est P1
(l'envouteur). Le snapshot `capturePreProcessOverlays` capture
overlays par (`player`, `seq`) où `player` est le contrôleur. Donc
quand l'XYZ part avec `msg.from.controller=1`, on lit la Map `(1, seq)`.
✓ Cohérent.

⚠️ **Sub-edge** : la table snapshot est `Map<\`${0|1}-${number}\`,
number[]>`. Si OCGCore expose le slot EMZ comme `(player=0, seq=5)`
ET aussi `(player=1, seq=5)` (les deux ont accès à EMZ_L) — la Map a
2 entrées pour la MÊME zone physique. Mais les EMZ ne sont accessibles
que par UN player à la fois (cf. memory [[mr5-emz-convention]]) →
une des 2 entrées est vide. Pas de bug.

### §5.d XYZ banni face-down

**Scénario** : Different Dimension Capsule banit l'XYZ face-down,
puis le rappelle face-up 2 turns plus tard.

**Comportement** : `OcgQueryFlags.OVERLAY_CARD` retourne les overlays
indépendamment de la position. Au snapshot pré-process, l'XYZ a ses
matériaux (face-up ou face-down). Les matériaux suivent l'XYZ banni —
ils ne settle PAS en GY. Donc pas de MSG_MOVE GRAVE→GRAVE reason=0x600 —
le rule cas #12 ne trigger pas (pas de settlings). Couvert
implicitement.

⚠️ **Sub-edge** : si l'XYZ banni est ensuite détruit pendant qu'il
est banni (théoriquement possible via certaines cartes exotiques),
les matériaux iraient en GY à ce moment. Le rule cas #12 dépend de
`fromLocation === LOCATION.MZONE` — un destroy depuis BANISHED ne
trigger pas. → **Pas un bug** : visuel resterait sous-optimal mais le
scénario est ultra-rare. Hors scope.

### §5.e Replays anciens sans `overlayMaterials`

**Scénario** : un replay enregistré AVANT le merge du Commit 0bis ;
rejoué via le replay viewer post-merge.

**Comportement** : le replay precompute regenère les events server-side
à chaque relecture (cf. CLAUDE.md "Pre-computation Timeline Rules").
Donc les replays anciens sont **re-précomputés** avec le nouveau code
→ ils auront `overlayMaterials` dans leurs MSG_MOVE. Pas de problème
de back-compat.

⚠️ Si le replay est CACHÉ (PreComputedState stocké en base/disque),
le cache reste à l'ancien format jusqu'à invalidation. → **Mitigation**
nécessaire : confirmer que `runReplayPreComputation` re-court à chaque
ouverture de replay, ou invalider le cache. Cf. spec §6 R0.6 — la
spec dit "vieux replays restent sans → OK". J'ajouterais : auditer
spring boot replay-persist pour confirmer.

→ **Question Axel-Q implicite** : le replay est-il re-précomputé à
chaque ouverture ou un cache persisté existe-t-il ? (Si oui, il faut
invalider.)

---

## §6 Plan d'implémentation détaillé

Ordre exact des éditions, sans livrer le code final.

### §6.1 Étape 1 — Ajouter le champ au mirror back

Fichier : `duel-server/src/ws-protocol-game.ts`.

Position : entre `reason: number;` (ligne 38) et `boardStateAfter?: BoardStatePayload;` (ligne 46).

```ts
// AVANT (lignes 37-46 actuelles)
  isToken: boolean;
  reason: number;
  /**
   * Board-state snapshot ...
   */
  boardStateAfter?: BoardStatePayload;

// APRÈS (insertion sandwich)
  isToken: boolean;
  reason: number;
  /**
   * β.3 cas #12 (2026-05-26, Commit 0bis) — overlayMaterials de la
   * card source AU MOMENT DU MSG_MOVE (capturés pré-`duelProcess`,
   * avant que la mutation OCGCore ne retire l'XYZ). Émis uniquement
   * quand (a) la card a un overlay non-vide ET (b) elle quitte une
   * zone MZONE. Optionnel — absent dans la grande majorité des
   * MSG_MOVE. Lu par le DEP rule `xyzLeaveWithMaterials` (Commit 1)
   * pour synthétiser N MSG_MOVE virtuels OVERLAY→GRAVE.
   */
  overlayMaterials?: number[];
  /**
   * Board-state snapshot ...
   */
  boardStateAfter?: BoardStatePayload;
```

### §6.2 Étape 2 — Mirror byte-sync côté front

Fichier : `front/src/app/pages/pvp/duel-ws-game.types.ts`.

**Modif strictement identique** à §6.1 (même bloc JSDoc, même position,
même indentation). Le script `check-ws-protocol-sync.mjs` normalise les
imports `.js` mais pas le contenu — donc le JSDoc et l'ordre doivent
être identiques au caractère près.

Validation immédiate : `cd duel-server && npm run prebuild`. Output
attendu : `OK: 8 paired protocol/game-log files are in sync ...`.

### §6.3 Étape 3 — Helper partagé pour la capture

Nouveau fichier : `duel-server/src/pre-process-overlays.ts`.

Suivre le pattern de `chain-snapshot-tracker.ts` (helper module partagé
entre `duel-worker.ts` et `replay-precompute.ts`).

```ts
// duel-server/src/pre-process-overlays.ts
import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { OcgQueryFlags } from '@n1xx1/ocgcore-wasm';
import { LOCATION } from './ws-protocol.js';

/** β.3 cas #12 (Commit 0bis) — clé du snapshot pré-process.
 *  `${controller}-${sequence}` parce que la card peut être contrôlée
 *  par P0 ou P1 (turn-switch via Mind Control, etc.). */
export type PreProcessOverlayKey = string;

/** MZONE slot count : 5 main + 2 EMZ + 1 réservé OCGCore (D0.3 défense
 *  en profondeur). */
const MZONE_SLOT_COUNT = 8;

/** Capture les overlayMaterials de chaque slot MZONE pour les 2 players,
 *  juste AVANT que `duelProcess` n'applique les mutations qui retireront
 *  potentiellement des XYZ. Résultats vides omis pour garder la Map
 *  petite.
 *
 *  Gestion d'erreur (audit option A) : try/catch global, dégradation
 *  gracieuse — un overlay manqué = visuel imparfait sur 1 XYZ, pas un
 *  crash du worker.
 *
 *  Performance : ~14-16 queries `OVERLAY_CARD` à ~50-200 µs chacune,
 *  total ~1-3 ms par appel. À mesurer via `duelInstr.time('preProcessOverlays', ...)`.
 *  Cf. §4 audit.
 */
export function capturePreProcessOverlays(
  core: OcgCoreSync,
  duel: OcgDuelHandle,
): Map<PreProcessOverlayKey, number[]> {
  const snapshot = new Map<PreProcessOverlayKey, number[]>();
  try {
    for (const player of [0, 1] as const) {
      for (let seq = 0; seq < MZONE_SLOT_COUNT; seq++) {
        const overlayInfo = core.duelQuery(duel, {
          flags: OcgQueryFlags.OVERLAY_CARD as number,
          controller: player,
          location: LOCATION.MZONE as number,
          sequence: seq,
          overlaySequence: 0,
        } as never);
        const overlayCards = (overlayInfo?.overlayCards ?? []) as number[];
        if (overlayCards.length > 0) {
          snapshot.set(`${player}-${seq}`, overlayCards);
        }
      }
    }
  } catch (err) {
    // Dégradation gracieuse — voir audit §2 Fragilité 1.
    // (logger optionnel : injecter via param si nécessaire en pass 1)
    console.warn('[PRE-PROCESS-OVERLAYS] query threw, snapshot partial', err);
  }
  return snapshot;
}
```

### §6.4 Étape 4 — Wire dans `runDuelLoop`

Fichier : `duel-server/src/duel-worker.ts`.

Modif autour de la ligne 1207 (juste avant le `try { status = duelInstr.time('duelProcess', ...)`).

```ts
// AVANT
    let status: number;
    try {
      status = duelInstr.time('duelProcess', () => core!.duelProcess(duel!));

// APRÈS
    // β.3 cas #12 (Commit 0bis) — capture overlays MZONE AVANT que
    // duelProcess n'applique les mutations.
    const preProcessOverlays = duelInstr.time(
      'preProcessOverlays',
      () => capturePreProcessOverlays(core!, duel!),
    );

    let status: number;
    try {
      status = duelInstr.time('duelProcess', () => core!.duelProcess(duel!));
```

Puis ligne 1254 (`const dto = transformMessage(msg);`) :

```ts
// AVANT
      const dto = transformMessage(msg);

// APRÈS
      const dto = transformMessage(msg, preProcessOverlays);
```

### §6.5 Étape 5 — Modif `transformMessage` + `transformMove`

Fichier : `duel-server/src/duel-worker.ts:520` (`transformMessage`) +
`duel-worker.ts:341` (`transformMove`).

```ts
// transformMove gagne un param optionnel
function transformMove(
  msg: any,
  preProcessOverlays?: Map<PreProcessOverlayKey, number[]>,
): ServerMessage {
  let reason = 0;
  // ... query REASON existante inchangée ...

  // β.3 cas #12 (Commit 0bis) — lit le snapshot pré-process pour les
  // moves depuis MZONE. Le snapshot a été capturé AVANT duelProcess,
  // donc les overlays d'un XYZ qui vient de partir sont accessibles.
  let overlayMaterials: number[] | undefined;
  if (preProcessOverlays && msg.from.location === LOCATION.MZONE) {
    const captured = preProcessOverlays.get(`${msg.from.controller}-${msg.from.sequence}`);
    if (captured && captured.length > 0) {
      overlayMaterials = captured;
    }
  }

  return {
    type: 'MSG_MOVE', cardCode: msg.card, /* ... champs existants ... */
    reason,
    ...(overlayMaterials ? { overlayMaterials } : {}),
  };
}

// transformMessage forwarde le snapshot
function transformMessage(
  msg: OcgMessage,
  preProcessOverlays?: Map<PreProcessOverlayKey, number[]>,
): ServerMessage | null {
  // ... logging existant ...
  switch (msg.type) {
    // ... autres cases inchangés ...
    case OcgMessageType.MOVE:
      return transformMove(msg, preProcessOverlays);
    // ...
  }
}
```

### §6.6 Étape 6 — Mirror dans `replay-precompute.ts`

Fichier : `duel-server/src/replay-precompute.ts:302-355`.

Ajout autour de la ligne 301 (juste avant `core.duelProcess(duel)`) :

```ts
// AVANT
    let status: number;
    try {
      status = core.duelProcess(duel);

// APRÈS
    const preProcessOverlays = capturePreProcessOverlays(core, duel);

    let status: number;
    try {
      status = core.duelProcess(duel);
```

Puis ligne 355 (`const translated = transformMessage(rawMsg);`) :

```ts
// AVANT
      const translated = transformMessage(rawMsg);

// APRÈS
      const translated = transformMessage(rawMsg, preProcessOverlays);
```

⚠️ **Note** : `transformMessage` est injecté dans `replay-precompute.ts`
via `ReplayPrecomputeDeps` ([replay-precompute.ts:182](../../duel-server/src/replay-precompute.ts#L182)).
La signature `(msg: OcgMessage) => ServerMessage | null` doit devenir
`(msg: OcgMessage, preProcessOverlays?: Map<...>) => ServerMessage | null`.
Modifier le type `ReplayPrecomputeDeps` en conséquence.

### §6.7 Étape 7 — Update `duel-worker.ts` injection des deps

`ReplayPrecomputeDeps.transformMessage` est passé via le `runReplayPreComputation`
call ([duel-worker.ts](../../duel-server/src/duel-worker.ts)). La closure passe
`transformMessage` directement — modifier le type pour accepter le param.

---

## §7 Plan de tests

8 specs unitaires + 1 régression Cypress optionnelle.

### T-B1 — `transformMove` sans snapshot omet `overlayMaterials`

Couvert dans la spec §6.1. Garde la rétrocompat — un caller qui
n'ajoute pas le snapshot continue de fonctionner.

### T-B2 — `transformMove` avec snapshot peuplé écrit `overlayMaterials`

Couvert dans la spec §6.2. Path nominal.

### T-B3 — `transformMove` ignore le snapshot pour `fromLocation !== MZONE`

Couvert dans la spec §6.3. Anti-régression : pas de leak du snapshot
vers SZONE / HAND / DECK.

### T-B4 — `capturePreProcessOverlays` retourne une Map vide quand
aucun MZONE n'a d'overlay

Test nouveau (audit) : setup un duel synthétique avec 3 monstres
non-XYZ sur le board. `capturePreProcessOverlays` retourne une Map
vide. Couvre la baseline "no work to do".

### T-B5 — `capturePreProcessOverlays` capture les EMZ slots

Test nouveau (audit) : setup avec 1 XYZ summon sur EMZ_L (`sequence=5`).
La Map a une entrée `0-5` (ou `1-5` selon le contrôleur). Couvre la
règle MR5 (cf. memory [[mr5-emz-convention]]).

### T-B6 — Boucle complète : XYZ destroy → MSG_MOVE émis avec `overlayMaterials` peuplé

Test d'intégration (équivalent T-B4 du spec original). Couverture
end-to-end avec un mock OCGCore minimal. Si l'infrastructure ne le
permet pas, déferrer à un test manuel debug-replay-harness.

### T-B7 — Test perf benchmark

Test nouveau (audit, §4.3) : `capturePreProcessOverlays` p50 < 5 ms,
p95 < 10 ms. Soft cap — ajuster sur la mesure réelle après pass 1.

### T-B8 — Test sync byte-check

`scripts/check-ws-protocol-sync.mjs` doit retourner OK après la modif.
Run en CI via `prebuild`. Pas un test JS unitaire — étape du build.

### T-B9 (optionnel) — Régression Cypress / Playwright

Tester le replay viewer sur un replay XYZ destroy connu. Vérifier que
`MoveMsg.overlayMaterials` est présent dans le message reçu via le WS.
Si le harness debug-replay le supporte, ajouter au catalogue regression.

---

## §8 Risques & mitigations (augmentés au-delà de la spec)

Ajoute aux R0.1-R0.6 de la spec existante.

| # | Risque | Impact | Mitigation |
|---|--------|--------|------------|
| **R0.7** | `LOCATION.MZONE` (0x04) drifte de `OcgLocation.MZONE` (4) suite à un refactor du protocole skytrix | Queries OCGCore deviennent silencieusement fausses (mauvais bit envoyé). Couvre toutes les MZONE queries du worker, pas que Commit 0bis. | Assertion runtime au boot du worker : `if (LOCATION.MZONE !== OcgLocation.MZONE) throw new Error(...)`. Hors scope strict de 0bis — à ajouter dans un commit séparé si on découvre le drift en pass 1. |
| **R0.8** | Info-leak via `overlayMaterials` : un matériau face-down (théoriquement impossible YGO actuel) leakerait son cardCode | Très théorique. Pas applicable à YGO standard. | Vérifier dans `filterMessage.ts` pendant la pass 1 que `overlayMaterials` ne traverse pas le filtre per-player tel quel. Si nécessaire, sanitize pour les opposants. |
| **R0.9** | `duelQuery` peut throw sous certaines conditions wasm (cf. `ocg-field-query.ts:251-273`). Worker crash sur un edge case OCGCore. | Worker crashe à la première query failing, watchdog clean-up le duel — joueurs perdent leur partie. | Try/catch dans `capturePreProcessOverlays` (audit Option A). Le worst-case devient "1 XYZ visuel imparfait" au lieu de "duel crashé". |
| **R0.10** | `replay-precompute.ts` re-précomputé à chaque ouverture vs cache persisté | Si cache, les replays anciens ne portent jamais le nouveau champ — pas de visuel correct pour les vieux replays | Audit `replay-persist.ts` + Spring Boot replay endpoint en pass 1. Si cache, plan B = invalidation ou regénération paresseuse. |
| **R0.11** | `MZONE_SLOT_COUNT = 8` est trop ou pas assez | Slot 7 query → wasted work (slot inexistant) ou slot 7 manqué (slot existe et porte un overlay) | Mesure empirique au probe R8 (cf. §3). Si OCGCore retourne `null` pour seq=7, mettre à 7. Si retourne `{overlayCards: []}`, garder à 8. |
| **R0.12** | Performance worst-case déclenche un slow-loop perçu | 14-16 queries × 100+ boucles `duelProcess` par turn = ~1-3s cumulés sur un duel. Peut faire dépasser le budget `duelInstr` ou ralentir un joueur. | Mesure via T-B7 benchmark + alternative `duelQueryLocation` (cf. §4.3) qui divise le coût par 8. |

---

## §9 Questions ouvertes pour Axel (récap)

Au plus 5 questions précises :

1. **Axel-Q1 (position du champ)** — Faut-il vraiment fortifier "entre
   `reason` et `boardStateAfter`" comme règle, ou est-ce un simple
   choix de cohérence ? (Pas critique mais clarifie le contrat.)
2. **Axel-Q2 (gestion d'erreur)** — `capturePreProcessOverlays` doit-il
   try/catch et continuer avec une Map partielle (option A — penchant
   audit), ou propager comme `duelProcess threw` (option B) ?
3. **Axel-Q3 (slot 7)** — Veux-tu lancer le probe au §3 pour mesurer
   empiriquement si OCGCore expose un slot 7 ? Décide entre
   `MZONE_SLOT_COUNT = 7` ou `8`.
4. **Axel-Q4 (optimisation `duelQueryLocation`)** — Préfères-tu
   commencer avec les 14-16 queries unitaires (simple, YAGNI) ou
   passer directement à `duelQueryLocation` (2 queries totales,
   ~8× plus rapide) ? Mon penchant : `duelQueryLocation` dès le
   commit si la lecture du retour binding-snake/camel ne pose pas
   problème — sinon les 14-16 queries.
5. **Axel-Q5 (replay cache)** — Le replay-persist (Spring Boot)
   met-il en cache les `PreComputedState` côté DB/disque, ou
   re-précompute-t-il à chaque ouverture ? Détermine si on a besoin
   d'une invalidation cache pour les vieux replays.

---

## §10 Recommandation finale audit

**La spec Commit 0bis est globalement saine**. Les 3 axes (protocole,
snapshot pré-process, mirror replay) sont corrects et le diagnostic
R8 est ferme.

**Avant de coder, traiter** :
- ❌ Bug path `check-ws-protocol-sync.mjs` (spec §3 + §6.3) — correction
  triviale, à inscrire dans la PR.
- ❌ Décompte arithmétique "5 + 2 + 1 OPT" (spec §1.2) — clarifier
  en "5 main + 2 EMZ + 1 réservé".
- ❌ Wording fragile "à vérifier ligne par ligne" (spec §4.5) —
  remplacer par la confirmation déjà faite par l'audit.
- ⚠️ Ajouter R0.7 à R0.12 au tableau des risques.

**Avant de merger**, valider empiriquement par le probe R8 (§3) que
l'invariant temporel tient. ~30 min.

**Au moment de coder**, prioriser `duelQueryLocation` (§4.3) plutôt
que le skip-empty-slot (§5.6 de la spec) — gain perf identique avec
moins de complexité.

Reste alignable sur la branche `feat/anim-pipeline-v2`, mergeable
indépendamment des Commits 1 & 2, sans bloquer la session #13.

---

## §11 Sources audit

- `_bmad-output/planning-artifacts/beta-3-case-12-commit-0bis-protocol-spec.md` — spec auditée.
- `_bmad-output/planning-artifacts/beta-3-case-12-xyz-leave-with-materials-spec.md` — spec parent.
- `duel-server/src/duel-worker.ts:341-370,520-530,1186-1310` — `transformMove`, `transformMessage`, `runDuelLoop`.
- `duel-server/src/replay-precompute.ts:170-355` — mirror replay.
- `duel-server/src/ws-protocol-game.ts:16-47` — `MoveMsg` back.
- `front/src/app/pages/pvp/duel-ws-game.types.ts:16-47` — `MoveMsg` front.
- `duel-server/src/ws-protocol-shared.ts:63-72` — `LOCATION` skytrix enum.
- `duel-server/node_modules/@n1xx1/ocgcore-wasm/dist/index.d.ts:196-266,355-362,713-738,1722-1797` — types OCGCore.
- `duel-server/src/solver/ocg-field-query.ts:251-273` — pattern try/catch existant.
- `duel-server/src/duel-worker.ts:854-900` — `buildBoardState` (référence wasm bug + pattern queryFlag).
- `scripts/check-ws-protocol-sync.mjs` — sync byte-check au root (PAS dans `duel-server/scripts/`).
- `duel-server/package.json` — `prebuild = node ../scripts/check-ws-protocol-sync.mjs`.
- Memory `[[mr5-emz-convention]]` — MR5 EMZ slot sequences 5-6.
- Memory `[[mr5-extra-deck-summon-destination]]` — règles ED summon.
- CLAUDE.md « MR5 EMZ convention » + « Server Chain Helpers ».
