package com.skytrix.controller;

import jakarta.inject.Inject;

import java.util.concurrent.TimeUnit;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.service.DocumentService;

@RestController
@RequestMapping("/documents")
public class DocumentController {

    public static final String DOCUMENT_ROOT_URL = "api/documents";

    /** Card images are content-addressed (passcode/imageId) and effectively immutable.
     *  Long-lived cache (1 year) + immutable lets the browser skip revalidation entirely
     *  so the same image is reused across duels and sessions without a network round-trip. */
    private static final CacheControl IMAGE_CACHE = CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable();

    @Inject
    private DocumentService documentService;

    @GetMapping("/big/{id}")
    public ResponseEntity<byte[]> getCardImage(@PathVariable(value = "id", required = false) Long id) {
        return ResponseEntity.ok().cacheControl(IMAGE_CACHE).contentType(MediaType.IMAGE_JPEG).body(documentService.getCardImage(id));
    }

    @GetMapping("/small/{id}")
    public ResponseEntity<byte[]> getSmallCardImage(@PathVariable(value = "id", required = false) Long id) {
        return ResponseEntity.ok().cacheControl(IMAGE_CACHE).contentType(MediaType.IMAGE_JPEG).body(documentService.getSmallCardImage(id));
    }

    @GetMapping("/small/code/{passcode}")
    public ResponseEntity<byte[]> getSmallCardImageByPasscode(@PathVariable("passcode") long passcode) {
        return ResponseEntity.ok().cacheControl(IMAGE_CACHE).contentType(MediaType.IMAGE_JPEG).body(documentService.getSmallCardImageByPasscode(passcode));
    }

    @GetMapping("/sample")
    public ResponseEntity<byte[]> getSampleImageRoute() {
        return ResponseEntity.ok().cacheControl(IMAGE_CACHE).contentType(MediaType.IMAGE_JPEG).body(documentService.getSampleCardImage());
    }
}
