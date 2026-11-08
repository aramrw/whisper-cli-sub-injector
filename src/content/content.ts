import {
  DEFAULT_SETTINGS,
  ExtensionSettings,
  isUrlAllowed,
  MessageToContent,
  SubtitleCue,
} from '../common/types';
import { VideoOverlay } from './overlay';
import { findAllVideos, isEligibleVideo } from './shadow-roots';
import { VideoBinding } from './types';
import {
  clearHighlight,
  getDetectedVideosList,
  getTargetVideo,
  highlightVideo,
} from './video-finder';
import { registerKeyNavigation } from './key-navigation';

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
const bindings: Map<HTMLMediaElement, VideoBinding> = new Map();
let activeVideo: HTMLMediaElement | null = null;
let selectedVideoId: string | null = null;
let keepAlivePort: chrome.runtime.Port | null = null;
let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let domObserver: MutationObserver | null = null;
let contextInvalidated = false;
let cleanupKeyNav: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let takeoverHandler: (() => void) | null = null;

function isExtensionContextValid(): boolean {
  if (contextInvalidated) return false;
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    contextInvalidated = true;
    return false;
  }
}

function cleanupInvalidatedContext() {
  if (contextInvalidated) return;
  contextInvalidated = true;

  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
  if (cleanupKeyNav) {
    cleanupKeyNav();
    cleanupKeyNav = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (focusHandler) {
    window.removeEventListener('focus', focusHandler);
    focusHandler = null;
  }
  if (takeoverHandler) {
    window.removeEventListener('whisper-cli-sub-instance-takeover', takeoverHandler);
    takeoverHandler = null;
  }
  if (keepAlivePort) {
    try {
      keepAlivePort.disconnect();
    } catch {}
    keepAlivePort = null;
  }

  clearHighlight();

  for (const binding of bindings.values()) {
    binding.overlay.destroy();
  }
  bindings.clear();
  activeVideo = null;
  selectedVideoId = null;
}

function initSettings() {
  if (!isExtensionContextValid()) {
    cleanupInvalidatedContext();
    return;
  }
  try {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (!isExtensionContextValid()) {
        cleanupInvalidatedContext();
        return;
      }
      if (items) {
        const maybeWrapped = (items as any).settings;
        settings = {
          ...DEFAULT_SETTINGS,
          ...(maybeWrapped && typeof maybeWrapped === 'object' ? maybeWrapped : items),
        };
        if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
          for (const binding of bindings.values()) {
            binding.overlay.destroy();
          }
          bindings.clear();
          activeVideo = null;
          selectedVideoId = null;
        } else {
          for (const binding of bindings.values()) {
            binding.overlay.applySettings(settings);
          }
        }
      }
    });
  } catch {
    cleanupInvalidatedContext();
  }
}

function ensureKeepAlive() {
  if (!isExtensionContextValid() || keepAlivePort) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'content-keepalive' });
    keepAlivePort.onMessage.addListener((message: MessageToContent) => {
      handleIncomingMessage(message);
    });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      if (isExtensionContextValid()) {
        setTimeout(ensureKeepAlive, 1000);
      } else {
        cleanupInvalidatedContext();
      }
    });
  } catch {
    cleanupInvalidatedContext();
  }
}

function resolveCurrentTarget(): HTMLMediaElement | null {
  const result = getTargetVideo(bindings, settings, selectedVideoId, activeVideo);
  activeVideo = result.newActive;
  return result.target;
}

function resolveCurrentTargetBinding(): VideoBinding | null {
  const target = resolveCurrentTarget();
  return target ? bindings.get(target) || null : null;
}

function scanVideos() {
  if (!isExtensionContextValid()) {
    cleanupInvalidatedContext();
    return;
  }
  if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
    if (bindings.size > 0) {
      for (const binding of bindings.values()) {
        binding.overlay.destroy();
      }
      bindings.clear();
      activeVideo = null;
      selectedVideoId = null;
    }
    return;
  }
  if (!document || (!document.body && !document.documentElement)) {
    return;
  }
  const discovered = findAllVideos(document);

  for (const video of discovered) {
    if (!bindings.has(video) && isEligibleVideo(video)) {
      const vidId =
        video.dataset.whisperVideoId ||
        (video.dataset.whisperVideoId = 'vid_' + Math.random().toString(36).substring(2, 9));

      const overlay = new VideoOverlay(video, settings);
      const binding: VideoBinding = {
        id: vidId,
        video,
        overlay,
        lastPlayed: video.paused ? 0 : Date.now(),
      };

      video.addEventListener('play', () => {
        binding.lastPlayed = Date.now();
        if (settings.autoEmbed) {
          activeVideo = video;
        }
      });

      video.addEventListener('playing', () => {
        binding.lastPlayed = Date.now();
        if (settings.autoEmbed) {
          activeVideo = video;
        }
      });

      bindings.set(video, binding);
      ensureKeepAlive();
      console.log('[whisper-cli-sub-injector] Bound video element candidate:', vidId, video);
    }
  }

  for (const [video, binding] of bindings.entries()) {
    if (!video.isConnected || !isEligibleVideo(video)) {
      binding.overlay.destroy();
      bindings.delete(video);
      if (activeVideo === video) {
        activeVideo = null;
      }
    }
  }
}

