package com.skytrix.service;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class SyncTaskTracker {

    public enum TaskStatus { IDLE, RUNNING, PAUSED }

    public static class TaskState {
        private volatile TaskStatus status = TaskStatus.IDLE;
        private volatile int total;
        private final AtomicInteger processed = new AtomicInteger();
        private final AtomicInteger failed = new AtomicInteger();
        private volatile String error;
        private volatile boolean pauseRequested;

        public boolean start(int total) {
            if (this.status != TaskStatus.IDLE) return false;
            this.status = TaskStatus.RUNNING;
            this.total = total;
            this.processed.set(0);
            this.failed.set(0);
            this.error = null;
            this.pauseRequested = false;
            return true;
        }

        public void incrementProcessed() { processed.incrementAndGet(); }
        public void incrementFailed() { failed.incrementAndGet(); }

        public void complete() {
            this.status = TaskStatus.IDLE;
            this.pauseRequested = false;
        }

        public void fail(String errorMessage) {
            this.status = TaskStatus.IDLE;
            this.error = errorMessage;
            this.pauseRequested = false;
        }

        public void requestPause() {
            if (this.status == TaskStatus.RUNNING) {
                this.pauseRequested = true;
                this.status = TaskStatus.PAUSED;
            }
        }

        public void requestResume() {
            if (this.status == TaskStatus.PAUSED) {
                this.pauseRequested = false;
                this.status = TaskStatus.RUNNING;
            }
        }

        public boolean shouldPause() { return pauseRequested; }
        public TaskStatus getStatus() { return status; }
        public int getTotal() { return total; }
        public int getProcessed() { return processed.get(); }
        public int getFailed() { return failed.get(); }
        public String getError() { return error; }
    }

    private final Map<String, TaskState> tasks = new ConcurrentHashMap<>();

    public SyncTaskTracker() {
        tasks.put("images", new TaskState());
        tasks.put("tcgImages", new TaskState());
        tasks.put("duelData", new TaskState());
    }

    public TaskState get(String taskName) {
        return tasks.get(taskName);
    }

    public Map<String, TaskState> getAll() {
        return tasks;
    }
}
