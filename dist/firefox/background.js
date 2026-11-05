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

  // src/background/background.ts
  var currentSettings = { ...DEFAULT_SETTINGS };
  var historySettings = { ...DEFAULT_HISTORY_SETTINGS };
  var historyCache = [];
  var eventSource = null;
  var isConnected = false;
  var reconnectTimer = null;
  var reconnectAttempts = 0;
  var lastCue = null;
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        currentSettings = { ...DEFAULT_SETTINGS, ...items };
        resolve(currentSettings);
      });
    });
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
      await chrome.storage.local.set({ subtitleHistory: historyCache });
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
    if (cutoff > 0) {
      historyCache = historyCache.filter((item) => item.receivedAt >= cutoff);
    }
    if (historyCache.length > historySettings.maxEntries) {
      historyCache = historyCache.slice(historyCache.length - historySettings.maxEntries);
    }
    await chrome.storage.local.set({ subtitleHistory: historyCache });
    chrome.runtime.sendMessage({
      type: "NEW_HISTORY_ENTRY",
      entry
    }).catch(() => {
    });
  }
  function updateBadge() {
    if (!currentSettings.enabled) {
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#777777" });
    } else if (isConnected) {
      chrome.action.setBadgeText({ text: "LIVE" });
      chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
    } else {
      chrome.action.setBadgeText({ text: "DISC" });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
    }
  }
  function broadcastToTabs(message) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {
          });
        }
      }
    });
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
    const sseUrl = `${currentSettings.serverUrl.replace(/\/+$/, "")}/events`;
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
            lastCue = cue;
            addCueToHistory(cue);
            broadcastToTabs({ type: "NEW_SUBTITLE", cue });
          }
        } catch (err) {
          console.warn("[whisper-cli-sub-injector] Failed to parse SSE event data:", event.data, err);
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
        reconnectAttempts++;
        const delay = Math.min(1e3 * Math.pow(1.5, reconnectAttempts), 5e3);
        reconnectTimer = setTimeout(() => {
          connectToEventSource();
        }, delay);
      };
    } catch (err) {
      console.error("[whisper-cli-sub-injector] Error creating EventSource:", err);
      isConnected = false;
      updateBadge();
      notifyStatus(false);
      reconnectTimer = setTimeout(connectToEventSource, 3e3);
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
      sendResponse({
        connected: isConnected,
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
      reconnectAttempts = 0;
      connectToEventSource();
      sendResponse({ success: true, connected: isConnected });
      return true;
    }
    if (message.type === "PING") {
      sendResponse({ pong: true, connected: isConnected });
      return true;
    }
    if (message.type === "TAB_FOCUSED") {
      if (currentSettings.enabled && !isConnected) {
        connectToEventSource();
      }
      sendResponse({
        connected: isConnected,
        lastCue,
        settings: currentSettings
      });
      return true;
    }
    if (message.type === "GET_HISTORY") {
      pruneHistory();
      sendResponse({
        history: historyCache,
        settings: historySettings
      });
      return true;
    }
    if (message.type === "GET_HISTORY_SETTINGS") {
      sendResponse(historySettings);
      return true;
    }
    if (message.type === "UPDATE_HISTORY_SETTINGS") {
      historySettings = { ...historySettings, ...message.settings };
      chrome.storage.local.set({ historySettings }, () => {
        pruneHistory();
        sendResponse({ success: true, settings: historySettings });
      });
      return true;
    }
    if (message.type === "CLEAR_HISTORY") {
      historyCache = [];
      chrome.storage.local.set({ subtitleHistory: [] }, () => {
        chrome.runtime.sendMessage({ type: "HISTORY_CLEARED" }).catch(() => {
        });
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
      const { cueId, replacedCueId, text, videoStartTime, videoEndTime, videoTitle, isFinal } = message;
      let targetIdx = historyCache.findIndex((e) => e.id === cueId);
      const replacedIdx = replacedCueId ? historyCache.findIndex((e) => e.id === replacedCueId) : -1;
      if (replacedIdx !== -1 && targetIdx !== -1 && replacedIdx !== targetIdx) {
        const targetEntry = historyCache[replacedIdx];
        targetEntry.id = cueId;
        targetEntry.text = text.trim() || targetEntry.text;
        targetEntry.videoStartTime = videoStartTime;
        targetEntry.videoEndTime = videoEndTime;
        targetEntry.durationMs = Math.max(100, Math.round((videoEndTime - videoStartTime) * 1e3));
        if (videoTitle) targetEntry.videoTitle = videoTitle;
        if (isFinal !== void 0) targetEntry.isFinal = isFinal;
        historyCache.splice(targetIdx, 1);
        chrome.storage.local.set({ subtitleHistory: historyCache }, () => {
          chrome.runtime.sendMessage({
            type: "UPDATE_HISTORY_ENTRY",
            entry: targetEntry,
            fullRefresh: true
          }).catch(() => {
          });
          sendResponse({ success: true });
        });
        return true;
      }
      if (targetIdx === -1 && replacedIdx !== -1) {
        targetIdx = replacedIdx;
      }
      if (targetIdx === -1 && historyCache.length > 0) {
        const last = historyCache[historyCache.length - 1];
        if (Date.now() - last.receivedAt < 6e3) {
          targetIdx = historyCache.length - 1;
        }
      }
      if (targetIdx !== -1) {
        const entry = historyCache[targetIdx];
        if (videoEndTime <= 0.3 && entry.videoEndTime && entry.videoEndTime > 0.5) {
          sendResponse({ success: false });
          return true;
        }
        entry.id = cueId;
        if (text.trim()) entry.text = text.trim();
        entry.videoStartTime = videoStartTime;
        entry.videoEndTime = videoEndTime;
        entry.durationMs = Math.max(100, Math.round((videoEndTime - videoStartTime) * 1e3));
        if (videoTitle) entry.videoTitle = videoTitle;
        if (isFinal !== void 0) entry.isFinal = isFinal;
        chrome.storage.local.set({ subtitleHistory: historyCache }, () => {
          chrome.runtime.sendMessage({
            type: "UPDATE_HISTORY_ENTRY",
            entry
          }).catch(() => {
          });
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false });
      }
      return true;
    }
    if (message.type === "DROP_PAUSED_HISTORY_CUE") {
      const idx = historyCache.findIndex((e) => e.id === message.cueId);
      if (idx !== -1) {
        const target = historyCache[idx];
        if (!message.forceDelete && target.videoEndTime && target.videoEndTime > 0.5) {
          sendResponse({ success: false });
          return true;
        }
        historyCache.splice(idx, 1);
        if (lastCue && lastCue.id === message.cueId) {
          lastCue = historyCache.length > 0 ? { ...historyCache[historyCache.length - 1] } : null;
        }
        chrome.storage.local.set({ subtitleHistory: historyCache }, () => {
          chrome.runtime.sendMessage({
            type: "UPDATE_HISTORY_ENTRY",
            fullRefresh: true
          }).catch(() => {
          });
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false });
      }
      return true;
    }
  });
  setInterval(() => {
    pruneHistory();
  }, 5 * 60 * 1e3);
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "whisper-keepalive") {
      if (currentSettings.enabled && !isConnected) {
        console.log("[whisper-cli-sub-injector] Port connected; ensuring SSE connection");
        connectToEventSource();
      }
    }
  });
  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      if (currentSettings.enabled && !isConnected) {
        console.log("[whisper-cli-sub-injector] Tab switched; auto-reconnecting SSE");
        connectToEventSource();
      }
      try {
        chrome.tabs.sendMessage(activeInfo.tabId, {
          type: "TAB_ACTIVATED",
          settings: currentSettings,
          lastCue,
          connected: isConnected
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
        if (currentSettings.enabled && !isConnected) {
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
