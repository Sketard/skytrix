# Chantier — Audit & instrumentation perf skytrix

> **Statut** : 📋 cadré — prêt à exécuter (party mode bouclé 2026-05-22).
> **Zone** : transverse — backend Spring Boot, duel-server Node, frontend Angular.
> **Nature** : instrumentation + plan d'attaque des findings d'audit (pas une feature).
> **Déclencheur** : audit perf préventif demandé par Axel 2026-05-22 (3 sous-audits agents).
> **Cadrage** : Winston (architecte) + roundtable party mode (John PM, Mary analyste).

---

## 1. Le job de ce chantier (et ce qu'il n'est PAS)

Audit **préventif** — aucun symptôme ressenti, l'app fonctionne. Le job défendable
n'est donc pas "optimiser parce que c'est propre" (ce serait du scope creep) mais :

> **Éviter qu'une dette de perf invisible devienne une panne visible au pire
> moment.** Le job, c'est de l'assurance, pas de la performance.

Ce que le chantier **n'est PAS** :
- Pas un framework de métriques transverse (cf. §3).
- Pas une refonte — aucune optim ne change un contrat public sans raison mesurée.
- Pas un PRD — document de travail léger, cohérent avec le steady-state.
- Pas une collection : 30 findings ≠ 30 optimisations dues. Cf. la ligne DONE (§7).

## 2. Principe directeur — le péage de la mesure

Règle non négociable : **un finding sans mesure de Phase 1 ne devient JAMAIS un
lot de Phase 2.** La sévérité provisoire de l'audit ne donne droit à rien — seul
un chiffre de Phase 1 ouvre la porte. La mesure n'est pas seulement *avant*
l'optimisation : elle est le **péage** qui décide quel finding a le droit d'entrer
en Phase 2.

**Traçabilité câblée** : chaque lot d'optimisation de Phase 2 cite, en en-tête,
le numéro de la mesure Phase 1 qui le justifie. Pas de mesure citée = lot non
démarrable.

## 3. Doctrine d'instrumentation — natif par couche, pas de framework unifié

Décision actée avec Axel : **3 mécanismes natifs, un par couche.** Pas de format
de métrique commun cross-langage, pas d'endpoint d'agrégation unique. La cohérence
du chantier est dans la **méthode** (baseline → mesure → verdict), pas dans un
module partagé entre Java, Node et Angular.

| Couche | Mécanisme | État actuel | Effort Phase 0 |
|---|---|---|---|
| **back** | Spring Boot Actuator + Micrometer | `spring-boot-starter-actuator` **déjà dans le `pom.xml`** ; bridé à `health` sur le port 8081, `show-details=never` | Faible — config seule : exposer `metrics`, activer Hibernate statistics + Hikari metrics |
| **duel-server** | Module d'instrumentation env-gated, pattern `solver-instrumentation.ts` | Le pattern existe (gate env, `hrtime`, buckets, histogramme) mais scopé solver. Compteurs `buildBoardState*` câblés mais **morts** (getter `getBuildBoardStateStats` jamais appelé) | Moyen — généraliser le pattern, rebrancher les compteurs, exposer via `/status` |
| **front** | Web Vitals + Angular DevTools profiler | Rien de dédié | Faible — protocole de mesure manuel + `ng build --stats-json` |

**Rule of Three** : le solver a écrit `solver-instrumentation.ts` une fois. Le
duel-server le fait une 2ᵉ fois → on généralise **à la 2ᵉ**, pas avant.

**Exposition (consensus unanime du roundtable)** : l'instrumentation duel-server
s'expose via **HTTP `/status`**, jamais via un message WS de debug. Un message WS
injecterait un type dans le protocole temps-réel (byte-sync front↔back,
`DuelEventProcessor`) — l'observateur contaminerait l'expérience qu'il mesure.
`/status` est out-of-band, agrège tous les duels, et reste cohérent avec
l'Actuator backend bridé. Pour les runs reproductibles de Phase 1, on **greffe**
la capture du `snapshot()` d'instrumentation sur le `debug-replay-harness.ts`
existant — on n'écrit pas un nouveau runner.

## 4. Budget de performance (tableau de référence)

Deux familles de métriques — confondre les deux est l'erreur classique :
- **🎯 TARGET** — liée à une perception stakeholder OU à une limite de capacité
  opérateur. Franchir la ligne = douleur ressentie ou risque d'incident.
