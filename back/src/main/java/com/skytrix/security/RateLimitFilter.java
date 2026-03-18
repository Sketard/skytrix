package com.skytrix.security;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
public class RateLimitFilter extends OncePerRequestFilter {

	private static final int MAX_REQUESTS = 10;
	private static final long WINDOW_MS = 60_000;

	private static final int CLEANUP_THRESHOLD = 500;

	private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !"/client-logs".equals(request.getServletPath());
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		var ip = request.getHeader("X-Real-IP");
		if (ip == null) ip = request.getRemoteAddr();

		if (windows.size() > CLEANUP_THRESHOLD) {
			evictExpiredWindows();
		}

		var window = windows.compute(ip, (key, existing) -> {
			var now = System.currentTimeMillis();
			if (existing == null || now - existing.start > WINDOW_MS) {
				return new Window(now);
			}
			return existing;
		});

		if (window.count.incrementAndGet() > MAX_REQUESTS) {
			log.warn("Rate limit exceeded for IP={}", ip);
			response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
			return;
		}

		chain.doFilter(request, response);
	}

	private void evictExpiredWindows() {
		var now = System.currentTimeMillis();
		windows.entrySet().removeIf(e -> now - e.getValue().start > WINDOW_MS);
	}

	private static class Window {
		final long start;
		final AtomicInteger count;

		Window(long start) {
			this.start = start;
			this.count = new AtomicInteger(0);
		}
	}
}
