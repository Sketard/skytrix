import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ListStore } from './list-store';

interface Item { id: number; name: string; tag: 'a' | 'b'; }

type Sort = 'name' | 'id';
type Filter = 'all' | 'a-only' | 'b-only';

@Injectable()
class TestListStore extends ListStore<Item, Sort, Filter> {
  constructor() { super('name', 'all'); }

  /** Test-only passthrough to the protected `setLoading` hook. */
  setLoadingForTest(value: boolean): void {
    this.setLoading(value);
  }

  protected searchMatches(item: Item, query: string): boolean {
    return item.name.toLowerCase().includes(query);
  }

  protected passesFilter(item: Item, mode: Filter): boolean {
    if (mode === 'a-only') return item.tag === 'a';
    if (mode === 'b-only') return item.tag === 'b';
    return true;
  }

  protected sortItems(items: Item[], mode: Sort): Item[] {
    if (mode === 'name') return items.sort((a, b) => a.name.localeCompare(b.name));
    return items.sort((a, b) => a.id - b.id);
  }
}

describe('ListStore', () => {
  let store: TestListStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TestListStore] });
    store = TestBed.inject(TestListStore);
    store.items.set([
      { id: 3, name: 'Cherry', tag: 'b' },
      { id: 1, name: 'Apple',  tag: 'a' },
      { id: 2, name: 'Banana', tag: 'a' },
    ]);
    store.setLoadingForTest(false);
  });

  it('exposes filteredItems sorted by initial sort mode', () => {
    expect(store.filteredItems().map(i => i.name)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('switches sort mode', () => {
    store.setSortMode('id');
    expect(store.filteredItems().map(i => i.id)).toEqual([1, 2, 3]);
  });

  it('applies search query', () => {
    store.setSearchQuery('an'); // matches Banana
    expect(store.filteredItems().map(i => i.id)).toEqual([2]);
  });

  it('applies active filter', () => {
    store.setActiveFilter('b-only');
    expect(store.filteredItems().map(i => i.id)).toEqual([3]);
  });

  it('combines search + filter + sort', () => {
    store.setActiveFilter('a-only');
    store.setSortMode('id');
    store.setSearchQuery('a'); // both apple + banana match 'a-only' + name contains 'a'
    expect(store.filteredItems().map(i => i.id)).toEqual([1, 2]);
  });

  it('hasSearchActive reflects trimmed query', () => {
    expect(store.hasSearchActive()).toBeFalse();
    store.setSearchQuery('  ');
    expect(store.hasSearchActive()).toBeFalse();
    store.setSearchQuery('apple');
    expect(store.hasSearchActive()).toBeTrue();
  });

  it('showEmptyState fires when items empty', () => {
    store.items.set([]);
    expect(store.showEmptyState()).toBeTrue();
    expect(store.showNoResultsState()).toBeFalse();
  });

  it('showNoResultsState fires when filter excludes all', () => {
    store.setSearchQuery('xyzzy');
    expect(store.showNoResultsState()).toBeTrue();
    expect(store.showEmptyState()).toBeFalse();
  });

  it('neither empty nor no-results when loading', () => {
    store.items.set([]);
    store.setLoadingForTest(true);
    expect(store.showEmptyState()).toBeFalse();
    expect(store.showNoResultsState()).toBeFalse();
  });

  it('clearSearch resets the query only', () => {
    store.setSearchQuery('apple');
    store.setActiveFilter('a-only');
    store.clearSearch();
    expect(store.searchQuery()).toBe('');
    expect(store.activeFilter()).toBe('a-only');
  });

  it('clearFilters resets to the constructor-time initial filter', () => {
    store.setSearchQuery('apple');
    store.setActiveFilter('b-only');
    store.clearFilters();
    expect(store.searchQuery()).toBe('');
    expect(store.activeFilter()).toBe('all');
  });
});
