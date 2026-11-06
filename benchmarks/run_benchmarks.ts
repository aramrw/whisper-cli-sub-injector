import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

// ---------------------------------------------------------------------------
// Realistic Browser DOM & Chrome Extension API Harness for Benchmarking
// ---------------------------------------------------------------------------
let domOpCounter = 0;
let styleSetPropertyCalls = 0;
let getBoundingClientRectCalls = 0;
let storageSetCalls = 0;
let storageBytesSerialized = 0;
let tabsQueryCalls = 0;
let tabsSendMessageCalls = 0;
let portPostMessageCalls = 0;

class MockStyle {
  private props = new Map<string, string>();
  display = '';
  opacity = '';
  position = '';

  setProperty(name: string, value: string, priority?: string) {
    styleSetPropertyCalls++;
    // Simulate CSSOM property parsing & style invalidation cost (~1.2us per setProperty)
    const start = performance.now();
    this.props.set(name, `${value}${priority ? ' !' + priority : ''}`);
    while (performance.now() - start < 0.0012) {
      domOpCounter++;
    }
  }

  getPropertyValue(name: string): string {
    return this.props.get(name) || '';
  }
}

class MockElement {
  tagName: string;
  className = '';
  id = '';
  type = '';
  title = '';
  private _textContent = '';
  dataset: Record<string, string> = {};
  style = new MockStyle();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  isConnected = true;
  private listeners = new Map<string, Function[]>();
  private attrs = new Map<string, string>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    // Simulate browser element allocation cost (~2us)
    const start = performance.now();
    while (performance.now() - start < 0.002) {
      domOpCounter++;
    }
  }

  setAttribute(name: string, val: string) {
    this.attrs.set(name, val);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeChild(child: MockElement) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      child.isConnected = false;
    }
    return child;
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val: string) {
    if (this._textContent !== val) {
      this._textContent = val;
      // Text node update (~0.5us)
      const start = performance.now();
      while (performance.now() - start < 0.0005) {
        domOpCounter++;
      }
    }
  }

  get innerHTML() {
    return '';
  }

  set innerHTML(val: string) {
    if (val === '' && this.children.length > 0) {
      // Simulate tearing down child DOM nodes & layout tree detachment (~4us per child)
      const childCount = this.children.length;
      const start = performance.now();
      while (performance.now() - start < childCount * 0.004) {
        domOpCounter++;
      }
      this.children = [];
    }
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  contains(other: MockElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }

  addEventListener(event: string, cb: Function) {
    const list = this.listeners.get(event) || [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, cb: Function) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(
      event,
      list.filter((fn) => fn !== cb)
    );
  }

  getBoundingClientRect() {
    getBoundingClientRectCalls++;
    // Simulate forced synchronous layout / reflow when reading layout geometry (~0.045ms)
    const start = performance.now();
    while (performance.now() - start < 0.045) {
      domOpCounter++;
    }
    return {
      left: 100,
      top: 80,
      width: 1280,
      height: 720,
      right: 1380,
      bottom: 800,
    };
  }
}

class MockVideoElement extends MockElement {
  currentTime = 42.5;
  playbackRate = 1.0;
  paused = false;
  seeking = false;
  buffered = {
    length: 1,
    start: () => 0,
    end: () => 300,
  };
  constructor() {
    super('video');
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

// Install global browser mocks before importing extension modules
const mockBody = new MockElement('body');
const mockDocElement = new MockElement('html');
mockDocElement.appendChild(mockBody);

(globalThis as any).window = {
  innerWidth: 1920,
  innerHeight: 1080,
  scrollX: 0,
  scrollY: 0,
  pageXOffset: 0,
  pageYOffset: 0,
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ position: 'relative' }),
};

(globalThis as any).document = {
  title: 'Benchmark Video Page',
  head: mockBody,
  body: mockBody,
  documentElement: mockDocElement,
  fullscreenElement: null,
  createElement: (tag: string) => new MockElement(tag),
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
};

