import { ExtensionSettings, SubtitleCue } from '../common/types';

export interface TimelineCue {
  id: string;
  text: string;
  startTime: number;  // in video.currentTime seconds
  endTime: number;    // in video.currentTime seconds
  receivedAt: number;
  isFinal?: boolean;
}

interface UtteranceAnchor {
  id: string;
  rawVideoStart: number;
  firstClipStartMs?: number;
}

interface RerecordWindow {
  startTime: number;
  endTime: number;
  expiresAt: number;
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
    .whisper-cli-sub-rerecord-btn {
      pointer-events: auto !important;
      cursor: pointer !important;
      user-select: none !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      padding: 3px 10px !important;
      border-radius: 999px !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #e2e8f0 !important;
      background: rgba(15, 23, 42, 0.86) !important;
      border: 1px solid rgba(56, 189, 248, 0.45) !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45) !important;
      transition: all 0.16s ease !important;
    }
    .whisper-cli-sub-rerecord-btn:hover {
      color: #ffffff !important;
      background: rgba(14, 116, 144, 0.92) !important;
      border-color: #38bdf8 !important;
      transform: translateY(-1px) !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  styleSheetInjected = true;
}

export class VideoOverlay {
  readonly video: HTMLMediaElement;
  private container: HTMLDivElement;
  private toolbarContainer: HTMLDivElement;
  private prevBtn: HTMLButtonElement;
  private rerecordBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
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
  private utteranceAnchors: Map<string, UtteranceAnchor> = new Map();
  private activeReplayCue: TimelineCue | null = null;
  private isReplaySeeking = false;
  private replaySeekResetTimer: any = null;
  private pendingSeekTimer: any = null;
  private lastVideoSeekAt = 0;
  private lastSeekTargetId: string | null = null;
  private lastSeekWallTime = 0;
  private lastLiveCueAt = 0;
  private maxWatchedTime = 0;
  private rerecordWindow: RerecordWindow | null = null;

