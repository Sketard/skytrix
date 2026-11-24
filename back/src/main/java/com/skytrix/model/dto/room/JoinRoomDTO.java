package com.skytrix.model.dto.room;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class JoinRoomDTO {

    /** Required to join a STANDARD room, ignored for a BOOSTER room. */
    private Long decklistId;
}