(globalThis as any).ResizeObserver = class {
  observe() {}
  disconnect() {}
};

// Mock Chrome Storage & IPC with realistic serialization work
const localStorageData: Record<string, any> = {};
const openTabs = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, url: `https://example.com/tab-${i}` }));
let onContentMessageReceived: ((msg: any) => void) | null = null;
let lastRuntimeSentMessage: any = null;

(globalThis as any).chrome = {
  runtime: {
    id: 'benchmark-extension-id',
    sendMessage: (msg: any) => {
      lastRuntimeSentMessage = msg;
      // IPC serialization of message payload
      const json = JSON.stringify(msg);
      storageBytesSerialized += json.length;
      return Promise.resolve();
    },
    onMessage: {
      addListener: () => {},
    },
    onConnect: {
      addListener: () => {},
    },
    onInstalled: {
      addListener: () => {},
    },
  },
  storage: {
    local: {
      get: (keys: string[], cb: (res: any) => void) => {
        const out: Record<string, any> = {};
        for (const k of keys) {
          if (k in localStorageData) {
            out[k] = structuredClone(localStorageData[k]);
          }
        }
        cb(out);
      },
      set: (items: Record<string, any>, cb?: () => void) => {
        storageSetCalls++;
        // Real Chrome extension storage.local.set serializes the payload on the service worker thread
        const serialized = JSON.stringify(items);
        storageBytesSerialized += serialized.length;
        for (const [k, v] of Object.entries(items)) {
          localStorageData[k] = JSON.parse(JSON.stringify(v));
        }
        if (cb) cb();
        return Promise.resolve();
      },
    },
    sync: {
      get: (defaults: any, cb: (res: any) => void) => cb(defaults),
      set: (_items: any, cb?: () => void) => {
        if (cb) cb();
        return Promise.resolve();
      },
    },
  },
  tabs: {
    query: (_queryInfo: any, cb: (tabs: any[]) => void) => {
      tabsQueryCalls++;
      // Simulate Chrome browser-process tabs.query IPC latency (~0.85ms)
      const start = performance.now();
      while (performance.now() - start < 0.85) {
        domOpCounter++;
      }
      cb(openTabs);
    },
    sendMessage: (tabId: number, msg: any) => {
      tabsSendMessageCalls++;
      // Each chrome.tabs.sendMessage serializes the message across IPC (~0.025ms per tab)
      const serialized = JSON.stringify(msg);
      storageBytesSerialized += serialized.length;
      const start = performance.now();
      while (performance.now() - start < 0.025) {
        domOpCounter++;
      }
      if (tabId === 1 && onContentMessageReceived) {
        onContentMessageReceived(msg);
      }
      return Promise.resolve();
    },
  },
};

// Now import actual extension modules
import { DEFAULT_SETTINGS, SubtitleCue } from '../src/common/types';
import {
  addCueToHistory,
  clearHistory,
  flushPendingHistorySave,
  getHistoryCache,
  syncVideoCueTiming,
  updateHistorySettings,
} from '../src/background/history-manager';
import { renderSubtitleStack } from '../src/content/overlay/stack-renderer';
import { estimateCueTiming } from '../src/content/overlay/timeline-manager';
import { VideoOverlay } from '../src/content/overlay';

interface BenchStats {
  testName: string;
  phase: string;
  iterations: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

function computeStats(testName: string, phase: string, samplesMs: number[]): BenchStats {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const n = Math.max(1, sorted.length);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    testName,
    phase,
    iterations: sorted.length,
    meanMs: sum / n,
    medianMs: sorted[Math.floor(n / 2)],
    p95Ms: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
    p99Ms: sorted[Math.min(n - 1, Math.floor(n * 0.99))],
    minMs: sorted[0],
    maxMs: sorted[n - 1],
  };
}

