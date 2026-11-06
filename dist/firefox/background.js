"use strict";
(() => {
  // src/common/types.ts
  var DEFAULT_HISTORY_SETTINGS = {
    retentionDuration: "24h",
    maxEntries: 1e3
  };
  function getRetentionMs(duration) {
    switch (duration) {
      case "1h":
        return 60 * 60 * 1e3;
      case "6h":
        return 6 * 60 * 60 * 1e3;
      case "24h":
        return 24 * 60 * 60 * 1e3;
      case "7d":
        return 7 * 24 * 60 * 60 * 1e3;
      case "30d":
        return 30 * 24 * 60 * 60 * 1e3;
      case "forever":
        return Infinity;
      default:
        return 24 * 60 * 60 * 1e3;
    }
  }
  var DEFAULT_SETTINGS = {
    serverUrl: "http://127.0.0.1:8989",
    enabled: true,
    fontSize: 28,
    bottomOffset: 60,
    topOffset: 40,
    alignment: "bottom",
    showBackgroundBox: true,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    autoFadeTimeoutMs: 6e3,
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
    autoEmbed: true
  };

  // src/background/history-manager.ts
  var historySettings = { ...DEFAULT_HISTORY_SETTINGS };
  var historyCache = [];
  var pendingSaveTimer = null;
  function findHistoryIndexFromEnd(id) {
    for (let i = historyCache.length - 1; i >= 0; i--) {
      if (historyCache[i].id === id) {
        return i;
      }
    }
    return -1;
  }
  async function persistHistory(immediate) {
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
  function getHistoryCache() {
    return historyCache;
  }
  function getHistorySettings() {
    return historySettings;
  }
  async function loadHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["subtitleHistory", "historySettings"], (result) => {
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
  function pruneHistory() {
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
  async function addCueToHistory(cue) {
    const cleanNew = cue.text.trim();
    if (!cleanNew) return;
    const lastEntry = historyCache.length > 0 ? historyCache[historyCache.length - 1] : null;
    const isContinuation = lastEntry && (lastEntry.id === cue.id || !lastEntry.isFinal && (cleanNew.startsWith(lastEntry.text) || lastEntry.text.startsWith(cleanNew) || Date.now() - lastEntry.receivedAt < 4e3 && cleanNew.toLowerCase().slice(0, 15) === lastEntry.text.toLowerCase().slice(0, 15)));
    if (isContinuation && lastEntry) {
      lastEntry.text = cleanNew;
      lastEntry.timestamp = cue.timestamp || lastEntry.timestamp;
      lastEntry.receivedAt = cue.receivedAt;
      lastEntry.id = cue.id;
      lastEntry.durationMs = cue.durationMs ?? lastEntry.durationMs;
      lastEntry.isFinal = cue.isFinal;
      await persistHistory(Boolean(cue.isFinal));
      chrome.runtime.sendMessage({
        type: "UPDATE_HISTORY_ENTRY",
        entry: lastEntry
      }).catch(() => {
      });
      return;
    }
    const entry = {
      id: cue.id,
      text: cleanNew,
      timestamp: cue.timestamp,
      receivedAt: cue.receivedAt,
      durationMs: cue.durationMs,
      isFinal: cue.isFinal
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
    chrome.runtime.sendMessage({
      type: "NEW_HISTORY_ENTRY",
      entry
    }).catch(() => {
    });
  }
  async function syncVideoCueTiming(params) {
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
      if (isFinal !== void 0) targetEntry.isFinal = isFinal;
      await persistHistory(Boolean(isFinal));
      chrome.runtime.sendMessage({
        type: "UPDATE_HISTORY_ENTRY",
        entry: targetEntry
      }).catch(() => {
      });
      return;
    }
    if (targetIdx === -1 && historyCache.length > 0) {
      const last = historyCache[historyCache.length - 1];
      if (Date.now() - last.receivedAt < 4e3) {
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
      if (isFinal !== void 0) entry.isFinal = isFinal;
      await persistHistory(Boolean(isFinal));
      chrome.runtime.sendMessage({
        type: "UPDATE_HISTORY_ENTRY",
        entry
      }).catch(() => {
      });
    }
  }
  async function dropPausedHistoryCue(cueId, forceDelete) {
    const idx = findHistoryIndexFromEnd(cueId);
    if (idx !== -1) {
      const target = historyCache[idx];
      if (forceDelete || !target.isFinal) {
        historyCache.splice(idx, 1);
        await persistHistory(true);
        chrome.runtime.sendMessage({
          type: "HISTORY_CLEARED"
        }).catch(() => {
        });
      }
    }
  }
  async function clearHistory() {
    historyCache = [];
    await persistHistory(true);
    chrome.runtime.sendMessage({ type: "HISTORY_CLEARED" }).catch(() => {
    });
  }
  async function updateHistorySettings(patch) {
    historySettings = { ...historySettings, ...patch };
    await chrome.storage.local.set({ historySettings });
    pruneHistory();
  }

  // src/background/cue-dispatcher.ts
  var connectedContentPorts = /* @__PURE__ */ new Set();
  function broadcastToTabs(message, ports = connectedContentPorts) {
    if (ports.size > 0) {
      for (const port of ports) {
        try {
          port.postMessage(message);
        } catch {
          ports.delete(port);
        }
      }
      return;
    }
    try {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {
            });
          }
        }
      });
    } catch {
    }
  }
  function dispatchCueFromBackground(cue, ports = connectedContentPorts) {
    broadcastToTabs({ type: "NEW_SUBTITLE", cue }, ports);
    addCueToHistory(cue);
  }

  // src/background/sse-client.ts
  var SseClient = class {
    eventSource = null;
    isConnected = false;
    reconnectTimer = null;
    reconnectAttempts = 0;
    callbacks;
    constructor(callbacks) {
      this.callbacks = callbacks;
    }
    get connected() {
      return this.isConnected;
    }
    disconnect() {
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
    connect(serverUrl, enabled) {
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
      const sseUrl = `${serverUrl.replace(/\/+$/, "")}/events`;
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
            if (data.type === "ping") return;
            const cue = {
              id: data.id || Math.random().toString(36).substring(2, 9),
              text: data.text || "",
              timestamp: data.timestamp,
              receivedAt: Date.now(),
              clipStartMs: data.clipStartMs,
              clipEndMs: data.clipEndMs,
              durationMs: data.durationMs,
              lagMs: data.lagMs,
              isFinal: data.isFinal ?? true
            };
            if (cue.text.trim()) {
              this.callbacks.onCueReceived(cue);
            }
          } catch (err) {
            console.warn("[whisper-cli-sub-injector] Failed to parse SSE event data:", event.data, err);
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
          const delay = Math.min(1e3 * Math.pow(1.5, this.reconnectAttempts), 5e3);
          this.reconnectTimer = setTimeout(() => {
            this.connect(serverUrl, enabled);
          }, delay);
        };
      } catch (err) {
        console.error("[whisper-cli-sub-injector] Error creating EventSource:", err);
        this.isConnected = false;
        this.callbacks.onStatusChange(false);
        this.reconnectTimer = setTimeout(() => {
          this.connect(serverUrl, enabled);
        }, 3e3);
      }
    }
  };

  // src/background/background.ts
  var currentSettings = { ...DEFAULT_SETTINGS };
  var lastCue = null;
  var sseClient = new SseClient({
    onStatusChange: (connected) => {
      updateBadge(connected);
      notifyStatus(connected);
    },
    onCueReceived: (cue) => {
      lastCue = cue;
      dispatchCueFromBackground(cue);
    }
  });
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        currentSettings = { ...DEFAULT_SETTINGS, ...items };
        resolve(currentSettings);
      });
    });
  }
  function updateBadge(connected = sseClient.connected) {
    if (!currentSettings.enabled) {
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#777777" });
    } else if (connected) {
      chrome.action.setBadgeText({ text: "LIVE" });
      chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
    } else {
      chrome.action.setBadgeText({ text: "..." });
      chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
    }
  }
  function notifyStatus(connected) {
    chrome.runtime.sendMessage({
      type: "SERVER_STATUS",
      connected,
      url: currentSettings.serverUrl
    }).catch(() => {
    });
    broadcastToTabs({
      type: "SERVER_STATUS",
      connected,
      url: currentSettings.serverUrl
    });
  }
  function connectToEventSource() {
    sseClient.connect(currentSettings.serverUrl, currentSettings.enabled);
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
      sendResponse({
        connected: sseClient.connected,
        serverUrl: currentSettings.serverUrl,
        enabled: currentSettings.enabled,
        lastCue
      });
      return true;
    }
    if (message.type === "GET_SETTINGS") {
      sendResponse(currentSettings);
      return true;
    }
    if (message.type === "UPDATE_SETTINGS") {
      currentSettings = { ...currentSettings, ...message.settings };
      chrome.storage.sync.set(currentSettings, () => {
        updateBadge();
        broadcastToTabs({ type: "SETTINGS_CHANGED", settings: currentSettings });
        connectToEventSource();
        sendResponse({ success: true, settings: currentSettings });
      });
      return true;
    }
    if (message.type === "RECONNECT") {
      connectToEventSource();
      sendResponse({ success: true, connected: sseClient.connected });
      return true;
    }
    if (message.type === "PING") {
      sendResponse({ pong: true, connected: sseClient.connected });
      return true;
    }
    if (message.type === "TAB_FOCUSED") {
      if (currentSettings.enabled && !sseClient.connected) {
        connectToEventSource();
      }
      sendResponse({
        connected: sseClient.connected,
        lastCue,
        settings: currentSettings
      });
      return true;
    }
    if (message.type === "GET_HISTORY") {
      pruneHistory();
      sendResponse({
        history: getHistoryCache(),
        settings: getHistorySettings()
      });
      return true;
    }
    if (message.type === "GET_HISTORY_SETTINGS") {
      sendResponse(getHistorySettings());
      return true;
    }
    if (message.type === "UPDATE_HISTORY_SETTINGS") {
      updateHistorySettings(message.settings).then(() => {
        sendResponse({ success: true, settings: getHistorySettings() });
      });
      return true;
    }
    if (message.type === "CLEAR_HISTORY") {
      clearHistory().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
    if (message.type === "CLEAR_TIMELINE_CACHE") {
      broadcastToTabs({ type: "CLEAR_TIMELINE_CACHE" });
      sendResponse({ success: true });
      return true;
    }
    if (message.type === "SYNC_VIDEO_CUE_TIMING") {
      syncVideoCueTiming(message).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
    if (message.type === "DROP_PAUSED_HISTORY_CUE") {
      dropPausedHistoryCue(message.cueId, message.forceDelete).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });
  setInterval(() => {
    pruneHistory();
  }, 5 * 60 * 1e3);
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "whisper-keepalive" || port.name === "content-keepalive") {
      connectedContentPorts.add(port);
      port.onDisconnect.addListener(() => {
        connectedContentPorts.delete(port);
      });
      if (currentSettings.enabled && !sseClient.connected) {
        console.log("[whisper-cli-sub-injector] Port connected; ensuring SSE connection");
        connectToEventSource();
      }
    }
  });
  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      if (currentSettings.enabled && !sseClient.connected) {
        console.log("[whisper-cli-sub-injector] Tab switched; auto-reconnecting SSE");
        connectToEventSource();
      }
      try {
        chrome.tabs.sendMessage(activeInfo.tabId, {
          type: "TAB_ACTIVATED",
          settings: currentSettings,
          lastCue,
          connected: sseClient.connected
        }).catch(() => {
        });
      } catch {
      }
    });
  }
  try {
    chrome.alarms.create("whisper-watchdog", { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "whisper-watchdog") {
        if (currentSettings.enabled && !sseClient.connected) {
          console.log("[whisper-cli-sub-injector] Watchdog alarm reconnecting SSE");
          connectToEventSource();
        }
      }
    });
  } catch (e) {
    console.warn("[whisper-cli-sub-injector] chrome.alarms not initialized:", e);
  }
  function reinjectContentScriptsIntoOpenTabs() {
    try {
      if (!chrome.scripting?.executeScript || !chrome.tabs?.query) return;
      chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
        for (const tab of tabs) {
          if (!tab.id) continue;
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ["content.js"]
          }).catch(() => {
          });
        }
      });
    } catch {
    }
  }
  chrome.runtime.onInstalled?.addListener(() => {
    reinjectContentScriptsIntoOpenTabs();
  });
  Promise.all([loadSettings(), loadHistory()]).then(() => {
    updateBadge();
    connectToEventSource();
  });
})();