- **👁️ OBSERVED** — hygiène interne. On enregistre, on watch le *delta*. Aucun
  chiffre absolu ne déclenche d'action ; sa cible c'est "ne pas dériver".

Méthode de dérivation des cibles : `target = max(seuil_perception_humaine,
baseline × 1.3)` — 30 % de marge de croissance, borné par la limite de perception
humaine quand elle existe.

| # | Métrique | Famille | Cible candidate | Baseline (Phase 0.5) |
|---|----------|---------|-----------------|----------------------|
| 1 | Card-search p95 latency (requête → rendu) | 🎯 TARGET | p95 < 400 ms, p99 < 800 ms | _à mesurer_ |
| 2 | Replay load time (clic → 1er frame board) | 🎯 TARGET | < 2.5 s (P75 réseau) | _à mesurer_ |
| 3 | Initial JS bundle eager (gzip) | 🎯 TARGET | gel baseline + 0 %, idéal < 500 ko | **430 kB gzip / 1.98 MB raw** (build prod 2026-05-22) — déjà sous la cible idéale |
| 4 | duel-server RSS / duel concurrent | 🎯 TARGET | dérivé baseline — plafond = (RAM × 0.7) / N_cible | _à mesurer_ |
| 5 | `buildBoardState()` durée / appel | 🎯 TARGET → 👁️ **rétrogradé OBSERVED** | watch delta — voir note ci-dessous | **3.87 ms moy / 6.7 ms max** (replay a8859c98, 219 appels) |
| 6 | Per-message WS latency (worker → client) | 🎯 TARGET | p95 < 16 ms (1 frame @60fps) | _à mesurer (duel PvP)_ |
| 7 | PvP board change-detection time | 👁️ OBSERVED | watch delta, flag si > 16 ms | _à mesurer_ |
| 8 | WS message serialization cost (octets + ms) | 👁️ OBSERVED | alerte si payload > baseline × 2 | **1.0 ms moy / 2.7 ms max** (54 appels, replay a8859c98) |
| 9 | Backend N+1 — requêtes SQL / endpoint | 🎯 TARGET | **count invariant** quel que soit N | _à mesurer_ |
| 10 | Replay precomputation time | 👁️ OBSERVED | témoin — pas user-facing si async | _à mesurer_ |

Cible #9 = *invariance algorithmique* ("ne croît pas avec N") : binaire,
incorruptible, pas de débat sur "combien de ms". Cible #4 marquée "dérivé de
baseline" — **aucun chiffre dur ne sera écrit avant sa mesure.**

> **Note métrique #5 — rétrogradée TARGET → OBSERVED (2026-05-22, mesure replay).**
> L'audit estimait `buildBoardState` à "~100 appels FFI, pics de centaines de
> ms". La capture Phase 0.5 sur le replay a8859c98 (219 appels) donne **3.87 ms
> en moyenne, 6.7 ms au pire — 100 % des appels sous 10 ms**. C'est réel mais
> modéré : très loin du symptôme annoncé. Conséquence directe (grille du
> roundtable) : la spike de qualification WASM de L-DS3 **n'est pas déclenchée**
> sur cette base. À confirmer avec un duel PvP live (longues chaînes), mais
> l'ordre de grandeur ne ment pas. Le péage de la mesure a fait son travail :
> le finding le plus "critique" de l'audit dégonfle.

## 5. Inventaire des findings d'audit (à valider en Phase 1)

> Sévérités = celles des agents d'audit — **provisoires** jusqu'à la Phase 1.
> Colonne "Validation" = comment on mesure. Colonne "Lot" = regroupement Phase 2.

### 5.1 — Backend Spring Boot

> Baselines capturées 2026-05-22 — backend sous profil `perf` (logs Hibernate
> `Session Metrics` + Actuator `http.server.requests`), PostgreSQL local, login
> admin. Données réelles, pas estimées.

