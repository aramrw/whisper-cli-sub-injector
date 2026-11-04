import {
  DEFAULT_SETTINGS,
  DetectedVideoInfo,
  ExtensionSettings,
  MessageToContent,
  SubtitleCue,
} from '../common/types';
import { VideoOverlay } from './overlay';
import { findAllVideos, isEligibleVideo } from './shadow-roots';

interface VideoBinding {
  id: string;
  video: HTMLMediaElement;
  overlay: VideoOverlay;
  lastPlayed: number;
}

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
const bindings: Map<HTMLMediaElement, VideoBinding> = new Map();
let activeVideo: HTMLMediaElement | null = null;
let selectedVideoId: string | null = null;
let keepAlivePort: chrome.runtime.Port | null = null;

let highlightedVideo: HTMLMediaElement | null = null;
let originalOutline = '';
let originalBoxShadow = '';

// Load settings from storage
function initSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    settings = { ...DEFAULT_SETTINGS, ...(items as ExtensionSettings) };
    for (const binding of bindings.values()) {
      binding.overlay.applySettings(settings);
    }
  });
}

// Establish or revive persistent keep-alive port to background service worker
function ensureKeepAlive() {
  if (keepAlivePort) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'whisper-keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      setTimeout(ensureKeepAlive, 1500);
    });
  } catch {
    keepAlivePort = null;
  }
}

// Helper to highlight a video element on the webpage (like asbplayer)
function highlightVideo(video: HTMLMediaElement) {
  clearHighlight();
  highlightedVideo = video;
  originalOutline = video.style.outline;
  originalBoxShadow = video.style.boxShadow;
  video.style.setProperty('outline', '3px solid #38bdf8', 'important');
  video.style.setProperty('box-shadow', '0 0 16px rgba(56, 189, 248, 0.75)', 'important');
}

function clearHighlight() {
  if (highlightedVideo) {
    highlightedVideo.style.outline = originalOutline;
    highlightedVideo.style.boxShadow = originalBoxShadow;
    highlightedVideo = null;
  }
}

// Format video title for UI
function getVideoTitle(video: HTMLMediaElement): string {
  if (video.title && video.title.trim()) return video.title.trim();
  const ariaLabel = video.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  if (video.currentSrc) {
    try {
      const url = new URL(video.currentSrc);
      const filename = url.pathname.split('/').filter(Boolean).pop();
      if (filename && !filename.includes('.m3u8')) {
        return decodeURIComponent(filename).slice(0, 36);
      }
    } catch {}
  }

  const pageTitle = document.title ? document.title.replace(/\s*-\s*YouTube$/, '').trim() : '';
  if (pageTitle) return pageTitle.slice(0, 36);

  return 'HTML5 Video Player';
}

// Determine which video should display subtitles
function getTargetVideo(): HTMLMediaElement | null {
  // If manual selection is active and a video is selected:
  if (!settings.autoEmbed && selectedVideoId) {
    for (const binding of bindings.values()) {
      if (binding.id === selectedVideoId && binding.video.isConnected && isEligibleVideo(binding.video)) {
        return binding.video;
      }
    }
  }

  // Automatic selection logic (autoEmbed is enabled, or fallback):
  // 1. If active video is still connected and playing
  if (activeVideo && activeVideo.isConnected && !activeVideo.paused && isEligibleVideo(activeVideo)) {
    return activeVideo;
  }

  // 2. Find any video currently playing
  let bestCandidate: VideoBinding | null = null;
  let maxPlayedTime = 0;

  for (const binding of bindings.values()) {
    if (!binding.video.isConnected || !isEligibleVideo(binding.video)) continue;

    if (!binding.video.paused) {
      if (binding.lastPlayed >= maxPlayedTime) {
        maxPlayedTime = binding.lastPlayed;
        bestCandidate = binding;
      }
    }
  }

  if (bestCandidate) {
    activeVideo = bestCandidate.video;
    return activeVideo;
  }

  // 3. If activeVideo was recently playing and is still connected/eligible (even if paused), retain it!
  if (activeVideo && activeVideo.isConnected && isEligibleVideo(activeVideo)) {
    return activeVideo;
  }

  // 4. Fallback to the largest visible eligible video
  let largestVideo: HTMLMediaElement | null = null;
  let maxArea = 0;

  for (const binding of bindings.values()) {
    if (!binding.video.isConnected || !isEligibleVideo(binding.video)) continue;
    const rect = binding.video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > maxArea) {
      maxArea = area;
      largestVideo = binding.video;
    }
  }

  if (largestVideo) {
    activeVideo = largestVideo;
    return activeVideo;
  }

  return null;
}

