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
import java.time.Duration;

import static java.net.http.HttpResponse.BodyHandlers.ofString;

@Slf4j
public abstract class Requester {

    private static final int MAX_RETRIES = 3;
    private static final long[] BACKOFF_MS = {1_000, 2_000, 4_000};

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final ObjectMapper objectMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    public HttpRequest createGetRequest(String uri) {
        return HttpRequest.newBuilder()
                .uri(buildUri(uri))
                .timeout(Duration.ofSeconds(30))
                .GET()
                .build();
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
        return sendWithRetry(request, ofString());
    }

    public HttpResponse<byte[]> sendRequestByteArray(HttpRequest request) {
        return sendWithRetry(request, HttpResponse.BodyHandlers.ofByteArray());
    }

    private <T> HttpResponse<T> sendWithRetry(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
        Exception lastException = null;
        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                var response = httpClient.send(request, handler);
                int status = response.statusCode();
                if (status >= 200 && status < 300) {
                    return response;
                }
                // Retryable server errors (429 Too Many Requests, 5xx)
                if (status == 429 || status >= 500) {
                    lastException = new IOException("HTTP " + status + " from " + request.uri());
                    if (attempt < MAX_RETRIES - 1) {
                        long delay = status == 429 ? BACKOFF_MS[attempt] * 2 : BACKOFF_MS[attempt];
                        log.warn("HTTP {} (attempt {}/{}): {} — retrying in {}ms",
                                status, attempt + 1, MAX_RETRIES, request.uri(), delay);
                        Thread.sleep(delay);
                        continue;
                    }
                }
                // Non-retryable client errors (4xx except 429) — return as-is
                return response;
            } catch (IOException e) {
                lastException = e;
                if (attempt < MAX_RETRIES - 1) {
                    log.warn("Request failed (attempt {}/{}): {} — retrying in {}ms",
                            attempt + 1, MAX_RETRIES, e.getMessage(), BACKOFF_MS[attempt]);
                    try {
                        Thread.sleep(BACKOFF_MS[attempt]);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new InternalServerError("Interrupted during retry backoff");
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new InternalServerError(e.getMessage());
            }
        }
        log.error("Request failed after {} retries: {}", MAX_RETRIES, request.uri());
        throw new InternalServerError(lastException != null ? lastException.getMessage() : "Request failed");
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
