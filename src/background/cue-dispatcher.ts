import { MessageToContent, SubtitleCue } from '../common/types';
import { addCueToHistory } from './history-manager';

export const connectedContentPorts = new Set<chrome.runtime.Port>();

export function broadcastToTabs(
  message: MessageToContent,
  ports: Set<{ postMessage: (msg: MessageToContent) => void }> = connectedContentPorts
): void {
  if (ports.size > 0) {
    for (const port of ports) {
      try {
        port.postMessage(message);
      } catch {
        ports.delete(port);
      }
    }
    return;
  }

  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
  } catch {}
}

export function dispatchCueFromBackground(
  cue: SubtitleCue,
  ports: Set<{ postMessage: (msg: MessageToContent) => void }> = connectedContentPorts
): void {
  broadcastToTabs({ type: 'NEW_SUBTITLE', cue }, ports);
  addCueToHistory(cue);
}
