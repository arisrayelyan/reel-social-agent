import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    /** Dedicated connection for pub/sub subscribers (a subscribing conn can't run commands). */
    redisSub: Redis;
  }
}

export default fp(async (app: FastifyInstance, opts: { config: AppConfig }) => {
  // maxRetriesPerRequest must be null for BullMQ compatibility
  const redis = new Redis(opts.config.redisUrl, { maxRetriesPerRequest: null });
  const redisSub = new Redis(opts.config.redisUrl, { maxRetriesPerRequest: null });
  app.decorate('redis', redis);
  app.decorate('redisSub', redisSub);
  app.addHook('onClose', async () => {
    await redis.quit().catch(() => redis.disconnect());
    await redisSub.quit().catch(() => redisSub.disconnect());
  });
});
