package com.skytrix.model.enums;

public enum RoomStatus {
    WAITING,
    /**
     * Both players have picked a deck; awaiting the creator's explicit "start
     * duel" click. The creator may also kick the joiner back to WAITING from
     * this state. Status is purely a UX checkpoint — no duel-server resources
     * have been allocated yet.
     */
    READY,
    CREATING_DUEL,
    ACTIVE,
    ENDED,
    CLOSED
}
