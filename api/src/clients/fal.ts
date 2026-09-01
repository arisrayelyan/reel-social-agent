import { fal } from '@fal-ai/client';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';

export interface GeneratedClip {
  filePath: string;
  model: string;
  requestedSeconds: number;
  costUsd: number;
}

/**
 * fal.ai image-to-video (minimax/h3-max/image-to-video). Uses queue submit +
 * status polling — localhost cannot receive webhooks. The request_id is
 * returned to the caller so a crashed worker can resume polling instead of
 * paying for a resubmission.
 */
export class FalClient {
  constructor(private readonly config: AppConfig) {
    if (!config.falKey) throw new Error('FAL_KEY is not set (api/.env)');
    fal.config({ credentials: config.falKey });
  }

  /**
   * Makes a keyframe addressable by the fal endpoint. Tries fal storage
   * first; if the upload is rejected (fal 403s malformed/suspicious files),
   * fall back to an inline data URI (accepted by fal image_url inputs).
   */
  async uploadImage(filePath: string): Promise<string> {
    const data = await readFile(filePath);
    try {
      const file = new File([new Uint8Array(data)], path.basename(filePath), {
        type: 'image/png',
      });
      return await fal.storage.upload(file);
    } catch {
      return `data:image/png;base64,${data.toString('base64')}`;
    }
  }

  async submitImageToVideo(params: {
    imageUrl: string;
    motionPrompt: string;
    durationSeconds: number;
  }): Promise<{ requestId: string; requestedSeconds: number }> {
    // fal durations are integer seconds with a floor — request ceil+1 and trim in merge
    const requestedSeconds = Math.max(5, Math.min(15, Math.ceil(params.durationSeconds) + 1));
    const { request_id } = await fal.queue.submit(this.config.falVideoModel, {
      input: {
        prompt: params.motionPrompt,
        image_url: params.imageUrl,
        duration: requestedSeconds,
        resolution: '768P',
      },
    });
    return { requestId: request_id, requestedSeconds };
  }

  /** Polls until the clip is ready, then downloads it. */
  async awaitClip(
    requestId: string,
    requestedSeconds: number,
    outputPath: string,
    pollMs = 5_000,
    timeoutMs = 15 * 60_000,
  ): Promise<GeneratedClip> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await fal.queue.status(this.config.falVideoModel, {
        requestId,
        logs: false,
      });
      if (status.status === 'COMPLETED') break;
      if (Date.now() > deadline) {
        throw new Error(`fal request ${requestId} timed out after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const result = await fal.queue.result(this.config.falVideoModel, { requestId });
    const videoUrl = (result.data as { video?: { url?: string } }).video?.url;
    if (!videoUrl) throw new Error(`fal result for ${requestId} has no video url`);

    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Failed to download fal clip (${res.status})`);
    await writeFile(outputPath, Buffer.from(await res.arrayBuffer()));

    return {
      filePath: outputPath,
      model: this.config.falVideoModel,
      requestedSeconds,
      costUsd: Number((requestedSeconds * this.config.falCostPerSecondUsd).toFixed(4)),
    };
  }
}
