// =============================================================================
// game-log-panel.component.ts — Surface 1 of the Game Log feature.
// -----------------------------------------------------------------------------
// The full-height side-band journal. It consumes `DuelGameLogService.
// gameLogEntries` (the accumulated, append-only `GameLogEntry[]`) and renders
// the five-block grammar (analysis §4.2).
//
// This component RE-EXPRESSES the render logic of the dev artefact
// `duel-server/src/game-log/game-log-html.ts` as an Angular template — it does
// NOT import it (that file is a raw-HTML-string emitter; analysis §1.1). The
// chain-grouping pass `renderStream` performs (fold `chain-start … chain-end`
// into one `.lg-chaingroup` block) is reproduced here as a `computed` that
// turns the flat entry list into a `RenderNode[]` tree the template walks.
//
// Token sourcing — the SCSS port (game-log-panel.component.scss) applies the
// three-bucket sort (analysis §5.1). i18n — the builder emits stable keys
// (`gameLog.*`, O9); the template translates them through `TranslatePipe`. The
// `gameLog.*` entries land in `fr.json` / `en.json` at Lot 6c — until then,
// ngx-translate echoes the key (loud fallback, never silent).
// =============================================================================

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DuelGameLogService } from '../duel-game-log.service';
import { DuelCardArtService } from '../duel-card-art.service';
import { AvatarComponent } from '../../../../shared/avatar/avatar.component';
import { IconButtonComponent } from '../../../../components/icon-button/icon-button.component';
import { PillComponent } from '../../../../components/pill/pill.component';
import { setupClickOutsideListener } from '../click-outside.utils';
import type {
  GameLogEntry,
  LogCardRef,
  MovedCard,
  RelPlayer,
  SeparatorEntry,
} from '../../game-log/game-log-types';

/** Exit-transition budget — kept in sync with `.gamelog--closing` in the SCSS.
 *  Mirrors the 150ms used by `pvp-zone-browser-overlay`. */
const CLOSE_TRANSITION_MS = 150;

/** "Already scrolled to the bottom?" tolerance, in px. `scrollTop +
 *  clientHeight` rarely equals `scrollHeight` exactly — sub-pixel layout and
 *  fractional scroll positions leave a few px of slack. Without this margin
 *  the auto-scroll wrongly reads "scrolled up" while the user is visually at
 *  the bottom, and shows the "new entries" pill when it should not. */
const SCROLL_BOTTOM_TOLERANCE_PX = 24;

/**
 * A node of the render tree the template walks. The flat `GameLogEntry[]` is
 * pre-processed into this so the template can `@switch` on `node.kind` —
 * `'chain'` carries a folded chain group (analysis D-B: a chain is ONE block),
 * `'entry'` is a standalone entry.
 */
type RenderNode =
  | { kind: 'entry'; entry: GameLogEntry }
  | { kind: 'chain'; linkCount: number; rows: ChainRow[] };

/** One row inside a folded chain group — an entry plus its resolution flag. */
interface ChainRow {
  entry: GameLogEntry;
  /** The `chain-resolve` sub-marker — `true` means "render the divider here". */
  resolveMarker: boolean;
  /** The row sits after `chain-resolve` — drives the description echo (D-C). */
  isResolution: boolean;
}

/** A single mini-board cell descriptor — drives the field-grid render. */
interface BoardGridCell {
  emz: boolean;
  spellTrap: boolean;
  target: boolean;
}

/**
 * Surface 1 — the game-log panel. Standalone, `OnPush`. Mounted in both the
 * duel page and the replay page; the `open` gate decides whether it renders
 * any DOM (R5 — the builder runs regardless, the panel is DOM only when open).
 */
