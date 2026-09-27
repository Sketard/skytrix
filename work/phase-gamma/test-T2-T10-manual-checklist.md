---
title: Phase γ — Checklist manuelle T2-T10 + parité V1
status: ready for execution (commits 7c + 7d)
date: 2026-05-27
depends_on:
  - phase-gamma-spec.md §5 (scénarios T0-T10)
  - bug-solo-sequence.md §2 (séquence T1-T10 du bug)
  - snapshots-v1/README.md (capture procédure V1)
  - front/e2e/solo-pvp-harness.ts (harness Playwright)
---

# Checklist manuelle T2-T10 phase γ

Les invariants T0/T1/T7/T9/R10 sont couverts en specs Karma vertes
(`phase-gamma-victory.spec.ts`, commit 7a). Les scénarios qui exigent un
timing WS réel (T2 le test de victoire en tête) sont **scriptés
manuellement** ici : l'infra Playwright (`solo-pvp-harness.ts`) capture
les frames + snapshots ; l'opérateur conduit le scénario via l'UI.

Pré-requis stack :
- back Spring Boot up (`localhost:8080`)
- duel-server up (`localhost:3001`)
- front Angular dev server up (`ng serve` ou build statique sur :4200)
- au moins **un deck chain-capable** dans le compte admin (D/D, Eldlich,
  Spright, ou tout deck avec hand traps + activations)

Pré-requis console :
- `__skytrixDebug.enableAll()` pour activer les categories `RESOLVE`,
  `PIPELINE`, `RUNNER` (off par défaut)
- DevTools ouvert avant la première action (sinon les warns initiaux
  sont perdus)

---

## T2 — Test de victoire (bug SOLO §2)

**Le scénario cardinal de γ.** Doit passer sans aucun symptôme.

### Setup

1. Lancer la session SOLO via UI Lobby → Quick Duel → choisir un deck
   chain-capable des deux côtés (par défaut le harness pose le même deck).
2. Attendre BOARD_STATE + 5 MSG_DRAW initiaux (board visible).
3. Console : `__skytrixDebug.enableAll()`.

### Action

1. P0 joue un effet chained (ex: Lukias activation, ou tout monstre
   avec effet on-summon qui peut être Ash Blossom-é).
2. Avant que `MSG_CHAIN_END` n'arrive, **switch perspective** via la
   touche `s` ou via UI.
3. Attendre que la chain se résolve naturellement.

### Captures requises (snapshot via `copy(JSON.stringify(__skytrixDebug.snapshot(), null, 2))`)

- `t2-pre-switch.json` — juste avant le `s` press, après MSG_CHAINING(2).
- `t2-post-switch.json` — juste après le flip (300ms après le `s`).
- `t2-post-chain-end.json` — après MSG_CHAIN_END.

### Critères PASS

- **`activeChainLinks.length === 2`** dans `t2-post-switch.json`.
- **`pendingChainEntry !== null`** ou commit déjà fait sur CL2 dans
  `t2-post-switch.json`.
- **`chainPhase === 'resolving'`** dans `t2-post-switch.json`.
- **`locks` non-vide** dans `t2-post-switch.json` (cost MSG_MOVE encore
  en cours).
- **Aucun log `Lock safety timeout`** entre `t2-pre-switch` et
  `t2-post-chain-end`.
- **Aucun log `[POLL-DROP REGRESSION]`** entre `t2-pre-switch` et
  `t2-post-chain-end`.
- **Aucun warn `chainIndex N not in active links []`** entre
  `t2-pre-switch` et `t2-post-chain-end`.
- `t2-post-chain-end.json` : `activeChainLinks === []`,
  `chainPhase === 'idle'`, `locks === {}`.

### Si FAIL

Le bug SOLO n'est PAS éliminé. Capturer en plus :
- `console.log` complet
- Le résultat de `__skytrixDebug.dump()`
- Le snapshot au moment exact du `Lock safety timeout` (l'harness le
  capture si on lance avec `screenshotOn: ['Lock safety timeout']`)

Et **NE PAS commit γ comme "livré"** — il y a une régression.

---

## T3 — Rematch

