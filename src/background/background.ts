import { DEFAULT_SETTINGS, ExtensionSettings, MessageToBackground, MessageToContent, SubtitleCue } from '../common/types';

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
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
      broadcastToTabs({
        type: 'SERVER_STATUS',
        connected: true,
        url: currentSettings.serverUrl,
      });
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
          durationMs: data.durationMs || currentSettings.autoFadeTimeoutMs,
        };

        if (cue.text.trim()) {
          lastCue = cue;
          broadcastToTabs({ type: 'NEW_SUBTITLE', cue });
        }
      } catch (err) {
        console.warn('[whisper-cli-sub-injector] Failed to parse SSE event data:', event.data, err);
      }
    };

    eventSource.onerror = () => {
      isConnected = false;
      updateBadge();
      broadcastToTabs({
        type: 'SERVER_STATUS',
        connected: false,
        url: currentSettings.serverUrl,
      });

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
    reconnectTimer = setTimeout(connectToEventSource, 3000);
  }
}

// Handle messages from popup or content scripts
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
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ pong: true, connected: isConnected });
    return true;
  }
});

// Initialize on startup
loadSettings().then(() => {
  updateBadge();
  connectToEventSource();
});