@Component({
  selector: 'app-game-log-panel',
  templateUrl: './game-log-panel.component.html',
  styleUrl: './game-log-panel.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    MatIcon,
    TranslatePipe,
    AvatarComponent,
    IconButtonComponent,
    PillComponent,
  ],
})
export class GameLogPanelComponent {
  private readonly gameLog = inject(DuelGameLogService);
  private readonly cardArt = inject(DuelCardArtService);
  private readonly hostEl = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /**
   * Open gate (R5). Driven by `DuelGameLogService.panelOpen` — the trigger
   * button (Lot 4f) toggles the service signal, the panel renders DOM only
   * while it is `true`.
   */
  readonly open = this.gameLog.panelOpen;

  /** True while the exit transition plays — drives `.gamelog--closing`. */
  readonly isClosing = this.gameLog.panelClosing;

  /** Player pseudos in relative order `[you, opp]` — drives the turn-header
   *  avatars. PROVISIONAL default for Lot 4b; the page feeds the real pair
   *  alongside the trigger wiring (Lot 4f). */
  readonly playerNames = input<[string, string]>(['Toi', 'Adversaire']);

  /** Emitted when a journal row carrying a `cardCode` is clicked — the page
   *  opens the card-inspector (Lot 4e, `inspectCard` pattern from
   *  `pvp-zone-browser-overlay`). */
  readonly inspectCard = output<number>();

  /** The accumulated journal feed. */
  readonly entries = this.gameLog.gameLogEntries;

  /** The scroll viewport — measured for the G3 auto-scroll bottom check. */
  private readonly scrollEl =
    viewChild<ElementRef<HTMLElement>>('scrollBox');

  /** True when there are unseen entries below the fold — drives the
   *  "↓ nouvelles entrées" pill (G3). */
  readonly hasNewEntries = signal(false);

  /**
   * Whether the viewport was scrolled to the bottom BEFORE the latest entry
   * was appended (Bug 5). The G3 auto-scroll must decide "follow vs raise the
   * pill" from the bottom-state as it was *before* the new row grew the
   * scroll height — checking `isAtBottom()` after the re-render always reads
   * "not at bottom" (the new row pushed the content past the fold). Kept
   * fresh by `onScroll()` (every user scroll) and `scrollToBottom()`; seeded
   * `true` (an empty viewport counts as "at bottom" — follow the first row).
   */
  private wasAtBottom = true;

  /** Document-level click-outside teardown — re-armed each time the panel
   *  re-opens (the listener is torn down on close). */
  private removeOutsideListener: (() => void) | null = null;

