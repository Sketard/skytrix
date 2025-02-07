package com.skytrix.model.dto.card;

import java.util.List;

import com.skytrix.model.enums.Type;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class CardFilterDTO {
    private Integer minAtk;
    private Integer maxAtk;
    private Integer minDef;
    private Integer maxDef;
    private String name;
    private String attribute;
    private String archetype;
    private Short scale;
    private Short linkval;
    private List<Type> types;
    private CardSetFilterDTO cardSetFilter;
    private boolean favorite;
}
