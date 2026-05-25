---
title: Plan d'implémentation — Chantier refonte pipeline d'animation
status: ready (point d'entrée pour démarrer le code)
parent_chantier: duel-session-chantier.md
date: 2026-05-25
target_branch: feat/anim-pipeline-v2 (à créer depuis chore/queue-runner-palier-0)
deadline_phase_alpha: 2026-06-15 (3 semaines)
---

# Plan d'implémentation — Chantier refonte pipeline d'animation

Ce document est le **point d'entrée d'implémentation**. Il découpe les 3
phases du cadrage (`duel-session-chantier.md §4.3`) en stories
exécutables. Chaque story a un livrable concret, un critère
d'acceptation testable, et un effort chiffré.

**Référentiel** : tous les choix d'architecture sont actés dans
`duel-session-chantier.md` (ready 2026-05-25). Ce plan ne re-décide
rien — il exécute.

---

## §0 Prérequis avant de coder

Cocher ces 3 items avant la première ligne de code de la phase α :

- [x] **Branche dédiée** : créer `feat/anim-pipeline-v2` depuis
  `chore/queue-runner-palier-0` (qui contient le commit du cadrage
  `7403caa9`). Le code phase α se développe là, pas sur master.
  **Pas de feature flag** — refactor in-place, V1 disparaît au merge
  (cf. cadrage §4.5). ✅ Fait 2026-05-25 (HEAD `14df1caa`).
- [x] ~~**Snapshots de référence V1 + harness Playwright parité**~~ —
  **DROPPED 2026-05-25 après prototypage**. Tentative : un harness
  Playwright qui rejoue 3-5 replays canoniques et compare l'état
  final (board sérialisé + journal + chainPhase). Honest verdict
  après l'avoir codé : à l'**end-of-replay**, locks vides, chain
  idle, animation queue drainée — il ne reste que le board final
  + le journal. C'est un oracle **macro post-mortem**, pas un
  oracle d'animation. Il catche "le pipeline a abouti correctement"
  (board ou journal différent = régression) mais **pas** "le pipeline
  anime juste" (réordering interne, timing, états intermédiaires
  pendant les chains passent silencieusement). Décision : pas de
  faux sens de sécurité — on s'appuie sur (a) les 1379 tests
  unitaires existants, (b) les tests ciblés par story (chaque
  story livre son test de comportement attendu), (c) les deux
  tests de victoire dédiés (`bug-solo-sequence.md` β.2,
  `bug-cost-before-overlay-sequence.md` γ.7), (d) validation
  manuelle UI solo en fin de chantier (§4 cadrage). Branche reste
  isolée de master, V1 reste mergeable, donc le risque cassage
  prod = 0.
- [x] **Erreur TS pré-existante à fixer en amont** :
  `front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:50-51`
  — NO-OP. L'erreur n'existe plus sur `chore/queue-runner-palier-0`
  (tsc + build + 1379 specs verts au 2026-05-25). Probablement
  corrigée par un commit upstream entre la rédaction de la mémoire
  `cost-before-overlay-failed-2026-05-25` et le démarrage de cette
  branche. Pas de fix à appliquer.

---

## §1 Phase α — Adaptation du socle existant (~2-3 semaines)

**Objectif** : préparer le terrain pour les nouveaux processors (β) sans
introduire de nouveau processor. Tout le travail α est sur le socle
existant.

**Note de relecture 2026-05-25** : toutes les références "test parité"
dans ce plan (et dans les §β, §γ, §4 bascule) datent d'avant
l'abandon du harness V1 vs V2 (cf. §0). Concrètement :
- "test parité" = à requalifier en **test ciblé par story** (la story
  livre le test qui prouve son acceptance criterion).
- "snapshots V1" / "oracle V1" = à ignorer (aucun snapshot capturé).
- "validation finale §4" = lecture allégée : les 2 tests de victoire
  (β.2 cost-before-overlay, γ.7 SOLO mid-chain) + validation manuelle
  UI solo + 1379 specs existantes restent les garde-fous.

**Test d'acceptation phase α** : lint custom actif en CI + 1379 specs
unitaires verts + chaque story a livré son test ciblé d'acceptance.

