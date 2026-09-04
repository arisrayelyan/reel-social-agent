import type { FastifyInstance } from 'fastify';
import type { ScoreCard, StoryCandidate } from '@reel-agent/shared';

/** Explicit on purpose: `embedding` is a 1024-float vector and never rides to the frontend. */
const COLUMNS = `id, run_id, topic, hook, year, place, summary, money_shot, turn, kicker, scores, risk, risk_note,
            total_score, rank, source_url, source_title, source_status, flags, sources,
            feedback, feedback_reason, feedback_note, feedback_at, video_id, created_at`;

export interface NewStoryCandidate {
  topic: string;
  hook: string;
  year: number | null;
  place: string | null;
  summary: string;
  moneyShot: string;
  turn: string;
  kicker: string;
  scores: ScoreCard;
  risk: string;
  riskNote: string | null;
  totalScore: number;
  rank: number;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceStatus: 'unchecked' | 'reachable' | 'unreachable';
  flags: string[];
  sources: Array<{ url: string; title: string | null }>;
  embedding: number[] | null;
}

export async function insertCandidates(
  app: FastifyInstance,
  runId: number,
  candidates: NewStoryCandidate[],
): Promise<void> {
  for (const c of candidates) {
    await app.pg.query(
      `INSERT INTO story_candidates
         (run_id, topic, hook, year, place, summary, money_shot, turn, kicker, scores, risk, risk_note,
          total_score, rank, source_url, source_title, source_status, flags, sources, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        runId, c.topic, c.hook, c.year, c.place, c.summary, c.moneyShot, c.turn, c.kicker,
        JSON.stringify(c.scores), c.risk, c.riskNote, c.totalScore, c.rank, c.sourceUrl, c.sourceTitle,
        c.sourceStatus, JSON.stringify(c.flags), JSON.stringify(c.sources),
        c.embedding ? JSON.stringify(c.embedding) : null,
      ],
    );
  }
}

/** Ranked list for one run. */
export async function findCandidatesByRun(app: FastifyInstance, runId: number): Promise<StoryCandidate[]> {
  const { rows } = await app.pg.query<StoryCandidate>(
    `SELECT ${COLUMNS} FROM story_candidates WHERE run_id = $1 ORDER BY rank ASC, id ASC`,
    [runId],
  );
  return rows;
}

export async function findCandidateById(app: FastifyInstance, id: number): Promise<StoryCandidate | null> {
  const { rows } = await app.pg.query<StoryCandidate>(
    `SELECT ${COLUMNS} FROM story_candidates WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Like / dislike (+ reason, note); null clears. Reason and note only mean anything on a dislike. */
export async function setCandidateFeedback(
  app: FastifyInstance,
  id: number,
  params: { feedback: 'like' | 'dislike' | null; reason?: string | null; note?: string | null },
): Promise<StoryCandidate | null> {
  const dislike = params.feedback === 'dislike';
  const { rows } = await app.pg.query<StoryCandidate>(
    `UPDATE story_candidates
        SET feedback = $2,
            feedback_reason = $3,
            feedback_note = $4,
            feedback_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, params.feedback, dislike ? (params.reason ?? null) : null, dislike ? (params.note?.trim() || null) : null],
  );
  return rows[0] ?? null;
}

/** Records which video a candidate became — the loop from research to a reel. */
export async function linkCandidateVideo(app: FastifyInstance, id: number, videoId: number): Promise<void> {
  await app.pg.query(`UPDATE story_candidates SET video_id = $2 WHERE id = $1`, [id, videoId]);
}

/**
 * Nearest earlier candidate by cosine similarity, optionally only among one
 * feedback class — "is this close to something the producer already rejected?"
 */
export async function findSimilarCandidate(
  app: FastifyInstance,
  embedding: number[],
  opts: { feedback?: 'like' | 'dislike'; excludeRunId?: number } = {},
): Promise<{ id: number; topic: string; feedback: string | null; similarity: number } | null> {
  const where = ['embedding IS NOT NULL'];
  const params: unknown[] = [JSON.stringify(embedding)];
  if (opts.feedback) {
    params.push(opts.feedback);
    where.push(`feedback = $${params.length}`);
  }
  if (opts.excludeRunId) {
    params.push(opts.excludeRunId);
    where.push(`run_id <> $${params.length}`);
  }
  const { rows } = await app.pg.query<{ id: number; topic: string; feedback: string | null; similarity: number }>(
    `SELECT id, topic, feedback, 1 - (embedding <=> $1::vector) AS similarity
       FROM story_candidates WHERE ${where.join(' AND ')}
      ORDER BY embedding <=> $1::vector LIMIT 1`,
    params,
  );
  const row = rows[0];
  return row ? { ...row, similarity: Number(row.similarity) } : null;
}

export interface FeedbackHistory {
  liked: Array<{ topic: string; hook: string }>;
  disliked: Array<{ topic: string; hook: string; reason: string | null; note: string | null }>;
}

/** The most recent producer verdicts — the memory the next research prompt is built from. */
export async function recentFeedback(app: FastifyInstance, limit = 20): Promise<FeedbackHistory> {
  const { rows } = await app.pg.query<{
    topic: string; hook: string; feedback: 'like' | 'dislike'; feedback_reason: string | null; feedback_note: string | null;
  }>(
    `SELECT topic, hook, feedback, feedback_reason, feedback_note
       FROM story_candidates WHERE feedback IS NOT NULL
      ORDER BY feedback_at DESC LIMIT $1`,
    [limit * 2],
  );
  return {
    liked: rows.filter((r) => r.feedback === 'like').slice(0, limit).map((r) => ({ topic: r.topic, hook: r.hook })),
    disliked: rows
      .filter((r) => r.feedback === 'dislike')
      .slice(0, limit)
      .map((r) => ({ topic: r.topic, hook: r.hook, reason: r.feedback_reason, note: r.feedback_note })),
  };
}
