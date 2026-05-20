import { Injectable, computed, effect, signal } from '@angular/core';

export const APP_THEME_MODES = ['auto', 'light', 'dark'] as const;
export type AppThemeMode = (typeof APP_THEME_MODES)[number];

/** Resolved theme actually applied to the DOM (never 'auto'). */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'app-theme';
const DEFAULT_MODE: AppThemeMode = 'auto';
const LIGHT_CLASS = 'theme-light';

/**
 * Global light/dark theme for the "app" pages (login, lobby, decks,
 * card-search, parameters, preferences, replay-hub, navbar).
 *
 * The PvP duel + replay viewer are intentionally NOT themed — they carry a
 * local `.theme-dark` class that re-declares the dark tokens, so they stay
 * dark regardless of this service's resolved theme.
 *
 * Three modes:
 *  - `auto`  — follows the OS `prefers-color-scheme` media query (default).
 *  - `light` — forces light.
 *  - `dark`  — forces dark.
 *
 * Twin of `ReducedMotionService` / `DuelThemeService` — same signal +
 * localStorage + sync-apply-in-constructor pattern. The class is toggled on
 * `<html>` (documentElement) so the cascade reaches every page.
 *
 * Instantiated at boot via an `APP_INITIALIZER` in `app.config.ts`
 * (mirroring `initReducedMotion`) so the class is applied before first paint.
 */
@Injectable({ providedIn: 'root' })
export class AppThemeService {
  /** User-chosen mode (auto/light/dark). */
  readonly mode = signal<AppThemeMode>(this.loadFromStorage() ?? DEFAULT_MODE);

  /** OS preference — only consulted when `mode() === 'auto'`. */
  private readonly osPrefersLight = signal<boolean>(this.queryOsPrefersLight());

  /** The theme actually applied to the DOM. */
  readonly resolved = computed<ResolvedTheme>(() => {
    const m = this.mode();
    if (m === 'light') return 'light';
    if (m === 'dark') return 'dark';
    return this.osPrefersLight() ? 'light' : 'dark';
  });

  constructor() {
    // Apply SYNCHRONOUSLY in the constructor — the effect() below tracks
    // subsequent changes but won't fire until after bootstrap. Without this,
    // a light-mode user would see a dark flash on the first paint.
    this.applyClass(this.resolved());

    effect(() => this.applyClass(this.resolved()));

    this.watchOsPreference();
  }

  /** Set the theme mode and persist it. */
  setMode(mode: AppThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage unavailable (private mode / SSR) — runtime state only.
    }
  }

  private applyClass(theme: ResolvedTheme): void {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;
    root.classList.toggle(LIGHT_CLASS, theme === 'light');
  }

  /** Keep `osPrefersLight` in sync with the live media query. */
  private watchOsPreference(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    // `addEventListener` is the modern API; the deprecated `addListener`
    // fallback is intentionally omitted (all supported browsers have it).
    mq.addEventListener('change', e => this.osPrefersLight.set(e.matches));
  }

  private queryOsPrefersLight(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  }

  private loadFromStorage(): AppThemeMode | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return APP_THEME_MODES.includes(stored as AppThemeMode)
        ? (stored as AppThemeMode)
        : null;
    } catch {
      return null;
    }
  }
}
