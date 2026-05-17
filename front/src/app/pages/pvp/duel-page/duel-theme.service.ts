import { Injectable, signal } from '@angular/core';

export const DUEL_THEMES = ['classic', 'cosmic', 'forest'] as const;
export type DuelTheme = (typeof DUEL_THEMES)[number];

const STORAGE_KEY = 'duel-theme';
const DEFAULT_THEME: DuelTheme = 'classic';

@Injectable({ providedIn: 'root' })
export class DuelThemeService {
  readonly currentTheme = signal<DuelTheme>(this.loadFromStorage() ?? DEFAULT_THEME);

  setTheme(theme: DuelTheme): void {
    this.currentTheme.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable (private mode / SSR) — keep runtime state only.
    }
  }

  private loadFromStorage(): DuelTheme | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return DUEL_THEMES.includes(stored as DuelTheme) ? (stored as DuelTheme) : null;
    } catch {
      return null;
    }
  }
}
