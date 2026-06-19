import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { DeckBuildService } from '../../../services/deck-build.service';
import { NavbarCollapseService } from '../../../services/navbar-collapse.service';
import { BoardStateService } from '../../simulator/board-state.service';
import { CommandStackService } from '../../simulator/command-stack.service';
import { PvpBoardContainerComponent } from '../duel-page/pvp-board-container/pvp-board-container.component';
import { PvpHandRowComponent } from '../duel-page/pvp-hand-row/pvp-hand-row.component';
import { PvpCardInspectorWrapperComponent } from '../duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component';
import { RenderedBoardStateService } from '../duel-page/rendered-board-state.service';
import { CardTravelEngine } from '../duel-page/card-travel-engine.service';
import { BoardEffectsService } from '../duel-page/board-effects.service';
import { FloatRegistryService } from '../duel-page/float-registry.service';
import { DuelContext } from '../duel-page/duel-context';
import { DuelLogger } from '../duel-page/duel-logger';
import { DuelCardArtService } from '../duel-page/duel-card-art.service';
import { DuelGameLogService } from '../duel-page/duel-game-log.service';
import { CardInspectionService } from '../duel-page/card-inspection.service';
import { CardDataCacheService } from '../duel-page/card-data-cache.service';
import { ScopeResetDispatcher } from '../projections';
import { BoardZone, CardOnField } from '../duel-ws.types';
import { EMPTY_STRING_SET, EMPTY_ARRAY } from '../types';
import { cardInstancesToBoardStatePayload } from './card-instances-to-payload';
import { FreeModeInteractionService, CardTapEvent } from './free-mode-interaction.service';

const FREE_MODE_LP = 8000;

/**
 * PvP Free Mode — a mono-player board editor (sandbox) built on the PvP render
 * pipeline. Reuses `<app-pvp-board-container>` + the sim edit engine
 * (`BoardStateService` + `CommandStackService`), bridged by the pure adapter
 * `cardInstancesToBoardStatePayload`.
 *
 * Decoupled from the WS bootstrap (the duel-page's `connectWhenReady` is
 * unconditional) — this is a dedicated page that reuses ONLY the board
 * component + its providers. No worker, no prompts, no turns, no victory.
 *
 * v1a — state jumps only (`updateLogical` + `commitAll`), zero `lockZone`
 * (no travel animation; that's v1b). The orchestrator pipeline is intentionally
 * NOT provided: the board renders straight from `RenderedBoardStateService`'s
 * `renderedState()` signal, which the bootstrap effect drives directly.
 */
