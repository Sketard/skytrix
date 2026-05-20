package com.skytrix.utils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardDeckIndex;
import com.skytrix.model.enums.DeckKeyword;

class BanlistValidatorTest {

    /** A Card with a fixed id and ban-list status (null = unlimited). */
    private Card card(long id, Short banInfo) {
        Card c = new Card();
        c.setId(id);
        c.setBanInfo(banInfo);
        return c;
    }

    /** N CardDeckIndex entries for the same card, in the given zone. */
    private List<CardDeckIndex> copies(Card card, int count, DeckKeyword zone) {
        List<CardDeckIndex> list = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            CardDeckIndex idx = new CardDeckIndex();
            idx.setCard(card);
            idx.setType(zone);
            idx.setIndex(i);
            list.add(idx);
        }
        return list;
    }

    @Test
    void legalWhenEveryCardIsWithinItsLimit() {
        Card unlimited = card(1, (short) 3);
        Card limited = card(2, (short) 1);
        List<CardDeckIndex> deck = new ArrayList<>();
        deck.addAll(copies(unlimited, 3, DeckKeyword.MAIN));
        deck.addAll(copies(limited, 1, DeckKeyword.MAIN));

        assertTrue(BanlistValidator.isLegal(deck));
        assertTrue(BanlistValidator.firstViolation(deck).isEmpty());
    }

    @Test
    void nullBanInfoTreatedAsUnlimited() {
        Card noBan = card(1, null);
        assertTrue(BanlistValidator.isLegal(copies(noBan, 3, DeckKeyword.MAIN)));
        assertFalse(BanlistValidator.isLegal(copies(noBan, 4, DeckKeyword.MAIN)));
    }

    @Test
    void flagsLimitedCardPresentTwice() {
        Card limited = card(5, (short) 1);
        List<CardDeckIndex> deck = copies(limited, 2, DeckKeyword.MAIN);

        assertFalse(BanlistValidator.isLegal(deck));
        assertEquals(5L, BanlistValidator.firstViolation(deck).orElseThrow().getId());
    }

    @Test
    void flagsForbiddenCardPresentAtAll() {
        Card forbidden = card(9, (short) 0);
        assertFalse(BanlistValidator.isLegal(copies(forbidden, 1, DeckKeyword.MAIN)));
    }

    @Test
    void countsCopiesGloballyAcrossZones() {
        // A limited card with 1 copy in each of main / side / extra — legal
        // per zone but 3 globally.
        Card limited = card(7, (short) 1);
        List<CardDeckIndex> deck = new ArrayList<>();
        deck.addAll(copies(limited, 1, DeckKeyword.MAIN));
        deck.addAll(copies(limited, 1, DeckKeyword.SIDE));
        deck.addAll(copies(limited, 1, DeckKeyword.EXTRA));

        assertFalse(BanlistValidator.isLegal(deck));
        assertEquals(7L, BanlistValidator.firstViolation(deck).orElseThrow().getId());
    }

    @Test
    void emptyDeckIsLegal() {
        assertTrue(BanlistValidator.isLegal(new ArrayList<>()));
    }
}
