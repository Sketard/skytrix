package com.skytrix.service;

import jakarta.inject.Inject;

import java.util.List;

import org.springframework.stereotype.Service;

import com.skytrix.repository.CardSetRepository;

@Service
public class CardSetService {

    @Inject
    private CardSetRepository cardSetRepository;

    public List<String> findAllNames() {
        return cardSetRepository.findDistinctNames();
    }
}
