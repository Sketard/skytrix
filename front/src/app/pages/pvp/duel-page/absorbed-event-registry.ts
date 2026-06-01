// =============================================================================
// absorbed-event-registry.ts — U16 (2026-06-01)
// -----------------------------------------------------------------------------
// Registre des flux events absorbés par un `RewriterRule` du DEP. Mirror
// structurel de `virtual-event-registry.ts` (β.3 cas #12) : un `WeakSet` keyed
// by event object, GC-friendly, pas de leak.
//
// Un event est "absorbé" quand `DeferredEffectProcessor.observe(event, ref)`
// retourne `{absorbed: true}` — i.e. au moins un `RewriterRule` actif a matché
// l'event via `chainTo` et retourné `'absorb'` / `'absorb-and-close'`. La
// sémantique côté orchestrator : l'event est consommé par la rule (animation
// déjà jouée via les MSG_MOVE virtuels qu'elle a injectés), donc :
//
//   1. SKIP le dispatch aval (`processEvent` retourne 0 sans router).
//   2. SKIP l'ingest dans le journal game-log (filter alongside `isVirtual`).
//   3. Les `AnimationStarted` / `AnimationCompleted` markers sont quand même
//      émis via le path normal (`_dispatchEvent.emitAnimationStarted` +
//      `runner.onStepSettled`) pour garder une lifecycle pair par event.
//
// Concrètement aujourd'hui : `xyzLeaveWithMaterials` (seule `RewriterRule`
// shipped à β.3) absorbe les MSG_MOVE de settling GRAVE→GRAVE / EXTRA→EXTRA
// que OCGCore émet en parallèle des virtuels OVERLAY→GRAVE synthétisés par
// la rule. Sans absorb, le journal afficherait N entrées "→ went to Graveyard"
// pour ces settlings réels.
// =============================================================================

const ABSORBED_EVENTS = new WeakSet<object>();

/**
 * Tag un event comme absorbé par un `RewriterRule` du DEP. Retourne le même
 * objet pour chaînage fluide.
 */
export function tagAsAbsorbed<T extends object>(event: T): T {
  ABSORBED_EVENTS.add(event);
  return event;
}

/**
 * Vérifie si un event a été tagué absorbed. Safe sur tout type d'event —
 * les non-tagués retournent `false`.
 */
export function isAbsorbed(event: object): boolean {
  return ABSORBED_EVENTS.has(event);
}
