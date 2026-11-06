import { ExtensionSettings, SubtitleCue } from '../../common/types';
import { TimelineCue, UtteranceAnchor } from './types';

export function splitIntoSentenceParts(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Split on sentence-ending punctuation (. ! ? 。 ！ ？ …) followed by whitespace or CJK/opening punctuation
  const parts = trimmed
    .split(/(?<=[.!?。！？…]["”'’»)」』】]?)\s+|(?<=[。！？…])(?=[^\s。！？…])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return parts.length > 1 ? parts : [trimmed];
}

export function getSafeSeekTime(video: HTMLMediaElement, rawSeekTime: number): number {
  let safeTime = Math.max(0.08, rawSeekTime);
  try {
    const buffered = video.buffered;
    if (buffered && buffered.length > 0) {
      for (let i = 0; i < buffered.length; i++) {
        const bStart = buffered.start(i);
        const bEnd = buffered.end(i);
        if (safeTime >= bStart && safeTime <= bEnd) {
          return safeTime;
        }
        if (safeTime < bStart && bStart - safeTime < 0.45) {
          return bStart + 0.02;
        }
      }
    }
  } catch {}
  return safeTime;
}

export function estimateCueTiming(
  cue: SubtitleCue,
  video: HTMLMediaElement,
  settings: ExtensionSettings,
  pausedAt: number,
  utteranceAnchors: Map<string, UtteranceAnchor>
): { estimatedStart: number; estimatedEnd: number } {
  const cleanText = cue.text.trim();
  const nowVideo = video.currentTime;
  const playbackRate = video.playbackRate > 0 ? video.playbackRate : 1.0;
  const pausedDuringLagSec =
    video.paused && pausedAt > 0 ? Math.max(0, (Date.now() - pausedAt) / 1000) : 0;
  const startPadSec = Math.max(0, (settings.srtStartPaddingMs ?? 50) / 1000);
  const endPadSec = Math.max(0, (settings.srtEndPaddingMs ?? 100) / 1000);

  const hasExactCliTiming =
    (settings.exactByteTiming ?? true) &&
    (cue.durationMs !== undefined || cue.clipStartMs !== undefined);

  if (hasExactCliTiming) {
    const rawLagSec = cue.lagMs !== undefined && cue.lagMs >= 0 ? cue.lagMs / 1000 : 0.05;
    const effectiveLagSec = Math.max(0, rawLagSec - pausedDuringLagSec);
    const clipDurSec = Math.max(
      0.12,
      ((cue.durationMs && cue.durationMs > 0 ? cue.durationMs : 250) / 1000) * playbackRate
    );

    const rawEnd = Math.max(0, nowVideo - effectiveLagSec * playbackRate);
    let rawStart = Math.max(0, rawEnd - clipDurSec);

    const existingAnchor = utteranceAnchors.get(cue.id);
    if (!existingAnchor) {
      utteranceAnchors.set(cue.id, {
        id: cue.id,
        rawVideoStart: rawStart,
        firstClipStartMs: cue.clipStartMs,
      });
      if (utteranceAnchors.size > 48) {
        const oldestKey = utteranceAnchors.keys().next().value;
        if (oldestKey) utteranceAnchors.delete(oldestKey);
      }
    } else {
      if (cue.isFinal && Math.abs(rawStart - existingAnchor.rawVideoStart) < 4.0) {
        existingAnchor.rawVideoStart = rawStart;
      } else if (
        cue.clipStartMs !== undefined &&
        existingAnchor.firstClipStartMs !== undefined
      ) {
        const deltaSec =
          ((cue.clipStartMs - existingAnchor.firstClipStartMs) / 1000) * playbackRate;
        if (Math.abs(deltaSec) < 2.0) {
          rawStart = Math.max(0, existingAnchor.rawVideoStart + deltaSec);
        } else {
          rawStart = Math.min(existingAnchor.rawVideoStart, rawStart);
        }
      } else {
        rawStart = Math.min(existingAnchor.rawVideoStart, rawStart);
      }
    }

    const estimatedStart = Math.max(0, rawStart - startPadSec);
    const estimatedEnd = Math.max(estimatedStart + 0.2, rawEnd + endPadSec);
    return { estimatedStart, estimatedEnd };
  }

  // Fallback: character-rate estimation
  const textSec = Math.max(1.8, cleanText.length / 13.0);
  const chunkSec = cue.durationMs && cue.durationMs > 0 ? cue.durationMs / 1000 : 0;
  const durSec = Math.max(chunkSec, textSec);
  const lagSec = cue.lagMs !== undefined && cue.lagMs >= 0 ? cue.lagMs / 1000 : 0.75;
  const effectiveLagSec = Math.max(0, lagSec - pausedDuringLagSec);

  const estimatedEnd = Math.max(0, nowVideo - effectiveLagSec * playbackRate + endPadSec);
  const estimatedStart = Math.max(0, estimatedEnd - durSec * playbackRate - startPadSec);
  return { estimatedStart, estimatedEnd };
}

export function findPreviousSubtitleCue(
  timeline: TimelineCue[],
  vPos: number,
  padSec: number,
  lastSeekTargetId: string | null,
  lastSeekWallTime: number
): { targetCue: TimelineCue | null; targetIndex: number } {
  let targetCue: TimelineCue | null = null;
  let targetIndex = -1;
  const nowWall = Date.now();

  // Step backward sentence-by-sentence if pressed within 1.4s
  if (lastSeekTargetId && nowWall - lastSeekWallTime < 1400) {
    const prevIdx = timeline.findIndex((c) => c.id === lastSeekTargetId);
    if (prevIdx > 0) {
      const candidate = timeline[prevIdx - 1];
      const current = timeline[prevIdx];
      if (current.startTime - candidate.endTime <= 30.0) {
        targetCue = candidate;
        targetIndex = prevIdx - 1;
      } else {
        return { targetCue: null, targetIndex: -1 };
      }
    } else if (prevIdx === 0) {
      return { targetCue: null, targetIndex: -1 };
    }
  }

  if (!targetCue) {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const c = timeline[i];
      if (vPos >= c.startTime - padSec - 0.25 && vPos <= c.endTime + padSec + 3.0) {
        const targetSeekPos = Math.max(0.08, c.startTime - padSec);
        if (
          Math.abs(vPos - targetSeekPos) < 0.55 ||
          (vPos < targetSeekPos + 0.45 && vPos >= targetSeekPos - 0.25)
        ) {
          if (i > 0) {
            const prevCandidate = timeline[i - 1];
            if (c.startTime - prevCandidate.endTime <= 30.0) {
              targetCue = prevCandidate;
              targetIndex = i - 1;
            }
            break;
          } else {
            return { targetCue: null, targetIndex: -1 };
          }
        }
        targetCue = c;
        targetIndex = i;
        break;
      } else if (c.endTime < vPos) {
        if (targetCue === null && vPos - c.endTime <= 12.0) {
          targetCue = c;
          targetIndex = i;
          break;
        }
      }
    }
  }

  return { targetCue, targetIndex };
}

export function findNextSubtitleCue(
  timeline: TimelineCue[],
  vPos: number,
  lastSeekTargetId: string | null,
  lastSeekWallTime: number,
  activeReplayCue: TimelineCue | null
): TimelineCue | null {
  const nowWall = Date.now();
  let targetCue: TimelineCue | null = null;

  const anchorId =
    lastSeekTargetId && nowWall - lastSeekWallTime < 1800
      ? lastSeekTargetId
      : activeReplayCue?.id || null;

  if (anchorId) {
    const idx = timeline.findIndex((c) => c.id === anchorId);
    if (idx !== -1 && idx + 1 < timeline.length) {
      const nextCandidate = timeline[idx + 1];
      if (nextCandidate.startTime - timeline[idx].endTime <= 30.0) {
        targetCue = nextCandidate;
      }
    }
  }

  if (!targetCue) {
    for (let i = 0; i < timeline.length; i++) {
      const c = timeline[i];
      if (c.startTime > vPos + 0.2 && c.startTime - vPos <= 30.0) {
        targetCue = c;
        break;
      }
    }
  }

  return targetCue;
}