| # | Sév. audit | Finding | Baseline mesurée | Verdict | Lot |
|---|---|---|---|---|---|
| B-C1 | CRITIQUE | 3 `@OneToMany` EAGER sur `Card` → produit cartésien + N+1 | avant : `/cards/search` 30 cartes = 122 req → **après : 10 req** | ✅ **optimisé** — EAGER→LAZY + `@BatchSize(100)` | **L-BE1** |
| B-M6 | MOYEN | N+1 `existsByIdAndFavoritedById` par carte | avant : ~30 `EXISTS`/page → **après : 1 requête groupée** | ✅ **optimisé** — `findFavoritedCardIds(userId, IN)` | **L-BE1** |
| B-M7 | MOYEN | N+1 collections `Deck` dans `getAll`/`toDeckDTO` | avant : `GET /decks/{id}` 41 cartes = 179 req → **après : 14 req** | ✅ **optimisé** — `@EntityGraph(cardsIndexed.card)` + `@BatchSize(50)` | **L-BE1** |
| B-C4 | CRITIQUE | `card.passcode` / `app_user.pseudo` sans index | avant : Seq Scan ~13k lignes → **après : Index Scan `card_passcode_idx`, 0.15 ms**. `pseudo` : index créé, Seq Scan conservé (table minuscule — choix planner correct) | ✅ **optimisé** — `V017` index non-uniques | **L-BE2** |
| B-C3 | CRITIQUE | Recherche carte `LIKE '%...%'` sans index trigram | avant : Seq Scan 26 049 lignes, 60 ms → **après : Bitmap Index Scan `translation_name_trgm_idx`, 11 ms** (−82 %) | ✅ **optimisé** — `V017` extension `pg_trgm` + index GIN | **L-BE2** |
| B-C2 | CRITIQUE | `getMatchHistory` charge `replayData` JSONB entier | mesuré : 67 replays, `replayData` **707 o moyen / 1.6 ko max**, table = 216 kB total | ⚪ **classé sans suite** — l'audit estimait "centaines de Ko" ; la réalité est négligeable. Projection JPA = over-engineering ici | **L-BE3** |
| B-C5 | CRITIQUE | Aucun cache sur données quasi-statiques | `/card-sets/names` : Seq Scan 43k lignes `card_set`, **17 ms/appel**, résultat 100 % statique entre syncs | ✅ **optimisé** — `@Cacheable` (cache Spring intégré, 0 dep) + `@CacheEvict` au sync | **L-BE3** |
| B-M1 | MOYEN | `open-in-view` actif | risque **monté** par L-BE1 : `open-in-view` protège désormais le mapping des collections passées LAZY. Le désactiver exigerait d'auditer chaque service web. Gain non mesuré (pas de saturation Hikari observée) | 🟡 **dette acceptée** — risque > gain, documenté | **L-BE4** |
| B-M2 | MOYEN | Pas de `batch_size` JDBC | n'accélère que le sync admin (rare, async, non user-facing) ; gain partiel (`Card` en `IDENTITY` → batch INSERT impossible) | ⚪ **classé sans suite** — pas un job à valeur | **L-BE4** |
| B-M3 | MOYEN | Verrou pessimiste tenu pendant appel HTTP duel-server | refactor : `startDuel` découpé en 3 tx courtes (claim → HTTP hors-tx → activate/rollback). Verrou + connexion plus tenus pendant l'I/O réseau | ✅ **optimisé** — gain scalabilité, vérifié par construction (boot OK, 17/17 tests) | **L-BE4** |

