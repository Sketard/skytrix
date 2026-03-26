import { ApplicationConfig, APP_INITIALIZER, ErrorHandler, importProvidersFrom } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { loaderInterceptor } from './core/interceptors/loader-interceptor';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { GlobalErrorHandler } from './core/services/global-error-handler';

function initLanguage(translate: TranslateService) {
  return () => {
    const saved = localStorage.getItem('lang');
    const lang = saved && ['fr', 'en'].includes(saved) ? saved : 'fr';
    translate.use(lang);
  };
}

function paginatorIntlFactory(translate: TranslateService): MatPaginatorIntl {
  const intl = new MatPaginatorIntl();
  const update = () => {
    intl.itemsPerPageLabel = translate.instant('replay.paginator.itemsPerPage');
    intl.nextPageLabel = translate.instant('replay.paginator.nextPage');
    intl.previousPageLabel = translate.instant('replay.paginator.previousPage');
    intl.firstPageLabel = translate.instant('replay.paginator.firstPage');
    intl.lastPageLabel = translate.instant('replay.paginator.lastPage');
    intl.getRangeLabel = (page, pageSize, length) => {
      const total = Math.max(length, 0);
      const start = page * pageSize + 1;
      const end = Math.min(start + pageSize - 1, total);
      return total === 0 ? `0 ${translate.instant('replay.paginator.of')} 0`
        : `${start} – ${end} ${translate.instant('replay.paginator.of')} ${total}`;
    };
    intl.changes.next();
  };
  // No unsubscribe needed — MatPaginatorIntl is a root singleton that lives for the app's lifetime
  translate.onLangChange.subscribe(update);
  update();
  return intl;
}

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([loaderInterceptor, authInterceptor])),
    provideAnimationsAsync(),
    provideAnimations(),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: 'fr',
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient],
        },
      })
    ),
    { provide: APP_INITIALIZER, useFactory: initLanguage, deps: [TranslateService], multi: true },
    { provide: MatPaginatorIntl, useFactory: paginatorIntlFactory, deps: [TranslateService] },
  ],
};
