import fp from 'fastify-plugin';
import { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { PipelineStep } from '@reel-agent/shared';

export const PIPELINE_QUEUE = 'pipeline';

/** Which fal tier a clips job renders on. */
export type RenderTier = 'draft' | 'premium';

export interface PipelineJobData {
  videoId: number;
  step: PipelineStep;
  /** clips only: 'draft' unless a producer promoted specific beats. */
  tier?: RenderTier;
  /** clips only: re-render just these beats, leaving the rest untouched. */
  beatIndexes?: number[];
}

/** Render chain order. TTS runs first: clip durations derive from real audio. */
export const RENDER_CHAIN: PipelineStep[] = ['tts', 'images', 'clips', 'merge', 'captions'];

declare module 'fastify' {
  interface FastifyInstance {
    pipelineQueue: Queue<PipelineJobData>;
  }
}

/** Decorates app.pipelineQueue (must be registered after the redis plugin). */
export const queuePlugin = fp(async (app: FastifyInstance) => {
  const queue = new Queue<PipelineJobData>(PIPELINE_QUEUE, {
    connection: app.redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  app.decorate('pipelineQueue', queue);
  app.addHook('onClose', async () => {
    await queue.close();
  });
});

export async function enqueueStep(
  app: FastifyInstance,
  videoId: number,
  step: PipelineStep,
  extras: Pick<PipelineJobData, 'tier' | 'beatIndexes'> = {},
): Promise<void> {
  // jobId already carries Date.now(), so a premium re-render never collides
  // with the draft job that produced the take it is replacing
  await app.pipelineQueue.add(
    step,
    { videoId, step, ...extras },
    { jobId: `${videoId}:${step}:${Date.now()}` },
  );
}

export function nextRenderStep(step: PipelineStep): PipelineStep | null {
  const idx = RENDER_CHAIN.indexOf(step);
  if (idx === -1 || idx === RENDER_CHAIN.length - 1) return null;
  return RENDER_CHAIN[idx + 1] ?? null;
}
