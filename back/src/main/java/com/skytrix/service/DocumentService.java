package com.skytrix.service;

import jakarta.inject.Inject;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Function;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.exception.InternalServerError;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardImage;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.utils.FileUtils;

@Service
public class DocumentService {
    @Inject
    private CardImageRepository cardImageRepository;

    @Inject
    private CardRepository cardRepository;

    public byte[] getCardImage(Long id) {
        return getCardImage(id, CardImage::getUrl);
    }

    public byte[] getSmallCardImage(Long id) {
        return getCardImage(id, CardImage::getSmallUrl);
    }

    public byte[] getSmallCardImageByPasscode(long passcode) {
        Card card = cardRepository.findByPasscode(passcode);
        if (card == null || card.getImages().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No image for passcode " + passcode);
        }
        return getFileContent(card.getImages().get(0).getSmallUrl());
    }

    private byte[] getCardImage(Long id, Function<CardImage, String> getter) {
        var cardImage = cardImageRepository.findById(id).orElseThrow();
        return getFileContent(getter.apply(cardImage));
    }

    public byte[] getSampleCardImage() {
        return FileUtils.getSampleCardFile();
    }

    private byte[] getFileContent(String path) {
        try {
            return Files.readAllBytes(Path.of(path));
        } catch (IOException e) {
            throw new InternalServerError(e.getMessage());
        }
    }
}
