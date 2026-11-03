import { DEFAULT_SETTINGS, ExtensionSettings, MessageToContent, SubtitleCue } from '../common/types';
import { VideoOverlay } from './overlay';
import { findAllVideos, isEligibleVideo } from './shadow-roots';

interface VideoBinding {
  video: HTMLMediaElement;
  overlay: VideoOverlay;
  lastPlayed: number;
}

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
const bindings: Map<HTMLMediaElement, VideoBinding> = new Map();
let activeVideo: HTMLMediaElement | null = null;

// Load settings from storage
function initSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    settings = { ...DEFAULT_SETTINGS, ...(items as ExtensionSettings) };
    for (const binding of bindings.values()) {
      binding.overlay.applySettings(settings);
    }
  });
}

// Determine which video should display subtitles
function getTargetVideo(): HTMLMediaElement | null {
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

// Discovery loop
function scanVideos() {
  const discovered = findAllVideos(document);

  // Bind new videos
  for (const video of discovered) {
    if (!bindings.has(video) && isEligibleVideo(video)) {
      const overlay = new VideoOverlay(video, settings);
      const binding: VideoBinding = {
        video,
        overlay,
        lastPlayed: video.paused ? 0 : Date.now(),
      };

      video.addEventListener('play', () => {
        binding.lastPlayed = Date.now();
        activeVideo = video;
      });

      video.addEventListener('playing', () => {
        binding.lastPlayed = Date.now();
        activeVideo = video;
      });

      bindings.set(video, binding);
      console.log('[whisper-cli-sub-injector] Bound video element candidate:', video);
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

// Handle messages from background service worker
chrome.runtime.onMessage.addListener((message: MessageToContent, _sender, _sendResponse) => {
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
  }
});

// Setup continuous discovery
function start() {
  initSettings();
  scanVideos();

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
