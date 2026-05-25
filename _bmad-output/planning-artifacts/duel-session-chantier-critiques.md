---
title: Critiques arbitrées — Chantier refonte pipeline d'animation
status: arbitré + bloc 1 d'investigations unitaires statué (R2/R6/R8 résolus)
source_doc: duel-session-chantier.md (état au 2026-05-25, draft cadrage en cours)
review_passes:
  - bmad-review-edge-case-hunter (39 findings bruts)
  - bmad-review-adversarial-general (20 findings bruts)
  - bmad-advanced-elicitation/pre-mortem (8 scénarios bruts)
investigations_unitaires:
  bloc_1_done:
    - R8 — audit boardStateAfter consumption (marginal)
    - R2 — QueueRunner migration compatibility (conservé + wrapper mineur)
    - R6 — ε3 vs 4 tentatives cost-before-overlay (structurellement différent)
  bloc_2_done:
    - R5 — débit actuel events/s pic chain (actable tel quel)
    - EC-12 — RAM croissance long duel (OOM faible BO1/BO3, surveillé > 2h)
  bloc_3_done:
    - R3 — spike info-hiding complexité (LÉGER 1-2j, inclure dans scope)
    - EC-26 — boundaries imbriquées (FLAT suffit, garantie structurelle OCGCore)
  poc_executes:
    - R1 — POC projection : EXÉCUTÉ + STATUÉ (S3 retenue, 5-6.5j, decision.md complet, 6/6 critères §7 validés)
  caracterisations_bugs:
    - R4 — bug SOLO caractérisé (bug-solo-sequence.md, séquence T0-T10 reproductible)
    - R4 — bug cost-before-overlay caractérisé (bug-cost-before-overlay-sequence.md, séquence T0-T13 reproductible)
  catalogues_metier:
    - Deferred effects (11 cas, ε3 case-driven validé, 2 passes Explore) — deferred-effects-catalogue.md
  revue_architecte:
    - duel-session-chantier-architect-review.md — verdict "ready avec 5 corrections mineures + 3 questions ouvertes". 10 findings + 3 décisions actées (strict-pass + prédicat, flag flip = restart app, PerspectiveSwitched préserve deferred). Tous appliqués au doc cadrage.
  decisions_editoriales:
    - R7 deadline cadrage : 2026-06-15 (3 semaines)
    - R7 critères ready : pack complet (sections + POC + bugs + Existant→Cible + catalogue deferred + revue architect)
arbitrage_method:
  - 3 sous-agents Explore en parallèle (1 par passe)
  - Vérification : code skytrix + CLAUDE.md + mémoires user
  - Pass de cohérence inter-passes (déduplication, contradictions)
  - Bloc 1 : 3 sous-agents Explore unitaires sur risques à très haut coût d'incertitude
date: 2026-05-25
reviewer: Claude Opus 4.7 (1M context)
---

# Critiques arbitrées — Chantier refonte pipeline d'animation

Ce document consolide **3 revues indépendantes** menées sur `duel-session-chantier.md` à l'état "cadrage en cours", **arbitrées contre le code skytrix et la mémoire du projet**. Sur 67 findings bruts (39 edge-case + 20 adversarial + 8 pre-mortem), **47 sont retenus comme trous valides** à traiter dans la suite du cadrage. Les autres sont déduplicés, écartés ou archivés en annexe avec raison.

**Méta-rappel** : le cadrage n'est pas fini. Plusieurs trous concernent les sections futures (prérequis, scope, migration, tests, acceptance, rollback) ; ils sont conservés pour ne pas être oubliés à la rédaction.

---

## Sommaire

