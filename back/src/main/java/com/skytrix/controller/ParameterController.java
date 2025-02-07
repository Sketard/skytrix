package com.skytrix.controller;

import jakarta.inject.Inject;

import static com.skytrix.utils.ThreadUtils.processAsynchronously;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.service.YugiproApiService;

@RestController
@RequestMapping("/parameters")
public class ParameterController {

	@Inject
	private YugiproApiService yugiproApiService;

	@PutMapping("/update/cards")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void fetchCards() {
		yugiproApiService.fetchAll();
	}

	@PutMapping("/update/images")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void fetchImages() {
		processAsynchronously(() -> yugiproApiService.fetchAllMissingImageAndSave());
	}

	@PutMapping("/update/ban-list")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void fetcBanList() {
		yugiproApiService.fetchAllBanList();
	}

	@PutMapping("/update/images/tcg")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void updateTcgImages() {
		processAsynchronously(() -> yugiproApiService.updateTcgImages());
	}
}
