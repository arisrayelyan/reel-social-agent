import path from 'node:path';
import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PipelineEventSchema,
  UpdateOverlayBodySchema,
  UpgradeClipsBodySchema,
  VideoIdParamSchema,
} from '@reel-agent/shared';
import {
  deleteVideo,
  findAllVideos,
  findVideoById,
  updateVideoOverlay,
  updateVideoStatus,
} from '../database/queries/videos.js';
import { findAssetsByVideo, selectAssetTake } from '../database/queries/assets.js';
import { findRunsByVideo } from '../database/queries/generationRuns.js';
import { findPublicationsByVideo } from '../database/queries/publications.js';
import { findEventsByVideo } from '../database/queries/videoEvents.js';
import { enqueueStep, RENDER_CHAIN } from '../pipeline/queue.js';
import { costPerSecondFor } from '../clients/falModels.js';
import { EVENTS_CHANNEL } from '../pipeline/events.js';

export async function videosRouter(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/videos', async () => findAllVideos(app));

  r.get(
    '/videos/:id',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });
      const [assets, runs, publications, events] = await Promise.all([
        findAssetsByVideo(app, video.id),
        findRunsByVideo(app, video.id),
        findPublicationsByVideo(app, video.id),
        findEventsByVideo(app, video.id),
      ]);
      return { ...video, assets, runs, publications, events };
    },
  );

  /**
   * Deletes a video and everything it owns: pending pipeline jobs (so the
   * worker never runs a step for a row that is gone), the DB row (assets,
   * runs and publications cascade), and the media directory on disk. Job and
   * file cleanup are best-effort — a Redis or fs hiccup must not leave the
   * video undeletable.
   */
  r.delete(
    '/videos/:id',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const id = request.params.id;
      try {
        const jobs = await app.pipelineQueue.getJobs(['waiting', 'delayed', 'prioritized']);
        await Promise.all(
          jobs
            .filter((job) => job.data.videoId === id)
            .map((job) => job.remove().catch(() => undefined)),
        );
      } catch (err) {
        app.log.warn({ err, videoId: id }, 'pipeline job cleanup failed — deleting video anyway');
      }

      const deleted = await deleteVideo(app, id);
      if (!deleted) return reply.code(404).send({ error: 'Video not found' });

      const mediaDir = path.join(app.config.storageDir, 'videos', String(id));
      await rm(mediaDir, { recursive: true, force: true }).catch((err) => {
        app.log.warn({ err, mediaDir, videoId: id }, 'failed to remove media directory');
      });

      return { ok: true };
    },
  );

  /** Story approved → kick off the render chain (tts first: audio drives timing). */
  r.post(
    '/videos/:id/approve-story',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });
      if (video.status !== 'story_review') {
        return reply.code(409).send({ error: `Cannot approve from status "${video.status}"` });
      }
      await updateVideoStatus(app, video.id, 'approved', null);
      await enqueueStep(app, video.id, RENDER_CHAIN[0]!);
      return { ok: true };
    },
  );

  /** Render approved → push to TikTok drafts. */
  r.post(
    '/videos/:id/approve-render',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });
      if (video.status !== 'render_review') {
        return reply.code(409).send({ error: `Cannot publish from status "${video.status}"` });
      }
      await enqueueStep(app, video.id, 'publish');
      return { ok: true };
    },
  );

  /** Retry a failed video from its failed step (idempotent — paid assets are reused). */
  r.post(
    '/videos/:id/retry',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });
      if (video.status !== 'failed' || !video.current_step) {
        return reply.code(409).send({ error: 'Only failed videos can be retried' });
      }
      if (video.current_step === 'script') {
        return reply.code(409).send({
          error:
            'Script generation is not a queue step — request changes to regenerate, or delete the video and generate again',
        });
      }
      await enqueueStep(app, video.id, video.current_step);
      return { ok: true };
    },
  );

  /**
   * Rewrites the on-screen hook or the Evidence File stamp and re-renders the
   * captions over the EXISTING merged video.
   *
   * Costs nothing: no other step's content hash reads these fields, so tts,
   * images, clips and merge all skip on their existing hashes and only the
   * captions hash changes. The previous take is kept as final_v1.
   */
  r.patch(
    '/videos/:id/overlay',
    { schema: { params: VideoIdParamSchema, body: UpdateOverlayBodySchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });
      if (!video.story) return reply.code(409).send({ error: 'This video has no story yet' });

      const updated = await updateVideoOverlay(app, video.id, request.body);
      if (!updated) return reply.code(404).send({ error: 'Video not found' });

      // Only re-render when there is something to render over. Before that,
      // the next render picks the new values up on its own.
      if (video.status === 'render_review') {
        await updateVideoStatus(app, video.id, 'rendering', 'captions');
        await enqueueStep(app, video.id, 'captions');
        return { video: updated, rerendering: true };
      }
      return { video: updated, rerendering: false };
    },
  );

  /**
   * Re-renders the named beats on the premium model.
   *
   * The clip content hash already includes model and resolution, so a tier
   * switch misses the existing hash, writes a new take, and the whole
   * downstream cascade (merge → captions → render_review) re-runs on its own.
   * The draft take is never destroyed.
   */
  r.post(
    '/videos/:id/upgrade-clips',
    { schema: { params: VideoIdParamSchema, body: UpgradeClipsBodySchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });
      if (video.status !== 'render_review') {
        return reply.code(409).send({ error: `Cannot upgrade clips from status "${video.status}"` });
      }
      if (!app.config.falVideoModelDraft) {
        return reply.code(409).send({
          error: 'Tiering is off — set FAL_VIDEO_MODEL_DRAFT to render drafts cheaply first',
        });
      }

      const beatCount = video.story?.beats.length ?? 0;
      const invalid = request.body.beat_indexes.filter((i) => i >= beatCount);
      if (invalid.length > 0) {
        return reply.code(400).send({ error: `No such beat: ${invalid.join(', ')}` });
      }

      await updateVideoStatus(app, video.id, 'rendering', 'clips');
      await enqueueStep(app, video.id, 'clips', {
        tier: 'premium',
        beatIndexes: request.body.beat_indexes,
      });
      return { ok: true, upgrading: request.body.beat_indexes.length };
    },
  );

  /**
   * What a premium re-render of these beats would cost, from the recorded clip
   * durations — so the producer sees the number before spending it.
   */
  r.get(
    '/videos/:id/upgrade-estimate',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const video = await findVideoById(app, request.params.id);
      if (!video) return reply.code(404).send({ error: 'Video not found' });

      const clips = (await findAssetsByVideo(app, video.id)).filter(
        (asset) => asset.kind === 'clip' && asset.selected,
      );
      const perSecond = costPerSecondFor(
        app.config.falVideoModel,
        app.config.falCostPerSecondUsdMap,
        app.config.falCostPerSecondUsd,
      );
      const beats = clips.map((clip) => ({
        beat_index: clip.beat_index ?? 0,
        seconds: Number(clip.duration_seconds ?? 0),
        cost_usd: Number((Number(clip.duration_seconds ?? 0) * perSecond).toFixed(4)),
      }));
      return {
        premium_model: app.config.falVideoModel,
        draft_model: app.config.falVideoModelDraft || null,
        per_second_usd: perSecond,
        beats,
        total_usd: Number(beats.reduce((sum, b) => sum + b.cost_usd, 0).toFixed(4)),
      };
    },
  );

  /** Pick a different take for a beat's keyframe/clip/audio. */
  r.post(
    '/assets/:id/select',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      const asset = await selectAssetTake(app, request.params.id);
      if (!asset) return reply.code(404).send({ error: 'Asset not found' });
      return asset;
    },
  );

  /** Live pipeline progress over SSE, backed by Redis pub/sub. */
  r.get(
    '/videos/:id/events',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const videoId = request.params.id;
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': app.config.corsOrigin,
      });
      reply.raw.write(': connected\n\n');

      const listener = (_channel: string, message: string) => {
        try {
          const event = PipelineEventSchema.parse(JSON.parse(message));
          if (event.video_id === videoId) reply.raw.write(`data: ${message}\n\n`);
        } catch {
          // ignore malformed events
        }
      };
      await app.redisSub.subscribe(EVENTS_CHANNEL);
      app.redisSub.on('message', listener);
      const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

      request.raw.on('close', () => {
        clearInterval(ping);
        app.redisSub.off('message', listener);
      });
    },
  );
}
