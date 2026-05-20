import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ReplayDTO } from '../../../core/model/dto/replay-dto';
import { DuelResult } from '../../../core/enums/duel-result.enum';
import { AuthService } from '../../../services/auth.service';
import { AvatarComponent } from '../../../shared/avatar/avatar.component';
import { ReplayCardSkeletonComponent } from '../../../shared/skel';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '../../../components/empty-state/empty-state.component';
import { PageShellComponent } from '../../../components/page-shell/page-shell.component';
import { SectionHeaderComponent } from '../../../components/section-header/section-header.component';
import { StatsStripComponent, StatItem } from '../../../components/stats-strip/stats-strip.component';
import { ReplayHubStore, ReplayFilter, ReplaySortMode } from './replay-hub-store';

interface ResultMeta {
  variant: 'gold' | 'cyan' | 'neutral' | 'warning' | 'danger';
  icon: string;
  i18nKey: string;
}

const RESULT_META: Record<DuelResult, ResultMeta> = {
  [DuelResult.VICTORY]:             { variant: 'gold',    icon: 'emoji_events',     i18nKey: 'replay.hub.card.result.victory' },
  [DuelResult.OPPONENT_TIMEOUT]:    { variant: 'gold',    icon: 'timer_off',        i18nKey: 'replay.hub.card.result.timeoutOpp' },
  [DuelResult.OPPONENT_DISCONNECT]: { variant: 'gold',    icon: 'wifi_off',         i18nKey: 'replay.hub.card.result.disconnectOpp' },
  [DuelResult.OPPONENT_SURRENDER]:  { variant: 'gold',    icon: 'flag',             i18nKey: 'replay.hub.card.result.surrenderOpp' },
  [DuelResult.DEFEAT]:              { variant: 'neutral', icon: 'close',            i18nKey: 'replay.hub.card.result.defeat' },
  [DuelResult.DRAW]:                { variant: 'cyan',    icon: 'horizontal_rule',  i18nKey: 'replay.hub.card.result.draw' },
  [DuelResult.TIMEOUT]:             { variant: 'warning', icon: 'timer_off',        i18nKey: 'replay.hub.card.result.timeout' },
  [DuelResult.DISCONNECT]:          { variant: 'warning', icon: 'wifi_off',         i18nKey: 'replay.hub.card.result.disconnect' },
  [DuelResult.SURRENDER]:           { variant: 'danger',  icon: 'flag',             i18nKey: 'replay.hub.card.result.surrender' },
};

const REPLAY_CARD_ITEM_SIZE_PX = 104;

/** Virtual-scroll item — real replay or skeleton placeholder. The skeleton
 *  variant is rendered inside the viewport (after the last real card) only
 *  while `loadNextPage()` is in flight, so the loading indicator sits in
 *  the scroll context next to the replays instead of below the empty
 *  bottom of the viewport. */
type DisplayedItem =
  | { kind: 'card'; replay: ReplayDTO }
  | { kind: 'skeleton'; id: string };