@Component({
  selector: 'app-free-mode-page',
  templateUrl: './free-mode-page.component.html',
  styleUrl: './free-mode-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `theme-dark` — keep the editor dark like the duel page even under light theme.
  host: { class: 'theme-dark' },
  providers: [
    // PvP render block (the board container's transitive deps)
    RenderedBoardStateService, CardTravelEngine, BoardEffectsService, FloatRegistryService,
    DuelContext, DuelLogger, DuelCardArtService, DuelGameLogService, ScopeResetDispatcher,
    // sim edit engine (the survivors — reused as-is)
    BoardStateService, CommandStackService,
    // free-mode interaction state machine (étape 4)
    FreeModeInteractionService,
    // card inspector (étape 5a — reused PvP inspector, T3)
    CardInspectionService, CardDataCacheService,
  ],
  imports: [PvpBoardContainerComponent, PvpHandRowComponent, PvpCardInspectorWrapperComponent],
})
export class FreeModePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly boardState = inject(BoardStateService);
  protected readonly duelCtx = inject(DuelContext);
  protected readonly rbs = inject(RenderedBoardStateService);
  protected readonly interaction = inject(FreeModeInteractionService);
  protected readonly cardInspection = inject(CardInspectionService);
  private readonly cardDataCache = inject(CardDataCacheService);

  protected readonly renderedState = this.rbs.renderedState;
  protected readonly inspectedCard = this.cardInspection.inspectedCard;
  protected readonly inspectorForceExpanded = this.cardInspection.inspectorForceExpanded;
  /** Player hand, derived from the rendered HAND zone (same as the duel-page). */
  protected readonly playerHand = computed<CardOnField[]>(() => {
    const player = this.renderedState().players[0];
    const handZone = player?.zones.find((z: BoardZone) => z.zoneId === 'HAND');
    return handZone?.cards ?? [];
  });
  /**
   * Every hand card is "actionable" so a tap fires `handCardAction` (→ arm). The
   * hand row only emits `handCardAction` for indices in this set; an unbound
   * (empty) set would route every tap to `cardInspectRequest` (inspect) instead,
   * making the tap-to-arm flow dead. Long-press / right-click still inspect via
   * `cardInspectRequest({forceExpanded:true})`.
   */
  protected readonly handActionableIndices = computed(
    () => new Set(this.playerHand().map((_, i) => i)),
  );
  protected readonly emptySet = EMPTY_STRING_SET;
  // Stable identities for the inert board inputs — a literal `[]`/`new Set()` in
  // the template allocates fresh each CD pass, thrashing the OnPush child input.
  protected readonly emptyChainLinks = EMPTY_ARRAY;

  // why: page-local editor state (player LP), wired to the inline LP editor in
  // étape 5. Not pipeline transport, not an @Environment input, and the page is
  // not a projection — it's plain component edit state outside the α.1 taxonomy.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  protected readonly lp = signal(FREE_MODE_LP);

  readonly deckId = toSignal(
    this.route.paramMap.pipe(map(params => Number(params.get('id')) || 0)),
    { initialValue: 0 },
  );

  constructor() {
    // 1. Configure DuelContext BEFORE any RBS/relativizer read (duelAssert otherwise).
    //    Mono-player: own index 0, no playback scaling, board always active
    //    (no pre-activation buffer — v1a has no animation queue to gate).
    this.duelCtx.configure({
      ownPlayerIndex: () => 0,
      speedMultiplier: () => 1,
      isBoardActive: () => true,
    });

    // 2. Load the deck → populate BoardStateService (hand of 5 + deck/extra).
    toObservable(this.deckId).pipe(
      filter(id => id > 0),
      switchMap(id => this.deckBuildService.getById(id).pipe(
        catchError(() => {
          this.router.navigate(['/decks']);
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(),
    ).subscribe(deck => this.boardState.initializeBoard(deck));

    // 3. Sync edit model → render payload on every board mutation. v1a: a state
    //    jump (commitAll), no lockZone (else assertNoLocks + 30s safety timeout).
    effect(() => {
      const payload = cardInstancesToBoardStatePayload(this.boardState.boardState(), this.lp());
      this.rbs.updateLogical(payload);
      this.rbs.commitAll('free-mode:sync');
    });

    // 4. Wire the PvP card inspector (T3). The interaction service signals
    //    "inspect" (double-tap / long-press) through the registered sink.
    this.cardInspection.init(this.cardDataCache);
    this.interaction.onInspect((event: CardTapEvent) => {
      void this.cardInspection.inspectByCode(event.cardCode, event.forceExpanded ?? false);
    });

    // Immersive mode (hide navbar) for the editor, restored on destroy.
    this.navbarCollapse.setImmersiveMode(true);
    this.destroyRef.onDestroy(() => this.navbarCollapse.setImmersiveMode(false));
  }

  /** Hand card tapped (actionable path) — arm by positional index. */
  onHandCardAction(event: { index: number; element: HTMLElement }): void {
    this.interaction.onHandCardTap(event.index);
  }

  /**
   * Hand card inspect gesture → PvP inspector. The hand row emits this on
   * long-press / right-click (forceExpanded) — and, defensively, on a plain tap
   * only if the card were ever non-actionable (it isn't here). Inspect only on
   * the explicit inspect gesture so a plain tap can't double as inspect.
   */
  onHandInspect(event: { cardCode: number; forceExpanded?: boolean }): void {
    if (!event.forceExpanded) return;
    void this.cardInspection.inspectByCode(event.cardCode, true);
  }

  closeInspector(): void {
    this.cardInspection.close();
  }
}
