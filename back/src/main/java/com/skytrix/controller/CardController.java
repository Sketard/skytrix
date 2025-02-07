package com.skytrix.controller;

import jakarta.inject.Inject;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.model.dto.card.CardDetailedDTO;
import com.skytrix.model.dto.card.CardFilterDTO;
import com.skytrix.service.CardService;
import com.skytrix.utils.CustomPageable;

@RestController
@RequestMapping("/cards")
public class CardController {

    @Inject
    private CardService cardService;

    @PostMapping("/search")
    @ResponseStatus(code = HttpStatus.OK)
    public CustomPageable<CardDetailedDTO> search(@RequestBody CardFilterDTO filter, @RequestParam("offset") int offset, @RequestParam("quantity") int quantity) {
        return cardService.search(filter, offset, quantity);
    }

    @PutMapping("/favorites/add/{cardId}")
    @ResponseStatus(code = HttpStatus.NO_CONTENT)
    public void addFavorite(@PathVariable("cardId") Long cardId) {
        cardService.addFavorite(cardId);
    }

    @PutMapping("/favorites/remove/{cardId}")
    @ResponseStatus(code = HttpStatus.OK)
    public List<CardDetailedDTO> removeFavorite(@PathVariable("cardId") Long cardId) {
        return cardService.removeFavorite(cardId);
    }

}
