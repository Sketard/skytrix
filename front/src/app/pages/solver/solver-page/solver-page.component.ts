import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';

import { SolverService } from '../services/solver.service';
import { SolverDebugLogService } from '../services/solver-debug-log.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Deck } from '../../../core/model/deck';
import { DeckDTO } from '../../../core/model/dto/deck-dto';
import type { SolverStartConfig } from '../../../core/model/solver.model';
import { SolverConfigComponent } from '../solver-config/solver-config.component';
import { SolverProgressComponent } from '../solver-progress/solver-progress.component';
import { HeroResultBlockComponent } from '../solver-result/hero-result-block.component';
import { BrickStateBlockComponent } from '../solver-result/brick-state-block.component';

@Component({
  selector: 'app-solver-page',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatProgressSpinnerModule, RouterLink, TranslatePipe, SolverConfigComponent, SolverProgressComponent, HeroResultBlockComponent, BrickStateBlockComponent],
  providers: [SolverDebugLogService],
  templateUrl: './solver-page.component.html',
  styleUrl: './solver-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolverPageComponent implements OnInit, OnDestroy {
  protected readonly solverService = inject(SolverService);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notify = inject(NotificationService);

  readonly collapsed = signal(false);
  readonly deck = signal<Deck | null>(null);
  private readonly windowWidth = signal(window.innerWidth);
  readonly isDesktop = computed(() => this.windowWidth() >= 1024);

  readonly solverState = this.solverService.solverState;

  readonly cardImageMap = computed(() => {
    const d = this.deck();
    if (!d) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const icd of d.mainDeck) {
      if (icd.index !== -1) {
        map.set(icd.card.card.id!, icd.card.images[0]?.smallUrl || 'assets/images/card_back.jpg');
      }
    }
    for (const icd of d.extraDeck) {
      if (icd.index !== -1) {
        map.set(icd.card.card.id!, icd.card.images[0]?.smallUrl || 'assets/images/card_back.jpg');
      }
    }
    return map;
  });

  constructor() {
    effect(() => {
      const state = this.solverService.solverState();
      if (state === 'complete') {
        this.collapsed.set(true);
      } else if (state === 'configuring') {
        this.collapsed.set(false);
      }
    });
  }

  @HostListener('window:resize')
  onResize(): void {
    this.windowWidth.set(window.innerWidth);
  }

  ngOnInit(): void {
    this.solverService.connect();

    this.route.params
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(params => {
          const id = params['id'];
          this.solverService.setDeckContext(id);
          this.solverService.solverState.set('loading');
          return this.http.get<DeckDTO>(`/api/decks/${id}`).pipe(
            catchError(err => {
              this.solverService.solverState.set('error');
              this.deck.set(null);
              if (err.status === 404) {
                this.notify.error('solver.error.deckNotFound');
              } else if (err.status === 403) {
                this.notify.error('solver.error.accessDenied');
              } else {
                this.notify.error('solver.error.connectionFailed');
              }
              return EMPTY;
            }),
          );
        }),
      )
      .subscribe(dto => {
        this.deck.set(new Deck(dto));
        if (this.solverService.solverState() === 'loading') {
          this.solverService.solverState.set('idle');
        }
      });
  }

  uncollapse(): void {
    this.solverService.solverState.set('configuring');
    this.collapsed.set(false);
  }

  onSolve(config: SolverStartConfig): void {
    this.solverService.solve(config);
  }

  onCancel(): void {
    this.solverService.cancel();
  }

  ngOnDestroy(): void {
    this.solverService.disconnect();
  }
}
