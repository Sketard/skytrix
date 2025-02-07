// === Import: NPM
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import { BehaviorSubject, combineLatest, Observable, of, Subject } from 'rxjs';
import { map, startWith, takeUntil } from 'rxjs/operators';
import { MatFormField, MatInput, MatLabel } from '@angular/material/input';
import { IsFormControlRequiredPipe } from '../../../../core/pipes/is-form-required.pipe';
import { NgForOf } from '@angular/common';
import { ShortResource } from '../../../../core/model/commons/short-resource';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { formattedWithoutCaseAndAccent } from '../../../../core/utilities/functions';

type AllowedFormValue = number | string | null;

@Component({
  selector: 'app-autocomplete-filter',
  templateUrl: './autocomplete-filter.component.html',
  styleUrls: ['./autocomplete-filter.component.scss'],
  encapsulation: ViewEncapsulation.None,
  imports: [
    MatInput,
    MatFormField,
    MatAutocomplete,
    MatOption,
    MatAutocompleteTrigger,
    ReactiveFormsModule,
    IsFormControlRequiredPipe,
    NgForOf,
    MatLabel,
    TranslatePipe,
  ],
  standalone: true,
})
export class AutocompleteFilterComponent implements OnDestroy, OnChanges, OnInit {
  @Input() options$: Observable<Array<ShortResource>> = of([]);
  @Input() form: FormControl<AllowedFormValue> = new FormControl(null);
  @Input() inputLabel: string = '';
  @Input() disabled: boolean = false;
  @Input() alphabeticalOrder: boolean = true;
  @Input() required: boolean = false;

  @Output() specificSelectionBehaviour = new EventEmitter<ShortResource | null>();

  public filteredOptions: Array<ShortResource> = [];
  public defaultOptionIds: Array<number | string> = [];

  private readonly unsubscribe$ = new Subject<void>();

  private readonly explicitedSelectedOptionSubject = new BehaviorSubject<ShortResource | null>(null);

  public inputDisplay = new FormControl<ShortResource | string | null>(null, this.customValidator.bind(this));

  @ViewChild(MatAutocompleteTrigger) autoTrigger!: MatAutocompleteTrigger;

  constructor(private readonly translateService: TranslateService) {}

  ngOnInit(): void {
    this.initFilterListener();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['form'] && !changes['form'].firstChange) {
      this.initFilterListener();
    }
    if (changes['disabled']) {
      if (changes['disabled'].currentValue && this.inputDisplay.enabled) {
        this.inputDisplay.disable();
      } else if (!changes['disabled'].currentValue && this.inputDisplay.disabled) {
        this.inputDisplay.enable();
      }
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  private initFilterListener(): void {
    this.inputDisplay.setValue(null);
    combineLatest([this.form.valueChanges.pipe(startWith(this.form.value)), this.options$])
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe(([form, options]) => {
        this.handleDefaultOptions(form);
        this.handleDisableInput();
        this.sync(form, options);
      });

    combineLatest([
      this.options$.pipe(takeUntil(this.unsubscribe$)),
      this.inputDisplay.valueChanges.pipe(takeUntil(this.unsubscribe$), startWith(this.inputDisplay.value)),
    ])
      .pipe(
        map(([options, value]: [Array<ShortResource>, ShortResource | string | null]) => {
          let name;
          if (typeof value !== 'string') {
            name = this.getOptionName(value);
          } else {
            name = value;
          }

          const formattedValue = formattedWithoutCaseAndAccent(name);
          const optionToAdd =
            !this.form.value &&
            options.find(
              (option: ShortResource) => formattedWithoutCaseAndAccent(this.getOptionName(option)) === formattedValue
            );

          if (optionToAdd) {
            this.inputDisplay.setValue(optionToAdd, { emitEvent: false });
            this.updateForm(optionToAdd);
            setTimeout(() => {
              this.autoTrigger.closePanel();
              return options;
            }, 0);
          }

          const currentOptionIsValid = options.some((option: ShortResource) => {
            return option.id === this.form.value || this.getOptionName(option) === this.form.value;
          });
          return this.filterOptions(options, currentOptionIsValid, formattedValue);
        })
      )
      .subscribe((filteredOptions: Array<ShortResource>) => {
        this.filteredOptions = filteredOptions;
      });
  }

  private handleDefaultOptions(value: AllowedFormValue): void {
    if (value && !this.defaultOptionIds.includes(value)) {
      this.defaultOptionIds.push(value);
    }
  }

  private handleDisableInput(): void {
    if (this.form.disabled && !this.inputDisplay.disabled) {
      this.inputDisplay.disable({ emitEvent: false });
    } else if (!this.form.disabled && this.inputDisplay.disabled && !this.disabled) {
      this.inputDisplay.enable({ emitEvent: false });
    }
  }

  private sync(form: AllowedFormValue, options: Array<ShortResource>): void {
    const explicitedId = this.explicitedSelectedOptionSubject.value?.id;

    if (form != explicitedId) {
      const optionToSync = options.find((option: ShortResource) => option.id === form) || null;

      setTimeout(() => {
        this.explicitedSelectedOptionSubject.next(optionToSync);
        this.inputDisplay.setValue(optionToSync);
        if (!optionToSync) {
          this.inputDisplay.setErrors(null);
        }
      }, 0);
    }
  }

  private filterOptions(
    options: Array<ShortResource>,
    currentValidIsValid: boolean,
    value: string
  ): Array<ShortResource> {
    return this.sortOptions(
      options.filter((option: ShortResource) => {
        return currentValidIsValid || this.valueMatchOption(option, value);
      })
    );
  }

  private valueMatchOption(option: ShortResource, value: string): boolean {
    const formattedValue = formattedWithoutCaseAndAccent(value);
    return formattedWithoutCaseAndAccent(this.translateService.instant(option.name)).indexOf(formattedValue) !== -1;
  }

  private sortOptions(options: Array<ShortResource>): Array<ShortResource> {
    return this.alphabeticalOrder
      ? options.sort((a: ShortResource, b: ShortResource) => {
          return this.getOptionName(a).localeCompare(this.getOptionName(b));
        })
      : options;
  }

  private getOptionName(option: ShortResource | null): string {
    return option && this.translateService.instant(option.name);
  }

  private updateForm(option: ShortResource | null): void {
    this.specificSelectionBehaviour.emit(option);
    setTimeout(() => {
      this.form.setValue(option?.id ?? null);
    }, 0);
  }

  public selectOption(option: MatAutocompleteSelectedEvent): void {
    const selectedOption = option.option.value;
    this.updateForm(selectedOption);
  }

  public unselectOption(): void {
    this.updateForm(null);
  }

  public handleSuppression($event: KeyboardEvent): void {
    const currentValue = ($event.target as HTMLTextAreaElement).value || '';
    if (this.getOptionName(this.explicitedSelectedOptionSubject.value) !== currentValue && this.form.value) {
      this.unselectOption();
    }
  }

  public displayFn = (option: ShortResource): string => {
    return this.getOptionName(option);
  };

  customValidator(control: AbstractControl): ValidationErrors {
    return !control.value || this.explicitedSelectedOptionSubject.value ? {} : { error: true };
  }

  public openPanel(): void {
    this.autoTrigger.openPanel();
  }
}
