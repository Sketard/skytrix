---
title: Replay Viewer — Rework Implementation Tracking
author: Sally (UX Designer) + Axel
date: 2026-05-14
status: APPROVED — ready for implementation
scope: Page `/pvp/replay/:replayId` refonte Holographic Arena + responsive mobile width-driven
mockup: _mockups/mockup-replay-viewer.html
related:
  - _bmad-output/planning-artifacts/replay-hub-rework-2026-05-14.md
  - _bmad-output/planning-artifacts/ux-audit-pvp-replay-2026-05-08.md
  - memory/project_replay_rework_2026_05_14.md
  - memory/project_pvp_lobby_rework_plan.md
---

# Replay Viewer — Refonte Holographic Arena + Mobile

## 1. Objectif

Refondre la page `/pvp/replay/:replayId` (actuellement `ReplayPageComponent` + `TimelineBarComponent` + `TransportBarComponent` Material) en viewer Holographic Arena cohérent avec le lobby PvP (shipped 2026-05-13) et le hub Replay (en cours, voir [replay-hub-rework-2026-05-14.md](./replay-hub-rework-2026-05-14.md)). Ajouter un mode mobile **width-driven** (≤ 760px) qui remplace la bande timeline par un stepper + picker grille + swipe board. **Ne pas toucher** au board lui-même ni aux composants partagés PvP.

**Mockup de référence** : [`_mockups/mockup-replay-viewer.html`](../../_mockups/mockup-replay-viewer.html)

> **⚠️ Pré-requis 2026-05-14** : ce viewer **consomme directement le DS Wave 1** (12 partials + 5 modifiers/utilities) livré par [`replay-hub-rework-2026-05-14.md`](./replay-hub-rework-2026-05-14.md) Phase F0. Spec autonome : [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md). Le Hub-rework DOIT être livré en prod **avant** le Viewer (cf. §7 — ordre de livraison). Sans le DS Wave 1, les composants F1-F4 référencent des classes utility qui n'existent pas (`.btn`, `.pill`, `.icon-btn`, `.surface-card`, `.text-gold-gradient`, etc.).

## 2. Décisions validées (2026-05-14)

