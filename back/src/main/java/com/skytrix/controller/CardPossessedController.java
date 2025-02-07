package com.skytrix.controller;

import com.skytrix.model.dto.card.CardFilterDTO;
import com.skytrix.model.dto.card.CardPossessedDTO;
import com.skytrix.model.dto.card.ShortCardPossessedDTO;
import com.skytrix.model.dto.card.UpdatePossessedCardDTO;
import com.skytrix.service.CardPossessedService;
import com.skytrix.utils.CustomPageable;
import jakarta.inject.Inject;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/possessed")
public class CardPossessedController {
    @Inject
    private CardPossessedService cardPossessedService;

    @PostMapping("/search")
    @ResponseStatus(code = HttpStatus.OK)
    public CustomPageable<CardPossessedDTO> search(@RequestBody CardFilterDTO filter, @RequestParam("offset") int offset, @RequestParam("quantity") int quantity) {
        return cardPossessedService.search(filter, offset, quantity);
    }

    @PutMapping
    @ResponseStatus(code = HttpStatus.OK)
    public List<ShortCardPossessedDTO> updatePossessedCard(@RequestBody UpdatePossessedCardDTO dto) {
        cardPossessedService.updatePossessedCards(dto);
        return getAllShort();
    }

    @GetMapping("/short")
    @ResponseStatus(code = HttpStatus.OK)
    public List<ShortCardPossessedDTO> getAllShort() {
        return cardPossessedService.getAllShort();
    }
}
