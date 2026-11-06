"use strict";
(() => {
  // src/history/export.ts
  function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function formatSrtTime(ms) {
    const clamped = Math.max(0, Math.round(ms));
    const hours = Math.floor(clamped / (1e3 * 60 * 60));
    const minutes = Math.floor(clamped % (1e3 * 60 * 60) / (1e3 * 60));
    const seconds = Math.floor(clamped % (1e3 * 60) / 1e3);
    const millis = clamped % 1e3;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
  }
  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function exportAsTxt(entries) {
    if (entries.length === 0) return;
    const lines = entries.map((e) => `[${formatTime(e.receivedAt)}] ${e.text}`);
    const textContent = lines.join("\n");
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    downloadFile(textContent, `whisper-subtitles-${dateStr}.txt`, "text/plain;charset=utf-8");
  }
  function exportAsSrt(entries) {
    if (entries.length === 0) return;
    const baseTime = entries[0].receivedAt;
    const hasVideoTimings = entries.some(
      (e) => e.videoStartTime !== void 0 && e.videoEndTime !== void 0
    );
    const srtItems = entries.map((entry) => {
      if (entry.videoStartTime !== void 0 && entry.videoEndTime !== void 0) {
        const startMs2 = Math.max(0, Math.round(entry.videoStartTime * 1e3));
        const endMs2 = Math.max(startMs2 + 200, Math.round(entry.videoEndTime * 1e3));
        return { startMs: startMs2, endMs: endMs2, text: entry.text.trim(), isVideoTimed: true };
      }
      const durMs = entry.durationMs && entry.durationMs > 0 ? entry.durationMs : 2500;
      const startMs = Math.max(0, entry.receivedAt - baseTime);
      const endMs = startMs + durMs;
      return { startMs, endMs, text: entry.text.trim(), isVideoTimed: false };
    });
    const ordered = hasVideoTimings ? srtItems.filter((item) => item.text.length > 0).sort((a, b) => a.startMs - b.startMs) : srtItems.filter((item) => item.text.length > 0);
    for (let i = 0; i + 1 < ordered.length; i++) {
      if (ordered[i].endMs > ordered[i + 1].startMs) {
        ordered[i].endMs = Math.max(ordered[i].startMs + 150, ordered[i + 1].startMs - 20);
      }
    }
    let srt = "";
    ordered.forEach((item, i) => {
      srt += `${i + 1}
${formatSrtTime(item.startMs)} --> ${formatSrtTime(item.endMs)}
${item.text}

`;
    });
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    downloadFile(srt, `whisper-subtitles-${dateStr}.srt`, "text/plain;charset=utf-8");
  }
  function exportAsJson(entries) {
    if (entries.length === 0) return;
    const jsonStr = JSON.stringify(entries, null, 2);
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    downloadFile(jsonStr, `whisper-subtitles-${dateStr}.json`, "application/json;charset=utf-8");
  }

  // src/history/render.ts
  function formatVideoTimeSpan(startSec, endSec) {
    if (startSec === void 0 || endSec === void 0) return "";
    const fmt = (sec) => {
      const m = Math.floor(sec / 60);
      const s = (sec % 60).toFixed(1).padStart(4, "0");
      return `${m}:${s}`;
    };
    return `[${fmt(startSec)} - ${fmt(endSec)}]`;
  }
  function highlightMatches(text, query) {
    if (!query) return escapeHtml(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    const parts = text.split(regex);
    return parts.map((part) => regex.test(part) ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join("");
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  function createEntryElement(entry, displayIndex, query) {
    const row = document.createElement("div");
    row.className = "subtitle-row";
    row.dataset.id = entry.id;
    const meta = document.createElement("div");
    meta.className = "cue-meta";
    const indexSpan = document.createElement("span");
    indexSpan.className = "cue-index";
    indexSpan.textContent = `#${displayIndex}`;
    const timeSpan = document.createElement("span");
    timeSpan.className = "cue-time";
    timeSpan.textContent = formatTime(entry.receivedAt);
    if (entry.timestamp) {
      timeSpan.title = `Source timestamp: ${entry.timestamp}`;
    }
    meta.appendChild(indexSpan);
    meta.appendChild(timeSpan);
    const videoSpan = document.createElement("span");
    videoSpan.className = "cue-video-time";
    const videoLabel = formatVideoTimeSpan(entry.videoStartTime, entry.videoEndTime);
    if (videoLabel) {
      videoSpan.textContent = videoLabel;
      if (entry.videoTitle) {
        videoSpan.title = `Video: ${entry.videoTitle}`;
      }
    }
    meta.appendChild(videoSpan);
    const textWrapper = document.createElement("div");
    textWrapper.className = "cue-text-wrapper";
    textWrapper.innerHTML = highlightMatches(entry.text, query);
    const actions = document.createElement("div");
    actions.className = "cue-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-icon";
    copyBtn.title = "Copy subtitle text";
    copyBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.text);
        copyBtn.classList.add("copied");
        setTimeout(() => copyBtn.classList.remove("copied"), 1200);
      } catch {
      }
    });
    actions.appendChild(copyBtn);
    row.appendChild(meta);
    row.appendChild(textWrapper);
    row.appendChild(actions);
    return row;
  }

  // src/history/history.ts
  document.addEventListener("DOMContentLoaded", () => {
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const countBadge = document.getElementById("count-badge");
    const retentionSelect = document.getElementById("retention-duration");
    const maxEntriesSelect = document.getElementById("max-entries");
    const searchInput = document.getElementById("search-input");
    const clearSearchBtn = document.getElementById("clear-search-btn");
    const autoScrollToggle = document.getElementById("auto-scroll-toggle");
    const exportBtn = document.getElementById("export-btn");
    const exportMenu = document.getElementById("export-menu");
    const exportTxt = document.getElementById("export-txt");
    const exportSrt = document.getElementById("export-srt");
    const exportJson = document.getElementById("export-json");
    const clearHistoryBtn = document.getElementById("clear-history-btn");
    const openOptionsBtn = document.getElementById("open-options-btn");
    const subtitleList = document.getElementById("subtitle-list");
    const emptyState = document.getElementById("empty-state");
    const footerStats = document.getElementById("footer-stats");
    const mainContent = document.querySelector(".history-content");
    let allEntries = [];
    let currentFilter = "";
    let autoScroll = true;
    function updateStatus(connected) {
      if (connected) {
        statusDot.className = "status-dot online";
        statusText.textContent = "Live Broadcast Connected";
      } else {
        statusDot.className = "status-dot offline";
        statusText.textContent = "Disconnected";
      }
    }
    function renderList() {
      const q = currentFilter.trim().toLowerCase();
      const filtered = q ? allEntries.filter((e) => e.text.toLowerCase().includes(q)) : allEntries;
      countBadge.textContent = `${filtered.length} entries`;
      footerStats.textContent = `Showing ${filtered.length} of ${allEntries.length} saved subtitles`;
      if (filtered.length === 0) {
        subtitleList.innerHTML = "";
        emptyState.style.display = "flex";
        return;
      }
      emptyState.style.display = "none";
      subtitleList.innerHTML = "";
      const fragment = document.createDocumentFragment();
      filtered.forEach((entry, idx) => {
        const el = createEntryElement(entry, idx + 1, currentFilter);
        fragment.appendChild(el);
      });
      subtitleList.appendChild(fragment);
      if (autoScroll && !currentFilter) {
        scrollToBottom();
      }
    }
    function appendSingleEntry(entry) {
      allEntries.push(entry);
      const q = currentFilter.trim().toLowerCase();
      const matches = !q || entry.text.toLowerCase().includes(q);
      countBadge.textContent = `${allEntries.length} entries`;
      footerStats.textContent = `Showing ${allEntries.length} subtitles`;
      if (matches) {
        emptyState.style.display = "none";
        const displayIndex = subtitleList.children.length + 1;
        const el = createEntryElement(entry, displayIndex, currentFilter);
        subtitleList.appendChild(el);
        if (autoScroll) {
          scrollToBottom();
        }
      }
    }
    function updateLastEntry(entry, fullRefresh) {
      if (!entry) return;
      if (fullRefresh) {
        chrome.runtime.sendMessage({ type: "GET_HISTORY" }, (res) => {
          if (res && Array.isArray(res.history)) {
            allEntries = res.history;
            renderList();
          }
        });
        return;
      }
      const existingIdx = allEntries.findIndex((e) => e.id === entry.id);
      const targetIdx = existingIdx !== -1 ? existingIdx : allEntries.length - 1;
      allEntries[targetIdx] = entry;
      const q = currentFilter.trim().toLowerCase();
      const rows = subtitleList.querySelectorAll(".subtitle-row");
      const targetRow = rows[targetIdx];
      if (targetRow) {
        const textWrapper = targetRow.querySelector(".cue-text-wrapper");
        if (textWrapper) {
          textWrapper.innerHTML = highlightMatches(entry.text, q);
        }
        const videoSpan = targetRow.querySelector(".cue-video-time");
        if (videoSpan) {
          const videoLabel = formatVideoTimeSpan(entry.videoStartTime, entry.videoEndTime);
          videoSpan.textContent = videoLabel;
          if (entry.videoTitle) {
            videoSpan.title = `Video: ${entry.videoTitle}`;
          }
        }
      }
    }
    function scrollToBottom() {
      if (!mainContent) return;
      requestAnimationFrame(() => {
        mainContent.scrollTop = mainContent.scrollHeight;
      });
    }
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      if (res) updateStatus(res.connected);
    });
    chrome.runtime.sendMessage({ type: "GET_HISTORY" }, (res) => {
      if (res && Array.isArray(res.history)) {
        allEntries = res.history;
        if (res.settings) {
          retentionSelect.value = res.settings.retentionDuration || "1d";
          maxEntriesSelect.value = String(res.settings.maxEntries || 2e3);
        }
        renderList();
      }
    });
    retentionSelect.addEventListener("change", () => {
      const duration = retentionSelect.value;
      chrome.runtime.sendMessage({
        type: "UPDATE_HISTORY_SETTINGS",
        settings: { retentionDuration: duration }
      });
    });
    maxEntriesSelect.addEventListener("change", () => {
      const maxEntries = Number(maxEntriesSelect.value);
      chrome.runtime.sendMessage({
        type: "UPDATE_HISTORY_SETTINGS",
        settings: { maxEntries }
      });
    });
    searchInput.addEventListener("input", () => {
      currentFilter = searchInput.value;
      clearSearchBtn.style.display = currentFilter ? "block" : "none";
      renderList();
    });
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      currentFilter = "";
      clearSearchBtn.style.display = "none";
      renderList();
      searchInput.focus();
    });
    autoScrollToggle.addEventListener("change", () => {
      autoScroll = autoScrollToggle.checked;
      if (autoScroll) scrollToBottom();
    });
    clearHistoryBtn.addEventListener("click", () => {
      const confirmClear = window.confirm(
        "Are you sure you want to clear your entire subtitle history? This cannot be undone."
      );
      if (confirmClear) {
        chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" }, () => {
          allEntries = [];
          renderList();
        });
      }
    });
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle("show");
    });
    document.addEventListener("click", () => {
      exportMenu.classList.remove("show");
    });
    exportTxt.addEventListener("click", () => {
      exportAsTxt(allEntries);
    });
    exportSrt.addEventListener("click", () => {
      exportAsSrt(allEntries);
    });
    exportJson.addEventListener("click", () => {
      exportAsJson(allEntries);
    });
    if (openOptionsBtn) {
      openOptionsBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
      });
    }
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "NEW_HISTORY_ENTRY") {
        appendSingleEntry(msg.entry);
      } else if (msg.type === "UPDATE_HISTORY_ENTRY") {
        updateLastEntry(msg.entry, msg.fullRefresh);
      } else if (msg.type === "SERVER_STATUS") {
        updateStatus(msg.connected);
      } else if (msg.type === "HISTORY_CLEARED") {
        allEntries = [];
        renderList();
      }
    });
  });
})();
