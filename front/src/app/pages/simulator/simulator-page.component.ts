import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal, toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, filter, map, switchMap } from 'rxjs';
import { DeckBuildService } from '../../services/deck-build.service';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { SimBoardComponent } from './board.component';

@Component({
  selector: 'app-sim-page',
  templateUrl: './simulator-page.component.html',
  styleUrl: './simulator-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BoardStateService, CommandStackService],
  imports: [SimBoardComponent],
})
export class SimulatorPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly boardState = inject(BoardStateService);

  readonly deckId = toSignal(
    this.route.paramMap.pipe(map(params => Number(params.get('id')) || 0)),
    { initialValue: 0 }
  );

  constructor() {
    toObservable(this.deckId).pipe(
      filter(id => id > 0),
      switchMap(id => this.deckBuildService.getById(id).pipe(
        catchError(() => {
          this.router.navigate(['/decks']);
          return EMPTY;
        })
      )),
      takeUntilDestroyed(),
    ).subscribe(deck => this.boardState.initializeBoard(deck));
  }
}
