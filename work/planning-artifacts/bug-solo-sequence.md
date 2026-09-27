---
title: Bug SOLO — caractérisation reproductible
status: ready (test de victoire pour chantier pipeline)
source_memory: project_pvp_solo_chain_state_hygiene_2026_05_23
context_doc: duel-session-chantier.md (§1 reformulation lignes 70-73 : "rendu impossible par construction")
date: 2026-05-25
---

# Bug SOLO — caractérisation reproductible

Le doc cadrage affirme que la nouvelle architecture "rend le bug SOLO impossible par construction". Ce document caractérise le bug actuel avec une séquence WS reproductible + l'état attendu vs observé. Il sert de **test de victoire** : la cible est concluante ssi rejouer cette séquence avec la nouvelle pipeline donne l'état attendu.

---

## §1 Manifestation observable

Deux symptômes ont été observés en SOLO PvP avec chain + `switchPlayer` (logs 2026-05-23) :

- **Symptôme A** : `Lock safety timeout for HAND-0/GY-0 after 5000ms` (`duelAssert` côté `RenderedBoardStateService`)
- **Symptôme B** : `[POLL-DROP REGRESSION] chain stuck after finalize-during-resolving for 10000ms`

Les deux ont vraisemblablement la même cause racine : **un changement d'état (switchPlayer) pendant qu'une chain est active produit un état désynchronisé** entre l'orchestrator et le `DuelEventProcessor` actif.

---

## §2 Séquence WS reproductible (canonique)

Le scénario minimal qui déclenche le bug. À rejouer en SOLO PvP avec une carte qui chain (D/D ou similaire).

```
T0   SETUP                       SOLO PvP, perspective P0
                                 connexion `conn0` active
                                 `processor0` lié à conn0

T1   MSG_NEW_TURN(P0)             P0 main phase 1
T2   USER_ACTION                  P0 active une carte qui peut être chained
T3   MSG_CHAINING(player=0, chain-1)
                                 processor0: phase idle → building
                                 activeChainLinks = [link-1]

T4   USER_ACTION                  L'utilisateur clique "switchPlayer"
                                 ⚠️  C'est ici que le bug naît

T5   switchPlayer()               Front bascule perspective P0 → P1
                                 _activeConnection: conn0 → conn1
                                 processor "actif" lu par l'orchestrator: processor0 → processor1
                                 processor1.activeChainLinks = []   ← état P1 jamais alimenté en chain-1
                                 processor0.activeChainLinks = [link-1]   ← préservé mais orphelin

T6   MSG_CHAIN_SOLVING(chain-1)   Émis par OCGCore (chain-1 démarre sa résolution)
                                 Routé vers _activeConnection = conn1
                                 processor1 reçoit l'event
                                 processor1.applyChainSolving(1) WARN "chainIndex 1 not in active links []"
                                 phase passe building → resolving (mais activeChainLinks reste vide)

T7   MSG_MOVE(card → GY, player=0)
                                 BOARD_CHANGING event pendant chainPhase=resolving
                                 → bufferIfResolving (mais avec un processor désynchronisé)
                                 MoveAnimationRouter prend lockZone('HAND-0') + lockZone('GY-0')

T8   queue drain                  finalize-during-resolving
                                 commitUnlocked appelé mais locks HAND-0/GY-0 toujours ref-counted
                                 (le handler MSG_MOVE n'a jamais resolved sa Promise)
                                 armPollDropWatchdog()

T9   +5s                          duelAssert "Lock safety timeout for GY-0"
                                  puis "Lock safety timeout for HAND-0"
                                 ← SYMPTÔME A

T10  +10s                         pollDropWatchdog fire
                                 [POLL-DROP REGRESSION] chain stuck after finalize-during-resolving
                                 ← SYMPTÔME B
```

---

## §3 État attendu (ce qui devrait se passer)

Plusieurs lectures possibles. Listées de la plus stricte à la plus laxiste :

### Lecture stricte — "le switch ne devrait pas être possible pendant une chain"

T4 (USER_ACTION switchPlayer pendant chain active) est interdit. L'UI désactive le bouton tant que `chainPhase !== 'idle'`. Aucun changement d'état tant que la chain ne s'est pas résolue.

**Implication architecture** : convention applicative simple. Pas d'impact pipeline.

### Lecture intermédiaire — "le switch est queué jusqu'à `MSG_CHAIN_END`"

T4 mémorise l'intention de switch. Le switch effectif (T5 conceptuel) ne s'exécute qu'après réception de `MSG_CHAIN_END` (qui termine chain-1).

**Implication architecture** : le composant SOLO PvP wrappe `switchPlayer()` dans une queue qui consomme à chaque `ChainEnded` (cf. §3.8 boundaries du cadrage).

