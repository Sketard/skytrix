---
title: Phase γ — Mémo de passation après commits 1-6
status: 6/8 commits livrés
date: 2026-05-26
branch: feat/anim-pipeline-v2
next_commits: 7 (T0-T10 + parité V1), 8 (cleanup + docs)
---

# Phase γ — passation après commits 1-6

Ce mémo résume ce qui a été livré sur les commits 1-6 et ce qui reste pour
les commits 7-8. Il est suffisamment self-contained pour qu'un agent neuf
puisse reprendre sans re-lire les 6 commits en détail.

---

## Commits γ livrés (du plus ancien au plus récent)

| # | SHA | Titre | Statut |
|---|---|---|---|
| 1 | `9a17d962` | chore: γ — pre-flight check | ✅ |
| 2 | `0142e33d` | refactor: γ — DuelEventProcessor partagé exposé via orchestrator | ✅ |
| 3 | `2197f23c` | refactor: γ — SoloDuelOrchestratorService single-processor | ✅ |
| 4 | `1fd0b3be` | refactor: γ — DuelWebSocketService lit le processor partagé | ✅ |
| 5 | `208de780` | feat: γ — PerspectiveSwitched event + PERSPECTIVE_LIFETIME dispatch | ✅ |
| 6 | `6e916341` | feat: γ — perspective projector (S3 coords container-relative) | ✅ |

Specs : 1574/1574 verts à chaque commit. ESLint + stylelint pre-commit OK.

---

## Décisions actées (à ne pas re-questionner)

- **R8** : pas de classe `SoloTransport` distincte. La même `DuelConnection`
  se reconfigure via option ctor `{ sharedProcessor? }`. PvP normal
  reste inchangé.
- **R10** : journal réactif au render — l'historique re-flippe You/Opponent
  au switch, pas en injectant un event marker. Implémenté en commit 7 si
  le code actuel fige à l'émission (à vérifier — voir checklist commit 7
  ci-dessous).
- **R1/R4** : prédicat de dédup checkpoint figé APRÈS observation du
  premier test T4 réel. Pas d'invention spéculative. Le commit 4 a posé
  l'instrumentation `wsService.checkpointLog(msg, transportIdx)` (log
  PIPELINE `wsService.onStateSync via transport %d type=%s`). Le commit 7
  exécute T4 et fige le predicat dans le commit 5 — **mais le commit 5 a
  déjà été livré avec le stub vide**. Donc le predicat sera ajouté en
  follow-up post-commit-7 si T4 révèle un cas à traiter.
- **`BufferReplayBuilder`** : NON pré-requis γ. Gain orthogonal (-5j) à
  livrer en parallèle ou après γ. Reste en place tel quel pour l'instant.

---

## API cible — état atteint

### Single-processor
- `AnimationOrchestratorService.processor: DuelEventProcessor` (readonly)
  exposé. Une seule instance par scope orchestrator.
- `DuelConnection` ctor option `{ sharedProcessor? }`. PvP-normal :
  instancie son processor local. SOLO : reçoit `animationService.processor`.

### Perspective signal
- `DuelContext.perspectiveSource: WritableSignal<0 | 1>` (tag α.1 `*Source`).
- `DuelContext.perspective(): WritableSignal<0 | 1>` getter.
- Le SOLO orchestrator écrit ; les consommateurs lisent.

### SOLO orchestrator refondu
- `switchPlayer()` → **`switchPerspective()`** (alias back-compat conservé,
  retrait au commit 8).
- Garde `pendingPrompt()` active (convention §5.2 POC).
- Debounce 300ms.
- N'appelle plus `clearAnimationQueueOnly` / `clearLastSelections`.
- `init()` instancie 2 `DuelConnection` avec `sharedProcessor` partagé.

### wsService
- `_activeConnection` supprimé.
- `_transport_connections: [conn, conn]` (PvP-normal: [default, default] ;
  SOLO: 2 distinctes via `bindTransports`).
- `active()` = `_transport_connections[duelCtx.perspective()()]`.
- `proc()` = `_sharedProcessor ?? defaultConnection.processor`.
- API SOLO : `bindSharedProcessor(proc)` + `bindTransports(t0, t1)`.
- Triage §3.3 : shared reads → `proc()`/RBS ; transport-local → `active()`.

