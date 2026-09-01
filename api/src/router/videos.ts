import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PipelineEventSchema, VideoIdParamSchema } from '@reel-agent/shared';
import {
  deleteVideo,
  findAllVideos,
  findVideoById,
  updateVideoStatus,
} from '../database/queries/videos.js';
import { findAssetsByVideo, selectAssetTake } from '../database/queries/assets.js';
import { findRunsByVideo } from '../database/queries/generationRuns.js';
import { findPublicationsByVideo } from '../database/queries/publications.js';
import { enqueueStep, RENDER_CHAIN } from '../pipeline/queue.js';
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
      const [assets, runs, publications] = await Promise.all([
        findAssetsByVideo(app, video.id),
        findRunsByVideo(app, video.id),
        findPublicationsByVideo(app, video.id),
      ]);
      return { ...video, assets, runs, publications };
    },
  );

  r.delete(
    '/videos/:id',
    { schema: { params: VideoIdParamSchema } },
    async (request, reply) => {
      const deleted = await deleteVideo(app, request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Video not found' });
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
      await enqueueStep(app, video.id, video.current_step);
      return { ok: true };
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
