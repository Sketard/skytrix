package com.skytrix.model.dto.room;

import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class CreateRoomDTO {

    @NotNull
    private Long decklistId;
}
