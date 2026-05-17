import { Component, signal } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FormArray, FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { IconedAutocompleteOption } from '../../../../core/model/commons/short-resource';
import { SearchServiceCore } from '../../../../services/search-service-core.service';
import { TokenSelectComponent } from './token-select.component';

type Fruit = 'apple' | 'banana' | 'cherry' | 'eclair';

@Component({
  standalone: true,
  imports: [TokenSelectComponent, ReactiveFormsModule, TranslateModule],
  template: `
    <app-token-select
      [form]="form"
      [options$]="options$"
      [inputLabel]="'fruit.label'"
      [maxVisibleChips]="maxChips()"
      [searchService]="searchService">
    </app-token-select>
  `,
})
class HostComponent {
  form = new FormArray<FormControl<Fruit>>([]);
  options$: Observable<Array<IconedAutocompleteOption<Fruit>>> = of([
    { id: 'banana', name: 'Banana' },
    { id: 'apple', name: 'Àpple', icon: 'apple.png' },
    { id: 'cherry', name: 'Cherry' },
    { id: 'eclair', name: 'Éclair' },
  ]);
  maxChips = signal(2);
  searchService?: SearchServiceCore;
}

describe('TokenSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function mount(): void {
    fixture.detectChanges(); // first cd binds inputs + runs ngOnInit
    tick(); // flush sync valueChanges startWith
    fixture.detectChanges();
  }

  function root(): HTMLElement {
    return fixture.nativeElement.querySelector('.token-select');
  }

  function trigger(): HTMLButtonElement {
    return root().querySelector('.token-select__trigger') as HTMLButtonElement;
  }

  function openPanel(): void {
    trigger().click();
    fixture.detectChanges();
    tick(); // queueMicrotask focus
  }

  function options(): HTMLElement[] {
    return Array.from(root().querySelectorAll('.token-select__option'));
  }

  function chips(): HTMLElement[] {
    return Array.from(root().querySelectorAll('.token-select__chip'));
  }

  function searchInput(): HTMLInputElement {
    return root().querySelector('.token-select__search-input') as HTMLInputElement;
  }

  it('binds FormArray two-way (add via option click pushes control)', fakeAsync(() => {
    mount();
    openPanel();
    options()[0].click(); // first sorted = Apple
    fixture.detectChanges();
    expect(host.form.value.length).toBe(1);
    // Second click on same option removes
    options()[0].click();
    fixture.detectChanges();
    expect(host.form.value.length).toBe(0);
  }));

  it('displays visible chips up to maxVisibleChips, then "+N" overflow', fakeAsync(() => {
    mount();
    host.form.push(new FormControl<Fruit>('apple', { nonNullable: true }));
    host.form.push(new FormControl<Fruit>('banana', { nonNullable: true }));
    host.form.push(new FormControl<Fruit>('cherry', { nonNullable: true }));
    tick();
    fixture.detectChanges();
    expect(chips().length).toBe(2);
    const overflow = root().querySelector('.token-select__overflow');
    expect(overflow?.textContent?.trim()).toBe('+1');
  }));

  it('removes selection when clicking mini-chip close button without opening panel', fakeAsync(() => {
    mount();
    host.form.push(new FormControl<Fruit>('apple', { nonNullable: true }));
    tick();
    fixture.detectChanges();
    expect(host.form.value).toEqual(['apple']);
    expect(root().classList.contains('token-select--open')).toBe(false);

    const closeBtn = chips()[0].querySelector('.token-select__chip-remove') as HTMLButtonElement;
    closeBtn.click();
    fixture.detectChanges();
    expect(host.form.value).toEqual([]);
    expect(root().classList.contains('token-select--open')).toBe(false);
  }));

  it('filters options by search input (case + accent insensitive)', fakeAsync(() => {
    mount();
    openPanel();
    searchInput().value = 'apple';
    searchInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(options().length).toBe(1);
    expect(options()[0].textContent).toContain('Àpple');
  }));

  it('supports Enter/Esc/↑↓ keyboard navigation', fakeAsync(() => {
    mount();
    // ArrowDown opens
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(root().classList.contains('token-select--open')).toBe(true);

    // ArrowDown in search focuses first option
    searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(options()[0].classList.contains('token-select__option--focused')).toBe(true);

    // Enter selects focused
    searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(host.form.value.length).toBe(1);

    // Escape closes
    searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(root().classList.contains('token-select--open')).toBe(false);
  }));

  it('clears FormArray when filtersCleared$ emits', fakeAsync(() => {
    const clear$ = new Subject<void>();
    host.searchService = { filtersCleared$: clear$ } as unknown as SearchServiceCore;
    host.form.push(new FormControl<Fruit>('apple', { nonNullable: true }));
    host.form.push(new FormControl<Fruit>('banana', { nonNullable: true }));
    mount();
    expect(host.form.value.length).toBe(2);

    clear$.next();
    tick();
    fixture.detectChanges();
    expect(host.form.value.length).toBe(0);
  }));

  it('renders icon when option has icon, omits img tag when absent', fakeAsync(() => {
    mount();
    openPanel();
    const list = options();
    expect(list[0].querySelector('img.token-select__option-icon')).not.toBeNull();
    expect(list[1].querySelector('img.token-select__option-icon')).toBeNull();
  }));

  it('sorts options via localeCompare on translated names', fakeAsync(() => {
    mount();
    openPanel();
    const labels = options().map(el =>
      el.querySelector('.token-select__option-label')?.textContent?.trim()
    );
    expect(labels).toEqual(['Àpple', 'Banana', 'Cherry', 'Éclair']);
  }));
});
