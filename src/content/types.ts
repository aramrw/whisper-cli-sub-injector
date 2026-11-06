import { VideoOverlay } from './overlay';

export interface VideoBinding {
  id: string;
  video: HTMLMediaElement;
  overlay: VideoOverlay;
  lastPlayed: number;
}
