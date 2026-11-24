package com.skytrix.model.dto.yugipedia;

/**
 * French text of one card as published by Yugipedia, already cleaned of wiki markup.
 *
 * @param passcode    card password (= {@code Card.passcode})
 * @param name        French name
 * @param description French lore; for Pendulum monsters, pendulum effect and monster text joined
 *                    in the same layout YGOPRODeck uses
 */
public record YugipediaTranslationDTO(Long passcode, String name, String description) {
}
