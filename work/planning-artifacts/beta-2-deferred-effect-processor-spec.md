---
title: β.2 — DeferredEffectProcessor (spec d'implémentation)
status: ready (pour démarrer le code)
parent_chantier: duel-session-chantier.md
parent_plan: duel-session-chantier-implementation-plan.md
references:
  - duel-session-chantier.md §3.7 (mécanisme ε3)
  - duel-session-chantier.md §3.7bis (tests obligatoires)
  - deferred-effects-catalogue.md (table 11 règles)
  - bug-cost-before-overlay-sequence.md (test de victoire)
  - cost-before-overlay-pitfalls-2026-05-25.md (antipatterns)
  - CLAUDE.md "BoundaryProcessor (β.1, 2026-05-26)"
  - CLAUDE.md "Pipeline Signal Tagging Convention (α.1)"
  - CLAUDE.md "Projection Infrastructure (α.2 + α.4a)"
date: 2026-05-26
author: Winston (architect) + Axel (validation)
---

# β.2 — DeferredEffectProcessor — spec d'implémentation

## §0 Pourquoi ce spec existe

4 tentatives de fix `cost-before-overlay` ont échoué en mai 2026 ([[cost-before-overlay-failed-2026-05-25]]). Chaque tentative essayait de patcher le timing du commit `pendingChainEntry` ad-hoc dans `DuelEventProcessor`. La leçon : **le mécanisme `pendingChainEntry` lui-même ne peut pas porter cette logique** — il y a trop de consommateurs entrelacés (5 fichiers, 5 effects côté overlay) et trop de race conditions (SOLO switch, replay seek, burst SOLVING, animations parallèles).

ε3 résout le problème **structurellement** : le timing n'est plus un état mutable du processor, c'est une **paire d'événements `DeferredEffect`/`EffectReady` sur le flux**. Les projections lisent l'EventReady, jamais le mécanisme sous-jacent. Pas de commit timing à orchestrer = pas de bug de commit timing possible.

Ce spec produit l'API + la mécanique + les invariants + le plan d'exécution. Implémenté sans dévier, il livre le test de victoire `bug-cost-before-overlay-sequence.md` et les 10 autres cas du catalogue.

---

## §1 API publique du DeferredEffectProcessor

### 1.1 Localisation

- Fichier : `front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts`
- Spec : `front/src/app/pages/pvp/duel-page/deferred-effect-processor.spec.ts`
- Classe : `DeferredEffectProcessor`
- Type d'instanciation : **plain class** (PAS `@Injectable`), instanciée privément par `DuelEventProcessor` — comme `BoundaryProcessor` (β.1).

### 1.2 Constructeur

```typescript
class DeferredEffectProcessor {
  constructor(
    private readonly emit: (event: DeferredFluxEvent) => void,
    private readonly getLogger: () => DuelLogger | undefined = () => undefined,
    private readonly clock: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout },
  ) {}
}
```

- `emit` — sink commun à `DeferredEffect`, `EffectReady`, `EffectAbandoned`. Idem contrat `BoundaryProcessor.emit`.
- `getLogger` — closure lazy (cf. BP). Sert pour `logger.warn` sur collisions de noms en prod.
- `clock` — injection optionnelle pour les specs (fake timer). Defaults au global `setTimeout`/`clearTimeout`.

### 1.3 Méthodes publiques

```typescript
class DeferredEffectProcessor implements ResetTarget {
  readonly scope: ScopeCategory = 'CONNECTION_LIFETIME';

  /**
   * Observe a flux event in arrival order. Two responsibilities:
   *   (a) Match the event against active deferreds' `awaitingPredicate`.
   *       Each match emits `EffectReady` + clears the deferred + its timer.
   *   (b) Match the event against the rule table. Each match opens a new
   *       deferred (emits `DeferredEffect`, arms the timer).
   * Strict ordering: (a) BEFORE (b) so a single event can both fulfill
   * one deferred AND trigger another.
   */
  observe(event: FluxEvent): void;

  /**
   * α.4b `ResetTarget` entry. Drops all active deferreds + clears timers.
   *   - CONNECTION_LIFETIME present → emit `EffectAbandoned(reason='checkpoint')`
   *     for each active, then silent clear. Caller is `STATE_SYNC` or
   *     `RematchStarted`.
   *   - PERSPECTIVE_LIFETIME alone → no-op (deferreds survive switch
   *     per §3.7; scope hierarchy means PERSPECTIVE-only never reaches
   *     this target).
   */
  applyReset(scopes: ReadonlySet<ScopeCategory>, _payload?: CheckpointPayload): void;

  /**
   * Silent reset — drops state + clears timers WITHOUT emitting any
   * `EffectAbandoned`. Called by `DuelEventProcessor.reset()` on hard
   * teardown (duel destroy / fresh start). Mirror of
   * `BoundaryProcessor.silentReset()`.
   */
  silentReset(): void;

  /** Test-only: count of currently active deferreds. */
  activeCount(): number;
}
```

### 1.4 Types — les événements émis sur le flux

Nouveau fichier `front/src/app/pages/pvp/types/deferred-effect.types.ts` :

```typescript
export interface DeferredEffectEvent {
  kind: 'deferred';
  type: 'DeferredEffect';
  name: string;                              // ex: 'overlay-show', 'banish-seq-2'
  triggerRef: number;                        // monotonic counter (Z1)
  awaitingPredicate: AwaitingPredicate;
}

export interface EffectReadyEvent {
  kind: 'deferred';
  type: 'EffectReady';
  name: string;
  triggerRef: number;
}

export interface EffectAbandonedEvent {
  kind: 'deferred';
  type: 'EffectAbandoned';
  name: string;
  triggerRef: number;
  reason: 'timeout' | 'checkpoint';
}

export type DeferredFluxEvent =
  | DeferredEffectEvent
  | EffectReadyEvent
  | EffectAbandonedEvent;

/**
 * Z2 — literal matcher. Each key/value pair is compared with strict
 * equality against the candidate event. `kind`, `type`, and the message
 * fields the catalogue rules need (player, cardCode, location,
 * destination, ref) are the only authorised keys.
 *
 * NOT a closure. NOT a JSONPath. NOT a regex. If a future rule needs
 * more, that rule does not belong to ε3 — it belongs to a richer
 * processor (or to a projection's own derivation logic).
 */
export interface AwaitingPredicate {
  kind?: 'boundary' | 'deferred';            // narrows the StreamEvent variant
  type?: string;                             // 'MSG_MOVE', 'AnimationCompleted', 'ChainEnded', ...
  ref?: number;                              // for matching by triggerRef of another event
  player?: number;
  cardCode?: number;
  location?: number;                         // LOCATION enum value
  destination?: number;                      // ex: LOCATION.GRAVE for cost-to-grave
  chainId?: number;                          // for matching ChainStarted/ChainEnded
}
```

`isDeferredFluxEvent(e: unknown): e is DeferredFluxEvent` — guard, comme `isBoundaryEvent`.

### 1.5 Extension de StreamEvent

`front/src/app/pages/pvp/types/game-event.types.ts` :

```typescript
export type StreamEvent =
  | GameEvent
  | ChainNegatedMsg
  | WinMsg
  | SelectCardMsg
  | BoundaryEvent          // β.1
  | DeferredFluxEvent      // β.2
  | InternalTransportEvent; // β.2 — Z3, absorbed from α.3 sink
```

L'ajout de `InternalTransportEvent` (qui était sur un sink séparé α.3) clôt le finding code-review W1.

`JournalEvent` (alias dans `duel-game-log.service.ts`) devient `Exclude<StreamEvent, BoundaryEvent | DeferredFluxEvent | InternalTransportEvent>` — le builder filtre tout ce qui n'est pas un MSG_*.

### 1.6 Wiring dans le DuelEventProcessor

Idem pattern β.1 :

```typescript
class DuelEventProcessor {
  private readonly boundary = new BoundaryProcessor(
    e => this.onEvent?.(e),
    () => this.logger,
  );
  // NEW β.2 — same emit sink, same lazy logger
  private readonly deferred = new DeferredEffectProcessor(
    e => this.onEvent?.(e),
    () => this.logger,
  );

  private _processMessageInner(msg: ServerMessage): void {
    this.boundary.observeMessage(msg);
    // The processor still owns chain state mutation; the deferred
    // processor observes the event AFTER boundary fires so a single
    // MSG_CHAINING produces, in order on the stream:
    //   ChainStarted(N) → MSG_CHAINING → DeferredEffect('overlay-show', ...)
    //                                    (only if rule matches)
    switch (msg.type) { /* ... existing cases unchanged ... */ }
    // After the in-queue tap inside processEvent has pushed the event
    // to the stream, the deferred processor's `observe` is fed too —
    // but via the orchestrator's tap site (cf. §1.7 Wiring orchestrator).
  }
}
```

Note importante : `deferred.observe()` est appelé **dans le tap de l'orchestrator** (le site §1.7 ci-dessous), PAS depuis `_processMessageInner` du processor. Pourquoi : les `AnimationStarted/Completed` ne transitent pas par le DEP ; ils naissent dans le QueueRunner. Pour que ε3 voie *tous* les events du flux dans le bon ordre, le seul point d'observation correct est le sink où **tout** converge — l'orchestrator's `_eventStream`.

### 1.7 Wiring orchestrator

`animation-orchestrator.service.ts` — le service possède déjà `_eventStream: signal<StreamEvent[]>` et un `notifyOutOfBandEvent(event)`. On ajoute un point unique d'observation post-push :

```typescript
private pushToStream(event: StreamEvent): void {
  this._eventStream.update(s => [...s, event]);
  this.deferredProcessor.observe(event);
}
```

Tous les 4 push-sites existants (cf. CLAUDE.md "EventStream vs AnimationQueue" : in-queue tap, MSG_CHAIN_NEGATED, SELECT_CARD, DUEL_END MSG_WIN) + le nouveau β.1 boundary appellent `pushToStream` au lieu de muter `_eventStream` directement.

Pour les `AnimationStarted/Completed` (Z3), le QueueRunner émet via son `onInternalEvent` sink — wiré côté orchestrator pour appeler `pushToStream` aussi. C'est la convergence promise.

### 1.8 Le DeferredEffectProcessor implémente ResetTarget

Auto-registration au constructor (idem α.4b managers). Mais : le DEP est une plain class, pas `@Injectable`. Solution : le DEP **ne s'auto-register pas** ; c'est l'orchestrator qui le fait, après construction du DEP, dans son propre constructeur :

```typescript
constructor() {
  // ... existing
  this.scopeDispatcher?.register(this.deferredProcessor);
}
```

Lint baseline : `deferred-effect-processor.ts` doit utiliser `implements ResetTarget` ; les signaux qu'il contient doivent être tagged via la classe (option c lint rule).

---

## §2 Mécanique ε3 strict-pass

### 2.1 État interne

```typescript
class DeferredEffectProcessor {
  /** scope: CONNECTION_LIFETIME (declared). */
  private readonly _active = new Map<string, ActiveDeferred>();
  /** Monotonic counter — Z1. Increments on every `observe()` call. */
  private _nextRef = 0;
}

interface ActiveDeferred {
  name: string;
  triggerRef: number;
  awaitingPredicate: AwaitingPredicate;
  timerId: ReturnType<typeof setTimeout>;
  createdAtRef: number; // for FIFO if needed in debugging
}
```

Index `_active` par `name` (string). Lookup matching = O(N) sur les actifs, N ≤ 11 ≤ ε3 catalogue → négligeable.

### 2.2 Pseudo-code `observe(event)`

```typescript
observe(event: FluxEvent): void {
  const ref = this._nextRef++;

  // (a) Match active deferreds — emit EffectReady, clear them.
  // Iterate over a copy to allow safe deletion mid-iteration.
  for (const [name, deferred] of [...this._active]) {
    if (this.matches(event, deferred.awaitingPredicate, ref)) {
      this.clock.clearTimeout(deferred.timerId);
      this._active.delete(name);
      this.emit({
        kind: 'deferred', type: 'EffectReady',
        name, triggerRef: deferred.triggerRef,
      });
      // Continue iterating — a single event can fulfill multiple
      // deferreds (rare but legitimate: two rules awaiting the same
      // `AnimationCompleted(ref=X)`).
    }
  }

  // (b) Match rule table — open new deferreds.
  for (const rule of RULES) {
    if (this.matchesRule(event, rule)) {
      this.openDeferred(rule, ref, event);
    }
  }
}

private openDeferred(rule: Rule, triggerRef: number, event: FluxEvent): void {
  const name = rule.deriveName(event, triggerRef);
  if (this._active.has(name)) {
    // Z6 — collisions are an invariant violation. Throw in dev, warn in
    // prod + abandon the existing one. The new deferred replaces it.
    duelAssert(false, 'DeferredEffect:collision',
      `name "${name}" already active (existing triggerRef=${this._active.get(name)!.triggerRef})`);
    this.getLogger()?.warn('[DEFERRED] collision on name "%s" — abandoning previous', name);
    const old = this._active.get(name)!;
    this.clock.clearTimeout(old.timerId);
    this.emit({
      kind: 'deferred', type: 'EffectAbandoned',
      name, triggerRef: old.triggerRef, reason: 'timeout',
    });
    this._active.delete(name);
  }
  const predicate = rule.derivePredicate(event, triggerRef);
  const timerId = this.clock.setTimeout(
    () => this.timeoutAbandon(name),
    DEFERRED_TIMEOUT_MS,
  );
  this._active.set(name, { name, triggerRef, awaitingPredicate: predicate, timerId, createdAtRef: triggerRef });
  this.emit({
    kind: 'deferred', type: 'DeferredEffect',
    name, triggerRef, awaitingPredicate: predicate,
  });
}

private timeoutAbandon(name: string): void {
  const deferred = this._active.get(name);
  if (!deferred) return; // race-safe: matched between timer arm and fire
  this._active.delete(name);
  this.emit({
    kind: 'deferred', type: 'EffectAbandoned',
    name, triggerRef: deferred.triggerRef, reason: 'timeout',
  });
  this.getLogger()?.warn('[DEFERRED] "%s" timed out after %dms', name, DEFERRED_TIMEOUT_MS);
}

private matches(event: FluxEvent, p: AwaitingPredicate, currentRef: number): boolean {
  // Z2 — literal equality on each defined key. Undefined keys in p are
  // wildcards (don't constrain).
  if (p.kind !== undefined && (event as { kind?: string }).kind !== p.kind) return false;
  if (p.type !== undefined && event.type !== p.type) return false;
  if (p.ref !== undefined && (event as { ref?: number }).ref !== p.ref) return false;
  // ... etc for player, cardCode, location, destination, chainId
  return true;
}
```

### 2.3 Constantes

```typescript
// animation-constants.ts
export const DEFERRED_TIMEOUT_MS = 5000;  // Z4 — 5s generous, pre-measurement
```

### 2.4 Invariants

| Invariant | Comment c'est garanti |
|---|---|
| Un event peut fulfill 0..N deferreds | Boucle (a) sur copie du Map |
| Un event peut ouvrir 0..N nouveaux deferreds | Boucle (b) sur RULES |
| (a) toujours AVANT (b) | Ordre dans `observe()` |
| `EffectReady` ≤ 1 par DeferredEffect | `_active.delete(name)` immédiat |
| Pas de DeferredEffect pending au-delà de `DEFERRED_TIMEOUT_MS` | Timer obligatoire, clear sur match/abandon |
| Pas de collision de noms en dev | `duelAssert` dans openDeferred |
| Checkpoint = abandon de tous | applyReset(`CONNECTION_LIFETIME`) émet `EffectAbandoned(reason='checkpoint')` |
| PerspectiveSwitched ne reset PAS | scope CONNECTION → dispatcher ne route pas un PERSPECTIVE-only ici |
| Replay seek = silentReset (pas d'`EffectAbandoned`) | Idem β.1 BP : seek wipe le journal via `rebuildUpTo`, pas via le flux |

---

## §3 Table opérationnelle des 11 règles

Chaque règle a la même structure :

```typescript
interface Rule {
  // Identité humaine
  catalogueCase: number;        // #1 à #11
  family: Family;               // pour debug log

  // Trigger detection — `event` est l'event courant qu'`observe` vient de recevoir
  trigger: (event: FluxEvent) => boolean;

  // Génère le nom UNIQUE du deferred (pour Necroface seq, inclut un index)
  deriveName: (event: FluxEvent, triggerRef: number) => string;

  // Génère le matcher déclaratif à poser sur les events suivants
  derivePredicate: (event: FluxEvent, triggerRef: number) => AwaitingPredicate;
}
```

Table des 11 règles (encodée dans `RULES: Rule[]` du fichier `deferred-effect-rules.ts`) :

| # | name (généré) | trigger | derivePredicate | Source |
|---|---|---|---|---|
| 1 | `overlay-show:<chainIdx>` | `MSG_CHAINING` avec `chainPhase == 'building'` ET `link-N≥2` (déterminé par `chainIndex≥1`) | `{ type: 'MSG_MOVE', player: <event.player>, cardCode: <event.cardCode>, destination: LOCATION.GRAVE }` THEN `{ type: 'AnimationCompleted', ref: <ref-of-that-MSG_MOVE> }` ※voir §3.1 | catalogue #1 |
| 2 | `trigger-show:<cardCode>:<ref>` | `MSG_CHAINING` du player local après un `MSG_MOVE` summon récent du même cardCode | `{ type: 'AnimationCompleted', ref: <triggerRef-du-MSG_MOVE> }` | catalogue #2 |
| 3 | `search-reveal:<cardCode>:<ref>` | `MSG_CHAINING` d'un tutor effect (heuristic : trigger qui s'attend à émettre des MSG_MOVE DECK→HAND) | Compound : tous les `MSG_MOVE` deck→hand + le `MSG_CONFIRM_CARDS` matching | catalogue #3 |
| 4 | `flip-summon-trigger:<cardCode>:<ref>` | `MSG_FLIPSUMMONING` | `{ type: 'AnimationCompleted', ref: <triggerRef-de-MSG_FLIPSUMMONED> }` | catalogue #4 |
| 5 | `banish-seq:<ref>:<n>` | `MSG_MOVE` (GY → banish) avec sequence batch (heuristic : N MSG_MOVE consécutifs du même chainIndex) | `{ type: 'AnimationCompleted', ref: <ref-du-MSG_MOVE-précédent> }` | catalogue #5 |
| 6 | `attack-impact:<ref>` | `MSG_ATTACK` | `{ type: 'AnimationCompleted', ref: <triggerRef-de-MSG_DAMAGE-ou-DAMAGE_STEP_END> }` | catalogue #6 |
| 7 | `equip-stat:<cardCode>:<ref>` | `MSG_MOVE` (HAND/DECK → SZONE) avec `cardType == EQUIP` | `{ type: 'AnimationCompleted', ref: <ref-du-travel> }` ET `{ type: 'MSG_EQUIP' }` | catalogue #7 |
| 8 | `xyz-attach:<chainIdx>` | `MSG_MOVE` (matériau → OVERLAY) | Compound : tous les MSG_MOVE pre-overlay matching le même chainIdx + le `MSG_MOVE` XYZ pose finale | catalogue #8 |
| 9 | `lp-cost:<chainIdx>` | `MSG_CHAINING` ET la chain entry suivante contient un `MSG_PAY_LPCOST` | `{ type: 'AnimationCompleted', ref: <ref-du-MSG_PAY_LPCOST> }` | catalogue #9 |
| 10 | `counter-pulse:<player>:<location>:<seq>` | `MSG_ADD_COUNTER` ou `MSG_REMOVE_COUNTER` | `{ type: 'AnimationCompleted', ref: <ref-du-counter-event> }` | catalogue #10 |
| 11 | `pile-float-cleanup:<chainIdx>` | `MSG_CHAIN_SOLVING` ET `targetIndicator.activeFloats > 0` (mais cette info n'est pas dans le flux — voir §3.2 dette) | `{ type: 'AnimationCompleted', ref: <ref-du-fade-out-float> }` | catalogue #11 |

### 3.1 Note sur le compound predicate (#1, #3, #7, #8)

Certaines règles ont **2 phases** : d'abord on attend un MSG_MOVE, puis on attend l'`AnimationCompleted` du `triggerRef` de ce MSG_MOVE. Le matcher actuel ne supporte qu'un seul predicate.

**Solution** : le rule ne pose pas un compound. Au lieu de cela, **la règle elle-même se redéclenche** :
- Pose initial : `{ type: 'MSG_MOVE', destination: GRAVE, player, cardCode }`
- Quand observe voit le MSG_MOVE matchant → EffectReady('overlay-show-move-seen', triggerRef). MAIS on ne veut pas EffectReady ici — on veut continuer à attendre l'AnimationCompleted.

Approche retenue : le DEP supporte **chained deferreds**. Quand un EffectReady est sur le point d'être émis pour une rule qui déclare un `chainTo`, à la place d'émettre EffectReady on **réouvre** un nouveau deferred avec le predicate `chainTo`. Le rule:
```typescript
interface Rule {
  // ...
  chainTo?: (event: FluxEvent, deferred: ActiveDeferred) => AwaitingPredicate | null;
}
```
- Si `chainTo` retourne null → emit EffectReady normalement.
- Si `chainTo` retourne un nouveau predicate → reopen le deferred avec ce nouveau predicate + reset timer (nouveau 5s).

Le nom du deferred reste le même au travers du chain, donc une seule entrée dans `_active` à la fois. Les projections lisent `EffectReady('overlay-show:N')` une seule fois à la fin de la chain.

### 3.2 Dette assumée — cas #11 et accès au DOM state

Le cas #11 (`pile-target-float-cleanup`) a besoin de savoir *"y a-t-il un float actif sur GY/Banished/ExtraDeck ?"* — cette info est dans `TargetIndicatorManager`, pas dans le flux WS.

**Choix assumé** : on retarde l'implémentation du cas #11 à β.2c. Le DEP β.2a + β.2b couvre les cas 1-10 ; le #11 nécessite que le `TargetIndicatorManager` émette lui aussi sur le flux (un nouvel event `TargetFloatCreated/Destroyed`), ce qui sort du scope ε3.

---

## §4 Tests d'invariants obligatoires

Au-delà des 4 tests "de victoire" du §3.7bis cadrage (déjà spécifiés), la spec impose **5 tests d'invariants** dans `deferred-effect-processor.spec.ts` :

### T-I1 — Collision de noms
- 2 triggers de même rule, sans match du premier predicate entre les deux.
- Assert : duelAssert throws en dev ; le second deferred remplace le premier ; le premier émet `EffectAbandoned(reason='timeout')`.

### T-I2 — Timeout = EffectAbandoned
- Inject fake timer. Trigger un deferred. Avancer le temps de `DEFERRED_TIMEOUT_MS + 1`.
- Assert : `EffectAbandoned(reason='timeout')` émis ; deferred retiré de `_active`.

### T-I3 — Checkpoint = EffectAbandoned
- Trigger 3 deferreds simultanés. Dispatch `{CONNECTION_LIFETIME}` via le dispatcher.
- Assert : 3 `EffectAbandoned(reason='checkpoint')` émis dans l'ordre d'insertion ; `_active` vide ; timers tous clear (vérifier via fake timer pas de timeout futur).

### T-I4 — No-leak ResetTarget
- Instancier le DEP, le register, lui faire émettre `EffectAbandoned`, puis vérifier que le dispatcher ne tient pas de référence supplémentaire après dispatch (idem pattern test α.4b).

### T-I5 — silentReset n'émet RIEN
- Trigger 2 deferreds, observer le sink. Appeler silentReset.
- Assert : sink n'a reçu aucun `EffectAbandoned` ; `_active` vide ; timers clear.

### T-I6 — PerspectiveSwitched ne touche pas le DEP
- Trigger 1 deferred. Dispatch `{PERSPECTIVE_LIFETIME}` via dispatcher.
- Assert : deferred toujours actif ; aucun EffectAbandoned émis. (Vérifie que le scope CONNECTION fait son boulot.)

### T-I7 — Order garantie : (a) match BEFORE (b) open
- Construire une rule artificielle dont le trigger ET le predicate matchent le même type d'event.
- Inject le predicate, puis injecter l'event qui matche les deux.
- Assert : `EffectReady` émis AVANT `DeferredEffect` du même cycle observe.

### T-I8 — Chained deferred (compound predicate cas #1)
- Suivre la séquence T0-T13 du `bug-cost-before-overlay-sequence.md`.
- Assert : un seul `DeferredEffect('overlay-show:1')` émis à T5 ; reopen silencieux à T6 ; `EffectReady('overlay-show:1')` émis à T7. Pas deux EffectReady, pas d'abandon entre les deux.

---

## §5 Articulation avec BoundaryProcessor

Le DEP **peut** consommer les BoundaryEvent comme awaitingPredicate (Z5). Concrètement :

- Le predicate `{ kind: 'boundary', type: 'ChainEnded', chainId: 1 }` matche le ChainEnded(chainId=1) émis par le BP.
- Aucune des 11 règles initiales du catalogue ne l'utilise. C'est une extension naturelle pour β.x+.

**Order d'observation** : dans `_processMessageInner`, BP fire FIRST (chain boundaries from `observeMessage`), puis le message lui-même va dans la queue → tap orchestrator → `pushToStream` → DEP voit le BoundaryEvent avant le message lui-même. Le matcher fonctionne par construction.

**Pour les Turn/Phase boundaries** (émis par BP depuis `observeBoardState`), elles partent sur le flux à un moment différent du cycle WS (lors du handler BOARD_STATE). Le DEP les voit aussi via `pushToStream`. Pas de risque d'ordering inversé : les BoundaryEvent partent sur le flux **avant** que les MSG_* suivants du même tour de boucle WS soient observed (BP `observeBoardState` se passe au site du handler, MSG_* en queue de pipeline derrière).

---

## §6 Plan d'exécution — sous-stories

La story originale β.2 estimait 3-4j. Avec la table 11 règles + le chained predicate + les 8 tests d'invariants + la wiring orchestrator, c'est sous-estimé. Découpage en **4 sous-stories**, chacune commitable indépendamment et testable :

### β.2a — Infrastructure (~1-1.5j)
Livrable :
- `deferred-effect.types.ts` (DeferredFluxEvent + AwaitingPredicate + guard)
- `deferred-effect-processor.ts` SQUELETTE (observe + applyReset + silentReset + getLogger pattern + ResetTarget + timer)
- Extension StreamEvent (DeferredFluxEvent + InternalTransportEvent)
- Wiring `pushToStream` dans orchestrator (refactor des 4 push-sites existants)
- Wiring `QueueRunner.onInternalEvent` → `pushToStream` (absorb α.3 sink dans le flux, ferme W1)
- Tests T-I2 (timeout), T-I3 (checkpoint), T-I4 (no-leak), T-I5 (silentReset), T-I6 (perspective), T-I7 (order)
- MAJ CLAUDE.md (nouvelle section "DeferredEffectProcessor")

**Aucune règle métier dans β.2a** — le DEP fonctionne mais RULES est `[]`. La machine est testable, sans aucun cas YGO. Garde-fou : tsc + lint + tests verts.

### β.2b — Table de règles 1-10 (~2j)
Livrable :
- `deferred-effect-rules.ts` : 10 règles (catalogue #1 à #10, skip #11)
- Support `chainTo` pour compound predicates (cas #1, #3, #7, #8)
- Règle #1 (overlay-show) avec naming "un par chain entière" (DP-5) — la rule guard contre la double-ouverture via lookup `_active` AVANT openDeferred.
- Règle #2 (trigger-effect-activation) avec gap=0 (DP-1) — predicate matchant immédiatement le MSG_MOVE summon précédent.
- Règle #3 (search-reveal-sync, DP-2) — matcher MSG_CHAINING + chainTo batch MSG_MOVE deck→hand + MSG_CONFIRM_CARDS. Heuristic large à β.2b, narrowing par cardCode en β.x si besoin.
- Tests T-I1 (collision), T-I8 (chained predicate)
- Tests de victoire §3.7bis #1 (overlay-show + cost — c'est LE test cible)
- Tests §3.7bis #2 (trigger-effect-activation)
- Tests §3.7bis #3 (xyz-overlay-attach)

**Le bug cost-before-overlay est résolu à la fin de β.2b** — mais juste au niveau processor (les projections consommatrices viennent en β.3).

### β.2c — Cas #11 + TargetIndicatorManager wired sur le flux (~0.5-1j)
Livrable :
- Étendre `TargetIndicatorManager` pour émettre `TargetFloatCreated/Destroyed` sur le flux (nouveau StreamEvent type)
- Ajouter règle #11 à RULES
- Test §3.7bis #4 (pile-target-float-cleanup)

### β.2d — Hooks de scénarios de casse (~0.5j)
Livrable :
- Tests intégration des 4 scénarios de casse §3.7bis (SOLO switch, replay seek, burst SOLVING, animations parallèles non-await).
- **Ces tests ne touchent PAS le DEP** — ils vérifient que les projections consommatrices (β.3+) traitent correctement EffectReady/EffectAbandoned dans ces 4 scénarios. β.2d les écrit en mode "harness", pas en mode "fix".
- Documenter chaque test comme attendu PASS dès β.3, FAIL aujourd'hui acceptable.

**Total estimé** : 3.5-5j. Plus que la fourchette 3-4j du plan initial, mais découpé + chaque sous-story livrable et revertable.

---

## §7 Decision-points laissés à Axel

### DP-1 — Heuristic du trigger #2 "summon récent" ✅ TRANCHÉ 2026-05-26
**Décision** : gap = 0. Le MSG_CHAINING doit suivre IMMEDIATEMENT le MSG_MOVE summon dans le flux. Si un event intermédiaire se glisse (CONFIRM_CARDS, AnimationStarted, etc.), la rule rate et l'overlay pop tôt (fallback comportement actuel — pas de régression majeure). β.2b ouvrira un follow-up si l'observation e2e montre que gap=0 rate trop souvent.

### DP-2 — Tutor #3 : heuristic du "tutor effect" ✅ TRANCHÉ 2026-05-26
**Décision** : **inclure** la règle #3 dès β.2b (divergence vs reco Winston initiale). Axel veut couvrir le polish Pot of Desires & co dès la première vague. Heuristic à coder : matcher MSG_CHAINING comme trigger ; awaiter le **batch** des MSG_MOVE DECK→HAND **du même chainIndex** + le MSG_CONFIRM_CARDS final. Predicate compound via le mécanisme `chainTo` du §3.1. Si l'heuristic surface des faux positifs en e2e, narrow par cardCode connu (Pot of Desires, Pot of Greed, Foolish Burial Goods, etc.).

### DP-3 — TIMEOUT_MS = 5000ms ✅ TRANCHÉ 2026-05-26
**Décision** : commencer à 5000ms fixe. Si T-I2 ou les e2e fail en SOLO PvP slow-playback, conditionner par `ctx.speedMultiplier()` (5000 * mult). Pas avant.

### DP-4 — Pas de signal `activeNames` exposé ✅ TRANCHÉ 2026-05-26
**Décision** : NON en β.2. Les projections lisent les events `EffectReady`/`EffectAbandoned` du flux, point. Le flux est source unique de vérité. Si une projection a besoin d'inférer le state actif, qu'elle dérive son propre signal depuis `eventStream` via `computed`.

### DP-5 — Granularité de `overlay-show` ✅ TRANCHÉ 2026-05-26
**Décision** : **un par chain entière**. Name = `overlay-show:chain-<chainIndex-de-la-première-link-≥1>`. Pendant une chain longue (4+ CHAINING), un seul deferred actif. La rule #1 vérifie *"y a-t-il déjà un overlay-show actif pour cette chain ?"* avant d'ouvrir un nouveau. Si oui, no-op. L'EffectReady est émis quand TOUS les costs ont vu leur AnimationCompleted (via le mécanisme `chainTo` qui re-pose le predicate sur l'AnimationCompleted suivant tant qu'il reste un cost en attente).

---

**Tous les 5 DP sont tranchés. Aucune ambiguïté résiduelle. β.2a peut démarrer.**

---

## §8 Antipatterns proscrits (capitalisation pitfalls)

Pour mémoire — ces 5 antipatterns sont déjà documentés dans `cost-before-overlay-pitfalls-2026-05-25.md §4`. Recopiés ici pour qu'un futur dev les voie directement dans le spec β.2 :

- ❌ FIFO `_pendingChainEntries[]` (tentative #4 — la catastrophe)
- ❌ Predicate "X en queue d'animation" (tentative #2 — fragile)
- ❌ Overwrite-protect synchrone à la réception WS (tentative #3 — casse le timing relatif)
- ❌ Modification de signature `pendingChainEntry` (casse 5+ consommateurs)
- ❌ Flush bulk à `MSG_CHAIN_END` (overlay voit saut 0 → N)

ε3 évite tous ces antipatterns par construction : pas de mutable state global, pas de FIFO, observation post-facto, le flux est la source unique.

---

## §9 Critère de réussite β.2

À la fin de β.2c, **avant de mettre β.3 en route** :

1. `bug-cost-before-overlay-sequence.md` test de victoire **passe** (T5→overlayVisible false, T7→true).
2. Tests T-I1 à T-I8 verts.
3. Tests §3.7bis #2 (Snake-Eye Ash), #3 (XYZ multi-mat), #4 (pile-float-cleanup) verts.
4. Tsc app + spec clean, lint 0 errors, baseline tests (1429 + nouveaux β.2) verts.
5. CLAUDE.md à jour avec la nouvelle section "DeferredEffectProcessor".
6. **β.2d harness** des 4 scénarios de casse documenté (peu importe le pass/fail à ce stade).

Si l'un de ces critères n'est pas atteint, **ne pas démarrer β.3**. Le DEP doit être bétonné avant que 10 projections en dépendent.

---

## §10 Articulation avec les autres stories

- **Prérequis** : α (toutes les stories) + β.1 (BoundaryProcessor) ✅ livrés.
- **Débloque** : β.3 (projections consommatrices — l'overlay component lit EffectReady, le badge counter aussi, etc.).
- **Pas de dépendance avec** : β.4 (jeter BufferReplayBuilder) — peut être fait en parallèle.

---

_Spec rédigée 2026-05-26 par Winston en pair avec Axel. 6 Z (ambiguïtés) tranchées en pre-write. Le spec est ready pour démarrer β.2a immédiatement._
