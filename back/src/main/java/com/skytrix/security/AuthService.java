package com.skytrix.security;

import jakarta.inject.Inject;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.exception.UnauthorizedException;
import com.skytrix.mapper.UserMapper;
import com.skytrix.model.dto.user.CreateUserDTO;
import com.skytrix.model.entity.User;
import com.skytrix.repository.UserRepository;
import com.skytrix.security.jwt.JWT;
import com.skytrix.security.jwt.JWTService;

import lombok.extern.slf4j.Slf4j;

import static org.springframework.http.HttpHeaders.AUTHORIZATION;

@Service
@Slf4j
public class AuthService {
    @Inject
    private JWTService jwtService;

    @Inject
    private UserRepository userRepository;

    @Inject
    private UserMapper userMapper;

    @Inject
    private PasswordEncoder encoder;

    @Value("${jwt.refresh-validity-period}")
    private Long refreshValidityMilliseconds;

    @Value("${server.servlet.context-path}")
    private String baseApiPath;


    public Long getConnectedUserId() {
        return getConnectedUser().getId();
    }

    public User getConnectedUser() {
        var userDetail = (CustomUserDetails) getAuthentication().getPrincipal();
        return userRepository.findById(userDetail.getId()).orElseThrow();
    }

    public Authentication getAuthentication() {
        return SecurityContextHolder.getContext().getAuthentication();
    }

    @Transactional
    public JWT login(Authentication authentication) {
        var userDetails = (CustomUserDetails) authentication.getPrincipal();
		return loginFromCustomUserDetails(userDetails);
    }

    @Transactional
    public void createAccount(CreateUserDTO userDTO) {
        var user = userMapper.toUser(userDTO);
        userRepository.save(user);
    }

    @Transactional
    public void logout() {
        var user = getConnectedUser();
        user.setRefreshToken(null);
    }

    public String refresh(String refreshToken) {
        try {
            var user = jwtService.getUser(refreshToken);
            return jwtService.generateAccessToken(user);
        } catch(Exception e) {
            throw new UnauthorizedException("Unauthorized refresh token request : %s".formatted(e.getMessage()));
        }
    }

    private JWT loginFromCustomUserDetails(CustomUserDetails details) {
        var accessToken = jwtService.generateAccessToken(details);
        var refreshToken = jwtService.generateRefreshToken(details);
        persistRefreshToken(details.getId(), encoder.encode(refreshToken));
        return new JWT(accessToken, refreshToken);
    }

    public void setResponseTokens(JWT jwt, HttpServletResponse response) {
        response.setHeader(AUTHORIZATION, jwt.getAccessToken());
        setResponseRefreshCookie(jwt.getRefreshToken(), (int) (refreshValidityMilliseconds/1000), response);
    }

    public void setResponseRefreshCookie(String refreskToken, int maxAge, HttpServletResponse response) {
        var refreshCookie = new Cookie("Refresh", refreskToken);
        refreshCookie.setHttpOnly(true);
        refreshCookie.setMaxAge(maxAge);
        refreshCookie.setSecure(true);
        refreshCookie.setPath(baseApiPath);
        response.addCookie(refreshCookie);

    }

    private void persistRefreshToken(Long userId, String token) {
        userRepository.findById(userId).ifPresent(account -> account.setRefreshToken(token));
    }
}
