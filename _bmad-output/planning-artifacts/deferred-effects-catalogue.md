---
title: Catalogue des deferred effects (ε3) — Pipeline d'animation
status: ready (calibrage ε3 case-driven validé, 4 passes Explore)
addresses_risks:
  - R6 réserve "Lister 5-15 cas concrets avant de figer §3.7"
  - ADV-11 "Exemple Ash trop happy-path"
context_doc: duel-session-chantier.md §3.7
passes:
  - pass1 (exemples YGO drivés) — 9 cas
  - pass2 (méthode inverse MSG_* + grep triggers ad-hoc + animations non-card) — 2 cas nouveaux pertinents + 1 marginal écarté
  - pass3 (audit visuel β.3 bugs #1+#2 — investigation 2026-05-26) — 1 cas nouveau (#12 xyz-leave-with-materials) + 1 cas écarté (REASON_RULE settling pile)
  - pass4 (audit β.3 bug annonces non-bloquantes — 2026-05-26) — 1 cas nouveau (#13 sequential-announcement-gating, famille "Sequential timer gating" — pas un deferred classique, plus proche d'une directive runner)
date: 2026-05-25 (pass 1-2), 2026-05-26 (pass 3-4)
---

# Catalogue des deferred effects (ε3)

Catalogue des couples `(trigger, awaiting)` qui matérialisent les
corrélations cross-event dans la pipeline d'animation. Sert de table de
référence pour le futur `DeferredEffectProcessor` (cf. §3.7 du doc
cadrage et §4.2 de la section Existant → Cible).

**Verdict de calibrage** : 13 cas identifiés (9 pass 1 + 2 pass 2 + 1 pass 3 + 1 pass 4)
→ ε3 **case-driven reste bien dimensionné**. Seuil favorable
maintenu (< 15 cas). Pas besoin de mécanique pattern-driven plus
générique.

**Cas spécial #12** : la troisième passe (pass 3, audit β.3 bugs visuels
2026-05-26) a fait émerger un cas hybride qui n'est pas strictement un
"deferred-effect (trigger + awaiting)" au sens classique des 11 autres.
Il s'agit d'un **rewrite du flux d'événements** (intercepter des MSG_MOVE
émis avec `reason=REASON_RULE+REASON_LOST_TARGET` et les remplacer par
des MSG_MOVE synthétiques routés différemment). C'est listé ici parce
que la logique de détection naturelle est au même niveau d'abstraction
que le DEP (corrélation cross-event sur le flux), et que l'isolation
dans un processor dédié serait disproportionnée pour un seul cas. Cf.
§1bis ci-dessous pour la spécificité du pattern. À ré-évaluer en β.x
si un 2e cas du même genre émerge.

**Cas spécial #13** : la quatrième passe (pass 4, audit β.3 bug annonces
2026-05-26) a fait émerger un cas qui n'est pas un deferred au sens
classique non plus. Il s'agit d'une **directive de gating séquentiel**
basée sur un timer : les annonces visuelles (chain resolution banner,
phase announcement DRAW/STANDBY/etc.) doivent bloquer le dispatch des
events suivants pendant leur durée d'affichage, pas tourner en parallèle.
Le mécanisme idéal est une **directive runner** (au niveau de `barrier`
/ `await-signal` / `lp` existantes), pas une règle DEP. C'est listé
dans ce catalogue pour cohérence documentaire mais l'implémentation
vivra côté `QueueRunner`, pas côté `DeferredEffectProcessor`. Cf. §1ter
ci-dessous pour la spécificité du pattern et l'aiguillage.

---

## §1 Catalogue exhaustif

