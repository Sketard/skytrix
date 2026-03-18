package com.skytrix.exception;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

	@ExceptionHandler(ResponseStatusException.class)
	public ResponseEntity<Map<String, String>> handleResponseStatus(ResponseStatusException ex) {
		if (ex.getStatusCode().is5xxServerError()) {
			log.error("[{}] {}", ex.getStatusCode(), ex.getReason(), ex);
		} else {
			log.warn("[{}] {}", ex.getStatusCode(), ex.getReason());
		}
		return buildResponse(HttpStatus.valueOf(ex.getStatusCode().value()), ex.getReason());
	}

	@ExceptionHandler(UnauthorizedException.class)
	public ResponseEntity<Map<String, String>> handleUnauthorized(UnauthorizedException ex) {
		log.warn("[401] {}", ex.getMessage());
		return buildResponse(HttpStatus.UNAUTHORIZED, ex.getMessage());
	}

	@ExceptionHandler(InternalServerError.class)
	public ResponseEntity<Map<String, String>> handleInternalServerError(InternalServerError ex) {
		log.error("[500] {}", ex.getMessage(), ex);
		return buildResponse(HttpStatus.INTERNAL_SERVER_ERROR, ex.getMessage());
	}

	@ExceptionHandler(RestClientException.class)
	public ResponseEntity<Map<String, String>> handleRestClient(RestClientException ex) {
		log.error("[503] Duel server communication error: {}", ex.getMessage(), ex);
		return buildResponse(HttpStatus.SERVICE_UNAVAILABLE, "Service temporarily unavailable");
	}

	@ExceptionHandler(AccessDeniedException.class)
	public ResponseEntity<Map<String, String>> handleAccessDenied(AccessDeniedException ex) {
		log.warn("[403] {}", ex.getMessage());
		return buildResponse(HttpStatus.FORBIDDEN, "Access denied");
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException ex) {
		log.warn("[400] Validation failed: {}", ex.getMessage());
		return buildResponse(HttpStatus.BAD_REQUEST, "Invalid request");
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<Map<String, String>> handleUnexpected(Exception ex) {
		log.error("[500] Unexpected error", ex);
		return buildResponse(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");
	}

	private ResponseEntity<Map<String, String>> buildResponse(HttpStatus status, String message) {
		return ResponseEntity.status(status).body(Map.of("message", message != null ? message : status.getReasonPhrase()));
	}
}
