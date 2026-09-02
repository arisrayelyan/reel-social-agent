import type { AppConfig } from '../config.js';
import type { OverlayProps } from '../utils/overlay.js';
import type { WordTiming } from './tts.js';

export interface CaptionCue {
  text: string;
  start: number;
  end: number;
  words: WordTiming[];
}

/**
 * HTTP client for the Remotion caption renderer (services/captions). Takes
 * the merged (already audio-synced) video plus global-timeline cues and
 * returns the final captioned MP4.
 */
export class CaptionsClient {
  constructor(private readonly config: AppConfig) {}

  async render(params: {
    videoPath: string;
    cues: CaptionCue[];
    durationSeconds: number;
    outPath: string;
    overlay: OverlayProps;
  }): Promise<{ out_path: string }> {
    const res = await fetch(`${this.config.captionsUrl}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        video_path: params.videoPath,
        cues: params.cues,
        duration_seconds: params.durationSeconds,
        out_path: params.outPath,
        overlay: params.overlay,
      }),
      // Remotion renders take minutes
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (!res.ok) {
      throw new Error(`Captions service failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { out_path: string };
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.captionsUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
