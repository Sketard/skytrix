---
title: Replay Hub — Rework Implementation Tracking
author: Sally (UX Designer) + Axel
date: 2026-05-14
status: APPROVED — ready for implementation
scope: Hub `/pvp/history` refonte Holographic Arena (back-end + front-end)
mockup: _mockups/mockup-replay-hub.html
related:
  - _bmad-output/planning-artifacts/ux-audit-pvp-replay-2026-05-08.md
  - memory/project_replay_rework_2026_05_14.md
  - memory/project_pvp_lobby_rework_plan.md
---

# Replay Hub — Refonte Holographic Arena

## 1. Objectif

Refondre la page `/pvp/history` (actuellement `MatchHistoryPageComponent`, Mat-table brut admin-gated) en hub Replay Holographic Arena cohérent avec le lobby PvP shipped 2026-05-13. Maximiser la réutilisation de l'existant lobby ; ouvrir l'accès à tous les users (plus admin-only).

**Mockup de référence** : [`_mockups/mockup-replay-hub.html`](../../_mockups/mockup-replay-hub.html)

## 2. Décisions validées (2026-05-14)

| # | Sujet | Décision | Notes |
|---|---|---|---|
| **D1** | Accès | Retirer `adminGuard` de `/pvp/history` **ET** de `/pvp/replay/:replayId` **ET** retirer le filtre `'ADMIN'` sur la `Tab` navbar [components/navbar/navbar.component.ts:49](../../front/src/app/components/navbar/navbar.component.ts#L49) | Back déjà ouvert à tous via `AuthService.getConnectedUserId()` — le gating était purement front. Sans le patch navbar, le tab reste invisible aux non-admins même route ouverte. Sans le patch viewer, les replays cliqués depuis le hub se font rejeter au routing |
| **D2** | Stats strip | Nouveau endpoint back `GET /api/replays/stats` | Renvoie `{ total, victories, defeats, draws, winrate }` |
| **D3** | Durée du duel | Calculer `durationSec = (Date.now() - duelStartMs) / 1000` côté duel-server, persister dans `ReplayMetadata` JSONB | Permet d'afficher "14:32" sous "11 tours" dans le mockup |
| **D4** | Replays legacy | **Ne rien afficher** pour les replays sans `durationSec` (sans backfill) | Template `@if (metadata.durationSec; as d)` cache l'affichage |
| **D5** | Filtres v1 | "Tous / Victoires / Défaites / Mon deck / 7 derniers jours" — **côté front** sur la page courante | Back v2 si on dépasse ~200 replays / user. **Filtre "Mon deck" — décision tranchée 2026-05-14 : option C** = matcher `metadata.deckNames[mySide]` contre `DeckBuildService.decks$()[0].name` (premier deck de la liste). Arbitraire mais zéro changement de service ; suffisant en v1 vu que la plupart des users ont 1-3 decks. Itération possible v2 si le matching arbitraire devient gênant |
| **D6** | Sort v1 | `newest` (default), `oldest`, `mostTurns` — **côté front** | Back v2 idem |
| **D7** | Recherche | Filtre par **pseudo OU deck name** | Plus riche que le lobby (pseudo only) |
| **D8** | Pagination | Scroll infini via `cdk-virtual-scroll-viewport` + append on scroll-end | Cohérent avec lobby. Plus de mat-paginator |
| **D9** | Suppression | Garder `ConfirmDialogComponent` + optimistic remove avec rollback en cas d'erreur | Inchangé vs actuel |
| **D10** | Empty state | 2 CTAs : `[Jouer en PvP]` (primary gold) + `[Bac à sable]` (secondary cyan) | Cohérent avec lobby cta-row. ⚠️ `<app-empty-state>` ne supporte qu'**1 CTA** (audit 2026-05-14). **Implémenter en template inline** dans `replay-hub.component.html` avec classes utility `.empty-state` (déjà partial global) — NE PAS étendre `<app-empty-state>` |
| **D11** | Orientation lock | Pas de blocage portrait (le hub fonctionne en stack vertical) | Contrairement au viewer Replay (board 16:9 obligatoire) |
| **D12** | Factoring DS — Wave 1 | Extraire **12 partials SCSS** dans `front/src/app/styles/` (`_a11y`, `_motion`, `_typography`, `_card-surface`, `_buttons`, `_pills`, `_chips`, `_icon-button`, `_search-bar`, `_page-header`, `_section-header` + refacto `_empty-state`) + **refacto Niveau 1** (BEM, keyframes `ds-*`, `@use` migration, dialog overrides consolidés, nettoyages). Lobby migré en 3 commits (période coexistence 1 semaine avec alias). **Spec autonome** [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) = référence d'implémentation. Audit croisé Hub × Viewer (2026-05-14) confirme ROI sur les 12. | Wave 1 = **partials uniquement** (pas de composant Angular sauf `<app-replay-card-skeleton>`). Composants Angular extraits au 2-3ème consommateur réel (Wave 2, prochain écran refondu). |
| **D13** | Skeleton | Créer `<app-replay-card-skeleton>` dédié (clone adapté de `<app-room-card-skeleton>`) | Structure exacte de la replay-card pour éviter effet de saute au remplacement |

## 3. Architecture cible

### Composants & services réutilisés tels quels

| Item | Chemin | Usage hub |
|---|---|---|
| `<app-avatar>` | `shared/avatar/` | Avatar adversaire (pseudo + hue dérivée) |
| `<app-skel>` | `shared/skel/skel.component.ts` | Primitive skeleton |
| `<app-error-banner>` | `shared/error-banner/` | États erreur réseau |
| ~~`<app-empty-state>`~~ | ~~`components/empty-state/`~~ | **NON utilisé** — ne supporte qu'1 CTA. Template inline + utility classes `.empty-state` à la place |
| `ConfirmDialogComponent` | `components/confirm-dialog/` | Confirmation suppression |
| `ReplayService.getMatchHistory()` | `services/replay.service.ts` | Pagination existante OK |
| `ReplayService.deleteReplay()` | idem | OK |
| `AuthService.user()` | `services/auth.service.ts` | Identifier player1 vs player2 pour flip |
| `DeckBuildService` (cache decks) | déjà cachant via `BehaviorSubject` | Pour filtre "Mon deck" |
| Partial `styles/_empty-state.scss` | global | `.empty-state` + variants `--error` |
| Partial `styles/_holo-arena.scss` | global | `.screen-bg` + grid + glows |
| Partial `styles/_scrollbar.scss` | global | Ghost scrollbar |
| Partial `styles/_responsive.scss` | global | mixins `respond-above/below` + breakpoints |

### Composants & services nouveaux

| Item | Chemin | Rôle |
|---|---|---|
| `ReplayHubPageComponent` | `pages/pvp/replay-hub/` (renommé depuis `match-history-page`) | Composant page racine |
| `ReplayHubStore` | `pages/pvp/replay-hub/replay-hub-store.ts` | State machine : REST snapshot + pagination + filter + sort + optimistic delete |
| `<app-replay-card-skeleton>` | `shared/skel/replay-card-skeleton.component.ts` | Skeleton aligné sur structure replay-card |
| `ReplayStatsDTO` (TS) | `core/model/dto/replay-stats-dto.ts` | `{ total, victories, defeats, draws, winrate }` |
| `ReplayService.getStats()` | `services/replay.service.ts` (extend) | Wrap nouveau endpoint |

### Partials SCSS DS à extraire (Phase F0)

| Partial | Source | Réutilisation |
|---|---|---|
| `styles/_page-header.scss` | Du lobby `.lobby-header*` | `.page-header`, `.page-header-title`, `.page-header-back-btn` |
| `styles/_section-header.scss` | Du lobby `.lobby-section-*` | `.section-header`, `.section-title`, `.section-count`, `.section-filter` |
| `styles/_search-bar.scss` | Du lobby `.lobby-search-bar` | `.search-bar`, `.search-bar-clear` |

### Back-end Spring nouveau

| Item | Chemin | Description |
|---|---|---|
| `ReplayStatsDTO` (Java record) | `model/dto/replay/ReplayStatsDTO.java` | `(long total, long victories, long defeats, long draws, double winrate)` |
| `ReplayRepository.getStatsForUser()` | extend | Native query Postgres JSONB |
| `ReplayService.getStatsForUser()` | extend | Wrapping + calcul winrate |
| `ReplayController.getStats()` | extend | `GET /api/replays/stats` |
| `ReplayMetadata.durationSec` (Java record) | extend `model/dto/replay/ReplayMetadata.java` | `Integer durationSec` (boxed, nullable pour legacy) |

### Back-end Node duel-server nouveau

| Item | Chemin | Description |
|---|---|---|
| `ReplayMetadata.durationSec` | `duel-server/src/types.ts` | `number` non-optionnel sur nouveaux replays |
| Calcul durée | `duel-server/src/duel-worker.ts` | `Math.round((Date.now() - duelStartMs) / 1000)` au moment du `WORKER_REPLAY_DATA` |

## 4. Phases d'implémentation

### Phase B1 — Back `durationSec` (back + duel-server) — ~45 min (+30 min si test infra à compléter, voir pré-requis)

**Fichiers touchés** :
- `duel-server/src/types.ts` — ajouter `durationSec: number` à `ReplayMetadata` ([types.ts:194-202](../../duel-server/src/types.ts#L194-L202))
- `duel-server/src/duel-worker.ts` — **capturer `duelStartMs = Date.now()` au début de `initDuel()`** ([duel-worker.ts:1444](../../duel-server/src/duel-worker.ts#L1444)) dans une variable module-level (à côté de `duelResult`, `replayEmitted`, etc.). ⚠️ `session.startedAt` est côté **main thread** (`server.ts`), pas accessible depuis le worker — il faut donc une variable propre au worker. Calculer `Math.round((Date.now() - duelStartMs) / 1000)` dans `emitReplayData()` ([duel-worker.ts:1172](../../duel-server/src/duel-worker.ts#L1172)). **Pas de reset** : `initDuel` est appelé 1 fois par worker (worker = 1 duel). `initFork`/`initReplay` sont des chemins séparés qui ne capturent pas `duelStartMs` → `durationSec` reste `undefined` pour ces cas (cohérent avec D4, les forks sont mid-duel snapshots).
- `back/src/main/java/com/skytrix/model/dto/replay/ReplayMetadata.java` — ajouter `Integer durationSec` (boxed pour permettre null sur legacy)
- `back/src/main/java/com/skytrix/mapper/ReplayMapper.java` — **propager `durationSec` dans le `new ReplayMetadata(...)` du flip player2** ([ReplayMapper.java:22-30](../../back/src/main/java/com/skytrix/mapper/ReplayMapper.java#L22-L30)). Le constructeur actuel a 7 args ; le 8e (`meta.durationSec()`) doit être ajouté en dernière position. Sans ça, le champ devient null en perspective player2.
- `front/src/app/core/model/dto/replay-dto.ts` — ajouter `durationSec?: number` à `ReplayMetadata` (champ optionnel pour legacy)
- `back/src/test/java/com/skytrix/.../ReplayMetadataTest.java` — spec déserialisation : replay legacy sans `durationSec` → `durationSec()` retourne `null`

⚠️ **Pré-requis test infra** (audit 2026-05-14, deuxième passe) :
- `back/pom.xml` ligne 54 : `spring-boot-starter-test` **présent** → JUnit5 + Mockito disponibles par transitivité ✓
- `back/src/test/java/` **vide** mais structure à créer (`com/skytrix/mapper/`, `com/skytrix/service/`)
- Testcontainers **absent** de pom.xml → ajouter pour B2 (~30 min) :
  ```xml
  <dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>postgresql</artifactId>
    <version>1.19.7</version>
    <scope>test</scope>
  </dependency>
  ```

**Critères d'acceptation** :
- [ ] Nouveau replay shippé → `metadata.durationSec` présent et > 0
- [ ] Replay legacy en BDD → `metadata.durationSec()` retourne `null` sans crash
- [ ] Replay vu en perspective player2 → `durationSec` flippé correctement préservé (pas null)
- [ ] Pas de migration SQL (champ JSONB libre)
- [ ] `npm test` duel-server vert
- [ ] `./mvnw test` back vert

### Phase B2 — Back endpoint `GET /replays/stats` — ~2h (incl. setup Testcontainers ~30 min)

**Setup Testcontainers** (pré-requis tranché 2026-05-14) — ajouter à `back/pom.xml` :
```xml
<dependency>
  <groupId>org.testcontainers</groupId>
  <artifactId>postgresql</artifactId>
  <version>1.19.7</version>
  <scope>test</scope>
</dependency>
```
Test integ utilise `@Testcontainers` + `@Container static PostgreSQLContainer<?>` + `@DynamicPropertySource` pour injecter l'URL JDBC. Le `COUNT(*) FILTER (WHERE ...)` est Postgres-only — H2 même en mode Postgres-compat ne le supporte pas correctement.


**Fichiers touchés** :
- `back/src/main/java/com/skytrix/model/dto/replay/ReplayStatsDTO.java` — nouveau record
- `back/src/main/java/com/skytrix/repository/ReplayRepository.java` — méthode `getStatsForUser` (native query)
- `back/src/main/java/com/skytrix/service/ReplayService.java` — wrapping + calcul winrate
- `back/src/main/java/com/skytrix/controller/ReplayController.java` — `@GetMapping("/replays/stats")`
- `back/src/test/java/.../ReplayServiceTest.java` — specs unit + integ

**Contrat API** :
```http
GET /api/replays/stats
Authorization: Bearer <jwt>

→ 200 OK
{
  "total": 47,
  "victories": 31,
  "defeats": 16,
  "draws": 0,
  "winrate": 0.66
}
```

**Native query Postgres** :
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE
    (player1_id = :userId AND metadata->>'result' IN ('VICTORY', 'OPPONENT_TIMEOUT', 'OPPONENT_DISCONNECT', 'OPPONENT_SURRENDER'))
    OR
    (player2_id = :userId AND metadata->>'result' IN ('DEFEAT', 'TIMEOUT', 'DISCONNECT', 'SURRENDER'))
  ) AS victories,
  COUNT(*) FILTER (WHERE
    (player1_id = :userId AND metadata->>'result' IN ('DEFEAT', 'TIMEOUT', 'DISCONNECT', 'SURRENDER'))
    OR
    (player2_id = :userId AND metadata->>'result' IN ('VICTORY', 'OPPONENT_TIMEOUT', 'OPPONENT_DISCONNECT', 'OPPONENT_SURRENDER'))
  ) AS defeats,
  COUNT(*) FILTER (WHERE metadata->>'result' = 'DRAW') AS draws
FROM replay
WHERE player1_id = :userId OR player2_id = :userId
```

> ⚠️ La perspective est **flippée selon le côté joueur** (la même logique que `ReplayMapper.toDto(replay, userId)`). Un test unit `getStats_whenUserIsPlayer2_flipsResults` est obligatoire.

**Critères d'acceptation** :
- [ ] User avec 3V 2D 0Draw → `{ total:5, victories:3, defeats:2, draws:0, winrate:0.6 }`
- [ ] User avec 0 replay → `{ total:0, victories:0, defeats:0, draws:0, winrate:0.0 }`
- [ ] User en perspective player2 → flip respecté (test obligatoire)
- [ ] Endpoint protégé par auth JWT (rejette 401 sans token)
- [ ] Spec integ avec Testcontainers Postgres vert (PAS H2 — `COUNT(*) FILTER` est Postgres-only)

### Phase F0 — Factoring DS Wave 1 (front, préparatoire) — ~12h

**Scope final 2026-05-14 (post-review adversariale + audit PvP)** — la Wave 1 livre **12 partials DS** + **5 modifiers/utilities additionnels** + **refacto Niveau 1** (BEM, keyframes `ds-*`, `@use` migration, dialog overrides consolidés, nettoyages a11y/focus) + **migrations PvP** (lobby + waiting room + dédoublonnage 6 keyframes). Voir **spec autonome [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md)** pour les inventaires détaillés et **audit PvP [`ds-wave-1-pvp-extraction-audit-2026-05-14.md`](./ds-wave-1-pvp-extraction-audit-2026-05-14.md)** pour le détail des extensions confirmées par le code shippé.

**Fichiers touchés** :

- **Nouveaux partials** (`front/src/app/styles/`) — cf. §2 de la spec :
  - `_a11y.scss` — focus global, reduced-motion global, dark-only, print v1 — §2.1
  - `_motion.scss` — keyframes `ds-*` consolidées + utilities animations — §2.2
  - `_typography.scss` — `.text-gold-gradient`, `.text-eyebrow`, `.text-mono`, `.text-balance` — §2.3
  - `_card-surface.scss` — apparence (background, border, shadow, accent-line, blur, hover) — §2.4
  - `_buttons.scss` — `.btn` + variants `--primary/--secondary/--ghost/--danger` + sizes + `--cta` — §2.5
  - `_pills.scss` — `.pill` (status) + `.badge` (count) clairement distingués — §2.6
  - `_chips.scss` — `.chip` interactif (filter actif/inactif) — §2.7
  - `_icon-button.scss` — `.icon-btn` + sizes + variants — §2.8
  - `_search-bar.scss` — input + clear + focus-within border — §2.9
  - `_page-header.scss` — header vertical + variant `--compact` (sticky horizontal viewer) — §2.10
  - `_section-header.scss` — titre + count (badge) + action (btn ghost) + accent bar — §2.11

- **Partial existant à étendre** :
  - `_empty-state.scss` REFACTO BEM `__` + variant `--rich` + nettoyage `:focus-visible` redondant + keyframe renommée `ds-empty-state-in` — §2.12

- **Refacto Niveau 1** (§3 de la spec, dans le même commit) :
  - `@import` → `@use` dans `styles.scss` + ordre d'import strict (§3.1, §1.3)
  - Renommage keyframes legacy → préfixe `ds-` (§3.2)
  - Migration `.pvp-dialog-panel` `styles.scss` → `_holo-modal.scss` (§3.3)
  - Nettoyage `prefers-reduced-motion` redondants (§3.4)
  - Nettoyage `:focus-visible` redondants (§3.5)
  - Doc `variable.scss` legacy (§3.6)
  - Audit grep pré-F0 + mini-rapport dans PR (§3.7)

- **Migration lobby** (période de coexistence — cf. §1.6 de la spec) :
  - **Commit 1** : nouveaux partials créés. Anciennes classes `.lobby-cta--primary`, `.lobby-filter-chip`, `.empty-state-icon`, etc. **conservées comme alias** dans les nouveaux partials (cf. liste exhaustive §1.6).
  - **Commit 2** : `front/src/app/pages/pvp/lobby-page/lobby-page.component.html` migré vers les nouvelles classes (`.btn.btn--primary.btn--lg.btn--cta`, `.chip.chip--active.chip--gold`, `.search-bar`, `.page-header`, `.section-header`, `.surface-card.surface-card--interactive`, etc.). Tests e2e restent verts grâce aux alias.
  - **Commit 3** (après QA visuelle OK + e2e verts) : grep `lobby-cta--primary` etc. dans front + e2e + scripts. Si 0 occurrence, supprimer les alias.

- **Référencement** : tous les nouveaux partials importés via `front/src/styles.scss` avec `@use` dans l'**ordre strict** défini en §1.3 de la spec.

**Critères d'acceptation** :
- [ ] Les 11 nouveaux partials créés (a11y, motion, typography, card-surface, buttons, pills, chips, icon-button, search-bar, page-header, section-header) + `_empty-state.scss` étendu (variant `--rich` + refacto BEM)
- [ ] **Refacto Niveau 1 effectué** : `@import` → `@use`, keyframes `ds-*`, dialog migrés vers `_holo-modal.scss`, `prefers-reduced-motion` + `:focus-visible` redondants supprimés, `variable.scss` documenté
- [ ] Lobby visuellement **identique** pré/post migration (screenshot QA before/after — Phase F0 critère prioritaire)
- [ ] **Audit grep §3.7** exécuté et résultat documenté dans le commit/PR
- [ ] Tous les **11 garde-fous d'invariance** de §6 de la spec respectés (commandes grep retournent zéro hors exceptions documentées)
- [ ] Aucun hex `#xxxxxx` ou `rgba(...)` hardcodé dans les nouveaux partials (vérifier avec §A2 de la spec)
- [ ] Chaque partial documenté en tête avec le format de la spec (source, variants, tokens consommés, critères)
- [ ] **Garde-fou Material** : les partials ne `@include mat.*` ni n'overridden des sélecteurs `.mat-*` — les overrides Material restent dans `styles/material.scss` + `_holo-modal.scss` (post-migration)
- [ ] Tests Hub + lobby (et autres pages touchées au passage) visuellement non-régressés
- [ ] **Période coexistence** : alias legacy retirés au commit 3 (verrou par grep zéro)

### Phase F1 — Hub Angular (composant + store + HTML/SCSS) — ~4h

**Renommages** :
- `MatchHistoryPageComponent` → `ReplayHubPageComponent`
- `pages/match-history-page/` → `pages/pvp/replay-hub/`
- Route `/pvp/history` reste (compat) — pas de changement Angular routing
- Retirer `adminGuard` du `canActivate` de `/pvp/history` (garder `[AuthService]`)
- **Retirer `adminGuard` de `/pvp/replay/:replayId`** (sinon les replays cliqués depuis le hub se rejettent au routing) — `app.routes.ts` lignes 39-42
- **Retirer le 4e argument `'ADMIN'` de la `Tab` navbar** [components/navbar/navbar.component.ts:49](../../front/src/app/components/navbar/navbar.component.ts#L49). Sans ça le tab reste invisible aux non-admins même route ouverte
- Grep préalable : aucun import externe de `MatchHistoryPageComponent` ne devrait exister (audit confirme : 5 références, toutes internes au composant ou à la route)
- Vérifier que `replay-page.component.ts` lignes 318 + 412 (back-nav `/pvp/history`) reste valide post-rename (la route reste `/pvp/history`, le composant cible change → OK transparent)

**Création `ReplayHubStore`** (clone allégé de `LobbyRoomsStore`) :
```ts
@Injectable()
export class ReplayHubStore {
  readonly replays = signal<ReplayDTO[]>([]);
  readonly stats = signal<ReplayStatsDTO | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly sortMode = signal<ReplaySortMode>('newest');
  readonly activeFilter = signal<ReplayFilter>('all');
  readonly hasMore = signal(true);
  private currentPage = signal(0);

  readonly filteredReplays = computed(() => /* search + filter + sort */);
  readonly stats$ = ... // fetched once on init
  
  start(): void { this.fetchSnapshot(); this.fetchStats(); }
  loadNextPage(): void { ... }
  setSearchQuery(q: string), setSortMode(m), setActiveFilter(f), deleteReplay(id) /* optimistic */
}
```

**HTML / SCSS** : adopter les partials Phase F0 + structure du mockup.

⚠️ **`cdk-virtual-scroll` requiert une hauteur bornée** (audit 2026-05-14) — le lobby utilise `.room-list-viewport { height: 65vh }` ([lobby-page.component.scss:352-354](../../front/src/app/pages/pvp/lobby-page/lobby-page.component.scss#L352-L354)). Le hub doit appliquer le même pattern : `.replay-list-viewport { height: 65vh; /* ou calc(100dvh - header - filters) */ }`. Sans hauteur explicite, virtual-scroll crash silencieusement (viewport 0 height).

⚠️ **`CustomPageable.size` = `totalElements` (mal nommé)** ([CustomPageable.java](../../back/src/main/java/com/skytrix/.../CustomPageable.java)) — `size = page.getTotalElements()` côté Java. Pour `hasMore()` :
```ts
hasMore = computed(() => this.replays().length < (this.totalElements() ?? 0));
```
NE PAS confondre avec `pageSize` (taille de la requête).

**Critères d'acceptation** :
- [ ] Tous les états visuels du mockup rendus (default / loading / empty / no-results / error)
- [ ] Stats strip affichée si `stats()` non-null, cachée sinon
- [ ] Click sur une replay-card → navigation `/pvp/replay/:id`
- [ ] Click trash + confirm → delete + remove optimistic + rollback si erreur back
- [ ] Filtres chips changent `activeFilter()`, sort change `sortMode()`, search change `searchQuery()` → `filteredReplays()` se met à jour
- [ ] Scroll infini : `(scrolledIndexChange)` déclenche `store.loadNextPage()` quand `viewport.getRenderedRange().end >= replays().length - 5` ET `hasMore() === true` ET `!loading()` (pattern Material standard ; le seuil de 5 items évite à la fois les déclenchements multiples et les blanks visibles). Empty state cdk-virtual-scroll : importer `ScrollingModule`.
- [ ] `adminGuard` retiré de `/pvp/history` ET `/pvp/replay/:replayId` → user non-admin accède aux deux ✓
- [ ] Filtre `'ADMIN'` retiré de la `Tab` navbar ligne 49 → tab "Replays" visible pour tous les users authentifiés
- [ ] Filtre "Mon deck" (option C tranchée) : matcher `metadata.deckNames[mySide]` (selon `player1Id === user.id ? 0 : 1`) contre `DeckBuildService.decks$()[0]?.name`. Si la liste est vide → filtre désactivé (chip absent ou disabled).

### Phase F2 — Skeletons — ~1h

**Fichiers touchés** :
- `front/src/app/shared/skel/replay-card-skeleton.component.ts` (nouveau)
- `front/src/app/shared/skel/skel.scss` (extend) — ajouter `.replay-card-skel` block
- `front/src/app/shared/skel/index.ts` (export)

**Critères d'acceptation** :
- [ ] Structure DOM du skeleton matche la replay-card (avatar 48 + 2 lignes + pill + meta + actions)
- [ ] Animation `skel-sweep` (existante, partagée) appliquée
- [ ] `prefers-reduced-motion` désactive l'animation (déjà géré au niveau global du partial)

### Phase F3 — Polish + cas limites + i18n + tests — ~3h

**Fichiers touchés** :
- `front/src/assets/i18n/{en,fr}.json` — **remplacer** `replay.matchHistory.*` par `replay.hub.*` (suppression complète des clés legacy dans le même commit ; le seul consommateur est `MatchHistoryPageComponent` qui disparaît, pas de période de transition nécessaire)
- `front/src/app/pages/pvp/replay-hub/replay-hub-store.spec.ts` (nouveau) — specs filter/sort/optimistic delete
- `front/src/app/pages/pvp/replay-hub/replay-hub.component.spec.ts` (migré depuis match-history)
- `front/src/app/services/replay.service.ts` — ajouter `getStats()`
- `front/src/app/core/model/dto/replay-dto.ts` — `durationSec?: number`
- `front/src/app/core/model/dto/replay-stats-dto.ts` (nouveau)

**i18n keys à créer** (FR + EN) :

| Clé | FR | EN |
|---|---|---|
| `replay.hub.title` | Bibliothèque de replays | Replay library |
| `replay.hub.subtitle` | Tes duels enregistrés | Your saved duels |
| `replay.hub.back` | Lobby | Lobby |
| `replay.hub.stats.total` | Replays | Replays |
| `replay.hub.stats.victories` | Victoires | Victories |
| `replay.hub.stats.defeats` | Défaites | Defeats |
| `replay.hub.stats.winrate` | Winrate | Win rate |
| `replay.hub.search.placeholder` | Filtrer par adversaire ou deck… | Filter by opponent or deck… |
| `replay.hub.filter.all` | Tous | All |
| `replay.hub.filter.wins` | Victoires | Wins |
| `replay.hub.filter.losses` | Défaites | Losses |
| `replay.hub.filter.myDeck` | Mon deck | My deck |
| `replay.hub.filter.last7days` | 7 derniers jours | Last 7 days |
| `replay.hub.list.title` | Replays | Replays |
| `replay.hub.list.count` | {count} résultats | {count} results |
| `replay.hub.sort.newest` | Plus récents | Newest |
| `replay.hub.sort.oldest` | Plus anciens | Oldest |
| `replay.hub.sort.mostTurns` | Plus de tours | Most turns |
| `replay.hub.empty.title` | Aucun replay pour le moment | No replays yet |
| `replay.hub.empty.desc` | Joue un duel en ligne ou en bac à sable — tes parties seront automatiquement enregistrées ici. | Play a duel online or in sandbox — your matches will be saved here. |
| `replay.hub.empty.ctaPvp` | Jouer en PvP | Play PvP |
| `replay.hub.empty.ctaSandbox` | Bac à sable | Sandbox |
| `replay.hub.noResults.title` | Aucun résultat | No results |
| `replay.hub.noResults.desc` | Modifie les filtres ou la recherche pour voir d'autres replays. | Adjust filters or search to see more replays. |
| `replay.hub.noResults.clearFilter` | Effacer les filtres | Clear filters |
| `replay.hub.error.title` | Impossible de charger les replays | Unable to load replays |
| `replay.hub.error.retry` | Réessayer | Retry |
| `replay.hub.card.vsPrefix` | vs | vs |
| `replay.hub.card.vsDeckPrefix` | vs | vs |
| `replay.hub.card.open` | Ouvrir | Open |
| `replay.hub.card.delete` | Supprimer | Delete |
| `replay.hub.card.deleteConfirm` | Voulez-vous vraiment supprimer définitivement ce replay ? | Delete this replay permanently? |
| `replay.hub.card.result.victory` | Victoire | Victory |
| `replay.hub.card.result.defeat` | Défaite | Defeat |
| `replay.hub.card.result.draw` | Égalité | Draw |
| `replay.hub.card.result.timeout` | Timeout | Timeout |
| `replay.hub.card.result.timeoutOpp` | Timeout adv. | Opp. timeout |
| `replay.hub.card.result.surrender` | Abandon | Surrender |
| `replay.hub.card.result.surrenderOpp` | Abandon adv. | Opp. surrender |
| `replay.hub.card.result.disconnect` | Déconnexion | Disconnect |
| `replay.hub.card.result.disconnectOpp` | Déconn. adv. | Opp. disconn. |
| `replay.hub.card.turns` | {n} tours | {n} turns |

**Critères d'acceptation** :
- [ ] Tous les états i18n présents en FR et EN, aucun fallback brut
- [ ] `replay-hub-store.spec.ts` couvre : filter par chaque mode, sort par chaque mode, optimistic delete + rollback
- [ ] `replay-hub.component.spec.ts` couvre : navigation au click, confirm dialog ouvert au delete, stats strip cachée si `stats()` null
- [ ] QA responsive : 360 / 414 / 768 / 1024 / 1280 / 1920 OK
- [ ] Lighthouse a11y score ≥ 95 sur la page (à vérifier au moment du commit final)

## 5. Effort total

| Phase | Description | Effort |
|---|---|---|
| B1 | `durationSec` (Node + Java + mapper flip + TS DTO) | 45 min |
| B2 | Endpoint `GET /replays/stats` (+30 min testcontainers setup) | 2h |
| F0 | Factoring DS **Wave 1 — 12 partials + 5 modifiers/utilities + refacto Niveau 1 + migrations PvP** (lobby + waiting room en 3 commits avec période coexistence, voir spec [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) + audit PvP [`ds-wave-1-pvp-extraction-audit-2026-05-14.md`](./ds-wave-1-pvp-extraction-audit-2026-05-14.md)) | 12h |
| F1 | Hub Angular complet (composant + store + double adminGuard removal + navbar + empty-state inline + virtual-scroll height) | 4h |
| F2 | Skeletons | 1h |
| F3 | Polish + i18n + tests + QA | 3h |
| **TOTAL** | | **~22h45** |

> **Note 2026-05-14 (post-review adversariale + audit PvP)** : la Wave 1 DS ajoute ~10h vs estimation initiale F0 (2h → 12h). C'est un **investissement structurant** confirmé par :
> - L'**audit croisé Hub × Viewer** (review adversariale 2026-05-14) — 20 incohérences/manques identifiés et corrigés
> - L'**audit du code PvP shippé** (`ds-wave-1-pvp-extraction-audit-2026-05-14.md`) — 5 modifiers/utilities additionnels confirmés par lobby+waiting room en prod, 6 keyframes consolidées (résolution de duplications)
>
> Les 12 partials + 5 modifiers seront tous consommés par au moins **2 écrans** dès la livraison du Hub + lobby + waiting room migrés, et **3+ écrans** dès le rework Viewer + futur deck-builder. Pas d'API spéculative — uniquement des classes utilities SCSS confirmées par 1+ consommateur réel. Composants Angular différés à Wave 2 (rule of three).

## 6. Risques + mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `metadata->>'result'` JSONB query lente sur user >1000 replays | Faible | Cap retention via `purgeExpiredReplays`. Index partiel si jamais |
| Perspective flip oubliée dans stats query | Moyenne | Test unit `getStats_whenUserIsPlayer2_flipsResults` obligatoire |
| Perspective flip oubliée dans `ReplayMapper.toDto` pour `durationSec` | Moyenne | Champ ajouté explicitement au `new ReplayMetadata(...)` flippé + test d'intégration `getMatchHistory_whenUserIsPlayer2_preservesDurationSec` |
| `durationSec` legacy null mal géré côté front | Faible | Template `@if (metadata.durationSec; as d)` cache l'affichage |
| Migration replays existants pour leur ajouter `durationSec` | N/A | **Pas faisable** — accepté (decision D4) |
| Stats endpoint coût sous load | Faible | Sur 50 replays/user c'est gratuit. Cache 60s `@Cacheable` si jamais |
| Factoring SCSS casse le lobby | Moyenne | Migration lobby dans le même commit + screenshot QA before/after |
| Rename `MatchHistoryPage → ReplayHub` casse des imports | Faible | Grep préalable obligatoire (audit 2026-05-14 : 5 références, toutes internes, OK) |
| Test infra Java partielle (JUnit5+Mockito présents via `spring-boot-starter-test`, Testcontainers absent) | Faible | Audit 2026-05-14 : pas de bootstrap massif requis, juste ajouter `org.testcontainers:postgresql` à `pom.xml` (~30 min) pour le test integ B2 |
| `DeckBuildService.activeDeck()` n'existe pas | Moyenne | Décision 2026-05-14 : option C retenue, matcher `decks$()[0]?.name` (premier deck arbitraire) |
| `<app-empty-state>` ne supporte qu'1 CTA, mockup en demande 2 | Faible | Audit 2026-05-14 deuxième passe : template inline + utility classes `.empty-state` à la place (D10 patché) |
| `CustomPageable.size` mal nommé (= `totalElements`) | Faible | Documenté dans F1 ; ne pas confondre avec `pageSize` |
| `cdk-virtual-scroll` sans hauteur bornée = crash silencieux | Faible | F1 : copier le pattern lobby `.replay-list-viewport { height: 65vh }` |
| `duelStartMs` mal capturé (worker n'a pas accès à `session.startedAt` du main thread) | Moyenne | Variable module-level dans `duel-worker.ts`, initialisée dans `initDuel()` ligne 1444 |
| `/pvp/replay/:id` toujours admin-gated alors que `/pvp/history` est ouvert | Moyenne | D1 patché : retirer `adminGuard` des **deux** routes + filtre `'ADMIN'` du tab navbar |

## 7. Ordre de livraison recommandé

```
B1 (back durationSec) ────────► B2 (back stats endpoint) ────────►
F0 (factoring DS, lobby migré) ──► F1 (hub Angular) ──► F2 (skeletons) ──► F3 (polish + i18n + tests)
```

**Parallélisation possible** : B1+B2 peuvent être en cours pendant F0 (factoring DS) puisque F0 ne dépend pas du back. F1 ne démarre qu'après F0 ET les endpoints back déployés (avec garde-fou gracefully degrade si stats endpoint pas dispo).

## 8. Annexes

### A0. DS Wave 1 — Voir spec autonome

**📘 Spec complète déplacée vers un fichier dédié** (décisions DS-D1 + DS-D2, post-review adversariale 2026-05-14) :

👉 **[`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md)** — référence d'implémentation **autonome** réutilisable par tous les reworks futurs.

**Contenu** (12 partials + 5 modifiers/utilities post-audit + refacto Niveau 1 + migrations PvP, effort ~12h dans Phase F0) :

| § | Partial / Refacto | Effort |
|---|---|---|
| §2.1 | `_a11y.scss` — focus global, reduced-motion global, dark-only, print v1, sr-only | 20 min |
| §2.2 | `_motion.scss` — 16 keyframes `ds-*` + utilities `.fade-in`/`.is-spinning`/`.pulse-dot`/`.card-entry`/`.is-chosen` | **55 min** |
| §2.3 | `_typography.scss` — `.text-gold-gradient`, `.text-eyebrow`, `.text-mono`, `.text-balance`, **`.text-code`** | **45 min** |
| §2.4 | `_card-surface.scss` — apparence uniquement (interactive + accents tonals), layout libre | 30 min |
| §2.5 | `_buttons.scss` — `.btn--primary/--secondary/--ghost/--danger` × 3 sizes + `--cta` + **`--cta-shimmer`** + **`--success-flash`** | **1h15** |
| §2.6 | `_pills.scss` + `.badge` — pill (status) vs badge (count) + **`.pill--live`** | **1h** |
| §2.7 | `_chips.scss` — chip interactif (filter) + container query mobile | 30 min |
| §2.8 | `_icon-button.scss` — sizes + variants danger/active/round/ghost-hover-only | 30 min |
| §2.9 | `_search-bar.scss` — input + clear (via `.icon-btn --sm`) + focus-within border | 20 min |
| §2.10 | `_page-header.scss` — header vertical + variant `--compact` (sticky horizontal viewer) | 45 min |
| §2.11 | `_section-header.scss` — titre + count (badge) + action (btn ghost) + accent bar | 20 min |
| §2.12 | `_empty-state.scss` REFACTO — BEM `__`, variant `--rich`, suppression `:focus-visible` redondant | 40 min |
| §3.1 | `@import` → `@use` migration `styles.scss` | 30 min |
| §3.2 | Renommage keyframes legacy → préfixe `ds-` | 20 min |
| §3.3 | Migration `.pvp-dialog-panel` `styles.scss` → `_holo-modal.scss` | 30 min |
| §3.4 | Nettoyage `prefers-reduced-motion` redondants (couverts par `_a11y.scss`) | 15 min |
| §3.5 | Nettoyage `:focus-visible` redondants | 5 min |
| §3.6 | Doc `variable.scss` legacy "do not extend, do not delete" | 5 min |
| §3.7 | Audit grep pré-F0 (verrou) + mini-rapport dans PR | 20 min |
| **Migrations PvP** (post-audit 2026-05-14, voir `ds-wave-1-pvp-extraction-audit-2026-05-14.md`) | | |
| — | Lobby `.lobby-cta--primary` → `.btn.btn--primary.btn--cta-shimmer.btn--lg.btn--cta` | inclus migration lobby |
| — | Lobby `.room-status-dot` → `.pulse-dot` utility | +10 min |
| — | Lobby `.room-card--new` → ajouter `.card-entry` | +5 min |
| — | Waiting room `.waiting-status-tag` → `.pill.pill--gold.pill--md.pill--live` | +10 min |
| — | Waiting room `.waiting-title` → `.text-gold-gradient` | +5 min |
| — | Waiting room `.room-code-value` → `.text-code` | +5 min |
| — | Waiting room `.code-copy-btn` → `.btn.btn--primary.btn--md` + JS `.btn--success-flash` | +15 min |
| — | Dédoublonnage `replay-chosen-pulse` 4× → `ds-chosen-pulse` | +20 min |
| — | Dédoublonnage `chain-badge-pulse` 2× → `ds-chain-badge-pulse` | +10 min |
| — | Migration lobby (templates + SCSS) | 1h |
| — | Tests QA visuels screenshot before/after | 30 min |
| **TOTAL F0** | | **~12h** |

**Conventions transverses** (cf. §1 de la spec) :

- **BEM strict `__`** pour les nouveaux composants (`.btn__icon`, jamais `.btn-icon`). Legacy kebab-simple migré au passage.
- **Préfixe `ds-`** pour toutes les keyframes DS (`@keyframes ds-spin`, jamais `@keyframes spin`).
- **Ordre d'import strict** dans `styles.scss` (`@use` ordre : `_tokens` → `_a11y` → `_motion` → `_typography` → ...) — cf. §1.3.
- **Container queries** recommandées pour composants partagés (`@container` plutôt que `@media`) — cf. §1.5.
- **Période de coexistence 1 semaine** : anciennes classes aliasées, migration template par template, suppression au commit 3 (verrou par grep zéro) — cf. §1.6.
- **Dark-only verrouillé** (DS-D7), **print v1 = body display:none** (DS-D10), **pas de logique RTL** (DS-D11).
- **Aucun z-index dans les partials** (via `_z-layers.scss`), **aucune valeur hardcodée** (hex / rgba / px non-multiples-de-4).

**Garde-fous d'invariance** (11 critères de PR review) — cf. §6 de la spec. Commandes de monitoring grep — cf. §A2.

**Roadmap suivante** :
- **Wave 1.5** (après livraison Hub, avant Viewer rework, ~6-8h) : page `/dev/ds` Angular + migration des 56 hex hardcodés `pages/*.scss` + audit `!important` + décommissionnement vieux tokens
- **Wave 2** (au 3ème écran refondu, ~15h) : extraction composants Angular (`<app-button>`, `<app-chip>`, etc.) + Stylelint + README docs
- **Wave 3** (opportuniste lors rework PvP/Solver, ~4-6h) : promotion tokens `--pvp-*` / `--solver-*` → DS global

---

### A0bis. Notes de cohérence pour Phase F0 du Hub

> Décisions internes à la spec DS Wave 1 dont l'impact se voit directement dans le scope du Hub.

**Pour le Hub spécifiquement, retenir** :

1. **Replay cards** = `.surface-card.surface-card--interactive.surface-card--accent-{gold,neutral,cyan,warning,danger}` selon `result` (`computed signal` côté `ReplayHubStore`). Mapping :
   | `result` | Modifier |
   |---|---|
   | `VICTORY`, `OPPONENT_TIMEOUT`, `OPPONENT_DISCONNECT`, `OPPONENT_SURRENDER` | `--accent-gold` |
   | `DEFEAT`, `TIMEOUT`, `DISCONNECT`, `SURRENDER` | `--accent-neutral` |
   | `DRAW` | `--accent-cyan` |
   | (legacy `timeout` exposé spécifiquement) | `--accent-warning` |
   | (legacy `surrender` exposé spécifiquement) | `--accent-danger` |
2. **Result pill** dans chaque card = `.pill.pill--<variant>.pill--md` avec le même mapping `result → variant`.
3. **Count "47 résultats"** = `.badge.badge--gold` (PAS pill — c'est un compteur Inter non-uppercase, cf. §1.4 disambiguation).
4. **CTAs empty state** = 2 boutons :
   - `<button class="btn btn--primary btn--lg btn--cta">` (Play PvP)
   - `<button class="btn btn--secondary btn--lg btn--cta">` (Sandbox)
5. **Search bar** = `.search-bar` + `.search-bar__input` + `.search-bar__clear` (`= .icon-btn --sm` via @extend ou class composé côté template).
6. **Filter chips row** = `.chip-row` qui devient horizontal-scroll en mobile via container query (le parent doit avoir `container-type: inline-size`).
7. **Skeleton replay-card** = composant Angular dédié `<app-replay-card-skeleton>` (Phase F2) — utilise `.surface-card.surface-card--low` + `<app-skel>` primitives.

**Garde-fou Phase F1** (au moment du codage Angular) : si une classe legacy `.lobby-*` ou `.hub-*` est utilisée dans le template Hub, c'est une regression — la migration doit utiliser EXCLUSIVEMENT les classes DS Wave 1.

---

### A1. Décisions UX déjà validées (mockup)

Voir [`_mockups/mockup-replay-hub.html`](../../_mockups/mockup-replay-hub.html) et [`memory/project_replay_rework_2026_05_14.md`](../../memory/project_replay_rework_2026_05_14.md) pour les détails du langage visuel Holographic Arena.

### A2. Patterns DS référents

- Mockup référentiel : [`_mockups/mockup-1-holo-arena.html`](../../_mockups/mockup-1-holo-arena.html) (DS skytrix complet)
- Lobby implémenté : `front/src/app/pages/pvp/lobby-page/` (shipped 2026-05-13)
- Convention skeleton : [`memory/project_skeleton_screens_convention.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_skeleton_screens_convention.md)
- Convention design system : [`memory/project_design_system_strategy.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_design_system_strategy.md)

### A3. Hors scope explicite

- Replay Viewer refonte (traité dans [`replay-viewer-rework-2026-05-14.md`](./replay-viewer-rework-2026-05-14.md), livrable en parallèle ou après le hub)
- Annotations / bookmarks sur replays
- Partage public d'un replay (URL publique)
- Replay tags / catégorisation user-defined
- Liste des decks préférés pour le filtre "Mon deck" (v1 = deck principal courant uniquement)

---

**Document maintenu par** : Sally (UX Designer) + Axel
**Dernière mise à jour** : 2026-05-14 (création + 1ère passe review + 2ème passe + décisions finales D5/B2 + **3ème passe : DS Wave 1 review adversariale** (20 incohérences résolues, A0 extrait vers spec autonome) + **4ème passe : audit code PvP shippé** (5 modifiers/utilities additionnels confirmés, 6 keyframes consolidées, F0 9h → 12h). Plan prêt pour exécution.)
**Spec DS Wave 1 référente** : [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) — 1600 lignes, autonome, réutilisable par tous les reworks futurs
**Audit PvP** : [`ds-wave-1-pvp-extraction-audit-2026-05-14.md`](./ds-wave-1-pvp-extraction-audit-2026-05-14.md) — couverture spec vs code shippé, recommandations case-by-case
