package com.skytrix.model.dto.deck;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

import com.skytrix.model.enums.TransferType;

import lombok.Data;

@Data
public class ExportDeckDTO {
	@NotBlank
	private String name;
	@Size(max = 60)
	private List<Long> mainIds;
	@Size(max = 15)
	private List<Long> extraIds;
	@Size(max = 15)
	private List<Long> sideIds;
	@NotNull
	private TransferType transferType;
}
