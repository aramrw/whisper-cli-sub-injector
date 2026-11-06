import {
  DEFAULT_SETTINGS,
  ExtensionSettings,
  MessageToBackground,
  MessageToContent,
  SubtitleCue,
} from '../common/types';
import {
  addCueToHistory,
  clearHistory,
  dropPausedHistoryCue,
  getHistoryCache,
  getHistorySettings,
  loadHistory,
  pruneHistory,
  syncVideoCueTiming,
  updateHistorySettings,
} from './history-manager';
import {
  broadcastToTabs,
  connectedContentPorts,
  dispatchCueFromBackground,
} from './cue-dispatcher';
import { SseClient } from './sse-client';

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let lastCue: SubtitleCue | null = null;

const sseClient = new SseClient({
  onStatusChange: (connected) => {
    updateBadge(connected);
    notifyStatus(connected);
  },
  onCueReceived: (cue) => {
    lastCue = cue;
    dispatchCueFromBackground(cue);
  },
});

async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...(items as ExtensionSettings) };
      resolve(currentSettings);
    });
  });
}

function updateBadge(connected: boolean = sseClient.connected) {
  if (!currentSettings.enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#777777' });
  } else if (connected) {
    chrome.action.setBadgeText({ text: 'LIVE' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
  } else {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
  }
}

function notifyStatus(connected: boolean) {
  chrome.runtime
    .sendMessage({
      type: 'SERVER_STATUS',
      connected,
      url: currentSettings.serverUrl,
    })
    .catch(() => {});

  broadcastToTabs({
    type: 'SERVER_STATUS',
    connected,
    url: currentSettings.serverUrl,
  });
}

function connectToEventSource() {
  sseClient.connect(currentSettings.serverUrl, currentSettings.enabled);
}

// Handle messages from popup, history tab, or content scripts
chrome.runtime.onMessage.addListener((message: MessageToBackground, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({
      connected: sseClient.connected,
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
    connectToEventSource();
    sendResponse({ success: true, connected: sseClient.connected });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ pong: true, connected: sseClient.connected });
    return true;
  }

  if (message.type === 'TAB_FOCUSED') {
    if (currentSettings.enabled && !sseClient.connected) {
      connectToEventSource();
    }
    sendResponse({
      connected: sseClient.connected,
      lastCue,
      settings: currentSettings,
    });
    return true;
  }

  if (message.type === 'GET_HISTORY') {
    pruneHistory();
    sendResponse({
      history: getHistoryCache(),
      settings: getHistorySettings(),
    });
    return true;
  }

  if (message.type === 'GET_HISTORY_SETTINGS') {
    sendResponse(getHistorySettings());
    return true;
  }

  if (message.type === 'UPDATE_HISTORY_SETTINGS') {
    updateHistorySettings(message.settings).then(() => {
      sendResponse({ success: true, settings: getHistorySettings() });
    });
    return true;
  }

  if (message.type === 'CLEAR_HISTORY') {
    clearHistory().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLEAR_TIMELINE_CACHE') {
    broadcastToTabs({ type: 'CLEAR_TIMELINE_CACHE' });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SYNC_VIDEO_CUE_TIMING') {
    syncVideoCueTiming(message).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'DROP_PAUSED_HISTORY_CUE') {
    dropPausedHistoryCue(message.cueId, message.forceDelete).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Periodic pruning of old history (every 5 minutes)
setInterval(() => {
  pruneHistory();
}, 5 * 60 * 1000);

// Setup keepalive port listener for active content script tabs
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'whisper-keepalive' || port.name === 'content-keepalive') {
    connectedContentPorts.add(port);
    port.onDisconnect.addListener(() => {
      connectedContentPorts.delete(port);
    });
    if (currentSettings.enabled && !sseClient.connected) {
      console.log('[whisper-cli-sub-injector] Port connected; ensuring SSE connection');
      connectToEventSource();
    }
  }
});

// Auto-reconnect & notify when tabs change or activate
if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (currentSettings.enabled && !sseClient.connected) {
      console.log('[whisper-cli-sub-injector] Tab switched; auto-reconnecting SSE');
      connectToEventSource();
    }
    try {
      chrome.tabs
        .sendMessage(activeInfo.tabId, {
          type: 'TAB_ACTIVATED',
          settings: currentSettings,
          lastCue,
          connected: sseClient.connected,
        })
        .catch(() => {});
    } catch {}
  });
}

// Watchdog alarm for Chrome MV3 service worker keep-alive
try {
  chrome.alarms.create('whisper-watchdog', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'whisper-watchdog') {
      if (currentSettings.enabled && !sseClient.connected) {
        console.log('[whisper-cli-sub-injector] Watchdog alarm reconnecting SSE');
        connectToEventSource();
      }
    }
  });
} catch (e) {
  console.warn('[whisper-cli-sub-injector] chrome.alarms not initialized:', e);
}

function reinjectContentScriptsIntoOpenTabs() {
  try {
    if (!chrome.scripting?.executeScript || !chrome.tabs?.query) return;
    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
      for (const tab of tabs) {
        if (!tab.id) continue;
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['content.js'],
          })
          .catch(() => {});
      }
    });
  } catch {}
}

chrome.runtime.onInstalled?.addListener(() => {
  reinjectContentScriptsIntoOpenTabs();
});

// Initialize on startup
Promise.all([loadSettings(), loadHistory()]).then(() => {
  updateBadge();
  connectToEventSource();
});
