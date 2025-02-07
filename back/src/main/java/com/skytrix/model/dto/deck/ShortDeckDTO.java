package com.skytrix.model.dto.deck;

import java.util.List;

import lombok.Data;

@Data
public class ShortDeckDTO {
	private Long id;
	private String name;
	private List<String> urls;
}