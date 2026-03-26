import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { DebugPanelEntry } from '../debug-log-formatter';

@Component({
  selector: 'app-debug-log-panel',
  templateUrl: './debug-log-panel.component.html',
  styleUrl: './debug-log-panel.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, TranslateModule],
})
export class DebugLogPanelComponent {
  readonly entries = input<DebugPanelEntry[]>([]);
  readonly open = input<boolean>(false);
  readonly replayMode = input(false);
  readonly activeIndex = input<number | null>(null);
  readonly computedUpTo = input<number>(Infinity);
  readonly closed = output<void>();
  readonly clearRequested = output<void>();
  readonly seekToEvent = output<number>();

  private readonly scrollContainer = viewChild<ElementRef>('scrollContainer');
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.scrollTimer !== null) clearTimeout(this.scrollTimer);
    });

    // Auto-scroll when new entries arrive and user is near bottom (PvP mode only)
    effect(() => {
      const len = this.entries().length;
      untracked(() => {
        if (this.replayMode() || len === 0) return;
        const el = this.scrollContainer()?.nativeElement;
        if (!el) return;
        const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
        if (isNearBottom) {
          this.scheduleScrollToBottom(el);
        }
      });
    });

    // Auto-scroll to bottom when panel opens with existing entries (PvP mode only)
    effect(() => {
      const isOpen = this.open();
      untracked(() => {
        if (this.replayMode()) return;
        if (!isOpen) return;
        if (this.entries().length === 0) return;
        const el = this.scrollContainer()?.nativeElement;
        if (!el) return;
        this.scheduleScrollToBottom(el);
      });
    });

    // Auto-scroll to active entry when activeIndex changes (replay mode)
    effect(() => {
      const idx = this.activeIndex();
      untracked(() => {
        if (!this.replayMode() || idx === null) return;
        this.scheduleScrollToActive();
      });
    });
  }

  onEntryClick(entry: { eventIndex?: number }): void {
    if (!this.replayMode()) return;
    const idx = entry.eventIndex;
    if (idx === undefined || idx > this.computedUpTo()) return;
    this.seekToEvent.emit(idx);
  }

  private scheduleScrollToActive(): void {
    if (this.scrollTimer !== null) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      const container = this.scrollContainer()?.nativeElement;
      if (!container) return;
      const activeEl = container.querySelector('.debug-panel__entry--active') as HTMLElement | null;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      activeEl?.scrollIntoView({ block: 'nearest', behavior });
      this.scrollTimer = null;
    });
  }

  private scheduleScrollToBottom(el: HTMLElement): void {
    if (this.scrollTimer !== null) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
      this.scrollTimer = null;
    });
  }

  downloadLogs(): void {
    const entries = this.entries();
    if (entries.length === 0) return;
    const replay = this.replayMode();
    const lines = entries.map(e => {
      const prefix = replay ? `#${e.eventIndex ?? '?'}`.padEnd(8) : this.formatTime(e.timestamp);
      const cat = `[${e.category}]`.padEnd(10);
      return `${prefix} ${cat} ${e.text}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duel-debug-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // SECURITY: HTML-escape ALL user content BEFORE injecting <span> markup.
  // Order matters: escape first, then inject trusted tags.
  highlightPlayers(text: string): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
      .replace(/\bP1\b/g, '<span class="dbg-p1">P1</span>')
      .replace(/\bP2\b/g, '<span class="dbg-p2">P2</span>');
  }

  formatTime(timestamp: number | undefined): string {
    if (timestamp === undefined) return '';
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }
}
