"use strict";
(() => {
  // src/common/types.ts
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
    stackMode: true
  };

  // src/background/background.ts
  var currentSettings = { ...DEFAULT_SETTINGS };
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
    const sseUrl = `${currentSettings.serverUrl.replace(/\/+$/, "")}/events`;
    console.log(`[whisper-cli-sub-injector] Connecting to SSE: ${sseUrl}`);
    try {
      eventSource = new EventSource(sseUrl);
      eventSource.onopen = () => {
        console.log(`[whisper-cli-sub-injector] Connected to ${sseUrl}`);
        isConnected = true;
        reconnectAttempts = 0;
        updateBadge();
        broadcastToTabs({
          type: "SERVER_STATUS",
          connected: true,
          url: currentSettings.serverUrl
        });
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
            durationMs: data.durationMs || currentSettings.autoFadeTimeoutMs
          };
          if (cue.text.trim()) {
            lastCue = cue;
            broadcastToTabs({ type: "NEW_SUBTITLE", cue });
          }
        } catch (err) {
          console.warn("[whisper-cli-sub-injector] Failed to parse SSE event data:", event.data, err);
        }
      };
      eventSource.onerror = () => {
        isConnected = false;
        updateBadge();
        broadcastToTabs({
          type: "SERVER_STATUS",
          connected: false,
          url: currentSettings.serverUrl
        });
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
      sendResponse({ success: true });
      return true;
    }
    if (message.type === "PING") {
      sendResponse({ pong: true, connected: isConnected });
      return true;
    }
  });
  loadSettings().then(() => {
    updateBadge();
    connectToEventSource();
  });
})();
