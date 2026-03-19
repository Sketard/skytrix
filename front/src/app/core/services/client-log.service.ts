import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CURRENT_USER_KEY } from '../utilities/auth.constants';

interface ClientLogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  context: string;
  url: string;
  user: string;
  userAgent: string;
}

const MAX_MESSAGE_LENGTH = 4_000;

@Injectable({ providedIn: 'root' })
export class ClientLogService implements OnDestroy {
  private readonly buffer: ClientLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL = 5_000;
  private readonly MAX_BUFFER = 50;
  private readonly beforeUnloadHandler = () => this.flushSync();

  readonly originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  constructor(private http: HttpClient) {
    if (environment.production) {
      this.patchConsole();
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
  }

  error(message: string, context = ''): void {
    this.push('error', message, context);
  }

  warn(message: string, context = ''): void {
    this.push('warn', message, context);
  }

  info(message: string, context = ''): void {
    this.push('info', message, context);
  }

  flush(): void {
    if (!this.buffer.length) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const entries = this.buffer.splice(0);
    this.http.post(`${environment.apiUrl}/client-logs`, entries).subscribe({
      error: () => {}
    });
  }

  private flushSync(): void {
    if (!this.buffer.length) return;
    const entries = this.buffer.splice(0);
    const blob = new Blob([JSON.stringify(entries)], { type: 'application/json' });
    navigator.sendBeacon(`${environment.apiUrl}/client-logs`, blob);
  }

  private patchConsole(): void {
    console.log = (...args: unknown[]) => {
      this.originalConsole.log(...args);
      this.push('info', this.stringify(...args), '');
    };
    console.warn = (...args: unknown[]) => {
      this.originalConsole.warn(...args);
      this.push('warn', this.stringify(...args), '');
    };
    console.error = (...args: unknown[]) => {
      this.originalConsole.error(...args);
      this.push('error', this.stringify(...args), '');
    };
  }

  private stringify(...args: unknown[]): string {
    return args.map(a => {
      if (a === null || a === undefined) return String(a);
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a !== 'object') return String(a);
      try {
        return JSON.stringify(a);
      } catch {
        return `[unserializable: ${Object.prototype.toString.call(a)}]`;
      }
    }).join(' ');
  }

  private truncate(value: string): string {
    return value.length > MAX_MESSAGE_LENGTH
      ? value.substring(0, MAX_MESSAGE_LENGTH) + '...[truncated]'
      : value;
  }

  private resolveUser(): string {
    try {
      const raw = localStorage.getItem(CURRENT_USER_KEY);
      if (!raw) return 'anonymous';
      return JSON.parse(raw).pseudo ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private push(level: ClientLogEntry['level'], message: string, context: string): void {
    if (!environment.production) return;
    this.buffer.push({
      timestamp: new Date().toISOString(),
      level,
      message: this.truncate(message),
      context: this.truncate(context),
      url: window.location.pathname,
      user: this.resolveUser(),
      userAgent: navigator.userAgent,
    });
    if (this.buffer.length >= this.MAX_BUFFER) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
  }
}
