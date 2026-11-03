import {
  DEFAULT_HISTORY_SETTINGS,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  getRetentionMs,
  HistorySettings,
  MessageToBackground,
  MessageToContent,
  SubtitleCue,
  SubtitleHistoryEntry,
} from '../common/types';

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let historySettings: HistorySettings = { ...DEFAULT_HISTORY_SETTINGS };
let historyCache: SubtitleHistoryEntry[] = [];

let eventSource: EventSource | null = null;
let isConnected = false;
let reconnectTimer: any = null;
let reconnectAttempts = 0;
let lastCue: SubtitleCue | null = null;

// Load settings from storage
async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...(items as ExtensionSettings) };
      resolve(currentSettings);
    });
  });
}

// Load history & history settings from storage.local
async function loadHistory(): Promise<void> {
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

function pruneHistory(): boolean {
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

async function addCueToHistory(cue: SubtitleCue): Promise<void> {
  const cleanNew = cue.text.trim();
  if (!cleanNew) return;

  const lastEntry = historyCache.length > 0 ? historyCache[historyCache.length - 1] : null;

  // Check if this cue is an in-progress continuation or extension of the previous entry:
  const isContinuation =
    lastEntry &&
    (lastEntry.id === cue.id ||
      cleanNew.startsWith(lastEntry.text) ||
      lastEntry.text.startsWith(cleanNew) ||
      (Date.now() - lastEntry.receivedAt < 4000 &&
        cleanNew.toLowerCase().slice(0, 15) === lastEntry.text.toLowerCase().slice(0, 15)));

  if (isContinuation && lastEntry) {
    // Overwrite the existing entry with the latest complete/longer text!
    lastEntry.text = cleanNew;
    lastEntry.timestamp = cue.timestamp || lastEntry.timestamp;
    lastEntry.receivedAt = cue.receivedAt;
    lastEntry.id = cue.id;
    lastEntry.isFinal = cue.isFinal;

    await chrome.storage.local.set({ subtitleHistory: historyCache });

    chrome.runtime.sendMessage({
      type: 'UPDATE_HISTORY_ENTRY',
      entry: lastEntry,
    }).catch(() => {});
    return;
  }

  const entry: SubtitleHistoryEntry = {
    id: cue.id,
    text: cleanNew,
    timestamp: cue.timestamp,
    receivedAt: cue.receivedAt,
    isFinal: cue.isFinal,
  };

  historyCache.push(entry);

  const retentionMs = getRetentionMs(historySettings.retentionDuration);
  const cutoff = retentionMs === Infinity ? 0 : Date.now() - retentionMs;
  if (cutoff > 0) {
    historyCache = historyCache.filter((item) => item.receivedAt >= cutoff);
  }
  if (historyCache.length > historySettings.maxEntries) {
    historyCache = historyCache.slice(historyCache.length - historySettings.maxEntries);
  }

  await chrome.storage.local.set({ subtitleHistory: historyCache });

  // Broadcast to open extension pages (e.g. History page)
  chrome.runtime.sendMessage({
    type: 'NEW_HISTORY_ENTRY',
    entry,
  }).catch(() => {
    // Popup or history page might not be open
  });
}

function updateBadge() {
  if (!currentSettings.enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#777777' });
  } else if (isConnected) {
    chrome.action.setBadgeText({ text: 'LIVE' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // Green
  } else {
    chrome.action.setBadgeText({ text: 'DISC' });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // Red
  }
}

function broadcastToTabs(message: MessageToContent) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have content script injected (e.g. chrome:// or unloaded)
        });
      }
    }
  });
}

function notifyStatus(connected: boolean) {
  // 1. Notify open extension views (popup, history tab)
  chrome.runtime.sendMessage({
    type: 'SERVER_STATUS',
    connected,
    url: currentSettings.serverUrl,
  }).catch(() => {
    // Popup or other views may be closed
  });

  // 2. Broadcast to content script tabs
  broadcastToTabs({
    type: 'SERVER_STATUS',
    connected,
    url: currentSettings.serverUrl,
  });
}

