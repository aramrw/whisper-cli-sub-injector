import { ExtensionSettings, SubtitleCue } from '../../common/types';

function isNodeSelected(node: HTMLElement): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
      return false;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return node.contains(sel.anchorNode) || node.contains(sel.focusNode);
  } catch {
    return false;
  }
}

export function renderSubtitleStack(
  stackContainer: HTMLDivElement,
  activeCues: SubtitleCue[],
  settings: ExtensionSettings
): void {
  const total = activeCues.length;
  if (total === 0) {
    if (stackContainer.children.length > 0) {
      stackContainer.innerHTML = '';
    }
    return;
  }

  const settingsSig = `${settings.fontSize}|${settings.textColor}|${settings.backgroundColor}|${settings.outlineColor}|${settings.showBackgroundBox}`;

  // Map existing DOM elements by cueId so we never destroy nodes (preserving active text selection)
  const existingById = new Map<string, HTMLDivElement>();
  const currentChildren = Array.from(stackContainer.children) as HTMLDivElement[];
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
    // age = 0 is the newest cue (rendered at bottom), age > 0 are older cues stacked above it
    const age = total - 1 - i;
    const ageStr = String(age);

    let item = existingById.get(cue.id);
    const isNewNode = !item;

    if (!item) {
      item = document.createElement('div');
      item.className = 'whisper-cli-sub-item';
      item.dataset.cueId = cue.id;
      item.textContent = cue.text;
    } else {
      // Only mutate textContent if it actually changed and user isn't mid-selection on identical finalized text
      if (item.textContent !== cue.text && !isNodeSelected(item)) {
        item.textContent = cue.text;
      }
    }

    // Only apply styles if node is new, its stack age changed, or settings changed
    if (
      isNewNode ||
      item.dataset.renderedAge !== ageStr ||
      item.dataset.settingsSig !== settingsSig
    ) {
      item.dataset.renderedAge = ageStr;
      item.dataset.settingsSig = settingsSig;

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

      const itemFontSize = Math.max(13, Math.round(settings.fontSize * scale));
      item.style.setProperty('font-size', `${itemFontSize}px`, 'important');
      item.style.setProperty('opacity', String(opacity), 'important');
      item.style.setProperty('color', settings.textColor, 'important');
      item.style.setProperty(
        'font-family',
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'important'
      );
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

      if (settings.showBackgroundBox) {
        item.style.setProperty('background', settings.backgroundColor, 'important');
        item.style.setProperty('padding', age === 0 ? '6px 14px' : '4px 10px', 'important');
        item.style.setProperty('border-radius', '6px', 'important');
        item.style.setProperty('box-shadow', '0 2px 8px rgba(0, 0, 0, 0.4)', 'important');
        item.style.setProperty(
          'text-shadow',
          `0 1px 2px ${settings.outlineColor}, 0 0 1px ${settings.outlineColor}`,
          'important'
        );
      } else {
        item.style.setProperty('background', 'transparent', 'important');
        item.style.setProperty('padding', '0', 'important');
        item.style.setProperty(
          'text-shadow',
          `-2px -2px 0 ${settings.outlineColor}, 2px -2px 0 ${settings.outlineColor}, -2px 2px 0 ${settings.outlineColor}, 2px 2px 0 ${settings.outlineColor}, 0 2px 6px rgba(0,0,0,0.85)`,
          'important'
        );
      }
    }

    if (isNewNode || stackContainer.children[i] !== item) {
      stackContainer.appendChild(item);
    }
  }
}
