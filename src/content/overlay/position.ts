import { ExtensionSettings } from '../../common/types';

export function updateOverlayPosition(
  container: HTMLDivElement,
  video: HTMLMediaElement,
  settings: ExtensionSettings
): void {
  const rect = video.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.setProperty('display', 'flex', 'important');

  const fsElement = document.fullscreenElement;
  const isFs = Boolean(fsElement && (fsElement.contains(video) || fsElement === video));

  let centerX: number;
  let targetY: number;

  if (isFs) {
    const fsRect = fsElement!.getBoundingClientRect();
    centerX = rect.left - fsRect.left + rect.width / 2;

    if (settings.alignment === 'top') {
      targetY = rect.top - fsRect.top + settings.topOffset;
    } else {
      targetY = rect.top - fsRect.top + rect.height - settings.bottomOffset;
    }
  } else {
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    centerX = rect.left + rect.width / 2 + scrollX;

    if (settings.alignment === 'top') {
      targetY = rect.top + settings.topOffset + scrollY;
    } else {
      targetY = rect.top + rect.height - settings.bottomOffset + scrollY;
    }
  }

  const maxWidth = Math.max(200, Math.min(rect.width * 0.9, window.innerWidth * 0.92));
  const isTop = settings.alignment === 'top';
  const transformVal = isTop ? 'translateX(-50%)' : 'translate(-50%, -100%)';

  container.style.setProperty('left', `${centerX}px`, 'important');
  container.style.setProperty('top', `${targetY}px`, 'important');
  container.style.setProperty('transform', transformVal, 'important');
  container.style.setProperty('max-width', `${maxWidth}px`, 'important');
}
