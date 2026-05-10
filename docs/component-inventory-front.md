# Component Inventory — Frontend

> All components are `standalone: true` with `OnPush` change detection. Selector prefix `app-`. Filenames kebab-case, classes PascalCase.

## Layout / chrome

| Component | Location | Role |
|---|---|---|
| `NavbarComponent` | `components/navbar/` | Top navigation, user profile, language toggle |
| `LoaderComponent` | `components/loader/` | Global spinner controlled by `LoaderService` signal |
| `SystemOverlayComponent` | `components/system-overlay/` | App-level overlays (errors, modals, blocking states) |

## Card

| Component | Role |
|---|---|
| `CardComponent` | Single card thumbnail (image + minimal metadata) |
| `CardInspectorComponent` | Full card detail view (text, attributes, lineage, sets) |
| `CardImageFallbackComponent` | Placeholder when art is missing |
| `CardListComponent` | Paginated card list grid |

## Deck

| Component | Role |
|---|---|
| `DeckBoxComponent` | Deck summary tile (name, counts, actions) |
| `DeckCardZoneComponent` | Drop zone in the deck builder (MAIN / EXTRA / SIDE) with CDK drag-drop |

## Filters & search

| Component | Role |
|---|---|
| `CardFiltersComponent` | Filter bar container |
| `AutocompleteFilterComponent` | Text search with autocomplete |
| `BetweenFilterComponent` | Numeric range slider |
| `CardSetSearchFilterComponent` | Card set picker |
| `MultiSelectAutocompleteFilterComponent` | Multi-select autocomplete |
| `ToggleIconFilterComponent` | Icon toggles (e.g. card type icons) |
| `SearchBarComponent` | Global search bar |
| `CardSearcherComponent` | Card search + filter orchestrator (combines several of the above) |
| `BottomSheetComponent` | Bottom-sheet modal container |

## Display utilities

| Component | Role |
|---|---|
| `EmptyStateComponent` | "No results" placeholder |
| `MultipleActionButtonComponent` | Split button with dropdown menu |
| `ScalingContainerComponent` | Responsive container that scales to its parent |
| `CustomTooltipComponent` | Enhanced Material tooltip |

## Dialog & notification

| Component | Role |
|---|---|
| `ConfirmDialogComponent` | Standard confirmation modal (used pervasively) |
| `SnackbarComponent` | Inline notification body, opened via `MatSnackBar.openFromComponent(...)` |

## Page-level components — Solo Simulator

Located under `pages/simulator-page/`.

| Component | Role |
|---|---|
| `SimulatorPageComponent` | Page entry; wires `BoardStateService` + `CommandStackService` (component-scoped) |
| `SimBoardComponent` | Field render: 18 zones, stacked overlays, xyz peeks |
| `HandComponent` | Player hand (drag-drop into the field) |
| `ZoneComponent` | Single field zone |
| `StackedZoneComponent` | Pile zones (Deck, GY, Banished, Extra) — top card render only |
| `PileOverlayComponent` | Browse-pile modal |
| `ControlBarComponent` | Undo/redo, draw, shuffle controls |

## Page-level components — Lobby (PvP entry)

Located under `pages/pvp/lobby-page/`.

| Component | Role |
|---|---|
| `LobbyPageComponent` | Room listing, create/join, deck picker |
| `DeckPickerDialogComponent` | Pre-join modal to pick a deck |

## Page-level components — PvP duel

The PvP duel page is the largest component graph in the app (40+ component-scoped services + ~25 components). Located under `pages/pvp/duel-page/`.

### Container & UI

| Component | Role |
|---|---|
| `DuelPageComponent` | The orchestrator — wires every duel-page service in its providers list |
| `PvpBoardContainerComponent` | Field zones, life points, graveyards, banished, extra-deck pile |
| `PvpHandRowComponent` | Opponent / player hand with chain badges |
| `PvpActivationToggleComponent` | Solo mode: switch p1 ↔ p2 perspective |
| `PvpChainOverlayComponent` | Chain building/resolving animation + UI; gates re-emission of buffered events |
| `PvpZoneBrowserOverlayComponent` | Deck / GY / banished browser modal |
| `PvpCardInspectorWrapperComponent` | Card detail inspector (images, text, lineage) |
| `InactivityWarningDialogComponent` | AFK warning modal |
| `DebugLogPanelComponent` | Optional debug overlay |

### Status badges

| Component | Role |
|---|---|
| `PvpLpBadgeComponent` | LP counter with tween animation |
| `PvpPhaseBadgeComponent` | Current phase indicator |
| `PvpTimerBadgeComponent` | Per-player timer |

### Prompt UI

Located under `pages/pvp/duel-page/prompts/`. Each prompt type has a dedicated component, registered in `prompt-registry.ts`.

