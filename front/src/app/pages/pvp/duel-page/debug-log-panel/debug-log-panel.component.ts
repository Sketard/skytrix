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
import { DebugLogEntry } from '../debug-log-formatter';

@Component({
  selector: 'app-debug-log-panel',
  templateUrl: './debug-log-panel.component.html',
  styleUrl: './debug-log-panel.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon],
})
export class DebugLogPanelComponent {
  readonly entries = input<DebugLogEntry[]>([]);
  readonly open = input<boolean>(false);
  readonly closed = output<void>();
  readonly clearRequested = output<void>();

  private readonly scrollContainer = viewChild<ElementRef>('scrollContainer');
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.scrollTimer !== null) clearTimeout(this.scrollTimer);
    });

    // Auto-scroll when new entries arrive and user is near bottom
    effect(() => {
      const len = this.entries().length;
      untracked(() => {
        if (len === 0) return;
        const el = this.scrollContainer()?.nativeElement;
        if (!el) return;
        const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
        if (isNearBottom) {
          this.scheduleScrollToBottom(el);
        }
      });
    });

    // Auto-scroll to bottom when panel opens with existing entries
    effect(() => {
      const isOpen = this.open();
      untracked(() => {
        if (!isOpen) return;
        if (this.entries().length === 0) return;
        const el = this.scrollContainer()?.nativeElement;
        if (!el) return;
        this.scheduleScrollToBottom(el);
      });
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
    const lines = entries.map(e => {
      const time = this.formatTime(e.timestamp);
      const cat = `[${e.category}]`.padEnd(10);
      return `${time} ${cat} ${e.text}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duel-debug-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  highlightPlayers(text: string): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
      .replace(/\bP1\b/g, '<span class="dbg-p1">P1</span>')
      .replace(/\bP2\b/g, '<span class="dbg-p2">P2</span>');
  }

  formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }
}
