export interface TimelineCue {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  receivedAt: number;
  isFinal?: boolean;
}

export interface UtteranceAnchor {
  id: string;
  rawVideoStart: number;
  firstClipStartMs?: number;
}

export interface RerecordWindow {
  startTime: number;
  endTime: number;
  expiresAt: number;
}
