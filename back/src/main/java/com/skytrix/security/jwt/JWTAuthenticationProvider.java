package com.skytrix.security.jwt;

import jakarta.inject.Inject;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.dao.AbstractUserDetailsAuthenticationProvider;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;

import com.skytrix.exception.InvalidRefreshTokenException;
import com.skytrix.exception.TokenExpiredException;
import com.skytrix.repository.UserRepository;
import com.skytrix.security.CustomUserDetails;

@Component
public class JWTAuthenticationProvider extends AbstractUserDetailsAuthenticationProvider {
	@Inject
	private UserRepository userRepository;
	@Inject
	private JWTService jwtService;

	@Override
	protected void additionalAuthenticationChecks(UserDetails userDetails,
			UsernamePasswordAuthenticationToken authentication) throws AuthenticationException {
		// No additional checks
	}

	@Override
	protected UserDetails retrieveUser(String username, UsernamePasswordAuthenticationToken authentication) throws AuthenticationException {
		var token = authentication.getPrincipal();
		CustomUserDetails user;
		try {
			user = jwtService.getUser(String.valueOf(token));
		} catch(TokenExpiredException | InvalidRefreshTokenException e) {
			throw e;
		} catch(Exception e) {
			throw new UsernameNotFoundException("User not authenticated");
		}
		return user;
	}
}
