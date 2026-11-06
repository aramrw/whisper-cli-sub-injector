import { ExtensionSettings } from '../../common/types';

let styleSheetInjected = false;

export function ensureSelectionStyle(): void {
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

export function applyOverlayStyles(
  container: HTMLDivElement,
  stackContainer: HTMLDivElement,
  settings: ExtensionSettings
): void {
  const fontFam =
    settings.fontFamily ||
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  container.style.fontFamily = fontFam;

  const fSize = settings.fontSize || 24;
  container.style.fontSize = `${fSize}px`;

  if (settings.alignment === 'left') {
    container.style.alignItems = 'flex-start';
    stackContainer.style.alignItems = 'flex-start';
  } else if (settings.alignment === 'right') {
    container.style.alignItems = 'flex-end';
    stackContainer.style.alignItems = 'flex-end';
  } else {
    container.style.alignItems = 'center';
    stackContainer.style.alignItems = 'center';
  }
}
