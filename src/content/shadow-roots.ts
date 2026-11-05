/**
 * Helper to discover shadow roots and locate <video> tags inside them,
 * inspired by asbplayer's shadow-root scanning logic.
 */

export function findAllVideos(root: Document | ShadowRoot | null = typeof document !== 'undefined' ? document : null): HTMLMediaElement[] {
  const videos: HTMLMediaElement[] = [];
  if (!root || typeof root.querySelectorAll !== 'function') {
    return videos;
  }

  try {
    // Query direct video elements in the current root
    const elements = root.querySelectorAll('video');
    for (let i = 0; i < elements.length; i++) {
      videos.push(elements[i]);
    }

    // Traverse all elements to find open shadow roots
    const allElements = root.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el && el.shadowRoot) {
        const nestedVideos = findAllVideos(el.shadowRoot);
        videos.push(...nestedVideos);
      }
    }
  } catch {
    // Ignore early DOM / detached shadow-root traversal errors
  }

  return videos;
}

/**
 * Filter out invisible, dead, or audio-only non-rendered videos
 */
export function isEligibleVideo(video: HTMLMediaElement | null | undefined): boolean {
  if (!video || !video.isConnected) return false;

  try {
    const rect = video.getBoundingClientRect();
    // Filter out tracking pixels or hidden media (< 40px)
    if (rect.width < 40 || rect.height < 40) return false;
    return true;
  } catch {
    return false;
  }
}
