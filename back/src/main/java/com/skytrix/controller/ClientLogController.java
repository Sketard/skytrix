package com.skytrix.controller;

import java.util.List;

import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import org.springframework.validation.annotation.Validated;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Validated
@RestController
public class ClientLogController {

	private static final org.slf4j.Logger clientLog = LoggerFactory.getLogger("CLIENT_LOG");

	@PostMapping("/client-logs")
	@ResponseStatus(code = HttpStatus.NO_CONTENT)
	public void receiveClientLogs(@Valid @RequestBody @Size(max = 50) List<ClientLogEntry> entries) {
		for (var entry : entries) {
			clientLog.info("[{}] [{}] [{}] [{}] {} | {}",
					entry.timestamp(), entry.user(), entry.level(), entry.url(), entry.message(), entry.context());
		}
	}

	public record ClientLogEntry(
			@NotNull String timestamp,
			@NotNull String level,
			@NotNull @Size(max = 5000) String message,
			@Size(max = 5000) String context,
			String url,
			String user,
			String userAgent
	) {}
}
