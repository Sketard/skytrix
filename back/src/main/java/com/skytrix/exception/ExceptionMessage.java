package com.skytrix.exception;

import lombok.Getter;

@Getter
public enum ExceptionMessage {
	INVALID_CREDENTIALS("INVALID_CREDENTIALS"),
	TOKEN_EXPIRED("TOKEN_EXPIRED");

	private final String message;

	ExceptionMessage(String message) {
		this.message = message;
	}
}
