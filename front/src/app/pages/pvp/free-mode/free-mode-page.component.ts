import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { DeckBuildService } from '../../../services/deck-build.service';
import { NavbarCollapseService } from '../../../services/navbar-collapse.service';
import { BoardStateService } from '../../simulator/board-state.service';
import { CommandStackService } from '../../simulator/command-stack.service';
import { PvpBoardContainerComponent } from '../duel-page/pvp-board-container/pvp-board-container.component';
import { RenderedBoardStateService } from '../duel-page/rendered-board-state.service';
import { CardTravelEngine } from '../duel-page/card-travel-engine.service';
import { BoardEffectsService } from '../duel-page/board-effects.service';
import { FloatRegistryService } from '../duel-page/float-registry.service';
import { DuelContext } from '../duel-page/duel-context';
import { DuelLogger } from '../duel-page/duel-logger';
import { DuelCardArtService } from '../duel-page/duel-card-art.service';
import { DuelGameLogService } from '../duel-page/duel-game-log.service';
import { ScopeResetDispatcher } from '../projections';
import { EMPTY_STRING_SET, EMPTY_ARRAY } from '../types';
import { cardInstancesToBoardStatePayload } from './card-instances-to-payload';

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
  ],
  imports: [PvpBoardContainerComponent],
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

  protected readonly renderedState = this.rbs.renderedState;
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

    // Immersive mode (hide navbar) for the editor, restored on destroy.
    this.navbarCollapse.setImmersiveMode(true);
    this.destroyRef.onDestroy(() => this.navbarCollapse.setImmersiveMode(false));
  }
}
