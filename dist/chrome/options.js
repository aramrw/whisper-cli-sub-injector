"use strict";
(() => {
  // src/common/types.ts
  var DEFAULT_HISTORY_SETTINGS = {
    retentionDuration: "24h",
    maxEntries: 1e3
  };
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

  // src/options/options.ts
  document.addEventListener("DOMContentLoaded", () => {
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const saveToast = document.getElementById("save-toast");
    const openHistoryBtn = document.getElementById("open-history-btn");
    const exactByteTimingCheckbox = document.getElementById("exact-byte-timing");
    const splitMultiSentenceCheckbox = document.getElementById("split-multi-sentence");
    const enableSubCacheCheckbox = document.getElementById("enable-sub-cache");
    const cementSubtitlesCheckbox = document.getElementById("cement-subtitles");
    const showRerecordBtnCheckbox = document.getElementById("show-rerecord-btn");
    const showPrevBtnCheckbox = document.getElementById("show-prev-btn");
    const showNextBtnCheckbox = document.getElementById("show-next-btn");
    const autoHealOverlapsCheckbox = document.getElementById("auto-heal-overlaps");
    const srtStartPaddingInput = document.getElementById("srt-start-padding");
    const srtStartPaddingVal = document.getElementById("srt-start-padding-val");
    const srtEndPaddingInput = document.getElementById("srt-end-padding");
    const srtEndPaddingVal = document.getElementById("srt-end-padding-val");
    const clearCacheBtn = document.getElementById("clear-cache-btn");
    const ignoreWhenPausedCheckbox = document.getElementById("ignore-when-paused");
    const pauseWithVideoCheckbox = document.getElementById("pause-with-video");
    const autoEmbedCheckbox = document.getElementById("auto-embed");
    const subNavEnabledCheckbox = document.getElementById("sub-nav-enabled");
    const subForwardNavEnabledCheckbox = document.getElementById("sub-forward-nav-enabled");
    const subNavPlayCheckbox = document.getElementById("sub-nav-play");
    const subNavPaddingInput = document.getElementById("sub-nav-padding");
    const subNavPaddingVal = document.getElementById("sub-nav-padding-val");
    const fontSizeInput = document.getElementById("font-size");
    const fontSizeVal = document.getElementById("font-size-val");
    const alignmentSelect = document.getElementById("alignment");
    const bottomOffsetInput = document.getElementById("bottom-offset");
    const bottomOffsetVal = document.getElementById("bottom-offset-val");
    const topOffsetInput = document.getElementById("top-offset");
    const topOffsetVal = document.getElementById("top-offset-val");
    const bgBoxCheckbox = document.getElementById("bg-box");
    const stackModeCheckbox = document.getElementById("stack-mode");
    const maxLinesInput = document.getElementById("max-lines");
    const maxLinesVal = document.getElementById("max-lines-val");
    const fadeTimeoutInput = document.getElementById("fade-timeout");
    const fadeTimeoutVal = document.getElementById("fade-timeout-val");
    const serverUrlInput = document.getElementById("server-url");
    const connectBtn = document.getElementById("connect-btn");
    const retryBtn = document.getElementById("retry-btn");
    const retentionSelect = document.getElementById("retention-duration");
    const maxEntriesSelect = document.getElementById("max-entries");
    const resetDefaultsBtn = document.getElementById("reset-defaults-btn");
    let toastTimeout = null;
    function showSavedToast(label = "\u2713 Saved") {
      saveToast.textContent = label;
      saveToast.classList.add("visible");
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        saveToast.classList.remove("visible");
      }, 1400);
    }
    function updateStatus(connected) {
      if (connected) {
        statusDot.className = "status-dot connected";
        statusText.textContent = "Live \u2022 Connected to whisper-cli";
      } else {
        statusDot.className = "status-dot disconnected";
        statusText.textContent = "Disconnected";
      }
    }
    function populateSettingsUI(s) {
      exactByteTimingCheckbox.checked = s.exactByteTiming ?? true;
      splitMultiSentenceCheckbox.checked = s.splitMultiSentenceCues ?? true;
      enableSubCacheCheckbox.checked = s.enableSubtitleCache ?? true;
      cementSubtitlesCheckbox.checked = s.cementSubtitlesInTimeline ?? true;
      showRerecordBtnCheckbox.checked = s.showRerecordButton ?? true;
      showPrevBtnCheckbox.checked = s.showPrevButton ?? true;
      showNextBtnCheckbox.checked = s.showNextButton ?? true;
      autoHealOverlapsCheckbox.checked = s.autoHealTimelineOverlaps ?? false;
      const startPad = s.srtStartPaddingMs ?? 50;
      srtStartPaddingInput.value = String(startPad);
      srtStartPaddingVal.textContent = `${startPad}ms`;
      const endPad = s.srtEndPaddingMs ?? 100;
      srtEndPaddingInput.value = String(endPad);
      srtEndPaddingVal.textContent = `${endPad}ms`;
      ignoreWhenPausedCheckbox.checked = s.ignoreSubtitlesWhenPaused ?? true;
      pauseWithVideoCheckbox.checked = s.pauseSubtitlesWithVideo ?? true;
      autoEmbedCheckbox.checked = s.autoEmbed ?? true;
      subNavEnabledCheckbox.checked = s.subNavigationEnabled ?? true;
      subForwardNavEnabledCheckbox.checked = s.subForwardNavigationEnabled ?? true;
      subNavPlayCheckbox.checked = s.subNavigationPlayOnSeek ?? true;
      const seekPad = s.subNavigationPaddingMs ?? 150;
      subNavPaddingInput.value = String(seekPad);
      subNavPaddingVal.textContent = `${seekPad}ms`;
      fontSizeInput.value = String(s.fontSize);
      fontSizeVal.textContent = `${s.fontSize}px`;
      alignmentSelect.value = s.alignment;
      bottomOffsetInput.value = String(s.bottomOffset);
      bottomOffsetVal.textContent = `${s.bottomOffset}px`;
      const topOff = s.topOffset ?? 40;
      topOffsetInput.value = String(topOff);
      topOffsetVal.textContent = `${topOff}px`;
      bgBoxCheckbox.checked = s.showBackgroundBox;
      stackModeCheckbox.checked = s.stackMode ?? true;
      const maxLines = s.maxLines || 3;
      maxLinesInput.value = String(maxLines);
      maxLinesVal.textContent = String(maxLines);
      const fadeSecs = Math.round((s.autoFadeTimeoutMs || 6e3) / 1e3);
      fadeTimeoutInput.value = String(fadeSecs);
      fadeTimeoutVal.textContent = `${fadeSecs}s`;
      serverUrlInput.value = s.serverUrl;
    }
    function saveSetting(patch) {
      chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: patch }, () => {
        showSavedToast();
      });
    }
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
      if (settings) {
        populateSettingsUI(settings);
      }
    });
    chrome.runtime.sendMessage({ type: "GET_HISTORY_SETTINGS" }, (histSettings) => {
      if (histSettings) {
        retentionSelect.value = histSettings.retentionDuration || DEFAULT_HISTORY_SETTINGS.retentionDuration;
        maxEntriesSelect.value = String(histSettings.maxEntries || DEFAULT_HISTORY_SETTINGS.maxEntries);
      }
    });
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
      if (status) {
        updateStatus(status.connected);
      }
    });
    exactByteTimingCheckbox.addEventListener("change", () => {
      saveSetting({ exactByteTiming: exactByteTimingCheckbox.checked });
    });
    splitMultiSentenceCheckbox.addEventListener("change", () => {
      saveSetting({ splitMultiSentenceCues: splitMultiSentenceCheckbox.checked });
    });
    enableSubCacheCheckbox.addEventListener("change", () => {
      saveSetting({ enableSubtitleCache: enableSubCacheCheckbox.checked });
    });
    cementSubtitlesCheckbox.addEventListener("change", () => {
      saveSetting({ cementSubtitlesInTimeline: cementSubtitlesCheckbox.checked });
    });
    showRerecordBtnCheckbox.addEventListener("change", () => {
      saveSetting({ showRerecordButton: showRerecordBtnCheckbox.checked });
    });
    showPrevBtnCheckbox.addEventListener("change", () => {
      saveSetting({ showPrevButton: showPrevBtnCheckbox.checked });
    });
    showNextBtnCheckbox.addEventListener("change", () => {
      saveSetting({ showNextButton: showNextBtnCheckbox.checked });
    });
    autoHealOverlapsCheckbox.addEventListener("change", () => {
      saveSetting({ autoHealTimelineOverlaps: autoHealOverlapsCheckbox.checked });
    });
    srtStartPaddingInput.addEventListener("input", () => {
      srtStartPaddingVal.textContent = `${srtStartPaddingInput.value}ms`;
      saveSetting({ srtStartPaddingMs: Number(srtStartPaddingInput.value) });
    });
    srtEndPaddingInput.addEventListener("input", () => {
      srtEndPaddingVal.textContent = `${srtEndPaddingInput.value}ms`;
      saveSetting({ srtEndPaddingMs: Number(srtEndPaddingInput.value) });
    });
    clearCacheBtn.addEventListener("click", () => {
      clearCacheBtn.disabled = true;
      clearCacheBtn.textContent = "Clearing...";
      chrome.runtime.sendMessage({ type: "CLEAR_TIMELINE_CACHE" }, () => {
        clearCacheBtn.textContent = "\u2713 Timeline Cache Cleared!";
        showSavedToast("\u2713 Cache Cleared");
        setTimeout(() => {
          clearCacheBtn.textContent = "\u{1F5D1}\uFE0F Clear Video Timeline Cache";
          clearCacheBtn.disabled = false;
        }, 1400);
      });
    });
    ignoreWhenPausedCheckbox.addEventListener("change", () => {
      saveSetting({ ignoreSubtitlesWhenPaused: ignoreWhenPausedCheckbox.checked });
    });
    pauseWithVideoCheckbox.addEventListener("change", () => {
      saveSetting({ pauseSubtitlesWithVideo: pauseWithVideoCheckbox.checked });
    });
    autoEmbedCheckbox.addEventListener("change", () => {
      saveSetting({ autoEmbed: autoEmbedCheckbox.checked });
    });
    subNavEnabledCheckbox.addEventListener("change", () => {
      saveSetting({ subNavigationEnabled: subNavEnabledCheckbox.checked });
    });
    subForwardNavEnabledCheckbox.addEventListener("change", () => {
      saveSetting({ subForwardNavigationEnabled: subForwardNavEnabledCheckbox.checked });
    });
    subNavPlayCheckbox.addEventListener("change", () => {
      saveSetting({ subNavigationPlayOnSeek: subNavPlayCheckbox.checked });
    });
    subNavPaddingInput.addEventListener("input", () => {
      subNavPaddingVal.textContent = `${subNavPaddingInput.value}ms`;
      saveSetting({ subNavigationPaddingMs: Number(subNavPaddingInput.value) });
    });
    fontSizeInput.addEventListener("input", () => {
      fontSizeVal.textContent = `${fontSizeInput.value}px`;
      saveSetting({ fontSize: Number(fontSizeInput.value) });
    });
    alignmentSelect.addEventListener("change", () => {
      saveSetting({ alignment: alignmentSelect.value });
    });
    bottomOffsetInput.addEventListener("input", () => {
      bottomOffsetVal.textContent = `${bottomOffsetInput.value}px`;
      saveSetting({ bottomOffset: Number(bottomOffsetInput.value) });
    });
    topOffsetInput.addEventListener("input", () => {
      topOffsetVal.textContent = `${topOffsetInput.value}px`;
      saveSetting({ topOffset: Number(topOffsetInput.value) });
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
    connectBtn.addEventListener("click", () => {
      const url = serverUrlInput.value.trim();
      statusText.textContent = "Connecting...";
      saveSetting({ serverUrl: url });
      chrome.runtime.sendMessage({ type: "RECONNECT" }, () => {
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "GET_STATUS" }, (st) => {
            if (st) updateStatus(st.connected);
          });
        }, 600);
      });
    });
    retryBtn.addEventListener("click", () => {
      const url = serverUrlInput.value.trim();
      statusText.textContent = "Retrying...";
      saveSetting({ serverUrl: url });
      chrome.runtime.sendMessage({ type: "RECONNECT" }, () => {
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "GET_STATUS" }, (st) => {
            if (st) updateStatus(st.connected);
          });
        }, 600);
      });
    });
    retentionSelect.addEventListener("change", () => {
      const duration = retentionSelect.value;
      chrome.runtime.sendMessage(
        { type: "UPDATE_HISTORY_SETTINGS", settings: { retentionDuration: duration } },
        () => showSavedToast()
      );
    });
    maxEntriesSelect.addEventListener("change", () => {
      const maxEntries = Number(maxEntriesSelect.value);
      chrome.runtime.sendMessage(
        { type: "UPDATE_HISTORY_SETTINGS", settings: { maxEntries } },
        () => showSavedToast()
      );
    });
    resetDefaultsBtn.addEventListener("click", () => {
      if (!window.confirm("Reset all Whisper Live Subtitles settings to their default values?")) {
        return;
      }
      populateSettingsUI(DEFAULT_SETTINGS);
      retentionSelect.value = DEFAULT_HISTORY_SETTINGS.retentionDuration;
      maxEntriesSelect.value = String(DEFAULT_HISTORY_SETTINGS.maxEntries);
      chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: DEFAULT_SETTINGS }, () => {
        chrome.runtime.sendMessage(
          { type: "UPDATE_HISTORY_SETTINGS", settings: DEFAULT_HISTORY_SETTINGS },
          () => showSavedToast("\u2713 Defaults Restored")
        );
      });
    });
    openHistoryBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SERVER_STATUS") {
        updateStatus(msg.connected);
      }
    });
  });
})();
