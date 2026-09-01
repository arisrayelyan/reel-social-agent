import type { FastifyInstance } from 'fastify';
import type { GenerationRun } from '@reel-agent/shared';

export interface NewGenerationRun {
  videoId: number | null;
  step: string;
  provider: string;
  model: string;
  prompt?: string | null;
  output?: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd: number;
  durationMs?: number | null;
  status?: 'succeeded' | 'failed';
}

/** Records one AI call (LLM, image, video, TTS) for the cost dashboard. */
export async function insertGenerationRun(
  app: FastifyInstance,
  run: NewGenerationRun,
): Promise<number> {
  const { rows } = await app.pg.query<{ id: number }>(
    `INSERT INTO generation_runs
       (video_id, step, provider, model, prompt, output, input_tokens, output_tokens,
        cost_usd, duration_ms, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      run.videoId,
      run.step,
      run.provider,
      run.model,
      run.prompt ?? null,
      run.output === undefined ? null : JSON.stringify(run.output),
      run.inputTokens ?? null,
      run.outputTokens ?? null,
      run.costUsd,
      run.durationMs ?? null,
      run.status ?? 'succeeded',
    ],
  );
  return rows[0]!.id;
}

/** All runs for one video, oldest first (cost breakdown table). */
export async function findRunsByVideo(
  app: FastifyInstance,
  videoId: number,
): Promise<GenerationRun[]> {
  const { rows } = await app.pg.query<GenerationRun>(
    `SELECT id, video_id, step, provider, model, prompt, output, input_tokens,
            output_tokens, cost_usd, duration_ms, status, created_at
       FROM generation_runs WHERE video_id = $1 ORDER BY created_at ASC`,
    [videoId],
  );
  return rows;
}
