package com.skytrix.model.dto.room;

import com.skytrix.model.enums.RoomMode;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class CreateRoomDTO {

    /** Required in STANDARD mode, ignored in BOOSTER mode. */
    private Long decklistId;

    private RoomMode mode = RoomMode.STANDARD;

    // --- BOOSTER mode only ---
    private String boosterSetName;

    @Min(1)
    @Max(40)
    private Integer boosterCount;

    @Min(1)
    @Max(60)
    private Integer minMainDeckSize;
}
