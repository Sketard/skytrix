package com.skytrix.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.skytrix.repository.UserRepository;

@Configuration
public class SecretConfig {

	@Bean
	public PasswordEncoder passwordEncoder() {
		return new BCryptPasswordEncoder();
	}

	@Bean
	DatabaseProvider databaseLoginAuthenticationProvider(CustomUserDetailsService userDetailsService) {
		var loginAuthenticationProvider = new DatabaseProvider();
		loginAuthenticationProvider.setPasswordEncoder(passwordEncoder());
		loginAuthenticationProvider.setUserDetailsService(userDetailsService);
		return loginAuthenticationProvider;
	}

	@Bean
	public CustomUserDetailsService userDetailsService(UserRepository userRepository) {
		var userDetailService = new CustomUserDetailsService();
		userDetailService.setUserRepository(userRepository);

		return userDetailService;
	}
}
