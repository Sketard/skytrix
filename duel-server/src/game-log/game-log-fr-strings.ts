// =============================================================================
// game-log-fr-strings.ts — i18n-key → French-string table (server-only)
// -----------------------------------------------------------------------------
// O9: the GameLogBuilder emits stable i18n KEYS, not French strings — the
// Angular component owns the translation and EN comes free. But the CLI's
// Markdown / HTML renderers are DEV ARTEFACTS, not i18n-bound: they must keep
// rendering readable French so `a8859c98.html` stays a visual reference.
//
// This table is the renderers' translation layer. It is the FR mirror of the
// `gameLog.*` keys the front-end's `fr.json` will carry (Lot 6c) — same keys,
// same strings, but co-located with the dev renderers so the CLI has zero
// dependency on the Angular i18n bundle.
//
// PURITY: pure data + one pure function. No fs/net/db — same contract as the
// rest of the `game-log/` module.
// =============================================================================

/**
 * i18n key → French string. Every key the `GameLogBuilder` can emit
 * (`gameLog.verb.*`, `gameLog.phase.*`, `gameLog.winReason.*`,
 * `gameLog.separator.*`) is listed here. The renderers translate through
 * `frString()`; an unknown key falls back to the key itself so a missing
 * entry is loud, not silent.
 */
export const KEY_TO_FR: Readonly<Record<string, string>> = {
  // --- Move verbs (MovedCard.verb) -------------------------------------------
  'gameLog.verb.draw': 'Pioche',
  'gameLog.verb.add': 'Ajout',
  'gameLog.verb.discard': 'Défausse',
  'gameLog.verb.sendGy': 'Envoi au GY',
  'gameLog.verb.banish': 'Bannissement',
  'gameLog.verb.returnDeck': 'Retour au deck',
  'gameLog.verb.returnHand': 'Retour en main',
  'gameLog.verb.returnExtra': 'Retour à l\'Extra',
  'gameLog.verb.normalSummon': 'Inv. Normale',
  'gameLog.verb.specialSummon': 'Inv. Spéciale',
  'gameLog.verb.fusionSummon': 'Inv. Fusion',
  'gameLog.verb.ritualSummon': 'Inv. Rituelle',
  'gameLog.verb.synchroSummon': 'Inv. Synchro',
  'gameLog.verb.xyzSummon': 'Inv. Xyz',
  'gameLog.verb.linkSummon': 'Inv. Lien',
  'gameLog.verb.set': 'Pose',
  'gameLog.verb.flip': 'Inv. par Flip',
  'gameLog.verb.attach': 'Matériau',
  'gameLog.verb.move': 'Déplacement',
  'gameLog.verb.tribute': 'Tribut',
  'gameLog.verb.material': 'Matériau',
  'gameLog.verb.changePos': 'Changement de position',

  // --- Phase names (PHASE_LABEL) ---------------------------------------------
  'gameLog.phase.draw': 'Phase de Pioche',
  'gameLog.phase.standby': 'Phase Standby',
  'gameLog.phase.main1': 'Main Phase 1',
  'gameLog.phase.battle': 'Battle Phase',
  'gameLog.phase.main2': 'Main Phase 2',
  'gameLog.phase.end': 'End Phase',

  // --- Win reasons (WIN_REASON) ----------------------------------------------
  'gameLog.winReason.lpZero': 'Points de vie à 0',
  'gameLog.winReason.deckOut': 'Deck épuisé',
  'gameLog.winReason.exodia': 'Combo de victoire (Exodia)',
  'gameLog.winReason.surrender': 'Abandon',
  'gameLog.winReason.timeout': 'Temps écoulé',

  // --- Separator labels (key-pure separator kinds) ---------------------------
  'gameLog.separator.chainStart': 'Début de chaîne',
  'gameLog.separator.chainResolve': 'Résolution de la chaîne',
  'gameLog.separator.chainEnd': 'Fin de chaîne',

  // --- Zone labels (MovedCard.fromZone / destZone) ---------------------------
  // Short zone tags drawn as the source/destination of a move-row flow. `GY`,
  // `DECK`, `EXTRA`, `XYZ` are universal TCG/OCG terms (untranslated in FR).
  'gameLog.zone.deck': 'DECK',
  'gameLog.zone.hand': 'MAIN',
  'gameLog.zone.monster': 'Monstre',
  'gameLog.zone.spellTrap': 'M/P',
  'gameLog.zone.grave': 'GY',
  'gameLog.zone.banished': 'BANNIE',
  'gameLog.zone.extra': 'EXTRA',
  'gameLog.zone.overlay': 'XYZ',
  'gameLog.zone.field': 'Terrain',

  // --- Action row labels (ActionEntry.labelKey) ------------------------------
  'gameLog.action.equip': 'Équipé à',
  'gameLog.action.counter': 'Compteur',
  // Counter-type fallback — the builder only knows the numeric type. The
  // `{{n}}` placeholder is filled with `ActionEntry.counterType` by the
  // renderer (ngx-translate interpolation syntax — keeps this table a true
  // mirror of the front-end `fr.json` `gameLog.*` keys).
  'gameLog.action.counterType': 'Type {{n}}',
  'gameLog.action.gyDeckSwap': 'Échange GY ↔ Deck',
  'gameLog.action.shuffleHand': 'Mélange de la main',
  'gameLog.action.shuffleDeck': 'Mélange du Deck',
  'gameLog.action.shuffleSetCard': 'Mélange des cartes posées',
  'gameLog.action.swap': 'Échange de cartes',

  // --- Combat labels & placeholders ------------------------------------------
  'gameLog.combat.directAttack': 'Attaque directe',
  'gameLog.combat.attacker': 'Attaquant',
  'gameLog.combat.defender': 'Défenseur',
  'gameLog.combat.equippedMonster': 'Monstre équipé',

  // --- RNG result tokens (RngEntry.results) ----------------------------------
  'gameLog.rng.heads': 'Face',
  'gameLog.rng.tails': 'Pile',
};

/**
 * Translate an i18n key to its French string. Unknown keys (e.g. a phase the
 * builder passed through verbatim because it had no mapping) return the key
 * itself — visible, never silent.
 */
export function frString(key: string): string {
  return KEY_TO_FR[key] ?? key;
}
