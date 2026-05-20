package com.skytrix.service;

import jakarta.inject.Inject;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Function;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardImage;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.utils.FileUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class DocumentService {
    @Inject
    private CardImageRepository cardImageRepository;

    @Inject
    private CardRepository cardRepository;

    public byte[] getCardImage(Long id) {
        var cardImage = cardImageRepository.findById(id).orElseThrow();
        // Some cards lack the "big" artwork on disk (incomplete image set):
        // fall back to the small image, then to the generic card back, so a
        // single missing file never breaks a PDF export or the card inspector.
        byte[] big = tryReadFile(cardImage.getUrl());
        if (big != null) {
            return big;
        }
        log.warn("Big image missing ({}), falling back to small for cardImage {}",
                cardImage.getUrl(), id);
        byte[] small = tryReadFile(cardImage.getSmallUrl());
        if (small != null) {
            return small;
        }
        log.warn("Small image also missing ({}) for cardImage {} — serving card back",
                cardImage.getSmallUrl(), id);
        return FileUtils.getSampleCardFile();
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
        byte[] content = tryReadFile(path);
        if (content == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found: " + path);
        }
        return content;
    }

    /** Reads the file, or returns {@code null} when it is missing — caller decides
     *  whether to fall back or surface a 404. A genuine I/O failure still throws. */
    private byte[] tryReadFile(String path) {
        Path resolved = Path.of(path);
        if (!Files.exists(resolved)) {
            return null;
        }
        try {
            return Files.readAllBytes(resolved);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to read image: " + path, e);
        }
    }
}
