package com.skytrix.repository;

import java.util.Optional;

import org.springframework.data.repository.CrudRepository;

import com.skytrix.model.entity.User;

public interface UserRepository extends CrudRepository<User, Long> {
	Optional<User> findByPseudo(String pseudo);
}
