import {
  DEFAULT_HISTORY_SETTINGS,
  HistoryRetentionDuration,
  HistorySettings,
  SubtitleHistoryEntry,
} from '../common/types';

document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
  const statusText = document.getElementById('status-text') as HTMLSpanElement;
  const countBadge = document.getElementById('count-badge') as HTMLDivElement;

  const retentionSelect = document.getElementById('retention-duration') as HTMLSelectElement;
  const maxEntriesSelect = document.getElementById('max-entries') as HTMLSelectElement;

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const clearSearchBtn = document.getElementById('clear-search-btn') as HTMLButtonElement;
  const autoScrollToggle = document.getElementById('auto-scroll-toggle') as HTMLInputElement;

  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
  const exportMenu = document.getElementById('export-menu') as HTMLDivElement;
  const exportTxt = document.getElementById('export-txt') as HTMLButtonElement;
  const exportSrt = document.getElementById('export-srt') as HTMLButtonElement;
  const exportJson = document.getElementById('export-json') as HTMLButtonElement;

  const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement;

  const subtitleList = document.getElementById('subtitle-list') as HTMLDivElement;
  const emptyState = document.getElementById('empty-state') as HTMLDivElement;
  const footerStats = document.getElementById('footer-stats') as HTMLSpanElement;
  const mainContent = document.querySelector('.history-content') as HTMLElement;

  let allEntries: SubtitleHistoryEntry[] = [];
  let currentFilter = '';
  let autoScroll = true;

  function formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function formatSrtTime(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    const millis = ms % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  function updateStatus(connected: boolean) {
    if (connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Live • Connected';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Disconnected';
    }
  }

  function highlightMatches(text: string, query: string): string {
    if (!query.trim()) {
      return escapeHtml(text);
    }
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);
    return parts
      .map((part) => (regex.test(part) ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
      .join('');
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function createEntryElement(entry: SubtitleHistoryEntry, displayIndex: number, query: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'subtitle-row';
    row.dataset.id = entry.id;

    const meta = document.createElement('div');
    meta.className = 'cue-meta';

    const indexSpan = document.createElement('span');
    indexSpan.className = 'cue-index';
    indexSpan.textContent = `#${displayIndex}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'cue-time';
    timeSpan.textContent = formatTime(entry.receivedAt);
    timeSpan.title = new Date(entry.receivedAt).toLocaleString();

    meta.appendChild(indexSpan);
    meta.appendChild(timeSpan);

    const textWrapper = document.createElement('div');
    textWrapper.className = 'cue-text-wrapper';
    textWrapper.innerHTML = highlightMatches(entry.text, query);

    const actions = document.createElement('div');
    actions.className = 'cue-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-cue-btn';
    copyBtn.title = 'Copy subtitle text';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(entry.text).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('copied');
        }, 1500);
      });
    });

    actions.appendChild(copyBtn);

    row.appendChild(meta);
    row.appendChild(textWrapper);
    row.appendChild(actions);

    return row;
  }

  function renderList() {
    subtitleList.innerHTML = '';
    const q = currentFilter.trim().toLowerCase();

    const filtered = q
      ? allEntries.filter((entry) => entry.text.toLowerCase().includes(q))
      : allEntries;

    countBadge.textContent = `${allEntries.length} ${allEntries.length === 1 ? 'Subtitle' : 'Subtitles'}`;
    footerStats.textContent = `Showing ${filtered.length} of ${allEntries.length} subtitles`;

    if (allEntries.length === 0) {
      emptyState.style.display = 'flex';
      subtitleList.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    subtitleList.style.display = 'flex';

    const fragment = document.createDocumentFragment();
    filtered.forEach((entry, idx) => {
      const el = createEntryElement(entry, idx + 1, currentFilter);
      fragment.appendChild(el);
    });
    subtitleList.appendChild(fragment);

    if (autoScroll && !q) {
      scrollToBottom();
    }
  }

  function appendSingleEntry(entry: SubtitleHistoryEntry) {
    allEntries.push(entry);

    const q = currentFilter.trim().toLowerCase();
    countBadge.textContent = `${allEntries.length} ${allEntries.length === 1 ? 'Subtitle' : 'Subtitles'}`;

    if (emptyState.style.display !== 'none') {
      emptyState.style.display = 'none';
      subtitleList.style.display = 'flex';
    }

    if (!q || entry.text.toLowerCase().includes(q)) {
      const displayIndex = subtitleList.children.length + 1;
      const el = createEntryElement(entry, displayIndex, currentFilter);
      subtitleList.appendChild(el);

      footerStats.textContent = `Showing ${subtitleList.children.length} of ${allEntries.length} subtitles`;

      if (autoScroll && !q) {
        scrollToBottom();
      }
    } else {
      footerStats.textContent = `Showing ${subtitleList.children.length} of ${allEntries.length} subtitles`;
    }
  }

  function scrollToBottom() {
    if (mainContent) {
      mainContent.scrollTop = mainContent.scrollHeight;
    }
  }

  // Load Initial Data
  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (res) => {
    if (res?.history) {
      allEntries = res.history;
    }
    if (res?.settings) {
      retentionSelect.value = res.settings.retentionDuration || DEFAULT_HISTORY_SETTINGS.retentionDuration;
      maxEntriesSelect.value = String(res.settings.maxEntries || DEFAULT_HISTORY_SETTINGS.maxEntries);
    }
    renderList();
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (status) {
      updateStatus(status.connected);
    }
  });

  // Settings Handlers
  retentionSelect.addEventListener('change', () => {
    const duration = retentionSelect.value as HistoryRetentionDuration;
    chrome.runtime.sendMessage(
      { type: 'UPDATE_HISTORY_SETTINGS', settings: { retentionDuration: duration } },
      () => {
        // Refresh trimmed history
        chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (res) => {
          if (res?.history) {
            allEntries = res.history;
            renderList();
          }
        });
      }
    );
  });

  maxEntriesSelect.addEventListener('change', () => {
    const maxEntries = Number(maxEntriesSelect.value);
    chrome.runtime.sendMessage(
      { type: 'UPDATE_HISTORY_SETTINGS', settings: { maxEntries } },
      () => {
        chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (res) => {
          if (res?.history) {
            allEntries = res.history;
            renderList();
          }
        });
      }
    );
  });

  // Search Filter
  searchInput.addEventListener('input', () => {
    currentFilter = searchInput.value;
    clearSearchBtn.style.display = currentFilter ? 'block' : 'none';
    renderList();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentFilter = '';
    clearSearchBtn.style.display = 'none';
    renderList();
    searchInput.focus();
  });

  // Auto Scroll Toggle
  autoScrollToggle.addEventListener('change', () => {
    autoScroll = autoScrollToggle.checked;
    if (autoScroll) {
      scrollToBottom();
    }
  });

  // Clear History
  clearHistoryBtn.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    const confirmClear = window.confirm(
      `Are you sure you want to clear all ${allEntries.length} saved subtitles from history?`
    );
    if (!confirmClear) return;

    chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }, () => {
      allEntries = [];
      renderList();
    });
  });

  // Export Dropdown
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    exportMenu.classList.remove('show');
  });

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportTxt.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    const lines = allEntries.map((e) => `[${formatTime(e.receivedAt)}] ${e.text}`);
    const textContent = lines.join('\n');
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(textContent, `whisper-subtitles-${dateStr}.txt`, 'text/plain;charset=utf-8');
  });

  exportSrt.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    let srt = '';
    const baseTime = allEntries[0].receivedAt;

    allEntries.forEach((entry, i) => {
      const startMs = Math.max(0, entry.receivedAt - baseTime);
      const endMs = startMs + 4000;
      srt += `${i + 1}\n${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}\n${entry.text}\n\n`;
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(srt, `whisper-subtitles-${dateStr}.srt`, 'text/plain;charset=utf-8');
  });

  exportJson.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    const jsonStr = JSON.stringify(allEntries, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(jsonStr, `whisper-subtitles-${dateStr}.json`, 'application/json;charset=utf-8');
  });

  // Listen for real-time broadcasts
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NEW_HISTORY_ENTRY') {
      appendSingleEntry(msg.entry);
    } else if (msg.type === 'SERVER_STATUS') {
      updateStatus(msg.connected);
    } else if (msg.type === 'HISTORY_CLEARED') {
      allEntries = [];
      renderList();
    }
  });
});
