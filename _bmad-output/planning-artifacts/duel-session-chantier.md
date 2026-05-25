---
title: Chantier — Refonte de la pipeline d'animation
status: ready for implementation (2026-05-25, avance sur deadline 2026-06-15)
branch: chore/queue-runner-palier-0 (à renommer le moment venu)
date_started: 2026-05-25
date_ready: 2026-05-25
authors:
  - Axel (lead)
  - Winston (agent BMad, rôle architecte) — pour le brainstorming initial et la revue finale
review_artifacts:
  - duel-session-chantier-critiques.md (3 passes BMad + 8 investigations unitaires)
  - duel-session-chantier-architect-review.md (revue finale, verdict ready avec 10 findings tous appliqués)
  - duel-session-chantier-next-steps.md (plan d'action chemin critique)
  - poc-projection-spec.md (spec POC couche projection)
  - _bmad-output/poc-projection/decision.md (POC exécuté, S3 retenue)
  - bug-solo-sequence.md (test de victoire bug SOLO)
  - bug-cost-before-overlay-sequence.md (test de victoire cost-before-overlay)
  - deferred-effects-catalogue.md (catalogue 11 cas pour calibrer §3.7)
---

# Chantier — Refonte de la pipeline d'animation

> **Statut** : ✅ **ready for implementation** (2026-05-25). Cadrage
> complet, dérisqué par 3 passes BMad + 8 investigations unitaires + POC
> exécuté + revue architecte. Effort chiffré 30-45 j-h en 3 phases
> séquentielles α/β/γ + spike parallèle. Tests de victoire reproductibles
> (`bug-solo-sequence.md`, `bug-cost-before-overlay-sequence.md`).

---

## 1. Le besoin

Je veux un système d'animation **robuste** qui fonctionne dans **trois cas de figure** :

1. **Duel PvP** avec un seul point de vue.
2. **Duel SOLO** avec le point de vue pouvant changer à tout moment.
3. **PvP Replay** avec le point de vue pouvant changer à tout moment et une
   configuration d'événements différente (precompute / seek / sub-event nav).

### Reformulation conceptuelle — dimensions orthogonales

Ces trois cas de figure ne sont **pas trois modes distincts**. Ce sont des
combinaisons de **trois dimensions orthogonales** :

- **Source du flux d'événements** : `LiveSource` (PvP filtré côté serveur,
  une perspective fixe par socket) ou `OmniscientSource` (SOLO + Replay,
  toutes les données visibles, perspective librement projetable).
- **Mode d'interaction** : `Interactive` (PvP + SOLO, prompts actifs, peut
  répondre au serveur) ou `ReadOnly` (Replay, aucune réponse possible).
- **Transport** : `Streaming` (les événements arrivent un à un, le timing
  est dicté par le serveur et par les interactions joueur) ou
  `Precomputed` (les événements sont disponibles d'un coup, le timing est
  dicté par une transport bar locale — play / pause / seek / vitesse).

| Combinaison utilisée aujourd'hui | Source | Interaction | Transport |
|---|---|---|---|
| **PvP normal**     | LiveSource       | Interactive | Streaming   |
| **SOLO PvP**       | OmniscientSource | Interactive | Streaming   |
| **Replay**         | OmniscientSource | ReadOnly    | Precomputed |

Les **autres combinaisons sont latentes** — elles n'existent pas
aujourd'hui mais le modèle les permet sans coût supplémentaire :

- *LiveSource + ReadOnly + Streaming* = mode **spectateur live**
  (joueur regarde une partie en cours sans pouvoir agir).
- *OmniscientSource + ReadOnly + Streaming* = **replay synchronisé**
  entre plusieurs spectateurs (le serveur drive la transport bar).

Le **pipeline d'animation lui-même est unique et neutre**. Il consomme un
flux d'événements et produit un état logique + un état rendu. La
**perspective de rendu** (qui voit le plateau de quel côté, avec quelles
couleurs, quelles rotations de cartes) est une **couche de projection**
au-dessus du pipeline, pas une caractéristique du flux. Le switch SOLO ne
modifie pas le pipeline — il modifie la valeur courante de la perspective.

Le **transport** est une couche **en amont** du pipeline. Il décide
*quand* le prochain événement entre dans la file d'animation. Le pipeline
ne sait pas s'il est alimenté par un WS streaming ou par une transport
bar — il consomme ce qu'on lui donne quand on le lui donne. La
**file d'animation est le tampon** entre transport et pipeline ; cette
séparation existe déjà conceptuellement dans le code actuel, le chantier
la rendra explicite et industrielle.

**Asymétrie lookahead** : le mode `Precomputed` permet de lire en avant
sur le flux (les événements futurs sont déjà chargés), le mode
`Streaming` ne le permet pas. La majorité des projections sont
*strict-pass* — elles consomment un événement à la fois, sans regarder
en avant. Quelques projections opt-in au lookahead (cf. §3.7
DeferredEffect resolution en mode Precomputed peut court-circuiter
l'attente d'AnimationCompleted via le boardStateAfter du serveur ;
l'audit R8 a montré que c'est marginal — 2 sites de lecture, fallback
strict-pass gracieux). Le pipeline reste **unique et neutre** car les
2 sites sont conditionnels (`if (boardStateAfter)`) et leur absence
dégrade en strict-pass sans perte fonctionnelle.

**Bug SOLO et structure cible** : la mémoire
`pvp-solo-chain-state-hygiene-2026-05-23` documente que l'état chain
diverge aujourd'hui entre les deux POV parce que SOLO instancie deux
`DuelEventProcessor` parallèles (un par connection) — l'orchestrator lit
la mauvaise instance après un `switchPlayer`. Dans la cible, **un seul
`DuelEventProcessor` par duel** + perspective comme couche de projection
= la divergence d'état est éliminée par construction (un seul état, pas
deux). Démonstration mécanique : `bug-solo-sequence.md` (séquence WS
T0-T10 + état attendu + test de victoire).

## 2. Les attributs de qualité visés

- **Robustesse** : le système doit tenir dans les combinaisons utilisées
  + latentes sans divergence d'état entre elles. En particulier :
  - **Auto-récupération bornée** : pour toute séquence d'événements WS
    reçue, le système converge vers un état cohérent en **≤ N
    événements**, où N = profondeur de la cascade de reset déclarée
    (max documenté 3 — `STATE_SYNC` → `RematchStarted` → idle).
    Couvre les bursts, reconnexions, animations résolvant hors-ordre,
    transitions de perspective. Au-delà de N, un `duelAssert()` lève.
  - **Parité inter-modes (séquence WS identique)** : pour une **même
    séquence d'événements WS** observée sous une perspective P0, l'état
    logique post-événement est identique en PvP normal, en SOLO avec
    perspective fixée à P0, et en Replay avec perspective fixée à P0.
    Les modes Interactive (PvP, SOLO) peuvent évidemment diverger entre
    parties par les choix joueur — la parité est **conditionnée à
    l'égalité de la séquence**, pas absolue. Le **timing** entre
    événements est libre par contrat (cf. §1).
- **Debuggabilité** : le code doit être facile à debug. Quand un bug
  survient, on doit pouvoir tracer la chaîne causale via le flux unique
  + DuelLogger catégorisé, sans archéologie cross-composant.
- **Races sur état partagé observable structurellement impossibles** :
  cf. §3.4. Les races réseau / d'horloge / de timer restent traitables
  par les mécaniques classiques (FIFO arbitré côté serveur, horloges
  explicites par projection, timers comme événements du flux).
- **Pas de comportement caché** : tout side-effect d'un manager / service
  est observable depuis l'extérieur (signal, événement, log). Aucun
  manager ne mute un autre manager via accès direct à son état interne.
  Les flux causaux entre composants sont déclarés.
- **Socle stable pour évolutions futures**, mesuré par :
  - Couverture tests ≥ 85% sur les processors (DeferredEffect, Boundary,
    BaseProjection)
  - Time-to-recover sur incident < 1h (mécaniques d'auto-récupération
    + DuelLogger)
  - Feature flag `ANIM_PIPELINE_V2` actif jusqu'à 2 semaines de
    stabilisation après bascule V2 production
  - 0 régression bugs caractérisés (cf. `bug-solo-sequence.md` et
    `bug-cost-before-overlay-sequence.md`)

## 3. Principes directeurs

Ces principes sont le **filtre d'évaluation** de tout futur code dans le
pipeline d'animation. Toute proposition doit être lisible à travers eux ;
toute violation doit être justifiée explicitement et documentée comme telle.

### 3.1 Le flux est l'unique source de vérité

