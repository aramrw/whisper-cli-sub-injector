import { DetectedVideoInfo } from '../common/types';

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatDuration(sec: number): string {
  if (isNaN(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function renderVideoList(
  container: HTMLDivElement,
  videos: DetectedVideoInfo[],
  autoEmbed: boolean,
  onSelect: (vidId: string) => void,
  onHighlight: (vidId: string) => void,
  onUnhighlight: () => void
): void {
  container.innerHTML = '';

  if (!videos || videos.length === 0) {
    container.innerHTML = `
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

    card.addEventListener('click', () => onSelect(vid.id));
    card.addEventListener('mouseenter', () => onHighlight(vid.id));
    card.addEventListener('mouseleave', () => onUnhighlight());

    container.appendChild(card);
  }
}
