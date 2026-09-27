# PvP↔Replay Event Stream Parity Test — spec (2026-06-05)

> **Statut** : spec, à implémenter en Phase 0 du chantier v4
> ([anim-pipeline-v4-replay-unification-2026-06-05.md](anim-pipeline-v4-replay-unification-2026-06-05.md)).
> Livrable autonome utile **AVANT** même le démarrage du chantier — ce
> test détecte les régressions silencieuses actuelles de parité PvP/Replay.

## Objectif

Prouver que pour un même duel (fixture replay), le pipeline anim
client consume **strictement la même séquence d'events** en mode PvP
normal (via `DuelConnection` + WS) et en mode Replay (via
`ReplayDuelAdapter` + précompute).

C'est le **golden reference** du chantier v4 : si après refactor le
test continue de passer, la doctrine "Replay = PvP readonly" est
vérifiée mécaniquement et plus seulement par construction.

C'est aussi utile **dès aujourd'hui** : si le test fail avant le
chantier, ça révèle des bugs de parité silencieux qui méritent
d'être documentés (et fix si jugés worth-it).

## Périmètre

### Ce que le test compare

Le contenu de `AnimationOrchestratorService._eventStream` après que le
duel ait été entièrement consommé en mode PvP normal vs Replay.

`_eventStream` contient TOUS les events qui passent par le pipeline
anim : `GameEvent[]` (MSG_*) + `BoundaryEvent[]` (ChainStarted,
TurnStarted, PhaseStarted) + `DeferredFluxEvent[]` (DeferredEffect,
EffectReady, EffectAbandoned) + `InternalTransportEvent[]` (runner-started,
runner-stopped) + `AnimationFluxEvent[]` (AnimationStarted, AnimationCompleted).

C'est l'API stream par où tout passe — le bon endroit pour vérifier la parité.

### Ce que le test NE compare PAS

- **Timings absolus** : irréductibles par construction (RTT WS vs scheduler).
- **`ref` monotonic counter** : peut différer si l'ordre des events diffère
  d'1 tick — comparer les events par contenu sémantique, pas par ref.
- **BoundaryEvent timestamps** : ils encodent la latence relative
  (différente par construction).
- **`PLAYER_RESPONSE`** : pas dans `_eventStream` (consommée côté
  serveur, jamais émise au client).
- **`SELECT_*`** : présent en PvP normal (le client envoie une
  PLAYER_RESPONSE après) mais ABSENT en replay si `togglePromptMode`
  est off (la précompute ne les met que sous certaines conditions).
  → À déterminer en écriture du test : strip-les ou compare-les.

### Fixtures cibles

Cf. doc v4 § Pré-requis B. 5-6 replays courts :

1. **Chain multi-link simple** (≥3 links, pas de prompts).
2. **Cost discard + self-destroy** (`18a55f97` — Radiant Typhoon Vision).
3. **XYZ détach + destroy** (matériaux qui partent en GY).
4. **Mid-chain prompt** (`SELECT_CARD` pendant chain resolving).
5. **Perspective switch SOLO** (post-v3 Phase 5-bis disponible).
6. **Initial draw + multi-tour normal** (smoke test).

Chaque fixture est un replay JSON stocké dans `front/src/test/fixtures/parity/`
+ idéalement une description Markdown du scénario.

## Architecture du test

### Étape 1 — Run PvP normal

Tourner le duel en mode PvP normal au-dessus de la stack dev-stack
isolée :

```ts
const session = await setupPvpSession(ctx, {
  decks: fixture.decks,
  playerResponses: fixture.playerResponses,  // injecte les réponses via tape player serveur OU via le client (cf. décision ci-dessous)
  fastMode: true,  // pas d'animation, juste consume le flux
});

await session.runToCompletion();
const pvpStream = await session.driver.captureEventStream();
```

**Question ouverte 1** : comment injecter les `playerResponses` en mode PvP
normal ? 2 options :

- **Option A — Tape player serveur** : étendre le serveur avec un mode
  "auto-respond from playerResponses[]" déclenché par un flag de session.
  Le serveur consomme les réponses du fixture comme s'il y avait 2 humains.
