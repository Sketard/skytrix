package com.skytrix.model.enums;

/** Provider of a card image file. */
public enum ImageSource {
    /** Clean render downloaded from YGOPRODeck, fetched again by the image syncs when missing. */
    YGOPRODECK,
    /** Alternate artwork built from a Yugipedia card scan; the YGOPRODeck flows leave it alone. */
    YUGIPEDIA
}
