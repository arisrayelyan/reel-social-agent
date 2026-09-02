import type { FastifyInstance } from 'fastify';
import type { EventLevel, VideoEvent } from '@reel-agent/shared';

/** One line of the human-readable activity log shown on the video page. */
export async function insertVideoEvent(
  app: FastifyInstance,
  params: { videoId: number; step: string; level: EventLevel; message: string },
): Promise<void> {
  await app.pg.query(
    `INSERT INTO video_events (video_id, step, level, message) VALUES ($1, $2, $3, $4)`,
    [params.videoId, params.step, params.level, params.message],
  );
}

/** Newest first, capped — the video page shows a scrollable log, not history. */
export async function findEventsByVideo(
  app: FastifyInstance,
  videoId: number,
  limit = 200,
): Promise<VideoEvent[]> {
  const { rows } = await app.pg.query<VideoEvent>(
    `SELECT id, video_id, step, level, message, created_at
       FROM video_events WHERE video_id = $1 ORDER BY id DESC LIMIT $2`,
    [videoId, limit],
  );
  return rows;
}
