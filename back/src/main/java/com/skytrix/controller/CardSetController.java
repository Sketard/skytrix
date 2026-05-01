package com.skytrix.controller;

import com.skytrix.model.dto.card.CardSetFilterDTO;
import com.skytrix.model.dto.card.CardSetShortDTO;
import com.skytrix.service.CardSetService;
import jakarta.inject.Inject;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/card-sets")
public class CardSetController {

    @Inject
    private CardSetService cardSetService;

    @PostMapping("/search/short")
    @ResponseStatus(HttpStatus.OK)
    public List<CardSetShortDTO> searchShort(@RequestBody CardSetFilterDTO filter) {
        return cardSetService.searchShort(filter);
    }
}