| Component | Prompt types it handles |
|---|---|
| `PromptYesNoComponent` | `SELECT_YESNO`, `SELECT_EFFECTYN` |
| `PromptChoiceComponent` | `SELECT_OPTION` |
| `PromptCardGridComponent` | `SELECT_CARD`, `SELECT_UNSELECT_CARD`, `SELECT_TRIBUTE`, `SELECT_SUM` |
| `PromptOptionListComponent` | Generic option list |
| `PromptActionListReadonlyComponent` | Read-only action menu (other player's view) |
| `PromptAnnounceCardComponent` | `ANNOUNCE_CARD` |
| `PromptNumericInputComponent` | `ANNOUNCE_NUMBER` |
| `PromptPositionSelectComponent` | `SELECT_POSITION` |
| `PromptSortCardComponent` | `SORT_CARD`, `SORT_CHAIN` |
| `PromptZoneHighlightComponent` | `SELECT_PLACE`, `SELECT_DISFIELD` |
| `PvpPromptDialogComponent` | Container that selects the right prompt component from the registry |

## Page-level components — Replay

Located under `pages/pvp/replay/`.

| Component | Role |
|---|---|
| `ReplayPageComponent` | Page entry; reuses ~25 services from `duel-page/` via the same providers pattern |
| `TimelineBarComponent` | Turn / response progression bar |
| `TransportBarComponent` | Play / pause / seek / speed |

## Page-level components — Match history (admin)

Located under `pages/pvp/match-history-page/`.

| Component | Role |
|---|---|
| `MatchHistoryPageComponent` | Replay list, metadata, admin viewing |

## Page-level components — Combo Solver

Located under `pages/solver/`.

| Component | Role |
|---|---|
| `SolverPageComponent` | Solver orchestrator |
| `SolverConfigComponent` | Start config (hand, field, board state) |
| `SolverProgressComponent` | Real-time progress meter |
| `HeroResultBlockComponent` | Best line of play (top node) |
| `BrickStateBlockComponent` | Brick detection + score breakdown |
| `DecisionTreeComponent` | Interactive tree explorer |
| `BreadcrumbPathComponent` | Selected path breadcrumb |
| `SolverHistoryMenuComponent` | Session history (10-entry cap) |
| `PinnedResultsBarComponent` | Pinned favorite results |
| `CardImageFallbackComponent` | Solver-specific fallback (alongside the global one) |
| `InterruptionDisplayComponent` | Interruption highlight |
| `HoverPopupController` | Decision tree hover-popup orchestrator |

## Page-level components — Other top-level pages

| Component | Location | Role |
|---|---|---|
| `LoginPageComponent` | `pages/login-page/` | Login + create-account form |
| `DeckPageComponent` | `pages/deck-page/` | Deck list (cards, actions) |
| `DeckBuilderComponent` | `pages/deck-page/deck-builder/` | Main deck editor (drag-drop, import/export, hand test) |
| `CardSearchPageComponent` | `pages/card-search-page/` | Full card database browser |
| `ParameterPageComponent` | `pages/parameter-page/` | Admin tools (card data sync, image refresh, ban-list) |

## Component count summary

| Category | Approx count |
|---|---|
| Reusable components (`components/**`) | 22 |
| Solo simulator | 7 |
| PvP lobby | 2 |
| PvP duel (container + status + prompts) | 22+ |
| Replay | 3 |
| Match history | 1 |
| Solver | 12 |
| Other top-level pages | 5 |

**Total**: ~75 components.

## Conventions

- Component selector prefix: `app`.
- File: kebab-case (`pvp-board-container.component.ts`), class: PascalCase (`PvpBoardContainerComponent`).
- All components: `standalone: true`, `changeDetection: ChangeDetectionStrategy.OnPush`.
- Inputs/outputs: `input<T>()` / `output<T>()` — never `@Input()`/`@Output()`.
- Templates use signal-based access (`(myValue())`) for OnPush correctness.
- SCSS modules; z-index always via `@use 'z-layers' as z; z.$z-name`.
- No NgModules anywhere.

## Adding a new component

1. Create the directory under `components/<name>/` (or `pages/<page>/<name>/`).
2. Use the existing nearby siblings as templates (e.g. for filter components, copy `between-filter.component.ts`).
3. `selector: 'app-<name>'`, `standalone: true`, `changeDetection: ChangeDetectionStrategy.OnPush`.
4. Imports go in the `imports` array in the decorator — never via `app.config.ts` for component-scoped concerns.
5. If the component holds state, prefer signals over component fields. If it consumes state, expose it as `input<T>()`.
6. If the component is part of a feature page graph (e.g. duel-page), add it to that page component's `imports` and any required services to the page's `providers` (component-scoped — don't use `providedIn: 'root'` for feature-specific services).
