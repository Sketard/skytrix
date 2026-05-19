import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { startWith } from 'rxjs/operators';
import { OnDestroy, OnInit } from '@angular/core';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { clearFormArray } from '../../core/utilities/functions';
import { CardFilterDTO } from '../../core/model/dto/card-filter-dto';

export interface ActiveFilter {
  key: string;
  label: string;
  suffix: string;
  remove: () => void;
}

@Component({
  selector: 'app-active-filters-bar',
  templateUrl: './active-filters-bar.component.html',
  styleUrl: './active-filters-bar.component.scss',
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveFiltersBarComponent implements OnInit, OnDestroy {
  readonly searchService = input.required<SearchServiceCore>();

  private readonly translate = inject(TranslateService);

  private readonly formValue = signal<Partial<CardFilterDTO>>({});

  private formSub?: Subscription;

  ngOnInit(): void {
    const svc = this.searchService();
    this.formSub = svc.filterForm.valueChanges
      .pipe(startWith(svc.filterForm.value))
      .subscribe(v => this.formValue.set(v as Partial<CardFilterDTO>));
  }

  ngOnDestroy(): void {
    this.formSub?.unsubscribe();
  }

  readonly activeFilters = computed<Array<ActiveFilter>>(() => {
    const svc = this.searchService();
    const value = this.formValue();
    const out: Array<ActiveFilter> = [];

    if (value.types && value.types.length) {
      out.push({
        key: 'types',
        label: 'cardFilters.cardType',
        suffix: ` : ${value.types.map(t => this.translate.instant(`card_type.${t}`)).join(', ')}`,
        remove: () => clearFormArray(svc.filterForm.controls.types),
      });
    }
    if (value.races && value.races.length) {
      out.push({
        key: 'races',
        label: 'cardFilters.race',
        suffix: ` : ${value.races.map(r => this.translate.instant(`card_race.${r}`)).join(', ')}`,
        remove: () => clearFormArray(svc.filterForm.controls.races),
      });
    }
    if (value.attribute) {
      out.push({
        key: 'attribute',
        label: `card_attribute.${value.attribute}`,
        suffix: '',
        remove: () => svc.filterForm.controls.attribute.setValue(null),
      });
    }
    if (value.archetype) {
      out.push({
        key: 'archetype',
        label: 'cardFilters.archetype',
        suffix: ` : ${value.archetype}`,
        remove: () => svc.filterForm.controls.archetype.setValue(''),
      });
    }

    this.appendRange(out, 'atk', 'cardFilters.atk', value.minAtk, value.maxAtk,
      () => this.clearRange(svc, 'minAtk', 'maxAtk'));
    this.appendRange(out, 'def', 'cardFilters.def', value.minDef, value.maxDef,
      () => this.clearRange(svc, 'minDef', 'maxDef'));
    this.appendRange(out, 'scale', 'cardFilters.scale', value.minScale, value.maxScale,
      () => this.clearRange(svc, 'minScale', 'maxScale'));
    this.appendRange(out, 'linkval', 'cardFilters.linkval', value.minLinkval, value.maxLinkval,
      () => this.clearRange(svc, 'minLinkval', 'maxLinkval'));

    const csf = value.cardSetFilter;
    const hasNames = !!(csf?.cardSetNames && csf.cardSetNames.length);
    if (hasNames || csf?.cardSetCode || csf?.cardRarityCode) {
      const parts: Array<string> = [];
      if (hasNames) parts.push(csf!.cardSetNames!.join(', '));
      if (csf?.cardSetCode) parts.push(csf.cardSetCode);
      if (csf?.cardRarityCode) parts.push(csf.cardRarityCode);
      out.push({
        key: 'cardSet',
        label: 'cardFilters.cardSet',
        suffix: ` : ${parts.join(' ')}`,
        remove: () => {
          clearFormArray(svc.filterForm.controls.cardSetFilter.controls.cardSetNames);
          svc.filterForm.controls.cardSetFilter.controls.cardSetCode.setValue('');
          svc.filterForm.controls.cardSetFilter.controls.cardRarityCode.setValue('');
        },
      });
    }
    return out;
  });

  private appendRange(
    out: Array<ActiveFilter>,
    key: string,
    label: string,
    min: number | null | undefined,
    max: number | null | undefined,
    remove: () => void,
  ): void {
    if (min == null && max == null) return;
    out.push({ key, label, suffix: this.formatRange(min ?? null, max ?? null), remove });
  }

  private clearRange<
    K extends 'minAtk' | 'maxAtk' | 'minDef' | 'maxDef' | 'minScale' | 'maxScale' | 'minLinkval' | 'maxLinkval',
  >(svc: SearchServiceCore, minName: K, maxName: K): void {
    svc.filterForm.controls[minName].setValue(null);
    svc.filterForm.controls[maxName].setValue(null);
  }

  private formatRange(min: number | null, max: number | null): string {
    if (min != null && max != null) return ` : ${min}–${max}`;
    if (min != null) return ` : ≥ ${min}`;
    if (max != null) return ` : ≤ ${max}`;
    return '';
  }

  remove(filter: ActiveFilter, event: MouseEvent): void {
    event.stopPropagation();
    filter.remove();
  }

  clearAll(): void {
    this.searchService().clearFilters();
  }
}
