import type { FastifyInstance } from 'fastify';
import type { Publication, PublicationStatus } from '@reel-agent/shared';

export async function createPublication(
  app: FastifyInstance,
  videoId: number,
  caption: string,
): Promise<Publication> {
  const { rows } = await app.pg.query<Publication>(
    `INSERT INTO publications (video_id, platform, status, caption)
     VALUES ($1, 'tiktok', 'pending', $2) RETURNING *`,
    [videoId, caption],
  );
  return rows[0]!;
}

export async function updatePublication(
  app: FastifyInstance,
  id: number,
  fields: { publishId?: string; status?: PublicationStatus; response?: unknown },
): Promise<void> {
  await app.pg.query(
    `UPDATE publications
        SET publish_id = COALESCE($2, publish_id),
            status = COALESCE($3, status),
            response = COALESCE($4, response),
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      fields.publishId ?? null,
      fields.status ?? null,
      fields.response === undefined ? null : JSON.stringify(fields.response),
    ],
  );
}

export async function findPublicationsByVideo(
  app: FastifyInstance,
  videoId: number,
): Promise<Publication[]> {
  const { rows } = await app.pg.query<Publication>(
    `SELECT * FROM publications WHERE video_id = $1 ORDER BY created_at DESC`,
    [videoId],
  );
  return rows;
}
