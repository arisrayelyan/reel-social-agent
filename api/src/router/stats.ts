import type { FastifyInstance } from 'fastify';

export async function statsRouter(app: FastifyInstance): Promise<void> {
  app.get('/stats', async () => {
    const [videos, runs, unattributed] = await Promise.all([
      app.pg.query<{ status: string; count: string; cost: string }>(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cost_usd), 0) AS cost
           FROM videos GROUP BY status`,
      ),
      app.pg.query<{ provider: string; count: string; cost: string }>(
        `SELECT provider, COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS cost
           FROM generation_runs GROUP BY provider`,
      ),
      // research runs and topic suggestions have no video to carry their cost
      app.pg.query<{ cost: string }>(
        `SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM generation_runs WHERE video_id IS NULL`,
      ),
    ]);

    const byStatus = Object.fromEntries(videos.rows.map((r) => [r.status, Number(r.count)]));
    const totalVideos = videos.rows.reduce((sum, r) => sum + Number(r.count), 0);
    const totalCost = videos.rows.reduce((sum, r) => sum + Number(r.cost), 0);

    return {
      total_videos: totalVideos,
      by_status: byStatus,
      total_cost_usd: Number(totalCost.toFixed(4)),
      avg_cost_usd: totalVideos > 0 ? Number((totalCost / totalVideos).toFixed(4)) : 0,
      total_runs: runs.rows.reduce((sum, r) => sum + Number(r.count), 0),
      cost_by_provider: Object.fromEntries(
        runs.rows.map((r) => [r.provider, Number(Number(r.cost).toFixed(4))]),
      ),
      research_cost_usd: Number(Number(unattributed.rows[0]?.cost ?? 0).toFixed(4)),
    };
  });
}
