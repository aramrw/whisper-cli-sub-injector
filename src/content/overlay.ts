import { ExtensionSettings, SubtitleCue } from '../common/types';

export interface TimelineCue {
  id: string;
  text: string;
  startTime: number;  // in video.currentTime seconds
  endTime: number;    // in video.currentTime seconds
  receivedAt: number;
}

let styleSheetInjected = false;
function ensureSelectionStyle() {
  if (styleSheetInjected) return;
  const style = document.createElement('style');
  style.textContent = `
    .whisper-cli-sub-item {
      user-select: text !important;
      -webkit-user-select: text !important;
      pointer-events: auto !important;
      cursor: text !important;
    }
    .whisper-cli-sub-item::selection {
      background: #38bdf8 !important;
      color: #000000 !important;
      text-shadow: none !important;
    }
    .whisper-cli-sub-item::-moz-selection {
      background: #38bdf8 !important;
      color: #000000 !important;
      text-shadow: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  styleSheetInjected = true;
}

export class VideoOverlay {
  readonly video: HTMLMediaElement;
  private container: HTMLDivElement;
  private stackContainer: HTMLDivElement;
  private settings: ExtensionSettings;
  private fadeTimer: any = null;
  private fadeTargetTime = 0;
  private fadeRemainingMs = 0;
  private pausedAt = 0;
  private resizeObserver: ResizeObserver | null = null;
  private isFullscreen = false;
  private activeCues: SubtitleCue[] = [];
  private isHovered = false;
  private timeline: TimelineCue[] = [];
  private activeReplayCue: TimelineCue | null = null;
  private isReplaySeeking = false;

  constructor(video: HTMLMediaElement, settings: ExtensionSettings) {
    this.video = video;
    this.settings = settings;

    ensureSelectionStyle();

    // Create outer container (pointer-events: none so clicks outside subtitle text pass through to video)
    this.container = document.createElement('div');
    this.container.className = 'whisper-cli-sub-overlay';
    this.container.setAttribute('aria-live', 'polite');
    this.container.style.setProperty('pointer-events', 'none', 'important');
    this.container.style.setProperty('position', 'absolute', 'important');
    this.container.style.setProperty('z-index', '2147483647', 'important');
    this.container.style.setProperty('transition', 'opacity 0.25s ease', 'important');
    this.container.style.setProperty('opacity', '0', 'important');

    // Create stack container
    this.stackContainer = document.createElement('div');
    this.stackContainer.className = 'whisper-cli-sub-stack';
    this.stackContainer.style.setProperty('display', 'flex', 'important');
    this.stackContainer.style.setProperty('flex-direction', 'column', 'important');
    this.stackContainer.style.setProperty('align-items', 'center', 'important');
    this.stackContainer.style.setProperty('gap', '5px', 'important');
    this.stackContainer.style.setProperty('width', '100%', 'important');
    this.stackContainer.style.setProperty('pointer-events', 'none', 'important');
    this.container.appendChild(this.stackContainer);

    this.applySettings(settings);
    this.attach();
    this.setupListeners();
  }

  private attach() {
    const fsElement = document.fullscreenElement;
    if (fsElement && (fsElement.contains(this.video) || fsElement === this.video)) {
      this.isFullscreen = true;
      fsElement.appendChild(this.container);
    } else {
      this.isFullscreen = false;
      document.body.appendChild(this.container);
    }
    this.updatePosition();
  }

  private onVideoPause() {
    this.pausedAt = Date.now();
    if (this.settings.pauseSubtitlesWithVideo) {
      if (this.fadeTimer) {
        this.fadeRemainingMs = Math.max(1000, this.fadeTargetTime - Date.now());
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      } else if (this.activeCues.length > 0) {
        this.fadeRemainingMs = this.settings.autoFadeTimeoutMs;
      }
      // Ensure subtitles remain frozen in place on screen while paused
      if (this.activeCues.length > 0 && this.container) {
        this.container.style.setProperty('opacity', '1', 'important');
      }
    }
  }

  private onVideoPlay() {
    this.pausedAt = 0;
    if (this.settings.pauseSubtitlesWithVideo && this.activeCues.length > 0) {
      const remaining = this.fadeRemainingMs > 0 ? this.fadeRemainingMs : this.settings.autoFadeTimeoutMs;
      this.scheduleFadeOut(remaining);
    }
  }

  private setupListeners() {
    // Fullscreen change
    const onFullscreen = () => {
      this.attach();
    };
    document.addEventListener('fullscreenchange', onFullscreen);

    // Resize observer on video element
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.updatePosition();
      });
      this.resizeObserver.observe(this.video);
    }

    // Scroll and window resize
    const onWindowChange = () => {
      this.updatePosition();
    };
    window.addEventListener('resize', onWindowChange, { passive: true });
    window.addEventListener('scroll', onWindowChange, { passive: true });

    // Video play/timeupdate repositioning
    this.video.addEventListener('play', onWindowChange);
    this.video.addEventListener('loadedmetadata', onWindowChange);

    // Video play/pause handlers for subtitle pause behavior
    const onPause = () => this.onVideoPause();
    const onPlay = () => this.onVideoPlay();
    const onTimeUpdate = () => this.onTimeUpdate();
    this.video.addEventListener('pause', onPause);
    this.video.addEventListener('play', onPlay);
    this.video.addEventListener('playing', onPlay);
    this.video.addEventListener('timeupdate', onTimeUpdate);

    // Pause auto-fade when hovering or highlighting text (essential for Yomitan scanning across lines)
    const onMouseEnter = () => {
      this.isHovered = true;
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
    };
    const onMouseLeave = () => {
      this.isHovered = false;
      if (!this.video.paused || !this.settings.pauseSubtitlesWithVideo) {
        this.scheduleFadeOut();
      }
    };
    this.stackContainer.addEventListener('mouseenter', onMouseEnter);
    this.stackContainer.addEventListener('mouseleave', onMouseLeave);

    // Prevent text highlight mousedown/click from bubbling down to video (which triggers pause/play on YouTube)
    const stopProp = (e: MouseEvent) => {
      e.stopPropagation();
    };
    this.stackContainer.addEventListener('mousedown', stopProp);
    this.stackContainer.addEventListener('click', stopProp);

    // Save cleanup references
    (this.container as any)._cleanup = () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange);
      this.video.removeEventListener('play', onWindowChange);
      this.video.removeEventListener('loadedmetadata', onWindowChange);
      this.video.removeEventListener('pause', onPause);
      this.video.removeEventListener('play', onPlay);
      this.video.removeEventListener('playing', onPlay);
      this.video.removeEventListener('timeupdate', onTimeUpdate);
      this.stackContainer.removeEventListener('mouseenter', onMouseEnter);
      this.stackContainer.removeEventListener('mouseleave', onMouseLeave);
      this.stackContainer.removeEventListener('mousedown', stopProp);
      this.stackContainer.removeEventListener('click', stopProp);
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
    };
  }

  applySettings(settings: ExtensionSettings) {
    this.settings = settings;

    if (!settings.enabled) {
      this.hide();
    } else {
      this.renderStack();
      this.updatePosition();
    }
  }

  renderStack() {
    this.stackContainer.innerHTML = '';
    const total = this.activeCues.length;
    if (total === 0) return;

    for (let i = 0; i < total; i++) {
      const cue = this.activeCues[i];
      // age = 0 is the newest cue (rendered at bottom), age > 0 are older cues stacked above it
      const age = (total - 1) - i;

      let opacity = 1.0;
      let scale = 1.0;

      if (age === 1) {
        opacity = 0.68;
        scale = 0.85;
      } else if (age === 2) {
        opacity = 0.42;
        scale = 0.72;
      } else if (age >= 3) {
        opacity = 0.25;
        scale = 0.60;
      }

      const item = document.createElement('div');
      item.className = 'whisper-cli-sub-item';
      item.dataset.cueId = cue.id;
      item.textContent = cue.text;

      const itemFontSize = Math.max(13, Math.round(this.settings.fontSize * scale));
      item.style.setProperty('font-size', `${itemFontSize}px`, 'important');
      item.style.setProperty('opacity', String(opacity), 'important');
      item.style.setProperty('color', this.settings.textColor, 'important');
      item.style.setProperty('font-family', 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'important');
      item.style.setProperty('font-weight', age === 0 ? '600' : '500', 'important');
      item.style.setProperty('line-height', '1.35', 'important');
      item.style.setProperty('text-align', 'center', 'important');
      item.style.setProperty('user-select', 'text', 'important');
      item.style.setProperty('-webkit-user-select', 'text', 'important');
      item.style.setProperty('pointer-events', 'auto', 'important');
      item.style.setProperty('cursor', 'text', 'important');
      item.style.setProperty('transition', 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)', 'important');
      item.style.setProperty('display', 'inline-block', 'important');
      item.style.setProperty('word-break', 'break-word', 'important');

      if (this.settings.showBackgroundBox) {
        item.style.setProperty('background', this.settings.backgroundColor, 'important');
        item.style.setProperty('padding', age === 0 ? '6px 14px' : '4px 10px', 'important');
        item.style.setProperty('border-radius', '6px', 'important');
        item.style.setProperty('box-shadow', '0 2px 8px rgba(0, 0, 0, 0.4)', 'important');
        item.style.setProperty(
          'text-shadow',
          `0 1px 2px ${this.settings.outlineColor}, 0 0 1px ${this.settings.outlineColor}`,
          'important'
        );
      } else {
        item.style.setProperty('background', 'transparent', 'important');
        item.style.setProperty('padding', '0', 'important');
        item.style.setProperty(
          'text-shadow',
          `-2px -2px 0 ${this.settings.outlineColor}, 2px -2px 0 ${this.settings.outlineColor}, -2px 2px 0 ${this.settings.outlineColor}, 2px 2px 0 ${this.settings.outlineColor}, 0 2px 6px rgba(0,0,0,0.85)`,
          'important'
        );
      }

      this.stackContainer.appendChild(item);
    }

    this.updatePosition();
  }

  updatePosition() {
    if (!this.container || !this.video) return;

    if (!this.container.isConnected) {
      this.attach();
    }

    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'block';

    const fsElement = document.fullscreenElement;
    const isFs = Boolean(fsElement && (fsElement.contains(this.video) || fsElement === this.video));

    let centerX: number;
    let targetY: number;

    if (isFs) {
      // In fullscreen mode, position relative to fullscreen viewport/container
      const fsRect = fsElement!.getBoundingClientRect();
      centerX = (rect.left - fsRect.left) + rect.width / 2;

      if (this.settings.alignment === 'top') {
        targetY = (rect.top - fsRect.top) + this.settings.topOffset;
      } else {
        targetY = (rect.top - fsRect.top) + rect.height - this.settings.bottomOffset;
      }
    } else {
      // Standard non-fullscreen mode: position relative to page scroll
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      centerX = rect.left + rect.width / 2 + scrollX;

      if (this.settings.alignment === 'top') {
        targetY = rect.top + this.settings.topOffset + scrollY;
      } else {
        targetY = rect.top + rect.height - this.settings.bottomOffset + scrollY;
      }
    }

    const maxWidth = Math.max(200, Math.min(rect.width * 0.90, window.innerWidth * 0.92));
    const isTop = this.settings.alignment === 'top';
    const transformVal = isTop ? 'translateX(-50%)' : 'translate(-50%, -100%)';

    this.container.style.setProperty('left', `${centerX}px`, 'important');
    this.container.style.setProperty('top', `${targetY}px`, 'important');
    this.container.style.setProperty('transform', transformVal, 'important');
    this.container.style.setProperty('max-width', `${maxWidth}px`, 'important');
  }

  clearTimelineCache() {
    this.timeline = [];
    this.activeReplayCue = null;
    console.log('[whisper-cli-sub-injector] Subtitle replay cache cleared.');
  }

  restoreIfIdle(cue: SubtitleCue) {
    if (!this.settings.enabled) return;
    const isVisible = this.container && this.container.style.opacity === '1';
    if (this.activeCues.length === 0 || !isVisible) {
      const isFresh = Date.now() - cue.receivedAt < 45000;
      if (isFresh || this.video.paused) {
        this.showCue(cue);
      }
    }
  }

  refreshPausedSubtitle() {
    if (!this.settings.enabled) return;
    if (this.activeCues.length > 0 && this.container) {
      this.updatePosition();
      this.container.style.setProperty('opacity', '1', 'important');
    }
  }

  showCue(cue: SubtitleCue) {
    if (!this.settings.enabled) return;

    // If video is paused and pauseSubtitlesWithVideo is active:
    // If paused for more than 4s, ignore stray background/mic audio so it doesn't overwrite frozen paused subtitles
    if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
      if (this.pausedAt > 0 && (Date.now() - this.pausedAt > 4000)) {
        return;
      }
    }

    // Register timing in the video timeline for smart replay navigation
    const nowVideo = this.video.currentTime;
    const cleanText = cue.text.trim();
    const cleanTextLower = cleanText.toLowerCase();

    // Human conversational speech rate is typically ~13-14 chars/sec (or ~2.5 to 3 words/sec).
    // If Whisper chunked the audio (e.g. at 2.5s) or split at a micro-pause, the reported chunk
    // duration can be far shorter than the full spoken sentence, which would cause seeks to land
    // in the middle of the sentence!
    // We enforce that duration is at least the physical time needed to speak the text:
    const textSec = Math.max(1.8, cleanText.length / 13.0);
    const chunkSec = cue.durationMs && cue.durationMs > 0 ? cue.durationMs / 1000 : 0;
    const durSec = Math.max(chunkSec, textSec);

    // Latency from Whisper:
    const lagSec = cue.lagMs !== undefined && cue.lagMs >= 0 ? cue.lagMs / 1000 : 0.75;

    const estimatedEnd = Math.max(0, nowVideo - lagSec);
    let estimatedStart = Math.max(0, estimatedEnd - durSec);

    // If new episode started (video currentTime jumped back close to 0 while we have old cues from deep in video):
    if (nowVideo < 2.0 && this.timeline.length > 0 && this.timeline[this.timeline.length - 1].startTime > 30) {
      this.timeline = [];
    }

    if (this.settings.enableSubtitleCache) {
      // Deduplication & cache update:
      // If this line was already registered or replayed, or is an in-progress extension:
      const existingIndex = this.timeline.findIndex(
        (c) =>
          c.id === cue.id ||
          c.text.trim().toLowerCase() === cleanTextLower ||
          cleanTextLower.startsWith(c.text.trim().toLowerCase()) ||
          c.text.trim().toLowerCase().startsWith(cleanTextLower) ||
          Math.abs(c.startTime - estimatedStart) < 3.0
      );

      if (existingIndex !== -1) {
        // Update both bounds: if a new calculation gives an earlier startTime, USE IT!
        this.timeline[existingIndex].text = cue.text;
        this.timeline[existingIndex].startTime = Math.min(this.timeline[existingIndex].startTime, estimatedStart);
        this.timeline[existingIndex].endTime = Math.max(this.timeline[existingIndex].endTime, estimatedEnd);
        this.timeline[existingIndex].id = cue.id;
      } else {
        // Check if previous cue in timeline ended very recently (< 1.2s ago).
        // If gap is small, they are adjacent clauses in the same dialogue:
        if (this.timeline.length > 0) {
          const prev = this.timeline[this.timeline.length - 1];
          if (estimatedStart > prev.endTime && estimatedStart - prev.endTime < 1.2) {
            estimatedStart = prev.endTime + 0.05;
          }
        }

        this.timeline.push({
          id: cue.id,
          text: cue.text,
          startTime: estimatedStart,
          endTime: estimatedEnd,
          receivedAt: cue.receivedAt,
        });

        if (this.timeline.length > 100) {
          this.timeline.shift();
        }
        this.timeline.sort((a, b) => a.startTime - b.startTime);
      }
    }

    // In-progress streaming update:
    // If the last active cue shares the same ID, or the new text extends/replaces it:
    const lastCue = this.activeCues[this.activeCues.length - 1];
    const isContinuation =
      lastCue &&
      (lastCue.id === cue.id ||
        cleanText.startsWith(lastCue.text.trim()) ||
        lastCue.text.trim().startsWith(cleanText));

    if (isContinuation && lastCue) {
      lastCue.text = cue.text;
      lastCue.receivedAt = cue.receivedAt;
      lastCue.id = cue.id;
      lastCue.durationMs = cue.durationMs;
      this.renderStack();
      this.container.style.setProperty('opacity', '1', 'important');
      return;
    }

    if (!this.settings.stackMode || this.settings.maxLines <= 1) {
      this.activeCues = [cue];
    } else {
      this.activeCues.push(cue);
      const maxLines = Math.max(1, this.settings.maxLines || 3);
      while (this.activeCues.length > maxLines) {
        this.activeCues.shift();
      }
    }

    this.renderStack();

    // Fade in
    this.container.style.setProperty('opacity', '1', 'important');

    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    if (!this.isHovered) {
      if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
        // Keep visible indefinitely while paused; save default timeout for when play resumes
        this.fadeRemainingMs = this.settings.autoFadeTimeoutMs || 6000;
      } else {
        this.scheduleFadeOut();
      }
    }
  }

  seekToPreviousSubtitle(): boolean {
    if (!this.settings.subNavigationEnabled) return false;

    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;

    // IF CACHING IS DISABLED:
    // Estimate directly from the currently/most recently displayed cue
    if (!this.settings.enableSubtitleCache) {
      const lastActive = this.activeCues[this.activeCues.length - 1];
      if (lastActive) {
        const textDur = Math.max(2.2, lastActive.text.trim().length / 13.0);
        const seekTime = Math.max(0, vPos - textDur - padSec);
        this.video.currentTime = seekTime;
        if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
          this.video.play().catch(() => {});
        }
        return true;
      }
      return false; // Let native video player rewind 5s/10s
    }

    if (this.timeline.length === 0) {
      const lastActive = this.activeCues[this.activeCues.length - 1];
      if (lastActive) {
        const textDur = Math.max(2.2, lastActive.text.trim().length / 13.0);
        const seekTime = Math.max(0, vPos - textDur - padSec);
        this.video.currentTime = seekTime;
        if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
          this.video.play().catch(() => {});
        }
        return true;
      }
      return false;
    }

    let targetCue: TimelineCue | null = null;
    let targetIndex = -1;

    // Scan backwards from latest to earliest in timeline
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const c = this.timeline[i];
      // Is vPos inside this cue or just finished (up to 3.0s after endTime)?
      if (vPos >= c.startTime - padSec - 0.25 && vPos <= c.endTime + padSec + 3.0) {
        const targetSeekPos = Math.max(0, c.startTime - padSec);
        // Did we already jump to the start of this cue? (or within 0.5s of it)
        if (Math.abs(vPos - targetSeekPos) < 0.5 || (vPos < targetSeekPos + 0.4 && vPos >= targetSeekPos - 0.25)) {
          // User wants to jump to the cue before this one!
          if (i > 0) {
            targetCue = this.timeline[i - 1];
            targetIndex = i - 1;
            break;
          }
        } else {
          // Replay this cue from the start!
          targetCue = c;
          targetIndex = i;
          break;
        }
      } else if (c.endTime < vPos) {
        // Cue ended prior to vPos. If within 12s of quiet / silence, seek back to it!
        if (targetCue === null && (vPos - c.endTime) <= 12.0) {
          targetCue = c;
          targetIndex = i;
          break;
        }
      }
    }

    if (!targetCue) {
      return false;
    }

    // Sentence clause chaining:
    // If targetCue is immediately preceded by an adjacent cue (< 1.2s pause)
    // and targetCue is a continuation (starts with lowercase or conjunction like 'pero', 'y', 'que'),
    // jump to the start of the entire sentence!
    if (targetIndex > 0) {
      const prevCue = this.timeline[targetIndex - 1];
      const gap = targetCue.startTime - prevCue.endTime;
      const startsWithLower = /^[a-záéíóúñ]/.test(targetCue.text.trim());
      if (gap < 1.0 || (gap < 1.8 && startsWithLower)) {
        targetCue = prevCue;
      }
    }

    const seekTime = Math.max(0, targetCue.startTime - padSec);
    this.activeReplayCue = targetCue;
    this.isReplaySeeking = true;

    // Seek the video element directly
    this.video.currentTime = seekTime;

    // If video was paused and auto-play on replay is enabled, resume playback
    if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
      this.video.play().catch(() => {});
    }

    // Instantly display the replayed subtitle so the user can read it on replay
    this.displayReplayCue(targetCue);

    setTimeout(() => {
      this.isReplaySeeking = false;
    }, 250);

    return true;
  }

  private displayReplayCue(cue: TimelineCue) {
    if (!this.settings.enabled) return;

    const subCue: SubtitleCue = {
      id: cue.id,
      text: cue.text,
      receivedAt: Date.now(),
      durationMs: (cue.endTime - cue.startTime) * 1000,
    };

    this.activeCues = [subCue];
    this.renderStack();
    this.container.style.setProperty('opacity', '1', 'important');

    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
      this.fadeRemainingMs = this.settings.autoFadeTimeoutMs || 6000;
    }
  }

  private onTimeUpdate() {
    if (!this.settings.enabled) return;
    if (this.isReplaySeeking) return;

    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;

    // 1. If currently replaying an active cue:
    if (this.activeReplayCue) {
      if (vPos > this.activeReplayCue.endTime + padSec) {
        // Dialogue has finished! Clean fade out
        this.activeReplayCue = null;
        this.scheduleFadeOut(600);
      } else if (vPos < this.activeReplayCue.startTime - padSec - 1.5) {
        // User sought away backwards
        this.activeReplayCue = null;
      }
      return;
    }

    // 2. Check if current playback position enters any known timeline cue:
    if (!this.isHovered && (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)) {
      for (const cue of this.timeline) {
        if (vPos >= cue.startTime - padSec && vPos <= cue.endTime + padSec) {
          const lastActive = this.activeCues[this.activeCues.length - 1];
          if (!lastActive || lastActive.text.trim() !== cue.text.trim()) {
            this.displayReplayCue(cue);
            this.activeReplayCue = cue;
          }
          break;
        }
      }
    }
  }

  private scheduleFadeOut(customMs?: number) {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    // Never fade out while paused if pauseSubtitlesWithVideo is enabled
    if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
      return;
    }

    const duration = customMs || this.settings.autoFadeTimeoutMs || 6000;
    this.fadeTargetTime = Date.now() + duration;
    this.fadeRemainingMs = duration;

    this.fadeTimer = setTimeout(() => {
      if (!this.isHovered && (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)) {
        this.hide();
      }
    }, duration);
  }

  hide() {
    if (this.container) {
      this.container.style.setProperty('opacity', '0', 'important');
    }
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.fadeRemainingMs = 0;
    setTimeout(() => {
      if (this.container && this.container.style.opacity === '0') {
        this.activeCues = [];
        this.renderStack();
      }
    }, 260);
  }

  destroy() {
    this.hide();
    if ((this.container as any)._cleanup) {
      (this.container as any)._cleanup();
    }
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
