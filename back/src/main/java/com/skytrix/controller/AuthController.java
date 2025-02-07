package com.skytrix.controller;

import jakarta.inject.Inject;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.exception.UnauthorizedException;
import com.skytrix.mapper.UserMapper;
import com.skytrix.model.dto.user.CreateUserDTO;
import com.skytrix.model.dto.user.ShortUserDTO;
import com.skytrix.security.AuthService;

import lombok.extern.slf4j.Slf4j;

import static org.springframework.http.HttpHeaders.AUTHORIZATION;

@RestController
@Slf4j
public class AuthController {

	@Inject
	private AuthService authService;
	@Inject
	private UserMapper userMapper;

	@PostMapping("/login")
	@ResponseStatus(code = HttpStatus.OK)
	public ShortUserDTO login(Authentication auth, HttpServletResponse response) {
		authService.setResponseTokens(authService.login(auth), response);
		return userMapper.toShortUserDTO(authService.getConnectedUser());
	}

	@PostMapping("/refresh")
	@ResponseStatus(code = HttpStatus.NO_CONTENT)
	public void refresh(HttpServletResponse response, @CookieValue(name = "Refresh", defaultValue = "") String refreshToken) {
		if(refreshToken.isEmpty()) {
			throw new UnauthorizedException("No token provided");
		}

		var jwtToken = authService.refresh(refreshToken);
		response.setHeader(AUTHORIZATION, jwtToken);
	}

	@PostMapping("/create-account")
	@ResponseStatus(code = HttpStatus.CREATED)
	public void createAccount(@RequestBody CreateUserDTO userDTO) {
		authService.createAccount(userDTO);
	}

	@PostMapping("/logout")
	@ResponseStatus(code = HttpStatus.NO_CONTENT)
	public void logout(HttpServletResponse response) {
		authService.logout();
		authService.setResponseRefreshCookie("", 0, response);
	}


}
