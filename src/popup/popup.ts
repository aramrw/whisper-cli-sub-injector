import { DetectedVideoInfo, ExtensionSettings, SubtitleCue } from '../common/types';
import { renderVideoList } from './video-list';

document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle = document.getElementById('enabled-toggle') as HTMLInputElement;
  const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
  const statusText = document.getElementById('status-text') as HTMLSpanElement;
  const openHistoryBtn = document.getElementById('open-history-btn') as HTMLButtonElement;
  const openOptionsBtn = document.getElementById('open-options-btn') as HTMLButtonElement;

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
      statusDot.className = 'status-dot disabled';
      statusText.textContent = 'Subtitles Disabled';
    } else if (connected) {
      statusDot.className = 'status-dot online';
      statusText.textContent = 'Live SSE Connected';
    } else {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Connecting...';
    }
  }

  function fetchCurrentStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
      if (chrome.runtime.lastError || !status) return;
      updateStatusUI(status.connected, status.enabled);
    });
  }

  function saveSetting(patch: Partial<ExtensionSettings>) {
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }, (res) => {
      if (res?.settings) {
        updateStatusUI(res.settings.connected, res.settings.enabled);
      }
    });
  }

  function handleVideoSelect(vidId: string) {
    autoEmbedToggle.checked = false;
    saveSetting({ autoEmbed: false });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SELECT_VIDEO', videoId: vidId }, () => {
          fetchDetectedVideos();
        });
      }
    });
  }

  function handleVideoHighlight(vidId: string) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'HIGHLIGHT_VIDEO', videoId: vidId }).catch(() => {});
      }
    });
  }

  function handleVideoUnhighlight() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'UNHIGHLIGHT_VIDEO' }).catch(() => {});
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
                <span class="empty-icon">🎬</span>
                <span class="empty-text">No video elements found on this tab.</span>
              </div>
            `;
          }
          return;
        }

        if (res.autoEmbed !== undefined) {
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

  function populatePopupSettings(settings: ExtensionSettings) {
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
  }

  // Load initial settings and status
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings: ExtensionSettings) => {
    if (!settings) return;
    populatePopupSettings(settings);
  });

  fetchCurrentStatus();
  fetchDetectedVideos();

  // Auto-embed toggle
  autoEmbedToggle.addEventListener('change', () => {
    const isAuto = autoEmbedToggle.checked;
    saveSetting({ autoEmbed: isAuto });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_AUTO_EMBED', autoEmbed: isAuto }, () => {
          fetchDetectedVideos();
        });
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

  openHistoryBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  });

  openOptionsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SERVER_STATUS') {
      updateStatusUI(msg.connected, enabledToggle.checked);
    }
  });

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

  const pollInterval = setInterval(fetchDetectedVideos, 2500);

  window.addEventListener('unload', () => {
    clearInterval(pollInterval);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'UNHIGHLIGHT_VIDEO' }).catch(() => {});
      }
    });
  });
});
