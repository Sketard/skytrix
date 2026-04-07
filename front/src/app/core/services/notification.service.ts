import { inject, Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { SnackbarComponent } from '../../components/snackbar/snackbar.component';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);

  error(errorOrKey: HttpErrorResponse | string, params?: Record<string, unknown>, duration = 4000): void {
    this.show('error', 'error', this.resolve(errorOrKey, params), duration);
  }

  success(key: string, params?: Record<string, unknown>, duration = 2000): void {
    this.show('success', 'check_circle', this.translate.instant(key, params), duration);
  }

  private show(type: string, icon: string, message: string, duration: number): void {
    this.snackBar.openFromComponent(SnackbarComponent, {
      data: { message, type, icon },
      duration,
      verticalPosition: 'top',
      horizontalPosition: 'center',
      panelClass: 'snackbar-panel',
    });
  }

  private resolve(errorOrKey: HttpErrorResponse | string, params?: Record<string, unknown>): string {
    if (typeof errorOrKey === 'string') {
      return this.translate.instant(errorOrKey, params);
    }
    const code = errorOrKey.error?.code ?? errorOrKey.error?.error;
    if (code) {
      const key = `error.${code}`;
      const translated = this.translate.instant(key);
      if (translated !== key) return translated;
    }
    return this.translate.instant('error.UNKNOWN');
  }
}