### Setup

1. Terminer un duel (surrender ou MSG_WIN naturel).
2. Cliquer rematch des deux côtés (l'auto-accept fire si le SOLO mode
   `setupRematchEffects` est câblé — cf. solo-duel-orchestrator.service.ts).

### Captures

- `t3-pre-rematch.json` — duel ended, before clicking rematch.
- `t3-post-rematch.json` — after MSG_NEW_TURN of the new duel.

### Critères PASS

- `t3-post-rematch.json` : `activeChainLinks === []`, `chainPhase === 'idle'`,
  `pendingChainEntry === null`.
- `perspective === 0` (convention rematch).
- Nouveau duel démarre : `logicalState.turnCount === 1` ou
  `MSG_NEW_TURN` reçu.
- Stream contient `EffectAbandoned(reason='checkpoint')` pour tout
  DeferredEffect actif (cf. §3.7bis chantier — vérifier via filter
  `[ANIM:DEP]` en console).
- Pas de `applyCheckpoint({RematchStarted})` appelé 2 fois (filter
  PIPELINE pour `applyCheckpoint` — doit apparaître 1 seule fois).

---

## T4 — STATE_SYNC mid-duel (F5 refresh simulé)

### Setup

1. Lancer SOLO, jouer 1-2 cartes pour avoir un board ≠ état initial.
2. Console : `__skytrixDebug.enableAll()`.

### Action

1. F5 refresh page.
2. Attendre re-init complète (board re-rendu).

### Captures

- `t4-pre-refresh.json` — avant F5.
- `t4-post-refresh.json` — après re-render board.

### Critères PASS + observation R1/R4

- Filter console pour `wsService.onStateSync via transport`. Doit
  apparaître **2 fois** (un par transport).
- **Observer la séquence des 2 STATE_SYNC** : payloads identiques ?
  Timings ? C'est la mesure qui fige le predicat R1/R4 du commit 5
  (voir spec §8 R1).
- `t4-post-refresh.json` : board cohérent avec `t4-pre-refresh.json`,
  pas de lock orphelin, pas de DeferredEffect orphelin.

**Décision attendue post-T4** : selon ce qu'on observe, soit no-op
idempotent côté 2nd STATE_SYNC (preferred), soit dédup explicite via
`lastCheckpointHash + lastCheckpointAt`. Documenter dans un follow-up
commit (5-bis post-γ) si nécessaire.

---

## T5 — Switch pendant DeferredEffect actif

### Setup

1. Lancer SOLO avec deck contenant un Ash Blossom ou hand trap similaire.
2. Console : `__skytrixDebug.enableAll()` + filter `[ANIM:DEP]`.

### Action

1. P0 active une carte qui déclenche un cost MSG_MOVE.
2. Pendant l'animation du cost (overlay pas encore affiché), switch via `s`.
3. Attendre fin chain.

### Captures

- `t5-cost-in-progress.json` — MSG_MOVE en cours, DEP a émis
  `DeferredEffect('overlay-show:chain-2', ...)`.
- `t5-post-switch.json` — juste après le switch.
- `t5-overlay-shown.json` — overlay finalement affiché sous nouvelle
  perspective.

### Critères PASS

- DEP n'émet **pas** d'`EffectAbandoned` au switch (CONNECTION_LIFETIME
  contract).
- L'overlay finit par s'afficher (rule `overlay-show` resolved par
  `EffectReady`).
- L'overlay apparaît **sous la nouvelle perspective** (visuellement,
  flipped si commit 6 livré ; sinon centré viewport — limitation
  connue cf. PASSATION §"Reports DIFFÉRÉS" 1).

---

## T6 — Burst MSG_CHAIN_SOLVING + switch

### Setup

1. Préparer un deck capable d'une chain longue 4+ links (ex: chain Ash
   → Maxx C → Lock Bird sur le même target).
2. Activer la situation où une chain longue se résout en burst rapide.

### Action

1. Démarrer la chain longue.
2. Switch via `s` au milieu du burst.

### Captures

- `t6-mid-burst.json` — au moment du switch.
- `t6-post-end.json` — après MSG_CHAIN_END.

