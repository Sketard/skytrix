package com.skytrix.model.dto.room;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class QuickDuelResponseDTO {

    private String roomCode;
    private String wsToken1;
    private String wsToken2;
}
