import type { FastifyInstance } from 'fastify';
import type { PipelineEvent } from '@reel-agent/shared';
import { insertVideoEvent } from '../database/queries/videoEvents.js';

export const EVENTS_CHANNEL = 'pipeline:events';

/**
 * Publishes a progress event on Redis pub/sub (the SSE route forwards it) and
 * persists it to video_events — the human-readable activity log on the video
 * page. Both writes are best-effort: a logging hiccup must never fail a step.
 */
export async function publishEvent(
  app: FastifyInstance,
  event: Omit<PipelineEvent, 'at'>,
): Promise<void> {
  const full: PipelineEvent = { ...event, at: new Date().toISOString() };
  await app.redis.publish(EVENTS_CHANNEL, JSON.stringify(full)).catch((err) => {
    app.log.warn({ err }, 'failed to publish pipeline event');
  });
  await insertVideoEvent(app, {
    videoId: full.video_id,
    step: full.step,
    level: full.level ?? (full.status === 'failed' ? 'error' : 'info'),
    message: full.message ?? `${full.step} ${full.status}`,
  }).catch((err) => {
    app.log.warn({ err }, 'failed to persist video event');
  });
}