### PerspectiveSwitched event
- Type `PerspectiveSwitchedEvent` (`kind: 'perspective'`) à
  `types/perspective-event.types.ts`. Ajouté à `StreamEvent`.
- `AnimationOrchestratorService.notifyPerspectiveSwitch(from, to)` push
  l'event + dispatche `{PERSPECTIVE_LIFETIME}` via `ScopeResetDispatcher`.
- Journal exclut PerspectiveEvent.

### PerspectiveProjector (S3)
- `CardTravelEngine.toLocalRect/getLocalRect` helpers.
- Floats / lines / overlays en `position: absolute` coords container-local.
- `PvpBoardContainerComponent` :
  - `boardTransform = computed(() => perspective === 1 ? 'rotate(180deg)' : 'rotate(0deg)')`
  - `boardFlipped = computed(...)`
  - `[style.transform]` + `[class.board-host--flipped]` sur `.board-host`
  - `registerContainer(boardHost)` via querySelector en ngAfterViewInit
- `_duel-tokens.scss` : `.board-host` reçoit transition transform 250ms cubic-bezier.
- `DuelContext.cardBaseRotation(rel)` perspective-aware (POC §2 B.1).

---

## Reports DIFFÉRÉS (à traiter post-γ)

1. **Re-parent `app-pvp-chain-overlay` sous `.board-host`** (POC §3 recommandé)
   - Pourquoi reporté : le composant est rendu à la fois par
     `duel-page.component.ts` et `replay-page.component.ts` ; le re-parent
     demande content projection + Input forwarding non triviaux pour le
     replay. Le banner reste centré viewport pour l'instant — le board
     flippe correctement, juste pas le banner.
   - Effort estimé : 0.5j (cf. POC §5).

2. **Mode B contre-rotation sur texte LP** (POC §3)
   - Pourquoi reporté : texte LP lisible "à l'envers" en perspective=1.
     Imperfait mais non-bloquant. Une class CSS conditionnée sur
     `.board-host--flipped` (déjà émis !) + une contre-rotation sur
     `.lp-value`, `.lp-delta__txt`, et autres glyphes orientés résoudra
     visuellement.
   - Effort estimé : ~0.5j (POC §5 disait 0.5j texte LP + 0.5j effect
     bubble + 0.5j chain overlay = 1.5j total mode B).

3. **R1/R4 predicat dédup checkpoint figé**
   - Pourquoi pas encore : le commit 5 a posé `notifyPerspectiveSwitch`
     en mode "push + dispatch", **mais le commit 4 a l'instrumentation
     PIPELINE `checkpointLog`** prête à mesurer les 2 STATE_SYNC qui
     arrivent en SOLO. Le commit 7 (T4) doit observer le log et figer
     le predicat dans un follow-up.

4. **Validation visuelle du commit 6 par l'utilisateur**
   - Pourquoi à faire : tests Karma ne couvrent pas la projection visuelle.
   - Procédure : lancer back + duel-server + ng serve, ouvrir SOLO PvP,
     clic "switch player", vérifier que le board flippe via rotate(180°)
     avec transition 250ms, que les cartes opp face-up restent lisibles,
     que les floats (draw/move) atterrissent à la bonne destination.

---

## État du repo