- **Option B — Tape player client** : le client capture le `SELECT_*`,
  attend `REPLAY_PROMPT_DELAY_MS`, dispatch la réponse pré-enregistrée.
  Identique à ce que fait le replay actuellement.

Recommandation Option B — minimal serveur impact, code de tape player
réutilisable entre test et chantier v4 lui-même.

### Étape 2 — Run Replay

Tourner le même duel en mode Replay :

```ts
const session = await setupReplaySession(ctx, {
  replayId: fixture.id,
  perspective: 0,
  buildFirst: false,
});

await session.driver.playToEnd();
const replayStream = await session.driver.captureEventStream();
```

### Étape 3 — Normaliser pour comparaison

Une fonction `normalize(stream: StreamEvent[]): NormalizedEvent[]` qui :

- Strip les fields non-déterministes : `ref`, `timestamp`, `traceId`.
- Conserve les fields sémantiques : `type`, `kind`, `chainIndex`, `cardCode`,
  `fromLocation`, `toLocation`, `lpDelta`, `name` (pour deferred), etc.
- Strip les events INTERNAL transport (`runner-started`, `runner-stopped`,
  `rescue-fired`, `watchdog-armed`) — ces events reflètent la mécanique
  de la queue runner, différente par construction.
- Strip les `AnimationStarted` / `AnimationCompleted` ? À décider — ils
  encodent quel msgType a été dispatched, mais leur ordre n'est pas
  strictement identique selon le moment exact du finalize.

**Question ouverte 2** : strip ou compare les `AnimationStarted/Completed` ?
Recommandation : strip-les en v0 du test (trop volatil), les réactiver
plus tard si on veut une parité plus stricte.

### Étape 4 — Assert structural equality

```ts
const pvpNormalized = normalize(pvpStream);
const replayNormalized = normalize(replayStream);
expect(replayNormalized).toEqual(pvpNormalized);
```

Si fail, diff lisible :
```
Expected (PvP):    [...., MSG_MOVE{card=Krosea, to=GY-0}, ChainEnded{idx=1}, ...]
Actual   (Replay): [...., ChainEnded{idx=1}, MSG_MOVE{card=Krosea, to=GY-0}, ...]
                                              ↑ order differs at index 47
```

## Implémentation concrète

### Localisation

`front/src/app/pages/pvp/duel-page/event-stream-parity.spec.ts`
(spec Karma — pas e2e Playwright, sinon trop lent et flaky).

### Helper de capture

Ajouter une méthode au `__skytrixDebug` surface :

```ts
__skytrixDebug.captureEventStream(): StreamEvent[]
```

Retourne `orchestrator._eventStream()` snapshot.

### Helper de normalisation

`front/src/test/parity/normalize.ts` :

```ts
export function normalizeStream(stream: StreamEvent[]): NormalizedEvent[] {
  return stream
    .filter(e => !isInternalTransport(e))
    .filter(e => !isAnimationFlux(e))  // v0 du test
    .map(stripVolatileFields);
}

function stripVolatileFields(e: StreamEvent): NormalizedEvent {
  const { ref, timestamp, traceId, ...semantic } = e as any;
  return semantic;
}
```

### Helper de fixture

`front/src/test/fixtures/parity/index.ts` :

```ts
export const PARITY_FIXTURES = [
  { id: 'chain-multi-link-simple', decks: [...], playerResponses: [...] },
  { id: 'radiant-typhoon-vision',  decks: [...], playerResponses: [...] },
  ...
] as const;
```

### Structure du test

```ts
describe('PvP↔Replay event stream parity', () => {
  for (const fixture of PARITY_FIXTURES) {
    it(`${fixture.id} — same stream`, async () => {
      const pvpStream    = await runPvpAndCaptureStream(fixture);
      const replayStream = await runReplayAndCaptureStream(fixture);

      expect(normalizeStream(replayStream))
        .toEqual(normalizeStream(pvpStream));
    });
  }
});
```

## Exécution attendue avant chantier v4

**Hypothèses initiales** :

- Les 6 fixtures vont probablement PAS toutes passer.
- Les failures attendues sont des divergences déjà connues mais
  non-documentées :
  - Ordre des `BoundaryEvent` autour des phase transitions (PvP fire
    `BoundaryStart(turn)` avant la 1ère MSG_DRAW, Replay possiblement après).
  - `DeferredEffect` qui timeout en PvP mais resolve en Replay parce que
    le timing diffère.
  - Ordre intra-batch des MSG_MOVE multi-card.
