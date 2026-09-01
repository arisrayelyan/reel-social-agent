import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { videosRouter } from './videos.js';
import { generateRouter } from './generate.js';
import { settingsRouter } from './settings.js';
import { tiktokRouter } from './tiktok.js';
import { statsRouter } from './stats.js';

/** All feature routers mount under a single /api prefix. */
export async function registerRouter(app: FastifyInstance): Promise<void> {
  await app.register(
    async (api) => {
      await api.register(videosRouter);
      await api.register(generateRouter);
      await api.register(settingsRouter);
      await api.register(tiktokRouter);
      await api.register(statsRouter);
      api.get('/health', async () => ({ ok: true }));
    },
    { prefix: '/api' },
  );

  // generated media (images/clips/audio/exports) for dashboard previews
  await app.register(fastifyStatic, {
    root: app.config.storageDir,
    prefix: '/media/',
    decorateReply: false,
  });
}
