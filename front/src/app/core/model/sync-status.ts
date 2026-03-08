export interface TaskState {
  status: 'IDLE' | 'RUNNING' | 'PAUSED';
  total: number;
  processed: number;
  failed: number;
  error: string;
}

export type SyncStatus = Record<string, TaskState>;
