package com.skytrix.model.dto.user;

import com.skytrix.model.enums.Role;

import lombok.Data;

@Data
public class ShortUserDTO {
	private Long id;
	private String pseudo;
	private Role role;
}
