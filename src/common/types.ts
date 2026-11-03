export interface SubtitleCue {
  id: string;
  text: string;
  timestamp?: string;
  receivedAt: number;
  durationMs?: number;
}

export interface ExtensionSettings {
  serverUrl: string;
  enabled: boolean;
  fontSize: number; // in pixels
  bottomOffset: number; // in pixels
  topOffset: number; // in pixels
  alignment: 'bottom' | 'top';
  showBackgroundBox: boolean;
  backgroundColor: string;
  textColor: string;
  outlineColor: string;
  autoFadeTimeoutMs: number;
  maxLines: number;
  stackMode: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: 'http://127.0.0.1:8989',
  enabled: true,
  fontSize: 28,
  bottomOffset: 60,
  topOffset: 40,
  alignment: 'bottom',
  showBackgroundBox: true,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  textColor: '#FFFFFF',
  outlineColor: '#000000',
  autoFadeTimeoutMs: 6000,
  maxLines: 3,
  stackMode: true,
};

export type MessageToContent =
  | { type: 'NEW_SUBTITLE'; cue: SubtitleCue }
  | { type: 'SETTINGS_CHANGED'; settings: ExtensionSettings }
  | { type: 'SERVER_STATUS'; connected: boolean; url: string }
  | { type: 'CLEAR_SUBTITLES' };

export type MessageToBackground =
  | { type: 'GET_STATUS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { type: 'RECONNECT' }
  | { type: 'PING' };