### Story α.1 — Lint custom "tag obligatoire pour signals" (~0.5-1j)

**Livrable** : ESLint rule custom `pipeline-signal-tagged` qui refuse
tout `signal<T>()` dans `front/src/app/pages/pvp/` ne déclarant pas
explicitement sa nature.

**Convention de tag** (par préfixe/suffixe ou décorateur) :
- `_transport_<name>` → état de transport interne (§3.2)
- `<name>Source` ou décorateur `@Environment` → entrée d'environnement
- Tout autre signal → doit être enregistré dans une `BaseProjection`
  (story α.2)

**Critère d'acceptation** :
- `npm run lint` détecte un signal non-tagué dans un fichier de test
- Aucun warning sur le code actuel après refactor de tagging
- CI fail sur PR introduisant un signal non-tagué

**Pourquoi en premier** : c'est le filet de sécurité qui empêche
toute régression pendant les stories suivantes. Le lint catche les
oublis avant qu'ils ne fassent dette.

**Risque** : ~0. Lint custom est outillage standard.

### Story α.2 — `BaseProjection<T>` + `ScopeResetDispatcher` (~1-2j)

**Livrable** : nouvelle infra dans
`front/src/app/pages/pvp/projections/` :

```typescript
// types/scope.ts
export type ScopeCategory =
  | 'SESSION_LIFETIME'
  | 'DUEL_LIFETIME'
  | 'CONNECTION_LIFETIME'
  | 'PERSPECTIVE_LIFETIME';

export interface CheckpointPayload {
  source: 'STATE_SYNC' | 'RematchStarted';
  // ... structure à compléter selon ws-protocol
}

// projections/base-projection.ts
export abstract class BaseProjection<T> {
  abstract readonly scope: ScopeCategory;
  abstract readonly value: Signal<T>;
  abstract applyEvent(event: FluxEvent): void;
  abstract applyReset(
    invalidatedScopes: Set<ScopeCategory>,
    checkpointPayload?: CheckpointPayload
  ): void;
}

// projections/scope-reset-dispatcher.ts
export class ScopeResetDispatcher {
  private projections = new Set<BaseProjection<unknown>>();
  register(p: BaseProjection<unknown>): void { /* duelAssert scope declared */ }
  dispatch(invalidatedScopes: Set<ScopeCategory>, payload?: CheckpointPayload): void;
}
```

**Critère d'acceptation** :
- Spec unit : un `BaseProjection` qui n'override pas `scope` ne
  compile pas (TypeScript abstract enforce)
- Spec unit : `dispatch({ PERSPECTIVE_LIFETIME })` appelle `applyReset`
  uniquement sur les projections de scope `PERSPECTIVE_LIFETIME`
- Spec unit : `dispatch({ DUEL_LIFETIME })` invalide aussi
  `CONNECTION_LIFETIME` et `PERSPECTIVE_LIFETIME` (par inclusion
  hiérarchique)

**Pourquoi en deuxième** : infra utilisée par toutes les stories
suivantes (α.3-α.6).

**Risque** : faible. Pattern standard. Attention à bien définir la
hiérarchie d'invalidation (un reset DUEL_LIFETIME doit invalider les
catégories en-dessous).

### Story α.3 — QueueRunner wrapper léger (~1-2j)

**Livrable** : adapter `front/src/app/pages/pvp/queue-runner.ts` selon
le verdict R2 de `duel-session-chantier-critiques.md §1bis` :

1. Ajouter callback `onInternalEvent?: (event: InternalTransportEvent) => void`
   à `QueueRunnerDeps`. Le runner émet vers le flux les transitions
   notables (timer armé/déclenché, rescue, finalize) au lieu de les
   logger uniquement.
2. Déclarer les 5 lifecycle primitives (`_isRunning`,
   `_isProcessing`, `_innerLoopDepth`, `_abort`, `_rescueNoProgressCount`)
   avec un commentaire `// scope: PERSPECTIVE_LIFETIME` chacune.