function onTabActivated(cueFromBg?: SubtitleCue | null) {
  if (!isExtensionContextValid()) {
    cleanupInvalidatedContext();
    return;
  }
  ensureKeepAlive();
  scanVideos();
  const target = resolveCurrentTarget();
  if (target) {
    const binding = bindings.get(target);
    if (binding) {
      binding.overlay.updatePosition();
      if (target.paused && settings.pauseSubtitlesWithVideo) {
        binding.overlay.refreshPausedSubtitle();
      }
      if (cueFromBg) {
        binding.overlay.restoreIfIdle(cueFromBg);
      }
    }
  }

  try {
    const p = chrome.runtime.sendMessage({ type: 'TAB_FOCUSED' });
    if (p && typeof p.then === 'function') {
      p.then((res) => {
        if (!isExtensionContextValid() || !res) return;
        if (res.lastCue && target) {
          const binding = bindings.get(target);
          if (binding) {
            binding.overlay.restoreIfIdle(res.lastCue);
          }
        }
      }).catch(() => {});
    }
  } catch {
    cleanupInvalidatedContext();
  }
}

function handleIncomingMessage(
  message: MessageToContent,
  sendResponse?: (response?: any) => void
): boolean {
  if (!isExtensionContextValid()) {
    cleanupInvalidatedContext();
    return false;
  }
  if (message.type === 'NEW_SUBTITLE') {
    if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
      return false;
    }
    const target = resolveCurrentTarget();
    if (target) {
      const binding = bindings.get(target);
      if (binding) {
        binding.overlay.showCue(message.cue);
      }
    }
  } else if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
      for (const binding of bindings.values()) {
        binding.overlay.destroy();
      }
      bindings.clear();
      activeVideo = null;
      selectedVideoId = null;
    } else {
      for (const binding of bindings.values()) {
        binding.overlay.applySettings(settings);
      }
      scanVideos();
    }
  } else if (message.type === 'CLEAR_SUBTITLES') {
    for (const binding of bindings.values()) {
      binding.overlay.hide();
    }
  } else if (message.type === 'CLEAR_TIMELINE_CACHE') {
    for (const binding of bindings.values()) {
      binding.overlay.clearTimelineCache();
    }
  } else if (message.type === 'GET_DETECTED_VIDEOS') {
    scanVideos();
    const target = resolveCurrentTarget();
    sendResponse?.({
      videos: getDetectedVideosList(bindings, target),
      autoEmbed: settings.autoEmbed ?? true,
      selectedVideoId,
    });
    return true;
  } else if (message.type === 'SELECT_VIDEO') {
    selectedVideoId = message.videoId;
    settings.autoEmbed = false;
    for (const binding of bindings.values()) {
      if (binding.id === message.videoId) {
        activeVideo = binding.video;
        binding.overlay.updatePosition();
      } else {
        binding.overlay.hide();
      }
    }
    sendResponse?.({ success: true, activeVideoId: selectedVideoId });
    return true;
  } else if (message.type === 'SET_AUTO_EMBED') {
    settings.autoEmbed = message.autoEmbed;
    if (message.autoEmbed) {
      selectedVideoId = null;
      activeVideo = resolveCurrentTarget();
    }
    sendResponse?.({ success: true });
    return true;
  } else if (message.type === 'HIGHLIGHT_VIDEO') {
    for (const binding of bindings.values()) {
      if (binding.id === message.videoId) {
        highlightVideo(binding.video);
        break;
      }
    }
    sendResponse?.({ success: true });
    return true;
  } else if (message.type === 'UNHIGHLIGHT_VIDEO') {
    clearHighlight();
    sendResponse?.({ success: true });
    return true;
  } else if (message.type === 'TAB_ACTIVATED') {
    if (message.settings) {
      settings = message.settings;
      for (const binding of bindings.values()) {
        binding.overlay.applySettings(settings);
      }
    }
    onTabActivated(message.lastCue);
  }
  return false;
}

// Handle messages from background worker or popup
if (isExtensionContextValid()) {
  try {
    chrome.runtime.onMessage.addListener((message: MessageToContent, _sender, sendResponse) => {
      return handleIncomingMessage(message, sendResponse);
    });
  } catch {
    cleanupInvalidatedContext();
  }
}

function start() {
  if (!isExtensionContextValid()) {
    cleanupInvalidatedContext();
    return;
  }

  try {
    window.dispatchEvent(new CustomEvent('whisper-cli-sub-instance-takeover'));
  } catch {}

  takeoverHandler = () => {
    cleanupInvalidatedContext();
  };
  window.addEventListener('whisper-cli-sub-instance-takeover', takeoverHandler);

  initSettings();
  ensureKeepAlive();
  scanVideos();
  cleanupKeyNav = registerKeyNavigation(
    () => settings,
    resolveCurrentTargetBinding,
    isExtensionContextValid,
    cleanupInvalidatedContext
  );

  scanIntervalId = setInterval(scanVideos, 1000);

  const observeRoot = document.body || document.documentElement;
  if (observeRoot) {
    domObserver = new MutationObserver(() => {
      scanVideos();
    });
    domObserver.observe(observeRoot, {
      childList: true,
      subtree: true,
    });
  }

  visibilityHandler = () => {
    if (!document.hidden && isExtensionContextValid()) {
      onTabActivated();
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  focusHandler = () => {
    if (isExtensionContextValid()) {
      onTabActivated();
    }
  };
  window.addEventListener('focus', focusHandler);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
