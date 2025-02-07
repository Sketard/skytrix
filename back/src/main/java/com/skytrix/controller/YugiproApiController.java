package com.skytrix.controller;

import com.skytrix.service.YugiproApiService;
import jakarta.inject.Inject;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/yugipro")
public class YugiproApiController {
    @Inject
    private YugiproApiService yugiproApiService;

    @PostMapping
    @ResponseStatus(code = HttpStatus.CREATED)
    public void fetchAll() {
           yugiproApiService.fetchAll();
    }

    @PutMapping("/update/ban-list")
    @ResponseStatus(code = HttpStatus.NO_CONTENT)
    public void fetchAllBanList() {
        yugiproApiService.fetchAllBanList();
    }

    @PostMapping("/fetch/image")
    @ResponseStatus(code = HttpStatus.NO_CONTENT)
    public void fetchAllMissingImageAndSave() {
        yugiproApiService.fetchAllMissingImageAndSave();
    }

    @PutMapping("/update/image/tcg")
    @ResponseStatus(code = HttpStatus.NO_CONTENT)
    public void updateTcgImages() {
        yugiproApiService.updateTcgImages();
    }

}
