import type { FastifyInstance } from 'fastify';
import type { PipelineStep, SourceImage, Story, StoryFinding, Video, VideoStatus } from '@reel-agent/shared';

type VideoRow = Video;

/** All videos, newest first. */
export async function findAllVideos(app: FastifyInstance): Promise<VideoRow[]> {
  const { rows } = await app.pg.query<VideoRow>(
    `SELECT id, topic, hook, status, current_step, story, story_versions, story_findings, source_url, source_material, source_images, error,
            total_cost_usd, created_at, updated_at
       FROM videos ORDER BY created_at DESC`,
  );
  return rows;
}

/** One video by id, or null. */
export async function findVideoById(
  app: FastifyInstance,
  id: number,
): Promise<VideoRow | null> {
  const { rows } = await app.pg.query<VideoRow>(
    `SELECT id, topic, hook, status, current_step, story, story_versions, story_findings, source_url, source_material, source_images, error,
            total_cost_usd, created_at, updated_at
       FROM videos WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Creates a bare draft row immediately; the script is generated async. */
export async function createDraftVideo(
  app: FastifyInstance,
  params: { topic: string; embedding: number[] | null; sourceUrl?: string },
): Promise<VideoRow> {
  const { rows } = await app.pg.query<VideoRow>(
    `INSERT INTO videos (topic, status, current_step, topic_embedding, source_url)
     VALUES ($1, 'draft', 'script', $2, $3)
     RETURNING id, topic, hook, status, current_step, story, story_versions, story_findings, source_url, source_material, source_images, error,
               total_cost_usd, created_at, updated_at`,
    [
      params.topic,
      params.embedding ? JSON.stringify(params.embedding) : null,
      params.sourceUrl ?? null,
    ],
  );
  return rows[0]!;
}

/** Fills in scrape results on a from-URL draft before the script is written. */
export async function updateVideoSource(
  app: FastifyInstance,
  id: number,
  params: {
    topic: string;
    embedding: number[] | null;
    sourceMaterial: string;
    sourceImages?: SourceImage[];
  },
): Promise<void> {
  await app.pg.query(
    `UPDATE videos
        SET topic = $2, topic_embedding = $3, source_material = $4,
            source_images = $5::jsonb, updated_at = now()
      WHERE id = $1`,
    [
      id,
      params.topic,
      params.embedding ? JSON.stringify(params.embedding) : null,
      params.sourceMaterial,
      JSON.stringify(params.sourceImages ?? []),
    ],
  );
}

/** Creates a draft video with its first story version. */
export async function createVideo(
  app: FastifyInstance,
  params: { topic: string; hook: string; story: Story; embedding: number[] | null },
): Promise<VideoRow> {
  const { rows } = await app.pg.query<VideoRow>(
    `INSERT INTO videos (topic, hook, status, story, story_versions, topic_embedding)
     VALUES ($1, $2, 'story_review', $3, $4, $5)
     RETURNING id, topic, hook, status, current_step, story, story_versions, story_findings, source_url, source_material, source_images, error,
               total_cost_usd, created_at, updated_at`,
    [
      params.topic,
      params.hook,
      JSON.stringify(params.story),
      JSON.stringify([
        { story: params.story, change_request: null, created_at: new Date().toISOString() },
      ]),
      params.embedding ? JSON.stringify(params.embedding) : null,
    ],
  );
  return rows[0]!;
}

/** Replaces the story after a change request, appending to version history. */
export async function updateVideoStory(
  app: FastifyInstance,
  id: number,
  story: Story,
  changeRequest: string | null,
  findings: StoryFinding[] = [],
): Promise<VideoRow | null> {
  const { rows } = await app.pg.query<VideoRow>(
    `UPDATE videos
        SET story = $2,
            hook = $3,
            topic = $5,
            story_findings = $6::jsonb,
            status = 'story_review',
            current_step = NULL,
            error = NULL,
            story_versions = story_versions || $4::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING id, topic, hook, status, current_step, story, story_versions, story_findings, source_url, source_material, source_images, error,
                total_cost_usd, created_at, updated_at`,
    [
      id,
      JSON.stringify(story),
      story.hook,
      JSON.stringify([
        { story, change_request: changeRequest, created_at: new Date().toISOString(), findings },
      ]),
      story.topic,
      JSON.stringify(findings),
    ],
  );
  return rows[0] ?? null;
}

/**
 * Patches the overlay-layer fields inside videos.story without touching the
 * narration, the beats or the version history — a hook rewrite must not
 * regenerate the script, or the "same content, different hook" comparison the
 * cheap re-render exists for is destroyed.
 */
export async function updateVideoOverlay(
  app: FastifyInstance,
  id: number,
  patch: { overlay_hook?: string | null; evidence_stamp?: string | null },
): Promise<VideoRow | null> {
  const fields: Record<string, string | null> = {};
  if (patch.overlay_hook !== undefined) fields.overlay_hook = patch.overlay_hook;
  if (patch.evidence_stamp !== undefined) fields.evidence_stamp = patch.evidence_stamp;
  const { rows } = await app.pg.query<VideoRow>(
    `UPDATE videos
        SET story = story || $2::jsonb,
            updated_at = now()
      WHERE id = $1 AND story IS NOT NULL
      RETURNING id, topic, hook, status, current_step, story, story_versions, story_findings, source_url, source_material, source_images, error,
                total_cost_usd, created_at, updated_at`,
    [id, JSON.stringify(fields)],
  );
  return rows[0] ?? null;
}

/** Moves the video through the state machine. */
export async function updateVideoStatus(
  app: FastifyInstance,
  id: number,
  status: VideoStatus,
  currentStep: PipelineStep | null = null,
  error: string | null = null,
): Promise<void> {
  await app.pg.query(
    `UPDATE videos SET status = $2, current_step = $3, error = $4, updated_at = now()
      WHERE id = $1`,
    [id, status, currentStep, error],
  );
}

/** Adds to the running cost total (called by every step that spends money). */
export async function addVideoCost(
  app: FastifyInstance,
  id: number,
  costUsd: number,
): Promise<void> {
  await app.pg.query(
    `UPDATE videos SET total_cost_usd = total_cost_usd + $2, updated_at = now() WHERE id = $1`,
    [id, costUsd],
  );
}

/** Highest cosine similarity between the candidate embedding and existing topics. */
export async function findMostSimilarTopic(
  app: FastifyInstance,
  embedding: number[],
): Promise<{ id: number; topic: string; similarity: number } | null> {
  const { rows } = await app.pg.query<{ id: number; topic: string; similarity: number }>(
    `SELECT id, topic, 1 - (topic_embedding <=> $1::vector) AS similarity
       FROM videos WHERE topic_embedding IS NOT NULL
      ORDER BY topic_embedding <=> $1::vector LIMIT 1`,
    [JSON.stringify(embedding)],
  );
  const row = rows[0];
  return row ? { ...row, similarity: Number(row.similarity) } : null;
}

export async function deleteVideo(app: FastifyInstance, id: number): Promise<boolean> {
  const { rowCount } = await app.pg.query(`DELETE FROM videos WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