| # | Nom du deferred | Trigger | Awaiting | Exemple YGO | Notes |
|---|---|---|---|---|---|
| 1 | `overlay-show` | `MSG_CHAINING` (ajout link n+1) | `MSG_MOVE` cost — `AnimationCompleted` | Ash Blossom discard en réponse à Pot of Desires | **Cas canonique** documenté en §3.7 + `bug-cost-before-overlay-sequence.md`. ~600ms de travel à attendre. |
| 2 | `trigger-effect-activation` | `MSG_CHAINING` (trigger déclenche) | `MSG_MOVE` summon — `AnimationCompleted` | Snake-Eye Ash pose en MZONE → déclenche effect | L'overlay « trigger activé » attend la fin de l'animation de pose. Évite l'overlay prématuré sur trigger post-summon. |
| 3 | `search-reveal-sync` | `MSG_CHAINING` (tutor effect résout) | `MSG_MOVE` deck → hand + `MSG_CONFIRM_CARDS` — `AnimationCompleted` | Pot of Desires tutor → carte sort du deck → reveal | Reveal attend la complétion du travel vers la hand pour que l'utilisateur perçoive « je cherche, la voilà ». |
| 4 | `flip-summon-trigger` | `MSG_FLIPSUMMONING` | `MSG_FLIPSUMMONED` + `AnimationCompleted` | Man-Eater Bug flip summon → trigger effect chaîne | Le trigger du flip ne peut chaîner que post-flip-complete. Évite les chains ghost. |
| 5 | `banish-then-revive` (batch séquentiel) | `MSG_MOVE` (premier de la série) | `AnimationCompleted` de chaque travel | Necroface banish séquentiel des cards du GY | Multi-cards banissent, chacune doit compléter avant la suivante pour la clarté visuelle. Dépendance 1→N. |
| 6 | `attack-impact-counter` | `MSG_ATTACK` | `DAMAGE_STEP_END` (ou battle impact resolution) — `AnimationCompleted` | Swordsoul Grandmaster attack → trigger counter-trap | Le trigger du contre attend le visuel du clash impact. Sinon overlay pop avant que le joueur voie « j'attaque et tu réponds ». |
| 7 | `equip-stat-update` | `MSG_MOVE` (equip vers SZONE) | `AnimationCompleted` du travel + `MSG_EQUIP` | O-Lion equip → mise à jour ATK/DEF du monstre ciblé | Display des stats reste bloqué pendant le travel de l'equip pour ne pas jumper au nouvel ATK avant que l'arme soit visible. |
| 8 | `xyz-overlay-attach` | `MSG_MOVE` (matériau vers Overlay) | `AnimationCompleted` du pre-overlay + `AnimationCompleted` du XYZ pose | XYZ summon multi-matériaux | L'overlay visuel ne montre « N matériaux » que quand tous sont arrivés ET que le XYZ est posé. Dépendance en chaîne. |
| 9 | `lp-cost-lock-visual` | `MSG_CHAINING` (activate effect payant LP) | `MSG_PAY_LPCOST` — `AnimationCompleted` du counter | Solemn Judgment half-LP cost | L'overlay reste invisible jusqu'à la fin du counter animation du coût payé. « Je paie d'abord, puis je chaîne mon effet. » |
| 10 | `counter-add-remove-pulse` | `MSG_ADD_COUNTER` ou `MSG_REMOVE_COUNTER` | `AnimationCompleted` du counter badge pulse | Hat Tricker counter, Doomking counter | (Pass 2) L'overlay/badge counter pulse doit attendre la fin de l'animation visuelle avant de disparaître ou muter. Différent de #9 (LP cost) — ici c'est le counter visuel qui attend, pas un overlay déclenché. |
| 11 | `pile-target-float-cleanup` | `MSG_CHAIN_SOLVING` (premier de la chain) | `AnimationCompleted` des pile floats fade-out | Reticles GY/Banished/Extra révélés par `MSG_BECOME_TARGET` | (Pass 2) Cas trouvé via grep de triggers ad-hoc actuels — l'orchestrator appelle `targetIndicator.cleanup()` dans `handleChainSolving`, mais les floats doivent se fade-out **visuellement** avant que la reticle ne disparaisse. Aujourd'hui géré ad-hoc. |
| 12 | `xyz-leave-with-materials` | `MSG_MOVE` (monstre XYZ avec `overlayMaterials.length > 0` quittant MZONE/EMZ, **toute raison**) | `AnimationCompleted` des travels matériaux + `AnimationCompleted` du travel XYZ | XYZ détruit ou sacrifié (matériel Link, tribut, return-to-deck, banishment…) | (Pass 3, 2026-05-26) **Rewrite du flux**, pas un deferred classique. Cf. §1bis ci-dessous pour le pattern complet. Bug visuel résolu : les ex-matériaux "flashent dans le GY à tour de rôle" parce qu'OCGCore émet pour eux des `GRAVE→GRAVE reason=0x600` (REASON_RULE+REASON_LOST_TARGET) qui se routent en `pileToPile` quasi-statique. Le DEP intercepte, synthétise un `OVERLAY→GRAVE` virtuel par matériau (travel visible depuis la position XYZ vers le GY), absorbe les `GRAVE→GRAVE reason=0x600` réels. Couvre **toutes** les manières dont un XYZ peut quitter le terrain ; le bug original observé en β.3 était sur un Link summon utilisant l'XYZ comme matériel, mais le pattern est identique pour destruction, tribut, return-to-deck, banishment. |
| 13 | `sequential-announcement-gating` | Émission interne d'une annonce visuelle (phase announcement, chain resolution banner, futures annonces) | Timer interne `durationMs` écoulé | Bannière "Chain Resolution" qui sort à l'apparition de l'overlay du premier link au lieu de rester toute la résolution ; annonce "DRAW PHASE" qui doit empêcher le `SELECT_IDLECMD` MAIN1 d'être livré tant qu'elle s'affiche | (Pass 4, 2026-05-26) **Directive runner**, pas une règle DEP. Cf. §1ter ci-dessous. Bug visuel β.3 + bug game-state : les annonces sont aujourd'hui des surfaces de présentation parallèles qui n'attendent rien et ne bloquent rien. Le user peut normal-summon pendant "DRAW PHASE" parce que le serveur a déjà envoyé `SELECT_IDLECMD` et que l'UI le dispatch instantanément. Le fix : faire de chaque annonce une **directive bloquante** dans le `QueueRunner` (au niveau de `barrier` / `await-signal`). Pendant la directive, les events de la queue restent en attente. Quand le timer s'écoule, dispatch reprend. Couvre ce cas ET règle automatiquement la bannière chain (elle disparaît à fin de directive, puis l'overlay de résolution apparaît à dispatch de l'event suivant). Scope blocage : **dispatch uniquement** (events serveur en attente jusqu'à fin annonce). Pas de blocage input direct sur le board (à reconsidérer si comportement étrange observé après livraison). |

---

## §1bis Spécificité du cas #12 — Rewrite du flux

Le cas #12 diffère structurellement des 11 autres. Les cas 1-11 suivent
le pattern canonique du `DeferredEffectProcessor` :

1. Un **trigger event** ouvre une déférée.
2. La déférée attend un **awaiting event** (matchant un prédicat).
3. Quand l'awaiting arrive, une `EffectReady` est émise sur le flux.
4. Une projection ou un handler observe `EffectReady` et réagit.

**Le cas #12 fait deux choses en plus** :
- Il **supprime** des événements du flux qui suit le trigger (les
  `GRAVE→GRAVE reason=0x600` émis par OCGCore une fois l'XYZ parti).
  Si le routing les voit, il les anime en `pileToPile` (flashs
  parasites). La projection consommatrice doit donc soit les filtrer
  côté `MoveAnimationRouter`, soit le DEP doit absorber+swallow les
  events matchant ce prédicat dans une fenêtre temporelle bornée.
- Il **synthétise** des MSG_MOVE virtuels (`OVERLAY→GRAVE`, un par
  matériau de l'XYZ partant) qui n'existent pas dans le flux WS réel.
  Ces synthétiques sont routés via `processOverlayDetachEvent` du
  `MoveAnimationRouter` (déjà implémenté, cf.
  [move-animation-router.ts:186](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L186)),
  qui anime un slide-out + travel vers le GY.

**Pourquoi pas le routeur MSG_MOVE pur** : un fix au niveau du
`MoveAnimationRouter` (intercepter le pattern `GRAVE→GRAVE reason=0x600`
et faire une recherche en arrière vers le MSG_MOVE de l'XYZ pour
reconstruire le contexte) demande au routeur de connaître l'historique
récent du flux + de matcher `reason` flags spécifiques. C'est exactement
le rôle du DEP : corrélation cross-event sur le flux.

**Pourquoi pas un processor dédié** : disproportionné pour un cas.
Tant que c'est le seul du genre, le DEP fait l'affaire avec une règle
spéciale qui peut à la fois émettre `EffectReady` ET marquer
des events à drop (extension mineure de l'API DEP). Si un 2e cas
similaire émerge (rewrite de flux pour pattern OCGCore-spécifique),
il faudra envisager un `FlowRewriteProcessor` séparé.

**Détection du pattern** :
- Trigger : `MSG_MOVE` dont `fromLocation === MZONE` (ou `EMZ_L/R`)
  ET le monstre source (lu depuis `boardStateAfter` ou snapshot
  pré-event) a `overlayMaterials.length > 0`. Toute raison de
  départ : `REASON_DESTROY`, `REASON_RELEASE`, `REASON_LINK`,
  `REASON_SYNCHRO`, `REASON_XYZ`, `REASON_FUSION`, `REASON_REDIRECT`,
  `REASON_RULE`, etc.
- Predicat awaiting : la séquence de `MSG_MOVE` suivants matchant
  `fromLocation === GRAVE && toLocation === GRAVE && reason ===
  (REASON_RULE | REASON_LOST_TARGET) === 0x600` ET `cardCode` ∈ liste
  des `overlayMaterials` du trigger. Le nombre attendu est connu
  (= `overlayMaterials.length`), borné, et OCGCore les émet dans la
  foulée du MSG_MOVE de l'XYZ.
- Action : (a) émettre N MSG_MOVE synthétiques `OVERLAY→GRAVE` (un
  par matériau, scheduling en parallèle ou en stagger avec le travel
  XYZ — choix à figer dans la spec d'impl) ; (b) marquer les N
  `GRAVE→GRAVE reason=0x600` réels comme "absorbed" (drop du routing).

**Edge cases à couvrir dans la spec d'impl** :
- XYZ qui retourne en EXTRA (return-to-deck) — les matériaux vont
  toujours en GY (règle YGO).
- XYZ banni — idem matériaux GY (sauf cas exotique de cartes type
  Number 89 qui les emportent ailleurs ; à vérifier en pass 4 si un
  cas réel est rencontré).
- Plusieurs XYZ partent en même temps (mass destruction) — chaque
  trigger ouvre sa propre déférée, la corrélation se fait par
  `cardCode` du matériau.
- XYZ avec un seul matériau — pas de différence de pattern, juste
  N=1.
- XYZ vide d'overlay au moment du départ (a déjà tout détaché) —
  pas de trigger (la condition `overlayMaterials.length > 0`
  filtre).

---

## §1ter Spécificité du cas #13 — Directive runner, pas règle DEP

Le cas #13 diffère encore plus structurellement des autres : ce n'est
**pas une corrélation cross-event**. C'est un **timer self-contained**
qui doit bloquer le dispatch des events suivants pendant sa durée.

### État actuel (β.3) — non-bloquant

- `PhaseAnnouncementService.show(label, ...)` set un signal
  `_announcement` et démarre un `setTimeout(PHASE_ANNOUNCE_DURATION =
  2000ms)`. Pendant ces 2s, le service n'a aucun couplage avec le
  `QueueRunner`. Les `SELECT_IDLECMD` arrivant du serveur sont
  immédiatement dispatchés au `PromptDerivationService` → l'utilisateur
  voit l'annonce ET le menu d'actions en même temps → il peut
  normal-summon pendant "DRAW PHASE".
- `ChainResolutionAnnounceProjection` (Lot 3.2-REDO) se base sur un
  `phaseWait('banner-announce', CHAIN_BANNER_PAUSE_MS,
  'MSG_CHAIN_SOLVING')` qui n'attend pas non plus. Le push de
  `AnimationPhaseCompleted` arrive après le timer, set la projection
  à `true`, mais ne bloque rien — le `MSG_CHAIN_SOLVING` suivant peut
  dispatch tout de suite et l'Effect D du chain-overlay masque
  l'overlay pendant toute la résolution.

### État cible — directive bloquante

Nouvelle directive du `QueueRunner` (au même niveau que `barrier`,
`lp`, `batch-end`, `await-signal`) :

```ts
type AnnouncementDirective = {
  kind: 'announcement';
  source: 'phase' | 'chain-resolution' | string;
  payload: PhaseAnnouncement | ChainResolutionAnnouncement | …;
  durationMs: number;
};
```

Le runner traite cette directive ainsi :
1. **Set la projection consommatrice** (ex: pour `source ===
   'chain-resolution'`, set `ChainResolutionAnnounceProjection` à
   `true` via un push de stream ; pour `source === 'phase'`, set le
   `_announcement` signal de `PhaseAnnouncementService`).
2. **`await scheduleTimeout(durationMs)`** — durée d'affichage.
3. **Clear la projection** (set à `false` / `null`).
4. **`return 'continue'`** → la queue dispatche l'event suivant.

L'observation clé est que les autres directives bloquantes existantes
(`barrier`, `await-signal`) le font déjà : `barrier` attend
`drawManager.awaitDrawsComplete()`, `await-signal` installe un effect
et retourne `'pause'`. La directive `announcement` est conceptuellement
identique mais sur un timer simple.

### Migration des deux call-sites existants

- **`PhaseAnnouncementService.show(...)`** : au lieu de set directement
  son signal, le service prépare un `AnnouncementDirective` et le
  pousse dans la queue d'animation via
  `dataSource.enqueueDirective(...)`. La directive est consommée à
  son tour par le runner ; pendant son exécution, le signal
  `_announcement` est set (par le runner via une callback), puis
  clear à la fin du timer.
- **`ChainResolutionAnnounceProjection`** : aujourd'hui set par
  l'event `AnimationPhaseCompleted({phase: 'banner-announce'})`.
  Migration : remplace `phaseWait` par un push de directive
  `announcement` dans la queue. La projection se set/clear via le
  runner (idem phase announcement). Effet bord : la projection
  devient plus simple — pas d'event flux, juste un set direct par le
  runner. À ré-évaluer si on garde la projection ou si on simplifie
  vers un signal géré par le runner.

### Familles d'annonces couvertes

- **Phase announcements** (cf. `MAJOR_PHASES` = DRAW, STANDBY, MAIN1,
  BATTLE_START, MAIN2, END). 2000ms chacune. Aujourd'hui empilées via
  une file interne au service.
- **Chain resolution banner** (multi-link chain, pause avant
  résolution). `CHAIN_BANNER_PAUSE_MS` + durée d'affichage. Une
  seule par chain multi-link.
- **Futures annonces** (Tribute Summon, Fusion Summon banner, etc.
  si ajoutées) — héritent automatiquement du contrat.

### Edge cases à couvrir dans la spec d'impl

- **Annonce pendant chain résolvant** : la directive doit pouvoir
  être enqueuée pendant `chainPhase === 'resolving'` sans interférer
  avec le buffer replay. Solution simple : la directive est dispatchée
  via la queue principale comme un event, pas via le buffer.
- **Annonce interrompue par STATE_SYNC / rematch** : le scope
  `applyReset` des projections concernées (PERSPECTIVE_LIFETIME) les
  clear ; la directive en cours doit aussi être abandonnée par le
  runner via `requestStop()`.
- **Burst de phase changes** (un effet qui passe rapidement par 3
  phases) : la file interne actuelle de `PhaseAnnouncementService`
  les sérialise. La migration vers la directive runner préserve
  naturellement cette sérialisation (file = queue d'animation).
- **Skip d'annonces en replay fast-forward** : le `speedMultiplier`
  doit scaler la `durationMs` comme les autres timers (via
  `ctx.scaledDuration`). En `reducedMotion`, la durée doit être
  réduite (mais pas à 0 — il faut que l'annonce reste lisible).
- **Annonce dispatch alors qu'une autre est en cours** : la 2e
  directive attend la 1ère via la sérialisation queue (pas de
  parallélisme).

### Scope **NON** couvert (par décision)

- **Blocage des inputs board** (clic carte, drag, ouverture menu) :
  décision user 2026-05-26 — non couvert au premier passage. Si un
  SELECT_* n'est pas dispatché pendant l'annonce, l'utilisateur n'a
  rien à cliquer de toute façon (les menus sont gated derrière les
  prompts du serveur). À ré-évaluer si comportement étrange observé
  après livraison.
- **Annonce côté serveur** (gating OCGCore) : hors scope chantier
  front. Le serveur continue d'envoyer ses events normalement ; c'est
  le client qui choisit quand les dispatcher à l'UI.

---

## §2 Groupement par famille (info utile, pas structurel)

Les 13 cas se regroupent naturellement en 9 familles. Cette taxonomie
n'est pas nécessaire à l'implémentation, mais elle aide à raisonner sur
l'extensibilité du mécanisme. Les familles ne sont pas toutes implémentées
dans le même composant : 11 familles dans le `DeferredEffectProcessor`,
1 famille spéciale (#12 Flow rewrite) qui demande une extension API du
DEP, 1 famille spéciale (#13 Sequential timer gating) qui vit côté
`QueueRunner` et non DEP.

| Famille | Cas | Composant cible | Pattern générique |
|---|---|---|---|
| **Cost-deferral** | #1, #9 | DEP | Overlay/effect attend la fin du `MSG_MOVE` cost ou du `MSG_PAY_LPCOST` |
| **Summon + trigger** | #2, #4 | DEP | Trigger effect activation attend la complétion de l'animation du monstre (summon ou flip) |
| **Multi-event sequencing** | #3, #5, #8 | DEP | Reveal ou attachment attend N travels séquentiels ou batch completion |
| **Battle + impact** | #6 | DEP | Trigger counter attend `DAMAGE_STEP_END` ou impact visual |
| **Zone animation deps** | #7 | DEP | Stat/property update attend l'animation de mouvement vers la zone |
| **Visual badge lifecycle** | #10 | DEP | Badge/counter pulse attend la fin de sa propre animation avant mutation |
| **Cleanup post-chain** | #11 | DEP | Élément visuel (float, reticle) attend `AnimationCompleted` du fade-out avant clear |
| **Flow rewrite** | #12 | DEP étendu | Le processor absorbe N events réels du flux (drop) ET synthétise N events virtuels routés différemment. Différent des autres familles : modification du flux, pas seulement observation. Tant qu'unique, vit dans le DEP avec une API étendue (émission + drop). Si 2e cas émerge → envisager un processor dédié `FlowRewriteProcessor`. |
| **Sequential timer gating** | #13 | `QueueRunner` | Une annonce visuelle (phase / chain resolution banner) doit bloquer le dispatch des events suivants pendant sa durée d'affichage. Pas une corrélation cross-event ; un timer self-contained. Implémenté comme directive runner (au niveau de `barrier`, `await-signal`, `lp`), pas une règle DEP. |

Le seuil de bascule pattern-driven (>15 cas) reste éloigné. L'ajout
de nouvelles familles attendues à moyen terme : pendulum-effect,
link-arrow-trigger, et possiblement d'autres flow-rewrite si OCGCore
émet d'autres séquences "REASON_RULE settling" sur des patterns non
encore audités (cf. §3 cas écartés).

---

## §3 Cas explicitement écartés (non pertinents pour ε3)

À documenter dans §3.7 pour éviter qu'un futur dev les ajoute à tort.

**Cas écartés Pass 1** :

- **`MSG_DRAW` + `MSG_CONFIRM_CARDS` (draw phase normale)** : l'ordre
  est garanti par le protocole, c'est du traitement séquentiel pur.
- **`MSG_NEW_PHASE` → phase visual update** : transition de phase
  instantanée, pas d'animation à attendre. Projection simple sur
  `chainPhase`.
- **`MSG_DAMAGE` → LP counter update** : side-effect synchrone du
  message. Pas de dépendance inter-événements (le couplage est intra-
  événement).
- **`MSG_SHUFFLE_DECK` → deck visual refresh** : pas d'animation à
  attendre, refresh instantané.

**Cas écartés Pass 2** :

- **`MSG_HINT` + target highlight** : MSG_HINT est texte-seul
  (indication serveur — "vous voyez le top du deck"). Le highlight passe
  par `MSG_CONFIRM_CARDS`, pas `MSG_HINT`. Pas ε3.
- **`MSG_TOSS_COIN` / `MSG_TOSS_DICE` + display du résultat** :
  animation autonome (toast), pas d'awaiting d'un autre événement.
- **Pendulum scale sync + EMZ summon** : aucun MSG_* spécifique, les
  scales et l'état EMZ arrivent via `BOARD_STATE` snapshots. Pas de
  dépendance inter-événements côté pipeline.
- **Link arrow display** : `linkedCards[]` du board state, rendu
  statique, non animé.
- **Chain overlay show/hide timing** : couvert implicitement par #2
  (`trigger-effect-activation`) et la gestion d'overlay existante.
- **`become-target-reticle-clear-timing`** (marginal) : race théorique
  si `MSG_CHAIN_SOLVING` arrive avant la fin du timeout
  `BECOME_TARGET_PULSE_MS`. En PvP live, l'ordre serveur garantit que le
  timeout (600ms) expire toujours avant le SOLVING. Seul cas observable
  en replay slow-playback. Documenté ici pour mémoire, **non retenu**
  comme deferred — à traiter via convention "timeout < latence
  réseau-moyenne" plutôt que par ε3.

**Cas écartés Pass 3** :

- **`MSG_MOVE` MZONE→EXTRA d'un matériau d'XYZ en cours d'invocation**
  (cf. β.3 bug #1 visuel). Pattern : OCGCore route les matériaux d'un
  XYZ summon par un détour logique `MZONE → EXTRA` (toSeq=7) avant que
  le MSG_MOVE de l'XYZ lui-même (`EXTRA → MZONE`) n'arrive. Le front
  anime les matériaux vers l'EXTRA via `leaveFieldNonDestroy`, ce qui
  donne visuellement "les matériaux partent au extra deck". **Non
  retenu comme deferred classique** parce que la résolution naturelle
  est un rewrite du flux (rerouter le travel des matériaux vers la zone
  finale de l'XYZ), même nature que cas #12 — donc un cas
  Flow-rewrite. **À évaluer en pass 4** si ce pattern doit devenir le
  cas #13 ou être absorbé dans une généralisation du cas #12.
  Aujourd'hui : laissé en backlog, le visuel est acceptable bien
  qu'imparfait.
- **Autres séquences `REASON_RULE` (0x400) non auditées** : OCGCore
  émet des `reason=REASON_RULE` dans plusieurs scénarios non couverts
  par la pass 3 (e.g. cards qui changent de location automatiquement
  pour suivre une règle de jeu — Pendulum scales déplacés par effet,
  cards renvoyées par P-Effect, etc.). **Audit incomplet** —
  l'investigation β.3 a découvert le cas XYZ-leave par accident, pas
  via une recherche exhaustive `reason & REASON_RULE`. Recommandation
  pour pass 4 : grep des `Duel.SendtoGrave/SendtoHand` avec
  `REASON_RULE` dans `duel-server/data/scripts_full/` pour lister les
  scénarios où le bug visuel pourrait se reproduire.

Règle générale : ε3 est **pour les dépendances inter-événements visibles**
seulement. Si la dépendance est interne à un seul handler (sync), ou
si l'ordre est garanti par le protocole (server-side timing), c'est du
code normal. **Exception : famille "Flow rewrite"** (cas #12 et
candidats pass 3) — ε3 absorbe ces cas par défaut tant qu'aucun
processor dédié n'est créé.

---

## §4 Tests de victoire dérivés

À intégrer dans §3.7bis "Tests obligatoires" du doc cadrage. Six tests
suffisent à couvrir les 9 familles (cas représentatif par famille la
plus risquée) :

1. **Cas #1 (overlay-show + cost)** — déjà spécifié dans `bug-cost-before-overlay-sequence.md`. Famille **Cost-deferral**.
2. **Cas #2 (trigger-effect-activation post-summon)** — nouveau test. Famille **Summon + trigger**. Séquence Snake-Eye Ash pose → trigger chaîne → assert overlay invisible jusqu'à fin pose.
3. **Cas #8 (xyz-overlay-attach multi-matériaux)** — nouveau test. Famille **Multi-event sequencing** + dépendance en chaîne. Séquence 3 matériaux + pose XYZ → assert overlay visible uniquement à la fin du dernier travel.
4. **Cas #11 (pile-target-float-cleanup)** — nouveau test. Famille **Cleanup post-chain**. Séquence MSG_BECOME_TARGET sur card en GY → float reticle visible → MSG_CHAIN_SOLVING → assert float fade-out complet avant clear `targetedZoneKeys`.
5. **Cas #12 (xyz-leave-with-materials)** — nouveau test (pass 3). Famille **Flow rewrite**. Pour couvrir la nature spéciale du rewrite, le test doit vérifier DEUX assertions distinctes :
   - **Assertion structurelle** : les `MSG_MOVE GRAVE→GRAVE reason=0x600` émis par OCGCore après le départ de l'XYZ sont absorbés (drop du routing) — assert qu'aucun travel `pileToPile` n'est lancé avec ces cardCodes après le trigger.
   - **Assertion visuelle** : N travels matériaux (`OVERLAY→GRAVE` synthétiques) sont lancés depuis la position MZONE de l'XYZ vers le GY pendant ou juste après le travel de l'XYZ — assert l'existence des floats correspondants dans `floatRegistry` pendant la fenêtre du travel.
   Séquence canonique du test : XYZ posé avec 2 matériaux → utilisation comme matériel de Link summon → vérifier les 2 assertions ci-dessus. Variantes secondaires à exécuter en pass de régression : XYZ détruit en battle, XYZ tributé pour Tribute Summon, XYZ banni.
6. **Cas #13 (sequential-announcement-gating)** — nouveau test (pass 4). Famille **Sequential timer gating**. Deux scénarios à couvrir :
   - **Scénario chain** : multi-link chain (CL2 sur CL1) → annonce "Chain Resolution" apparaît → assert que l'overlay de résolution du premier link N'EST PAS visible pendant l'annonce → fin du timer annonce → assert la bannière disparaît ET l'overlay apparaît dans la foulée.
   - **Scénario phase** : enchaînement DRAW → MAIN1 → assert que pendant l'annonce "DRAW PHASE" (2000ms), le `SELECT_IDLECMD` reçu du serveur N'EST PAS dispatché au `PromptDerivationService` (donc le menu d'action n'est pas visible et l'utilisateur ne peut pas summon). Fin du timer annonce → assert `SELECT_IDLECMD` est dispatché et le menu apparaît.
   Test d'isolation : burst de 3 phase changes consécutifs (DRAW → STANDBY → MAIN1) → assert les 3 annonces sont jouées en séquence (pas en parallèle), durée totale ~6000ms (3 × 2000ms), et aucun event de queue n'est dispatché entre elles.

Les cas #5 et #6 sont voisins de #8 (multi-event) et #1 (LP cost). #10
est voisin de #11 (animation lifecycle). Les 6 tests ci-dessus
couvrent les 9 familles et suffisent au filet de sécurité de bascule.

---

## §5 Capitalisation pour la rédaction §3.7

À intégrer dans `duel-session-chantier.md` §3.7 :

- **Remplacer** *"il existe une table de règles métier ('quels événements déclenchent quels effets différés, attendant quelles complétions')"* par un pointeur vers ce catalogue + la phrase *"13 cas catalogués (4 passes Explore — 11 cas classiques DEP + 1 cas Flow-rewrite DEP étendu + 1 cas Sequential timer gating runner), voir `deferred-effects-catalogue.md`."*
- **Ajouter** un paragraphe explicite sur les cas écartés (cf. §3 de ce doc) pour cadrer le scope du processor.
- **Mentionner la famille Flow-rewrite (cas #12)** comme extension de l'API DEP : le processor doit pouvoir non seulement émettre `EffectReady` mais aussi marquer des events à drop du routing aval. Spec d'impl à figer en β (probablement un retour `{kind:'absorb'}` du callback `chainTo` en plus de `{kind:'animation', type:'AnimationCompleted', ref}`).
- **Mentionner la famille Sequential timer gating (cas #13)** comme directive runner (PAS une règle DEP). Implémentée comme nouvelle directive `announcement` dans le `QueueRunner` au même niveau que `barrier` / `await-signal` / `lp`. Migration des deux call-sites existants (`PhaseAnnouncementService.show(...)` et `ChainResolutionAnnounceProjection`'s `phaseWait`) vers la directive.
- **Insister** sur le processor comme **unique** lieu de la connaissance YGO de qui attend qui (pour les 11 familles DEP). Toute nouvelle règle de dépendance YGO se traite par ajout dans le catalogue + ajout dans la table de règles ; jamais ad-hoc dans une projection ou un handler. Les annonces et la séquentialité timer-driven (#13) restent côté runner — pas de YGO knowledge requise.
- **Ajouter §3.7bis "Tests obligatoires"** listant les 6 tests de §4 ci-dessus + les 4 scénarios de casse documentés dans la réserve R6 (SOLO PvP switch, replay seek, burst SOLVING, animations parallèles).
- **Note pour Phase γ** : les cas #12 et #13 ne dépendent pas du single-DuelEventProcessor de la Phase γ ; ils peuvent être livrés en β. Mais le bug visuel β.3 bug #1 (matériaux XYZ summon vers EXTRA, candidat pass 3) sera plus facile à fixer une fois le pipeline unifié de γ en place (un seul flux d'événements à intercepter).
