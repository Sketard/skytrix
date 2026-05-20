package com.skytrix.model.dto.deck;

import java.time.Instant;
import java.util.List;

import lombok.Data;

@Data
public class ShortDeckDTO {
	private Long id;
	private String name;
	private List<String> urls;
	// Main deck card count (Phase 2.10) — surfaced in the deck picker grid
	// so the user can see at a glance whether a deck is ready to play.
	private int mainDeckCount;
	// True when the deck satisfies the card-count rules (MAIN ∈ [40,60],
	// EXTRA ≤ 15, SIDE ≤ 15). False = the deck is "incomplete". Independent
	// from ban-list legality — see banlistLegal.
	private boolean valid;
	// True when every card respects its ban-list copy limit, counted
	// globally across main + extra + side. False = the deck is count-valid
	// but plays an over-the-limit card; the picker dims it with a ban-list
	// reason tooltip just like an incomplete deck.
	private boolean banlistLegal;
	// Wall-clock timestamp of the most recent save (V016 migration,
	// 2026-05-18). Drives the deck-list "Recent" sort mode on the front.
	private Instant updatedAt;
}