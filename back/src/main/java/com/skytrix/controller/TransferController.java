package com.skytrix.controller;

import jakarta.inject.Inject;
import jakarta.validation.Valid;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.skytrix.model.dto.deck.DeckDTO;
import com.skytrix.model.dto.deck.ExportDeckDTO;
import com.skytrix.service.TransferService;

@RestController
@RequestMapping("/transfers")
public class TransferController {

	@Inject
	private TransferService transferService;

	@PostMapping("/export/deck")
	@ResponseStatus(code = HttpStatus.OK)
	public byte[] exportDeck(@RequestBody @Valid ExportDeckDTO deckDTO) {
		return transferService.exportDeck(deckDTO);
	}

	@PostMapping("/import/deck")
	@ResponseStatus(code = HttpStatus.OK)
	public DeckDTO exportDeck(@RequestPart("file") MultipartFile file) throws IOException {
		return transferService.importDeckFromFile(file.getBytes());
	}
}
