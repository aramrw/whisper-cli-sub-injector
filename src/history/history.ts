import {
  HistoryRetentionDuration,
  HistorySettings,
  SubtitleHistoryEntry,
} from '../common/types';
import {
  exportAsJson,
  exportAsSrt,
  exportAsTxt,
} from './export';
import {
  createEntryElement,
  formatVideoTimeSpan,
  highlightMatches,
} from './render';

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
  const openOptionsBtn = document.getElementById('open-options-btn') as HTMLButtonElement | null;

  const subtitleList = document.getElementById('subtitle-list') as HTMLDivElement;
  const emptyState = document.getElementById('empty-state') as HTMLDivElement;
  const footerStats = document.getElementById('footer-stats') as HTMLSpanElement;
  const mainContent = document.querySelector('.history-content') as HTMLElement;

  let allEntries: SubtitleHistoryEntry[] = [];
  let currentFilter = '';
  let autoScroll = true;

  function updateStatus(connected: boolean) {
    if (connected) {
      statusDot.className = 'status-dot online';
      statusText.textContent = 'Live Broadcast Connected';
    } else {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Disconnected';
    }
  }

  function renderList() {
    const q = currentFilter.trim().toLowerCase();
    const filtered = q
      ? allEntries.filter((e) => e.text.toLowerCase().includes(q))
      : allEntries;

    countBadge.textContent = `${filtered.length} entries`;
    footerStats.textContent = `Showing ${filtered.length} of ${allEntries.length} saved subtitles`;

    if (filtered.length === 0) {
      subtitleList.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';
    subtitleList.innerHTML = '';

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

  function appendSingleEntry(entry: SubtitleHistoryEntry) {
    allEntries.push(entry);

    const q = currentFilter.trim().toLowerCase();
    const matches = !q || entry.text.toLowerCase().includes(q);

    countBadge.textContent = `${allEntries.length} entries`;
    footerStats.textContent = `Showing ${allEntries.length} subtitles`;

    if (matches) {
      emptyState.style.display = 'none';
      const displayIndex = subtitleList.children.length + 1;
      const el = createEntryElement(entry, displayIndex, currentFilter);
      subtitleList.appendChild(el);

      if (autoScroll) {
        scrollToBottom();
      }
    }
  }

  function updateLastEntry(entry?: SubtitleHistoryEntry, fullRefresh?: boolean) {
    if (!entry) return;

    if (fullRefresh) {
      chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (res) => {
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
    const rows = subtitleList.querySelectorAll('.subtitle-row');
    const targetRow = rows[targetIdx] as HTMLElement | undefined;

    if (targetRow) {
      const textWrapper = targetRow.querySelector('.cue-text-wrapper');
      if (textWrapper) {
        textWrapper.innerHTML = highlightMatches(entry.text, q);
      }
      const videoSpan = targetRow.querySelector('.cue-video-time') as HTMLElement | null;
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

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (res) updateStatus(res.connected);
  });

  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (res) => {
    if (res && Array.isArray(res.history)) {
      allEntries = res.history;
      if (res.settings) {
        retentionSelect.value = res.settings.retentionDuration || '1d';
        maxEntriesSelect.value = String(res.settings.maxEntries || 2000);
      }
      renderList();
    }
  });

  retentionSelect.addEventListener('change', () => {
    const duration = retentionSelect.value as HistoryRetentionDuration;
    chrome.runtime.sendMessage({
      type: 'UPDATE_HISTORY_SETTINGS',
      settings: { retentionDuration: duration },
    });
  });

  maxEntriesSelect.addEventListener('change', () => {
    const maxEntries = Number(maxEntriesSelect.value);
    chrome.runtime.sendMessage({
      type: 'UPDATE_HISTORY_SETTINGS',
      settings: { maxEntries },
    });
  });

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

  autoScrollToggle.addEventListener('change', () => {
    autoScroll = autoScrollToggle.checked;
    if (autoScroll) scrollToBottom();
  });

  clearHistoryBtn.addEventListener('click', () => {
    const confirmClear = window.confirm(
      'Are you sure you want to clear your entire subtitle history? This cannot be undone.'
    );
    if (confirmClear) {
      chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }, () => {
        allEntries = [];
        renderList();
      });
    }
  });

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    exportMenu.classList.remove('show');
  });

  exportTxt.addEventListener('click', () => {
    exportAsTxt(allEntries);
  });

  exportSrt.addEventListener('click', () => {
    exportAsSrt(allEntries);
  });

  exportJson.addEventListener('click', () => {
    exportAsJson(allEntries);
  });

  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NEW_HISTORY_ENTRY') {
      appendSingleEntry(msg.entry);
    } else if (msg.type === 'UPDATE_HISTORY_ENTRY') {
      updateLastEntry(msg.entry, msg.fullRefresh);
    } else if (msg.type === 'SERVER_STATUS') {
      updateStatus(msg.connected);
    } else if (msg.type === 'HISTORY_CLEARED') {
      allEntries = [];
      renderList();
    }
  });
});
