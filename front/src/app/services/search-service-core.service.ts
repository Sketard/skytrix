import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounce,
  fromEvent,
  map,
  Observable,
  of,
  startWith,
  Subject,
  take,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { CardFilterDTO, CardSetFilterDTO } from '../core/model/dto/card-filter-dto';
import { CardDetailDTO, CardDetailDTOPage } from '../core/model/dto/card-detail-dto';
import { CardDetail } from '../core/model/card-detail';
import { TypedForm } from '../core/model/commons/typed-form';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { CardAttribute } from '../core/enums/card-attribute';
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
  readonly CARDS_CONTAINER_CLASS = '.cardSearchPage-searcher-result';
  private readonly displayModeState = signal<CardDisplayType>(CardDisplayType.MOSAIC);
  readonly displayMode = this.displayModeState.asReadonly();

  private readonly openedFiltersState = signal<boolean>(false);
  readonly openedFilters = this.openedFiltersState.asReadonly();

  private readonly skipDebounceState = signal<boolean>(false);
  readonly skipDebounce = this.skipDebounceState.asReadonly();

  private readonly isLoadingState = signal<boolean>(false);
  readonly isLoading = this.isLoadingState.asReadonly();

  private readonly hasMoreResultsState = signal<boolean>(true);
  readonly hasMoreResults = this.hasMoreResultsState.asReadonly();

  private unsubscribe$ = new Subject<void>();

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

  public fetch(httpClient: HttpClient) {
    this.unsubscribe$.next();
    this.unsubscribe$ = new Subject<void>();
    this.isLoadingState.set(false);
    this.hasMoreResultsState.set(true);

    const content = document.querySelector(this.CARDS_CONTAINER_CLASS);
    const scroll$ = fromEvent(content!, 'scroll').pipe(
      map(() => {
        return content!.scrollTop;
      })
    );

    let filterUpdate = true;

    combineLatest([
      scroll$.pipe(startWith(0)).pipe(
        map(t => {
          filterUpdate = false;
          return t;
        })
      ),
      this.filterForm.valueChanges.pipe(
        debounce(() => {
          return this.openedFilters() || this.skipDebounceState() ? of({}) : timer(750);
        }),
        tap(() => {
          this.skipDebounceState.set(false);
          filterUpdate = true;
        })
      ),
    ])
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe(([scrollPos, filters]) => {
        let limit = content!.scrollHeight - content!.clientHeight;
        if (filterUpdate) {
          this.offset = 0;
          this.hasMoreResultsState.set(true);
        }
        if (!this.isLoadingState() && (this.hasMoreResultsState() || filterUpdate)) {
          if (scrollPos === limit || filterUpdate) {
            this.isLoadingState.set(true);
            this.search(httpClient, this.filters, this.quantity, this.offset)
              .pipe(take(1))
              .subscribe({
                next: (cards: Array<CardDetail>) => {
                  if (filterUpdate) {
                    this.cardsDetails = cards;
                    filterUpdate = false;
                  } else {
                    this.cardsDetails = [...this.cardsDetails, ...cards];
                  }
                  this.offset += 1;
                  this.hasMoreResultsState.set(cards.length >= this.quantity);
                  this.isLoadingState.set(false);
                },
                error: () => {
                  this.isLoadingState.set(false);
                },
              });
          }
        }
      });
  }

  public clearOffset() {
    const content = document.querySelector(this.CARDS_CONTAINER_CLASS);
    if (content) {
      content.scrollTop = 0;
    }
    this.offset = 0;
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
      scale: new FormControl<number | null>(null),
      linkval: new FormControl<number | null>(null),
      types: new FormArray<FormControl<CardType>>([]),
      favorite: new FormControl<boolean>(false, { nonNullable: true }),
      cardSetFilter: new FormGroup<TypedForm<CardSetFilterDTO>>({
        cardSetName: new FormControl<string>(''),
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

  public toggleFilters() {
    this.openedFiltersState.set(!this.openedFilters());
  }

  public setDisplayMode(mode: CardDisplayType) {
    const currentMode = this.displayModeState();
    if ((currentMode === CardDisplayType.FAVORITE) !== (mode === CardDisplayType.FAVORITE)) {
      this.filterForm.controls.favorite.setValue(mode === CardDisplayType.FAVORITE);
    }
    this.displayModeState.set(mode);
  }

  public addFavoriteCard(httpClient: HttpClient, id: number) {
    return httpClient.put<void>(`/api/cards/favorites/add/${id}`, {}).pipe(take(1));
  }

  public removeFavoriteCard(httpClient: HttpClient, id: number) {
    return httpClient.put<void>(`/api/cards/favorites/remove/${id}`, {}).pipe(take(1));
  }
}
