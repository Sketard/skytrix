import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

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
 * Returns the card name in the current UI language.
 * Fallback chain: currentLang → first available language → card.name → ''.
 */
@Pipe({ name: 'cardName', standalone: true, pure: false })
export class CardNamePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

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
export class CardDescPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(card: { description?: string | null; translations?: Record<string, { description: string }> } | null | undefined): string {
    if (!card) return '';
    return resolve(card.translations, this.translate.currentLang, 'description', card.description);
  }
}
