package com.skytrix.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import static com.skytrix.exception.ExceptionMessage.INVALID_CREDENTIALS;

import java.io.IOException;
import java.util.HashMap;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.www.BasicAuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class AuthEntryPoint extends BasicAuthenticationEntryPoint {

	@Override
	public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authEx)
			throws IOException {
		var result = new HashMap<String, String>();
		var status = HttpStatus.UNAUTHORIZED.value();
		response.setStatus(status);
		result.put("message", INVALID_CREDENTIALS.getMessage());
		response.getOutputStream().write(new ObjectMapper().writeValueAsBytes(result));
	}

	@Override
	public void afterPropertiesSet() {
		setRealmName("Skytrix");
		super.afterPropertiesSet();
	}
}