  /** Pending DOM-teardown timer for the timed close. */
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
      this.removeOutsideListener?.();
    });

    // Arm / disarm the click-outside listener with the open gate. The
    // listener is created only while the panel is open; closing tears it
    // down so a click on the (now-absent) panel cannot leak.
    effect(() => {
      const open = this.open();
      untracked(() => {
        if (open && !this.removeOutsideListener) {
          this.removeOutsideListener = setupClickOutsideListener(
            this.hostEl,
            this.destroyRef,
            () => this.requestClose(),
          );
        } else if (!open) {
          this.removeOutsideListener?.();
          this.removeOutsideListener = null;
        }
      });
    });

    // Bug 5 — opening the panel jumps the viewport to the bottom. The
    // journal is a history; on open the user wants the latest entry, not
    // the top. The scroll runs in `afterNextRender` so the `@if(open())`
    // DOM is painted first. `scrollToBottom()` also seeds `wasAtBottom`.
    effect(() => {
      if (!this.open()) return;
      untracked(() =>
        afterNextRender(() => this.scrollToBottom(), { injector: this.injector }),
      );
    });

    // Bug 5 — a wholesale rebuild (replay seek, `journalRebuiltTick`) jumps
    // the viewport to the bottom: a seek lands the user on step N, and
    // step N's entry is the bottom of the rebuilt history. Distinct from
    // an incremental append (handled by the G3 follow-the-bottom effect).
    //
    // `wasAtBottom` is forced true SYNCHRONOUSLY here: a rebuild also fires
    // the `entries()` effect below (same `_entries.set`), and this effect
    // is declared first — so the G3 effect then sees `wasAtBottom === true`
    // and defers to the scroll instead of flashing the "new entries" pill.
    effect(() => {
      this.gameLog.journalRebuiltTick();
      untracked(() => {
        if (!this.open()) return;
        this.wasAtBottom = true;
        afterNextRender(() => this.scrollToBottom(), { injector: this.injector });
      });
    });

    // G3 auto-scroll. A new entry appends at the bottom (oldest-at-top order).
    // If the user was already at the bottom, follow it; if they scrolled up to
    // read history, do NOT hijack — raise the "new entries" pill instead.
    //
    // Bug 5: TWO timing traps, both fixed here.
    //  · The decision reads `wasAtBottom` — the bottom-state captured BEFORE
    //    this entry grew the scroll height. A live `isAtBottom()` checked
    //    here would always read "not at bottom" (the new row already pushed
    //    the content past the fold).
    //  · The actual scroll is deferred to `afterNextRender`: an `effect`
    //    can run BEFORE the `@for` paints the new row, so a synchronous
    //    `scrollToBottom()` would scroll to the OLD `scrollHeight` and leave
    //    the new row below the fold. `afterNextRender` runs post-paint, when
    //    `scrollHeight` includes the new row.
    effect(() => {
      const count = this.entries().length;
      untracked(() => {
        if (count === 0 || !this.open()) return;
        if (this.wasAtBottom) {
          afterNextRender(() => this.scrollToBottom(), { injector: this.injector });
        } else {
          this.hasNewEntries.set(true);
        }
      });
    });
  }

  /**
   * The render tree — the flat entry list folded into `RenderNode[]`, with
   * each `chain-start … chain-end` span collapsed into one `'chain'` node.
   * Mirrors `game-log-html.ts:renderStream` + `chainGroupEnd` +
   * `renderChainGroup`.
   */
  readonly renderNodes = computed<RenderNode[]>(() =>
    this.buildRenderTree(this.entries()),
  );

  // ---------------------------------------------------------------------------
  // Panel chrome — close (✕ / click-outside / Escape) + timed teardown
  // ---------------------------------------------------------------------------

  /** Begin the timed close: play the exit transition, then tear the DOM down.
   *  Reuses the `isClosing` + delayed-close pattern from
   *  `pvp-zone-browser-overlay`. Idempotent — a second call while closing is
   *  a no-op. */
  requestClose(): void {
    if (!this.open() || this.isClosing()) return;
    this.gameLog.beginPanelClose();
    this.closeTimeout = setTimeout(() => {
      this.closeTimeout = null;
      this.gameLog.finishPanelClose();
    }, CLOSE_TRANSITION_MS);
  }

  /** Escape closes the panel — mirrors `pvp-zone-browser-overlay.onKeydown`. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.requestClose();
      event.preventDefault();
    }
  }

  // ---------------------------------------------------------------------------
  // G3 auto-scroll — bottom detection + scroll affordance
  // ---------------------------------------------------------------------------

  /** True when the viewport is scrolled to (within tolerance of) the bottom.
   *  An exact `scrollTop + clientHeight === scrollHeight` check is unreliable
   *  — see `SCROLL_BOTTOM_TOLERANCE_PX`. */
  private isAtBottom(): boolean {
    const el = this.scrollEl()?.nativeElement;
    if (!el) return true; // no viewport yet → treat as bottom (don't nag)
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= SCROLL_BOTTOM_TOLERANCE_PX;
  }

  /** Scroll the viewport to the newest entry and clear the pill. The panel is
   *  now at the bottom — record it so a burst of follow-up entries keeps
   *  auto-scrolling (Bug 5). */
  scrollToBottom(): void {
    const el = this.scrollEl()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
    this.wasAtBottom = true;
    this.hasNewEntries.set(false);
  }

  /** Scroll handler — tracks `wasAtBottom` on every user scroll so the G3
   *  auto-scroll has the correct pre-render bottom-state (Bug 5), and clears
   *  the "new entries" pill once the user reaches the bottom on their own. */
  onScroll(): void {
    this.wasAtBottom = this.isAtBottom();
    if (this.hasNewEntries() && this.wasAtBottom) {
      this.hasNewEntries.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Row interaction — click-to-inspect (Lot 4e)
  // ---------------------------------------------------------------------------

  /** A row carrying a `cardCode` opens the card-inspector. The source card is
   *  the natural inspection target (a row is "about" its acting card); a
   *  source-less bare row has no card to inspect. */
  onRowClick(entry: GameLogEntry): void {
    if (entry.block === 'separator') return;
    const code = entry.source?.cardCode;
    if (code != null) this.inspectCard.emit(code);
  }

  // ---------------------------------------------------------------------------
  // Render-tree construction — the chain-grouping pass
  // ---------------------------------------------------------------------------

  /** Fold the flat entry list into render nodes (chains → one grouped node). */
  private buildRenderTree(entries: GameLogEntry[]): RenderNode[] {
    const out: RenderNode[] = [];
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i];
      if (entry.block === 'separator' && entry.kind === 'chain-start') {
        const end = this.chainGroupEnd(entries, i);
        out.push(this.buildChainNode(entries.slice(i + 1, end)));
        i = end < entries.length ? end + 1 : end;
        continue;
      }
      out.push({ kind: 'entry', entry });
      i++;
    }
    return out;
  }

  /** Index of the `chain-end` (or `turn`) separator closing the chain opened
   *  at `start`, or `entries.length` for an unclosed chain. */
  private chainGroupEnd(entries: GameLogEntry[], start: number): number {
    for (let j = start + 1; j < entries.length; j++) {
      const e = entries[j];
      if (e.block === 'separator' && (e.kind === 'chain-end' || e.kind === 'turn')) {
        return j;
      }
    }
    return entries.length;
  }

  /** Build one folded chain node from the entries between the delimiters. */
  private buildChainNode(inner: GameLogEntry[]): RenderNode {
    // Link count = distinct chainLink values across the ACTIVATION rows (those
    // before the `chain-resolve` marker — resolution rows reuse the values).
    const links = new Set<number>();
    let seenResolve = false;
    for (const e of inner) {
      if (e.block === 'separator' && e.kind === 'chain-resolve') seenResolve = true;
      if (!seenResolve && e.block === 'move' && e.chainLink) links.add(e.chainLink);
    }

    const rows: ChainRow[] = [];
    let resolution = false;
    for (const e of inner) {
      if (e.block === 'separator' && e.kind === 'chain-resolve') {
        resolution = true;
        rows.push({ entry: e, resolveMarker: true, isResolution: false });
        continue;
      }
      rows.push({ entry: e, resolveMarker: false, isResolution: resolution });
    }
    return { kind: 'chain', linkCount: links.size, rows };
  }

  // ---------------------------------------------------------------------------
  // Entry-shape narrowing helpers (the template `@switch`es on these)
  // ---------------------------------------------------------------------------

  /** A move row is BARE when it has no source and is a standalone system move
   *  (not the initial-hand / draw-phase variants, which render dedicated). */
  isBareRow(e: GameLogEntry): boolean {
    return (
      e.block === 'move' &&
      !e.source &&
      e.variant !== 'initial-hand' &&
      e.variant !== 'draw-phase'
    );
  }

  /** True when a moved card and the row source are the same revealed card —
   *  the moved-card name header is then suppressed (the source head carries
   *  it). A hidden card never matches (no identity). */
  isSameCard(moved: LogCardRef, source: LogCardRef | null | undefined): boolean {
    return (
      source != null &&
      moved.revealed &&
      source.revealed &&
      moved.cardCode != null &&
      moved.cardCode === source.cardCode
    );
  }

  // ---------------------------------------------------------------------------
  // Card / zone rendering helpers
  // ---------------------------------------------------------------------------

  /** The display name of a card ref — a real name, or a `#code` fallback. */
  cardName(ref: LogCardRef): string {
    return ref.cardName ?? (ref.cardCode != null ? `#${ref.cardCode}` : 'Carte');
  }

  /** First two words of a card name — fits the small thumbnail box. */
  shortName(ref: LogCardRef): string {
    const name = ref.cardName ?? (ref.cardCode != null ? `#${ref.cardCode}` : 'carte');
    return name.split(/\s+/).slice(0, 2).join(' ');
  }

  /** Artwork URL for a revealed card, or `null` to fall back to the text
   *  placeholder thumbnail. */
  artUrl(ref: LogCardRef): string | null {
    if (!ref.revealed || ref.cardCode == null) return null;
    return this.cardArt.resolveUrl(ref.cardCode);
  }

  /** RNG icon — coin vs dice. */
  rngIcon(rng: 'coin' | 'dice'): string {
    return rng === 'coin' ? 'toll' : 'casino';
  }

  /** The ATK/DEF class for a combat stat string (`''` keeps the neutral
   *  damage style — a non-ATK/DEF outcome like "détruit"). */
  statClass(stat: string | undefined): 'atk' | 'def' | 'dmg' {
    const t = (stat ?? '').trim();
    if (/^ATK\b/i.test(t)) return 'atk';
    if (/^DEF\b/i.test(t)) return 'def';
    return 'dmg';
  }

  /** The combat stat string to show for a side — `stat` then `outcome`. */
  statText(side: { stat?: string; outcome?: string }): string {
    return side.stat ?? side.outcome ?? '';
  }

  // ---------------------------------------------------------------------------
  // Mini-board grid — reproduces `game-log-html.ts:renderMiniBoard`
  // ---------------------------------------------------------------------------

  /** Grid columns that hold a shared Extra Monster Zone cell. */
  private static readonly EMZ_COLUMNS: readonly number[] = [1, 3];

  /** Build one M or S row of the mini-board for a given relative player. */
  boardRow(
    cell: MovedCard['destCell'],
    rel: RelPlayer,
    kind: 'M' | 'S',
  ): BoardGridCell[] {
    const cells: BoardGridCell[] = [];
    for (let seq = 0; seq < 5; seq++) {
      const target =
        cell != null &&
        cell.player === rel &&
        cell.row === kind &&
        cell.sequence === seq;
      cells.push({ emz: false, spellTrap: kind === 'S', target });
    }
    return cells;
  }

  /** Build the shared EMZ band — 5 columns, EMZ cells at columns 1 and 3,
   *  spacers elsewhere (mirrors a real board's layout). */
  boardEmz(cell: MovedCard['destCell']): BoardGridCell[] {
    const cells: BoardGridCell[] = [];
    for (let col = 0; col < 5; col++) {
      const emzSlot = GameLogPanelComponent.EMZ_COLUMNS.indexOf(col);
      if (emzSlot < 0) {
        cells.push({ emz: false, spellTrap: false, target: false });
        continue;
      }
      const target =
        cell != null && cell.row === 'EMZ' && cell.sequence === emzSlot;
      cells.push({ emz: true, spellTrap: false, target });
    }
    return cells;
  }

  /** True when the field-spell cell is the move's destination. */
  isFieldTarget(cell: MovedCard['destCell']): boolean {
    return cell != null && cell.row === 'FIELD';
  }

  /** The chrome class for a separator entry — narrows `kind` for the template. */
  separatorKind(e: SeparatorEntry): SeparatorEntry['kind'] {
    return e.kind;
  }

  /** Turn-separator LP pair `[you, opp]` with a zero fallback. */
  turnLp(e: SeparatorEntry): [number, number] {
    return e.lp ?? [0, 0];
  }
}
