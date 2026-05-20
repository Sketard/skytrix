import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  BehaviorSubject,
  debounce,
  map,
  Observable,
  of,
  Subject,
  take,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { clearFormArray } from '../core/utilities/functions';
import { CardFilterDTO, CardSetFilterDTO } from '../core/model/dto/card-filter-dto';
import { CardDetailDTO, CardDetailDTOPage } from '../core/model/dto/card-detail-dto';
import { CardDetail } from '../core/model/card-detail';
import { TypedForm } from '../core/model/commons/typed-form';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { CardAttribute } from '../core/enums/card-attribute';
import { CardRace } from '../core/enums/card-race.enum';
import { CardType } from '../core/enums/card-type.enum';
import { HttpClient } from '@angular/common/http';
import { CardDisplayType } from '../core/enums/card-display-type';

@Injectable({
  providedIn: 'root',
})
export abstract class SearchServiceCore implements OnDestroy {
  readonly cardsDetailsSubject = new BehaviorSubject<Array<CardDetail>>([]);
  readonly cardsDetails$ = this.cardsDetailsSubject.asObservable();
  readonly filterForm = new FormGroup<TypedForm<CardFilterDTO>>(SearchServiceCore.buildSearchForm());
  private offset: number = 0;
  readonly quantity: number = 60;
  private readonly displayModeState = signal<CardDisplayType>(CardDisplayType.GRID);
  readonly displayMode = this.displayModeState.asReadonly();

  private readonly favoriteFilterState = signal<boolean>(false);
  readonly favoriteFilter = this.favoriteFilterState.asReadonly();

  private readonly skipDebounceState = signal<boolean>(false);
  readonly skipDebounce = this.skipDebounceState.asReadonly();

  private readonly isLoadingState = signal<boolean>(false);
  readonly isLoading = this.isLoadingState.asReadonly();

  // True only while a fresh search (offset 0) resolves — NOT during
  // loadNextPage pagination. Drives the full-grid skeleton swap.
  private readonly isReloadingState = signal<boolean>(false);
  readonly isReloading = this.isReloadingState.asReadonly();

  private readonly hasMoreResultsState = signal<boolean>(true);
  readonly hasMoreResults = this.hasMoreResultsState.asReadonly();

  readonly filtersCleared$ = new Subject<void>();

  private unsubscribe$ = new Subject<void>();
  private fetchActive = false;

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  get cardsDetails(): Array<CardDetail> {
    return this.cardsDetailsSubject.value;
  }

  set cardsDetails(cardsDetails: Array<CardDetail>) {
    this.cardsDetailsSubject.next(cardsDetails);
  }

  get filters(): CardFilterDTO {
    return this.filterForm.getRawValue();
  }

  public disableDebounceForOneRequest() {
    this.skipDebounceState.set(true);
  }

  public refreshResearch(): void {
    this.disableDebounceForOneRequest();
    this.filterForm.controls.name.setValue(this.filterForm.controls.name.value);
  }

  public clearFilters(): void {
    this.disableDebounceForOneRequest();
    this.filterForm.controls.name.reset('', { emitEvent: false });
    this.filterForm.controls.minAtk.reset(null, { emitEvent: false });
    this.filterForm.controls.maxAtk.reset(null, { emitEvent: false });
    this.filterForm.controls.minDef.reset(null, { emitEvent: false });
    this.filterForm.controls.maxDef.reset(null, { emitEvent: false });
    this.filterForm.controls.attribute.reset(null, { emitEvent: false });
    this.filterForm.controls.archetype.reset('', { emitEvent: false });
    this.filterForm.controls.minScale.reset(null, { emitEvent: false });
    this.filterForm.controls.maxScale.reset(null, { emitEvent: false });
    this.filterForm.controls.minLinkval.reset(null, { emitEvent: false });
    this.filterForm.controls.maxLinkval.reset(null, { emitEvent: false });
    this.filterForm.controls.cardSetFilter.controls.cardSetCode.reset('', { emitEvent: false });
    this.filterForm.controls.cardSetFilter.controls.cardRarityCode.reset('', { emitEvent: false });
    clearFormArray(this.filterForm.controls.cardSetFilter.controls.cardSetNames, false);
    clearFormArray(this.filterForm.controls.types, false);
    clearFormArray(this.filterForm.controls.races, false);
    this.filterForm.updateValueAndValidity();
    this.filtersCleared$.next();
  }