- [§1 Top risks consolidés (R1-R8)](#1-top-risks)
- [§1bis Verdicts du bloc 1 d'investigations unitaires](#1bis-bloc1)
- [§2 Trous valides arbitrés (47 items)](#2-trous-valides)
- [§3 Findings dédupliqués ou écartés (raisons)](#3-ecartes)
- [§4 Contradictions inter-passes résolues](#4-contradictions)
- [§5 Patterns transverses](#5-patterns)
- [§6 Actions à très haute valeur (séquencées)](#6-actions)
- [§7 Risques résiduels post-bloc 1 (à investiguer)](#7-residus)
- [Annexe A — Verdict détaillé des 67 findings](#annexe-a)

---

<a id="1-top-risks"></a>
## §1 Top risks consolidés

Les risques **confirmés par ≥ 2 passes** après arbitrage. Priorisés par criticité opérationnelle = probabilité × coût × levier de mitigation.

| # | Risque | Passes | Probabilité revisitée | Action principale |
|---|---|---|---|---|
| **R1** | **POC projection sans seuils chiffrés** ✅ spec prête | EC-32, EC-33, ADV-17, PM-A | Moyenne — spec POC rédigée (`poc-projection-spec.md`) avec critères de succès chiffrés. Risque passe de "indéfini" à "à exécuter selon plan". | Exécuter la spec POC (3 demi-journées, timebox dur) — voir §1bis pour décisions Axel intégrées (transform CSS unique, switch in-flight pendant travel cible) |
| **R2** | **Existant ignoré (QueueRunner et 8 managers)** | EC-34, ADV-20, PM-C | **Haute** (PM revisité : QueueRunner extrait il y a 2j, doc parle comme si la table était vide) | Section "Existant → Cible" obligatoire : pour chaque composant, statut (conservé / wrappé / fusionné / jeté) + plan coexistence V1↔V2 |
| **R3** | **Spike info-hiding peut bloquer le chantier** | EC-31, ADV-16, PM-B | Moyenne | Démarrer pipeline sur contrat de flux **figé** (`message-filter.ts` état 2026-05-25 immutable) ; spike informe v2 seulement |
| **R4** | **Promesses non démontrées (races, bug SOLO, industrialisable)** | ADV-3, ADV-4, ADV-5, PM-H, EC-7 | Moy-faible mais embarrassant si avéré | Caractériser bug SOLO + cost-before-overlay en séquences WS reproductibles ; démontrer mécaniquement leur élimination |
| **R5** | **Coût débit non chiffré (§3.3 multiplie le volume)** | EC-12, EC-29, ADV-7, ADV-14, PM-D | Moyenne | Mesurer débit actuel (events/s pic chain 8+ liens) ; définir budget cible **avant** de figer §3.3 |
| **R6** | **Deferred-effect processor sous-dimensionné** (lifecycle, collisions, versioning) | EC-20, EC-21, EC-22, EC-24, EC-39, ADV-11 | Moyenne. ⚠️ Reformulé d'après PM-E : le risque réel n'est pas "table de règles qui gonfle" mais "mécanique de commit lifecycle cassée" (les 4 tentatives cost-before-overlay l'ont prouvé) | Lister les 5-15 cas concrets ET spécifier le lifecycle complet (timeout, collision, abandon par checkpoint, versioning) |
| **R7** | **Doc qui gonfle sans jamais shipper** | ADV-19, PM-F, EC-37 (acceptance) | Moyenne | Fixer maintenant : sections à écrire avant code vs découvertes-en-code ; deadline cadrage (proposé : 2026-06-01) |
| **R8** | **Asymétrie precompute/streaming niée** | EC-22, PM-G | Moyenne (PM-G a noté que cost-before-overlay #1 a justement échoué sur ce point) | Reconnaître le lookahead comme propriété de la dimension Transport ; lister projections strict-pass vs lookahead-dependent |

**Mise à jour finale (état au 2026-05-25 fin de session)** : tous les risques R1-R8 + EC-12 + EC-26 sont **résolus**. POC R1 **exécuté** et statué (S3 retenue, 5-6.5j d'effort chiffré). **Revue architecte exécutée** (`duel-session-chantier-architect-review.md`) — verdict "ready avec 5 corrections mineures + 3 questions ouvertes", **tous les 10 findings + 3 décisions actés** dans le doc cadrage (strict-pass + prédicat pour ε3, flag flip = restart app pour V1↔V2, PerspectiveSwitched préserve `CONNECTION_LIFETIME` y compris deferred). Pack complet "ready" à **6/6 items**. Le doc cadrage est **prêt pour bascule "draft → ready for implementation"** avant 2026-06-15.

---

<a id="1bis-bloc1"></a>
## §1bis Verdicts du bloc 1 d'investigations unitaires

Trois investigations unitaires ont été menées en parallèle pour statuer sur les risques à très haut coût d'incertitude. **Aucun verdict négatif** ne force une réécriture du cadrage.

### R8 — Asymétrie precompute/streaming : ampleur réelle

**Question** : `boardStateAfter` est-il un avantage marginal ou un prérequis structurel ?

**Méthode** : audit exhaustif des sites de lecture de `boardStateAfter` dans la pipeline front (animation orchestrator, managers, replay adapter, buffer replay builder).

**Verdict : MARGINAL.**
- **2 sites de lecture** seulement :
  - `animation-orchestrator.service.ts:802-803` (synchronisation logique, `if (boardStateAfter)` explicite)
  - `replay-duel-adapter.ts:swapEventBoardStates()` lignes 123-130 (transformation perspective, retour identité si absent)
- **Aucun site décisionnel** sans fallback.
- En mode Streaming (absence de `boardStateAfter`), comportement = dégradation gracieuse : skip de `updateLogical()` per-event, l'état logique saute au prochain `syncRendered()` — exactement le comportement actuel PvP live.

**Conséquence pour le cadrage** :
- La "neutralité unique et neutre" est défendable. À **expliciter** dans §1 reformulation : `LiveSource + Streaming` = strict-pass, pas de lookahead, comportement dégradé documenté.
- Dans §3.7 (deferred effects), la variante par mode Transport (lookahead vs strict-pass) reste à spécifier — c'est où l'asymétrie sera nommée.

### R2 — Plan de migration : QueueRunner conservable ?

**Question** : le QueueRunner extrait il y a 2 jours est-il compatible avec les 9 principes du cadrage ?

**Méthode** : lecture du code source + confrontation à chacun des 9 principes (§3.1 → §3.9).

**Verdict : CONSERVÉ + WRAPPER MINEUR (1-3 jours d'adaptation).**

| Principe | Verdict |
|---|---|
| §3.1 Flux unique | ✅ Compatible (consomme `animationQueue()` via deps, pas de flux parallèle) |
| §3.2 Projection vs transport | ✅ Compatible (5 lifecycle primitives explicitement transport) |
| §3.3 Events internes sur flux | 🟡 Adaptation mineure (+1 callback `onInternalEvent` dans `QueueRunnerDeps`) |
| §3.4 Absence de races | ✅ Compatible (AbortController + `_isProcessing` guard + `_innerLoopDepth` assertion) |
| §3.5 Scope persistance | 🟡 Adaptation mineure (déclaration de scope par primitive en commentaire) |
| §3.6 Checkpoints | ✅ Compatible (`requestStop()` zéro tout, l'orchestrator pilote) |
| §3.7 Effets différés | ✅ Compatible (aucune opinion sur corrélations cross-event) |
| §3.8 Frontières | ✅ Compatible (boundaries émises par un autre composant) |
| §3.9 Coût et discipline | ✅ Compatible (decideNextStep pure, logging gated) |

**Sauvegarde estimée** : 9-14 j-h vs réécriture, +3-4 j-h de tests (27 specs existantes).

**Conséquence pour le cadrage** :
- Le chantier est un **refactor incrémental** autour du QueueRunner, pas une réécriture.
- "Existant → Cible" (R2 action) : QueueRunner devient le composant nommé "moteur de transport" du §3.2.
- 2 adaptations à intégrer dans la spec d'implémentation : callback transport-event + déclaration de scope.

### R6 — ε3 vs 4 tentatives cost-before-overlay : structurellement différent ?

**Question** : le mécanisme `DeferredEffect` / `EffectReady` est-il une nouvelle approche ou une 5e variante du même pattern ?

**Méthode** : confrontation de ε3 à chacune des 4 tentatives échouées (single-pending+defer, IfNoSolvingQueued, DeferredIfBuilding+overwrite-protect, FIFO) + vérification contre les antipatterns proscrits et approches favorisées du pitfalls doc.

**Verdict : STRUCTURELLEMENT DIFFÉRENT.**

Les 4 tentatives jouaient toutes sur **"quand committer un état mutable `pendingChainEntry`"** (timing du commit / introspection queue / overwrite-protect / FIFO d'états). ε3 **supprime cet état mutable** et émet 2 événements indépendants sur le flux. Pas de commit = pas de "mauvais timing du commit" possible.

**Antipatterns proscrits évités** :
- ✅ FIFO sans cleanup → ε3 n'a pas de FIFO
- ✅ Predicat "X en queue" → ε3 observe le flux post-facto
- ✅ Overwrite-protect synchrone WS → ε3 ne commit rien
- ✅ Modification signature `pendingChainEntry` → ε3 ne touche pas la signature
- ✅ Flush bulk à MSG_CHAIN_END → ε3 émet fine-grained

**Réserves à intégrer dans la spec §3.7** :
1. **Processor isolé en composant testable indépendamment** (unit tests : flux → événements produits, fonction pure).
2. **Frontières §3.8 sont un prérequis du processor d'effets différés** — pour pouvoir raisonner sur les groupes causaux sans contamination cross-chain (élimine le bug de la tentative #4).
3. **4 scénarios de casse à couvrir au niveau projections consommatrices** (SOLO PvP switch, replay seek, burst SOLVING, animations parallèles) — les événements ε3 sont corrects, c'est leur consommation qui doit être robuste.

**Conséquence pour le cadrage** :
- §3.7 peut être acté comme résolution structurelle du risque cost-before-overlay.
- Le processor d'effets différés doit explicitement déclarer §3.8 comme prérequis.
- Ajouter §3.7bis "Tests obligatoires" listant les 4 scénarios.

### R1 — POC projection : STATUÉ (S3 retenue)

**Question** : la couche de projection (perspective comme transform CSS) est-elle viable + comment gérer le switch in-flight pendant travel de carte ?

**Statut** : ✅ **STATUÉ 2026-05-25**. POC exécuté sur 3 demi-journées (J1 Playwright isolé, J2 board PvP réel, J3 audit hors-container + décision). Sortie complète dans `_bmad-output/poc-projection/` (day1-findings.md, day2-findings.md, decision.md). 6/6 critères de succès §7 de la spec validés.

**Verdict** :
- **Stratégie sélectionnée : S3** (coords container-relative + re-parent floats sous `.board-host`). Robustesse permanente structurelle ; pas de coordination JS au switch ; cross-browser Chromium + WebKit prouvé.
- **Mode rotation carte : Option B.1** — `cardBaseRotation` devient perspective-aware (`DuelContext.cardBaseRotation` dépend du signal `perspective`). ~5 lignes dans `duel-context.ts`. Option A (suppression) écartée : casserait le rendu non-flippé.
- **Mode hors-container** : Mode A (re-parent dans `.board-host`) pour les floats anim et chain overlay ; Mode B (observer signal + contre-rotation) pour le texte LP, deltas LP, contenu effect bubble (chiffres/symboles orientés).

**Effort d'implémentation chiffré** : **5-6.5j** (un dev solo, sans surprise). Détail : 1.5-2j refactor `CardTravelEngine` viewport→container coords, 0.5-1j alignement `BoardEffectsService`, 0.5j `BattleAnimationTracker`, 0.5j signal `perspective` + `cardBaseRotation`, 0.5j contre-rotation LP/contenus, 0.5j chain overlay re-parent, 0.5j effect bubble + test CDK, 0.5j tests regression.

**Surprises notables (révisions post-J1)** :
- Coût S3 révisé **3-5j → 5-6.5j tout compris**. L'audit Q2 (J2) a montré que `CardTravelEngine` calcule en coords viewport-absolues et appendée les floats à duel-page host (pas `.board-host`). S3 n'est PAS "free lunch" comme suggéré J1.
- Erreur d'interprétation J2 sur les LP, corrigée J3 par sondage live : les LP badges flippent BIEN avec `.board-host` (mode A natif). Le doute venait de la symétrie 180° approximative des glyphs "8000" → "0008" — confirmé par Axel.
- FPS ≥ 30 mobile largement validé (60 fps sous CDP throttling 4×), mais mesure optimiste : CDP throttle le JS thread, pas le compositor GPU. À surveiller en condition réelle iOS Safari bas de gamme (backlog post-refactor).

**Tests de non-régression obligatoires** (à porter dans `front/e2e/` propre) :
- T1-T6 WAAPI isolé (`poc-projection-transform.spec.ts` + `playwright.config.poc.ts`)
- U1-U4 board réel (`poc-projection-board.spec.ts`)
- Probes DOM cartes + LP (`poc-projection-card-probe.spec.ts`, `poc-projection-lp-probe.spec.ts`)
- Tests post-refactor à ajouter : travel HAND→MZONE post-flip, switch mid-travel sur board réel, multi-tribute + flip, chain résolvant + flip in-flight, LP delta + flip, Pendulum scale.

**Conséquence pour le cadrage** :
- §1 reformulation : modèle "couche de projection au-dessus du pipeline" **confirmé** par le POC.
- §5.2 du doc cadrage **mis à jour** avec l'algorithme figé (pseudo-code + invariants à protéger + anti-patterns) — voir patch séparé.
- Le doc cadrage n'est plus bloqué par R1 ; les autres risques peuvent continuer leur cycle d'arbitrage.

### R5 — Débit actuel events/s pic chain : viabilité §3.3

**Question** : multiplier ×3-4 le volume d'événements (§3.3 ajoute AnimationStarted/Completed/ZoneCommitted) est-il viable en débit ?

**Méthode** : estimation statique par modélisation d'une chain YGO réaliste 8+ liens + croisement avec baselines `perf-audit-instrumentation-chantier.md` (replay a8859c98 : 153 réponses sur ~30 tours, buildBoardState 3.87 ms moyen / 6.7 ms max).

**Verdict : ACTABLE TEL QUEL.**

| Métrique | Seuil de risque | Actuel | Après §3.3 (×3-4) | Statut |
|---|---|---|---|---|
| Pic events/s | 2000 | ~25 | ~60 | ✅ 30-100× sous le seuil |
| Moyen events/s | 500 | ~3 | ~7 | ✅ |

Chain 8 liens actuelle : 56 events bruts (32 métier + 24 contrôle). Après §3.3 : ~152 events (32 métier + 96 internes + 24 contrôle). YGO génère des dizaines d'events/s, pas des milliers — aucun risque matériel WS ou JSON serialization.

**Conséquence pour le cadrage** :
- §3.3 peut être figé sans dégradation.
- §3.9 peut chiffrer le coût : "+3 events internes par event métier animatable, pic estimé ~60 events/s sur chain 8+ liens, ordre de magnitude négligeable vs seuil 2000 events/s".
- Prérequis : Phase 1 de l'audit perf doit capturer la baseline réelle (instrumentation Phase 0b) — confirmation, pas validation bloquante.

### R3 — Spike info-hiding : complexité de rendre `message-filter.ts` dynamique

**Question** : 1-2 jours (à inclure dans scope chantier) ou 1-2 semaines (à isoler en chantier séparé) ?

**Méthode** : lecture exhaustive de `duel-server/src/message-filter.ts` (stateless pur), `replay-precompute.ts` (omniscient bypass), grep des manipulations `MSG_CONFIRM_CARDS` dans duel-server + front, estimation de la solution minimale.

**Verdict : LÉGER (1-2 jours).**

**Solution minimale** :
- Ajouter `revealedCards: Map<"${player}-${location}-${sequence}", cardCode>` au state `ActiveDuelSession`
- Muter à `MSG_CONFIRM_CARDS` (public) — enregistre la révélation
- Nettoyer à `MSG_MOVE` — la carte quitte sa location, oubli
- Augmenter `sanitizeOpponentBoard()` pour consulter la Map au filtrage `BOARD_STATE`
- 4 fichiers touchés (~50-80 LOC + ~15-20 LOC tests)

**Impact** :
- Format WS inchangé (toujours `cardCode` ou `null`, seul contenu change)
- Replays stockés restent valides (sous-révélés mais pas cassés)
- Idempotence du replay précompute préservée (omniscient bypass la Map)

**Conséquence pour le cadrage** :
- **Inclure dans scope** comme micro-chantier "Info hiding dynamique" en Palier 0 — stabilise le contrat de flux avant que le pipeline commence à le consommer.
- §4.1 connexes du cadrage peut acter la décision et retirer la question.
- Pas de risque de blocage cyclique avec le chantier pipeline (PM-B mitigé).

### EC-26 — Boundaries imbriquées : flat ou stack semantics ?

**Question** : chain-in-chain (Mind Crush sur cost, etc.) impose-t-il stack semantics dans §3.8 ?

**Méthode** : lecture de `ocgcore-technical-reference.md` + `yugioh-game-rules.md` + inspection `chain-state-tracker.ts` (notamment test `MSG_CHAINING after MSG_CHAIN_SOLVING`) + grep 16 cartes EVENT_CHAINING + vérification meta (Snake-Eye, DDD, Branded, Spright).

**Verdict : FLAT BOUNDARIES SUFFISENT.**

**Garantie structurelle OCGCore** :
- Phase chain = state linéaire `idle → building → resolving → idle`
- `MSG_CHAINING` reçu pendant `resolving` accumule un link à la chain courante, **ne flip jamais vers `building`**
- Aucune nouvelle chain ne peut démarrer avant `MSG_CHAIN_END`
- Test `chain-state-tracker.spec.ts:68-77` documente explicitement ce cas

**Cartes "candidates" (16 cartes EVENT_CHAINING)** : Ash Blossom, Ghost Ogre, Veiler, etc. — toutes Quick Effects qui chainent **en réaction** à une activation, pas pendant un cost. Aucun cas empirique de chain-during-cost dans les decks meta 2026 skytrix.

**Conséquence pour le cadrage** :
- §3.8 peut spécifier flat semantics explicitement.
- Phrase suggérée à intégrer : *"OCGCore garantit une sémantique flat des boundaries : aucune nouvelle chain ne peut commencer jusqu'à ce que la chain courante soit fully resolved et `ChainEnded` ait été émis. Cette garantie structurelle élimine le risque EC-26."*
- Risque résiduel : N/A.

### EC-12 — RAM croissance long duel : politique de rétention nécessaire ?

**Question** : la croissance unbounded du flux (×3-4 après §3.3) cause-t-elle un OOM browser sur un best-of-3 (~45min) ?

**Méthode** : estimation statique par triangulation taille event × volume × multiplication §3.3, croisement avec audit Phase 0.5 (replay a8859c98 = ~250-300 events métier, BO3 estimé ~500-750).

**Verdict : OOM FAIBLE pour BO1/BO3 (~1.5-3 Mo), SURVEILLÉ pour sessions > 2h (arcade, exhibition).**

| Scénario | Flux brut | Heap total (×2.5 overhead) | Statut |
|---|---|---|---|
| BO1 actuel | ~160 Ko | ~400 Ko | ✅ |
| BO3 actuel | ~480 Ko | ~1.2 Mo | ✅ (< 5% de 50 Mo budget) |
| BO3 post-§3.3 | ~960 Ko | ~2.4 Mo | ✅ |
| Session 2h+ post-§3.3 | non borné | > 10 Mo | ⚠️ |

Les events internes sont minimalistes (~80 bytes, sans `boardStateAfter`). La grosse charge reste les events métier avec snapshot.

**Conséquence pour le cadrage** :
- §3.3 actable sans politique de rétention pour la cible PvP / BO3 standard.
- Politique de rétention RECOMMANDÉE pour le cadrage afin d'éviter le risque arcade/exhibition long-term, mais **non bloquante** pour démarrer l'implémentation.
- 3 stratégies suggérées (à choisir à la rédaction de §3.3 ou en story dédiée) :
  1. Ring-buffer post-checkpoint (conserve checkpoint + N derniers events)
  2. Snapshot+truncate per-turn (tous les 5 tours)
  3. Compaction causale (agrégation par `ChainEnded` après 10 chains résolues — articule avec §3.8)

---

<a id="2-trous-valides"></a>
## §2 Trous valides arbitrés

**47 items** organisés par thème. Chaque entrée note les passes d'origine, l'action et le moment où elle doit être traitée dans la suite du cadrage.

### 2.1 Combinatoire des dimensions (3 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-1 | Combo `LiveSource + Interactive + Precomputed` (PvP avec buffer/rewind) non addressée | Matrice de qualification : invariant interdisant ou cas futur | Cadrage §1 |
| EC-2 | Combo `LiveSource + ReadOnly + Precomputed` (spectateur VOD) non addressée | Idem (out-of-scope explicite OK) | Cadrage §1 |
| EC-3 | Statut des combinaisons latentes (supporté / non-testé / out-of-scope) non qualifié | Produit de EC-1/2 — colonne "Statut" dans la matrice | Cadrage §1 |

### 2.2 Switch de perspective (2 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-4 | Switch pendant chain résolvante : sémantique non spécifiée | Spécifier (snap / rollback / queue / abort) + test de couverture | Cadrage §3.X ou prérequis |
| EC-5 | Switch pendant `CardTravelEngine.travel()` in-flight | Cas-cible du POC projection ; choisir cancel+rejoue ou freeze+transform | POC projection prérequis |

### 2.3 Transport — sémantiques (1 item)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-6 | Pause/resume pendant `Streaming` : timeout serveur ? | Contrat transport : Streaming admet-il pause ? Heartbeat ? | Prérequis |

### 2.4 Convergence et parité (2 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-7 | "Convergence en nombre fini" non borné numériquement | Chiffrer : ≤ N événements où N = profondeur cascade reset (max 3 docs) | Cadrage §2 reformulé |
| EC-8 | Parité ignore prompt-driven branches (Interactive divergent par choix joueur) | Restreindre : "pour **même séquence WS** post-événement identique" — exclure choix joueur | Cadrage §3.5 ou §3.6 reformulé |

### 2.5 Flux comme source de vérité (3 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-9 | DOM state (FloatRegistry, zones) hors flux mais pas carve-out explicite | Ajouter catégorie `@DOM` ou `@Environment` hors-flux par design | Cadrage §3.2 |
| EC-13 | Timers async (type-4) : window arm→fire reste hidden state, contradit §3.3 | Émettre `TimerArmed` / `TimerFired` / `TimerCancelled` sur le flux ; ou nommer "transport state" carve-out | Cadrage §3.3 |
| ADV-6 | §3.2 circulaire (tautologie "sinon enrichir le flux") | Doter d'algorithme de décision opérationnel (cf. EC-10/EC-30) | Cadrage §3.2 reformulé |

### 2.6 Frontière projection / transport / environnement (1 item fusionné)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-10 ⊕ EC-30 ⊕ ADV-6 (fusion) | Frontière subjective + pas d'escape hatch pour environment (reducedMotion, theme, speedMultiplier) | Algorithme : "si lu hors-engine → projection ; interne → transport ; entrée externe constante → `@Environment`" + matrice d'exemples | Cadrage §3.2 nouveau |

### 2.7 Pipeline events sur le flux (3 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-11 | Ordering interleavé pipeline-events vs WS undefined | Spécifier append vs merge vs batch | Cadrage §3.3 |
| EC-12 | Flux unbounded en long duel (events animation-isés) | Politique rétention : ring-buffer post-N / snapshot+truncate / GC au checkpoint | Cadrage §3.3 + R5 |
| ADV-7 | Coût d'événement-isation non chiffré | Mesurer + budgéter avant figer §3.3 (= R5) | Action haute valeur #3 |

### 2.8 Scope de persistance (4 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-14 | `SESSION_LIFETIME` manquant (rematch, score best-of-3, opponent identity) | Ajouter à table §3.5 + décider invalidations | Cadrage §3.5 |
| EC-15 | Reset events manquants (`TabHidden`, `ServerKicked`, `NavigationAway`, `TabFreeze`) | Liste exhaustive + décider scope chantier vs futur | Cadrage §3.5 |
| EC-16 | Post-`DuelEnded` non spécifié (rematch button, replay viewer) | Quels streams survivent et combien de temps | Cadrage §3.5 |
| ADV-9 | Enforcement mécanique du contrat de scope manquant | `BaseProjection.applyReset(categories)` abstrait — compilation error si non implémenté | Cadrage §3.5 (κ enforcement) |

### 2.9 Checkpoint (4 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-17 | Checkpoint vs `AnimationStarted` pending (sans `AnimationCompleted`) | Synthétiser `AnimationCancelled` ou freeze | Cadrage §3.6 |
| EC-18 | Payload partiel / corrompu : validation manquante | Checksum / schéma / fallback "reconnect from zero" | Cadrage §3.6 |
| EC-19 | "Pas de divergence policy projection" non enforcé | Base class abstraite (cf. ADV-9) | Cadrage §3.6 |
| ADV-10 | Race timestamp serveur vs réception client | Spécifier l'arbitre (server timestamp) + invariant "events post-checkpoint server-time > sync" | Cadrage §3.6 |

### 2.10 Deferred effects (R6 détaillé — 6 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-20 | `awaitingRef` qui n'arrive jamais | Timeout après N ms → `EffectAbandoned` event | Cadrage §3.7 |
| EC-21 | Collisions deferred même nom (2 Ash sur 2 chains rapprochées) | Keyed deferred OU invariant "1 seul actif par nom" | Cadrage §3.7 |
| EC-22 | Lookahead asymétrie : processor sait/ne sait pas le futur | Variante par mode Transport (cf. R8) | Cadrage §3.7 + §3.8 |
| EC-24 | Versioning table de règles non aligné avec ws-protocol | Lier versioning à ws-protocol-shared OU décorrélation explicite | Cadrage §3.7 |
| EC-39 | Checkpoint mid-await annule deferred | `EffectAbandoned` automatique sur tout deferred pending | Corollaire EC-20 + EC-17 |
| ADV-11 | Exemple Ash trop happy-path | Documenter 5-15 cas concrets (action haute valeur #2) | Avant figer §3.7 |

### 2.11 Boundaries (3 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-25 | Boundary processor lag : projection peut voir MSG_* avant frontière | Sync mandatory sur chaque WS message avant projection reads | Cadrage §3.8 |
| EC-26 | Boundaries imbriquées (chain-in-chain via Mind Crush) | Stack semantics ou flat (décider et tester) | Cadrage §3.8 |
| EC-27 ⊕ EC-28 (fusion) | `DuelEnded` mid-chain + politique mismatch detection | `DuelEnded` synthétise `ChainEnded`/`TurnEnded`/`PhaseEnded` ; mismatch = warn prod + `duelAssert` dev | Cadrage §3.8 |
| ADV-13 | "Qui émet les frontières" non spécifié | Nommer le boundary processor explicitement (composant testable) | Cadrage §3.8 |

### 2.12 Asymétrie precompute/streaming (R8 détaillé — 1 item)

| ID | Trou | Action | Quand |
|---|---|---|---|
| ADV-12 | "Un seul endroit YGO knowledge" est faux (filtre serveur + boundary processor en ont aussi) | Reconnaître les 3 composants ; spécialisation (filtre=sanitization, deferred=corrélation, boundary=transition) | Cadrage §3.7 reformulé |

### 2.13 Performance — projections (1 item, R5 déjà couvre le débit)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-29 | Recomputation cost : batching / debouncing | Spécifier sync per-event vs debounced per-microtask + budget computation | Cadrage §3.9 |

### 2.14 Acceptance, migration, observabilité (sections futures du doc — 5 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| EC-34 ⊕ ADV-20 ⊕ PM-C (fusion R2) | Existant ignoré, pas de migration | Section "Existant → Cible" : 8 composants × statut cible + plan coexistence | Prérequis |
| EC-35 | Pas d'observabilité / testing strategy | Chapitre dédié : unit (processor pur), integration (record + replay), DuelLogger catégories | Section futur "Tests" |
| EC-36 | Cross-version flux compatibility (replays anciens) | Versioning + adapteur de migration + replays unmigrable flaggés | Section futur "Migration" |
| EC-37 ⊕ ADV-19 (fusion R7) | Acceptance criteria + critère bascule draft→ready | Done = (a) 3 combos green sur parité test (b) 0 hidden state per audit script (c) cost-before-overlay test pass (d) SOLO switch mid-chain test pass. Deadline cadrage : 2026-06-01 | Cadrage §5 nouveau |
| EC-38 | Rollback / coexistence plan | Feature flag `ANIM_PIPELINE_V2` ; V1 conservé 2 semaines après V2 green | Section futur "Rollout" |

### 2.15 Décisions de design à démontrer (R4 détaillé — 3 items)

| ID | Trou | Action | Quand |
|---|---|---|---|
| ADV-1 | Pas d'alternatives posées, pas de trade-offs évalués | Pour 2-3 décisions majeures : alternatives écartées + raison | Cadrage §3 reformulé |
| ADV-3 | Bug SOLO "impossible par construction" sans démo | Caractériser bug en séquence WS + démontrer élimination mécanique (action #1) | Avant figer §1 reformulation |
| ADV-8 | "Replay déterministe y compris animations" device-dependent | Restreindre à "déterminisme du flux logique ; rendu best-effort device" OU spécifier que `speedMultiplier` est dans le flux | Cadrage §3.3 reformulé |

---

<a id="3-ecartes"></a>
## §3 Findings dédupliqués ou écartés

### Écartés (3 items)

| ID | Raison |
|---|---|
| PM-A (POC ne converge jamais) | PM agent a noté que `CardTravelEngine` est stable depuis 2026-04 et que les 3 questions du §3.2 connexe sont en réalité des critères opérationnels implicites. Le risque réel est R1 (seuils non écrits explicitement) qui reste valide ; mais le scénario d'échec "POC infini" est faible. |
| PM-E (deferred-processor devient chain manager v2) | PM agent a montré que les 4 tentatives cost-before-overlay ont échoué sur la **mécanique de commit lifecycle**, pas sur l'enflure de la table de règles. R6 a été reformulé pour pointer le vrai risque. |
| EC-23 (server batchage ordre processor vs WS) | Couvert par EC-25 (boundary processor sync mandatory). Doublon. |

### Polish éditorial (3 items — non bloquants pour le cadrage)

| ID | Trou | Action |
|---|---|---|
| ADV-2 | Mot "découverte du cadrage" est marketing | Remplacer par "reformulation en dimensions orthogonales" |
| ADV-15 | Section §4 contient `### 3.1` et `### 3.2` (bug numérotation) | Corriger en `### 4.1` et `### 4.2` |
| ADV-18 | "Winston (architecte)" — agent BMad, pas humain | Clarifier "Winston (agent BMad, rôle architecte)" |

### Déduplications inter-passes (14 items absorbés dans les fusions)

- EC-32 ⊕ ADV-17 ⊕ PM-A → R1
- EC-34 ⊕ ADV-20 ⊕ PM-C → R2 + entrée fusion en §2.14
- EC-31 ⊕ ADV-16 ⊕ PM-B → R3
- EC-7 ⊕ ADV-5 → R4 partiel
- EC-12 ⊕ EC-29 ⊕ ADV-7 ⊕ PM-D → R5
- EC-20→24 ⊕ EC-39 ⊕ ADV-11 → R6 (6 items conservés individuellement car chacun adresse une facette distincte)
- ADV-19 ⊕ PM-F ⊕ EC-37 → R7
- EC-22 ⊕ PM-G → R8
- EC-3 (statut combos) — dérivé pur de EC-1+EC-2, conservé pour lisibilité de l'action
- EC-10 ⊕ EC-30 ⊕ ADV-6 → fusion §2.6
- EC-27 ⊕ EC-28 → fusion §2.11
- ADV-12 → §2.12 reformulé

---

<a id="4-contradictions"></a>
## §4 Contradictions inter-passes résolues

### Contradiction 1 — POC projection : "ne converge jamais" vs "exit criteria manquant"

- **EC** a validé EC-32 (POC sans exit criteria).
- **PM** a écarté PM-A (POC infini implausible car CardTravelEngine stable).

**Résolution** : les deux ne contredisent pas. EC-32 dit *"il n'y a pas de seuils écrits"* (vrai et à corriger) ; PM-A dit *"même sans seuils écrits, le POC ne va pas exploser en pratique"* (probable mais non garanti). On garde R1 comme risque avec **probabilité moyenne** (pas "haute") et **action = écrire les seuils explicitement** — ne pas se reposer sur la maturité de CardTravelEngine pour le futur switch perspective.

### Contradiction 2 — Deferred processor : "trous lifecycle" vs "vrai risque mécanique commit"

- **EC** a validé 6 trous lifecycle (timeout, collisions, versioning, etc.).
- **PM** a marqué PM-E (deferred → chain manager v2) redondant en notant que cost-before-overlay a échoué sur la mécanique commit, pas sur la table de règles.

**Résolution** : les 6 trous lifecycle EC restent valides individuellement (ils décrivent le lifecycle qui manque). PM-E porte mal son nom — le vrai risque qu'il pointe est *"le design ne résout pas cost-before-overlay structurellement"*. R6 a été reformulé pour intégrer les deux.

### Contradiction 3 — "Industrialisable" : adversarial dit "mot fourre-tout"

Pas de contradiction directe, mais à noter : ADV-4 propose de remplacer par critères mesurables. R7 (deadline + critères bascule) absorbe partiellement. Ajouter dans §2.X une définition explicite ("couverture tests ≥ 85%, runbook ops, time-to-recover < 1h, etc.") — ou supprimer le mot.

---

<a id="5-patterns"></a>
## §5 Patterns transverses (confirmés par arbitrage)

Trois patterns confirmés par les 3 passes ET par la vérification code/mémoire :

1. **Affirmation sans démonstration mécanique.** "Rendu impossible par construction", "industrialisable", "races disparaissent". Le doc déclare des propriétés qu'il devrait prouver — l'arbitrage adversarial a noté que le bug SOLO n'est même pas caractérisé dans le doc. (R4)
2. **Asymétrie niée au nom de la neutralité.** Le pipeline est présenté comme "unique et neutre" mais lookahead precompute vs streaming crée structurellement deux mondes. (R8)
3. **Pas de dimensionnement.** Aucun chiffre dans le doc — pas de débit cible, pas de nombre de cas deferred, pas de durée de POC, pas de deadline cadrage, pas de RAM/CPU budget. (R1, R5, R6, R7)

Un quatrième pattern émerge de l'arbitrage :

4. **Existant occulté.** Le doc parle du futur comme si la table était vide. Le QueueRunner extrait il y a 2 jours, les 8 managers, le DuelEventProcessor, le CardTravelEngine — aucun n'est nommé. (R2)

---

<a id="6-actions"></a>
## §6 Actions à très haute valeur (séquencées)

Action séquencées par dépendance et levier. **Toutes faisables sans attendre la suite du cadrage.**

### Pré-suite-du-cadrage (3 actions, ~3-5j cumulés)

1. **Caractériser le bug SOLO + le bug cost-before-overlay en séquences WS reproductibles** (~1j). Output : 2 fichiers `.md` (séquence + état attendu + état observé). Servent de tests de victoire de la cible. Adresse R4, R6 reformulé, ADV-3.
2. **Lister les 5-15 cas concrets de deferred effects connus** (~0.5j). Output : un tableau (cas, trigger, awaiting, exemple WS). Sert à calibrer §3.7. Si > 15 cas → repenser pattern-driven. Adresse R6, ADV-11.
3. **Mesurer le débit actuel du flux** (~1j). Output : events/s moyen + pic chain 8+ liens + RAM par duel. Sert à fixer budget §3.3. Adresse R5, ADV-7.

### Pré-implémentation (3 actions, ~5-8j cumulés)

4. **Section "Existant → Cible — mapping"** (~2j). Output : tableau 8 composants × statut cible (conservé / wrappé / fusionné / jeté) + plan coexistence V1↔V2. Adresse R2.
5. **Lister les scénarios in-flight animation que le POC doit traiter** (~0.5j). Output : liste de 5 scénarios reproductibles + seuils de succès (jump ≤ 1 frame, fps cible par plateforme). Adresse R1, EC-5, EC-33.
6. **Fixer critères de bascule cadrage → implémentation** (~0.5j). Output : table des matières finale du doc avec date de gel par section + deadline globale (proposé : 2026-06-01). Adresse R7, EC-37, ADV-19.

### Pendant le cadrage (4 décisions à acter)

7. Algorithme de décision projection / transport / environment (cadrage §3.2).
8. Lookahead comme propriété explicite de la dimension Transport (cadrage §3.5/§3.6, R8).
9. Politique de rétention du flux (cadrage §3.3, R5).
10. Boundary processor : composant nommé + sync mandatory (cadrage §3.8, EC-25, ADV-13).

---

<a id="7-residus"></a>
## §7 Risques résiduels post-bloc 1 (à investiguer)

Après le bloc 1, les risques suivants restent **non investigués mécaniquement**. Ils ne bloquent pas la suite du cadrage mais doivent être traités avant l'implémentation correspondante.

| Risque | Investigation prévue | Bloc | Coût |
|---|---|---|---|
| ~~**R5** débit non chiffré~~ | ✅ Bloc 2 statué — ACTABLE TEL QUEL (~60 events/s pic post-§3.3) | — | — |
| ~~**EC-12** RAM croissance long duel~~ | ✅ Bloc 2 statué — OOM faible BO1/BO3, surveillé > 2h | — | — |
| ~~**R3** spike info-hiding complexité~~ | ✅ Bloc 3 statué — LÉGER (1-2j), inclure en Palier 0 du chantier | — | — |
| ~~**EC-26** boundaries imbriquées~~ | ✅ Bloc 3 statué — flat semantics suffit (garantie structurelle OCGCore) | — | — |
| ~~**R1** POC projection seuils~~ | ✅ Spec POC rédigée (`poc-projection-spec.md`). Décisions Axel actées (transform CSS unique, switch in-flight pendant travel cible). Critères de succès chiffrés. À **exécuter** : 3 demi-journées timebox dur. | — | ~1.5j d'exécution |
| ~~**R4** caractérisation bug SOLO + cost-before-overlay~~ | ✅ Statué — `bug-solo-sequence.md` + `bug-cost-before-overlay-sequence.md` rédigés avec séquences WS T0-T10 / T0-T13 reproductibles + état attendu + test de victoire | — | — |
| ~~**R7** deadline + critères bascule~~ | ✅ Acté — deadline **2026-06-15** (3 semaines), critères **pack complet** (sections 1-5 + POC + bugs + Existant→Cible + catalogue deferred + revue agent architect) | — | — |

Le **bloc 2** (R5 + EC-12) est désormais clos — §3.3 et §3.9 peuvent être figés sans dégradation, une politique de rétention reste recommandée pour les sessions longues. Le **bloc 3** (R3 + EC-26) peut être traité en parallèle de la rédaction des sections concernées.

---

<a id="annexe-a"></a>
## Annexe A — Verdict détaillé des 67 findings

Pour traçabilité, le verdict par finding individuel (consultable dans les sorties d'agents).

### Edge-case (39 findings)

| ID | Verdict initial | Verdict après arbitrage inter-passes | Localisation finale |
|---|---|---|---|
| EC-1, EC-2, EC-3 | valide | valide | §2.1 |
| EC-4, EC-5 | valide | valide | §2.2 |
| EC-6 | valide | valide | §2.3 |
| EC-7 | valide | valide (→ R4) | §2.4 |
| EC-8 | valide | valide | §2.4 |
| EC-9 | valide | valide | §2.5 |
| EC-10 | valide | fusionné dans §2.6 | §2.6 |
| EC-11 | valide | valide | §2.7 |
| EC-12 | valide | valide (→ R5) | §2.7 |
| EC-13 | valide | valide | §2.5 |
| EC-14, EC-15, EC-16 | valide | valide | §2.8 |
| EC-17, EC-18, EC-19 | valide | valide | §2.9 |
| EC-20, EC-21, EC-22, EC-24 | valide | valide (→ R6) | §2.10 |
| EC-23 | valide | **écarté** (doublon EC-25) | §3 |
| EC-25, EC-26 | valide | valide | §2.11 |
| EC-27, EC-28 | valide | **fusionné** dans §2.11 | §2.11 |
| EC-29 | valide | valide (→ R5) | §2.13 |
| EC-30 | valide | fusionné dans §2.6 | §2.6 |
| EC-31 | valide | valide (→ R3) | §2.14 (via R3) |
| EC-32 | valide | valide (→ R1) | R1 |
| EC-33 | valide | valide | Action #5 |
| EC-34 | valide | fusionné R2 + §2.14 | §2.14 |
| EC-35 | valide | valide | §2.14 |
| EC-36 | valide | valide | §2.14 |
| EC-37 | valide | fusionné R7 + §2.14 | §2.14 |
| EC-38 | valide | valide | §2.14 |
| EC-39 | valide | valide (corollaire EC-17+EC-20) | §2.10 |

**Bilan EC : 38/39 retenus (EC-23 écarté), 5 fusionnés.**

### Adversarial (20 findings)

| ID | Verdict initial | Verdict après arbitrage inter-passes | Localisation finale |
|---|---|---|---|
| ADV-1 | valide | valide | §2.15 |
| ADV-2 | polish | polish | §3 polish |
| ADV-3 | valide | valide (→ R4) | §2.15 |
| ADV-4 | valide | valide (→ R4) | R4 partiel + §4 contradiction 3 |
| ADV-5 | valide | valide (→ R4) | R4 partiel |
| ADV-6 | valide | fusionné dans §2.6 | §2.6 |
| ADV-7 | valide | valide (→ R5) | §2.7 |
| ADV-8 | valide | valide | §2.15 |
| ADV-9 | valide | valide | §2.8 |
| ADV-10 | valide | valide | §2.9 |
| ADV-11 | valide | valide (→ R6) | §2.10 |
| ADV-12 | valide | valide | §2.12 |
| ADV-13 | valide | valide | §2.11 |
| ADV-14 | valide | valide (→ R5) | §2.7 (couvert par EC-12+ADV-7) |
| ADV-15 | polish | polish | §3 polish |
| ADV-16 | valide | valide (→ R3) | §2.14 (via R3) |
| ADV-17 | valide | valide (→ R1) | R1 |
| ADV-18 | polish | polish | §3 polish |
| ADV-19 | valide | valide (→ R7) | §2.14 (via R7) |
| ADV-20 | valide | fusionné R2 + §2.14 | §2.14 |

**Bilan ADV : 17 valides + 3 polish, 5 fusionnés.**

### Pre-mortem (8 scénarios)

| ID | Verdict | Probabilité revisitée | Mapping |
|---|---|---|---|
| PM-A | écarté | faible | Contradiction résolue §4.1 — risque R1 reformulé probabilité moyenne |
| PM-B | plausible | moyenne | R3 |
| PM-C | plausible | **haute** | R2 |
| PM-D | plausible | moyenne | R5 |
| PM-E | redondant | faible | Reformulé dans R6 (cf. §4.2) |
| PM-F | plausible | moyenne | R7 |
| PM-G | plausible | moyenne | R8 |
| PM-H | plausible | moy-faible | R4 |

**Bilan PM : 6 plausibles, 1 écarté, 1 redondant.**

### Total

- 67 findings bruts
- **47 retenus comme trous valides** (38 EC + 17 ADV - doublons fusionnés + 6 PM mappés sur R1-R8)
- 3 polish éditoriaux
- 17 fusionnés ou redondants (la même chose vue depuis 2 ou 3 angles)
- 3 écartés (PM-A, PM-E, EC-23)

---

_Document arbitré 2026-05-25 par consolidation de 3 passes BMad + vérification code/mémoire via 3 sous-agents Explore en parallèle. Source de vérité = `duel-session-chantier.md` ; ce document est l'outil de revue à lire **à côté** du cadrage pour piloter sa complétion._
