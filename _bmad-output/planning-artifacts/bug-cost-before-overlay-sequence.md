---
title: Bug cost-before-overlay — caractérisation reproductible
status: ready (test de victoire pour chantier pipeline)
source_memory: project_cost_before_overlay_failed_2026_05_25
source_pitfalls: _bmad-output/planning-artifacts/cost-before-overlay-pitfalls-2026-05-25.md
context_doc: duel-session-chantier.md §3.7 (mécanisme ε3 DeferredEffect/EffectReady)
date: 2026-05-25
---

# Bug cost-before-overlay — caractérisation reproductible

Le doc cadrage propose ε3 comme résolution structurelle de ce bug (§3.7). L'arbitrage R6 a confirmé que ε3 est structurellement différent des 4 tentatives échouées. Ce document caractérise le bug avec une séquence WS reproductible + état attendu vs observé. Il sert de **test de victoire** : la cible est concluante ssi rejouer cette séquence avec la nouvelle pipeline donne l'état attendu.

---

## §1 Manifestation observable

**Symptôme** : pendant l'activation d'une chain link déclenchée par un hand trap (Ash Blossom, Effect Veiler, Ghost Ogre, etc.), le **chain overlay visuel** (la bannière "première multi-link") apparaît **AVANT** que l'animation du coût (MSG_MOVE du hand trap vers GY) ait fini de se jouer.

**Cas canonique** : opponent activate `Pot of Desires` ; player active `Ash Blossom & Joyous Spring` en discardant Ash de sa main vers GY.

**Bug** : l'overlay pop dès la réception WS de `MSG_CHAIN_SOLVING(chain-2)` (chain Ash résout). L'utilisateur voit la bannière "chain 2/2" alors que la carte Ash est encore mid-travel vers le GY.

**Attendu** : l'overlay doit apparaître **après** l'animation de coût terminée, pour que l'utilisateur perçoive la séquence narrative *"je discard d'abord, puis l'effet résout"*.

---

## §2 Séquence WS reproductible (canonique)

```
T0   SETUP                       PvP normal, perspective fixe
                                 opponent main phase, hand contient `Pot of Desires`
                                 player hand contient `Ash Blossom`

T1   USER_ACTION                  Opponent active `Pot of Desires` (chain-1)
T2   MSG_CHAINING(player=opp, chain-1, cardCode=Pot)
                                 processor: phase idle → building
                                 activeChainLinks = [link-1]
                                 PvpChainOverlayComponent voit chainPhase=building

T3   PROMPT                       Player a la fenêtre pour chain
                                 Cliquer "activate Ash Blossom"

T4   PLAYER_RESPONSE(activate Ash, discard cost)
T5   MSG_CHAINING(player=me, chain-2, cardCode=Ash)
                                 processor: phase still building (multi-link chain)
                                 activeChainLinks = [link-1, link-2]
                                 ⚠️  L'overlay component voit phase=building + 2 links
                                     → trigger l'effect "premier multi-link banner show"
                                     → overlay apparaît IMMÉDIATEMENT

T6   MSG_MOVE(Ash → GY, player=me, cost)
                                 Animation : Ash quitte la main, traverse vers GY
                                 Durée ~600ms (CardTravelEngine)
                                 ⚠️  L'overlay est déjà visible depuis T5
                                     pendant que l'animation joue

T7   queue drain                  Le travel se termine, commit Ash dans GY

T8   MSG_CHAIN_SOLVING(chain-2)   chain Ash résout en premier (LIFO)
T9   MSG_NEGATE                   Effect Pot of Desires nié
T10  MSG_CHAIN_SOLVED(chain-2)
T11  MSG_CHAIN_SOLVING(chain-1)
T12  MSG_CHAIN_SOLVED(chain-1)
T13  MSG_CHAIN_END                processor: phase resolving → idle
```

Le bug est strictement entre T5 et T7 : l'overlay (qui doit signaler la **complétion** de l'activation, pas le **début**) est visible pendant que le coût est encore mid-animation.

---

## §3 État attendu

```
T0-T4   identiques à §2

T5      MSG_CHAINING(chain-2)
        processor : building, activeChainLinks = [link-1, link-2]
        ⚠️  L'overlay reste invisible — il attend la fin du coût

T5'     pipeline détecte la dépendance "overlay-show attend la complétion du MOVE de coût"
        émet DeferredEffect('overlay-show', triggerRef=T5, awaitingRef=T6) sur le flux
        overlayVisible projection : reste false

T6      MSG_MOVE(Ash → GY)
        Animation : Ash quitte la main, traverse vers GY
        pipeline émet AnimationStarted(ref=T6)

T6→T7   ~600ms d'animation

T7      AnimationCompleted(ref=T6)
        ⚠️  pipeline émet EffectReady('overlay-show', triggerRef=T5) sur le flux
            overlayVisible projection lit EffectReady, repasse à true
            → overlay APPARAÎT, le coût est terminé

T8-T13  identiques à §2
```

