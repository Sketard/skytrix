// =============================================================================
// virtual-event-registry.ts — β.3 cas #12 (2026-05-26)
// -----------------------------------------------------------------------------
// Registre des MSG_MOVE virtuels synthétisés par les `RewriterRule` du DEP.
// Permet de distinguer un event serveur d'un event synthétique sans polluer
// le protocole WS (asymétrie front/back qui polluerait le contrat).
//
// `WeakSet` : garbage-collected automatiquement quand l'event est dropped de
// partout (queue, stream, références internes). Aucune fuite mémoire possible.
//
// Cf. décision E2 architecture review β.3 cas #12 — `_virtual: true` n'est PAS
// dans le protocole WS. Visibilité debug préservée via décoration au dump
// (`DuelDebugService.snapshot()`).
// =============================================================================

const VIRTUAL_EVENTS = new WeakSet<object>();

/**
 * Tag un event (typiquement un `MSG_MOVE` synthétique) comme virtuel.
 * Retourne le même objet pour chaînage fluide :
 *
 *   const virtual = tagAsVirtual({ type: 'MSG_MOVE', ... });
 */
export function tagAsVirtual<T extends object>(event: T): T {
  VIRTUAL_EVENTS.add(event);
  return event;
}

/**
 * Vérifie si un event a été tagué virtuel. Safe sur tout type d'event —
 * les non-tagués retournent `false`.
 */
export function isVirtual(event: object): boolean {
  return VIRTUAL_EVENTS.has(event);
}
