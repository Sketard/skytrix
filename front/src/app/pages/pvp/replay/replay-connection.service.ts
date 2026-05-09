import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { PROTOCOL_VERSION } from '../duel-ws.types';
import type { PreComputedState, ReplayMetadataMsg, ReplayServerMessage, ForkSanityFields } from '../replay-ws.types';

@Injectable()
export class ReplayConnectionService implements OnDestroy {

  private ws: WebSocket | null = null;

  readonly connectionStatus = signal<'connecting' | 'connected' | 'disconnected'>('disconnected');
  readonly metadata = signal<ReplayMetadataMsg | null>(null);
  readonly boardStates = signal<PreComputedState[]>([]);
  readonly computedUpTo = computed(() => this.boardStates().length - 1);
  readonly totalResponses = signal<number>(0);
  readonly error = signal<string | null>(null);
  readonly lastReceivedTurn = signal<number>(-1);
  readonly forkStatus = signal<'idle' | 'forking' | 'ready' | 'warning' | 'error'>('idle');
  readonly forkTokens = signal<{ token1: string; token2: string } | null>(null);
  readonly forkWarning = signal<string | null>(null);
  /** True when the server closed the WS with code 4426 (protocol version
   *  mismatch). The replay-page component reads this to render a "please
   *  refresh" banner instead of the generic error toast. */
  readonly protocolMismatch = signal(false);

  connect(replayId: string, token: string): void {
    this.disconnect();
    this.boardStates.set([]);
    this.lastReceivedTurn.set(-1);
    this.metadata.set(null);
    this.error.set(null);
    this.protocolMismatch.set(false);
    this.connectionStatus.set('connecting');

    const url = `${environment.wsUrl}?mode=replay&replayId=${encodeURIComponent(replayId)}&token=${encodeURIComponent(token)}&pv=${PROTOCOL_VERSION}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connectionStatus.set('connected');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch (e) {
        console.warn('[ReplayConnection] Failed to parse WS message:', e);
        return;
      }
      if (!isReplayServerMessage(parsed)) {
        console.warn('[ReplayConnection] Dropped malformed WS message:', parsed);
        return;
      }
      const msg = parsed;

      try {
        switch (msg.type) {
          case 'REPLAY_METADATA':
            this.metadata.set(msg);
            this.totalResponses.set(msg.totalResponses);
            break;

          case 'REPLAY_BOARD_STATES':
            this.boardStates.update(prev => prev.concat(msg.states));
            this.lastReceivedTurn.set(msg.turnNumber);
            break;

          case 'REPLAY_ERROR': {
            if (msg.code === 'FORK_DIVERGENCE_WARNING') {
              this.forkStatus.set('warning');
              this.forkWarning.set(msg.message);
            } else {
              this.error.set(msg.code ?? msg.message);
              if (this.forkStatus() === 'forking') {
                this.forkStatus.set('error');
              }
            }
            break;
          }

          case 'REPLAY_FORK_READY':
            this.forkStatus.set('ready');
            this.forkTokens.set({ token1: msg.token1, token2: msg.token2 });
            break;
        }
      } catch (e) {
        console.warn('[ReplayConnection] handler threw, dropping:', msg.type, e);
      }
    };

    this.ws.onclose = (event) => {
      this.connectionStatus.set('disconnected');
      // 4426 = protocol version mismatch — server is running a newer
      // PROTOCOL_VERSION than this client bundle. Surface via dedicated
      // signal so the page can render a "please refresh" banner instead of
      // the generic "connection lost" error.
      if (event.code === 4426) {
        this.protocolMismatch.set(true);
        this.error.set('replay.viewer.protocolMismatch');
        console.warn('[ReplayConnection] WS closed — protocol version mismatch (server bundle ahead of client)');
      }
    };

    this.ws.onerror = (e) => {
      console.warn('[ReplayConnection] WebSocket error:', e);
      // onclose will fire after onerror
    };
  }

  sendFork(responseCount: number, expectedState: ForkSanityFields): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.forkStatus.set('forking');
      this.forkTokens.set(null);
      this.forkWarning.set(null);
      this.ws.send(JSON.stringify({ type: 'REPLAY_FORK', responseCount, expectedState }));
    }
  }

  sendForkContinue(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'REPLAY_FORK_CONTINUE' }));
    }
  }

  sendForkCancel(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.forkStatus.set('idle');
      this.forkWarning.set(null);
      this.ws.send(JSON.stringify({ type: 'REPLAY_FORK_CANCEL' }));
    }
  }

  clearBoardStates(): void {
    this.boardStates.set([]);
  }

  resetForkState(): void {
    this.forkStatus.set('idle');
    this.forkTokens.set(null);
    this.forkWarning.set(null);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.connectionStatus.set('disconnected');
    // M20: drop any stale fork state so the next session does not inherit
    // a fork warning / tokens fantôme from the previous replay.
    this.resetForkState();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}

function isReplayServerMessage(x: unknown): x is ReplayServerMessage {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';
}
