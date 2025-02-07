package com.skytrix.model.dto.yugipro;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonProperty;

import lombok.Data;

@Data
public class MiscInfoDTO {
	@JsonProperty("tcg_date")
	private Date tcgDate;
}
