---
title: Catalogue des deferred effects (ε3) — Pipeline d'animation
status: ready (calibrage ε3 case-driven validé, 2 passes Explore)
addresses_risks:
  - R6 réserve "Lister 5-15 cas concrets avant de figer §3.7"
  - ADV-11 "Exemple Ash trop happy-path"
context_doc: duel-session-chantier.md §3.7
passes:
  - pass1 (exemples YGO drivés) — 9 cas
  - pass2 (méthode inverse MSG_* + grep triggers ad-hoc + animations non-card) — 2 cas nouveaux pertinents + 1 marginal écarté
date: 2026-05-25
---

# Catalogue des deferred effects (ε3)

Catalogue des couples `(trigger, awaiting)` qui matérialisent les
corrélations cross-event dans la pipeline d'animation. Sert de table de
référence pour le futur `DeferredEffectProcessor` (cf. §3.7 du doc
cadrage et §4.2 de la section Existant → Cible).

**Verdict de calibrage** : 11 cas identifiés (9 pass 1 + 2 pass 2)
→ ε3 **case-driven est bien dimensionné**. Seuil favorable
maintenu (< 15 cas). Pas besoin de mécanique pattern-driven plus
générique.

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

---

## §2 Groupement par famille (info utile, pas structurel)

Les 9 cas se regroupent naturellement en 5 familles. Cette taxonomie
n'est pas nécessaire à l'implémentation (le processor a 9 règles
indépendantes), mais elle aide à raisonner sur l'extensibilité du
mécanisme.

| Famille | Cas | Pattern générique |
|---|---|---|
| **Cost-deferral** | #1, #9 | Overlay/effect attend la fin du `MSG_MOVE` cost ou du `MSG_PAY_LPCOST` |
| **Summon + trigger** | #2, #4 | Trigger effect activation attend la complétion de l'animation du monstre (summon ou flip) |
| **Multi-event sequencing** | #3, #5, #8 | Reveal ou attachment attend N travels séquentiels ou batch completion |
| **Battle + impact** | #6 | Trigger counter attend `DAMAGE_STEP_END` ou impact visual |
| **Zone animation deps** | #7 | Stat/property update attend l'animation de mouvement vers la zone |
| **Visual badge lifecycle** | #10 | Badge/counter pulse attend la fin de sa propre animation avant mutation |
| **Cleanup post-chain** | #11 | Élément visuel (float, reticle) attend `AnimationCompleted` du fade-out avant clear |

Une 10e ou 11e famille apparaîtrait probablement avec l'ajout de
nouveaux types d'effets (ex: pendulum-effect, link-arrow-trigger), mais
le seuil de bascule pattern-driven (>15 cas) reste éloigné.

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

Règle générale : ε3 est **pour les dépendances inter-événements visibles**
seulement. Si la dépendance est interne à un seul handler (sync), ou
si l'ordre est garanti par le protocole (server-side timing), c'est du
code normal.

---

## §4 Tests de victoire dérivés

À intégrer dans §3.7bis "Tests obligatoires" du doc cadrage. Trois tests
suffisent à couvrir les 5 familles (cas représentatif par famille la
plus risquée) :

1. **Cas #1 (overlay-show + cost)** — déjà spécifié dans `bug-cost-before-overlay-sequence.md`. Famille **Cost-deferral**.
2. **Cas #2 (trigger-effect-activation post-summon)** — nouveau test. Famille **Summon + trigger**. Séquence Snake-Eye Ash pose → trigger chaîne → assert overlay invisible jusqu'à fin pose.
3. **Cas #8 (xyz-overlay-attach multi-matériaux)** — nouveau test. Famille **Multi-event sequencing** + dépendance en chaîne. Séquence 3 matériaux + pose XYZ → assert overlay visible uniquement à la fin du dernier travel.
4. **Cas #11 (pile-target-float-cleanup)** — nouveau test. Famille **Cleanup post-chain**. Séquence MSG_BECOME_TARGET sur card en GY → float reticle visible → MSG_CHAIN_SOLVING → assert float fade-out complet avant clear `targetedZoneKeys`.

Les cas #5 et #6 sont voisins de #8 (multi-event) et #1 (LP cost). #10
est voisin de #11 (animation lifecycle). Les 4 tests ci-dessus
couvrent les 7 familles et suffisent au filet de sécurité de bascule.

---

## §5 Capitalisation pour la rédaction §3.7

À intégrer dans `duel-session-chantier.md` §3.7 :

- **Remplacer** *"il existe une table de règles métier ('quels événements déclenchent quels effets différés, attendant quelles complétions')"* par un pointeur vers ce catalogue + la phrase *"11 règles initiales (2 passes Explore), voir `deferred-effects-catalogue.md`."*
- **Ajouter** un paragraphe explicite sur les cas écartés (cf. §3 de ce doc) pour cadrer le scope du processor.
- **Insister** sur le processor comme **unique** lieu de la connaissance YGO de qui attend qui. Toute nouvelle règle de dépendance se traite par ajout dans le catalogue + ajout dans la table de règles ; jamais ad-hoc dans une projection ou un handler.
- **Ajouter §3.7bis "Tests obligatoires"** listant les 3 tests de §4 ci-dessus + les 4 scénarios de casse documentés dans la réserve R6 (SOLO PvP switch, replay seek, burst SOLVING, animations parallèles).
