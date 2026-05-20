import { ChangeDetectorRef, inject, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

/** Picks a field from card.translations by current lang, falling back to first available language, then to the default field. */
function resolve<K extends string>(
  translations: Record<string, Record<K, string>> | undefined,
  lang: string,
  field: K,
  fallback: string | null | undefined,
): string {
  if (translations) {
    const entry = translations[lang] ?? Object.values(translations)[0];
    if (entry?.[field]) return entry[field];
  }
  return fallback ?? '';
}

/**
 * Base for the card i18n pipes. Impure so it re-evaluates each CD cycle, and
 * subscribed to `onLangChange` so an OnPush host with no other `| translate`
 * binding still re-renders when the UI language switches.
 */
abstract class CardI18nPipe implements OnDestroy {
  protected readonly translate = inject(TranslateService);
  private readonly sub: Subscription;

  constructor() {
    const cdr = inject(ChangeDetectorRef);
    this.sub = this.translate.onLangChange.subscribe(() => cdr.markForCheck());
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}

/**
 * Returns the card name in the current UI language.
 * Fallback chain: currentLang → first available language → card.name → ''.
 */
@Pipe({ name: 'cardName', standalone: true, pure: false })
export class CardNamePipe extends CardI18nPipe implements PipeTransform {
  transform(card: { name?: string | null; translations?: Record<string, { name: string }> } | null | undefined): string {
    if (!card) return '';
    return resolve(card.translations, this.translate.currentLang, 'name', card.name);
  }
}

/**
 * Returns the card description in the current UI language.
 * Fallback chain: currentLang → first available language → card.description → ''.
 */
@Pipe({ name: 'cardDesc', standalone: true, pure: false })
export class CardDescPipe extends CardI18nPipe implements PipeTransform {
  transform(card: { description?: string | null; translations?: Record<string, { description: string }> } | null | undefined): string {
    if (!card) return '';
    return resolve(card.translations, this.translate.currentLang, 'description', card.description);
  }
}
