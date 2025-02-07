package com.skytrix.security;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

import com.skytrix.repository.UserRepository;

import lombok.Setter;

@Setter
public class CustomUserDetailsService implements UserDetailsService {
	private UserRepository userRepository;

	@Override
	public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
		var user = userRepository.findByPseudo(username).orElseThrow(() -> new UsernameNotFoundException("Authentication Error"));
		return new CustomUserDetails(user.getId(), user.getPassword(), user.getPseudo());
	}
}