  constructor(video: HTMLMediaElement, settings: ExtensionSettings) {
    this.video = video;
    this.settings = settings;
    this.pausedAt = video.paused ? Date.now() : 0;

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
    this.container.style.setProperty('display', 'flex', 'important');
    this.container.style.setProperty('flex-direction', 'column', 'important');
    this.container.style.setProperty('align-items', 'center', 'important');
    this.container.style.setProperty('gap', '6px', 'important');

    // Create floating action toolbar above subtitles (Prev, Re-record Line, Next)
    this.toolbarContainer = document.createElement('div');
    this.toolbarContainer.className = 'whisper-cli-sub-toolbar';
    this.toolbarContainer.style.setProperty('display', 'none', 'important');
    this.toolbarContainer.style.setProperty('justify-content', 'center', 'important');
    this.toolbarContainer.style.setProperty('align-items', 'center', 'important');
    this.toolbarContainer.style.setProperty('gap', '6px', 'important');
    this.toolbarContainer.style.setProperty('pointer-events', 'none', 'important');

    this.prevBtn = document.createElement('button');
    this.prevBtn.type = 'button';
    this.prevBtn.className = 'whisper-cli-sub-rerecord-btn';
    this.prevBtn.title = 'Previous subtitle (Left Arrow)';
    this.prevBtn.textContent = '⏮ Prev';
    this.prevBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.seekToPreviousSubtitle();
    });

    this.rerecordBtn = document.createElement('button');
    this.rerecordBtn.type = 'button';
    this.rerecordBtn.className = 'whisper-cli-sub-rerecord-btn';
    this.rerecordBtn.title = 'Uncement & re-record this subtitle line from its start (Alt+R)';
    this.rerecordBtn.textContent = '🔄 Re-record Line';
    this.rerecordBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.rerecordBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.rerecordCurrentSubtitle();
    });

    this.nextBtn = document.createElement('button');
    this.nextBtn.type = 'button';
    this.nextBtn.className = 'whisper-cli-sub-rerecord-btn';
    this.nextBtn.title = 'Next subtitle (Right Arrow)';
    this.nextBtn.textContent = 'Next ⏭';
    this.nextBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.seekToNextSubtitle();
    });

    this.toolbarContainer.appendChild(this.prevBtn);
    this.toolbarContainer.appendChild(this.rerecordBtn);
    this.toolbarContainer.appendChild(this.nextBtn);
    this.container.appendChild(this.toolbarContainer);

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

  private updateToolbarVisibility() {
    if (!this.toolbarContainer || !this.rerecordBtn || !this.prevBtn || !this.nextBtn) return;
    const isRerecording = Boolean(this.rerecordWindow && Date.now() < this.rerecordWindow.expiresAt);
    if (isRerecording) {
      this.prevBtn.style.setProperty('display', 'none', 'important');
      this.nextBtn.style.setProperty('display', 'none', 'important');
      this.rerecordBtn.style.setProperty('display', 'inline-flex', 'important');
      this.rerecordBtn.textContent = '🎙️ Re-recording line...';
      this.toolbarContainer.style.setProperty('display', 'flex', 'important');
      return;
    }
    this.rerecordBtn.textContent = '🔄 Re-record Line';

    // Only turn on the toolbar buttons when the video is paused
    if (!this.video.paused || this.activeCues.length === 0) {
      this.toolbarContainer.style.setProperty('display', 'none', 'important');
      return;
    }

    const showPrev = (this.settings.showPrevButton ?? true) && this.hasPreviousSubtitle();
    const showRerecord = this.settings.showRerecordButton ?? true;
    const showNext = (this.settings.showNextButton ?? true) && this.hasNextSubtitle();

    this.prevBtn.style.setProperty('display', showPrev ? 'inline-flex' : 'none', 'important');
    this.rerecordBtn.style.setProperty('display', showRerecord ? 'inline-flex' : 'none', 'important');
    this.nextBtn.style.setProperty('display', showNext ? 'inline-flex' : 'none', 'important');

    const shouldShow = showPrev || showRerecord || showNext;
    this.toolbarContainer.style.setProperty('display', shouldShow ? 'flex' : 'none', 'important');
  }

  private safeSendMessage(message: unknown) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        return;
      }
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch {
      // Extension context invalidated (e.g. extension was reloaded in chrome://extensions)
    }
  }

  private attach() {
    const fsElement = document.fullscreenElement;
    if (fsElement && (fsElement.contains(this.video) || fsElement === this.video)) {
      this.isFullscreen = true;
      fsElement.appendChild(this.container);
    } else {
      this.isFullscreen = false;
      const host = document.body || document.documentElement;
      if (host) {
        host.appendChild(this.container);
      }
    }
    this.updatePosition();
  }

  private onVideoPause() {
    this.pausedAt = Date.now();
    this.updateToolbarVisibility();
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
    this.updateToolbarVisibility();
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
      this.updateToolbarVisibility();
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
    };
    const onMouseLeave = () => {
      this.isHovered = false;
      this.updateToolbarVisibility();
      if (!this.video.paused || !this.settings.pauseSubtitlesWithVideo) {
        this.scheduleFadeOut();
      }
    };
    this.container.addEventListener('mouseenter', onMouseEnter);
    this.container.addEventListener('mouseleave', onMouseLeave);

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
      this.container.removeEventListener('mouseenter', onMouseEnter);
      this.container.removeEventListener('mouseleave', onMouseLeave);
      this.stackContainer.removeEventListener('mousedown', stopProp);
      this.stackContainer.removeEventListener('click', stopProp);
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
    };
  }

  applySettings(settings: ExtensionSettings) {
    this.settings = settings;
    this.updateToolbarVisibility();

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
    this.updateToolbarVisibility();
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

    this.container.style.setProperty('display', 'flex', 'important');

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
    this.utteranceAnchors.clear();
    this.activeReplayCue = null;
    this.lastSeekTargetId = null;
    this.lastSeekWallTime = 0;
    this.maxWatchedTime = 0;
    this.rerecordWindow = null;
    console.log('[whisper-cli-sub-injector] Subtitle replay cache cleared.');
  }

  private splitIntoSentenceParts(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    // Split on sentence-ending punctuation (. ! ? 。 ！ ？ …) followed by whitespace or CJK/opening punctuation
    const parts = trimmed
      .split(/(?<=[.!?。！？…]["”'’»)」』】]?)\s+|(?<=[。！？…])(?=[^\s。！？…])/u)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    return parts.length > 1 ? parts : [trimmed];
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

  /**
   * Uncements the currently active or most recent subtitle line, removes it from history,
   * opens a re-record window for its timespan, and seeks back to replay & re-transcribe it cleanly.
   */
  rerecordCurrentSubtitle(): boolean {
    if (!this.settings.enabled) return false;
    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;

    let targetCue: TimelineCue | null = this.activeReplayCue;
    if (!targetCue && this.timeline.length > 0) {
      // Find cue covering vPos or most recently ended before vPos
      for (let i = this.timeline.length - 1; i >= 0; i--) {
        const c = this.timeline[i];
        if (vPos >= c.startTime - padSec - 0.3 && vPos <= c.endTime + padSec + 4.0) {
          targetCue = c;
          break;
        }
      }
      if (!targetCue) {
        targetCue = this.timeline[this.timeline.length - 1];
      }
    }

    if (!targetCue) {
      // Fallback: rewind 3 seconds and open a 6s re-record window
      const seekTime = Math.max(0.08, vPos - 3.0);
      this.rerecordWindow = {
        startTime: Math.max(0, seekTime - 0.5),
        endTime: vPos + 3.0,
        expiresAt: Date.now() + 12000,
      };
      this.activeCues = [];
      this.renderStack();
      this.performSafeVideoSeek(seekTime);
      return true;
    }

    const winStart = Math.max(0, targetCue.startTime - 0.15);
    const winEnd = targetCue.endTime + 0.15;

    // Remove targetCue (and any fragments inside its immediate span) from timeline & background history
    const removedIds: string[] = [];
    this.timeline = this.timeline.filter((c) => {
      const overlaps =
        c.id === targetCue!.id ||
        (c.startTime >= winStart - 0.1 && c.endTime <= winEnd + 0.1);
      if (overlaps) {
        removedIds.push(c.id);
        this.utteranceAnchors.delete(c.id);
        return false;
      }
      return true;
    });

    for (const id of removedIds) {
      this.safeSendMessage({
        type: 'DROP_PAUSED_HISTORY_CUE',
        cueId: id,
        forceDelete: true,
      });
    }

    this.rerecordWindow = {
      startTime: Math.max(0, targetCue.startTime - 0.5),
      endTime: targetCue.endTime + 2.5,
      expiresAt: Date.now() + 14000,
    };

    this.activeReplayCue = null;
    this.activeCues = [];
    this.renderStack();
    this.container.style.setProperty('opacity', '1', 'important');
    this.updateToolbarVisibility();

    this.performSafeVideoSeek(targetCue.startTime - padSec);

    return true;
  }

  showCue(cue: SubtitleCue) {
    if (!this.settings.enabled) return;

    const cleanText = cue.text.trim();
    if (!cleanText) return;
    const cleanTextLower = cleanText.toLowerCase();

    const pausedDurationMs = this.video.paused
      ? this.pausedAt > 0
        ? Date.now() - this.pausedAt
        : 999999
      : 0;

    // 1. Handle incoming audio while video is paused (e.g. Anki cards, Yomitan audio, background tabs)
    if (this.video.paused) {
      const startedWhilePlaying = this.utteranceAnchors.has(cue.id) && pausedDurationMs <= 2500;
      const finalizationGraceMs = (cue.lagMs ?? 350) + 450;

      if (this.settings.ignoreSubtitlesWhenPaused ?? true) {
        if (!startedWhilePlaying && pausedDurationMs > finalizationGraceMs) {
          this.safeSendMessage({
            type: 'DROP_PAUSED_HISTORY_CUE',
            cueId: cue.id,
          });
          return;
        }
      } else if (this.settings.pauseSubtitlesWithVideo && pausedDurationMs > 4000) {
        return;
      }
    }

    // 2. Compute video timeline start & end timestamps (in video.currentTime seconds)
    const nowVideo = this.video.currentTime;
    this.maxWatchedTime = Math.max(this.maxWatchedTime, nowVideo);
    const playbackRate = this.video.playbackRate > 0 ? this.video.playbackRate : 1.0;
    const pausedDuringLagSec =
      this.video.paused && this.pausedAt > 0
        ? Math.max(0, (Date.now() - this.pausedAt) / 1000)
        : 0;
    const startPadSec = Math.max(0, (this.settings.srtStartPaddingMs ?? 50) / 1000);
    const endPadSec = Math.max(0, (this.settings.srtEndPaddingMs ?? 100) / 1000);

    let estimatedStart: number;
    let estimatedEnd: number;

    const hasExactCliTiming =
      (this.settings.exactByteTiming ?? true) &&
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

      // Lock the start of the utterance on the very first partial, while allowing word-level
      // or sentence-split refinement when the CLI reports an updated clipStartMs/durationMs.
      const existingAnchor = this.utteranceAnchors.get(cue.id);
      if (!existingAnchor) {
        this.utteranceAnchors.set(cue.id, {
          id: cue.id,
          rawVideoStart: rawStart,
          firstClipStartMs: cue.clipStartMs,
        });
        if (this.utteranceAnchors.size > 48) {
          const oldestKey = this.utteranceAnchors.keys().next().value;
          if (oldestKey) this.utteranceAnchors.delete(oldestKey);
        }
      } else {
        if (cue.isFinal && Math.abs(rawStart - existingAnchor.rawVideoStart) < 4.0) {
          // Trust final word-aligned duration from SpeechTranscriber
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

      estimatedStart = Math.max(0, rawStart - startPadSec);
      estimatedEnd = Math.max(estimatedStart + 0.2, rawEnd + endPadSec);
    } else {
      // Fallback: character-rate estimation
      const textSec = Math.max(1.8, cleanText.length / 13.0);
      const chunkSec = cue.durationMs && cue.durationMs > 0 ? cue.durationMs / 1000 : 0;
      const durSec = Math.max(chunkSec, textSec);
      const lagSec = cue.lagMs !== undefined && cue.lagMs >= 0 ? cue.lagMs / 1000 : 0.75;
      const effectiveLagSec = Math.max(0, lagSec - pausedDuringLagSec);

      estimatedEnd = Math.max(0, nowVideo - effectiveLagSec * playbackRate + endPadSec);
      estimatedStart = Math.max(0, estimatedEnd - durSec * playbackRate - startPadSec);
    }

    // If new episode started (video currentTime jumped back close to 0 while we have old cues from deep in video):
    if (nowVideo < 2.0 && this.timeline.length > 0 && this.timeline[this.timeline.length - 1].startTime > 30) {
      this.timeline = [];
      this.utteranceAnchors.clear();
      this.maxWatchedTime = nowVideo;
      this.rerecordWindow = null;
    }

    // Check if an active Re-record Window is open for this video range
    if (this.rerecordWindow && Date.now() >= this.rerecordWindow.expiresAt) {
      this.rerecordWindow = null;
    }
    const inRerecordWindow = Boolean(
      this.rerecordWindow &&
        estimatedEnd >= this.rerecordWindow.startTime &&
        estimatedStart <= this.rerecordWindow.endTime
    );
    if (inRerecordWindow && cue.isFinal) {
      // Close the re-record window once a final line has been captured in it
      this.rerecordWindow = null;
    }

    // 2c. Cemented Timeline Protection:
    // If `cementSubtitlesInTimeline` is enabled and the user rewound into an already-cemented
    // subtitle region (and is NOT actively re-recording that line), ignore redundant re-transcriptions
    // so cemented subtitles stay locked and history is never polluted with duplicate re-transcribed lines!
    if (
      this.settings.enableSubtitleCache &&
      (this.settings.cementSubtitlesInTimeline ?? true) &&
      !inRerecordWindow
    ) {
      const sameIdExists = this.timeline.some((c) => c.id === cue.id);
      if (!sameIdExists) {
        const cementedMatch = this.timeline.find((c) => {
          if (!c.isFinal) return false;
          // Must be an older finalized line (cemented > 3.0s ago), not the immediately preceding sentence
          if (Math.abs(cue.receivedAt - c.receivedAt) < 3000) return false;
          const overlap = Math.min(c.endTime, estimatedEnd) - Math.max(c.startTime, estimatedStart);
          const span = Math.max(0.2, estimatedEnd - estimatedStart);
          return overlap > 0.35 || overlap / span > 0.45;
        });

        if (cementedMatch) {
          this.safeSendMessage({
            type: 'DROP_PAUSED_HISTORY_CUE',
            cueId: cue.id,
            forceDelete: true,
          });
          // Ensure the cemented cue is displayed on screen if vPos is inside it
          if (nowVideo >= cementedMatch.startTime - 0.25 && nowVideo <= cementedMatch.endTime + 0.25) {
            this.displayReplayCue(cementedMatch);
            this.activeReplayCue = cementedMatch;
          }
          return;
        }
      }
    }

    // If the video jumped forward from 0 (e.g. Crunchyroll restoring saved watch progress at 12:33),
    // purge any bogus pre-load 00:00.0 cues so backward seeking never jumps back to 00:00.0!
    if (nowVideo > 15.0 && this.timeline.length > 0 && this.timeline[0].endTime < 2.5) {
      this.timeline = this.timeline.filter((c) => c.endTime >= 2.5);
    }

    // Clear any stale replay lock so live streaming subtitles appear immediately without being one behind!
    this.activeReplayCue = null;
    this.lastLiveCueAt = Date.now();

    let syncedTimelineCue: TimelineCue = {
      id: cue.id,
      text: cue.text,
      startTime: estimatedStart,
      endTime: estimatedEnd,
      receivedAt: cue.receivedAt,
      isFinal: cue.isFinal,
    };
    let replacedCueId: string | undefined;

    const hasValidVideoClock = nowVideo > 0.08 || this.maxWatchedTime > 0.5;
    if (this.settings.enableSubtitleCache && hasValidVideoClock) {
      // 2a. Check if this exact utterance ID is already in the timeline (streaming partial -> final)
      const sameIdIndex = this.timeline.findIndex((c) => c.id === cue.id);

      if (sameIdIndex !== -1) {
        const target = this.timeline[sameIdIndex];
        const sentenceParts =
          (this.settings.splitMultiSentenceCues ?? true) && (cue.isFinal ?? true)
            ? this.splitIntoSentenceParts(cue.text)
            : [cue.text.trim()];

        if (sentenceParts.length > 1) {
          const totalChars = Math.max(
            1,
            sentenceParts.reduce((acc, s) => acc + s.length, 0)
          );
          const totalSpan = Math.max(0.4, estimatedEnd - estimatedStart);
          let cursorStart = estimatedStart;
          const newItems: TimelineCue[] = [];

          sentenceParts.forEach((part, idx) => {
            const weight = part.length / totalChars;
            const partSpan =
              idx === sentenceParts.length - 1
                ? Math.max(0.2, estimatedEnd - cursorStart)
                : Math.max(0.25, totalSpan * weight);
            const partEnd = Math.min(estimatedEnd, cursorStart + partSpan);
            const subItem: TimelineCue = {
              id: idx === 0 ? cue.id : `${cue.id}-s${idx}`,
              text: part,
              startTime: cursorStart,
              endTime: Math.max(cursorStart + 0.2, partEnd),
              receivedAt: cue.receivedAt + idx,
              isFinal: true,
            };
            newItems.push(subItem);
            cursorStart = subItem.endTime + 0.01;
          });
          this.timeline.splice(sameIdIndex, 1, ...newItems);
          syncedTimelineCue = newItems[0];
        } else {
          target.text = cue.text;
          target.startTime = estimatedStart;
          target.endTime = Math.max(estimatedStart + 0.2, estimatedEnd);
          target.receivedAt = cue.receivedAt;
          target.isFinal = cue.isFinal;
          syncedTimelineCue = target;
        }
      } else {
        // 2b. Auto-Heal disabled by default (pretend it doesn't exist while cementing handles timeline integrity)
        const healIndex = -1;

        if (healIndex !== -1) {
          const existing = this.timeline[healIndex];
          replacedCueId = existing.id !== cue.id ? existing.id : undefined;
          if (cleanText.length >= existing.text.trim().length || cue.isFinal) {
            existing.text = cue.text;
          }
          existing.startTime = Math.min(existing.startTime, estimatedStart);
          existing.endTime = Math.max(existing.endTime, estimatedEnd);
          existing.id = cue.id;
          existing.receivedAt = cue.receivedAt;
          existing.isFinal = cue.isFinal ?? existing.isFinal;
          syncedTimelineCue = existing;
        } else {
          // Trim slight padding overlap with the immediately preceding cue so SRT cues never overlap
          if (this.timeline.length > 0) {
            const prev = this.timeline[this.timeline.length - 1];
            if (
              prev.startTime < estimatedStart &&
              prev.endTime > estimatedStart &&
              prev.endTime - estimatedStart < 0.4
            ) {
              prev.endTime = Math.max(prev.startTime + 0.15, estimatedStart - 0.02);
            }
          }

          const sentenceParts =
            (this.settings.splitMultiSentenceCues ?? true) && (cue.isFinal ?? true)
              ? this.splitIntoSentenceParts(cue.text)
              : [cue.text.trim()];

          if (sentenceParts.length > 1) {
            const totalChars = Math.max(
              1,
              sentenceParts.reduce((acc, s) => acc + s.length, 0)
            );
            const totalSpan = Math.max(0.4, estimatedEnd - estimatedStart);
            let cursorStart = estimatedStart;

            sentenceParts.forEach((part, idx) => {
              const weight = part.length / totalChars;
              const partSpan =
                idx === sentenceParts.length - 1
                  ? Math.max(0.2, estimatedEnd - cursorStart)
                  : Math.max(0.25, totalSpan * weight);
              const partEnd = Math.min(estimatedEnd, cursorStart + partSpan);
              const subItem: TimelineCue = {
                id: idx === 0 ? cue.id : `${cue.id}-s${idx}`,
                text: part,
                startTime: cursorStart,
                endTime: Math.max(cursorStart + 0.2, partEnd),
                receivedAt: cue.receivedAt + idx,
                isFinal: true,
              };
              this.timeline.push(subItem);
              cursorStart = subItem.endTime + 0.01;
            });
            syncedTimelineCue = this.timeline[this.timeline.length - 1];
          } else {
            this.timeline.push(syncedTimelineCue);
          }

          if (this.timeline.length > 2000) {
            this.timeline.splice(0, this.timeline.length - 2000);
          }
          this.timeline.sort((a, b) => a.startTime - b.startTime);
        }
      }
    }

    // 3. Sync exact video timestamps back to background history so SRT export uses real video time
    if (nowVideo > 0.08 || this.maxWatchedTime > 0.5) {
      this.safeSendMessage({
        type: 'SYNC_VIDEO_CUE_TIMING',
        cueId: syncedTimelineCue.id,
        replacedCueId,
        text: syncedTimelineCue.text,
        videoStartTime: syncedTimelineCue.startTime,
        videoEndTime: syncedTimelineCue.endTime,
        videoTitle: document.title || undefined,
        isFinal: cue.isFinal,
      });
    }

    // In-progress streaming update:
    // Only overwrite the last active cue in-place if it shares the same utterance ID,
    // or if the previous cue was still an unfinalized partial being extended.
    const lastCue = this.activeCues[this.activeCues.length - 1];
    const isContinuation =
      lastCue &&
      (lastCue.id === cue.id ||
        (!lastCue.isFinal &&
          (cleanText.startsWith(lastCue.text.trim()) ||
            lastCue.text.trim().startsWith(cleanText))));

    if (isContinuation && lastCue) {
      lastCue.text = cue.text;
      lastCue.receivedAt = cue.receivedAt;
      lastCue.id = cue.id;
      lastCue.durationMs = cue.durationMs;
      lastCue.isFinal = cue.isFinal;
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

  private getSafeSeekTime(rawSeekTime: number): number {
    // Never seek to exact 0.000 on MSE/DASH streams (first frame PTS is often 0.033-0.083s)
    let safeTime = Math.max(0.08, rawSeekTime);
    try {
      const buffered = this.video.buffered;
      if (buffered && buffered.length > 0) {
        for (let i = 0; i < buffered.length; i++) {
          const bStart = buffered.start(i);
          const bEnd = buffered.end(i);
          // If safeTime is inside this buffered range, it's 100% safe
          if (safeTime >= bStart && safeTime <= bEnd) {
            return safeTime;
          }
          // If safeTime landed in a tiny micro-gap just before a buffered range (< 0.45s),
          // nudge it into the buffered range so the MSE decoder doesn't stall!
          if (safeTime < bStart && bStart - safeTime < 0.45) {
            return bStart + 0.02;
          }
        }
      }
    } catch {}
    return safeTime;
  }

  private performSafeVideoSeek(rawSeekTime: number) {
    const safeSeekTime = this.getSafeSeekTime(rawSeekTime);
    this.isReplaySeeking = true;
    if (this.replaySeekResetTimer) {
      clearTimeout(this.replaySeekResetTimer);
    }

    const executeSeek = () => {
      this.pendingSeekTimer = null;
      this.lastVideoSeekAt = Date.now();
      try {
        this.video.currentTime = safeSeekTime;
      } catch {}

      if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
        // Wait briefly if the video is mid-seek so play() isn't aborted by MSE seeking
        if (this.video.seeking) {
          const onSeeked = () => {
            this.video.removeEventListener('seeked', onSeeked);
            if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
              this.video.play().catch(() => {});
            }
          };
          this.video.addEventListener('seeked', onSeeked, { once: true });
        } else {
          this.video.play().catch(() => {});
        }
      }

      this.replaySeekResetTimer = setTimeout(() => {
        this.isReplaySeeking = false;
        this.updateToolbarVisibility();
      }, 260);
    };

    // If the user is rapidly tapping Left/Right arrow (< 110ms between taps),
    // coalesce the actual MSE video.currentTime assignment so Shaka/Vilos never stalls!
    const sinceLastSeek = Date.now() - this.lastVideoSeekAt;
    if (this.pendingSeekTimer) {
      clearTimeout(this.pendingSeekTimer);
    }
    if (sinceLastSeek < 110) {
      this.pendingSeekTimer = setTimeout(executeSeek, 85);
    } else {
      executeSeek();
    }
  }

  hasPreviousSubtitle(): boolean {
    if (!this.settings.subNavigationEnabled || !this.settings.enableSubtitleCache) return false;
    if (this.timeline.length === 0) return false;
    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;
    const first = this.timeline[0];
    return vPos > first.startTime - padSec + 0.45;
  }

  hasNextSubtitle(): boolean {
    if (!this.settings.subNavigationEnabled || !this.settings.enableSubtitleCache) return false;
    if (this.timeline.length === 0) return false;
    const vPos = this.video.currentTime;
    const last = this.timeline[this.timeline.length - 1];
    if (this.activeReplayCue && this.activeReplayCue.id !== last.id) {
      return true;
    }
    return last.startTime > vPos + 0.25;
  }

  seekToPreviousSubtitle(): boolean {
    if (!this.settings.subNavigationEnabled) return false;

    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;

    // IF CACHING IS DISABLED or timeline is empty:
    if (!this.settings.enableSubtitleCache || this.timeline.length === 0) {
      const lastActive = this.activeCues[this.activeCues.length - 1];
      if (lastActive) {
        const textDur = Math.max(2.2, lastActive.text.trim().length / 13.0);
        const seekTime = Math.max(0.08, vPos - textDur - padSec);
        this.performSafeVideoSeek(seekTime);
        return true;
      }
      return false;
    }

    let targetCue: TimelineCue | null = null;
    let targetIndex = -1;
    const nowWall = Date.now();

    // If the user presses Left Arrow repeatedly within 1.4s, step backward sentence-by-sentence
    if (this.lastSeekTargetId && nowWall - this.lastSeekWallTime < 1400) {
      const prevIdx = this.timeline.findIndex((c) => c.id === this.lastSeekTargetId);
      if (prevIdx > 0) {
        const candidate = this.timeline[prevIdx - 1];
        const current = this.timeline[prevIdx];
        // Never jump across an unrecorded gap > 30s to an orphan cue
        if (current.startTime - candidate.endTime <= 30.0) {
          targetCue = candidate;
          targetIndex = prevIdx - 1;
        } else {
          return false;
        }
      } else if (prevIdx === 0) {
        // Already at the earliest recorded subtitle — don't trap the player in a seek loop!
        return false;
      }
    }

    // Otherwise scan backwards from latest to earliest in timeline
    if (!targetCue) {
      for (let i = this.timeline.length - 1; i >= 0; i--) {
        const c = this.timeline[i];
        // Is vPos inside this cue or just finished (up to 3.0s after endTime)?
        if (vPos >= c.startTime - padSec - 0.25 && vPos <= c.endTime + padSec + 3.0) {
          const targetSeekPos = Math.max(0.08, c.startTime - padSec);
          // Did we already jump to the start of this cue? (or within 0.55s of it)
          if (Math.abs(vPos - targetSeekPos) < 0.55 || (vPos < targetSeekPos + 0.45 && vPos >= targetSeekPos - 0.25)) {
            if (i > 0) {
              const prevCandidate = this.timeline[i - 1];
              if (c.startTime - prevCandidate.endTime <= 30.0) {
                targetCue = prevCandidate;
                targetIndex = i - 1;
              }
              break;
            } else {
              // Already at the start of timeline[0] — do not re-seek to timeline[0] in a loop!
              return false;
            }
          }
          // Replay this sentence from its start!
          targetCue = c;
          targetIndex = i;
          break;
        } else if (c.endTime < vPos) {
          // Cue ended prior to vPos. If within 12s of quiet / silence, seek back to it!
          if (targetCue === null && (vPos - c.endTime) <= 12.0) {
            targetCue = c;
            targetIndex = i;
            break;
          }
        }
      }
    }

    if (!targetCue || targetIndex === -1) {
      return false;
    }

    this.lastSeekTargetId = targetCue.id;
    this.lastSeekWallTime = nowWall;
    this.activeReplayCue = targetCue;

    // Instantly display the replayed subtitle so the user can read it on replay
    this.displayReplayCue(targetCue);
    this.performSafeVideoSeek(targetCue.startTime - padSec);

    return true;
  }

  seekToNextSubtitle(): boolean {
    if (
      !this.settings.subNavigationEnabled ||
      !(this.settings.subForwardNavigationEnabled ?? true) ||
      !this.settings.enableSubtitleCache
    ) {
      return false;
    }
    if (this.timeline.length === 0) return false;

    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;
    const nowWall = Date.now();

    let targetCue: TimelineCue | null = null;

    // 1. If stepping from a recently selected cue (or activeReplayCue), advance to the next index
    const anchorId =
      this.lastSeekTargetId && nowWall - this.lastSeekWallTime < 1800
        ? this.lastSeekTargetId
        : this.activeReplayCue?.id || null;

    if (anchorId) {
      const idx = this.timeline.findIndex((c) => c.id === anchorId);
      if (idx !== -1 && idx + 1 < this.timeline.length) {
        const nextCandidate = this.timeline[idx + 1];
        if (nextCandidate.startTime - this.timeline[idx].endTime <= 30.0) {
          targetCue = nextCandidate;
        }
      }
    }

    // 2. Otherwise scan forward for the next subtitle starting ahead of vPos
    if (!targetCue) {
      for (let i = 0; i < this.timeline.length; i++) {
        const c = this.timeline[i];
        if (c.startTime > vPos + 0.2 && c.startTime - vPos <= 30.0) {
          targetCue = c;
          break;
        }
      }
    }

    if (!targetCue) {
      return false;
    }

    this.lastSeekTargetId = targetCue.id;
    this.lastSeekWallTime = nowWall;
    this.activeReplayCue = targetCue;

    this.displayReplayCue(targetCue);
    this.performSafeVideoSeek(targetCue.startTime - padSec);

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
    this.maxWatchedTime = Math.max(this.maxWatchedTime, vPos);
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;
    // Lead-in so cemented subtitles appear right as the line is about to be said (~180ms early)
    const leadInSec = Math.max(0.18, padSec);

    // If a live streaming subtitle arrived within the last 1.8s and we aren't actively replaying a past cue,
    // never let timeline replay overwrite the live streaming subtitle!
    if (!this.activeReplayCue && Date.now() - this.lastLiveCueAt < 1800) {
      this.updateToolbarVisibility();
      return;
    }

    // Scan from newest to oldest so if the next sentence's lead-in has started, we immediately
    // transition to the new sentence instead of lingering on the previous sentence!
    if (!this.isHovered && (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)) {
      let matchedCue: TimelineCue | null = null;
      for (let i = this.timeline.length - 1; i >= 0; i--) {
        const cue = this.timeline[i];
        if (vPos >= cue.startTime - leadInSec && vPos <= cue.endTime + 0.05) {
          matchedCue = cue;
          break;
        }
      }

      if (matchedCue) {
        const lastActive = this.activeCues[this.activeCues.length - 1];
        if (!lastActive || lastActive.id !== matchedCue.id || lastActive.text.trim() !== matchedCue.text.trim()) {
          this.displayReplayCue(matchedCue);
        }
        this.activeReplayCue = matchedCue;
        this.updateToolbarVisibility();
        return;
      }
    }

    // If no timeline cue matches vPos anymore and we were showing a replay cue that has now ended:
    if (this.activeReplayCue) {
      if (vPos > this.activeReplayCue.endTime + 0.05 || vPos < this.activeReplayCue.startTime - leadInSec - 1.5) {
        this.activeReplayCue = null;
        this.updateToolbarVisibility();
        this.scheduleFadeOut(400);
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
