import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

/** Shape of the bundled `assets/duel-strings/{fr,en}.json` tables. */
interface DuelStringTable {
  system: Record<string, string>;
  victory: Record<string, string>;
}

const TABLE_URLS: Record<string, string> = {
  fr: 'assets/duel-strings/fr.json',
  en: 'assets/duel-strings/en.json',
};

/** Language used as the fallback when a string is missing in the current one. */
const FALLBACK_LANG = 'en';

/**
 * Resolves OCGCore system strings (prompt chrome, win reasons) client-side
 * from the bundled FR/EN tables, keyed off the current UI language.
 *
 * System strings are the `cardCode == 0` half of a `description` code — text
 * that used to be stamped server-side from the English `strings.conf`. Card
 * descriptions (`cardCode != 0`) are NOT handled here; they resolve via the
 * Spring Boot card data path (see `duel-description.util.ts`).
 *
 * EN is always loaded as the fallback table; the current language is loaded
 * lazily on first use. A missing index falls through to EN, then to ''.
 */
@Injectable({ providedIn: 'root' })
export class DuelSystemStringsService {
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);

  private readonly tables = new Map<string, DuelStringTable>();
  private readonly inFlight = new Map<string, Promise<DuelStringTable>>();

  /**
   * Eagerly loads the table(s) needed for resolution: the fallback (EN) plus
   * the current language. Safe to call repeatedly — cached after first load.
   */
  async preload(): Promise<void> {
    await Promise.all([
      this.loadTable(FALLBACK_LANG),
      this.loadTable(this.currentLang()),
    ]);
  }

  /**
   * Resolves a system-string index for the current language. Falls back to
   * the EN table when the index is absent, then to '' so the UI never shows
   * `undefined`.
   */
  resolveSystemString(strIndex: number): string {
    return this.lookup('system', String(strIndex));
  }

  /**
   * Resolves a win-reason code. Reason codes arrive as numbers; the `victory`
   * map is keyed by `0x`-prefixed lowercase hex (mirrors `strings.conf`).
   * Unknown codes fall through to '' so the caller can apply a generic label.
   */
  resolveWinReason(code: number): string {
    return this.lookup('victory', `0x${code.toString(16)}`);
  }

  private lookup(section: keyof DuelStringTable, key: string): string {
    const lang = this.currentLang();
    const primary = this.tables.get(lang)?.[section][key];
    if (primary) return primary;
    const fallback = this.tables.get(FALLBACK_LANG)?.[section][key];
    return fallback ?? '';
  }

  private currentLang(): string {
    const lang = this.translate.currentLang;
    return lang && TABLE_URLS[lang] ? lang : FALLBACK_LANG;
  }

  private loadTable(lang: string): Promise<DuelStringTable> {
    const cached = this.tables.get(lang);
    if (cached) return Promise.resolve(cached);

    const pending = this.inFlight.get(lang);
    if (pending) return pending;

    const url = TABLE_URLS[lang] ?? TABLE_URLS[FALLBACK_LANG];
    const request = firstValueFrom(this.http.get<DuelStringTable>(url))
      .then(table => {
        this.tables.set(lang, table);
        this.inFlight.delete(lang);
        return table;
      })
      .catch((err: unknown): DuelStringTable => {
        // Degrade gracefully: callers launch `preload()` fire-and-forget
        // (`void preload()`), so a failed fetch must not surface as an
        // unhandled rejection. Cache an empty table so resolution falls
        // through to '' and never retries.
        console.warn(`[DuelSystemStrings] failed to load "${lang}" table — system strings will be blank`, err);
        const empty: DuelStringTable = { system: {}, victory: {} };
        this.tables.set(lang, empty);
        this.inFlight.delete(lang);
        return empty;
      });
    this.inFlight.set(lang, request);
    return request;
  }
}
