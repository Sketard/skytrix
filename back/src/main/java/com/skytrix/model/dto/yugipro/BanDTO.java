package com.skytrix.model.dto.yugipro;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
public class BanDTO {
    @JsonProperty("ban_tcg")
    private String banTcg;

    public short getBanTcg() {
        if (banTcg == null) {
            return 3;
        }
        return switch (banTcg) {
            case "Forbidden" -> 0;
            case "Limited" -> 1;
            case "Semi-Limited" -> 2;
            default -> 3;
        };
    }
}
