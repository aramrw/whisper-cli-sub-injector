"use strict";
(() => {
  // src/common/types.ts
  var DEFAULT_SETTINGS = {
    serverUrl: "http://127.0.0.1:8989",
    enabled: true,
    fontSize: 28,
    bottomOffset: 60,
    topOffset: 40,
    alignment: "bottom",
    showBackgroundBox: true,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    autoFadeTimeoutMs: 6e3,
    maxLines: 3,
    stackMode: true,
    pauseSubtitlesWithVideo: true,
    ignoreSubtitlesWhenPaused: true,
    subNavigationEnabled: true,
    subForwardNavigationEnabled: true,
    subNavigationPlayOnSeek: true,
    subNavigationPaddingMs: 150,
    enableSubtitleCache: true,
    exactByteTiming: true,
    splitMultiSentenceCues: true,
    autoHealTimelineOverlaps: false,
    cementSubtitlesInTimeline: true,
    showRerecordButton: true,
    showPrevButton: true,
    showNextButton: true,
    srtStartPaddingMs: 50,
    srtEndPaddingMs: 100,
    autoEmbed: true,
    urlFilterMode: "all",
    urlFilterList: ["crunchyroll.com", "youtube.com", "netflix.com"]
  };
  function isUrlAllowed(url, mode = "all", filterList = []) {
    if (mode === "all") return true;
    if (!url) return false;
    let hostname = "";
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname.toLowerCase();
    } catch {
      hostname = url.toLowerCase();
    }
    const normalizedUrl = url.toLowerCase();
    const matchesAny = filterList.some((rawPattern) => {
      const pattern = rawPattern.trim().toLowerCase();
      if (!pattern) return false;
      if (hostname === pattern || hostname.endsWith("." + pattern)) {
        return true;
      }
      if (normalizedUrl.includes(pattern)) {
        return true;
      }
      if (pattern.includes("*")) {
        const regexStr = "^" + pattern.split("*").map((s) => s.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&")).join(".*") + "$";
        try {
          const regex = new RegExp(regexStr, "i");
          return regex.test(hostname) || regex.test(normalizedUrl);
        } catch {
          return false;
        }
      }
      return false;
    });
    if (mode === "whitelist") {
      return matchesAny;
    } else if (mode === "blacklist") {
      return !matchesAny;
    }
    return true;
  }

  // src/content/overlay/toolbar.ts
  function createOverlayToolbar(onPrev, onRerecord, onNext) {
    const toolbarContainer = document.createElement("div");
    toolbarContainer.className = "whisper-cli-sub-toolbar";
    toolbarContainer.style.setProperty("display", "none", "important");
    toolbarContainer.style.setProperty("justify-content", "center", "important");
    toolbarContainer.style.setProperty("align-items", "center", "important");
    toolbarContainer.style.setProperty("gap", "6px", "important");
    toolbarContainer.style.setProperty("pointer-events", "none", "important");
    const prevBtn = createToolbarButton("\u23EE Prev", "Previous subtitle (Left Arrow)", onPrev);
    const rerecordBtn = createToolbarButton(
      "\u{1F504} Re-record Line",
      "Uncement & re-record this subtitle line from its start (Alt+R)",
      onRerecord
    );
    const nextBtn = createToolbarButton("Next \u23ED", "Next subtitle (Right Arrow)", onNext);
    toolbarContainer.appendChild(prevBtn);
    toolbarContainer.appendChild(rerecordBtn);
    toolbarContainer.appendChild(nextBtn);
    return { toolbarContainer, prevBtn, rerecordBtn, nextBtn };
  }
  function createToolbarButton(label, title, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "whisper-cli-sub-rerecord-btn";
    btn.title = title;
    btn.textContent = label;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }
  function updateToolbarState(elements, video, settings2, hasActiveCues, rerecordWindow, hasPrevSubtitle, hasNextSubtitle) {
    const { toolbarContainer, prevBtn, rerecordBtn, nextBtn } = elements;
    if (!toolbarContainer || !rerecordBtn || !prevBtn || !nextBtn) return;
    const isRerecording = Boolean(rerecordWindow && Date.now() < rerecordWindow.expiresAt);
    if (isRerecording) {
      prevBtn.style.setProperty("display", "none", "important");
      nextBtn.style.setProperty("display", "none", "important");
      rerecordBtn.style.setProperty("display", "inline-flex", "important");
      rerecordBtn.textContent = "\u{1F399}\uFE0F Re-recording line...";
      toolbarContainer.style.setProperty("display", "flex", "important");
      return;
    }
    rerecordBtn.textContent = "\u{1F504} Re-record Line";
    if (!video.paused || !hasActiveCues) {
      toolbarContainer.style.setProperty("display", "none", "important");
      return;
    }
    const showPrev = (settings2.showPrevButton ?? true) && hasPrevSubtitle();
    const showRerecord = settings2.showRerecordButton ?? true;
    const showNext = (settings2.showNextButton ?? true) && hasNextSubtitle();
    prevBtn.style.setProperty("display", showPrev ? "inline-flex" : "none", "important");
    rerecordBtn.style.setProperty("display", showRerecord ? "inline-flex" : "none", "important");
    nextBtn.style.setProperty("display", showNext ? "inline-flex" : "none", "important");
    const shouldShow = showPrev || showRerecord || showNext;
    toolbarContainer.style.setProperty("display", shouldShow ? "flex" : "none", "important");
  }

  // src/content/overlay/styles.ts
  var styleSheetInjected = false;
  function ensureSelectionStyle() {
    if (styleSheetInjected) return;
    const style = document.createElement("style");
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
  function applyOverlayStyles(container, stackContainer, settings2) {
    const fontFam = settings2.fontFamily || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    container.style.fontFamily = fontFam;
    const fSize = settings2.fontSize || 24;
    container.style.fontSize = `${fSize}px`;
    if (settings2.alignment === "left") {
      container.style.alignItems = "flex-start";
      stackContainer.style.alignItems = "flex-start";
    } else if (settings2.alignment === "right") {
      container.style.alignItems = "flex-end";
      stackContainer.style.alignItems = "flex-end";
    } else {
      container.style.alignItems = "center";
      stackContainer.style.alignItems = "center";
    }
  }

  // src/content/overlay/stack-renderer.ts
  function isNodeSelected(node) {
    try {
      if (typeof window === "undefined" || typeof window.getSelection !== "function") {
        return false;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
      return node.contains(sel.anchorNode) || node.contains(sel.focusNode);
    } catch {
      return false;
    }
  }
  function renderSubtitleStack(stackContainer, activeCues, settings2) {
    const total = activeCues.length;
    if (total === 0) {
      if (stackContainer.children.length > 0) {
        stackContainer.innerHTML = "";
      }
      return;
    }
    const settingsSig = `${settings2.fontSize}|${settings2.textColor}|${settings2.backgroundColor}|${settings2.outlineColor}|${settings2.showBackgroundBox}`;
    const existingById = /* @__PURE__ */ new Map();
    const currentChildren = Array.from(stackContainer.children);
    const targetIds = new Set(activeCues.map((c) => c.id));
    for (const child of currentChildren) {
      const id = child.dataset?.cueId;
      if (id && targetIds.has(id) && !existingById.has(id)) {
        existingById.set(id, child);
      } else if (stackContainer.removeChild) {
        stackContainer.removeChild(child);
      }
    }
    for (let i = 0; i < total; i++) {
      const cue = activeCues[i];
      const age = total - 1 - i;
      const ageStr = String(age);
      let item = existingById.get(cue.id);
      const isNewNode = !item;
      if (!item) {
        item = document.createElement("div");
        item.className = "whisper-cli-sub-item";
        item.dataset.cueId = cue.id;
        item.textContent = cue.text;
      } else {
        if (item.textContent !== cue.text && !isNodeSelected(item)) {
          item.textContent = cue.text;
        }
      }
      if (isNewNode || item.dataset.renderedAge !== ageStr || item.dataset.settingsSig !== settingsSig) {
        item.dataset.renderedAge = ageStr;
        item.dataset.settingsSig = settingsSig;
        let opacity = 1;
        let scale = 1;
        if (age === 1) {
          opacity = 0.68;
          scale = 0.85;
        } else if (age === 2) {
          opacity = 0.42;
          scale = 0.72;
        } else if (age >= 3) {
          opacity = 0.25;
          scale = 0.6;
        }
        const itemFontSize = Math.max(13, Math.round(settings2.fontSize * scale));
        item.style.setProperty("font-size", `${itemFontSize}px`, "important");
        item.style.setProperty("opacity", String(opacity), "important");
        item.style.setProperty("color", settings2.textColor, "important");
        item.style.setProperty(
          "font-family",
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          "important"
        );
        item.style.setProperty("font-weight", age === 0 ? "600" : "500", "important");
        item.style.setProperty("line-height", "1.35", "important");
        item.style.setProperty("text-align", "center", "important");
        item.style.setProperty("user-select", "text", "important");
        item.style.setProperty("-webkit-user-select", "text", "important");
        item.style.setProperty("pointer-events", "auto", "important");
        item.style.setProperty("cursor", "text", "important");
        item.style.setProperty("transition", "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)", "important");
        item.style.setProperty("display", "inline-block", "important");
        item.style.setProperty("word-break", "break-word", "important");
        if (settings2.showBackgroundBox) {
          item.style.setProperty("background", settings2.backgroundColor, "important");
          item.style.setProperty("padding", age === 0 ? "6px 14px" : "4px 10px", "important");
          item.style.setProperty("border-radius", "6px", "important");
          item.style.setProperty("box-shadow", "0 2px 8px rgba(0, 0, 0, 0.4)", "important");
          item.style.setProperty(
            "text-shadow",
            `0 1px 2px ${settings2.outlineColor}, 0 0 1px ${settings2.outlineColor}`,
            "important"
          );
        } else {
          item.style.setProperty("background", "transparent", "important");
          item.style.setProperty("padding", "0", "important");
          item.style.setProperty(
            "text-shadow",
            `-2px -2px 0 ${settings2.outlineColor}, 2px -2px 0 ${settings2.outlineColor}, -2px 2px 0 ${settings2.outlineColor}, 2px 2px 0 ${settings2.outlineColor}, 0 2px 6px rgba(0,0,0,0.85)`,
            "important"
          );
        }
      }
      if (isNewNode || stackContainer.children[i] !== item) {
        stackContainer.appendChild(item);
      }
    }
  }

  // src/content/overlay/position.ts
  function updateOverlayPosition(container, video, settings2) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      container.style.display = "none";
      return;
    }
    container.style.setProperty("display", "flex", "important");
    const fsElement = document.fullscreenElement;
    const isFs = Boolean(fsElement && (fsElement.contains(video) || fsElement === video));
    let centerX;
    let targetY;
    if (isFs) {
      const fsRect = fsElement.getBoundingClientRect();
      centerX = rect.left - fsRect.left + rect.width / 2;
      if (settings2.alignment === "top") {
        targetY = rect.top - fsRect.top + settings2.topOffset;
      } else {
        targetY = rect.top - fsRect.top + rect.height - settings2.bottomOffset;
      }
    } else {
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      centerX = rect.left + rect.width / 2 + scrollX;
      if (settings2.alignment === "top") {
        targetY = rect.top + settings2.topOffset + scrollY;
      } else {
        targetY = rect.top + rect.height - settings2.bottomOffset + scrollY;
      }
    }
    const maxWidth = Math.max(200, Math.min(rect.width * 0.9, window.innerWidth * 0.92));
    const isTop = settings2.alignment === "top";
    const transformVal = isTop ? "translateX(-50%)" : "translate(-50%, -100%)";
    container.style.setProperty("left", `${centerX}px`, "important");
    container.style.setProperty("top", `${targetY}px`, "important");
    container.style.setProperty("transform", transformVal, "important");
    container.style.setProperty("max-width", `${maxWidth}px`, "important");
  }

  // src/content/overlay/timeline-manager.ts
  function splitIntoSentenceParts(text) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const parts = trimmed.split(/(?<=[.!?。！？…]["”'’»)」』】]?)\s+|(?<=[。！？…])(?=[^\s。！？…])/u).map((s) => s.trim()).filter((s) => s.length >= 2);
    return parts.length > 1 ? parts : [trimmed];
  }
  function getSafeSeekTime(video, rawSeekTime) {
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
    } catch {
    }
    return safeTime;
  }
  function estimateCueTiming(cue, video, settings2, pausedAt, utteranceAnchors) {
    const cleanText = cue.text.trim();
    const nowVideo = video.currentTime;
    const playbackRate = video.playbackRate > 0 ? video.playbackRate : 1;
    const pausedDuringLagSec = video.paused && pausedAt > 0 ? Math.max(0, (Date.now() - pausedAt) / 1e3) : 0;
    const startPadSec = Math.max(0, (settings2.srtStartPaddingMs ?? 50) / 1e3);
    const endPadSec = Math.max(0, (settings2.srtEndPaddingMs ?? 100) / 1e3);
    const hasExactCliTiming = (settings2.exactByteTiming ?? true) && (cue.durationMs !== void 0 || cue.clipStartMs !== void 0);
    if (hasExactCliTiming) {
      const rawLagSec = cue.lagMs !== void 0 && cue.lagMs >= 0 ? cue.lagMs / 1e3 : 0.05;
      const effectiveLagSec2 = Math.max(0, rawLagSec - pausedDuringLagSec);
      const clipDurSec = Math.max(
        0.12,
        (cue.durationMs && cue.durationMs > 0 ? cue.durationMs : 250) / 1e3 * playbackRate
      );
      const rawEnd = Math.max(0, nowVideo - effectiveLagSec2 * playbackRate);
      let rawStart = Math.max(0, rawEnd - clipDurSec);
      const existingAnchor = utteranceAnchors.get(cue.id);
      if (!existingAnchor) {
        utteranceAnchors.set(cue.id, {
          id: cue.id,
          rawVideoStart: rawStart,
          firstClipStartMs: cue.clipStartMs
        });
        if (utteranceAnchors.size > 48) {
          const oldestKey = utteranceAnchors.keys().next().value;
          if (oldestKey) utteranceAnchors.delete(oldestKey);
        }
      } else {
        if (cue.isFinal && Math.abs(rawStart - existingAnchor.rawVideoStart) < 4) {
          existingAnchor.rawVideoStart = rawStart;
        } else if (cue.clipStartMs !== void 0 && existingAnchor.firstClipStartMs !== void 0) {
          const deltaSec = (cue.clipStartMs - existingAnchor.firstClipStartMs) / 1e3 * playbackRate;
          if (Math.abs(deltaSec) < 2) {
            rawStart = Math.max(0, existingAnchor.rawVideoStart + deltaSec);
          } else {
            rawStart = Math.min(existingAnchor.rawVideoStart, rawStart);
          }
        } else {
          rawStart = Math.min(existingAnchor.rawVideoStart, rawStart);
        }
      }
      const estimatedStart2 = Math.max(0, rawStart - startPadSec);
      const estimatedEnd2 = Math.max(estimatedStart2 + 0.2, rawEnd + endPadSec);
      return { estimatedStart: estimatedStart2, estimatedEnd: estimatedEnd2 };
    }
    const textSec = Math.max(1.8, cleanText.length / 13);
    const chunkSec = cue.durationMs && cue.durationMs > 0 ? cue.durationMs / 1e3 : 0;
    const durSec = Math.max(chunkSec, textSec);
    const lagSec = cue.lagMs !== void 0 && cue.lagMs >= 0 ? cue.lagMs / 1e3 : 0.75;
    const effectiveLagSec = Math.max(0, lagSec - pausedDuringLagSec);
    const estimatedEnd = Math.max(0, nowVideo - effectiveLagSec * playbackRate + endPadSec);
    const estimatedStart = Math.max(0, estimatedEnd - durSec * playbackRate - startPadSec);
    return { estimatedStart, estimatedEnd };
  }
  function findPreviousSubtitleCue(timeline, vPos, padSec, lastSeekTargetId, lastSeekWallTime) {
    let targetCue = null;
    let targetIndex = -1;
    const nowWall = Date.now();
    if (lastSeekTargetId && nowWall - lastSeekWallTime < 1400) {
      const prevIdx = timeline.findIndex((c) => c.id === lastSeekTargetId);
      if (prevIdx > 0) {
        const candidate = timeline[prevIdx - 1];
        const current = timeline[prevIdx];
        if (current.startTime - candidate.endTime <= 30) {
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
        if (vPos >= c.startTime - padSec - 0.25 && vPos <= c.endTime + padSec + 3) {
          const targetSeekPos = Math.max(0.08, c.startTime - padSec);
          if (Math.abs(vPos - targetSeekPos) < 0.55 || vPos < targetSeekPos + 0.45 && vPos >= targetSeekPos - 0.25) {
            if (i > 0) {
              const prevCandidate = timeline[i - 1];
              if (c.startTime - prevCandidate.endTime <= 30) {
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
          if (targetCue === null && vPos - c.endTime <= 12) {
            targetCue = c;
            targetIndex = i;
            break;
          }
        }
      }
    }
    return { targetCue, targetIndex };
  }
  function findNextSubtitleCue(timeline, vPos, lastSeekTargetId, lastSeekWallTime, activeReplayCue) {
    const nowWall = Date.now();
    let targetCue = null;
    const anchorId = lastSeekTargetId && nowWall - lastSeekWallTime < 1800 ? lastSeekTargetId : activeReplayCue?.id || null;
    if (anchorId) {
      const idx = timeline.findIndex((c) => c.id === anchorId);
      if (idx !== -1 && idx + 1 < timeline.length) {
        const nextCandidate = timeline[idx + 1];
        if (nextCandidate.startTime - timeline[idx].endTime <= 30) {
          targetCue = nextCandidate;
        }
      }
    }
    if (!targetCue) {
      for (let i = 0; i < timeline.length; i++) {
        const c = timeline[i];
        if (c.startTime > vPos + 0.2 && c.startTime - vPos <= 30) {
          targetCue = c;
          break;
        }
      }
    }
    return targetCue;
  }

  // src/content/overlay.ts
  var VideoOverlay = class {
    video;
    container;
    stackContainer;
    toolbar;
    settings;
    fadeTimer = null;
    fadeTargetTime = 0;
    fadeRemainingMs = 0;
    pausedAt = 0;
    resizeObserver = null;
    isFullscreen = false;
    activeCues = [];
    isHovered = false;
    timeline = [];
    utteranceAnchors = /* @__PURE__ */ new Map();
    activeReplayCue = null;
    isReplaySeeking = false;
    replaySeekResetTimer = null;
    pendingSeekTimer = null;
    lastVideoSeekAt = 0;
    lastSeekTargetId = null;
    lastSeekWallTime = 0;
    lastLiveCueAt = 0;
    maxWatchedTime = 0;
    rerecordWindow = null;
    constructor(video, settings2) {
      this.video = video;
      this.settings = settings2;
      this.pausedAt = video.paused ? Date.now() : 0;
      ensureSelectionStyle();
      this.container = document.createElement("div");
      this.container.className = "whisper-cli-sub-overlay";
      this.container.setAttribute("aria-live", "polite");
      this.container.style.setProperty("pointer-events", "none", "important");
      this.container.style.setProperty("position", "absolute", "important");
      this.container.style.setProperty("z-index", "2147483647", "important");
      this.container.style.setProperty("transition", "opacity 0.25s ease", "important");
      this.container.style.setProperty("opacity", "0", "important");
      this.container.style.setProperty("display", "flex", "important");
      this.container.style.setProperty("flex-direction", "column", "important");
      this.container.style.setProperty("align-items", "center", "important");
      this.container.style.setProperty("gap", "6px", "important");
      this.toolbar = createOverlayToolbar(
        () => this.seekToPreviousSubtitle(),
        () => this.rerecordCurrentSubtitle(),
        () => this.seekToNextSubtitle()
      );
      this.container.appendChild(this.toolbar.toolbarContainer);
      this.stackContainer = document.createElement("div");
      this.stackContainer.className = "whisper-cli-sub-stack";
      this.stackContainer.style.setProperty("display", "flex", "important");
      this.stackContainer.style.setProperty("flex-direction", "column", "important");
      this.stackContainer.style.setProperty("align-items", "center", "important");
      this.stackContainer.style.setProperty("gap", "5px", "important");
      this.stackContainer.style.setProperty("width", "100%", "important");
      this.stackContainer.style.setProperty("pointer-events", "none", "important");
      this.container.appendChild(this.stackContainer);
      this.applySettings(settings2);
      this.attach();
      this.setupListeners();
    }
    updateToolbarVisibility() {
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
    safeSendMessage(message) {
      try {
        if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
          return;
        }
        const p = chrome.runtime.sendMessage(message);
        if (p && typeof p.catch === "function") {
          p.catch(() => {
          });
        }
      } catch {
      }
    }
    attach() {
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
    onVideoPause() {
      this.pausedAt = Date.now();
      this.updateToolbarVisibility();
      if (this.settings.pauseSubtitlesWithVideo) {
        if (this.fadeTimer) {
          this.fadeRemainingMs = Math.max(1e3, this.fadeTargetTime - Date.now());
          clearTimeout(this.fadeTimer);
          this.fadeTimer = null;
        } else if (this.activeCues.length > 0) {
          this.fadeRemainingMs = this.settings.autoFadeTimeoutMs;
        }
        if (this.activeCues.length > 0 && this.container) {
          this.container.style.setProperty("opacity", "1", "important");
        }
      }
    }
    onVideoPlay() {
      this.pausedAt = 0;
      this.updateToolbarVisibility();
      if (this.settings.pauseSubtitlesWithVideo && this.activeCues.length > 0) {
        const remaining = this.fadeRemainingMs > 0 ? this.fadeRemainingMs : this.settings.autoFadeTimeoutMs;
        this.scheduleFadeOut(remaining);
      }
    }
    setupListeners() {
      const onFullscreen = () => {
        this.attach();
        setTimeout(() => this.updatePosition(), 60);
        setTimeout(() => this.updatePosition(), 250);
      };
      document.addEventListener("fullscreenchange", onFullscreen);
      document.addEventListener("webkitfullscreenchange", onFullscreen);
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          this.updatePosition();
        });
        this.resizeObserver.observe(this.video);
      }
      const onWindowChange = () => {
        this.updatePosition();
      };
      window.addEventListener("resize", onWindowChange, { passive: true });
      window.addEventListener("scroll", onWindowChange, { passive: true });
      this.video.addEventListener("play", onWindowChange);
      this.video.addEventListener("loadedmetadata", onWindowChange);
      const onPause = () => this.onVideoPause();
      const onPlay = () => this.onVideoPlay();
      const onTimeUpdate = () => this.onTimeUpdate();
      this.video.addEventListener("pause", onPause);
      this.video.addEventListener("ended", onPause);
      this.video.addEventListener("play", onPlay);
      this.video.addEventListener("playing", onPlay);
      this.video.addEventListener("timeupdate", onTimeUpdate);
      const onMouseEnter = () => {
        this.isHovered = true;
        this.updateToolbarVisibility();
        if (this.fadeTimer) {
          clearTimeout(this.fadeTimer);
          this.fadeTimer = null;
        }
        if (this.activeCues.length > 0) {
          this.container.style.setProperty("opacity", "1", "important");
        }
      };
      const onMouseLeave = () => {
        this.isHovered = false;
        this.updateToolbarVisibility();
        if (!this.video.paused || !this.settings.pauseSubtitlesWithVideo) {
          this.scheduleFadeOut();
        }
      };
      this.container.addEventListener("mouseenter", onMouseEnter);
      this.container.addEventListener("mouseleave", onMouseLeave);
      const stopProp = (e) => {
        e.stopPropagation();
      };
      const selectionEvents = [
        "mousedown",
        "mouseup",
        "pointerdown",
        "pointerup",
        "click",
        "dblclick",
        "contextmenu",
        "selectstart"
      ];
      for (const evt of selectionEvents) {
        this.stackContainer.addEventListener(evt, stopProp);
      }
      this.container._cleanup = () => {
        document.removeEventListener("fullscreenchange", onFullscreen);
        document.removeEventListener("webkitfullscreenchange", onFullscreen);
        window.removeEventListener("resize", onWindowChange);
        window.removeEventListener("scroll", onWindowChange);
        this.video.removeEventListener("play", onWindowChange);
        this.video.removeEventListener("loadedmetadata", onWindowChange);
        this.video.removeEventListener("pause", onPause);
        this.video.removeEventListener("ended", onPause);
        this.video.removeEventListener("play", onPlay);
        this.video.removeEventListener("playing", onPlay);
        this.video.removeEventListener("timeupdate", onTimeUpdate);
        this.container.removeEventListener("mouseenter", onMouseEnter);
        this.container.removeEventListener("mouseleave", onMouseLeave);
        for (const evt of selectionEvents) {
          this.stackContainer.removeEventListener(evt, stopProp);
        }
        if (this.resizeObserver) {
          this.resizeObserver.disconnect();
        }
      };
    }
    hasSelectedText() {
      try {
        if (typeof window === "undefined" || typeof window.getSelection !== "function") {
          return false;
        }
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
        return this.container.contains(sel.anchorNode) || this.container.contains(sel.focusNode);
      } catch {
        return false;
      }
    }
    applySettings(settings2) {
      this.settings = settings2;
      applyOverlayStyles(this.container, this.stackContainer, settings2);
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
      console.log("[whisper-cli-sub-injector] Subtitle replay cache cleared.");
    }
    restoreIfIdle(cue) {
      if (!this.settings.enabled) return;
      const isVisible = this.container && this.container.style.opacity === "1";
      if (this.activeCues.length === 0 || !isVisible) {
        const isFresh = Date.now() - cue.receivedAt < 45e3;
        if (isFresh || this.video.paused) {
          this.showCue(cue);
        }
      }
    }
    refreshPausedSubtitle() {
      if (!this.settings.enabled) return;
      if (this.activeCues.length > 0 && this.container) {
        this.updatePosition();
        this.container.style.setProperty("opacity", "1", "important");
        this.updateToolbarVisibility();
        return;
      }
      this.onTimeUpdate();
    }
    rerecordCurrentSubtitle() {
      if (!this.settings.enabled) return false;
      const vPos = this.video.currentTime;
      const padSec = (this.settings.subNavigationPaddingMs || 150) / 1e3;
      let targetCue = this.activeReplayCue;
      if (!targetCue && this.timeline.length > 0) {
        for (let i = this.timeline.length - 1; i >= 0; i--) {
          const c = this.timeline[i];
          if (vPos >= c.startTime - padSec - 0.3 && vPos <= c.endTime + padSec + 4) {
            targetCue = c;
            break;
          }
        }
        if (!targetCue) {
          targetCue = this.timeline[this.timeline.length - 1];
        }
      }
      if (!targetCue) {
        const seekTime = Math.max(0.08, vPos - 3);
        this.rerecordWindow = {
          startTime: Math.max(0, seekTime - 0.5),
          endTime: vPos + 3,
          expiresAt: Date.now() + 12e3
        };
        this.activeCues = [];
        this.renderStack();
        this.performSafeVideoSeek(seekTime);
        return true;
      }
      const winStart = Math.max(0, targetCue.startTime - 0.15);
      const winEnd = targetCue.endTime + 0.15;
      const removedIds = [];
      this.timeline = this.timeline.filter((c) => {
        const overlaps = c.id === targetCue.id || c.startTime >= winStart - 0.1 && c.endTime <= winEnd + 0.1;
        if (overlaps) {
          removedIds.push(c.id);
          this.utteranceAnchors.delete(c.id);
          return false;
        }
        return true;
      });
      for (const id of removedIds) {
        this.safeSendMessage({
          type: "DROP_PAUSED_HISTORY_CUE",
          cueId: id,
          forceDelete: true
        });
      }
      this.rerecordWindow = {
        startTime: Math.max(0, targetCue.startTime - 0.5),
        endTime: targetCue.endTime + 2.5,
        expiresAt: Date.now() + 14e3
      };
      this.activeReplayCue = null;
      this.activeCues = [];
      this.renderStack();
      this.container.style.setProperty("opacity", "1", "important");
      this.updateToolbarVisibility();
      this.performSafeVideoSeek(targetCue.startTime - padSec);
      return true;
    }
    shouldDropPausedAudio(cue) {
      if (!this.video.paused) return false;
      const pausedDurationMs = this.pausedAt > 0 ? Date.now() - this.pausedAt : 999999;
      const startedWhilePlaying = this.utteranceAnchors.has(cue.id) && pausedDurationMs <= 2500;
      const finalizationGraceMs = (cue.lagMs ?? 350) + 450;
      if (this.settings.ignoreSubtitlesWhenPaused ?? true) {
        if (!startedWhilePlaying && pausedDurationMs > finalizationGraceMs) {
          this.safeSendMessage({
            type: "DROP_PAUSED_HISTORY_CUE",
            cueId: cue.id
          });
          return true;
        }
      } else if (this.settings.pauseSubtitlesWithVideo && pausedDurationMs > 4e3) {
        return true;
      }
      return false;
    }
    findTimelineIndexFromEnd(id) {
      for (let i = this.timeline.length - 1; i >= 0; i--) {
        if (this.timeline[i].id === id) {
          return i;
        }
      }
      return -1;
    }
    isCementedDuplicate(cue, estimatedStart, estimatedEnd, inRerecordWindow) {
      if (!this.settings.enableSubtitleCache || !(this.settings.cementSubtitlesInTimeline ?? true) || inRerecordWindow) {
        return false;
      }
      if (this.findTimelineIndexFromEnd(cue.id) !== -1) return false;
      const cementedMatch = this.timeline.find((c) => {
        if (!c.isFinal) return false;
        if (Math.abs(cue.receivedAt - c.receivedAt) < 3e3) return false;
        const overlap = Math.min(c.endTime, estimatedEnd) - Math.max(c.startTime, estimatedStart);
        const span = Math.max(0.2, estimatedEnd - estimatedStart);
        return overlap > 0.35 || overlap / span > 0.45;
      });
      if (cementedMatch) {
        this.safeSendMessage({
          type: "DROP_PAUSED_HISTORY_CUE",
          cueId: cue.id,
          forceDelete: true
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
    addOrUpdateTimeline(cue, estimatedStart, estimatedEnd) {
      let syncedTimelineCue = {
        id: cue.id,
        text: cue.text,
        startTime: estimatedStart,
        endTime: estimatedEnd,
        receivedAt: cue.receivedAt,
        isFinal: cue.isFinal
      };
      let replacedCueId;
      const sameIdIndex = this.findTimelineIndexFromEnd(cue.id);
      if (sameIdIndex !== -1) {
        const target = this.timeline[sameIdIndex];
        const sentenceParts = (this.settings.splitMultiSentenceCues ?? true) && (cue.isFinal ?? true) ? splitIntoSentenceParts(cue.text) : [cue.text.trim()];
        if (sentenceParts.length > 1) {
          const totalChars = Math.max(
            1,
            sentenceParts.reduce((acc, s) => acc + s.length, 0)
          );
          const totalSpan = Math.max(0.4, estimatedEnd - estimatedStart);
          let cursorStart = estimatedStart;
          const newItems = [];
          sentenceParts.forEach((part, idx) => {
            const weight = part.length / totalChars;
            const partSpan = idx === sentenceParts.length - 1 ? Math.max(0.2, estimatedEnd - cursorStart) : Math.max(0.25, totalSpan * weight);
            const partEnd = Math.min(estimatedEnd, cursorStart + partSpan);
            const subItem = {
              id: idx === 0 ? cue.id : `${cue.id}-s${idx}`,
              text: part,
              startTime: cursorStart,
              endTime: Math.max(cursorStart + 0.2, partEnd),
              receivedAt: cue.receivedAt + idx,
              isFinal: true
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
        const prevStartTime = this.timeline.length > 0 ? this.timeline[this.timeline.length - 1].startTime : -1;
        if (this.timeline.length > 0) {
          const prev = this.timeline[this.timeline.length - 1];
          if (prev.startTime < estimatedStart && prev.endTime > estimatedStart && prev.endTime - estimatedStart < 0.4) {
            prev.endTime = Math.max(prev.startTime + 0.15, estimatedStart - 0.02);
          }
        }
        const sentenceParts = (this.settings.splitMultiSentenceCues ?? true) && (cue.isFinal ?? true) ? splitIntoSentenceParts(cue.text) : [cue.text.trim()];
        if (sentenceParts.length > 1) {
          const totalChars = Math.max(
            1,
            sentenceParts.reduce((acc, s) => acc + s.length, 0)
          );
          const totalSpan = Math.max(0.4, estimatedEnd - estimatedStart);
          let cursorStart = estimatedStart;
          sentenceParts.forEach((part, idx) => {
            const weight = part.length / totalChars;
            const partSpan = idx === sentenceParts.length - 1 ? Math.max(0.2, estimatedEnd - cursorStart) : Math.max(0.25, totalSpan * weight);
            const partEnd = Math.min(estimatedEnd, cursorStart + partSpan);
            const subItem = {
              id: idx === 0 ? cue.id : `${cue.id}-s${idx}`,
              text: part,
              startTime: cursorStart,
              endTime: Math.max(cursorStart + 0.2, partEnd),
              receivedAt: cue.receivedAt + idx,
              isFinal: true
            };
            this.timeline.push(subItem);
            cursorStart = subItem.endTime + 0.01;
          });
          syncedTimelineCue = this.timeline[this.timeline.length - 1];
        } else {
          this.timeline.push(syncedTimelineCue);
        }
        if (this.timeline.length > 2e3) {
          this.timeline.splice(0, this.timeline.length - 2e3);
        }
        if (estimatedStart < prevStartTime) {
          this.timeline.sort((a, b) => a.startTime - b.startTime);
        }
      }
      return { syncedCue: syncedTimelineCue, replacedCueId };
    }
    showCue(cue) {
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
      if (nowVideo < 2 && this.timeline.length > 0 && this.timeline[this.timeline.length - 1].startTime > 30) {
        this.timeline = [];
        this.utteranceAnchors.clear();
        this.maxWatchedTime = nowVideo;
        this.rerecordWindow = null;
      }
      if (this.rerecordWindow && Date.now() >= this.rerecordWindow.expiresAt) {
        this.rerecordWindow = null;
      }
      const inRerecordWindow = Boolean(
        this.rerecordWindow && estimatedEnd >= this.rerecordWindow.startTime && estimatedStart <= this.rerecordWindow.endTime
      );
      if (inRerecordWindow && cue.isFinal) {
        this.rerecordWindow = null;
      }
      if (this.isCementedDuplicate(cue, estimatedStart, estimatedEnd, inRerecordWindow)) {
        return;
      }
      if (nowVideo > 15 && this.timeline.length > 0 && this.timeline[0].endTime < 2.5) {
        this.timeline = this.timeline.filter((c) => c.endTime >= 2.5);
      }
      this.activeReplayCue = null;
      this.lastLiveCueAt = Date.now();
      this.updateActiveCues(cue, cleanText);
      const hasValidVideoClock = nowVideo > 0.08 || this.maxWatchedTime > 0.5;
      let syncedTimelineCue = {
        id: cue.id,
        text: cue.text,
        startTime: estimatedStart,
        endTime: estimatedEnd,
        receivedAt: cue.receivedAt,
        isFinal: cue.isFinal
      };
      let replacedCueId;
      if (this.settings.enableSubtitleCache && hasValidVideoClock) {
        const res = this.addOrUpdateTimeline(cue, estimatedStart, estimatedEnd);
        syncedTimelineCue = res.syncedCue;
        replacedCueId = res.replacedCueId;
      }
      if (nowVideo > 0.08 || this.maxWatchedTime > 0.5) {
        this.safeSendMessage({
          type: "SYNC_VIDEO_CUE_TIMING",
          cueId: syncedTimelineCue.id,
          replacedCueId,
          text: syncedTimelineCue.text,
          videoStartTime: syncedTimelineCue.startTime,
          videoEndTime: syncedTimelineCue.endTime,
          videoTitle: document.title || void 0,
          isFinal: cue.isFinal
        });
      }
    }
    updateActiveCues(cue, cleanText) {
      const lastCue = this.activeCues[this.activeCues.length - 1];
      const isContinuation = lastCue && (lastCue.id === cue.id || !lastCue.isFinal && (cleanText.startsWith(lastCue.text.trim()) || lastCue.text.trim().startsWith(cleanText)));
      if (isContinuation && lastCue) {
        lastCue.text = cue.text;
        lastCue.receivedAt = cue.receivedAt;
        lastCue.id = cue.id;
        lastCue.durationMs = cue.durationMs;
        lastCue.isFinal = cue.isFinal;
        renderSubtitleStack(this.stackContainer, this.activeCues, this.settings);
        if (this.container.style.opacity !== "1") {
          this.container.style.setProperty("opacity", "1", "important");
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
      this.container.style.setProperty("opacity", "1", "important");
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      if (!this.isHovered) {
        if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
          this.fadeRemainingMs = this.settings.autoFadeTimeoutMs || 6e3;
        } else {
          this.scheduleFadeOut();
        }
      }
    }
    performSafeVideoSeek(rawSeekTime) {
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
        } catch {
        }
        if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
          if (this.video.seeking) {
            const onSeeked = () => {
              this.video.removeEventListener("seeked", onSeeked);
              if (this.video.paused && this.settings.subNavigationPlayOnSeek) {
                this.video.play().catch(() => {
                });
              }
            };
            this.video.addEventListener("seeked", onSeeked, { once: true });
          } else {
            this.video.play().catch(() => {
            });
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
    hasPreviousSubtitle() {
      if (!this.settings.subNavigationEnabled || !this.settings.enableSubtitleCache) return false;
      if (this.timeline.length === 0) return false;
      const vPos = this.video.currentTime;
      const padSec = (this.settings.subNavigationPaddingMs || 150) / 1e3;
      const first = this.timeline[0];
      return vPos > first.startTime - padSec + 0.45;
    }
    hasNextSubtitle() {
      if (!this.settings.subNavigationEnabled || !this.settings.enableSubtitleCache) return false;
      if (this.timeline.length === 0) return false;
      const vPos = this.video.currentTime;
      const last = this.timeline[this.timeline.length - 1];
      if (this.activeReplayCue && this.activeReplayCue.id !== last.id) {
        return true;
      }
      return last.startTime > vPos + 0.25;
    }
    seekToPreviousSubtitle() {
      if (!this.settings.subNavigationEnabled) return false;
      const vPos = this.video.currentTime;
      const padSec = (this.settings.subNavigationPaddingMs || 150) / 1e3;
      if (!this.settings.enableSubtitleCache || this.timeline.length === 0) {
        const lastActive = this.activeCues[this.activeCues.length - 1];
        if (lastActive) {
          const textDur = Math.max(2.2, lastActive.text.trim().length / 13);
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
    seekToNextSubtitle() {
      if (!this.settings.subNavigationEnabled || !(this.settings.subForwardNavigationEnabled ?? true) || !this.settings.enableSubtitleCache) {
        return false;
      }
      if (this.timeline.length === 0) return false;
      const vPos = this.video.currentTime;
      const padSec = (this.settings.subNavigationPaddingMs || 150) / 1e3;
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
    displayReplayCue(cue) {
      if (!this.settings.enabled) return;
      const subCue = {
        id: cue.id,
        text: cue.text,
        receivedAt: Date.now(),
        durationMs: (cue.endTime - cue.startTime) * 1e3
      };
      this.activeCues = [subCue];
      this.renderStack();
      this.container.style.setProperty("opacity", "1", "important");
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
        this.fadeRemainingMs = this.settings.autoFadeTimeoutMs || 6e3;
      }
    }
    onTimeUpdate() {
      if (!this.settings.enabled) return;
      if (this.isReplaySeeking) return;
      const vPos = this.video.currentTime;
      this.maxWatchedTime = Math.max(this.maxWatchedTime, vPos);
      const padSec = (this.settings.subNavigationPaddingMs || 150) / 1e3;
      const leadInSec = Math.max(0.18, padSec);
      if (!this.activeReplayCue && Date.now() - this.lastLiveCueAt < 1800) {
        this.updateToolbarVisibility();
        return;
      }
      if (!this.isHovered && !this.hasSelectedText() && (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)) {
        let matchedCue = null;
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
    scheduleFadeOut(customMs) {
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
        return;
      }
      const duration = customMs || this.settings.autoFadeTimeoutMs || 6e3;
      this.fadeTargetTime = Date.now() + duration;
      this.fadeRemainingMs = duration;
      this.fadeTimer = setTimeout(() => {
        if (!this.isHovered && !this.hasSelectedText() && (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)) {
          this.hide();
        }
      }, duration);
    }
    hide() {
      if (this.container) {
        this.container.style.setProperty("opacity", "0", "important");
      }
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      this.fadeRemainingMs = 0;
      setTimeout(() => {
        if (this.container && this.container.style.opacity === "0") {
          this.activeCues = [];
          this.renderStack();
        }
      }, 260);
    }
    destroy() {
      this.hide();
      if (this.container._cleanup) {
        this.container._cleanup();
      }
      if (this.container && this.container.parentElement) {
        this.container.parentElement.removeChild(this.container);
      }
    }
  };

  // src/content/shadow-roots.ts
  function findAllVideos(root = typeof document !== "undefined" ? document : null) {
    const videos = [];
    if (!root || typeof root.querySelectorAll !== "function") {
      return videos;
    }
    try {
      const elements = root.querySelectorAll("video");
      for (let i = 0; i < elements.length; i++) {
        videos.push(elements[i]);
      }
      const allElements = root.querySelectorAll("*");
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        if (el && el.shadowRoot) {
          const nestedVideos = findAllVideos(el.shadowRoot);
          videos.push(...nestedVideos);
        }
      }
    } catch {
    }
    return videos;
  }
  function isEligibleVideo(video) {
    if (!video || !video.isConnected) return false;
    try {
      const rect = video.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return false;
      return true;
    } catch {
      return false;
    }
  }

  // src/content/video-finder.ts
  var highlightedVideo = null;
  var originalOutline = "";
  var originalBoxShadow = "";
  function highlightVideo(video) {
    clearHighlight();
    highlightedVideo = video;
    originalOutline = video.style.outline;
    originalBoxShadow = video.style.boxShadow;
    video.style.setProperty("outline", "3px solid #38bdf8", "important");
    video.style.setProperty("box-shadow", "0 0 16px rgba(56, 189, 248, 0.75)", "important");
  }
  function clearHighlight() {
    if (highlightedVideo) {
      highlightedVideo.style.outline = originalOutline;
      highlightedVideo.style.boxShadow = originalBoxShadow;
      highlightedVideo = null;
    }
  }
  function getVideoTitle(video) {
    if (video.title && video.title.trim()) return video.title.trim();
    const ariaLabel = video.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    if (video.currentSrc) {
      try {
        const url = new URL(video.currentSrc);
        const filename = url.pathname.split("/").filter(Boolean).pop();
        if (filename && !filename.includes(".m3u8")) {
          return decodeURIComponent(filename).slice(0, 36);
        }
      } catch {
      }
    }
    const pageTitle = document.title ? document.title.replace(/\s*-\s*YouTube$/, "").trim() : "";
    if (pageTitle) return pageTitle.slice(0, 36);
    return "HTML5 Video Player";
  }
  function getTargetVideo(bindings2, settings2, selectedVideoId2, activeVideo2) {
    if (!settings2.autoEmbed && selectedVideoId2) {
      for (const binding of bindings2.values()) {
        if (binding.id === selectedVideoId2 && binding.video.isConnected && isEligibleVideo(binding.video)) {
          return { target: binding.video, newActive: activeVideo2 };
        }
      }
    }
    if (activeVideo2 && activeVideo2.isConnected && !activeVideo2.paused && isEligibleVideo(activeVideo2)) {
      return { target: activeVideo2, newActive: activeVideo2 };
    }
    let bestCandidate = null;
    let maxPlayedTime = 0;
    for (const binding of bindings2.values()) {
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
    if (activeVideo2 && activeVideo2.isConnected && isEligibleVideo(activeVideo2)) {
      return { target: activeVideo2, newActive: activeVideo2 };
    }
    let largestVideo = null;
    let maxArea = 0;
    for (const binding of bindings2.values()) {
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
    return { target: null, newActive: activeVideo2 };
  }
  function getDetectedVideosList(bindings2, target) {
    const list = [];
    for (const binding of bindings2.values()) {
      if (!binding.video.isConnected || !isEligibleVideo(binding.video)) continue;
      const v = binding.video;
      const rect = v.getBoundingClientRect();
      list.push({
        id: binding.id,
        src: v.src || "",
        currentSrc: v.currentSrc || "",
        currentTime: v.currentTime || 0,
        duration: v.duration && !isNaN(v.duration) ? v.duration : 0,
        paused: v.paused,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        isSelected: target === v,
        title: getVideoTitle(v)
      });
    }
    return list;
  }

  // src/content/key-navigation.ts
  function isEditableElement(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }
  function registerKeyNavigation(getSettings, getTargetBinding, isContextValid, onInvalidContext) {
    const handler = (e) => {
      if (!isContextValid()) {
        onInvalidContext();
        return;
      }
      if (isEditableElement(e.target)) return;
      const settings2 = getSettings();
      if (!settings2.enabled) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === "KeyC" || e.key.toLowerCase() === "c")) {
        const binding2 = getTargetBinding();
        if (binding2 && binding2.overlay.hasSelectedText()) {
          const selectedText = window.getSelection()?.toString();
          if (selectedText) {
            navigator.clipboard?.writeText(selectedText).catch(() => {
            });
          }
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyR" || e.key.toLowerCase() === "r")) {
        const binding2 = getTargetBinding();
        if (!binding2) return;
        const handled2 = binding2.overlay.rerecordCurrentSubtitle();
        if (handled2) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!settings2.subNavigationEnabled) return;
      const binding = getTargetBinding();
      if (!binding) return;
      const handled = e.key === "ArrowLeft" ? binding.overlay.seekToPreviousSubtitle() : binding.overlay.seekToNextSubtitle();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
    };
  }

  // src/content/content.ts
  var settings = { ...DEFAULT_SETTINGS };
  var bindings = /* @__PURE__ */ new Map();
  var activeVideo = null;
  var selectedVideoId = null;
  var keepAlivePort = null;
  var scanIntervalId = null;
  var domObserver = null;
  var contextInvalidated = false;
  var cleanupKeyNav = null;
  var visibilityHandler = null;
  var focusHandler = null;
  var takeoverHandler = null;
  function isExtensionContextValid() {
    if (contextInvalidated) return false;
    try {
      return Boolean(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch {
      contextInvalidated = true;
      return false;
    }
  }
  function cleanupInvalidatedContext() {
    if (contextInvalidated) return;
    contextInvalidated = true;
    if (scanIntervalId) {
      clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    if (cleanupKeyNav) {
      cleanupKeyNav();
      cleanupKeyNav = null;
    }
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
    if (focusHandler) {
      window.removeEventListener("focus", focusHandler);
      focusHandler = null;
    }
    if (takeoverHandler) {
      window.removeEventListener("whisper-cli-sub-instance-takeover", takeoverHandler);
      takeoverHandler = null;
    }
    if (keepAlivePort) {
      try {
        keepAlivePort.disconnect();
      } catch {
      }
      keepAlivePort = null;
    }
    clearHighlight();
    for (const binding of bindings.values()) {
      binding.overlay.destroy();
    }
    bindings.clear();
    activeVideo = null;
    selectedVideoId = null;
  }
  function initSettings() {
    if (!isExtensionContextValid()) {
      cleanupInvalidatedContext();
      return;
    }
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        if (!isExtensionContextValid()) {
          cleanupInvalidatedContext();
          return;
        }
        if (items) {
          const maybeWrapped = items.settings;
          settings = {
            ...DEFAULT_SETTINGS,
            ...maybeWrapped && typeof maybeWrapped === "object" ? maybeWrapped : items
          };
          if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
            for (const binding of bindings.values()) {
              binding.overlay.destroy();
            }
            bindings.clear();
            activeVideo = null;
            selectedVideoId = null;
          } else {
            for (const binding of bindings.values()) {
              binding.overlay.applySettings(settings);
            }
          }
        }
      });
    } catch {
      cleanupInvalidatedContext();
    }
  }
  function ensureKeepAlive() {
    if (!isExtensionContextValid() || keepAlivePort) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: "content-keepalive" });
      keepAlivePort.onMessage.addListener((message) => {
        handleIncomingMessage(message);
      });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        if (isExtensionContextValid()) {
          setTimeout(ensureKeepAlive, 1e3);
        } else {
          cleanupInvalidatedContext();
        }
      });
    } catch {
      cleanupInvalidatedContext();
    }
  }
  function resolveCurrentTarget() {
    const result = getTargetVideo(bindings, settings, selectedVideoId, activeVideo);
    activeVideo = result.newActive;
    return result.target;
  }
  function resolveCurrentTargetBinding() {
    const target = resolveCurrentTarget();
    return target ? bindings.get(target) || null : null;
  }
  function scanVideos() {
    if (!isExtensionContextValid()) {
      cleanupInvalidatedContext();
      return;
    }
    if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
      if (bindings.size > 0) {
        for (const binding of bindings.values()) {
          binding.overlay.destroy();
        }
        bindings.clear();
        activeVideo = null;
        selectedVideoId = null;
      }
      return;
    }
    if (!document || !document.body && !document.documentElement) {
      return;
    }
    const discovered = findAllVideos(document);
    for (const video of discovered) {
      if (!bindings.has(video) && isEligibleVideo(video)) {
        const vidId = video.dataset.whisperVideoId || (video.dataset.whisperVideoId = "vid_" + Math.random().toString(36).substring(2, 9));
        const overlay = new VideoOverlay(video, settings);
        const binding = {
          id: vidId,
          video,
          overlay,
          lastPlayed: video.paused ? 0 : Date.now()
        };
        video.addEventListener("play", () => {
          binding.lastPlayed = Date.now();
          if (settings.autoEmbed) {
            activeVideo = video;
          }
        });
        video.addEventListener("playing", () => {
          binding.lastPlayed = Date.now();
          if (settings.autoEmbed) {
            activeVideo = video;
          }
        });
        bindings.set(video, binding);
        ensureKeepAlive();
        console.log("[whisper-cli-sub-injector] Bound video element candidate:", vidId, video);
      }
    }
    for (const [video, binding] of bindings.entries()) {
      if (!video.isConnected || !isEligibleVideo(video)) {
        binding.overlay.destroy();
        bindings.delete(video);
        if (activeVideo === video) {
          activeVideo = null;
        }
      }
    }
  }
  function onTabActivated(cueFromBg) {
    if (!isExtensionContextValid()) {
      cleanupInvalidatedContext();
      return;
    }
    ensureKeepAlive();
    scanVideos();
    const target = resolveCurrentTarget();
    if (target) {
      const binding = bindings.get(target);
      if (binding) {
        binding.overlay.updatePosition();
        if (target.paused && settings.pauseSubtitlesWithVideo) {
          binding.overlay.refreshPausedSubtitle();
        }
        if (cueFromBg) {
          binding.overlay.restoreIfIdle(cueFromBg);
        }
      }
    }
    try {
      const p = chrome.runtime.sendMessage({ type: "TAB_FOCUSED" });
      if (p && typeof p.then === "function") {
        p.then((res) => {
          if (!isExtensionContextValid() || !res) return;
          if (res.lastCue && target) {
            const binding = bindings.get(target);
            if (binding) {
              binding.overlay.restoreIfIdle(res.lastCue);
            }
          }
        }).catch(() => {
        });
      }
    } catch {
      cleanupInvalidatedContext();
    }
  }
  function handleIncomingMessage(message, sendResponse) {
    if (!isExtensionContextValid()) {
      cleanupInvalidatedContext();
      return false;
    }
    if (message.type === "NEW_SUBTITLE") {
      if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
        return false;
      }
      const target = resolveCurrentTarget();
      if (target) {
        const binding = bindings.get(target);
        if (binding) {
          binding.overlay.showCue(message.cue);
        }
      }
    } else if (message.type === "SETTINGS_CHANGED") {
      settings = message.settings;
      if (!isUrlAllowed(window.location.href, settings.urlFilterMode, settings.urlFilterList)) {
        for (const binding of bindings.values()) {
          binding.overlay.destroy();
        }
        bindings.clear();
        activeVideo = null;
        selectedVideoId = null;
      } else {
        for (const binding of bindings.values()) {
          binding.overlay.applySettings(settings);
        }
        scanVideos();
      }
    } else if (message.type === "CLEAR_SUBTITLES") {
      for (const binding of bindings.values()) {
        binding.overlay.hide();
      }
    } else if (message.type === "CLEAR_TIMELINE_CACHE") {
      for (const binding of bindings.values()) {
        binding.overlay.clearTimelineCache();
      }
    } else if (message.type === "GET_DETECTED_VIDEOS") {
      scanVideos();
      const target = resolveCurrentTarget();
      sendResponse?.({
        videos: getDetectedVideosList(bindings, target),
        autoEmbed: settings.autoEmbed ?? true,
        selectedVideoId
      });
      return true;
    } else if (message.type === "SELECT_VIDEO") {
      selectedVideoId = message.videoId;
      settings.autoEmbed = false;
      for (const binding of bindings.values()) {
        if (binding.id === message.videoId) {
          activeVideo = binding.video;
          binding.overlay.updatePosition();
        } else {
          binding.overlay.hide();
        }
      }
      sendResponse?.({ success: true, activeVideoId: selectedVideoId });
      return true;
    } else if (message.type === "SET_AUTO_EMBED") {
      settings.autoEmbed = message.autoEmbed;
      if (message.autoEmbed) {
        selectedVideoId = null;
        activeVideo = resolveCurrentTarget();
      }
      sendResponse?.({ success: true });
      return true;
    } else if (message.type === "HIGHLIGHT_VIDEO") {
      for (const binding of bindings.values()) {
        if (binding.id === message.videoId) {
          highlightVideo(binding.video);
          break;
        }
      }
      sendResponse?.({ success: true });
      return true;
    } else if (message.type === "UNHIGHLIGHT_VIDEO") {
      clearHighlight();
      sendResponse?.({ success: true });
      return true;
    } else if (message.type === "TAB_ACTIVATED") {
      if (message.settings) {
        settings = message.settings;
        for (const binding of bindings.values()) {
          binding.overlay.applySettings(settings);
        }
      }
      onTabActivated(message.lastCue);
    }
    return false;
  }
  if (isExtensionContextValid()) {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        return handleIncomingMessage(message, sendResponse);
      });
    } catch {
      cleanupInvalidatedContext();
    }
  }
  function start() {
    if (!isExtensionContextValid()) {
      cleanupInvalidatedContext();
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent("whisper-cli-sub-instance-takeover"));
    } catch {
    }
    takeoverHandler = () => {
      cleanupInvalidatedContext();
    };
    window.addEventListener("whisper-cli-sub-instance-takeover", takeoverHandler);
    initSettings();
    ensureKeepAlive();
    scanVideos();
    cleanupKeyNav = registerKeyNavigation(
      () => settings,
      resolveCurrentTargetBinding,
      isExtensionContextValid,
      cleanupInvalidatedContext
    );
    scanIntervalId = setInterval(scanVideos, 1e3);
    const observeRoot = document.body || document.documentElement;
    if (observeRoot) {
      domObserver = new MutationObserver(() => {
        scanVideos();
      });
      domObserver.observe(observeRoot, {
        childList: true,
        subtree: true
      });
    }
    visibilityHandler = () => {
      if (!document.hidden && isExtensionContextValid()) {
        onTabActivated();
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
    focusHandler = () => {
      if (isExtensionContextValid()) {
        onTabActivated();
      }
    };
    window.addEventListener("focus", focusHandler);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
