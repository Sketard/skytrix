package com.skytrix.model.dto.booster;

/**
 * A card set that can be opened in booster mode.
 *
 * @param code      set prefix of its prints (e.g. "LOB"), may be null
 * @param cardCount distinct cards in the set
 */
public record BoosterSetDTO(String name, String code, long cardCount) {}
