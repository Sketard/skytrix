package com.skytrix.security.jwt;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.Arrays;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;

public class JWTAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

	public JWTAuthenticationFilter(RequestMatcher requiresAuthenticationRequestMatcher, AuthenticationManager authManager, AuthenticationFailureHandler failureHandler) {
		super(requiresAuthenticationRequestMatcher);
		setAuthenticationManager(authManager);
		setAuthenticationFailureHandler(failureHandler);
	}

	@Override
	public Authentication attemptAuthentication(HttpServletRequest request, HttpServletResponse response) throws AuthenticationException {
		var token = extractTokenFromCookie(request);

		if (token == null || token.isEmpty()) {
			throw new UsernameNotFoundException("Invalid credentials");
		}
		var authentication = new JWTAuthentication(token, null);
		return getAuthenticationManager().authenticate(authentication);
	}

	@Override
	protected void successfulAuthentication(final HttpServletRequest request, final HttpServletResponse response, final FilterChain chain, final Authentication authResult) throws IOException, ServletException {
		SecurityContextHolder.getContext().setAuthentication(authResult);
		chain.doFilter(request, response);
	}

	private String extractTokenFromCookie(HttpServletRequest request) {
		var cookies = request.getCookies();
		if (cookies == null) return null;
		return Arrays.stream(cookies)
				.filter(c -> "Access".equals(c.getName()))
				.map(Cookie::getValue)
				.findFirst()
				.orElse(null);
	}
}
