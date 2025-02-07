package com.skytrix.security.jwt;

import java.io.Serial;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@EqualsAndHashCode(callSuper = true)
public class JWTAuthentication extends UsernamePasswordAuthenticationToken {
	@Serial
	private static final long serialVersionUID = 1L;

	public JWTAuthentication(Object principal, Object credentials) {
		super(principal, credentials);
	}
}
