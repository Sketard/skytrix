package com.skytrix.requester;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skytrix.exception.InternalServerError;

import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static java.net.http.HttpResponse.BodyHandlers.ofString;

@Slf4j
public abstract class Requester {

    private final HttpClient httpClient = HttpClient.newHttpClient();

    private final ObjectMapper objectMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    public HttpRequest createGetRequest(String uri) {
        return HttpRequest.newBuilder().uri(buildUri(uri)).GET().build();
    }

    public URI buildUri(String uri) {
        try {
            return new URI(uri);
        } catch (URISyntaxException e) {
            log.error("erreur durant construction de l'uri");
            throw new InternalServerError(e.getMessage());
        }
    }

    public HttpResponse<String> sendRequest(HttpRequest request) {
        try {
            return httpClient.send(request, ofString());
        } catch (IOException e) {
            log.error("erreur durant la requete");
            throw new InternalServerError(e.getMessage());
        } catch(InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new InternalServerError(e.getMessage());
        }
    }

    public HttpResponse<byte[]> sendRequestByteArray(HttpRequest request) {
        try {
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            log.error("erreur durant la requete");
            throw new InternalServerError(e.getMessage());
        } catch(InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new InternalServerError(e.getMessage());
        }
    }

    public <R> R parseResponse(HttpResponse<String> response, TypeReference<R> typeReference) {
        try {
            return objectMapper.readValue(response.body(), typeReference);
        } catch (JsonProcessingException e) {
            log.error("erreur durant le parsing");
            throw new InternalServerError(e.getMessage());
        }
    }

}
