package com.skytrix.security;

import java.time.Duration;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
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

@Service
@Slf4j
public class AuthService {

    private final JWTService jwtService;
    private final UserRepository userRepository;
    private final UserMapper userMapper;
    private final PasswordEncoder encoder;
    private final Long accessValidityMilliseconds;
    private final Long refreshValidityMilliseconds;
    private final String baseApiPath;

    public AuthService(JWTService jwtService,
                       UserRepository userRepository,
                       UserMapper userMapper,
                       PasswordEncoder encoder,
                       @Value("${jwt.validity-period}") Long accessValidityMilliseconds,
                       @Value("${jwt.refresh-validity-period}") Long refreshValidityMilliseconds,
                       @Value("${server.servlet.context-path}") String baseApiPath) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.userMapper = userMapper;
        this.encoder = encoder;
        this.accessValidityMilliseconds = accessValidityMilliseconds;
        this.refreshValidityMilliseconds = refreshValidityMilliseconds;
        this.baseApiPath = baseApiPath;
    }

    public Long getConnectedUserId() {
        var userDetail = (CustomUserDetails) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        return userDetail.getId();
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
        log.info("Login userId={} username={}", userDetails.getId(), userDetails.getUsername());
        return loginFromCustomUserDetails(userDetails);
    }

    @Transactional
    public void createAccount(CreateUserDTO userDTO) {
        var user = userMapper.toUser(userDTO);
        userRepository.save(user);
        log.info("Account created userId={} username={}", user.getId(), user.getPseudo());
    }

    @Transactional
    public void logout() {
        var user = getConnectedUser();
        user.setRefreshToken(null);
        log.info("Logout userId={}", user.getId());
    }

    public String refresh(String refreshToken) {
        try {
            var user = jwtService.getUser(refreshToken);
            log.info("Token refreshed userId={}", user.getId());
            return jwtService.generateAccessToken(user);
        } catch(Exception e) {
            log.warn("Refresh token rejected: {}", e.getMessage());
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
        setAccessCookie(jwt.getAccessToken(), response);
        setRefreshCookie(jwt.getRefreshToken(), (int) (refreshValidityMilliseconds / 1000), response);
    }

    public void setAccessCookie(String accessToken, HttpServletResponse response) {
        var cookie = ResponseCookie.from("Access", accessToken)
                .httpOnly(true)
                .secure(true)
                .path(baseApiPath)
                .sameSite("Strict")
                .maxAge(Duration.ofMillis(accessValidityMilliseconds))
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public void clearAccessCookie(HttpServletResponse response) {
        var cookie = ResponseCookie.from("Access", "")
                .httpOnly(true)
                .secure(true)
                .path(baseApiPath)
                .sameSite("Strict")
                .maxAge(0)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public void setRefreshCookie(String refreshToken, int maxAge, HttpServletResponse response) {
        var cookie = ResponseCookie.from("Refresh", refreshToken)
                .httpOnly(true)
                .secure(true)
                .path(baseApiPath)
                .sameSite("Strict")
                .maxAge(maxAge)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    private void persistRefreshToken(Long userId, String token) {
        userRepository.findById(userId).ifPresent(account -> account.setRefreshToken(token));
    }
}
