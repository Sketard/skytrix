package com.skytrix.model.dto.room;

import java.time.Instant;

import com.skytrix.model.dto.user.ShortUserDTO;
import com.skytrix.model.enums.RoomStatus;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class RoomDTO {

    private Long id;
    private String roomCode;
    private RoomStatus status;
    private ShortUserDTO player1;
    private ShortUserDTO player2;
    private String duelServerId;
    private String wsToken;
    private Long decklistId;
    private Instant createdAt;
}
