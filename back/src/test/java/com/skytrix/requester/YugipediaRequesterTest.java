package com.skytrix.requester;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class YugipediaRequesterTest {

    @Test
    void askQueryEncodesPlusSoTheServerDoesNotReadASpace() {
        var uri = YugipediaRequester.buildAskUri("[[French name::+]]|limit=500");
        assertEquals("https://yugipedia.com/api.php?action=ask&format=json&query=%5B%5BFrench+name%3A%3A%2B%5D%5D%7Climit%3D500", uri);
    }

    @Test
    void nonPendulumDescriptionIsTheLore() {
        assertEquals("Effet.", YugipediaRequester.buildDescription("Effet.", null));
    }

    @Test
    void pendulumDescriptionFollowsYgoprodeckLayout() {
        assertEquals("[ Pendulum Effect ] \nEffet P.\n\n[ Monster Effect ] \nEffet M.",
                YugipediaRequester.buildDescription("Effet M.", "Effet P."));
    }
}
