package com.skytrix.security.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.inject.Inject;
import jakarta.servlet.http.HttpServletRequest;

import static com.skytrix.exception.ExceptionMessage.TOKEN_EXPIRED;

import java.util.Date;

import javax.crypto.SecretKey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.skytrix.exception.InvalidRefreshTokenException;
import com.skytrix.exception.TokenExpiredException;
import com.skytrix.exception.UnauthorizedException;
import com.skytrix.repository.UserRepository;
import com.skytrix.security.CustomUserDetails;

@Service
public class JWTService {

	@Inject
	private UserRepository userRepository;

	@Inject
	private PasswordEncoder encoder;

	@Value("${jwt.secret}")
	private String secret;

	@Value("${jwt.validity-period}")
	private int accessValidityMilliseconds;

	@Value("${jwt.refresh-validity-period}")
	private int refreshValidityMilliseconds;

	private AntPathRequestMatcher refreshUrlMatcher;

	private static final String TOKEN_USER_ID = "userId";
	private static final String TOKEN_REFRESH = "refresh";

	public String generateAccessToken(CustomUserDetails userDetails) {
		return "Bearer " + generateToken(userDetails, false);
	}

	public String generateRefreshToken(CustomUserDetails userDetails) {
		return generateToken(userDetails, true);
	}

	public CustomUserDetails getUser(String token) throws TokenExpiredException, InvalidRefreshTokenException {
		Claims body;
		var httpRequest = getCurrentHttpRequest();
		try {
			body = Jwts.parser()
					.verifyWith(getSecret()).build()
					.parseSignedClaims(token)
					.getPayload();
		} catch(ExpiredJwtException e) {
			throw new TokenExpiredException(TOKEN_EXPIRED.getMessage());
		}

		// check refresh token in db
		if(isRefreshToken(body)) {
			if(!refreshUrlMatcher.matches(httpRequest)) {
				throw new UnauthorizedException("Token invalid");
			}
			if(!checkRefreshToken(Long.parseLong(String.valueOf(body.get(TOKEN_USER_ID))), token)) {
				throw new InvalidRefreshTokenException("Invalid refresh token");
			}
		}

		return buildUserFromToken(body);
	}

	public static HttpServletRequest getCurrentHttpRequest() {
		var requestAttributes = RequestContextHolder.getRequestAttributes();
		if(requestAttributes instanceof ServletRequestAttributes servletRequestAttributes) {
			return servletRequestAttributes.getRequest();
		}
		return null;
	}

	private boolean isRefreshToken(Claims body) {
		return Boolean.TRUE.equals(body.get(TOKEN_REFRESH, Boolean.class));
	}

	private String generateToken(CustomUserDetails userDetails, boolean refresh) {
		var claimsBuilder = Jwts.claims()
				.subject(userDetails.getUsername())
				.issuedAt(new Date())
				.expiration(new Date(System.currentTimeMillis() + (refresh ? refreshValidityMilliseconds : accessValidityMilliseconds)))
				.add(TOKEN_USER_ID, userDetails.getId())
				.add(TOKEN_REFRESH, refresh)
				.build();

		return Jwts.builder()
				.claims(claimsBuilder)
				.signWith(getSecret(), Jwts.SIG.HS512)
				.compact();
	}

	private CustomUserDetails buildUserFromToken(Claims body) {
		var user = new CustomUserDetails();
		var userId = Long.parseLong(String.valueOf(body.get(TOKEN_USER_ID)));

		user.setUsername(body.getSubject());
		user.setId(userId);
		return user;
	}

	public void setRefreshUrlMatcher(AntPathRequestMatcher matcher) {
		if(this.refreshUrlMatcher == null) {
			this.refreshUrlMatcher = matcher;
		}
	}

	private SecretKey getSecret() {
		return Keys.hmacShaKeyFor(secret.getBytes());
	}

	public boolean checkRefreshToken(Long userId, String token) {
		var user = userRepository.findById(userId);
		return user.filter(value -> encoder.matches(token, value.getRefreshToken())).isPresent();
	}
}
