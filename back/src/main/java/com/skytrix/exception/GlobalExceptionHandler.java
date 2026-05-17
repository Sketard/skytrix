package com.skytrix.exception;

import java.util.Map;

import org.apache.catalina.connector.ClientAbortException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.RestClientException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
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
		return buildResponse(HttpStatus.valueOf(ex.getStatusCode().value()), ex.getStatusCode().is4xxClientError() ? "BAD_REQUEST" : "INTERNAL_ERROR", ex.getReason());
	}

	@ExceptionHandler(UnauthorizedException.class)
	public ResponseEntity<Map<String, String>> handleUnauthorized(UnauthorizedException ex) {
		log.warn("[401] {}", ex.getMessage());
		return buildResponse(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", ex.getMessage());
	}

	@ExceptionHandler(InternalServerError.class)
	public ResponseEntity<Map<String, String>> handleInternalServerError(InternalServerError ex) {
		log.error("[500] {}", ex.getMessage(), ex);
		return buildResponse(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", ex.getMessage());
	}

	@ExceptionHandler(RestClientException.class)
	public ResponseEntity<Map<String, String>> handleRestClient(RestClientException ex) {
		log.error("[503] Duel server communication error: {}", ex.getMessage(), ex);
		return buildResponse(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "Service temporarily unavailable");
	}

	@ExceptionHandler(AccessDeniedException.class)
	public ResponseEntity<Map<String, String>> handleAccessDenied(AccessDeniedException ex) {
		log.warn("[403] {}", ex.getMessage());
		return buildResponse(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Access denied");
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException ex) {
		log.warn("[400] Validation failed: {}", ex.getMessage());
		return buildResponse(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Invalid request");
	}

	/**
	 * Client disconnected mid-response (SSE keep-alive ping, broadcast flush,
	 * or any async write after the socket was abandoned). The response is
	 * already committed, so we can't write a body — and trying to do so on
	 * a text/event-stream response triggers a secondary
	 * HttpMessageNotWritableException in the resolver. Log at DEBUG and
	 * return no body.
	 */
	@ExceptionHandler({ AsyncRequestNotUsableException.class, ClientAbortException.class })
	public ResponseEntity<Void> handleClientAbort(Exception ex) {
		log.debug("Client disconnected mid-response: {}", ex.getMessage());
		return ResponseEntity.noContent().build();
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<Map<String, String>> handleUnexpected(Exception ex) {
		log.error("[500] Unexpected error", ex);
		return buildResponse(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "An unexpected error occurred");
	}

	private ResponseEntity<Map<String, String>> buildResponse(HttpStatus status, String code, String message) {
		return ResponseEntity.status(status).body(Map.of(
			"code", code,
			"message", message != null ? message : status.getReasonPhrase()
		));
	}
}
