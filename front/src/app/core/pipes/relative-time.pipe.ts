import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Formats a date string as a locale-aware relative time (e.g. "5 minutes ago" / "il y a 5 minutes").
 * Uses `Intl.RelativeTimeFormat` — zero i18n keys needed.
 *
 * Note: This pipe is pure — Angular caches the result and won't recalculate as time passes.
 * This is fine when the input data is periodically refreshed (e.g. lobby polling every 10s).
 */
@Pipe({ name: 'relativeTime', standalone: true })
export class RelativeTimePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(date: string): string {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    if (isNaN(diff)) return '';
    const rtf = new Intl.RelativeTimeFormat(this.translate.currentLang, { numeric: 'auto' });
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return rtf.format(-seconds, 'second');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.floor(hours / 24), 'day');
  }
}
