import { DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

/** Injection function — returns a `Signal<string>` that holds the translated
 *  value for `key` and refreshes whenever the active language changes.
 *
 *  Use it when you need a translated string in a place where `| translate`
 *  doesn't run: component `host` metadata bindings (aria-label, title…),
 *  imperative DOM updates, etc. Inside a component template, prefer the
 *  standard `| translate` pipe.
 *
 *  MUST be called from an injection context (component/directive factory,
 *  field initializer, or constructor). */
export function i18nAttr(key: string): Signal<string> {
  const translate = inject(TranslateService);
  const destroyRef = inject(DestroyRef);
  const value = signal(translate.instant(key));
  translate.onLangChange.pipe(takeUntilDestroyed(destroyRef))
    .subscribe(() => value.set(translate.instant(key)));
  return value;
}
