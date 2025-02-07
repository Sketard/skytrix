package com.skytrix.exception;

import org.springframework.security.core.AuthenticationException;

public class InvalidRefreshTokenException extends AuthenticationException {
	public InvalidRefreshTokenException(String msg) {
		super(msg);
	}
}
