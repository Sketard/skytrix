import { DestroyRef, inject, Injectable, signal } from '@angular/core';

interface TabMessage {
  type: 'TAB_ACTIVE';
  tabId: string;
  roomId: string;
  timestamp: number;
}

@Injectable()
export class DuelTabGuardService {
  private readonly destroyRef = inject(DestroyRef);

  readonly isBlocked = signal(false);

  private tabId = crypto.randomUUID();
  private roomId = '';
  private channel: BroadcastChannel | null = null;
  private storageHandler: ((e: StorageEvent) => void) | null = null;
  private readonly useBroadcastChannel = typeof BroadcastChannel !== 'undefined';

  init(roomId: string): void {
    this.roomId = roomId;

    if (this.useBroadcastChannel) {
      this.initBroadcastChannel();
    } else {
      this.initLocalStorageFallback();
    }

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  takeControl(): void {
    this.tabId = crypto.randomUUID();
    this.isBlocked.set(false);
    this.broadcast();
  }

  broadcast(): void {
    const msg: TabMessage = {
      type: 'TAB_ACTIVE',
      tabId: this.tabId,
      roomId: this.roomId,
      timestamp: Date.now(),
    };

    if (this.useBroadcastChannel && this.channel) {
      this.channel.postMessage(msg);
    } else {
      const key = `skytrix-pvp-active-tab-${this.roomId}`;
      localStorage.setItem(key, JSON.stringify({ tabId: this.tabId, timestamp: Date.now() }));
    }
  }

  private initBroadcastChannel(): void {
    this.channel = new BroadcastChannel('skytrix-pvp-duel');

    this.channel.onmessage = (event: MessageEvent<TabMessage>) => {
      const msg = event.data;
      if (msg.type === 'TAB_ACTIVE' && msg.roomId === this.roomId && msg.tabId !== this.tabId) {
        // Newer tab takes control — this tab is superseded
        this.isBlocked.set(true);
      }
    };
  }

  private initLocalStorageFallback(): void {
    const key = `skytrix-pvp-active-tab-${this.roomId}`;

    // Write initial entry
    localStorage.setItem(key, JSON.stringify({ tabId: this.tabId, timestamp: Date.now() }));

    this.storageHandler = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue) as { tabId: string; timestamp: number };
        if (data.tabId !== this.tabId) {
          this.isBlocked.set(true);
        }
      } catch {
        // Ignore malformed entries
      }
    };
    window.addEventListener('storage', this.storageHandler);
  }

  private cleanup(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.storageHandler) {
      window.removeEventListener('storage', this.storageHandler);
      this.storageHandler = null;
    }
    // [Review L1 fix] Clean up localStorage key to prevent accumulation
    if (this.roomId) {
      localStorage.removeItem(`skytrix-pvp-active-tab-${this.roomId}`);
    }
  }
}
