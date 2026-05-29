package com.skytrix.controller;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lightweight liveness probe accessible without auth.
 *
 * <p>Spring Boot Actuator already exposes health on the management port 8081
 * (cf. application.properties + SecurityConfig whitelist of /actuator/**),
 * but that endpoint is internal-only and not reachable from probe scripts
 * targeting the public port 8080. This controller mirrors the bare-minimum
 * "is the back accepting traffic?" check that probe scripts (Playwright
 * harness, deployment scripts) expect on the same port as the API.
 *
 * <p>Returns a fixed payload — does NOT touch DB / cache / external services
 * to keep latency minimal and avoid masking outages of dependents.
 */
@RestController
public class HealthController {

	@GetMapping("/health")
	public Map<String, String> health() {
		return Map.of("status", "UP");
	}
}
