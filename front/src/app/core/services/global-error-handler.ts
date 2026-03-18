import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ClientLogService } from './client-log.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly logService = inject(ClientLogService);

  handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? '' : '';
    this.logService.error(message, stack);
    this.logService.originalConsole.error(error);
  }
}
