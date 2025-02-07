import { Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormArray, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocomplete, MatAutocompleteTrigger, MatOption } from '@angular/material/autocomplete';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, combineLatest, Observable, of, Subject } from 'rxjs';
import { map, startWith, takeUntil } from 'rxjs/operators';
import { formattedWithoutCaseAndAccent } from '../../../../core/utilities/functions';
import { IsFormControlRequiredPipe } from '../../../../core/pipes/is-form-required.pipe';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOptionSelectionChange } from '@angular/material/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { NgForOf } from '@angular/common';
import { MatInput } from '@angular/material/input';
import { AutocompleteOption } from '../../../../core/model/commons/short-resource';

@Component({
  selector: 'app-multiselect-autocomplete-filter',
  templateUrl: './multiselect-autocomplete-filter.component.html',
  styleUrls: ['./multiselect-autocomplete-filter.component.scss'],
  standalone: true,
  imports: [
    MatOption,
    TranslatePipe,
    IsFormControlRequiredPipe,
    ReactiveFormsModule,
    MatAutocompleteTrigger,
    MatLabel,
    MatFormField,
    MatAutocomplete,
    MatCheckbox,
    NgForOf,
    MatInput,
  ],
})
export class MultiselectAutocompleteFilterComponent<T> implements OnInit, OnDestroy {
  @Input() form: FormArray<FormControl<T>> = new FormArray<FormControl<T>>([]);
  @Input() options$: Observable<Array<AutocompleteOption<T>>> = of([]);
  @Input() inputLabel: string = '';

  public inputDisplay = new FormControl<string>('');
  public filteredOptions: Array<AutocompleteOption<T>> = [];
  private readonly unsubscribe$ = new Subject<void>();

  public defaultOptionIds: Array<T> = [];
  private previousInputValue = '';

  private readonly separator = ' / ';
  private readonly separatorRegex = this.separator.replace(' ', ' ?');

  public readonly explicitedSelectedOptionsSubject = new BehaviorSubject<Array<AutocompleteOption<T>>>([]);

  @ViewChild(MatAutocompleteTrigger) autoTrigger: MatAutocompleteTrigger | undefined;

  constructor(private readonly translateService: TranslateService) {}

