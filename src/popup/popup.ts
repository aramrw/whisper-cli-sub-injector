import { ExtensionSettings, SubtitleCue } from '../common/types';

document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle = document.getElementById('enabled-toggle') as HTMLInputElement;
  const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
  const statusText = document.getElementById('status-text') as HTMLSpanElement;
  const openHistoryBtn = document.getElementById('open-history-btn') as HTMLButtonElement;

  const pauseWithVideoCheckbox = document.getElementById('pause-with-video') as HTMLInputElement;
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

  const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
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

  // Load initial settings and status
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings: ExtensionSettings) => {
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

    const fadeSecs = Math.round(settings.autoFadeTimeoutMs / 1000);
    fadeTimeoutInput.value = String(fadeSecs);
    fadeTimeoutVal.textContent = `${fadeSecs}s`;

    serverUrlInput.value = settings.serverUrl;
  });

  fetchCurrentStatus();

  // Settings update helper
  function saveSetting(patch: Partial<ExtensionSettings>) {
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }, (res) => {
      if (res?.settings) {
        updateStatusUI(res.settings.connected, res.settings.enabled);
      }
    });
  }

  enabledToggle.addEventListener('change', () => {
    saveSetting({ enabled: enabledToggle.checked });
  });

  pauseWithVideoCheckbox.addEventListener('change', () => {
    saveSetting({ pauseSubtitlesWithVideo: pauseWithVideoCheckbox.checked });
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

  // Connect button: saves the new URL and reconnects
  connectBtn.addEventListener('click', () => {
    const url = serverUrlInput.value.trim();
    statusText.textContent = 'Connecting...';
    saveSetting({ serverUrl: url });
    chrome.runtime.sendMessage({ type: 'RECONNECT' }, () => {
      setTimeout(fetchCurrentStatus, 400);
      setTimeout(fetchCurrentStatus, 1200);
    });
  });

  // Retry button: forces an immediate reconnection attempt
  retryBtn.addEventListener('click', () => {
    retryBtn.textContent = '...';
    retryBtn.disabled = true;
    statusText.textContent = 'Retrying connection...';

    const url = serverUrlInput.value.trim();
    saveSetting({ serverUrl: url });

    chrome.runtime.sendMessage({ type: 'RECONNECT' }, () => {
      setTimeout(() => {
        retryBtn.textContent = 'Retry';
        retryBtn.disabled = false;
        fetchCurrentStatus();
      }, 500);
      setTimeout(fetchCurrentStatus, 1200);
    });
  });

  // Open History page in a new tab
  openHistoryBtn.addEventListener('click', () => {
    const historyUrl = chrome.runtime.getURL('history.html');
    chrome.tabs.create({ url: historyUrl });
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
});