function appendCsvResults(
  stats: BenchStats[],
  rawSamples: Array<{ testName: string; phase: string; samplesMs: number[] }>
) {
  const dir = path.join(process.cwd(), 'benchmarks');
  fs.mkdirSync(dir, { recursive: true });

  const summaryPath = path.join(dir, 'extension_latency_summary.csv');
  const writeHeader = !fs.existsSync(summaryPath) || fs.statSync(summaryPath).size === 0;
  const summaryLines: string[] = [];
  if (writeHeader) {
    summaryLines.push(
      'project,test_name,phase,iterations,mean_ms,median_ms,p95_ms,p99_ms,min_ms,max_ms'
    );
  }
  for (const s of stats) {
    summaryLines.push(
      `whisper-cli-sub-injector,${s.testName},${s.phase},${s.iterations},${s.meanMs.toFixed(
        4
      )},${s.medianMs.toFixed(4)},${s.p95Ms.toFixed(4)},${s.p99Ms.toFixed(4)},${s.minMs.toFixed(
        4
      )},${s.maxMs.toFixed(4)}`
    );
  }
  fs.appendFileSync(summaryPath, summaryLines.join('\n') + '\n');

  const samplesPath = path.join(dir, 'extension_latency_samples.csv');
  const writeSamplesHeader = !fs.existsSync(samplesPath) || fs.statSync(samplesPath).size === 0;
  const sampleLines: string[] = [];
  if (writeSamplesHeader) {
    sampleLines.push('project,test_name,phase,iteration,latency_ms');
  }
  for (const item of rawSamples) {
    item.samplesMs.forEach((val, idx) => {
      sampleLines.push(
        `whisper-cli-sub-injector,${item.testName},${item.phase},${idx + 1},${val.toFixed(4)}`
      );
    });
  }
  fs.appendFileSync(samplesPath, sampleLines.join('\n') + '\n');
}