- Documenter chaque failure comme finding du chantier v4 préliminaire.

**Si les 6 fixtures passent dès le 1er run** : excellent, on a un golden
reference solide pour démarrer le chantier v4.

## Maintenance post-chantier v4

Après livraison du chantier v4 :

- Le test continue de tourner — le `mockConn` remplace l'adapter, donc
  la "parité" devient quasi-tautologique (même code path après dispatch).
- Le test devient un **détecteur de régression** : si quelqu'un
  introduit une divergence dans le `mockConn` qui fait que le replay
  consomme différemment, le test catch.
- À ajouter au CI front si pas déjà — un `npm test` qui catch ce genre
  de régression structurellement.

## Backlog futur — PvP normal parity test

L'implémentation Phase 0 utilise **SOLO multiplex** (1 token, 1 ws,
omniscient filter) comme source PvP de comparaison. Choix fait après
exploration approfondie de `pvp-connection-handler.ts` :

- PvP normal exige 2 ws connectés AVANT que le worker démarre
  (`isReadyToStart` dans `lifecycle-helpers.ts` ligne 26-29).
- Le front PvP normal récupère les tokens via `roomService.fetchRoom()`
  qui appelle Spring Boot — pas exposé depuis `/api/duels/from-replay`.
- Faire connecter 2 contexts Playwright synchroniquement = fragile.

**SOLO multiplex** est plus proche du replay précompute par construction
(les deux sont omniscient → moins de divergences mécaniques à filtrer)
et démarre avec 1 ws sans bricolage.

**Mode PvP normal à ajouter plus tard** comme variante du test :
- Endpoint `/api/duels/from-replay?mode=pvp-normal` avec `soloMode: false`.
- Côté front, route `/pvp/duel/${duelId}?pvp-bypass=true` qui bypass
  `roomService.fetchRoom` et accepte 2 tokens via query string.
- 2 contexts Playwright qui se connectent en parallèle.
- Bénéfice : ce test catch les divergences spécifiques au per-player
  filter (`message-filter.ts:sanitizeBoardState` opponent hand/deck
  masking).

Effort estimé : ~3-5h additionnels post-Phase 0.

## Backlog futur — SOLO ↔ PvP normal parity test

Une fois les 2 endpoints disponibles, un 3ème test compare directement
SOLO ↔ PvP normal sur le même replay. Détecte les divergences imputables
au mode (omniscient vs per-player filter, slot routing, etc.). Effort :
~1h (les helpers existent déjà après les 2 premiers tests).

## Décisions ouvertes

- **Strip ou compare `SELECT_*` events** : décider après 1er run.
- **Strip ou compare `AnimationStarted/Completed`** : v0 stripper,
  réactiver plus tard.
- **Tolérer un certain nombre de différences "acceptées"** via une
  whitelist ? Permet de ne pas bloquer les autres fixtures sur un
  finding particulier. Recommandation : NE PAS faire au début — les
  failures sont valuable info.

## Liens

- Chantier parent : [anim-pipeline-v4-replay-unification-2026-06-05.md](anim-pipeline-v4-replay-unification-2026-06-05.md).
- CLAUDE.md "EventStream vs AnimationQueue" (palier 0) — documente
  les types d'events qui transitent par `_eventStream`.
- `front/e2e/replay-debug-driver.ts` — pattern de driver à réutiliser
  pour la capture côté replay.
- Doctrine "Replay-as-max-rate-PvP" (CLAUDE.md) — contexte.

## Effort estimé

| Étape | Durée |
|---|---|
| Helper `captureEventStream` + `__skytrixDebug.captureEventStream()` | 30min |
| Helper `normalizeStream` + types | 1h |
| Setup fixtures (5-6 replays) | 1-2h |
| Pattern `runPvpAndCaptureStream` (avec tape player client) | 1-2h |
| Pattern `runReplayAndCaptureStream` | 30min |
| Tests + debug 1er run + documenter les failures | 1-2h |
| **Total** | **4-6h** |
