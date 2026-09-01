import type { FastifyInstance } from 'fastify';
import type { PipelineEvent } from '@reel-agent/shared';

export const EVENTS_CHANNEL = 'pipeline:events';

/** Publishes a progress event on Redis pub/sub; the SSE route forwards it. */
export async function publishEvent(
  app: FastifyInstance,
  event: Omit<PipelineEvent, 'at'>,
): Promise<void> {
  const full: PipelineEvent = { ...event, at: new Date().toISOString() };
  await app.redis.publish(EVENTS_CHANNEL, JSON.stringify(full)).catch((err) => {
    app.log.warn({ err }, 'failed to publish pipeline event');
  });
}
