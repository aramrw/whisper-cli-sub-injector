"use strict";
(() => {
  // src/popup/video-list.ts
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function formatDuration(sec) {
    if (isNaN(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }
  function renderVideoList(container, videos, autoEmbed, onSelect, onHighlight, onUnhighlight) {
    container.innerHTML = "";
    if (!videos || videos.length === 0) {
      container.innerHTML = `
      <div class="video-empty-state">
        <span class="empty-icon">\u{1F3AC}</span>
        <span class="empty-text">No video elements found on this tab.</span>
      </div>
    `;
      return;
    }
    for (const vid of videos) {
      const card = document.createElement("div");
      const isTargeted = vid.isSelected;
      card.className = `video-card ${isTargeted ? "active-target" : ""}`;
      card.dataset.videoId = vid.id;
      const statusIcon = vid.paused ? "\u23F8" : "\u25B6";
      const statusTitle = vid.paused ? "Paused" : "Playing";
      const durStr = vid.duration > 0 ? `${formatDuration(vid.currentTime)} / ${formatDuration(vid.duration)}` : formatDuration(vid.currentTime);
      const resStr = vid.width && vid.height ? `${vid.width}\xD7${vid.height}` : "Video";
      let badgeHtml = "";
      if (isTargeted) {
        if (autoEmbed) {
          badgeHtml = `<span class="video-badge badge-auto">Auto-Targeted</span>`;
        } else {
          badgeHtml = `<span class="video-badge badge-manual">Selected</span>`;
        }
      }
      card.innerHTML = `
      <div class="video-card-top">
        <span class="video-play-status ${vid.paused ? "paused" : "playing"}" title="${statusTitle}">
          ${statusIcon}
        </span>
        <span class="video-title" title="${escapeHtml(vid.title)}">
          ${escapeHtml(vid.title)}
        </span>
        ${badgeHtml}
      </div>
      <div class="video-card-meta">
        <span class="meta-item">${resStr}</span>
        <span class="meta-sep">\u2022</span>
        <span class="meta-item">${durStr}</span>
        ${!isTargeted ? '<span class="select-hint">Click to target</span>' : ""}
      </div>
    `;
      card.addEventListener("click", () => onSelect(vid.id));
      card.addEventListener("mouseenter", () => onHighlight(vid.id));
      card.addEventListener("mouseleave", () => onUnhighlight());
      container.appendChild(card);
    }
  }

  // src/popup/popup.ts
  document.addEventListener("DOMContentLoaded", () => {
    const enabledToggle = document.getElementById("enabled-toggle");
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const openHistoryBtn = document.getElementById("open-history-btn");
    const openOptionsBtn = document.getElementById("open-options-btn");
    const autoEmbedToggle = document.getElementById("auto-embed-toggle");
    const refreshVideosBtn = document.getElementById("refresh-videos-btn");
    const videoListContainer = document.getElementById("video-list-container");
    const pauseWithVideoCheckbox = document.getElementById("pause-with-video");
    const ignoreWhenPausedCheckbox = document.getElementById("ignore-when-paused");
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
    const testSubBtn = document.getElementById("test-sub-btn");
    function updateStatusUI(connected, enabled) {
      if (!enabled) {
        statusDot.className = "status-dot disabled";
        statusText.textContent = "Subtitles Disabled";
      } else if (connected) {
        statusDot.className = "status-dot online";
        statusText.textContent = "Live SSE Connected";
      } else {
        statusDot.className = "status-dot offline";
        statusText.textContent = "Connecting...";
      }
    }
    function fetchCurrentStatus() {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
        if (chrome.runtime.lastError || !status) return;
        updateStatusUI(status.connected, status.enabled);
      });
    }
    function saveSetting(patch) {
      chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: patch }, (res) => {
        if (res?.settings) {
          updateStatusUI(res.settings.connected, res.settings.enabled);
        }
      });
    }
    function handleVideoSelect(vidId) {
      autoEmbedToggle.checked = false;
      saveSetting({ autoEmbed: false });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "SELECT_VIDEO", videoId: vidId }, () => {
            fetchDetectedVideos();
          });
        }
      });
    }
    function handleVideoHighlight(vidId) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "HIGHLIGHT_VIDEO", videoId: vidId }).catch(() => {
          });
        }
      });
    }
    function handleVideoUnhighlight() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "UNHIGHLIGHT_VIDEO" }).catch(() => {
          });
        }
      });
    }
    function fetchDetectedVideos() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) {
          if (videoListContainer) {
            videoListContainer.innerHTML = `
            <div class="video-empty-state">
              <span class="empty-icon">\u26A0\uFE0F</span>
              <span class="empty-text">No active tab found.</span>
            </div>
          `;
          }
          return;
        }
        chrome.tabs.sendMessage(activeTab.id, { type: "GET_DETECTED_VIDEOS" }, (res) => {
          if (chrome.runtime.lastError || !res) {
            if (videoListContainer) {
              videoListContainer.innerHTML = `
              <div class="video-empty-state">
                <span class="empty-icon">\u{1F3AC}</span>
                <span class="empty-text">No video elements found on this tab.</span>
              </div>
            `;
            }
            return;
          }
          if (res.autoEmbed !== void 0) {
            autoEmbedToggle.checked = res.autoEmbed;
          }
          renderVideoList(
            videoListContainer,
            res.videos,
            res.autoEmbed,
            handleVideoSelect,
            handleVideoHighlight,
            handleVideoUnhighlight
          );
        });
      });
    }
    function populatePopupSettings(settings) {
      enabledToggle.checked = settings.enabled;
      autoEmbedToggle.checked = settings.autoEmbed ?? true;
      pauseWithVideoCheckbox.checked = settings.pauseSubtitlesWithVideo ?? true;
      ignoreWhenPausedCheckbox.checked = settings.ignoreSubtitlesWhenPaused ?? true;
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
    }
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
      if (!settings) return;
      populatePopupSettings(settings);
    });
    fetchCurrentStatus();
    fetchDetectedVideos();
    autoEmbedToggle.addEventListener("change", () => {
      const isAuto = autoEmbedToggle.checked;
      saveSetting({ autoEmbed: isAuto });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "SET_AUTO_EMBED", autoEmbed: isAuto }, () => {
            fetchDetectedVideos();
          });
        }
      });
    });
    refreshVideosBtn.addEventListener("click", () => {
      const icon = refreshVideosBtn.querySelector(".refresh-icon");
      if (icon) {
        icon.style.transform = "rotate(180deg)";
        setTimeout(() => {
          icon.style.transform = "";
        }, 350);
      }
      fetchDetectedVideos();
    });
    enabledToggle.addEventListener("change", () => {
      saveSetting({ enabled: enabledToggle.checked });
    });
    pauseWithVideoCheckbox.addEventListener("change", () => {
      saveSetting({ pauseSubtitlesWithVideo: pauseWithVideoCheckbox.checked });
    });
    ignoreWhenPausedCheckbox.addEventListener("change", () => {
      saveSetting({ ignoreSubtitlesWhenPaused: ignoreWhenPausedCheckbox.checked });
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
    openHistoryBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    });
    openOptionsBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
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
    const pollInterval = setInterval(fetchDetectedVideos, 2500);
    window.addEventListener("unload", () => {
      clearInterval(pollInterval);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "UNHIGHLIGHT_VIDEO" }).catch(() => {
          });
        }
      });
    });
  });
})();
