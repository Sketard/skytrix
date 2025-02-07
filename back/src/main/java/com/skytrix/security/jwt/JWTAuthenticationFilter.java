package com.skytrix.security.jwt;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;

import com.skytrix.security.CustomUserDetails;

import lombok.Setter;

import static org.springframework.http.HttpHeaders.AUTHORIZATION;

@Setter
public class JWTAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

	private JWTService jwtService;

	public JWTAuthenticationFilter(RequestMatcher requiresAuthenticationRequestMatcher, AuthenticationManager authManager, AuthenticationFailureHandler failureHandler) {
		super(requiresAuthenticationRequestMatcher);
		setAuthenticationManager(authManager);
		setAuthenticationFailureHandler(failureHandler);
	}

	@Override
	public Authentication attemptAuthentication(HttpServletRequest request, HttpServletResponse response) throws AuthenticationException {
		String bearer = request.getHeader(AUTHORIZATION);
		var token = bearer == null ? null : bearer.replaceFirst("Bearer ", "");

		if (token == null || token.isEmpty()) {
			throw new UsernameNotFoundException("Invalid credentials");
		}
		var authentication = new JWTAuthentication(token, null);
		return getAuthenticationManager().authenticate(authentication);
	}

	@Override
	protected void successfulAuthentication(final HttpServletRequest request, final HttpServletResponse response, final FilterChain chain, final Authentication authResult) throws IOException, ServletException {
		SecurityContextHolder.getContext().setAuthentication(authResult);
		var jwt = jwtService.generateAccessToken((CustomUserDetails) authResult.getPrincipal());
		response.addHeader(AUTHORIZATION, jwt);
		chain.doFilter(request, response);
	}
}
