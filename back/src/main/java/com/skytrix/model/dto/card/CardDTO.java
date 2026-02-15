package com.skytrix.model.dto.card;

import com.skytrix.model.enums.Attribute;
import com.skytrix.model.enums.Race;
import com.skytrix.model.enums.Type;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
public class CardDTO {
    private Long id;
    private String name;
    private String description;
    private long passcode;
    private List<Type> types;
    private String frameType;
    private Integer atk;
    private Integer def;
    private Short level;
    private Race race;
    private Attribute attribute;
    private String archetype;
    private Short scale;
    private Short linkval;
    private List<String> linkmarkers;
    private boolean extraCard;
    private Short banInfo;
    private Integer genesysPoint;
}
