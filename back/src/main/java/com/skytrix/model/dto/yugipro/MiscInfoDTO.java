package com.skytrix.model.dto.yugipro;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.Date;

@Data
public class MiscInfoDTO {
	@JsonProperty("tcg_date")
	private Date tcgDate;
	@JsonProperty("genesys_points")
	private Integer genesysPoint;

}