3. Renommer les 5 primitives en `_transport_*` pour matcher la
   convention du lint α.1 (ou les exempter explicitement via
   commentaire `// eslint-disable-next-line pipeline-signal-tagged`
   si on préfère garder le nom court — décision à acter au commit).

**Critère d'acceptation** :
- Les 27 specs existantes du QueueRunner passent toujours
- Le callback `onInternalEvent` est appelé au moins une fois en cas
  de rescue (vérifié dans une spec dédiée)
- Lint α.1 passe sur queue-runner.ts

**Pourquoi en troisième** : autonome, peut partir en parallèle de α.4.
Pas de blocage downstream.

**Risque** : faible. Le code existe, on ajoute juste 1 callback.

### Story α.4 — Requalifier les managers en projections (~3-5j)

**Livrable** : convertir 5 managers en `BaseProjection` sous-classes :

| Manager | Scope | Effort |
|---|---|---|
| `ChainResolutionManager` | `CONNECTION_LIFETIME` | 1-2j |
| `LpAnimationTracker` | `PERSPECTIVE_LIFETIME` (animation) + `DUEL_LIFETIME` (`_pendingLpCommits`) | 0.5-1j |
| `BattleAnimationTracker` | `PERSPECTIVE_LIFETIME` | 0.5j |
| `BoardEffectsService` | timers = transport state, pas projection | 0.5j |
| `DuelGameLogService` | `DUEL_LIFETIME` | 0.5-1j |

Pour chaque manager :
1. Faire hériter de `BaseProjection<T>` (T = type de l'output principal)
2. Déclarer le scope
3. Implémenter `applyReset(scopes, payload?)` au lieu de mutations
   ad-hoc actuelles
4. Enregistrer auprès du `ScopeResetDispatcher` à l'instanciation

**Critère d'acceptation** :
- Les specs unit existantes de chaque manager passent toujours
- Un nouveau test parité (Playwright) vérifie qu'un `PerspectiveSwitched`
  ne reset PAS les `_pendingLpCommits` (DUEL_LIFETIME) mais reset
  l'`animatingLpPlayer` (PERSPECTIVE_LIFETIME)
- Lint α.1 passe

**Pourquoi en quatrième** : dépend de α.2 (BaseProjection existe). Peut
être parallélisé en sous-stories par manager si on a la main d'œuvre.

**Risque** : moyen. C'est là que les bugs de scope mal-déclaré peuvent
apparaître. Le test parité de l'étape §0 doit catcher.

### Story α.5 — `AnimationOrchestratorService` read-only pour projections (~1-2j)

**Livrable** : retirer toutes les mutations directes de signaux
managers depuis l'orchestrator. L'orchestrator devient :
- Producteur d'événements pour le flux (via `dataSource`)
- Consommateur de signaux (lecture seule pour la dispatch logic)
- Aucune écriture sur des projections

Les écritures restantes (cf. CLAUDE.md §"Orchestrator Decomposition")
doivent toutes passer par `applyEvent` sur le flux.

**Critère d'acceptation** :
- Aucun appel `.set()` direct sur un signal de projection depuis
  `animation-orchestrator.service.ts`
- Les specs existantes du orchestrator passent toujours
- Lint custom (à ajouter en bonus α.1) qui détecte
  `manager._signal.set(...)` cross-fichier

**Pourquoi en cinquième** : dépend de α.4 (managers requalifiés). Sans
les projections, on ne sait pas ce qui devrait être read-only.

**Risque** : moyen-haut. C'est le code le plus touché. Le test parité
est critique ici.

### Story α.6 — Spike α-prérequis : info hiding dynamique (~1-2j, parallèle)

**Livrable** : implémenter le verdict R3 de
`duel-session-chantier-critiques.md §1bis` côté serveur :

1. Ajouter `revealedCards: Map<"${player}-${location}-${sequence}", cardCode>`
   au state `ActiveDuelSession` (`duel-server/src/duel-session-manager.ts`)
2. Muter à `MSG_CONFIRM_CARDS` public (`worker-message-router.ts`)
3. Nettoyer à `MSG_MOVE` (carte quitte sa location)
4. Augmenter `sanitizeOpponentBoard()` dans `message-filter.ts` pour
   consulter la Map au filtrage BOARD_STATE
5. Tests : couvrir Pot of Desires, Maxx "C", Foolish Burial Goods

**Critère d'acceptation** :
- Replay d'un duel avec Pot of Desires : la carte révélée à T1 reste
  visible (card-code transmis, pas null) jusqu'à T2 si elle ne bouge pas
- Test parité V1 vs V2 : les replays anciens sont toujours lisibles
- Format WS inchangé (toujours `cardCode` ou `null`)

**Pourquoi parallèle de α** : indépendant du front. Peut être fait par
quelqu'un d'autre ou en alternance.

**Risque** : faible. Verdict d'investigation = "léger 1-2j" confirmé.

### Story α.7 — Tagger le code existant + erreur TS fix (~0.5-1j)

**Livrable** :
1. Fixer l'erreur TS `solo-duel-orchestrator.service.ts:50-51` (item
   §0 prérequis — si pas encore fait)
