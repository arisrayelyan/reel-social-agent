import type { AppConfig } from '../config.js';

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface SynthesisResult {
  wav_path: string;
  duration_seconds: number;
  words: WordTiming[];
}

/**
 * HTTP client for the local Chatterbox TTS service (services/tts). The model
 * is held warm in that process; each call synthesizes one storyboard beat.
 */
export class TtsClient {
  constructor(private readonly config: AppConfig) {}

  async synthesize(params: {
    text: string;
    outPath: string;
    seed?: number;
  }): Promise<SynthesisResult> {
    // One in-client retry after a short pause: a long-idle Chatterbox process
    // can wedge on its first request (macOS App Nap / MPS state) and recover.
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${this.config.ttsUrl}/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: params.text,
          out_path: params.outPath,
          seed: params.seed,
        }),
      });
      if (res.ok) return (await res.json()) as SynthesisResult;
      const body = await res.text();
      if (attempt >= 2) {
        throw new Error(`TTS service failed (${res.status}): ${body}`);
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.ttsUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
