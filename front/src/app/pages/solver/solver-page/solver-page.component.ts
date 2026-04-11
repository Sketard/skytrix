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
  viewChild,
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
import type { SolverAction, SolverStartConfig } from '../../../core/model/solver.model';
import { SolverConfigComponent } from '../solver-config/solver-config.component';
import { SolverProgressComponent } from '../solver-progress/solver-progress.component';
import { HeroResultBlockComponent } from '../solver-result/hero-result-block.component';
import { BrickStateBlockComponent } from '../solver-result/brick-state-block.component';
import { BreadcrumbPathComponent } from '../solver-result/breadcrumb-path.component';
import { DecisionTreeComponent } from '../solver-result/decision-tree.component';
import { SolverHistoryMenuComponent } from '../solver-result/solver-history-menu.component';
import { PinnedResultsBarComponent } from '../solver-result/pinned-results-bar.component';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-solver-page',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule, RouterLink, TranslatePipe, SolverConfigComponent, SolverProgressComponent, HeroResultBlockComponent, BrickStateBlockComponent, BreadcrumbPathComponent, DecisionTreeComponent, SolverHistoryMenuComponent, PinnedResultsBarComponent],
  providers: [SolverDebugLogService],
  templateUrl: './solver-page.component.html',
  styleUrl: './solver-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { tabindex: '0' },
})
export class SolverPageComponent implements OnInit, OnDestroy {
  protected readonly solverService = inject(SolverService);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notify = inject(NotificationService);

  readonly decisionTree = viewChild<DecisionTreeComponent>('decisionTree');
  readonly solverConfig = viewChild(SolverConfigComponent);

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

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Skip when the user is typing in a real input — no shortcut hijacking.
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

    // Ctrl/Cmd+Enter → solve (if config valid)
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const cfg = this.solverConfig();
      if (cfg && cfg.canSolve()) {
        event.preventDefault();
        cfg.onSolve();
      }
      return;
    }

    // Escape → cancel running solve
    if (event.key === 'Escape' && this.solverState() === 'running') {
      event.preventDefault();
      this.onCancel();
    }
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
        const cardNameMap = new Map<number, string>();
        const allCards = [...dto.mainDeck, ...dto.extraDeck];
        for (const icd of allCards) {
          if (icd.card.card.id != null && icd.card.card.name != null) {
            cardNameMap.set(icd.card.card.id, icd.card.card.name);
          }
        }
        this.solverService.setDeckDisplayMeta(dto.name, cardNameMap);
        if (this.solverService.solverState() === 'loading') {
          this.solverService.solverState.set('idle');
        }
      });
  }

  onBreadcrumbClick(action: SolverAction): void {
    this.decisionTree()?.scrollToAction(action);
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
    // Do NOT disconnect the SolverService here. The service is `providedIn:
    // 'root'` precisely so a long-running solve can complete in the background
    // while the user navigates elsewhere — and the result re-appears when they
    // come back to this page (Story 1.5a result-resilience AC). The service's
    // own idle-timer (5 min, see solver.service.ts:430) handles eventual
    // teardown when the user truly stops interacting. Disconnecting here was
    // the C4 finding in the Epic 1 review.
  }
}