function connectToEventSource() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (!currentSettings.enabled) {
    isConnected = false;
    updateBadge();
    notifyStatus(false);
    return;
  }

  const sseUrl = `${currentSettings.serverUrl.replace(/\/+$/, '')}/events`;
  console.log(`[whisper-cli-sub-injector] Connecting to SSE: ${sseUrl}`);

  try {
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      console.log(`[whisper-cli-sub-injector] Connected to ${sseUrl}`);
      isConnected = true;
      reconnectAttempts = 0;
      updateBadge();
      notifyStatus(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;

        const cue: SubtitleCue = {
          id: data.id || Math.random().toString(36).substring(2, 9),
          text: data.text || '',
          timestamp: data.timestamp,
          receivedAt: Date.now(),
          durationMs: data.durationMs,
          lagMs: data.lagMs,
          isFinal: data.isFinal ?? true,
        };

        if (cue.text.trim()) {
          lastCue = cue;
          addCueToHistory(cue);
          broadcastToTabs({ type: 'NEW_SUBTITLE', cue });
        }
      } catch (err) {
        console.warn('[whisper-cli-sub-injector] Failed to parse SSE event data:', event.data, err);
      }
    };

    eventSource.onerror = () => {
      isConnected = false;
      updateBadge();
      notifyStatus(false);

      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      // Reconnect with exponential backoff capped at 5 seconds
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 5000);
      reconnectTimer = setTimeout(() => {
        connectToEventSource();
      }, delay);
    };
  } catch (err) {
    console.error('[whisper-cli-sub-injector] Error creating EventSource:', err);
    isConnected = false;
    updateBadge();
    notifyStatus(false);
    reconnectTimer = setTimeout(connectToEventSource, 3000);
  }
}

// Handle messages from popup, history tab, or content scripts
chrome.runtime.onMessage.addListener((message: MessageToBackground, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({
      connected: isConnected,
      serverUrl: currentSettings.serverUrl,
      enabled: currentSettings.enabled,
      lastCue,
    });
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    sendResponse(currentSettings);
    return true;
  }

  if (message.type === 'UPDATE_SETTINGS') {
    currentSettings = { ...currentSettings, ...message.settings };
    chrome.storage.sync.set(currentSettings, () => {
      updateBadge();
      broadcastToTabs({ type: 'SETTINGS_CHANGED', settings: currentSettings });
      connectToEventSource();
      sendResponse({ success: true, settings: currentSettings });
    });
    return true;
  }

  if (message.type === 'RECONNECT') {
    reconnectAttempts = 0;
    connectToEventSource();
    sendResponse({ success: true, connected: isConnected });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ pong: true, connected: isConnected });
    return true;
  }

  if (message.type === 'GET_HISTORY') {
    pruneHistory();
    sendResponse({
      history: historyCache,
      settings: historySettings,
    });
    return true;
  }

  if (message.type === 'GET_HISTORY_SETTINGS') {
    sendResponse(historySettings);
    return true;
  }

  if (message.type === 'UPDATE_HISTORY_SETTINGS') {
    historySettings = { ...historySettings, ...message.settings };
    chrome.storage.local.set({ historySettings }, () => {
      pruneHistory();
      sendResponse({ success: true, settings: historySettings });
    });
    return true;
  }

  if (message.type === 'CLEAR_HISTORY') {
    historyCache = [];
    chrome.storage.local.set({ subtitleHistory: [] }, () => {
      chrome.runtime.sendMessage({ type: 'HISTORY_CLEARED' }).catch(() => {});
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLEAR_TIMELINE_CACHE') {
    broadcastToTabs({ type: 'CLEAR_TIMELINE_CACHE' });
    sendResponse({ success: true });
    return true;
  }
});

// Periodic pruning of old history (every 5 minutes)
setInterval(() => {
  pruneHistory();
}, 5 * 60 * 1000);

// Initialize on startup
Promise.all([loadSettings(), loadHistory()]).then(() => {
  updateBadge();
  connectToEventSource();
});
