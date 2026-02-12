import { signal } from '@angular/core';

const GLOW_DURATION_MS = 400;

export function createGlowEffect() {
  const justDropped = signal(false);
  let glowTimeout: ReturnType<typeof setTimeout> | undefined;

  return {
    justDropped: justDropped.asReadonly(),

    triggerGlow(): void {
      if (glowTimeout) {
        clearTimeout(glowTimeout);
        justDropped.set(false);
      }
      requestAnimationFrame(() => {
        justDropped.set(true);
        glowTimeout = setTimeout(() => {
          justDropped.set(false);
          glowTimeout = undefined;
        }, GLOW_DURATION_MS);
      });
    },

    onGlowAnimationEnd(): void {
      if (glowTimeout) {
        clearTimeout(glowTimeout);
        glowTimeout = undefined;
      }
      justDropped.set(false);
    },
  };
}
