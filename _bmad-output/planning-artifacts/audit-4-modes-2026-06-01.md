# Audit — robustesse & propreté des 4 modes (PvP / SOLO multiplex / fork-solo / Replay)

**Date** : 2026-06-01
**Méthode** : workflow adversariale multi-agents (80 agents, ~1.2M tokens, ~19 min)
**Périmètre** : pipeline animation front, duel-server (worker + session), protocole WS + parité, game-log / EventStream

> Cet inventaire est le **brut + vérification adversariale** issu de l'audit. Pour la version synthétique (top 5 risques + cleanups par ratio impact/effort + recommandation chantier), voir le message de chat associé.

## Sommaire

- [Triage interactif (en cours)](#triage-interactif-en-cours)
- [Statistiques](#statistiques)
- [Méthode](#méthode)
- [Verdicts globaux par agent](#verdicts-globaux-par-agent)
- [Findings confirmés (10)](#findings-confirmés-10) — passés la vérification adversariale
- [Findings réfutés (23)](#findings-réfutés-23) — disqualifiés par le skeptic, gardés pour archive
- [Inventaire brut par axe d'audit](#inventaire-brut-par-axe-daudit)

---

## Triage interactif (en cours)

> Investigation manuelle des 38 findings non-vérifiés (session limit a interrompu la phase adversariale auto). Chaque finding est creusé puis tagué.
>
> **Convention** :
> - **KEEP** — finding réel, dette à fermer (un cleanup est listé)
> - **KEEP-LATER** — finding réel mais non-urgent (deferred, à ressortir si bug surface)
> - **DROP** — finding faux ou déjà mitigé après investigation
> - **DONE** — finding fermé pendant cette session
>
> Décisions par Axel ; investigation file:line par Claude.

### Statut

| # | Sev | Source | Titre court | Statut | Cleanup résumé |
|---|---|---|---|---|---|
| U1 | HIGH | fork-solo | 3 carve-outs fork sans tests | **KEEP** | 3 tests (~50 LOC) dans `worker-lifecycle.spec.ts` + `worker-message-router.spec.ts` |
| U2 | HIGH→MED | protocol | PROTOCOL_VERSION jamais bumpé | **KEEP** | spec `protocol-version-check` + 2 tests onclose(4426) sur duel + solver (~80 LOC) |
| U3 | HIGH | protocol | Animation Parity Rule sans gate | **KEEP** | spec parity `animation-orchestrator.parity.spec.ts` (~15 LOC) qui grep le fichier source |
| U4 | HIGH | PvP | duel-worker.ts 1973 LOC god-file | **KEEP** | 2 extractions ciblées : `ocg-message-transforms.ts` (~500 LOC, 1-2j) + `duel-worker-fork.ts` (~260 LOC, ~4h). PAS le cœur (`runDuelLoop`+`updateState`+`buildBoardState`). |
| U5 | HIGH | PvP | 3 sources de vérité slot ownership | **DROP** | Doublon de U6 mal formulé : "3 sources" est un faux ami (1 source serveur + 1 mirror client + 1 read helper). Le contenu actionable est U6. |
| U6 | HIGH | PvP | Symmetric clear blocks hand-maintained | **KEEP** | Spec table-driven `mass-reset matrix` (~100 LOC) pinning les 4 sites × 8 fields contre §4.3 A8 |
| U7 | HIGH | PvP | orchestrator 1985 LOC | **DROP** | Doublon de C1 (déjà confirmé). Aucune extraction au-delà de `ProjectionRegistry` ne réduit le couplage — elle le déplace (18 deps suivent). |
| U8 | HIGH | SOLO | 3 pre-duel `_slots` carve-outs | **DROP** | Faux finding : les 3 carve-outs (DICE_ROLL, SELECT_FIRST_PLAYER, MSG_HINT broadcast) sont déjà doctrinés (commentaires inline) + pinned (3 specs Karma) + liés à des commits fix identifiables. |
| U9 | HIGH | SOLO | Mid-chain switchPerspective hygiène | **DROP** | Finding obsolète : F3 (2026-05-30) + T-F6 ferment le backlog `pvp-solo-chain-state-hygiene-2026-05-23`. 5 tests dédiés + suite cardinal γ invariant. |
| U10 | HIGH | Replay | F10 cost-sync parity sans gate | **DROP** | Doublon de C5 (déjà confirmé). Conflit interne du verdict adversarial : 1 confirmé (C5) vs 3 réfutés (R10/R12/R20) sur la même dette — la doctrine F10 defere explicitement le fix "if a future bug surfaces" (Axel-validated 2026-05-31). |
| U11 | HIGH | Replay | PvP-replay convergence parallel impl | **DROP** | Faux finding : ce qui est différent EST différent par nature (WS lifecycle vs precomputed timeline). Le share existant (`AnimationDataSource` + `syncAfterBoardState` + `board-state-swap` + `DuelEventProcessor`) couvre exactement le bon scope. |
| U12 | HIGH→MED | Replay | flush boundaries implicites | **KEEP** | Taxonomy `SEGMENTATION_ACTION` + spec parametrisée sur l'union `ServerMessage['type']` qui force une décision explicite pour chaque type (~30 LOC code + ~30 LOC test) |
| U13 | HIGH | Replay | Lock-assert sites fragmentés | **KEEP** | `commitAll(site?: string)` log warn quand locks > 0 + tag les 3 call-sites replay skip (~20 LOC). Surface les leaks sans throw, complémentaire à F19. |
| U14 | HIGH→LOW | server-mod | broadcastMessage god-function | **KEEP minimal** | Commentaire-table en tête de la fonction (~15 LOC) listant les 7 stages + dépendances d'ordre load-bearing. PAS la refacto pipeline (risque MEDIUM, ROI faible). |
| U15 | HIGH | server-mod | ActiveDuelSession 35-field bag | **KEEP modéré** | 2 helpers : `createInitialSessionState(opts)` factory partagée PvP/fork (ferme aussi U37) + `resetSessionForRematch(session)` (~50 LOC, ~3h). Full class+methods (3-5j) à ré-évaluer au moment de l'implem. |
| U16 | MED→HIGH | event-stream | DEP observe `absorbed` non propagé | **KEEP** (priorité) | Wire `absorbed` flag de `pushToStream` vers `_handleEntry` (skip dispatch + emit synthetic lifecycle pair). ~30 LOC + 20 LOC test. **Bug latent probablement visible** dans le journal game-log (settlings GRAVE→GRAVE non filtrés). |
| U17 | MED→LOW | fork-solo | Sanity check audit-trail fragmenté | **KEEP minimal** | Log symétrique sur path OK + flag `sanityWarningAccepted` au log de transition (~10 LOC). Pas de champ session. |
| U18 | MED→LOW | fork-solo | Boot order pitfall config | **KEEP minimal** | Comment 3 LOC à fork-handlers.ts:136 documentant dépendance implicite `attachWorkerHandlers → worker-lifecycle configured`. |
| U19 | MED | protocol | Front index types pas byte-checked | **DROP** | Risque pratique faible : barrels = 8 exports stables + 1 union reconstruite, drift trappé par tsc. Doctrine déjà dans l'en-tête. Étendre le check serait fragile. |
| U20 | MED | PvP | handleMessage switch 35 cases | **KEEP** | Routing table + méthodes privées `_handleXxx(msg)` (~1-2j). Préserve l'invariant cardinal γ-c (pas d'extraction `_slots`). Bénéfice = lisibilité. Différent de C2/R2 (qui proposait `MessageDispatcher` class, refusé). |
| U21 | MED | PvP | SELECT resend sans whitelist pre-duel | **DROP** | Faux finding : DICE_ROLL/SELECT_FIRST_PLAYER ne passent JAMAIS par broadcastMessage (envoyés direct via first-player-coordinator → sendToPlayer). Le `SELECT_TYPES.has(...)` ne fire pas pour ces 2 types. Mélange anodin. |
| U22 | MED→LOW | PvP | Triple-guard `_innerLoopDepth` | **KEEP minimal** | Test C4 manquant (~30 LOC) — pin l'assert `depth <= 1` sur scenario intra-tick re-entry. Pas de refacto du triple-guard (orthogonal, doctriné F13). |
| U23 | MED | PvP | boardStateAfter payload 50-150 KB | **DROP** | Doctrine déjà en place (CLAUDE.md L1425-1426 "highly redundant — gzip handles it"). Le finding lui-même propose `deep` + acceptable today. Tient dans 1 batch turn de 512 KB. Pas d'action utile au-delà de la doctrine. |
| U24 | MED→LOW | SOLO | Inactivity timer self-forfeit UX | **KEEP + bonus** | (1) `mapDuelEndReason` branche SOLO → i18n `inactivity_solo` "session expirée — anti-leak"; (2) bonus : `InactivityWarningDialog` adapté SOLO (texte "session expirera" au lieu de "you will forfeit"). ~30 min, ~15 LOC. |
| U25 | MED→LOW | SOLO | Turn timer skip dispersé | **KEEP** | `shouldRunTurnTimer(session): boolean` prédicate dans timer-management + commentaire global "null-guarded by design" en tête du module + spec pin (~20 LOC). Centralise la règle, ouvre l'extension future. |
| U26 | MED | SOLO | `_shouldSwapForSolo` assert coupling | **DROP** | Invariant maintenu par 2 call-sites uniquement (`DuelWebSocketService` ctor + `SoloDuelOrchestratorService.init`), assert + duelCtx default conn = garde-fous suffisants. Le risque flagué n'existe pas en pratique. |
| U27 | MED | SOLO | PSEUDO_PAIRWISE_SOLO_ROUTED whitelist | **KEEP minimal** | Commentaire-anchor "SOLO-AWARE MESSAGE CONTRACT" en tête de `PSEUDO_PAIRWISE_SOLO_ROUTED` documentant les 4 touchpoints + fail-modes (~10 LOC). Pas la table déclarative (deep). |
| U28 | MED→HIGH | SOLO | Slot-1 fallback asymétrique — **bug serveur live découvert** | **KEEP (priorité)** | Fix 1 (serveur) : ajouter `player: p` au payload INACTIVITY_WARNING à `timer-management.ts:289`. Fix 2 (test) : pin le contrat (~20 LOC total). Ferme un bug latent : en PvP normal, le P1 viewer rate les inactivity warnings de son opposant (slot-0 silently). |
| U29 | MED→LOW | SOLO | Double cleanup `conn.cleanup` | **KEEP** | `_destroyed: boolean` flag + early-return + 2 specs idempotence (~20 LOC). Pin Transport Lifecycle Invariant 1 de CLAUDE.md. |
| U30 | MED | SOLO | `canSwitchPerspective` non réactif | **DROP + comment** | Bug théorique mais invariant runner (queue-runner.ts:175 + :468 bypassent finalize tant que `hasDrawsInFlight`) garantit `isAnimating === true` pendant tout draw. Commentaire ajouté à `canSwitchPerspective` documentant l'invariant. |
| U31 | MED | SOLO | `bindSoloConnection` sinks partial | **KEEP** | `applySinks(conn)` privé dans `DuelWebSocketService` unifie ctor + bindSoloConnection ; SOLO orchestrator retire son `wireConnectionDebugSinks` (~30 LOC modifiés). |
| U32 | MED | server-mod | server.ts ~600 LOC residual | **KEEP-LATER** | À rediscuter au moment de l'implem pour potentiellement tout faire d'un coup. Proposition : 3 extractions `pvp-connection-handler` (~340 LOC) + `session-orchestrator` (~300) + `ws-write` (~40), shrink server.ts à ~300 LOC. Effort 3-5j, risque MEDIUM (boucles de deps). |
| U33 | MED→LOW | server-mod | Worker port.postMessage non-typé | **KEEP** | `duel-worker-emit.ts` (~50 LOC nouveau) — `createWorkerEmitter(port, duelId)` retourne 8 emitters typés. Refacto 25 sites duel-worker.ts. TypeScript trap les typos à compile time. ~1-2h. |
| U34 | MED | server-mod | DI graph hub worker-lifecycle | **KEEP-LATER** | À rediscuter au moment de l'implem en même temps que U32. `DuelEndCoordinator` extraction (~2-3j) casse le cycle runtime (router → lifecycle → ... → router). Pas urgent — `createConfigurable<T>` masque la cyclicité et fonctionne. |
| U35 | MED | server-mod | 33× `configureClientMessageRouter` | **DROP** | Argument "parallel race" faux (vitest fork isolation protège). Refacto factory-pattern déjà débattue dans R8 (réfutée comme "stylistic improvement at best, not load-bearing fix"). |
| U36 | MED | server-mod | broadcastMessage closures = leak | **DROP** | Finding partiel : `decideSoloRouting` déjà extracted + unit-tested ([lifecycle-helpers.ts:117](duel-server/src/lifecycle-helpers.ts#L117)). Exemple INACTIVITY_WARNING faux (type EST whitelisté). Split résiduel créerait duplication chez 5 consumers sans gain net. |
| U37 | MED | server-mod | fork-handlers session ctor duplicate | **DROP (absorbé par U15)** | Même cleanup que U15 — la factory `createInitialSessionState(opts)` ferme U15 + U37 d'un coup. Pas de nouvelle action. |
| U38 | MED | server-mod | WORKER_CANCEL_DONE 60-LOC handler | **KEEP minimal** | `cancel-rollback-main.ts` extrait 2 fonctions main-side (`snapshotCancelTarget` + `applyCancelRollbackBroadcast`, ~80 LOC) + spec dédiée. Le worker reste à part (cross-process). ~1j. |

**Confirmés (10)** triage interactif (2026-06-01) — la numérotation suit le doc canonique ci-dessous.

| # | Sev | Source | Titre court | Statut | Cleanup résumé |
|---|---|---|---|---|---|
| C1 | HIGH | protocol | Byte-sync script — 3 bypass paths (no CI) | **KEEP** | GitHub Actions workflow `protocol-sync.yml` (~30 LOC YAML) + bonus `prebuild` à `front/package.json` (5 LOC). Ferme `--no-verify` bypass + dev sans hooks. |
| C2 | HIGH | protocol | F9 chainPhase parity sans cross-check | **KEEP minimal (DONE)** | Comment-anchor F9 ajouté à `chain-state-tracker.spec.ts` + `duel-event-processor.spec.ts` (~15 LOC chacun) — cross-référence explicite review-time. Pure reducer extraction reportée (KEEP-LATER si bug surface). |
| C3 | HIGH | event-stream | Orchestrator 1985 LOC — 6 cérémonies par projection | **KEEP** (Option B structural) | `_streamProjections: BaseProjection[]` array itéré dans attach + destroy (+ smoke spec réflexion). Ferme C3 + C5 par construction. ~1h. |
| C4 | HIGH | protocol | F6 Perspective Convention sans static enforce | **KEEP minimal** | Spec parity `perspective-zone-key.parity.spec.ts` (~50 LOC) qui walk les TS files, regex sur `` `${ZONE_ID}-${X}` `` templates, fail si X n'est pas une variable nommée `rel*` ou via `relativePlayer()`. Couvre les 26 sites existants + bloque les nouveaux. Plugin ESLint deferred. |
| C5 | MED | event-stream | `targetedZoneKeys.detachEventStream()` missing — **BUG LATENT** | **KEEP (absorbé par C3 Option B)** | Same fix : array de projections itéré force la symétrie. Hot-fix ligne possible avant le structural. |
| C6 | MED | protocol | F19 lock-assert sites — manifest manquant | **KEEP minimal (DONE)** | 3 comments inline aux skip sites (`collapseRemainingSteps`, `abort`, `jumpToState`) + F19 anchor header complet sur `rbs.assertNoLocks` listant les 7 asserted + 3 skipped. Complémentaire à U13 (runtime warn). |
| C7 | MED | Replay | PVP-REPLAY-DIVERGENCES.md orphelin | **KEEP DONE (deleted)** | Fichier supprimé. Orphan (last touched 2026-05-01, ~30 F-fixes non reflétés, 0 ref code). CLAUDE.md sections "Replay Board State Parity Rule" + "BoundaryProcessor invariants" + "Animation Parity Rule" + "Perspective Convention" couvrent déjà toutes les divergences load-bearing. |
| C8 | MED | protocol | Worker→main types non byte-checked | **KEEP minimal (DONE)** | Exhaustive `default: const _exhaustive: never = wmsg` ajouté à `handleWorkerMessage` (~5 LOC). Complémentaire à U33 (qui couvre le côté emit). Catch maintenant les 2 directions : ajout d'un type sans handler (C8) OU sans emitter (U33). |
| C9 | MED→LOW | duplication | runReplay vs runDuel duplication | **DROP** | Skeptic dégrade à LOW : "80% identical" est faux (~6% en réalité). HOF nécessite ~8-10 callbacks → plus complexe que la duplication. Doctrine F10 + cross-ref comments duel-worker.ts:1367 ↔ replay-precompute.ts:395 documentent l'accepted-debt (Axel-validated 2026-05-31). Hoist on next concrete bug only. |
| C10 | MED | fork-solo | fork-solo skip WORKER_DUEL_CREATED — dead code path | **KEEP minimal (DONE)** | (1) Comment trompeur `fork-handlers.ts:32-33` corrigé : la skip timer est par CONSTRUCTION (path bypass), pas par le soloMode gate. (2) Comment-anchor ajouté à `worker-message-router.ts:91` au-dessus du case WORKER_DUEL_CREATED documentant que fork-solo bypasse cette branche. |

### Plan d'implémentation (2026-06-01)

Triage complet : **22 KEEP** (dont 6 DONE pendant le triage), **2 KEEP-LATER**, **13 DROP**. Voici l'ordre d'attaque proposé, organisé en buckets par priorité.

#### Bucket 0 — Déjà DONE pendant le triage (aucune action restante)

| # | Description |
|---|---|
| C2 | Comment-anchors F9 dans `chain-state-tracker.spec.ts` + `duel-event-processor.spec.ts` |
| C6 | F19 anchor header sur `rbs.assertNoLocks` + 3 comments inline aux skip sites replay |
| C7 | `PVP-REPLAY-DIVERGENCES.md` supprimé |
| C8 | Exhaustive `default: never` ajouté à `handleWorkerMessage` |
| C10 | Comments corrigés `fork-handlers.ts:32-33` + comment-anchor `worker-message-router.ts:91` |
| U30 | Comment ajouté à `canSwitchPerspective` (invariant runner documenté) |
| U21 | Comment `SELECT_TYPES` corrigé (court-circuit pre-duel) |
| U9 | Memory `pvp-solo-chain-state-hygiene-2026-05-23` mise à jour (2 couches γ + F3) |

#### Bucket 1 — Bugs latents (priorité MAX, ~3-4h)

| # | Sev | Description | Effort |
|---|---|---|---|
| **U28** | HIGH | **Bug serveur live** : `INACTIVITY_WARNING.player` non populé à [timer-management.ts:289](duel-server/src/timer-management.ts#L289) → P1 viewer PvP rate les warnings. Fix : ajouter `player: p` au payload + 1 test pin contrat A8.1. | ~20 LOC, 1h |
| **U16** | HIGH | **Bug journal probablement visible** : `DEP.observe.{absorbed}` ignoré par `pushToStream` → settlings XYZ GRAVE→GRAVE non filtrés dans le game-log journal. Fix : wire `absorbed` flag + skip dispatch + emit synthetic lifecycle pair + spec orchestrator-level. | ~50 LOC, 2-3h |
| **C5** | MED | **Bug latent live** : `targetedZoneKeys.detachEventStream()` manquant dans `destroy()` ([animation-orchestrator.service.ts:928-933](front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L928)). Effect leak sur hard teardown. **Absorbé par C3 ci-dessous** — fix structural. | inclus C3 |

#### Bucket 2 — Quick wins (low effort, high ROI, ~3-5h cumulés)

| # | Description | Effort |
|---|---|---|
| **C3 + C5** | `_streamProjections: BaseProjection[]` array itéré dans attach + destroy + smoke spec réflexion. Ferme C3 (structural) + C5 (bug latent) d'un coup. | ~40 LOC, 1h |
| **C1** | GitHub Actions workflow `protocol-sync.yml` + `prebuild` à `front/package.json`. Ferme R4 (3 bypass paths sans CI). | ~35 LOC, 30min |
| **C8** | DONE — voir Bucket 0 |
| **U33** | `duel-worker-emit.ts` — 8 emitters typés (`createWorkerEmitter(port, duelId)`). Refacto 25 sites duel-worker.ts. Catch typos à compile time. | ~50 LOC, 1-2h |
| **U2** | `protocol-version-check.spec.ts` nouveau + 2 tests `onclose(4426)` sur duel-connection + solver.service. | ~80 LOC, 1h |
| **U3** | Spec parity `animation-orchestrator.parity.spec.ts` qui grep le fichier source pour `DuelWebSocketService`/`DuelConnection`. | ~15 LOC, 15min |
| **U18** | Comment 3 LOC à `fork-handlers.ts:136` documentant dépendance implicite `attachWorkerHandlers → worker-lifecycle`. | ~3 LOC, 5min |
| **U22** | Spec C4 manquant — pin `_innerLoopDepth <= 1` assert sur intra-tick parallel re-entry. | ~30 LOC, 30min |
| **U25** | `shouldRunTurnTimer(session): boolean` prédicate + commentaire global "null-guarded by design" + spec pin. | ~20 LOC, 30min |
| **U14** | Commentaire-table en tête de `broadcastMessage` listant les 7 stages + dépendances d'ordre. | ~15 LOC, 15min |
| **U27** | Commentaire-anchor "SOLO-AWARE MESSAGE CONTRACT" en tête de `PSEUDO_PAIRWISE_SOLO_ROUTED`. | ~10 LOC, 15min |
| **U17** | Log symétrique fork sanity OK path + flag `sanityWarningAccepted` au log de transition. | ~10 LOC, 15min |
| **U29** | `_destroyed: boolean` flag + early-return dans `cleanup()` + 2 specs idempotence. | ~20 LOC, 30min |

#### Bucket 3 — Spec coverage (~3-5h)

| # | Description | Effort |
|---|---|---|
| **U1** | 3 tests fork-specific carve-outs (no rematch, no persist, log tag) dans `worker-lifecycle.spec.ts` + `worker-message-router.spec.ts`. | ~50 LOC, 30min |
| **C4** | Spec parity `perspective-zone-key.parity.spec.ts` — walk TS files, regex `${ZONE_ID}-${X}`, fail si X non-relative. | ~50 LOC, 1h |
| **U6** | Spec table-driven `mass-reset matrix` pinning 4 sites × 8 fields contre §4.3 A8. | ~100 LOC, 1-2h |
| **U12** | Taxonomy `SEGMENTATION_ACTION` + spec parametrisée sur l'union `ServerMessage['type']`. | ~60 LOC, 1h |
| **U13** | `commitAll(site?: string)` log warn quand locks > 0 + tag les 3 call-sites replay skip. | ~20 LOC, 30min |
| **U24** | i18n `inactivity_solo` + bonus `InactivityWarningDialog` adapté SOLO. | ~15 LOC, 30min |
| **U31** | `applySinks(conn)` privé dans `DuelWebSocketService` ; SOLO orchestrator retire son `wireConnectionDebugSinks`. | ~30 LOC, 1h |

#### Bucket 4 — Refacto moyens (effort 3h-1j chacun)

| # | Description | Effort |
|---|---|---|
| **U15** | Factory `createInitialSessionState(opts)` + `resetSessionForRematch(session)` (ferme aussi U37). | ~50 LOC, 3h |
| **U38** | `cancel-rollback-main.ts` — extrait `snapshotCancelTarget` + `applyCancelRollbackBroadcast` + spec dédiée. | ~80 LOC, 1j |
| **U20** | Routing table + méthodes privées `_handleXxx(msg)` dans DuelConnection. | ~1-2j |
| **U4** | Extraction `ocg-message-transforms.ts` (~500 LOC, 14 transforms) + `duel-worker-fork.ts` (~260 LOC). | 1-2j (transforms) + 4h (fork) |

#### Bucket 5 — KEEP-LATER (à rediscuter ensemble dans un chantier server-side dédié)

| # | Description |
|---|---|
| **U32** | server.ts ~600 LOC residual — 3 extractions `pvp-connection-handler` + `session-orchestrator` + `ws-write` (~3-5j). |
| **U34** | DI graph hub — `DuelEndCoordinator` extraction casse le cycle runtime (~2-3j). À coupler avec U32. |

#### Bucket "DROP" (pour archive, 13 findings)

U5, U7, U8, U9, U10, U11, U19, U21, U23, U26, U35, U36, U37, C9 — réfutés ou absorbés par d'autres findings. Voir détails dans la section Investigation.

#### Séquencement recommandé

1. **Aujourd'hui (Bucket 1)** : U28 + U16 → ferment 2 bugs latents. ~3-4h.
2. **Cette semaine (Bucket 2)** : tous les quick wins. ~3-5h cumulés.
3. **Sprint suivant (Bucket 3)** : spec coverage. ~3-5h.
4. **Plus tard (Bucket 4)** : refacto moyens, par ordre de ROI. U15+U37 d'abord (ferme 2 d'un coup), puis U20, puis U4.
5. **Chantier server-side dédié (Bucket 5)** : U32 + U34 ensemble, à planifier.

**Stop-rule** : si Bucket 1 (bugs latents) fait surface des régressions test ailleurs, stopper et investiguer avant Bucket 2.

---

### Investigation détaillée par finding

#### U1 — 3 carve-outs fork-spécifiques sans test dédié → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité** : HIGH
**Source** : fork-solo

**Sites** :
- [worker-message-router.ts:226](duel-server/src/worker-message-router.ts#L226) — skip `persistReplay` quand `session.forkMode`
- [worker-lifecycle.ts:165](duel-server/src/worker-lifecycle.ts#L165) — skip `rematchTimeout = setTimeout(...)` quand `session.forkMode`
- [worker-message-router.ts:266](duel-server/src/worker-message-router.ts#L266) — `mode: 'fork_solo'` sur DUEL_END log

**Investigation** :
- `worker-lifecycle.spec.ts` (qui pin le contrat rematch arm) : 0 occurrence de `forkMode` → le skip rematch n'est testé nulle part.
- `worker-message-router.spec.ts` (qui pin broadcastMessage) : 0 occurrence de `forkMode` → ni persist skip ni log tag testés.
- `fork-handlers.spec.ts:138-150` pin la construction de session forkMode=true (bootstrap couvert). Le commentaire `fork-handlers.spec.ts:246-247` documente que la parity routing fork↔SOLO est testée "structurellement par la même code path" et n'inclut PAS de E2E des 3 skips dans ce module — par design.

→ Le trou est réel : les 3 skips vivent dans `worker-message-router` + `worker-lifecycle`, mais les specs de ces deux modules ne les exercent pas.

**Cleanup proposé (~30 min, ~50 LOC)** :

```ts
// duel-server/src/worker-lifecycle.spec.ts — dans describe('handleDuelEnd')
it('does NOT arm rematch timer when session.forkMode', () => {
  configureWorkerLifecycle(makeConfig(spy));
  const s = makeSession({ forkMode: true, soloMode: true });
  handleDuelEnd(s);
  expect(s.endedAt).not.toBeNull();
  expect(s.rematchTimeout).toBeNull();
});
```

```ts
// duel-server/src/worker-message-router.spec.ts — 2 tests
it('skips persistReplay on WORKER_REPLAY_DATA when session.forkMode', () => {
  // spy sur persistReplay ; broadcaster WORKER_REPLAY_DATA sur forkMode=true session
  // assert persistReplay NOT called, safeTerminateWorker called
});

it('writes mode: "fork_solo" on DUEL_END log line for forkMode sessions', () => {
  // spy logger.log ; déclencher MSG_WIN sur forkMode session
  // assert le 3e arg contient mode: 'fork_solo'
});
```

**Risque si on jette** : refactor `worker-lifecycle` ajoute rematch arm avant le `if (!session.forkMode)` → fork-solo propose une rematch invitation alors qu'il ne devrait pas. Aucun test ne crie.

---

#### U2 — PROTOCOL_VERSION jamais bumpé, coverage 4426 inégale → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité réelle** : MEDIUM (le finding disait HIGH mais 4426 est bien handled sur les 3 services)
**Source** : WS protocol + parity gates

**Sites** :
- [duel-server/src/protocol-version-check.ts](duel-server/src/protocol-version-check.ts) — fonction pure extraite explicitement pour test, **pas de spec associée**
- [duel-server/src/server.ts:842-849](duel-server/src/server.ts#L842-L849) — appel `recordFailedWsAttempt + protocolMismatchCount++ + ws.close(4426)`
- [front/src/app/pages/pvp/duel-page/duel-connection.ts:928-942](front/src/app/pages/pvp/duel-page/duel-connection.ts#L928-L942) — branche 4426 (wipe tokens + signal)
- [front/src/app/pages/solver/services/solver.service.ts:218-226](front/src/app/pages/solver/services/solver.service.ts#L218) — branche 4426 (intentionalClose + toast)

**Investigation** :
- `protocol-version-check.spec.ts` : **n'existe pas** alors que le file docstring dit "extracted from server.ts for unit-testability"
- `duel-connection.spec.ts` lit `protocolMismatch()` l.65 mais **aucun `fireClose(4426)` n'est tiré** → la branche entière (wipe reconnectToken/wsToken/sessionToken + signal set) n'est pas exercée
- `replay-connection.service.spec.ts:219-228` couvre correctement les deux branches (4426 vs non-4426)
- `solver.service` : **aucun spec touche 4426**

**Faux ami du finding** :
- 4426 EST handled sur les 3 services (CLAUDE.md tient sa promesse)
- "No clean bump path exercised" est une formulation excessive : un bump est trivial (`PROTOCOL_VERSION = 2`, 1 ligne) ; ce qui manque c'est la confiance que le parsing du `pv` query param tient en edge cases.

**Cleanup proposé (~1h, ~80 LOC)** :

```ts
// duel-server/src/protocol-version-check.spec.ts — NEW FILE
import { describe, it, expect } from 'vitest';
import { checkProtocolVersionPure } from './protocol-version-check.js';
import { PROTOCOL_VERSION } from './ws-protocol-shared.js';

describe('checkProtocolVersionPure', () => {
  it('accepts matching version', () => {
    expect(checkProtocolVersionPure(String(PROTOCOL_VERSION)).ok).toBe(true);
  });
  it('rejects null (pv absent)', () => {
    const r = checkProtocolVersionPure(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.parsedClientVersion).toBeNull();
  });
  it('rejects non-numeric "abc"', () => {
    const r = checkProtocolVersionPure('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Number.isNaN(r.parsedClientVersion)).toBe(true);
  });
  it('rejects numeric mismatch', () => {
    const r = checkProtocolVersionPure(String(PROTOCOL_VERSION + 1));
    expect(r.ok).toBe(false);
  });
});
```

```ts
// front/src/app/pages/pvp/duel-page/duel-connection.spec.ts — ajouter
it('onclose with code 4426: wipes tokens + sets protocolMismatch', () => {
  conn.reconnectToken = 'tok-r';
  conn.wsToken = 'tok-ws';
  ws.fireClose(4426);
  expect(conn.protocolMismatch()).toBeTrue();
  expect(conn.reconnectToken).toBeNull();
  expect(conn.wsToken).toBeNull();
});
```

```ts
// front/src/app/pages/solver/services/solver.service.spec.ts — ajouter
it('onclose 4426: stops retrying + surfaces refresh toast', () => {
  ws.fireClose(4426);
  expect(svc.intentionalClose).toBe(true);
  // assert no setTimeout reconnect, toast key set
});
```

**Risque si on jette** : le jour où on bumpe PROTOCOL_VERSION=2 (nouveau msg system ajouté), un edge case du parsing peut échouer silencieusement — un client legacy passerait au lieu d'être rejeté. Détecté seulement en prod, sur les clients avec un bundle cache.

---

#### U3 — Animation Parity Rule sans gate → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité** : HIGH
**Source** : WS protocol + parity gates

**Règle** : `AnimationOrchestratorService` MUST NOT import or reference `DuelWebSocketService` or `DuelConnection` directly. Tout passe par `AnimationDataSource` (token `ANIMATION_DATA_SOURCE`).

**Sites** :
- [animation-orchestrator.service.ts:80](front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L80) — `inject(ANIMATION_DATA_SOURCE)` ✓
- [animation-data-source.spec.ts:259-260](front/src/app/pages/pvp/duel-page/animation-data-source.spec.ts#L259) — pin l'existence du token (mais pas son usage exclusif)

**Investigation** :
- Grep `DuelWebSocketService|DuelConnection` dans `animation-orchestrator.service.ts` → **0 occurrence** : la règle EST respectée aujourd'hui
- `eslint.config.js` + `front/eslint-plugins/` → aucune règle pour la garder
- Pas de spec dédiée pour l'orchestrator (il est testé via les specs en aval qui mockent `AnimationDataSource`)
- "Gate" actuel : si un dev ajoute `inject(DuelWebSocketService)`, les specs en aval (chain-resolution-manager, etc.) échouent avec "No provider for DuelWebSocketService" → détection accidentelle, message cryptique

**Verdict** : règle respectée + protégée par DI implicite, mais aucune prévention explicite. Trou défensif réel mais bas-niveau.

**Cleanup proposé (~15 LOC)** :

```ts
// front/src/app/pages/pvp/duel-page/animation-orchestrator.parity.spec.ts — NEW
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Animation Parity Rule (CLAUDE.md)', () => {
  it('animation-orchestrator.service.ts MUST NOT import DuelWebSocketService or DuelConnection', () => {
    const path = join(__dirname, 'animation-orchestrator.service.ts');
    const src = readFileSync(path, 'utf-8');
    // Strip comments to avoid false matches in docstrings
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(stripped).not.toMatch(/\bDuelWebSocketService\b/);
    expect(stripped).not.toMatch(/\bDuelConnection\b/);
  });
});
```

Alternative considérée : règle ESLint `no-restricted-imports` ciblée. Plus propre conceptuellement mais nécessite override dans `eslint.config.js`. Le test Karma est plus pragmatique pour 1 fichier × 2 classes.

**Risque si on jette** : un dev injecte `DuelWebSocketService` pour un besoin "rapide", ajoute un provider de mock dans les specs qui échouent → régression silencieuse vs replay, détectée seulement à l'usage prod du replay.

---

#### U4 — duel-worker.ts (1973 LOC) god-file → **KEEP** (ciblage précis)

**Statut** : KEEP (2026-06-01)
**Sévérité** : HIGH (mais ciblage à raffiner)
**Source** : PvP normal

**Investigation** :
- 39 fonctions top-level (pas "50+ transformXxx" — le finding exagère ; en réalité **14** transforms)
- Couplage au state worker (variables module-locales `core`, `duel`, etc.) :
  - `transformMove`, `transformHint`, `transformSelectChain`, `transformResponse`, `transformMessage` → couplés (5 transforms)
  - **9 transforms sur 14 sont des pure functions** (0 refs au state) — extractibles trivialement
- Sections distinctes du fichier :
  - L.347-580 : 14 `transformXxx` (~230 LOC)
  - L.580-879 : `transformMessage` big switch (~300 LOC)
  - L.879-1150 : `updateState` + `buildBoardState` (~270 LOC)
  - L.1150-1212 : `transformResponse` + `capturedSetResponse` (~60 LOC)
  - L.1250-1514 : `runDuelLoop` cœur (~265 LOC)
  - L.1514-1710 : `loadDeckToOcg` + `resetDuelState` + `cleanup` (~200 LOC)
  - L.1710-1973 : `runForkReconstruction` + `performSanityCheck` (~263 LOC) — branche fork

**Verdict** :
- 1973 LOC est vrai
- Sous-entendu "tout doit être splitté" est faux : le cœur (`runDuelLoop` + `updateState` + `buildBoardState` + `transformMessage` + `cleanup` + `resetDuelState`) est UNE responsabilité cohérente (driver OCGCore + emit) — confirmé par l'agent server-mod qui l'a explicitement défendu
- **2 extractions ciblées** sont légitimes

**Cleanup proposé** :

**Extraction 1 — `ocg-message-transforms.ts` (~400-500 LOC, 1-2 jours)**
- Sortir les 14 `transformXxx` + `decodePlaces`/`decodePositions`/`decodeBitmask`/`decodeAttributes` + `countersToRecord`
- Les 4 transforms couplés (Move/Hint/SelectChain/Response) reçoivent `core: OcgCoreSync, duel: OcgDuelHandle` en paramètres explicites
- Bénéfice : transforms unit-testables sans booter le worker ; duel-worker.ts passe de 1973 → ~1500 LOC

**Extraction 2 — `duel-worker-fork.ts` (~260 LOC, ~4h)**
- Sortir `runForkReconstruction` + `performSanityCheck`
- Bénéfice : duel-worker.ts → ~1240 LOC, branche fork lisible isolément, prépare un éventuel divergence future du bootstrap fork

**À NE PAS extraire** : `runDuelLoop`, `updateState`, `buildBoardState`, `transformMessage` (big switch), `cleanup`, `resetDuelState` — cœur cohérent.

**Risque si on jette** : duel-worker.ts continue de grossir à chaque nouvelle message type, passe les 2000 LOC, diff PR illisible, transforms non-testables unitairement.

---

#### U5 — 3 sources de vérité prompt slot ownership → **DROP**

**Statut** : DROP (2026-06-01) — doublon mal formulé de U6
**Sévérité** : HIGH (mais analyse à raffiner)
**Source** : PvP normal

**Investigation** :
Le finding cite 3 lieux : server `lastSentPrompt[p]`, client `_slots[p].pendingPrompt`, sendResponse `pendingPrompt.player`.

Architecture réelle :
- **1 source serveur authoritative** : `session.lastSentPrompt[p]` (5 mass-resets + writes par player) — utilisée pour CANCEL_PROMPT_SEQUENCE re-broadcast et STATE_SYNC re-emit
- **1 mirror client** : `_slots[p].pendingPrompt` (9 sites de write) — UI dialog state
- Le 3e "lieu" cité (`sendResponse` lit `pendingPrompt.player`) **n'est pas une source de vérité** — c'est un read du mirror pour identifier le slot, post-F-bugB3 fix

**Raison du DROP** :
- Le seul vrai bug récent (F-bugB3, [duel-connection.ts:644-659](front/src/app/pages/pvp/duel-page/duel-connection.ts#L644)) a été fixé en lisant `pendingPrompt.player` — soit exactement ce que le finding suggère. La doctrine "source serveur autoritative" tient.
- La dette réelle = les 5 mass-resets côté client + 3 côté serveur sont hand-maintained → **c'est exactement le périmètre de U6** formulé proprement
- "3 sources" est un faux ami : 1 source + 1 mirror + 1 read helper

→ Drop en faveur de U6 qui cible le même problème de façon actionable.

---

#### U6 — Symmetric clear blocks hand-maintained à 4 reset sites → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité** : HIGH
**Source** : PvP normal

**Investigation** :

4 mass-reset blocks identifiés dans [duel-connection.ts](front/src/app/pages/pvp/duel-page/duel-connection.ts), chacun fait des clears **différents** :

| Site | Case | `pendingPrompt` | `inactivityWarning` | `waitingForOpponent` | `hintContext` | `lastConfirmedCards` | `lastSelectedCards` | `lastSelectedPromptType` | `hintCardConsumed` |
|---|---|---|---|---|---|---|---|---|---|
| l.1183 | DUEL_STARTING | set(message) | – | false | – | – | – | – | – |
| l.1209 | FIRST_PLAYER_RESULT | null | – | false | – | – | – | – | – |
| l.1338 | DUEL_END | null | null | false | empty | [] | – | – | – |
| l.1407 | REMATCH_STARTING | null | null | false | empty | [] | – | – | – |
| l.1661 | STATE_SYNC | null | – | – | empty | [] | [] | null | false |

**Source autoritative** : spec §4.3 A8 dans [`phase-gamma-option-c-multiplex-spec.md:986-1018`](_bmad-output/planning-artifacts/phase-gamma-option-c-multiplex-spec.md#L986) — 8 fields per-perspective + reset rules par event. Le code source y fait référence (F10, F12 commentaires l.1334-1406).

**Tests existants** :
- 1 test DUEL_END à [duel-connection.spec.ts:200-223](front/src/app/pages/pvp/duel-page/duel-connection.spec.ts#L200) — vérifie SEULEMENT 3 fields (`duelResult`, `pendingPrompt`, `lastConfirmedCards`). Loupe `inactivityWarning`, `waitingForOpponent`, `hintContext` clears.
- **Aucun test** pour REMATCH_STARTING, FIRST_PLAYER_RESULT, DUEL_STARTING mass-clears
- Tests STATE_SYNC présents (F14 atomic) mais ne vérifient pas exhaustivement les 8 fields

→ La spec table A8 vit dans un doc, **pas dans le code**. Pure review-time discipline.

**Cleanup proposé (~100 LOC)** :

```ts
// duel-connection.spec.ts — nouveau describe block
describe('DuelConnection — mass-reset matrix (spec §4.3 A8)', () => {
  const RESET_MATRIX = {
    'DUEL_END':            { pendingPrompt: 'null', inactivityWarning: 'null', waitingForOpponent: false, hintContext: 'empty', lastConfirmedCards: '[]' },
    'REMATCH_STARTING':    { pendingPrompt: 'null', inactivityWarning: 'null', waitingForOpponent: false, hintContext: 'empty', lastConfirmedCards: '[]' },
    'STATE_SYNC':          { pendingPrompt: 'null', lastSelectedCards: '[]', lastSelectedPromptType: 'null', hintCardConsumed: false, hintContext: 'empty', lastConfirmedCards: '[]' },
    'FIRST_PLAYER_RESULT': { pendingPrompt: 'null', waitingForOpponent: false },
  };
  for (const [event, expected] of Object.entries(RESET_MATRIX)) {
    it(`${event}: clears expected fields per spec §4.3 A8`, () => {
      const conn = new DuelConnection('/ws/test', false, 'k');
      primeSlotState(conn, 0);
      primeSlotState(conn, 1);
      dispatch(conn, mockEvent(event));
      for (const slot of [0, 1] as const) {
        for (const [field, value] of Object.entries(expected)) {
          expect(conn.getSlotField(slot, field)).toMatch(value);
        }
      }
    });
  }
});
```

**Pas d'extraction structurelle** — les 5 boucles ne sont pas factorisables en 1 helper sans paramétriser massivement ce qu'on clear vs garde. La spec test-driven est suffisante pour fermer la dette.

**Risque si on jette** : un dev refactor `_inactivityWarning` (ex: passage à Map) → oublie clear REMATCH_STARTING → leak du warning d'un duel à l'autre. Manifesté seulement par un user voyant "expulsion inactivité" en pleine rematch arena.

---

#### U7 — orchestrator 1985 LOC, thin-coordinator est un mensonge → **DROP**

**Statut** : DROP (2026-06-01) — doublon de C1
**Sévérité** : HIGH (mais redondant)
**Source** : PvP normal

**Investigation** :
- 1985 LOC ✓
- 18 inject() (finding dit "25+", exagère mais ordre de grandeur)
- Sections : DI sourcing (78-110), state (112-171), projection declarations (320-338), event push (339-510), constructor wiring (509-670), public API (671-810), reset coordination (870-1030), `_handleEntry` (1215-1320), `processDirective` (1322+)
- 54 références internes à `decorateLpEventForStream`, `phaseWait`, `pushToStream`, `pushDeferredToStream`, `_transport_lastDispatchedRef` → tout est densément interconnecté

**Raison du DROP** :
- C1 (déjà confirmé) couvre exactement le seul cleanup ROI-positif : `ProjectionRegistry` / `_streamProjections[]` array (~50 LOC factorisables)
- Toute autre extraction (`EventPushPipeline`, `OrchestratorResetCoordinator`) **ne réduit pas le couplage**, elle le déplace : un `EventPushPipeline` aurait besoin des mêmes 18 deps
- Le côté "1985 LOC est un signal SRP" est documentation-only — c'est un god-file de fait, mais structurellement justifié (intégrateur du pipeline animation)

→ Drop en faveur de C1 qui pin le seul actionable.

---

#### U8 — 3 pre-duel `_slots` carve-outs → **DROP**

**Statut** : DROP (2026-06-01) — finding réfuté après investigation
**Sévérité** : HIGH (mais finding faux)
**Source** : SOLO multiplex

**Investigation** :

3 carve-outs `for (const s of this._slots) s.X.set(...)` confirmés :

| Site | Case | Raison du BOTH-slots write |
|---|---|---|
| [duel-connection.ts:1168](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1168) | DICE_ROLL | `perspectiveSlot()` est UNRESOLVED en 1er duel (lit `_slots[0]`) mais RESOLVED en rematch (joiner lit `_slots[1]`) → écrire les 2 |
| [duel-connection.ts:1183](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1183) | SELECT_FIRST_PLAYER | Idem DICE_ROLL |
| [duel-connection.ts:1266](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1266) | MSG_HINT broadcast public | Payload `.player = origine`, mais tous viewers doivent voir → écrire les 2 (A39-bis fix) |

**Raison du DROP** : chaque carve-out est déjà couvert sur 3 angles :

1. **Doctrine inline** : commentaires 5-10 lignes expliquant POURQUOI (timing pré-duel vs origine payload publique)
2. **Specs Karma dédiées** :
   - [duel-connection.spec.ts:370](front/src/app/pages/pvp/duel-page/duel-connection.spec.ts#L370) `DICE_ROLL (player:1) lands in BOTH slots`
   - [duel-connection.spec.ts:378](front/src/app/pages/pvp/duel-page/duel-connection.spec.ts#L378) `SELECT_FIRST_PLAYER (player:1) lands in BOTH slots`
   - [duel-connection.spec.ts:599-661](front/src/app/pages/pvp/duel-page/duel-connection.spec.ts#L599) `describe A39-bis MSG_HINT broadcast intra-slot` (8 tests)
3. **Commits fix identifiables** : γ-c regression 2026-05-29, γ-c regression 2026-05-30, A39-bis

→ Aucune action requise. Le finding lit la situation comme un trou ; en réalité c'est de la doctrine + tests + traçabilité git complète.

---

#### U9 — Mid-chain switchPerspective hygiène → **DROP**

**Statut** : DROP (2026-06-01) — finding obsolète, déjà fixé par F3
**Sévérité** : HIGH (mais déjà résolu)
**Source** : SOLO multiplex

**Investigation** :

Le finding suggère que le gate `isBoardStableForSwitch` existe mais que la data-only relativization "n'est pas structurellement prouvée". Investigation :

- F3 (2026-05-30, commit `abcc259f`) a introduit `canSwitchPerspective` à [solo-duel-orchestrator.service.ts:236-243](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L236) avec 4 conditions cumulatives :
  - Prompt modal absent (whitelist `IDLE_PHASE_PROMPT_TYPES`)
  - Pas de draw in flight (`!drawManager.hasDrawsInFlight`)
  - `chainPhase === 'idle'`
  - `!isAnimating` (queue drainée, locks libérés)
- 5 tests dédiés au gate F3 dans [phase-gamma-victory.spec.ts:393-432](front/src/app/pages/pvp/duel-page/phase-gamma-victory.spec.ts#L393) :
  - blocks switch while board NOT stable
  - blocks while draw in flight
  - allows once board stable again
  - blocks on modal prompt active
  - allows on stable board no prompt
- **Suite T-F6** ([phase-gamma-victory.spec.ts:461+](front/src/app/pages/pvp/duel-page/phase-gamma-victory.spec.ts#L461)) pin le **cardinal γ invariant** : même si un switch passe le gate (impossible via UI, possible via edge case reconnect), la chain SOLO multiplex survit structurellement parce qu'il y a UN seul `DuelEventProcessor` sur UNE seule `DuelConnection` (post-γ-c collapse, 2026-05-29).

→ Le backlog `pvp-solo-chain-state-hygiene-2026-05-23` est **fermé** : gate F3 user-facing + invariant T-F6 transport-level = double-belt + braces.

**Note collatérale** : memory `pvp-solo-chain-state-hygiene-2026-05-23` mise à jour 2026-06-01 — précise les 2 couches de protection (γ transport + F3 user-facing).

---

#### U10 — F10 cost-sync parity sans gate → **DROP** (doublon de C5)

**Statut** : DROP (2026-06-01) — doublon de C5 confirmé
**Sévérité** : HIGH (mais redondant)
**Source** : Replay

**Investigation** :
Même contenu que C5 (confirmé) : PvP emits `BOARD_STATE` via `hasCostMoves` flag ; Replay relies on `PreComputedState` segmentation ; no automated gate.

Conflit interne du verdict adversarial : le même problème apparaît **4 fois** dans l'audit :
- **C5** confirmé (KEEP implicite)
- **U10** (ici, non vérifié)
- **R10, R12, R20** (réfutés par 3 agents skeptic indépendants)

Les réfutations citent la doctrine F10 CLAUDE.md L217-247 + cross-reference comments duel-worker.ts:1367-1375 et replay-precompute.ts:394-406 qui defere le fix "if a future bug surfaces a divergence here, the right fix is probably to hoist into a shared utility" — Axel-validated 2026-05-31.

→ DROP en faveur de C5. Décision opérationnelle reste deferred par doctrine F10 jusqu'à premier bug réel.

---

#### U11 — PvP-replay convergence parallel impl → **DROP**

**Statut** : DROP (2026-06-01) — finding faux ; le share est exactement où il doit être
**Sévérité** : HIGH (mais finding réfuté)
**Source** : Replay

**Investigation** :

LOC par side :
- [duel-connection.ts](front/src/app/pages/pvp/duel-page/duel-connection.ts) (PvP+SOLO) — 1696 LOC
- [replay-duel-adapter.ts](front/src/app/pages/pvp/replay/replay-duel-adapter.ts) — 372 LOC
- [animation-data-source.ts](front/src/app/pages/pvp/duel-page/animation-data-source.ts) (shared) — 206 LOC

**Ce qui est partagé (vérifié)** :
- Interface `AnimationDataSource` (contrat)
- Helper `syncAfterBoardState` (pure function ~30 LOC)
- `ChainSnapshotTracker` côté serveur (parity by construction)
- `board-state-swap.ts` (perspective swap utility, γ Option C PR2 c4.4)
- `DuelEventProcessor` (même classe instanciée côté DuelConnection ET ReplayDuelAdapter)
- `RenderedBoardStateService`, `AnimationOrchestratorService` (même services)
- L'impl `AnimationDataSource` dans chaque side = thin pass-through au processor (~50-65 LOC chacun)

**Ce qui est mode-specific (par nature)** :
- DuelConnection : WS lifecycle, reconnect, handleMessage switch 35 cases, slot routing, STATE_SYNC buffer, prefetch, game-log relay
- ReplayDuelAdapter : feedTransition / feedTransitionPhased / buildSteps / advanceStep / resetProcessorForTransition

**Raison du DROP** : le finding mélange "intentionally distinct" (WS vs timeline) avec "duplicated by accident". Forcer plus de share entre les deux casserait la séparation des responsabilités. Le seul vrai gap résiduel (F10 cost-sync) est déjà cité par C5.

---

#### U12 — Replay-precompute flush boundaries implicites → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité réelle** : MEDIUM (le finding disait HIGH, mais fréquence d'ajout `MSG_*` ~1/an)
**Source** : Replay

**Investigation** :

La segmentation `PreComputedState` est éclatée en 4 branches dans `runReplayPreComputation` :
- [replay-precompute.ts:407-413](duel-server/src/replay-precompute.ts#L407) — flush BEFORE accumulating `MSG_CHAINING`
- [replay-precompute.ts:414-431](duel-server/src/replay-precompute.ts#L414) — flush + push `MSG_CHAIN_END` separator
- [replay-precompute.ts:438-443](duel-server/src/replay-precompute.ts#L438) — flush on `NEW_PHASE`
- [replay-precompute.ts:355-367](duel-server/src/replay-precompute.ts#L355) — flush + emit batch on `NEW_TURN`

`generateLabel` (l. 119-144) switch peut tomber dans un default silencieux pour un type inconnu.

**Couverture existante** : 21 tests dans replay-precompute.spec.ts, dont 5+ pinning les boundaries (NEW_TURN, MSG_CHAINING/MSG_CHAIN_END, MSG_NEW_PHASE, SELECT prompt feeding). Solide pour les types **existants**, **pas exhaustif** sur l'union `ServerMessage['type']`.

**Risque** : un nouveau `MSG_*` ajouté côté `transformMessage` (duel-worker.ts) sans toucher `runReplayPreComputation` :
- Si nécessite flush-before → accumulé dans l'état précédent silencieusement
- Si label-only → tombe dans `generateLabel` default → state labelé avec raw type name

Fréquence d'ajout `MSG_*` ~1/an (vu via git log) → risque réel mais faible.

**Cleanup proposé (~60 LOC)** :

```ts
// duel-server/src/replay-precompute.ts — au-dessus de runReplayPreComputation
type SegmentationAction = 'flush-before' | 'flush-after' | 'accumulate' | 'skip';

const SEGMENTATION: Partial<Record<ServerMessage['type'], SegmentationAction>> = {
  MSG_CHAINING:   'flush-before',
  MSG_CHAIN_END:  'flush-before', // + push as separator (handled inline)
  WAITING_RESPONSE:    'skip',
  MSG_CHAIN_SOLVING:   'skip',
  MSG_CHAIN_SOLVED:    'skip',
  MSG_HINT:            'skip',
  MSG_CONFIRM_CARDS:   'skip',
  // default: 'accumulate'
};

function getSegmentationAction(t: ServerMessage['type']): SegmentationAction {
  return SEGMENTATION[t] ?? 'accumulate';
}
```

Remplacer le ladder `if (filtered.type === 'MSG_CHAINING') ... else if` par un `switch (getSegmentationAction(filtered.type))`. Les flush NEW_PHASE / NEW_TURN restent inline (ils opèrent sur `OcgMessageType`, pas `ServerMessage`).

**Spec parametrisée** (~30 LOC) :

```ts
// duel-server/src/replay-precompute.spec.ts — nouveau describe
describe('segmentation taxonomy completeness', () => {
  // Hardcode l'union manuellement OU dériver via un type-helper si dispo.
  const ALL_SERVER_MSG_TYPES: ReadonlyArray<ServerMessage['type']> = [
    'MSG_MOVE', 'MSG_DRAW', 'MSG_CHAINING', 'MSG_CHAIN_END', /* etc — exhaustive */
  ];
  for (const t of ALL_SERVER_MSG_TYPES) {
    it(`${t}: has a documented segmentation action`, () => {
      const action = getSegmentationAction(t);
      expect(['flush-before', 'flush-after', 'accumulate', 'skip']).toContain(action);
    });
  }
});
```

**Note** : la spec force tout ajout futur de `MSG_*` à passer par le SEGMENTATION map ou à être explicitement classé `'accumulate'`. Le PR qui ajoute le type fait apparaître la décision au revieweur.

**Risque si on jette** : un futur `MSG_NEW_TURN_VARIANT` accumulé dans le précédent state, manifesté seulement quand un user replay touche cette feature et constate "le label est wrong" ou "ce coup est rattaché à la phase précédente".

---

#### U13 — Lock-assert sites fragmentés (3 sites replay skip) → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité** : HIGH
**Source** : Replay
**Complémentaire à** : C7 (F19 lock-assert sites manifest manquant)

**Investigation** :

CLAUDE.md L809-843 doctrine 7 sites assertés + 3 sites **intentionally NOT asserted** :
- [replay-duel-adapter.ts:316](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L316) — `collapseRemainingSteps` (user skip-to-end)
- [replay-duel-adapter.ts:357](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L357) — `abort` (teardown)
- [replay-duel-adapter.ts:366](front/src/app/pages/pvp/replay/replay-duel-adapter.ts#L366) — `jumpToState` (user seek)

Les 3 appellent `commitAll()` qui clear silencieusement `_locks` via [rendered-board-state.service.ts:277-282](front/src/app/pages/pvp/duel-page/rendered-board-state.service.ts#L277).

**Audit memo F36 ≡ F19** (planning-artifacts/audit-cohabitation-modes-2026-05-31.md:185-186) : "`assertNoLocks()` documentée comme garde mais zéro appelant prod" → soit le pipeline est vraiment propre, soit les leaks sont masquées par les `commitAll` voluntary-skip.

**Cleanup proposé (~20 LOC)** :

```ts
// rendered-board-state.service.ts:277
commitAll(site?: string): void {
  if (site && this._locks.size > 0) {
    this.logger?.warn('commitAll dropped %d active locks at %s: %s',
      this._locks.size, site, [...this._locks.keys()].join(', '));
  }
  for (const tid of this._safetyTimeouts) clearTimeout(tid);
  this._safetyTimeouts.clear();
  this._locks.clear();
  this._rendered.set(this._logical());
}
```

Tagger les 3 call-sites replay :
- `commitAll('replay:collapseRemainingSteps')`
- `commitAll('replay:abort')`
- `commitAll('replay:jumpToState')`

Les autres call-sites (orchestrator `destroy`, draw-sequence fallback, buffer-replay-builder) restent untagged — soit passent par `assertNoLocks` avant (reset boundaries), soit run avec locks par design (mid-pipeline).

**Différence vs F19/C7** : F19 throw sur les RESET boundaries (forcer la propreté pre-transition). U13 LOG sur les VOLUNTARY-SKIP paths (détecter sans bloquer le skip-to-end user). Orthogonal, complémentaire.

**Risque si on jette** : une régression dans `collapseRemainingSteps` (ex: 50 locks droppés à chaque skip à cause d'un nouveau handler qui ne release pas) est invisible. Manifeste seulement quand un user note une zone qui clignote bizarrement au skip.

---

#### U14 — `broadcastMessage` god-function (130 LOC, 7 responsabilités) → **KEEP minimal**

**Statut** : KEEP minimal (2026-06-01) — commentaire-table only, PAS la refacto pipeline
**Sévérité réelle** : LOW (le finding disait HIGH, mais ROI/risque défavorable au split)
**Source** : server-mod

**Investigation** :

7 responsabilités dans [worker-message-router.ts:238-367](duel-server/src/worker-message-router.ts#L238) (130 LOC) :

| # | LOC | Stage | Dépend de |
|---|---|---|---|
| 1 | 248 | `ingestGameLog` | — |
| 2 | 250-271 | `handleDuelEndAndWin` (DUEL_END + MSG_WIN synthesis + mode tag) | Stage 1 (commentaire explicite) |
| 3 | 274 | `applyChainTransition` | — |
| 4 | 276-280 | `tagConfirmCardsChainIndex` (M22) | Stage 3 (lit `currentSolvingChainIndex`) |
| 5 | 282-286 | `cacheBoardStateAndTurn` | — (mais STAGE 7 STATE_SYNC reconnect lit `lastBoardState`) |
| 6 | 288-325 | `armSelectTimers` (awaiting + WAITING_RESPONSE + cancel cache + inactivity) | — |
| 7 | 327-367 | `sendPerPlayerFiltered` (SOLO omniscient OR per-player loop) | Stages 3, 5, 6 |

**Analyse du risque refacto** :

1. **Ordre load-bearing** entre 4 stages (1→2, 3→4, 5→7, 6→7) — un pipeline déclaratif perd la visibilité de ces dépendances
2. **Early-return SOLO** au stage 7 (l. 353) — pas facilement convertible en pipeline sans sentinel
3. **Side-effects mutations** sur `session` partout — pipeline pure-fonction serait artificiel
4. **Tests** : 6 describes Karma — refacto = risque régression silencieuse sur edge cases non testés
5. **Croissance stable** : git log montre ~1 modif/3 mois sur le fichier

**Pourquoi pas la refacto** : ROI ≈ "lisibilité de l'ordre" — pas le couplage (déplacé, pas réduit), pas la testabilité (déjà testée). Le risque est MEDIUM (régression SOLO subtile, détectée tardivement par Playwright manuel).

**Cleanup minimal proposé (~15 LOC)** :

```ts
/**
 * broadcastMessage pipeline — 7 stages, ORDER IS LOAD-BEARING :
 *
 *   1. ingestGameLog          (BEFORE 2 — natural-end row built from raw MSG_WIN)
 *   2. handleDuelEndAndWin    (DUEL_END + MSG_WIN→DUEL_END synthesis + mode tag)
 *   3. applyChainTransition   (BEFORE 4 — sets session.currentSolvingChainIndex)
 *   4. tagConfirmCardsChainIndex (M22 — reads session.currentSolvingChainIndex)
 *   5. cacheBoardStateAndTurn (BEFORE 7 STATE_SYNC reconnect path)
 *   6. armSelectTimers        (awaiting + WAITING_RESPONSE + cancel cache + inactivity)
 *   7. sendPerPlayerFiltered  (SOLO omniscient short-circuit ; OR per-player loop)
 *
 * Mutating dependencies between stages prevent extraction into a declarative
 * pipeline. The SOLO early-return at stage 7 also resists factoring.
 */
export function broadcastMessage(session: ActiveDuelSession, message: ServerMessage): void {
```

→ Capture 80% du gain de lisibilité avec 0% du risque. Un futur dev qui ajoute une 8e responsabilité saura où l'insérer + pourquoi l'ordre compte.

**Quand ré-évaluer pour la refacto full** : si une 8e responsabilité est ajoutée OU si un bug d'ordre des stages survient (preuve concrète que l'implicite cause des erreurs).

---

#### U15 — `ActiveDuelSession` 35-field mutable bag → **KEEP modéré**

**Statut** : KEEP modéré (2026-06-01) — 2 helpers ciblés ; full class+methods à ré-évaluer au moment de l'implem (Axel-validated)
**Sévérité** : HIGH
**Source** : server-mod

**Investigation** :

- 35 fields confirmé dans [types.ts:373-460](duel-server/src/types.ts#L373) (`interface ActiveDuelSession extends DuelSession`)
- **78 writes** `session.X = ...` éparpillés sur **7 modules** :
  - `server.ts` : 45 writes (construction + tear-down + rematch reset)
  - `first-player-coordinator.ts` : 12
  - `timer-management.ts` : 7
  - `worker-message-router.ts` : 6
  - `worker-lifecycle.ts` : 5
  - `fork-handlers.ts` : 2
  - `replay-persist.ts` : 1
- **Aucune méthode atomic** sur la session (sauf `DuelSessionManager.terminate`) → couples comme `awaitingResponse[p] = true` + `promptSentAt[p] = Date.now()` doivent être maintenus à la main partout
- **3 sites de reset hand-maintained** :
  - Initial construction PvP : [server.ts:453-494](duel-server/src/server.ts#L453)
  - Rematch reset : [server.ts:573-591](duel-server/src/server.ts#L573) (18 lignes hand-coded)
  - `cleanupDuelSession` : [server.ts:739+](duel-server/src/server.ts#L739)
- **Construction fork-handlers vs server.ts quasi-duplique** : [fork-handlers.ts:72-116](duel-server/src/fork-handlers.ts#L72) ~45 lignes parallèles à PvP, modulo `forkMode: true / soloMode: true / skipShuffle: true` (recouvre **U37**)

**Cleanup proposé (KEEP modéré, ~50 LOC, ~3h)** :

```ts
// duel-server/src/session-factory.ts — NEW
export function createInitialSessionState(opts: {
  duelId: string;
  players: [PlayerSession, PlayerSession];
  decks: [Deck, Deck];
  soloMode: boolean;
  forkMode?: boolean;
  skipShuffle?: boolean;
  turnTimeSecs?: number;
  playerUsernames: [string, string];
  deckNames: [string, string];
  worker?: Worker | null;
  phase?: SessionPhase;
}): ActiveDuelSession {
  return {
    duelId: opts.duelId,
    phase: opts.phase ?? 'WAITING_PLAYERS',
    firstPlayerState: null,
    chosenFirstPlayer: null,
    players: opts.players,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    worker: opts.worker ?? null,
    // … 25 autres fields par défaut
    soloMode: opts.soloMode,
    forkMode: opts.forkMode ?? false,
    skipShuffle: opts.skipShuffle ?? false,
    turnTimeSecs: opts.turnTimeSecs ?? 300,
    decks: opts.decks,
    playerUsernames: opts.playerUsernames,
    deckNames: opts.deckNames,
    ...emptyChainState(),
    gameLog: createSessionGameLog(),
  };
}

export function resetSessionForRematch(session: ActiveDuelSession): void {
  session.workerTerminated = true;
  session.awaitingResponse = [false, false];
  session.lastBoardState = null;
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];
  session.rematchRequested = [false, false];
  session.endedAt = null;
  session.startedAt = Date.now();
  session.bothDisconnected = false;
  session.storedDuelResult = null;
  session.lastStateSyncAt = [0, 0];
  session.lastCancelAt = [0, 0];
  session.cancelTargetPrompt = [null, null];
  session.invalidResponseCount = [0, 0];
  session.promptSentAt = [0, 0];
  Object.assign(session, emptyChainState());
  session.gameLog = createSessionGameLog();
}
```

Call-sites à modifier :
- [server.ts:453-494](duel-server/src/server.ts#L453) (POST /api/duels) → `createInitialSessionState({...})`
- [fork-handlers.ts:72-116](duel-server/src/fork-handlers.ts#L72) → `createInitialSessionState({ soloMode: true, forkMode: true, skipShuffle: true, phase: 'DUELING', ... })`
- [server.ts:573-591](duel-server/src/server.ts#L573) rematch reset → `resetSessionForRematch(session)`

**Ferme** : U15 partiel + **U37 entier** (duplicate fork-handlers vs server.ts ctor).

**À ré-évaluer au moment de l'implem (Axel 2026-06-01)** : la version full `class ActiveDuelSession` avec méthodes atomiques (`armPrompt(p, type)`, `resetChainState()`, etc.) — ~3-5j de chantier touchant 7 modules + 200+ tests. Si l'implem du KEEP modéré révèle plus de duplication ou de risques d'ordre de mutation, escalader vers le full refacto.

**Risque KEEP modéré** : LOW. Les 2 helpers conservent le shape `ActiveDuelSession` ; les tests existants restent valides (ils testent le comportement, pas la construction).

**Risque si on jette** : drift entre fork-handlers et server.ts construction (déjà commencé : forkMode/skipShuffle/phase différents) ; un nouveau field ajouté à la session doit être ajouté à 4 endroits (initial PvP + initial fork + rematch reset + cleanup) — facile à manquer.

---

#### U16 — DEP `observe` retourne `{absorbed: boolean}` non propagé → **KEEP (priorité)**

**Statut** : KEEP priorité (2026-06-01) — bug latent probablement visible dans le journal game-log
**Sévérité réelle** : HIGH (le finding disait MEDIUM, l'investigation a révélé un impact concret)
**Source** : EventStream + game-log + projections

**Investigation** :

1. [`DeferredEffectProcessor.observe(event, ref)`](front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts#L428-L435) retourne `{absorbed: boolean}`.
2. La docstring l.422-426 dit explicitement : *"If absorbed: true, the orchestrator should SKIP the routing aval + emit synthetic AnimationStarted/AnimationCompleted markers for stream consistency"*.
3. [`xyzLeaveWithMaterials.chainTo`](front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts#L414-L438) (l'unique `RewriterRule` shippée à β.3) retourne `absorb` ou `absorb-and-close` quand un settling GRAVE→GRAVE match.
4. 2 specs DEP pin le retour (T-V4, T-V11 dans `deferred-effect-processor.spec.ts:700-759`).
5. **MAIS** [`AnimationOrchestratorService.pushToStream`](front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts#L1064-L1069) IGNORE la valeur de retour : `this.deferredProcessor.observe(event, ref);` — `{absorbed}` jeté.
6. Aucun handler dans l'orchestrator/router/processor ne skip le dispatch aval pour les settlings.

**Bug concret aujourd'hui** :

Un settling XYZ GRAVE→GRAVE est :
- Routé via `MoveAnimationRouter.pileToPile` → travel `GY-N → GY-N` (distance 0, invisible visuellement)
- **MAIS** ingest dans le journal game-log comme MSG_MOVE normal ([duel-game-log.service.ts:315-323](front/src/app/pages/pvp/duel-page/duel-game-log.service.ts#L315) filtre `isVirtual` mais PAS les réels settlings)
- → le journal affiche probablement N entrées "→ went to Graveyard" pour les settlings réels, alors que les N virtuels OVERLAY→GRAVE sont déjà filtrés par `isVirtual`

Conséquence : **mismatch journal visible** — entrées doubles ou mal labellées sur tout XYZ qui perd ses matériaux.

**Cleanup proposé (~30 LOC code + 20 LOC test)** :

```ts
// animation-orchestrator.service.ts:1064 — pushToStream
pushToStream(event: StreamEvent): number {
  const ref = this._transport_nextStreamRef++;
  this._eventStream.update(s => [...s, event]);
  const { absorbed } = this.deferredProcessor.observe(event, ref);
  if (absorbed) {
    // β.3 cas #12 — settling consumed by xyzLeaveWithMaterials rewriter.
    // Mark the queue entry so the runner skips the routing aval. Emit
    // synthetic AnimationStarted+Completed pair so the stream stays
    // consistent (lifecycle pair for every dispatched event).
    this._transport_absorbedRefs.add(ref);
  }
  return ref;
}

// _handleEntry — early return for absorbed events
if (this._transport_absorbedRefs.has(ref)) {
  this._transport_absorbedRefs.delete(ref);
  this.pushToStream({ kind: 'animation', type: 'AnimationStarted',   ref, msgType: event.type });
  this.pushToStream({ kind: 'animation', type: 'AnimationCompleted', ref, msgType: event.type });
  return 0; // skip MoveAnimationRouter
}
```

+ Spec orchestrator-level : "absorbed event skips MoveAnimationRouter + emits synthetic lifecycle pair + journal does NOT ingest the absorbed event".

**Validation runtime recommandée** : harness Playwright sur un replay XYZ destroy pour confirmer le bug journal visible avant/après. Selon résultat, ferme la dette structurelle + un bug user-facing.

**Risque si on jette** : bug journal visible **aujourd'hui** sur tout duel impliquant un XYZ qui perd ses matériaux. Manifeste comme entrées doubles "→ went to Graveyard" ou similaire.

---

#### U17 — Sanity check audit-trail fragmenté → **KEEP minimal**

**Statut** : KEEP minimal (2026-06-01)
**Sévérité réelle** : LOW (le finding disait MEDIUM)
**Source** : fork-solo

**Investigation** :

Flow `WORKER_FORK_READY` dans [replay-handlers.ts:467-491](duel-server/src/replay-handlers.ts#L467) :
- **Mismatch path** : `state = 'fork_warning'`, log `'Fork sanity mismatch'` + `REPLAY_ERROR(FORK_DIVERGENCE_WARNING)` au client, worker en attente
- **Match OK path** : `state = 'transitioning'` → `transitionForkToSolo(...)` **sans log dédié**
- **Continue after warning** : `handleReplayForkContinue` → `transitionForkToSolo(...)` **même branche, aucune distinction**

Vérifié : `ActiveDuelSession` n'a pas de champ `sanityResult` ou `sanityWarningAccepted` ([types.ts:373+](duel-server/src/types.ts#L373)).

**Logs existants** :
1. `dlog.log('Fork sanity check', { result: 'PASS' | 'MISMATCH' })` côté worker (debug-only, env-gated)
2. `logger.log('Fork sanity mismatch', ...)` côté replay-handlers (mismatch seulement)
3. `logger.log('Fork transitioned to solo session', { replayId, duelId })` sur transition

→ Audit-trail **existe mais fragmenté sur 3 logs** + impossible de distinguer "OK transition" vs "warning-accepted transition" depuis les logs.

**Cleanup proposé (~10 LOC)** :

```ts
// replay-handlers.ts:476-480 — branche OK
} else {
  conn.state = 'transitioning';
  // U17 — log symétrique au 'Fork sanity mismatch' pour confirmer
  // "session créée avec sanity=PASS" sans déduire par absence
  logger.log('Fork sanity check', { replayId: conn.replayId, result: 'PASS' });
  transitionForkToSolo(conn, worker, forkDuelId, replayData, /* sanityWarningAccepted */ false);
}

// replay-handlers.ts:575 — branche continue-after-warning
transitionForkToSolo(conn, pending.worker, pending.forkDuelId, pending.replayData, /* sanityWarningAccepted */ true);

// transitionForkToSolo — log final enrichi
logger.log('Fork transitioned to solo session', {
  replayId: conn.replayId,
  duelId: forkDuelId,
  sanityWarningAccepted,
});
```

**Risque si on jette** : aucun bug runtime, perte d'observabilité sur fork-warning-accepted sessions. Investiguer "le user a accepté un mismatch et a fork quand même" nécessite de corréler 3 logs au lieu d'1.

---

#### U18 — Boot order pitfall fork-handlers ↔ worker-lifecycle → **KEEP minimal**

**Statut** : KEEP minimal (2026-06-01) — comment-only, dépendance documentée
**Sévérité réelle** : LOW (le finding disait MEDIUM, l'investigation montre 0 risque prod)
**Source** : fork-solo

**Investigation** :

- [fork-handlers.ts:136](duel-server/src/fork-handlers.ts#L136) appelle `attachWorkerHandlers(session)` qui vit dans `worker-lifecycle.ts`
- `attachWorkerHandlers` lit `getCfg()` qui throw si `worker-lifecycle` n'est pas configuré
- [fork-handlers.spec.ts:65-76](duel-server/src/fork-handlers.spec.ts#L65) `wireUpstreams()` doit appeler `configureWorkerLifecycle` avec un stub minimum avant tout test
- **Prod boot invariant** ([server.ts:856-871](duel-server/src/server.ts#L856)) vérifie les 10 modules AVANT `wss.on('connection')`. Si un module manque → throw au boot.

**Faux du finding** :
- "production wires it only in server.ts" → c'est précisément l'endroit prévu par le pattern `createConfigurable`. Tous les modules sont configurés au boot, le boot invariant capture les oublis.
- "regression risk if someone introduces an eager call from a configure callback" → reste hypothétique ; le boot invariant trap dès la première run.

**Vrai du finding** :
- Dépendance implicite `fork-handlers → worker-lifecycle` non documentée dans le code → confusion pour un nouveau dev écrivant un test fork-handlers.

**Cleanup proposé (~3 LOC)** :

```ts
// fork-handlers.ts:136
session.worker = worker;
// U18 — attachWorkerHandlers requires configureWorkerLifecycle (wired in
// server.ts boot block, ordered before fork-handlers' first call site).
// Tests must call configureWorkerLifecycle in their setup (see fork-handlers.spec.ts).
attachWorkerHandlers(session);
```

**Alternative écartée** : injecter `attachWorkerHandlers` via `ForkHandlersConfig` (typed-explicit). Over-engineered selon le finding lui-même (3-4 jours pour le bénéfice de type-safety).

**Risque si on jette** : aucun en prod. Un nouveau dev écrivant un test fork-handlers sans wire worker-lifecycle aura erreur cryptique "worker-lifecycle: configureWorkerLifecycle() not called" — friction évitable.

---

#### U19 — Front index barrel pas byte-checked → **DROP**

**Statut** : DROP (2026-06-01) — risque pratique faible, doctrine déjà présente
**Sévérité** : MEDIUM (mais ROI très faible)
**Source** : WS protocol + parity gates

**Investigation** :

- [scripts/check-ws-protocol-sync.mjs:16-18](scripts/check-ws-protocol-sync.mjs#L16) confirme explicitement : "The two index files (ws-protocol.ts on back, duel-ws.types.ts on front) are NOT byte-checked: they have different import paths and slightly different re-export bodies. Their structural correctness is enforced by tsc."
- Les 2 barrels font 168 LOC chacun, structurellement identiques après normalize
- Diff réel après normalize = **2 lignes** (entête filename + direction du mirror dans la docstring)
- **8 exports** stables des deux côtés ; ajouter un nouveau message type passe par les sub-files (qui SONT byte-checkés), pas par le barrel
- TSC capture les drifts réels (import d'un type inexistant → compile fail)

**Raison du DROP** :
- Étendre le check aux barrels = normalize plus complexe (gérer diff entête + docstring) OU byte-check à 2 lignes près → fragile
- Une spec TS introspection "barrel front re-exports same names as back" = ~30-50 LOC pour fermer un risque déjà capturé par TSC
- La doctrine "mirror structure" est déjà documentée dans les barrels eux-mêmes (l.7-10 commentaire en-tête)

→ Risque faible, fix coûteux, drop.

---

#### U20 — `handleMessage` switch ~35 cases avec slot-routing + side-effects mixés → **KEEP**

**Statut** : KEEP (2026-06-01) — routing table + méthodes privées
**Sévérité** : MEDIUM
**Source** : PvP normal

**Investigation** :

- 77 cases dans le switch [duel-connection.ts:971](front/src/app/pages/pvp/duel-page/duel-connection.ts#L971) (incluant fall-throughs SELECT_*), ~30 cases distincts
- Chaque case mélange : slot-routing (single/both/forPlayer), processor delegation, signal mutations, side-effects (timers, prefetch, logs)
- Context-comments 3-15 LOC par case avant la logic effective → coût de lecture élevé
- Pas de bug systémique attribué au switch (les fixes récents sont par-case : F14, F23, F-bugB3, A39-bis, etc.)

**Différence vs C2/R2 (DuelConnection split 3-way, refusé)** :

| Aspect | C2/R2 (refusé) | U20 (proposé) |
|---|---|---|
| Approche | Extraire `MessageDispatcher` class | Routing table + méthodes privées |
| Risque | MEDIUM-HIGH | LOW-MEDIUM |
| Coût | 3-5j | 1-2j |
| Compat γ-c R8 | Interdite (extraction `_slots`) | Compatible (méthodes privées partagent `this`) |
| Bénéfice testabilité | Indirect (MessageDispatcher unit-testable) | Indirect (méthodes privées peuvent être exposées si besoin) |

**Cleanup proposé** :

```ts
private readonly _messageHandlers: Record<string, (msg: any) => void> = {
  'BOARD_STATE':       (m) => this._handleBoardState(m),
  'STATE_SYNC':        (m) => this._handleStateSync(m),
  'CHAIN_STATE':       (m) => this._handleChainState(m),
  'SELECT_CARD':       (m) => this._handleSelectModal(m),
  'SELECT_CHAIN':      (m) => this._handleSelectModal(m), // regrouping fall-throughs
  // ...
  'DICE_ROLL':         (m) => this._handleDiceRoll(m),
  'MSG_HINT':          (m) => this._handleMsgHint(m),
  // ...
};

private handleMessage(message: ServerMessage): void {
  const handler = this._messageHandlers[message.type];
  if (handler) handler(message);
  else this.logger?.warn('Unhandled message type:', message.type);
}

private _handleDiceRoll(msg: DiceRollMsg): void {
  // F-bugB context comments restent attachés à la méthode
  this._rematchStarting.set(false);
  // ...
  for (const s of this._slots) s.pendingPrompt.set(msg);
}
```

**Bénéfices** :
- Lisibilité : chaque méthode courte avec son context dédié
- Les context-comments F-bugB / γ-c / etc. restent attached à la méthode au lieu de polluer le switch
- Tests Karma existants restent valides (ils dispatch un event, lisent résultat — pas de changement de contrat)

**Risque** : LOW-MEDIUM. Surtout sur la regroupement des fall-throughs SELECT_* (faut s'assurer que les regroupements préservent le comportement exact).

**Quand le faire** : opportunistically au prochain ajout de case substantielle (le coût marginal est alors faible et la nouvelle case devient propre dès le départ). Pas de chantier dédié immédiat.

**Risque si on jette** : pas de bug, juste un coût de maintenance qui grossit lentement. La fonction continue à accumuler des context-comments à chaque fix par case.

---

#### U21 — SELECT prompt resend sans whitelist pre-duel → **DROP**

**Statut** : DROP (2026-06-01) — finding réfuté par investigation structurelle
**Sévérité** : MEDIUM (mais faux)
**Source** : PvP normal

**Investigation** :

- `SELECT_TYPES` à [worker-message-router.ts:63-72](duel-server/src/worker-message-router.ts#L63) inclut explicitement DICE_ROLL + SELECT_FIRST_PLAYER avec comment "they ride the same awaiting-response pipeline"
- `isSelectMessage` est utilisé UNIQUEMENT dans `broadcastMessage` (l.289 timers, l.342/359 cache writes)
- **MAIS** : DICE_ROLL et SELECT_FIRST_PLAYER ne passent JAMAIS par `broadcastMessage`
  - Envoyés via `cfg.sendToPlayer(...)` DIRECT dans [first-player-coordinator.ts:126-127](duel-server/src/first-player-coordinator.ts#L126) (DICE_ROLL) et l.216 (SELECT_FIRST_PLAYER)
  - `broadcastMessage` est appelé uniquement depuis `WORKER_MESSAGE` handler (l.111), qui vient de l'OCGCore worker, lequel ne génère pas de pré-duel prompts

**Le `SELECT_TYPES.has(...)` ne fire JAMAIS pour ces 2 types** → les gates `armSelectTimers` (scheduleTimerStart + startInactivityTimer) sont du code mort pour les pré-duel.

**Faux du finding** :
- "happens to be safe by coincidence of phase semantics" → **structurellement** safe par séparation de chemin (first-player-coordinator vs broadcastMessage)
- "split into PRE_DUEL_SELECT_TYPES + IN_GAME_SELECT_TYPES" → split inutile, `isSelectMessage` n'évalue jamais les pré-duel

**Vrai mineur** : le comment l.69-71 ("they ride the same pipeline") est trompeur car en réalité ils sont court-circuités. Mais ne cause pas de confusion pratique.

**Légitimité du cache `lastSentPrompt[p]` partagé** : utilisé à [client-message-router.ts:110](duel-server/src/client-message-router.ts#L110) pour valider qu'un PLAYER_RESPONSE matche le prompt envoyé — pré-duel et in-game obéissent au même contrat (M28). Le mélange est intentionnel et structurel.

→ Drop. Pas de bug, pas de risque, commentaire légèrement misleading mais anodin.

**Action collatérale (2026-06-01)** : commentaire `SELECT_TYPES` à [worker-message-router.ts:69-71](duel-server/src/worker-message-router.ts#L69) mis à jour pour expliquer que DICE_ROLL/SELECT_FIRST_PLAYER ne passent JAMAIS par `broadcastMessage` (court-circuités par first-player-coordinator) — supprime le misleading "they ride the same pipeline".

---

#### U22 — `_innerLoopDepth` + `AbortController` + `_isRunning` triple-guard → **KEEP minimal**

**Statut** : KEEP minimal (2026-06-01) — test C4 manquant, pas de refacto
**Sévérité réelle** : LOW (le finding disait MEDIUM)
**Source** : PvP normal

**Investigation** :

3 guards coexistent dans [queue-runner.ts](front/src/app/pages/pvp/duel-page/queue-runner.ts) :
- [`_isRunning`](front/src/app/pages/pvp/duel-page/queue-runner.ts#L255) — flag macro "loop active"
- [`_innerLoopDepth`](front/src/app/pages/pvp/duel-page/queue-runner.ts#L296) — compteur de re-entry intra-tick
- [`_abort`](front/src/app/pages/pvp/duel-page/queue-runner.ts#L306) (AbortController) — reset boundary

CLAUDE.md F13 ([L1651-1670](CLAUDE.md#L1651)) doctrine **explicite** que les 2 derniers sont **orthogonaux** (scenarios distincts) :
- `AbortController` guard les RESET boundaries (suspended loop bail après requestStop)
- `_innerLoopDepth` guard l'INTRA-TICK parallel re-entry (finalize → setRunning(false) → advanceStep → notifyEnqueue dans le même microtask)

**Faux du finding** :
- "Brittle" → les 3 guards sont orthogonaux, pas redondants
- "Comment apologizes" → le commentaire justifie (35 lignes de doctrine), pas s'excuse

**Vrai du finding** :
- Scenario C4 (`_innerLoopDepth <= 1` assert) **n'est pas pinned par un test** ([queue-runner.spec.ts](front/src/app/pages/pvp/duel-page/queue-runner.spec.ts) : aucune occurrence de "C4" / "innerLoopDepth" / "intra-tick" / "F13")
- Le scenario 1 (AbortController + reset boundary) EST testé ([queue-runner.spec.ts:549](front/src/app/pages/pvp/duel-page/queue-runner.spec.ts#L549) `'a suspended loop bails on resume after requestStop'`)

**Pourquoi pas de refacto** : le commentaire l.291-294 propose une simplification (critical section synchrone end-to-end) mais elle briserait l'invariant l.612-616 (`_isProcessing = false` AVANT `setRunning(false)` pour que `notifyEnqueue` ne soit pas no-op). Non-trivial.

**Cleanup proposé (~30 LOC)** :

```ts
// queue-runner.spec.ts — nouveau describe
describe('intra-tick parallel re-entry (F13 / C4)', () => {
  it('detects parallel inner loop start via finalize→setRunning(false)→re-enqueue', () => {
    // Simulate : queue runs to empty → finalize fires → setRunning(false)
    // callback synchronously trigger advanceStep → notifyEnqueue
    // → entry assert depth <= 1 must trip OR the 2 loops don't overlap
    let triggerReentry: (() => void) | null = null;
    const { runner, ds, handleCalls } = makeRunner({
      onIsRunningChange: (running) => {
        if (!running && triggerReentry) {
          // Sync re-entry from setRunning(false) callback
          triggerReentry();
        }
      },
    });
    triggerReentry = () => {
      ds.setQueue([ev('MSG_MOVE')]);
      runner.notifyEnqueue();
    };
    ds.setQueue([]);
    runner.notifyEnqueue();
    // Assert: handleCalls integrity (no double-dispatch, no negative depth, etc.)
  });
});
```

**Risque si on jette** : le scenario C4 reste invisible jusqu'à ce qu'une future régression supprime un des 3 guards. La doctrine F13 reste review-time only.

---

#### U23 — Per-event `boardStateAfter` payload bloat → **DROP**

**Statut** : DROP (2026-06-01) — doctrine déjà acceptée, redondant avec le finding original
**Sévérité** : MEDIUM (mais le finding lui-même propose "acceptable today")
**Source** : PvP normal

**Investigation** :

- `ChainSnapshotTracker.process()` ([chain-snapshot-tracker.ts:31-40](duel-server/src/chain-snapshot-tracker.ts#L31)) attache `boardStateAfter: BoardStatePayload` à chaque event BOARD_CHANGING pendant `chainResolving`
- Estimation : ~2-5 KB par snapshot × 10 events/chain × 5 chains/duel = ~100-250 KB raw → 50-150 KB gzipped
- [CLAUDE.md:1425-1426](CLAUDE.md#L1425) doctrine **explicite** : *"Payload growth is ~50-150 KB gzipped per duel (snapshots are highly redundant)"*
- Replay batches limités à `MAX_BATCH_BYTES = 512 KB` ([replay-precompute.ts:215](duel-server/src/replay-precompute.ts#L215)) → 1 turn tient largement dans 1 batch
- PvP streaming : invisible (les snapshots étalés sur la durée du duel)

**Raison du DROP** :
- Le finding lui-même propose "deep" + reconnaît "Acceptable today" + suggère "backlog item for future bandwidth chantiers"
- Doctrine déjà en place
- Pattern identique à F10/C5 (deferred par doctrine, à ressortir au prochain chantier bandwidth)

→ Aucune action utile au-delà de la doctrine existante.

---

#### U24 — Inactivity timer self-forfeit en SOLO sans UX dédiée → **KEEP + bonus**

**Statut** : KEEP + bonus (2026-06-01) — adapter le message d'expiration ET le dialogue warning
**Sévérité réelle** : LOW (le finding disait MEDIUM)
**Source** : SOLO multiplex

**Investigation** :

- Doctrine [CLAUDE.md:380-387](CLAUDE.md#L380) accepte le paradoxe : *"the 'you forfeit yourself' paradox is accepted in exchange for the resource-leak protection. SOLO players who walk away from an active prompt for >5min will see 'duel ended by inactivity'"*
- `InactivityWarningDialog` ([inactivity-warning-dialog.component.ts](front/src/app/pages/pvp/duel-page/inactivity-warning-dialog.component.ts)) : texte générique `'duel.inactivity.warning'` = "You will forfeit due to inactivity if you don't respond." — pas adapté SOLO
- Le dialogue s'ouvre sur `INACTIVITY_WARNING` (sans branche soloMode) à [duel-prompt-effects.service.ts:53](front/src/app/pages/pvp/duel-page/duel-prompt-effects.service.ts#L53)
- DUEL_END inactivity → `mapDuelEndReason` ([duel-page.component.ts:1180](front/src/app/pages/pvp/duel-page/duel-page.component.ts#L1180)) retourne `duel.endReason.inactivity.{winner|loser}` selon `isWinner = result.winner === ownPlayerIndex()` — en SOLO, dépend de la perspective courante, message ambigu
- i18n actuel : `inactivity.winner: "L'adversaire était inactif"` / `inactivity.loser: "Vous étiez inactif"` — en SOLO le user est les 2

**Cleanup proposé (~15 LOC)** :

```ts
// duel-page.component.ts mapDuelEndReason — branche SOLO
private mapDuelEndReason(result, isWinner: boolean): string {
  if (result.reason === 'inactivity' && this.duelCtx.isSoloMode?.()) {
    return this.translate.instant('duel.endReason.inactivity_solo');
  }
  // ... existing logic
}
```

```json
// i18n/fr.json + en.json
"endReason": {
  "inactivity": { /* existing */ },
  "inactivity_solo": "Session expirée (pas d'activité pendant 5 minutes — protection serveur)"
}
"inactivity": {
  "title": "Êtes-vous toujours là ?",
  "warning": "Vous perdrez par inactivité si vous ne répondez pas.",
  "warningSolo": "Cette session expirera dans 1 minute si vous ne confirmez pas.",
  "confirm": "Je suis là"
}
```

**Bonus** : `InactivityWarningDialogComponent` lit `duelCtx.isSoloMode()` et switch le i18n key `inactivity.warning` ↔ `inactivity.warningSolo` au render.

**Risque si on jette** : aucun bug runtime. UX confusion légère pour les users qui laissent un duel SOLO ouvert >5 min — le message générique "L'adversaire était inactif" est techniquement faux puisqu'il n'y a pas d'adversaire.

---

#### U25 — Turn timer skip dispersé sur 6 sites → **KEEP**

**Statut** : KEEP (2026-06-01) — prédicate + commentaire global
**Sévérité réelle** : LOW (le finding disait MEDIUM, TS strictNullChecks gère déjà la safety)
**Source** : SOLO multiplex

**Investigation** :

- 1 init guard à [worker-message-router.ts:102](duel-server/src/worker-message-router.ts#L102) `if (!session.soloMode) { session.timerContext = {...} }`
- 5 early-returns `if (!ctx) return` dans [timer-management.ts](duel-server/src/timer-management.ts) :
  - `sendTimerStateToAll` (l.66)
  - `sendTimerStateToPlayer`
  - `startTurnTimer` (l.94)
  - `pauseTurnTimer`
  - `scheduleTimerStart`
- `TimerContext | null` type ([types.ts](duel-server/src/types.ts)) → TS `strictNullChecks` force le guard
- **0 cas réel** de dérefencement `ctx!.foo` dans le code prod

**Vrai du finding** :
- Doctrine "no turn timer in SOLO" dispersée sur 6 sites
- Les 5 early-returns dans `timer-management.ts` n'ont **pas de comment** liant à SOLO/F5-bis
- Le commentaire init guard (l.95-101) est long (7 lignes) pour 1 ligne de logique → signal que la décision mérite un nom

**Faux du finding** :
- "Crashes at SOLO runtime only" → TS strictNullChecks force le check, aucun deref non-guard aujourd'hui
- "Future patch becomes dangerous" → le compileur enforce la signature `TimerContext | null`

**Pourquoi `shouldRunTurnTimer` n'est PAS sur-engineering (réévalué)** :
1. Centralise une règle qui scalera mal si un 4e mode arrive (tutorial/practice/hardcore-pvp)
2. Force la décision à être nommée une fois au lieu d'être dispersée dans 7 lignes de commentaire à l'init guard
3. Ouvre la porte à un test direct (`shouldRunTurnTimer({soloMode: true})` → `false`) au lieu d'un test indirect via WORKER_DUEL_CREATED

**Cleanup proposé (~20 LOC)** :

```ts
// duel-server/src/timer-management.ts — en tête du fichier
/**
 * **Null-guarded by design** — every function in this module early-returns
 * when `session.timerContext === null`. SOLO multiplex and fork-solo sessions
 * skip turn-timer allocation entirely (see `shouldRunTurnTimer` below +
 * CLAUDE.md F5-bis). The `if (!ctx) return` pattern is load-bearing, not
 * defensive. TS `strictNullChecks` enforces the guard at compile time
 * (`session.timerContext` is `TimerContext | null`).
 */

/**
 * F5-bis (2026-05-31) — turn timer is meaningless against oneself.
 * SOLO multiplex and fork-solo (forkMode implies soloMode) skip timer init.
 * Inactivity timer is independent (handled separately, see startInactivityTimer).
 */
export function shouldRunTurnTimer(session: ActiveDuelSession): boolean {
  return !session.soloMode;
}
```

```ts
// worker-message-router.ts:102 — devient
if (shouldRunTurnTimer(session)) {
  session.timerContext = { /* ... */ };
}
```

```ts
// timer-management.spec.ts — pin la règle
describe('shouldRunTurnTimer', () => {
  it('returns true for PvP normal', () => {
    expect(shouldRunTurnTimer({ soloMode: false } as any)).toBe(true);
  });
  it('returns false for SOLO multiplex', () => {
    expect(shouldRunTurnTimer({ soloMode: true, forkMode: false } as any)).toBe(false);
  });
  it('returns false for fork-solo (implies soloMode)', () => {
    expect(shouldRunTurnTimer({ soloMode: true, forkMode: true } as any)).toBe(false);
  });
});
```

**Risque si on jette** : aucun runtime, aucun compile-time. Un nouveau dev qui lit `if (!ctx) return` peut penser "défensif, à virer" → introduit NPE SOLO. Le commentaire global + la prédicate nommée évitent cette confusion.

---

#### U26 — `_shouldSwapForSolo` assert coupling → **DROP**

**Statut** : DROP (2026-06-01) — risque inexistant en pratique
**Sévérité** : MEDIUM (mais faux risque)
**Source** : SOLO multiplex

**Investigation** :

- `_shouldSwapForSolo` ([duel-connection.ts:600-609](front/src/app/pages/pvp/duel-page/duel-connection.ts#L600)) `duelAssert(ctx !== undefined, ...)` fire si `soloMode=true` mais `_duelCtx === undefined`
- Contrat maintenu par **2 call-sites uniquement** :
  - [duel-web-socket.service.ts:90-93](front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts#L90) — default conn PvP normal passe `duelCtx` quand même (BH-3 parity)
  - [solo-duel-orchestrator.service.ts:159-162](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L159) — SOLO bootstrap passe `duelCtx`
- Tests existants passent par `SoloDuelOrchestratorService` qui wire correctement les deux

**Raison du DROP** :
- L'assert ne fire JAMAIS en prod (2 call-sites garantissent l'invariant)
- En test, l'assert fire bruyamment si quelqu'un casse l'invariant — c'est exactement le rôle de `duelAssert`
- Le type-restructure proposé (discriminated union DuelConnectionOptions) forcerait tous les tests à updater pour un risque qui ne se matérialise pas

→ Garde-fous existants suffisants. Pas de dette réelle.

---

#### U27 — `PSEUDO_PAIRWISE_SOLO_ROUTED` whitelist sur 4 touchpoints → **KEEP minimal**

**Statut** : KEEP minimal (2026-06-01) — commentaire-anchor central
**Sévérité** : MEDIUM
**Source** : SOLO multiplex

**Investigation** :

4 touchpoints confirmés pour les 4 messages SOLO-aware (`WAITING_RESPONSE`, `INACTIVITY_WARNING`, `ERROR`, `REMATCH_INVITATION`) :

1. **Whitelist** : [lifecycle-helpers.ts:75-80](duel-server/src/lifecycle-helpers.ts#L75) `PSEUDO_PAIRWISE_SOLO_ROUTED` → décide `route-to-0` vs `noop` dans `decideSoloRouting`
2. **Passthrough** : [message-filter.ts:213-223](duel-server/src/message-filter.ts#L213) — passthrough explicite dans le switch sanitize ; sinon `default → DROP + logger.error`. Commentaire l.219-221 reconnaît "Listed defensively"
3. **Broadcast SOLO branch** : [worker-message-router.ts:339-354](duel-server/src/worker-message-router.ts#L339) — single-send omniscient
4. **Receive-side** : [duel-connection.ts:1284-1299](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1284) (INACTIVITY_WARNING) + l.1426-1440 (WAITING_RESPONSE) — `_slots[message.player ?? 0].X.set(...)` + assert F-2.4 sur présence de `player`/`targetPlayer`

**Fail-modes** (tous détectables) :
- Oubli (1) → server drop slot-1 send silently
- Oubli (2) → server omniscient filter logs "Dropped unknown message type"
- Oubli (4) → SOLO viewer perspective=1 misses ; assert F-2.4 fire en dev

**Cleanup proposé (~10 LOC)** :

```ts
// duel-server/src/lifecycle-helpers.ts — au-dessus de PSEUDO_PAIRWISE_SOLO_ROUTED
/**
 * SOLO-AWARE MESSAGE CONTRACT — to add a new message type that routes per-slot in SOLO :
 *   1. Add to `PSEUDO_PAIRWISE_SOLO_ROUTED` below (decideSoloRouting → 'route-to-0')
 *   2. Add passthrough case in `message-filter.ts` sanitizeMessage (else default-drop)
 *   3. If sent via broadcastMessage : ensure the SOLO branch handles it
 *      (worker-message-router.ts:339-354)
 *   4. Front : populate `message.player`/`message.targetPlayer` server-side,
 *      receive in `duel-connection.ts` with `_slots[message.player ?? 0].X.set(...)`
 *      AND a `duelAssert(!soloMode || message.player !== undefined, ...)` (F-2.4)
 *
 * Forgetting any step is detectable but distributed :
 *   - (1) missing → server drops slot-1 send silently
 *   - (2) missing → server omniscient filter logs "Dropped unknown message type"
 *   - (4) missing → SOLO viewer perspective=1 misses ; F-2.4 assert fires in dev
 */
```

**Quand promote à Option 2 (whitelist factorisée, ~30 LOC) ou Option 3 (full SoloMessageContract table, ~80-100 LOC)** : si un 5e message SOLO-aware est ajouté.

**Risque si on jette** : ajout silencieux d'un nouveau message SOLO sans toucher les 4 sites → fail-modes distribués (3 endroits où le bug se manifeste, chacun avec un signal de log/assert distinct).

---

#### U28 — Slot-1 fallback asymétrique — **bug serveur live découvert** → **KEEP (priorité)**

**Statut** : KEEP priorité (2026-06-01) — bug latent identifié pendant l'investigation
**Sévérité réelle** : HIGH (le finding disait MEDIUM ; investigation révèle bug live en PvP normal)
**Source** : SOLO multiplex

**Investigation** :

Le finding original pointe l'asymétrie de l'assert F-2.4 ([duel-connection.ts:1295](front/src/app/pages/pvp/duel-page/duel-connection.ts#L1295) + l.1436) :
- En SOLO : assert fire si `message.player === undefined`
- En PvP normal : `?? 0` fallback silencieux → message land dans `_slots[0]`

**Découverte bonus** : l'investigation a révélé un **bug serveur live** :

```ts
// duel-server/src/timer-management.ts:288-291 — BUG
sendWarning: (p, remainingSec) => {
  const warningMsg: ServerMessage = { type: 'INACTIVITY_WARNING', remainingSec };
  //                                                                  ^^^^^^^^^^^^
  //                                                                  PAS de `player: p` !
  c.sendToPlayer(session, p, warningMsg);
},
```

Contrat protocol A8.1 ([ws-protocol-system.ts:199-207](duel-server/src/ws-protocol-system.ts#L199)) : *"Populated in both modes for consistency; required by SOLO multiplex (A28 routing) to dispatch the warning to the correct perspective slot. PvP normal front ignores the field."*

→ Serveur **viole le contrat** : `player` manquant dans le payload.

**Conséquences live** :
- **SOLO** : `message.player === undefined` → assert F-2.4 fire à chaque INACTIVITY_WARNING (rare en pratique, ~4 min inactivité)
- **PvP normal** : `?? 0` lands le warning dans `_slots[0]` → P1 viewer **rate visuellement** les warnings de son opposant. Dégrade UX pour la moitié des utilisateurs PvP.

**Pourquoi le bug est passé** :
- Aucun test côté serveur ne pin que `INACTIVITY_WARNING` contient `player` ([timer-management.spec.ts](duel-server/src/timer-management.spec.ts) : 0 occurrence)
- [inactivity-timer.spec.ts:24](duel-server/src/inactivity-timer.spec.ts#L24) teste seulement que la callback est appelée avec `p`, pas que le **payload sortant** contient `player: p`
- L'assert F-2.4 (γ-c cleanup) ajouté côté front documente le contrat mais ne le crée pas

**Cleanup proposé (~20 LOC)** :

```ts
// Fix 1 — serveur : populate player
// duel-server/src/timer-management.ts:289
sendWarning: (p, remainingSec) => {
  const warningMsg: ServerMessage = { type: 'INACTIVITY_WARNING', remainingSec, player: p };
  c.sendToPlayer(session, p, warningMsg);
},
```

```ts
// Fix 2 — test pin
// duel-server/src/timer-management.spec.ts — nouveau test
it('inactivity warning callback sends INACTIVITY_WARNING with player field populated (A8.1 contract)', () => {
  const sent: ServerMessage[] = [];
  // setup config with sendToPlayer spy
  // trigger warning via inactivity timer
  expect(sent[0]).toEqual(jasmine.objectContaining({
    type: 'INACTIVITY_WARNING',
    player: 0,
    remainingSec: jasmine.any(Number),
  }));
});
```

**Fix 3 deferred** : promouvoir l'assert F-2.4 au mode PvP (`duelAssert(message.player !== undefined, ...)` sans `!soloMode ||`). À NE PAS faire tant qu'un audit n'a pas vérifié les autres messages similaires (`WAITING_RESPONSE`, etc.) — risque d'asserts en cascade si un autre payload a le même bug.

**Risque si on jette** :
- Bug serveur reste latent
- Tests SOLO peuvent fail aléatoirement
- PvP normal P1 viewer continue à rater les warnings → UX dégradée silencieuse pour ~50 % des duels

---

#### U29 — Double cleanup `conn.cleanup()` (SOLO + wsService.ngOnDestroy) → **KEEP**

**Statut** : KEEP (2026-06-01) — flag + 2 specs
**Sévérité réelle** : LOW (le finding disait MEDIUM)
**Source** : SOLO multiplex

**Investigation** :

Double cleanup confirmé :
- [solo-duel-orchestrator.service.ts:374-378](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L374) `cleanup()` → `conn.cleanup()`
- [duel-web-socket.service.ts:427-433](front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts#L427) `ngOnDestroy()` → `this.active().cleanup()`
- Les deux fire au teardown du duel-page en SOLO

**Idempotence respectée par construction aujourd'hui** ([duel-connection.ts:824-837](front/src/app/pages/pvp/duel-page/duel-connection.ts#L824)) :
- `rbs.assertNoLocks('cleanup')` — locks déjà cleared au 2e call
- `rbs.destroy()` = `commitAll()` (idempotent)
- `clearTimeoutSlot(...)` null-safe
- `if (this.ws) { ws.close(); this.ws = null }` null-safe

**Trou** : **aucun test** ne pin `DuelConnection.cleanup()` idempotence. CLAUDE.md "Transport Lifecycle Invariants → Invariant 1" déclare ça load-bearing sans gate.

**Cleanup proposé (~20 LOC)** :

```ts
// duel-connection.ts:824
private _destroyed = false;

cleanup(): void {
  if (this._destroyed) return;  // ← idempotence structurelle
  this._destroyed = true;
  this.rbs.assertNoLocks('cleanup');
  this.rbs.destroy();
  // ... reste inchangé
}
```

```ts
// duel-connection.spec.ts
describe('DuelConnection.cleanup() — idempotence (Transport Lifecycle Invariant 1)', () => {
  it('calling cleanup() twice does not throw', () => {
    const conn = new DuelConnection('/ws/test', false, 'key');
    expect(() => { conn.cleanup(); conn.cleanup(); }).not.toThrow();
  });

  it('calling cleanup() without prior connect() does not throw', () => {
    const conn = new DuelConnection('/ws/test', false, 'key');
    expect(() => conn.cleanup()).not.toThrow();
  });
});
```

**Pourquoi le flag (Option B+) plutôt que juste la spec (Option A)** : le flag rend l'idempotence **structurelle** (~3 LOC additionnels) — impossible à casser par un futur ajout non null-safe (log Datadog, listener qui throw, etc.). Coût marginal.

**Risque si on jette** : aujourd'hui aucun. Demain, ajout d'une ligne non null-safe dans `cleanup()` → double-cleanup throw → SOLO ou PvP crash silencieusement au teardown.

---

#### U30 — `canSwitchPerspective` non réactif → **DROP + comment**

**Statut** : DROP avec comment ajouté (2026-06-01) — bug théorique non manifestable
**Sévérité** : MEDIUM (mais faux)
**Source** : SOLO multiplex

**Investigation** :

[`canSwitchPerspective`](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L237) (getter) lit :
- `pendingPrompt()` ✅ signal réactif
- `hasDrawsInFlight` ❌ getter sur Set (non-signal)
- `isBoardStableForSwitch` ✅ (composé de chainPhase + isAnimating signals)

Consommé en template via `[disabled]="!orchestrator.canSwitchPerspective"` ([duel-page.component.html:360](front/src/app/pages/pvp/duel-page/duel-page.component.html#L360)).

**Avec OnPush** : le binding ne se re-évalue que si un signal lu par le template change. `hasDrawsInFlight` (non-signal) ne déclenche pas de change detection.

**Mais l'invariant runner couvre le cas** :
- [queue-runner.ts:175](front/src/app/pages/pvp/duel-page/queue-runner.ts#L175) `decideNextStep` : `if (input.isWaitingForOverlay || input.hasDrawsInFlight)` → return wait (pas finalize)
- [queue-runner.ts:468](front/src/app/pages/pvp/duel-page/queue-runner.ts#L468) rescue path : même early-return
- → tant que `hasDrawsInFlight === true`, le runner reste `_isRunning = true` → `isAnimating === true` → `isBoardStableForSwitch === false`

Donc le binding `[disabled]` se re-évalue correctement via `isAnimating` (signal réactif) **même si** `hasDrawsInFlight` est non-signal.

**Comment ajouté à [solo-duel-orchestrator.service.ts:237](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L237)** (~12 LOC) documentant :
- L'invariant runner (queue-runner.ts:175 + :468)
- Le fait que `hasDrawsInFlight` check est defense-in-depth, pas load-bearing
- Quand promouvoir à signal (si l'invariant runner change)

→ Pas d'autre action. Le finding cherche un bug qui n'existe pas en pratique.

---

#### U31 — `bindSoloConnection` sinks partial → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité** : MEDIUM
**Source** : SOLO multiplex

**Investigation** :

4 familles de sinks aujourd'hui :
1. `wireConnectionDebugSinks(conn, {artService, debugLog})` (onMessage + onResponse) — wired par 2 callers ([wsService:94](front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts#L94) + [solo orchestrator:174](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L174))
2. `_outOfBandSink` — via `attachOutOfBandSink` API
3. `_drawNewTurnSink` — via `onDrawNewTurn` setter
4. `onStateSync` — via setter

Le commentaire [duel-web-socket.service.ts:153-158](front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts#L153) reconnaît ouvertement la dette : *"Caller contract — conn MUST have its `artService`, `onMessage`, and `onResponse` wired BEFORE this call... we don't keep a registry of them for re-binding."*

**Vérifié** : `DuelCardArtService` est provider de `duel-page.component` → singleton partagé entre wsService et SOLO orchestrator (l'orchestrator pourrait donc déléguer le wiring au wsService sans casser l'injection).

**Risque** : ajout d'un 4e sink à `DuelConnection` → 3 modifications coordonnées (ctor wsService + bindSoloConnection + caller wireXxx) silencieusement nécessaires.

**Cleanup proposé (~30 LOC modifiés)** :

```ts
// duel-web-socket.service.ts — nouveau private method
private applySinks(conn: DuelConnection): void {
  wireConnectionDebugSinks(conn, { artService: this.artService, debugLog: this.debugLog });
  if (this._outOfBandSink) conn.attachOutOfBandSink(this._outOfBandSink);
  if (this._drawNewTurnSink) conn.onDrawNewTurn = this._drawNewTurnSink;
  conn.onStateSync = (msg) => { this.onStateSync?.(msg); };
}

constructor() {
  const defaultConn = new DuelConnection(/* ... */);
  this.applySinks(defaultConn);  // remplace les 2 lignes inline
  this._transport_connection = signal<DuelConnection>(defaultConn);
}

bindSoloConnection(conn: DuelConnection): void {
  const previous = this._transport_connection();
  if (previous !== conn) previous.cleanup();
  this._transport_connection.set(conn);
  this.applySinks(conn);  // remplace les 3 lignes manuelles
}
```

Et **SOLO orchestrator** :
```ts
// solo-duel-orchestrator.service.ts:174 — RETIRER cette ligne
// wireConnectionDebugSinks(conn, { artService: this.artService, debugLog: this.debugLog });
// applySinks dans bindSoloConnection le fait maintenant
```

**Bénéfice** : ajout d'un 5e sink = 1 ligne dans `applySinks`. Plus de coordination cross-files.

**Risque si on jette** : ajout d'un 4e sink silencieusement oublié dans un des 3 endroits. Non-urgent mais latent (probabilité faible mais coût élevé si arrive).

---

#### U32 — server.ts ~600 LOC residual orchestration → **KEEP-LATER**

**Statut** : KEEP-LATER (2026-06-01) — à rediscuter au moment de l'implem pour potentiellement tout faire
**Sévérité** : MEDIUM
**Source** : server-mod

**Investigation** :

[server.ts:1374 LOC](duel-server/src/server.ts) après 10 extractions. Décomposition :

| Section | Lignes | LOC |
|---|---|---|
| Imports | 1-110 | 110 |
| Constants + state global | 123-200 | 80 |
| `configure*` boot wiring | 200-340 | 140 |
| HTTP `handleRequest` | 350-553 | 200 |
| `startRematch` + `rematchExpired` + `startDuelWithOrder` | 554-696 | 140 |
| `sendToPlayer` | 697-736 | 40 |
| `cleanupDuelSession` | 737-834 | 100 |
| `checkProtocolVersion` | 835-855 | 20 |
| Boot invariant + `wss.on('connection')` | 855-1216 | **360** |
| `resendPendingPrompt` + `sendStateSnapshot` | 1217-1309 | 93 |
| `shutdown` + signal handlers | 1310+ | 65 |

**Catégorie identifiable** : tout ce qui touche **BOTH** "WS connection state" AND "session lifecycle" est resté inline. C'est précisément un "connection-orchestrator" — un module qui n'a pas encore été extracted, pas "scraps".

**Cleanup proposé (~3-5j, risque MEDIUM)** :

3 extractions séquentielles :
1. **`ws-write.ts`** (~40 LOC) — `sendToPlayer` + SOLO routing inlined. Le plus petit, le moins couplé → premier candidat.
2. **`pvp-connection-handler.ts`** (~340 LOC) — body du `wss.on('connection')` closure (handshake + reconnect + grace-period + SOLO/PvP dispatch).
3. **`session-orchestrator.ts`** (~300 LOC) — `startRematch` + `startDuelWithOrder` + `cleanupDuelSession` + `sendStateSnapshot`.

Après extraction : `server.ts` shrink à ~300 LOC de boot wiring pur.

**Risque MEDIUM** :
- Boucles de deps potentielles : `session-orchestrator` a besoin de `worker-lifecycle` qui a besoin de `cleanupDuelSession` (= dans `session-orchestrator`)
- Toutes les 3 nouvelles modules à wirer dans le boot invariant
- Tests existants couvrent indirectement via specs des modules amont — pas de refacto de spec massif requise

**Pourquoi KEEP-LATER** :
- Pas de bug attribué au monolithe restant
- Évolution server.ts mesurée (~1 modif/3 mois)
- Pas d'urgence opérationnelle

**Quand promouvoir à KEEP-NOW** :
- Si on ajoute un 4e mode (tournament/practice) → besoin d'un `session-orchestrator` partagé
- Si un bug d'orchestration cross-cutting apparaît (rematch ↔ reconnect race condition)
- Si Axel décide de lancer un chantier server-side dédié

**Stratégie d'implem suggérée si on y va** : commencer par `ws-write.ts` (low coupling), valider l'approche, puis étendre aux 2 autres. NE PAS attaquer les 3 ensemble — risque de boucles de deps invisible.

---

#### U33 — Worker `port.postMessage` non-typé (25 sites) → **KEEP**

**Statut** : KEEP (2026-06-01)
**Sévérité réelle** : LOW (le finding disait MEDIUM, le titre "bypass router" est trompeur)
**Source** : server-mod

**Investigation** :

25 sites `port.postMessage(...)` dans [duel-worker.ts](duel-server/src/duel-worker.ts) — chacun manuellement wrap `{type, duelId, ...payload}`.

**Faux du finding** : "bypass the router" est trompeur. Le routing PASSE par `handleWorkerMessage` ([worker-message-router.ts:87](duel-server/src/worker-message-router.ts#L87)) qui dispatch sur le type. Le vrai problème = **typing côté worker**, pas le routing.

**Vrai du finding** :
- `port.postMessage` côté Node est typé `(value: any) => void` → 0 typecheck sur l'envelope
- Typo dans `'WORKER_MESSAGE'` → `validateWorkerMessage` [default → return null](duel-server/src/validation/worker-message-validation.ts#L81) → drop silencieux
- `duelId` (variable module-local du worker) répété 25 fois — redondance pure

**Cleanup proposé (~50 LOC nouveau, ~1-2h refacto)** :

```ts
// duel-server/src/duel-worker-emit.ts — NEW
import type { ServerMessage } from './ws-protocol.js';
import type { WorkerToMainMessage } from './types.js';

export interface WorkerEmitter {
  message(msg: ServerMessage): void;
  error(error: string): void;
  retry(playerIndex: 0 | 1): void;
  duelCreated(): void;
  cancelDone(playerIndex: 0 | 1): void;
  replayData(payload: /* WorkerReplayPayload */): void;
  forkReady(sanityResult: { match: boolean; details?: string }): void;
  forkError(code: string, message: string): void;
}

export function createWorkerEmitter(
  port: { postMessage: (v: WorkerToMainMessage) => void },
  duelId: string,
): WorkerEmitter {
  return {
    message: (message) => port.postMessage({ type: 'WORKER_MESSAGE', duelId, message }),
    error: (error) => port.postMessage({ type: 'WORKER_ERROR', duelId, error }),
    retry: (playerIndex) => port.postMessage({ type: 'WORKER_RETRY', duelId, playerIndex }),
    duelCreated: () => port.postMessage({ type: 'WORKER_DUEL_CREATED', duelId }),
    cancelDone: (playerIndex) => port.postMessage({ type: 'WORKER_CANCEL_DONE', duelId, playerIndex }),
    replayData: (payload) => port.postMessage({ type: 'WORKER_REPLAY_DATA', duelId, payload }),
    forkReady: (sanityResult) => port.postMessage({ type: 'WORKER_FORK_READY', duelId, sanityResult }),
    forkError: (code, message) => port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code, message }),
  };
}
```

Puis :
```ts
// duel-worker.ts — instancier une fois après duelId est connu
const emit = createWorkerEmitter(port, duelId);

// Remplacer :
//   port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: buildBoardState() });
// Par :
emit.message(buildBoardState());
```

**Bénéfices** :
- Typo dans le type → compile fail (au lieu de drop silencieux)
- `duelId` centralisé (DRY)
- Ajout d'un nouveau `WORKER_*` à l'union → TS flag l'absence d'emitter
- 25 sites simplifiés (1-2 LOC chacun)

**Risque** : LOW. Refacto mécanique. Tests côté main (`worker-message-validation.spec.ts`) restent valides.

**Risque si on jette** : typos silencieux possibles. Ajout futur d'un `WORKER_*` requiert d'updater le worker manuellement sans guidance type.

---

#### U34 — Cross-module hub centré sur worker-lifecycle → **KEEP-LATER**

**Statut** : KEEP-LATER (2026-06-01) — à rediscuter au moment de l'implem en même temps que U32
**Sévérité** : MEDIUM
**Source** : server-mod

**Investigation** :

Graph d'imports cross-modules (au niveau ES) :
- `worker-message-router` imports `timer-management` (4 fns) + `worker-lifecycle` (3 fns) + `replay-persist` (1 fn)
- `client-message-router` imports `timer-management` (4 fns) + `worker-lifecycle` (2 fns) + `first-player-coordinator` (1 fn)
- `fork-handlers` imports `worker-lifecycle` (2 fns)
- `worker-lifecycle` N'importe PAS les routers — reçoit `handleWorkerMessage` via `cfg` (`createConfigurable<T>` injection)

**Pas de cycle ES module** mais **cycle d'invocation runtime** :
- `worker.on('message') → cfg.handleWorkerMessage → broadcastMessage → handleDuelEnd → safeTerminateWorker → ... peut potentiellement re-trigger worker.on('message') au tick suivant`

[worker-lifecycle.ts:112-119](duel-server/src/worker-lifecycle.ts#L112) montre que `worker.on('message')` invoque `cfg.handleWorkerMessage(session, wmsg)` — c'est le pattern late-binding qui évite le cycle TS mais le préserve à runtime.

**Faux du finding** : "if a future refactor tries to express the graph cleanly... cycle becomes obvious and forces a redesign" — spéculatif. `createConfigurable<T>` fonctionne en pratique, pas de bug attribué au cycle.

**Cleanup proposé (deep, ~2-3j)** :

`DuelEndCoordinator` extraction : un nouveau module qui owns la séquence `{handleDuelEnd + requestReplayFromWorker + sendDuelEndMsg + safeTerminateWorker}`. Les 2 routers dépendent du coordinator (pas de `worker-lifecycle`), le coordinator dépend de `worker-lifecycle`, plus de cycle.

→ Casse le cycle runtime, modules plus testables isolément.

**Pourquoi KEEP-LATER + couplage U32** :
- Pas de bug réel, juste dette architecturale
- Même catégorie que U32 (modularisation server-side)
- Logique de grouper dans un chantier server-side dédié

**Quand promouvoir à KEEP-NOW** :
- Migration vers un DI container (`@nestjs/core`, tsyringe) → le cycle deviendrait visible
- Bug d'orchestration cross-cutting (rematch race, DUEL_END leak) → preuve concrète d'une dette architecturale qui mord

À rediscuter en même temps que U32 (extraction `pvp-connection-handler` + `session-orchestrator` + `ws-write`).

---

#### U35 — 31× `configureClientMessageRouter` dans 1 spec → **DROP**

**Statut** : DROP (2026-06-01) — argument central faux + déjà débattu dans R8
**Sévérité** : MEDIUM (mais faux)
**Source** : server-mod

**Investigation** :

- 31 occurrences vérifiées dans [client-message-router.spec.ts](duel-server/src/client-message-router.spec.ts) (le finding disait 33 — proche)
- Pattern : chaque test fait `makeSpy()` + `configureClientMessageRouter(makeConfig(spy))` + `makeSession(spy)` parce que les spies sont locaux au test pour isolation
- `beforeEach` setup `wireUpstreams()` global mais pas `configureClientMessageRouter` (qui dépend du spy frais)

**Faux du finding** :
- "Future parallel run breaks" → faux. Vitest default = `pool: 'forks'` → tests dans des fichiers différents s'exécutent dans des processus séparés (cfg global isolé par fork) ; tests dans le même fichier sont séquentiels.
- "Heavyweight" → 3 lignes/test, coût marginal minime
- L'extraction factory-pattern (`createClientMessageRouter(cfg)` → handlers) est **exactement** la proposition réfutée dans **R8** : *"The pattern is intentional, documented (CLAUDE.md §'Server Module Configuration'), and has an explicit regression fence: server.ts:856-871 runs an isConfigured() boot invariant. The suggested factory refactor would be a stylistic improvement at best, not a load-bearing fix."*

→ Drop. Pas d'action utile au-delà du débat R8 déjà fermé.

---

#### U36 — `broadcastMessage` 'plumbing closures' = abstraction leak → **DROP**

**Statut** : DROP (2026-06-01) — finding ignore le travail déjà fait
**Sévérité** : MEDIUM (mais faux ami)
**Source** : server-mod

**Investigation** :

`sendToPlayer` à [server.ts:697-719](duel-server/src/server.ts#L697) fait 3 concerns :
1. STATE_SYNC decoration (attach `gameLogEntries` per-player) — policy globale
2. SOLO routing decision via `decideSoloRouting` (lifecycle-helpers.ts)
3. Wire send via `safeSend`

5 modules injectent `sendToPlayer` (client-message-router, first-player-coordinator, fork-handlers, timer-management, worker-message-router).

**Faux du finding** :
- **Exemple central faux** : "INACTIVITY_WARNING silently dropped if not in PSEUDO_PAIRWISE_SOLO_ROUTED" → vérifié, INACTIVITY_WARNING **est** dans la whitelist ([lifecycle-helpers.ts:75-80](duel-server/src/lifecycle-helpers.ts#L75)). Pas de drop silencieux.
- **Travail déjà fait ignoré** : `decideSoloRouting` est déjà extracted en **pure function** + unit-tested ([lifecycle-helpers.spec.ts:67-86](duel-server/src/lifecycle-helpers.spec.ts#L67)). Le finding suggère de le faire alors que c'est fait à 50%.

**Vrai du finding** : `sendToPlayer` reste un "fat helper" qui mélange decoration + routing + transport. Mais :
- Le split proposé (`decorate + decideSoloRouting + safeSend` chez chaque consumer) créerait de la **duplication chez 5 consumers**
- La doctrine actuelle (fat helper unique avec policy centralisée) est intentionnelle et **plus DRY** que la décomposition

→ Drop. Aucune action utile.

---

#### U37 — fork-handlers session ctor duplicate → **DROP (absorbé par U15)**

**Statut** : DROP (2026-06-01) — entièrement absorbé par U15
**Sévérité** : MEDIUM
**Source** : server-mod

**Investigation** :

Le finding cite [fork-handlers.ts:72-116](duel-server/src/fork-handlers.ts#L72) vs [server.ts:453-494](duel-server/src/server.ts#L453) — quasi-duplique modulo `soloMode: true / forkMode: true / skipShuffle: true`. Propose factory `createActiveDuelSession({...})`.

C'est **strictement identique** à la proposition U15 (factory `createInitialSessionState(opts)`). Pointeur croisé déjà présent dans U15 ("Ferme : U15 partiel + **U37 entier**").

→ Pas de nouvelle action. U15 KEEP modéré couvre les deux.

---

#### U38 — `WORKER_CANCEL_DONE` 60-LOC handler → **KEEP minimal**

**Statut** : KEEP minimal (2026-06-01) — extraction main-side only
**Sévérité** : MEDIUM
**Source** : server-mod

**Investigation** :

[worker-message-router.ts:155-216](duel-server/src/worker-message-router.ts#L155) — 62 LOC dans 1 case du switch. Fait :
1. Re-broadcast STATE_SYNC + CHAIN_STATE empty + cached IDLECMD prompt
2. Mirror server-side chain state reset (4 fields)
3. Clear `lastSentHint`, `invalidResponseCount`, `cancelTargetPrompt`
4. Re-arm `awaitingResponse` + `lastSentPrompt`
5. Branche `soloMode` pour routing + omniscient filter

Snapshot-at-commit dispersé à [client-message-router.ts:158-166](duel-server/src/client-message-router.ts#L158) (3 lignes).

**Contract centralisé** : [cancel-rollback-contract.md](_bmad-output/planning-artifacts/cancel-rollback-contract.md) (187 LOC doc) + tests dispersés sur 5 fichiers spec.

**Faux du finding** : "1 module = 1 file = 1 spec" → impossible 100% à cause du worker/main split. Au mieux 80% (main-side only). Le worker (`duel-worker.ts:1900`) reste séparé.

**Cleanup proposé (~80 LOC nouveau, ~1j)** :

```ts
// duel-server/src/cancel-rollback-main.ts — NEW
export function snapshotCancelTarget(
  session: ActiveDuelSession, p: 0 | 1, prompt: ServerMessage,
): void {
  session.cancelTargetPrompt[p] = prompt;
  session.invalidResponseCount[p] = 0;
  session.lastSentHint[p] = null;
}

export function applyCancelRollbackBroadcast(
  session: ActiveDuelSession,
  p: 0 | 1,
  send: (s: ActiveDuelSession, dest: 0|1, m: ServerMessage) => void,
): void {
  const cached = session.cancelTargetPrompt[p];
  if (!cached) { logger.warn('CANCEL: no cached prompt'); return; }

  const dest: 0 | 1 = session.soloMode ? 0 : p;
  const omniscient = session.soloMode;

  if (session.lastBoardState?.type === 'BOARD_STATE') {
    const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
    const filtered = filterMessage(stateSync, p, omniscient);
    if (filtered) send(session, dest, filtered);
  }
  send(session, dest, { type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [] });

  session.activeChainLinks = [];
  session.chainPhase = 'idle';
  session.negatedChainIndices.clear();
  session.currentSolvingChainIndex = null;

  session.lastSentPrompt[p] = cached;
  session.awaitingResponse[p] = true;
  send(session, dest, cached);
  session.cancelTargetPrompt[p] = null;
}
```

Puis simplifier les 2 call-sites (`worker-message-router.ts:155` + `client-message-router.ts:158`) en 1 ligne chacun.

**Bénéfices** :
- 2 fonctions nommées + testables isolément (1 spec dédiée `cancel-rollback-main.spec.ts`)
- `worker-message-router.ts` shrink 60 LOC
- Contrat main-side lisible en 1 fichier (le doc `cancel-rollback-contract.md` reste la SoT cross-process)

**Limites** : le côté worker (`duel-worker.ts:1900` qui exec le OCG snapshot rollback) reste séparé.

**Risque si on jette** : pas de bug. Code actuel verbose mais testé. Cleanup d'esthétique pure.

---



| Agent | Strengths | Weaknesses | critical | high | medium | low |
|---|---:|---:|---:|---:|---:|---:|
| PvP normal | 7 | 16 | 0 | 6 | 6 | 4 |
| SOLO multiplex | 6 | 15 | 0 | 2 | 8 | 5 |
| fork-solo | 4 | 8 | 0 | 1 | 3 | 4 |
| Replay | 5 | 13 | 0 | 4 | 4 | 5 |
| Cross-mode duplication | 5 | 15 | 0 | 2 | 5 | 8 |
| EventStream + game-log + projections | 7 | 15 | 0 | 3 | 7 | 5 |
| WS protocol + parity gates | 7 | 15 | 0 | 5 | 5 | 5 |
| server.ts + duel-worker.ts cohesion | 7 | 13 | 0 | 3 | 7 | 3 |
| **Total** | **48** | **110** | | | | |

**Vérification adversariale** : 71 findings (medium+) envoyés au skeptic. 10 confirmés, 23 réfutés, 38 schémas non produits (session limit atteinte pendant la phase verify).

## Méthode

4 phases :

1. **Mode walkthroughs** (4 agents en parallèle) — un agent par mode (PvP / SOLO / fork-solo / Replay) lit le hot path end-to-end et émet des findings structurés sur 6 dimensions : architecture, DRY, KISS, SRP, maintenabilité, robustesse.
2. **Transverse audits** (4 agents en parallèle) — couvre les axes cross-cutting : duplication cross-mode, EventStream/projections, WS protocol + parity gates, server.ts/duel-worker.ts modularité.
3. **Adversarial verification** — chaque finding medium+ envoyé à un skeptic indépendant avec consigne *refute by default*. Vérifie file:line, lit ±50 lignes de contexte, vérifie le git log, cherche la doctrine matching dans CLAUDE.md.
4. **Synthesis** — auto-générée mais échouée (session limit). Synthèse manuelle dans le chat associé.

Schémas JSON utilisés pour structured output → chaque finding cite file:line, principe violé, impact concret, cleanup suggéré.

## Verdicts globaux par agent

### PvP normal

> PvP normal hot path is exceptionally well-instrumented (10 configurable modules, F-numbered audit findings, dual specs pinning client/server chain parity), but the four giant files (duel-worker 1973, animation-orchestrator 1985, duel-connection 1696, server 1374 LOC) carry real SRP debt and the parity invariants (F10 cost-sync, F9 chainPhase, per-slot reset blocks) remain doctrine-as-comment with no automated gate.

### SOLO multiplex

> SOLO multiplex is largely "PvP with structural switches" rather than parallel logic — the γ-c refactor (1 conn / 1 processor / `_slots[2]`) makes the cardinal invariant impossible to regress — but a handful of carve-outs (turn-timer skip pattern, inactivity-timer paradox, pre-duel double-slot writes, mid-chain switch hygiene) remain convention-protected rather than structurally proven, and the file has accumulated heavy historical commentary that obscures live invariants.

### fork-solo

> F5-bis genuinely achieves the SOLO multiplex collapse (3 small inline carve-outs replace ~140 LOC of parallel implementation) and the dual `forkMode` naming is well-isolated by scope, but the 3 fork-specific skips have zero test coverage, the worker-side cancel-rollback path contradicts the F5-bis intent comment, and the type system doesn't enforce the documented `forkMode implies soloMode` invariant.

### Replay

> Replay mode is structurally solid where it counts most (ChainSnapshotTracker, swap helpers, AnimationDataSource interface, worker pool discipline) but its \"PvP parity by construction\" claim holds for only ~5 narrow surfaces; the broader parity is parallel implementations synchronized by review-time discipline, with F10 / F29 / BoundaryProcessor seek being the most load-bearing examples.

### Cross-mode duplication

> The audit confirms several "shared by construction" claims are genuinely shared (ChainSnapshotTracker, board-state-swap, single DuelEventProcessor per session, GAME_EVENT_TYPE_MAP) — but the load-bearing cross-side parity claims (F9 chainPhase, F10 cost-board-sync) are TWO PARALLEL IMPLEMENTATIONS with zero automated gate, by the doctrine's own admission. The 5+ `soloMode` branches and 7 `assertNoLocks` sites are real code smells where a thin abstraction would prevent regression-by-omission as new modes/boundaries arrive.

### EventStream + game-log + projections

> A genuinely well-thought-out subsystem (single push convergence, layered ResetTarget/BaseProjection, pure scope cascade, small BoundaryProcessor) carried by a 1985-LOC orchestrator that accreted 6 ceremonies per projection — making the abstractions clean in theory but expensive in practice, with multiple documentation-only carve-outs (F15 doctrine, silentReset-vs-applyReset, sync-vs-wall-clock animation events) that survive only on reviewer discipline.

### WS protocol + parity gates

> The WS protocol surface is well-structured (6 logical sub-files + barrels) with a working byte-sync mechanism and proper 4426 handling across all three client services — but the broader invariant enforcement listed in CLAUDE.md is overwhelmingly review-time discipline rather than gated checks (Animation Parity Rule, F9 cross-side, F10 cost-sync, F19 lock-asserts, F6 perspective routing all rely on conventions), and the byte-sync script itself has three documented bypass paths (no CI, no front prebuild, --no-verify).

### server.ts + duel-worker.ts cohesion

> The createConfigurable pattern delivers real benefits (boot invariant, unit-testable modules, explicit dependency declarations) but encodes the DI graph as 10 global singletons gated by runtime null checks rather than as a typed dependency tree — a future migration to a factory-based createWorkerMessageRouter({...}) pattern is the natural next step. server.ts retains ~600 LOC of legitimately cross-cutting orchestration (connection handling + session lifecycle) that deserves further extraction; duel-worker.ts at 1973 LOC is genuinely one coherent OCGCore-driver responsibility and should NOT be split. The real smells are broadcastMessage (god-function with 7 sequential policies), ActiveDuelSession (35-field mutable bag with no encapsulation, duplicated by fork-handlers + rematch reset), and the worker-lifecycle ↔ worker-message-router runtime cycle hidden by late binding.

---

## Findings confirmés (10)

Ces findings ont survécu à la vérification adversariale. Le skeptic a refusé de les réfuter parce que :
- l'evidence file:line tient,
- aucune doctrine existante ne mitige déjà,
- ou un bug est actuellement live dans le code.

### C1. [HIGH] Byte-sync script has 3 documented bypass paths — no CI safety net

- **Source** : WS protocol + parity gates
- **Principe violé** : Defense-in-depth / robustness
- **Confidence** : medium

**Evidence** :

> scripts/hooks/pre-commit:18-19 documents '--no-verify' bypass. duel-server/package.json:10 (prebuild) only fires when duel-server is rebuilt. front/package.json has no prebuild check (`ng build` line 7 doesn't call it). No `.github/workflows`, no `.circleci`. setup-hooks.sh requires manual `git config core.hooksPath` post-clone (developer must remember).

**Impact** :

> A dev who: (a) clones without running setup-hooks.sh, (b) only edits a front `duel-ws-*.types.ts` file, (c) runs `npm run build` in `front/` only — has ZERO gates between their change and a production divergence. The next duel-server rebuild surfaces it days later. Probability is real because front-only changes are common (signal additions, JSDoc edits).

**Cleanup suggéré** :

> Add `node ../scripts/check-ws-protocol-sync.mjs` to front/package.json's `prebuild` script (mirror duel-server). Even better: introduce a minimal GitHub Actions workflow that runs the check on every PR — the script is ~50ms, the dependency is just `node` already used for ng build.

**Affinement du skeptic** :

> Finding's CORE concern (no CI safety net) is real — confirmed no `.github/workflows`, `.circleci`, or `.gitlab-ci.yml`. But the cited evidence is partially STALE: since F7 (commit `5cf328fa`, 2026-05-31), `scripts/hooks/pre-commit:24-39` DOES run `check-ws-protocol-sync.mjs` on staged front protocol files (pattern at line 30 explicitly matches `duel-ws-*.types.ts`, front `game-log/*`, and `ocgcore-reason-flags.ts` mirrors). So the "front-only edit → zero gates" scenario in the Impact section is wrong: the hook gates it, IF the dev ran `setup-hooks.sh`. The real residual gap is the manual hook activation + `--no-verify` bypass with no CI fallback. Suggested cleanup REFINEMENT: adding `prebuild` to `front/package.json` is weak (devs rarely run `npm run build` before push; they run `ng test`/`ng serve`). The right defense-in-depth is a minimal GitHub Actions workflow running `node scripts/check-ws-protocol-sync.mjs` (+`check-perspective-isolation.mjs`, already paired in duel-server prebuild line 10) on every PR — catches both un-installed hooks AND `--no-verify` bypasses. Optionally also wire into `front/package.json`'s `pretest` (runs more often than prebuild).

---

### C2. [HIGH] F9 chainPhase cross-side parity has zero cross-check — only per-side pins

- **Source** : WS protocol + parity gates
- **Principe violé** : DRY / robustness
- **Confidence** : high

**Evidence** :

> chain-state-tracker.spec.ts pins server transitions; duel-event-processor.spec.ts pins client transitions. There is NO test that runs `applyChainTransition` and `_processMessageInner + applyChainSolving + applyChainEnd` on the same message sequence and asserts the resulting (phase, activeLinks, negated) tuples agree. The 5-row transition matrix in CLAUDE.md is a markdown contract, not a runtime gate.

**Impact** :

> If someone edits chain-state-tracker.ts (e.g. adds a 'pending' sub-phase as CLAUDE.md hypothesizes) and updates the server spec but forgets the client mirror, the CHAIN_STATE reconnect payload deserializes into a state the client can't handle. Detected only at runtime, only on a real reconnect mid-chain. The matrix in CLAUDE.md depends on humans reading both files at edit time.

**Cleanup suggéré** :

> Add a 'parity' spec that imports both `applyChainTransition` from duel-server (via relative path) and the client processor, feeds an identical message sequence through both, and asserts the tuples (phase, activeLinks.length, negatedIndices, currentSolvingChainIndex) agree at every step. The duel-server's vitest already imports front files via relative path elsewhere (ws-protocol-shared.spec.ts:34) — same pattern applies.

**Affinement du skeptic** :

> The gap is real and explicitly self-documented in CLAUDE.md:305-306 ("currently NO automated gate; review-time discipline is the protection"). Grep confirms `applyChainTransition` is referenced only inside duel-server (server + spec) and never imported/asserted against by any client spec or vice versa. The doctrine block at `duel-event-processor.ts:46-55` calls out the F9 invariant verbally but routes enforcement back to CLAUDE.md.

Refinement on the suggested cleanup: directly importing the client `DuelEventProcessor` from a duel-server vitest is harder than the `ws-protocol-shared.spec.ts` precedent suggests — the processor depends on Angular `signal()` and uses `.js` extensions vs `.types` mirror. Two cleaner alternatives:
1. **Front-side parity spec** (preferred) — add a spec in `front/src/app/pages/pvp/duel-page/chain-phase-parity.spec.ts` that imports `applyChainTransition` from duel-server via relative path (same pattern as `ws-protocol-shared.spec.ts` but reversed direction), feeds an identical CHAIN_* sequence through both `applyChainTransition(serverState, msg)` and `processor._processMessageInner(msg)` + the queue-runner-driven `applyChainSolving`/`applyChainEnd`, and asserts tuple equality at every step.
2. **Extract pure transition fn** — pull the pure (phase, links, negated, currentSolvingChainIndex) reducer out of `DuelEventProcessor` into a shared module both sides import. Eliminates duplication entirely (true DRY fix) rather than just testing it.

Option 2 is the load-bearing fix; option 1 is the quick gate.

---

### C3. [HIGH] Orchestrator (1985 LOC) is the central god-class — adding a projection touches 6 ceremonies

- **Source** : EventStream + game-log + projections
- **Principe violé** : SRP / OCP / Miller's Law
- **Confidence** : high

**Evidence** :

> animation-orchestrator.service.ts: declare field (line ~355), construct in constructor with deps (line ~366), register w/ dispatcher (line ~626), attachEventStream (line ~627), detachEventStream in destroy (line ~929), document in CLAUDE.md projections table. Plus optional manager-side wiring + spec file + index.ts re-export.

**Impact** :

> Adding an 8th projection means a developer must edit 4 files (.projection.ts, index.ts, animation-orchestrator.service.ts ×3 sites, optional manager). Each site is silently load-bearing; missing the `detachEventStream` is an effect-leak; missing the `register` makes `applyReset` silently no-op. Reviewers cannot tell at a glance whether all 6 are wired. Subsystem hostility scales linearly with N.

**Cleanup suggéré** :

> deep — Extract `ProjectionRegistry` that owns the `register + attachEventStream + detachEventStream` triad behind one `mount(projection)` / `unmount(projection)` call. Or introduce a single `registerProjections([...])` helper that closes the asymmetry. Move the `target-zone-keys.detachEventStream()` omission into a smoke spec that walks all `BaseProjection` fields via reflection.

**Affinement du skeptic** :

> Finding is corroborated by a live bug already in the tree: `targetedZoneKeys.attachEventStream` is called at animation-orchestrator.service.ts:660 but the matching `detachEventStream()` is absent from `destroy()` (lines 924-933 detach the other 6 projections but skip this one). The orchestrator's own comment at L925-927 ("explicit detach avoids relying on injector lifetime for a hard reset path") makes the explicit teardown load-bearing — the omission is exactly the silent-asymmetry failure mode the finding predicts. Suggested cleanup is correct; refine to: (1) prefer a `mount(projection)`/`unmount(projection)` helper on the orchestrator (or a `ProjectionRegistry` injectable) so register+attach+detach are atomic by construction; (2) ALSO add the reflection-walking smoke spec proposed (iterate own-properties for `instanceof BaseProjection` and assert each appears in the destroy list) — belt + braces, because a `mount`/`unmount` refactor doesn't retroactively cover a future field someone forgets to route through it. The missing `targetedZoneKeys.detachEventStream()` should be added as a hot-fix even if the deeper refactor lands later.

---

### C4. [HIGH] Perspective Convention (F6) has zero static enforcement — only documented routing

- **Source** : WS protocol + parity gates
- **Principe violé** : Robustness / DRY
- **Confidence** : high

**Evidence** :

> CLAUDE.md 'Perspective Convention': 'Enforcement: there is currently no automated lint rule that flags new ${zoneId}-${X} builders where X is not provably relative. The gate is review-time discipline + this checklist.' Grep confirms ~40 call sites across orchestrator/managers/components. The 'inline idiom kept' list (prompt-derivation, board-container 'is mine' tests) requires per-site judgment.

**Impact** :

> The most common perspective bug class in PvP (`linkedZoneMap controller absolu`, EMZ resolver, etc. cited in `perspective-bug-hunt-2026-05-20` memory) keeps recurring because new code can re-introduce the inline `=== ownIdx ? 0 : 1` idiom without any signal. Each occurrence wastes hours to surface via Playwright debug captures. F6 ROUTED the existing sites through ctx.relativePlayer but didn't ban the bare idiom.

**Cleanup suggéré** :

> Add an ESLint rule that warns on a template literal containing `${...}-${...}` where the trailing expression is NOT a call to `relativePlayer` or a parameter explicitly typed `0 | 1`. Lots of false positives initially → start with a per-file enable list + baseline like skytrix-pipeline. Even a `// skytrix-perspective-ok` comment opt-out is better than today's zero signal.

**Affinement du skeptic** :

> Finding holds — CLAUDE.md:1003-1007 self-documents zero enforcement, and the perspective-bug-hunt-2026-05-20 memory confirms 3 real production bugs from this exact class (EMZ resolver, linkedZoneMap controller absolu, boardStateAfter per-event). F6 (eb29a330, 2026-05-31) only routed existing sites — bare idiom remains legal in new code. Precedent for the per-file-baseline ESLint plugin exists (`pipeline-signal-tagged`, 4 commits of hardening). However, the suggested cleanup pattern `${...}-${...}` is too broad (17 files match it, many for unrelated key formats like `${location}-${player}-${sequence}` which is intentionally absolute per CLAUDE.md rule 3). A better rule: target only template literals whose static prefix segment matches a known ZONE_ID enum value (MZONE/SZONE/HAND/GY/DECK/EXTRA/BANISH/FIELD/EMZ). This sharpens the predicate, matches the actual zone-key DOM-registry surface (`getZoneElement(zoneKey)`), and avoids flagging absolute-by-design composite keys like `confirmedCardKeys`. The escape-hatch suggestion (`// skytrix-perspective-ok`) is sound.

---

### C5. [MEDIUM] Asymmetric detach: `targetedZoneKeys.detachEventStream` missing from `destroy()`

- **Source** : EventStream + game-log + projections
- **Principe violé** : symmetry / robustness / DRY
- **Confidence** : high

**Evidence** :

> animation-orchestrator.service.ts:659-660 registers + attaches `targetedZoneKeys`. The destroy block 928-933 detaches `overlayShowReady`, `counterPulse`, `animatingZone`, `isAnimating`, `swapGraveDeckKeys`, `lpTracker.animatingLpPlayerProjection` but NOT `targetedZoneKeys`.

**Impact** :

> Latent effect leak on hard teardown (rematch, navigation away). Angular's component-scoped `DestroyRef` masks it in production today, but the orchestrator's own docblock (lines 924-927) says explicit detach is defense-in-depth. The asymmetry directly confirms the previous finding: 7 projections × 6 ceremonies => 42 sites, and one slipped.

**Cleanup suggéré** :

> Add `this.targetedZoneKeys.detachEventStream()` to destroy(), then refactor into a `_projections: BaseProjection<unknown>[]` array iterated in both `attach` and `destroy` to make this asymmetry impossible.

**Affinement du skeptic** :

> Verified at front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts:659-660 (register+attach of targetedZoneKeys) vs lines 928-933 (only 6 of 7 projections detached). The docblock at 924-927 explicitly frames detachEventStream() as defense-in-depth beyond DestroyRef, and the destroy() docblock at 895-902 itself warns about asymmetric pairs. TargetedZoneKeysProjection extends BaseProjection and inherits detachEventStream() — the call is valid. Minimal fix: add `this.targetedZoneKeys.detachEventStream();` after line 933. Suggested array-iteration refactor is reasonable but unnecessary scope; the symmetry intent is already documented for the dispatcher (which registers all 7 via scopeDispatcher.register + dispatcher auto-fan-out covers reset). A lighter alternative: introduce a private `_streamProjections: BaseProjection<unknown>[]` list populated next to the existing register/attach block, then `for (const p of this._streamProjections) p.detachEventStream();` in destroy() — keeps the explicit attach calls visible (each carries a distinct β.3 Lot doc comment).

---

### C6. [MEDIUM] F19 lock-assert sites — adding an 8th would not be 'obvious' (no manifest, no test)

- **Source** : WS protocol + parity gates
- **Principe violé** : Miller's Law / robustness (7 sites at the limit; doc is the only manifest)
- **Confidence** : medium

**Evidence** :

> 7 prod call sites enumerated in CLAUDE.md, verified by grep: animation-orchestrator.service.ts:996, duel-connection.ts:825/1393/1649, replay-duel-adapter.ts:154/191/246. There is no central registry of expected sites, no spec that iterates expected sites, and the assert sites list lives ONLY in CLAUDE.md. 'Intentionally NOT asserted' sites (collapseRemainingSteps, abort, jumpToState) are documented in markdown, not code comments at those exact sites.

**Impact** :

> A new transition boundary added in 6 months (e.g., a new STATE_SYNC variant) is silently NOT asserted. Reviewer reads new code, sees no `assertNoLocks`, doesn't know the convention because they didn't read CLAUDE.md F19. The 7-vs-8 question becomes archaeology.

**Cleanup suggéré** :

> Add a one-liner comment at each of the 'intentionally NOT asserted' sites (`collapseRemainingSteps`, `abort`, `jumpToState`) explaining WHY (e.g. `// no assertNoLocks: skip-to-end interrupts mid-dispatch intentionally`). Then add a CLAUDE.md table that's actually generatable: a spec that reads all `assertNoLocks(` call sites and pins the SET against an expected ARRAY in the spec. Drift between site list and expected set → red.

**Affinement du skeptic** :

> Verified: 7 prod sites match the CLAUDE.md F19 list exactly (animation-orchestrator.service.ts:996, duel-connection.ts:825/1393/1649, replay-duel-adapter.ts:154/191/246). The 3 'intentionally NOT asserted' sites (replay-duel-adapter.ts collapseRemainingSteps:312, abort:355, jumpToState:363) have ZERO inline comments. The spec file only covers behavior, not the call-site set. Doctrine lives only in CLAUDE.md markdown. Suggested cleanup is partly correct (inline comments at skip sites — yes) but the 'spec iterating expected sites' part is overkill for 7 slow-moving sites. Better cleanup: (a) inline `// no assertNoLocks: <reason>` at each of the 3 skip sites mirroring the existing 'F19 site N of 3' comment pattern used in queue-runner.ts; (b) a `// F19 anchor — expected callers: …` header at `rbs.assertNoLocks` definition so the canonical list lives in code, not just CLAUDE.md. Inline comments at the call sites are higher-leverage than a CI grep gate because they catch the issue at read-time during review, not post-commit.

---

### C7. [MEDIUM] PVP-REPLAY-DIVERGENCES.md is treated as resolved ("Résolutions" all checked) but the underlying parity gaps are still load-bearing

- **Source** : Replay
- **Principe violé** : Documentation drift / single source of truth (CLAUDE.md, PVP-REPLAY-DIVERGENCES.md, anim-pipeline-v2/README.md, and audit-cohabitation-modes-2026-05-31.md all overlap but disagree on what's open vs closed)
- **Confidence** : medium

**Evidence** :

> PVP-REPLAY-DIVERGENCES.md:109-131 marks items #1-#6 as `[x]` resolved, but the resolutions are: "accepted as residual risk", "PvP-only by nature", "aligns automatically with #1", "inherent to replay nature". Only #1 (lock lifecycle) and #9 (queue collapse) and #10 (buffer replay) have actual code fixes. The doc has not been updated since the F10/F19/F29 additions — it does not list the BoundaryProcessor asymmetry, the F10 mechanism, the perspective swap, or the orchestrator's `resetForReplaySeek` semantics.

**Impact** :

> A new contributor reads PVP-REPLAY-DIVERGENCES.md and concludes parity work is done. They miss F10, F29, the BoundaryProcessor seek asymmetry, the `resetForReplaySeek` rename — all of which are documented elsewhere but not here. The next "why doesn't replay see X" investigation will start from incomplete info.

**Cleanup suggéré** :

> Either fold PVP-REPLAY-DIVERGENCES.md into CLAUDE.md's "Replay Board State Parity Rule" section (single SoT) or refresh it: add a "new divergences" section covering F10, F29, perspective swap, BoundaryProcessor seek, and rebuildUpTo journal wipe. Delete the stale "Résolutions" checklist.

**Affinement du skeptic** :

> The finding's diagnosis is correct (doc last touched 2026-04-21, ee3a4997; ~30 F-series commits since then including F10, F19 expansion, F25, F27 rename are not reflected; no inbound references from CLAUDE.md or code = orphan). But the "checklist is lying" framing is partially off: #2-#6 are flagged as "accepted as residual / by nature / aligns automatically" — those are genuine design closures, not pending work disguised as done, so the [x] marks aren't structurally wrong. The real drift is the MISSING sections (F10 cost sync, F27 rename, F29 perspective swap on event.boardStateAfter, BoundaryProcessor seek closure semantics, resetForReplaySeek scope widening to DUEL_LIFETIME). Per MEMORY.md's "live truth = CLAUDE.md + docs/" doctrine and the steady-state-no-bmad-planning rule, the cleanest fix is NOT "refresh the orphan" but DELETE the file outright — CLAUDE.md's "Replay Board State Parity Rule", "BoundaryProcessor invariants", "Animation Parity Rule", and "Perspective Convention" sections already cover every load-bearing divergence with current information. Adding a second doc to maintain creates exactly the drift problem the finding flags. Severity should be LOW not medium given the doc is unreferenced (a new contributor following CLAUDE.md as documented SoT won't reach it).

---

### C8. [MEDIUM] Worker→main message types are NOT byte-checked, but cross duel-server↔duel-worker process boundary

- **Source** : WS protocol + parity gates
- **Principe violé** : Robustness
- **Confidence** : high

**Evidence** :

> types.ts:162 + 275 define MainToWorkerMessage + WorkerToMainMessage. duel-worker.ts emits these via `port.postMessage`. They cross a worker boundary (different module instance). No check enforces that both sides agree on every union member (e.g., a `WORKER_NEW_THING` added to types.ts but never emitted, or a new message emitted but missing from the union). Internal-only ≠ no parity risk.

**Impact** :

> Lower than wire drift (compile-time TS catches misuse if both files import the same union), but if someone adds a transient INIT-time message in duel-worker.ts:1700-ish without updating types.ts (because `port.postMessage` is untyped on Node's MessagePort), the main thread's `handleWorkerMessage` switch silently lacks a case → message dropped, log spam.

**Cleanup suggéré** :

> Type the `port.postMessage` call site with a helper: `function send<T extends WorkerToMainMessage>(port, msg: T) { port.postMessage(msg) }`. Then every emit is type-checked against the union. Cheap, no runtime cost.

**Affinement du skeptic** :

> Confirmed. Verified evidence: (1) duel-worker.ts:60 holds `port = parentPort` (Node MessagePort, postMessage typed as `value: unknown`); (2) duel-worker.ts:23 imports `MainToWorkerMessage` only — `WorkerToMainMessage` is NOT imported, so the ~30 emit sites (duel-worker.ts:1222, 1265, 1307, 1378, 1382, 1414, 1430, 1575, 1589, 1648, 1692, 1722, 1733, 1743, 1761, 1773, 1805, 1820, 1827, 1835, 1844, 1848, 1860, 1970, 1971 + replay-precompute.ts emits) have zero structural check against the union; (3) worker-message-router.ts:78 `handleWorkerMessage` switch has no `default: const _: never = wmsg.type` exhaustiveness arm (grep confirms no `never`/`exhaustive` in the file); (4) scripts/check-ws-protocol-sync.sh only diffs ws-protocol.ts front↔back, NOT worker types. The suggested cleanup is correct. Refinement: pair it with an exhaustive `default` arm in `handleWorkerMessage` (`default: { const _exhaustive: never = wmsg; throw new Error(...) }`) — that catches the OTHER direction (type added to union but no handler). Two cheap edits, full bidirectional check.

---

### C9. [MEDIUM] `runReplayPreComputation` and `runDuelLoop` re-implement the same overlay capture + chain-tracking + transform loop

- **Source** : cross-mode duplication
- **Principe violé** : DRY — the two loops are ~80% identical in structure; the only real divergence is the emission strategy at the end (live broadcast vs batched state)
- **Confidence** : medium

**Evidence** :

> duel-worker.ts:1289-1382 (PvP: `capturePreProcessOverlays` → `buildSettlingSourceFifo` → `duelProcess` → for-each-message → `updateState` → `transformMessage` → `liveChainTracker.process` → `port.postMessage`) vs replay-precompute.ts:309-435 (Replay: `capturePreProcessOverlays` → `buildSettlingSourceFifo` → `duelProcess` → for-each-message → `updateState` → `transformMessage` → `chainTracker.process` → `flushState/events.push`). Both invoke the same OCG helpers but diverge in emission (port.postMessage vs PreComputedState segmentation).

**Impact** :

> Every fix to one loop (e.g. β.3 cas #12 overlay capture, or the F10 cost-sync logic) must be re-applied to the other manually. The β.3 cas #12 commit history shows comments at both sites referencing each other — confirming the dual-maintenance burden. Risk: a future OCG-related fix is applied to PvP and forgotten in Replay (or vice versa), producing replay desync that only surfaces in long-tail scenarios.

**Cleanup suggéré** :

> MEDIUM-DEEP — extract a `runOcgEventLoop({onMessage, captureSnapshot, ...})` higher-order function in a new `ocg-event-loop.ts`. PvP's `onMessage` posts to the worker port; Replay's `onMessage` updates the `events[]` array + flush-on-MSG_CHAINING. Both share the snapshot tracker, the overlay capture, the FIFO. Effort: 2-3 days. Major win: future OCG quirks are fixed in ONE loop.

**Affinement du skeptic** :

> The duplication is real and acknowledged in CLAUDE.md F10 (line 244-252): "If a future bug surfaces a divergence here, the right fix is probably to hoist the intermediate sync into a shared utility callable from both runDuelLoop and runReplayPreComputation." However, the suggested cleanup (single HOF `runOcgEventLoop({onMessage, captureSnapshot})`) significantly understates the divergence. The "80% identical" framing is wrong: PvP handles RETRY recovery, RPS auto-respond, fork-mode gating, IDLECMD snapshot rollback (P0-3bis), watchdog, live broadcast; Replay handles NEW_PHASE/NEW_TURN flushState, playerResponses[] feeding, DecisionMoment capture with per-prompt BOARD_STATE snapshots, MSG_CHAINING/MSG_CHAIN_END timeline segmentation, turn batching, divergence detection. A 2-callback HOF would not be sufficient — it would need ~8-10 callbacks (onPreEmit/onEmit/onPostEmit/onSelectPrompt/onPhaseChange/onTurnChange/onWin/onRetry), at which point the abstraction obscures rather than clarifies. Better refinement: (1) Defer the full HOF extraction (Axel-validated doctrine: extract on next concrete bug, not preemptively); (2) In the meantime, extract NARROWER shared helpers as they emerge — the shared primitives `capturePreProcessOverlays`, `buildSettlingSourceFifo`, `transformMessage`, `ChainSnapshotTracker`, `filterMessage` are ALREADY shared; the next candidate is the "post-cost board sync" emission per F10 doctrine when it next breaks. Cost: 2-3 days for full HOF is optimistic — realistic estimate is 5-7 days given the divergent prompt/response/win handling. Severity should be LOW not MEDIUM: dual-maintenance burden exists but is structurally visible (CLAUDE.md F10 + cross-reference comments at both sites at duel-worker.ts:1367-1375 and replay-precompute.ts:395-406 explicitly require lock-step updates).

---

### C10. [MEDIUM] fork-solo session is constructed in DUELING phase but skips WORKER_DUEL_CREATED — silent inheritance of timer-init logic

- **Source** : fork-solo
- **Principe violé** : documented contract vs. actual flow
- **Confidence** : medium

**Evidence** :

> fork-handlers.ts:74 sets `phase: 'DUELING'` and line 85 sets `startedAt: Date.now()`. The fork worker (duel-worker.ts:1805) sends `WORKER_FORK_READY`, NOT `WORKER_DUEL_CREATED` — so worker-message-router.ts:83-108 (the WORKER_DUEL_CREATED branch with the `if (!session.soloMode) { session.timerContext = ... }` gate) is never reached for fork. fork-handlers.ts:32-33 documents "No turn timer — inherited from soloMode: true" but the inheritance is via DEAD CODE PATH, not via the gate firing.

**Impact** :

> If a future change adds a side-effect to WORKER_DUEL_CREATED OUTSIDE the `if (!session.soloMode)` gate (e.g. `session.startedAt = Date.now()` re-set, instrumentation hook, log line) — fork-solo would silently miss it. The fork's manual `startedAt: Date.now()` at fork-handlers.ts:85 is already a duplication of the WORKER_DUEL_CREATED handler line 85. Currently harmless but the divergence point is invisible at review time.

**Cleanup suggéré** :

> Either (a) add a comment block on WORKER_DUEL_CREATED in worker-message-router.ts noting "fork-solo skips this entire branch by construction — only INIT_FORK sessions reach the FORK_RESUME → live duel state without ever emitting WORKER_DUEL_CREATED", or (b) emit a synthetic WORKER_DUEL_CREATED from the worker on WORKER_FORK_READY arrival via the canonical handler so all duel-startup side-effects converge. (a) is YAGNI-friendly; (b) is structurally cleaner but bigger.

**Affinement du skeptic** :

> The factual evidence is correct: fork worker emits WORKER_FORK_READY (duel-worker.ts:1805), never WORKER_DUEL_CREATED (only emitted from initDuel at duel-worker.ts:1589). The entire case branch in worker-message-router.ts:83-108 is bypassed for fork; the `if (!session.soloMode)` gate is dead code FOR the fork path. fork-handlers.ts:85 duplicates `startedAt = Date.now()` to compensate. The misleading piece is fork-handlers.ts:32-33's comment which claims "inherited from soloMode" via "WORKER_DUEL_CREATED handler skips timerContext init in SOLO" — this is wrong about the MECHANISM (fork doesn't reach the handler at all). Better cleanup combines both: (1) FIX the fork-handlers.ts:32-33 comment to say "fork bypasses WORKER_DUEL_CREATED entirely; timer init is skipped by construction, not by the soloMode gate. startedAt is set manually at line 85"; (2) ADD a comment block at worker-message-router.ts:83 noting "fork-solo skips this entire branch — INIT_FORK → WORKER_FORK_READY → live session; future additions belong here OR in fork-handlers.ts:createForkSoloSession". Option (b) in the original suggestion (synthetic WORKER_DUEL_CREATED) is structurally cleaner but introduces a second emission point and risks double-init if someone forgets the skip — not recommended. Current impact is LOW (forward-looking divergence risk only); the medium severity is justified only by review-blind-spot risk, not by user-facing bug.

---

## Findings réfutés (23)

Ces findings ont été émis par les agents walkthrough mais le skeptic a fourni une réfutation tenant la route. Gardés ici pour archive — utiles pour éviter de re-creuser ces pistes.

### R1. [HIGH] AnimationStarted SYNC vs AnimationCompleted WALL-CLOCK — semantic split documented but fragile

- **Source** : EventStream + game-log + projections
- **Principe** : KISS / least surprise
- **Confidence du skeptic** : high

**Impact original** : 5 distinct paths emit `Animation*` events: dispatch path, group path, lp directive path, phaseWait path, runner onStepSettled path. A future rule writer authoring a chainTo predicate `{kind:'animation', type:'AnimationCompleted', ref:matchedRef}` needs to know whether the matched event went through the standard dispatch or a directive, because the timing semantics differ. Comments documenting this

**Réfutation du skeptic** :

> The finding inverts the actual contract. The semantic across all 5 cited sites is UNIFORM, not split: `AnimationStarted` always emits sync after dispatch, `AnimationCompleted` always emits at the real wall-clock end of the awaited animation. (1) Dispatch path: emitAnimationStarted (sync, line 1277) + onStepSettled wall-clock (line 538-555). (2) Group directive: emitAnimationStarted (sync, line 1346) + Promise.all wall-clock (line 1366-1371). (3) LP directive: sync + setTimeout matching lpDelta.durationMs (line 1408-1419). All three converge to the same `{kind:'animation', type:'AnimationCompleted', ref}` shape that rules narrow on. The 4th site (`phaseWait`, line 487-500) emits a DIFFERENT event type — `AnimationPhaseCompleted` with explicit `phase` field — rules narrow on `type` so cannot confuse. The 5th site (runner onStepSettled) is the dispatch-path back-end, not a separate path. All 5 existing DEP rules in deferred-effect-rules.ts (`overlayShow`, `triggerShow`, `attackImpact`, `lpCost`, `counterPulse`) use the identical predicate shape — a rule writer never needs to know which path emitted it. CLAUDE.md §"Wall-clock `AnimationCompleted` alignment" (lines 785-800) explicitly documents the contract. Commit 16605868 (β.3 red-team finding #2 fix) added the LP setTimeout PRECISELY to preserve this uniform semantic — the very "scattered comments" the finding cites are the audit trail of preserving uniformity, not evidence of fragility. The suggested rename `AnimationDispatched`/`AnimationSettled` is purely cosmetic since `Started`/`Completed` already mean exactly that.

---

### R2. [HIGH] Config-as-late-bound-singleton hides the dependency graph from the type system

- **Source** : server.ts + duel-worker.ts cohesion
- **Principe** : Inversion of Control violated — modules pretend to be DI'd but are global singletons gated by a runtime null check
- **Confidence du skeptic** : high

**Impact original** : Every module call site is `getCfg()` — a synchronous throw if order-of-boot is wrong. The dependency graph is not encoded in any constructor; it's encoded in server.ts:226-334 as a giant list of configureXxx({...}) blocks. Adding a circular dep (configureA needs B, configureB needs A) compiles cleanly and explodes at the first runtime call. A real DI container (or a `createModule(deps): ModuleAPI`

**Réfutation du skeptic** :

> The pattern is intentional, documented (CLAUDE.md §"Server Module Configuration (createConfigurable<T>)" L1681-1700), and has an explicit regression fence: server.ts:856-871 runs an `isConfigured()` boot invariant that throws with the list of missing modules BEFORE `wss.on('connection')`. The finding's specific claims are overstated: (1) "Adding a circular dep compiles cleanly" is wrong — modules depend on each other via ES module imports (worker-message-router.ts:6-19 imports from timer-management, worker-lifecycle, etc.), and TypeScript's module graph catches those cycles the same way a factory pattern would. The `configureXxx({...})` calls inject CONFIG VALUES (callbacks, scalars), not module instances, so they don't add cycle risk. (2) "configured in wrong order if order matters" — order doesn't matter for these modules because configs are read lazily via `getCfg()` at message-handling time, not at configure time; the boot invariant fence guarantees all are configured before the WS accepts connections. (3) No actual bug is demonstrated; the impact is speculative. The suggested factory refactor would be a stylistic improvement at best, not a load-bearing fix — and CLAUDE.md L1689-1693 explicitly calls out the boot invariant as "the regression fence for the whole pattern" with the rule "New configurable modules MUST register their isXxxConfigured() in the boot block".

---

### R3. [HIGH] DuelConnection (1696 LOC) is doing 6 distinct jobs — transport + chain state proxy + slot routing + STATE_SYNC buffer + prefetch + game-log relay

- **Source** : PvP normal
- **Principe** : SRP — handles WS lifecycle, message parsing, per-slot perspective routing, processor delegation, art prefetch, journal hook, reconnect/retry policy, and protocol version handling in one class
- **Confidence du skeptic** : high

**Impact original** : Adding a new server message type requires (1) routing decision in the giant switch, (2) deciding which `_slots[]` to write to, (3) whether to forward to processor, (4) whether to push to out-of-band sink, (5) whether to clear `_confirmedCardsByChain`. The list of clears scattered across DUEL_END (:1320), REMATCH_STARTING (:1369), STATE_SYNC (:_applyStateSync), CHAIN_END (:1479), MSG_CONFIRM_CARDS 

**Réfutation du skeptic** :

> The size + multi-responsibility observation is factually accurate (1696 LOC confirmed at duel-connection.ts:1696; symmetry-of-clears hazard is real per F10/F12/F14 commits), but the suggested 3-way split contradicts explicit γ-c doctrine and load-bearing invariants:

1. **R8 explicitly rejected this split.** CLAUDE.md line 165-167 + duel-connection.ts:165-167 docstring: *"R8 acté (phase-gamma-spec.md §8) : pas de classe abstraite `DuelTransport`. La même `DuelConnection` se reconfigure via le constructor option."* The decision to keep DuelConnection as a single concrete class was a γ-c phase outcome, not an oversight.

2. **`SlotStateStore` extraction would break the cardinal γ invariant.** CLAUDE.md "Chain Event Processing & State Machine": *"SOLO multiplex builds ONE `DuelConnection` (mono-conn, post-c6a) which owns its processor outright... Both perspectives are projected from the same `_slots[0|1]` on this SAME conn — the cardinal γ invariant that eliminates the bug-solo-sequence.md chain-orphan bug structurally."* The whole point of γ-c c6a (`88203957` PR2 c8) was to collapse from 2 conns to 1 to eliminate the inter-object sync surface. Extracting `_slots[]` to a separate `SlotStateStore` re-introduces exactly that surface.

3. **CLAUDE.md states the architectural posture explicitly:** line 141: *"`DuelConnection` is a concrete WebSocket class, NOT an abstraction layer."* The finding's "transport + dispatcher + store" framing is the abstraction-layer view R8 rejected.

4. **The symmetry-of-clears concern is already discharged by active maintenance.** F14 (`f40c43f8`, 2026-05-31) extracted `_applyStateSync` precisely to dedupe the STATE_SYNC↔CHAIN_STATE pair. F10/F12 comments at duel-connection.ts:1402-1406 + 1334-1337 cite the spec §4.3 A8 table as the authoritative source. The 4 clear sites are not silent footguns — they are reviewed against the spec table at every change.

5. **`MessageDispatcher` extraction has near-zero benefit.** The handleMessage switch mutates `_slots[]`, `processor`, 13+ signals, `_confirmedCardsByChain`, `_pendingStateSync`, and the timer slots. Extracting it would require passing all of these as a parameter bundle or via callbacks — net complexity flat or up, no new test seams (the processor is already injected, the rbs is already a separate service).

The class is large but internally sectioned (Signals, WS lifecycle, handleMessage, prefetch, reconnect, helpers). Severity "high" is inflated — the finding identifies a real LOC count but proposes a structural change that explicitly contradicts the γ-c phase decision shipped 2026-05-29 across 28 commits.

---

### R4. [HIGH] F10 cost-board-sync parity is TWO DIFFERENT MECHANISMS with no automated gate

- **Source** : cross-mode duplication
- **Principe** : DRY / regression-fence — 'parity by construction' is claimed but the construction is two independent code paths in two languages of intent (message emission vs state segmentation)
- **Confidence du skeptic** : high

**Impact original** : The most likely break is the client-side scenario: a future projection or manager keys off `chainPhase === 'building'` at sync time. In PvP that fires (sync is after MSG_CHAINING); in Replay it doesn't (sync is before). A bug would manifest only in Replay, only on chains with cost MOVE events, only for the specific zone the new consumer cares about — exactly the kind of long-tail divergence that d

**Réfutation du skeptic** :

> The finding restates the doctrine that already exists. CLAUDE.md lines 217-247 explicitly document (a) the two-mechanism nature, (b) the exact two break scenarios the finding lists as "Impact" (server splits PvP path / client adds ORDER-dependent consumer), and (c) the suggested cleanup ("the right fix is probably to hoist the intermediate sync into a shared utility"). Both source files carry F10 anchor comments cross-referencing each other and the doctrine (duel-worker.ts:1367-1375 and replay-precompute.ts:394-406), each ending with the explicit instruction "If you change/remove/relocate this branch, update the counterpart + the doctrine in lock-step". The doc-only commit 174523c7 (2026-05-31, yesterday) documents that Axel explicitly investigated Option 2 (light gate cross-loop spec) and vetoed it as "infeasible because runDuelLoop is private to duel-worker.ts, invasive refactor, no user-visible 'Chain Cost' entry desired" — also noting the DEP β.2 reads AnimationCompleted not the board, making the asymmetry invisible to the only current consumer that could care. This is documented accepted tech debt with review-time discipline as the gate (same protection model as the F9 chainPhase parity which also has no automated cross-side gate). The finding's suggested_cleanup is the chantier already named-and-deferred by doctrine; calling that "a tombstone" misreads it — it's a "if a future bug surfaces" trigger, not an unaddressed risk.

---

### R5. [HIGH] F10 cost-sync parity gap: PvP emits an extra BOARD_STATE, replay relies on precompute segmentation — two different mechanisms, no shared gate

- **Source** : PvP normal
- **Principe** : DRY + robustness — two divergent implementations of the same observable invariant with no shared test gate
- **Confidence du skeptic** : high

**Impact original** : A future server PR touching `hasCostMoves` (e.g. moving it to a different trigger, dropping it because PvP 'looks fine') silently desyncs from replay. The pre-cost sync tier differs (PvP tier 3 chainPhase=building, replay tier 2 chainPhase=idle) — any future tier-4 with a side-effect gated on chainPhase==='building' would diverge immediately. CLAUDE.md's own remediation hint is 'hoist into a share

**Réfutation du skeptic** :

> The finding regurgitates verbatim what CLAUDE.md §"Intermediate post-cost board sync (F10, 2026-05-31)" (lines 178-252) already documents — including the two regression-risk scenarios, the "no automated gate" note, and the exact proposed remediation ("hoist into a shared utility"). It is doctrine, not a new finding. The doctrine was shipped 2 commits ago (`174523c7`, 2026-05-31) and explicitly states the deep refactor is deferred: "If a FUTURE bug surfaces a divergence here, the right fix is PROBABLY to hoist..." — Axel-validated 2026-05-31. Both code sites carry explicit cross-reference comments pointing to each other + the doctrine (duel-worker.ts:1367-1375 and replay-precompute.ts:395-406) telling devs to update in lock-step. The "high severity" claim contradicts the explicit acceptance: per doctrine, the practical effect (DECK/EXTRA pile counts + metadata up to date before resolving) is equivalent, the divergence is bounded, and the user-facing impact is nil (Axel: "internal mechanics, not a user-facing step"). The proposed deep cleanup is wasteful work the project has explicitly deferred.

---

### R6. [HIGH] F9 cross-side chain-state parity has NO automated gate — by admission

- **Source** : cross-mode duplication
- **Principe** : Maintenance / regression-fence discipline (the doctrine itself acknowledges the gap)
- **Confidence du skeptic** : high

**Impact original** : A future contributor adding e.g. a `pending` sub-phase server-side to fix some reconnect edge case would update `applyChainTransition` + its spec, see green, and ship. The client `restoreChainState(links, phase)` would receive a phase value the union `'idle'|'building'|'resolving'` can't hold. TS would catch the literal type mismatch IF the server sub-phase was added to the shared `ws-protocol`, b

**Réfutation du skeptic** :

> The finding restates a deliberately accepted trade-off as if it were a discovery. Commit 4cf0fedb (2026-05-31, the day before this review) explicitly investigated the exact remediation proposed and rejected it: "Investigated Option B (Karma front spec importing the server tracker): infeasible without breaking the front↔server isolation enforced by check-ws-protocol-sync.mjs — no TS alias to duel-server/. Three sub-variants (copy tracker into front, relative import, re-implement inline) all carry more cost than the gate they provide. Decision: DOC-ONLY." Audit doc marks F9 as DONE (`_bmad-output/planning-artifacts/_archive-2026-05/...` per archival commit f5f8675d). Pointer comments were added to both implementation files (chain-state-tracker.ts:49-55 explicitly: "Any change to the transition table here MUST be reflected on the client side..."; duel-event-processor.ts has the matching pointer) so the doctrine surfaces at change-time. The suggested "shared CHAIN_TRANSITION_MATRIX in ws-protocol-shared.ts" duplicates Option B's "re-implement inline" sub-variant which was costed and rejected; the "parity.spec.ts driving both sides through a synthetic harness" alternative IS exactly Option B rejected as more expensive than the gate it provides. The doctrine names "review-time discipline + this checklist" as THE gate — the CLAUDE.md transition matrix itself is the artefact a reviewer cross-checks.

---

### R7. [HIGH] `_transport_lastDispatchedRef` side-channel is a hidden coupling between processEvent and 5 emit sites

- **Source** : EventStream + game-log + projections
- **Principe** : encapsulation / least surprise
- **Confidence du skeptic** : high

**Impact original** : The field comment claims 'safe because processEvent is fully synchronous from entry to return; the side-channel never holds across an await'. But phaseWait (line 488) reads it inside a synchronous prefix of an async function — relies on the handler not awaiting before phaseWait. If a future handler awaits THEN calls phaseWait, the side-channel may have been overwritten by the next `processEvent`. 

**Réfutation du skeptic** :

> The finding misreads phaseWait. Line 488 `const ref = this._transport_lastDispatchedRef;` captures the field SYNCHRONOUSLY into a local at call time, BEFORE the Promise/setTimeout closure runs. The closure uses the local, not the field. Same pattern at line 1347 (group path) and 1102 (emitAnimationStarted) — all read into a local right after the synchronous processEvent return. The runner enforces serial dispatch: queue-runner.ts:659 snapshots `getLastDispatchedRef()` synchronously after `handleEntry()` returns, then awaits the handler's Promise (line 684) BEFORE calling the next handleEntry. No NEXT processEvent runs while the prior handler is suspended on an await, so "future handler awaits THEN calls phaseWait" can't observe a stomp — and even if it did, phaseWait's capture-to-local would still pin the right value. The docblock at lines 419-425 explicitly addresses this: "the runner waits for the handler's Promise to resolve before advancing". The architectural invariant (serial dispatch in QueueRunner) is the real enforcement, not the comment. The suggested deep refactor would not change behavior and would touch ~25 handlers for zero correctness gain.

---

### R8. [MEDIUM] 7 lock-assert sites (F19) repeat the same `assertNoLocks(site)` pattern with no unified guard

- **Source** : cross-mode duplication
- **Principe** : DRY (low-level), KISS — the wrapper would make the contract self-documenting
- **Confidence du skeptic** : high

**Impact original** : When a 8th transition boundary is added (e.g. a new pause/resume path, or a future demo seek), the contributor must remember to call `assertNoLocks` with a fresh site-string. If they forget, the boundary silently masks lock leaks. The doctrine list is the only enumeration of WHICH boundaries assert — there's no compile-time discovery.

**Réfutation du skeptic** :

> The 7 sites share only the assertion line, not the surrounding action: cleanup() calls destroy(); REMATCH_STARTING + onStateSync + resetAllState call commitAll() with different follow-up cleanup; feedTransition/feedTransitionPhased call syncRendered() before processor reset; advanceStep:done calls syncRendered() + busy.set(false). There is no common "transition boundary action" to factor — only the one-line assertion. CLAUDE.md "Replay Board State Parity Rule" §809-843 already enumerates the 7 asserted sites + 3 intentionally-skipped sites + the rationale for each, and explicitly documents "no automated gate; review-time discipline is the protection." The proposed transitionBoundary(site, fn) wrapper would replace `this.rbs.assertNoLocks('foo'); commitAll()` with `this.rbs.transitionBoundary('foo', () => this.rbs.commitAll())` — adds a closure indirection while saving zero lines, hides the linear control flow, and provides ZERO additional compile-time discovery (forgetting to call the wrapper at an 8th boundary is the same risk as forgetting to call assertNoLocks). DRY here is shallow string repetition, not behavioral duplication. KISS argues for keeping the explicit call.

---

### R9. [MEDIUM] DEFERRED_TIMEOUT_MS = 5000 is a fixed magic number unmoored from animation durations

- **Source** : EventStream + game-log + projections
- **Principe** : robustness / configurability
- **Confidence du skeptic** : high

**Impact original** : Under slow-playback (speedMultiplier=0.5) a chain cost MSG_MOVE travel can take >5s, the deferred times out, `EffectAbandoned(timeout)` fires, the overlay-show projection falls back to graceful degradation (which is 'show anyway'), so the cost-before-overlay test of victory silently regresses. The graceful fallback masks the bug. No telemetry surfaces 'deferred timeouts per duel'.

**Réfutation du skeptic** :

> Three independent refutations: (1) The docblock at animation-constants.ts:41-50 EXPLICITLY rejects speedMultiplier scaling with articulated rationale: "a speed-scaled timeout would hide an actually stuck rule under slow playback". This is an intentional design decision, not a missed concern. (2) The finding's premise is mathematically backwards: in skytrix, speedMultiplier=0.5 makes durations SHORTER (Math.round(base * 0.5) at duel-context.ts:89), not longer. The duel-page sets speedMultiplier=0.5 only when activationMode==='off' (animations skipped/sped up); replay uses 1. There is no mode where an MSG_MOVE travel becomes >5s. Travel constants are 400ms base (SHUFFLE_SET_CARD_TRAVEL_MS, SWAP_TRAVEL_MS) — 5s is ~12x margin. (3) The requested telemetry already exists: deferred-effect-processor.ts:707 emits `logger.warn('[DEFERRED] "%s" timed out after %dms', name, DEFERRED_TIMEOUT_MS)` on every timeout. The "no telemetry" claim is false. The "graceful fallback masks the bug" claim conflicts with overlay-show-ready.projection.ts:23-25 documenting it as the doctrinal correct behavior ("better than a never-showing overlay").

---

### R10. [MEDIUM] Doctrine 3-bis is a documentation-only carve-out — easy to drift

- **Source** : EventStream + game-log + projections
- **Principe** : convention-over-code
- **Confidence du skeptic** : medium

**Impact original** : A future dev adding a new manager-owned signal exposed via `asReadonly()` AND consumed by a sync predicate will not be flagged. They might create a parallel `BaseProjection` mirror (rebuilding the F15 bug class) because the projection lane is the obvious 'flux state' pattern. The lint rule pipeline-signal-tagged accepts any class implementing ResetTarget as a tag, so neither shape errors.

**Réfutation du skeptic** :

> The factual claim is correct — no lint rule encodes Doctrine 3-bis and the `pipeline-signal-tagged` rule accepts any `ResetTarget` implementer as valid. But the finding's impact is overstated and the suggested cleanups are weak fits.

Mitigations already in place:
1. `chain-resolution-manager.ts:62-78` — the reference impl carries an explicit 17-line F15 comment block warning future devs about the split-brain antipattern. Any dev touching this file gets the doctrine at point-of-use, not just CLAUDE.md.
2. CLAUDE.md is canonical project doctrine (`Codebase and user instructions... IMPORTANT: These instructions OVERRIDE any default behavior`), explicitly read by Claude Code as system context. The "no automated gate, review-time discipline is the protection" pattern is used elsewhere (F6 relativizer routing, F9 chain phase parity) — consistent project-wide convention.
3. The historical risk is one incident (F-bugB4, 2026-05-31). The doctrine emerged FROM that bug, not as a preventive abstraction.

Suggested cleanups are both poor fits:
- Lint heuristic "BaseProjection.value read sync via dataSource.X()" produces false positives on legitimate sync reads from genuine projections (e.g., `IsAnimatingProjection` is read sync in many places without being dual-purpose).
- TS interface `SyncReadableProjection<T>` adds type-surface but doesn't prevent a dev from picking the wrong abstraction if they don't already understand the doctrine — the decision is semantic ("dérivable du STATE vs FLUX"), not syntactic.

The doctrine is exactly the kind of judgment-call convention where encoding in types/lint produces friction without preventing the underlying error. Refute by default — the cost of the fix exceeds the cost of the risk.

---

### R11. [MEDIUM] F10 cost-sync parity explicitly has 'NO automated gate' — by author's own admission

- **Source** : WS protocol + parity gates
- **Principe** : DRY (two implementations of one contract)
- **Confidence du skeptic** : high

**Impact original** : A future server change that 'looks fine' on PvP (e.g. dropping the hasCostMoves intermediate BOARD_STATE because tests pass) silently breaks the synchronization on PvP only — replay keeps working through the precompute flush mechanism. The asymmetry guarantees a 50% chance of half-detection: spec coverage on one side, untouched on the other.

**Réfutation du skeptic** :

> The finding re-states CLAUDE.md's own caveat as if it were a discovery, while ignoring the explicit mitigation that's already in place. Three blockers: (1) Both code sites carry F10 cross-reference comments added 2026-05-31 in commit `174523c7` — `duel-worker.ts:1366-1380` explicitly points at `replay-precompute.ts:394-399` and the CLAUDE.md doctrine, and vice versa at `replay-precompute.ts:394-406`. Review-time discipline is the documented gate. (2) CLAUDE.md F10 section explicitly pre-commits to the suggested cleanup ('hoist into a shared utility') **if a future bug surfaces** — the author weighed this trade-off and chose deliberate debt over preemptive refactor (Axel-validated). The suggested_cleanup is literally already in the doctrine. (3) No bug has actually surfaced; the parity holds today by construction. The finding asks to spend 3-5 days on a chantier that CLAUDE.md explicitly defers. Not actionable — duplicates an accepted documented decision.

---

### R12. [MEDIUM] F15 'Dual-purpose signal' carve-out signals BaseProjection is the wrong shape for some flux state

- **Source** : EventStream + game-log + projections
- **Principe** : abstraction-cost / OCP
- **Confidence du skeptic** : high

**Impact original** : Tells a future reader: 'sometimes a manager-owned `signal()` exposed via `asReadonly()` is the right answer, and the projection class is overhead.' But the dispatcher / registry / drainStream contract doesn't acknowledge this — there's no first-class 'manager-projection' lane. Each future case has to weigh BaseProjection vs Doctrine 3-bis vs ResetTarget-only with no compile-time guide. Risk of sub

**Réfutation du skeptic** :

> CLAUDE.md:739-783 documents a deliberate 4-rule taxonomy (FLUX→projection / STATE→manager / sub-step→Standardisation 1 / external-dep→Standardisation 2) with Doctrine 3-bis being rule #5 (dual-purpose→manager-owned signal w/ asReadonly). Each rule names a reference implementation (`chainResolutionAnnounce` for 3-bis, `hasBufferedEvents` for rule 2, `swapGraveDeckKeys` for rule 3, LP `lpDelta` decoration for rule 4). This is not an unprincipled carve-out — it's a partition of the design space. The 'first-class manager-projection lane' the finding claims is missing already exists: it's called `ResetTarget` (`projections/reset-target.ts`), which managers implement (CLAUDE.md:854-863 lists 5 implementers: ChainResolutionManager, LpAnimationTracker, BattleAnimationTracker, DuelGameLogService, TargetIndicatorManager). The dispatcher accepts `ResetTarget` (CLAUDE.md:725 'register(target) accepts any ResetTarget'). Doctrine 3-bis was forged from a concrete regression (F-bugB4 infinite re-deferred loop from two-writer skew, CLAUDE.md:767-768) — removing the carve-out via option (b) would re-introduce it. The lint rule in option (a) is wrong-shaped: flagging asReadonly() on non-ResetTarget classes has huge FP rate (every Angular service exposing a readonly signal) and misses the actual constraint. Commit c410f630 (2026-05-31) just COLLAPSED triple-doc on F15 — the maintenance trajectory is simplification, not abstraction debt.

---

### R13. [MEDIUM] False symmetry: `_processMessageInner` (sync) vs `applyChainTransition` (sync) — they handle MSG_CHAIN_SOLVING differently

- **Source** : cross-mode duplication
- **Principe** : LSP-adjacent — two `applyChainTransition`-shaped functions that diverge in phase semantics. A reader expecting symmetry from the naming will misread the boundary.
- **Confidence du skeptic** : high

**Impact original** : The CHAIN_STATE reconnect handshake is the bridge: server emits its snapshot, client calls `restoreChainState(links, phase)`. If the client is in a state where the queue is still draining (server phase=`resolving`, client phase=`building`) AND a reconnect fires AND the snapshot says `resolving` — the client now skips the queue-driven `applyChainSolving` and surfaces in `resolving` with the queue n

**Réfutation du skeptic** :

> The claimed impact ("client surfaces in resolving with queue not yet drained on reconnect") is structurally impossible. At duel-connection.ts:1043-1074, the CHAIN_STATE handler calls _applyStateSync which calls processor.reset() (duel-event-processor.ts:299-311) — that wipes _animationQueue to [] AND clears activeChainLinks/chainPhase BEFORE restoreChainState (line 1074) sets the snapshot phase. The queue is empty by construction when phase is restored to 'resolving'. F14 doctrine (duel-connection.ts:400-417) explicitly pairs STATE_SYNC+CHAIN_STATE as atomic same-tick. F9 doctrine in CLAUDE.md explicitly documents the asymmetry as intentional and identifies CHAIN_STATE+restoreChainState as the re-alignment mechanism. chain-state-tracker.ts:49-55 already carries an F9 doctrine pointer in code comments. The "misleading mirror naming" concern is mitigated by inline doctrine — no integration test gap, no rename needed.

---

### R14. [MEDIUM] Forking re-runs the duel via `INIT_FORK`/`INIT_REPLAY` but `runReplayPreComputation` and the fork path don't share their pre-MSG_CHAINING loop

- **Source** : Replay
- **Principe** : DRY (two implementations of "replay PlayerResponses through OCGCore" with one tiny shared constant) + parity-by-construction lapses (only one decision is structurally shared)
- **Confidence du skeptic** : medium

**Impact original** : Bug in OCGCore replay handling (e.g. RETRY detection, mid-chain disconnect handling, MAX_ITERATIONS guard) fixed in `runReplayPreComputation` won't auto-propagate to `runForkReconstruction`. The fork sanity check (sanityResult) is the only guard, and it only checks final state, not the loop's robustness.

**Réfutation du skeptic** :

> The two loops have fundamentally different responsibilities and a small shared surface that is already abstracted. `runForkReconstruction` (duel-worker.ts:1710-1777, ~68 lines) is a "fast-forward to position N then hand off to SOLO" primitive — it does NOT call transformMessage, filterMessage, chainTracker, flushState, generateLabel, emitTurnBatch, or any chain/turn/decision/hint accumulation. `runReplayPreComputation` (replay-precompute.ts:270+, ~250+ lines) builds the entire precomputed timeline. The genuinely-shared concern (which OCG messages count as select prompts) IS already extracted as the exported `SELECT_MESSAGE_TYPES` constant, with an explicit comment at replay-precompute.ts:35-37 documenting fork as a consumer. The remaining "shared" code is ~15 lines: duelProcess try/catch, RETRY check, updateState call, MAX_ITERATIONS guard, status END check — each using DIFFERENT error codes (`WORKER_FORK_ERROR` vs `WORKER_REPLAY_ERROR`), DIFFERENT divergence semantics (fork errors out on exhaust; replay treats exhaust as graceful interrupt completion), and DIFFERENT stop conditions (`targetResponseCount` vs end-of-responses). The proposed `replayPlayerResponses(deps, responses, onMessage)` extraction would need hooks for: stop predicate, error-code mapping, port-message-type mapping, whether-to-call-transformMessage, whether-to-flushState — a hook surface larger than the duplicated code itself, violating YAGNI. Recent F5-bis (commit `e0f39f7a`) collapsed fork into SOLO at the runtime level, NOT the bootstrap level — explicit design choice. Impact claim ("bug fix in replay's RETRY detection won't propagate to fork") is true in principle but the RETRY check is 3 lines that mirror by inspection; same for the MAX_ITERATIONS guard. No drift observed in commit history. CLAUDE.md's "Modes — vue d'ensemble" + "Fork-solo unification (F5-bis)" sections explicitly call out fork's INIT_FORK bootstrap as legitimately distinct from replay's INIT_REPLAY precompute batch.

---

### R15. [MEDIUM] MSG_CHAIN_END buffer drain timing differs between client-side processor and server-side state tracker

- **Source** : PvP normal
- **Principe** : robustness — invariant 'both sides agree at boundaries' is bounded by the queue drain plus chainOverlayReady await-signal, with no explicit timeout/guard
- **Confidence du skeptic** : high

**Impact original** : If the queue runner stalls (e.g. an await-signal that never resolves due to a missing overlay state), the server is `idle` while the client is still `resolving`. A reconnect handshake in this window would ship `phase: 'idle'` (server snapshot) to a client that just successfully resumed its own resolving phase — the client `restoreChainState(links, phase)` would FORCE idle, dropping any chain link 

**Réfutation du skeptic** :

> Finding misunderstands the architecture. (1) The asymmetry is intentional and documented (CLAUDE.md F9 lines 273-281): server `chainPhase` = wire state, client `chainPhase` = animation state. (2) The "corrupted reconnect" scenario is structurally impossible: server.ts:1252-1259 only sends CHAIN_STATE when `session.activeChainLinks.length > 0`. If server is idle (post-MSG_CHAIN_END), it sends ONLY STATE_SYNC, which calls `processor.reset()` (duel-connection.ts:1657) → phase=idle. That is the desired outcome — server is authoritative. (3) F14 (duel-connection.ts:399-417, lines 1019-1041) already addresses STATE_SYNC↔CHAIN_STATE atomicity via `_pendingStateSync` buffering with a wall-clock fallback timer. (4) Client doesn't "commit chain links to server" — the server is source of truth; client animation queue is local rendering. Losing pending local animations on reconnect IS the intended hard-resync semantics. (5) The "POLL-DROP watchdog (10s)" framing is irrelevant: a 10s queue stall before reconnect would mean MSG_CHAIN_END was already received by the client and queued; reconnect just collapses the stalled animation, no link is lost. The suggested cleanup (server tracking client's last-ack phase) would add bidirectional state for a non-bug.

---

### R16. [MEDIUM] Per-event boardStateAfter sanitization at server PLUS swap at front — two places relying on perspective convention drift

- **Source** : cross-mode duplication
- **Principe** : SRP — sanitization, perspective-relativization, and per-event snapshot routing are 3 concerns interleaved across 3 files; the partial-relativization TODO is the smoking gun.
- **Confidence du skeptic** : high

**Impact original** : The 'controller/player fields stay absolute' invariant is a footgun. Documented in CLAUDE.md → 'Perspective Convention' but each consumer site (chain-badges, linked-zone-map, EMZ resolver) must re-discover it. New code reading `card.controller` from a `boardStateAfter` snapshot will see absolute server indices even when `players[]` is relative — exactly the F6 bug class.

**Réfutation du skeptic** :

> The finding misrepresents the structure. (1) The "TWO additional swaps" on the front are not duplicated: both `DuelConnection._maybeSwapBoardStateAfter` (front/src/app/pages/pvp/duel-page/duel-connection.ts:611-633) and `ReplayDuelAdapter.swapEvents`/`swapBs` (replay-duel-adapter.ts:117-123) delegate to the SAME pure helpers `swapBoardState`/`swapEventBoardStates` in front/src/app/pages/pvp/board-state-swap.ts — explicitly extracted (γ Option C PR2 c4.4, 2026-05-28) for exactly this reason. The file's docblock cites both call sites. (2) The "partial relativization" invariant is not a footgun — it is documented in CLAUDE.md "Perspective Convention" (lines 934-1007) with explicit rules covering server-side partial swap, replay-side partial swap, and the 4 rules consumers must follow. (3) F6 (2026-05-31, last week) is cited by the finding as the bug class but is actually the recent *fix*: it centralised every `abs === ownIdx ? 0 : 1` through `DuelContext.relativePlayer()` and pinned every known-correct relativizer in a Known-correct list. (4) Server `sanitizeBoardState` (message-filter.ts:242) has a different concern from the front swaps — info-leak sanitization of opponent private zones — and is correctly orthogonal to perspective conversion of inner `controller` fields. The Story 4.2 TODO at line 247 is acknowledged tech debt, not a load-bearing risk: per CLAUDE.md "Those stay absolute in both PvP and Replay" makes the convention uniform and explicit.

---

### R17. [MEDIUM] ReplayDuelAdapter is the SoT for animation-pipeline parity but has no `*.spec.ts` covering its swap+sync orchestration directly

- **Source** : Replay
- **Principe** : Testability + SRP (heavy component spec covers transport + adapter + orchestrator simultaneously, so a failure pinpoints poorly)
- **Confidence du skeptic** : high

**Impact original** : When (not if) the swap logic or segmentation breaks, the failure manifests in `replay-page.component.spec.ts` as a generic "replay step didn't render" assertion. The root cause (e.g. `swapEventBoardStates` missing a new event field with `boardStateAfter`) is one debugging hop away.

**Réfutation du skeptic** :

> `front/src/app/pages/pvp/replay/replay-duel-adapter.spec.ts` exists (453 lines, 30+ tests) and directly covers 4 of the 5 suggested cleanup items: (a) perspective=1 swap propagating to boardStateAfter at line 156 ("should swap per-event boardStateAfter when perspectiveIndex is 1"); (b) buildSteps segmentation around SELECT_* at lines 197, 212, 223; (c) resetProcessorForTransition preserving chain state at lines 394-431; (e) SELECT_CHAIN auto-skip at line 212. The finding's premise that orchestration is "currently exercised only through the heavy component spec" is factually wrong. Only item (d) assertNoLocks timing is not explicitly tested, but that does not justify the finding as written — the spec file the finding claims is missing actually exists and predates the audit by several commits.

---

### R18. [MEDIUM] Server's lastBoardState cache + cancel rollback both use full BOARD_STATE — STATE_SYNC re-emit is potentially stale

- **Source** : PvP normal
- **Principe** : robustness — cache may be stale relative to in-flight worker mutations
- **Confidence du skeptic** : high

**Impact original** : If the worker emits BOARD_STATE → then emits 2-3 MSG_MOVE → then a player reconnects, sendStateSnapshot ships the PRE-move BOARD_STATE. The 2-3 MSG_MOVE were already broadcast (the player who missed them lost them) and the server ships an outdated snapshot. The current mitigation is that BOARD_STATE is emitted right before every prompt at duel-worker.ts:1430, so the gap is bounded to 'one prompt w

**Réfutation du skeptic** :

> The "stale cache" scenario is structurally bounded by OCGCore's sync execution model + existing mitigations:

1. duel-worker.ts:1430 — BOARD_STATE is emitted on EVERY `OcgProcessResult.WAITING` transition (the worker's only pause point for player input). The worker is synchronous re: OCGCore; it cannot pause mid-batch. A reconnect happens during a WAITING window, by definition AFTER the most recent BOARD_STATE was port.postMessage'd.

2. duel-worker.ts:1376-1380 (F10) — Intermediate BOARD_STATE before MSG_CHAIN_SOLVING when `hasCostMoves` is true, so chain-cost MSG_MOVEs are captured in the cache before the chain resolves.

3. duel-worker.ts:1362 — `liveChainTracker.process(dto, () => buildBoardState().data)` attaches `boardStateAfter` per BOARD_CHANGING event during resolving (shared ChainSnapshotTracker, parity with replay). The client's `processEvent` uses these snapshots to progress logical state per-event.

4. server.ts:1252-1259 — `sendStateSnapshot` ALSO ships CHAIN_STATE (activeChainLinks + chainPhase + negatedIndices) so a mid-chain reconnect restores the chain state machine, not just the board.

5. The finding's worry "worker emits BOARD_STATE → then emits 2-3 MSG_MOVE → then a player reconnects" — the only way 2-3 MSG_MOVEs are emitted without a subsequent BOARD_STATE is if the worker is still processing (status=CONTINUE). The reconnect handler runs on the main thread serializing port.postMessage; the cache update at worker-message-router.ts:284 happens for every BOARD_STATE in arrival order. When the worker next hits WAITING, a new BOARD_STATE is broadcast AND cached. The "window" the finding describes is the chain-resolving window, which IS covered by F10 + per-event boardStateAfter snapshots.

No doctrine match for the finding's concern; multiple existing mitigations (F10 in CLAUDE.md, ChainSnapshotTracker shared spec, CHAIN_STATE on reconnect). The suggested replay buffer is YAGNI.

---

### R19. [MEDIUM] The 5+ `session.soloMode` branches in broadcastMessage + 8 in server.ts are NOT unified

- **Source** : cross-mode duplication
- **Principe** : SRP / Open-closed — adding a 4th mode (e.g. a future demo mode or tutorial) would require touching each of these sites individually; the abstraction of 'session phase routing' is implicit.
- **Confidence du skeptic** : high

**Impact original** : When a 4th mode is introduced (or even when reading the current 3), discoverability is low: a contributor must `grep -r session.soloMode` to find every gate. Some branches are positive (`if (soloMode)`), some negative (`if (!soloMode)`), some compound (`session.forkMode ? 'fork_solo' : (session.soloMode ? 'solo' : 'pvp')`). Each is correct, but the set of branches is the de-facto definition of 'mo

**Réfutation du skeptic** :

> CLAUDE.md "Modes — vue d'ensemble" (line 26+) explicitly catalogues the 3 modes in a single table AND the F5-bis section (line 314-432) exhaustively enumerates the 3 forkMode skips + the inherited-from-SOLO surface. Discoverability is the OPPOSITE of low — every cited branch carries an inline comment citing its doctrine rationale (γ A29/A30/A1/A1bis/A10, F5-bis #1/#2/#3). The most recent commit on these files (`e0f39f7a` 2026-05-31) is precisely the F5-bis collapse that CONSOLIDATED fork-solo INTO SOLO multiplex — the project deliberately REMOVED an abstraction layer rather than adding one. The audit tracked in `pvp-solo-replay-audit-2026-05-30` closed 22/24 findings with this exact branching as the accepted shape. The cited branches are SEMANTICALLY DIFFERENT concerns (socket-routing because slot 1 has no WS / info-disclosure filter / replay-persist policy / rematch policy) — a `getSessionCapabilities` would hide that heterogeneity. 4th-mode hypothetical is YAGNI (no 4th mode on roadmap; project is post-big-bang steady-state per MEMORY `feedback_steady_state_no_bmad_planning`). The `MODE_TAGS` micro-alternative for the single line `worker-message-router.ts:266` is too trivial to write up as a medium finding.

---

### R20. [MEDIUM] The `forPlayer` SOLO security gate is implementation-validated, not protocol-encoded

- **Source** : WS protocol + parity gates
- **Principe** : Robustness / type-driven design
- **Confidence du skeptic** : high

**Impact original** : A malicious PvP client adds `forPlayer: 1` to SURRENDER → if validation regresses, PvP impersonation possible. The protocol type doesn't prevent it at the TS layer (both PvP + SOLO use the same type). A test pinning 'PvP rejects forPlayer-tagged messages' protects against regression but the type system COULD encode it (two distinct types, one for PvP normal, one for SOLO).

**Réfutation du skeptic** :

> The "suggested cleanup" is already shipped. `client-message-validator.ts:58-97` is a centralized pure function applied at the SINGLE WS-ingress point in `server.ts ws.on('message')` (caller noted explicitly in module doctrine, lines 19-20) — it gates ALL ClientMessage types uniformly, not per-type, so "validation lives in client-message-router.ts (not checked)" is factually wrong: it lives in a dedicated validator module with its own spec. `client-message-validator.spec.ts` already pins (1) T-S6 PLAYER_RESPONSE rejection with warn (line 37-57), (2) T-S6 SURRENDER explicitly (line 59-66), (3) rejection even when `forPlayer === currentPlayerIndex` (no self-tag carve-out, line 68-84), (4) triple-layer runtime hardening: non-object payload (P2), invalid-value (P1, 11 parametrized bad values, line 205-223), PvP-mode check. A "parametrized test per message type" is structurally redundant — the validator is type-agnostic by design. The TS-type observation is true but the mitigation (centralized gate + comprehensive specs + module-level doctrine) is the exact "runtime guard with spec is the pragmatic equilibrium" the finding proposes as cleanup.

---

### R21. [MEDIUM] Three drops 'by design' (chainOverlayBoardChanged, confirmRevealedCards, slot 3.2) hint at YAGNI debt in the projection model

- **Source** : EventStream + game-log + projections
- **Principe** : YAGNI
- **Confidence du skeptic** : high

**Impact original** : Three of ten planned projection slots failed the model fit. ~30% miss rate suggests the projection enumeration in §3.9 was speculative. Future devs reading 'we have 7 projections' may not realise 3 candidates were tried and rejected — the apparent ratio of 7 successes hides that 7/10 is the actual hit rate.

**Réfutation du skeptic** :

> The cleanup the finding asks for already exists in three places: (1) CLAUDE.md §β.3 "Permanent drops (by design)" lines 699-704 lists each dropped slot with its replacement mechanism; (2) `front/src/app/pages/pvp/projections/index.ts:31-33` carries an inline F15 comment explaining slot 3.2's retirement and pointer to the owning manager; (3) `docs/anim-pipeline-v2/README.md` lines 361-385 has a dedicated "Drops" subsection that is exactly the "dropped.md" the finding requests, including French rationale, doctrine cross-refs (3-bis, 1-4), and an "Other cleanups in the same chasse-aux-sorcières pass" addendum naming `_entryAnimInProgress` + `hasLockedZones` for additional teaching. The finding also misframes the issue: CLAUDE.md lines 741-742 + 781-783 explicitly state the doctrine was *derived from* the chasse-aux-sorcières (β.3), so the drops are the output of applied criteria, not failed speculative predictions. Recent commit `9653b4d0` (F15 collapse) and `1f70bb43` (F25 CheckpointPayload purge) show the team actively prunes — this is documented learning, not YAGNI debt.

---

### R22. [MEDIUM] Two reset paths (`silentReset` vs `applyReset`) with subjective 'when' rule

- **Source** : EventStream + game-log + projections
- **Principe** : abstraction-cost / DRY
- **Confidence du skeptic** : high

**Impact original** : The 'when to use which' is documented in 4 different docblocks (CLAUDE.md, DEP file, BP file, orchestrator destroy comment) — each says 'silent on hard teardown because the subscriber dies anyway'. A future maintainer adding a new processor will copy one of the four docs; getting it subtly wrong (emit closures into a dying stream → no-op; OR drop without closures when the subscriber lives → orphan

**Réfutation du skeptic** :

> The split is an intentional, documented design with a mechanical (not subjective) "when" rule. CLAUDE.md:611-613 (BP) and 653-656 (DEP) state the contract: silentReset when the stream subscriber dies with the same scope; applyReset/forceClosure when the journal/projections survive and must see closure events. The F29 doctrine block at CLAUDE.md:615-626 (commit `1f70bb43`, 2026-05-31) explicitly justifies the asymmetry on the replay-seek path — emitting closures before a same-tick journal wipe is "pure noise". The source docblocks (deferred-effect-processor.ts:441-470, boundary-processor.ts:211-251) co-locate the rule with the methods; this is locality, not 4-way duplication. The orchestrator destroy block (animation-orchestrator.service.ts:895-902) is explicitly symmetric by design — comment says "all four listed symmetrically so a future ResetTarget added without updating this method is the only outlier instead of an asymmetric pair". The suggested `resetMode: 'silent'|'closures'` param does not reduce caller cognitive load (caller still picks the mode) and the `OrchestratorPhase.Destroying` marker would add a global lifecycle state machine to replace a 2-line method — direction contrary to F25 (`1f70bb43`) which just purged unused CheckpointPayload abstraction. Cleanup would add abstraction cost, not remove it.

---

### R23. [MEDIUM] `resetProcessorForTransition` chain-state preservation across transitions is mid-state magic with no spec

- **Source** : Replay
- **Principe** : Parity (PvP loses chain state at any STATE_SYNC mid-chain; replay preserves it across precompute state boundaries) + transparency (the divergence is one method that callers rely on without knowing)
- **Confidence du skeptic** : high

**Impact original** : If a server change splits a chain across precompute states differently — or the chain-state machine adds a new field — the resetQueue-only branch will lose the new field at every transition. The animation pipeline assumes chain state survives the transition, so the bug would manifest as broken multi-link chain animations only mid-resolution at a transition seam.

**Réfutation du skeptic** :

> The finding's central claim — "I didn't see a dedicated test for this specific invariant" — is factually wrong. `front/src/app/pages/pvp/replay/replay-duel-adapter.spec.ts:394-428` has a dedicated `describe('resetProcessorForTransition (via feedTransition)')` block with TWO tests pinning both branches: (a) "should preserve chain state across transitions when chain is active" — asserts `chainPhase === 'resolving'` and `activeChainLinks.length === 1` survive a second `feedTransition` mid-chain; (b) "should full-reset processor when chain is idle" — asserts the idle branch wipes leftovers. The divergence is also explicitly acknowledged and documented at `front/src/app/pages/pvp/duel-page/PVP-REPLAY-DIVERGENCES.md:80` (pointing to the method) and item #5 in the same doc. The "mid-state magic with no spec" framing is refuted on both counts: it is specced AND documented.

---

## Inventaire brut par axe d'audit

> Toutes les weaknesses émises par les 8 agents, **avant** vérification adversariale. Inclut les findings de sévérité `low` non envoyés au skeptic. Les findings sont notés `✅ confirmed` ou `❌ refuted` quand un verdict adversariale existe.

### PvP normal

**Forces identifiées** :

- **Server-side WS server.ts: aggressively decomposed into 10 configurable modules with a boot-time invariant**
  - Evidence : duel-server/src/server.ts:856-871 (`unconfigured` check throws if any of the 10 `isXxxConfigured()` returns false); the 10 `configureXxx` injections at server.ts:226-334; boot block requires every module to register or boot fails
  - Why it matters : Adding an 11th module is mechanically enforced: a new `configureXxx` MUST be paired with a new `isXxxConfigured()` in the boot block, otherwise the server refuses to start. This is the single regression fence for the whole configurable pattern (server.ts:853 comment makes this explicit). The pre-extraction monolith had subtle wiring bugs (e.g. timer-management H1-suite phase 4 said the M1 timer maps used to live as 4 free-floating Maps in server.ts); the boot invariant ensures no module gets silently dropped.
- **Chain state-machine parity by construction (server ↔ client), pinned by two distinct spec suites**
  - Evidence : duel-server/src/chain-state-tracker.ts:32-85 (`applyChainTransition` — pure dispatcher, ChainStateContainer); front/src/app/pages/pvp/duel-page/duel-event-processor.ts:156-210 (`_processMessageInner` — same switch, same triggers); CLAUDE.md doctrine 'Cross-side chainPhase parity (F9)' explicitly maps the transition matrix; specs at chain-state-tracker.spec.ts + duel-event-processor.spec.ts
  - Why it matters : Both sides converge on the same 5-state machine (`idle | building | resolving`, MSG_CHAIN_NEGATED, etc.). Server tracks wire state; client tracks animation state. The asymmetry (server flips on receipt, client flips on dispatch) is intentional and documented. The CHAIN_STATE reconnect handshake (server.ts:1252-1259) is the integration point that would surface a drift — but the dual specs make a divergence visible at PR time.
- **ChainSnapshotTracker eliminates the PvP/Replay parity risk by physical co-location**
  - Evidence : duel-server/src/chain-snapshot-tracker.ts:31-40 (`process(dto, captureSnapshot)`); used by both duel-worker.ts:1362 (live PvP runDuelLoop) AND replay-precompute.ts via the same callsite — same predicate, same field, same code path
  - Why it matters : The pre-extraction `chainResolving` flag was duplicated inline in `runDuelLoop` + `runReplayPreComputation`. The class lifts the contract to a single place, so a future change to which events get `boardStateAfter` attached can only land once. This is one of the few places in the codebase where 'parity by construction' is actually structural, not a `// keep in sync` comment.
- **Animation orchestrator has a single convergence point (`pushToStream`) for the EventStream + DeferredEffectProcessor**
  - Evidence : animation-orchestrator.service.ts:1064-1069 (`pushToStream` assigns monotonic ref, updates stream, feeds DEP, returns ref); 5 callsites (in-queue tap processEvent:1533, page-bootstrapped out-of-band sink for MSG_CHAIN_NEGATED + SELECT_CARD + synthetic MSG_WIN, runner internal events at constructor:589, group directive at processDirective:1367)
  - Why it matters : The β.2a refactor turned what was a scattered set of push sites into ONE method that owns the ref counter + observer feed. A new event type that should flow into the GameLog only needs to hit `pushToStream` once. Without this convergence the DEP rule predicates would have unpredictable arrival order.
- **ScopeResetDispatcher enforces the §3.6 reset hierarchy mechanically, not by comment**
  - Evidence : animation-orchestrator.service.ts:1145-1160 (`notifyPerspectiveSwitch` dispatches PERSPECTIVE_LIFETIME) vs 1184-1195 (`resetForReplaySeek` dispatches DUEL_LIFETIME) vs 1197-1213 (`onStateSync` DUEL_LIFETIME); ChainResolutionManager scope = PERSPECTIVE_LIFETIME; LpAnimationTracker scope = DUEL_LIFETIME
  - Why it matters : Pre-α.5 each manager had to be reset by hand at every callsite — `chainManager.reset()` + `lpTracker.reset()` + `battleTracker.reset()` in sequence, with comments like 'do NOT add lpTracker here for PERSPECTIVE switch'. The cascade is now derived from declared scope; LP's DUEL_LIFETIME declaration mechanically opts it out of a PERSPECTIVE switch. F27 (resetForReplaySeek widening from PERSPECTIVE→DUEL) was a one-line change.
- **DuelConnection cleanup is invariantly idempotent + null-safe — load-bearing for the γ-c bootstrap**
  - Evidence : duel-connection.ts:824-837 (`cleanup()` — assertNoLocks → destroy → clear 4 timer slots → ws.close); CLAUDE.md 'Transport Lifecycle Invariants' explicitly names this as Invariant 1; SOLO bootstrap creates a default conn then immediately orphans it via `bindSoloConnection` requiring `cleanup()` to be safe without prior `connect()`
  - Why it matters : The γ-c single-connection model relies on `cleanup()` being safely callable twice (SOLO teardown can fire it from two paths). Any future addition that throws on missing prior init breaks SOLO silently. The doctrine is in CLAUDE.md but the code shape (`if (this.ws)`, slot-by-slot timer null-check) physically enforces it.
- **F14 STATE_SYNC+CHAIN_STATE atomic buffer collapses a transient window**
  - Evidence : duel-connection.ts:1027-1041 (STATE_SYNC parks payload, arms 100ms flush timer); duel-connection.ts:1043-1076 (CHAIN_STATE consumes pending payload, applies both atomically); STATE_SYNC_FLUSH_MS = 100ms at duel-connection.ts:26
  - Why it matters : Pre-F14, reconnect mid-chain had a one-tick window where chain state was empty (STATE_SYNC reset) before CHAIN_STATE restored it. Any reader running between the two saw a corrupted view. The buffer makes the pair a single semantic operation, with a graceful fallback for the empty-chain case (server contract: only sends CHAIN_STATE when there's something to restore).

**Dettes identifiées** :

- **[HIGH] F10 cost-sync parity gap: PvP emits an extra BOARD_STATE, replay relies on precompute segmentation — two different mechanisms, no shared gate** ❌ **REFUTED**
  - Principe : DRY + robustness — two divergent implementations of the same observable invariant with no shared test gate
  - Evidence : duel-server/src/duel-worker.ts:1318 + 1354 + 1376-1380 (PvP `hasCostMoves` flag → extra BOARD_STATE before MSG_CHAIN_SOLVING); CLAUDE.md §'Intermediate post-cost board sync (F10)' explicitly documents replay uses PreComputedState segmentation at replay-precompute.ts:394-399 instead; CLAUDE.md §'Regression risk' acknowledges 'There is currently NO automated gate enforcing this parity'
  - Impact : A future server PR touching `hasCostMoves` (e.g. moving it to a different trigger, dropping it because PvP 'looks fine') silently desyncs from replay. The pre-cost sync tier differs (PvP tier 3 chainPhase=building, replay tier 2 chainPhase=idle) — any future tier-4 with a side-effect gated on chainPhase==='building' would diverge immediately. CLAUDE.md's own remediation hint is 'hoist into a shared utility callable from both runDuelLoop and runReplayPreComputation'.
  - Cleanup : Deep — extract a `CostMovesSyncGate` shared module callable from both duel-worker.ts and replay-precompute.ts that owns the `hasCostMoves` accumulator AND the emit decision. Add a regression spec asserting both modes emit equivalent state before MSG_CHAIN_SOLVING.

- **[HIGH] duel-worker.ts (1973 LOC) is a god-file: orchestration + 50+ transformXxx + buildBoardState + chain + replay/fork all in one module**
  - Principe : SRP — at least 5 distinct responsibilities (DTO transform, board snapshot, OCG loop, replay capture, fork reconstruction) share module-level mutable state
  - Evidence : duel-worker.ts:79-90 (10 module-level `let` variables shared across the file); transformMessage at duel-worker.ts:580-872 (~290 LOC switch with 30+ branches); buildBoardState at :918-1144 (~226 LOC, 14 face-up flag queries with WASM-bug workaround); runDuelLoop at :1250-1435; initDuel/initReplay/initFork/runForkReconstruction at :1548-1778; port.on('message') at :1817 (10 message types dispatched inline)
  - Impact : Worker state (turnPlayer, turnCount, phase, lp, forkMode, lastIdleSnapshot, capturedResponses, …) is implicit ambient. Anyone adding a new message handler MUST find all the `let` slots that need resetting in `cleanup()` (1597-1633, which already had a regression in 2026-05-08 with `forkMode` being sticky across error paths — comment at 1617-1622). The fact that `cleanup()` has 12 distinct resets is the smell. Adding a new message type requires reading the whole 1973 LOC to find the matching state slot to reset.
  - Cleanup : Deep — extract `transform-message.ts` (the OCG→DTO switch), `build-board-state.ts` (the WASM query orchestrator with cardDbCache), and a `WorkerSession` class that owns the 10 module-level `let`s. Worker file becomes the message dispatcher + lifecycle skeleton.

- **[HIGH] DuelConnection (1696 LOC) is doing 6 distinct jobs — transport + chain state proxy + slot routing + STATE_SYNC buffer + prefetch + game-log relay** ❌ **REFUTED**
  - Principe : SRP — handles WS lifecycle, message parsing, per-slot perspective routing, processor delegation, art prefetch, journal hook, reconnect/retry policy, and protocol version handling in one class
  - Evidence : duel-connection.ts:136 (class header for 1500+ LOC class); 13 signal pairs at :180-221; per-slot state at :233; handleMessage switch at :971-1549 (~580 LOC, 35+ branches); openConnection/onopen/onmessage/onclose/onerror at :860-969; prefetchRevealedCards at :1556-1587; _applyStateSync at :1646-1672; _slots[0|1] manipulation scattered through every case
  - Impact : Adding a new server message type requires (1) routing decision in the giant switch, (2) deciding which `_slots[]` to write to, (3) whether to forward to processor, (4) whether to push to out-of-band sink, (5) whether to clear `_confirmedCardsByChain`. The list of clears scattered across DUEL_END (:1320), REMATCH_STARTING (:1369), STATE_SYNC (:_applyStateSync), CHAIN_END (:1479), MSG_CONFIRM_CARDS (:1483-1498) — keeping these symmetric is error-prone (F10/F12 code-review comments explicitly say the legacy was missing clears in REMATCH_STARTING).
  - Cleanup : Deep — split into `DuelConnection` (raw WS lifecycle, reconnect, protocol mismatch), `MessageDispatcher` (the giant switch, owns slot routing), and `SlotStateStore` (the `_slots[0|1]` data + reset semantics). The current class is the integration of all three.

- **[HIGH] Three sources of truth for prompt slot ownership: server `lastSentPrompt[p]`, client `_slots[p].pendingPrompt`, sendResponse `pendingPrompt.player` lookup**
  - Principe : DRY + robustness — three independent slot resolutions for the same logical message
  - Evidence : duel-server/src/worker-message-router.ts:344 (`session.lastSentPrompt[targetPlayer] = filtered` SOLO) vs :360 (PvP loop); duel-connection.ts:1101-1102 (`_slotFor(message.player)`) sets the slot from the message; duel-connection.ts:644-663 (sendResponse F-bugB3 root-cause fix — slot index re-derived from `pendingPrompt()?.player` because `forPlayer` was wrong in PvP); CLAUDE.md F-bugB3 mentions a 16-day debt before the fix
  - Impact : F-bugB3 (2026-05-31) was caused by `sendResponse` clearing the wrong slot in PvP P1 viewer because the pre-fix fallback `_slots[forPlayer ?? 0]` cleared slot 0 even when the prompt lived in slot 1. The triage required tracing log lines from both server `SELECT prompt sent` and client `ws.recv SELECT_*` to find the mismatch. Every future slot-write site is susceptible.
  - Cleanup : Medium-deep — introduce a `PromptSlotRouter` helper used by both `_slotFor` AND `sendResponse` that derives slot from a SINGLE rule (`forPlayer ?? message.player ?? 0` with explicit precedence) and pin it in a spec. Today the rule is implicit in 3 different branches.

- **[HIGH] Symmetric clear blocks for slots are hand-maintained across 4 reset sites — drift caught by code review only**
  - Principe : DRY — three near-identical loops that drifted historically and got patched up over time
  - Evidence : duel-connection.ts:1338-1344 (DUEL_END clear block — 5 fields per slot); :1407-1413 (REMATCH_STARTING clear block — same 5 fields); :1661-1668 (_applyStateSync clear block — 7 fields per slot — adds `lastSelectedCards`/`lastSelectedPromptType`/`hintCardConsumed`); F12 + F10 comments explicitly say the legacy was missing `hintContext` + `inactivityWarning` clears
  - Impact : Each loop is the spec §4.3 A8 table replicated in code. F12 (code-review fix) had to add `hintContext` clears to DUEL_END + REMATCH_STARTING — meaning the legacy was wrong for 6+ months. Without an authoritative `clearSlot(scope)` method, the next added per-slot field will be missed in at least one of the three reset sites.
  - Cleanup : Medium — extract `PerspectiveSlot.applyReset(scope: 'duel-end' | 'rematch' | 'state-sync')` that owns the scope→fields-to-clear matrix in one place, and inline-call it from the 3 sites. The spec §4.3 A8 table becomes a single switch.

- **[HIGH] AnimationOrchestratorService (1985 LOC) — 'thin coordinator' aspiration broken by 25+ inject() + 7 projection wirings + business handlers**
  - Principe : SRP + KISS — the file is the integration point for 8 managers + 8 projections + queue runner + deferred processor + DOM helpers (handleEquip touches DOM directly)
  - Evidence : animation-orchestrator.service.ts:78-110 (15 injects at top); :122-394 (8 projections instantiated + auto-registered in ctor); :509-668 (~160-line constructor wiring runner deps + 8 register/attach pairs); processEvent at :1488-1564 (24-branch dispatch switch); per-handler methods (handleFlipSummoning, handleChainSolving, handleChaining, handleEquip, …) live in this file too
  - Impact : The 'thin coordinator' framing in the docblock is aspirational. The ctor at :509-668 is critical-path: a register-without-attach (or vice versa) wirings a projection that silently no-ops on reset (note the `?.register` `optional: true` pattern — unit specs run without the dispatcher). β.3 checkpoint R3 mitigation comment at :331-338 explicitly admits 'if you spot a projection registered without a matching applyReset, the `?.` silently no-ops'. Adding a 9th projection requires reading the entire constructor to find the symmetric register/attach/detach trio.
  - Cleanup : Deep — split into `AnimationOrchestratorWiring` (ctor that owns register/attach/detach lifecycle in declarative form, e.g. an array of projections) and `AnimationDispatcher` (the processEvent switch + per-handler methods). The constructor becoming declarative makes the register/attach symmetry mechanically visible.

- **[MEDIUM] Inline handleMessage switch with ~35 cases performs slot-routing + processor delegation + side-effects in mixed order**
  - Principe : KISS — the switch mixes 'route this to slot', 'tell the processor', 'fire a side-effect callback', and 'mutate per-class state' on each branch, with comments documenting historical regression fixes inline
  - Evidence : duel-connection.ts:983-1548 — single handleMessage switch with branches doing: SELECT_CARD also pushes to outOfBandSink (:1088), CHAIN_STATE consumes pending STATE_SYNC (:1043-1076), MSG_CONFIRM_CARDS chainIndex tagging (:1483-1498), MSG_DRAW gates onDrawNewTurn on _boardActive (:1499-1523), DICE_ROLL writes BOTH slots (:1168 — γ-c regression-fix comment block at :1155-1167)
  - Impact : Comprehension cost: each case has 3-15 lines of context-establishing comments before the actual logic. The DICE_ROLL fix (writes both slots because the receiver's perspectiveSlot is unresolved on rematch but resolved on fresh duel) is genuinely subtle and lives in a switch case — a future refactor that tries to make DICE_ROLL 'use the normal _slotFor pattern' will silently break the rematch flow.
  - Cleanup : Medium — each non-trivial case becomes a private `_handleXxx(msg)` method; the switch becomes a routing table. The historical-fix comments stay attached to the method they describe instead of cluttering the switch.

- **[MEDIUM] Server-side SELECT prompt resend has no whitelist for 'pre-duel prompts vs in-game prompts' — both flow through lastSentPrompt**
  - Principe : SRP — pre-duel and in-game prompts share the same `awaitingResponse`/`lastSentPrompt` slots even though their reconnect semantics differ
  - Evidence : worker-message-router.ts:63-72 (SELECT_TYPES set includes pre-duel `DICE_ROLL` + `SELECT_FIRST_PLAYER` alongside in-game prompts); resendPendingPrompt at server.ts:1217-1224 fires the cached prompt on reconnect; the SOLO `IDLE_PHASE_PROMPT_TYPES` whitelist mentioned in CLAUDE.md §5.2 lives in solo-duel-orchestrator (front), NOT server
  - Impact : Resending DICE_ROLL/SELECT_FIRST_PLAYER on a mid-duel reconnect via `commitPendingTimer + startInactivityTimer` (server.ts:1006-1014) is meaningless — those prompts have their own coordinator. The current code happens to be safe because pre-duel prompts can't co-exist with awaitingResponse=true mid-game (different phase), but the protection is by coincidence of phase semantics, not by structural guard.
  - Cleanup : Small — split the set into PRE_DUEL_SELECT_TYPES and IN_GAME_SELECT_TYPES; the timer arm at :319-320 only fires for in-game. resendPendingPrompt guards on the prompt type matching the current phase.

- **[MEDIUM] `_innerLoopDepth` + `AbortController` + `_isRunning` triple-guard is brittle and the comment apologizes for it**
  - Principe : KISS — three intertwined lifecycle primitives where one orthogonality break invalidates the other two
  - Evidence : CLAUDE.md §'F13 (2026-05-31) — AbortController does NOT make _innerLoopDepth redundant' explicitly defends both as needed; queue-runner.ts marked with 3 `F13 site N of 3` comments; the 2026-05-20 perspective-bug-hunt memory mentions the 'infinite rescue loop on seek pendant chain'
  - Impact : Three load-bearing assertions across 3 files. The comment at F13 (CLAUDE.md) admits `_innerLoopDepth` guards intra-tick parallel re-entry while `AbortController` guards reset boundaries; removing either breaks the other's detection scope. A future dev who reads only the F13 comment for the file they're modifying may legitimately think 'the abort makes the depth check redundant' (the comment had to explicitly say 'NOT redundant' because someone tried).
  - Cleanup : Deep — encapsulate the three primitives behind a `RunnerLifecycleGuard` class with explicit invariant tests. Today the guard is splayed across the file with comment pointers; the abstraction would make the orthogonality structural rather than asserted-by-doc.

- **[MEDIUM] MSG_CHAIN_END buffer drain timing differs between client-side processor and server-side state tracker** ❌ **REFUTED**
  - Principe : robustness — invariant 'both sides agree at boundaries' is bounded by the queue drain plus chainOverlayReady await-signal, with no explicit timeout/guard
  - Evidence : duel-event-processor.ts:259-263 (`applyChainEnd` — clears links + sets idle, called from queue runner async); chain-state-tracker.ts:70-74 (`MSG_CHAIN_END` — sync clear on receipt at server); CLAUDE.md F9 explicitly documents the asymmetry but acknowledges only the spec suites guard it
  - Impact : If the queue runner stalls (e.g. an await-signal that never resolves due to a missing overlay state), the server is `idle` while the client is still `resolving`. A reconnect handshake in this window would ship `phase: 'idle'` (server snapshot) to a client that just successfully resumed its own resolving phase — the client `restoreChainState(links, phase)` would FORCE idle, dropping any chain link the client was about to commit. The current safety net is the POLL-DROP watchdog (10s) — anything shorter than 10s but longer than the queue resume is a silent corruption.
  - Cleanup : Medium — server could attach the client's last-acknowledged chain phase to STATE_SYNC requests; the server then drops CHAIN_STATE if the client is ahead. Today the server unconditionally ships its own snapshot.

- **[MEDIUM] Per-event `boardStateAfter` snapshot adds a 50-150 KB / duel payload that's redundant with the next BOARD_STATE**
  - Principe : Occam's Razor — every snapshot is a full BoardStatePayload (players + zones + counters + alteration fields) when the consumer (`processEvent` → `updateLogical`) only needs the deltas
  - Evidence : duel-worker.ts:1356-1362 (`liveChainTracker.process(dto, …)` attaches snapshot on every BOARD_CHANGING event during resolving); chain-snapshot-tracker.ts:37-39 (every BOARD_CHANGING in resolving carries the snapshot); CLAUDE.md §'Pre-computation Timeline Rules #4' admits 'Payload growth is ~50-150 KB gzipped per duel'
  - Impact : On a slow connection or a long chain, the wire payload can balloon. The client uses it for progressive logical-state sync, but `updateLogical(snapshot)` replaces the entire logical state — the orchestrator only needs the diff (which the queue's per-event handlers already compute). The full snapshot is defensive but it's the simplest possible encoding.
  - Cleanup : Deep — emit only changed zones/cards as a delta. Would require a server-side diff against the LAST attached snapshot per chain + a client-side merge. Acceptable today (CLAUDE.md notes 'highly redundant — gzip handles it') but a backlog item for future bandwidth chantiers.

- **[MEDIUM] Server's lastBoardState cache + cancel rollback both use full BOARD_STATE — STATE_SYNC re-emit is potentially stale** ❌ **REFUTED**
  - Principe : robustness — cache may be stale relative to in-flight worker mutations
  - Evidence : worker-message-router.ts:283-286 (`session.lastBoardState = message` on every BOARD_STATE); :171-175 cancel-rollback uses lastBoardState; server.ts:1246-1250 sendStateSnapshot reuses lastBoardState; no version/sequence number on the cached state
  - Impact : If the worker emits BOARD_STATE → then emits 2-3 MSG_MOVE → then a player reconnects, sendStateSnapshot ships the PRE-move BOARD_STATE. The 2-3 MSG_MOVE were already broadcast (the player who missed them lost them) and the server ships an outdated snapshot. The current mitigation is that BOARD_STATE is emitted right before every prompt at duel-worker.ts:1430, so the gap is bounded to 'one prompt window'. Still: between the last `port.postMessage` BOARD_STATE and the next prompt's BOARD_STATE, mid-resolving snapshots aren't cached.
  - Cleanup : Medium — server-side replay buffer of the last N messages since lastBoardState, replayed on reconnect after the snapshot. Or, simpler: always force a fresh `WORKER_REQUEST_BOARD_STATE` from the worker on reconnect, accepting the latency in exchange for guaranteed freshness.

- **[LOW] Server boot block lists 10 modules; adding an 11th requires editing 3 places (configure call, isXxxConfigured import, boot block list)**
  - Principe : DRY — the 'mechanically enforced boot invariant' itself requires 3 lockstep edits per new module
  - Evidence : server.ts:226-334 (10 `configureXxx` calls); server.ts:856-870 (10 `isXxxConfigured()` checks); the import header at :55-114 (10 import groups)
  - Impact : The invariant is the saving grace but adding a new module means the dev forgets one of the 3 edits 1 time in 10. Most likely failure: `configureXxx` called but `isXxxConfigured` not added to the boot block — module is configured but the server still boots if it was missed. Inversely, isXxxConfigured added but configureXxx missing → server doesn't boot, which is fine.
  - Cleanup : Small — `createConfigurable()` could maintain a global registry of all instances created; the boot block becomes `registry.assertAllConfigured()` instead of an explicit 10-line list. One-time refactor, one source of truth thereafter.

- **[LOW] Client retains a 'sharedProcessor' ctor option apology comment but no enforcement that the option can't return**
  - Principe : robustness — historical anti-pattern is documented but not gated
  - Evidence : duel-connection.ts:159-168 (comment block explaining the field is owned locally now); :500-510 (ctor explicitly says 'γ Option C c8 — sharedProcessor ctor option dropped'); no spec asserts that DuelConnection.processor is NEVER swapped after construction
  - Impact : Re-introducing a shared processor would re-introduce the 'switchPerspective routes future messages to a different processor' bug class (the original cause of bug-solo-sequence.md). The dev would have to know the history to spot the regression in review.
  - Cleanup : Small — `processor` is currently `readonly` so it can't be re-assigned, which is half the guard. Add a unit test asserting `processor === processor` across the conn's lifetime to pin the invariant explicitly.

- **[LOW] Animation orchestrator's `_dispatchEvent` returns 4 different result types ('divert' | number | 'async' | Promise) — the runner switch consuming this is implicit**
  - Principe : KISS — discriminated union with 4 wire-incompatible branches stretched across orchestrator + runner boundary
  - Evidence : animation-orchestrator.service.ts:1240 (`EventResult | 'divert'`); processEvent at :1488 returns `number | 'async' | Promise<void>`; CLAUDE.md §'Synchronous business dispatch' documents the 4 forms; runner consumes via `decideNextStep`/`handleEntry` callbacks
  - Impact : Adding a 5th result (e.g. 'retry-later') requires (1) updating the EventResult type, (2) the runner's consumer to handle it, (3) ensuring no existing handler accidentally returns the new value. The runner's per-step timing (setTimeout for number, Promise.race for Promise, suspend for 'async', dropped for 'divert') is implicit — the orchestrator can't know which form was actually awaited.
  - Cleanup : Small-medium — replace with a tagged union: `{kind: 'instant'} | {kind: 'hold', ms: number} | {kind: 'awaitTravel', p: Promise<void>} | {kind: 'awaitAsync'} | {kind: 'divert'}`. The runner switch becomes exhaustive (TS `never` arm), and new kinds are mechanically caught.

- **[LOW] Per-perspective slot state lifetime spans 3 unrelated reset paths — DUEL_END, REMATCH_STARTING, STATE_SYNC — but the scope concept lives only in projections, not in conn**
  - Principe : DRY (across boundaries) — the conn could participate in the same scope hierarchy but doesn't
  - Evidence : duel-connection.ts `_slots[0|1]` cleared by hand in 3 inline blocks (:1338, :1407, :1661); the orchestrator side uses ScopeResetDispatcher (PERSPECTIVE_LIFETIME / DUEL_LIFETIME / CONNECTION_LIFETIME / SESSION_LIFETIME hierarchy); slot cleanup uses ad-hoc imperative `set(null)` calls
  - Impact : Two parallel reset mechanisms: orchestrator-side cascading scope dispatcher (well-engineered, projection-aware), connection-side hand-rolled reset blocks. A future refactor that adds a new scope (e.g. PAGE_LIFETIME for hot module reload) would only flow through the orchestrator's ScopeResetDispatcher; the conn wouldn't participate.
  - Cleanup : Deep — make `DuelConnection` (or rather its `_slots` store) a `ResetTarget` with scope = PERSPECTIVE_LIFETIME (since slots ARE per-perspective). DUEL_END/REMATCH_STARTING/STATE_SYNC become `dispatcher.dispatch(DUEL_LIFETIME)` calls instead of inline clears. Aligns the two mechanisms.

---

### SOLO multiplex

**Forces identifiées** :

- **Cardinal γ invariant is now structural, not conventional**
  - Evidence : front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:159-186, front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts:168-178, front/src/app/pages/pvp/duel-page/duel-connection.ts:233 (_slots [2]), front/src/app/pages/pvp/duel-page/duel-connection.ts:504 (this.processor = new DuelEventProcessor())
  - Why it matters : The fix for `bug-solo-sequence.md` (switchPerspective rerouting future messages to a stale processor) is now impossible to regress: there is literally ONE socket, ONE `DuelConnection`, ONE `DuelEventProcessor`. `_slots[0]` and `_slots[1]` are properties of the same conn — flipping `perspectiveSource` is a read-side change only. A future refactor would have to reintroduce a 2nd conn or 2nd processor to break this; the c8 removal of `sharedProcessor` ctor option closed the back door.
- **F-2.3 cleanup collapsed the A21 pair-flip into a single source of truth**
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:251-274 (`get soloMode() { return this._soloModeSource?.() ?? false; }`), front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:159-172 (single `setSoloMode(true)` call, no `conn.soloMode = true` paired flip), front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts:70 (`readonly soloModeSource = signal(false)`)
  - Why it matters : Previously the SOLO bootstrap required a manual pair flip (`conn.soloMode = true` + `wsService.setSoloMode(true)`) in lockstep — a textbook source of future regressions when a 3rd init path landed. By deriving `conn.soloMode` from `wsService.soloModeSource` through ctor injection, the invariant becomes a static dependency and is structurally enforced — adding a new SOLO bootstrap can no longer forget the flip.
- **Pure decision function `decideSoloRouting` keeps routing testable in isolation**
  - Evidence : duel-server/src/lifecycle-helpers.ts:75-124, the `PSEUDO_PAIRWISE_SOLO_ROUTED` whitelist (4 entries) + `decideSoloRouting()` 3-way return ('send'|'route-to-0'|'noop')
  - Why it matters : The 1-socket / 2-slots routing — the single most fragile thing in SOLO — is a pure function with 4 explicit message types in a whitelist, unit-testable without booting the WS server. The whitelist is the gate for adding new SOLO-aware messages and acts as a forcing function: a future addition that needs slot-1 routing MUST be added to one list. Compared to scattering `if(soloMode)` checks at 37 send sites in server.ts, this is the right ergonomic.
- **Defensive duelAssert on the SOLO BOARD_STATE swap invariant**
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:600-609 (`_shouldSwapForSolo` asserts `_duelCtx !== undefined`)
  - Why it matters : Soft-failing here (silently disabling the swap) would have caused a flipped board for 1 frame in SOLO P1 with no error. The dev-throw / prod-warn surfaces a wiring bug instead of producing a near-imperceptible visual artifact. Combined with the orchestrator construction (`solo-duel-orchestrator.service.ts:159-166` always passing `duelCtx`), the contract is enforced at construction-time + runtime.
- **Boundary closure + per-slot prompt clears on STATE_SYNC / DUEL_END / REMATCH**
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:1338-1344 (DUEL_END), 1407-1413 (REMATCH_STARTING), 1660-1668 (STATE_SYNC `_applyStateSync`), 1326 (forceBoundaryClosure)
  - Why it matters : Every transition that wipes processor state ALSO loops over BOTH `_slots` to clear the per-slot prompt flow. This eliminates a whole class of stale-slot resurfacing bugs (cf. the FIRST_PLAYER_RESULT regression fix at 1209-1213, where a stale DICE_ROLL in `_slots[1]` resurfaced when ocgPlayerIndex flipped). The per-slot invariant is uniformly applied.
- **Cancel-rollback explicitly handles SOLO routing + omniscient filter**
  - Evidence : duel-server/src/worker-message-router.ts:155-203 (WORKER_CANCEL_DONE: `const dest: 0 | 1 = session.soloMode ? 0 : p; const omniscient = session.soloMode;` and STATE_SYNC + CHAIN_STATE + cached prompt all routed to dest with the right filter)
  - Why it matters : The cancel-rollback path is one of the trickiest to get right (it touches worker + server + client state per the contract doc). The SOLO branch routes all 3 messages to socket 0 with omniscient filtering so the perspective-1 viewer sees the rollback's private fields it needs to render — without this, a SOLO cancel from slot-1 would have hidden fields. The branch is explicit and well-commented.

**Dettes identifiées** :

- **[HIGH] Three pre-duel `for (const s of this._slots) s.pendingPrompt.set(message)` carve-outs — the receive-side dispatch is no longer per-`message.player`**
  - Principe : SRP / single-source-of-truth
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:1155-1168 (DICE_ROLL), 1177-1186 (SELECT_FIRST_PLAYER), 1209-1212 (FIRST_PLAYER_RESULT)
  - Impact : The 3 pre-duel cases (which are DEAD in SOLO per the comments, but populate BOTH slots regardless) violate the per-slot dispatch convention. The justification is that `ocgPlayerIndex` is unresolved on first duel but resolved on rematch → `perspectiveSlot()` reads slot 0 first time / slot 1 on rematch → routing to one slot misses one of the cases. This works today, but represents a temporal-coupling between message dispatch and `ocgPlayerIndex` initialization that is not enforced anywhere. A future code path that READS pre-duel prompts at the wrong moment will get unexpected ghost entries from the other slot — and the comments admit "Safe: the receiver is the sole reader, and DICE_ROLL is dead in SOLO", which is exactly the kind of "safe today" reasoning that breaks 6 months later.
  - Cleanup : Resolve `ocgPlayerIndex` BEFORE the dice flow so `perspectiveSlot()` is correct at the time DICE_ROLL arrives — the `DECK_PREFETCH` already runs before `FIRST_PLAYER_RESULT`, and `DUEL_STARTING` carries `playerIndex`; reorder server-side so `ocgPlayerIndex` lands first. Then drop the `for (const s of this._slots)` writes — the per-slot convention is uniformly enforced again. Deep — requires server-side reorder and front-side validation.

- **[HIGH] Mid-chain switchPerspective behavior — `isBoardStableForSwitch` says "no", but the doc claim on data-only relativization is structurally vulnerable to STATE_SYNC during chain**
  - Principe : Robustness / completeness
  - Evidence : front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:228-243 (canSwitchPerspective), memory `pvp-solo-chain-state-hygiene-2026-05-23` (still-open backlog: "mid-chain switchPerspective during chain resolution can desync activeChainLinks")
  - Impact : The `canSwitchPerspective` gate blocks switches while chain is not idle — good. But: `chainPhase()` is the CLIENT processor's view, which is decoupled from the server's view (cf. CLAUDE.md F9 chainPhase parity matrix). There IS a bounded window where the server is `idle` (sent CHAIN_END) but the client is still `resolving` (queue not drained) — or vice-versa. A switch during that window combined with a STATE_SYNC arriving (e.g. background tab returns + sendRequestStateSync) could land server-relative data on a client whose `perspectiveSource` is mid-flip. The backlog memo flags this as unverified post-γ.
  - Cleanup : (deep) Add a Karma spec test that drives MockWebSocket through (CHAIN_SOLVING → switchPerspective attempt → CHAIN_END → STATE_SYNC) and asserts no stale `activeChainLinks`. The memory item says the status is unclear — verify it now in code, not just by manual SOLO play. Until then, the `canSwitchPerspective` gate is a convention claim, not a proven invariant.

- **[MEDIUM] Inactivity timer in SOLO can forfeit the user against themselves — accepted paradox documented but no UX surfaces it**
  - Principe : Robustness / UX clarity (also breaks F5-bis's symmetry rationale)
  - Evidence : duel-server/src/worker-message-router.ts:86-107 (turn timer skipped in SOLO via `if (!session.soloMode)`), but worker-message-router.ts:319-320 unconditionally calls `startInactivityTimer(session, targetPlayer)` on every SELECT_* — see also CLAUDE.md "Inactivity timer kept" under Fork-solo unification
  - Impact : A SOLO user who walks away from an active prompt for >5min sees `DUEL_END reason='inactivity'`, with the slot they walked away from declared the loser of the duel they're playing against themselves. The doc admits the paradox and accepts it for resource-leak protection, but: (1) there is NO client-side warning that this can happen in SOLO; (2) `worker-message-router.ts:88-91` proudly removes the turn timer with `against oneself is a paradox` reasoning, then leaves the same paradox in the inactivity timer. The fix is structurally inconsistent.
  - Cleanup : Either (a) replace the SOLO inactivity timer with a SILENT session-cleanup-only timer (no DUEL_END emission, just terminate the worker after 5min of no activity — the user can re-enter the lobby), or (b) emit a SOLO-specific `INACTIVITY_TIMEOUT` warning surfaced as a non-blocking toast in the UI so the user knows the clock is ticking. The current `forfeit(p)` callback at `timer-management.ts:292-301` fires `DUEL_END` for BOTH players in SOLO.

- **[MEDIUM] Turn timer skip in `worker-message-router.ts` is a 1-line `if` carve-out — the rest of `timer-management.ts` is silently `null`-guarded**
  - Principe : Implicit coupling / OCP
  - Evidence : duel-server/src/worker-message-router.ts:93-107 (`if (!session.soloMode) { session.timerContext = {...}; sendTimerStateToAll(session); }`), duel-server/src/timer-management.ts:65-66 / 94-97 / 149-151 (every function early-returns on `if (!ctx)`)
  - Impact : The decision to skip the turn timer in SOLO is encoded as an `if (!session.soloMode)` guard in ONE module, with EVERY consumer downstream relying on `timerContext === null` early-returns. A future patch that gates `timerContext` allocation on a different predicate (e.g. fork-only) without updating every early-return becomes dangerous, but worse — a future code path that DEREFERENCES `session.timerContext` without checking (`session.timerContext!.pools[...]`) compiles fine and crashes at SOLO runtime only. There are 14 places that read `ctx` in `timer-management.ts` alone.
  - Cleanup : Move the SOLO turn-timer policy into a single predicate function `shouldRunTurnTimer(session): boolean` exposed by `timer-management.ts`, called both at allocation (`worker-message-router.ts:93`) and from `startTurnTimer` / `pauseTurnTimer` / `handleTurnChange`. Then the `if (!ctx)` early-returns become a defensive backstop, not the load-bearing mechanism.

- **[MEDIUM] `_shouldSwapForSolo` asserts on every BOARD_STATE — coupling between conn lifecycle and `_duelCtx` injection becomes fragile**
  - Principe : DRY / coupling
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:600-609, called from `_maybeSwapBoardState` (612) on every BOARD_STATE AND from `_maybeSwapBoardStateAfter` (628-633) on EVERY MESSAGE
  - Impact : The duelAssert at line 607 fires on every BOARD_STATE and every BOARD_CHANGING event during chain resolving in SOLO. While correct in principle, it means a future test or path that constructs a `DuelConnection` with `soloMode=true` via `soloModeSource` but forgets `duelCtx` will fire the assert on EVERY message, drowning the console. Worse, the failure surface is wide: any place injecting `soloModeSource` (currently only `SoloDuelOrchestratorService.init`) is implicitly required to also inject `duelCtx`. The two options are independent in the ctor signature but coupled in semantics — exactly what the F-2.3 cleanup was supposed to eliminate for `soloMode` itself.
  - Cleanup : Either (a) consolidate `duelCtx` + `soloModeSource` into a single `soloContext?: { perspective: Signal<0|1>; enabled: Signal<boolean> }` option so they cannot be partially provided, or (b) move the perspective getter to be derived from `soloModeSource.duelCtx` (one input). The current state has the c8 cleanup of `soloMode` half-done — `_duelCtx` is the next field that should follow the same pattern.

- **[MEDIUM] `PSEUDO_PAIRWISE_SOLO_ROUTED` whitelist drifts away from server-side route decisions — adding a new SOLO-aware message requires touching at least 4 places**
  - Principe : DRY / SRP
  - Evidence : duel-server/src/lifecycle-helpers.ts:75-80 (whitelist of 4), duel-server/src/message-filter.ts:217-223 (defensive `INACTIVITY_WARNING` / `ERROR` passthrough), duel-server/src/worker-message-router.ts:339-354 (omniscient SOLO branch in broadcastMessage), front/src/app/pages/pvp/duel-page/duel-connection.ts:1284-1298 / 1426-1440 (per-slot routing on receive)
  - Impact : Adding a new SOLO-aware message (say, a future `SHARED_ZONE_HOVER`) requires: (1) add to `PSEUDO_PAIRWISE_SOLO_ROUTED`, (2) add a passthrough in `message-filter.ts`, (3) decide if it goes through the omniscient SOLO branch or not in `broadcastMessage`, (4) add a `_slotFor(message.player, ...)` write at receive. Forgetting (1) → silent drop; forgetting (2) → default-DROP + logger.error; forgetting (4) → slot-0 fallback (invisible after switch). The 4 touchpoints are nominally independent.
  - Cleanup : Promote a single `SoloMessageContract` table (a `const messageType → { slotRouted: boolean; omniscient: boolean; sendBranch: 'route-to-0' | 'broadcast-once' | 'noop' }` object) consumed by all 4 sites. Better: derive the receive-side slot write from the same table via a runtime lookup. Deep cleanup — would need a coordinated front+back PR.

- **[MEDIUM] Slot-1 read fallback in `_slots[message.player ?? 0]` is asymmetric — assertion fires only in SOLO but silently lands in slot 0 in PvP if `targetPlayer` is undefined**
  - Principe : Robustness / asymmetric defense
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:1293-1298 (INACTIVITY_WARNING: `duelAssert(!this.soloMode || message.player !== undefined, ...); this._slots[message.player ?? 0]`), 1436-1439 (WAITING_RESPONSE: same pattern)
  - Impact : In PvP normal, if a server regression OMITS `targetPlayer` on `WAITING_RESPONSE`, the message lands silently in `_slots[0]`. PvP normal reads `_slots[ownPlayerIndex]` via `perspectiveSlot()`; for the P0 viewer this matches (lucky), but for the P1 viewer the badge would never surface. The assert fires only in SOLO. The protocol field is currently always populated by the server (since PR1 c2c), so this is latent — but the symmetric assert (`duelAssert(message.player !== undefined, ...)`) is the right defense in both modes.
  - Cleanup : Drop the `!this.soloMode ||` clause — assert unconditionally and let the server contract guarantee the field. The `?? 0` fallback then becomes defense-in-depth, not load-bearing. Trivial change.

- **[MEDIUM] `SoloDuelOrchestratorService.cleanup()` calls `conn.cleanup()` AND `DuelWebSocketService.ngOnDestroy` ALSO calls `active().cleanup()` — double-cleanup risk**
  - Principe : Robustness / idempotency contract
  - Evidence : front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:374-388 (cleanup calls `conn.cleanup()`), front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts:427-433 (`ngOnDestroy` calls `this.active().cleanup()` — `active()` returns the SAME conn the SOLO orchestrator already cleaned up), front/src/app/pages/pvp/duel-page/duel-connection.ts:824-837 (cleanup body)
  - Impact : Both teardown paths fire on duel-page destroy: SoloDuelOrchestratorService.cleanup (via destroyRef) AND DuelWebSocketService.ngOnDestroy. The first call clears timers and closes the WS; the second call passes through `rbs.assertNoLocks('cleanup')` AGAIN — which is OK because the RBS has been destroyed. But `rbs.destroy()` is called twice. The duel-web-socket.service.ts comment at 428-431 acknowledges this ("cleanup is idempotent") — but the doc CLAUDE.md "Transport Lifecycle Invariants → Invariant 1" declares this load-bearing without a regression test pinning it. If a future addition to `cleanup()` (e.g. a Datadog counter, a listener that throws on missing listener) breaks idempotency, both paths break together.
  - Cleanup : Add a `_destroyed: boolean` flag inside `DuelConnection.cleanup()` that early-returns on the second call. Add a spec test that calls `cleanup()` twice and asserts no throw — pins the contract that CLAUDE.md declares. Low effort, high regression value.

- **[MEDIUM] `canSwitchPerspective` reads 3 reactive signals + 1 non-reactive `hasDrawsInFlight` — `[disabled]` binding may not refresh on draw events**
  - Principe : Reactive correctness / KISS (broken in subtle ways)
  - Evidence : front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:237-243 (`if (this.animationService.drawManager.hasDrawsInFlight) return false`), front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts:162-164 (`isBoardStableForSwitch` is a getter reading reactive signals)
  - Impact : The doc comment claims `canSwitchPerspective` "Reads only reactive signals (pendingPrompt, chainPhase, isAnimating) plus the draw-in-flight Set; the reactive trio drives `[disabled]` refresh". But `drawManager.hasDrawsInFlight` is a non-reactive getter on a Set's `.size` — Angular's signal effect tracker doesn't see Set mutations. A `[disabled]=canSwitchPerspective` binding will refresh when chainPhase/isAnimating/pendingPrompt change but NOT when a draw lands or completes. In practice the chain-phase change usually masks the issue (a chain that triggered the draw flips chainPhase), but for solo-initiated draws (e.g. tutored fetch outside chain) the binding can lag. Same getter is invoked again INSIDE `switchPerspective()` so the imperative gate is correct — only the UX hint (disabled button) is at risk.
  - Cleanup : Either (a) expose `hasDrawsInFlight` as a `signal<boolean>` on `DrawSequenceManager` that's updated on add/remove, OR (b) keep it as Set + expose `drawsInFlight = computed(() => this._draws().size > 0)` where `_draws` is a signal. (a) is cheaper. Audit-level finding — doc claims reactive but implementation isn't.

- **[MEDIUM] `bindSoloConnection` re-applies 3 sinks but does NOT re-apply `onMessage` / `onResponse` — comment admits the burden falls on caller**
  - Principe : SRP / completeness
  - Evidence : front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts:153-158 ("the wsService re-applies only the lifecycle sinks it owns (Palier 0 out-of-band, draw-new-turn, onStateSync). The debug-log message/response hooks belong to the caller"), front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:174 (`wireConnectionDebugSinks(conn, ...)` called once, never re-applied)
  - Impact : The split between "sinks the wsService re-applies" and "sinks the caller wires" is fragile. The current SOLO bootstrap wires `wireConnectionDebugSinks` ONCE for the SOLO conn, but `bindSoloConnection` ALSO calls `previous.cleanup()` on the ctor-built default conn whose debug sinks were wired by the wsService ctor. If a future feature adds a new sink to the default conn (say, a metrics sink wired in the wsService ctor), the SOLO orchestrator either misses it or must duplicate the wiring. The current 3-sink list is hardcoded — additions are silent breakages.
  - Cleanup : Move all sink wiring into a single `applySinks(conn: DuelConnection)` method on `DuelWebSocketService` that walks every registered sink uniformly. Then both the default conn AND the SOLO conn call the same method. The SOLO orchestrator stops wiring debug sinks; `bindSoloConnection` calls `applySinks(newConn)` after swapping. Medium refactor.

- **[LOW] Cancel-rollback rate-limit per-player is bypassable in SOLO via `forPlayer` alternation — admitted in the code as "intentional and benign"**
  - Principe : KISS / Robustness
  - Evidence : duel-server/src/client-message-router.ts:266-279 (`load-bearing: in SOLO multiplex, the user could alternate forPlayer: 0/1 on successive CANCEL_PROMPT_SEQUENCE to bypass this per-player rate limit`)
  - Impact : The user can spam CANCEL_PROMPT_SEQUENCE at 2× the rate in SOLO by alternating `forPlayer: 0/1`. The code accepts this because "SOLO is the user's own session". But the per-player rate-limit was designed to bound MALICIOUS flood cost — that protection is structurally weaker in SOLO. The worker bears 2× the cancel rollback cost. Probably fine today, but the comment hand-waves the only protective layer.
  - Cleanup : Track the rate limit on a SOLO-shared slot in addition to per-player: `if (soloMode && (now - max(lastCancelAt[0], lastCancelAt[1])) < ...)` returns the rate-limit error. Trivial — and would close the admitted bypass while staying ergonomic for non-malicious users.

- **[LOW] `forceBoundaryClosure('STATE_SYNC')` / `('DuelEnded')` / `('RematchStarted')` — magic-string switch with no exhaustivity guard**
  - Principe : Type safety / OCP
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:1326 (DuelEnded), 1372 (RematchStarted), 1656 (STATE_SYNC)
  - Impact : The 3 string literals are the closure reasons fed to the BoundaryProcessor. They influence journal ordering (see CLAUDE.md β.1 invariants). A typo (`'STATE-SYNC'`) compiles fine. The reason set is finite (3 reasons today) and CLAUDE.md declares them load-bearing — but typed as `string` at the call sites. A future addition (`'PerspectiveSwitched'`?) breaks parity with replay without any compile-time warning.
  - Cleanup : Promote a `type ClosureReason = 'STATE_SYNC' | 'DuelEnded' | 'RematchStarted'` union in `boundary-processor.ts` and update the signature. Trivial. Doc gain too.

- **[LOW] Perspective restoration coupling — sessionStorage read at duel-page mount, switchPerspective called immediately after init(), no atomicity guarantee**
  - Principe : Encapsulation / SRP
  - Evidence : front/src/app/pages/pvp/duel-page/duel-page.component.ts:656-665 (`const restoredPlayer = (stored?.activePlayer as 0|1|undefined) ?? 0; this.orchestrator.init(wsToken1); if (restoredPlayer === 1) this.orchestrator.switchPerspective();`), front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:83-92 (F18 doc comment delegates to duel-page)
  - Impact : The orchestrator's `init` no longer reads storage (F18 fix); duel-page now bootstraps perspective by calling `init()` then conditionally `switchPerspective()`. But `switchPerspective()` runs through `canSwitchPerspective` which checks `pendingPrompt() / hasDrawsInFlight / isBoardStableForSwitch`. At duel-page mount these are all default — fine today — but the contract is implicit. If a future bootstrap path sets `isBoardActive=true` BEFORE `switchPerspective()` runs (e.g. a hot-reload), the restore can no-op silently and the user opens on the wrong perspective.
  - Cleanup : Add a `restorePerspective(target: 0|1)` method on `SoloDuelOrchestratorService` that BYPASSES the `canSwitchPerspective` gate (it's a bootstrap, not a user gesture). The current path conflates user-initiated switching with bootstrap restoration. Small refactor, big intent gain.

- **[LOW] `DICE_ROLL` cleared via `_diceInProgress.set(false)` on receive but written from BOTH server identities — race on rematch in SOLO**
  - Principe : YAGNI / DRY
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:1141-1169 (DICE_ROLL handler), duel-server/src/server.ts:1117-1119 (SOLO startDuelWithOrder skips dice — the comment at duel-connection.ts:1166 says "DICE_ROLL is dead in SOLO")
  - Impact : The DICE_ROLL handler in `DuelConnection` writes BOTH slots' `pendingPrompt`, with elaborate justification in 9 lines of comment. The comment also notes "Dead in SOLO (startFirstPlayerPhase throws), so the unread slot is inert." If DICE_ROLL is dead in SOLO, the SOLO branch of the handler is dead code. The current code is defensive against a hypothetical future SOLO path that emits DICE_ROLL — but if that path were ever added, the WRONG fix would be to silently emit while the rest of the SOLO infrastructure was unprepared.
  - Cleanup : Add `duelAssert(!this.soloMode, 'DICE_ROLL', 'unexpected in SOLO multiplex')` at the top of the case — turns the dead-code assumption into a contract. Trivial. Same applies to SELECT_FIRST_PLAYER at line 1177.

- **[LOW] Comment / doc bloat: `solo-duel-orchestrator.service.ts` carries 16+ multi-paragraph historical comments referencing commits/PRs/findings**
  - Principe : Maintainability (Miller's Law on file scan)
  - Evidence : front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts:34-67 (history doc), 83-93 (F18), 100-104 (c5b), 124-127 (perspective signal mention), 136-141 (lifecycle), 145-198 (init), 200-220 (switch), 270-282 (post-review H2), 295-303 (cleanup F-2.2)
  - Impact : The file is 389 lines for what is a 6-method service. The historical context (PR2 c4.1, c4.2, c5b, c6a, c6b, c6c, c6d, c6e, c6f, c7a, c8, c10, F-2.1, F-2.2, F-2.3, F3, F17, F18, F22, A21, A27, A28, A29, A30, A39, BH-2, BH-3, H2) saturates Miller's 7±2. A new contributor cannot tell which comments are load-bearing invariants vs archived rationale.
  - Cleanup : Archive the history (per-commit / per-finding rationale) to `_bmad-output/planning-artifacts/solo-orchestrator-history.md` and keep only the LIVE invariants in-file. Already a precedent: CLAUDE.md collapse on `chainResolutionAnnounce` F15 (recent commit `c410f630`). Same exercise needed here.

---

### fork-solo

**Forces identifiées** :

- **F5-bis collapse genuinely unifies the routing path — 3 narrow inline branches, no parallel implementation**
  - Evidence : duel-server/src/fork-handlers.ts:136 calls `attachWorkerHandlers(session)` (the canonical PvP/SOLO handler set) after `removeAllListeners` (lines 132-134). The 3 carve-outs are: worker-message-router.ts:226 (`if (session.forkMode) { safeTerminateWorker(session); break; }`), worker-lifecycle.ts:165 (`if (!session.forkMode) { session.rematchTimeout = setTimeout(...) }`), and worker-message-router.ts:266 (`mode = session.forkMode ? 'fork_solo' : ...`). All three are 1-3 lines, no separate dispatch loop. fork-handlers.ts:40-43 explicitly notes the pre-F5-bis `setupForkWorkerHandlers` parallel implementation has been removed.
  - Why it matters : Pre-F5-bis fork-solo had ~140 LOC of `setupForkWorkerHandlers` reimplementing a subset of `broadcastMessage` — every server message routing fix needed a parallel patch in two places. The collapse means SOLO multiplex improvements (omniscient filter, chain tracking, MSG_CONFIRM_CARDS tag, winReasonCode, cancel-rollback, game-log) automatically apply to fork-solo without effort, as documented in fork-handlers.ts:35-38.
- **Worker-side `forkMode` variable is well-isolated from `session.forkMode` and clearly scoped**
  - Evidence : duel-worker.ts:1676 declares `let forkMode = false;` as a module-local. Set ONLY by `performSanityCheck` at line 1804 (after INIT_FORK reconstruction succeeds) and reset by the defensive scrub at line 1622 inside `resetDuelState()` (with a 5-line code-review comment explaining why). All consumer reads (lines 1264, 1338, 1404, 1418, 1843, 1889, 1907) gate worker-internal concerns: `emitReplayData` skips, MSG_WIN cleanup-vs-stay, IDLECMD/BATTLECMD pre-snapshot, `capturedSetResponse` bypass for deterministic replay, FORK_RESUME handler, cancel handler.
  - Why it matters : The dual `forkMode` could have been confusing, but the worker-side variable is genuinely worker-internal (OCGCore bootstrap concerns) and the session-side flag is genuinely server-routing-internal. They share a name but never appear in the same file — fork-handlers.ts uses only `session.forkMode`, duel-worker.ts uses only the local. The defensive reset on `resetDuelState()` at line 1622 specifically guards against the audit-flagged scenario of stale `forkMode` after INIT_FORK error → INIT_DUEL re-init.
- **fork-handlers.ts properly mirrors SOLO multiplex session shape with explicit reservation rationale**
  - Evidence : duel-server/src/fork-handlers.ts:78-83 builds `players[1]` as `{ playerId: userId, playerIndex: 1, ws: null, connected: false, ... }` with an inline comment pointing at lifecycle-helpers.ts. `isReadyToStart` (lifecycle-helpers.ts:27) and `isFullyDisconnected` (line 38) both branch on `soloMode` to read slot 0 only, which fork-solo inherits via `soloMode: true` (line 104) without any forkMode special case.
  - Why it matters : The reserved-but-never-connected slot 1 is the foundation that lets all SOLO multiplex routing decisions (decideSoloRouting, broadcastMessage SOLO branch at worker-message-router.ts:339) apply uniformly to fork without per-mode forks.
- **H2 connection timeout protects against orphan fork workers + tests cover both terminate and skip paths**
  - Evidence : fork-handlers.ts:121-127 arms `forkConnectionTimeout` (default 30s) that calls `safeTerminateWorker` + `cleanupDuelSession` only if `isFullyDisconnected(session)` still holds. fork-handlers.spec.ts:200-239 covers both branches: the cleanup-after-timeout case AND the skip-cleanup-after-connect case. server.ts:1125-1127 clears the timer when FORK_RESUME is dispatched.
  - Why it matters : Without this, a sanity-OK fork worker whose client never connects (network failure between REPLAY_FORK_READY and the new WS open) would leak both the OCGCore worker thread AND the registered ActiveDuelSession indefinitely. The test pinning ensures the timeout duration parameter stays load-bearing.

**Dettes identifiées** :

- **[HIGH] The 3 fork-specific carve-outs have ZERO dedicated test coverage**
  - Principe : test coverage / regression prevention
  - Evidence : Grep for `forkMode|fork_solo` in worker-message-router.spec.ts and worker-lifecycle.spec.ts returns no matches. fork-handlers.spec.ts:242-248 explicitly says "no per-message dispatch tests are needed here" because routing parity is structural. But the 3 skips (persist branch at worker-message-router.ts:226, rematch arm at worker-lifecycle.ts:165, log tag at worker-message-router.ts:266) are NOT structural — they are explicit `if (session.forkMode)` predicates that could regress silently.
  - Impact : A future refactor that, e.g., moves the persist call out of the `WORKER_REPLAY_DATA` branch (consolidates it into `handleDuelEnd`) would silently start persisting fork-solo replays — and there's nothing to catch it. The same applies to the rematch arm: a refactor that moves the timer setup out of `handleDuelEnd` loses the fork skip. The log tag (`mode: 'fork_solo'`) is used for audit log filtering — a typo turning it back to `'solo'` is invisible to any test. CLAUDE.md:1718-1727 explicitly enumerates these 3 as the only behavioral differences from SOLO, making them load-bearing for invariant preservation but unprotected.
  - Cleanup : Add 3 small tests to worker-message-router.spec.ts and worker-lifecycle.spec.ts: (1) WORKER_REPLAY_DATA with `session.forkMode=true` does NOT call `persistReplay` and DOES call `safeTerminateWorker`; (2) `handleDuelEnd` with `session.forkMode=true` does NOT set `session.rematchTimeout`; (3) MSG_WIN broadcast with `forkMode=true` logs `mode: 'fork_solo'`. ~30 LOC total, blocks future drift.

- **[MEDIUM] fork-solo session is constructed in DUELING phase but skips WORKER_DUEL_CREATED — silent inheritance of timer-init logic** ✅ **CONFIRMED**
  - Principe : documented contract vs. actual flow
  - Evidence : fork-handlers.ts:74 sets `phase: 'DUELING'` and line 85 sets `startedAt: Date.now()`. The fork worker (duel-worker.ts:1805) sends `WORKER_FORK_READY`, NOT `WORKER_DUEL_CREATED` — so worker-message-router.ts:83-108 (the WORKER_DUEL_CREATED branch with the `if (!session.soloMode) { session.timerContext = ... }` gate) is never reached for fork. fork-handlers.ts:32-33 documents "No turn timer — inherited from soloMode: true" but the inheritance is via DEAD CODE PATH, not via the gate firing.
  - Impact : If a future change adds a side-effect to WORKER_DUEL_CREATED OUTSIDE the `if (!session.soloMode)` gate (e.g. `session.startedAt = Date.now()` re-set, instrumentation hook, log line) — fork-solo would silently miss it. The fork's manual `startedAt: Date.now()` at fork-handlers.ts:85 is already a duplication of the WORKER_DUEL_CREATED handler line 85. Currently harmless but the divergence point is invisible at review time.
  - Cleanup : Either (a) add a comment block on WORKER_DUEL_CREATED in worker-message-router.ts noting "fork-solo skips this entire branch by construction — only INIT_FORK sessions reach the FORK_RESUME → live duel state without ever emitting WORKER_DUEL_CREATED", or (b) emit a synthetic WORKER_DUEL_CREATED from the worker on WORKER_FORK_READY arrival via the canonical handler so all duel-startup side-effects converge. (a) is YAGNI-friendly; (b) is structurally cleaner but bigger.

- **[MEDIUM] Sanity check is a soft assertion — divergence is logged but the OK path doesn't tag the session**
  - Principe : robustness — silent state corruption
  - Evidence : duel-worker.ts:1799 sets `match = mismatches.length === 0`. The check covers ONLY: LP[0/1], turnCount, phase (lines 1789-1797). It does NOT verify any board zone content. On mismatch, replay-handlers.ts:470-475 sends `FORK_DIVERGENCE_WARNING` and the user can choose to continue (replay-fork.service.ts:34-43). When the user continues, `transitionForkToSolo` runs with the same divergent OCGCore state — no record of the divergence is carried into the ActiveDuelSession.
  - Impact : Three failure modes: (1) LP/turn/phase match but a card in a zone diverged (Pendulum scale, attached overlay material, counter count) — the user starts the fork on a board that visually matches the replay but differs from OCGCore truth → first action emits MSG_MOVE from a zone the client doesn't think holds the right card, causing rendered-vs-logical desync. (2) User clicks Continue on warning → no `session.divergenceWarning` flag or log line at fork-solo construction time, so when the inevitable downstream weirdness happens (animation skip, lock leak, etc.), there's no breadcrumb pointing back at the divergent fork origin. (3) The sanity check at duel-worker.ts:1780-1807 happens BEFORE `transitionForkToSolo` builds the session, so `session.forkMode=true` is set unconditionally regardless of sanity result.
  - Cleanup : Either (a) extend the sanity check to compare zone contents (deep but expensive); or cheaper: (b) add `divergenceWarningAccepted: boolean` to the ActiveDuelSession for fork-solo, set by `transitionForkToSolo` when the user accepted a FORK_DIVERGENCE_WARNING, logged on DUEL_END and on every error in this session. ~10 LOC, gives the audit log a forensic trail for the otherwise-mysterious post-divergence bugs.

- **[MEDIUM] Boot order pitfall — fork-handlers.spec.ts has to call `configureWorkerLifecycle` for `attachWorkerHandlers` to not throw, but production wires it only in server.ts**
  - Principe : DI doctrine / boot order invariant
  - Evidence : fork-handlers.spec.ts:65-76 `wireUpstreams` calls `configureWorkerLifecycle` because `attachWorkerHandlers` (worker-lifecycle.ts:109) calls `getCfg()` which throws if unconfigured. fork-handlers.ts:136 calls `attachWorkerHandlers(session)` inside `createForkSoloSession`. Production wiring at server.ts (around line 105+264) configures both modules at boot, but they are now COUPLED at runtime — a future module split that reorders boot could leave fork-handlers initialized before worker-lifecycle.
  - Impact : createConfigurable<T> gives a boot invariant in `server.ts` that throws if any module is unconfigured. But the order in that boot block matters — if fork-handlers' configure call lands and IMMEDIATELY needs worker-lifecycle (it doesn't today — config is deferred to first invocation), the implicit dependency is undocumented. Today: harmless because `attachWorkerHandlers` is only called via REPLAY_FORK → createForkSoloSession runtime path, after boot completes. But a regression risk if someone introduces an eager call from a configure callback.
  - Cleanup : Add a comment to fork-handlers.ts:136 stating `attachWorkerHandlers REQUIRES configureWorkerLifecycle to have run — wired in server.ts boot block, ordered before this module's first call site`. Cheap. Alternative: take `attachWorkerHandlers` as an injected dep in ForkHandlersConfig to make the contract explicit, but that's over-engineering.

- **[LOW] Front fork bootstrap reads `wsToken1` from `history.state` only — no sessionStorage fallback like the SOLO path**
  - Principe : consistency / robustness
  - Evidence : front/src/app/pages/pvp/duel-page/duel-page.component.ts:634 reads `const wsToken1 = history.state?.wsToken1 as string | undefined;` then bails if absent. The SOLO branch at line 647 falls back to `sessionStorage.getItem(soloTokensKey)`. solo-mode-effects.service.ts:27-29 `initFork()` only wires the connection-loss effect — no sessionStorage persistence.
  - Impact : User F5's mid-fork-duel → `history.state` is gone → bail → redirect to /pvp with `SOLO_SESSION_EXPIRED`. The SOLO multiplex path survives the same F5 because of sessionStorage. CLAUDE.md "game-log refresh persistence 2026-05-23" memory notes this is a known issue for SOLO already; for fork-solo it's a guaranteed token loss + duel termination on the server side after 30s `forkConnectionTimeout` expires.
  - Cleanup : Acceptable as-is if fork is exploratory "don't expect F5 to survive" — but document explicitly in `replay-fork.service.ts:navigateToForkDuel` why no sessionStorage persistence. Alternative: persist `{wsToken1, replayId, seekTo}` under a `fork-duel-tokens-{forkId}` key with the same restore pattern as SOLO. ~5 LOC.

- **[LOW] Worker-side `forkMode` reset is defensive but the comment hints at a real foot-gun**
  - Principe : documentation vs code divergence (memory: no-doc-code-divergence)
  - Evidence : duel-worker.ts:1617-1622 — the comment explicitly says "forkMode was previously left at its post-WORKER_FORK_READY value across reset cycles. duel-server.spec.ts started gating its snapshot-take and cancel handler on `!forkMode`." Then `resetDuelState()` resets it to false. The cancel-rollback handler at line 1907 reads `if (forkMode) { dlog.warn('[duel-worker] cancel ignored (fork mode)'); return; }` — but the comment at line 1874-1879 says fork-solo NOW inherits cancel-rollback. Contradiction.
  - Impact : Reading lines 1874-1879 a developer expects cancel to work in fork; reading line 1907 they see it's hard-blocked by the worker-side `forkMode` gate. The PLAYER_RESPONSE branch at 1880-1887 DOES take a snapshot (because the comment says fork inherits cancel), but the actual cancel rollback at line 1907 short-circuits before it can be used. So the snapshot is taken but never consumed in fork mode → wasted CPU/memory per IDLECMD/BATTLECMD in fork-solo. Behavior contradiction: comment says "fork-solo inherits cancel-rollback" but the worker still ignores the cancel message.
  - Cleanup : Either (a) extend cancel to fork-mode if the F5-bis intent is real — remove the line 1907 guard, verify the rollback path is safe with `capturedSetResponse` bypassed (line 1889 uses `duelSetResponse` direct); or (b) revert the snapshot-take at 1880 to the prior `!forkMode` gate to match the cancel-ignore behavior — then update the comment block 1874-1879 to say "cancel-rollback NOT supported in fork-solo because [reason]". Pick one; the current state is half-shipped.

- **[LOW] Replay→fork→duel transition has 3 worker handle ownership swaps with no end-to-end integration test**
  - Principe : test coverage of state-machine handoffs
  - Evidence : (1) replay-handlers.ts:447 attaches replay-side listeners on the new worker. (2) replay-handlers.ts:485-486 OR 532-533 detaches via `conn.worker = null` after WORKER_FORK_READY. (3) fork-handlers.ts:132-136 calls `removeAllListeners` for message/exit/error and then `attachWorkerHandlers(session)`. Each transition has its own listener set + timer (replay watchdog → forkConnectionTimeout → none). The 3-spec inventory (replay-handlers spec, fork-handlers spec, worker-message-router spec) tests each leg independently.
  - Impact : If WORKER_FORK_READY (sanity OK) fires AT THE SAME TIME as `worker.on('exit')` due to a race (worker crashes immediately after sending), the replay-side listeners can call `onReplayWorkerDone` while the new fork-handlers listeners are being attached. Specifically: replay-handlers.ts:493-499 captures `worker` by closure and only nulls `conn.worker`; if `transitionForkToSolo` already nulled it (line 533), the exit branch is `false` and the safe cleanup runs. But if `transitionForkToSolo` is reached AFTER an exit, fork-handlers attaches listeners to an already-terminated worker → never receives any FORK_RESUME response → user stuck on connecting screen until WS closes.
  - Cleanup : Add a guard in transitionForkToSolo (replay-handlers.ts:519): check `worker.threadId` is alive (or pass a boolean check) before handing off. If the worker has already exited, send REPLAY_ERROR and clean up. Or: add a Playwright/integration test (CLAUDE.md mentions gamma-c-playwright-c9 deferred) covering replay → fork → live duel → first card play, would catch any silent handle ownership desync.

- **[LOW] `session.forkMode` flag is set in only one production path but type allows it on every session — no compile-time enforcement of "forkMode implies soloMode"**
  - Principe : type safety / invariant enforcement
  - Evidence : types.ts:413-424 declares `soloMode: boolean` and `forkMode: boolean` as independent fields. The comment at 422 says "NEVER true with `soloMode: false`" but this is a documentation invariant, not a type constraint. fork-handlers.ts:104-105 is the only construction that sets both; every other session construction sets `forkMode: false` (server.ts:492 confirms in the PvP POST path).
  - Impact : A future refactor could introduce a code path that sets `forkMode: true, soloMode: false` (e.g. a typo, a copy-paste from fork-handlers but missing the soloMode line). The 3 carve-outs at worker-message-router.ts:226, worker-lifecycle.ts:165, worker-message-router.ts:266 would then fire on a non-SOLO session: skipping replay persist for a PvP duel (data loss), skipping rematch (UX regression). No runtime assertion catches it.
  - Cleanup : Replace `soloMode: boolean; forkMode: boolean;` with `mode: { kind: 'pvp' } | { kind: 'solo' } | { kind: 'fork_solo' }` discriminated union. Migration touches ~20 sites but every read becomes a TS-exhaustive switch. Cheaper alternative: add `duelAssert(!session.forkMode || session.soloMode, 'session-mode', ...)` at session construction sites + at the top of `broadcastMessage` to fail-fast in dev. ~3 LOC.

---

### Replay

**Forces identifiées** :

- **ChainSnapshotTracker is genuinely shared and pins per-event boardStateAfter parity by construction**
  - Evidence : duel-server/src/chain-snapshot-tracker.ts:19-46 (single class, ~46 LOC); duel-worker.ts:171 `const liveChainTracker = new ChainSnapshotTracker()` + :1362 `liveChainTracker.process(dto, ...)`; replay-precompute.ts:292 `const chainTracker = new ChainSnapshotTracker()` + :384 `chainTracker.process(filtered, ...)`; spec at chain-snapshot-tracker.spec.ts (16 cases)
  - Why it matters : This is the textbook example of structural parity — same class, same `process()` signature, same flag transitions, same field name (`boardStateAfter`). A future change to the resolving-window snapshot contract automatically applies to both modes. The pattern is replicated for overlay capture (`capturePreProcessOverlays` / `buildSettlingSourceFifo`) and `SELECT_MESSAGE_TYPES` (single source of truth shared with fork reconstruction).
- **swapBoardState / swapEventBoardStates extracted as pure helpers and reused by both Replay and SOLO multiplex**
  - Evidence : front/src/app/pages/pvp/board-state-swap.ts:26-55 (pure, no `this`, identity fast-path for perspective=0); replay-duel-adapter.ts:117-123 (thin closures over `this.perspectiveIndex()`); reused by `DuelConnection` (per board-state-swap.ts docstring `// SOLO PvP multiplex (γ Option C)`); CLAUDE.md "Replay perspective swap" pins the contract
  - Why it matters : Originally Replay-only, the helpers were intentionally extracted at γ-c PR2 c4.4 (2026-05-28) when SOLO needed the same logic. Both modes now consume the same code path — drift between Replay swap and SOLO swap is structurally impossible. Adds the `boardStateAfter` per-event swap (`swapEventBoardStates`), the exact place the previous bug hid.
- **AnimationDataSource interface has documented, deliberate mode-specific surfaces — not a leaky abstraction**
  - Evidence : animation-data-source.ts:80-95 lists 4 mode-specific surfaces (`attachDrawNewTurnSink`, `onStateSync`, `setBoardActive`, replay step-queue API) with one-line rationale each; line 95 sets the doctrine "if a new concept is genuinely shared, add it; otherwise keep it mode-specific"
  - Why it matters : The audit threat model is "PvP-only feature accidentally promoted to interface, replay implements no-op". The current contract is small (~12 members) and every absent member is justified inline. The contract enforces parity for the genuinely shared surface (queue, chain ops, RBS, out-of-band sink) while letting replay keep `pendingPrompt = signal(null)` legitimately (F32 NOT_REPRODUCED).
- **Robust replay-handlers worker pool with idempotent cleanup, double-fork guard, and explicit cache eviction**
  - Evidence : replay-handlers.ts:117-133 (concurrency gate + queue), :410-425 (terminate previous worker + pending fork before starting fork), :323-332 (cache evict on `WORKER_REPLAY_ERROR` to prevent reuse of bad data), :596-625 `cleanupReplayConnection` (idempotent — clears watchdog, terminates worker, drains pending fork, releases slot), :635-648 `cleanupAllReplayState` (SIGTERM-safe — drains queue FIRST to prevent re-spawn)
  - Why it matters : Replay sessions have no `ActiveDuelSession` so there's no DuelSessionManager safety net — worker leaks compound forever (silent +1 to `replayWorkerCount` blocks all future replays). The current cleanup discipline addresses each leak path explicitly (M16 flush-then-close comment :546-551, `onReplayWorkerDone` decoupling after transition :534-537, `preserveCache` flag :596 for fork-transition case).
- **F10 / F29 doctrine explicitly documents the asymmetric mechanisms that achieve same-effect parity**
  - Evidence : replay-precompute.ts:395-406 (F10 inline comment cross-references duel-worker.ts:1376-1379); duel-worker.ts:1367-1375 mirrors the reference; F29 doctrine in CLAUDE.md and audit-cohabitation-modes-2026-05-31.md:88-100 explains why `forceClosure` is intentionally absent from replay seek (journal is wiped by `rebuildUpTo`)
  - Why it matters : The replay code has *two* known asymmetries that look like bugs and aren't (intermediate cost sync via segmentation vs explicit BOARD_STATE; boundary closure absent because journal rebuilds anyway). Documenting both with anti-regression notes ("don't add forceClosure without first introducing a consumer that survives the wipe") is the only thing standing between a future contributor and a real regression — and both are now load-bearing comments.

**Dettes identifiées** :

- **[HIGH] F10 "intermediate post-cost board sync" parity is by construction, not by shared mechanism — no automated gate**
  - Principe : DRY (two independent implementations of the same logical contract) + maintenance (review-time discipline is the only enforcement)
  - Evidence : duel-worker.ts:1318 `let hasCostMoves = false` + :1354 `hasCostMoves = true` + :1376-1380 `if (dto.type === 'MSG_CHAIN_SOLVING' && hasCostMoves)` emits intermediate BOARD_STATE; replay-precompute.ts:407-413 flushes events on `MSG_CHAINING` unconditionally (different trigger, different ordering vs MSG_CHAINING). Comments at both sites tell humans "update the other side too", and the F10 doctrine in CLAUDE.md spells out the regression risk in 30+ lines. No spec asserts the parity.
  - Impact : Server changes the `hasCostMoves` trigger (e.g. "only flush on actual cost MOVEs, not any MOVE") → PvP loses intermediate sync, replay keeps it. Pile counts diverge on chain resolution start in one mode but not the other. The CLAUDE.md note literally says this is the right time to hoist into a shared util — that work was deferred.
  - Cleanup : (deep) Extract a shared `shouldEmitPreSolvingSync(messageHistory): boolean` predicate in a new module (e.g. `pre-solving-sync.ts`) that both `runDuelLoop` and `runReplayPreComputation` consume. Bonus: a small spec table proving that for a given message sequence, both modes either both flush or both don't.

- **[HIGH] PvP-replay convergence on the client side is largely parallel implementations of the same flow, not shared code**
  - Principe : DRY + parity-by-contract: only `syncAfterBoardState`, `swapBoardState`, `ChainSnapshotTracker`, `BOARD_CHANGING_EVENT_TYPES`, `SELECT_MESSAGE_TYPES` are truly shared. Everything else (boundary closure timing, `forceBoundaryClosure` call sites, chain-state reset flow, message processing loop) is duplicated and synced by convention.
  - Evidence : ReplayDuelAdapter.feedTransition lines 150-176 and DuelConnection's BOARD_STATE handler both call `syncAfterBoardState` (shared, GOOD) but the surrounding `updateLogical` / `processMessage` loop / `observeBoardState` / `assertNoLocks` orchestration is duplicated. The shared interface (AnimationDataSource, ~12 members) is much narrower than the shared logic in practice (every handler that touches chain/lock/RBS).
  - Impact : Every new pipeline feature requires touching both files (PVP-REPLAY-DIVERGENCES.md item 5 was discovered exactly this way). The risk grows non-linearly: each pair of parallel implementations is a divergence-budget. F10 + F29 + the message-feeding loop ordering are already three load-bearing conventions.
  - Cleanup : (deep) Phase 1: catalog the actual shared surface (currently informal; PVP-REPLAY-DIVERGENCES.md is a partial catalog). Phase 2: extract a `BoardStateSyncPolicy` helper that owns `updateLogical → assertNoLocks → syncRendered → processMessages → syncAfterBoardState → observeBoardState` as ONE function, called from both `DuelConnection.case 'BOARD_STATE'` and `ReplayDuelAdapter.feedTransition`.

- **[HIGH] Replay-precompute flush boundaries on MSG_NEW_PHASE / MSG_NEW_TURN / MSG_CHAINING / MSG_CHAIN_END are tightly coupled to OCGCore message ordering**
  - Principe : SRP (the segmentation logic is interleaved with the OCG message loop) + KISS (the flush conditions interact: a new OCG message type would land in `events[]`, generateLabel would return its raw type as the label, the front-end would see a state with an unrecognised label, the timeline would render "MSG_FOO" as a sub-event)
  - Evidence : replay-precompute.ts:338-344 (flush BEFORE NEW_PHASE update), :355-367 (flush + emit batch BEFORE NEW_TURN increment), :407-413 (flush BEFORE MSG_CHAINING accumulates), :414-431 (flush + push MSG_CHAIN_END as separator). The labels in `generateLabel` (119-144) assume the first "meaningful" event per state is a small, fixed set. The state-segmentation contract is implicit in this code.
  - Impact : If ocgcore-wasm starts emitting a new OcgMessageType that translates to a new ServerMessage type — or if `transformMessage` starts emitting a hypothetical `MSG_*` that wasn't anticipated — `generateLabel` falls through the switch, falls through the SKIP_TYPES filter only if it's lucky, and ends up labelling a state with the raw type name. Worse: if a new message MUST be flushed-on (analog of MSG_CHAINING) but isn't, it gets bundled into an unrelated state.
  - Cleanup : Add an explicit "segmentation taxonomy" — a typed `getSegmentationAction(msgType): 'flush-before' | 'flush-after' | 'accumulate' | 'metadata-only'` predicate covering every member of the ServerMessage union (or at least every member with a TS exhaustive `never` default). Move the inline `if (filtered.type === ...)` ladder into this predicate so the contract is reviewable in one place.

- **[HIGH] Lock-assert sites are F19-documented but the coverage is fragmented and replay's 3 sites can mask leaks that PvP can't**
  - Principe : Robustness (the asserts are the only safety net for lock-pair invariants) + parity (replay's 3 cover transitions; PvP's 3 cover reset paths — different boundaries, not analogous)
  - Evidence : CLAUDE.md "Replay Board State Parity Rule" lists 7 assert sites: PvP (3: STATE_SYNC, REMATCH_STARTING, cleanup), orchestrator (1: resetAllState), replay (3: feedTransition, feedTransitionPhased, advanceStep:done). Replay's `collapseRemainingSteps`, `abort`, `jumpToState` intentionally skip assert because they `commitAll()` unconditionally (replay-duel-adapter.ts:316, :357, :367). PVP-REPLAY-DIVERGENCES.md item #1 explicitly says "replay masks lock leaks via commitAll". Audit memo notes F36≡F19 "assertNoLocks code mort" — no production caller has ever seen one fire.
  - Impact : A future lock-leak in a replay-specific path (e.g. inside `collapseRemainingSteps` after a user skip-to-end) will be silently swallowed by `commitAll()`. The assertion sites at `feedTransition` and `advanceStep:done` don't cover this path. PvP's 3 sites cover RESET boundaries (STATE_SYNC, REMATCH, cleanup) not TRANSITION boundaries — so the symmetry implied by "7 sites" is illusory.
  - Cleanup : Either (a) accept the asymmetry and rename: PvP asserts are "reset boundary asserts"; replay asserts are "transition boundary asserts" — they cover orthogonal things. Document explicitly which leak class each catches. Or (b) add a `commitAllWithLockCount(site: string)` variant that asserts the count of locks dropped exceeds 0 — would surface silent leaks in `collapseRemainingSteps` / `abort` / `jumpToState` without breaking the user's skip-to-end workflow.

- **[MEDIUM] PVP-REPLAY-DIVERGENCES.md is treated as resolved ("Résolutions" all checked) but the underlying parity gaps are still load-bearing** ✅ **CONFIRMED**
  - Principe : Documentation drift / single source of truth (CLAUDE.md, PVP-REPLAY-DIVERGENCES.md, anim-pipeline-v2/README.md, and audit-cohabitation-modes-2026-05-31.md all overlap but disagree on what's open vs closed)
  - Evidence : PVP-REPLAY-DIVERGENCES.md:109-131 marks items #1-#6 as `[x]` resolved, but the resolutions are: "accepted as residual risk", "PvP-only by nature", "aligns automatically with #1", "inherent to replay nature". Only #1 (lock lifecycle) and #9 (queue collapse) and #10 (buffer replay) have actual code fixes. The doc has not been updated since the F10/F19/F29 additions — it does not list the BoundaryProcessor asymmetry, the F10 mechanism, the perspective swap, or the orchestrator's `resetForReplaySeek` semantics.
  - Impact : A new contributor reads PVP-REPLAY-DIVERGENCES.md and concludes parity work is done. They miss F10, F29, the BoundaryProcessor seek asymmetry, the `resetForReplaySeek` rename — all of which are documented elsewhere but not here. The next "why doesn't replay see X" investigation will start from incomplete info.
  - Cleanup : Either fold PVP-REPLAY-DIVERGENCES.md into CLAUDE.md's "Replay Board State Parity Rule" section (single SoT) or refresh it: add a "new divergences" section covering F10, F29, perspective swap, BoundaryProcessor seek, and rebuildUpTo journal wipe. Delete the stale "Résolutions" checklist.

- **[MEDIUM] `resetProcessorForTransition` chain-state preservation across transitions is mid-state magic with no spec** ❌ **REFUTED**
  - Principe : Parity (PvP loses chain state at any STATE_SYNC mid-chain; replay preserves it across precompute state boundaries) + transparency (the divergence is one method that callers rely on without knowing)
  - Evidence : replay-duel-adapter.ts:347-353 — when `chainPhase !== 'idle'`, only the queue is reset; chain signals (activeChainLinks, chainPhase) are preserved across the transition boundary. The single-line docstring says "so multi-link chains accumulate correctly across transitions". PVP-REPLAY-DIVERGENCES.md item #5 acknowledges PvP has no analogous concept (STATE_SYNC nukes everything via `processor.reset()`).
  - Impact : If a server change splits a chain across precompute states differently — or the chain-state machine adds a new field — the resetQueue-only branch will lose the new field at every transition. The animation pipeline assumes chain state survives the transition, so the bug would manifest as broken multi-link chain animations only mid-resolution at a transition seam.
  - Cleanup : Pin the contract in a spec: "feedTransition called with chainPhase=building MUST preserve activeChainLinks across the call". Today `replay-duel-adapter.spec.ts` exists (referenced by the F29 audit) but I didn't see a dedicated test for this specific invariant. Add one and link it from the docstring.

- **[MEDIUM] ReplayDuelAdapter is the SoT for animation-pipeline parity but has no `*.spec.ts` covering its swap+sync orchestration directly** ❌ **REFUTED**
  - Principe : Testability + SRP (heavy component spec covers transport + adapter + orchestrator simultaneously, so a failure pinpoints poorly)
  - Evidence : Glob found `replay-page.component.spec.ts` and `replay-transport.service.ts` is tested via that. But `feedTransition` / `feedTransitionPhased` / `buildSteps` (the actual swap+segmentation orchestration) live on the adapter and the audit-cohabitation memo never cites a `replay-duel-adapter.spec.ts`. The orchestration is currently exercised only through the heavy component spec.
  - Impact : When (not if) the swap logic or segmentation breaks, the failure manifests in `replay-page.component.spec.ts` as a generic "replay step didn't render" assertion. The root cause (e.g. `swapEventBoardStates` missing a new event field with `boardStateAfter`) is one debugging hop away.
  - Cleanup : Add `replay-duel-adapter.spec.ts` with dedicated tests for: (a) perspective=1 swap propagates to `boardStateAfter`; (b) `buildSteps` segments events around SELECT_*; (c) `resetProcessorForTransition` preserves chain state across transitions; (d) `feedTransition` calls assertNoLocks at the right point; (e) `advanceStep` SELECT_CHAIN auto-skip when no chainable cards.

- **[MEDIUM] Forking re-runs the duel via `INIT_FORK`/`INIT_REPLAY` but `runReplayPreComputation` and the fork path don't share their pre-MSG_CHAINING loop** ❌ **REFUTED**
  - Principe : DRY (two implementations of "replay PlayerResponses through OCGCore" with one tiny shared constant) + parity-by-construction lapses (only one decision is structurally shared)
  - Evidence : replay-handlers.ts:505-516 sends INIT_FORK; duel-worker has separate `runForkReconstruction` and `runReplayPreComputation` (per replay-precompute.ts:35-37 comment: "runForkReconstruction in duel-worker.ts also gates on this set"). Only `SELECT_MESSAGE_TYPES` is genuinely shared; the rest (the loop structure, state tracking, error handling) is duplicated. The comment says "Kept here as the single source of truth so fork + replay can never drift on which OCG messages count as select prompts" — implicitly acknowledging the rest CAN drift.
  - Impact : Bug in OCGCore replay handling (e.g. RETRY detection, mid-chain disconnect handling, MAX_ITERATIONS guard) fixed in `runReplayPreComputation` won't auto-propagate to `runForkReconstruction`. The fork sanity check (sanityResult) is the only guard, and it only checks final state, not the loop's robustness.
  - Cleanup : Extract a `replayPlayerResponses(deps, responses, onMessage)` core loop in a new module that both replay-precompute and the fork worker consume. The differences (omniscient filter, segmentation, `targetResponseCount` early-return) are passed as hooks.

- **[LOW] Audit memo F25 was purged but the CheckpointPayload "infrastructure" still left a 30-line documented re-introduction path — over-engineering precedent**
  - Principe : YAGNI (β.2 shipped infrastructure no consumer needed; β.3 burned audit cycles re-discovering it was dead)
  - Evidence : commit 1f70bb43 purged checkpoint-payload.ts but the commit message itself plans the re-add path. animation-data-source.ts:127-137 still describes the bootstrap convergence around `pushToStream` with a lot of historical context. The audit memo's leçon méta #1 acknowledges 8/13 findings were false alerts.
  - Impact : The pipeline accumulates documented-but-unused abstraction layers because the doctrine "document everything so the next refactor doesn't regress" trades vs YAGNI "don't ship infra without a consumer". F25 was the cleanup; the next one is lurking.
  - Cleanup : Before shipping any new pipeline abstraction, require a SECOND consumer in the SAME PR. The α.2 BaseProjection / ResetTarget infra dodged this because β.3 was already committed to using them — but CheckpointPayload had no β.3 consumer and shipped anyway.

- **[LOW] `generateLabel`'s SKIP_TYPES set duplicates HIDDEN_LABELS in the front-end with no enforcement**
  - Principe : DRY / cross-tier coupling without enforcement (front-end and back-end maintain parallel lists of "events the timeline hides")
  - Evidence : replay-precompute.ts:137 `const SKIP_TYPES = new Set(['WAITING_RESPONSE', 'MSG_CHAIN_END', 'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_HINT', 'MSG_CONFIRM_CARDS'])`; the comment at :423-425 references "HIDDEN_LABELS in subEventSegments" — a separate front-end set. The two sets are coupled by intent but live in different repos.
  - Impact : Add a new "hidden" message type — must update both lists. Forget one: the back-end labels a state with the raw type, front-end doesn't filter it, the timeline grows a phantom sub-event entry.
  - Cleanup : Put HIDDEN_LABELS / SKIP_TYPES in `ws-protocol-game.ts` (already shared via the byte-sync gate) as an exported `const TIMELINE_HIDDEN_MESSAGE_TYPES`. Both sides consume it.

- **[LOW] Replay-handlers worker state is process-global (top-level `const`) — hard to test in isolation**
  - Principe : Testability + SRP (the module is both the policy and the state container)
  - Evidence : replay-handlers.ts:56-59 `const activeReplayConnections = new Map<...>()`, `const pendingForkWorkers = new Map<...>()`, `let replayWorkerCount = 0`, `const replayQueue: ...`. These are module-level and can't be reset between tests without restarting the import. No spec file accompanies replay-handlers.ts.
  - Impact : Cleanup races (the M16 flush-then-close pattern, the double-fork guard, the `onReplayWorkerDone` decrement on transition) are tested only via integration. Edge cases like "client disconnects mid-flush" or "two REPLAY_FORK arrive within ms" rely on the production code being right.
  - Cleanup : Factor state into a `ReplayHandlerRegistry` class instance constructed once by `configureReplayHandlers`. Methods take the WS / worker / conn; module-level functions delegate to the singleton. Spec can then construct fresh instances per test.

- **[LOW] `syncAfterBoardState` boolean `boardActive` parameter is always `true` from replay — degenerate code path**
  - Principe : Interface clarity (a parameter that's always true in one of two impls suggests the function has two responsibilities) + KISS
  - Evidence : replay-duel-adapter.ts:164, 287, 328 — every call passes `true`. animation-data-source.ts:146-177 has a `!boardActive` branch (tier 1, syncPileCounts only) that is unreachable from replay. PVP-REPLAY-DIVERGENCES.md item #4 acknowledges this is PvP-only by nature.
  - Impact : Future contributor sees the param, may try to use it in replay (e.g. "pause the board on user-init dialog") and won't understand why tier 1 is misbehaving. The doctrine "replay's board is always active" is implicit.
  - Cleanup : Either rename the param to `isBootstrapping: boolean` (clearer intent — replay is never bootstrapping the live board) or split `syncAfterBoardState` into `syncAfterBoardStateBootstrap` / `syncAfterBoardStateActive` with the two-impl boundary at the call site.

- **[LOW] `runReplayPreComputation` mixes 4 distinct concerns in a single 270-line while-loop**
  - Principe : SRP + Miller's law (4 concerns × ~70 LOC each = >7 simultaneous mental loads); KISS
  - Evidence : replay-precompute.ts:297-545 — single function handles: (1) message receipt + OCG loop control + RETRY/WAITING/END status branches, (2) state accumulation + flush-boundary logic, (3) chain-tracker dispatch + filter, (4) decision-moment capture + response feeding. Five inline `port.postMessage(... 'WORKER_REPLAY_ERROR' ...)` blocks duplicate the error-emit-and-cleanup pattern.
  - Impact : Adding the F10 segmentation rule was a 30-LOC inline patch with a 12-line comment. The next "intermediate sync" or new flush-boundary will accrete more. Already at the limit of reviewable.
  - Cleanup : Extract: (1) `processOcgMessages(messages, ctx): IterationResult` (returns segmentation actions, error / continue / end), (2) `accumulateAndFlush(action, ctx)` — pure state machine, (3) the error-emit-and-cleanup helper as a tagged-throw.

---

### Cross-mode duplication

**Forces identifiées** :

- **ChainSnapshotTracker is a real shared class — true parity by construction**
  - Evidence : duel-server/src/chain-snapshot-tracker.ts:19-46 (class definition); duel-server/src/duel-worker.ts:171 (`liveChainTracker = new ChainSnapshotTracker()`); duel-server/src/replay-precompute.ts:292 (`const chainTracker = new ChainSnapshotTracker()`); both call `.process(dto, captureSnapshot)` at duel-worker.ts:1362 and replay-precompute.ts:384 with identical semantics. Spec at chain-snapshot-tracker.spec.ts:35-220 pins the contract.
  - Why it matters : The `boardStateAfter` snapshot is the load-bearing contract for replay/PvP rendered-state parity during chain resolution. Sharing the class (not just the field name) means a future change to the resolving-window predicate cannot diverge — both code paths import the same Class. CLAUDE.md's 'parity by construction' claim is real here.
- **board-state-swap.ts unified between SOLO and Replay perspective swap**
  - Evidence : front/src/app/pages/pvp/board-state-swap.ts:26-55 (pure `swapBoardState` + `swapEventBoardStates`); consumed by duel-connection.ts:611-613 (`_maybeSwapBoardState`) and duel-connection.ts:628-633 (`_maybeSwapBoardStateAfter`) for SOLO; consumed by replay-duel-adapter.ts:117-123 (`swapBs`/`swapEvents`) for Replay. Both wire it through a per-instance perspective signal.
  - Why it matters : Two distinct entry points (SOLO single socket, Replay precompute) producing absolute-P0 board states needed identical perspective-1 swap. A prior version with duplicated swap logic would have been a perfect divergence trap; the shared pure-function form is genuinely DRY. Spec at duel-context.spec.ts:111 explicitly cross-references it.
- **GAME_EVENT_TYPE_MAP exhaustiveness check via TS Record<…, true>**
  - Evidence : front/src/app/pages/pvp/duel-page/duel-event-processor.ts:21-30 — `Record<GameEvent['type'], true>` forces a compile error if a new variant is added or removed. Combined with `BOARD_CHANGING_EVENT_TYPES` at duel-server/src/ws-protocol-shared.ts:219-225 (used both server- and client-side via the byte-synced barrel).
  - Why it matters : Replaces a hand-maintained Set with a compiler-enforced invariant. This is exactly the automated gate that F9 and F10 lack — and it shows the team can do it. The pattern should be extended to chain-state-tracker.spec parity (see weakness W1).
- **Configurable boot invariant forces module wiring discipline**
  - Evidence : duel-server/src/configurable.ts (factory); server.ts boot-invariant block lists all `isXxxConfigured()` checks; 10 modules use this pattern (worker-message-router, fork-handlers, etc.). Documented in CLAUDE.md → 'Server Module Configuration'.
  - Why it matters : Forces module init order to be explicit and fail-fast at server startup. Without this, the modular extracts of worker-message-router/fork-handlers/timer-management would silently no-op until the first inbound message — a class of bug structurally prevented.
- **Single DuelEventProcessor instance per session (no shared/sync)**
  - Evidence : duel-event-processor.ts:57 — plain class, instantiated locally by `DuelConnection` constructor (duel-connection.ts:174) and `ReplayDuelAdapter` constructor (replay-duel-adapter.ts:32). γ-c PR2 c8 dropped `sharedProcessor` ctor option (CLAUDE.md → 'Chain Event Processing & State Machine'). SOLO multiplex uses 1 conn → 1 processor; PvP uses 1 conn → 1 processor; Replay uses 1 adapter → 1 processor.
  - Why it matters : Eliminates the 'two processors disagree at switchPerspective' class of bug structurally. The fact that `bug-solo-sequence.md` (chain orpheline) was killed by collapsing to 1 conn rather than synchronizing 2 is a textbook case of the right kind of refactor.

**Dettes identifiées** :

- **[HIGH] F9 cross-side chain-state parity has NO automated gate — by admission** ❌ **REFUTED**
  - Principe : Maintenance / regression-fence discipline (the doctrine itself acknowledges the gap)
  - Evidence : CLAUDE.md → 'Cross-side chainPhase parity (F9)' explicitly states 'There is currently NO automated gate ; review-time discipline is the protection.' Server transition table at duel-server/src/chain-state-tracker.ts:57-85 (`applyChainTransition`). Client equivalent split across duel-event-processor.ts:156-210 (`_processMessageInner` for CHAINING/NEGATED) and lines 235-263 (`applyChainSolving`/`applyChainEnd` driven from queue). chain-state-tracker.spec.ts pins only server side; duel-event-processor.spec.ts pins only client side. No spec correlates the two transition matrices.
  - Impact : A future contributor adding e.g. a `pending` sub-phase server-side to fix some reconnect edge case would update `applyChainTransition` + its spec, see green, and ship. The client `restoreChainState(links, phase)` would receive a phase value the union `'idle'|'building'|'resolving'` can't hold. TS would catch the literal type mismatch IF the server sub-phase was added to the shared `ws-protocol`, but if it stays internal to `ChainStateContainer` (it currently is — server-internal mirror) the drift goes unnoticed until a real reconnect mid-chain.
  - Cleanup : Add a single shared `CHAIN_TRANSITION_MATRIX` constant (or a type-level mapping) in `ws-protocol-shared.ts` listing `{type, fromPhases, toPhase}` per chain message. Both sides import it and the tests assert the actual implementations match the matrix entries. Cheaper alternative: a small `parity.spec.ts` that drives the SAME message sequence through `applyChainTransition` (server) and a synthetic harness wrapping `_processMessageInner` + `applyChainSolving/End` (client) and asserts equivalent final `chainPhase` + `activeChainLinks.length`. Effort: medium (1-2 days).

- **[HIGH] F10 cost-board-sync parity is TWO DIFFERENT MECHANISMS with no automated gate** ❌ **REFUTED**
  - Principe : DRY / regression-fence — 'parity by construction' is claimed but the construction is two independent code paths in two languages of intent (message emission vs state segmentation)
  - Evidence : PvP: duel-worker.ts:1376-1380 emits an extra `BOARD_STATE` via `port.postMessage({ type: 'WORKER_MESSAGE', ... buildBoardState() })` when `hasCostMoves` flag (line 1318/1354) is set at `MSG_CHAIN_SOLVING`. Replay: replay-precompute.ts:407-413 flushes a `PreComputedState` segment on `MSG_CHAINING` via `flushState(...)`. Different message (BOARD_STATE vs segmentation), different ORDER vs MSG_CHAINING (PvP after, Replay before). Grepping for 'F10' or 'hasCostMoves' in *.spec.ts returned 0 results. CLAUDE.md → 'Intermediate post-cost board sync (F10)' explicitly enumerates 2 ways this can break ('Server splits the PvP path' / 'Client adds a sync consumer that depends on ORDER vs MSG_CHAINING').
  - Impact : The most likely break is the client-side scenario: a future projection or manager keys off `chainPhase === 'building'` at sync time. In PvP that fires (sync is after MSG_CHAINING); in Replay it doesn't (sync is before). A bug would manifest only in Replay, only on chains with cost MOVE events, only for the specific zone the new consumer cares about — exactly the kind of long-tail divergence that doesn't surface in unit tests.
  - Cleanup : DEEP — hoist the intermediate sync into a shared utility callable from both `runDuelLoop` and `runReplayPreComputation`. Concretely: replace both the duel-worker.ts:1376 special-case branch AND the replay-precompute.ts:407 MSG_CHAINING flush with a call to `emitCostBoardSync(emit, hasCostMoves, buildBoardState)` that wraps the predicate. CLAUDE.md already names this fix ('the right fix is probably to hoist…') but explicitly defers it ('if a future bug surfaces a divergence here'). The doctrine is a tombstone for a chantier.

- **[MEDIUM] The 5+ `session.soloMode` branches in broadcastMessage + 8 in server.ts are NOT unified** ❌ **REFUTED**
  - Principe : SRP / Open-closed — adding a 4th mode (e.g. a future demo mode or tutorial) would require touching each of these sites individually; the abstraction of 'session phase routing' is implicit.
  - Evidence : worker-message-router.ts has soloMode/forkMode checks at lines 93 (no timer init), 161-162 (cancel rollback dest), 226 (no replay persist), 266 (mode tag), 339 (omniscient filter). server.ts has further checks at 324, 595, 654, 715, 1104, 1117, 1123. Each branch is small but they are scattered: timer init, cancel dest, persist skip, omniscient filter, rematch skip, log tag. The 'Fork-solo unification (F5-bis)' doctrine documents the 3 fork-specific behavioral differences but admits the broader soloMode branching is by design.
  - Impact : When a 4th mode is introduced (or even when reading the current 3), discoverability is low: a contributor must `grep -r session.soloMode` to find every gate. Some branches are positive (`if (soloMode)`), some negative (`if (!soloMode)`), some compound (`session.forkMode ? 'fork_solo' : (session.soloMode ? 'solo' : 'pvp')`). Each is correct, but the set of branches is the de-facto definition of 'modes' — and it's spread across 5+ files.
  - Cleanup : Medium chantier. Define a `SessionMode = 'PVP' | 'SOLO' | 'FORK_SOLO'` discriminant with a `getSessionCapabilities(mode)` helper returning `{ usesTurnTimer, persistsReplay, armsRematch, omniscientFilter, modeTag }`. Each call site becomes `if (caps.usesTurnTimer)` etc. The 3 modes are then defined in ONE place (capabilities table) and adding a 4th is a single-file change. Lower-effort alternative: a `MODE_TAGS` constant for the mode tag (used at worker-message-router.ts:266) and keep the rest inline.

- **[MEDIUM] 7 lock-assert sites (F19) repeat the same `assertNoLocks(site)` pattern with no unified guard** ❌ **REFUTED**
  - Principe : DRY (low-level), KISS — the wrapper would make the contract self-documenting
  - Evidence : front/src/app/pages/pvp/duel-page/duel-connection.ts:825 ('cleanup'), 1393 ('REMATCH_STARTING'), 1649 ('onStateSync'); animation-orchestrator.service.ts:996 ('resetAllState'); replay-duel-adapter.ts:154 ('feedTransition'), 191 ('feedTransitionPhased'), 246 ('advanceStep:done'). All 7 call `this.rbs.assertNoLocks(<site-string>)`. Pattern: before `commitAll()`/`commitX()` on a transition boundary, assert clean. The 3 voluntary-skip sites are documented but the doctrine has 'currently NO automated gate' on which boundaries SHOULD assert.
  - Impact : When a 8th transition boundary is added (e.g. a new pause/resume path, or a future demo seek), the contributor must remember to call `assertNoLocks` with a fresh site-string. If they forget, the boundary silently masks lock leaks. The doctrine list is the only enumeration of WHICH boundaries assert — there's no compile-time discovery.
  - Cleanup : Low-effort: a `transitionBoundary(site: string, fn: () => void)` helper on `RenderedBoardStateService` that does `assertNoLocks(site); fn(); /* optionally other discipline */`. Call-sites become `this.rbs.transitionBoundary('REMATCH_STARTING', () => this.rbs.commitAll())`. The 3 voluntary-skip sites stay with raw `commitAll()` and a comment, surfacing the asymmetry. Side benefit: future telemetry (e.g. counter of transitions per boundary) lands in one place.

- **[MEDIUM] False symmetry: `_processMessageInner` (sync) vs `applyChainTransition` (sync) — they handle MSG_CHAIN_SOLVING differently** ❌ **REFUTED**
  - Principe : LSP-adjacent — two `applyChainTransition`-shaped functions that diverge in phase semantics. A reader expecting symmetry from the naming will misread the boundary.
  - Evidence : Server applyChainTransition (chain-state-tracker.ts:63-66): MSG_CHAIN_SOLVING flips `chainPhase = 'resolving'` synchronously on receipt. Client _processMessageInner (duel-event-processor.ts:188-192): MSG_CHAIN_SOLVING only ENQUEUES via `this.enqueue(msg)` and commits pending entry; the actual `chainPhase = 'resolving'` flip happens in `applyChainSolving(idx)` (line 235) called from the queue runner LATER. CLAUDE.md F9 doctrine says 'the asymmetry is intentional' (one tracks wire state, the other animation state).
  - Impact : The CHAIN_STATE reconnect handshake is the bridge: server emits its snapshot, client calls `restoreChainState(links, phase)`. If the client is in a state where the queue is still draining (server phase=`resolving`, client phase=`building`) AND a reconnect fires AND the snapshot says `resolving` — the client now skips the queue-driven `applyChainSolving` and surfaces in `resolving` with the queue not yet drained. Verified: `restoreChainState` (duel-event-processor.ts:266-270) directly `set`s without draining. The window is bounded but exists.
  - Cleanup : MEDIUM — either (a) accept the asymmetry but spec-pin the reconnect-mid-resolving scenario (a single integration test that fires CHAIN_STATE while the client queue has CHAIN_SOLVING pending), or (b) align names so the parallel isn't misleading: rename the client's `_processMessageInner` chain branches to make explicit they ENQUEUE rather than TRANSITION. The current naming + 'mirror' wording in chain-state-tracker.ts:6 invites the wrong mental model.

- **[MEDIUM] Per-event boardStateAfter sanitization at server PLUS swap at front — two places relying on perspective convention drift** ❌ **REFUTED**
  - Principe : SRP — sanitization, perspective-relativization, and per-event snapshot routing are 3 concerns interleaved across 3 files; the partial-relativization TODO is the smoking gun.
  - Evidence : Server sanitize: message-filter.ts:50-61 — `if (result && 'boardStateAfter' in result && result.boardStateAfter)` adds `sanitizeBoardState(boardStateAfter, forPlayer, omniscient)`. Server `sanitizeBoardState` (line 242) swaps `players[]` + `turnPlayer` but TODO at line 247: 'MSG_* `player` fields still use absolute OCGCore indices'. Front then has TWO additional swaps: SOLO at duel-connection.ts:628-633 (`_maybeSwapBoardStateAfter`) and Replay at replay-duel-adapter.ts:158 (`swapEvents`). All three operate on the same field, with the same partial scope (top-level players + turnPlayer).
  - Impact : The 'controller/player fields stay absolute' invariant is a footgun. Documented in CLAUDE.md → 'Perspective Convention' but each consumer site (chain-badges, linked-zone-map, EMZ resolver) must re-discover it. New code reading `card.controller` from a `boardStateAfter` snapshot will see absolute server indices even when `players[]` is relative — exactly the F6 bug class.
  - Cleanup : DEEP — finish Story 4.2 (per the TODO at message-filter.ts:247). Either fully relativize `player`/`controller` in `sanitizeBoardState` (so the front gets purely relative payloads) OR document the invariant via a branded type `AbsolutePlayer extends number` vs `RelativePlayer extends 0 | 1` so the type system distinguishes them. Until then, an unbounded class of future bugs is gated only by reviewer discipline.

- **[MEDIUM] `runReplayPreComputation` and `runDuelLoop` re-implement the same overlay capture + chain-tracking + transform loop** ✅ **CONFIRMED**
  - Principe : DRY — the two loops are ~80% identical in structure; the only real divergence is the emission strategy at the end (live broadcast vs batched state)
  - Evidence : duel-worker.ts:1289-1382 (PvP: `capturePreProcessOverlays` → `buildSettlingSourceFifo` → `duelProcess` → for-each-message → `updateState` → `transformMessage` → `liveChainTracker.process` → `port.postMessage`) vs replay-precompute.ts:309-435 (Replay: `capturePreProcessOverlays` → `buildSettlingSourceFifo` → `duelProcess` → for-each-message → `updateState` → `transformMessage` → `chainTracker.process` → `flushState/events.push`). Both invoke the same OCG helpers but diverge in emission (port.postMessage vs PreComputedState segmentation).
  - Impact : Every fix to one loop (e.g. β.3 cas #12 overlay capture, or the F10 cost-sync logic) must be re-applied to the other manually. The β.3 cas #12 commit history shows comments at both sites referencing each other — confirming the dual-maintenance burden. Risk: a future OCG-related fix is applied to PvP and forgotten in Replay (or vice versa), producing replay desync that only surfaces in long-tail scenarios.
  - Cleanup : MEDIUM-DEEP — extract a `runOcgEventLoop({onMessage, captureSnapshot, ...})` higher-order function in a new `ocg-event-loop.ts`. PvP's `onMessage` posts to the worker port; Replay's `onMessage` updates the `events[]` array + flush-on-MSG_CHAINING. Both share the snapshot tracker, the overlay capture, the FIFO. Effort: 2-3 days. Major win: future OCG quirks are fixed in ONE loop.

- **[LOW] Replay precompute has its own MSG_CHAIN_END / boundary logic separate from `ChainSnapshotTracker`**
  - Principe : SRP — `replay-precompute` mixes 'OCG event loop' + 'PreComputedState segmentation' + 'chainIndex grouping for timeline label finalization' in one 250-line function.
  - Evidence : replay-precompute.ts has 2 separate chain-tracking concerns: (1) `chainTracker.process` (line 384) for `boardStateAfter` snapshot — uses the shared class. (2) `activeChainIndex` (line 289) + the MSG_CHAINING/MSG_CHAIN_END branches at 407-431 for chainIndex grouping in PreComputedState — entirely local logic. Compare to PvP which has none of this (chain grouping happens client-side via the front's chain manager).
  - Impact : When timeline display rules change (e.g. a future 'show negated links inline' UX), the segmentation logic at replay-precompute.ts:407-431 must change in lockstep with the front consumer in `subEventSegments` (game-log-builder etc.). The dependency is undocumented except via 'replay precompute emits PreComputedState which the front consumes' — broad and unaudited.
  - Cleanup : LOW-MEDIUM — extract a `PreComputedStateBuilder` class with explicit `flush(label, decisions?)` / `openChain(idx)` / `closeChain()` methods. The main loop calls into it; the segmentation rules live in one testable class. Aligns with the H3.5 extraction pattern already used for `runReplayPreComputation` itself.

- **[LOW] `assertNoLocks` warns at 7 sites but NOT at `processAnimationQueue` finalize (the natural lock-leak detection point)**
  - Principe : Robustness — the assertion catches transition-boundary leaks but not mid-pipeline leaks. The QueueRunner finalize is precisely the moment a mis-paired lock/commit would surface.
  - Evidence : CLAUDE.md → 'Replay Board State Parity Rule' enumerates the 7 sites: STATE_SYNC, REMATCH_STARTING, cleanup (duel-connection); resetAllState (orchestrator); feedTransition, feedTransitionPhased, advanceStep:done (replay-duel-adapter). The doctrine explicitly lists 'NOT asserted' sites (collapseRemainingSteps, abort, jumpToState). But the queue-empty finalize path (animation-orchestrator.service.ts queue-runner) doesn't assert either — yet a leak there is the most common 'animation handler forgot to commit a lock' bug class.
  - Impact : A new event handler that calls `rbs.lockZone(X)` but forgets `commit/release` in the error path will leak silently. The lock survives the queue finalize, gets carried into the next event's commitUnlocked() — masking the leak via auto-commit. The bug only surfaces if the next event is a no-op or the duel ends, hitting `cleanup` assert hours later with site='cleanup' (useless for debugging).
  - Cleanup : LOW — add `rbs.assertNoLocks('queueFinalize')` in the QueueRunner's `'finalize'` case after the chain phase check. If this fires false-positive during legitimate mid-chain holds, downgrade to a `warn` with the active lock set captured for telemetry. The dev experience improves dramatically: leaks surface at the offending event, not 30 minutes later at duel end.

- **[LOW] `DuelConnection` and `ReplayDuelAdapter` re-implement same `processor` wiring + same chain-method delegation**
  - Principe : DRY (lite) — the `AnimationDataSource` interface contract has ~10 methods, ~6 of which both implementations delegate identically to `processor`.
  - Evidence : duel-connection.ts:174-179 (`processor`, `rbs`, `renderedBoardState`, `boardStateView`) and replay-duel-adapter.ts:32-37 (identical 4 readonly fields with same comment 'audit L25'). duel-connection.ts:800-809 (`applyChainSolving`/`applyChainSolved`/`applyChainEnd` thin delegates) vs replay-duel-adapter.ts:73-83 (same 3 delegates, identical bodies). The `attachOutOfBandSink` is also implemented twice identically (duel-connection has it inline; replay-duel-adapter.ts:97-99 = `this.processor.onEvent = sink`).
  - Impact : Adding a new processor method (e.g. a future `applyChainNegated`) requires adding 3 lines × 2 files. Low impact today but every contract evolution doubles the surface. Adapters drift if a fix is applied only on one side.
  - Cleanup : LOW — extract a `DuelEventProcessorBackedDataSource` abstract base class (not Angular service — plain class) holding `processor`, `rbs`, `renderedBoardState`, `boardStateView`, plus the 6 delegate methods. `DuelConnection` extends it (adds WS-specific bits); `ReplayDuelAdapter` extends it (adds step-queue bits). Or use TypeScript mixins. Effort: half-day. NOT a forced refactor — current duplication is small — but a logical follow-up if the contract grows.

- **[LOW] `SELECT_MESSAGE_TYPES` exists in 2 forms across server modules**
  - Principe : DRY — same conceptual set ('what counts as a prompt') in two representations with different evolution histories
  - Evidence : worker-message-router.ts:63-72 — `SELECT_TYPES` set of string-tag types (uses our DTO types). replay-precompute.ts:38-60 — `SELECT_MESSAGE_TYPES` set of `OcgMessageType` enum values (uses ocgcore-wasm types). Both enumerate select-class prompts; both have evolved over time (replay-precompute also includes `ROCK_PAPER_SCISSORS`, worker-message-router includes `DICE_ROLL`/`SELECT_FIRST_PLAYER` post-2026-05-13).
  - Impact : Adding a new prompt type (e.g. a future hypothetical SELECT_RACE_TUPLE) requires updating both sets, knowing the right representation for each. The 2 lists drift; the duel-server prebuild check syncs ws-protocol-*.ts files but does NOT cross-check these enumerations.
  - Cleanup : LOW — define `SELECT_MESSAGE_KINDS: ReadonlySet<ServerMessage['type']>` in `ws-protocol-prompts.ts` (the byte-synced module). worker-message-router consumes it directly. replay-precompute keeps its `OcgMessageType` set but adds a test asserting the mapping `ocgcoreToServerType(t) ∈ SELECT_MESSAGE_KINDS ⇔ t ∈ SELECT_MESSAGE_TYPES`. Effort: 2-3 hours.

- **[LOW] `ActiveDuelSession.activeChainLinks` + `chainPhase` fields are spread on the session object rather than nested in a `chainState`**
  - Principe : Encapsulation — the chain state could be `session.chainState: ChainStateContainer` and `applyChainTransition` would take that nested object. The current spread pattern means any code reading `session.chainPhase` is implicitly coupled to ChainStateContainer.
  - Evidence : ChainStateContainer (chain-state-tracker.ts:15-29) has 4 fields: activeChainLinks, chainPhase, negatedChainIndices, currentSolvingChainIndex. Server.ts:588 does `Object.assign(session, emptyChainState())` — spreads them onto the session. worker-message-router.ts:274 calls `applyChainTransition(session, message)` treating session AS ChainStateContainer. Same fields are referenced individually at worker-message-router.ts:182-185 (`session.activeChainLinks = []` etc.) for cancel handling. The chain state is structurally part of the session but its identity is preserved only by the shared interface.
  - Impact : When adding a 5th chain state field (e.g. a `chainResolutionStartedAt` for telemetry), it lands as a fresh top-level session field — drift between ChainStateContainer and 'whatever fields the session actually has'. The `Object.assign` pattern hides the schema.
  - Cleanup : LOW — nest: `session.chainState: ChainStateContainer = emptyChainState()`. `applyChainTransition(session.chainState, message)`. Cancel handler updates `session.chainState.activeChainLinks` etc. Effort: 1 day (touches ~15 call sites). Defer if no chain-state evolution is planned.

- **[LOW] Worker `forkMode` (module-level boolean) and session `forkMode` field share a name but have different scopes — easy reader confusion**
  - Principe : KISS — same name, different scope, different concern, in different processes. Maximum confusion.
  - Evidence : duel-worker.ts:1676 `let forkMode = false;` (module-level worker-side concern — gates `capturedSetResponse` bypass, skips `emitReplayData`). ActiveDuelSession.forkMode (server-side concern — gates persist/rematch/log tag in worker-message-router.ts). CLAUDE.md → 'Worker forkMode variable (not the same as session.forkMode)' explicitly notes the naming collision and the different scopes. The doctrine acknowledges the trap.
  - Impact : A future contributor reading worker code sees `if (!forkMode) emitReplayData()` and may assume the same flag flows from session config. It doesn't — the worker's `forkMode` is set by INIT_REPLAY_FORK message receipt, not by the server's session schema. The doctrine acknowledges the trap with a dedicated section heading.
  - Cleanup : LOW — rename worker-side variable to `workerForkMode` or `isForkBootstrap`. Effort: 10 minutes. Removes the documented cognitive trap entirely.

- **[LOW] `AnimationDataSource` interface admits 'mode-specific surfaces' that bypass the contract**
  - Principe : OCP / Interface segregation — the interface ostensibly abstracts PvP vs Replay, but consumers that need mode-specific behavior still inject the concrete class. The abstraction is leaky by design.
  - Evidence : animation-data-source.ts:81-95 — JSDoc explicitly lists 4 'NOT part of this contract' methods/fields: `attachDrawNewTurnSink`, `onStateSync`, `setBoardActive`, plus the entire `ReplayDuelAdapter` step-queue API. Consumers reach these 'via a direct concrete injection'. The interface itself has 10 members; the bypasses are 4+ additional surfaces.
  - Impact : Page bootstrap code must know which concrete service to inject for which surface. Discovery of 'what's available where' relies on reading the JSDoc comment carefully. A new contributor adding a feature that needs SOLO+Replay capability may not realize replay-page injects ReplayDuelAdapter directly (bypassing the token).
  - Cleanup : LOW — accept the design but enforce it: a `ReplayOnlyMethods` and `PvpSoloOnlyMethods` interface in the same file, each documenting its own contract. Concrete classes implement `AnimationDataSource & ReplayOnlyMethods` or `AnimationDataSource & PvpSoloOnlyMethods`. Consumers inject the union type they need. Effort: 1 day. Side benefit: TS can flag a SOLO-only call from replay page (or vice versa).

- **[LOW] Front-end `restoreChainState` skips draining the animation queue — possible reconnect-mid-resolving drift**
  - Principe : Robustness — the restore method assumes a clean queue without enforcing it.
  - Evidence : duel-event-processor.ts:266-270 — `restoreChainState(links, phase)` directly sets `_activeChainLinks` + `_chainPhase` + clears `_pendingChainEntry`. Does NOT touch `_animationQueue`. CLAUDE.md → 'Cross-side chainPhase parity (F9)' references the reconnect handshake but doesn't pin the queue-state contract on restore. If a reconnect fires while the queue has [..., MSG_CHAIN_SOLVING, MSG_CHAIN_END] pending, `restoreChainState('resolving')` sets phase but the queue still drives `applyChainSolving`/`applyChainEnd` — phase ping-pongs.
  - Impact : In practice, the wider STATE_SYNC handler (duel-connection.ts:_applyStateSync at 1646) calls `this.processor.reset()` (clears queue) BEFORE the CHAIN_STATE restore consumes the buffered payload. So the bug is masked by the STATE_SYNC ordering. But the masking is implicit — if a future flow restores chain-state via a different path, the queue-not-cleared invariant breaks silently.
  - Cleanup : LOW — `restoreChainState` should either (a) assert `_animationQueue().length === 0` via duelAssert (making the invariant explicit) or (b) `resetQueue()` defensively. Either way, the contract becomes self-documenting. Effort: 30 minutes + spec update.

---

### EventStream + game-log + projections

**Forces identifiées** :

- **Single convergence point `pushToStream` for the EventStream**
  - Evidence : animation-orchestrator.service.ts:1064-1069 (`pushToStream`) — 1 site that increments ref, updates the signal, AND feeds the DEP; all in-queue dispatch, out-of-band sinks, runner internal events, group dispatch, and LP directive go through it (lines 492, 550, 589, 1146, 1367, 1390, 1414, 1533)
  - Why it matters : Closes the W1 finding from β.2a code-review. A single line change to push ordering (e.g. adding a counter, telemetry hook, or new derived event) propagates everywhere without scavenger-hunt. The DEP, projections, journal all observe identical arrival order — PvP↔Replay parity is structural not behavioural.
- **Strict ResetTarget / BaseProjection layering with abstract `scope`**
  - Evidence : base-projection.ts:38-48 declares `abstract readonly scope` (so a subclass that forgets it does not compile — explicit reference to the regression of commit 853e3374). reset-target.ts:40-43 is the slim interface; BaseProjection is a strict superset.
  - Why it matters : The compile-time guard turns a former runtime-time/code-review-time invariant into a build error. The split lets managers (Chain, Lp, Battle, Log) participate in scope cascade without paying the projection-purity cost, while β.3 projections get the read-only signal extraction. Two contracts, layered cleanly — not three contracts mashed together.
- **Scope cascade is one well-tested pure function**
  - Evidence : scope.ts:40-54 (`expandInvalidatedScopes`) — anchors on shallowest, fills strictly below. P9 hardening 2026-05-26 fixed the non-contiguous gap. scope.spec.ts exercises it; scope-reset-dispatcher.ts:77-84 is the only caller.
  - Why it matters : DUEL → CONNECTION → PERSPECTIVE cascade is a single pure call, not duplicated chains of `manager.reset()` across files. Adding a new scope category is local (one array literal). Caller passes top-most scope; the dispatcher does the work.
- **BoundaryProcessor is small, pure, and self-contained**
  - Evidence : boundary-processor.ts (259 LOC total): 3 observation entry points (`observeMessage`, `observeBoardState`, `forceClosure`), 2 internal mutable fields (`chainOpen`, `lastTurn`, `lastPhase`), no DI, no signal, no async. Sink injected at construction.
  - Why it matters : A 259-line plain class with one responsibility — detect causal-group boundaries. Test surface is finite, transitions are deterministic, no Angular lifecycle to fight. This is the shape the rest of the subsystem aspires to.
- **Shared `drainStream` harness eliminates duplicated drain logic**
  - Evidence : drain-stream.ts (68 LOC) shared by `BaseProjection.attachEventStream` (base-projection.ts:97-109) and `DuelGameLogService.attachEventStream` (duel-game-log.service.ts:340-348). F11 (2026-05-31) extracted from two near-identical effects.
  - Why it matters : Idempotency contract + stream-wipe contract codified once. The orchestrator can call `_eventStream.set([])` confidently knowing both kinds of consumers regression-sync their cursor. Reduces the surface area where 'one of N projections wedges on a wipe' could ship.
- **Architecture guard against unbounded RewriterRule growth**
  - Evidence : deferred-effect-processor.ts:136-159 — `ARCHITECTURE GUARD` block on `RewriterRule`. `deferred-effect-rules.ts:296-301` exports `xyzLeaveWithMaterials` for an invariant test that pins the unique rewriter by identity.
  - Why it matters : Explicit Rule-of-Three discipline: a 2nd RewriterRule triggers an architecture review and likely extraction of `FlowRewriteProcessor`. Prevents the DEP from accreting a flow-rewrite family inline. The export-for-test pattern resists rename evasion.
- **Server-side game-log builder is a pure, dependency-free module**
  - Evidence : duel-server/src/game-log/game-log-builder.ts:1-12 'PURITY CONTRACT' — imports only protocol types; no `replay-*`, `duel-worker`, `ws`, `fs`/`net`, browser API. i18n keys, not strings (line 132-138).
  - Why it matters : Reusable production brick. Same builder feeds PvP live, replay precompute, dev CLI, future tooling. Language-agnostic by construction. The constraint is enforced by file-header docblock; brownfield-safe because there are no imports to refactor.

**Dettes identifiées** :

- **[HIGH] Orchestrator (1985 LOC) is the central god-class — adding a projection touches 6 ceremonies** ✅ **CONFIRMED**
  - Principe : SRP / OCP / Miller's Law
  - Evidence : animation-orchestrator.service.ts: declare field (line ~355), construct in constructor with deps (line ~366), register w/ dispatcher (line ~626), attachEventStream (line ~627), detachEventStream in destroy (line ~929), document in CLAUDE.md projections table. Plus optional manager-side wiring + spec file + index.ts re-export.
  - Impact : Adding an 8th projection means a developer must edit 4 files (.projection.ts, index.ts, animation-orchestrator.service.ts ×3 sites, optional manager). Each site is silently load-bearing; missing the `detachEventStream` is an effect-leak; missing the `register` makes `applyReset` silently no-op. Reviewers cannot tell at a glance whether all 6 are wired. Subsystem hostility scales linearly with N.
  - Cleanup : deep — Extract `ProjectionRegistry` that owns the `register + attachEventStream + detachEventStream` triad behind one `mount(projection)` / `unmount(projection)` call. Or introduce a single `registerProjections([...])` helper that closes the asymmetry. Move the `target-zone-keys.detachEventStream()` omission into a smoke spec that walks all `BaseProjection` fields via reflection.

- **[HIGH] AnimationStarted SYNC vs AnimationCompleted WALL-CLOCK — semantic split documented but fragile** ❌ **REFUTED**
  - Principe : KISS / least surprise
  - Evidence : animation-orchestrator.service.ts:1082-1106 (sync emit), runner `onStepSettled` callback at line 537-555 (wall-clock emit), processDirective.group line 1362-1371 (group post-Promise.all loop), processDirective.lp line 1408-1419 (setTimeout-based emit for buffered LP), Standardisation 1 `phaseWait` at line 487-500 (yet another emission mechanism).
  - Impact : 5 distinct paths emit `Animation*` events: dispatch path, group path, lp directive path, phaseWait path, runner onStepSettled path. A future rule writer authoring a chainTo predicate `{kind:'animation', type:'AnimationCompleted', ref:matchedRef}` needs to know whether the matched event went through the standard dispatch or a directive, because the timing semantics differ. Comments documenting this are scattered (lines 1082-1106, 1270-1278, 1362-1371, 1393-1419). The β.2b history note 'sync emission would fire EffectReady same frame' confirms a real bug was caught here.
  - Cleanup : deep — Centralize via a `AnimationLifecycleEmitter` that all 5 sites call. Or split the event types: `AnimationDispatched(ref)` (sync) and `AnimationSettled(ref)` (wall-clock). Rules then narrow on the right one explicitly. Document the contract in animation-constants.ts or a sibling `animation-lifecycle.ts` file.

- **[HIGH] `_transport_lastDispatchedRef` side-channel is a hidden coupling between processEvent and 5 emit sites** ❌ **REFUTED**
  - Principe : encapsulation / least surprise
  - Evidence : animation-orchestrator.service.ts:317-319 declares the field. processEvent line 1492 reset to null, line 1533 set after pushToStream. Consumed by: emitAnimationStarted (1102), onStepSettled (532, 549), phaseWait (488), processDirective.group (1347), processDirective.lp (1391). 7 readers across 4 methods.
  - Impact : The field comment claims 'safe because processEvent is fully synchronous from entry to return; the side-channel never holds across an await'. But phaseWait (line 488) reads it inside a synchronous prefix of an async function — relies on the handler not awaiting before phaseWait. If a future handler awaits THEN calls phaseWait, the side-channel may have been overwritten by the next `processEvent`. The comment is the only guarantee; no compile-time enforcement.
  - Cleanup : deep — Pass `ref` explicitly to handlers (refactor `processEvent` signature to return ref alongside result, or pass a `dispatchContext` argument with `ref` populated). Removes the field, removes the contract documentation, makes the dependency explicit at every call site. Mechanical refactor over ~25 handlers.

- **[MEDIUM] Asymmetric detach: `targetedZoneKeys.detachEventStream` missing from `destroy()`** ✅ **CONFIRMED**
  - Principe : symmetry / robustness / DRY
  - Evidence : animation-orchestrator.service.ts:659-660 registers + attaches `targetedZoneKeys`. The destroy block 928-933 detaches `overlayShowReady`, `counterPulse`, `animatingZone`, `isAnimating`, `swapGraveDeckKeys`, `lpTracker.animatingLpPlayerProjection` but NOT `targetedZoneKeys`.
  - Impact : Latent effect leak on hard teardown (rematch, navigation away). Angular's component-scoped `DestroyRef` masks it in production today, but the orchestrator's own docblock (lines 924-927) says explicit detach is defense-in-depth. The asymmetry directly confirms the previous finding: 7 projections × 6 ceremonies => 42 sites, and one slipped.
  - Cleanup : Add `this.targetedZoneKeys.detachEventStream()` to destroy(), then refactor into a `_projections: BaseProjection<unknown>[]` array iterated in both `attach` and `destroy` to make this asymmetry impossible.

- **[MEDIUM] F15 'Dual-purpose signal' carve-out signals BaseProjection is the wrong shape for some flux state** ❌ **REFUTED**
  - Principe : abstraction-cost / OCP
  - Evidence : animation-orchestrator.service.ts:662-667 — F15 retired the `ChainResolutionAnnounceProjection` because a single signal serves BOTH reactive UI AND a sync predicate inside the manager. CLAUDE.md doctrine 3-bis (lines 661-... in this audit's context) formalised this as an exception.
  - Impact : Tells a future reader: 'sometimes a manager-owned `signal()` exposed via `asReadonly()` is the right answer, and the projection class is overhead.' But the dispatcher / registry / drainStream contract doesn't acknowledge this — there's no first-class 'manager-projection' lane. Each future case has to weigh BaseProjection vs Doctrine 3-bis vs ResetTarget-only with no compile-time guide. Risk of subjective drift in 6 months.
  - Cleanup : Either (a) accept BaseProjection covers ~80% and the remaining 20% lives in managers as ResetTarget (current state) and add a lint rule that flags any `asReadonly()` on a class not implementing ResetTarget; OR (b) deep — split BaseProjection into `FluxProjection<T>` (current shape) and `ManagerProjection<T>` (single sync read + reactive expose) and remove the doctrine carve-out.

- **[MEDIUM] Three drops 'by design' (chainOverlayBoardChanged, confirmRevealedCards, slot 3.2) hint at YAGNI debt in the projection model** ❌ **REFUTED**
  - Principe : YAGNI
  - Evidence : CLAUDE.md β.3 table 'Permanent drops (by design)': `chainOverlayBoardChanged` (Lot 2.1) → replaced by `hasBufferedEvents` getter; `confirmRevealedCards` (Lot 2.5) → orphelin, never set in prod; slot 3.2 (F15) → ChainResolutionAnnounceProjection retired.
  - Impact : Three of ten planned projection slots failed the model fit. ~30% miss rate suggests the projection enumeration in §3.9 was speculative. Future devs reading 'we have 7 projections' may not realise 3 candidates were tried and rejected — the apparent ratio of 7 successes hides that 7/10 is the actual hit rate.
  - Cleanup : Document the rejected slots in `projections/index.ts` or a short `dropped.md` so a developer faced with a 'new projection candidate' can see the historical 'what didn't fit' pattern. Doctrine 1-4 (CLAUDE.md) is decent but high-level; the concrete drops are the load-bearing teaching.

- **[MEDIUM] DEFERRED_TIMEOUT_MS = 5000 is a fixed magic number unmoored from animation durations** ❌ **REFUTED**
  - Principe : robustness / configurability
  - Evidence : animation-constants.ts:51 `export const DEFERRED_TIMEOUT_MS = 5_000;`. Docblock (lines 41-50) admits 'pre-measurement; β.2b will revisit (DP-3) if T-I2 or e2e SOLO slow-playback shows clipping. NOT scaled by speedMultiplier today'.
  - Impact : Under slow-playback (speedMultiplier=0.5) a chain cost MSG_MOVE travel can take >5s, the deferred times out, `EffectAbandoned(timeout)` fires, the overlay-show projection falls back to graceful degradation (which is 'show anyway'), so the cost-before-overlay test of victory silently regresses. The graceful fallback masks the bug. No telemetry surfaces 'deferred timeouts per duel'.
  - Cleanup : Either scale by `ctx.safetyTimeout(BASE)` (like the queue runner's lock safety) OR explicitly counter-measure on a slow-playback duel + bump to 10-15s. Add a `logger.warn` count surfacing via DuelDebugService.snapshot() so a tester can see 'X deferreds timed out this duel'.

- **[MEDIUM] Two reset paths (`silentReset` vs `applyReset`) with subjective 'when' rule** ❌ **REFUTED**
  - Principe : abstraction-cost / DRY
  - Evidence : deferred-effect-processor.ts:461-476 (silentReset) vs 453-456 (applyReset). animation-orchestrator.service.ts:918-923 'destroy' calls silentReset; resetAllState calls scopeDispatcher.dispatch (which routes to applyReset). BP has the same split (boundary-processor.ts:222-238 forceClosure / 247-251 silentReset).
  - Impact : The 'when to use which' is documented in 4 different docblocks (CLAUDE.md, DEP file, BP file, orchestrator destroy comment) — each says 'silent on hard teardown because the subscriber dies anyway'. A future maintainer adding a new processor will copy one of the four docs; getting it subtly wrong (emit closures into a dying stream → no-op; OR drop without closures when the subscriber lives → orphan UI state) is a latent bug class.
  - Cleanup : Either consolidate into a single `resetMode: 'silent' | 'closures'` parameter on `applyReset(scopes, mode?)` so there's one entry point with two modes, OR introduce a lifecycle marker (e.g. `OrchestratorPhase.Destroying`) that the dispatcher reads to auto-route. The orchestrator's destroy block already lists 4 manager `.reset()` calls + the DEP `silentReset` — it's a hand-coded mirror of what the dispatcher does.

- **[MEDIUM] Doctrine 3-bis is a documentation-only carve-out — easy to drift** ❌ **REFUTED**
  - Principe : convention-over-code
  - Evidence : CLAUDE.md doctrine 3-bis: 'Dual-purpose signal — reactive UI + sync predicate'. Cited as the reason for F15 ChainResolutionAnnounceProjection retirement. No lint rule, no abstract base class encoding this pattern.
  - Impact : A future dev adding a new manager-owned signal exposed via `asReadonly()` AND consumed by a sync predicate will not be flagged. They might create a parallel `BaseProjection` mirror (rebuilding the F15 bug class) because the projection lane is the obvious 'flux state' pattern. The lint rule pipeline-signal-tagged accepts any class implementing ResetTarget as a tag, so neither shape errors.
  - Cleanup : Either add a lint helper rule that warns when a `BaseProjection.value` shape is also read sync-elsewhere via `dataSource.someSignal()` (heuristic), OR codify Doctrine 3-bis as a TS interface `SyncReadableProjection<T>` extending ResetTarget so the choice surfaces at type-time.

- **[MEDIUM] DEP `observe` returns `{absorbed: boolean}` but only one rule (RewriterRule) sets it, and orchestrator does not propagate the signal**
  - Principe : robustness / contract enforcement
  - Evidence : deferred-effect-processor.ts:428-435 returns `{absorbed: boolean}`. animation-orchestrator.service.ts:1064-1069 pushToStream calls `this.deferredProcessor.observe(event, ref)` but discards the return value. The docblock at line 422-427 says 'orchestrator should SKIP the routing aval' on absorbed.
  - Impact : The xyz-leave-with-materials RewriterRule synthesizes virtuals and absorbs settling MSG_MOVEs from the routing aval. But the orchestrator drops the absorbed signal. Either (a) absorb is currently a no-op in production (rewriter wiring still pending per `NO_OP_SINKS` default at line 305 + the 'Pass 1 d'impl Commit 2' note at deferred-effect-rules.ts:344-349), or (b) the contract is incomplete and the routeur sees the settling event anyway. The architecture guard test 'at most one RewriterRule' protects only the count, not the wiring.
  - Cleanup : Either (a) make `observe` return `void` while the rewriter wiring is pending (revert the API surface to match what callers actually use), OR (b) wire the absorbed signal into a fast-return in pushToStream / processEvent. Mark the current state with a `// TODO Commit 2` comment at pushToStream's callsite + a regression spec that asserts the absorbed flag IS or IS NOT consumed.

- **[LOW] `ScopeResetDispatcher.register` is idempotent but `unregister` is silently noop on unknown**
  - Principe : robustness / observability
  - Evidence : scope-reset-dispatcher.ts:49-65 — register uses Set semantics (idempotent), unregister 'Calling unregister on an unknown target is a silent no-op'.
  - Impact : A typo or stale-ref bug (e.g. caller holds an old projection instance after a re-instantiation) silently fails the unregister, leaving the old target in the registry. The old target receives `applyReset` calls forever. Hard to debug because there's no error, no warn, no size check. The lint rule pipeline-signal-tagged catches missing signals but NOT missing dispatcher registrations (CLAUDE.md acknowledges this).
  - Cleanup : Add a `duelAssert(this._transport_targets.has(target), ...)` in unregister at dev mode. The dev throw catches double-unregister + unknown-target. Production stays no-op.

- **[LOW] Game Log filter chain in `notifyGameLog` is 6 isXxxEvent() type guards**
  - Principe : DRY / robustness
  - Evidence : duel-game-log.service.ts:298-325 — `isDevChaining`, `isBoundaryEvent`, `isDeferredFluxEvent`, `isAnimationFluxEvent`, `isInternalTransportEvent`, `isPerspectiveEvent`, `isVirtual` — 7 explicit guards before the ingest path. JournalEvent type alias (line 50-53) is an `Exclude<StreamEvent, ...>` union maintained separately.
  - Impact : The Exclude type and the 7 guards must stay in sync. When β.x adds a new flux family (e.g. transport's `runner-rescue-fired` is already 'one of 5 kinds'), both have to be updated. The TS Exclude catches type-level drift but the runtime guard list is a hand-maintained mirror. If a new event reaches notifyGameLog without a guard, it goes through to GameLogBuilder which silently ignores unknown types — the journal stays correct but the spec for 'what reaches the builder' becomes implicit.
  - Cleanup : Introduce a `JournalEventClassifier.isJournalEvent(e): boolean` central predicate consumed by both the type narrowing and the runtime filter. Or, even simpler: invert the polarity — list the 5 `MSG_*` types the journal cares about and accept-list instead of exclude-list. Smaller surface to maintain.

- **[LOW] Projection 'cast-to-shape' pattern `event as { kind?; type?; msgType? }` repeated in 6 projections**
  - Principe : DRY
  - Evidence : overlay-show-ready.projection.ts:70, counter-pulse.projection.ts:63, animating-zone.projection.ts:80, animating-lp.projection.ts:72, swap-grave-deck.projection.ts:63, targeted-zone-keys.projection.ts:59, is-animating.projection.ts:73 — each `applyEvent` opens with `const candidate = event as { kind?: string; type?: string; ... }` before narrowing.
  - Impact : Each projection re-implements the narrowing scaffold for the FluxEvent union. The actual TS union (`StreamEvent`) is discriminated correctly but using `as Record` casts loses type safety AT each projection. A typo in `'AnimationCompleted'` vs `'AnimationCompleeted'` is a silent miss; only the spec catches it. The union has well-defined discriminants (`kind`, `type`); the projections sidestep them.
  - Cleanup : Add a small `match()` helper or per-family type guard in `projections/flux-event.ts`: `isAnimationCompletedOf(msgTypes: Set<string>)`, `isDeferredFor(prefix: string)`, etc. Each projection then narrows via `if (matchesAnimCompleted(event, LP_MSG_TYPES))` — typed, central, testable.

- **[LOW] Sink errors are swallowed across BP, DEP, and runner — debugging surface depleted**
  - Principe : observability
  - Evidence : boundary-processor.ts:92-93 'Fire-and-forget: the BP does not handle sink failures'. deferred-effect-processor.ts:378-380 'fire-and-forget, the DEP does not handle sink failures'. CLAUDE.md queue-runner section: 'Sink errors are swallowed (fire-and-forget); omitting it is back-compat.'
  - Impact : If the orchestrator's `pushToStream` ever throws (e.g. signal update failure in a future Angular release, OOM on the array spread at line 1066), the BP / DEP / runner emit calls swallow it. The stream gets a partial state and no error surfaces. Three different doctrines say the same thing — robust enough today, but ZERO instrumentation means a regression here is invisible.
  - Cleanup : Either (a) catch + `logger.error('[STREAM-EMIT-FAILURE] %s %o', context, err)` at each sink site (3 lines × 3 sites), OR (b) wrap pushToStream's body in try/catch and bump a counter `DuelDebugService.snapshot().streamEmitFailures`. Catch surfaces during e2e + the debug-replay harness.

- **[LOW] Standardisation 2 `decorateLpEventForStream` runs an O(N) switch on every event for 3 hot LP types**
  - Principe : efficiency (minor)
  - Evidence : animation-orchestrator.service.ts:465-485 — the switch over `event.type` runs on EVERY event going through processEvent (line 1532) and EVERY entry going through processDirective.lp (line 1389). For 26+ event types, only 3 (DAMAGE/RECOVER/PAY_LPCOST) match. The default arm returns the input unchanged.
  - Impact : Microscopic perf cost — 1 typeof check + switch dispatch per event. Negligible. But the API is named for the LP case and called on non-LP events too — semantic mismatch. Reader has to know 'decorate is a passthrough for non-LP'. Adding a 4th decoration concern (e.g. tag MSG_MOVE with damage delta for upcoming `MoveDecorationProjection`) means renaming or branching. The 'shallow clone' contract (line 452-463) is in the docblock only.
  - Cleanup : Either (a) inline the LP_MSG_TYPES check at processEvent before calling: `LP_TYPES.has(type) ? decorate(event) : event` — explicit + visible cost, OR (b) generalise as `decorateForStream(event)` and accumulate dispatcher-style per-type decorators, with a registry pattern. Probably (a) — YAGNI on the generalised path.

---

### WS protocol + parity gates

**Forces identifiées** :

- **Byte-sync script is conceptually solid + has 9 paired files covered**
  - Evidence : scripts/check-ws-protocol-sync.mjs:96-132 declares 9 paired files (6 ws-protocol-* + 2 game-log + ocgcore-reason-flags). The normalizer (lines 41-81) handles `.js` suffix stripping, path stem rewriting (`ws-protocol-X` → `duel-ws-X.types`), game-log sub-directory `../` imports, and the ocgcore-reason-flags cross-tree mirror.
  - Why it matters : Reduces 9 pairs to byte-identical comparison after a small, well-documented set of substitutions. The mechanism is honest about what it covers (paired sub-files, NOT the barrels) and the script's own header explicitly cites this delineation (lines 14-17: 'The two index files are NOT byte-checked').
- **PROTOCOL_VERSION has a belt-and-suspenders gate beyond byte-sync**
  - Evidence : ws-protocol-shared.spec.ts:27-38 reads the front file at test time and pins the literal PROTOCOL_VERSION via regex. duel-server/src/server.ts:836 calls checkProtocolVersionPure (lines 31-42 of protocol-version-check.ts) on every WS connect with comprehensive pure-function tests in ws-protocol-shared.spec.ts:45-110 (8 cases: exact match, missing, mismatch low/high, NaN, empty, whitespace).
  - Why it matters : The most load-bearing constant is double-gated: byte-sync catches structural drift, the vitest test catches semantic drift even if normalization accidentally papered over it, and 4426 enforcement is unit-tested independently of the WS scaffold.
- **Close-code 4426 handled symmetrically on all 3 client services**
  - Evidence : duel-connection.ts:928-933 wipes tokens + storage + sets protocolMismatch signal. replay-connection.service.ts:99-103 sets protocolMismatch + 'replay.viewer.protocolMismatch' error key. solver.service.ts:222-225 sets intentionalClose+solverState='error'+'solver.error.outdatedClient'. Replay branch is unit-tested at replay-connection.service.spec.ts:219-229 (both positive 4426 + negative 1006).
  - Why it matters : All three WS entry points stop the reconnect loop and surface a refresh-prompt UX, the precise contract documented in CLAUDE.md. Forgetting one would cause an infinite reconnect loop against an outdated bundle — the 3-way symmetry is enforced by code + 1 spec.
- **BOARD_CHANGING_EVENT_TYPES has a runtime subset-of-GameEvent invariant gate**
  - Evidence : duel-event-processor.spec.ts:318-330 (F8) iterates BOARD_CHANGING_EVENT_TYPES and asserts every entry is in GAME_EVENT_TYPES, with an explanatory withContext message pointing to the exact remediation files. The set's two consumers (ChainSnapshotTracker server-side, bufferIfResolving client-side) are both gated on this set.
  - Why it matters : Adding a new BOARD_CHANGING type without updating GAME_EVENT_TYPES would silently drop it during chain buffer replay (logger.warn, no assertion). F8 turns that silent failure into a Karma red. This is one of the few invariants in the audit list with a real test gate.
- **Pipeline signal tagging α.1 is the most rigorously enforced invariant in the codebase**
  - Evidence : eslint.config.js:64-77 wires `skytrix-pipeline/pipeline-signal-tagged` as an ERROR-level rule for `src/app/pages/pvp/**/*.ts`. allowed-files.json (48 entries) is the explicit baseline. eslint-plugins/pipeline-signal-tagged/__tests__/rule.spec.mjs unit-tests the rule. regenerate-baseline.mjs scripts baseline maintenance. CLAUDE.md cites P8 hardening (strict `_transport_` prefix, module-scope `*Source`, projection import requirement) and P9 hardening (scope hierarchy fill).
  - Why it matters : Three layers (lint rule + baseline file + unit tests for the rule + regenerate script + documented hardening rounds) make this the gold standard for invariant enforcement in the project — every other invariant should aspire to this level.
- **Internal worker channel types live in types.ts (NOT the WS protocol)**
  - Evidence : types.ts:103-286 defines MainToWorkerMessage (INIT_DUEL, INIT_REPLAY, INIT_FORK, PLAYER_RESPONSE-internal, ...) and WorkerToMainMessage (WORKER_DUEL_CREATED, WORKER_MESSAGE, WORKER_FORK_READY, ...). These are intentionally NOT in ws-protocol-* because they never cross the wire — `port.postMessage` calls in duel-worker.ts:1265, 1378, 1430, 1589 use those internal types.
  - Why it matters : Clean separation: the 6 ws-protocol files are the wire surface (browser↔server), types.ts is the worker-thread channel (main↔worker). Mixing them would create false byte-sync requirements with front (which never sees WORKER_* messages). The split is correct.
- **applyChainTransition is pure + spec-covered with explicit cross-side parity reference**
  - Evidence : chain-state-tracker.ts:57-85 dispatches MSG_CHAINING/SOLVING/SOLVED/END/NEGATED on a pure container, with the JSDoc explicitly naming `duel-event-processor.ts _processMessageInner` + `applyChainSolving` + `applyChainEnd` as the cross-side mirror (lines 49-55). chain-state-tracker.spec.ts pins the server-side; duel-event-processor.spec.ts pins the client.
  - Why it matters : Both sides of the F9 contract are individually spec-covered, and the file headers cross-reference each other so a future dev editing one finds the pointer to the other within 10 seconds of reading.

**Dettes identifiées** :

- **[HIGH] Byte-sync script has 3 documented bypass paths — no CI safety net** ✅ **CONFIRMED**
  - Principe : Defense-in-depth / robustness
  - Evidence : scripts/hooks/pre-commit:18-19 documents '--no-verify' bypass. duel-server/package.json:10 (prebuild) only fires when duel-server is rebuilt. front/package.json has no prebuild check (`ng build` line 7 doesn't call it). No `.github/workflows`, no `.circleci`. setup-hooks.sh requires manual `git config core.hooksPath` post-clone (developer must remember).
  - Impact : A dev who: (a) clones without running setup-hooks.sh, (b) only edits a front `duel-ws-*.types.ts` file, (c) runs `npm run build` in `front/` only — has ZERO gates between their change and a production divergence. The next duel-server rebuild surfaces it days later. Probability is real because front-only changes are common (signal additions, JSDoc edits).
  - Cleanup : Add `node ../scripts/check-ws-protocol-sync.mjs` to front/package.json's `prebuild` script (mirror duel-server). Even better: introduce a minimal GitHub Actions workflow that runs the check on every PR — the script is ~50ms, the dependency is just `node` already used for ng build.

- **[HIGH] PROTOCOL_VERSION is still 1 — no clean bump path exercised, no forced-refresh test**
  - Principe : YAGNI (until it bites) / robustness
  - Evidence : ws-protocol-shared.ts:23-27 'Version log: 1 — initial baseline'. PROTOCOL_VERSION = 1 has never been bumped. The 4426 close handlers (duel-connection.ts:928, replay-connection.service.ts:99, solver.service.ts:222) surface a 'please refresh' message but don't enforce a hard refresh. duel-connection.ts:931 wipes localStorage but a service worker / cached bundle would reload identical code.
  - Impact : First time PROTOCOL_VERSION bumps from 1→2 (any breaking wire change), users with a tab open get a toast they can dismiss, then keep hitting 4426 on every reconnect. The semantics of 'please refresh' depend on the user actually doing it. No e2e/integration test simulates a version-bump deploy. The 'Version log' single-entry suggests this code path is unexercised in production.
  - Cleanup : Add an explicit `window.location.reload(true)` (or service-worker skipWaiting + clients.claim) in the 4426 handler instead of just a toast — and pin the behavior with an integration test that mocks PROTOCOL_VERSION+1 server-side and asserts the bundle reload triggers. Mark as 'deep' because it touches SW + cache headers.

- **[HIGH] Animation Parity Rule is enforced ONLY by convention — no lint, no test**
  - Principe : OCP / robustness (invariant policed by docs, not code)
  - Evidence : Grep'd animation-orchestrator.service.ts for `DuelWebSocketService|DuelConnection` imports: zero matches (good). But eslint.config.js has no `no-restricted-imports` rule scoped to orchestrator/managers. CLAUDE.md's 'Animation Parity Rule' says 'orchestrator MUST NOT import or reference' — pure review-time discipline. The AnimationDataSource interface is enforced by TS typing but adding a sneaky `inject(DuelWebSocketService)` would compile.
  - Impact : A future dev under deadline pressure adds `inject(DuelWebSocketService)` to the orchestrator for a 'quick' signal access. TS passes, specs pass (the test-bed provides DuelWebSocketService anyway), code review may miss it. Replay parity silently breaks: ReplayDuelAdapter doesn't provide that injection, replay viewer throws NG0201 at runtime weeks later. Echoes the F1/F23 precedent (16-day debt) cited in CLAUDE.md.
  - Cleanup : Add an ESLint `no-restricted-imports` rule scoped to `animation-orchestrator.service.ts` + the 8 managers, banning `duel-web-socket.service` and `duel-connection`. ~10 lines in eslint.config.js. Pattern is already established by skytrix-pipeline plugin.

- **[HIGH] F9 chainPhase cross-side parity has zero cross-check — only per-side pins** ✅ **CONFIRMED**
  - Principe : DRY / robustness
  - Evidence : chain-state-tracker.spec.ts pins server transitions; duel-event-processor.spec.ts pins client transitions. There is NO test that runs `applyChainTransition` and `_processMessageInner + applyChainSolving + applyChainEnd` on the same message sequence and asserts the resulting (phase, activeLinks, negated) tuples agree. The 5-row transition matrix in CLAUDE.md is a markdown contract, not a runtime gate.
  - Impact : If someone edits chain-state-tracker.ts (e.g. adds a 'pending' sub-phase as CLAUDE.md hypothesizes) and updates the server spec but forgets the client mirror, the CHAIN_STATE reconnect payload deserializes into a state the client can't handle. Detected only at runtime, only on a real reconnect mid-chain. The matrix in CLAUDE.md depends on humans reading both files at edit time.
  - Cleanup : Add a 'parity' spec that imports both `applyChainTransition` from duel-server (via relative path) and the client processor, feeds an identical message sequence through both, and asserts the tuples (phase, activeLinks.length, negatedIndices, currentSolvingChainIndex) agree at every step. The duel-server's vitest already imports front files via relative path elsewhere (ws-protocol-shared.spec.ts:34) — same pattern applies.

- **[HIGH] Perspective Convention (F6) has zero static enforcement — only documented routing** ✅ **CONFIRMED**
  - Principe : Robustness / DRY
  - Evidence : CLAUDE.md 'Perspective Convention': 'Enforcement: there is currently no automated lint rule that flags new ${zoneId}-${X} builders where X is not provably relative. The gate is review-time discipline + this checklist.' Grep confirms ~40 call sites across orchestrator/managers/components. The 'inline idiom kept' list (prompt-derivation, board-container 'is mine' tests) requires per-site judgment.
  - Impact : The most common perspective bug class in PvP (`linkedZoneMap controller absolu`, EMZ resolver, etc. cited in `perspective-bug-hunt-2026-05-20` memory) keeps recurring because new code can re-introduce the inline `=== ownIdx ? 0 : 1` idiom without any signal. Each occurrence wastes hours to surface via Playwright debug captures. F6 ROUTED the existing sites through ctx.relativePlayer but didn't ban the bare idiom.
  - Cleanup : Add an ESLint rule that warns on a template literal containing `${...}-${...}` where the trailing expression is NOT a call to `relativePlayer` or a parameter explicitly typed `0 | 1`. Lots of false positives initially → start with a per-file enable list + baseline like skytrix-pipeline. Even a `// skytrix-perspective-ok` comment opt-out is better than today's zero signal.

- **[MEDIUM] F10 cost-sync parity explicitly has 'NO automated gate' — by author's own admission** ❌ **REFUTED**
  - Principe : DRY (two implementations of one contract)
  - Evidence : CLAUDE.md F10 section: 'There is currently NO automated gate enforcing this parity. The ChainSnapshotTracker shared spec covers the resolving-window snapshot contract — the pre-resolving cost-sync contract is unwritten.' Two distinct mechanisms (PvP duel-worker.ts:1366-1369 hasCostMoves explicit; Replay precompute flush implicit) produce equivalent client effect — but no test cross-verifies.
  - Impact : A future server change that 'looks fine' on PvP (e.g. dropping the hasCostMoves intermediate BOARD_STATE because tests pass) silently breaks the synchronization on PvP only — replay keeps working through the precompute flush mechanism. The asymmetry guarantees a 50% chance of half-detection: spec coverage on one side, untouched on the other.
  - Cleanup : Hoist the cost-sync logic to a shared utility callable from both runDuelLoop and runReplayPreComputation (the CLAUDE.md F10 section already suggests this as 'the right fix'). Mark as 'deep' — requires refactoring duel-worker.ts:1366 + replay-precompute.ts:394, ~3-5 day chantier.

- **[MEDIUM] F19 lock-assert sites — adding an 8th would not be 'obvious' (no manifest, no test)** ✅ **CONFIRMED**
  - Principe : Miller's Law / robustness (7 sites at the limit; doc is the only manifest)
  - Evidence : 7 prod call sites enumerated in CLAUDE.md, verified by grep: animation-orchestrator.service.ts:996, duel-connection.ts:825/1393/1649, replay-duel-adapter.ts:154/191/246. There is no central registry of expected sites, no spec that iterates expected sites, and the assert sites list lives ONLY in CLAUDE.md. 'Intentionally NOT asserted' sites (collapseRemainingSteps, abort, jumpToState) are documented in markdown, not code comments at those exact sites.
  - Impact : A new transition boundary added in 6 months (e.g., a new STATE_SYNC variant) is silently NOT asserted. Reviewer reads new code, sees no `assertNoLocks`, doesn't know the convention because they didn't read CLAUDE.md F19. The 7-vs-8 question becomes archaeology.
  - Cleanup : Add a one-liner comment at each of the 'intentionally NOT asserted' sites (`collapseRemainingSteps`, `abort`, `jumpToState`) explaining WHY (e.g. `// no assertNoLocks: skip-to-end interrupts mid-dispatch intentionally`). Then add a CLAUDE.md table that's actually generatable: a spec that reads all `assertNoLocks(` call sites and pins the SET against an expected ARRAY in the spec. Drift between site list and expected set → red.

- **[MEDIUM] Worker→main message types are NOT byte-checked, but cross duel-server↔duel-worker process boundary** ✅ **CONFIRMED**
  - Principe : Robustness
  - Evidence : types.ts:162 + 275 define MainToWorkerMessage + WorkerToMainMessage. duel-worker.ts emits these via `port.postMessage`. They cross a worker boundary (different module instance). No check enforces that both sides agree on every union member (e.g., a `WORKER_NEW_THING` added to types.ts but never emitted, or a new message emitted but missing from the union). Internal-only ≠ no parity risk.
  - Impact : Lower than wire drift (compile-time TS catches misuse if both files import the same union), but if someone adds a transient INIT-time message in duel-worker.ts:1700-ish without updating types.ts (because `port.postMessage` is untyped on Node's MessagePort), the main thread's `handleWorkerMessage` switch silently lacks a case → message dropped, log spam.
  - Cleanup : Type the `port.postMessage` call site with a helper: `function send<T extends WorkerToMainMessage>(port, msg: T) { port.postMessage(msg) }`. Then every emit is type-checked against the union. Cheap, no runtime cost.

- **[MEDIUM] Front-side index `duel-ws.types.ts` is intentionally NOT byte-checked → silent re-export drift possible**
  - Principe : DRY
  - Evidence : check-ws-protocol-sync.mjs:14-17 'The two index files (ws-protocol.ts on back, duel-ws.types.ts on front) are NOT byte-checked: they have different import paths and slightly different re-export bodies. Their structural correctness is enforced by tsc.' The ServerMessage / ClientMessage unions are duplicated in both barrels (back:65-150, front:65-150).
  - Impact : A new message type added to ws-protocol-game.ts (which IS byte-checked) but missing from the ServerMessage union in the back barrel BUT present in the front barrel (or vice versa) would silently desync. TS catches this only if a consumer actually consumes the missing variant — handlers using exhaustive `switch (msg.type)` would catch it via `never` default, but loose code (e.g. `if (msg.type === 'NEW') ...`) would not.
  - Cleanup : Add a small normalizer for the barrel-level union: strip imports + comments, sort and compare the `export type ServerMessage = ... ` blocks. Even a regex extracting the union members between `export type ServerMessage =` and `;` then asserting set equality would catch most drift. ~30 lines added to check-ws-protocol-sync.mjs.

- **[MEDIUM] The `forPlayer` SOLO security gate is implementation-validated, not protocol-encoded** ❌ **REFUTED**
  - Principe : Robustness / type-driven design
  - Evidence : ws-protocol-prompts.ts:298-301 + ws-protocol-system.ts:233-237 document via JSDoc 'PvP normal MUST NOT set this field; the server validates strictly and rejects PvP payloads with `forPlayer` defined (A2 — possible impersonation attempt)'. The TYPE allows `forPlayer?: 0 | 1` on every client message regardless of mode. The validation lives in client-message-router.ts (not checked).
  - Impact : A malicious PvP client adds `forPlayer: 1` to SURRENDER → if validation regresses, PvP impersonation possible. The protocol type doesn't prevent it at the TS layer (both PvP + SOLO use the same type). A test pinning 'PvP rejects forPlayer-tagged messages' protects against regression but the type system COULD encode it (two distinct types, one for PvP normal, one for SOLO).
  - Cleanup : Add a server-side spec that confirms forPlayer is rejected in PvP normal mode for every client message type (one parametrized test, ~20 lines). Type-level fix (split union) is a bigger refactor and likely over-engineered for the threat. Mark as 'consider' — runtime guard with spec is the pragmatic equilibrium.

- **[LOW] Inline `type: 'MSG_*'` literals scattered across duel-worker.ts (~60 sites)**
  - Principe : DRY (mild)
  - Evidence : Grep found ~60 inline `type: 'MSG_X', ...` object constructions in duel-worker.ts:396-845 (transformMove, runDuelLoop branches). Each is unioned via the return type but the literal string is not centralized as a constant.
  - Impact : Low — TS unions catch typos at compile time because the return type is `ServerMessage`. But a stale string like `'MSG_PAY_LPCST'` (typo) in the construct site could compile if `as` casts widen the type, and a future refactor that loosens any return signature to `unknown`/`object` loses the gate entirely. Also makes greppable cross-references the only way to map a message to its emitter.
  - Cleanup : Optional — extract `const MSG_TYPES = { MOVE: 'MSG_MOVE', DRAW: 'MSG_DRAW', ... } as const` and use `type: MSG_TYPES.MOVE`. Higher cost than benefit at current LOC; mark as low priority. The real benefit would come from emitting via per-type factory functions (`buildMoveMsg(...)`) which would also colocate boardStateAfter attachment logic.

- **[LOW] Game-log files cross-imported into ws-protocol-system.ts create an under-documented fan-out**
  - Principe : Locality of reference
  - Evidence : ws-protocol-system.ts:13 imports `GameLogEntry` from `./game-log/game-log-types.js`. The byte-sync script handles the path normalization (normalize() lines 50-51 + normalizeGameLog() lines 67-78) but the implicit coupling — 'editing game-log-types.ts can cause ws-protocol drift to fail' — is not flagged in either file's header comment.
  - Impact : A dev editing `game-log-types.ts` doesn't know they may need to update front/back in lockstep AND that the ws-protocol-system.ts pair-check will fire. The pre-commit hook PATTERN at scripts/hooks/pre-commit:30 does catch game-log files, so detection works, but the surprise factor adds friction.
  - Cleanup : Add a sentence to ws-protocol-system.ts header: '// Note: re-exports GameLogEntry from game-log/ — that file is ALSO byte-synced (check script covers both).' One-line doc fix.

- **[LOW] Allowed-files.json baseline has 48 entries — no scheduled shrinkage cadence**
  - Principe : Robustness (drift over time)
  - Evidence : eslint-plugins/pipeline-signal-tagged/allowed-files.json contains 48 entries including major files like animation-orchestrator.service.ts, duel-connection.ts, duel-event-processor.ts, queue-runner.ts. CLAUDE.md states 'α.7 shrinks that list to zero as it migrates them' but the project memory `anim-pipeline-v2-lint-baseline-strategy` says 'Pas de story α.7b.2 dédiée ; retraits opportunistes au fil des stories'.
  - Impact : The baseline is the loophole. As long as legacy files stay listed, new signals added INSIDE those files don't need tagging (the rule short-circuits on the whole file). 48 entries / 50 PvP files = ~96% of the surface is bypassed. The 'opportunistic' shrinkage means files removed from the baseline at random rates.
  - Cleanup : Two complementary actions: (1) inspect-violations.mjs script (already exists per CLAUDE.md) should be run as part of the duel-server prebuild and FAIL if any allowed-file has zero violations remaining (= 'why is it still in the baseline?'). (2) Track baseline size as a sprint metric — e.g. CLAUDE.md or a project-memory file commits to a target curve (48 → 30 → 10 over X months).

- **[LOW] ReplayForkReadyMsg legacy field comment in protocol mentions removed token2 — dead context surface**
  - Principe : YAGNI / dead-state cleanup
  - Evidence : ws-protocol-replay.ts:73-82 ReplayForkReadyMsg has only `token1` after F5-bis, but the comment block (lines 76-81) keeps explaining 'Pre-F5-bis emitted a second token...'. Useful one-liner, but the message itself doesn't enforce the F5-bis decision — a future dev could add `token2?:` back without anything failing.
  - Impact : Minimal — TS would catch a missing token2 consumer. But comments accumulate; if every F-fix leaves a paragraph behind, the protocol files become archeology. Already visible in ws-protocol-system.ts:39-58 with the F4 context.
  - Cleanup : Migrate per-field 'why this changed' comments older than 3 sprints to docs/anim-pipeline-v2/ or similar; keep the protocol files focused on current shape + 1-line invariants. Convention: a per-protocol-version CHANGELOG instead of per-field history. Mark as low priority — it's housekeeping.

- **[LOW] Header comments in paired files claim 'same content modulo .js suffix' — but normalize() also rewrites stems**
  - Principe : Documentation accuracy
  - Evidence : ws-protocol-game.ts:5-6 says 'modulo `.js` import suffix on the back side — the sync script normalizes before comparison'. Misleading: the normalizer ALSO rewrites `from './ws-protocol-X.js'` → `from './duel-ws-X.types'` (different stem, not just suffix). The script header (check-ws-protocol-sync.mjs:11-13) is the only honest doc on the actual rules.
  - Impact : A dev fixing a sync failure reads the header in the .ts file, expects to only change `.js` → `''`, then sees the script also wants stem rewriting, gets confused. ~5 minutes wasted per occurrence, but trust in the doc erodes.
  - Cleanup : Update the 'Sync rule' comment in each ws-protocol-*.ts file header to say 'modulo `.js` suffix AND `ws-protocol-X` → `duel-ws-X.types` stem rewriting (see check-ws-protocol-sync.mjs:normalize)'. One-line fix in 6 files + 6 mirrors.

---

### server.ts + duel-worker.ts cohesion

**Forces identifiées** :

- **Boot invariant is a real safety net, not theater**
  - Evidence : server.ts:856-871 ; configurable.ts:23-26,40-42
  - Why it matters : All 10 modules expose isXxxConfigured() and server.ts asserts the full set in one block immediately before wss.on('connection'). A future module added without a configure() call fails fast at process start with a self-describing error, not at the first WS message (where it would surface as 'configureXxx() not called' deep in a callback). createConfigurable centralises the throw message so the contract stays uniform — important since 10 modules means 10 chances to copy-paste a stale error string.
- **Session lifecycle has a single owner with explicit ordering**
  - Evidence : server.ts:737-802 (cleanupDuelSession) ; duel-session-manager.ts:31-150 ; duel-session-manager.ts:137-150 (terminate called LAST)
  - Why it matters : DuelSessionManager owns the 3 Maps (activeDuels, pendingTokens, reconnectTokens) and is the LAST step in cleanupDuelSession by contract. WS close + timer clears + worker termination happen before. Token consumption returns a 3-variant tagged discriminator ('unknown' / 'session-gone' / 'ok') so the WS handler can pick the correct close-code. This is the kind of cleanup ordering that the 'inline closures in server.ts' era had as a 200-line comment block; here it's enforced by class boundary + the comment at line 132-136.
- **Tagged-union token consumption + atomic Maps eliminate a real race class**
  - Evidence : duel-session-manager.ts:59-72,85-98 ; server.ts:1017-1031
  - Why it matters : consumePendingToken/consumeReconnectToken do read-then-delete in one call and return the tagged result so the caller cannot forget to delete. The 'orphan token' case (session gone but token still in the Map) auto-prunes on the read. This collapses an inline 6-line pattern that previously appeared at both the handshake path and the reconnect path.
- **duel-worker.ts at 1973 LOC is one coherent responsibility, not a god-object**
  - Evidence : duel-worker.ts:1250-1435 (runDuelLoop), 1548-1591 (initDuel), 1639-1670 (initReplay), 1679-1707 (initFork), 1817-1973 (port.on dispatcher) ; 25 port.postMessage calls (Grep)
  - Why it matters : The worker has one job: drive OCGCore + transform/emit messages. The three init paths share 80% of the bootstrap (initOcgEngine + loadDeckToOcg + resetDuelState) and diverge on which loop they enter. Splitting it would create artificial seams — runDuelLoop, transformMessage, buildBoardState all share the same module-level WASM state (core, duel, lp, turnPlayer). The 'god' feel is contained because the surface to the main thread is exactly 6 message types and they all funnel through `port.postMessage({type:'WORKER_MESSAGE',...})` or one of 5 lifecycle siblings.
- **Pure helpers carved out for the parts that benefit from isolation**
  - Evidence : lifecycle-helpers.ts:26-29,38-41,75-80,91-104,117-124 ; session-phase.ts; pre-duel-snapshot.ts; chain-state-tracker.ts (applyChainTransition pure)
  - Why it matters : The 'should this SOLO multiplex session start?' / 'route this message to which slot?' decisions live in pure functions that take primitives (soloMode boolean + playerIndex + messageType) and return tagged unions. Call sites in server.ts and worker-message-router.ts read like intent. Unit-testable without booting a WS. This is the right shape for the cross-cutting SOLO logic — better than the createConfigurable pattern which is heavyweight for stateless decisions.
- **Worker lifecycle bugs documented + flag-guarded**
  - Evidence : worker-lifecycle.ts:71-93 (safeTerminateWorker 3 bug guards), 109-132 (attachWorkerHandlers exit branch), 146-168 (handleDuelEnd idempotency)
  - Why it matters : The terminate path enumerates three pre-extraction bugs it now guards against (double-terminate, double-counted totalDuelsServed, re-fire of listeners after teardown) and uses workerTerminated + removeAllListeners + the endedAt branch in 'exit' to handle each. handleDuelEnd is idempotent on endedAt. The patterns are simple flags but the comments make the invariants explicit — a future refactor that drops the flag breaks something documented, not something tribal.
- **Modules are independently unit-testable via their config interface**
  - Evidence : timer-management.spec.ts:35-51 (makeConfig + sentMessage spy harness) ; client-message-router.spec.ts (33 configureClientMessageRouter calls per Grep)
  - Why it matters : Each module's configure() takes its dependencies as plain callbacks, so a spec wires fakes for sendToPlayer/handleDuelEnd/etc and exercises the module without booting a WS server, worker, or HTTP listener. The boot invariant + isConfigured() never matters in tests because tests call configure() directly. The pattern delivers what it promised: isolated unit-testability.

**Dettes identifiées** :

- **[HIGH] Config-as-late-bound-singleton hides the dependency graph from the type system** ❌ **REFUTED**
  - Principe : Inversion of Control violated — modules pretend to be DI'd but are global singletons gated by a runtime null check
  - Evidence : configurable.ts:28-44 (module-local `let cfg: T | null`) ; worker-message-router.ts:58-61 ; client-message-router.ts:58-61
  - Impact : Every module call site is `getCfg()` — a synchronous throw if order-of-boot is wrong. The dependency graph is not encoded in any constructor; it's encoded in server.ts:226-334 as a giant list of configureXxx({...}) blocks. Adding a circular dep (configureA needs B, configureB needs A) compiles cleanly and explodes at the first runtime call. A real DI container (or a `createModule(deps): ModuleAPI` factory pattern) would catch the cycle at wiring time and the missing dep at type-check time. The boot invariant catches 'forgot to configure' but NOT 'configured with stale values' or 'configured in wrong order if order matters'.
  - Cleanup : deep — migrate to a `createWorkerMessageRouter({sendToPlayer, timer, ...}): {handleWorkerMessage, broadcastMessage}` factory pattern. Modules become plain objects returned by their factory. server.ts wires them in dependency order. The boot invariant disappears because TypeScript catches missing args at compile time. This is the next refactor.

- **[HIGH] broadcastMessage is a god-function with 7 responsibilities in 130 lines**
  - Principe : SRP — 'broadcast a message' has accreted 7 cross-cutting policies in a sequential pipeline
  - Evidence : worker-message-router.ts:238-368 ; CLAUDE.md describes 7 concerns: game-log ingest / DUEL_END synthesis / chain transition / CONFIRM_CARDS tagging / BOARD_STATE cache+turn change / SELECT_* timers / per-player filter+SOLO branch
  - Impact : Each new concern has to find a slot in the implicit ordering (game-log BEFORE the DUEL_END synth so MSG_WIN is logged raw; chain transition AFTER DUEL_END synth; CONFIRM_CARDS tag AFTER chain transition reads currentSolvingChainIndex). The order is load-bearing but only documented in scattered comments. A pipeline pattern (array of `(session, msg) => msg | null` interceptors) would make the order explicit and each step testable in isolation. The SOLO branch at line 339 also duplicates the filterMessage + isSelectMessage cache logic of the PvP branch at 356-367 (the 'omniscient single-pass vs per-player loop' difference is real but the lastSentPrompt/lastSentHint cache writes are identical).
  - Cleanup : deep — extract a `MessagePipeline` with 7 named steps. SOLO becomes a `runOnce(omniscient=true)` vs PvP a `runForEachPlayer()` at the LAST step only. The 6 preceding steps run once regardless of mode.

- **[HIGH] ActiveDuelSession is a 35-field mutable bag that every module mutates**
  - Principe : Encapsulation — there is no 'session API', every module reaches into the same struct
  - Evidence : server.ts:453-494 (initial PvP session construction, 35 fields) ; fork-handlers.ts:72-116 (parallel 33-field construction) ; worker-message-router.ts:140 (session.invalidResponseCount[p]++), 183-185 (session.activeChainLinks=[]; chainPhase='idle'; etc.) ; client-message-router.ts:135 (session.invalidResponseCount[playerIndex]++), 152-153 ; timer-management.ts:94-145 (mutates session.timerContext + session.awaitingResponse) ; server.ts:578-588 (rematch reset assigns 13 fields by hand)
  - Impact : Every extracted module reads + writes fields directly on the session by name. The 'session has no methods' choice (DuelSessionManager.terminate is the only one) means there is no place to enforce invariants like 'awaitingResponse[p] flipped to true MUST be paired with promptSentAt[p] = Date.now()'. The rematch reset at server.ts:578-588 enumerates 13 fields to clear — adding a new field anywhere means searching for every reset site (initial construct, rematch reset, cancel reset, cleanupDuelSession). The fork-handlers session constructor at 72-116 is a near-duplicate of the PvP one at server.ts:453-494; they have already drifted (forkMode/skipShuffle defaults differ but the rest is identical).
  - Cleanup : deep — class ActiveDuelSession with methods (armPrompt(p, type) sets awaitingResponse + promptSentAt atomically; resetForRematch() owns the 13-field reset; resetChainState() wraps the 4-line chain clear at worker-message-router.ts:183-185). PvP + fork constructors become factory methods on the class.

- **[MEDIUM] server.ts retains ~600 LOC of orchestration that's neither protocol nor module — leftover scraps after 10 extractions**
  - Principe : SRP — server.ts is now 'whatever didn't fit anywhere else' not 'the HTTP/WS entry point'
  - Evidence : server.ts:554-686 (startRematch + startDuelWithOrder), 697-719 (sendToPlayer), 737-802 (cleanupDuelSession), 873-1214 (wss.on('connection') closure ~340 LOC), 1217-1261 (resendPendingPrompt + sendStateSnapshot)
  - Impact : The 340-line WS connection closure handles handshake + reconnect + post-duel cleanup + grace-period bookkeeping + SOLO-vs-PvP branches + currentPlayerIndex live lookup all in one big inline block. startDuelWithOrder owns the player-array swap with reconnect token remap (lines 630-646). cleanupDuelSession is THE central cleanup but lives in server.ts because every other module depends on it via injection. The pattern that emerged is: anything that touches BOTH 'WS connection state' AND 'session lifecycle' stayed inline. That's a real category — call it `connection-orchestrator` — and it deserves its own module instead of being 'whatever's left'.
  - Cleanup : Extract `pvp-connection-handler.ts` (the wss.on closure body), `session-orchestrator.ts` (startRematch + startDuelWithOrder + cleanupDuelSession + sendStateSnapshot), and `ws-write.ts` (sendToPlayer + the SOLO routing it inlines). server.ts shrinks to ~300 LOC of boot wiring.

- **[MEDIUM] Worker → main side has parallel 'broadcast' logic on the worker side that bypasses the router**
  - Principe : DRY / encapsulation — every emission site assembles the `{type:'WORKER_MESSAGE',duelId,message}` envelope by hand
  - Evidence : duel-worker.ts:1378 (`port.postMessage({type:'WORKER_MESSAGE',duelId,message:buildBoardState()})`), 1382 (same), 1430, 1844-1848, 1970-1971 ; 25 total port.postMessage calls
  - Impact : The worker has 25 raw port.postMessage calls, each manually wrapping with `{type:'WORKER_MESSAGE'|'WORKER_ERROR'|'WORKER_RETRY'|'WORKER_CANCEL_DONE'|'WORKER_REPLAY_DATA'|'WORKER_DUEL_CREATED', duelId, ...}`. A typo in any 'duelId' or 'type' fails silently (validateWorkerMessage drops the message). A tiny `emit*` helper module (e.g. `emitBoardState()`, `emitError(msg)`, `emitDuelCreated()`) would centralise the envelope, the type discriminant, and the WORKER_* tag. This is the WORKER-side analog of broadcastMessage and got NO extraction love.
  - Cleanup : Add `duel-worker-emit.ts` (~40 LOC) with 6 typed emitters. Replace the 25 raw postMessage call sites. Worker shrinks ~30 LOC; main-thread validateWorkerMessage tests cover the wire format from one location.

- **[MEDIUM] Cross-module dep graph is not flat — three modules form a hub centred on worker-lifecycle + timer-management**
  - Principe : DRY + acyclic dependencies — worker-lifecycle <-> worker-message-router is a cycle broken only by runtime late binding via createConfigurable
  - Evidence : worker-message-router.ts imports timer-management (4 fns) + worker-lifecycle (3 fns) + replay-persist (1 fn) ; client-message-router.ts imports timer-management (4 fns) + worker-lifecycle (2 fns) + first-player-coordinator (1 fn) ; fork-handlers.ts imports worker-lifecycle (2 fns) ; worker-lifecycle injects handleWorkerMessage via configure, which is in worker-message-router
  - Impact : worker-message-router calls worker-lifecycle's handleDuelEnd / safeTerminateWorker / requestReplayFromWorker as direct imports. worker-lifecycle takes handleWorkerMessage as a configured callback, wired from worker-message-router via server.ts. So the call graph at runtime IS a cycle (worker.on('message') → handleWorkerMessage → broadcastMessage → handleDuelEnd → ... back into worker.on next tick). The createConfigurable null check at boot hides this from TypeScript. If a future refactor tries to express the graph cleanly (e.g. `new WorkerMessageRouter(workerLifecycle)`), the cycle becomes obvious and forces a redesign. Currently it works only because the cycle resolves across event-loop ticks.
  - Cleanup : deep — extract a `DuelEndCoordinator` (1 fn: `endDuel(session, reason)`) that owns the {handleDuelEnd + requestReplayFromWorker + sendDuelEndMsg + safeTerminateWorker on certain reasons} sequence. Both routers depend on the coordinator, the coordinator depends on lifecycle, no cycle. handleWorkerMessage no longer needs late binding.

- **[MEDIUM] 33 calls to configureClientMessageRouter in ONE spec is a smell about how heavyweight 'configure once per test' is**
  - Principe : Testability — every test reconfigures the singleton because configure is global mutable state
  - Evidence : Grep result — client-message-router.spec.ts:186,203,222,247,270,294,333,354,369,388,407,428,439,453,466,486,505,513,530,543,560,570,581,593,616,627,640,651,662,673 (~30 calls)
  - Impact : createConfigurable's `let cfg: T | null` is module-private GLOBAL state. Two parallel tests cannot have different configs (vitest sequential default saves them today, but a future parallel run breaks). Every test redoes the configure dance. A factory pattern (`createClientMessageRouter(cfg)` returning the handler closures) would let each test build its own instance with its own deps — no global, no reconfigure, no spec coupling to module load order.
  - Cleanup : deep — same as the createConfigurable migration above. The signal that this is a real cleanup, not a nice-to-have, is the 30× repetition in one file.

- **[MEDIUM] broadcastMessage 'plumbing closures' comment IS the abstraction leak it warns about**
  - Principe : SRP — sendToPlayer claims to be 'a WS-write helper' but encodes (1) STATE_SYNC game-log attach, (2) SOLO decideSoloRouting routing decision, (3) actual safeSend
  - Evidence : CLAUDE.md → 'server.ts retains: ... `broadcastMessage` plumbing closures' ; server.ts:697-719 (sendToPlayer) + the 37 inline call-sites comment in worker-message-router.ts:42-44
  - Impact : sendToPlayer at server.ts:697-719 has the comment 'WS-write helper (37 call sites in server.ts)' justifying why it stays inline — but the actual body has 3 concerns: attaching gameLogEntries to STATE_SYNC, calling decideSoloRouting for SOLO routing, then safeSend. Every module that takes sendToPlayer as a callback gets all 3 behaviors transitively. The 'plumbing closure' language in CLAUDE.md is a euphemism for 'this single function captures the layering violation we did not undo'. timer-management calls sendToPlayer for INACTIVITY_WARNING; the SOLO routing logic in decideSoloRouting then drops the msg silently if WARNING is not in PSEUDO_PAIRWISE_SOLO_ROUTED — coupling timer behavior to a routing whitelist defined in lifecycle-helpers.ts.
  - Cleanup : Split sendToPlayer into a pure SoloRouter (already exists as decideSoloRouting) + safeSend at the actual transport layer + a STATE_SYNC decorator interceptor. Modules inject the LOW-level safeSend, not the policy-laden sendToPlayer.

- **[MEDIUM] fork-handlers session constructor is a 30-line duplicate of the PvP session constructor with 3 fields different**
  - Principe : DRY — two near-identical 30-line struct literals diverge silently
  - Evidence : fork-handlers.ts:72-116 vs server.ts:453-494
  - Impact : soloMode/forkMode/skipShuffle differ; everything else is identical literal-for-literal. A new field added to ActiveDuelSession needs to land in both files (and the rematch reset above). The CLAUDE.md fork-solo doctrine pretends fork-solo IS SOLO multiplex 'by construction' but the construction itself is parallel. The fact that the docs spend 60 lines saying 'they are the same' is evidence that the code doesn't enforce it.
  - Cleanup : createActiveDuelSession({ soloMode, forkMode, skipShuffle, decks, players, ... }) factory that both POST /api/duels and createForkSoloSession call. Field divergence becomes impossible.

- **[MEDIUM] WORKER_CANCEL_DONE handler is 60 lines deep inside worker-message-router — owns BOTH server-side chain state reset AND the re-broadcast contract**
  - Principe : SRP — the cancel-rollback flow spans worker + server + client; one of the most complex flows in the codebase is buried inside a switch case
  - Evidence : worker-message-router.ts:146-208 (the WORKER_CANCEL_DONE case)
  - Impact : The handler resets 7 session fields (activeChainLinks, chainPhase, negatedChainIndices, currentSolvingChainIndex, lastSentHint, invalidResponseCount, lastSentPrompt, awaitingResponse, cancelTargetPrompt) PLUS sends 3 messages (STATE_SYNC, CHAIN_STATE, the cached prompt) PLUS branches on session.soloMode for both routing AND filter omniscience. The comment at line 47-49 points at cancel-rollback-contract.md but the implementation IS the contract. Any change to the cancel flow has to touch (1) duel-worker.ts CANCEL_PROMPT_SEQUENCE handler at line 1900, (2) this case, (3) the client-message-router CANCEL_PROMPT_SEQUENCE case, (4) the server-side cancelTargetPrompt snapshot in client-message-router.ts:158-166. Four sites, no shared type or function.
  - Cleanup : Extract a `cancel-rollback.ts` module owning the 4 step transitions: snapshot-at-commit, validate-cancel-request, apply-rollback-on-worker (worker-side), apply-rollback-broadcast-on-main (this case). The contract becomes 1 module = 1 file = 1 spec.

- **[LOW] Rematch reset assigns 13 fields by hand right next to a fresh-session constructor that already does this**
  - Principe : DRY — same field initial values written in two places
  - Evidence : server.ts:572-591 (rematch reset block) vs server.ts:453-494 (initial PvP construction)
  - Impact : Rematch initialization sets workerTerminated/awaitingResponse/lastBoardState/lastSentPrompt/lastSentHint/rematchRequested/endedAt/startedAt/bothDisconnected/storedDuelResult/lastStateSyncAt/lastCancelAt/cancelTargetPrompt/invalidResponseCount/promptSentAt + emptyChainState() + new gameLog by hand. The PvP constructor at line 453 sets ALL the same fields to the same values. When a new mutable field is added (e.g. SESSION_PHASE has lastSentPhase), it must be added to BOTH sites or rematch leaks the previous duel's value. There is no compile-time guarantee.
  - Cleanup : Add `resetForRematch(session)` method to ActiveDuelSession (per the encapsulation finding above), or extract a `freshDuelStateFields()` helper that both startRematch and the constructor spread.

- **[LOW] client-message-router and worker-message-router are the same pattern split for no architectural reason**
  - Principe : Miller's Law — two near-identical 300-line files for symmetrical concerns inflate the cognitive map
  - Evidence : worker-message-router.ts:78-236 (handleWorkerMessage switch on 6 types) ; client-message-router.ts:69-303 (handleClientMessage switch on 7 types) — both are pure dispatchers operating on session state, both take sendToPlayer + lifecycle hooks via configure, both have a constants-set guard at the top
  - Impact : A reader has to track which module handles inbound-from-worker vs inbound-from-client. Both modules import the same timer-management + worker-lifecycle subset. The split is justified by source direction (worker thread vs WS client) but nothing in the code reads any differently — both modules are 'side-effect bag triggered by an inbound message switch'.
  - Cleanup : Not necessarily — the split is defensible because the message TYPES are different and the validation differs. Listed as low because it is a coherence smell not a bug. If a message-router base class emerges (with the constants Set + the type guard), share it.

- **[LOW] Boot-time configure ordering is implicit — configureSolverHandlers runs BEFORE the `if (dataReady)` solver init block, configureReplayHandlers runs at top level but persistReplay configure is later**
  - Principe : robustness — boot order is sequential top-to-bottom, no guard that 'all configures complete before any handler can be invoked'
  - Evidence : server.ts:202-220 (solver init in conditional `if (dataReady)`) vs server.ts:226-239 (configureSolverHandlers always runs after) ; server.ts:298-301 (configureReplayPersist)
  - Impact : The boot invariant at line 856-871 catches missing configures but runs at the END of module-level execution, after all configures. If a configure() throws (e.g., loadHandtraps fails), subsequent configures never run, but the boot invariant fires NEXT module-level statement — the user sees a confusing 'modules not configured: A, B, C' error when the real cause was a throw at line 218. Wrapping configures in a try/catch with a clear 'configure failed' error would make the actual root cause surface first.
  - Cleanup : Wrap each configureXxx call in a try/catch that re-throws with `configureXxx failed: ${cause}`. Or move all configures into a single `bootModules()` function with explicit ordering + error context.

---
