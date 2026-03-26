package com.skytrix.model.enums;

// Architecture spec defines 6 values (stored relative to player1, derived at query time).
// Implementation uses 9 values: OPPONENT_* variants preserve the "why" context in match history
// (e.g., "Win — opponent timeout" vs generic "Victory"). flip() maps between perspectives.
public enum DuelResult {
    VICTORY,
    DEFEAT,
    DRAW,
    TIMEOUT,
    DISCONNECT,
    SURRENDER,
    OPPONENT_TIMEOUT,
    OPPONENT_DISCONNECT,
    OPPONENT_SURRENDER;

    public DuelResult flip() {
        return switch (this) {
            case VICTORY -> DEFEAT;
            case DEFEAT -> VICTORY;
            case DRAW -> DRAW;
            case TIMEOUT -> OPPONENT_TIMEOUT;
            case DISCONNECT -> OPPONENT_DISCONNECT;
            case SURRENDER -> OPPONENT_SURRENDER;
            case OPPONENT_TIMEOUT -> TIMEOUT;
            case OPPONENT_DISCONNECT -> DISCONNECT;
            case OPPONENT_SURRENDER -> SURRENDER;
        };
    }
}
