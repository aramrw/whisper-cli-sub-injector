import {
  DEFAULT_HISTORY_SETTINGS,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  HistoryRetentionDuration,
  HistorySettings,
} from '../common/types';

document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
  const statusText = document.getElementById('status-text') as HTMLSpanElement;
  const saveToast = document.getElementById('save-toast') as HTMLDivElement;
  const openHistoryBtn = document.getElementById('open-history-btn') as HTMLButtonElement;

  // 1. Clip Timing & Subtitle Builder
  const exactByteTimingCheckbox = document.getElementById('exact-byte-timing') as HTMLInputElement;
  const splitMultiSentenceCheckbox = document.getElementById('split-multi-sentence') as HTMLInputElement;
  const enableSubCacheCheckbox = document.getElementById('enable-sub-cache') as HTMLInputElement;
  const cementSubtitlesCheckbox = document.getElementById('cement-subtitles') as HTMLInputElement;
  const showRerecordBtnCheckbox = document.getElementById('show-rerecord-btn') as HTMLInputElement;
  const showPrevBtnCheckbox = document.getElementById('show-prev-btn') as HTMLInputElement;
  const showNextBtnCheckbox = document.getElementById('show-next-btn') as HTMLInputElement;
  const autoHealOverlapsCheckbox = document.getElementById('auto-heal-overlaps') as HTMLInputElement;
  const srtStartPaddingInput = document.getElementById('srt-start-padding') as HTMLInputElement;
  const srtStartPaddingVal = document.getElementById('srt-start-padding-val') as HTMLSpanElement;
  const srtEndPaddingInput = document.getElementById('srt-end-padding') as HTMLInputElement;
  const srtEndPaddingVal = document.getElementById('srt-end-padding-val') as HTMLSpanElement;
  const clearCacheBtn = document.getElementById('clear-cache-btn') as HTMLButtonElement;

  // 2. Video Playback & External Audio Filtering
  const ignoreWhenPausedCheckbox = document.getElementById('ignore-when-paused') as HTMLInputElement;
  const pauseWithVideoCheckbox = document.getElementById('pause-with-video') as HTMLInputElement;
  const autoEmbedCheckbox = document.getElementById('auto-embed') as HTMLInputElement;

  // 3. Smart Replay
  const subNavEnabledCheckbox = document.getElementById('sub-nav-enabled') as HTMLInputElement;
  const subForwardNavEnabledCheckbox = document.getElementById('sub-forward-nav-enabled') as HTMLInputElement;
  const subNavPlayCheckbox = document.getElementById('sub-nav-play') as HTMLInputElement;
  const subNavPaddingInput = document.getElementById('sub-nav-padding') as HTMLInputElement;
  const subNavPaddingVal = document.getElementById('sub-nav-padding-val') as HTMLSpanElement;

  // 4. Overlay Appearance
  const fontSizeInput = document.getElementById('font-size') as HTMLInputElement;
  const fontSizeVal = document.getElementById('font-size-val') as HTMLSpanElement;
  const alignmentSelect = document.getElementById('alignment') as HTMLSelectElement;
  const bottomOffsetInput = document.getElementById('bottom-offset') as HTMLInputElement;
  const bottomOffsetVal = document.getElementById('bottom-offset-val') as HTMLSpanElement;
  const topOffsetInput = document.getElementById('top-offset') as HTMLInputElement;
  const topOffsetVal = document.getElementById('top-offset-val') as HTMLSpanElement;
  const bgBoxCheckbox = document.getElementById('bg-box') as HTMLInputElement;
  const stackModeCheckbox = document.getElementById('stack-mode') as HTMLInputElement;
  const maxLinesInput = document.getElementById('max-lines') as HTMLInputElement;
  const maxLinesVal = document.getElementById('max-lines-val') as HTMLSpanElement;
  const fadeTimeoutInput = document.getElementById('fade-timeout') as HTMLInputElement;
  const fadeTimeoutVal = document.getElementById('fade-timeout-val') as HTMLSpanElement;

  // 5. Server & History Storage
  const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
  const retentionSelect = document.getElementById('retention-duration') as HTMLSelectElement;
  const maxEntriesSelect = document.getElementById('max-entries') as HTMLSelectElement;
  const resetDefaultsBtn = document.getElementById('reset-defaults-btn') as HTMLButtonElement;

  let toastTimeout: any = null;

  function showSavedToast(label = '✓ Saved') {
    saveToast.textContent = label;
    saveToast.classList.add('visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      saveToast.classList.remove('visible');
    }, 1400);
  }

  function updateStatus(connected: boolean) {
    if (connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Live • Connected to whisper-cli';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Disconnected';
    }
  }

  function saveSetting(patch: Partial<ExtensionSettings>) {
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }, () => {
      showSavedToast();
    });
  }

  function populateSettingsUI(s: ExtensionSettings) {
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

    const fadeSecs = Math.round((s.autoFadeTimeoutMs || 6000) / 1000);
    fadeTimeoutInput.value = String(fadeSecs);
    fadeTimeoutVal.textContent = `${fadeSecs}s`;

    serverUrlInput.value = s.serverUrl;
  }

  function bindTimingSection() {
    exactByteTimingCheckbox.addEventListener('change', () => {
      saveSetting({ exactByteTiming: exactByteTimingCheckbox.checked });
    });
    splitMultiSentenceCheckbox.addEventListener('change', () => {
      saveSetting({ splitMultiSentenceCues: splitMultiSentenceCheckbox.checked });
    });
    enableSubCacheCheckbox.addEventListener('change', () => {
      saveSetting({ enableSubtitleCache: enableSubCacheCheckbox.checked });
    });
    cementSubtitlesCheckbox.addEventListener('change', () => {
      saveSetting({ cementSubtitlesInTimeline: cementSubtitlesCheckbox.checked });
    });
    showRerecordBtnCheckbox.addEventListener('change', () => {
      saveSetting({ showRerecordButton: showRerecordBtnCheckbox.checked });
    });
    showPrevBtnCheckbox.addEventListener('change', () => {
      saveSetting({ showPrevButton: showPrevBtnCheckbox.checked });
    });
    showNextBtnCheckbox.addEventListener('change', () => {
      saveSetting({ showNextButton: showNextBtnCheckbox.checked });
    });
    autoHealOverlapsCheckbox.addEventListener('change', () => {
      saveSetting({ autoHealTimelineOverlaps: autoHealOverlapsCheckbox.checked });
    });
    srtStartPaddingInput.addEventListener('input', () => {
      srtStartPaddingVal.textContent = `${srtStartPaddingInput.value}ms`;
      saveSetting({ srtStartPaddingMs: Number(srtStartPaddingInput.value) });
    });
    srtEndPaddingInput.addEventListener('input', () => {
      srtEndPaddingVal.textContent = `${srtEndPaddingInput.value}ms`;
      saveSetting({ srtEndPaddingMs: Number(srtEndPaddingInput.value) });
    });
    clearCacheBtn.addEventListener('click', () => {
      clearCacheBtn.disabled = true;
      clearCacheBtn.textContent = 'Clearing...';
      chrome.runtime.sendMessage({ type: 'CLEAR_TIMELINE_CACHE' }, () => {
        clearCacheBtn.textContent = '✓ Timeline Cache Cleared!';
        showSavedToast('✓ Cache Cleared');
        setTimeout(() => {
          clearCacheBtn.textContent = '🗑️ Clear Video Timeline Cache';
          clearCacheBtn.disabled = false;
        }, 1400);
      });
    });
  }

  function bindPlaybackSection() {
    ignoreWhenPausedCheckbox.addEventListener('change', () => {
      saveSetting({ ignoreSubtitlesWhenPaused: ignoreWhenPausedCheckbox.checked });
    });
    pauseWithVideoCheckbox.addEventListener('change', () => {
      saveSetting({ pauseSubtitlesWithVideo: pauseWithVideoCheckbox.checked });
    });
    autoEmbedCheckbox.addEventListener('change', () => {
      saveSetting({ autoEmbed: autoEmbedCheckbox.checked });
    });
  }

  function bindSmartReplaySection() {
    subNavEnabledCheckbox.addEventListener('change', () => {
      saveSetting({ subNavigationEnabled: subNavEnabledCheckbox.checked });
    });
    subForwardNavEnabledCheckbox.addEventListener('change', () => {
      saveSetting({ subForwardNavigationEnabled: subForwardNavEnabledCheckbox.checked });
    });
    subNavPlayCheckbox.addEventListener('change', () => {
      saveSetting({ subNavigationPlayOnSeek: subNavPlayCheckbox.checked });
    });
    subNavPaddingInput.addEventListener('input', () => {
      subNavPaddingVal.textContent = `${subNavPaddingInput.value}ms`;
      saveSetting({ subNavigationPaddingMs: Number(subNavPaddingInput.value) });
    });
  }

  function bindAppearanceSection() {
    fontSizeInput.addEventListener('input', () => {
      fontSizeVal.textContent = `${fontSizeInput.value}px`;
      saveSetting({ fontSize: Number(fontSizeInput.value) });
    });
    alignmentSelect.addEventListener('change', () => {
      saveSetting({ alignment: alignmentSelect.value as 'bottom' | 'top' });
    });
    bottomOffsetInput.addEventListener('input', () => {
      bottomOffsetVal.textContent = `${bottomOffsetInput.value}px`;
      saveSetting({ bottomOffset: Number(bottomOffsetInput.value) });
    });
    topOffsetInput.addEventListener('input', () => {
      topOffsetVal.textContent = `${topOffsetInput.value}px`;
      saveSetting({ topOffset: Number(topOffsetInput.value) });
    });
    bgBoxCheckbox.addEventListener('change', () => {
      saveSetting({ showBackgroundBox: bgBoxCheckbox.checked });
    });
    stackModeCheckbox.addEventListener('change', () => {
      saveSetting({ stackMode: stackModeCheckbox.checked });
    });
    maxLinesInput.addEventListener('input', () => {
      maxLinesVal.textContent = maxLinesInput.value;
      saveSetting({ maxLines: Number(maxLinesInput.value) });
    });
    fadeTimeoutInput.addEventListener('input', () => {
      fadeTimeoutVal.textContent = `${fadeTimeoutInput.value}s`;
      saveSetting({ autoFadeTimeoutMs: Number(fadeTimeoutInput.value) * 1000 });
    });
  }

  function triggerReconnect() {
    const url = serverUrlInput.value.trim();
    statusText.textContent = 'Connecting...';
    saveSetting({ serverUrl: url });
    chrome.runtime.sendMessage({ type: 'RECONNECT' }, () => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (st) => {
          if (st) updateStatus(st.connected);
        });
      }, 600);
    });
  }

  function bindServerHistorySection() {
    connectBtn.addEventListener('click', triggerReconnect);
    retryBtn.addEventListener('click', triggerReconnect);

    retentionSelect.addEventListener('change', () => {
      const duration = retentionSelect.value as HistoryRetentionDuration;
      chrome.runtime.sendMessage(
        { type: 'UPDATE_HISTORY_SETTINGS', settings: { retentionDuration: duration } },
        () => showSavedToast()
      );
    });

    maxEntriesSelect.addEventListener('change', () => {
      const maxEntries = Number(maxEntriesSelect.value);
      chrome.runtime.sendMessage(
        { type: 'UPDATE_HISTORY_SETTINGS', settings: { maxEntries } },
        () => showSavedToast()
      );
    });

    resetDefaultsBtn.addEventListener('click', () => {
      if (!window.confirm('Reset all Whisper Live Subtitles settings to their default values?')) {
        return;
      }
      populateSettingsUI(DEFAULT_SETTINGS);
      retentionSelect.value = DEFAULT_HISTORY_SETTINGS.retentionDuration;
      maxEntriesSelect.value = String(DEFAULT_HISTORY_SETTINGS.maxEntries);

      chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: DEFAULT_SETTINGS }, () => {
        chrome.runtime.sendMessage(
          { type: 'UPDATE_HISTORY_SETTINGS', settings: DEFAULT_HISTORY_SETTINGS },
          () => showSavedToast('✓ Defaults Restored')
        );
      });
    });

    openHistoryBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SERVER_STATUS') {
        updateStatus(msg.connected);
      }
    });
  }

  // Load initial settings
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings: ExtensionSettings) => {
    if (settings) {
      populateSettingsUI(settings);
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_HISTORY_SETTINGS' }, (histSettings: HistorySettings) => {
    if (histSettings) {
      retentionSelect.value = histSettings.retentionDuration || DEFAULT_HISTORY_SETTINGS.retentionDuration;
      maxEntriesSelect.value = String(histSettings.maxEntries || DEFAULT_HISTORY_SETTINGS.maxEntries);
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (status) {
      updateStatus(status.connected);
    }
  });

  bindTimingSection();
  bindPlaybackSection();
  bindSmartReplaySection();
  bindAppearanceSection();
  bindServerHistorySection();
});