- Branche : `feat/anim-pipeline-v2`
- HEAD : `6e916341` (commit 6 γ)
- Working tree non-staged : un fichier `duel-event-processor.ts` modifié
  (WIP β.3 cas #12 d'Axel, **hors scope γ**). Aussi un untracked
  `_bmad-output/planning-artifacts/beta-3-case-12-commit-0bis-protocol-spec.md`
  (WIP β.3).
- Tests : `cd front && npm test -- --watch=false --browsers=ChromeHeadless`
  → 1574/1574.

---

## Commit 7 — Tests T0-T10 + parité V1

Cf. `_bmad-output/planning-artifacts/phase-gamma-spec.md §5 + §7 commit 7`
pour les 10 scénarios détaillés.

**Découpe interne suggérée** :

- **7a — Spec unit** : T0 (boot), T1 (switch sans chain), T7 (replay non-régression),
  T9 (double switch debounce). Mocks de transports, vérification d'invariants
  d'état. Ajouts dans `solo-duel-orchestrator.service.spec.ts` ou un nouveau
  fichier dédié. ~3h.

- **7b — Extension du harness Playwright SOLO** :
  - Lire `front/e2e/debug-replay-harness.ts` pour comprendre le pattern
    `runReplayDebug(ctx, opts)`.
  - Créer `front/e2e/solo-pvp-harness.ts` avec un équivalent
    `runSoloPvpDebug(ctx, opts)` qui :
    1. Lance/joint une session SOLO PvP (back/duel-server up requis)
    2. Capture console + snapshot état + screenshots
    3. Expose une API pour scripter une séquence d'actions (active carte,
       chain, switch, etc.)
  - ~4h.

- **7c — Playwright E2E T2-T6, T8, T10** :
  - T2 (test de victoire bug SOLO — `bug-solo-sequence.md §5`)
  - T3 (rematch)
  - T4 (STATE_SYNC mid-duel — F5 simulé) : observer le log PIPELINE
    `checkpointLog` pour figer R1/R4 si nécessaire.
  - T5 (switch pendant DeferredEffect actif)
  - T6 (burst MSG_CHAIN_SOLVING + switch)
  - T8 (switch immédiat post-mount)
  - T10 (switch pendant prompt actif)
  - ~5h.

- **7d — Parité V1** :
  - Capture des snapshots V1 SOLO (cf. README à
    `_bmad-output/phase-gamma/snapshots-v1/`) — **demande à Axel de les
    fournir** (lui seul peut lancer SOLO live).
  - Capture des snapshots post-γ équivalents.
  - Diff structurel : doit être vide pour S1/S2/S3/S5, présent uniquement
    sur les symptômes A/B disparus pour S4.
  - ~1-2h.

**Vérification R10 (journal réactif au render)** : avant de finir le commit 7,
ajouter un test "switch après une ligne 'Opponent: Played Ash Blossom'
flippe en 'You: Played Ash Blossom'". Si le code actuel fige à l'émission,
adapter `DuelGameLogService` ou son consommateur template — selon la
décision §8 R10 spec.

---

## Commit 8 — Cleanup + docs

Cf. spec §7 commit 8.

- Supprimer alias `switchPlayer` (back-compat conservé en commit 3).
- Supprimer code mort éventuel (`clearAnimationQueueOnly`,
  `clearLastSelections` côté SOLO si pas réutilisé ailleurs).
- Mettre à jour `CLAUDE.md` sections "Animation Parity Rule",
  "Orchestrator Decomposition", "Perspective Convention" pour refléter
  le single-processor SOLO.
- Mémoire utilisateur : déprécier
  `pvp-solo-chain-state-hygiene-2026-05-23` (bug fermé), créer
  `phase-gamma-shipped`.

---

## Critères de "γ livrée"

Cf. spec §10 :

1. ✅ Commits 1-6 mergés. ⏳ 7 + 8 à venir.
2. ⏳ T0-T10 passent tous.
3. ⏳ Snapshot V1 SOLO match l'état post-γ modulo bug résolu.
4. ⏳ Aucun nouveau warning console catégorie RESOLVE/PIPELINE/RUNNER/CHAIN.
5. ⏳ CLAUDE.md sections mises à jour.
6. ⏳ Mémoires sync.

---

## Risques résiduels identifiés

- **R9 POC** (surprise trajets exotiques) : pas encore observé.
  `verify` visuel du commit 6 + T2-T6 du commit 7 le révéleraient.
- **Validation visuelle** : aucune n'a eu lieu. Le board pourrait flipper
  correctement mais avoir un float qui rate sa destination dans un cas
  spécifique (Pendulum, Link materials, mass destroy). À surveiller au
  commit 7.
- **Mode B LP différé** : les chiffres LP sont lisibles à l'envers
  en perspective=1. Si l'utilisateur trouve ça insupportable, prioriser
  le mode B avant le commit 7.
