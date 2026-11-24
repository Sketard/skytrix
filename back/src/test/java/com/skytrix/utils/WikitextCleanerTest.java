package com.skytrix.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class WikitextCleanerTest {

    @Test
    void nullStaysNull() {
        assertNull(WikitextCleaner.clean(null));
    }

    @Test
    void lineBreaksBecomeNewlines() {
        assertEquals("\"A\" + \"B\"\nDoit d'abord être Invoquée",
                WikitextCleaner.clean("\"A\" + \"B\" <br />Doit d'abord être Invoquée"));
    }

    @Test
    void linksKeepTheirLabel() {
        assertEquals("cartes \"Cyber Dragon\" et FLIP",
                WikitextCleaner.clean("cartes \"[[Cyber Dragon (archetype)|Cyber Dragon]]\" et [[FLIP]]"));
    }

    @Test
    void italicAndBoldMarkupIsRemoved() {
        assertEquals("Un zombie qui surgit, gras",
                WikitextCleaner.clean("''Un zombie qui surgit'', '''gras'''"));
    }

    @Test
    void entitiesAreDecoded() {
        assertEquals("Maliss <C> GWC-06 & co", WikitextCleaner.clean("Maliss <&#67;> GWC-06 &amp; co"));
    }

    @Test
    void literalAngleBracketsInCardTextAreKept() {
        assertEquals("continuer ? <O/N>...[ ]\nOv", WikitextCleaner.clean("continuer ? <O/N>...[ ]<br />Ov"));
    }

    @Test
    void knownHtmlTagsAreStripped() {
        assertEquals("texte important", WikitextCleaner.clean("<span class=\"x\">texte</span> <b>important</b>"));
    }
}
