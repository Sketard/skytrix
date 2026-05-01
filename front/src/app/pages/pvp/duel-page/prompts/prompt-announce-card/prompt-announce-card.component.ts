import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { debounceTime, switchMap, takeUntil } from 'rxjs/operators';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { AnnounceCardMsg } from '../../../duel-ws.types';
import { TranslatePipe } from '@ngx-translate/core';
import { DuelCardArtService } from '../../duel-card-art.service';

interface CardNameEntry {
  code: number;
  name: string;
}

@Component({
  selector: 'app-prompt-announce-card',
  templateUrl: './prompt-announce-card.component.html',
  styleUrl: './prompt-announce-card.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class PromptAnnounceCardComponent implements PromptSubComponent<AnnounceCardMsg>, OnInit {
  promptData: AnnounceCardMsg | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  @HostBinding('class.read-only') readOnly = false;
  preSelectedResponse: unknown = undefined;
  answered = false;

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly artService = inject(DuelCardArtService);
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  readonly getCardImageUrl = (code: number | null) => this.artService.resolveUrl(code);
  readonly results = signal<CardNameEntry[]>([]);
  readonly selectedEntry = signal<CardNameEntry | null>(null);
  readonly highlightedIndex = signal(-1);
  readonly isSearching = signal(false);

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
    });

    if (this.readOnly && this.preSelectedResponse != null) {
      const r = this.preSelectedResponse as { value: number };
      this.selectedEntry.set({ code: r.value, name: '' });
      this.answered = true;
      return;
    }

    this.searchSubject.pipe(
      debounceTime(300),
      switchMap(query => {
        if (query.length < 2) {
          this.results.set([]);
          this.isSearching.set(false);
          return [];
        }
        this.isSearching.set(true);
        return this.http.get<CardNameEntry[]>(`/api/cards/names?q=${encodeURIComponent(query)}`);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: entries => {
        this.results.set(entries);
        this.highlightedIndex.set(-1);
        this.isSearching.set(false);
      },
      error: () => this.isSearching.set(false),
    });
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.selectedEntry.set(null);
    this.searchSubject.next(value);
  }

  selectEntry(entry: CardNameEntry): void {
    if (this.answered) return;
    this.selectedEntry.set(entry);
  }

  confirm(): void {
    const entry = this.selectedEntry();
    if (this.answered || !entry) return;
    this.answered = true;
    this.response.emit({ value: entry.code });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.readOnly) return;
    const isInputFocused = (event.target as HTMLElement).tagName === 'INPUT';
    const list = this.results();

    if (event.key === 'ArrowDown' && !isInputFocused) {
      event.preventDefault();
      this.highlightedIndex.update(i => Math.min(i + 1, list.length - 1));
      const entry = list[this.highlightedIndex()];
      if (entry) this.selectedEntry.set(entry);
    } else if (event.key === 'ArrowUp' && !isInputFocused) {
      event.preventDefault();
      this.highlightedIndex.update(i => Math.max(i - 1, 0));
      const entry = list[this.highlightedIndex()];
      if (entry) this.selectedEntry.set(entry);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.confirm();
    }
  }
}
