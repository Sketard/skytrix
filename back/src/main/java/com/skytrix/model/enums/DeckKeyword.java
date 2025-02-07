package com.skytrix.model.enums;

import java.util.Arrays;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

@Getter
@Slf4j
public enum DeckKeyword {
	MAIN("#main", 40, 60),
	EXTRA("#extra", 0, 15),
	SIDE("!side", 0, 15),
	DEFAULT("", 0,0);

	private final String separator;
	private final int minSize;
	private final int maxSize;

	public static DeckKeyword getDeckKeyword(String separator) {
		return Arrays.stream(DeckKeyword.values())
				.filter(deckKeyword -> deckKeyword.separator.equals(separator))
				.findAny()
				.orElse(DEFAULT);
	}

	public static void checkValidity(int size, DeckKeyword deckKeyword) {
		var maxSize = deckKeyword.getMaxSize();
		if (size > maxSize) {
			throw new IllegalArgumentException("Size of %s bigger than the max possible. Max size allowed (%s) got (%s)".formatted(deckKeyword, maxSize, size));
		}
	}

	DeckKeyword(String separator, int minSize, int maxSize) {
		this.separator = separator;
		this.maxSize = maxSize;
		this.minSize = minSize;
	}
}
