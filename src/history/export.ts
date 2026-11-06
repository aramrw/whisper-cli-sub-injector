import { SubtitleHistoryEntry } from '../common/types';

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / (1000 * 60 * 60));
  const minutes = Math.floor((clamped % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((clamped % (1000 * 60)) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAsTxt(entries: SubtitleHistoryEntry[]): void {
  if (entries.length === 0) return;
  const lines = entries.map((e) => `[${formatTime(e.receivedAt)}] ${e.text}`);
  const textContent = lines.join('\n');
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadFile(textContent, `whisper-subtitles-${dateStr}.txt`, 'text/plain;charset=utf-8');
}

export function exportAsSrt(entries: SubtitleHistoryEntry[]): void {
  if (entries.length === 0) return;

  const baseTime = entries[0].receivedAt;
  const hasVideoTimings = entries.some(
    (e) => e.videoStartTime !== undefined && e.videoEndTime !== undefined
  );

  const srtItems = entries.map((entry) => {
    if (entry.videoStartTime !== undefined && entry.videoEndTime !== undefined) {
      const startMs = Math.max(0, Math.round(entry.videoStartTime * 1000));
      const endMs = Math.max(startMs + 200, Math.round(entry.videoEndTime * 1000));
      return { startMs, endMs, text: entry.text.trim(), isVideoTimed: true };
    }
    const durMs = entry.durationMs && entry.durationMs > 0 ? entry.durationMs : 2500;
    const startMs = Math.max(0, entry.receivedAt - baseTime);
    const endMs = startMs + durMs;
    return { startMs, endMs, text: entry.text.trim(), isVideoTimed: false };
  });

  const ordered = hasVideoTimings
    ? srtItems
        .filter((item) => item.text.length > 0)
        .sort((a, b) => a.startMs - b.startMs)
    : srtItems.filter((item) => item.text.length > 0);

  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i].endMs > ordered[i + 1].startMs) {
      ordered[i].endMs = Math.max(ordered[i].startMs + 150, ordered[i + 1].startMs - 20);
    }
  }

  let srt = '';
  ordered.forEach((item, i) => {
    srt += `${i + 1}\n${formatSrtTime(item.startMs)} --> ${formatSrtTime(item.endMs)}\n${item.text}\n\n`;
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  downloadFile(srt, `whisper-subtitles-${dateStr}.srt`, 'text/plain;charset=utf-8');
}

export function exportAsJson(entries: SubtitleHistoryEntry[]): void {
  if (entries.length === 0) return;
  const jsonStr = JSON.stringify(entries, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadFile(jsonStr, `whisper-subtitles-${dateStr}.json`, 'application/json;charset=utf-8');
}
