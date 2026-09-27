# Phase 0.5 — Checklist de capture de baseline

> Compagnon de `perf-audit-instrumentation-chantier.md` (§ Phase 0.5).
> **À exécuter par Axel** quand les services tournent — l'instrumentation de
> Phase 0 est en place, il reste à relever les chiffres réels.
>
> Règle : chaque chiffre relevé est reporté dans la colonne `baseline` du
> tableau §4 du doc de chantier, OU dans le verdict du finding au §5. Une
> capture sans chiffre reporté ne compte pas (péage de la mesure).
>
> Pas besoin de tout faire d'un coup — les 3 blocs (back / duel-server / front)
> sont indépendants. Cocher au fur et à mesure.

---

## Bloc A — Backend (cibles #1, #9 + findings B-C1/B-M6/B-M7, B-C3, B-C4, B-M1)

### A.0 — Démarrer

- [ ] PostgreSQL up (`docker compose up db` ou instance locale).
- [ ] Backend lancé **avec le profil perf** :
      `mvn spring-boot:run -Dspring-boot.run.profiles=perf`
      (ou `-Dspring.profiles.active=perf`). Le profil active les logs SQL.
- [ ] Se connecter à l'app pour avoir un JWT (les endpoints `/cards/**` et
      `/decks/**` sont authentifiés).

### A.1 — Card-search p95 (cible #1) + N+1 (B-C1, B-M6 → cible #9)

- [ ] Faire **une recherche de cartes** dans l'app (card-search, ~30 résultats).
- [ ] Dans les logs backend, repérer la ligne **`Session Metrics`** émise après
      la requête (logger `org.hibernate.stat` en DEBUG).
- [ ] **Relever** : nombre de `JDBC statements` (= count de requêtes SQL pour
      *un* `/cards/search`). C'est le chiffre N+1 — finding B-C1 + B-M6.
      → reporter sur **B-C1** au §5.
- [ ] **Latence** : d'abord lister les URI connues —
      `GET http://localhost:8081/actuator/metrics/http.server.requests`
      → champ `availableTags` → valeurs du tag `uri` (le path exact peut être
      `/cards/search` ou `/api/cards/search` selon le strip du context-path —
      prendre celui qui apparaît). Puis filtrer :
      `…/http.server.requests?tag=uri:<la-valeur-exacte>`
      → `TOTAL_TIME` / `COUNT` = moyenne, `MAX` = pire cas. Les p50/p95/p99
      apparaissent comme mesures additionnelles dans le même JSON (config
      `percentiles` client-side activée en 0a).
      Faire 10-20 recherches d'abord pour que le p95 soit significatif.
      → reporter sur **budget #1** au §4.

      Valeur relevée — count requêtes SQL : `_____`   p95 latence : `_____ ms`

### A.2 — Detail deck N+1 (B-M7 → cible #9)

- [ ] Ouvrir **un deck** (`GET /decks/{id}`, deck de ~40-60 cartes).
- [ ] Relever le `JDBC statements` de la ligne `Session Metrics` correspondante.
      → reporter sur **B-M7** au §5.

      Valeur relevée — count requêtes SQL pour un deck : `_____`

### A.3 — Recherche `LIKE` sans index (B-C3) + passcode (B-C4)

- [ ] Dans les logs (profil perf, `show-sql`), copier la requête SQL générée
      par `/cards/names?q=...` (autocomplete) et par un lookup `findByPasscode`.
- [ ] Les passer dans `psql` préfixées de `EXPLAIN ANALYZE`.
- [ ] **Relever** : `Seq Scan` vs `Index Scan`, et le `actual time`.
      → reporter sur **B-C3** et **B-C4** au §5.

      B-C3 plan : `_____`   B-C4 plan : `_____`

### A.4 — open-in-view (B-M1)

- [ ] Dans les logs d'un appel `/decks/{id}`, vérifier si des requêtes SQL
      apparaissent **après** la ligne de retour du controller (= requêtes en
      couche MVC, déclenchées par la sérialisation). Présence = B-M1 confirmé.
      → reporter (oui/non) sur **B-M1** au §5.

---

## Bloc B — Duel-server (cibles #5, #6 + findings D-C1, D-C2, D-C3, D-M7, D-M8)

### B.0 — Démarrer