2. Passer le lint α.1 sur tout `front/src/app/pages/pvp/` : tagger
   tous les `signal()` non-projections existants avec
   `_transport_*` ou `@Environment` selon le cas
3. Documenter dans CLAUDE.md la convention de tag

**Critère d'acceptation** :
- `npm run lint` zéro warning
- `npm run build` succès
- `npm test` zéro régression

**Pourquoi en dernier** : ramassage final. Toutes les stories
précédentes ont créé ou modifié des signaux ; on tag tout en une fois.

---

## §2 Phase β — Émergence des nouveaux processors (~3-4 semaines)

**Objectif** : implémenter `BoundaryProcessor` + `DeferredEffectProcessor`,
jeter `BufferReplayBuilder`. Faire passer le test cost-before-overlay.

### Story β.1 — `BoundaryProcessor` (~2-3j)

**Livrable** : `front/src/app/pages/pvp/processors/boundary-processor.ts`

Observe le flux WS et émet sur le flux les frontières
`ChainStarted(chainId)`, `ChainEnded(chainId)`, `TurnStarted(N, player)`,
`TurnEnded(N)`, `PhaseStarted(phase)`, `PhaseEnded(phase)`.

Cf. `duel-session-chantier.md §3.8` pour les contrats opérationnels
(sync mandatory, garantie flat OCGCore, closure forcée par checkpoint
et DuelEnded).

