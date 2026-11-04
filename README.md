
# whisper-cli-sub-injector

Browser extension that displays live subtitles over HTML5 video elements.
Companion app for [whisper-cli](https://github.com/aramrw/whisper-cli) (required).

<p align="center">
  <img width="755" height="345" alt="st_overlayd_resized" src="https://github.com/user-attachments/assets/e83736d6-32f4-4c7b-ac0b-5b8b19992830" />
</p>

## Features

- Detects and binds to videos (works on YouTube, Crunchyroll, Netflix, and other video sites).
- Pauses subtitles when the video is paused. Useful for yomitan.
- Customizable
- Dedicated history page
- Supports fullscreen mode

### Popup
<p align="center">
  <img src="screenshots/popup.png" width="35%" alt="Extension Popup" />
  &nbsp;
</p>

### History
<p align="center">
 <img src="screenshots/history.png" width="90%" alt="History Page" />
</p>
 

 ---

## How to Use

1. Download & Run [whisper-cli](https://github.com/aramrw/whisper-cli) with live system audio capture:

```bash
whisper --live --preset live -l ja
```

[whisper-cli](https://github.com/aramrw/whisper-cli) starts a local SSE server at `http://127.0.0.1:8989/events`.

2. The extension connects to the local endpoint automatically and overlays live transcription on the video currently playing in your browser.

## Installation

### Build from source

```bash
git clone https://github.com/aramrw/whisper-cli-sub-injector.git
cd whisper-cli-sub-injector
npm install
npm run build
```

This generates:
- `dist/chrome/` (for Chrome, Brave, Edge)
- `dist/firefox/` (for Firefox)

### Load into browser

**Chrome / Brave / Edge:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the `dist/chrome` folder.

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..." and select `dist/firefox/manifest.json`.

## License

MIT
