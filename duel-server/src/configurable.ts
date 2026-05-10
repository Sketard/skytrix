/**
 * Two-phase init helper for the `configureXxx({...})` modules extracted
 * during H1 (http-routes, replay-handlers, timer-management, solver-handlers).
 *
 * Each of those modules used to repeat the same 4-line pattern:
 *
 *   let cfg: TheConfig | null = null;
 *   export function configureXxx(config: TheConfig): void { cfg = config; }
 *   function getCfg(): TheConfig {
 *     if (!cfg) throw new Error('xxx: configureXxx() not called');
 *     return cfg;
 *   }
 *
 * `createConfigurable<T>(name)` returns a `{ configure, get, isConfigured }`
 * triple that captures that exact contract — `name` is folded into the
 * not-configured error so the message stays self-describing.
 */
export interface Configurable<T> {
  /** Install the config. Idempotent — last write wins. */
  configure(config: T): void;
  /** Read the config. Throws if not configured. */
  get(): T;
  /** True iff `configure` was called at least once. Used by the boot-time
   *  invariant "all modules configured before wss.on('connection')". */
  isConfigured(): boolean;
}

export function createConfigurable<T>(name: string): Configurable<T> {
  let cfg: T | null = null;
  return {
    configure(config: T): void {
      cfg = config;
    },
    get(): T {
      if (cfg === null) {
        throw new Error(`${name}: configure${capitalize(name)}() not called`);
      }
      return cfg;
    },
    isConfigured(): boolean {
      return cfg !== null;
    },
  };
}

function capitalize(s: string): string {
  // Convert "http-routes" → "HttpRoutes" so the message reads "configureHttpRoutes()".
  return s.split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