Un duel est, par nature métier, une **séquence ordonnée d'événements**.
C'est la chronique causale de ce qui s'est passé. Le flux est sérialisable,
reproductible, et permet par construction la reconstitution complète d'un
état à n'importe quel instant.

Le système d'animation traite le flux comme **la** source primaire — pas
*une* source parmi d'autres. Tout signal libre qui prétend détenir une
information *à côté* du flux est un défaut de conception.

### 3.2 Tout état observable est une projection déterministe du flux

Toute valeur consultable depuis l'extérieur du pipeline (par un composant,
un manager, un test) est de l'une des **trois** natures suivantes — et de
l'une seulement :

- **Projection** : une fonction déterministe `(flux, perspective) → valeur`.
  Elle n'a pas d'écriture extérieure. Elle est mémoisable mais n'est jamais
  *synchronisée* avec autre chose — il n'y a rien d'autre avec quoi se
  synchroniser. Exemples : phase de chain, liste des chain links actifs,
  visibilité de l'overlay, contenu rendu d'une zone.
- **État de transport** : une variable interne au moteur d'exécution
  (drain de queue, timer en cours, lock acquis). Elle a une sémantique
  purement mécanique — *"où en est le moteur d'animation"* — et n'a
  **aucune signification métier**. Elle est nommée comme telle. Elle est
  isolée du reste : un composant UI ne doit jamais avoir besoin de la lire.
- **Entrée d'environnement** (`@Environment`) : un input externe constant
  ou semi-constant qui n'est pas dérivable du flux. Exemples :
  `reducedMotion` (media query OS), `speedMultiplier` (réglage user),
  `theme` (sélection user), `ownPlayerIndex` (configuration session
  fixe). Tagué explicitement. Lecture-seule du point de vue du
  pipeline. Reset par le système d'OS / user, pas par le flux.

**Algorithme de décision** (utilisable en code review) :

```
Pour toute valeur observable X exposée par le pipeline :
  1. X est-elle dérivable d'une fonction pure (flux, perspective, environnement) → X ?
     - OUI → Projection. Doit être implémentée via `computed` ou
       `applyEvent` dans un projector.
  2. X est-elle un input externe (OS, user setting, configuration session) ?
     - OUI → @Environment. Doit être tagguée et lecture-seule depuis le pipeline.
  3. X est-elle nécessaire au moteur d'exécution interne uniquement ?
     - OUI → Transport state. Doit être interne au composant qui l'utilise,
       jamais exposée à l'UI.
  4. Aucun des trois ?
     - REFUSÉ. Le flux doit être enrichi (cf. principe 3.3) ou la valeur
       supprimée.
```

**Test opérationnel pour code review** : *« cette valeur est-elle lue par
un template Angular ou un effect hors du moteur d'animation ? »*
- OUI → c'est une projection (ou exceptionnellement @Environment).
- NON → c'est du transport state.

Cette frontière est mécaniquement enforceable via convention de nommage
(préfixe `_transport_*` pour transport, suffixe `Source` ou tagué
`@Environment` pour environment) + lint custom (à ajouter au scope du
chantier).

### 3.3 Les événements internes du pipeline sont sur le flux, pas en marge

Les choses qui se passent **dans le pipeline lui-même** (une animation a
démarré, une animation a fini, une zone vient d'être commit, un timer
fallback a tiré) sont elles aussi des événements. Elles sont produites
par le pipeline et entrent dans le flux.

Conséquence : il n'existe pas deux mondes — *"le métier"* (MSG_* du
serveur) et *"la mécanique"* (animations qui se jouent). Il y a **un
seul flux** qui contient les deux catégories. Les projections lisent
indifféremment l'un ou l'autre selon ce qu'elles modélisent.

Cela permet notamment :
- De faire du replay déterministe **du flux logique** (états logique
  successifs reproductibles). Le **rendu visuel** reste best-effort
  selon le device : `speedMultiplier`, `reducedMotion`, easing browser,
  framerate sont des inputs `@Environment` (§3.2) qui n'entrent pas dans
  le flux. Deux machines différentes rejouent la même séquence d'états
  logiques mais peuvent rendre l'animation à des durées différentes.
- D'éliminer la classe des bugs où *"un état est attendu mais l'animation
  qui le produit n'a pas fini"* — cette transition est elle-même un
  événement du flux, donc observable.
- De rendre les timers de safety net (`safetyTimeout`, `guardTimer`)
  conceptuellement honnêtes : ils ne sont pas un *état caché*, ils sont
  une *promesse d'événement futur sur le flux* (matérialisée par
  `TimerArmed` / `TimerFired` / `TimerCancelled`).

**Ordering et cardinalité du flux** :

- **Ordre canonique** : événements WS arrivés du serveur d'abord (dans
  l'ordre serveur), événements internes émis par le pipeline en réponse
  ensuite (dans l'ordre d'émission), avec timestamp monotone.
  L'`AnimationStarted(ref=N)` est toujours après le WS qu'il référence
  et avant le prochain WS de la séquence — sauf burst, où plusieurs WS
  consécutifs peuvent s'enchaîner avant le premier `AnimationStarted`
  si la queue n'a pas encore drainé.
- **Garantie pour les consommateurs** : un événement interne référence
  toujours un événement amont par son `ref` (index dans le flux), donc
  l'ordre des écritures importe peu — c'est l'ordre des références qui
  établit la causalité.
- **Volume estimé** (cf. §3.9) : ~60 events/s pic post-§3.3 sur une
  chain 8 liens. 30-100× sous tout seuil de risque.
- **Politique de rétention** : le flux est non borné dans la version
  actuelle mais le volume reste digérable pour BO1/BO3 (~2.4 Mo heap
  post-§3.3). Compaction recommandée pour sessions > 2h (cf. §3.9).

### 3.4 Conséquence sur les race conditions

Reformulation honnête (cf. arbitrage ADV-5) : les races ne disparaissent
pas toutes — elles changent de forme. Précisément :

- Les **races sur état partagé observable** (type 2) deviennent
  **impossibles modulo l'enforcement lint + assert runtime** (§3.5
  `BaseProjection` + lint custom §3.2) : il n'y a pas d'état partagé
  observable de l'extérieur, seulement des projections déterministes
  d'un flux unique. Une projection n'a pas de race avec elle-même.
  La garantie est mécanique (lint statique au build + assert
  runtime en dev) — pas purement structurelle, mais robuste.
  **C'est la garantie forte du chantier**.
- Les **races d'ordre d'arrivée** (type 1) restent possibles côté
  réseau / WS mais sont **contenues par l'ordre du flux** (FIFO unique).
  Une fois entré dans le flux, l'ordre est figé. Le serveur arbitre les
  cas ambigus côté émission.
