package com.skytrix.controller;

import jakarta.inject.Inject;

import static com.skytrix.utils.ThreadUtils.processAsynchronously;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.annotation.Secured;
import org.springframework.web.bind.annotation.*;

import com.skytrix.service.DuelServerClient;
import com.skytrix.service.SyncTaskTracker;
import com.skytrix.service.YugiproApiService;

import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/parameters")
@Secured("ROLE_ADMIN")
public class ParameterController {

	@Inject
	private YugiproApiService yugiproApiService;

	@Inject
	private DuelServerClient duelServerClient;

	@Inject
	private SyncTaskTracker syncTaskTracker;

	@PutMapping("/update/cards")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void fetchCards() {
		var task = syncTaskTracker.get("cards");
		processAsynchronously(() -> {
			task.start(1);
			try {
				yugiproApiService.fetchAll();
				task.incrementProcessed();
				task.complete();
			} catch (Exception e) {
				task.fail(e.getMessage());
			}
		});
	}

	@PutMapping("/update/images")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void fetchImages() {
		// Mark RUNNING synchronously so the first status poll never sees a stale
		// IDLE state (the polling UI would read it as "task finished, nothing
		// missing"). The real total is set inside fetchAllMissingImageAndSave
		// once the flag reconciliation + missing-image query have run.
		syncTaskTracker.get("images").markRunning();
		processAsynchronously(() -> yugiproApiService.fetchAllMissingImageAndSave());
	}

	@PutMapping("/update/ban-list")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void fetcBanList() {
		var task = syncTaskTracker.get("banlist");
		processAsynchronously(() -> {
			task.start(1);
			try {
				yugiproApiService.fetchAllBanList();
				task.incrementProcessed();
				task.complete();
			} catch (Exception e) {
				task.fail(e.getMessage());
			}
		});
	}

	@PutMapping("/update/images/tcg")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void updateTcgImages() {
		processAsynchronously(() -> yugiproApiService.updateTcgImages());
	}

	@PutMapping("/update/duel-data")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void updateDuelData() {
		var task = syncTaskTracker.get("duelData");
		processAsynchronously(() -> {
			task.start(1);
			try {
				duelServerClient.updateData();
				task.incrementProcessed();
				task.complete();
			} catch (Exception e) {
				task.fail(e.getMessage());
			}
		});
	}

	@GetMapping("/status")
	public Map<String, Map<String, Object>> getStatus() {
		return syncTaskTracker.getAll().entrySet().stream()
				.collect(Collectors.toMap(Map.Entry::getKey, e -> {
					var state = e.getValue();
					return Map.of(
							"status", state.getStatus().name(),
							"total", state.getTotal(),
							"processed", state.getProcessed(),
							"failed", state.getFailed(),
							"error", state.getError() != null ? state.getError() : ""
					);
				}));
	}

	@PostMapping("/pause/{task}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void pauseTask(@PathVariable String task) {
		var state = syncTaskTracker.get(task);
		if (state != null) {
			state.requestPause();
		}
	}

	@PostMapping("/resume/{task}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void resumeTask(@PathVariable String task) {
		var state = syncTaskTracker.get(task);
		if (state != null) {
			state.requestResume();
		}
	}
}
