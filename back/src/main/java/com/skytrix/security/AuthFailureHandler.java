package com.skytrix.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import static com.skytrix.exception.ExceptionMessage.INVALID_CREDENTIALS;

import java.io.IOException;
import java.util.HashMap;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;


@Component
public class AuthFailureHandler implements AuthenticationFailureHandler {

	@Override
	public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response, AuthenticationException exception) throws IOException {
		var result = new HashMap<String, String>();
		var status = HttpStatus.UNAUTHORIZED.value();
		response.setStatus(status);
		result.put("message", INVALID_CREDENTIALS.getMessage());
		response.getOutputStream().write(new ObjectMapper().writeValueAsBytes(result));
	}
}
