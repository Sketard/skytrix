package com.skytrix.model.dto.deck;

import jakarta.validation.constraints.Size;

import java.util.List;

import lombok.Data;

@Data
public class CreateDeckDTO {
    private Long id;

    private String name;

    @Size(max = 3)
    private List<EntityIndexDTO> imageIds;

    @Size(max = 60)
    private List<EntityIndexDTO> mainIds;

    @Size(max = 15)
    private List<EntityIndexDTO> extraIds;

    @Size(max = 15)
    private List<EntityIndexDTO> sideIds;
}
