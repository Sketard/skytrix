import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { DuelSystemStringsService } from './duel-system-strings.service';

// Minimal stand-ins for the bundled assets/duel-strings/{fr,en}.json tables.
// FR intentionally omits index 999 + victory 0x99 so the EN-fallback path is
// exercised.
const EN_TABLE = {
  system: {
    '500': 'Select the card(s) to Tribute',
    '999': 'EN-only string',
    // Strings OCGCore leaves with unsubstituted printf placeholders — the
    // browser has no engine args to fill them.
    '221': 'Activate the Trigger Effect of "%ls" from [%ls]?',
    '204': 'Remove %d "%ls"',
  },
  victory: { '0x1': 'LP reached 0', '0x99': 'EN-only victory' },
};
const FR_TABLE = {
  system: {
    '500': 'Sélectionnez la/les carte(s) à Sacrifier',
    '221': 'Activer l\'Effet Déclencheur de « %ls » depuis [%ls] ?',
  },
  victory: { '0x1': 'Points de Vie réduits à 0' },
};

describe('DuelSystemStringsService', () => {
  let service: DuelSystemStringsService;
  let httpMock: HttpTestingController;
  let translate: { currentLang: string };

  function makeService(lang: string): void {
    translate = { currentLang: lang };
    TestBed.configureTestingModule({
      providers: [
        DuelSystemStringsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TranslateService, useValue: translate },
      ],
    });
    service = TestBed.inject(DuelSystemStringsService);
    httpMock = TestBed.inject(HttpTestingController);
  }

  /** Resolves the FR + EN table HTTP requests issued by `preload()`. */
  async function preloadWithTables(): Promise<void> {
    const promise = service.preload();
    // Flush whichever tables `preload()` requested (order is not guaranteed).
    for (const req of httpMock.match(() => true)) {
      if (req.request.url.endsWith('fr.json')) req.flush(FR_TABLE);
      else if (req.request.url.endsWith('en.json')) req.flush(EN_TABLE);
    }
    await promise;
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('resolves a system string in French when lang=fr', async () => {
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveSystemString(500)).toBe('Sélectionnez la/les carte(s) à Sacrifier');
  });

  it('resolves a system string in English when lang=en', async () => {
    makeService('en');
    await preloadWithTables();
    expect(service.resolveSystemString(500)).toBe('Select the card(s) to Tribute');
  });

  it('falls back to the EN table when the FR table lacks the index', async () => {
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveSystemString(999)).toBe('EN-only string');
  });

  it('returns an empty string for an index absent from both tables', async () => {
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveSystemString(123456)).toBe('');
  });

  it('drops a system string carrying an unsubstituted %ls placeholder', async () => {
    // system 221 — "Activate the Trigger Effect of \"%ls\" from [%ls]?". The
    // browser cannot fill %ls (no engine args) — a raw "%ls" in a prompt hint
    // reads as a bug. The guard returns '' so the caller falls back cleanly.
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveSystemString(221)).toBe('');
  });

  it('drops a system string carrying an unsubstituted %d placeholder', async () => {
    makeService('en');
    await preloadWithTables();
    expect(service.resolveSystemString(204)).toBe('');
  });

  it('still resolves a placeholder-free system string normally', async () => {
    makeService('en');
    await preloadWithTables();
    expect(service.resolveSystemString(500)).toBe('Select the card(s) to Tribute');
  });

  it('resolves a win reason in French when lang=fr', async () => {
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveWinReason(0x1)).toBe('Points de Vie réduits à 0');
  });

  it('resolves a win reason in English when lang=en', async () => {
    makeService('en');
    await preloadWithTables();
    expect(service.resolveWinReason(0x1)).toBe('LP reached 0');
  });

  it('falls back to the EN table for a win reason missing in FR', async () => {
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveWinReason(0x99)).toBe('EN-only victory');
  });

  it('returns an empty string for an unknown win-reason code', async () => {
    makeService('fr');
    await preloadWithTables();
    expect(service.resolveWinReason(0xabc)).toBe('');
  });

  it('treats an unsupported language as the EN fallback', async () => {
    makeService('de');
    // `de` is not a known table — `preload()` loads EN twice (current + fallback).
    const promise = service.preload();
    for (const req of httpMock.match(() => true)) req.flush(EN_TABLE);
    await promise;
    expect(service.resolveSystemString(500)).toBe('Select the card(s) to Tribute');
  });

  it('degrades gracefully when a table fetch fails — no rejection, resolves to ""', async () => {
    makeService('fr');
    const warnSpy = spyOn(console, 'warn');
    // `preload()` must resolve (not reject) even when every fetch errors.
    const promise = service.preload();
    for (const req of httpMock.match(() => true)) {
      req.error(new ProgressEvent('error'));
    }
    await promise;
    expect(warnSpy).toHaveBeenCalled();
    // An empty table is cached — resolution falls through to ''.
    expect(service.resolveSystemString(500)).toBe('');
    expect(service.resolveWinReason(0x1)).toBe('');
  });

  it('does not retry a failed table fetch on a later resolve', async () => {
    makeService('fr');
    spyOn(console, 'warn');
    const promise = service.preload();
    for (const req of httpMock.match(() => true)) {
      req.error(new ProgressEvent('error'));
    }
    await promise;
    service.resolveSystemString(500);
    // The empty table is cached — no further HTTP requests are issued.
    httpMock.expectNone(() => true);
  });
});