  public fetch(httpClient: HttpClient): boolean {
    if (this.fetchActive) return false;
    this.fetchActive = true;
    this.unsubscribe$.next();
    this.unsubscribe$ = new Subject<void>();
    this.isLoadingState.set(false);
    this.hasMoreResultsState.set(true);

    this.filterForm.valueChanges
      .pipe(
        debounce(() => {
          return this.skipDebounceState() ? of({}) : timer(300);
        }),
        tap(() => {
          this.skipDebounceState.set(false);
        }),
        takeUntil(this.unsubscribe$),
      )
      .subscribe(() => {
        if (this.isLoadingState()) return;
        this.offset = 0;
        this.hasMoreResultsState.set(true);
        this.isLoadingState.set(true);
        this.isReloadingState.set(true);
        this.search(httpClient, this.filters, this.quantity, this.offset)
          .pipe(take(1))
          .subscribe({
            next: (cards: Array<CardDetail>) => {
              this.cardsDetails = cards;
              this.offset += 1;
              this.hasMoreResultsState.set(cards.length >= this.quantity);
              this.isLoadingState.set(false);
              this.isReloadingState.set(false);
            },
            error: () => {
              this.isLoadingState.set(false);
              this.isReloadingState.set(false);
            },
          });
      });
    return true;
  }

  public loadNextPage(httpClient: HttpClient): void {
    if (this.isLoadingState() || !this.hasMoreResultsState()) return;
    this.isLoadingState.set(true);
    this.search(httpClient, this.filters, this.quantity, this.offset)
      .pipe(take(1))
      .subscribe({
        next: (cards: Array<CardDetail>) => {
          this.cardsDetails = [...this.cardsDetails, ...cards];
          this.offset += 1;
          this.hasMoreResultsState.set(cards.length >= this.quantity);
          this.isLoadingState.set(false);
        },
        error: () => {
          this.isLoadingState.set(false);
        },
      });
  }

  public clearOffset() {
    this.offset = 0;
    this.fetchActive = false;
    this.unsubscribe$.next();
  }

  public static buildSearchForm(): TypedForm<CardFilterDTO> {
    return {
      minAtk: new FormControl<number | null>(null),
      maxAtk: new FormControl<number | null>(null),
      minDef: new FormControl<number | null>(null),
      maxDef: new FormControl<number | null>(null),
      name: new FormControl<string>(''),
      attribute: new FormControl<CardAttribute | null>(null),
      archetype: new FormControl<string>(''),
      minScale: new FormControl<number | null>(null),
      maxScale: new FormControl<number | null>(null),
      minLinkval: new FormControl<number | null>(null),
      maxLinkval: new FormControl<number | null>(null),
      types: new FormArray<FormControl<CardType>>([]),
      races: new FormArray<FormControl<CardRace>>([]),
      favorite: new FormControl<boolean>(false, { nonNullable: true }),
      cardSetFilter: new FormGroup<TypedForm<CardSetFilterDTO>>({
        cardSetNames: new FormArray<FormControl<string>>([]),
        cardSetCode: new FormControl<string>(''),
        cardRarityCode: new FormControl<string>(''),
      }),
    };
  }

  public search(
    httpClient: HttpClient,
    filter: CardFilterDTO,
    quantity: number,
    offset: number
  ): Observable<Array<CardDetail>> {
    return httpClient
      .post<CardDetailDTOPage>(`/api/cards/search?quantity=${quantity}&offset=${offset}`, filter)
      .pipe(map((cards: CardDetailDTOPage) => cards.elements.map((card: CardDetailDTO) => new CardDetail(card))));
  }

  public setDisplayMode(mode: CardDisplayType) {
    this.displayModeState.set(mode);
  }

  public toggleFavoriteFilter(): void {
    const next = !this.favoriteFilterState();
    this.favoriteFilterState.set(next);
    this.filterForm.controls.favorite.setValue(next);
  }

  public addFavoriteCard(httpClient: HttpClient, id: number) {
    return httpClient.put<void>(`/api/cards/favorites/add/${id}`, {}).pipe(take(1));
  }

  public removeFavoriteCard(httpClient: HttpClient, id: number) {
    return httpClient.put<void>(`/api/cards/favorites/remove/${id}`, {}).pipe(take(1));
  }
}
