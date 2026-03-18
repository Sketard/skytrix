package com.skytrix.security;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.skytrix.security.jwt.JWTAuthenticationFilter;
import com.skytrix.security.jwt.JWTAuthenticationProvider;
import com.skytrix.security.jwt.JWTService;

import static org.springframework.security.config.Customizer.withDefaults;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity(securedEnabled = true, jsr250Enabled = true)
public class SecurityConfig {

	private final AuthFailureHandler authFailureHandler;
	private final JWTAuthenticationProvider accessTokenAuthenticationProvider;
	private final DatabaseProvider databaseProvider;
	private final AuthEntryPoint authEntryPoint;
	private final JWTService jwtService;
	private final String apiUrlPrefix;
	private final String corsAllowedOrigins;

	public SecurityConfig(AuthFailureHandler authFailureHandler,
						  JWTAuthenticationProvider accessTokenAuthenticationProvider,
						  DatabaseProvider databaseProvider,
						  AuthEntryPoint authEntryPoint,
						  JWTService jwtService,
						  @Value("${server.servlet.context-path}") String apiUrlPrefix,
						  @Value("${CORS_ALLOWED_ORIGINS:http://localhost:4200}") String corsAllowedOrigins) {
		this.authFailureHandler = authFailureHandler;
		this.accessTokenAuthenticationProvider = accessTokenAuthenticationProvider;
		this.databaseProvider = databaseProvider;
		this.authEntryPoint = authEntryPoint;
		this.jwtService = jwtService;
		this.apiUrlPrefix = apiUrlPrefix;
		this.corsAllowedOrigins = corsAllowedOrigins;
	}

	@Bean
	public AuthenticationManager authenticationManager() {
		return new ProviderManager(
				databaseProvider,
				accessTokenAuthenticationProvider
		);
	}

	@Bean
	public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
		var refreshUrlMatcher = new AntPathRequestMatcher("/refresh", HttpMethod.POST.name());
		var loginUrlMatcher = new OrRequestMatcher(
				new AntPathRequestMatcher("/login", HttpMethod.POST.name()),
				new AntPathRequestMatcher("/create-account", HttpMethod.POST.name()),
				refreshUrlMatcher,
				new AntPathRequestMatcher("/documents/big/{\\d+}", HttpMethod.GET.name()),
				new AntPathRequestMatcher("/documents/small/{\\d+}", HttpMethod.GET.name()),
				new AntPathRequestMatcher("/documents/small/code/{\\d+}", HttpMethod.GET.name()),
				new AntPathRequestMatcher("/documents/sample", HttpMethod.GET.name()),
				new AntPathRequestMatcher("/client-logs", HttpMethod.POST.name())
		);

		var jwtFilteredMatcher = new NegatedRequestMatcher(new OrRequestMatcher(loginUrlMatcher));
		var jwtFilter = new JWTAuthenticationFilter(jwtFilteredMatcher, authenticationManager(), authFailureHandler);

		jwtService.setRefreshUrlMatcher(refreshUrlMatcher);

		http
				.httpBasic(basic -> basic.authenticationEntryPoint(authEntryPoint))
				.sessionManagement(management -> management.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(requests -> requests
						.requestMatchers(loginUrlMatcher).permitAll()
						.requestMatchers(jwtFilteredMatcher).authenticated())
				.addFilterBefore(jwtFilter, AnonymousAuthenticationFilter.class)
				.csrf(AbstractHttpConfigurer::disable)
				.formLogin(AbstractHttpConfigurer::disable)
				.logout(AbstractHttpConfigurer::disable)
				.cors(withDefaults());

		return http.build();
	}

	@Bean
	CorsConfigurationSource corsConfigurationSource() {
		var config = new CorsConfiguration();
		config.setAllowedOrigins(List.of(corsAllowedOrigins.split(",")));
		config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
		var source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/**", config);
		return source;
	}

}
