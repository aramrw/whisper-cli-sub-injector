import { ExtensionSettings } from '../../common/types';
import { RerecordWindow } from './types';

export interface OverlayToolbarElements {
  toolbarContainer: HTMLDivElement;
  prevBtn: HTMLButtonElement;
  rerecordBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
}

export function createOverlayToolbar(
  onPrev: () => void,
  onRerecord: () => void,
  onNext: () => void
): OverlayToolbarElements {
  const toolbarContainer = document.createElement('div');
  toolbarContainer.className = 'whisper-cli-sub-toolbar';
  toolbarContainer.style.setProperty('display', 'none', 'important');
  toolbarContainer.style.setProperty('justify-content', 'center', 'important');
  toolbarContainer.style.setProperty('align-items', 'center', 'important');
  toolbarContainer.style.setProperty('gap', '6px', 'important');
  toolbarContainer.style.setProperty('pointer-events', 'none', 'important');

  const prevBtn = createToolbarButton('⏮ Prev', 'Previous subtitle (Left Arrow)', onPrev);
  const rerecordBtn = createToolbarButton(
    '🔄 Re-record Line',
    'Uncement & re-record this subtitle line from its start (Alt+R)',
    onRerecord
  );
  const nextBtn = createToolbarButton('Next ⏭', 'Next subtitle (Right Arrow)', onNext);

  toolbarContainer.appendChild(prevBtn);
  toolbarContainer.appendChild(rerecordBtn);
  toolbarContainer.appendChild(nextBtn);

  return { toolbarContainer, prevBtn, rerecordBtn, nextBtn };
}

function createToolbarButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'whisper-cli-sub-rerecord-btn';
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function updateToolbarState(
  elements: OverlayToolbarElements,
  video: HTMLMediaElement,
  settings: ExtensionSettings,
  hasActiveCues: boolean,
  rerecordWindow: RerecordWindow | null,
  hasPrevSubtitle: () => boolean,
  hasNextSubtitle: () => boolean
): void {
  const { toolbarContainer, prevBtn, rerecordBtn, nextBtn } = elements;
  if (!toolbarContainer || !rerecordBtn || !prevBtn || !nextBtn) return;

  const isRerecording = Boolean(rerecordWindow && Date.now() < rerecordWindow.expiresAt);
  if (isRerecording) {
    prevBtn.style.setProperty('display', 'none', 'important');
    nextBtn.style.setProperty('display', 'none', 'important');
    rerecordBtn.style.setProperty('display', 'inline-flex', 'important');
    rerecordBtn.textContent = '🎙️ Re-recording line...';
    toolbarContainer.style.setProperty('display', 'flex', 'important');
    return;
  }
  rerecordBtn.textContent = '🔄 Re-record Line';

  // Only turn on the toolbar buttons when the video is paused
  if (!video.paused || !hasActiveCues) {
    toolbarContainer.style.setProperty('display', 'none', 'important');
    return;
  }

  const showPrev = (settings.showPrevButton ?? true) && hasPrevSubtitle();
  const showRerecord = settings.showRerecordButton ?? true;
  const showNext = (settings.showNextButton ?? true) && hasNextSubtitle();

  prevBtn.style.setProperty('display', showPrev ? 'inline-flex' : 'none', 'important');
  rerecordBtn.style.setProperty('display', showRerecord ? 'inline-flex' : 'none', 'important');
  nextBtn.style.setProperty('display', showNext ? 'inline-flex' : 'none', 'important');

  const shouldShow = showPrev || showRerecord || showNext;
  toolbarContainer.style.setProperty('display', shouldShow ? 'flex' : 'none', 'important');
}
