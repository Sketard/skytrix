package com.skytrix.model.dto.yugipro;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class YugiproImageDTO {
    private Long id;

    @JsonProperty("image_url")
    private String url;

    @JsonProperty("image_url_small")
    private String urlSmall;

    @JsonProperty("image_url_cropped")
    private String urlCropped;
}
