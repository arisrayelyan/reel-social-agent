import type { FastifyInstance } from 'fastify';
import type { ResearchRun } from '@reel-agent/shared';

const RUN_COLUMNS = `r.id, r.status, r.provider, r.model, r.brief, r.count, r.use_sources, r.prompt, r.error,
            r.cost_usd, r.created_at, r.finished_at,
            COUNT(c.id)::int                                   AS candidate_count,
            COUNT(c.id) FILTER (WHERE c.feedback = 'like')::int    AS liked_count,
            COUNT(c.id) FILTER (WHERE c.feedback = 'dislike')::int AS disliked_count`;
const RUN_FROM = `FROM research_runs r LEFT JOIN story_candidates c ON c.run_id = r.id`;
const RUN_GROUP = `GROUP BY r.id`;

/** Opens a run in `running`; the background researcher fills it in. */
export async function createResearchRun(
  app: FastifyInstance,
  params: { provider: string; model: string; brief: string | null; count: number; useSources: boolean },
): Promise<ResearchRun> {
  const { rows } = await app.pg.query<{ id: number }>(
    `INSERT INTO research_runs (provider, model, brief, count, use_sources)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [params.provider, params.model, params.brief, params.count, params.useSources],
  );
  return (await findResearchRunById(app, rows[0]!.id))!;
}

export async function finishResearchRun(
  app: FastifyInstance,
  id: number,
  params: { prompt: string; model: string; costUsd: number },
): Promise<void> {
  await app.pg.query(
    `UPDATE research_runs
        SET status = 'succeeded', prompt = $2, model = $3, cost_usd = $4, finished_at = now()
      WHERE id = $1`,
    [id, params.prompt, params.model, params.costUsd],
  );
}

export async function failResearchRun(
  app: FastifyInstance,
  id: number,
  error: string,
  prompt: string | null,
): Promise<void> {
  await app.pg.query(
    `UPDATE research_runs
        SET status = 'failed', error = $2, prompt = COALESCE($3, prompt), finished_at = now()
      WHERE id = $1`,
    [id, error.slice(0, 2000), prompt],
  );
}

/** Newest first, with candidate and feedback counts for the history rail. */
export async function findResearchRuns(app: FastifyInstance): Promise<ResearchRun[]> {
  const { rows } = await app.pg.query<ResearchRun>(
    `SELECT ${RUN_COLUMNS} ${RUN_FROM} ${RUN_GROUP} ORDER BY r.created_at DESC LIMIT 100`,
  );
  return rows;
}

export async function findResearchRunById(app: FastifyInstance, id: number): Promise<ResearchRun | null> {
  const { rows } = await app.pg.query<ResearchRun>(
    `SELECT ${RUN_COLUMNS} ${RUN_FROM} WHERE r.id = $1 ${RUN_GROUP}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteResearchRun(app: FastifyInstance, id: number): Promise<boolean> {
  const { rowCount } = await app.pg.query(`DELETE FROM research_runs WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
