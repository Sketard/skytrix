package com.skytrix.mapper;

import jakarta.inject.Inject;

import org.mapstruct.Mapper;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.skytrix.model.dto.user.CreateUserDTO;
import com.skytrix.model.dto.user.ShortUserDTO;
import com.skytrix.model.entity.User;

@Mapper(componentModel = "spring")
public abstract class UserMapper {
	@Inject
	private PasswordEncoder passwordEncoder;

	public User toUser(CreateUserDTO source) {
		var target = new User();
		target.setPseudo(source.getPseudo());
		target.setPassword(passwordEncoder.encode(source.getPassword()));
		return target;
	}

	public abstract ShortUserDTO toShortUserDTO(User connectedUser);
}