**Critère d'acceptation** :
- Spec unit : un `MSG_CHAINING(1)` → `ChainStarted(1)` émis avant
- Spec unit : un `MSG_CHAIN_END` → `ChainEnded(N)` émis après
- Spec unit : `DuelEnded` avec chain ouverte → `ChainEnded` synthétisé
- Test parité Playwright : tous les replays anciens passent identique
  V1 vs V2 (les frontières n'affectent pas les projections actuelles)

### Story β.2 — `DeferredEffectProcessor` (~3-4j)

**Livrable** : `front/src/app/pages/pvp/processors/deferred-effect-processor.ts`

Implémente le mécanisme ε3 strict-pass + prédicat (cf.
`duel-session-chantier.md §3.7`). Table de 11 règles initiales basées
sur `deferred-effects-catalogue.md`.

**Critère d'acceptation** :
- Test #1 (overlay-show + cost Ash) — séquence T0-T13 de
  `bug-cost-before-overlay-sequence.md` passe en V2
- Test #2 (Snake-Eye Ash trigger post-summon) passe
- Test #8 (XYZ multi-matériaux) passe
- Test #11 (pile-target-float-cleanup) passe
- Tests d'invariants : collision noms `duelAssert`, timeout émet
  `EffectAbandoned`, checkpoint émet `EffectAbandoned`
- Spec unit : processor pur (entrées flux, sortie flux), aucune
  dépendance sur l'orchestrator

### Story β.3 — Projections consommatrices (~1-2j)

**Livrable** : refactorer les composants UI qui ont aujourd'hui de la
logique ad-hoc de timing (overlay component, target-indicator-manager,
etc.) pour lire `EffectReady` à la place.

**Critère d'acceptation** :
- L'overlay component ne contient plus aucune logique YGO de "j'attends
  quoi" — uniquement de la lecture d'`EffectReady('overlay-show')`
- Test parité Playwright : zéro régression visuelle

### Story β.4 — Jeter `BufferReplayBuilder` (~−5j, gain net) (~0.5j)

**Livrable** : supprimer
`front/src/app/pages/pvp/animation/buffer-replay-builder.ts`. Tout son
rôle est absorbé par le flux unique avec frontières (β.1) et deferred
(β.2).

**Critère d'acceptation** :
- Le fichier est supprimé
- Tous les tests passent
- Test parité OK sur replays anciens

---

## §3 Phase γ — Couche de projection + refonte SOLO (~2 semaines)

**Objectif** : implémenter S3 (POC projection) + refondre
SoloDuelOrchestratorService en single-processor. Faire passer le test
bug SOLO.

### Story γ.1 — Refactor `CardTravelEngine` viewport → container coords (~1.5-2j)

**Livrable** : modifier
`front/src/app/pages/pvp/animation/card-travel-engine.service.ts` :
- `registerContainer(boardHost)` au lieu du duel-page host actuel
- `card-travel-helpers.ts` : deltas calculés en container-local
  (`rect.x - containerRect.x`) au lieu de viewport-local
- Float positioning : `style.left/top` relatifs au container

Cf. `_bmad-output/poc-projection/decision.md §5` pour le détail.

**Critère d'acceptation** :
- Tests Playwright `poc-projection-board.spec.ts` portés en
  regression assets passent
- Aucune régression visuelle sur les travels existants (test parité)

### Story γ.2 — Alignement `BoardEffectsService` + `BattleAnimationTracker` (~1j)

**Livrable** : aligner les autres services qui créent des floats sur
le même container (`.board-host`). Cf. tableau "Mode A" du
`decision.md §3`.

**Critère d'acceptation** :
- Tous les floats (travel, slam dust, pre-destroy, activate, target
  indicator, attack line) sont enfants de `.board-host`
- Spec unit : grep `document.body.appendChild` dans le pipeline = 0

### Story γ.3 — `DuelContext` perspective signal + `cardBaseRotation` aware (~0.5j)

**Livrable** : étendre
`front/src/app/pages/pvp/duel-page/duel-context.ts` :
- Ajouter signal `perspective: WritableSignal<0 | 1>`
- `cardBaseRotation(relPlayer)` devient perspective-aware (option B.1)

Cf. `decision.md §2`.

**Critère d'acceptation** :
- Spec unit : `cardBaseRotation` retourne 180 pour own en perspective 1
- Pas de régression sur les 5 sites d'appel existants

### Story γ.4 — Mode B contre-rotation (texte LP + deltas + effect bubble) (~1j)

**Livrable** : pour les éléments dont le **contenu** ne doit pas
flipper visuellement même si leur container flip, ajouter une
contre-rotation conditionnée par `perspective()`.

Cf. tableau "Mode B" du `decision.md §3`.

**Critère d'acceptation** :
- Capture visuelle après flip : "8000" LP reste lisible (pas inversé)
- Capture visuelle : effect bubble contenu reste lisible

### Story γ.5 — Re-parent chain overlay dans `.board-host` (~0.5j)

**Livrable** : déplacer `app-pvp-chain-overlay` du `main.dark-theme-content`
vers `.board-host`. Le `position: fixed; inset:0` devient relatif au
board, le flip gère automatiquement.

**Critère d'acceptation** :
- Chain overlay s'affiche au bon endroit avant ET après flip
- Test Playwright : chain overlay actif + flip in-flight = aucun
  saut visuel

### Story γ.6 — Switch perspective UI + `PerspectiveSwitched` event (~0.5j)

**Livrable** :
- API `switchPerspective(target)` dans `PvpBoardContainerComponent`
  (cf. pseudo-code `duel-session-chantier.md §5.2`)
- Émission de `PerspectiveSwitched(playerIndex)` sur le flux
- Lock UI pendant prompt actif (convention §3.6.1 spec POC)

**Critère d'acceptation** :
- Click sur le bouton SOLO switch déclenche le flip CSS
- Pas de re-entry possible (debounce via `switching()` signal)
- Lock UI pendant prompt vérifié manuellement

### Story γ.7 — Refonte `SoloDuelOrchestratorService` single-processor (~5-7j)

**Livrable** : refondre
`front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts`
selon §4.1 du cadrage et §3.5 (chain state `CONNECTION_LIFETIME`).

**Changement structurel principal** : remplacer les 2 instances
parallèles de `DuelConnection` / `DuelEventProcessor` par **une seule
instance** partagée, et faire du switchPlayer une émission de
`PerspectiveSwitched` sur le flux (au lieu d'un change d'instance).

**Critère d'acceptation** :
- Test bug SOLO (séquence T0-T10 de `bug-solo-sequence.md §2`) passe :
  aucun `Lock safety timeout`, aucun `POLL-DROP REGRESSION`
- L'état chain (links, phase) survit au switch
- Les `DeferredEffect` pending survivent au switch (cohérent §3.7
  lifecycle)

### Story γ.8 — Tests regression Playwright (~0.5j)

**Livrable** : porter `front/e2e/poc-projection-*.spec.ts` (du commit
`7403caa9`) dans `front/e2e/` propre, les wirer en CI pour catch les
régressions.

Ajouter les nouveaux tests cités dans
`_bmad-output/poc-projection/decision.md §6.2` :
- Travel HAND→MZONE post-flip immédiat
- Switch mid-travel sur board réel
- Multi-tribute + flip
- Chain résolvant + flip in-flight
- LP delta + flip
- Pendulum scale + flip

**Critère d'acceptation** : tests verts en CI sur la branche feat/.

---

## §4 Bascule (merge branche → master)

### Validation finale avant merge

- [ ] **Tous les tests de victoire passent** :
  - `bug-solo-sequence.md` (γ.7)
  - `bug-cost-before-overlay-sequence.md` (β.2)
  - Tests Playwright regression γ.8
- [ ] **Test parité contre snapshots V1** : zéro diff sur le set de
  replays canoniques, **hors** les deux diffs attendus correspondant
  aux deux bugs résolus
- [ ] **Lint custom CI** sans warning
- [ ] **Couverture tests** ≥ 85% sur les processors (DeferredEffect,
  Boundary, BaseProjection) — cf. §2 cadrage
- [ ] **Performance** : pic ~60 events/s mesuré en condition réelle
  (cf. §3.9), pas de dégradation FPS perçue
- [ ] **Captures visuelles validation** : 1-2 captures par PR sur
  perspective 1 avec carte face-up + LP delta + chain overlay (règle
  `decision.md §11`)

### Merge

- [ ] **Merge `feat/anim-pipeline-v2` → master en une fois**. V1
  disparaît au merge. Aucune coexistence runtime post-merge (cf.
  cadrage §4.5 "stratégie de bascule").
- [ ] **1 semaine d'usage solo post-merge** : jouer plusieurs duels
  SOLO et replays variés. Si régression : fix via PR dédiée sur
  master, pas de revert global.
- [ ] Quand la semaine est passée sans régression visible : le
  chantier est officiellement clos. Mettre à jour CLAUDE.md pour
  refléter les nouveaux composants et les conventions
  (BaseProjection, scope categories, DeferredEffectProcessor,
  BoundaryProcessor, container-local coords).

---

## §5 Récapitulatif effort

| Phase | Stories | Effort | Cumul |
|---|---|---|---|
| Prérequis §0 | 4 items | <0.5j | <0.5j |
| **Phase α** | α.1 → α.7 | **8-13j** | 8-13j |
| **Phase β** | β.1 → β.4 | **6-9j** | 14-22j |
| **Phase γ** | γ.1 → γ.8 | **10-13j** | 24-35j |
| Bascule | validation + 2 sem stabilisation | ~2j | 26-37j |
| **Total** | | **26-37j** | (cohérent avec 30-45 j-h cadrage marge incluse) |

L'écart en bas de fourchette (26j vs 30j cadrage) vient du gain net
`BufferReplayBuilder` jeté (−5j inclus en β.4). Marge cadrage utilisée
pour intégrations cross-stories et surprises.

---

## §6 Ordre d'exécution recommandé

Toutes les stories à l'intérieur d'une phase sont ordonnées par
dépendance. Stories qui peuvent partir en parallèle (équipe ≥ 2) :

- **α.6 (spike info-hiding serveur)** parallèle de tout α front
- **α.4 sous-stories par manager** peuvent partir en parallèle après
  α.2 livrée
- **β.1 (Boundary) + β.2 (Deferred)** peuvent partir en parallèle (β.3
  les consomme après)
- **γ.1 + γ.2** parallèles (touchent des services différents)
- **γ.3 + γ.4 + γ.5** parallèles (touchent des composants différents)
- **γ.7 (SOLO refonte)** doit attendre γ.1-γ.6

En solo, l'ordre linéaire α.1 → α.7 → β.1 → β.4 → γ.1 → γ.8 fonctionne.

---

## §7 Quoi commiter quand

Convention : 1 commit par story, message
`type(scope): short imperative`. Ne PAS faire de mega-commits qui
groupent plusieurs stories — chaque story doit être revertable
isolément si elle introduit une régression.

Exemples de messages cibles :
- `feat(anim-v2): add BaseProjection + ScopeResetDispatcher (α.2)`
- `feat(anim-v2): wrap QueueRunner with onInternalEvent callback (α.3)`
- `refactor(anim-v2): ChainResolutionManager extends BaseProjection (α.4)`
- `feat(anim-v2): add DeferredEffectProcessor (β.2, ε3 strict-pass)`
- `refactor(anim-v2): CardTravelEngine uses container-local coords (γ.1, POC S3)`
- `fix(solo): single DuelEventProcessor per duel (γ.7, bug SOLO)`

Tag commits intermediate par phase pour facilité de bascule :
- `git tag anim-v2-alpha` après α.7
- `git tag anim-v2-beta` après β.4
- `git tag anim-v2-gamma` après γ.8

---

## §8 Si quelque chose tourne mal

**Si une story bloque > 2× l'estimation** :
1. Stop. Pas de "encore un peu de patch".
2. Caractériser le blocage en 2 lignes (qu'est-ce qui résiste ?)
3. Choisir : (a) timeboxer 1 jour de plus pour finir, (b) revenir au
   cadrage et ajuster, (c) abandonner cette story et continuer avec
   une mitigation documentée.
4. Le critère "ce qui est attendu V2" est dans
   `duel-session-chantier.md`. Si ce critère devient infaisable, c'est
   le cadrage qu'il faut revisiter, pas l'implémentation.

**Si un test parité fail sans cause évidente** :
1. Capturer le diff précis (board state, journal, chainPhase)
2. Vérifier si c'est une régression V2 ou un bug V1 enfin visible
3. Documenter en commit message — ne pas faire semblant que rien ne
   s'est passé

**Si un bug observé n'est dans aucun test de victoire** :
1. Ajouter une story dédiée (mini-story bug-fix)
2. Caractériser le bug en séquence WS reproductible (comme
   `bug-solo-sequence.md`)
3. Ne pas le mixer avec une autre story en cours

---

## §9 Référentiel pour démarrer

Documents à avoir sous la main pendant l'implémentation :

| Doc | Quand le lire |
|---|---|
| `duel-session-chantier.md` | Référence permanente — relire la section concernée avant chaque story |
| `duel-session-chantier-architect-review.md` | Si une question d'architecture émerge — la revue Winston a déjà tranché 10 findings |
| `bug-solo-sequence.md` | Avant γ.7 |
| `bug-cost-before-overlay-sequence.md` | Avant β.2 |
| `deferred-effects-catalogue.md` | Avant β.2 — table de règles à implémenter |
| `_bmad-output/poc-projection/decision.md` | Avant γ.1 → γ.6 |
| CLAUDE.md sections "Orchestrator Decomposition", "Chain Event Processing" | Avant α.4 |

---

_Plan d'implémentation rédigé 2026-05-25, deadline phase α 2026-06-15.
Le plan est un guide ; les estimations sont des fourchettes, pas des
contrats. Si la réalité diverge significativement, mettre à jour ce
doc et expliciter la divergence dans le commit message concerné._
