package com.skytrix.model.dto.yugipro;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class YugiproSetDTO {
    @JsonProperty("set_name")
    private String name;

    @JsonProperty("set_code")
    private String code;

    @JsonProperty("set_rarity")
    private String rarity;

    @JsonProperty("set_rarity_code")
    private String rarityCode;

    @JsonProperty("set_price")
    private float price;
}
