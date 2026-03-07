import { MatSnackBar } from '@angular/material/snack-bar';
import { SnackbarComponent } from '../../components/snackbar/snackbar.component';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FormArray } from '@angular/forms';

export const generateRandomId = (): number => {
  const crypto = window.crypto;
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return Math.abs(array[0]);
};

export const downloadDocument = (data: Blob | null, fileName: string, contentType: string): void => {
  const blob = new Blob([data ?? ''], { type: contentType });
  const url = URL.createObjectURL(blob);

  const fileLink = document.createElement('a');
  fileLink.href = url;
  fileLink.setAttribute('target', '_blank');
  fileLink.download = fileName;
  fileLink.click();
  window.URL.revokeObjectURL(url);
};

export const displayError = (snackBar: MatSnackBar, error: HttpErrorResponse | string) => {
  const message = typeof error === 'string' ? error : (error.error?.error ?? 'Une erreur est survenue');
  snackBar.openFromComponent(SnackbarComponent, {
    data: { message, type: 'error', icon: 'error' },
    duration: 4000,
    verticalPosition: 'top',
    horizontalPosition: 'center',
    panelClass: 'snackbar-panel',
  });
};

export const displaySuccess = (snackBar: MatSnackBar, message: string, duration = 2000) => {
  snackBar.openFromComponent(SnackbarComponent, {
    data: { message, type: 'success', icon: 'check_circle' },
    duration,
    verticalPosition: 'top',
    horizontalPosition: 'center',
    panelClass: 'snackbar-panel',
  });
};

export const parseErrorBlob = (err: HttpErrorResponse, snackBar: MatSnackBar) => {
  const reader: FileReader = new FileReader();
  const obs = new Observable<HttpResponse<Blob>>((observer: any) => {
    reader.onloadend = e => {
      const messageObject = JSON.parse(reader.result as string);
      observer.error({
        error: {
          message: messageObject.message,
        },
        message: messageObject.message,
        status: err.status,
      });
      displayError(snackBar, err);
      observer.complete();
    };
  });
  reader.readAsText(err.error);
  return obs;
};

export const relativeTime = (date: string): string => {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  if (isNaN(diff)) return '';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
};

export const formattedWithoutCaseAndAccent = (a: string): string => {
  return !a
    ? ''
    : a
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
};

export const clearFormArray = (formArray: FormArray, emitEvent = true) => {
  while (formArray.length !== 0) {
    formArray.removeAt(0, { emitEvent });
  }
};

export const countValidValues = (obj: any, ignoredKeys: string[] = []): number => {
  if (obj === null || obj === undefined || obj === '') {
    return 0;
  }

  if (Array.isArray(obj)) {
    return obj.some(item => countValidValues(item, ignoredKeys) > 0) ? 1 : 0;
  }

  if (typeof obj === 'object') {
    return Object.entries(obj)
      .filter(([key]) => !ignoredKeys.includes(key))
      .reduce((count, [, value]) => count + (countValidValues(value, ignoredKeys) > 0 ? 1 : 0), 0);
  }

  // Si c'est une valeur primitive valide, on compte 1
  return 1;
};
