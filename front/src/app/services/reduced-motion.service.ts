import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

const STORAGE_KEY = 'pref-reduced-motion';
const BODY_CLASS = 'reduced-motion-forced';

/**
 * Centralised reduced-motion state — the single source of truth for whether
 * animations should be suppressed across the whole app (CSS transitions,
 * the PvP animation orchestrator, the Replay viewer).
 *
 * Two inputs feed it, additively:
 *  - `forced` — the manual override exposed in the user Preferences page,
 *    persisted in localStorage. When on, a `body.reduced-motion-forced`
 *    class is added, mirroring the SCSS rules in `_a11y.scss`.
 *  - the OS-level `prefers-reduced-motion: reduce` media query.
 *
 * `enabled` is the resolved value — `true` when EITHER input asks for
 * reduced motion. PvP (`DuelContext`) and Replay both read `enabled`, so
 * a single toggle governs the three surfaces consistently.
 */
@Injectable({ providedIn: 'root' })
export class ReducedMotionService {
  /** Manual override from the Preferences page (persisted in localStorage). */
  readonly forced = signal<boolean>(this.loadFromStorage());

  /** Live OS-level `prefers-reduced-motion: reduce` state. */
  private readonly osReduced = signal<boolean>(
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  /** Resolved reduced-motion state — manual override OR OS preference. */
  readonly enabled = computed<boolean>(() => this.forced() || this.osReduced());

  constructor() {
    // Apply the body class SYNCHRONOUSLY in the constructor — the `effect()`
    // below tracks subsequent changes, but it won't fire until after Angular
    // bootstrap. Without this sync apply, a user with `forced=true` would
    // briefly see animations play on the first paint before the effect
    // catches up.
    this.applyClass(this.forced());

    effect(() => this.applyClass(this.forced()));

    const mql = matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => this.osReduced.set(e.matches);
    mql.addEventListener('change', handler);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', handler));
  }

  private applyClass(on: boolean): void {
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    body.classList.toggle(BODY_CLASS, on);
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
