import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, filter, mergeMap, Observable, Subject, take, tap, throwError } from 'rxjs';
import {
  ACCESS_TOKEN,
  AUTH_HEADER,
  BEARER_PREFIX,
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
    req = addHeader(req);
    return next(req).pipe(catchError(x => handleResponseError(x, req, next, router)));
  }
  return next(req);
};

const isRouteWithRight = (req: HttpRequest<any>): boolean => {
  return !['.*/login$', '.*/create-account$', '.*/refresh$', '.*/assets'].some(url => req.url.match(url));
};

const addHeader = (req: HttpRequest<any>): HttpRequest<any> => {
  req = req.clone({
    headers: req.headers.set(AUTH_HEADER, BEARER_PREFIX + localStorage.getItem(ACCESS_TOKEN)),
  });
  return req;
};

const setAccessToken = (response: HttpResponse<any>): void => {
  response.headers.keys();
  const authHeader = response.headers.get(AUTH_HEADER);
  if (authHeader) {
    const accessToken = authHeader.replace(BEARER_PREFIX, '');
    localStorage.setItem(ACCESS_TOKEN, accessToken);
  }
};

const handleResponseError = (
  err: HttpErrorResponse,
  req: HttpRequest<any>,
  next: HttpHandlerFn,
  router: Router
): Observable<any> => {
  if (err.status === 401) {
    if (err.error instanceof Blob) {
      console.log('1');
      return handleBlob401Errors(err, req, next, router);
    }
    console.log('2');
    return handle401Errors(err, req, next, router);
  }
  if (err.error instanceof Blob) {
    console.log('3');
    return handleBlobError(err);
  }
  console.log('4');
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
      localStorage.removeItem(ACCESS_TOKEN);
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
        req = addHeader(req);
        return next(req);
      })
    );
  }

  authService.refresh = RefreshStep.DOING;
  return authService
    .refreshToken()
    .pipe(
      mergeMap((data: HttpResponse<any>) => {
        setAccessToken(data);
        req = addHeader(req);
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