  ngOnInit(): void {
    this.initFilterListener();
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  private initFilterListener(): void {
    combineLatest([this.form.valueChanges.pipe(startWith(this.form.value)), this.options$])
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe(([form, options]) => {
        this.handleDefaultOptions(form);
        this.handleDisableInput();
        this.sync(form, options);
      });

    combineLatest([this.inputDisplay.valueChanges.pipe(startWith(this.inputDisplay.value)), this.options$])
      .pipe(
        takeUntil(this.unsubscribe$),
        map(([value, options]) => {
          if (!value) {
            return this.sortOptions(options);
          }

          let name;
          if (Array.isArray(value)) {
            name = value?.map((option: AutocompleteOption<T>) => this.getOptionName(option)).join(this.separator);
          } else {
            name = value;
          }

          // IF ONLY SEPARATOR IS DELETED, CANCEL USER ACTION
          const delta = this.previousInputValue.length - name.length;
          if (
            delta >= 1 &&
            delta <= 3 &&
            !this.previousInputValue.includes(name) &&
            (this.previousInputValue.match(new RegExp(this.separator, 'g')) || []).length !==
              (name.match(new RegExp(this.separator, 'g')) || []).length
          ) {
            this.inputDisplay.setValue(this.cutEmptySeparator(this.previousInputValue));
            return this.filterOptions(options, '', true);
          }

          this.previousInputValue = value;
          const values = this.getInputDisplayFormattedOptionsName(name);
          const lastValue = values[values.length - 1];
          const formattedLastValue = formattedWithoutCaseAndAccent(lastValue);
          let writingLastOption = null;

          // CHECK IF LAST VALUE IS A VALID OPTION OR IT CONTAINS A VALID OPTION
          const lastOption = this.explicitedSelectedOptionsSubject.value.find(opt => {
            const displayedName = this.getOptionName(opt);
            const formattedOptionName = formattedWithoutCaseAndAccent(displayedName);

            if (formattedLastValue.includes(formattedOptionName) && formattedOptionName !== formattedLastValue) {
              writingLastOption = displayedName;
            }
            return formattedOptionName === formattedLastValue;
          });

          // IF IT CONTAINS A VALID OPTION, GO TO NEXT VALUE
          if (writingLastOption) {
            const lastPart = lastValue.replace(writingLastOption, '');
            this.inputDisplay.setValue(
              this.cutEmptySeparator(
                (this.inputDisplay.value ?? '').replace(lastValue, writingLastOption) + this.separator + lastPart
              ),
              {
                emitEvent: false,
              }
            );
            return this.filterOptions(options, lastPart, false);
          }
          return this.filterOptions(options, formattedLastValue, !!lastOption);
        })
      )
      .subscribe((filteredOptions: Array<AutocompleteOption<T>>) => {
        this.filteredOptions = filteredOptions;
      });
  }

  private filterOptions(
    options: Array<AutocompleteOption<T>>,
    lastValue: string,
    isLastOption: boolean
  ): Array<AutocompleteOption<T>> {
    return this.sortOptions(
      options.filter((option: AutocompleteOption<T>) => {
        return !lastValue || isLastOption || this.valueMatchOption(option, lastValue);
      })
    );
  }

  private sortOptions(options: Array<AutocompleteOption<T>>): Array<AutocompleteOption<T>> {
    return options.sort((a: AutocompleteOption<T>, b: AutocompleteOption<T>) => {
      return this.translateService.instant(this.getOptionName(a)).localeCompare(this.getOptionName(b));
    });
  }

  private sync(form: Array<T>, options: Array<AutocompleteOption<T>>): void {
    const explicitedValue = this.explicitedSelectedOptionsSubject.value.filter(e => e);
    const selectedOptionsIds = explicitedValue.reduce(
      (acc: Array<T>, selectedValue: AutocompleteOption<T>) => [...acc, selectedValue.id],
      []
    );
    const toAdd: Array<AutocompleteOption<T>> = [];
    const toRemove: Array<T> = [];

    // HANDLE PUSHED VALUE IN FORM
    form.forEach((id: T) => {
      const opt = options.find((option: AutocompleteOption<T>) => option.id === id)!;
      if (!selectedOptionsIds.includes(id)) {
        toAdd.push(opt);
      }
    });

    // HANDLE REMOVED VALUE IN FORM
    explicitedValue.forEach((opt: AutocompleteOption<T>) => {
      if (!form.includes(opt.id)) {
        toRemove.push(opt.id);
      }
    });

    // APPLY CHANGES
    if (toAdd.length || toRemove.length) {
      const newValue = [
        ...explicitedValue.filter((opt: AutocompleteOption<T>) => !toRemove.includes(opt.id)),
        ...toAdd,
      ];
      this.explicitedSelectedOptionsSubject.next(newValue);
      const selection = this.sortOptions(newValue).reduce(
        (acc: string, option: AutocompleteOption<T>, index: number) =>
          `${acc}${index !== 0 ? this.separator : ''}${this.getOptionName(option)}`,
        ''
      );
      this.inputDisplay.setValue(selection);
    }
  }

  private getInputDisplayFormattedOptionsName(value: string): Array<string> {
    return value.split('/').map((parsedValue: string) => parsedValue.trim());
  }

  private valueMatchOption(option: AutocompleteOption<T>, value: string): boolean {
    const formattedValue = formattedWithoutCaseAndAccent(value);
    return formattedWithoutCaseAndAccent(this.translateService.instant(option.name)).indexOf(formattedValue) !== -1;
  }

  private getOptionName(option: AutocompleteOption<T>): string {
    return option && this.translateService.instant(option.name);
  }

  private addOption(option: AutocompleteOption<T>): void {
    this.form.push(new FormControl<T>(option.id, { nonNullable: true }));
  }

  private removeOption(option: AutocompleteOption<T>): void {
    this.form.removeAt(this.form.value.findIndex((id: T) => option.id === id));
  }

  public selectOption(option: AutocompleteOption<T>, $event?: MouseEvent): void {
    $event?.stopPropagation();
    $event?.preventDefault();
    if (this.form.value.includes(option.id)) {
      this.removeOption(option);
      this.autoTrigger!.openPanel();
    } else {
      this.addOption(option);
      this.autoTrigger!.openPanel();
    }
  }

  toggleSelection(option: AutocompleteOption<T>, $event: MouseEvent): void {
    $event.stopPropagation();
    this.selectOption(option);
  }

  public onEnter($event: MatOptionSelectionChange<Array<AutocompleteOption<T>>>, option: AutocompleteOption<T>): void {
    if ($event.source.selected) {
      setTimeout(() => {
        this.selectOption(option);
      }, 0);
    }
  }

  public handleSuppression($event: KeyboardEvent): void {
    const toRemove: Array<T> = [];
    const toDeleteFromForm: Array<AutocompleteOption<T>> = [];
    const values = this.getInputDisplayFormattedOptionsName(($event.target as HTMLTextAreaElement).value || '');
    this.explicitedSelectedOptionsSubject.value.forEach((opt: AutocompleteOption<T>) => {
      if (!values.includes(this.getOptionName(opt))) {
        toRemove.push(opt.id);
        toDeleteFromForm.push(opt);
      }
    });

    // APPLY CHANGES
    if (toRemove.length) {
      this.explicitedSelectedOptionsSubject.next([
        ...this.explicitedSelectedOptionsSubject.value.filter(
          (opt: AutocompleteOption<T>) => !toRemove.includes(opt.id)
        ),
      ]);
    }

    if (toDeleteFromForm.length) {
      toDeleteFromForm.forEach((option: AutocompleteOption<T>) => this.removeOption(option));
    }
  }

  private cutEmptySeparator(value: string): string {
    return value
      .replace(new RegExp('^' + this.separatorRegex), '')
      .replace(new RegExp(`(${this.separatorRegex}){2,}`), this.separator);
  }

  private handleDefaultOptions(values: Array<T>): void {
    values?.forEach(value => {
      if (!this.defaultOptionIds.includes(value)) {
        this.defaultOptionIds.push(value);
      }
    });
  }

  private handleDisableInput(): void {
    if (this.form.disabled && !this.inputDisplay.disabled) {
      this.inputDisplay.disable({ emitEvent: false });
    } else if (!this.form.disabled && this.inputDisplay.disabled) {
      this.inputDisplay.enable({ emitEvent: false });
    }
  }

  public displayFn = (value: AutocompleteOption<T> | string): string => {
    if (typeof value === 'object') {
      return '';
    }
    return value;
  };
}