- Les **races entre horloges** (type 3) restent possibles entre WS et
  pipeline events, mais deviennent **explicites** : chaque projection
  déclare quel sous-ensemble du flux elle observe (les événements WS
  bruts, les événements d'animation, ou les deux). Un consommateur
  choisit son horloge ; il ne peut plus mélanger silencieusement.
- Les **timers async** (type 4) restent intrinsèques à JavaScript mais
  ne créent plus d'état caché : leur résolution produit un événement
  sur le flux (`TimerArmed` / `TimerFired` / `TimerCancelled`).

**Critère opérationnel** : *« quand un bug d'animation survient, on n'a
jamais besoin de dire 'c'est une race condition sur état partagé'. Soit
c'est une violation d'invariant déclaré (et un assert l'attrape), soit
c'est un bug logique reproductible — un flux donné donne un résultat
erroné, on le rejoue, on corrige la projection. »*

Les races réseau / horloges / timers restent traitables par les
mécaniques classiques (FIFO arbitré par serveur, horloge explicite par
projection, timers comme événements). Ce qui disparaît, c'est la classe
spécifique « bug parce qu'un autre composant a écrit pendant que je
lisais ». Cf. §2 reformulé.

### 3.5 Scope de persistance par catégorie

Tous les streams et projections du système n'ont pas la même durée de vie.
Certains survivent à des événements qui en invalident d'autres. Cette
sémantique doit être **explicite et déclarative**, pas implicite par
garde-fou commenté dans le code (le commit `853e3374` a montré qu'un
warning seul ne tient pas — un reset accidentel était régressé deux fois).

**Mécanisme retenu** : chaque stream / projection déclare la **catégorie
de portée** à laquelle il appartient. Chaque événement de reset déclare
les **catégories qu'il invalide**. Le dispatch fait le matching
automatiquement.

**Catégories de portée** (du plus durable au plus volatile) :

| Catégorie | Survit à... | Invalidé par... |
|---|---|---|
| `SESSION_LIFETIME` | tout sauf navigation away | tab close, navigation hors-app |
| `DUEL_LIFETIME` | `PerspectiveSwitched`, déconnexion réseau temporaire | `RematchStarted`, `STATE_SYNC`, `DuelAbandoned` |
| `CONNECTION_LIFETIME` | `PerspectiveSwitched` | toute reconnexion WS, `STATE_SYNC`, `RematchStarted` |
| `PERSPECTIVE_LIFETIME` | aucune (le plus volatile) | `PerspectiveSwitched`, tout reset au-dessus |

**Streams / projections par catégorie** (à figer dans la spec
d'implémentation) :

| Stream / projection | Catégorie |
|---|---|
| Score best-of-3, opponent identity, scores cumulés | `SESSION_LIFETIME` |
| Flux d'événements WS bruts (Famille 1) | `DUEL_LIFETIME` |
| Journal de log (`DuelGameLogService`) | `DUEL_LIFETIME` |
| LP commits cumulés (`_pendingLpCommits`) | `DUEL_LIFETIME` |
| État chain (links, phase) | `CONNECTION_LIFETIME` |
| `pendingDeferredEffects` (DeferredEffectProcessor) | `CONNECTION_LIFETIME` |
| Locks `RenderedBoardStateService` | `CONNECTION_LIFETIME` |
| Buffer chain résolvante | `CONNECTION_LIFETIME` |
| État d'animation en cours (`pendingAttack`, `animatingLpPlayer`) | `PERSPECTIVE_LIFETIME` |
| Queue / timers internes / floats in-flight | `PERSPECTIVE_LIFETIME` |

**Événements de reset** (du plus invasif au plus localisé) :

| Événement | Catégories invalidées |
|---|---|
| `NavigationAway` (tab close, route change) | tout, y compris `SESSION_LIFETIME` |
| `RematchStarted` | `DUEL_LIFETIME` + `CONNECTION_LIFETIME` + `PERSPECTIVE_LIFETIME` (préserve `SESSION_LIFETIME`) |
| `STATE_SYNC` (F5 refresh, reconnect mid-duel) | `DUEL_LIFETIME` + `CONNECTION_LIFETIME` + `PERSPECTIVE_LIFETIME` (payload sert d'état initial) |
| `ServerKicked` (4029 connection limit) | `CONNECTION_LIFETIME` + `PERSPECTIVE_LIFETIME` |
| `PerspectiveSwitched` | `PERSPECTIVE_LIFETIME` uniquement |
| `DuelEnded` (terminé naturellement) | rien (état figé pour consultation post-match — replay viewer + rematch button accèdent à l'état final) |
| `TabHidden` / `TabFreeze` (Page Visibility API) | rien (suspend, pas reset) |

**Note importante sur le bug SOLO** : la mémoire `pvp-solo-chain-state-hygiene-2026-05-23`
documente que le bug actuel est dû au fait que les locks et le chain state
(`CONNECTION_LIFETIME`) sont aujourd'hui attachés à la connection
(via le DuelEventProcessor instancié par DuelConnection). Le `switchPlayer`
SOLO change la connection active → l'orchestrator lit un processor vide.
Dans la cible, le DuelEventProcessor est unique au duel et son état
`CONNECTION_LIFETIME` survit explicitement à `PerspectiveSwitched`. C'est
le mécanisme structurel qui élimine le bug. Cf. `bug-solo-sequence.md`
pour la démonstration mécanique.

**Enforcement mécanique** (corrige l'aveu lignes 228-230) :

Chaque projection hérite de `BaseProjection` qui requiert :

```typescript
abstract class BaseProjection<T> {
  abstract readonly scope: ScopeCategory;     // déclaration obligatoire
  abstract applyEvent(event: FluxEvent): void;
  abstract applyReset(
    invalidatedScopes: Set<ScopeCategory>,
    checkpointPayload?: CheckpointPayload     // fourni si reset par §3.6
  ): void;
  // ... initial state, computed signal, etc.
}
```

Le paramètre optionnel `checkpointPayload` est passé par le
`ScopeResetDispatcher` quand le reset est déclenché par un événement
checkpoint de §3.6 (`STATE_SYNC`, `RematchStarted`). La projection
réinitialise son état à partir du payload au lieu d'un état zéro.
Pour les resets non-checkpoint (`PerspectiveSwitched`, `ServerKicked`,
etc.), `checkpointPayload` est `undefined` et la projection repart de
son état initial déclaré. Cette signature résout le décalage entre
§3.6 (*"repartir de zéro en utilisant le payload du checkpoint"*) et
§3.5 (`applyReset(scopes)` qui ne portait pas de payload).

Le `BaseProjection` est consommé par un `ScopeResetDispatcher` qui :
1. Tient un registre des projections instanciées par scope.
2. À chaque événement de reset, dispatche `applyReset(scopes)` à toutes
   les projections dont le scope est dans l'ensemble invalidé.
3. Vérifie en runtime (dev mode) qu'aucune projection sans scope déclaré
   n'a été enregistrée — `duelAssert()` sinon.

Combiné avec une lint custom qui interdit `class ... extends Projection`
sans déclaration de scope, la régression du commit `853e3374` (warning
qui ne tient pas) devient **impossible** : un développeur qui oublie
de déclarer son scope ne peut pas compiler.

**Conséquence pour les contributions futures** : tout nouveau stream
déclare sa catégorie via le type system. Pas de revue manuelle requise.

### 3.6 Événements checkpoint — invalidation explicite de l'amont

Certains événements du flux ont une sémantique de **checkpoint** : ils
ne sont pas un événement métier de plus, ils sont une **barre de
réinitialisation**. Quand un checkpoint arrive sur le flux, tous les
événements antérieurs sont *logiquement effacés* pour les consommateurs
de projection.

**Cas canoniques** :
- `STATE_SYNC` (F5 refresh, reconnect mid-duel, rematch R8) — le serveur
  envoie l'état complet + le journal courant ; les events précédents
  sont caducs.
- `RematchStarted` (équivalent fort) — nouvelle partie, table rase.

**Contrat strict** :
- Quand une projection consomme un checkpoint, elle **doit** repartir de
  zéro en utilisant le payload du checkpoint comme état initial.
- Les events antérieurs au checkpoint **peuvent rester en mémoire pour
  debug / replay arrière** mais ne sont plus *consommables* — le flux
  effectif des projections démarre au checkpoint.
- Le contraire — une projection qui continue à accumuler à travers un
  checkpoint — est interdit. Deux projections du même flux ne peuvent
  pas diverger sur leur politique d'honneur du checkpoint.

Ce contrat strict (κ1) supprime la classe de bug *"une projection est
décalée par rapport au serveur parce qu'elle a replayé des events
pré-sync"*. Le STATE_SYNC est ainsi *honnête au sens du serveur* :
*"voilà l'état, oublie ce qui précède."*

**Articulation avec 3.5** : un événement checkpoint déclare comme
catégories invalidées **toutes les catégories** (DUEL_LIFETIME et en
dessous). Le scope de persistance et le checkpoint sont deux faces du
même mécanisme : le checkpoint est l'événement le plus invalidant
possible.

**Conséquence pour le debug arrière** : si tu veux *"replayer le duel
depuis le début pour comprendre un bug"*, tu peux — mais en sachant que
tu reconstruis un état qui n'est pas celui qu'a vu l'utilisateur, car
le checkpoint a fait reset entre temps. Cette divergence est documentée
et acceptée.

### 3.7 Corrélation cross-event — effets différés

Certaines projections ne dépendent pas d'un seul événement, mais de la
**relation temporelle** entre plusieurs événements. Le cas canonique
est `overlayVisible` : l'overlay chain ne devient visible **qu'après**
que l'animation de coût ait fini, pas dès la réception WS du
`MSG_CHAINING` adverse.

Aujourd'hui, ce besoin est traité ad-hoc par chaque consommateur (le
composant overlay tient ses propres flags pour suivre la dépendance).
Cela a produit la classe de bug *cost-before-overlay* : 4 tentatives
de fix ont échoué parce que la dépendance était implicite, scattered,
et impossible à raisonner cohéremment.

**Mécanisme retenu (ε3)** : les corrélations sont matérialisées par
deux événements de Famille 3 sur le flux :

- `DeferredEffect(name, triggerRef, awaitingPredicate)` — émis quand un
  événement *trigger* déclenche un effet qui doit attendre la complétion
  d'un événement *awaiting*.
- `EffectReady(name, triggerRef)` — émis automatiquement quand
  un événement matchant `awaitingPredicate` a vu son `AnimationCompleted`.

**Pairing strict-pass** (clarification critique) : le processor
d'effets différés observe le flux **post-facto**, **sans lookahead**.
Quand un trigger arrive, il émet un `DeferredEffect` dont
l'`awaitingPredicate` est un **matcher déclaratif** (forme attendue
de l'événement futur) — pas un index précis. Quand un événement
matchant le prédicat arrive plus tard sur le flux, le processor
émet `EffectReady`.

Ce design garantit la neutralité streaming/precomputed du pipeline
(cf. §1) : la mécanique est identique en mode `Streaming`
(événements arrivent un à un) et en mode `Precomputed` (événements
disponibles d'avance) — le processor traite chaque événement à
mesure qu'il entre dans le flux, sans regarder en avant.

Les projections lisent uniquement le drapeau `EffectReady` — elles ne
raisonnent jamais sur la dépendance elle-même. La complexité est isolée
dans **un seul composant** qui produit ces événements : le
**processor d'effets différés**.

Exemple 1 — la séquence Ash sur Lukias (cas #1 catalogue, cost-deferral) :

```
[idx]  Événement                                Source
   1   MSG_CHAINING(Lukias, chain-1)            WS
   2   AnimationStarted(ref=1)                  Pipeline
   3   AnimationCompleted(ref=1)                Pipeline
   4   MSG_CHAINING(Ash, chain-2)               WS                          ← trigger
   5   DeferredEffect('overlay-show', 4,        Processor (à l'arrivée de 4)
       awaitingPredicate={
         type: 'MSG_MOVE',
         player: 0,
         card.code: ASH_CODE,
         destination: 'GY'
       })
   6   MSG_MOVE(Ash → GY, cost)                 WS                          ← matche le prédicat
   7   AnimationStarted(ref=6)                  Pipeline
   8   AnimationCompleted(ref=6)                Pipeline
   9   EffectReady('overlay-show', 4)           Processor
                                                ← overlayVisible passe à true
  10   MSG_CHAIN_SOLVING(0)                     WS
```

À l'idx 5, le processor **ne sait pas** que l'événement à l'idx 6 va arriver.
Il émet juste un prédicat qui décrit la forme attendue. Quand idx 6 arrive,
le processor parcourt ses deferred actifs, trouve celui dont le prédicat
matche, et émet `EffectReady`.

Exemple 2 — Snake-Eye Ash trigger-effect-activation (cas #2, summon + trigger) :

```
[idx]  Événement                                Source
   1   MSG_MOVE(Snake-Eye Ash → MZONE)          WS                          ← trigger
   2   DeferredEffect('trigger-show', 1,        Processor
       awaitingPredicate={
         type: 'AnimationCompleted',
         ref: 1
       })
   3   AnimationStarted(ref=1)                  Pipeline
   4   AnimationCompleted(ref=1)                Pipeline                    ← matche le prédicat
   5   EffectReady('trigger-show', 1)           Processor
   6   MSG_CHAINING(SE Ash effect, chain-1)     WS
```

Ici le prédicat attend la **complétion de l'animation du trigger lui-même**
(matcher par `ref`). Cas plus simple : le prédicat référence un index
connu (le trigger), pas un événement futur.

Exemple 3 — Necroface banish séquentiel (cas #5, multi-event sequencing) :

```
[idx]  Événement                                Source
   1   MSG_CHAINING(Necroface, chain-1)         WS                          ← trigger
   2   MSG_MOVE(card-A GY → banish)             WS
   3   DeferredEffect('banish-seq-2', 1,        Processor
       awaitingPredicate={ type:'AnimationCompleted', ref: 2 })
   4   AnimationStarted(ref=2)                  Pipeline
   5   AnimationCompleted(ref=2)                Pipeline
   6   EffectReady('banish-seq-2', 1)           Processor                   ← gate pour MSG_MOVE suivant
   7   MSG_MOVE(card-B GY → banish)             WS
   8   DeferredEffect('banish-seq-3', 1, ...)   Processor
   ...
```

Le nom du deferred inclut un **index séquentiel** (`banish-seq-2`,
`banish-seq-3`, ...) pour éviter les collisions de noms — cf. règle
ci-dessous "collisions de noms interdites".

La projection `overlayVisible` est triviale : *"le dernier
`EffectReady('overlay-show')` est-il plus récent que le dernier
`OverlayHidden` ?"*. Aucune logique YGO dans la projection.

**Le processor d'effets différés** :
- Observe le flux complet et y produit les événements `DeferredEffect`
  et `EffectReady`.
- Contient une **table de règles métier** — 11 règles initiales
  (2 passes Explore), cf. `deferred-effects-catalogue.md`, réparties en
  **7 familles** :
  1. **Cost-deferral** (cas #1, #9) — overlay/effect attend la fin du
     MSG_MOVE cost ou MSG_PAY_LPCOST
  2. **Summon + trigger** (cas #2, #4) — trigger effect attend la fin
     de l'animation du monstre (summon ou flip)
  3. **Multi-event sequencing** (cas #3, #5, #8) — reveal ou attachment
     attend N travels séquentiels
  4. **Battle + impact** (cas #6) — trigger counter attend
     DAMAGE_STEP_END ou impact visual
  5. **Zone animation deps** (cas #7) — stat/property update attend
     l'animation vers la zone
  6. **Visual badge lifecycle** (cas #10) — badge/counter pulse attend
     la fin de sa propre animation
  7. **Cleanup post-chain** (cas #11) — élément visuel attend
     `AnimationCompleted` du fade-out avant clear
- Est testable indépendamment (entrées : flux, sortie : événements
  produits — fonction pure).
- Est **l'unique endroit** dans l'architecture qui contient la
  connaissance YGO de *"qui attend qui"*. Cette spécialisation cohabite
  avec celle du filtre serveur (sanitization) et du processor de
  frontières (transition detection §3.8) — trois composants distincts,
  trois responsabilités YGO distinctes, jamais de duplication.

**Cas explicitement écartés** (pour border le scope du processor) :
- Ordre garanti par le protocole (ex: `MSG_DRAW` puis `MSG_CONFIRM_CARDS`)
  → pas ε3, séquentiel naturel.
- Transition de phase instantanée (`MSG_NEW_PHASE`) → projection simple,
  pas ε3.
- Side-effect intra-événement (`MSG_DAMAGE` → LP counter) → pas une
  dépendance inter-événements.
- Animation autonome sans awaiting (`MSG_TOSS_COIN` toast,
  `MSG_SHUFFLE_DECK` refresh) → pas ε3.
- Détail exhaustif dans `deferred-effects-catalogue.md §3`.

**Règle générale** : ε3 est pour les **dépendances inter-événements
visibles**. Si la dépendance est interne à un seul handler (sync), ou
si l'ordre est garanti côté serveur, c'est du code normal.

**Conséquence sur les bugs visés** : cost-before-overlay devient
structurellement impossible. Les 4 tentatives de fix de mai 2026 ont
échoué parce qu'elles essayaient de reconstruire ce concept ad-hoc dans
chaque tentative (parfois dans le processor de chain, parfois dans
l'overlay component, parfois dans une FIFO de pending entries). Le
mécanisme ε3 le nomme une fois pour toutes. Démonstration mécanique :
cf. `bug-cost-before-overlay-sequence.md`.

#### 3.7bis Tests obligatoires du DeferredEffectProcessor

Quatre tests automatisables couvrent les 7 familles du catalogue
(cas représentatif de la famille la plus risquée) :

1. **Cas #1 — overlay-show + cost (Cost-deferral)** — déjà spécifié
   dans `bug-cost-before-overlay-sequence.md`. Test de victoire du
   bug historique.
2. **Cas #2 — trigger-effect-activation post-summon (Summon + trigger)**.
   Snake-Eye Ash pose en MZONE → trigger chaîne → assert overlay
   invisible jusqu'à fin pose.
3. **Cas #8 — xyz-overlay-attach multi-matériaux (Multi-event
   sequencing + dépendance en chaîne)**. 3 matériaux + pose XYZ →
   assert overlay visible uniquement à la fin du dernier travel.
4. **Cas #11 — pile-target-float-cleanup (Cleanup post-chain)**.
   MSG_BECOME_TARGET sur card en GY → float reticle visible →
   MSG_CHAIN_SOLVING → assert float fade-out complet avant clear
   `targetedZoneKeys`.

Plus les **4 scénarios de casse** identifiés à l'arbitrage R6 (à
couvrir au niveau des projections consommatrices, pas du processor
lui-même) :
- SOLO PvP switchPlayer mid-chain (cf. `bug-solo-sequence.md`)
- Replay seek pendant un deferred actif
- Burst WS de N `MSG_CHAIN_SOLVING` (chain longue)
- Animations parallèles non-await (cf. mémoire
  `faimena-activate-cost-overlap-2026-05-24`)

**Lifecycle des DeferredEffect** (à spécifier dans la spec
d'implémentation) :

- **Timeout** : un `DeferredEffect` qui ne voit pas son
  `awaitingPredicate` matché dans un délai N (à chiffrer post-mesure)
  émet `EffectAbandoned(name, triggerRef, reason: 'timeout')`. Les
  projections lisant `EffectReady` ignorent l'événement abandonné ;
  le pipeline ne reste pas bloqué.
- **Collisions de noms** : deux `DeferredEffect` du même nom actifs
  simultanément sont **interdits par invariant** (assertable via
  `duelAssert` en dev). Pour les cas séquentiels comme #5 Necroface
  (batch banish), le naming inclut un **index séquentiel**
  (`banish-seq-2`, `banish-seq-3`, ...) garantissant l'unicité. Si un
  cas émerge où la collision serait légitime sans index, repenser le
  naming des règles plutôt que d'assouplir l'invariant.
- **Annulation par checkpoint** (§3.6) : `STATE_SYNC` ou
  `RematchStarted` annulent tout `DeferredEffect` pending et émettent
  `EffectAbandoned(name, triggerRef, reason: 'checkpoint')` pour
  chacun. Les projections sont reset au checkpoint indépendamment —
  pas de dépendance circulaire.
- **PerspectiveSwitched ne déclenche PAS d'abandon**. Les
  `DeferredEffect` sont `CONNECTION_LIFETIME` (cf. §3.5) et **survivent
  au switch de perspective**. L'effet visuel (overlay, badge, etc.)
  apparaît dans la nouvelle perspective quand le matching event arrive
  — pipeline neutre garanti par §1. C'est cohérent avec la lecture
  laxiste de `bug-solo-sequence.md §3` (état transféré au switch, pas
  invalidé).
- **Versioning** : la table de règles est alignée avec
  ws-protocol-shared. Ajout d'un nouveau MSG_* type → la table doit
  être consultée pour vérifier qu'aucune règle existante n'est cassée.

**Signature de `EffectAbandoned`** :

```typescript
interface EffectAbandoned {
  kind: 'EffectAbandoned';
  name: string;                                    // même nom que le DeferredEffect
  triggerRef: number;                              // même triggerRef
  reason: 'timeout' | 'checkpoint';
}
```

Les projections traitent `EffectAbandoned` comme un signal *"oublie
ce deferred"* — équivalent fonctionnel à n'avoir jamais émis le
`DeferredEffect` correspondant.

**Lien frontières §3.8 ↔ règles ε3** : les frontières
`ChainStarted/Ended`, `TurnStarted/Ended`, `PhaseStarted/Ended`
peuvent servir de `triggerRef` ou de matcher d'`awaitingPredicate`
dans une règle. Exemple potentiel (non implémenté aujourd'hui) :
*"un EffectReady('chain-resume') est émis à chaque `ChainEnded`"*.
Aucune règle du catalogue actuel n'utilise les frontières comme
trigger primaire, mais c'est une extension naturelle.

### 3.8 Groupement causal — frontières explicites

Le serveur (OCGCore) envoie souvent des **bursts** de messages liés à
une même unité causale en quelques microsecondes — typiquement
`MSG_CHAIN_SOLVING(0), MSG_CHAIN_SOLVED(0), MSG_CHAIN_SOLVING(1), …,
MSG_CHAIN_END` pour une chain entière. Au niveau du flux brut, ces
événements sont indépendants ; sémantiquement, ils appartiennent au
même groupe causal.

La tentative #4 de fix cost-before-overlay (FIFO de pending entries,
25/05) a explosé sur ce point : une nouvelle chain démarrait avant que
la précédente soit clôturée côté projections, et la contamination
cross-chain produisait des états visuels incohérents (`activeChainLinks
= 4` au début d'une nouvelle chain).

**Mécanisme retenu (γ2)** : le pipeline émet des événements explicites
de **frontière** sur le flux pour les transitions causales critiques :

- `ChainStarted(chainId)` / `ChainEnded(chainId)` — encadrent les
  événements WS d'une même chain YGO.
- `TurnStarted(turnNumber, playerIndex)` / `TurnEnded(turnNumber)` —
  encadrent les événements d'un tour.
- `PhaseStarted(phase)` / `PhaseEnded(phase)` — encadrent les
  événements d'une phase (Draw / Standby / Main / Battle / End).

Les événements entre une frontière d'ouverture et sa frontière de
clôture appartiennent au groupe correspondant. Les projections lisent
les frontières pour savoir *"où je suis dans la causalité du duel"*
sans avoir à inférer depuis les MSG_*.

**Articulation avec 3.7** : les frontières sont des candidates
naturelles à servir de `triggerRef` ou `awaitingRef` pour les effets
différés. Par exemple, *"l'overlay reste visible jusqu'à `ChainEnded`,
indépendamment des link-by-link"*.

**Articulation avec 3.6** : un événement checkpoint (STATE_SYNC,
RematchStarted) ferme implicitement tous les groupes ouverts. Si le
flux contient `ChainStarted(7)` puis `STATE_SYNC` sans `ChainEnded(7)`,
le groupe 7 est *abandonné causalement* — les events post-checkpoint
appartiennent à de nouveaux groupes définis par les frontières émises
après.

**Bénéfice** : un nouveau type de bug *"cross-chain contamination"*
devient impossible parce que les frontières sont **dans le flux**, pas
inférées. Une projection qui lit `ChainStarted(8)` sans avoir vu
`ChainEnded(7)` peut lever une assertion explicite — un invariant
testable, pas un état caché.

**Conséquence pour le processor de frontières** : c'est un composant
identifié, comme le processor d'effets différés (3.7). Il observe les
MSG_* du flux et émet les frontières quand il détecte les transitions
métier. Il contient la connaissance *"quel MSG_* ouvre / ferme quel
groupe"*. Testable indépendamment.

**Le BoundaryProcessor — contrats opérationnels** :

- **Sync mandatory sur chaque WS message** : le processor runs synchrone
  avant que les projections lisent le flux. Une projection ne voit
  jamais un `MSG_CHAIN_SOLVING` sans avoir vu le `ChainStarted` qui
  l'encadre. Garantie d'ordering structurelle, pas par convention.
- **Détection mismatch** : si le processor reçoit `MSG_CHAIN_END` sans
  `ChainStarted` ouvert (ou inversement), il `duelAssert()` en dev et
  `logger.warn` en prod tout en émettant la frontière manquante (best-
  effort self-heal). Ne bloque pas le pipeline.
- **Closure forcée par checkpoint** (cf. §3.6) : `STATE_SYNC` /
  `RematchStarted` ferment tous les groupes ouverts en émettant les
  frontières manquantes synthétiquement avant de purger l'état.
- **Closure forcée par DuelEnded** : `DuelEnded` (surrender, timeout,
  disconnect, fin naturelle) synthétise `ChainEnded` / `TurnEnded` /
  `PhaseEnded` pour tous les groupes encore ouverts. Pas d'assertion
  d'ouverture orpheline.

**Nesting des chains — garantie structurelle OCGCore (flat)** :

OCGCore garantit que les chains sont **flat** par construction :
- Phase chain = state linéaire `idle → building → resolving → idle`.
- `MSG_CHAINING` reçu pendant `resolving` accumule un link à la chain
  courante, ne flip jamais vers `building`. Aucune nouvelle chain ne
  peut commencer avant `MSG_CHAIN_END`.
- Test `chain-state-tracker.spec.ts:68-77` documente explicitement ce
  cas.

Les 16 cartes EVENT_CHAINING (Ash Blossom, Ghost Ogre, Veiler, etc.)
sont toutes des Quick Effects qui chainent en réaction à une activation,
**pas pendant un cost**. Aucun cas empirique de chain-during-cost dans
les decks meta 2026 skytrix.

**Conséquence** : le BoundaryProcessor émet des frontières `ChainStarted`
/ `ChainEnded` **flat** — pas de pile/stack à gérer. Le risque
"cross-chain contamination" élimine par construction (la tentative #4
de cost-before-overlay l'a confirmé a contrario).

### 3.9 Coût et discipline assumés

Ces principes ne sont pas gratuits. Ils impliquent :

- Un **read model** explicite (un projector par cas d'usage) qui consomme
  le flux et expose des `computed` Angular. Le projector lui-même
  accumule un état interne — mais cet état n'est jamais muté de
  l'extérieur, sa seule entrée est `applyEvent(event)`.
- L'**inclusion dans le flux** d'événements de pipeline (animation
  démarrée / terminée, zone commit) que le code actuel garde en marge.
- Un **réflexe de discipline** : tout `signal()` créé dans le pipeline
  doit pouvoir répondre à *"projection ou transport ?"*. S'il ne sait pas
  répondre, il n'a pas le droit d'exister.

**Coût quantifié (mesures statiques pré-implémentation)** :

- **Débit événementiel** : §3.3 ajoute `AnimationStarted` +
  `AnimationCompleted` + `ZoneCommitted` par événement métier
  animatable. Multiplication ×3-4 estimée. Mesure : chain 8 liens
  actuelle = 56 events bruts, ~25 events/s pic. Cible post-§3.3 = ~152
  events, **~60 events/s pic**. Seuil de risque WS/JSON serialization =
  ~2000 events/s soutenu. Marge 30-100× sous le seuil. (Investigation
  R5, cf. `duel-session-chantier-critiques.md §1bis`.)
- **RAM accumulée** : un duel BO3 (~45min, ~500-750 events métier) post-
  §3.3 consomme ~960 Ko de flux brut + ~2.4 Mo de heap total (×2.5
  overhead Angular signals + objets JS instanciés). Budget skytrix
  cible <10 Mo heap partagé → **OK pour BO1/BO3**. Politique de
  rétention nécessaire au-delà de 2h de session continue
  (arcade/exhibition). (Investigation EC-12.)
- **Politique de rétention** (à acter en story dédiée si arcade/
  exhibition deviennent un cas) : 3 stratégies disponibles —
  ring-buffer post-N events / snapshot+truncate per-turn / compaction
  causale par `ChainEnded` (articule avec §3.8). Recommandée mais non
  bloquante pour BO1/BO3.

**Nombre de projections estimé** : 1 par cas d'usage UI. Inventaire
actuel : `chainPhase`, `activeChainLinks`, `overlayVisible`,
`renderedBoard`, `logicalBoard`, `gameLog`, `targetedZoneKeys`,
`animatingLpPlayer`, `pendingAttack`, `targetIndicators` →
**~10 projections**. Chacune mémoisée via `computed` Angular. Recompute
sync per-event (pas de batching nécessaire au débit cible).

Ces coûts sont assumés. Ils sont l'investissement qui rend le résultat
**socle stable pour les évolutions futures** au sens du principe
directeur de la section 2.

> Note : le mot "industrialisable" utilisé dans la section 2 et dans la
> version initiale de cette section a été remplacé par des attributs
> mesurables (couverture tests, time-to-recover, présence de feature
> flag, etc. — cf. critères de bascule §6.3) suite à l'arbitrage ADV-4.

---

## 4. Existant → Cible

Cette section liste chaque composant de la pipeline actuelle et statue
sur son devenir dans la cible. L'objectif est double : (a) ne pas réécrire
ce qui marche, (b) éviter le scénario *« le chantier parle du futur
comme si la table était vide »* qui a tué plusieurs refontes ailleurs.

L'audit a été mené composant par composant contre les 9 principes
de la section 3. Les verdicts sont :

- **Conservé** : compatible avec les principes, pas de refonte nécessaire
- **Wrappé** : conservé avec ajouts/adaptations mineures (callback, signal
  déclaratif, scope category)
- **Jeté** : son rôle disparaît dans la cible parce qu'un mécanisme
  structurel l'élimine
- **Reformé** : conservé mais profondément refondu

### 4.1 Tableau des composants

| # | Composant | Rôle actuel | Statut cible | Effort | Raison |
|---|-----------|-------------|--------------|--------|--------|
| 1 | `AnimationOrchestratorService` | Coordinateur thin, dispatch métier sur managers | Wrappé | 3-5j | Devient read-only pour les projections ; émet `AnimationStarted/Completed` sur le flux (3.3) ; intègre les processors d'effets différés (3.7) et de frontières (3.8) ; déclare les scope categories (3.5). |
| 2 | `DuelEventProcessor` | Machine d'état chain, file d'animation, chain entry commit | Conservé | 0-1j | Reste source-of-truth de `chainPhase` et `activeChainLinks`. Aucun changement structurel — mineure : logging pour debuggabilité (principe 2). |
| 3 | `RenderedBoardStateService` | Board state, locks, sync tiers | Conservé | 0-1j | Orthogonal aux principes. Ses locks et `commitAll` sont du *transport state* (3.2) — conservés tels quels. |
| 4 | `ChainResolutionManager` | Signaux overlay (announce, ready), buffer, replay timeouts | Wrappé | 2-3j | Signaux requalifiés en **projections** lecture-seule. Écoute explicite des frontières `ChainStarted/Ended` (3.8). Sa fonction « announce » est l'EffectReady (3.7) du processor d'effets différés. |
| 5 | `DrawSequenceManager` | Draw sequences, hand expansion, shuffle, card confirmation | Conservé | 0j | Logique métier YGO pure (hand reveal, confirm). Aucune mutation croisée, aucune race. |
| 6 | `MoveAnimationRouter` | Routage MSG_MOVE via MoveContext, overlay detach | Conservé | 0-1j | Logique métier YGO. Mineure : vérifier qu'il ne mute pas `RenderedBoardState` directement (utiliser les locks existants). |
| 7 | `LpAnimationTracker` | LP tracking, counter animation, commit LP | Wrappé | 1-2j | Signal `animatingLpPlayer` requalifié projection. `_pendingLpCommits` déclarés `DUEL_LIFETIME` (3.5) — survivent à un switch de perspective. |
| 8 | `BattleAnimationTracker` | Attack line + clash impact, pending attack | Wrappé | 1-2j | Même pattern que LP tracker. Signal `pendingAttack` = projection. Scope `PERSPECTIVE_LIFETIME`. |
| 9 | `TargetIndicatorManager` | Reticles pour cards dans pile zones (GY, Banished, Extra) | Conservé | 0-1j | Spécialisé, sain. Mineure : vérifier qu'aucun float ne fuite via `FloatRegistryService`. |
| 10 | `BufferReplayBuilder` | 3-pass batch construction pour replayBuffer | **Jeté** | −5j (gain) | Son rôle disparaît : avec un flux unique qui contient les événements de pipeline (3.3) et des frontières causales (3.8), il n'y a plus besoin de re-bâtir un batch isolé. Le flux **est** le buffer. |
| 11 | `QueueRunner` | Boucle async, lifecycle primitives, finalize | Conservé + wrapper | 1-3j | Verdict de l'investigation R2. Ajout : callback `onInternalEvent(name, event)` dans `QueueRunnerDeps` pour qu'il émette `AnimationStarted/Completed` sur le flux ; déclaration de scope category sur ses 5 primitives. C'est le **moteur de transport** nommé par le principe 3.2. |
| 12 | `DuelContext` | Contexte partagé (player index, speed, board active, reduced motion) | Conservé | 0j | Configuration pure, pas d'état observable. Inchangé. |
| 13 | `CardTravelEngine` | Animations de travel (géométrie, keyframes, registry de zones) | Conservé + perspective | 1j (hors POC) | Cœur du rendu. Mineure : accepter l'injection de la perspective comme attribut de contexte (transform CSS sur container). Voir POC projection §5.2. |
| 14 | `BoardEffectsService` | Effets visuels (impact, dust, preDestroy, activate) | Wrappé | 1-2j | Conservé. Ses timers internes restent du *transport state* (3.2). Ajouter logging des effects lancés (debuggabilité). |
| 15 | `FloatRegistryService` | Lifecycle des floats créés par CardTravelEngine | Conservé | 0j | Isolé, sain. N'observe que les animations qu'on lui passe. |
| 16 | `DuelConnection` | WebSocket PvP, message dispatch | Conservé | 0-1j | Adaptateur WS concret. Mineure : déclarer instances propres par duel (pas de singleton cross-duel). |
| 17 | `ReplayDuelAdapter` | Adapter replay mode, `AnimationDataSource` impl | Conservé | 0-1j | Implémentation `AnimationDataSource` pour precompute. Mineure : son processor et son RBS sont propres et indépendants — vérifier qu'ils ne divergent pas en scope reset. |
| 18 | `DuelGameLogService` | Journal de log, tap sur orchestrator.eventStream | Wrappé | 1-2j | Devient **consumer pur du flux**. Catégorie `DUEL_LIFETIME` (survit perspective switch). Reset sur checkpoints `STATE_SYNC` / `RematchStarted` (3.6). |
| 19 | `SoloDuelOrchestratorService` | Wrapper SOLO PvP, deux DuelConnection parallèles | **Reformé** | 5-7j | C'est le composant qui porte le bug SOLO caractérisé (cf. `bug-solo-sequence.md`). Aujourd'hui : deux DuelEventProcessor parallèles → divergence d'état. Cible : **un seul** DuelEventProcessor + un seul flux ; switch de perspective via un événement `PerspectiveSwitched(playerIndex)` émis sur le flux. Le service devient un coordinateur de perspective, pas une machine d'état dupliquée. |

### 4.2 Nouveaux composants de la cible

Trois rôles structurellement nouveaux apparaissent dans la cible. Ils
n'existent pas aujourd'hui, et la décision de les nommer comme
composants distincts est une conséquence des principes 3.7, 3.8 et de la
couche de projection.

| Composant nouveau | Rôle | Principe rattaché | Effort |
|-------------------|------|-------------------|--------|
| `DeferredEffectProcessor` | Matérialise les corrélations cross-event. Émet `DeferredEffect(name, triggerRef, awaitingRef)` et `EffectReady(name, triggerRef)`. Table de règles métier YGO (overlay attend cost, etc.). Composant pur, testable isolément. | 3.7 (ε3) | 3-4j |
| `BoundaryProcessor` | Détecte les transitions causales et émet les frontières (`ChainStarted/Ended`, `TurnStarted/Ended`, `PhaseStarted/Ended`). Observe le flux WS brut. | 3.8 (γ2) | 2-3j |
| `PerspectiveProjector` | Couche de projection visuelle au-dessus du pipeline. Applique un transform CSS sur le container racine du board ; gère le switch SOLO sans recalcul en cours d'animation. Stratégie d'implémentation fixée par le POC. | §5.2 + principe 1 | 3-5j (POC inclus) |

### 4.3 Plan de migration en 3 phases

La cible ne peut pas être atteinte en big-bang. Trois phases ordonnées,
chacune testable indépendamment.

**Phase α — Adaptation du socle existant (~2-3 semaines)**
- QueueRunner + wrapper léger (callback `onInternalEvent` + déclaration de scope)
- AnimationOrchestratorService devient read-only pour les projections
- ChainResolutionManager, LpAnimationTracker, BattleAnimationTracker, BoardEffectsService, DuelGameLogService : signaux requalifiés en projections, scope categories déclarées
- Infrastructure transverse : scope reset dispatcher (`BaseProjection.applyReset(scopes, checkpointPayload?)`), checkpoint enforcement, RegistrationBoundary
- **Lint custom** (~0.5-1j) : règle pour interdire `signal()` non-tagué (projection / @Environment / `_transport_*`), enforce convention §3.2
- Validation : tests PvP live, parité comportementale avec V1

**Phase β — Émergence des nouveaux processors (~3-4 semaines)**
- `BoundaryProcessor` : émet `ChainStarted/Ended` etc. sur le flux
- `DeferredEffectProcessor` : émet `DeferredEffect` / `EffectReady`
- `BufferReplayBuilder` jeté (son rôle est absorbé par le flux unique)
- Test cost-before-overlay (cf. `bug-cost-before-overlay-sequence.md`) doit passer
- Validation : tests replay + PvP, regression check sur les chains complexes

**Phase γ — Couche de projection + refonte SOLO (~2 semaines)**
- POC projection exécuté (✅ statué, stratégie S3 retenue, cf. §5.2 et `_bmad-output/poc-projection/decision.md`)
- `PerspectiveProjector` implémenté selon S3 (coords container-relative + re-parent floats sous `.board-host`, 5-6.5j chiffré)
- `SoloDuelOrchestratorService` reformé : **single DuelEventProcessor par duel** (au lieu de deux processors parallèles dans la version actuelle) + événement `PerspectiveSwitched` émis sur le flux. C'est ce changement structurel qui élimine la divergence d'état documentée par `bug-solo-sequence.md §4` (T5 du single-processor reste inchangé au switch).
- Test bug SOLO (séquence T0-T10 de `bug-solo-sequence.md §2`) doit passer
- Validation : tests SOLO PvP + perspective switch in-flight

**Spike α-prérequis — Info hiding dynamique** (1-2j, parallèle phase α) :
modification de `message-filter.ts` côté serveur pour rendre le filtrage
durable post-`MSG_CONFIRM_CARDS`. Verdict de l'investigation R3 :
travail léger, inclus dans le scope (cf. `duel-session-chantier-critiques.md` §1bis R3).

### 4.4 Effort total

- Composants conservés inchangés (5) : 0j
- Composants wrappés (7) : 8-15j
- BufferReplayBuilder jeté (gain net) : −5j
- SoloDuelOrchestratorService reformé : 5-7j
- Nouveaux processors (DeferredEffect, Boundary, PerspectiveProjector) : 8-12j
- Infrastructure transverse (scope, checkpoint, reset dispatch) : 3-5j
- Spike info-hiding (parallèle) : 1-2j

**Total : ~30-45 jours-homme** (6-9 semaines à intensité full-time, ou 10-15 semaines en intensité mi-temps en cohabitation avec le steady-state skytrix).

### 4.5 Stratégie de bascule (branche dédiée, pas de feature flag)

Skytrix est un projet solo, pré-production, avec un seul développeur sur
le pipeline d'animation. Le pattern classique "feature flag pour ramper
progressivement V1↔V2 sur une fraction du trafic" n'a pas de cas d'usage
ici — il ajouterait du code de bascule à écrire et maintenir pendant
6-9 semaines pour zéro bénéfice opérationnel.

**Stratégie retenue** : refactor in-place sur une branche dédiée
`feat/anim-pipeline-v2` partant de `chore/queue-runner-palier-0`.
Aucune cohabitation runtime V1↔V2.

Trois mécanismes protègent contre les régressions :

1. **Branche isolée** — `feat/anim-pipeline-v2`. Le master continue à
   shipper V1 si besoin de hotfix. La branche dédiée est rebasée sur
   master ponctuellement si master diverge.
2. **Snapshots de référence V1 capturés en début de chantier** — un set
   de 3-5 replays canoniques (BO1 simple, chain 4+ liens, SOLO switch,
   cost-before-overlay scenario) joué sur master pré-chantier. L'état
   final (board rendu sérialisé, journal de log, chainPhase) est
   capturé en JSON et commit dans la branche feat/ comme oracle de
   parité.
3. **Tests parité automatisés** — un harness Playwright rejoue les
   replays canoniques sur la branche feat/ et compare contre les
   snapshots. Diff = zéro tolérance hors bugs documentés à fixer (les
   2 bugs caractérisés `bug-solo-sequence.md` et
   `bug-cost-before-overlay-sequence.md` sont des diffs **attendus** —
   leur résolution est l'objectif).

**Bascule** : merge `feat/anim-pipeline-v2` → master en **une fois**,
quand tous les tests parité passent + les deux tests de victoire
passent + couverture ≥ 85% sur les processors. V1 disparaît au merge,
pas de coexistence post-merge.

**Stabilisation post-merge** : 1 semaine d'usage solo (jouer plusieurs
duels SOLO et replays variés) avant de considérer le chantier
"vraiment clos". Si une régression apparaît pendant cette semaine,
fix sur master via PR dédiée — pas de revert global.

**Pas de SESSION_LIFETIME cross-version à gérer** : V1 n'existe plus
post-merge, la question de la sérialisation cross-version est vacante.

---

## 5. Sujets connexes

### 5.1 Info hiding dynamique (chantier serveur orthogonal)

Bug ancien : *des cartes ne sont pas affichées alors que leur information
devrait être visible des deux joueurs* (typiquement après un
`MSG_CONFIRM_CARDS` — Pot of Desires, Maxx "C", scry, etc.). Le filtre
serveur actuel est statique par location ; il n'entretient pas d'état
durable *"cette carte a été révélée publiquement à T1, donc elle reste
révélée jusqu'à ce qu'elle quitte sa location courante"*.

**Rapport au chantier pipeline** : conceptuellement orthogonal. Le
pipeline consomme un flux et affiche ce que le flux contient. Si une
carte arrive avec `cardCode = 0`, le pipeline affiche un card-back —
c'est juste. Le bug est *en amont*, côté serveur ou côté contrat
de flux.

**Décision actée** : ce sujet sera traité **en parallèle** du chantier
pipeline, sous forme d'un **spike d'investigation court** (1-2 jours)
au démarrage. Le spike répond à trois questions :

1. Le filtrage actuel (`message-filter.ts`) est-il purement statique,
   ou contient-il déjà un début d'état dynamique ?
2. Quels événements WS sont concernés par les révélations
   conditionnelles ?
3. Quelle est la complexité estimée pour rendre le filtre dynamique ?

Selon les réponses :
- **Si la modification est légère** → on l'inclut dans le scope pipeline,
  on profite du momentum.
- **Si elle est lourde** → on l'isole en chantier séparé, le pipeline
  continue avec le contrat de flux actuel + on documente la dépendance.

Le spike informe le contrat de flux du pipeline sans le bloquer.

### 5.2 Couche de projection — algorithme figé (POC statué)

La perspective comme couche de projection visuelle au-dessus du pipeline
est l'idée structurelle clé du chantier. Le POC a été exécuté sur
3 demi-journées et a statué la stratégie + l'algorithme. Sortie complète
dans `_bmad-output/poc-projection/` (day1-findings.md, day2-findings.md,
decision.md).

**Décisions actées (2026-05-25, statuées après POC)** :
- Modèle = **transform CSS unique** sur le container racine `.board-host`
  (pas de re-render data perspective-relative). Confirmé.
- Scénario cible = **switch in-flight pendant travel de carte doit
  marcher**. Atteint via S3 (coords container-relative).

**Stratégie retenue : S3 — coords container-relative + re-parent floats**

Une fois les floats parentés sous `.board-host` et les keyframes
calculées en container-local, **un switch de perspective devient un
`style.transform = 'rotate(180deg)'`** appliqué à un seul élément.
Aucune coordination JS, aucune annulation, aucun tracking d'animations
en cours. Cross-browser Chromium + WebKit validé (J1 T6).

**Algorithme de switch perspective** (pseudo-code) :

```typescript
// Source de vérité : un signal partagé via DuelContext étendu.
interface PerspectiveSource {
  perspective(): WritableSignal<0 | 1>;  // 0 = own bottom, 1 = flipped
  switching(): Signal<boolean>;          // debounce / no-double-fire
}

// Composant racine du board observe le signal et applique le transform.
@Component({ template: `<div class="board-host" [style.transform]="boardTransform()"> ... </div>` })
class PvpBoardContainerComponent {
  protected readonly boardTransform = computed(() =>
    this.duelCtx.perspective()() === 1 ? 'rotate(180deg)' : 'rotate(0deg)'
  );
  // CSS : .board-host { transform-origin: center center; transition: transform 250ms cubic-bezier(...); }
  // Pendant les 250ms, les floats en cours de travel continuent leur
  // animation WAAPI — leur trajectoire est en coords container-local,
  // donc le browser interpole la projection viewport sans coordination
  // JS (T6 prouvé J1 sur Chromium + WebKit).
}

// API publique : déclencher un switch.
function switchPerspective(target: 0 | 1) {
  if (this.duelCtx.switching()) return;     // pas de re-entry
  if (this.promptActive()) return;          // convention : pas pendant prompt
  this.duelCtx.perspective().set(target);   // signal flip
  // Pas d'autre action : tout est CSS-driven.
}

// Composants observateurs (mode B — contenu orienté qui doit contre-rotater) :
class PvpLpBadgeComponent {
  protected readonly textCounterRotation = computed(() =>
    this.duelCtx.perspective()() === 1 ? 'rotate(180deg)' : 'rotate(0deg)'
  );
  // template: <span class="lp-value" [style.transform]="textCounterRotation()">{{ lp }}</span>
}

// DuelContext.cardBaseRotation est lui-même perspective-aware (option B.1).
cardBaseRotation(relPlayer: number): number | undefined {
  const flipped = this.perspective()() === 1;
  const isOwn = relPlayer === 0;
  if (flipped) return isOwn ? 180 : undefined;
  return isOwn ? undefined : 180;
}
```

**Invariants à protéger** :

1. `perspective()` est lu UNIQUEMENT via `DuelContext` — pas de duplication signal.
2. `CardTravelEngine.registerContainer(boardHost)` est appelé une fois
   au mount de `pvp-board-container`, jamais re-call.
3. Les coords keyframes sont **container-local** (delta calculé par
   `rect.x - containerRect.x`, etc.), JAMAIS viewport-local.
4. Aucun composant ne lit `getBoundingClientRect()` post-keyframe-build
   pour piloter une animation en cours.
5. `cardBaseRotation` reste dans `DuelContext` — pas de copie locale.

**Anti-patterns à interdire (cible CI lint)** :

- `style.position = 'fixed'` sur un float in-game (briserait le flip).
- `document.body.appendChild` pour un élément de jeu.
- Toute lecture de `getBoundingClientRect()` post-keyframe-build pour
  piloter une animation en cours (la projection peut avoir changé
  entre le getRect et le frame suivant).

**Mode de traitement des éléments hors-container** :

| Élément | Mode | Action |
|---|---|---|
| Card travel floats (FloatRegistryService) | A | `registerContainer(boardHost)`, coords container-local |
| Slam dust, pre-destroy, activate (BoardEffectsService) | A | même `_container` que travel floats |
| Target indicator floats (TargetIndicatorManager) | A | délègue à BoardEffectsService |
| Attack line + clash impact (BattleAnimationTracker) | A | via `createLineBetween` dans card-travel-engine |
| LP badges (placement, `app-pvp-player-card`) | A natif | déjà DANS `.board-host` |
| Texte LP + deltas (contenu badges) | B | classe CSS contre-rotation conditionnée |
| `app-pvp-chain-overlay` (banner multi-link) | A | déplacer DOM dans `.board-host` (re-parent ~10 lignes) |
| `app-effect-bubble` (CDK overlay) | B | contre-rotation contenu + test `OverlayRef.updatePosition()` |
| `app-pvp-prompt-dialog` | Convention | pas de switch pendant prompt actif |
| `.cdk-overlay-container` (Material global) | n/a | hors-jeu |

**Effort d'implémentation chiffré** : **5-6.5j** un dev solo. Détail
dans `_bmad-output/poc-projection/decision.md §5`.

**Tests de non-régression obligatoires** : les specs Playwright J1+J2+J3
deviennent des regression assets permanents. Tests post-refactor à
ajouter : travel HAND→MZONE post-flip immédiat, switch mid-travel sur
board réel, multi-tribute + flip, chain résolvant + flip in-flight,
LP delta animation + flip, Pendulum scale + flip.

**Critères de succès chiffrés (figés au début, atteints au POC)** :
- Gap visuel au switch ≤ 2 frames — **0 frame en S3 (browser auto)**
- FPS ≥ 55 Chrome desktop — **60 fps mesurés J1+J2**
- FPS ≥ 30 Chrome mobile (CDP throttling 4×) — **60 fps mesurés**
  (mesure optimiste : translate CSS = compositor GPU, throttling
  affecte le JS thread)
- Cross-browser Chrome + WebKit — **parité parfaite J1**

**Statut** : ✅ POC concluant à 6/6 critères. Algorithme figé.

---

## 6. Tests de victoire

Le chantier est concluant ssi les deux bugs majeurs caractérisés en
amont sont éliminés. Ces tests servent de **critères d'acceptance** au
moment de la bascule V2 → production.

### 6.1 Bug SOLO mid-chain

Détail : `bug-solo-sequence.md`. Séquence WS T0-T10 reproductible
(SOLO PvP avec chain + switchPlayer mid-chain) qui produit aujourd'hui
deux symptômes : `Lock safety timeout HAND-0/GY-0` (5s) et
`POLL-DROP REGRESSION` (10s).

**Test automatisable** : harness Playwright SOLO PvP, force la chain,
force le switch mid-chain, assert absence des deux symptômes + état
correct du rendered board sous perspective P1.

### 6.2 Bug cost-before-overlay

Détail : `bug-cost-before-overlay-sequence.md`. Séquence WS T0-T13
canonique (opponent active Pot of Desires, player active Ash Blossom
discard) qui montre aujourd'hui l'overlay visible AVANT la fin de
l'animation du coût.

**Test automatisable** : harness Playwright replay de la séquence,
capture du DOM state à T5+1ms (overlay = false), T7+1ms (overlay =
true). Assert également absence des 4 régressions documentées dans le
pitfalls (cf. `cost-before-overlay-pitfalls-2026-05-25.md`).

### 6.3 Critères de bascule "draft → ready for implementation"

Le doc est ready ssi (pack complet, deadline 2026-06-15) :
- Sections 1-5 écrites + TOC finale figée
- R1 POC projection exécuté + algorithme de switch perspective intégré
- R4 bugs caractérisés (cf. §6.1 et §6.2) — ✅ fait
- Section Existant→Cible écrite (§4) — ✅ fait
- Catalogue deferred effects produit (5-15 cas concrets)
- Revue finale par `bmad-agent-architect`

---

_Cadrage clos 2026-05-25. Le doc est désormais le référentiel de
l'implémentation. Toute modification structurelle ultérieure (ajout
d'un principe, refonte d'une section) doit passer par une nouvelle
itération de revue BMad+architecte. Les ajustements éditoriaux mineurs
(typos, exemples additionnels, références mises à jour pendant
l'implémentation) sont libres._
