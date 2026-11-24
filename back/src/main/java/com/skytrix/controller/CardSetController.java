package com.skytrix.controller;

import com.skytrix.model.dto.booster.BoosterSetDTO;
import com.skytrix.service.CardSetService;
import jakarta.inject.Inject;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/card-sets")
public class CardSetController {

    @Inject
    private CardSetService cardSetService;

    @GetMapping("/names")
    @ResponseStatus(HttpStatus.OK)
    public List<String> findAllNames() {
        return cardSetService.findAllNames();
    }

    /** Sets that can be opened in a booster-mode room. */
    @GetMapping("/boosters")
    @ResponseStatus(HttpStatus.OK)
    public List<BoosterSetDTO> findBoosterSets() {
        return cardSetService.findBoosterSets();
    }
}
