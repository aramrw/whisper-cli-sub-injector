import { DetectedVideoInfo, ExtensionSettings } from '../common/types';
import { isEligibleVideo } from './shadow-roots';
import { VideoBinding } from './types';

let highlightedVideo: HTMLMediaElement | null = null;
let originalOutline = '';
let originalBoxShadow = '';

export function highlightVideo(video: HTMLMediaElement): void {
  clearHighlight();
  highlightedVideo = video;
  originalOutline = video.style.outline;
  originalBoxShadow = video.style.boxShadow;
  video.style.setProperty('outline', '3px solid #38bdf8', 'important');
  video.style.setProperty('box-shadow', '0 0 16px rgba(56, 189, 248, 0.75)', 'important');
}

export function clearHighlight(): void {
  if (highlightedVideo) {
    highlightedVideo.style.outline = originalOutline;
    highlightedVideo.style.boxShadow = originalBoxShadow;
    highlightedVideo = null;
  }
}

export function getVideoTitle(video: HTMLMediaElement): string {
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

export function getTargetVideo(
  bindings: Map<HTMLMediaElement, VideoBinding>,
  settings: ExtensionSettings,
  selectedVideoId: string | null,
  activeVideo: HTMLMediaElement | null
): { target: HTMLMediaElement | null; newActive: HTMLMediaElement | null } {
  // 1. Manual selection:
  if (!settings.autoEmbed && selectedVideoId) {
    for (const binding of bindings.values()) {
      if (binding.id === selectedVideoId && binding.video.isConnected && isEligibleVideo(binding.video)) {
        return { target: binding.video, newActive: activeVideo };
      }
    }
  }

  // 2. Active video playing:
  if (activeVideo && activeVideo.isConnected && !activeVideo.paused && isEligibleVideo(activeVideo)) {
    return { target: activeVideo, newActive: activeVideo };
  }

  // 3. Find any video currently playing:
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
    return { target: bestCandidate.video, newActive: bestCandidate.video };
  }

  // 4. Retain active video if recently playing and still eligible:
  if (activeVideo && activeVideo.isConnected && isEligibleVideo(activeVideo)) {
    return { target: activeVideo, newActive: activeVideo };
  }

  // 5. Largest visible video:
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
    return { target: largestVideo, newActive: largestVideo };
  }

  return { target: null, newActive: activeVideo };
}

export function getDetectedVideosList(
  bindings: Map<HTMLMediaElement, VideoBinding>,
  target: HTMLMediaElement | null
): DetectedVideoInfo[] {
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
