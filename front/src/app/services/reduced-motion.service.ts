import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'pref-reduced-motion';
const BODY_CLASS = 'reduced-motion-forced';

/**
 * Manual reduced-motion override exposed in the user Preferences page.
 *
 * Independent of the OS-level `prefers-reduced-motion: reduce` media query:
 * when forced via this service, a `body.reduced-motion-forced` class is added,
 * mirroring the same SCSS rules (`_a11y.scss`). The two paths are additive —
 * either one triggers the global animation/transition kill.
 */
@Injectable({ providedIn: 'root' })
export class ReducedMotionService {
  readonly forced = signal<boolean>(this.loadFromStorage());

  constructor() {
    effect(() => {
      const on = this.forced();
      const body = typeof document !== 'undefined' ? document.body : null;
      if (!body) return;
      body.classList.toggle(BODY_CLASS, on);
    });
  }

  set(value: boolean): void {
    this.forced.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // localStorage unavailable (private mode / SSR) — runtime state only.
    }
  }

  toggle(): void {
    this.set(!this.forced());
  }

  private loadFromStorage(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
