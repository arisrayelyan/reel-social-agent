import { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { StorySchema, type PipelineStep } from '@reel-agent/shared';
import { PIPELINE_QUEUE, enqueueStep, nextRenderStep, type PipelineJobData } from './queue.js';
import { publishEvent } from './events.js';
import { findVideoById, updateVideoStatus } from '../database/queries/videos.js';
import { TelegramClient } from '../clients/telegram.js';
import { runTtsStep } from './steps/tts.js';
import { runImagesStep } from './steps/images.js';
import { runClipsStep } from './steps/clips.js';
import { runMergeStep } from './steps/merge.js';
import { runCaptionsStep } from './steps/captions.js';
import { runPublishStep } from './steps/publish.js';

/**
 * In-process BullMQ worker. Postgres (videos.status) is the source of truth;
 * Redis only carries transient job state. Every step is idempotent via
 * content-hash asset lookups, so BullMQ's retries never regenerate paid work.
 */
export function startWorker(app: FastifyInstance): Worker<PipelineJobData> {
  const worker = new Worker<PipelineJobData>(
    PIPELINE_QUEUE,
    async (job) => {
      const { videoId, step } = job.data;
      const video = await findVideoById(app, videoId);
      if (!video) throw new Error(`Video ${videoId} not found`);
      if (!video.story) throw new Error(`Video ${videoId} has no approved story`);
      const story = StorySchema.parse(video.story);

      app.log.info({ videoId, step }, 'pipeline step started');
      await publishEvent(app, { video_id: videoId, step, status: 'started' });
      await updateVideoStatus(app, videoId, step === 'publish' ? 'publishing' : 'rendering', step);

      switch (step) {
        case 'tts':
          await runTtsStep(app, videoId, story);
          break;
        case 'images':
          await runImagesStep(app, videoId, story);
          break;
        case 'clips':
          await runClipsStep(app, videoId, story);
          break;
        case 'merge':
          await runMergeStep(app, videoId, story);
          break;
        case 'captions':
          await runCaptionsStep(app, videoId);
          break;
        case 'publish':
          await runPublishStep(app, videoId, story);
          break;
        default:
          throw new Error(`Step "${String(step)}" is not a queue-executed step`);
      }

      await publishEvent(app, { video_id: videoId, step, status: 'completed' });

      const next = step === 'publish' ? null : nextRenderStep(step);
      if (next) {
        await enqueueStep(app, videoId, next);
      } else if (step === 'captions') {
        await updateVideoStatus(app, videoId, 'render_review', null);
        const telegram = new TelegramClient(app.config);
        await telegram
          .notifyApprovalNeeded({ videoId, topic: story.topic })
          .catch((err) => app.log.warn({ err }, 'telegram notify failed'));
      } else if (step === 'publish') {
        await updateVideoStatus(app, videoId, 'published', null);
      }
    },
    {
      connection: app.redis,
      concurrency: 2, // videos in parallel; per-beat fan-out lives inside steps
    },
  );

  worker.on('failed', (job, err) => {
    void (async () => {
      if (!job || (job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return; // retries remain
      const { videoId, step } = job.data;
      app.log.error({ videoId, step, err }, 'pipeline step failed permanently');
      await updateVideoStatus(app, videoId, 'failed', step as PipelineStep, err.message);
      await publishEvent(app, { video_id: videoId, step, status: 'failed', message: err.message });
      const video = await findVideoById(app, videoId);
      const telegram = new TelegramClient(app.config);
      await telegram
        .notifyFailure({ videoId, topic: video?.topic ?? `#${videoId}`, step, error: err.message })
        .catch(() => undefined);
    })().catch((e) => app.log.error(e, 'failed-handler error'));
  });

  return worker;
}
