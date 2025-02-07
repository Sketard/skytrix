package com.skytrix.utils;

import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;

import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

public abstract class ThreadUtils {
	private static final int DEFAULT_POOL_SIZE = 30;

	public static void processAsynchronously(Runnable process) {
		var executor = createExecutor();
		executor.setWaitForTasksToCompleteOnShutdown(true);
		executor.submit(process);
		closeExecutor(executor);
	}


	public static ThreadPoolTaskExecutor createExecutor() {
		var executor = new ThreadPoolTaskExecutor();
		executor.setCorePoolSize(DEFAULT_POOL_SIZE);
		executor.initialize();
		return executor;
	}

	public static void await(List<Future<?>> futures) {
		// wait for threads to finish
		for (var futureElement: futures) {
			try {
				futureElement.get();
			} catch (InterruptedException | ExecutionException e) {
				Thread.currentThread().interrupt();
			}
		}
	}

	public static void closeExecutor(ThreadPoolTaskExecutor executor) {
		executor.shutdown();
	}
}
