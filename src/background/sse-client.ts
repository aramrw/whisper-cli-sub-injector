import { SubtitleCue } from '../common/types';

export interface SseClientCallbacks {
  onStatusChange: (connected: boolean) => void;
  onCueReceived: (cue: SubtitleCue) => void;
}

export class SseClient {
  private eventSource: EventSource | null = null;
  private isConnected = false;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private callbacks: SseClientCallbacks;

  constructor(callbacks: SseClientCallbacks) {
    this.callbacks = callbacks;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnected = false;
    this.callbacks.onStatusChange(false);
  }

  connect(serverUrl: string, enabled: boolean): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (!enabled) {
      this.isConnected = false;
      this.callbacks.onStatusChange(false);
      return;
    }

    const sseUrl = `${serverUrl.replace(/\/+$/, '')}/events`;
    console.log(`[whisper-cli-sub-injector] Connecting to SSE: ${sseUrl}`);

    try {
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        console.log(`[whisper-cli-sub-injector] Connected to ${sseUrl}`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.callbacks.onStatusChange(true);
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ping') return;

          const cue: SubtitleCue = {
            id: data.id || Math.random().toString(36).substring(2, 9),
            text: data.text || '',
            timestamp: data.timestamp,
            receivedAt: Date.now(),
            clipStartMs: data.clipStartMs,
            clipEndMs: data.clipEndMs,
            durationMs: data.durationMs,
            lagMs: data.lagMs,
            isFinal: data.isFinal ?? true,
          };

          if (cue.text.trim()) {
            this.callbacks.onCueReceived(cue);
          }
        } catch (err) {
          console.warn('[whisper-cli-sub-injector] Failed to parse SSE event data:', event.data, err);
        }
      };

      this.eventSource.onerror = () => {
        this.isConnected = false;
        this.callbacks.onStatusChange(false);

        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 5000);
        this.reconnectTimer = setTimeout(() => {
          this.connect(serverUrl, enabled);
        }, delay);
      };
    } catch (err) {
      console.error('[whisper-cli-sub-injector] Error creating EventSource:', err);
      this.isConnected = false;
      this.callbacks.onStatusChange(false);
      this.reconnectTimer = setTimeout(() => {
        this.connect(serverUrl, enabled);
      }, 3000);
    }
  }
}