- [ ] Duel-server lancé **avec l'instrumentation** :
      `DUEL_INSTRUMENT=1 npm start`  (port 3001).
      PowerShell : `$env:DUEL_INSTRUMENT='1'; npm start`.

### B.1 — Jouer un duel PvP réel

- [ ] Lancer un **duel PvP complet** via l'app (idéalement un duel avec au
      moins une chaîne longue — c'est là que `buildBoardState` est chaud).
- [ ] **Pendant** le duel : `GET http://localhost:3001/status` → bloc
      `perfInstrumentation` → buckets **`filterMessage`** et **`serialize`**
      (count, msMean, msMax, histogramme). → cible #6 + finding D-C3.

      filterMessage — count : `_____`  msMean : `_____`  msMax : `_____`
      serialize — count : `_____`  msMean : `_____`  msMax : `_____`

- [ ] **À la fin du duel** : dans les logs duel-server, repérer la ligne
      **`duel-instrumentation snapshot`** → buckets worker :
      - `buildBoardState` (count, msMean, msMax) → cible #5 + finding D-C2.
      - `getCardName` (count, msMean) → finding D-C1.
      - `duelProcess` (count, msMean) → contexte.
      - `workerColdStart` (count=1, msMax) → finding D-M8.

      buildBoardState — count : `_____`  msMean : `_____`  msMax : `_____`
      getCardName — count : `_____`  msMean : `_____`
      workerColdStart — ms : `_____`

      → reporter buildBoardState count sur **D-C2** §5 + **budget #5** §4 ;
        getCardName sur **D-C1** ; workerColdStart sur **D-M8**.

### B.2 — Précompute replay (D-M7)

- [ ] Ouvrir un **replay** (déclenche `runReplayPreComputation`).
- [ ] Dans les logs, la ligne `Pre-computation complete` porte déjà
      `buildBoardStatePerf` (calls / cumulativeMs / avgMs). + la ligne
      `duel-instrumentation snapshot` du worker replay.
      → reporter `calls` sur **D-M7** §5.

      buildBoardState calls (précompute) : `_____`

### B.3 — Mémoire par duel (cible #4)

- [ ] `GET /status` → `memoryUsageMb` (RSS) **0 duel actif** = `_____`.
- [ ] Lancer N duels concurrents, relever `memoryUsageMb` = `_____`.
- [ ] `delta / N` = RSS par duel → **budget #4** §4.

---

## Bloc C — Frontend (cibles #3, #7 + findings F-C1..F-C5, F-M*)

Procédure détaillée : `front/PERF-MEASUREMENT.md`. Ici, juste les chiffres
à reporter.

### C.1 — Bundle (Axe 1 → cible #3)

- [ ] Build prod **avec accès réseau** : `cd front && npx ng build --configuration production --stats-json`.
- [ ] Relever le `Initial total` (transfer/gzip) du résumé.
      → **budget #3** §4.

      Initial bundle (gzip) : `_____ kB`

- [ ] Analyser `stats.json` → confirmer que jspdf est (ou non) dans le chunk
      initial. → finding **F-C2**. Confirmer quelles routes F-C1 sont eager.

### C.2 — Images (Axe 2 → finding F-C4)

- [ ] card-search, DevTools Network filtre Img, cache vidé, **sans scroller**.
      Relever le nombre de requêtes images parties. → finding **F-C4**.

      Requêtes images au load : `_____`

### C.3 — Change detection (Axe 3 → cible #7)

- [ ] Angular DevTools Profiler, record d'un scroll de card-search.
      Relever la durée du cycle de CD le plus lourd. → **budget #7** §4.
- [ ] Console, après plusieurs scrolls : `document.querySelectorAll('app-card').length`.
      → finding **F-C3**.

      Cycle CD max : `_____ ms`   nb `<app-card>` après N scrolls : `_____`

---

## Après la capture

1. Reporter tous les chiffres dans le doc de chantier (colonne `baseline` §4,
   verdicts §5).
2. Figer les **cibles dérivées de baseline** : #4 et #5 reçoivent leur valeur
   via `target = max(seuil_perception, baseline × 1.3)`.
3. Resserrer le budget `initial` dans `front/angular.json` sur `baseline × 1.1`.
4. La Phase 1 (validation chiffrée) peut alors démarrer — chaque finding a
   désormais un chiffre, donc un droit d'entrée (ou non) en Phase 2.
