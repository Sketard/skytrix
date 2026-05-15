import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { ReplayHubPageComponent } from './replay-hub-page.component';
import { ReplayHubStore } from './replay-hub-store';
import { AuthService } from '../../../services/auth.service';
import { DeckBuildService } from '../../../services/deck-build.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReplayDTO } from '../../../core/model/dto/replay-dto';
import { DuelResult } from '../../../core/enums/duel-result.enum';
import { UserDTO } from '../../../core/model/account/user';

const ME_ID = 42;

function makeReplay(id: string, overrides: Partial<ReplayDTO> = {}): ReplayDTO {
  return {
    id,
    player1Id: ME_ID,
    player2Id: 99,
    createdAt: '2026-05-14T12:00:00Z',
    metadata: {
      playerUsernames: ['Me', 'Opp'],
      deckNames: ['MyDeck', 'OppDeck'],
      turnCount: 5,
      result: DuelResult.VICTORY,
      date: '2026-05-14T12:00:00Z',
      scriptsHash: 'h',
      ocgcoreVersion: '1',
    },
    ...overrides,
  };
}

describe('ReplayHubPageComponent', () => {
  let fixture: ComponentFixture<ReplayHubPageComponent>;
  let component: ReplayHubPageComponent;
  let http: HttpTestingController;
  let router: Router;
  let deckSubject: BehaviorSubject<Array<{ name: string }>>;

  beforeEach(async () => {
    deckSubject = new BehaviorSubject<Array<{ name: string }>>([{ name: 'MyDeck' }]);

    const authStub = {
      user: () => ({ id: ME_ID, pseudo: 'Me', role: 'USER' } as unknown as UserDTO),
    };

    await TestBed.configureTestingModule({
      imports: [ReplayHubPageComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authStub },
        { provide: DeckBuildService, useValue: { decks$: deckSubject.asObservable() } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('Notify', ['error']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReplayHubPageComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
  });

  function initialFetchFlush(replays: ReplayDTO[] = [], stats: { total: number; victories: number; defeats: number; draws: number; winrate: number } | null = null) {
    fixture.detectChanges(); // triggers ngOnInit → store.start()
    http.expectOne(req => req.url === '/api/replays' && req.method === 'GET').flush({ elements: replays, size: replays.length });
    if (stats) {
      http.expectOne('/api/replays/stats').flush(stats);
    } else {
      http.expectOne('/api/replays/stats').error(new ProgressEvent('error'), { status: 500, statusText: 'err' });
    }
    fixture.detectChanges();
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('navigates to /pvp/replay/:id on Space activation (Enter/click handled natively by routerLink)', () => {
    const navSpy = spyOn(router, 'navigate');
    const r = makeReplay('abc');
    initialFetchFlush([r], { total: 1, victories: 1, defeats: 0, draws: 0, winrate: 1 });

    const spaceEvent = new KeyboardEvent('keydown', { key: ' ' });
    const preventSpy = spyOn(spaceEvent, 'preventDefault');
    component.openReplay(spaceEvent, r);

    expect(preventSpy).toHaveBeenCalled(); // avoid the default page scroll
    expect(navSpy).toHaveBeenCalledWith(['/pvp/replay', 'abc']);
  });

  // ───────────────────────────────────────────────────────────────────────────

  it('deletes immediately on click — no confirm dialog (mockup §replay-action-btn--danger tap & gone)', fakeAsync(() => {
    const r = makeReplay('xyz');
    initialFetchFlush([r], { total: 1, victories: 1, defeats: 0, draws: 0, winrate: 1 });

    component.deleteReplay(r, new Event('click'));
    flush();

    // Optimistic removal — card disappears immediately from filteredReplays.
    expect(component['store'].replays().map(rp => rp.id)).not.toContain('xyz');
    // Backend DELETE fires without user confirmation.
    http.expectOne({ url: '/api/replays/xyz', method: 'DELETE' }).flush(null);
    flush();
    // Stats refresh follows.
    http.expectOne('/api/replays/stats').flush({
      total: 0, victories: 0, defeats: 0, draws: 0, winrate: 0,
    });
  }));

  it('rolls back the optimistic removal when the backend returns an error', fakeAsync(() => {
    const r = makeReplay('xyz');
    initialFetchFlush([r], { total: 1, victories: 1, defeats: 0, draws: 0, winrate: 1 });

    component.deleteReplay(r, new Event('click'));
    flush();
    expect(component['store'].replays().map(rp => rp.id)).not.toContain('xyz');
    // Server rejects — store should re-insert the replay (cf. ReplayHubStore.deleteReplay).
    http.expectOne({ url: '/api/replays/xyz', method: 'DELETE' }).flush(
      { message: 'forbidden' }, { status: 403, statusText: 'Forbidden' },
    );
    flush();
    expect(component['store'].replays().map(rp => rp.id)).toContain('xyz');
  }));

  // ───────────────────────────────────────────────────────────────────────────

  it('shows the stats strip when stats() is non-null', () => {
    initialFetchFlush(
      [makeReplay('a')],
      { total: 1, victories: 1, defeats: 0, draws: 0, winrate: 1 },
    );
    const stats = fixture.nativeElement.querySelector('.hub-stats');
    expect(stats).not.toBeNull();
  });

  it('hides the stats strip when stats() fetch fails', () => {
    initialFetchFlush([makeReplay('a')], null);
    const stats = fixture.nativeElement.querySelector('.hub-stats');
    expect(stats).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────

  it('exposes winratePercent() rounded from stats.winrate', () => {
    initialFetchFlush([], { total: 4, victories: 3, defeats: 1, draws: 0, winrate: 0.75 });
    expect(component.winratePercent()).toBe(75);
  });
});
