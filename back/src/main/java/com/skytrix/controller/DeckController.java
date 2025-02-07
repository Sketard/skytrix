package com.skytrix.controller;

import jakarta.inject.Inject;
import jakarta.validation.Valid;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.model.dto.deck.CreateDeckDTO;
import com.skytrix.model.dto.deck.DeckDTO;
import com.skytrix.model.dto.deck.ShortDeckDTO;
import com.skytrix.service.DeckService;

@RestController
@RequestMapping("/decks")
public class DeckController {
    @Inject
    private DeckService deckService;

    @PostMapping
    @ResponseStatus(code = HttpStatus.CREATED)
    public DeckDTO createDeck(@RequestBody @Valid CreateDeckDTO createDeckDTO) {
        return deckService.createDeck(createDeckDTO);
    }

    @GetMapping("/{id}")
    @ResponseStatus(HttpStatus.OK)
    public DeckDTO getById(@PathVariable("id") Long id) {
        return deckService.getById(id);
    }

    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    public List<ShortDeckDTO> getAll() {
        return deckService.getAll();
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteById(@PathVariable("id") Long id) {
        deckService.deleteById(id);
    }



}