async function runBenchmarks() {
  const phase = process.env.BENCH_PHASE || 'before';
  const allStats: BenchStats[] = [];
  const rawSamples: Array<{ testName: string; phase: string; samplesMs: number[] }> = [];

  // Seed history with 1,500 finalized cues (typical multi-episode viewing session)
  await clearHistory();
  await updateHistorySettings({ maxEntries: 2000, retentionDuration: '24h' });
  const baseTime = Date.now() - 600_000;
  const cache = getHistoryCache();
  for (let i = 0; i < 1500; i++) {
    cache.push({
      id: `seed-cue-${i}`,
      text: `Historical subtitle entry number ${i} from earlier in the video stream.`,
      timestamp: '02:15',
      receivedAt: baseTime + i * 300,
      durationMs: 1400,
      videoStartTime: i * 1.5,
      videoEndTime: i * 1.5 + 1.4,
      videoTitle: 'Benchmark Video Page',
      isFinal: true,
    });
  }

  // -------------------------------------------------------------------------
  // Test 1: addCueToHistory on 100 streaming partial token updates (1,500 history items)
  // -------------------------------------------------------------------------
  const historyPartialSamples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const partialCue: SubtitleCue = {
      id: 'live-stream-cue-1',
      text: `Streaming partial subtitle word sequence ${i} growing in real time`,
      timestamp: '10:05',
      receivedAt: Date.now(),
      durationMs: 300 + i * 25,
      lagMs: 25,
      isFinal: i === 99,
    };
    const t0 = performance.now();
    await addCueToHistory(partialCue);
    historyPartialSamples.push(performance.now() - t0);
  }
  allStats.push(computeStats('bg_add_cue_to_history_partial_1500', phase, historyPartialSamples));
  rawSamples.push({
    testName: 'bg_add_cue_to_history_partial_1500',
    phase,
    samplesMs: historyPartialSamples,
  });

  // -------------------------------------------------------------------------
  // Test 2: syncVideoCueTiming on 100 streaming partial token updates (1,500 history items)
  // -------------------------------------------------------------------------
  const syncTimingSamples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    await syncVideoCueTiming({
      cueId: 'live-stream-cue-1',
      text: `Streaming partial subtitle word sequence ${i} growing in real time`,
      videoStartTime: 605.0,
      videoEndTime: 605.3 + i * 0.025,
      videoTitle: 'Benchmark Video Page',
      isFinal: i === 99,
    });
    syncTimingSamples.push(performance.now() - t0);
  }
  allStats.push(computeStats('bg_sync_video_cue_timing_partial_1500', phase, syncTimingSamples));
  rawSamples.push({
    testName: 'bg_sync_video_cue_timing_partial_1500',
    phase,
    samplesMs: syncTimingSamples,
  });

  // -------------------------------------------------------------------------
  // Test 3: Background SSE cue arrival -> Content script delivery (25 browser tabs open)
  // -------------------------------------------------------------------------
  const connectedPorts = new Set<{ postMessage: (msg: any) => void }>();
  connectedPorts.add({
    postMessage: (msg: any) => {
      portPostMessageCalls++;
      // Direct persistent Port postMessage (~0.025ms single pipe write)
      const serialized = JSON.stringify(msg);
      storageBytesSerialized += serialized.length;
      const start = performance.now();
      while (performance.now() - start < 0.025) {
        domOpCounter++;
      }
      if (onContentMessageReceived) {
        onContentMessageReceived(msg);
      }
    },
  });

  // Import broadcastToTabs & handleIncomingSseCue from background if exported, or run exact pipeline
  const { dispatchCueFromBackground } = await import('../src/background/cue-dispatcher');
  const bgToContentSamples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const cue: SubtitleCue = {
      id: 'live-stream-cue-2',
      text: `Live subtitle token ${i} dispatched from background to active video tab`,
      timestamp: '11:20',
      receivedAt: Date.now(),
      durationMs: 250 + i * 20,
      lagMs: 20,
      isFinal: false,
    };
    let receivedAtMs = 0;
    onContentMessageReceived = () => {
      receivedAtMs = performance.now();
    };
    const t0 = performance.now();
    dispatchCueFromBackground(cue, connectedPorts as any);
    bgToContentSamples.push(receivedAtMs - t0);
  }
  await flushPendingHistorySave();
  onContentMessageReceived = null;
  allStats.push(computeStats('bg_cue_to_content_delivery_25_tabs', phase, bgToContentSamples));
  rawSamples.push({
    testName: 'bg_cue_to_content_delivery_25_tabs',
    phase,
    samplesMs: bgToContentSamples,
  });

  // -------------------------------------------------------------------------
  // Test 4: renderSubtitleStack on 200 partial token updates (3 stacked cues)
  // -------------------------------------------------------------------------
  const stackContainer = new MockElement('div') as unknown as HTMLDivElement;
  const activeCues: SubtitleCue[] = [
    {
      id: 'stack-cue-1',
      text: 'Previous finalized line one in the subtitle stack.',
      timestamp: '12:01',
      receivedAt: Date.now() - 4000,
      isFinal: true,
    },
    {
      id: 'stack-cue-2',
      text: 'Second finalized line in the subtitle stack.',
      timestamp: '12:03',
      receivedAt: Date.now() - 2000,
      isFinal: true,
    },
    {
      id: 'stack-cue-3',
      text: 'Streaming third line...',
      timestamp: '12:05',
      receivedAt: Date.now(),
      isFinal: false,
    },
  ];
  const renderStackSamples: number[] = [];
  for (let i = 0; i < 200; i++) {
    activeCues[2].text = `Streaming third line partial update word ${i} in stack`;
    const t0 = performance.now();
    renderSubtitleStack(stackContainer, activeCues, DEFAULT_SETTINGS);
    renderStackSamples.push(performance.now() - t0);
  }
  allStats.push(computeStats('content_render_subtitle_stack_partial', phase, renderStackSamples));
  rawSamples.push({
    testName: 'content_render_subtitle_stack_partial',
    phase,
    samplesMs: renderStackSamples,
  });

  // -------------------------------------------------------------------------
  // Test 5: SubtitleOverlay.showCue full pipeline on 150 partial updates (1,500 timeline cues)
  // -------------------------------------------------------------------------
  const videoParent = new MockElement('div');
  const mockVideo = new MockVideoElement();
  videoParent.appendChild(mockVideo);
  mockBody.appendChild(videoParent);

  const overlay = new VideoOverlay(mockVideo as unknown as HTMLMediaElement, {
    ...DEFAULT_SETTINGS,
  });
  // Seed overlay timeline with 1,500 cemented cues
  const internalTimeline = (overlay as any).timeline as any[];
  for (let i = 0; i < 1500; i++) {
    internalTimeline.push({
      id: `tl-seed-${i}`,
      text: `Timeline cemented subtitle line ${i}`,
      startTime: i * 1.5,
      endTime: i * 1.5 + 1.3,
      receivedAt: baseTime + i * 300,
      isFinal: true,
    });
  }
  mockVideo.currentTime = 2300.0;

  const showCuePartialSamples: number[] = [];
  for (let i = 0; i < 150; i++) {
    const partialCue: SubtitleCue = {
      id: 'overlay-live-cue-1',
      text: `Overlay live streaming token ${i} rendered onto video`,
      timestamp: '38:20',
      receivedAt: Date.now(),
      clipStartMs: 2300000,
      clipEndMs: 2300000 + i * 25,
      durationMs: 200 + i * 25,
      lagMs: 25,
      isFinal: i === 149,
    };
    const t0 = performance.now();
    overlay.showCue(partialCue);
    showCuePartialSamples.push(performance.now() - t0);
  }
  allStats.push(
    computeStats('content_overlay_show_cue_partial_1500', phase, showCuePartialSamples)
  );
  rawSamples.push({
    testName: 'content_overlay_show_cue_partial_1500',
    phase,
    samplesMs: showCuePartialSamples,
  });

  // -------------------------------------------------------------------------
  // Test 6: estimateCueTiming micro-benchmark (check if already <1ms)
  // -------------------------------------------------------------------------
  const anchors = new Map();
  const timingCalcSamples: number[] = [];
  for (let i = 0; i < 200; i++) {
    const cue: SubtitleCue = {
      id: 'timing-cue-1',
      text: `Timing calculation test word ${i}`,
      timestamp: '05:00',
      receivedAt: Date.now(),
      clipStartMs: 300000,
      clipEndMs: 300000 + i * 20,
      durationMs: 200 + i * 20,
      lagMs: 25,
      isFinal: false,
    };
    const t0 = performance.now();
    estimateCueTiming(cue, mockVideo as unknown as HTMLMediaElement, DEFAULT_SETTINGS, 0, anchors);
    timingCalcSamples.push(performance.now() - t0);
  }
  allStats.push(computeStats('content_estimate_cue_timing', phase, timingCalcSamples));
  rawSamples.push({
    testName: 'content_estimate_cue_timing',
    phase,
    samplesMs: timingCalcSamples,
  });

  appendCsvResults(allStats, rawSamples);

  console.log(`\n=== whisper-cli-sub-injector Latency Benchmark (${phase}) ===`);
  for (const s of allStats) {
    console.log(
      `  ${s.testName.padEnd(38)} | mean: ${s.meanMs.toFixed(4).padStart(8)} ms | p50: ${s.medianMs
        .toFixed(4)
        .padStart(8)} ms | p95: ${s.p95Ms.toFixed(4).padStart(8)} ms | max: ${s.maxMs
        .toFixed(4)
        .padStart(8)} ms`
    );
  }
}

runBenchmarks().catch((err) => {
  console.error(err);
  process.exit(1);
});
