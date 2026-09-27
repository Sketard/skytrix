---
title: Phase γ — snapshots V1 SOLO de référence (oracle de parité)
status: pending capture (commit 1 γ)
depends_on:
  - phase-gamma-spec.md §7 commit 1 (livrable)
  - phase-gamma-spec.md §10 critère 3 (usage)
  - phase-gamma-spec.md §7 commit 7 (consommateur)
---

# Snapshots V1 SOLO de référence

Ce répertoire contient les snapshots d'état final atteints par la pipeline
**V1 (architecture actuelle, 2 DuelEventProcessor en parallèle)** au terme
de 3-5 sessions SOLO PvP canoniques. Ils servent d'oracle de parité pour
le commit 7 de γ — la pipeline γ (single-processor) doit atteindre le
même état final modulo les 2 deltas attendus :

1. Le bug SOLO (séquence `bug-solo-sequence.md` T0-T10) ne reproduit plus.
2. Micro-deltas de timing dus au `PerspectiveProjector` (~250ms transition CSS).

## Procédure de capture (manuel, V1 = avant γ)

Pré-requis : back + duel-server up, branche `feat/anim-pipeline-v2` au
commit 1 de γ (pre-flight check). **Pas de modification structurelle
appliquée**.

Pour chaque scénario canonique listé ci-dessous :

1. Ouvrir Chrome DevTools → Console.
2. Lancer une session SOLO PvP fresh via l'UI.
3. Jouer la séquence canonique jusqu'au tour final (ou un point stable
   identifié).
4. Dans la console DevTools :
   ```js
   copy(JSON.stringify(__skytrixDebug.snapshot(), null, 2))
   ```
5. Coller le contenu dans le fichier `scenario-<tag>-v1.json` de ce
   répertoire.
6. Noter dans `MANIFEST.md` (à créer) la séquence d'actions UI qui a
   produit le snapshot, pour reproductibilité au commit 7.

## Scénarios canoniques recommandés

Les 3-5 scénarios doivent collectivement couvrir :

- **S1 — Boot + 5 MSG_DRAW initiaux** : capture après la première
  BOARD_STATE + dérogation pre-activation buffer. Pas d'actions UI.
  Vérifie la parité du chemin nominal sans chain.

- **S2 — Chain simple sans switch** : P0 active une carte chained par
  Ash Blossom ou équivalent. Capture après `MSG_CHAIN_END`. Pas de
  `switchPlayer` invoqué. Vérifie le single-processor (γ) ne dérive
  pas du multi-processor (V1) en l'absence de switch.

- **S3 — Switch sans chain** : P0 joue 1 carte, idle phase, puis
  `switchPlayer()`. Capture après le switch. Vérifie que les
  signaux PERSPECTIVE_LIFETIME sont vidés par γ comme par V1.

- **S4 — Switch pendant chain (le bug)** : P0 active Lukias ou
  D/D, P1 chaîne Ash, switch mid-resolution. **En V1 ce snapshot
  contient les symptômes A/B du bug** (`Lock safety timeout` +
  `POLL-DROP REGRESSION`). En γ ces symptômes disparaissent — c'est
  le delta attendu N°1.

- **S5 — Rematch** : duel terminé, des deux côtés rematch accepté.
  Capture après MSG_NEW_TURN du nouveau duel. Vérifie que le reset
  cascade DUEL_LIFETIME → CONNECTION → PERSPECTIVE est cohérent V1 et γ.

## Format snapshot

Le format attendu est celui produit par `__skytrixDebug.snapshot()`
(cf. CLAUDE.md "Debugging Animations" Layer 2). Champs critiques pour
la parité :

- `logicalState` — board logique final
- `renderedState` — board rendu final
- `chain.activeLinks` + `chain.phase` — état chain final
- `locks` — locks RBS résiduels (devrait être vide si le scénario s'est
  bien clos)
- `animationQueue` — queue d'animation (devrait être vide)
- `preActivationBuffer` — buffer pré-activation (devrait être vide)

Les champs `domZones` (qui forcent ~50 getBoundingClientRect) et
`inFlightFloats` / `landedFloats` (ephemeral) sont ignorés pour la
comparaison de parité.

## Diff au commit 7

Le commit 7 de γ produit les snapshots équivalents post-γ
(`scenario-<tag>-gamma.json`). Le test de parité fait un diff
structurel champ par champ. Le diff doit être :

- **Vide** pour S1, S2, S3, S5.
- **Présent uniquement sur les symptômes A/B** pour S4.

Tout autre delta est une **régression** à investiguer.

## Statut

Snapshots à capturer :
- [ ] `scenario-s1-boot-v1.json`
- [ ] `scenario-s2-chain-simple-v1.json`
- [ ] `scenario-s3-switch-no-chain-v1.json`
- [ ] `scenario-s4-switch-during-chain-v1.json`
- [ ] `scenario-s5-rematch-v1.json`

Tag `v1` = pipeline V1 (pré-γ). Le commit 7 utilise le tag `gamma` pour
les snapshots post-γ.
