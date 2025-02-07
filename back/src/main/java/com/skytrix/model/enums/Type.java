package com.skytrix.model.enums;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;

@Getter
public enum Type {
    FUSION("Fusion"),
    SYNCHRO("Synchro"),
    XYZ("XYZ"),
    LINK("Link"),
    MONSTER("Monster"),
    RITUAL("Ritual"),
    PENDULUM("Pendulum"),
    TOON("Toon"),
    TUNER("Tuner"),
    UNION("Union"),
    GEMINI("Gemini"),
    FLIP("Flip"),
    EFFECT("Effect"),
    NORMAL("Normal"),
    SPELL("Spell"),
    TRAP("Trap"),
    TOKEN("Token"),
    SKILL("Skill");

    private final String stringValue;

    Type(String stringValue) {
        this.stringValue = stringValue;
    }

    public static List<Type> getType(String cardTypes) {
        List<Type> types = new ArrayList<>();
        for (Type type: Type.values()) {
            if (cardTypes.contains(type.stringValue)) {
                types.add(type);
            }
        }
        return types;
    }

    public static List<Type> getType(List<String> cardTypes) {
        List<Type> types = new ArrayList<>();
        for (Type type: Type.values()) {
            if (cardTypes.contains(type.name())) {
                types.add(type);
            }
        }
        return types;
    }

    public static List<Type> getExtraType() {
        return List.of(SYNCHRO, XYZ, LINK, FUSION);
    }
}
