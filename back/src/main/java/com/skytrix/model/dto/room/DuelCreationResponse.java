package com.skytrix.model.dto.room;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class DuelCreationResponse {

    private String duelId;
    private String[] tokens;
}
