import { DetectedVideoInfo, ExtensionSettings, SubtitleCue } from '../common/types';

document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle = document.getElementById('enabled-toggle') as HTMLInputElement;
  const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
  const statusText = document.getElementById('status-text') as HTMLSpanElement;
  const openHistoryBtn = document.getElementById('open-history-btn') as HTMLButtonElement;
  const openOptionsBtn = document.getElementById('open-options-btn') as HTMLButtonElement;

  // Detected Videos elements
  const autoEmbedToggle = document.getElementById('auto-embed-toggle') as HTMLInputElement;
  const refreshVideosBtn = document.getElementById('refresh-videos-btn') as HTMLButtonElement;
  const videoListContainer = document.getElementById('video-list-container') as HTMLDivElement;

  const pauseWithVideoCheckbox = document.getElementById('pause-with-video') as HTMLInputElement;
  const ignoreWhenPausedCheckbox = document.getElementById('ignore-when-paused') as HTMLInputElement;
  const fontSizeInput = document.getElementById('font-size') as HTMLInputElement;
  const fontSizeVal = document.getElementById('font-size-val') as HTMLSpanElement;

  const bottomOffsetInput = document.getElementById('bottom-offset') as HTMLInputElement;
  const bottomOffsetVal = document.getElementById('bottom-offset-val') as HTMLSpanElement;

  const alignmentSelect = document.getElementById('alignment') as HTMLSelectElement;
  const bgBoxCheckbox = document.getElementById('bg-box') as HTMLInputElement;
  const stackModeCheckbox = document.getElementById('stack-mode') as HTMLInputElement;
  const maxLinesInput = document.getElementById('max-lines') as HTMLInputElement;
  const maxLinesVal = document.getElementById('max-lines-val') as HTMLSpanElement;

  const fadeTimeoutInput = document.getElementById('fade-timeout') as HTMLInputElement;
  const fadeTimeoutVal = document.getElementById('fade-timeout-val') as HTMLSpanElement;

  const subNavEnabledCheckbox = document.getElementById('sub-nav-enabled') as HTMLInputElement;
  const subNavPlayCheckbox = document.getElementById('sub-nav-play') as HTMLInputElement;
  const subNavPaddingInput = document.getElementById('sub-nav-padding') as HTMLInputElement;
  const subNavPaddingVal = document.getElementById('sub-nav-padding-val') as HTMLSpanElement;

  const testSubBtn = document.getElementById('test-sub-btn') as HTMLButtonElement;

  function updateStatusUI(connected: boolean, enabled: boolean) {
    if (!enabled) {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Subtitles Disabled';
    } else if (connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Live • Connected to whisper-cli';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Disconnected from server';
    }
  }

  function fetchCurrentStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
      if (chrome.runtime.lastError || !status) return;
      updateStatusUI(status.connected, status.enabled);
    });
  }

  function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDuration(sec: number): string {
    if (isNaN(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function renderVideoList(
    videos: DetectedVideoInfo[],
    autoEmbed: boolean,
    _selectedVideoId: string | null
  ) {
    if (!videoListContainer) return;
    videoListContainer.innerHTML = '';

    if (!videos || videos.length === 0) {
      videoListContainer.innerHTML = `
        <div class="video-empty-state">
          <span class="empty-icon">🎬</span>
          <span class="empty-text">No video elements found on this tab.</span>
        </div>
      `;
      return;
    }

    for (const vid of videos) {
      const card = document.createElement('div');
      const isTargeted = vid.isSelected;
      card.className = `video-card ${isTargeted ? 'active-target' : ''}`;
      card.dataset.videoId = vid.id;

      const statusIcon = vid.paused ? '⏸' : '▶';
      const statusTitle = vid.paused ? 'Paused' : 'Playing';
      const durStr =
        vid.duration > 0
          ? `${formatDuration(vid.currentTime)} / ${formatDuration(vid.duration)}`
          : formatDuration(vid.currentTime);
      const resStr = vid.width && vid.height ? `${vid.width}×${vid.height}` : 'Video';

      let badgeHtml = '';
      if (isTargeted) {
        if (autoEmbed) {
          badgeHtml = `<span class="video-badge badge-auto">Auto-Targeted</span>`;
        } else {
          badgeHtml = `<span class="video-badge badge-manual">Selected</span>`;
        }
      }

      card.innerHTML = `
        <div class="video-card-top">
          <span class="video-play-status ${vid.paused ? 'paused' : 'playing'}" title="${statusTitle}">
            ${statusIcon}
          </span>
          <span class="video-title" title="${escapeHtml(vid.title)}">
            ${escapeHtml(vid.title)}
          </span>
          ${badgeHtml}
        </div>
        <div class="video-card-meta">
          <span class="meta-item">${resStr}</span>
          <span class="meta-sep">•</span>
          <span class="meta-item">${durStr}</span>
          ${!isTargeted ? '<span class="select-hint">Click to target</span>' : ''}
        </div>
      `;

      // Click: manually target this video and disable autoEmbed
      card.addEventListener('click', () => {
        autoEmbedToggle.checked = false;
        saveSetting({ autoEmbed: false });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { type: 'SELECT_VIDEO', videoId: vid.id },
              () => {
                fetchDetectedVideos();
              }
            );
          }
        });
      });

      // Hover: highlight the video on the actual webpage
      card.addEventListener('mouseenter', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'HIGHLIGHT_VIDEO',
              videoId: vid.id,
            }).catch(() => {});
          }
        });
      });

      card.addEventListener('mouseleave', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'UNHIGHLIGHT_VIDEO' }).catch(() => {});
          }
        });
      });

      videoListContainer.appendChild(card);
    }
  }

  function fetchDetectedVideos() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        if (videoListContainer) {
          videoListContainer.innerHTML = `
            <div class="video-empty-state">
              <span class="empty-icon">⚠️</span>
              <span class="empty-text">No active tab found.</span>
            </div>
          `;
        }
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_DETECTED_VIDEOS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          if (videoListContainer) {
            videoListContainer.innerHTML = `
              <div class="video-empty-state">
                <span class="empty-icon">🔍</span>
                <span class="empty-text">No HTML5 video elements detected.</span>
              </div>
            `;
          }
          return;
        }

        if (res.autoEmbed !== undefined) {
          autoEmbedToggle.checked = res.autoEmbed;
        }
        renderVideoList(res.videos, res.autoEmbed, res.selectedVideoId);
      });
    });
  }

  // Load initial settings and status
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings: ExtensionSettings) => {
    if (!settings) return;
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

    const fadeSecs = Math.round(settings.autoFadeTimeoutMs / 1000);
    fadeTimeoutInput.value = String(fadeSecs);
    fadeTimeoutVal.textContent = `${fadeSecs}s`;

    subNavEnabledCheckbox.checked = settings.subNavigationEnabled ?? true;
    subNavPlayCheckbox.checked = settings.subNavigationPlayOnSeek ?? true;
    const padMs = settings.subNavigationPaddingMs ?? 150;
    subNavPaddingInput.value = String(padMs);
    subNavPaddingVal.textContent = `${padMs}ms`;
  });

  fetchCurrentStatus();
  fetchDetectedVideos();

  // Settings update helper
  function saveSetting(patch: Partial<ExtensionSettings>) {
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }, (res) => {
      if (res?.settings) {
        updateStatusUI(res.settings.connected, res.settings.enabled);
      }
    });
  }

  // Auto-embed toggle
  autoEmbedToggle.addEventListener('change', () => {
    const isAuto = autoEmbedToggle.checked;
    saveSetting({ autoEmbed: isAuto });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: 'SET_AUTO_EMBED', autoEmbed: isAuto },
          () => {
            fetchDetectedVideos();
          }
        );
      }
    });
  });

  // Refresh detected videos button
  refreshVideosBtn.addEventListener('click', () => {
    const icon = refreshVideosBtn.querySelector('.refresh-icon') as HTMLElement;
    if (icon) {
      icon.style.transform = 'rotate(180deg)';
      setTimeout(() => {
        icon.style.transform = '';
      }, 350);
    }
    fetchDetectedVideos();
  });

  enabledToggle.addEventListener('change', () => {
    saveSetting({ enabled: enabledToggle.checked });
  });

  pauseWithVideoCheckbox.addEventListener('change', () => {
    saveSetting({ pauseSubtitlesWithVideo: pauseWithVideoCheckbox.checked });
  });

  ignoreWhenPausedCheckbox.addEventListener('change', () => {
    saveSetting({ ignoreSubtitlesWhenPaused: ignoreWhenPausedCheckbox.checked });
  });

  fontSizeInput.addEventListener('input', () => {
    fontSizeVal.textContent = `${fontSizeInput.value}px`;
    saveSetting({ fontSize: Number(fontSizeInput.value) });
  });

  bottomOffsetInput.addEventListener('input', () => {
    bottomOffsetVal.textContent = `${bottomOffsetInput.value}px`;
    saveSetting({ bottomOffset: Number(bottomOffsetInput.value) });
  });

  alignmentSelect.addEventListener('change', () => {
    saveSetting({ alignment: alignmentSelect.value as 'bottom' | 'top' });
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

  subNavEnabledCheckbox.addEventListener('change', () => {
    saveSetting({ subNavigationEnabled: subNavEnabledCheckbox.checked });
  });

  subNavPlayCheckbox.addEventListener('change', () => {
    saveSetting({ subNavigationPlayOnSeek: subNavPlayCheckbox.checked });
  });

  subNavPaddingInput.addEventListener('input', () => {
    subNavPaddingVal.textContent = `${subNavPaddingInput.value}ms`;
    saveSetting({ subNavigationPaddingMs: Number(subNavPaddingInput.value) });
  });

  // Open History page in a new tab
  openHistoryBtn.addEventListener('click', () => {
    const historyUrl = chrome.runtime.getURL('history.html');
    chrome.tabs.create({ url: historyUrl });
  });

  // Open dedicated Options page in a new tab
  openOptionsBtn.addEventListener('click', () => {
    const optionsUrl = chrome.runtime.getURL('options.html');
    chrome.tabs.create({ url: optionsUrl });
  });

  // Listen for real-time server status pushes from background worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SERVER_STATUS') {
      updateStatusUI(msg.connected, enabledToggle.checked);
    }
  });

  // Send test subtitle
  testSubBtn.addEventListener('click', () => {
    const samplePhrases = [
      '¡Hola! Los subtítulos de whisper-cli funcionan perfectamente.',
      'Audio en tiempo real detectado con ScreenCaptureKit.',
      'Siguiente línea sincronizada con el reproductor de video.',
      'Live speech transcription running seamlessly!',
      'When you pause the video, the subtitle pauses too!',
    ];
    const text = samplePhrases[Math.floor(Math.random() * samplePhrases.length)];
    const cue: SubtitleCue = {
      id: Math.random().toString(36).substring(2, 9),
      text,
      timestamp: new Date().toLocaleTimeString(),
      receivedAt: Date.now(),
      durationMs: Number(fadeTimeoutInput.value) * 1000,
    };

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'NEW_SUBTITLE', cue });
      }
    });
  });

  // Periodic polling for detected videos while popup is open
  const pollInterval = setInterval(fetchDetectedVideos, 2500);

  window.addEventListener('unload', () => {
    clearInterval(pollInterval);
    // Clear video outline highlight on tab if popup closes
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'UNHIGHLIGHT_VIDEO' }).catch(() => {});
      }
    });
  });
});
