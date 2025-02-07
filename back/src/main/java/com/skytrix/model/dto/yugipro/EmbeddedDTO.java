package com.skytrix.model.dto.yugipro;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class EmbeddedDTO {
    private List<YugiproCardDTO> data;
}
