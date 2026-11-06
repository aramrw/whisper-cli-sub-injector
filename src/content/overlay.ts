import { ExtensionSettings, SubtitleCue } from '../common/types';
import {
  createOverlayToolbar,
  OverlayToolbarElements,
  updateToolbarState,
} from './overlay/toolbar';
import { applyOverlayStyles, ensureSelectionStyle } from './overlay/styles';
import { renderSubtitleStack } from './overlay/stack-renderer';
import { updateOverlayPosition } from './overlay/position';
import {
  estimateCueTiming,
  findNextSubtitleCue,
  findPreviousSubtitleCue,
  getSafeSeekTime,
  splitIntoSentenceParts,
} from './overlay/timeline-manager';
import { RerecordWindow, TimelineCue, UtteranceAnchor } from './overlay/types';

export { TimelineCue, UtteranceAnchor, RerecordWindow };

export class VideoOverlay {
  readonly video: HTMLMediaElement;
  private container: HTMLDivElement;
  private stackContainer: HTMLDivElement;
  private toolbar: OverlayToolbarElements;
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

    // Create outer container
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

    // Create floating action toolbar
    this.toolbar = createOverlayToolbar(
      () => this.seekToPreviousSubtitle(),
      () => this.rerecordCurrentSubtitle(),
      () => this.seekToNextSubtitle()
    );
    this.container.appendChild(this.toolbar.toolbarContainer);

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
    updateToolbarState(
      this.toolbar,
      this.video,
      this.settings,
      this.activeCues.length > 0,
      this.rerecordWindow,
      () => this.hasPreviousSubtitle(),
      () => this.hasNextSubtitle()
    );
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
    } catch {}
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
      if (this.activeCues.length > 0 && this.container) {
        this.container.style.setProperty('opacity', '1', 'important');
      }
    }
  }

  private onVideoPlay() {
    this.pausedAt = 0;
    this.updateToolbarVisibility();
    if (this.settings.pauseSubtitlesWithVideo && this.activeCues.length > 0) {
      const remaining =
        this.fadeRemainingMs > 0 ? this.fadeRemainingMs : this.settings.autoFadeTimeoutMs;
      this.scheduleFadeOut(remaining);
    }
  }

  private setupListeners() {
    const onFullscreen = () => {
      this.attach();
      setTimeout(() => this.updatePosition(), 60);
      setTimeout(() => this.updatePosition(), 250);
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.updatePosition();
      });
      this.resizeObserver.observe(this.video);
    }

    const onWindowChange = () => {
      this.updatePosition();
    };
    window.addEventListener('resize', onWindowChange, { passive: true });
    window.addEventListener('scroll', onWindowChange, { passive: true });

    this.video.addEventListener('play', onWindowChange);
    this.video.addEventListener('loadedmetadata', onWindowChange);

    const onPause = () => this.onVideoPause();
    const onPlay = () => this.onVideoPlay();
    const onTimeUpdate = () => this.onTimeUpdate();
    this.video.addEventListener('pause', onPause);
    this.video.addEventListener('ended', onPause);
    this.video.addEventListener('play', onPlay);
    this.video.addEventListener('playing', onPlay);
    this.video.addEventListener('timeupdate', onTimeUpdate);

    const onMouseEnter = () => {
      this.isHovered = true;
      this.updateToolbarVisibility();
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      if (this.activeCues.length > 0) {
        this.container.style.setProperty('opacity', '1', 'important');
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

    const stopProp = (e: Event) => {
      e.stopPropagation();
    };
    const selectionEvents = [
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'click',
      'dblclick',
      'contextmenu',
      'selectstart',
    ];
    for (const evt of selectionEvents) {
      this.stackContainer.addEventListener(evt, stopProp);
    }

    (this.container as any)._cleanup = () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange);
      this.video.removeEventListener('play', onWindowChange);
      this.video.removeEventListener('loadedmetadata', onWindowChange);
      this.video.removeEventListener('pause', onPause);
      this.video.removeEventListener('ended', onPause);
      this.video.removeEventListener('play', onPlay);
      this.video.removeEventListener('playing', onPlay);
      this.video.removeEventListener('timeupdate', onTimeUpdate);
      this.container.removeEventListener('mouseenter', onMouseEnter);
      this.container.removeEventListener('mouseleave', onMouseLeave);
      for (const evt of selectionEvents) {
        this.stackContainer.removeEventListener(evt, stopProp);
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
    };
  }

  hasSelectedText(): boolean {
    try {
      if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
        return false;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
      return (
        this.container.contains(sel.anchorNode) ||
        this.container.contains(sel.focusNode)
      );
    } catch {
      return false;
    }
  }

  applySettings(settings: ExtensionSettings) {
    this.settings = settings;
    applyOverlayStyles(this.container, this.stackContainer, settings);
    this.renderStack();
    this.updatePosition();
  }

  renderStack() {
    renderSubtitleStack(this.stackContainer, this.activeCues, this.settings);
    this.updateToolbarVisibility();
    this.updatePosition();
  }

  updatePosition() {
    if (!this.container || !this.video) return;
    if (!this.container.isConnected) {
      this.attach();
    }
    updateOverlayPosition(this.container, this.video, this.settings);
  }

  clearTimelineCache() {
    this.timeline = [];
    this.utteranceAnchors.clear();
    this.activeReplayCue = null;
    this.maxWatchedTime = 0;
    this.rerecordWindow = null;
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
      this.updateToolbarVisibility();
      return;
    }
    this.onTimeUpdate();
  }

  rerecordCurrentSubtitle(): boolean {
    if (!this.settings.enabled) return false;
    const vPos = this.video.currentTime;
    const padSec = (this.settings.subNavigationPaddingMs || 150) / 1000;

    let targetCue: TimelineCue | null = this.activeReplayCue;
    if (!targetCue && this.timeline.length > 0) {
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

  private shouldDropPausedAudio(cue: SubtitleCue): boolean {
    if (!this.video.paused) return false;
    const pausedDurationMs = this.pausedAt > 0 ? Date.now() - this.pausedAt : 999999;
    const startedWhilePlaying = this.utteranceAnchors.has(cue.id) && pausedDurationMs <= 2500;
    const finalizationGraceMs = (cue.lagMs ?? 350) + 450;

    if (this.settings.ignoreSubtitlesWhenPaused ?? true) {
      if (!startedWhilePlaying && pausedDurationMs > finalizationGraceMs) {
        this.safeSendMessage({
          type: 'DROP_PAUSED_HISTORY_CUE',
          cueId: cue.id,
        });
        return true;
      }
    } else if (this.settings.pauseSubtitlesWithVideo && pausedDurationMs > 4000) {
      return true;
    }
    return false;
  }

  private findTimelineIndexFromEnd(id: string): number {
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      if (this.timeline[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  private isCementedDuplicate(
    cue: SubtitleCue,
    estimatedStart: number,
    estimatedEnd: number,
    inRerecordWindow: boolean
  ): boolean {
    if (
      !this.settings.enableSubtitleCache ||
      !(this.settings.cementSubtitlesInTimeline ?? true) ||
      inRerecordWindow
    ) {
      return false;
    }

    if (this.findTimelineIndexFromEnd(cue.id) !== -1) return false;

    const cementedMatch = this.timeline.find((c) => {
      if (!c.isFinal) return false;
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
      const nowVideo = this.video.currentTime;
      if (nowVideo >= cementedMatch.startTime - 0.25 && nowVideo <= cementedMatch.endTime + 0.25) {
        this.displayReplayCue(cementedMatch);
        this.activeReplayCue = cementedMatch;
      }
      return true;
    }
    return false;
  }

  private addOrUpdateTimeline(
    cue: SubtitleCue,
    estimatedStart: number,
    estimatedEnd: number
  ): { syncedCue: TimelineCue; replacedCueId?: string } {
    let syncedTimelineCue: TimelineCue = {
      id: cue.id,
      text: cue.text,
      startTime: estimatedStart,
      endTime: estimatedEnd,
      receivedAt: cue.receivedAt,
      isFinal: cue.isFinal,
    };
    let replacedCueId: string | undefined;

    const sameIdIndex = this.findTimelineIndexFromEnd(cue.id);

    if (sameIdIndex !== -1) {
      const target = this.timeline[sameIdIndex];
      const sentenceParts =
        (this.settings.splitMultiSentenceCues ?? true) && (cue.isFinal ?? true)
          ? splitIntoSentenceParts(cue.text)
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
      const prevStartTime =
        this.timeline.length > 0 ? this.timeline[this.timeline.length - 1].startTime : -1;
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
          ? splitIntoSentenceParts(cue.text)
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
      if (estimatedStart < prevStartTime) {
        this.timeline.sort((a, b) => a.startTime - b.startTime);
      }
    }

    return { syncedCue: syncedTimelineCue, replacedCueId };
  }

  showCue(cue: SubtitleCue) {
    if (!this.settings.enabled) return;
    const cleanText = cue.text.trim();
    if (!cleanText) return;

    if (this.shouldDropPausedAudio(cue)) return;

    const nowVideo = this.video.currentTime;
    this.maxWatchedTime = Math.max(this.maxWatchedTime, nowVideo);

    const { estimatedStart, estimatedEnd } = estimateCueTiming(
      cue,
      this.video,
      this.settings,
      this.pausedAt,
      this.utteranceAnchors
    );

    // If new episode started:
    if (nowVideo < 2.0 && this.timeline.length > 0 && this.timeline[this.timeline.length - 1].startTime > 30) {
      this.timeline = [];
      this.utteranceAnchors.clear();
      this.maxWatchedTime = nowVideo;
      this.rerecordWindow = null;
    }

    if (this.rerecordWindow && Date.now() >= this.rerecordWindow.expiresAt) {
      this.rerecordWindow = null;
    }
    const inRerecordWindow = Boolean(
      this.rerecordWindow &&
        estimatedEnd >= this.rerecordWindow.startTime &&
        estimatedStart <= this.rerecordWindow.endTime
    );
    if (inRerecordWindow && cue.isFinal) {
      this.rerecordWindow = null;
    }

    if (this.isCementedDuplicate(cue, estimatedStart, estimatedEnd, inRerecordWindow)) {
      return;
    }

    if (nowVideo > 15.0 && this.timeline.length > 0 && this.timeline[0].endTime < 2.5) {
      this.timeline = this.timeline.filter((c) => c.endTime >= 2.5);
    }

    this.activeReplayCue = null;
    this.lastLiveCueAt = Date.now();

    // Paint the subtitle to the DOM first before timeline/history sync
    this.updateActiveCues(cue, cleanText);

    const hasValidVideoClock = nowVideo > 0.08 || this.maxWatchedTime > 0.5;
    let syncedTimelineCue: TimelineCue = {
      id: cue.id,
      text: cue.text,
      startTime: estimatedStart,
      endTime: estimatedEnd,
      receivedAt: cue.receivedAt,
      isFinal: cue.isFinal,
    };
    let replacedCueId: string | undefined;

    if (this.settings.enableSubtitleCache && hasValidVideoClock) {
      const res = this.addOrUpdateTimeline(cue, estimatedStart, estimatedEnd);
      syncedTimelineCue = res.syncedCue;
      replacedCueId = res.replacedCueId;
    }

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
  }

  private updateActiveCues(cue: SubtitleCue, cleanText: string) {
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
      renderSubtitleStack(this.stackContainer, this.activeCues, this.settings);
      if (this.container.style.opacity !== '1') {
        this.container.style.setProperty('opacity', '1', 'important');
      }
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
    this.container.style.setProperty('opacity', '1', 'important');

    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    if (!this.isHovered) {
      if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
        this.fadeRemainingMs = this.settings.autoFadeTimeoutMs || 6000;
      } else {
        this.scheduleFadeOut();
      }
    }
  }

  private performSafeVideoSeek(rawSeekTime: number) {
    const safeSeekTime = getSafeSeekTime(this.video, rawSeekTime);
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

    const { targetCue, targetIndex } = findPreviousSubtitleCue(
      this.timeline,
      vPos,
      padSec,
      this.lastSeekTargetId,
      this.lastSeekWallTime
    );

    if (!targetCue || targetIndex === -1) {
      return false;
    }

    this.lastSeekTargetId = targetCue.id;
    this.lastSeekWallTime = Date.now();
    this.activeReplayCue = targetCue;

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

    const targetCue = findNextSubtitleCue(
      this.timeline,
      vPos,
      this.lastSeekTargetId,
      this.lastSeekWallTime,
      this.activeReplayCue
    );

    if (!targetCue) {
      return false;
    }

    this.lastSeekTargetId = targetCue.id;
    this.lastSeekWallTime = Date.now();
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
    const leadInSec = Math.max(0.18, padSec);

    if (!this.activeReplayCue && Date.now() - this.lastLiveCueAt < 1800) {
      this.updateToolbarVisibility();
      return;
    }

    if (
      !this.isHovered &&
      !this.hasSelectedText() &&
      (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)
    ) {
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

    if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
      return;
    }

    const duration = customMs || this.settings.autoFadeTimeoutMs || 6000;
    this.fadeTargetTime = Date.now() + duration;
    this.fadeRemainingMs = duration;

    this.fadeTimer = setTimeout(() => {
      if (
        !this.isHovered &&
        !this.hasSelectedText() &&
        (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)
      ) {
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
