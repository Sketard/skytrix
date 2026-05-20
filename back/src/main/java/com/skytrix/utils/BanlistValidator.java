package com.skytrix.utils;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardDeckIndex;

/**
 * Ban-list legality checks for a deck. Copy limits follow the official
 * TCG/OCG rule: a card's allowed count is counted GLOBALLY across the
 * main + extra + side decks combined (not per-zone).
 *
 * {@code Card.banInfo}: 0 = forbidden, 1 = limited, 2 = semi-limited,
 * 3 (or null) = unlimited. A card is in violation when its total copy
 * count exceeds {@code banInfo}.
 */
public final class BanlistValidator {

	/** Allowed copy count when a card has no recorded ban-list status. */
	private static final short UNLIMITED = 3;

	private BanlistValidator() {
	}

	/** Allowed copies for a card — treats a null {@code banInfo} as unlimited. */
	public static short allowedCopies(Card card) {
		var banInfo = card.getBanInfo();
		return banInfo == null ? UNLIMITED : banInfo;
	}

	/**
	 * Returns true when every card respects its global copy limit.
	 */
	public static boolean isLegal(List<CardDeckIndex> deckCards) {
		return firstViolation(deckCards).isEmpty();
	}

	/**
	 * Returns the first card whose total copy count exceeds its ban-list
	 * limit, or empty when the deck is ban-list legal. Cards are grouped by
	 * id (not object identity) so copies spread across zones — which may map
	 * to distinct {@code Card} instances — still count as the same card.
	 */
	public static Optional<Card> firstViolation(List<CardDeckIndex> deckCards) {
		Map<Long, List<Card>> cardsById = deckCards.stream()
				.map(CardDeckIndex::getCard)
				.collect(Collectors.groupingBy(Card::getId));
		return cardsById.values().stream()
				.filter(copies -> copies.size() > allowedCopies(copies.get(0)))
				.map(copies -> copies.get(0))
				.findFirst();
	}
}
