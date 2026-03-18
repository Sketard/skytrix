import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, filter, mergeMap, Observable, Subject, take, tap, throwError } from 'rxjs';
import {
  INVALID_CREDENTIALS,
  TOKEN_EXPIRED,
} from '../utilities/auth.constants';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { displayError } from '../utilities/functions';
import { AuthService } from '../../services/auth.service';
import { RefreshStep } from '../enums/refresh-step.enum';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  if (isRouteWithRight(req)) {
    return next(req).pipe(catchError(x => handleResponseError(x, req, next, router)));
  }
  return next(req);
};

const isRouteWithRight = (req: HttpRequest<any>): boolean => {
  return !['.*/login$', '.*/create-account$', '.*/refresh$', '.*/assets', '.*/client-logs$'].some(url => req.url.match(url));
};

const handleResponseError = (
  err: HttpErrorResponse,
  req: HttpRequest<any>,
  next: HttpHandlerFn,
  router: Router
): Observable<any> => {
  if (err.status === 401) {
    if (err.error instanceof Blob) {
      return handleBlob401Errors(err, req, next, router);
    }
    return handle401Errors(err, req, next, router);
  }
  if (err.error instanceof Blob) {
    return handleBlobError(err);
  }
  return throwError(err);
};

const handle401Errors = (
  err: HttpErrorResponse,
  req: HttpRequest<any>,
  next: HttpHandlerFn,
  router: Router
): Observable<any> => {
  switch (err.error.message) {
    case TOKEN_EXPIRED:
      return tryToRefreshToken(req, next, router);
    case INVALID_CREDENTIALS:
      if (!req.url.match('.*/login')) {
        router.navigate(['/login']);
      }
      return throwError(err);
  }
  return throwError(err);
};

const handleBlob401Errors = (
  err: HttpErrorResponse,
  req: HttpRequest<any>,
  next: HttpHandlerFn,
  router: Router
): Observable<any> => {
  const reader: FileReader = new FileReader();
  const getBlobMessageSubject = new Subject<any>();
  const getBlobMessage$ = getBlobMessageSubject.asObservable();

  handleBlobError(err, getBlobMessageSubject).pipe(take(1)).subscribe();
  reader.readAsText(err.error);
  return getBlobMessage$.pipe(
    mergeMap(error => {
      return handle401Errors({ ...err, error }, req, next, router);
    })
  );
};

const handleBlobError = (err: HttpErrorResponse, blobSubject?: Subject<any>): Observable<any> => {
  const snackBar = inject(MatSnackBar);
  const reader: FileReader = new FileReader();
  const obs = new Observable((observer: any) => {
    reader.onloadend = e => {
      const messageObject = JSON.parse(reader.result as string);
      const errorMessage = {
        error: {
          message: messageObject.message,
        },
        message: messageObject.message,
        status: err.status,
      };
      observer.error(errorMessage);

      if (blobSubject) {
        blobSubject.next(errorMessage);
      } else {
        displayError(snackBar, messageObject.message);
      }
      observer.complete();
    };
  });
  reader.readAsText(err.error);
  return obs;
};

const tryToRefreshToken = (req: HttpRequest<any>, next: HttpHandlerFn, router: Router): Observable<any> => {
  const authService = inject(AuthService);
  const refresh$ = authService.refresh$;
  if (authService.refresh === RefreshStep.DOING) {
    return refresh$.pipe(
      filter((value: RefreshStep) => [RefreshStep.FINISHED, RefreshStep.ERROR].includes(value)),
      mergeMap((value: RefreshStep) => {
        if (value === RefreshStep.ERROR) {
          return throwError('Refresh token not valid');
        }
        return next(req);
      })
    );
  }

  authService.refresh = RefreshStep.DOING;
  return authService
    .refreshToken()
    .pipe(
      mergeMap(() => {
        return next(req);
      })
    )
    .pipe(
      tap(() => {
        authService.refresh = RefreshStep.FINISHED;
      }),
      catchError(error => {
        if (error.status === 401) {
          authService.refresh = RefreshStep.FINISHED;
          return router.navigate(['/login']);
        }
        return throwError(error);
      })
    );
};
