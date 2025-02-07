package com.skytrix.controller;

import jakarta.inject.Inject;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.service.DocumentService;

@RestController
@RequestMapping("/documents")
public class DocumentController {

    public static final String DOCUMENT_ROOT_URL = "api/documents";

    @Inject
    private DocumentService documentService;

    @GetMapping("/big/{id}")
    @ResponseStatus(code = HttpStatus.OK)
    public byte[] getCardImage(@PathVariable(value = "id", required = false) Long id) {
        return documentService.getCardImage(id);
    }

    @GetMapping("/small/{id}")
    @ResponseStatus(code = HttpStatus.OK)
    public byte[] getSmallCardImage(@PathVariable(value = "id", required = false) Long id) {
        return documentService.getSmallCardImage(id);
    }

    @GetMapping("/sample")
    @ResponseStatus(code = HttpStatus.OK)
    public byte[] getSampleImageRoute() {
        return documentService.getSampleCardImage();
    }
}
