package com.skytrix.model.dto.yugipro;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.List;
import java.util.Objects;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class YugiproCardDTO {
    private Long id;
    private String name;
    private String type;
    private String frameType;
    @JsonProperty("desc")
    private String description;
    private Integer atk;
    private Integer def;
    private Short level;
    private String race;
    private String attribute;
    private String archetype;
    private Short scale;
    private Short linkval;
    private List<String> linkmarkers;
    @JsonProperty("card_sets")
    private List<YugiproSetDTO> sets;
    @JsonProperty("card_images")
    private List<YugiproImageDTO> images;
    @JsonProperty("banlist_info")
    private BanDTO banInfo;
    @JsonProperty("misc_info")
    private List<MiscInfoDTO> miscInfo;

    public short getTcgBanInfo() {
        if (banInfo != null) {
            return banInfo.getBanTcg();
        } else {
            return 3;
        }
    }

    public LocalDate getFirstTcgRelease() {
        return getMiscInfo()
                .stream()
                .map(MiscInfoDTO::getTcgDate)
                .filter(Objects::nonNull)
                .min(Date::compareTo)
                .map(date -> date.toInstant().atZone(ZoneId.systemDefault()).toLocalDate())
                .orElse(null);
    }

    public Integer getGenesysPoint() {
        return getMiscInfo()
            .stream()
            .map(MiscInfoDTO::getGenesysPoint)
            .filter(Objects::nonNull)
            .findAny()
            .orElse(0);
    }
}