// Build detected videos info list for popup
function getDetectedVideosList(): DetectedVideoInfo[] {
  scanVideos();
  const target = getTargetVideo();
  const list: DetectedVideoInfo[] = [];

  for (const binding of bindings.values()) {
    if (!binding.video.isConnected || !isEligibleVideo(binding.video)) continue;
    const v = binding.video;
    const rect = v.getBoundingClientRect();

    list.push({
      id: binding.id,
      src: v.src || '',
      currentSrc: v.currentSrc || '',
      currentTime: v.currentTime || 0,
      duration: v.duration && !isNaN(v.duration) ? v.duration : 0,
      paused: v.paused,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isSelected: target === v,
      title: getVideoTitle(v),
    });
  }
  return list;
}

// Discovery loop
function scanVideos() {
  const discovered = findAllVideos(document);

  // Bind new videos
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

  // Clean up unbound / detached videos
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

// Handle tab activation & visibility changes
function onTabActivated(cueFromBg?: SubtitleCue | null) {
  ensureKeepAlive();
  scanVideos();
  const target = getTargetVideo();
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

  // Query background for latest connection status and last cue
  chrome.runtime.sendMessage({ type: 'TAB_FOCUSED' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    if (res.lastCue && target) {
      const binding = bindings.get(target);
      if (binding) {
        binding.overlay.restoreIfIdle(res.lastCue);
      }
    }
  });
}

// Handle messages from background worker or popup
chrome.runtime.onMessage.addListener((message: MessageToContent, _sender, sendResponse) => {
  if (message.type === 'NEW_SUBTITLE') {
    const target = getTargetVideo();
    if (target) {
      const binding = bindings.get(target);
      if (binding) {
        binding.overlay.showCue(message.cue);
      }
    }
  } else if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    for (const binding of bindings.values()) {
      binding.overlay.applySettings(settings);
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
    sendResponse({
      videos: getDetectedVideosList(),
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
    sendResponse({ success: true, activeVideoId: selectedVideoId });
    return true;
  } else if (message.type === 'SET_AUTO_EMBED') {
    settings.autoEmbed = message.autoEmbed;
    if (message.autoEmbed) {
      selectedVideoId = null;
      activeVideo = getTargetVideo();
    }
    sendResponse({ success: true });
    return true;
  } else if (message.type === 'HIGHLIGHT_VIDEO') {
    for (const binding of bindings.values()) {
      if (binding.id === message.videoId) {
        highlightVideo(binding.video);
        break;
      }
    }
    sendResponse({ success: true });
    return true;
  } else if (message.type === 'UNHIGHLIGHT_VIDEO') {
    clearHighlight();
    sendResponse({ success: true });
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
});

// Helper to ignore keystrokes when typing in inputs/textareas
function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
  );
}

// Global key listener for smart subtitle replay (asbplayer style Left Arrow)
function setupKeyNavigation() {
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isEditableElement(e.target)) return;
      if (!settings.enabled || !settings.subNavigationEnabled) return;

      const target = getTargetVideo();
      if (!target) return;

      const binding = bindings.get(target);
      if (!binding) return;

      const handled = binding.overlay.seekToPreviousSubtitle();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    },
    true // Capture phase: intercepts before Crunchyroll / video player default seek
  );
}

// Setup continuous discovery
function start() {
  initSettings();
  ensureKeepAlive();
  scanVideos();
  setupKeyNavigation();

  // Periodic poll to catch SPAs & dynamic video changes
  setInterval(scanVideos, 1000);

  // MutationObserver for instant detection when new nodes appear
  const observer = new MutationObserver(() => {
    scanVideos();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Re-sync on visibility change (switching tabs back) and focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      onTabActivated();
    }
  });

  window.addEventListener('focus', () => {
    onTabActivated();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
