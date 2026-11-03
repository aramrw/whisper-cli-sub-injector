"use strict";
(() => {
  // src/popup/popup.ts
  document.addEventListener("DOMContentLoaded", () => {
    const enabledToggle = document.getElementById("enabled-toggle");
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const openHistoryBtn = document.getElementById("open-history-btn");
    const pauseWithVideoCheckbox = document.getElementById("pause-with-video");
    const fontSizeInput = document.getElementById("font-size");
    const fontSizeVal = document.getElementById("font-size-val");
    const bottomOffsetInput = document.getElementById("bottom-offset");
    const bottomOffsetVal = document.getElementById("bottom-offset-val");
    const alignmentSelect = document.getElementById("alignment");
    const bgBoxCheckbox = document.getElementById("bg-box");
    const stackModeCheckbox = document.getElementById("stack-mode");
    const maxLinesInput = document.getElementById("max-lines");
    const maxLinesVal = document.getElementById("max-lines-val");
    const fadeTimeoutInput = document.getElementById("fade-timeout");
    const fadeTimeoutVal = document.getElementById("fade-timeout-val");
    const subNavEnabledCheckbox = document.getElementById("sub-nav-enabled");
    const subNavPlayCheckbox = document.getElementById("sub-nav-play");
    const subNavPaddingInput = document.getElementById("sub-nav-padding");
    const subNavPaddingVal = document.getElementById("sub-nav-padding-val");
    const serverUrlInput = document.getElementById("server-url");
    const connectBtn = document.getElementById("connect-btn");
    const retryBtn = document.getElementById("retry-btn");
    const testSubBtn = document.getElementById("test-sub-btn");
    function updateStatusUI(connected, enabled) {
      if (!enabled) {
        statusDot.className = "status-dot disconnected";
        statusText.textContent = "Subtitles Disabled";
      } else if (connected) {
        statusDot.className = "status-dot connected";
        statusText.textContent = "Live \u2022 Connected to whisper-cli";
      } else {
        statusDot.className = "status-dot disconnected";
        statusText.textContent = "Disconnected from server";
      }
    }
    function fetchCurrentStatus() {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
        if (chrome.runtime.lastError || !status) return;
        updateStatusUI(status.connected, status.enabled);
      });
    }
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
      if (!settings) return;
      enabledToggle.checked = settings.enabled;
      pauseWithVideoCheckbox.checked = settings.pauseSubtitlesWithVideo ?? true;
      fontSizeInput.value = String(settings.fontSize);
      fontSizeVal.textContent = `${settings.fontSize}px`;
      bottomOffsetInput.value = String(settings.bottomOffset);
      bottomOffsetVal.textContent = `${settings.bottomOffset}px`;
      alignmentSelect.value = settings.alignment;
      bgBoxCheckbox.checked = settings.showBackgroundBox;
      stackModeCheckbox.checked = settings.stackMode ?? true;
      const maxLines = settings.maxLines || 3;
      maxLinesInput.value = String(maxLines);
      maxLinesVal.textContent = String(maxLines);
      const fadeSecs = Math.round(settings.autoFadeTimeoutMs / 1e3);
      fadeTimeoutInput.value = String(fadeSecs);
      fadeTimeoutVal.textContent = `${fadeSecs}s`;
      subNavEnabledCheckbox.checked = settings.subNavigationEnabled ?? true;
      subNavPlayCheckbox.checked = settings.subNavigationPlayOnSeek ?? true;
      const padMs = settings.subNavigationPaddingMs ?? 150;
      subNavPaddingInput.value = String(padMs);
      subNavPaddingVal.textContent = `${padMs}ms`;
      serverUrlInput.value = settings.serverUrl;
    });
    fetchCurrentStatus();
    function saveSetting(patch) {
      chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: patch }, (res) => {
        if (res?.settings) {
          updateStatusUI(res.settings.connected, res.settings.enabled);
        }
      });
    }
    enabledToggle.addEventListener("change", () => {
      saveSetting({ enabled: enabledToggle.checked });
    });
    pauseWithVideoCheckbox.addEventListener("change", () => {
      saveSetting({ pauseSubtitlesWithVideo: pauseWithVideoCheckbox.checked });
    });
    fontSizeInput.addEventListener("input", () => {
      fontSizeVal.textContent = `${fontSizeInput.value}px`;
      saveSetting({ fontSize: Number(fontSizeInput.value) });
    });
    bottomOffsetInput.addEventListener("input", () => {
      bottomOffsetVal.textContent = `${bottomOffsetInput.value}px`;
      saveSetting({ bottomOffset: Number(bottomOffsetInput.value) });
    });
    alignmentSelect.addEventListener("change", () => {
      saveSetting({ alignment: alignmentSelect.value });
    });
    bgBoxCheckbox.addEventListener("change", () => {
      saveSetting({ showBackgroundBox: bgBoxCheckbox.checked });
    });
    stackModeCheckbox.addEventListener("change", () => {
      saveSetting({ stackMode: stackModeCheckbox.checked });
    });
    maxLinesInput.addEventListener("input", () => {
      maxLinesVal.textContent = maxLinesInput.value;
      saveSetting({ maxLines: Number(maxLinesInput.value) });
    });
    fadeTimeoutInput.addEventListener("input", () => {
      fadeTimeoutVal.textContent = `${fadeTimeoutInput.value}s`;
      saveSetting({ autoFadeTimeoutMs: Number(fadeTimeoutInput.value) * 1e3 });
    });
    subNavEnabledCheckbox.addEventListener("change", () => {
      saveSetting({ subNavigationEnabled: subNavEnabledCheckbox.checked });
    });
    subNavPlayCheckbox.addEventListener("change", () => {
      saveSetting({ subNavigationPlayOnSeek: subNavPlayCheckbox.checked });
    });
    subNavPaddingInput.addEventListener("input", () => {
      subNavPaddingVal.textContent = `${subNavPaddingInput.value}ms`;
      saveSetting({ subNavigationPaddingMs: Number(subNavPaddingInput.value) });
    });
    connectBtn.addEventListener("click", () => {
      const url = serverUrlInput.value.trim();
      statusText.textContent = "Connecting...";
      saveSetting({ serverUrl: url });
      chrome.runtime.sendMessage({ type: "RECONNECT" }, () => {
        setTimeout(fetchCurrentStatus, 400);
        setTimeout(fetchCurrentStatus, 1200);
      });
    });
    retryBtn.addEventListener("click", () => {
      retryBtn.textContent = "...";
      retryBtn.disabled = true;
      statusText.textContent = "Retrying connection...";
      const url = serverUrlInput.value.trim();
      saveSetting({ serverUrl: url });
      chrome.runtime.sendMessage({ type: "RECONNECT" }, () => {
        setTimeout(() => {
          retryBtn.textContent = "Retry";
          retryBtn.disabled = false;
          fetchCurrentStatus();
        }, 500);
        setTimeout(fetchCurrentStatus, 1200);
      });
    });
    openHistoryBtn.addEventListener("click", () => {
      const historyUrl = chrome.runtime.getURL("history.html");
      chrome.tabs.create({ url: historyUrl });
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SERVER_STATUS") {
        updateStatusUI(msg.connected, enabledToggle.checked);
      }
    });
    testSubBtn.addEventListener("click", () => {
      const samplePhrases = [
        "\xA1Hola! Los subt\xEDtulos de whisper-cli funcionan perfectamente.",
        "Audio en tiempo real detectado con ScreenCaptureKit.",
        "Siguiente l\xEDnea sincronizada con el reproductor de video.",
        "Live speech transcription running seamlessly!",
        "When you pause the video, the subtitle pauses too!"
      ];
      const text = samplePhrases[Math.floor(Math.random() * samplePhrases.length)];
      const cue = {
        id: Math.random().toString(36).substring(2, 9),
        text,
        timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString(),
        receivedAt: Date.now(),
        durationMs: Number(fadeTimeoutInput.value) * 1e3
      };
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "NEW_SUBTITLE", cue });
        }
      });
    });
  });
})();
