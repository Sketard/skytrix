package com.skytrix.model.enums;

import java.util.HashMap;
import java.util.Map;

import lombok.Getter;

@Getter
public enum Race {
    DRAGON("Dragon"),
    AQUA("Aqua"),
    NORMAL("Normal"), // for spell and trap
    REPTILE("Reptile"),
    SEA_SERPENT("Sea Serpent"),
    CYBERSE("Cyberse"),
    CREATOR_GOD("Creator-God"),
    ROCK("Rock"),
    ILLUSION("Illusion"),
    CONTINUOUS("Continuous"),
    SPELLCASTER("Spellcaster"),
    WYRM("Wyrm"),
    PLANT("Plant"),
    ZOMBIE("Zombie"),
    COUNTER("Counter"),
    FIELD("Field"),
    MACHINE("Machine"),
    THUNDER("Thunder"),
    WINGED_BEAST("Winged Beast"),
    EQUIP("Equip"),
    PYRO("Pyro"),
    BEAST("Beast"),
    RITUAL("Ritual"),
    FISH("Fish"),
    FAIRY("Fairy"),
    PSYCHIC("Psychic"),
    INSECT("Insect"),
    DINOSAUR("Dinosaur"),
    BEAST_WARRIOR("Beast-Warrior"),
    WARRIOR("Warrior"),
    QUICK_PLAY("Quick-Play"),
    FIEND("Fiend"),
    DIVINE_BEAST("Divine-Beast"),
    OTHER("other");

    private final String stringValue;

    Race(String stringValue){
        this.stringValue = stringValue;
    }

    public static Race getRace(String cardRace) {
        return mapStringRace.getOrDefault(cardRace, OTHER);
    }

    private static final Map<String, Race> mapStringRace = new HashMap<>();

    static {
        for (Race race : Race.values()) {
            mapStringRace.put(race.stringValue, race);
        }
    }

}