| # | Sujet | Décision | Notes |
|---|---|---|---|
| **D1** | Critère responsive | **Width-driven** uniquement (`@media (max-width: 760px)`). PAS d'orientation/height. | Feedback Axel : "il faudrait gérer cela par rapport à la largeur, pas la hauteur". iPad portrait (768px), phone landscape, phone portrait → tous unifiés sous le même UI compact. Breakpoint `NARROW_BREAKPOINT = 760` constante TS exposée. Montable à 800 si on veut iPad portrait en stepper. |
| **D2** | Orientation lock | **CONSERVÉ dans le replay viewer** (revue 2026-05-14 post-impl B1+B2). `<app-orientation-lock>` extrait dans `shared/orientation-lock/` au passage (consolidation avec duel-page). | Raison pragmatique : le viewer **réutilise les composants PvP** (`<app-pvp-board-container>`, hand-rows, zone-browser, card-inspector, chain-overlay, prompt-dialog) qui ne sont **PAS responsive portrait** (board layout intrinsèquement landscape 16:9, 7 zones × 2 lignes). Tant que le PvP duel reste landscape-only, le replay viewer doit l'être aussi. La décision initiale "observation pure → pas besoin de rotation forcée" sous-estimait le coût d'adapter les composants PvP au portrait. À reconsidérer si/quand le PvP duel devient adaptable portrait. |
| **D3** | Timeline mobile | Bande timeline desktop **remplacée** par stepper `◀ pill ▶` + row sub-events tour courant. La pill ouvre un picker bottom-sheet grille 3 cols. | Stepper cibles 44×44 WCAG. Sub-events row préserve seek fin intra-tour. |
| **D4** | Picker format | **Grille 3 colonnes avec mini-board** (3 options proposées, choix Axel). Sections "Préparation" (T0) + "Tours du duel" (T1..N). | Chaque card : `T{N}` + mini-avatar joueur + mini-board 16:9 + footer (durée + count events). Tour courant = ring doré. Not-computed = stripes + ⏳ disabled. Auto-scroll sur tour courant à l'ouverture (250ms). |
| **D5** | Setup (T0) | **Inclus dans le stepper** comme tour normal (`◀ ▶` navigue T0 → T1 → …). Affiché dans section "Préparation" distincte du picker. | Choix Axel parmi 2 options (vs bouton "↺ Début" séparé). |
| **D6** | Swipe board | **Activé**. Threshold 60px horizontal, < 80px vertical, < 600ms. Flash doré sur le bord pendant le swipe. Hint "Glisse pour changer de tour" affiché 3s à l'ouverture, fadeout au premier swipe. | Choix Axel. ⚠️ Conflit futur potentiel avec zoom carte ; au portage Angular, attacher la directive au **fond** du board, PAS aux cards. |
| **D7** | Zoom timeline | 3 niveaux `1× / 2× / 3×` desktop ≥ 920px. **Mini-control placé dans `.transport-options`** (cluster droite), PAS dans la timeline-bar elle-même. Wheel scroll sur la bande zoom aussi. | Le control flottant z-index:10 dans la timeline masquait le dernier tour. Le déplacer libère 100% de la bande. Caché sous 920px (cramped + power-user feature). Mockup simplifié : pas de cursor-anchored scroll preservation — l'impl Angular actuelle fait ça via rAF loop ([timeline-bar.component.ts:230-269](../../front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts#L230-L269)), à conserver intégralement. |
| **D8** | Drag-to-seek | **Existe déjà** côté Angular ([onMouseDown/onTouchStart](../../front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts#L183-L228)). Au portage refonte, garder ce comportement. Mockup ajoute cursor `grab/grabbing` visuel. | Hover popover désactivé pendant `isScrubbing` à conserver. |
| **D9** | Position label | Format aligné : `Tour 3 · ⚡ Main 1 · P1 · Activation : Snake-Eye Ash`. Phase ajoutée comme chip dédié `.context-phase` entre position et event-label. | Matche [positionLabel computed](../../front/src/app/pages/pvp/replay/replay-page.component.ts#L205-L211). |
| **D10** | Loading progress | Texte enrichi : "Chargé **6 / 11** tours · {label}". Label `.replay-loading-label` caché sous 480px. Skeleton board + timeline + transport (pas de spinner plein écran). | Matche [progressText computed](../../front/src/app/pages/pvp/replay/replay-page.component.ts#L223-L233). Loading hint reste toast bas centré. |
| **D11** | Keyboard bindings | Aligné 1:1 sur [replay-page.component.ts:500-512](../../front/src/app/pages/pvp/replay/replay-page.component.ts#L500-L512) : `Espace/← →/Home/End/F/A/M/D/G/V/?/Esc`. **`M` = mode décisions/résultats** (l'ancien mockup mettait `D`, c'était une erreur), **`D` = panneau debug**, **`G` = niveau log normal/debug**. | Pas de `M = Manuel/auto` (feature inventée par ancien mockup, n'existe pas en Angular). |
| **D12** | Cheat sheet modal | Ouvrable via `?` ou bouton keyboard ghost dans transport-bar (pas dans la topbar, plus near du contexte d'usage). Bottom-sheet sous ≤ 480px. | Listing organisé en 3 sections : Lecture / Visionnage / Actions. |
| **D13** | Cascade de masquage transport-context | Progressive selon largeur : ≤ 920px cache `.context-event-label` + `.context-phase` ; ≤ 480px cache aussi `.context-position`. Turn pill `3 / 11 tours` reste jusqu'au bout. | Évite l'effet "tout disparaît d'un coup". |
| **D14** | Topbar mobile | Sous ≤ 480px : back-btn devient icône-only, decks cachés, pills meta cachées, copy-link caché. Apparition du bouton `ⓘ Détails` → ouvre `#detailsSheet`. | Conserve la summary minimale (vs adversaire). |
| **D15** | Transport mobile (≤ 480px) | Toggles + perspective + fork + cheat-sheet + zoom **regroupés sous "⋯ More"** ouvrant `#optionsSheet`. Play reste 48px prominent. Dot doré sur `⋯` si une option non-default est active. | Sans cette compression, le transport déborde à 360px. |
| **D16** | Fork mobile hint | Dans `#optionsSheet`, l'entrée Forker a un meta "Mieux sur un écran plus grand". | Pas de blocage, juste un nudge UX. |
| **D17** | Toggle preview dev | Toolbar mockup réduite à `🖥 Desktop` + `📱 Mobile` (414px) + select largeur. Plus de boutons Portrait/Landscape. La classe `.is-narrow` sur `#screen` réplique les règles `@media (max-width: 760px)` pour preview desktop sans resize fenêtre. | Mécanisme dans le mockup uniquement, n'a pas d'équivalent Angular (côté Angular = pur MQ). |
| **D18** | End-overlay — bouton Fork | **Retiré.** L'end-overlay (`atEnd() === true`) propose `Rejouer` + `Bibliothèque` seulement (2 CTAs au lieu de 3). | Forker depuis l'état terminal d'un duel terminé n'a pas de sens jeu : pas de pile à dérouler, MSG_WIN déjà émis. Le bouton resterait fonctionnel via `ReplayForkService.fork(currentIndex)` mais aboutirait sur un duel solo immédiatement en game-over. Le mockup peut être déjà conforme au mockup ; l'impl Angular doit OMETTRE le bouton Fork. À mettre à jour dans `_mockups/mockup-replay-viewer.html` aussi. |
| **D19** | End-overlay — détermination du résultat | Mapper côté front : `metadata.result` (string) → `'victory' \| 'defeat' \| 'draw'` selon perspective courante. **Pas de nouveau champ protocole.** | `ReplayMetadataMsg.result` est un free-form string (`"victory"`, `"defeat"`, `"draw"`, `"timeout"`, `"surrender"`, etc. — voir `replay.matchHistory.*` i18n keys existantes). Helper pur `deriveOutcome(result, perspectiveIndex, mySide): 'victory' \| 'defeat' \| 'draw'` à ajouter dans `replay-page.component.ts` (ou `replay-outcome.util.ts` si réutilisé par hub). LP des deux joueurs lus dans `boardStates[currentIndex].boardState.players[0\|1].lp`. |
| **D20** | Copy-link feature | Bouton "Copier le lien à ce moment" dans `<app-replay-topbar>` (desktop) + `#optionsSheet` (mobile). Construit `${window.location.origin}/pvp/replay/${replayId}?seekTo=${currentIndex}` puis `navigator.clipboard.writeText(url)` + toast `replay.viewer.copyLinkToast`. | La logique `seekTo` query-param existe déjà côté `ReplayPageComponent.ngOnInit` (l. 417-421) — c'est l'envers (génération du lien). Handler `onCopyLink()` à ajouter dans la page + binding sur le topbar `(copyLink)` output. Fallback en cas d'absence de `navigator.clipboard` (HTTP localhost) : `document.execCommand('copy')` sur un input temporaire. |
| **D21** | Zoom timeline — ownership du state | `zoomLevel` migré du `TimelineBarComponent` interne vers `ReplayPageComponent`. Le timeline-bar devient stateless sur ce point (input `level` + output `levelChange`). Le `<app-timeline-zoom-control>` ET le `wheel` interne de la timeline émettent vers le même signal page. | Sans cette migration, le control de zoom dans la transport-bar et le wheel scroll de la timeline seraient désynchronisés. Le wheel handler de `TimelineBarComponent` ([timeline-bar.component.ts:230-269](../../front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts#L230-L269)) garde la logique cursor-anchored + rAF mais émet `zoomLevelChange` au lieu de muter `this.zoomLevel`. |
| **D22** | Hand-rows positioning | **CONSERVER** le `position: absolute` des hand-rows dans `replay-page.component.scss`. **PAS** de retrait. | Vérifié 2026-05-14 : `<app-pvp-board-container>` ne positionne PAS les hand-rows ; les CSS rules dans [replay-page.component.scss:39-57](../../front/src/app/pages/pvp/replay/replay-page.component.scss#L39-L57) et [duel-page.component.scss:35-50](../../front/src/app/pages/pvp/duel-page/duel-page.component.scss#L35-L50) sont **requises**. La note F4 SCSS prétendait à tort "déléguées à `<app-pvp-board-container>`" — corrigée. |

## 3. Architecture cible

### Composants & services réutilisés tels quels (PvP-shared — ne pas toucher)

| Item | Chemin | Rôle dans le viewer |
|---|---|---|
| `<app-pvp-board-container>` | `pvp/duel-page/pvp-board-container/` | Board principal (réutilise tous les composants children) |
| `<app-pvp-hand-row>` | `pvp/duel-page/pvp-hand-row/` | Mains opponent + player |
| `<app-pvp-zone-browser-overlay>` | `pvp/duel-page/pvp-zone-browser-overlay/` | Right sidebar (GY/Banished/Extra) |
| `<app-pvp-card-inspector-wrapper>` | `pvp/duel-page/pvp-card-inspector-wrapper/` | Inspector card (refonte premium deferred — `card-inspector-premium-spec`) |
| `<app-pvp-chain-overlay>` | `pvp/duel-page/pvp-chain-overlay/` | Overlay résolution chain |
| `<app-pvp-prompt-dialog>` | `pvp/duel-page/prompts/pvp-prompt-dialog/` | Mode décisions readonly |
| `<app-pvp-duel-overlays>` | `pvp/duel-page/pvp-duel-overlays/` | Phase announcement + toast |
| `<app-orientation-lock>` | `shared/orientation-lock/` | **Utilisé dans le replay** (D2 revue 2026-05-14) — extrait au passage en `shared/` pour réutilisation PvP duel + Replay viewer. Render conditionnel via `@if (isPortrait()) { ... }` interne au composant. |
| `<app-debug-log-panel>` | `pvp/duel-page/debug-log-panel/` | Panneau debug latéral (touche `D`) |
| `<app-skel>` | `shared/skel/skel.component.ts` | **Primitive skeleton** — `<app-replay-loading-skeleton>` (F1) DOIT consommer cette primitive (variants `rect`/`circle`/`pill`/`text-*`), pas écrire son propre wireframe. Convention skytrix : `project_skeleton_screens_convention.md`. |
| `<app-bottom-sheet-handle>` | `shared/bottom-sheet-handle/` | **Handle drag-to-close partagé** — `<app-replay-bottom-sheet>` (F1) DOIT l'inclure comme premier enfant (pattern MatDialog : pointerdown→close à 30% surface OU velocity > 0.5 px/ms). Visible <768px, masqué au-dessus. Source mockup-1-holo-arena.html |
| `<app-avatar>` | `shared/avatar/` | Avatar joueurs dans `<app-replay-topbar>` + `#detailsSheet` (hue dérivée du pseudo) |
| `ReplayConnectionService` | `pvp/replay/replay-connection.service.ts` | WS connection + précomputation |
| `ReplayTransportService` | `pvp/replay/replay-transport.service.ts` | Transport state (playing, currentIndex). **API à étendre** — voir F2/F4 (ajout `seekToTurn(turnIndex: number)`). |
| `ReplayForkService` | `pvp/replay/replay-fork.service.ts` | Fork solo depuis un point |
| `ReplayDuelAdapter` | `pvp/replay/replay-duel-adapter.ts` | `AnimationDataSource` impl replay |
| `AnimationOrchestratorService` | `pvp/duel-page/animation-orchestrator.service.ts` | Animations partagées PvP (Animation Parity Rule — voir CLAUDE.md) |

### Composants & services nouveaux (chrome propre au replay)

| Item | Chemin | Rôle |
|---|---|---|
| `<app-replay-topbar>` | `pvp/replay/topbar/` | Topbar Holographic 3 zones (back · joueurs · meta pills + copy-link). Inputs : `metadata: ReplayMetadataMsg \| null`, `turnIndex: number`, `totalTurns: number`. Outputs : `back()`, `copyLink()`, `openDetails()`. |
| `<app-timeline-stepper>` | `pvp/replay/timeline-stepper/` | Stepper mobile `◀ pill ▶` + sub-events row (composant remplace timeline-bar sous `.is-narrow`) |
| `<app-turn-picker-sheet>` | `pvp/replay/turn-picker-sheet/` | Bottom-sheet grille 3 cols mini-board. **Utilise `<app-mini-board-thumbnail>` dédié**, PAS `<app-pvp-board-container [preview]>` (tranchage 2026-05-14 : le mockup acte un layout simplifié `.mini-hand` + `.mini-field-row` + `.mini-zone`, beaucoup plus léger pour 11+ tours en grille). |
| `<app-mini-board-thumbnail>` | `pvp/replay/mini-board-thumbnail/` | **Nouveau composant léger** — rend `mini-hand` (compteurs) + 2 `mini-field-row` (Mz1-5 + Sz1-5) à partir d'un `DuelState`. Consomme `_mini-board.scss`. Réutilisé par picker mobile **et** par hover popover desktop (en remplacement du `<app-pvp-board-container [preview]>` actuel — voir F3). |
| `BoardSwipeNavigator` directive | `pvp/replay/board-swipe-navigator.directive.ts` | Directive swipe horizontal sur host element (60px threshold, 80px max-y, 600ms max-dt). Émet `swipeLeft` / `swipeRight` outputs |
| `<app-timeline-zoom-control>` | `pvp/replay/timeline-zoom-control/` | Mini-control `1× 2× 3×` extrait dans transport-bar. Inputs : `[level]: 1\|2\|3`. Outputs : `(levelChange)`. **State lifté** dans `ReplayPageComponent` (signal `zoomLevel = signal<1\|2\|3>(1)`) ; `TimelineBarComponent.zoomLevel` devient un `input()` ; `TimelineBarComponent.onWheel` émet `(zoomLevelChange)` au lieu de muter en interne. Voir O6 en F3. |
| `<app-replay-bottom-sheet>` | `pvp/replay/bottom-sheet/` | Wrapper bottom-sheet réutilisable (factorise options + détails + picker). **Implémentation : MatDialog en mode bottom-sheet** (cohérent lobby/hub) avec `<app-bottom-sheet-handle>` partagé inclus comme premier enfant. NE PAS réimplémenter le handle + drag-to-close — réutiliser le composant shared. |
| `<app-replay-end-overlay>` | `pvp/replay/end-overlay/` | Overlay fin de replay (slide-in + 3 CTAs). Inputs : `result: 'victory' \| 'defeat' \| 'draw'`, `selfLp: number`, `oppLp: number`, `selfName: string`, `oppName: string`. Outputs : `replay()`, `library()`, `dismissed()`. **PAS de bouton Fork** — voir D18 + O14. |
| `<app-replay-cheat-sheet>` | `pvp/replay/cheat-sheet/` | Modal raccourcis clavier |
| `<app-replay-loading-skeleton>` | `pvp/replay/loading-skeleton/` | Wireframe board + timeline + transport (remplace `mat-progress-spinner`). **Composé de `<app-skel>` primitives** (variants `rect`/`circle`/`pill`), PAS de div + classes ad-hoc. |
| `<app-context-pill>` | `pvp/replay/context-pill/` | Pill `Tour 3 / 11 tours` + chip phase (extrait pour réuse mobile/desktop) |

### Composants refondus (existants)

| Item | Chemin | Changement |
|---|---|---|
| `ReplayPageComponent` | `pvp/replay/replay-page.component.{ts,html,scss}` | Template refactor : extraction du topbar, ajout du stepper mobile, intégration de l'end-overlay, bottom-sheets. **Conservation de `<app-orientation-lock>`** (D2 revue 2026-05-14, consommé via `shared/orientation-lock/`). Ajout `NARROW_BREAKPOINT` constant + sync class `.is-narrow` sur host. |
| `TimelineBarComponent` | `pvp/replay/timeline-bar/timeline-bar.component.{ts,html,scss}` | Refonte visuelle Holographic (tokens DS + chain owner palette + playhead glow + shimmer not-computed). Logique métier (zoom, drag-seek, hover popover) **conservée**. Caché sous `.is-narrow` via CSS. |
| `TransportBarComponent` | `pvp/replay/transport-bar/transport-bar.component.{ts,html,scss}` | Refonte 3 zones (context · controls · options). Play 52px gold gradient. Ajout du zoom-control + cheat-sheet ghost icon. Compactage progressif (label-short → icon-only → ⋯ More). |

### Partials SCSS DS à extraire (Phase F0)

| Partial | Source | Réutilisation |
|---|---|---|
| `styles/_bottom-sheet.scss` | Mockup `.bottom-sheet*` (handle + header + body) | `.bottom-sheet`, `.bottom-sheet-backdrop`, `.bottom-sheet-handle`, `.bottom-sheet-header`, `.bottom-sheet-body`. Réutilisé par options/details/picker/preview |
| `styles/_chain-owner-palette.scss` | Mockup `:root --self-blue*` + `--opp-amber*` (mockup-replay-viewer.html l. 49-55) | **AJOUTER d'abord les tokens à `_tokens.scss`** (`--self-blue`, `--self-blue-soft`, `--self-blue-glow`, `--opp-amber`, `--opp-amber-soft`, `--opp-amber-glow`) — vérifié 2026-05-14 : ces tokens N'existent PAS encore dans le DS Angular. Puis le partial expose les mixins helper `@include chain-group-self` / `--opp` qui les consomment. |
| `styles/_mini-board.scss` | Mockup `.hover-popover-board` + `.mini-hand-card` + `.mini-zone` + `.turn-picker-mini-board` | Partagé entre hover popover desktop + picker grille mobile via `<app-mini-board-thumbnail>` |

### Back-end Spring nouveau

**Aucun.** Le viewer reste 100% front + duel-server (déjà capable de servir le replay via WS). Le `durationSec` ajouté par la phase B1 du hub-rework est consommé via `metadata.durationSec` côté front.

### Back-end Node duel-server nouveau

**Aucun.** Tout est déjà en place.

## 4. Phases d'implémentation

### Phase F0 — Factoring SCSS DS spécifique Viewer (front, préparatoire) — ~1h

> **⚠️ Refresh 2026-05-14 post-DS Wave 1 (Hub-rework)** : la Wave 1 DS Skytrix (12 partials + 5 modifiers/utilities) sera **déjà livrée en prod par la Phase F0 du Hub-rework** AVANT que ce Phase F0 Viewer commence (cf. ordre de livraison §7). Le scope Viewer F0 ne livre donc QUE les partials **spécifiques au viewer** + les tokens chain-owner palette.

#### Partials DS déjà disponibles (livrés par Hub-rework F0 — consommer tel quel)

Voir [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) pour les inventaires détaillés. Les classes utility suivantes sont **disponibles dès le démarrage F0 Viewer** et doivent être consommées par les composants F1-F4 :

| Partial | Classes utility prêtes à consommer dans Viewer |
|---|---|
| `_a11y.scss` | `*:focus-visible` global (gold ring 2px), `@mixin respect-reduced-motion`, `.sr-only` |
| `_motion.scss` | `.fade-in`, `.slide-up`, `.is-spinning`, `.is-pulsing`, `.is-chosen`, `.card-entry`, `.pulse-dot` + 16 keyframes `ds-*` |
| `_typography.scss` | `.text-gold-gradient` (replay-topbar title, end-overlay result), `.text-eyebrow` (subtitles), `.text-mono` (durée + scores), `.text-code` (replay ID share inline), `.text-balance` |
| `_card-surface.scss` | `.surface-card`, `.surface-card--interactive`, `.surface-card--accent-{gold,cyan,neutral,warning,danger}` — utilisé par `.turn-picker-card` + end-overlay container + cheat-sheet container |
| `_buttons.scss` | `.btn.btn--primary.btn--cta-shimmer` (Rejouer dans end-overlay), `.btn--secondary` (cyan stroked), `.btn--ghost` (back-btn, options, retours), `.btn--danger`, sizes `--sm/--md/--lg`, `.btn--cta`, `.btn--icon-leading/-trailing`, `.btn--full`, `.btn--success-flash` (copy-link toast) |
| `_pills.scss` + `.badge` | `.pill--gold/-cyan/-neutral/-warning/-danger/-success` × sizes `--xs/-sm/-md/-lg`, `.pill--celebrated` (end-overlay victory), `.pill--live` (loading turns indicator), `.badge--gold` (counts) |
| `_chips.scss` | `.chip` + `.chip--active.chip--gold/-cyan/-neutral` — utilisé par filter chips éventuels en options-sheet |
| `_icon-button.scss` | `.icon-btn` + sizes `--sm/-md/-lg`, `.icon-btn--danger`, `.icon-btn--active`, `.icon-btn--round` (transport play 52px), `.icon-btn--ghost-hover-only` |
| `_search-bar.scss` | `.search-bar` (pas utilisé v1 viewer, prêt pour search éventuel dans bottom-sheet) |
| `_page-header.scss` | `.page-header.page-header--compact.page-header--bordered` — directement adopté par `<app-replay-topbar>` |
| `_section-header.scss` | `.section-header` (cheat-sheet sections, options-sheet sections) + `.section-header__title` |
| `_empty-state.scss` | `.empty-state.empty-state--rich` (cas "Aucun replay" si replayId invalide) |

**Garde-fou** : tous les nouveaux composants Viewer (F1-F4) doivent référencer **EXCLUSIVEMENT** ces classes utility via `class="..."` côté template. Aucune redéfinition de styles équivalents en SCSS scopé du composant. Critère de PR review : `grep -rn 'background.*linear-gradient.*var(--gold' front/src/app/pages/pvp/replay/` doit retourner 0 (sauf re-use legit comme la page elle-même).

#### Partials nouveaux spécifiques Viewer

| Partial | Source | Utilisation |
|---|---|---|
| `styles/_bottom-sheet.scss` | Mockup `.bottom-sheet*` (handle + header + body) | `.bottom-sheet`, `.bottom-sheet-backdrop`, `.bottom-sheet-handle`, `.bottom-sheet-header`, `.bottom-sheet-body`. Réutilisé par options/details/picker sheets via MatDialog wrapper |
| `styles/_chain-owner-palette.scss` | Mockup `:root --self-blue*` + `--opp-amber*` (mockup l. 49-55) | Mixins helper `@include chain-group-self` / `--opp` consommant les tokens. Utilisé par timeline-bar chain-group rendering |
| `styles/_mini-board.scss` | Mockup `.hover-popover-board` + `.mini-hand-card` + `.mini-zone` + `.turn-picker-mini-board` | Partagé entre hover popover desktop + picker grille mobile via `<app-mini-board-thumbnail>` |

#### Tokens à ajouter dans `_tokens.scss`

**6 tokens chain-owner palette** (absents du DS Wave 1 Hub-rework, à ajouter spécifiquement pour le viewer) :

```scss
// Section "Chain owner palette" (nouveau bloc dans _tokens.scss)
--self-blue:       #1e5ac8;
--self-blue-soft:  rgba(30, 90, 200, 0.25);
--self-blue-glow:  rgba(96, 165, 250, 0.55);
--opp-amber:       #b45309;
--opp-amber-soft:  rgba(180, 83, 9, 0.30);
--opp-amber-glow:  rgba(245, 158, 11, 0.55);
```

> **Note** : ces tokens sont **PvP-replay scopés** sémantiquement (self/opp pour les chains). Ne pas les renommer en `--player-blue` / `--player-amber` — la sémantique "self/opp" est précieuse pour distinguer perspective.

#### Mise à jour `_responsive.scss`

**`styles/_responsive.scss`** — AJOUTER une constante de breakpoint `$bp-replay-narrow: 760px` + un alias mixin `respond-below(narrow)` (le breakpoint le plus proche existant est `$bp-tablet: 768px` qui ne matche pas exactement `NARROW_BREAKPOINT = 760`).

#### Ordre d'import (`styles.scss`)

Suivre l'ordre strict de la spec DS Wave 1 (§1.3) — les nouveaux partials Viewer s'ajoutent dans la **section 4 — composites**, juste après `_empty-state` et avant `_holo-modal` :

```scss
// 4. Composites (utilisent les building blocks)
@use 'app/styles/search-bar';
@use 'app/styles/page-header';
@use 'app/styles/section-header';
@use 'app/styles/empty-state';
@use 'app/styles/bottom-sheet';          // ← Viewer F0
@use 'app/styles/chain-owner-palette';   // ← Viewer F0
@use 'app/styles/mini-board';            // ← Viewer F0
@use 'app/styles/holo-modal';
```

**Critères d'acceptation** :

- [ ] Les 6 tokens `--self-blue*` / `--opp-amber*` présents dans `_tokens.scss` (nouvelle section "Chain owner palette" après "PvP Tokens")
- [ ] Les 3 partials Viewer (`_bottom-sheet.scss`, `_chain-owner-palette.scss`, `_mini-board.scss`) importés dans l'ordre strict + intégrés à `styles.scss`
- [ ] `respond-below(narrow)` génère bien `@media (max-width: 759px)` (mobile-first standard)
- [ ] Aucun composant existant cassé (Lobby + Hub déjà shippés)
- [ ] Audit grep : `_bottom-sheet.scss` n'utilise QUE des tokens + classes DS Wave 1 (no hex, no rgba inline, no `!important` non-justifié)
- [ ] `_chain-owner-palette.scss` consomme uniquement les 6 nouveaux tokens + DS Wave 1 (pas de couleur hardcodée)

### Phase F1 — Composants chrome (topbar + bottom-sheet + end-overlay + cheat-sheet + loading-skeleton + context-pill) — ~4h

> **⚠️ Refresh 2026-05-14** : tous les composants chrome F1 consomment **EXCLUSIVEMENT** les classes utility DS Wave 1 (livrées par Hub-rework F0) pour leur visuel — aucune redéfinition de styles équivalents. Le SCSS scopé de chaque composant ne contient QUE le layout structurel (grid/flex spécifique) et les classes de positionnement spécifiques au viewer.

**Fichiers touchés** :

- **Nouveaux composants** : `<app-replay-topbar>`, `<app-replay-bottom-sheet>`, `<app-replay-end-overlay>`, `<app-replay-cheat-sheet>`, `<app-replay-loading-skeleton>`, `<app-context-pill>`.
- Chacun standalone, ChangeDetection OnPush, signal-based I/O (`input()` / `output()`).
- Tous gouvernés par `@media (max-width: 760px)` + `.is-narrow` pour leurs variantes mobile.

**Classes DS Wave 1 consommées par composant** :

| Composant | Classes DS Wave 1 utilisées dans son template | Notes |
|---|---|---|
| `<app-replay-topbar>` | Root : `.page-header.page-header--compact.page-header--bordered`. Title : `.page-header__title.text-gold-gradient`. Back : `.btn.btn--ghost.btn--sm.btn--icon-leading`. Match summary : `.surface-card.surface-card--flat` (optionnel). Meta pills : `.pill.pill--neutral.pill--xs` ou `.pill.pill--cyan.pill--xs`. Copy-link : `.icon-btn.icon-btn--md` (desktop) avec logique JS pour toggle `.btn--success-flash` 1.5s après copy. | Page header `--compact` est le variant sticky horizontal défini dans DS Wave 1 §2.10 spécifiquement pour le viewer. |
| `<app-replay-bottom-sheet>` | Wrapper : `.bottom-sheet` (partial Viewer F0). Header : `.section-header` + `.section-header__title` (DS Wave 1). Body : `.bottom-sheet-body` (partial Viewer). Close btn : `.icon-btn.icon-btn--md`. | Le MatDialog wrapping reste l'implémentation Angular ; les classes DS s'appliquent au contenu interne. |
| `<app-replay-end-overlay>` | Container : `.surface-card.surface-card--flat` (panel central). Result pill : `.pill.pill--<variant>.pill--lg.pill--celebrated` (variant via `deriveOutcome` D19 → `pill--gold` pour victory, `pill--neutral` pour defeat, `pill--cyan` pour draw). Score LP : `.text-mono` + `.text-gold-gradient` (LP gagnant). Vs separator : `.text-eyebrow`. CTAs : `.btn.btn--primary.btn--cta-shimmer.btn--lg.btn--cta` (Rejouer) + `.btn.btn--ghost.btn--lg.btn--cta` (Bibliothèque). Dismiss hint : `.text-eyebrow` muted. | **2 CTAs uniquement** (D18) — pas de bouton Fork. |
| `<app-replay-cheat-sheet>` | Container : `.surface-card.surface-card--flat`. Title : `.text-rajdhani` (Rajdhani semibold). Sections : `.section-header.section-header__title.section-header__title--no-bar` (sans accent-bar). Items : flex row, label en texte courant + keys en `<kbd class="text-code text-code--inline">`. Close : `.icon-btn.icon-btn--md`. | Pattern modal cheat-sheet — `<kbd>` html5 stylé via `.text-code--inline`. |
| `<app-replay-loading-skeleton>` | **Composé de primitives `<app-skel>` uniquement** (variants `rect`/`circle`/`pill`/`text-*`) — NE PAS écrire de div + classes ad-hoc. Layout container : `.surface-card.surface-card--low` pour le bloc principal. Convention skytrix [`project_skeleton_screens_convention.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_skeleton_screens_convention.md). Texte de chargement : `.pill.pill--gold.pill--md.pill--live` (utilise le pulse-dot intégré DS Wave 1 §2.6). | Le `.pill--live` remplace l'ancien hint custom "Chargé 6/11 tours". |
| `<app-context-pill>` | Turn pill : `.pill.pill--gold.pill--sm`. Position (P1/P2) : `.text-eyebrow`. Phase : `.pill.pill--cyan.pill--xs`. Event label : `.text-eyebrow` truncated. | Toutes les pills consomment DS Wave 1 §2.6 — pas de styles inline. |

**Notes techniques** :

- **`<app-replay-bottom-sheet>`** : wrapper autour de `MatDialog` ouvert en mode bottom-sheet (cohérent lobby/hub). Inclut `<app-bottom-sheet-handle>` shared comme premier enfant (handle + drag-to-close partagé). NE PAS réimplémenter pointerdown/pointermove/pointerup — le composant shared gère ça.
- **`<app-replay-end-overlay>`** : **2 CTAs** au lieu de 3 (D18) — `Rejouer` (primary gold avec shimmer) + `Bibliothèque` (ghost). Pas de bouton Fork.

**Critères d'acceptation** :

- [ ] `<app-replay-topbar>` rendu identique au mockup en desktop ET mobile (back-btn + summary + meta pills + bouton copy-link desktop)
- [ ] `<app-replay-topbar>` émet `(copyLink)` au clic du bouton copy-link (handler implémenté en F4 par `ReplayPageComponent.onCopyLink()`)
- [ ] `<app-replay-bottom-sheet>` ouvre/ferme via MatDialog standard, `<app-bottom-sheet-handle>` inclus, backdrop click ferme, max-height: 85dvh
- [ ] `<app-replay-end-overlay>` slide-in 400ms, **2 CTAs** (`Rejouer` + `Bibliothèque`), auto-dismiss Esc/← via output `(dismissed)`
- [ ] `<app-replay-end-overlay>` reçoit `[result]: 'victory' \| 'defeat' \| 'draw'`, `[selfLp]`, `[oppLp]`, `[selfName]`, `[oppName]` — dérivation faite en F4 par la page
- [ ] `<app-replay-end-overlay>` result pill = `.pill.pill--<variant>.pill--lg.pill--celebrated` avec text-shadow glow (DS Wave 1 §2.6)
- [ ] `<app-replay-cheat-sheet>` listing 3 sections (Lecture / Visionnage / Actions), responsive bottom-sheet sous 480px
- [ ] `<app-replay-loading-skeleton>` rend wireframe board + timeline + transport via composition de `<app-skel>` (sweep 1.4s hérité de la primitive)
- [ ] `<app-replay-loading-skeleton>` indicator "Chargé 6/11 tours" utilise `.pill.pill--gold.pill--live` (pas d'animation custom)
- [ ] `<app-context-pill>` affiche turn pill + (optionnel) chip phase, masquage progressive selon `is-narrow`
- [ ] **Garde-fou DS** : grep dans `front/src/app/pages/pvp/replay/{topbar,bottom-sheet,end-overlay,cheat-sheet,loading-skeleton,context-pill}/*.scss` ne contient AUCUN `background.*gold`, AUCUN `linear-gradient.*gold-100`, AUCUN `rgba(201, 168, 76`, AUCUN `#[0-9a-fA-F]{6}` (sauf tokens via var()). Critère de PR review.

### Phase F2 — Stepper mobile + Turn picker + Swipe directive + `seekToTurn` — ~4h30

**Fichiers touchés** :

- **Nouveaux composants** : `<app-timeline-stepper>`, `<app-turn-picker-sheet>`, `<app-mini-board-thumbnail>`.
- **Nouvelle directive** : `BoardSwipeNavigator` attachée au wrapper board (PAS aux cards).
- **`ReplayTransportService`** ([replay-transport.service.ts](../../front/src/app/pages/pvp/replay/replay-transport.service.ts)) — **AJOUTER** la méthode `seekToTurn(turnIndex: number, turns: TurnMeta[])` (vérifié 2026-05-14 : absente). Contrat :
  ```typescript
  seekToTurn(turnIndex: number, turns: TurnMeta[]): void {
    const turn = turns[turnIndex];
    if (!turn) return;
    if (turn.startIndex > this.getCfg().computedUpTo()) return;
    this.seek(turn.startIndex);  // réutilise pause + jumpToState
  }
  ```
  La méthode appelle `this.seek(startIndex)` qui déjà fait `pausePlayback()` + `jumpToState()`. **Le composant doit appeler `abortAndClean()` AVANT** (cf. doc `replay-transport.service.ts:24-31`). Pattern dans la page : `onSeekToTurn(idx) { this.abortAndClean(); this.transport.seekToTurn(idx, this.turns()); }`.
- **`ReplayPageComponent`** : ajout listener `(swipeLeft)` / `(swipeRight)` sur wrapper board, branchés sur `onSeekToTurn(currentTurnIndex ± 1)`. Calcul `currentTurnIndex` via `turns().findIndex(t => t.startIndex <= currentIndex() && currentIndex() <= t.endIndex)`.
- **`<app-timeline-stepper>`** :
  - Inputs : `turns: TurnMeta[]`, `currentTurnIndex: number`, `computedUpToIndex: number`, `subEvents: TimelineSegment[]` (du tour courant).
  - Outputs : `prevTurn()`, `nextTurn()`, `openPicker()`, `seekSubEvent(idx: number)`.
  - Affichage : `@media (max-width: 760px)` OR `:host-context(.is-narrow)` (CSS-driven, pas de logique JS).
  - Dot-progress (7 dots) caché sous 480px via MQ interne.
  - **Setup (T0)** : la sub-events row peut être visuellement vide pour T0 (segments majoritairement filtrés via `HIDDEN_LABELS`). Acceptable v1 — la pill `T0 · Préparation` reste un repère suffisant. À monitorer en QA.
- **`<app-turn-picker-sheet>`** :
  - Inputs : `turns: TurnMeta[]`, `currentTurnIndex: number`, `computedUpToIndex: number`, `boardStates: PreComputedState[]`.
  - Outputs : `jumpToTurn(turnIndex: number)`, `closed()`.
  - Mini-board : utilise `<app-mini-board-thumbnail [state]="boardStates[turn.startIndex].boardState">` (NE PAS instancier `<app-pvp-board-container [preview]>` — trop lourd pour 11+ instances en grille, tranchage D / 2026-05-14).
  - Auto-scroll sur `is-current` à l'ouverture via `afterRender` (250ms timeout pour laisser l'animation slide-in finir).
- **`<app-mini-board-thumbnail>`** :
  - Inputs : `state: DuelState`, `perspectiveIndex: 0 | 1` (pour ordonner self/opp).
  - Template : `mini-hand` (compteurs cartes) × 2 + `mini-field-row` (Mz1-5 + Sz1-5) × 2, classes `.has-card` pour zones occupées.
  - Consomme `_mini-board.scss`.
- **`BoardSwipeNavigator` directive** :
  - Constantes : `SWIPE_THRESHOLD_X = 60`, `SWIPE_MAX_Y = 80`, `SWIPE_MAX_DT_MS = 600`.
  - `@HostListener('touchstart', ['$event'])`, `@HostListener('touchend', ['$event'])`.
  - Émet `swipeLeft` / `swipeRight` outputs.
  - Désactivable via `[disabled]="true"` input (utile quand un overlay/sheet est ouvert).

**Critères d'acceptation** :

- [ ] `ReplayTransportService.seekToTurn(turnIndex, turns)` couvert par un test unitaire (refuse si turn not-computed, refuse si index hors bornes, sinon délègue à `seek`)
- [ ] Sous `@media (max-width: 760px)` : la bande timeline est cachée, le stepper apparaît
- [ ] `◀ ▶` désactivés sur bornes (turn 0 et dernier turn computed)
- [ ] Tap sur la pill `Tour 3 / 11 ▼` ouvre le picker
- [ ] Picker auto-scroll sur le tour courant à l'ouverture
- [ ] Tours not-computed dans le picker = stripes + ⏳, `disabled`, `aria-disabled="true"`
- [ ] `<app-mini-board-thumbnail>` rend < 5ms par instance (test perf — fixture 20 tours)
- [ ] Swipe gauche sur board → next turn, droite → prev turn
- [ ] Swipe vertical > 80px = ignoré (= scroll page)
- [ ] Swipe désactivé pendant qu'un bottom-sheet est ouvert
- [ ] Hint "Glisse pour changer de tour" affiché 3s à l'ouverture mobile, fadeout au premier swipe
- [ ] Flash doré sur le bord du board pendant le swipe (200ms)
- [ ] Test responsive : 360, 414, 768, 1024, 1280 OK

### Phase F3 — Refonte timeline-bar + transport-bar + zoom-control extrait — ~4h30

> **⚠️ Refresh 2026-05-14** : timeline-bar et transport-bar consomment **les classes DS Wave 1** pour tous les éléments visuels génériques (boutons step, pills phase/turn, play button). Les éléments **spécifiques** (timeline track, chain-groups, segments, sub-events, playhead, hover popover) restent dans le SCSS scopé du composant + consomment `_chain-owner-palette.scss` (partial Viewer F0).

**Fichiers touchés** :

- **`TimelineBarComponent`** :
  - Refonte visuelle Holographic (tokens DS + chain owner palette + playhead glow + shimmer not-computed + popover position:fixed).
  - Logique métier conservée : drag-to-seek + hover popover + segment cache.
  - **Zoom state lifté hors du composant** (D21) — `zoomLevel` devient un `input<1|2|3>()` au lieu d'un `signal<1|2|3>(1)` interne. `onWheel` calcule la nouvelle valeur localement puis émet `zoomLevelChange.emit(next)` au lieu de muter `this.zoomLevel.set(next)`. La logique cursor-anchored (rAF loop, [timeline-bar.component.ts:230-269](../../front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts#L230-L269)) reste intégralement dans `onWheel` mais lit `this.zoomLevel()` via input.
  - Hover popover : remplacer `<app-pvp-board-container [preview]>` par `<app-mini-board-thumbnail [state]>` (cohérence avec picker mobile + perf).
  - Caché sous `.is-narrow` via CSS (`display: none`).
- **`TransportBarComponent`** :
  - Refonte 3 zones grid : context (turn pill + position + phase + event label) · controls (5 step btns + play 52px gold) · options (zoom + toggles + perspective + fork + cheat-sheet + ⋯ More).
  - Play 52px circulaire avec gold gradient, shimmer hover.
  - Compactage progressif (label-short hidden ≤ 920px → fork label hidden ≤ 920px → toggles+fork+perspective remplacés par ⋯ More ≤ 480px).
  - Bouton cheat-sheet ghost icon (touche `?`).
  - **Nouveau input** : `[zoomLevel]: 1|2|3` + nouveau output `(zoomLevelChange)` — pass-through vers `<app-timeline-zoom-control>` enfant.
- **`<app-timeline-zoom-control>`** :
  - Mini-control `1× 2× 3×` extrait dans `.transport-options` (cluster droit, à gauche des toggles).
  - Caché sous 920px (`@media (max-width: 920px) { display: none }`).
  - **State partagé** : la `ReplayPageComponent` détient `zoomLevel = signal<1|2|3>(1)`, persiste/restore via `localStorage` (clé `replay.zoomLevel`), passe la valeur en input aux DEUX consommateurs (timeline + transport) et écoute leur `(zoomLevelChange)` pour update le signal.
  - Inputs : `[level]: 1|2|3`. Outputs : `(levelChange)`.

**Classes DS Wave 1 consommées par composant** :

| Composant | Élément | Classe DS Wave 1 |
|---|---|---|
| `TimelineBarComponent` | Container | (SCSS scopé — pas de class racine DS, c'est un composant unique au viewer) |
| | Hover popover | `.surface-card.surface-card--flat` pour le panel (DS Wave 1 §2.4) |
| | Popover board content | `<app-mini-board-thumbnail>` (composant Viewer F2) |
| | Popover label | `.text-eyebrow` (turn N · phase) |
| | Not-computed shimmer | utility `.fade-in` ou `.is-spinning` du `_motion.scss` (DS Wave 1 §2.2) |
| `TransportBarComponent` | Context turn pill | `.pill.pill--gold.pill--md` (DS Wave 1 §2.6) |
| | Position label "P1" | `.text-eyebrow` (DS Wave 1 §2.3) |
| | Phase chip | `.pill.pill--cyan.pill--xs` (DS Wave 1 §2.6) |
| | Event label | `.text-eyebrow` truncated |
| | Step buttons (◀◀ ◀ ▶ ▶▶) | `.icon-btn.icon-btn--md` (DS Wave 1 §2.8) |
| | Play button (52px) | `.icon-btn.icon-btn--lg.icon-btn--round` avec custom override `width: 52px; height: 52px` + `background: linear-gradient(135deg, var(--gold-100), var(--gold), var(--gold-700));` (l'override est justifié — variant "play" est un cas unique, pas de `.btn--primary.btn--round` standard) |
| | Play button shimmer | `.btn--cta-shimmer` modifier (DS Wave 1 §2.5) appliqué directement via class composée |
| | Toggle anim/decisions/perspective | `.icon-btn.icon-btn--md.icon-btn--active` quand actif (DS Wave 1 §2.8) |
| | Fork button (desktop) | `.btn.btn--ghost.btn--sm.btn--icon-leading` (DS Wave 1 §2.5) |
| | Cheat-sheet ghost icon | `.icon-btn.icon-btn--md` (DS Wave 1 §2.8) |
| | ⋯ More button (mobile) | `.icon-btn.icon-btn--lg` |
| `<app-timeline-zoom-control>` | Container | flex inline scopé — pas de class racine DS |
| | Level buttons (1× 2× 3×) | `.pill.pill--neutral.pill--xs` (inactifs) + `.pill.pill--gold.pill--xs` (actif). **Note** : les zooms sont **non-interactifs visuellement** (= status display) — donc pill, pas chip. Cursor pointer + aria-pressed côté template Angular. |

**Notes critiques sur les éléments NON-couverts par DS Wave 1** :

- **Timeline track** (`.timeline-track`, `.turn-segment`, `.sub-event`, `.chain-group`, `.playhead`) : reste **100% SCSS scopé** du `TimelineBarComponent`. Consomme `_chain-owner-palette.scss` (Viewer F0) pour les couleurs self/opp + tokens DS pour le reste. Pas de classe utility équivalente — c'est un composant unique au viewer, pas de réutilisation attendue.
- **Hover popover board** (mini-board layout) : `.hover-popover-board` + `.mini-hand-card` + `.mini-zone` consomment `_mini-board.scss` (Viewer F0). Voir F2 pour `<app-mini-board-thumbnail>`.
- **Transport 3-zone grid layout** : grid-template-columns `auto 1fr auto` reste scopé au composant — c'est un layout structurel, pas un visuel DS.

**Critères d'acceptation** :

- [ ] Bande timeline visuellement identique au mockup en desktop
- [ ] Chain-groups self (blue) vs opp (amber) rendus via tokens partagés (`--self-blue*`, `--opp-amber*` — ajoutés en F0)
- [ ] Playhead gold avec glow + cap rond, position au pixel près
- [ ] Not-computed : pattern shimmer diagonal animé, opacité 0.35
- [ ] Hover popover position:fixed (escape `overflow:hidden`), variants normal + not-computed, **utilise `<app-mini-board-thumbnail>`**
- [ ] Hover popover container = `.surface-card.surface-card--flat` (consomme DS Wave 1)
- [ ] Zoom 1× / 2× / 3× : bullets grossissent, bande devient scrollable. **Clic sur `<app-timeline-zoom-control>` ET wheel sur timeline-bar** synchronisés (state partagé en page)
- [ ] `<app-timeline-zoom-control>` level buttons utilisent `.pill.pill--gold.pill--xs` (actif) / `.pill.pill--neutral.pill--xs` (inactif)
- [ ] Wheel scroll cursor-anchored préserve la position visuelle (logique conservée)
- [ ] Drag-to-seek : `mousedown` + `mousemove` global emit `scrubbing`, `mouseup` commit `seekTo`. Hover popover désactivé pendant `isScrubbing`
- [ ] Transport-bar : 3 zones grid + play 52px gold + bouton ⋯ More mobile + cheat-sheet ghost
- [ ] Transport-bar step buttons (`.icon-btn.icon-btn--md`) + play (`.icon-btn.icon-btn--lg.icon-btn--round.btn--cta-shimmer`) + cheat-sheet (`.icon-btn`) consomment DS Wave 1
- [ ] Transport-bar context turn pill = `.pill.pill--gold.pill--md`, phase chip = `.pill.pill--cyan.pill--xs`
- [ ] Cascade de masquage : ≤ 920px (label-short + phase + event-label) → ≤ 480px (toggles+fork+perspective → ⋯ More + position)
- [ ] Tests `timeline-bar.component.spec.ts` mis à jour pour le passage en input-driven `zoomLevel` (un test vérifie que `onWheel` émet `(zoomLevelChange)` sans muter)
- [ ] **Garde-fou DS** : grep `front/src/app/pages/pvp/replay/{timeline-bar,transport-bar,timeline-zoom-control}/*.scss` pour `background.*gold-100\|border.*gold-soft\|padding: 8px 14px` → tout match doit être justifié inline ou remplacé par `@extend` de la classe DS

### Phase F4 — ReplayPageComponent template refactor + glue logic — ~3h

**Fichiers touchés** :

- `front/src/app/pages/pvp/replay/replay-page.component.html` — template refactor : ajouter `<app-replay-topbar>`, `<app-timeline-stepper>` (`@media`-CSS-driven, pas `@if`), `<app-replay-end-overlay>` (`@if (atEnd())`), `<app-replay-cheat-sheet>` (`@if (cheatSheetOpen())`), bottom-sheets (3 instances : options, details, picker), wrapper board avec `appBoardSwipeNavigator` directive.
- `front/src/app/pages/pvp/replay/replay-page.component.scss` — retrait du `replay-loading` Material (remplacé par `<app-replay-loading-skeleton>`). **CONSERVER** les positions absolues des hand-rows (D22) — `<app-pvp-board-container>` ne les gère pas, vérifié 2026-05-14.
- `front/src/app/pages/pvp/replay/replay-page.component.ts` :
  - **Conservation** de `OrientationLockComponent` import (D2 revue 2026-05-14 — extrait dans `shared/orientation-lock/` au passage de l'impl B1+B2, partagé avec PvP duel).
  - Ajout signals : `cheatSheetOpen = signal(false)`, `pickerOpen = signal(false)`, `optionsOpen = signal(false)`, `detailsOpen = signal(false)`, `zoomLevel = signal<1|2|3>(1)` (lifté depuis timeline-bar, voir D21), `isNarrow = signal(false)`.
  - Ajout handlers : `openCheatSheet()`, `closeCheatSheet()`, `onSeekToTurn(turnIndex: number)` (appelle `abortAndClean()` puis `transport.seekToTurn(turnIndex, turns())`), `onZoomLevelChange(level: 1|2|3)`, `onCopyLink()`.
  - **`onCopyLink()` (D20)** :
    ```typescript
    async onCopyLink(): Promise<void> {
      const replayId = this.route.snapshot.paramMap.get('replayId');
      if (!replayId) return;
      const url = `${window.location.origin}/pvp/replay/${replayId}?seekTo=${this.currentIndex()}`;
      try {
        await navigator.clipboard.writeText(url);
        this.notify.success('replay.viewer.copyLinkToast');
      } catch {
        // Fallback HTTP localhost : input + execCommand('copy')
        const input = document.createElement('input');
        input.value = url; document.body.appendChild(input);
        input.select(); document.execCommand('copy'); document.body.removeChild(input);
        this.notify.success('replay.viewer.copyLinkToast');
      }
    }
    ```
  - **End-overlay glue** : computed `endOverlayState = computed<{ result: 'victory'|'defeat'|'draw', selfLp, oppLp, selfName, oppName } | null>` qui mappe `replayConnection.metadata().result` + LP final + perspective via helper `deriveOutcome(result, mySide)` (D19). Helper : Victoire si `result.startsWith('victory') || result === 'opponentTimeout' || result === 'opponentDisconnect' || result === 'opponentSurrender'` ; Défaite si `'defeat'/'timeout'/'disconnect'/'surrender'` (côté self) ; sinon Draw.
  - Ajout keyboard handler : `?` → `openCheatSheet()`. **Détection clavier** : tester `event.key === '?'` (Chrome/Firefox/Safari) — Shift+/ sur QWERTY US ET Shift+, sur AZERTY FR émettent tous deux `key === '?'` (chr U+003F final, pas la touche physique). Ne pas tester `event.code` (qui changerait selon layout). Aussi : ne PAS appeler `event.preventDefault()` sauf si overlay ouvert (le `?` est aussi utilisé par les autres pages).
  - **`NARROW_BREAKPOINT = 760`** constante exposée + binding signal-based host (convention Angular moderne du projet — pas `@HostBinding`) :
    ```typescript
    @Component({
      ...,
      host: { '[class.is-narrow]': 'isNarrow()' },
    })
    ```
    Plus listener `matchMedia('(max-width: 760px)').addEventListener('change', e => this.isNarrow.set(e.matches))` dans `ngOnInit`, cleanup dans `ngOnDestroy`.
- `front/src/assets/i18n/{fr,en}.json` — voir F5 pour la liste détaillée. Les clés `replay.transport.*` existantes (l. 711-726 fr.json) restent en place et sont **réutilisées** par la cheat sheet (cf. tableau F5) — pas de doublon.

**Critères d'acceptation** :

- [ ] Template Angular rendu visuellement identique au mockup à 1280px et 414px
- [ ] Touche `?` ouvre le cheat-sheet sur QWERTY US ET AZERTY FR ; `Esc` ferme tous les overlays
- [ ] `<app-orientation-lock>` **conservé** dans le template replay (D2 revue 2026-05-14) ; partagé avec PvP duel via `shared/orientation-lock/`
- [ ] `<app-replay-loading-skeleton>` remplace `<mat-progress-spinner>` plein écran
- [ ] `<app-replay-end-overlay>` slide-in sur `atEnd() === true`, reçoit `endOverlayState()` non-null
- [ ] `deriveOutcome()` couvert par tests unitaires (8 cas : victory/defeat/draw × mySide 0/1, + opponentTimeout/disconnect/surrender)
- [ ] `onCopyLink()` copie l'URL avec `?seekTo=${currentIndex()}` ; toast `copyLinkToast` affiché ; fallback execCommand testé manuellement en HTTP
- [ ] `(swipeLeft)` / `(swipeRight)` du board → `onSeekToTurn(currentTurnIndex ± 1)`
- [ ] `<app-timeline-zoom-control>` (transport) + wheel scroll (timeline) synchronisés via `zoomLevel` signal page
- [ ] Resize fenêtre window passe `.is-narrow` automatique via signal+matchMedia listener
- [ ] Tests `replay-page.component.spec.ts` mis à jour pour les nouveaux composants imports + nouveaux handlers

### Phase F5 — i18n + tests + polish QA — ~2h

**i18n keys à créer** (FR + EN) :

| Clé | FR | EN |
|---|---|---|
| `replay.viewer.cheatSheet.title` | Raccourcis clavier | Keyboard shortcuts |
| `replay.viewer.cheatSheet.section.playback` | Lecture | Playback |
| `replay.viewer.cheatSheet.section.viewing` | Visionnage | Viewing |
| `replay.viewer.cheatSheet.section.actions` | Actions | Actions |
| `replay.viewer.cheatSheet.playPause` | Lecture / pause | Play / pause |
| `replay.viewer.cheatSheet.stepEvent` | Évènement précédent / suivant | Previous / next event |
| `replay.viewer.cheatSheet.skipBoundary` | Aller au début / à la fin | Skip to start / end |
| `replay.viewer.cheatSheet.perspective` | Changer de perspective | Toggle perspective |
| `replay.viewer.cheatSheet.animations` | Animations on / off | Animations on / off |
| `replay.viewer.cheatSheet.promptMode` | Mode décisions / résultats | Decision / result mode |
| `replay.viewer.cheatSheet.debug` | Panneau de debug | Debug panel |
| `replay.viewer.cheatSheet.logLevel` | Niveau de log | Log level |
| `replay.viewer.cheatSheet.fork` | Forker à ce point | Fork at this point |
| `replay.viewer.cheatSheet.copyLink` | Copier le lien à ce moment | Copy link to this moment |
| `replay.viewer.cheatSheet.help` | Afficher cette aide | Show this help |
| `replay.viewer.cheatSheet.close` | Fermer / quitter overlays | Close / exit overlays |
| `replay.viewer.endOverlay.victory` | Victoire | Victory |
| `replay.viewer.endOverlay.defeat` | Défaite | Defeat |
| `replay.viewer.endOverlay.draw` | Égalité | Draw |
| `replay.viewer.endOverlay.replay` | Rejouer | Replay |
| `replay.viewer.endOverlay.library` | Bibliothèque | Library |
| `replay.viewer.endOverlay.dismissHint` | Esc ou ← pour reprendre la lecture | Esc or ← to resume playback |
| `replay.viewer.bottomSheet.options.title` | Options | Options |
| `replay.viewer.bottomSheet.options.animations` | Animations | Animations |
| `replay.viewer.bottomSheet.options.decisions` | Décisions | Decisions |
| `replay.viewer.bottomSheet.options.perspective` | Perspective | Perspective |
| `replay.viewer.bottomSheet.options.copyLink` | Copier le lien à ce moment | Copy link to this moment |
| `replay.viewer.bottomSheet.options.cheatSheet` | Raccourcis clavier | Keyboard shortcuts |
| `replay.viewer.bottomSheet.options.fork` | Forker à ce point | Fork at this point |
| `replay.viewer.bottomSheet.options.forkHint` | Mieux sur un écran plus grand | Better on a larger screen |
| `replay.viewer.bottomSheet.details.title` | Détails du duel | Duel details |
| `replay.viewer.bottomSheet.details.duration` | Durée | Duration |
| `replay.viewer.bottomSheet.details.date` | Date | Date |
| `replay.viewer.bottomSheet.details.turns` | Tours | Turns |
| `replay.viewer.bottomSheet.details.events` | Évènements | Events |
| `replay.viewer.bottomSheet.details.summary` | {{duration}} · {{turns}} tours · {{events}} évènements | {{duration}} · {{turns}} turns · {{events}} events |
| `replay.viewer.bottomSheet.details.opponentLabel` | Adversaire | Opponent |
| `replay.viewer.bottomSheet.details.deckLabel` | Deck | Deck |
| `replay.viewer.stepper.prevTurn` | Tour précédent | Previous turn |
| `replay.viewer.stepper.nextTurn` | Tour suivant | Next turn |
| `replay.viewer.stepper.openPicker` | Choisir un tour | Choose a turn |
| `replay.viewer.picker.title` | Aller au tour | Go to turn |
| `replay.viewer.picker.section.setup` | Préparation | Setup |
| `replay.viewer.picker.section.turns` | Tours du duel | Duel turns |
| `replay.viewer.picker.notComputed` | Calcul en cours… | Computing… |
| `replay.viewer.swipeHint` | Glisse pour changer de tour | Swipe to change turn |
| `replay.viewer.loadingProgressDetailed` | Chargé {{current}} / {{total}} tours | Loaded {{current}} / {{total}} turns |
| `replay.viewer.copyLinkToast` | Lien du moment copié ✓ | Moment link copied ✓ |

> ⚠️ **Clé `endOverlay.fork` retirée** (D18) — l'end-overlay n'a plus que 2 CTAs (`replay` + `library`).
> ⚠️ **Clés `replay.transport.*` existantes** (l. 711-726 fr.json : `skipStart`, `stepBack`, `play`, `pause`, `stepForward`, `skipEnd`, `fork`, `enableAnimations`, `disableAnimations`, `showDecisions`, `skipDecisions`, `viewAsPlayer1`, `viewAsPlayer2`) — **réutilisées telles quelles** par la cheat sheet et le transport-bar refondu. Ne pas dupliquer sous `replay.viewer.cheatSheet.*` ; le composant cheat-sheet référence directement les clés `transport.*` quand le libellé est identique. La nouvelle clé `replay.viewer.cheatSheet.help` (Afficher cette aide) et `cheatSheet.close` (Fermer / quitter overlays) sont les seules réellement nouvelles dans la section "Actions".
> ⚠️ **Clés `replay.matchHistory.victory/defeat/draw/timeout/disconnect/surrender/opponentTimeout/opponentDisconnect/opponentSurrender`** (l. 679-687 fr.json) — **réutilisées** par `deriveOutcome()` du F4 pour mapper `metadata.result` vers l'end-overlay state. Pas de duplicate sous `replay.viewer.endOverlay.*`.
> ⚠️ Garder `replay.viewer.loading` et `replay.viewer.loadingProgress` (legacy déjà utilisés par le `progressText` computed). La nouvelle clé `loadingProgressDetailed` est consommée par `<app-replay-loading-skeleton>` ; l'ancien `loadingProgress` reste utilisé pendant la transition. Décision impl-time : remplacer ou garder les deux.

**Fichiers tests** :

- `front/src/app/pages/pvp/replay/timeline-stepper/timeline-stepper.component.spec.ts` (nouveau) — bornes navigation, picker open output, sub-event click
- `front/src/app/pages/pvp/replay/turn-picker-sheet/turn-picker-sheet.component.spec.ts` (nouveau) — disabled state not-computed, jump output, auto-scroll
- `front/src/app/pages/pvp/replay/board-swipe-navigator.directive.spec.ts` (nouveau) — threshold, vertical max, dt max, disabled input
- `front/src/app/pages/pvp/replay/replay-page.component.spec.ts` (mis à jour) — orientation-lock **conservé** (D2 revue 2026-05-14), bindings nouveaux pour topbar/stepper/end-overlay/cheat-sheet

**Critères d'acceptation** :

- [ ] Toutes les nouvelles clés i18n présentes en FR et EN, aucun fallback brut
- [ ] Tests des 3 nouveaux composants/directive verts
- [ ] Tests existants `replay-page.component.spec.ts` + `timeline-bar.component.spec.ts` (s'il existe) + `transport-bar.component.spec.ts` (s'il existe) mis à jour et verts
- [ ] QA responsive : 360 / 414 / 768 / 1024 / 1280 / 1920 OK
- [ ] QA cross-browser : Chrome / Firefox / Safari (au moins desktop)
- [ ] QA touch device réel : iPhone (portrait + landscape) + iPad (portrait)
- [ ] Lighthouse a11y score ≥ 95 sur la page
- [ ] Pas de régression sur l'expérience desktop (timeline avec zoom + drag-seek + hover popover)

## 5. Effort total

**⚠️ Pré-requis bloquant** : la **Phase F0 du Hub-rework (DS Wave 1)** DOIT être livrée en prod avant que la Phase F0 Viewer commence. Voir [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) et [`replay-hub-rework-2026-05-14.md`](./replay-hub-rework-2026-05-14.md). Sans le DS Wave 1 livré, le Viewer F1-F4 ne peut pas consommer les classes utility (`.btn`, `.pill`, `.icon-btn`, `.surface-card`, `.text-gold-gradient`, etc.).

| Phase | Description | Effort |
|---|---|---|
| F0 | Factoring SCSS spécifique Viewer (3 partials Viewer + 6 tokens chain-owner ; **les 12 partials + 5 modifiers DS Wave 1 sont déjà livrés par Hub-rework F0**) | **1h** *(était 2h30, -1h30 grâce au DS Wave 1)* |
| F1 | Composants chrome (topbar, bottom-sheet via MatDialog, end-overlay 2 CTAs, cheat-sheet, loading-skeleton via `<app-skel>`, context-pill) — **consomment les classes DS Wave 1** | 4h |
| F2 | Stepper mobile + Turn picker + Swipe directive + `<app-mini-board-thumbnail>` + `seekToTurn` dans `ReplayTransportService` | 4h30 |
| F3 | Refonte timeline-bar (zoomLevel lifté en input) + transport-bar + zoom-control extrait — **consomment les classes DS Wave 1** | 4h30 |
| F4 | ReplayPageComponent template + glue (copy-link + deriveOutcome + zoom signal + matchMedia + clavier `?` AZERTY) | 3h |
| F5 | i18n + tests + polish QA | 2h |
| **TOTAL** | | **~19h** *(était 20h30, -1h30 grâce au DS Wave 1)* |

> **Note 2026-05-14 (refresh post-DS Wave 1)** : le gain de 1h30 vient du fait que les **12 partials DS** + **5 modifiers/utilities** (incluant `_buttons.scss`, `_pills.scss`, `_icon-button.scss`, `_typography.scss`, `_card-surface.scss`, `_a11y.scss`, `_motion.scss`, etc.) sont **déjà créés et testés** lors du Hub-rework F0. Le Viewer F0 ne livre que les **3 partials spécifiques au viewer** (`_bottom-sheet.scss`, `_chain-owner-palette.scss`, `_mini-board.scss`) + les **6 tokens chain-owner palette**. Bénéfice indirect : **cohérence visuelle garantie Lobby + Hub + Viewer** dès la livraison.

## 6. Risques + mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Refonte casse l'Animation Parity Rule | **Critique** | Ne JAMAIS importer `DuelWebSocketService` / `DuelConnection` dans les nouveaux composants. Tous les composants nouveaux consomment uniquement `ReplayTransportService` ou `ReplayDuelAdapter` (qui implémente `AnimationDataSource`). Test Parity intégration `replay-integration.spec.ts` doit rester vert. |
| Swipe board entre en conflit avec zoom carte futur | Moyenne | Directive attachée au **wrapper du board** (`.replay-viewer-content`), PAS au board container lui-même. Désactivable via `[disabled]` quand un overlay est actif. À auditer quand zoom carte sera implémenté. |
| Picker avec 30+ tours rame au rendering | Faible | Mitigé par le choix `<app-mini-board-thumbnail>` dédié (F2) — composant léger sans logique zone-resolver, attendu < 5ms par instance. Lazy-render via Intersection Observer en option v2 si nécessaire. |
| Mini-board layout doit rester cohérent avec hover popover desktop ET picker mobile | Faible | Mitigé par la décision d'un seul `<app-mini-board-thumbnail>` consommé par les deux sites (F2 + F3). Une seule source de vérité pour `_mini-board.scss`. |
| State `zoomLevel` désynchronisé entre control + wheel | Moyenne | Mitigé D21 : state lifté en `ReplayPageComponent`, les DEUX consommateurs (timeline-bar wheel + `<app-timeline-zoom-control>`) sont input-driven. Test `timeline-bar.component.spec.ts` vérifie que `onWheel` émet `zoomLevelChange` sans muter d'état interne. |
| `metadata.result` formats hétérogènes (free-form string) | Moyenne | Mitigé D19 : helper `deriveOutcome()` exhaustif (8 cas + fallback Draw), couvert par tests unitaires. Si un format inconnu apparaît côté back-end, fallback vers `Draw` plutôt que crash. À surveiller en QA après production. |
| Copy-link `navigator.clipboard` indisponible en HTTP localhost | Faible | Mitigé D20 : fallback `document.execCommand('copy')` sur input temporaire — pattern standard, fonctionne sur tous browsers cible. Toast identique dans les deux cas. |
| Hand-rows positioning cassé par refonte | **High → mitigé** | Audit 2026-05-14 a confirmé que le CSS absolute est requis (`<app-pvp-board-container>` ne gère pas). D22 acte la conservation. F4 SCSS note corrigée. |
| Hover popover hover-fight pendant le drag-to-seek | Faible | Comportement existant Angular : flag `isScrubbing` désactive `onTurnMouseEnter`. Conserver intégralement. |
| Wheel zoom desktop perd la position cursor-anchored | Faible | Logique existe ([timeline-bar.component.ts:onWheel](../../front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts#L230)). NE PAS la simplifier au portage. |
| `.is-narrow` class désynchronisée du MQ réel | Moyenne | Composant `ReplayPageComponent` écoute `matchMedia('(max-width: 760px)').addEventListener('change', ...)` + `@HostBinding('class.is-narrow')`. Cleanup dans `ngOnDestroy`. Test e2e à 768/758 pour valider la frontière. |
| Bottom-sheet picker scroll lock empêche scroll body | Faible | Pattern standard : `body { overflow: hidden }` quand un sheet est ouvert. Cleanup au close. |
| iPad portrait (768px) reste en bande timeline alors qu'on voudrait stepper | À valider produit | Si feedback Axel après QA : monter `NARROW_BREAKPOINT` à 800. Constante exposée pour rapidité. |
| Conflit keyboard : `D` panneau debug vs ancien mockup `D` = décisions | N/A | Décision tranchée D11 : `M` = mode décisions, `D` = panneau debug. Cheat sheet aligné. Pas de risque utilisateur (ancien mockup pas encore implémenté). |
| Skeleton stepper en loading state perturbe le layout shift | Faible | Skeleton stepper a même `min-height` que stepper réel (56-64px). Pas de CLS. |

## 7. Ordre de livraison recommandé

### Pré-requis bloquants (Hub-rework)

```
Hub-rework B1 (durationSec back) ───► Hub-rework B2 (stats endpoint) ───► Hub-rework F0 (DS Wave 1 = 12 partials + 5 modifiers/utilities)
  ↓
  ✅ DS Wave 1 LIVRÉ EN PROD (lobby + hub migrés, 12 partials disponibles)
  ↓
Hub-rework F1 → F2 → F3 ───► ✅ HUB LIVRÉ EN PROD
```

### Phase Viewer (démarre après livraison Hub)

```
F0 Viewer (3 partials spécifiques + 6 tokens chain-owner) ───► F1 (composants chrome) ───►
F2 (stepper + picker + swipe directive) + F3 (refonte timeline + transport + zoom) [parallélisables] ───►
F4 (replay-page glue) ───► F5 (i18n + tests + polish QA) ───► ✅ VIEWER LIVRÉ EN PROD
```

**Parallélisation interne Viewer** : F2 et F3 peuvent être réalisés en parallèle par 2 personnes. F4 attend F1+F2+F3. F5 peut commencer dès que F4 est en cours (les i18n FR sont déjà partiellement présentes dans `fr.json`).

**Dépendances** :

- **Bloquant** : DS Wave 1 (Hub-rework F0) DOIT être livré avant Viewer F0. Sans ça, les composants F1-F4 référencent des classes qui n'existent pas (`.btn`, `.pill`, `.icon-btn`, `.surface-card`, `.text-gold-gradient`).
- **Non bloquant mais utile** : Hub-rework B1 (`durationSec`) est utile pour `<app-replay-bottom-sheet>` détails — le viewer affiche `metadata.durationSec` si présent, sinon n'affiche rien (cf. décision D4 du hub-rework, template `@if (metadata.durationSec; as d)`).
- **Indépendant** : Hub Angular F1-F3 ne bloque PAS le Viewer (les deux consomment indépendamment le DS Wave 1).

### Calendrier indicatif

| Sprint | Hub-rework | Viewer-rework |
|---|---|---|
| **Sprint 1** | B1 + B2 + F0 commit 1 (partials créés + aliases legacy) | — |
| **Sprint 2** | F0 commits 2+3 (migration lobby + waiting room + suppression aliases) + F1 + F2 | — (refresh mockup post-Wave 1 si besoin) |
| **Sprint 3** | F3 + livraison Hub en prod | F0 (1h) + F1 démarre |
| **Sprint 4** | (Wave 1.5 catalog `/dev/ds` optionnel) | F2 + F3 (parallélisables) |
| **Sprint 5** | — | F4 + F5 + livraison Viewer en prod |

> **Total cumulé Hub + Viewer** : ~22h45 (Hub avec DS Wave 1) + ~19h (Viewer post-Wave 1) = **~41h45**. Cohérence visuelle Lobby + Hub + Viewer + Waiting Room garantie en fin de Sprint 5.

## 8. Annexes

### A1. Décisions UX déjà validées (mockup)

Voir [`_mockups/mockup-replay-viewer.html`](../../_mockups/mockup-replay-viewer.html) pour le rendu visuel complet de tous les états :

- **States** : Viewing / Loading (skeleton) / End overlay / Cheat sheet
- **Mobile** : Stepper mobile + Turn picker + Bottom sheets (Options, Détails, Picker, Preview legacy)
- **Toolbar dev** : Toggle Desktop / Mobile + select largeur (uniquement dans le mockup, pas dans l'Angular final)
- **Tokens DS** : Voir `_tokens.scss` côté Angular + section `:root` du mockup

### A2. Patterns DS référents

- **DS Wave 1 spec autonome** : [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) — **référence d'implémentation principale pour Viewer F1-F4** (12 partials + 5 modifiers/utilities post-audit, 1700 lignes)
- **Audit PvP extraction** : [`ds-wave-1-pvp-extraction-audit-2026-05-14.md`](./ds-wave-1-pvp-extraction-audit-2026-05-14.md) — patterns shippés vs spec DS Wave 1
- **Hub Replay rework** : [`replay-hub-rework-2026-05-14.md`](./replay-hub-rework-2026-05-14.md) — **premier consommateur DS Wave 1** (livre les partials avant Viewer)
- Mockup référentiel global : [`_mockups/mockup-1-holo-arena.html`](../../_mockups/mockup-1-holo-arena.html) (DS skytrix complet)
- Mockup Viewer : [`_mockups/mockup-replay-viewer.html`](../../_mockups/mockup-replay-viewer.html)
- Lobby implémenté : `front/src/app/pages/pvp/lobby-page/` (shipped 2026-05-13)
- Waiting Room implémentée : `front/src/app/pages/pvp/duel-page/duel-page-ui.scss` (shipped 2026-05-14)
- Convention skeleton : [`memory/project_skeleton_screens_convention.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_skeleton_screens_convention.md)
- Convention DS : [`memory/project_design_system_strategy.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_design_system_strategy.md)
- Convention responsive : [`memory/project_responsive_strategy.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_responsive_strategy.md)
- Animation Parity Rule : [`CLAUDE.md`](../../CLAUDE.md) section "Animation Parity Rule"

### A3. Hors scope explicite

**Composants partagés PvP — ne pas modifier** :

- `<app-pvp-board-container>`
- `<app-pvp-hand-row>`
- `<app-pvp-zone-browser-overlay>` (right-sidebar)
- `<app-pvp-card-inspector-wrapper>` (refonte deferred — `card-inspector-premium-spec` en mémoire)
- `<app-pvp-chain-overlay>`
- `<app-pvp-prompt-dialog>`
- `<app-pvp-duel-overlays>`
- `<app-debug-log-panel>` (chrome de debug, pas user-facing)

**Features non-scope v1** :

- Annotations / bookmarks sur replays (rejeté 2026-05-14)
- Partage public d'un replay (URL publique)
- Replay tags / catégorisation user-defined
- Liste des "moments forts" auto-générés sur la timeline (rejeté 2026-05-14)
- Card inspector premium refonte (deferred — voir [`memory/project_card_inspector_premium_spec.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_card_inspector_premium_spec.md))
- Picker turn avec virtual scroll (v1 = scroll natif simple)

### A4. Décisions revues et tranchées sur le mockup (2026-05-14)

| Sujet | Avant | Après | Raison |
|---|---|---|---|
| Critère responsive | orientation/hauteur (`force-mobile-landscape`, `force-portrait`) | width-driven `@media (max-width: 760px)` + `.is-narrow` | Feedback Axel "il faudrait gérer cela par rapport à la largeur, pas la hauteur" |
| Timeline mobile | bande compressée + long-press preview | stepper `◀ pill ▶` + picker grille 3 cols + swipe board | Cibles tactiles WCAG 44×44 impossibles à 360px sur 11+ tours |
| Picker format | 3 options proposées | grille 3 cols avec mini-board | Choix Axel (vs liste verticale / hybride icône) |
| Setup (T0) | option dédiée séparée | inclus comme tour normal dans stepper | Choix Axel (vs bouton "↺ Début") |
| Swipe board | non proposé initialement | activé (60px / 80px / 600ms thresholds) | Choix Axel (vs pas de swipe) |
| Zoom timeline | dans la timeline-bar (z-index:10 flottant) | dans `.transport-options` cluster droit | Masquait le dernier tour avec son z-index:10 |
| Cheat sheet keybind | `D` = mode décisions, `M` = manuel/auto | `M` = mode décisions, `D` = panneau debug, `G` = niveau log | Aligné sur Angular replay-page.component.ts:500-512. `M=manuel/auto` était une feature inventée n'existant pas en Angular |
| Position label | `Tour 3 · 42 / 87 évts · Activation` | `Tour 3 · ⚡ Main 1 · P1 · Activation` | Phase ajoutée comme chip dédié, matche Angular |
| Loading progress | "Calcul des états du duel…" générique | "Chargé **6 / 11** tours · {label}" | Matche Angular `progressText` computed |
| Preview toolbar dev | Desktop / 📱 Portrait / 📱 Landscape | 🖥 Desktop / 📱 Mobile + select largeur | Cohérent avec critère width-driven |
| **(Audit code 2026-05-14)** Mini-board picker + popover | `<app-pvp-board-container [preview]>` partagé | `<app-mini-board-thumbnail>` dédié | Mockup acte un layout simplifié (`.mini-hand` + `.mini-field-row` + `.mini-zone`) ; trop lourd d'instancier 11+ `<app-pvp-board-container>` en grille. Décision déplacée de "risque impl-time" à "décision Architecture". |
| **(Audit code 2026-05-14)** End-overlay CTA Fork | 3 CTAs (Rejouer + Fork + Bibliothèque) | 2 CTAs (Rejouer + Bibliothèque) | Forker depuis l'état terminal d'un duel terminé n'a pas de sens jeu. Mockup à mettre à jour. |
| **(Audit code 2026-05-14)** End-overlay détermination résultat | non spécifié | helper `deriveOutcome(metadata.result, mySide)` | `ReplayMetadataMsg` n'a PAS de champ `winner` ; on dérive depuis `result: string` + perspective. Helper pur testable. |
| **(Audit code 2026-05-14)** Copy-link feature | dans mockup, absente du plan | handler `onCopyLink()` + bouton topbar + entrée options-sheet + toast | Le mockup la prévoit déjà ; le plan listait l'i18n mais omettait composant + service. |
| **(Audit code 2026-05-14)** Zoom state ownership | interne `TimelineBarComponent` | lifté en `ReplayPageComponent` | Sans lifting, `<app-timeline-zoom-control>` extrait dans transport-bar serait désynchronisé du wheel scroll timeline. |
| **(Audit code 2026-05-14)** `_tokens.scss` `--self-blue*`/`--opp-amber*` | plan disait "tokens existants" | tokens à AJOUTER en F0 | Audit a confirmé qu'ils n'existent que dans le mockup `:root`, pas dans le DS Angular. |
| **(Audit code 2026-05-14)** Hand-rows `position:absolute` | plan F4 SCSS disait "retrait, déléguées à board-container" | CONSERVER intégralement | `<app-pvp-board-container>` ne gère PAS la position des hand-rows ; retrait casserait le layout. |
| **(Audit code 2026-05-14)** `ReplayTransportService.seekToTurn` | plan utilisait `transport.seekToTurn(...)` sans préciser que c'est nouveau | méthode à AJOUTER au service | Vérifié 2026-05-14 : absente du service. |
| **(Audit code 2026-05-14)** `<app-replay-bottom-sheet>` handle | plan créait un wrapper from scratch | wrapper consomme `<app-bottom-sheet-handle>` shared | Composant shared existe déjà (lobby/hub), pattern MatDialog + drag-to-close réutilisable. |
| **(Audit code 2026-05-14)** `<app-replay-loading-skeleton>` | plan créait un wireframe ad-hoc | composé de primitives `<app-skel>` shared | Convention skytrix `project_skeleton_screens_convention.md` ; primitive existante avec sweep 1.4s. |
| **(Audit code 2026-05-14)** Détails bottom-sheet i18n | 3 clés (`title`, `duration`, `date`) | 8 clés (+ `turns`, `events`, `summary`, `opponentLabel`, `deckLabel`) | Mockup `#detailsSheet` affiche durée + tours + évènements + date + joueurs + decks. |
| **(Audit code 2026-05-14)** Clavier `?` cross-layout | non spécifié | `event.key === '?'` (fonctionne QWERTY + AZERTY) | `event.code` varie selon layout ; `event.key` renvoie le caractère final, identique sur les deux. |
| **(Audit code 2026-05-14)** Réutilisation `replay.transport.*` i18n | non mentionnée | clés existantes réutilisées par cheat-sheet | Évite doublons et incohérences FR/EN. |
| **(Revue post-impl B1+B2 2026-05-14)** D2 orientation lock | Retiré du replay viewer | **CONSERVÉ** dans le replay viewer + extrait dans `shared/orientation-lock/` (consolidation PvP duel + replay) | Le viewer **réutilise les composants PvP** (board-container, hand-rows, zone-browser, etc.) qui ne sont pas responsive portrait. Tant que le PvP duel reste landscape-only, le replay doit l'être aussi. La décision initiale sous-estimait le coût d'adapter les composants PvP au portrait. À reconsidérer si/quand le PvP duel devient adaptable portrait. |

---

**Document maintenu par** : Sally (UX Designer) + Axel
**Dernière mise à jour** : 2026-05-14 (audit cross-code 2e passe — 15 ajustements appliqués + 5 décisions D18-D22 + **3e passe : refresh DS Wave 1** + **4e passe : revue post-impl B1+B2** (D2 orientation-lock reverté : conservé + extrait dans `shared/`)). F0 réduit de 2h30 → 1h, total 20h30 → 19h. Tables de classes DS Wave 1 ajoutées en F1 + F3.
**Source de vérité** : ce document + spec DS Wave 1 + mockup [`_mockups/mockup-replay-viewer.html`](../../_mockups/mockup-replay-viewer.html). En cas de divergence avec [`memory/project_replay_rework_2026_05_14.md`](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_replay_rework_2026_05_14.md), ce document fait foi.
**Pré-requis bloquant** : DS Wave 1 livré en prod (cf. §7 — ordre de livraison). Sans le DS Wave 1, le Viewer F1-F4 ne peut pas démarrer.
**Documents liés** : [`ds-wave-1-spec-2026-05-14.md`](./ds-wave-1-spec-2026-05-14.md) (spec DS autonome) · [`ds-wave-1-pvp-extraction-audit-2026-05-14.md`](./ds-wave-1-pvp-extraction-audit-2026-05-14.md) (audit PvP) · [`replay-hub-rework-2026-05-14.md`](./replay-hub-rework-2026-05-14.md) (premier consommateur DS Wave 1)
