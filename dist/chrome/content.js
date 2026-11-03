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
    pauseSubtitlesWithVideo: true
  };

  // src/content/overlay.ts
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
  `;
    (document.head || document.documentElement).appendChild(style);
    styleSheetInjected = true;
  }
  var VideoOverlay = class {
    video;
    container;
    stackContainer;
    settings;
    fadeTimer = null;
    fadeTargetTime = 0;
    fadeRemainingMs = 0;
    pausedAt = 0;
    resizeObserver = null;
    isFullscreen = false;
    activeCues = [];
    isHovered = false;
    constructor(video, settings2) {
      this.video = video;
      this.settings = settings2;
      ensureSelectionStyle();
      this.container = document.createElement("div");
      this.container.className = "whisper-cli-sub-overlay";
      this.container.setAttribute("aria-live", "polite");
      this.container.style.setProperty("pointer-events", "none", "important");
      this.container.style.setProperty("position", "absolute", "important");
      this.container.style.setProperty("z-index", "2147483647", "important");
      this.container.style.setProperty("transition", "opacity 0.25s ease, transform 0.2s ease", "important");
      this.container.style.setProperty("opacity", "0", "important");
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
    attach() {
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
    onVideoPause() {
      this.pausedAt = Date.now();
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
      if (this.settings.pauseSubtitlesWithVideo && this.activeCues.length > 0) {
        const remaining = this.fadeRemainingMs > 0 ? this.fadeRemainingMs : this.settings.autoFadeTimeoutMs;
        this.scheduleFadeOut(remaining);
      }
    }
    setupListeners() {
      const onFullscreen = () => {
        this.attach();
      };
      document.addEventListener("fullscreenchange", onFullscreen);
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
      this.video.addEventListener("pause", onPause);
      this.video.addEventListener("play", onPlay);
      this.video.addEventListener("playing", onPlay);
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
      this.stackContainer.addEventListener("mouseenter", onMouseEnter);
      this.stackContainer.addEventListener("mouseleave", onMouseLeave);
      const stopProp = (e) => {
        e.stopPropagation();
      };
      this.stackContainer.addEventListener("mousedown", stopProp);
      this.stackContainer.addEventListener("click", stopProp);
      this.container._cleanup = () => {
        document.removeEventListener("fullscreenchange", onFullscreen);
        window.removeEventListener("resize", onWindowChange);
        window.removeEventListener("scroll", onWindowChange);
        this.video.removeEventListener("play", onWindowChange);
        this.video.removeEventListener("loadedmetadata", onWindowChange);
        this.video.removeEventListener("pause", onPause);
        this.video.removeEventListener("play", onPlay);
        this.video.removeEventListener("playing", onPlay);
        this.stackContainer.removeEventListener("mouseenter", onMouseEnter);
        this.stackContainer.removeEventListener("mouseleave", onMouseLeave);
        this.stackContainer.removeEventListener("mousedown", stopProp);
        this.stackContainer.removeEventListener("click", stopProp);
        if (this.resizeObserver) {
          this.resizeObserver.disconnect();
        }
      };
    }
    applySettings(settings2) {
      this.settings = settings2;
      if (!settings2.enabled) {
        this.hide();
      } else {
        this.renderStack();
        this.updatePosition();
      }
    }
    renderStack() {
      this.stackContainer.innerHTML = "";
      const total = this.activeCues.length;
      if (total === 0) return;
      for (let i = 0; i < total; i++) {
        const cue = this.activeCues[i];
        const age = total - 1 - i;
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
        const item = document.createElement("div");
        item.className = "whisper-cli-sub-item";
        item.dataset.cueId = cue.id;
        item.textContent = cue.text;
        const itemFontSize = Math.max(13, Math.round(this.settings.fontSize * scale));
        item.style.setProperty("font-size", `${itemFontSize}px`, "important");
        item.style.setProperty("opacity", String(opacity), "important");
        item.style.setProperty("color", this.settings.textColor, "important");
        item.style.setProperty("font-family", 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', "important");
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
        if (this.settings.showBackgroundBox) {
          item.style.setProperty("background", this.settings.backgroundColor, "important");
          item.style.setProperty("padding", age === 0 ? "6px 14px" : "4px 10px", "important");
          item.style.setProperty("border-radius", "6px", "important");
          item.style.setProperty("box-shadow", "0 2px 8px rgba(0, 0, 0, 0.4)", "important");
          item.style.setProperty(
            "text-shadow",
            `0 1px 2px ${this.settings.outlineColor}, 0 0 1px ${this.settings.outlineColor}`,
            "important"
          );
        } else {
          item.style.setProperty("background", "transparent", "important");
          item.style.setProperty("padding", "0", "important");
          item.style.setProperty(
            "text-shadow",
            `-2px -2px 0 ${this.settings.outlineColor}, 2px -2px 0 ${this.settings.outlineColor}, -2px 2px 0 ${this.settings.outlineColor}, 2px 2px 0 ${this.settings.outlineColor}, 0 2px 6px rgba(0,0,0,0.85)`,
            "important"
          );
        }
        this.stackContainer.appendChild(item);
      }
      this.updatePosition();
    }
    updatePosition() {
      if (!this.container || !this.video) return;
      const rect = this.video.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        this.container.style.display = "none";
        return;
      }
      this.container.style.display = "block";
      const fsElement = document.fullscreenElement;
      const isFs = Boolean(fsElement && (fsElement.contains(this.video) || fsElement === this.video));
      let centerX;
      let targetY;
      if (isFs) {
        const fsRect = fsElement.getBoundingClientRect();
        centerX = rect.left - fsRect.left + rect.width / 2;
        if (this.settings.alignment === "top") {
          targetY = rect.top - fsRect.top + this.settings.topOffset;
        } else {
          targetY = rect.top - fsRect.top + rect.height - this.settings.bottomOffset;
        }
      } else {
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        centerX = rect.left + rect.width / 2 + scrollX;
        if (this.settings.alignment === "top") {
          targetY = rect.top + this.settings.topOffset + scrollY;
        } else {
          targetY = rect.top + rect.height - this.settings.bottomOffset + scrollY;
        }
      }
      const maxWidth = Math.max(200, Math.min(rect.width * 0.9, window.innerWidth * 0.92));
      this.container.style.setProperty("left", `${centerX}px`, "important");
      this.container.style.setProperty("top", `${targetY}px`, "important");
      this.container.style.setProperty("transform", "translateX(-50%)", "important");
      this.container.style.setProperty("max-width", `${maxWidth}px`, "important");
    }
    showCue(cue) {
      if (!this.settings.enabled) return;
      if (this.video.paused && this.settings.pauseSubtitlesWithVideo) {
        if (this.pausedAt > 0 && Date.now() - this.pausedAt > 4e3) {
          return;
        }
      }
      const lastCue = this.activeCues[this.activeCues.length - 1];
      if (lastCue && lastCue.text.trim() === cue.text.trim()) {
        lastCue.receivedAt = cue.receivedAt;
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
        if (!this.isHovered && (!this.video.paused || !this.settings.pauseSubtitlesWithVideo)) {
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
  function findAllVideos(root = document) {
    const videos = [];
    const elements = root.querySelectorAll("video");
    for (let i = 0; i < elements.length; i++) {
      videos.push(elements[i]);
    }
    const allElements = root.querySelectorAll("*");
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el.shadowRoot) {
        const nestedVideos = findAllVideos(el.shadowRoot);
        videos.push(...nestedVideos);
      }
    }
    return videos;
  }
  function isEligibleVideo(video) {
    if (!video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;
    return true;
  }

  // src/content/content.ts
  var settings = { ...DEFAULT_SETTINGS };
  var bindings = /* @__PURE__ */ new Map();
  var activeVideo = null;
  function initSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      settings = { ...DEFAULT_SETTINGS, ...items };
      for (const binding of bindings.values()) {
        binding.overlay.applySettings(settings);
      }
    });
  }
  function getTargetVideo() {
    if (activeVideo && activeVideo.isConnected && !activeVideo.paused && isEligibleVideo(activeVideo)) {
      return activeVideo;
    }
    let bestCandidate = null;
    let maxPlayedTime = 0;
    for (const binding of bindings.values()) {
      if (!binding.video.isConnected || !isEligibleVideo(binding.video)) continue;
      if (!binding.video.paused) {
        if (binding.lastPlayed >= maxPlayedTime) {
          maxPlayedTime = binding.lastPlayed;
          bestCandidate = binding;
        }
      }
    }
    if (bestCandidate) {
      activeVideo = bestCandidate.video;
      return activeVideo;
    }
    if (activeVideo && activeVideo.isConnected && isEligibleVideo(activeVideo)) {
      return activeVideo;
    }
    let largestVideo = null;
    let maxArea = 0;
    for (const binding of bindings.values()) {
      if (!binding.video.isConnected || !isEligibleVideo(binding.video)) continue;
      const rect = binding.video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea) {
        maxArea = area;
        largestVideo = binding.video;
      }
    }
    if (largestVideo) {
      activeVideo = largestVideo;
      return activeVideo;
    }
    return null;
  }
  function scanVideos() {
    const discovered = findAllVideos(document);
    for (const video of discovered) {
      if (!bindings.has(video) && isEligibleVideo(video)) {
        const overlay = new VideoOverlay(video, settings);
        const binding = {
          video,
          overlay,
          lastPlayed: video.paused ? 0 : Date.now()
        };
        video.addEventListener("play", () => {
          binding.lastPlayed = Date.now();
          activeVideo = video;
        });
        video.addEventListener("playing", () => {
          binding.lastPlayed = Date.now();
          activeVideo = video;
        });
        bindings.set(video, binding);
        console.log("[whisper-cli-sub-injector] Bound video element candidate:", video);
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
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === "NEW_SUBTITLE") {
      const target = getTargetVideo();
      if (target) {
        const binding = bindings.get(target);
        if (binding) {
          binding.overlay.showCue(message.cue);
        }
      }
    } else if (message.type === "SETTINGS_CHANGED") {
      settings = message.settings;
      for (const binding of bindings.values()) {
        binding.overlay.applySettings(settings);
      }
    } else if (message.type === "CLEAR_SUBTITLES") {
      for (const binding of bindings.values()) {
        binding.overlay.hide();
      }
    }
  });
  function start() {
    initSettings();
    scanVideos();
    setInterval(scanVideos, 1e3);
    const observer = new MutationObserver(() => {
      scanVideos();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
