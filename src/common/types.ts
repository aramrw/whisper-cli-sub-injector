export interface SubtitleCue {
  id: string;
  text: string;
  timestamp?: string;
  receivedAt: number;
  clipStartMs?: number;
  clipEndMs?: number;
  durationMs?: number;
  lagMs?: number;
  isFinal?: boolean;
}

export interface SubtitleHistoryEntry {
  id: string;
  text: string;
  timestamp?: string;
  receivedAt: number;
  durationMs?: number;
  videoStartTime?: number; // in video.currentTime seconds
  videoEndTime?: number;   // in video.currentTime seconds
  videoTitle?: string;
  isFinal?: boolean;
}

export type HistoryRetentionDuration = '1h' | '6h' | '24h' | '7d' | '30d' | 'forever';

export interface HistorySettings {
  retentionDuration: HistoryRetentionDuration;
  maxEntries: number;
}

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  retentionDuration: '24h',
  maxEntries: 1000,
};

export function getRetentionMs(duration: HistoryRetentionDuration): number {
  switch (duration) {
    case '1h':
      return 60 * 60 * 1000;
    case '6h':
      return 6 * 60 * 60 * 1000;
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case 'forever':
      return Infinity;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export interface DetectedVideoInfo {
  id: string;
  src: string;
  currentSrc: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  width: number;
  height: number;
  isSelected: boolean;
  title: string;
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
  pauseSubtitlesWithVideo: boolean;
  ignoreSubtitlesWhenPaused: boolean;
  subNavigationEnabled: boolean;
  subForwardNavigationEnabled: boolean;
  subNavigationPlayOnSeek: boolean;
  subNavigationPaddingMs: number;
  enableSubtitleCache: boolean;
  exactByteTiming: boolean;
  splitMultiSentenceCues: boolean;
  autoHealTimelineOverlaps: boolean;
  cementSubtitlesInTimeline: boolean;
  showRerecordButton: boolean;
  showPrevButton: boolean;
  showNextButton: boolean;
  srtStartPaddingMs: number;
  srtEndPaddingMs: number;
  autoEmbed: boolean;
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
  pauseSubtitlesWithVideo: true,
  ignoreSubtitlesWhenPaused: true,
  subNavigationEnabled: true,
  subForwardNavigationEnabled: true,
  subNavigationPlayOnSeek: true,
  subNavigationPaddingMs: 150,
  enableSubtitleCache: true,
  exactByteTiming: true,
  splitMultiSentenceCues: true,
  autoHealTimelineOverlaps: false,
  cementSubtitlesInTimeline: true,
  showRerecordButton: true,
  showPrevButton: true,
  showNextButton: true,
  srtStartPaddingMs: 50,
  srtEndPaddingMs: 100,
  autoEmbed: true,
};

export type MessageToContent =
  | { type: 'NEW_SUBTITLE'; cue: SubtitleCue }
  | { type: 'SETTINGS_CHANGED'; settings: ExtensionSettings }
  | { type: 'SERVER_STATUS'; connected: boolean; url: string }
  | { type: 'CLEAR_SUBTITLES' }
  | { type: 'CLEAR_TIMELINE_CACHE' }
  | { type: 'GET_DETECTED_VIDEOS' }
  | { type: 'SELECT_VIDEO'; videoId: string }
  | { type: 'SET_AUTO_EMBED'; autoEmbed: boolean }
  | { type: 'HIGHLIGHT_VIDEO'; videoId: string }
  | { type: 'UNHIGHLIGHT_VIDEO' }
  | { type: 'TAB_ACTIVATED'; settings: ExtensionSettings; lastCue: SubtitleCue | null; connected: boolean };

export type MessageToBackground =
  | { type: 'GET_STATUS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { type: 'RECONNECT' }
  | { type: 'PING' }
  | { type: 'TAB_FOCUSED' }
  | { type: 'GET_HISTORY' }
  | { type: 'GET_HISTORY_SETTINGS' }
  | { type: 'UPDATE_HISTORY_SETTINGS'; settings: Partial<HistorySettings> }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'CLEAR_TIMELINE_CACHE' }
  | {
      type: 'SYNC_VIDEO_CUE_TIMING';
      cueId: string;
      replacedCueId?: string;
      text: string;
      videoStartTime: number;
      videoEndTime: number;
      videoTitle?: string;
      isFinal?: boolean;
    }
  | { type: 'DROP_PAUSED_HISTORY_CUE'; cueId: string; forceDelete?: boolean };

export type BroadcastMessage =
  | MessageToContent
  | { type: 'NEW_HISTORY_ENTRY'; entry: SubtitleHistoryEntry }
  | { type: 'HISTORY_CLEARED' };