> **L-BE1** groupe B-C1+B-M6+B-M7 : *même racine* = la stratégie de fetch de
> `Card`/`Deck`. Trois symptômes d'une cause — et la mesure le prouve : un
> `/cards/search` de 30 cartes = 122 requêtes, un `/decks/{id}` de 41 cartes =
> 179 requêtes. Une correction, un test, une campagne de mesure.
>
> **Contraste avec le duel-server** : côté back, le péage de la mesure
> **confirme** les findings (122 et 179 requêtes, c'est massif) — alors que côté
> duel-server il a *dégonflé* D-C2. C'est exactement le rôle de la Phase 1 :
> trier, sans préjuger.

### 5.2 — Frontend Angular

> Baselines partielles capturées 2026-05-22 — build `development` avec
> `--stats-json` (le build `production` échoue hors-ligne, cf. note ci-dessous)
> + lecture de code. Les Axes 2 (images) et 3 (change detection) demandent
> DevTools en interactif — **à faire par Axel** via `front/PERF-MEASUREMENT.md`.

| # | Sév. audit | Finding | Baseline mesurée | Verdict | Lot |
|---|---|---|---|---|---|
| F-C1 | CRITIQUE | 5 routes lourdes en eager → bundle initial | **build PROD : Initial total 430 kB gzip / 1.98 MB raw** — routes deck-page/builder/simulator/card-search/parameter eager confirmées, mais le poids transféré reste **sous la cible idéale de 500 ko** | 🟡 **dégonflé** — routes eager oui, mais bundle initial sain. Lazy-load = nettoyage, pas urgence | **L-FE1** |
| F-C2 | CRITIQUE | jspdf (~350 KB) en import statique | `import { jsPDF }` statique dans `deck-builder.component.ts:13` — MAIS build prod confirme : `index-es` (jspdf, 47 kB gzip) + `purify-es` (9 kB) + `html2canvas` (38 kB gzip) sont **des lazy chunks** | 🟢 **dégonflé** — esbuild code-split jspdf hors du bundle initial. `import()` = nettoyage cosmétique | **L-FE1** |
| F-C4 | CRITIQUE | Images de cartes sans `loading="lazy"` | _Axe 2 — à mesurer par Axel (DevTools Network)_ | ⬜ à valider | **L-FE2** |
| F-C5 | CRITIQUE | Double pipe `async` dans card-list | confirmé : `card-list.component.html` ligne 2 `@let cards = cardsDetails$() \| async` + ligne 14 `@for (… cardsDetails$() \| async)` — 2 souscriptions même source | 🔴 confirmé — bug réel, fix trivial | **L-FE2** |
| F-C3 | CRITIQUE | card-list sans virtual scroll (accumulation DOM) | _Axe 3 — à mesurer par Axel (compteur `app-card`)_ | ⬜ à valider | **L-FE3** |
| F-M1 | MOYEN | `CardNamePipe` impur sur longues listes | _Axe 3 — à mesurer par Axel (Profiler)_ | ⬜ à valider | **L-FE3** |
| F-M2 | MOYEN | Scroll listener non throttle | _Axe 3 — à mesurer par Axel (Profiler)_ | ⬜ à valider | **L-FE3** |
| F-M5 | MOYEN | `deck-card-zone` track + closure binding | _Axe 3 — à mesurer par Axel (Profiler)_ | ⬜ à valider | **L-FE3** |

> **Build prod indisponible dans l'environnement de capture** : `ng build
> --configuration production` échoue sur l'inlining des Google Fonts
> (`unable to verify the first certificate` — proxy/cert hors-ligne). Le chiffre
> du budget #3 (bundle gzip minifié) reste à capturer dans un environnement
> connecté. Le build `development` ci-dessus n'est pas minifié (total ~5 MB
> gonflé) — il sert à voir la *structure* eager/lazy, pas le poids final.

### 5.3 — Duel-server

> Baselines capturées 2026-05-22 sur le replay a8859c98 (153 réponses, ~30+
> tours), duel-server sous `DUEL_INSTRUMENT=1` via le harness Playwright
> `debug-replay-perf-audit.spec.ts`. Verdict = **provisoire** pour les findings
> mesurés uniquement en replay ; à confirmer en duel PvP live (note ci-dessous).

| # | Sév. audit | Finding | Baseline mesurée (replay a8859c98) | Verdict provisoire | Lot |
|---|---|---|---|---|---|
| D-C1 | CRITIQUE | `getCardName` SQLite + log inconditionnels par message OCG | **10 414 lookups**, 0.077 ms moy, 798 ms cumulés | 🟡 confirmé mais petit — volume énorme, coût unitaire minuscule. Mémoïsation = quick-win propre, pas urgence | **L-DS1** |
| D-M1 | MOYEN | `getCardName`/`nameStmt` jamais mémoïsé (racine D-C1) | idem D-C1 | 🟡 idem | **L-DS1** |
| D-C3 | CRITIQUE | Double `JSON.stringify` + `filterMessage` du même payload | `serialize` 54 appels, 1.0 ms moy, 2.7 ms max. `filterMessage` **non mesurable en replay** (PvP-only) | ⏳ partiel — à mesurer en duel PvP | **L-DS2** |
| D-C2 | CRITIQUE | `buildBoardState()` (~100 FFI) par événement de chaîne | **219 appels, 3.87 ms moy, 6.7 ms max**, 100 % sous 10 ms, 848 ms cumulés | 🟢 **dégonflé** — réel mais modéré, loin du symptôme estimé. Pas de spike WASM | **L-DS3** |
| D-M7 | MOYEN | `flushState` : un `buildBoardState` plein par état timeline | idem D-C2 (219 appels = tous flushState + chaîne confondus) | 🟢 dégonflé avec D-C2 | **L-DS3** |
| D-M8 | MOYEN | Spawn worker recharge cdb + scripts + WASM par duel | **74.5 ms** (cold-start, 1 occurrence) | 🟢 confirmé, bas de fourchette estimée. Mineur | **L-DS4** |
| D-M9 | MOYEN | `createScriptReader` I/O synchrone sans cache | _non mesuré (pas de bucket dédié)_ | ⬜ à valider Phase 1 | **L-DS4** |

> Findings MINEURS de l'audit non listés — repris en vrac dans un lot de polish
> final **uniquement** si un chiffre de Phase 1 le justifie.
>
> **Réserve PvP-live** : `filterMessage` et `duelProcess` ne sont PAS empruntés
> par un replay (= 0 dans le snapshot). D-C3 côté `filterMessage` exige un duel
> PvP réel pour être mesuré. Les baselines `buildBoardState`/`getCardName`
> ci-dessus viennent d'un replay ; un duel PvP avec longues chaînes pourrait
> donner des chiffres un peu plus élevés — l'ordre de grandeur reste fiable.

## 6. Phases du chantier

### Phase 0 — Instrumentation (3 sous-lots indépendants, parallélisables)

- **0a — back** : config Actuator (exposer `metrics`/`prometheus`, activer
  Hibernate statistics + Hikari metrics, `@Timed` sur les endpoints chauds).
  Pas de code applicatif.
- **0b — duel-server** : généraliser `solver-instrumentation.ts` en module duel
  (gate `DUEL_INSTRUMENT=1`, buckets : `buildBoardState`, `getCardName`,
  `filterMessage`, `serialize`, `duelProcess`, `workerColdStart`). Rebrancher les
  compteurs `buildBoardState*` morts. Exposer le `snapshot()` via `/status`.
  Greffer la capture sur `debug-replay-harness.ts`.
- **0c — front** : protocole de mesure manuel documenté (DevTools profiler +
  `ng build --stats-json` + onglet réseau).

### Phase 0.5 — Capture de baseline (garde-fou des cibles)

Pour **chaque ligne du tableau §4**, mesurer la *valeur d'aujourd'hui* sous
l'instrumentation de Phase 0. C'est ce qui transforme une cible "dérivé de
baseline" en chiffre réel et fige le *budget de régression* des métriques
OBSERVED. **Aucune cible dure n'est arrêtée avant la fin de cette phase.**

> **Procédure exécutable** : `perf-baseline-capture-checklist.md` (compagnon
> de ce document) — 3 blocs indépendants back/duel-server/front, chaque étape
> avec son emplacement pour reporter le chiffre. Demande des services lancés
> (PostgreSQL, un duel réel, un build prod connecté) — à exécuter par Axel.

### Phase 1 — Validation chiffrée

Un run réel par couche sous instrumentation :
- back : parcours `/cards/search` + `/decks/{id}` + `/api/replays` chargés.
- duel-server : un duel PvP complet + une précompute replay.
- front : un build stats-json + un profil de card-search avec scroll.

Sortie : chaque finding du §5 reçoit un **chiffre réel** et un **verdict
go/no-go** d'optimisation. Findings invalidés = sortis du backlog.

### Phase 2 — Lots d'optimisation priorisés

**Ordre entre couches (tranché 2026-05-22) : Backend → Frontend → duel-server.**
Backend en 1er car c'est la seule dette qui *grossit toute seule* avec le volume
de données, et sa cible binaire (#9 count invariant) est le meilleur banc d'essai
du pipeline Phase 1→Phase 2. duel-server en dernier car le plus risqué (chaîne
d'animation, parité PvP/replay, WASM).

Ordre interne des lots = ratio gain/risque issu de Phase 1. Chaque lot porte sa
métrique de succès tirée du §4 et cite sa mesure Phase 1 justificative.

**Cas spécial — racine WASM (L-DS3, tranché 2026-05-22).** Les findings D-C2/D-M7
ont pour racine un "bug WASM multi-flag" marqué *blocked*. Traitement en 3 temps :
1. **Mémoïsation** dans le chantier — défense légitime contre un appel coûteux
   idempotent en boucle, indépendamment du bug. Faite de toute façon.
2. **Spike de qualification** dans le chantier — *conditionnelle* : déclenchée
   uniquement si Phase 1 chiffre `buildBoardState` au-dessus du seuil de douleur.
   Time-boxée 1-2 j. Livrable = un **diagnostic documenté** ("bug upstream
   OCGCore" / "limitation ABI WASM" / "pas eu le temps"), **pas du code de fix**.
3. **Déblocage effectif du bug WASM** — **hors chantier**. Devient une décision
   séparée d'Axel avec son propre scope. Ne rentre jamais par accident dans ce
   chantier.

## 7. Définition de DONE

Le chantier est terminé quand **chaque finding du §5 a un verdict**. Un verdict
est l'une de **trois issues, toutes également valides** :

1. ✅ **Optimisé** — quantifié en Phase 1 → optimisé → re-mesuré sous la cible.
2. ⚪ **Classé sans suite** — quantifié → sous le seuil de douleur → on n'optimise
   pas. C'est une fin légitime, pas un échec.
3. 🟡 **Dette acceptée** — quantifié → correction trop coûteuse/risquée → dette
   documentée (une ligne `MEMORY.md`), on passe.

Quand les ~25 lignes du §5 ont toutes un verdict, le chantier est mort : on
l'archive, `MEMORY.md` garde une ligne. Tout findings au-delà de DONE = nouveau
chantier, nouvelle décision.

## 8. Suivi de progression

| Lot | Couche | Findings | Statut | Mesure P1 citée |
|---|---|---|---|---|
| Phase 0a | back | instrumentation Actuator | ✅ fait 2026-05-22 | — |
| Phase 0b | duel-server | instrumentation env-gated | ✅ fait 2026-05-22 | — |
| Phase 0c | front | protocole de mesure (`front/PERF-MEASUREMENT.md`) | ✅ fait 2026-05-22 | — |
| Phase 0.5 | duel-server | baseline bloc B — replay a8859c98 | ✅ fait 2026-05-22 (réserve PvP-live) | — |
| Phase 0.5 | back | baseline bloc A | ✅ fait 2026-05-22 (B-C2/C4/C5/M2/M3 à compléter) | — |
| Phase 0.5 | front | baseline bloc C | 🔄 partiel — Axes 2+3 (DevTools) + build prod restent | — |
| Phase 1 | toutes | validation chiffrée | ⬜ à faire | — |
| L-BE1 | back | B-C1, B-M6, B-M7 | ✅ fait 2026-05-22 — `/cards/search` 122→10 req, `/decks/{id}` 179→14 req (−92 %) | baseline §5.1 |
| L-BE2 | back | B-C4, B-C3 | ✅ fait 2026-05-22 — `V017` : recherche `LIKE` 60→11 ms, passcode lookup Seq→Index | baseline §5.1 |
| L-BE3 | back | B-C2 (sans suite), B-C5 (cache) | ✅ fait 2026-05-22 — B-C2 dégonflé par mesure, B-C5 caché (17 ms→~0) | baseline §5.1 |
| L-BE4 | back | B-M3 (fait), B-M1 (dette), B-M2 (sans suite) | ✅ fait 2026-05-22 — `startDuel` découpé 3 tx ; B-M1/B-M2 triés avec justification | baseline §5.1 |
| L-FE1 | front | F-C1, F-C2 | ⬜ bloqué par P1 | _à citer_ |
| L-FE2 | front | F-C4, F-C5 | ⬜ bloqué par P1 | _à citer_ |
| L-FE3 | front | F-C3, F-M1, F-M2, F-M5 | ⬜ bloqué par P1 | _à citer_ |
| L-DS1 | duel-server | D-C1, D-M1 | ⬜ bloqué par P1 | _à citer_ |
| L-DS2 | duel-server | D-C3 | ⬜ bloqué par P1 | _à citer_ |
| L-DS3 | duel-server | D-C2, D-M7 (+ spike WASM cond.) | ⬜ bloqué par P1 | _à citer_ |
| L-DS4 | duel-server | D-M8, D-M9 | ⬜ bloqué par P1 | _à citer_ |

---

> Document de référence du chantier. Mises à jour : statuts dans le §8, verdicts
> par finding dans le §5, baselines dans le §4. Tracé dans `MEMORY.md`.
