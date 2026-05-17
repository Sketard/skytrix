import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormArray, FormControl } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Observable, Subscription } from 'rxjs';
import { startWith } from 'rxjs/operators';
import { IconedAutocompleteOption } from '../../../../core/model/commons/short-resource';

@Component({
  selector: 'app-token-select',
  templateUrl: './token-select.component.html',
  styleUrl: './token-select.component.scss',
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenSelectComponent<T> {
  readonly form = input.required<FormArray<FormControl<T>>>();
  readonly options$ = input.required<Observable<Array<IconedAutocompleteOption<T>>>>();
  readonly inputLabel = input.required<string>();
  readonly placeholder = input<string>('cardFilters.tokenSelect.placeholder');

  private readonly hostRef = inject(ElementRef<HTMLElement>);

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  private readonly _options = signal<Array<IconedAutocompleteOption<T>>>([]);
  private readonly _selectedIds = signal<ReadonlyArray<T>>([]);

  readonly selectedOptions = computed<Array<IconedAutocompleteOption<T>>>(() => {
    const ids = this._selectedIds();
    const options = this._options();
    return ids
      .map(id => options.find(opt => opt.id === id))
      .filter((opt): opt is IconedAutocompleteOption<T> => opt != null);
  });

  readonly displayedOptions = computed<Array<IconedAutocompleteOption<T>>>(() => this._options());

  private optionsSub?: Subscription;
  private formSub?: Subscription;

  constructor() {
    queueMicrotask(() => {
      this.optionsSub = this.options$().subscribe(opts => this._options.set(opts));
      const formArray = this.form();
      this.formSub = formArray.valueChanges
        .pipe(startWith(formArray.value))
        .subscribe(ids => this._selectedIds.set([...ids]));
    });
  }

  ngOnDestroy(): void {
    this.optionsSub?.unsubscribe();
    this.formSub?.unsubscribe();
  }

  toggle(): void {
    this._isOpen.update(open => !open);
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
