# 🎧 whisper-cli-sub-injector

**Live browser subtitle injector for [whisper-cli](https://github.com/whisper-cli).**

Injects real-time system audio transcription directly over HTML5 `<video>` elements in Google Chrome, Brave, and Mozilla Firefox — inspired by the video detection & overlay architecture of **asbplayer**.

---

## 💡 How It Works (Pure Direct Architecture)

There are **zero intermediate JavaScript servers or wrapper scripts**:
1. When you run `whisper --live`, the Rust CLI automatically serves a real-time Server-Sent Events (SSE) broadcast at `http://127.0.0.1:8989/events`.
2. The browser extension connects directly to `whisper-cli` on port 8989.
3. When `whisper-cli` is running:
   - The extension badge turns **LIVE** (green).
   - The content script discovers `<video>` elements (including custom shadow-root players like YouTube).
   - It positions a high-contrast, responsive subtitle overlay over the active video.
   - **Fullscreen Support**: Automatically migrates into `document.fullscreenElement` so subtitles remain visible on full-screen media players.
4. When you stop `whisper-cli` (Ctrl+C), the extension immediately detects the disconnect and sleeps.

---

## 🚀 Quick Setup

### 1. Build the Extension
In this directory (`~/Programming/whisper-cli-sub-injector`):

```bash
npm install
npm run build
```

This compiles both extension targets:
- `dist/chrome/` (Chrome Manifest V3 for Chrome, Brave, Edge, Opera)
- `dist/firefox/` (Firefox Manifest V3 for Firefox, Floorp, LibreWolf)

---

### 2. Load the Extension into Your Browser

#### In Chrome / Brave / Edge:
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `dist/chrome` folder in this project.

#### In Mozilla Firefox:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `dist/firefox/manifest.json`.

---

### 3. Usage

Simply start your normal `whisper` CLI in your terminal:

```bash
# Transcribe Spanish system audio in real time:
whisper --live --speech --preset live -l es

# Or translate Spanish system audio directly into English subtitles:
whisper --live --speech --preset live -l es --translate
```

You'll see the banner confirming the subtitle broadcast endpoint:
```
╭──────────────────────────────────────────────────────────────╮
│ 🎧 macOS Live System Audio Subtitles (ScreenCaptureKit)      │
╰──────────────────────────────────────────────────────────────╯
  • Provider : Custom (http://localhost:8080 • live preset)
  • Subtitles: http://127.0.0.1:8989/events (Browser Injector)
  • Language : es
  • Mode     : Smart Speech VAD (Press Ctrl+C to stop)
```

Now open any video in your browser (YouTube, Netflix, Crunchyroll, anime, or local HTML5 video). As audio plays through your Mac, subtitles will render directly over the video in real time!

---

## ⚙️ Extension Settings & Controls

Click the **Whisper Live Subs** icon in your browser toolbar:
- **Master Switch**: Toggle subtitles on/off instantly.
- **Font Size**: Adjustable slider (16px – 52px).
- **Positioning**: Bottom or Top of video with distance slider.
- **Background Styling**: Semi-transparent dark rounded box or clean high-contrast text outline (`text-shadow`).
- **Auto-Fade Timeout**: Customize how long subtitles stay visible after speech pauses (default: 5s).
- **Send Test Subtitle**: In-browser button to test the overlay styling and positioning on any active video immediately.

---

## 🛠️ CLI Options

You can customize the subtitle port if needed:
```bash
whisper --live --preset live --sub-port 8989
```
*(Pass `--sub-port 0` to disable the subtitle broadcast server).*
