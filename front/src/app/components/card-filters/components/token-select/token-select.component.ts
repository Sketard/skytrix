import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormArray, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, Subscription } from 'rxjs';
import { startWith } from 'rxjs/operators';
import { IconedAutocompleteOption } from '../../../../core/model/commons/short-resource';
import { formattedWithoutCaseAndAccent } from '../../../../core/utilities/functions';
import { SearchServiceCore } from '../../../../services/search-service-core.service';

const DEFAULT_MAX_VISIBLE_CHIPS = 2;

@Component({
  selector: 'app-token-select',
  templateUrl: './token-select.component.html',
  styleUrl: './token-select.component.scss',
  standalone: true,
  imports: [MatIcon, TranslatePipe, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenSelectComponent<T> implements OnInit, OnDestroy {
  readonly form = input.required<FormArray<FormControl<T>>>();
  readonly options$ = input.required<Observable<Array<IconedAutocompleteOption<T>>>>();
  readonly inputLabel = input<string>('');
  readonly placeholder = input<string>('cardFilters.tokenSelect.placeholder');
  readonly searchPlaceholder = input<string>('cardFilters.tokenSelect.searchPlaceholder');
  readonly maxVisibleChips = input<number>(DEFAULT_MAX_VISIBLE_CHIPS);
  readonly searchService = input<SearchServiceCore | undefined>(undefined);

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('trigger') triggerRef?: ElementRef<HTMLButtonElement>;

  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly translate = inject(TranslateService);

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  private readonly _options = signal<Array<IconedAutocompleteOption<T>>>([]);
  private readonly _selectedIds = signal<ReadonlyArray<T>>([]);

  readonly searchControl = new FormControl<string>('', { nonNullable: true });
  private readonly _searchTerm = signal<string>('');

  private readonly _focusedIndex = signal<number>(-1);
  readonly focusedIndex = this._focusedIndex.asReadonly();

  private readonly _sortedOptions = computed<Array<IconedAutocompleteOption<T>>>(() => {
    const opts = [...this._options()];
    return opts.sort((a, b) =>
      this.translate.instant(a.name).localeCompare(this.translate.instant(b.name))
    );
  });

  readonly selectedOptions = computed<Array<IconedAutocompleteOption<T>>>(() => {
    const ids = this._selectedIds();
    const sorted = this._sortedOptions();
    return ids
      .map(id => sorted.find(opt => opt.id === id))
      .filter((opt): opt is IconedAutocompleteOption<T> => opt != null);
  });

  readonly visibleChips = computed<Array<IconedAutocompleteOption<T>>>(() =>
    this.selectedOptions().slice(0, this.maxVisibleChips())
  );

  readonly overflowCount = computed<number>(() =>
    Math.max(0, this.selectedOptions().length - this.maxVisibleChips())
  );

  readonly filteredOptions = computed<Array<IconedAutocompleteOption<T>>>(() => {
    const term = this._searchTerm();
    const sorted = this._sortedOptions();
    if (!term) return sorted;
    const needle = formattedWithoutCaseAndAccent(term);
    return sorted.filter(opt =>
      formattedWithoutCaseAndAccent(this.translate.instant(opt.name)).includes(needle)
    );
  });

  private optionsSub?: Subscription;
  private formSub?: Subscription;
  private searchSub?: Subscription;
  private clearSub?: Subscription;

  constructor() {
    effect(() => {
      // Reset focus + search whenever panel closes
      if (!this._isOpen()) {
        this._focusedIndex.set(-1);
        if (this.searchControl.value) {
          this.searchControl.setValue('', { emitEvent: false });
          this._searchTerm.set('');
        }
      }
    });
  }

  ngOnInit(): void {
    this.optionsSub = this.options$().subscribe(opts => this._options.set(opts));
    const formArray = this.form();
    this.formSub = formArray.valueChanges
      .pipe(startWith(formArray.value))
      .subscribe(ids => this._selectedIds.set([...ids]));
    this.searchSub = this.searchControl.valueChanges.subscribe(v => this._searchTerm.set(v ?? ''));
    const svc = this.searchService();
    if (svc) {
      this.clearSub = svc.filtersCleared$.subscribe(() => this.clearAll());
    }
  }

  ngOnDestroy(): void {
    this.optionsSub?.unsubscribe();
    this.formSub?.unsubscribe();
    this.searchSub?.unsubscribe();
    this.clearSub?.unsubscribe();
  }

  open(): void {
    this._isOpen.set(true);
    setTimeout(() => this.searchInputRef?.nativeElement.focus(), 0);
  }

  toggle(): void {
    if (this._isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  close(): void {
    this._isOpen.set(false);
  }

  isSelected(opt: IconedAutocompleteOption<T>): boolean {
    return this._selectedIds().includes(opt.id);
  }

  toggleSelection(opt: IconedAutocompleteOption<T>): void {
    if (this.isSelected(opt)) {
      this.removeOption(opt);
    } else {
      this.addOption(opt);
    }
  }

  deselect(opt: IconedAutocompleteOption<T>, event: MouseEvent): void {
    event.stopPropagation();
    this.removeOption(opt);
  }

  clearAll(): void {
    while (this.form().length > 0) {
      this.form().removeAt(0, { emitEvent: false });
    }
    this.form().updateValueAndValidity();
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle();
    } else if (event.key === 'Escape' && this._isOpen()) {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown' && !this._isOpen()) {
      event.preventDefault();
      this.open();
    }
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      this.triggerRef?.nativeElement.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveFocus(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const idx = this._focusedIndex();
      const opts = this.filteredOptions();
      if (idx >= 0 && idx < opts.length) {
        this.toggleSelection(opts[idx]);
      }
    } else if (event.key === 'Tab') {
      this.close();
    }
  }

  private moveFocus(delta: number): void {
    const len = this.filteredOptions().length;
    if (len === 0) {
      this._focusedIndex.set(-1);
      return;
    }
    const current = this._focusedIndex();
    const next = current < 0 ? (delta > 0 ? 0 : len - 1) : (current + delta + len) % len;
    this._focusedIndex.set(next);
  }

  private addOption(opt: IconedAutocompleteOption<T>): void {
    this.form().push(new FormControl<T>(opt.id, { nonNullable: true }));
  }

  private removeOption(opt: IconedAutocompleteOption<T>): void {
    const idx = this.form().value.findIndex(id => id === opt.id);
    if (idx >= 0) this.form().removeAt(idx);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this._isOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.hostRef.nativeElement.contains(target)) {
      this.close();
    }
  }
}
