// =============================================================================
// solver-prefs.service.ts — User preferences (mode, speed, algorithm,
// handtraps) persisted to localStorage. Extracted from SolverService to
// narrow its surface area; components and siblings inject this directly
// when they only need prefs.
// =============================================================================

import { Injectable, signal } from '@angular/core';

const PREFS_STORAGE_KEY = 'solver:prefs:v1';

export interface SolverPrefs {
  speed: 'fast' | 'optimal';
  algorithm: 'dfs' | 'mcts' | 'auto';
  mode: 'goldfish' | 'adversarial';
  handtrapIds: number[];
}

const DEFAULT_PREFS: SolverPrefs = {
  speed: 'fast',
  algorithm: 'auto',
  mode: 'goldfish',
  handtrapIds: [],
};

function loadPrefs(): SolverPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<SolverPrefs>;
    return {
      speed: parsed.speed === 'optimal' ? 'optimal' : 'fast',
      algorithm: parsed.algorithm === 'dfs' || parsed.algorithm === 'mcts' || parsed.algorithm === 'auto'
        ? parsed.algorithm
        : 'auto',
      mode: parsed.mode === 'goldfish' || parsed.mode === 'adversarial' ? parsed.mode : 'goldfish',
      handtrapIds: Array.isArray(parsed.handtrapIds) ? parsed.handtrapIds.filter(n => Number.isInteger(n)) : [],
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

@Injectable({ providedIn: 'root' })
export class SolverPrefsService {
  readonly prefs = signal<SolverPrefs>(loadPrefs());

  updatePrefs(partial: Partial<SolverPrefs>): void {
    const next: SolverPrefs = { ...this.prefs(), ...partial };
    this.prefs.set(next);
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch { /* quota / private mode — silently ignore */ }
  }
}
