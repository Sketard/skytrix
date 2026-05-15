import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplayDTO } from '../../../core/model/dto/replay-dto';
import { DuelResult } from '../../../core/enums/duel-result.enum';
import { AuthService } from '../../../services/auth.service';
import { AvatarComponent } from '../../../shared/avatar/avatar.component';
import { ReplayCardSkeletonComponent } from '../../../shared/skel';
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
    return this.realDeckName(r.metadata.deckNames[this.mySide(r)]);
  }
  opponentDeckName(r: ReplayDTO): string {
    return this.realDeckName(r.metadata.deckNames[this.opponentSide(r)]);
  }
  /** The duel-server falls back to the literal string `'Deck'` when a player
   *  has no named deck (see duel-server/src/server.ts:476). The hub-card
   *  doesn't want to render that placeholder — it would just clutter the
   *  meta line. Treat 'Deck' (case-insensitive) as "missing" and let the
   *  template's `@if` skip the row. */
  private realDeckName(raw: string | undefined | null): string {
    if (!raw) return '';
    return raw.trim().toLowerCase() === 'deck' ? '' : raw;
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

  /** Mockup §replay-action-btn--danger — "tap & gone" delete. The store
   *  performs the optimistic removal + auto-rollbacks on HTTP error (cf.
   *  `ReplayHubStore.deleteReplay`), so no confirm modal is needed. The
   *  spinner state via `deletingId` covers the brief network round-trip. */
  async deleteReplay(replay: ReplayDTO, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
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
