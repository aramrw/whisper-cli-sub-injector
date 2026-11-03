/**
 * Helper to discover shadow roots and locate <video> tags inside them,
 * inspired by asbplayer's shadow-root scanning logic.
 */

export function findAllVideos(root: Document | ShadowRoot = document): HTMLMediaElement[] {
  const videos: HTMLMediaElement[] = [];

  // Query direct video elements in the current root
  const elements = root.querySelectorAll('video');
  for (let i = 0; i < elements.length; i++) {
    videos.push(elements[i]);
  }

  // Traverse all elements to find open shadow roots
  const allElements = root.querySelectorAll('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    if (el.shadowRoot) {
      const nestedVideos = findAllVideos(el.shadowRoot);
      videos.push(...nestedVideos);
    }
  }

  return videos;
}

/**
 * Filter out invisible, dead, or audio-only non-rendered videos
 */
export function isEligibleVideo(video: HTMLMediaElement): boolean {
  if (!video.isConnected) return false;

  const rect = video.getBoundingClientRect();
  // Filter out tracking pixels or hidden media (< 20px)
  if (rect.width < 40 || rect.height < 40) return false;

  return true;
}