L'overlay est visible **entre T7 (cost terminé) et la fin de la séquence (T13 ou OverlayHidden ultérieur)**. La narration est : *coût d'abord, puis "voilà la chain qui se forme", puis résolution*.

---

## §4 Pourquoi la nouvelle architecture l'élimine

Le doc cadrage §3.7 propose le mécanisme ε3 :
- `DeferredEffect(name, triggerRef, awaitingRef)` émis quand un trigger déclenche un effet qui doit attendre la complétion d'un autre événement.
- `EffectReady(name, triggerRef)` émis automatiquement quand l'`AnimationCompleted` du `awaitingRef` est vu.
- Les projections lisent **uniquement** `EffectReady`. Elles ne raisonnent jamais sur la dépendance elle-même.

L'arbitrage R6 a confirmé que ce mécanisme est **structurellement différent** des 4 tentatives échouées (toutes basées sur la mutation/timing d'un état `pendingChainEntry`). ε3 supprime l'état mutable et émet 2 événements sur le flux. Pas de commit = pas de "mauvais timing du commit" possible.

**Condition nécessaire** : le processor d'effets différés doit :
1. Reconnaître la séquence T5 (`MSG_CHAINING` quand link-2 est ajoutée à une chain) comme **trigger** d'un `overlay-show` deferred.
2. Identifier T6 (`MSG_MOVE` qui suit immédiatement, avec `player === T5.player` et `card === T5.card`) comme l'`awaitingRef`.
3. Surveiller le flux jusqu'à l'émission d'`AnimationCompleted(ref=T6)` puis émettre `EffectReady('overlay-show', T5)`.

**Cas non-Ash à couvrir par la même règle** :
- Veiler discard cost
- Ghost Ogre discard cost
- Maxx "C" — pas concerné (no cost de discard à la chain)
- Toutes activations avec discard/banish cost en réponse à une chain

---

## §5 Test de victoire

Le bug est éliminé ssi :

1. La séquence T0-T13 de §2, rejouée avec la nouvelle pipeline, produit le timing de §3 :
   - À T5+1ms, `overlayVisible` est `false`.
   - À T7+1ms, `overlayVisible` est `true`.
   - L'utilisateur perçoit visuellement "discard puis overlay".
2. Aucune des 4 régressions des tentatives précédentes ne réapparaît :
   - Pas de contamination cross-chain (activeChainLinks ne sautent pas de 0 à N entre 2 chains)
   - Pas de flush bulk à `MSG_CHAIN_END`
   - Pas de hand-row qui affiche le mauvais nombre de cartes
   - Pas d'overlay qui pop tardivement après `MSG_CHAIN_END`
3. Couvert dans les 4 scénarios de casse identifiés :
   - SOLO PvP switchPlayer mid-chain → cf. bug-solo-sequence.md
   - Replay seek pendant le timing T5-T7 → l'overlay doit apparaître au bon moment dans le replay
   - Burst WS de N `MSG_CHAIN_SOLVING` (chain longue) → chaque overlay show/hide se synchronise sur son cost respectif
   - Animations parallèles non-await (cf. memory `faimena-activate-cost-overlap-2026-05-24`) → les effects ne se chevauchent pas indûment

**Test automatisable** : harness Playwright replay de la séquence canonique. Capturer le DOM state à T5+1ms, T7+1ms, T13+1ms. Assert visibilité overlay attendue.

---

## §6 Pièges à éviter (capitalisation pitfalls)

Pour mémoire — toute spec d'implémentation ε3 doit refuser ces antipatterns (cf. arbitrage R6 + `cost-before-overlay-pitfalls-2026-05-25.md`) :

- ❌ FIFO `_pendingChainEntries[]` sans cleanup
- ❌ Predicat "X en queue" sur l'animation queue (introspection fragile)
- ❌ Overwrite-protect synchrone à la réception WS (casse timing relatif)
- ❌ Modification de signature `pendingChainEntry` (casse 5+ consommateurs)
- ❌ Flush bulk à `MSG_CHAIN_END` (overlay voit saut 0 → N)

ε3 évite tous ces antipatterns par construction — pas de mutable state, pas de FIFO, observation du flux post-facto.

---

## §7 Capitalisation pour le cadrage

À intégrer dans `duel-session-chantier.md` :

- **§3.7** : pointer ce doc comme exemple canonique + ajouter le test de victoire dans §3.7bis "Tests obligatoires".
- **§3.8** : la règle de pairing (T5 = MSG_CHAINING avec link supplémentaire, T6 = MSG_MOVE immédiat avec mêmes player+card) est candidate à être exprimée comme une **frontière** plutôt qu'un deferred ad-hoc — à arbitrer à la rédaction de §3.7/§3.8.
- **§5 (acceptance criteria)** : le test de victoire de §5 ci-dessus devient un critère "done" du chantier — automatisable, mesurable.
