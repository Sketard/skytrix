// Import : NPM
import { HttpEvent, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { LoaderService } from '../../services/loader.service';

export function loaderInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  const loaderService = inject(LoaderService);

  const isNotCardFetch = (req: HttpRequest<unknown>): boolean => {
    return !req.url.includes('documents');
  };

  const removeRequest = (req: HttpRequest<unknown>) => {
    const i = loaderService.requests.indexOf(req);
    if (i >= 0) {
      loaderService.requests.splice(i, 1);
    }
    loaderService.isLoading.set(loaderService.requests.filter(req => isNotCardFetch(req)).length > 0);
  };

  if (isNotCardFetch(req)) {
    loaderService.requests.push(req);
    loaderService.isLoading.set(true);
  }

  return new Observable<HttpEvent<unknown>>(observer => {
    const subscription = next(req).subscribe({
      next: (event: unknown) => {
        if (event instanceof HttpResponse) {
          removeRequest(req);
          observer.next(event);
        }
      },
      error: (err: unknown) => {
        removeRequest(req);
        observer.error(err);
      },
      complete: () => {
        removeRequest(req);
        observer.complete();
      },
    });
    return () => {
      removeRequest(req);
      subscription.unsubscribe();
    };
  });
}
