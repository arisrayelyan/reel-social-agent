import { fal } from '@fal-ai/client';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { capsFor, costPerSecondFor } from './falModels.js';

export interface ClipSubmission {
  requestId: string;
  /** The endpoint this request went to. Polling the wrong one 404s. */
  model: string;
  requestedSeconds: number;
  resolution: string;
  seed: number | null;
  /** Exactly what was sent, image_url redacted — goes into generation_runs. */
  input: Record<string, unknown>;
}

export interface GeneratedClip {
  filePath: string;
  model: string;
  requestedSeconds: number;
  costUsd: number;
  seed: number | null;
  /**
   * The endpoint's own rewrite of our motion prompt. prompt_expansion_mode
   * defaults to "balanced", so this — not what we sent — is what the model
   * actually generated from. Recording it is what makes the motion-prompt
   * rules auditable rather than aspirational.
   */
  expandedPrompt: string | null;
  timings: Record<string, number> | null;
}

/** data: URIs run to megabytes; never store one in a generation_runs row. */
function redactImageUrl(url: string): string {
  return url.startsWith('data:') ? `data-uri(${url.length} chars)` : url;
}

/**
 * fal.ai image-to-video. Uses queue submit + status polling — localhost cannot
 * receive webhooks. The submission is returned to the caller so a crashed
 * worker can resume polling instead of paying for a resubmission.
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
    /** Negatives, sent in their own field where the endpoint has one. */
    negativePrompt?: string;
    durationSeconds: number;
    model?: string;
    resolution?: string;
    seed?: number | null;
    endImageUrl?: string | null;
  }): Promise<ClipSubmission> {
    const model = params.model ?? this.config.falVideoModel;
    const caps = capsFor(model);
    // fal durations are whole seconds with a per-family floor; the request is
    // rounded UP so the clip covers the shots that draw on it, and merge trims
    const requestedSeconds = Math.max(
      caps.minDurationSeconds,
      Math.min(caps.maxDurationSeconds, Math.ceil(params.durationSeconds)),
    );
    const resolution = params.resolution ?? this.config.falVideoResolution;
    // a field the endpoint does not declare is a 422, and a field it declares
    // under a different NAME is also a 422 — every name below comes from the
    // caps table, which is generated from the live openapi document
    const seed = caps.supportsSeed ? (params.seed ?? null) : null;

    const input: Record<string, unknown> = {
      prompt: params.motionPrompt,
      [caps.imageField]: params.imageUrl,
      duration: caps.durationType === 'string' ? String(requestedSeconds) : requestedSeconds,
      ...(caps.supportsResolution ? { resolution } : {}),
      // required by h3-max, and it rewrites the prompt either way; sent
      // explicitly so the choice shows up in the recorded request
      ...(caps.rewritesPrompt
        ? { prompt_expansion_mode: this.config.falPromptExpansionMode }
        : {}),
      // where the endpoint has a real negative field, the negatives belong
      // there rather than eating into the prompt's ~30-word budget
      ...(caps.hasNegativePrompt && params.negativePrompt
        ? { negative_prompt: params.negativePrompt }
        : {}),
      // Kling and Seedance generate audio by DEFAULT; merge strips clip audio,
      // and on Kling that default is a 50% surcharge for something discarded
      ...(caps.audioField ? { [caps.audioField]: false } : {}),
      ...(seed === null ? {} : { seed }),
      ...(params.endImageUrl && caps.supportsEndImage
        ? { [caps.endImageField]: params.endImageUrl }
        : {}),
    };

    const { request_id } = await fal.queue.submit(model, { input });
    return {
      requestId: request_id,
      model,
      requestedSeconds,
      resolution,
      seed,
      input: { ...input, [caps.imageField]: redactImageUrl(params.imageUrl) },
    };
  }

  /** Polls until the clip is ready, then downloads it. */
  async awaitClip(
    submission: ClipSubmission,
    outputPath: string,
    pollMs = 5_000,
    timeoutMs = 15 * 60_000,
  ): Promise<GeneratedClip> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // must poll the endpoint the request was SUBMITTED to — with two tiers
      // configured, polling config.falVideoModel would 404 on draft requests
      const status = await fal.queue.status(submission.model, {
        requestId: submission.requestId,
        logs: false,
      });
      if (status.status === 'COMPLETED') break;
      if (Date.now() > deadline) {
        throw new Error(`fal request ${submission.requestId} timed out after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const result = await fal.queue.result(submission.model, { requestId: submission.requestId });
    const data = result.data as {
      video?: { url?: string };
      expanded_prompt?: string | null;
      timings?: Record<string, number> | null;
    };
    const videoUrl = data.video?.url;
    if (!videoUrl) throw new Error(`fal result for ${submission.requestId} has no video url`);

    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Failed to download fal clip (${res.status})`);
    await writeFile(outputPath, Buffer.from(await res.arrayBuffer()));

    const perSecond = costPerSecondFor(
      submission.model,
      this.config.falCostPerSecondUsdMap,
      this.config.falCostPerSecondUsd,
    );
    return {
      filePath: outputPath,
      model: submission.model,
      requestedSeconds: submission.requestedSeconds,
      // billed on the padded request, which is what fal actually charges
      costUsd: Number((submission.requestedSeconds * perSecond).toFixed(4)),
      seed: submission.seed,
      expandedPrompt: data.expanded_prompt ?? null,
      timings: data.timings ?? null,
    };
  }
}