### Lecture laxiste — "le switch s'exécute immédiatement, mais l'état chain est transféré"

T5 inclut un transfert : `processor1.activeChainLinks = processor0.activeChainLinks`. Le `_animatedBuffer`, les locks acquis, les pending DeferredEffect sont également transférés. Après T5, processor1 est dans le même état que processor0 était avant.

**Implication architecture** : c'est exactement ce que le doc cadrage promet via §3.5 (scope `PERSPECTIVE_LIFETIME` invalidé par `PerspectiveSwitched`, mais chain state survit en `CONNECTION_LIFETIME`). Le switch ne reset que les projections qui dépendent strictement de la perspective.

---

## §4 Pourquoi la nouvelle architecture l'élimine (à démontrer)

Le doc cadrage propose : **un seul `DuelEventProcessor` par duel**, pas un par connection. La perspective devient une couche de projection au-dessus du processor (cf. §1 reformulation : *"Le switch SOLO ne modifie pas le pipeline — il modifie la valeur courante de la perspective"*).

Dans la nouvelle architecture, T5 se réduit à :

```
T5'  switchPlayer()               currentPerspective: 0 → 1
                                  processor (unique) : INCHANGÉ
                                  activeChainLinks: INCHANGÉ
                                  locks: INCHANGÉS
                                  buffer: INCHANGÉ
```

Les T6/T7/T8/T9/T10 deviennent identiques au mode PvP normal — le pipeline ne sait pas qu'un switch a eu lieu. Le rendu visuel flip via le transform CSS du container (cf. POC projection), mais le processor continue son travail.

**Condition nécessaire** : il faut effectivement que les classes d'état `CONNECTION_LIFETIME` (chain links, phase) survivent à `PerspectiveSwitched`. Le §3.5 du cadrage le déclare ; le mécanisme d'enforcement (cf. R6 réserve "ADV-9 → BaseProjection abstrait") doit le garantir mécaniquement.

---

## §5 Test de victoire

Le bug SOLO est éliminé par la nouvelle pipeline ssi :

1. La séquence WS T1-T10 ci-dessus, rejouée en SOLO PvP avec la nouvelle pipeline, ne déclenche **aucun** des symptômes A et B.
2. L'état observable post-T5 (rendered board, chain badges, hand cards) reflète **l'état chain-1 toujours active** côté processor, vu sous la perspective P1.
3. T6 `MSG_CHAIN_SOLVING` est traité correctement (pas de WARN `chainIndex N not in active links []`).
4. T7-T8 (`MSG_MOVE` + queue drain) animent correctement la carte vers GY sous la perspective P1.
5. Aucun `pollDropWatchdog` ne fire.
6. Le `chainPhase` finit par `idle` quand `MSG_CHAIN_END` arrive (T?).

**Test automatisable** : harness Playwright SOLO PvP avec une carte D/D ou équivalent. Force chain, force switch mid-chain, assert l'absence des 2 symptômes + l'état correct du rendered board.

---

## §6 Risques voisins à surveiller post-fix

Même si la nouvelle pipeline élimine ce bug spécifique, des bugs **différents dans la cause, identiques dans le symptôme** restent possibles (cf. Pre-mortem PM-H) :

- Switch interrompt un `DeferredEffect` en cours d'attente → orphelin si `EffectAbandoned` n'est pas émis (cf. R6 réserve EC-20).
- Switch pendant un `AnimationStarted` non-encore-`Completed` → un lock dst persisté (cf. R6 réserve EC-17).
- Switch pendant le replay d'un buffer (`BufferReplayBuilder`) → batch interrompu, `session HAND locks` non-libérés.

Ces cas doivent être couverts par le `BaseProjection.applyReset(PERSPECTIVE_LIFETIME)` (§3.5) et par les invariants de boundary (§3.8). Si le `PerspectiveSwitched` event invalide uniquement les projections de perspective, **les locks et les deferred effects ne doivent pas y être attachés**.

---

## §7 Capitalisation pour le cadrage

À intégrer dans `duel-session-chantier.md` :

- **§1 reformulation** : remplacer *"rendu impossible par construction"* par une référence à ce doc + ajouter *"cf. bug-solo-sequence.md pour la séquence reproductible et le mécanisme d'élimination"*.
- **§3.5** : préciser que `activeChainLinks`, `chainPhase`, `locks`, `pendingDeferredEffects` sont **tous** en `CONNECTION_LIFETIME` (pas `PERSPECTIVE_LIFETIME`).
- **§3.8** : la lecture intermédiaire (§3 de ce doc) — switch queué jusqu'à `ChainEnded` — pourrait être l'option par défaut si la lecture laxiste s'avère trop coûteuse à mettre en œuvre.