@Component({
  selector: 'app-replay-hub-page',
  standalone: true,
  imports: [
    DatePipe,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ScrollingModule,
    TranslateModule,
    RouterLink,
    AvatarComponent,
    ReplayCardSkeletonComponent,
    EmptyStateComponent,
    PageShellComponent,
    SectionHeaderComponent,
    StatsStripComponent,
  ],
  providers: [ReplayHubStore],
  templateUrl: './replay-hub-page.component.html',
  styleUrl: './replay-hub-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayHubPageComponent implements OnInit {
  protected readonly store = inject(ReplayHubStore);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(MatDialog);

  readonly replayCardItemSize = REPLAY_CARD_ITEM_SIZE_PX;
  readonly deletingId = signal<string | null>(null);

  readonly sortModes: ReplaySortMode[] = ['newest', 'oldest', 'mostTurns'];
  readonly filterModes: { id: ReplayFilter; icon?: string; needsDeck?: boolean }[] = [
    { id: 'all' },
    { id: 'wins',       icon: 'emoji_events' },
    { id: 'losses',     icon: 'close' },
    { id: 'myDeck',     icon: 'style', needsDeck: true },
    { id: 'last7days',  icon: 'schedule' },
  ];

  readonly hasSearchActive = computed(() => this.store.searchQuery().length > 0);

  readonly showEmptyState = computed(() =>
    !this.store.loading()
    && !this.store.error()
    && this.store.replays().length === 0,
  );

  readonly showNoResultsState = computed(() =>
    !this.store.loading()
    && !this.store.error()
    && this.store.replays().length > 0
    && this.store.filteredReplays().length === 0,
  );

  readonly winratePercent = computed(() => {
    const s = this.store.stats();
    if (!s) return 0;
    return Math.round(s.winrate * 100);
  });

  readonly statsItems = computed<StatItem[]>(() => {
    const s = this.store.stats();
    if (!s) return [];
    return [
      { icon: 'movie',        iconVariant: 'cyan',    value: s.total,                labelKey: 'replay.hub.stats.total',     surfaceAccent: 'cyan' },
      { icon: 'emoji_events', iconVariant: 'gold',    value: s.victories,            labelKey: 'replay.hub.stats.victories', surfaceAccent: 'gold', valueVariant: 'gold' },
      { icon: 'close',        iconVariant: 'neutral', value: s.defeats,              labelKey: 'replay.hub.stats.defeats',   surfaceAccent: 'neutral', valueVariant: 'muted' },
      { icon: 'trending_up',  iconVariant: 'gold',    value: `${this.winratePercent()}%`, labelKey: 'replay.hub.stats.winrate', surfaceAccent: 'gold', valueVariant: 'gold' },
    ];
  });

  /** Items rendered by the virtual-scroll. Real replay-cards followed by 2
   *  skeleton-sentinel placeholders while `fetchingMore()` is in flight —
   *  this keeps the skeleton positioned right after the last visible card
   *  (in-list) instead of as a sibling at the bottom of the viewport,
   *  which is what the user expected (Q7-skeleton follow-up). */
  readonly displayedItems = computed<DisplayedItem[]>(() => {
    const cards: DisplayedItem[] = this.store.filteredReplays().map(r => ({ kind: 'card' as const, replay: r }));
    if (this.store.fetchingMore()) {
      cards.push({ kind: 'skeleton' as const, id: '__skeleton-1' });
      cards.push({ kind: 'skeleton' as const, id: '__skeleton-2' });
    }
    return cards;
  });

  ngOnInit(): void {
    this.store.start();
  }

  // ── Card view-model helpers ────────────────────────────────────────────────
  /** Player index of the authenticated user inside a replay (0 or 1). */
  mySide(r: ReplayDTO): 0 | 1 {
    return r.player1Id === this.authService.user()?.id ? 0 : 1;
  }
  opponentSide(r: ReplayDTO): 0 | 1 {
    return this.mySide(r) === 0 ? 1 : 0;
  }
  opponentName(r: ReplayDTO): string {
    return r.metadata.playerUsernames[this.opponentSide(r)] ?? '';
  }
  myDeckName(r: ReplayDTO): string {
    return r.metadata.deckNames[this.mySide(r)] ?? '';
  }
  opponentDeckName(r: ReplayDTO): string {
    return r.metadata.deckNames[this.opponentSide(r)] ?? '';
  }
  /** Une seule string `myDeck · vs oppDeck` (ou variantes partielles) pour
   *  rendre les decks dans un unique `<span>` — élimine les gaps flex parasites
   *  entre 2 spans séparés (Axel 2026-05-17). Retourne `''` si aucun deck. */
  deckMatchupText(r: ReplayDTO): string {
    const mine = this.myDeckName(r);
    const opp = this.opponentDeckName(r);
    const vsPrefix = this.translate.instant('replay.hub.card.vsDeckPrefix');
    if (mine && opp) return `${mine} ${vsPrefix} ${opp}`;
    if (mine) return mine;
    if (opp) return `${vsPrefix} ${opp}`;
    return '';
  }
  resultMeta(r: ReplayDTO): ResultMeta {
    return RESULT_META[r.metadata.result];
  }
  /** Formats the optional duration as M:SS, or empty string when absent. */
  durationText(r: ReplayDTO): string {
    const sec = r.metadata.durationSec;
    if (!sec || sec <= 0) return '';
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // ── Track / sort labels ────────────────────────────────────────────────────
  trackByReplayId(_index: number, item: ReplayDTO): string {
    return item.id;
  }
  trackByDisplayed(_index: number, item: DisplayedItem): string {
    return item.kind === 'card' ? item.replay.id : item.id;
  }
  isCard(item: DisplayedItem): item is { kind: 'card'; replay: ReplayDTO } {
    return item.kind === 'card';
  }
  sortLabelKey(): string {
    return `replay.hub.sort.${this.store.sortMode()}`;
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  setSortMode(mode: ReplaySortMode): void {
    this.store.setSortMode(mode);
  }
  setActiveFilter(filter: ReplayFilter): void {
    this.store.setActiveFilter(filter);
  }
  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.store.setSearchQuery(target.value);
  }
  clearSearch(): void {
    this.store.clearSearch();
  }
  clearFilters(): void {
    this.store.clearFilters();
  }

  /**
   * Keyboard-only entry point — the replay-card is an `<a [routerLink]>` so
   * Enter and click are handled natively by the browser/router (preserves
   * middle-click open-in-new-tab + Ctrl/Cmd+Click). Space is hijacked here to
   * match the master `mat-row` activation model and prevent the default page
   * scroll. Programmatic callers (tests, future imperative seek) still get a
   * navigate path.
   */
  openReplay(event: Event | null, replay: ReplayDTO): void {
    if (event && 'preventDefault' in event) event.preventDefault();
    this.router.navigate(['/pvp/replay', replay.id]);
  }

  goToLobby(): void {
    this.router.navigate(['/pvp']);
  }

  /** Mockup §replay-action-btn--danger — delete with confirm modal.
   *  Aligned with the rest of the app's destructive-action pattern
   *  (deck delete, etc.) via `ConfirmDialogComponent`. The store still
   *  performs optimistic removal + auto-rollback on HTTP error; the
   *  `deletingId` spinner covers the brief network round-trip. */
  async deleteReplay(replay: ReplayDTO, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    const confirmed = await firstValueFrom(
      this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        data: {
          title: this.translate.instant('replay.hub.card.deleteTitle'),
          message: this.translate.instant('replay.hub.card.deleteConfirm'),
          confirmLabel: this.translate.instant('common.delete'),
          destructive: true,
        },
        width: '360px',
        panelClass: ['pvp-dialog-panel', 'pvp-dialog-panel--danger'],
        autoFocus: false,
      }).afterClosed(),
    );

    if (!confirmed) return;

    this.deletingId.set(replay.id);
    try {
      await this.store.deleteReplay(replay.id);
    } finally {
      this.deletingId.set(null);
    }
  }

  // ── Virtual scroll pagination ──────────────────────────────────────────────
  onScrolledIndexChange(_index: number, viewport: CdkVirtualScrollViewport): void {
    const renderedEnd = viewport.getRenderedRange().end;
    if (this.store.shouldLoadMore(renderedEnd)) {
      this.store.loadNextPage();
    }
  }
}
