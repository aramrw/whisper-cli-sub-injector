import { ExtensionSettings } from '../common/types';
import { VideoBinding } from './types';

export function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
  );
}

export function registerKeyNavigation(
  getSettings: () => ExtensionSettings,
  getTargetBinding: () => VideoBinding | null,
  isContextValid: () => boolean,
  onInvalidContext: () => void
): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!isContextValid()) {
      onInvalidContext();
      return;
    }
    if (isEditableElement(e.target)) return;
    const settings = getSettings();
    if (!settings.enabled) return;

    // Allow Cmd+C / Ctrl+C to copy selected subtitle text without the video player hijacking the 'C' key
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyC' || e.key.toLowerCase() === 'c')) {
      const binding = getTargetBinding();
      if (binding && binding.overlay.hasSelectedText()) {
        const selectedText = window.getSelection()?.toString();
        if (selectedText) {
          navigator.clipboard?.writeText(selectedText).catch(() => {});
        }
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
    }

    // Alt+R / Option+R: Re-record current subtitle line
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyR' || e.key.toLowerCase() === 'r')) {
      const binding = getTargetBinding();
      if (!binding) return;
      const handled = binding.overlay.rerecordCurrentSubtitle();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!settings.subNavigationEnabled) return;

    const binding = getTargetBinding();
    if (!binding) return;

    const handled =
      e.key === 'ArrowLeft'
        ? binding.overlay.seekToPreviousSubtitle()
        : binding.overlay.seekToNextSubtitle();
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };

  window.addEventListener('keydown', handler, true);
  return () => {
    window.removeEventListener('keydown', handler, true);
  };
}
