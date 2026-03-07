package com.skytrix.model.dto.room;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DuelDeckDTO {

    private int[] main;
    private int[] extra;
}