### Critères PASS

- `t6-post-end.json` : `chainPhase === 'idle'`,
  `activeChainLinks === []`.
- Aucun warn `chainIndex N not in active links []`.
- Aucun `[POLL-DROP REGRESSION]`.

---

## T8 — Switch immédiat post-mount (race condition)

### Setup

1. Avant de lancer SOLO, préparer la console pour exécuter rapidement.

### Action

1. Lancer SOLO via UI.
2. **Dès que le routeur navigue à `/pvp/duel/{code}?solo=true`**, mais
   AVANT que `[data-zone]` paraisse, presser `s` (peut nécessiter
   plusieurs essais).

### Captures

- `t8-during-loading.json` — pendant chargement (boardActive=false).
- `t8-after-board.json` — après board chargé.

### Critères PASS

- Pas de crash (pas de pageerror).
- L'événement `PerspectiveSwitched` est émis mais le visual flip
  attend `.board-host` monté (commit 6).
- Dice arena → active transitionne normalement.
- `drainPreActivationBuffer` cohérent (les MSG_DRAW initiaux s'animent
  sous la nouvelle perspective).

---

## T10 — Switch pendant prompt actif

### Setup

1. Lancer SOLO et atteindre un prompt SELECT_* (premier tour : prompt
   "Choose your first card to set" si applicable, ou attendre une
   activation qui demande SELECT_CARD).

### Action

1. Prompt ouvert → presser `s`.

### Captures

- `t10-prompt-open.json` — prompt actif.
- `t10-after-skip.json` — après tentative de switch.

### Critères PASS

- Filter console pour `switchPerspective skipped: prompt active` →
  doit apparaître.
- `perspective` inchangée entre les 2 snapshots.
- Prompt reste ouvert et fonctionnel (cliquer une carte le ferme
  normalement).

---

## Procédure de parité V1 ↔ γ (commit 7d)

Cf. `snapshots-v1/README.md` pour la procédure de capture V1.

### Étape 1 — Capturer V1 (avant γ)

`git checkout 0142e33d` (commit 2 γ — encore en multi-processor) puis
rejouer les scénarios S1-S5 du README v1, sauvegarder dans
`snapshots-v1/scenario-<tag>-v1.json`.

NB : il n'existe pas de "commit 0 V1 pur" — γ commits 1+2 sont
internes/refactor non-fonctionnels. Le commit 0142e33d est le dernier
état où le code SOLO multi-processor n'a pas été migré. C'est le
référentiel V1 le plus tardif possible.

### Étape 2 — Capturer γ (post-commit 6)

`git checkout 6e916341` (commit 6 γ — full single-processor + projector).
Rejouer S1-S5 du README v1, sauvegarder dans
`snapshots-v1/scenario-<tag>-gamma.json`.

### Étape 3 — Diff structurel

Utiliser le script `snapshot-diff.mjs` (à venir, hors scope commit 7c)
ou un diff manuel via [jsondiffpatch](https://github.com/benjamine/jsondiffpatch)
en ignorant les champs ephemeral :
- `domZones` (getBoundingClientRect impur)
- `inFlightFloats.*.duration` (timing variable)
- `landedFloats.*.timestamp`

### Étape 4 — Verdict

- **S1, S2, S3, S5** : diff doit être vide. Sinon = régression à
  investiguer.
- **S4** : diff DOIT contenir la disparition des `Lock safety timeout`
  + `POLL-DROP REGRESSION` côté γ (côté V1 ils sont présents). Et
  `activeChainLinks`/`chainPhase` doivent être cohérents post-MSG_CHAIN_END.

---

## Décision post-checklist

Si **tous** les critères PASS → γ peut être déclarée "livrée" selon
spec §10. Mettre à jour la mémoire `phase-gamma-shipped` avec date +
SHA du commit 7c et des éventuels follow-ups.

Si **un seul critère FAIL** → ouvrir un follow-up commit qui adresse
la régression spécifique. Ne pas marquer γ livrée tant que le FAIL
n'est pas résolu ou explicitement accepté comme delta connu (cf. §10
critère 3 "modulo les 2 deltas attendus").
