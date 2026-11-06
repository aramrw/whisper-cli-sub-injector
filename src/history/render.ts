import { SubtitleHistoryEntry } from '../common/types';
import { formatTime } from './export';

export function formatVideoTimeSpan(startSec?: number, endSec?: number): string {
  if (startSec === undefined || endSec === undefined) return '';
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  };
  return `[${fmt(startSec)} - ${fmt(endSec)}]`;
}

export function highlightMatches(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);
  return parts
    .map((part) => (regex.test(part) ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function createEntryElement(
  entry: SubtitleHistoryEntry,
  displayIndex: number,
  query: string
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'subtitle-row';
  row.dataset.id = entry.id;

  const meta = document.createElement('div');
  meta.className = 'cue-meta';

  const indexSpan = document.createElement('span');
  indexSpan.className = 'cue-index';
  indexSpan.textContent = `#${displayIndex}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'cue-time';
  timeSpan.textContent = formatTime(entry.receivedAt);
  if (entry.timestamp) {
    timeSpan.title = `Source timestamp: ${entry.timestamp}`;
  }

  meta.appendChild(indexSpan);
  meta.appendChild(timeSpan);

  const videoSpan = document.createElement('span');
  videoSpan.className = 'cue-video-time';
  const videoLabel = formatVideoTimeSpan(entry.videoStartTime, entry.videoEndTime);
  if (videoLabel) {
    videoSpan.textContent = videoLabel;
    if (entry.videoTitle) {
      videoSpan.title = `Video: ${entry.videoTitle}`;
    }
  }
  meta.appendChild(videoSpan);

  const textWrapper = document.createElement('div');
  textWrapper.className = 'cue-text-wrapper';
  textWrapper.innerHTML = highlightMatches(entry.text, query);

  const actions = document.createElement('div');
  actions.className = 'cue-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-icon';
  copyBtn.title = 'Copy subtitle text';
  copyBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(entry.text);
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1200);
    } catch {}
  });

  actions.appendChild(copyBtn);

  row.appendChild(meta);
  row.appendChild(textWrapper);
  row.appendChild(actions);

  return row;
}
