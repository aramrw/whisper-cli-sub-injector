import {
  DEFAULT_HISTORY_SETTINGS,
  getRetentionMs,
  HistorySettings,
  SubtitleCue,
  SubtitleHistoryEntry,
} from '../common/types';

let historySettings: HistorySettings = { ...DEFAULT_HISTORY_SETTINGS };
let historyCache: SubtitleHistoryEntry[] = [];
let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;

function findHistoryIndexFromEnd(id: string): number {
  for (let i = historyCache.length - 1; i >= 0; i--) {
    if (historyCache[i].id === id) {
      return i;
    }
  }
  return -1;
}

async function persistHistory(immediate: boolean): Promise<void> {
  if (immediate) {
    if (pendingSaveTimer) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    await chrome.storage.local.set({ subtitleHistory: historyCache });
    return;
  }

  if (!pendingSaveTimer) {
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      chrome.storage.local.set({ subtitleHistory: historyCache });
    }, 400);
  }
}

export async function flushPendingHistorySave(): Promise<void> {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
    await chrome.storage.local.set({ subtitleHistory: historyCache });
  }
}

export function getHistoryCache(): SubtitleHistoryEntry[] {
  return historyCache;
}

export function getHistorySettings(): HistorySettings {
  return historySettings;
}

export async function loadHistory(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['subtitleHistory', 'historySettings'], (result) => {
      if (result.historySettings) {
        historySettings = { ...DEFAULT_HISTORY_SETTINGS, ...result.historySettings };
      }
      if (Array.isArray(result.subtitleHistory)) {
        historyCache = result.subtitleHistory;
      } else {
        historyCache = [];
      }
      pruneHistory();
      resolve();
    });
  });
}

export function pruneHistory(): boolean {
  const retentionMs = getRetentionMs(historySettings.retentionDuration);
  const cutoff = retentionMs === Infinity ? 0 : Date.now() - retentionMs;
  const initialLen = historyCache.length;

  let filtered = historyCache.filter((item) => item.receivedAt >= cutoff);
  if (filtered.length > historySettings.maxEntries) {
    filtered = filtered.slice(filtered.length - historySettings.maxEntries);
  }

  const changed = filtered.length !== initialLen;
  if (changed) {
    historyCache = filtered;
    chrome.storage.local.set({ subtitleHistory: historyCache });
  }
  return changed;
}

export async function addCueToHistory(cue: SubtitleCue): Promise<void> {
  const cleanNew = cue.text.trim();
  if (!cleanNew) return;

  const lastEntry = historyCache.length > 0 ? historyCache[historyCache.length - 1] : null;

  const isContinuation =
    lastEntry &&
    (lastEntry.id === cue.id ||
      (!lastEntry.isFinal &&
        (cleanNew.startsWith(lastEntry.text) ||
          lastEntry.text.startsWith(cleanNew) ||
          (Date.now() - lastEntry.receivedAt < 4000 &&
            cleanNew.toLowerCase().slice(0, 15) === lastEntry.text.toLowerCase().slice(0, 15)))));

  if (isContinuation && lastEntry) {
    lastEntry.text = cleanNew;
    lastEntry.timestamp = cue.timestamp || lastEntry.timestamp;
    lastEntry.receivedAt = cue.receivedAt;
    lastEntry.id = cue.id;
    lastEntry.durationMs = cue.durationMs ?? lastEntry.durationMs;
    lastEntry.isFinal = cue.isFinal;

    await persistHistory(Boolean(cue.isFinal));

    chrome.runtime
      .sendMessage({
        type: 'UPDATE_HISTORY_ENTRY',
        entry: lastEntry,
      })
      .catch(() => {});
    return;
  }

  const entry: SubtitleHistoryEntry = {
    id: cue.id,
    text: cleanNew,
    timestamp: cue.timestamp,
    receivedAt: cue.receivedAt,
    durationMs: cue.durationMs,
    isFinal: cue.isFinal,
  };

  historyCache.push(entry);

  const retentionMs = getRetentionMs(historySettings.retentionDuration);
  const cutoff = retentionMs === Infinity ? 0 : Date.now() - retentionMs;
  if (cutoff > 0 && historyCache[0] && historyCache[0].receivedAt < cutoff) {
    historyCache = historyCache.filter((item) => item.receivedAt >= cutoff);
  }
  if (historyCache.length > historySettings.maxEntries) {
    historyCache = historyCache.slice(historyCache.length - historySettings.maxEntries);
  }

  await persistHistory(Boolean(cue.isFinal));

  chrome.runtime
    .sendMessage({
      type: 'NEW_HISTORY_ENTRY',
      entry,
    })
    .catch(() => {});
}

export async function syncVideoCueTiming(params: {
  cueId: string;
  replacedCueId?: string;
  text?: string;
  videoStartTime: number;
  videoEndTime: number;
  videoTitle?: string;
  isFinal?: boolean;
}): Promise<void> {
  const { cueId, replacedCueId, text, videoStartTime, videoEndTime, videoTitle, isFinal } = params;

  let targetIdx = findHistoryIndexFromEnd(cueId);
  const replacedIdx = replacedCueId ? findHistoryIndexFromEnd(replacedCueId) : -1;

  if (replacedIdx !== -1 && targetIdx === -1) {
    const targetEntry = historyCache[replacedIdx];
    targetEntry.id = cueId;
    if (text) targetEntry.text = text;
    targetEntry.videoStartTime = videoStartTime;
    targetEntry.videoEndTime = videoEndTime;
    if (videoTitle) targetEntry.videoTitle = videoTitle;
    if (isFinal !== undefined) targetEntry.isFinal = isFinal;

    await persistHistory(Boolean(isFinal));
    chrome.runtime
      .sendMessage({
        type: 'UPDATE_HISTORY_ENTRY',
        entry: targetEntry,
      })
      .catch(() => {});
    return;
  }

  if (targetIdx === -1 && historyCache.length > 0) {
    const last = historyCache[historyCache.length - 1];
    if (Date.now() - last.receivedAt < 4000) {
      targetIdx = historyCache.length - 1;
    }
  }

  if (targetIdx !== -1) {
    const entry = historyCache[targetIdx];
    entry.id = cueId;
    if (text) entry.text = text;
    entry.videoStartTime = videoStartTime;
    entry.videoEndTime = videoEndTime;
    if (videoTitle) entry.videoTitle = videoTitle;
    if (isFinal !== undefined) entry.isFinal = isFinal;

    await persistHistory(Boolean(isFinal));
    chrome.runtime
      .sendMessage({
        type: 'UPDATE_HISTORY_ENTRY',
        entry,
      })
      .catch(() => {});
  }
}

export async function dropPausedHistoryCue(cueId: string, forceDelete?: boolean): Promise<void> {
  const idx = findHistoryIndexFromEnd(cueId);
  if (idx !== -1) {
    const target = historyCache[idx];
    if (forceDelete || !target.isFinal) {
      historyCache.splice(idx, 1);
      await persistHistory(true);
      chrome.runtime
        .sendMessage({
          type: 'HISTORY_CLEARED',
        })
        .catch(() => {});
    }
  }
}

export async function clearHistory(): Promise<void> {
  historyCache = [];
  await persistHistory(true);
  chrome.runtime.sendMessage({ type: 'HISTORY_CLEARED' }).catch(() => {});
}

export async function updateHistorySettings(patch: Partial<HistorySettings>): Promise<void> {
  historySettings = { ...historySettings, ...patch };
  await chrome.storage.local.set({ historySettings });
  pruneHistory();
}
