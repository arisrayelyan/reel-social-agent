import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CandidateFeedbackBodySchema,
  LlmResearchSchema,
  ResearchIdParamSchema,
  StartResearchBodySchema,
  type LlmResearchCandidate,
  type Provider,
} from '@reel-agent/shared';
import { FirecrawlClient } from '../clients/firecrawl.js';
import { generateJsonWithRetry, getProvider, type LlmProvider } from '../llm/index.js';
import { embedText } from '../llm/ollama.js';
import { buildResearchPrompt, researchSystem } from '../llm/prompts.js';
import { insertGenerationRun } from '../database/queries/generationRuns.js';
import {
  createResearchRun,
  deleteResearchRun,
  failResearchRun,
  findResearchRunById,
  findResearchRuns,
  finishResearchRun,
} from '../database/queries/researchRuns.js';
import {
  findCandidateById,
  findCandidatesByRun,
  findSimilarCandidate,
  insertCandidates,
  recentFeedback,
  setCandidateFeedback,
  type NewStoryCandidate,
} from '../database/queries/storyCandidates.js';
import { findAllVideos, findMostSimilarTopic } from '../database/queries/videos.js';
import { rankCandidates, totalScore } from '../utils/researchRank.js';
import { checkUrl } from '../utils/sourceCheck.js';

/** Same bar as machine-suggested topics on the Generate page. */
const VIDEO_SIMILARITY = 0.82;
/** Close enough to a rejected candidate to inherit the rejection. */
const REJECTED_SIMILARITY = 0.85;
/** Already proposed in an earlier run. */
const SEEN_SIMILARITY = 0.9;
/** Firecrawl search bills 2 credits per 10 results; we ask for 3. */
const SEARCH_CREDITS = 2;
/** How many recent likes/dislikes reach the prompt. */
const FEEDBACK_LIMIT = 20;

/**
 * Background researcher: one provider call for the whole set, then per
 * candidate a free embedding pass (dedupe against videos, rejected and
 * earlier candidates), a free reachability check on the model's source link,
 * and — only when the producer ticked the box — one Firecrawl search. Every
 * per-candidate step degrades to a flag; only the provider call can fail the run.
 */
function runResearch(
  app: FastifyInstance,
  opts: {
    runId: number;
    providerName: Provider;
    provider: LlmProvider;
    count: number;
    brief: string | null;
    useSources: boolean;
  },
): void {
  void (async () => {
    let prompt: string | null = null;
    try {
      const [videos, feedback] = await Promise.all([findAllVideos(app), recentFeedback(app, FEEDBACK_LIMIT)]);
      prompt = buildResearchPrompt(app.config.promptsDir, {
        count: opts.count,
        brief: opts.brief,
        catalogue: videos.map((v) => ({ topic: v.topic, status: v.status })),
        liked: feedback.liked,
        disliked: feedback.disliked,
      });

      const startedAt = Date.now();
      const result = await generateJsonWithRetry(opts.provider, {
        system: researchSystem(app.config.promptsDir),
        prompt,
        schema: LlmResearchSchema,
      });
      await insertGenerationRun(app, {
        videoId: null,
        step: 'research',
        provider: opts.providerName,
        model: result.model,
        prompt: `research run ${opts.runId}`,
        output: { run_id: opts.runId, candidates: result.data.candidates.length },
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
      });

      const firecrawl = opts.useSources ? new FirecrawlClient(app.config) : null;
      let searchCost = 0;
      const scored: NewStoryCandidate[] = [];
      for (const c of result.data.candidates) {
        const built = await assessCandidate(app, c, opts.runId, firecrawl);
        searchCost += built.searchCost;
        scored.push(built.candidate);
      }

      const ranked = rankCandidates(scored);
      await insertCandidates(app, opts.runId, ranked);
      await finishResearchRun(app, opts.runId, {
        prompt,
        model: result.model,
        costUsd: Number((result.costUsd + searchCost).toFixed(4)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err, runId: opts.runId }, 'research run failed');
      await failResearchRun(app, opts.runId, message, prompt);
    }
  })();
}

async function assessCandidate(
  app: FastifyInstance,
  c: LlmResearchCandidate,
  runId: number,
  firecrawl: FirecrawlClient | null,
): Promise<{ candidate: NewStoryCandidate; searchCost: number }> {
  const flags: string[] = [];
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(app.config.ollamaUrl, app.config.ollamaEmbedModel, c.topic);
    const video = await findMostSimilarTopic(app, embedding);
    if (video && video.similarity > VIDEO_SIMILARITY) flags.push(`similar_to_video:${video.id}`);
    const rejected = await findSimilarCandidate(app, embedding, { feedback: 'dislike', excludeRunId: runId });
    if (rejected && rejected.similarity > REJECTED_SIMILARITY) flags.push('near_rejected');
    const prior = await findSimilarCandidate(app, embedding, { excludeRunId: runId });
    if (prior && prior.similarity > SEEN_SIMILARITY && prior.feedback !== 'like') flags.push('seen_before');
  } catch (err) {
    app.log.warn({ err, topic: c.topic }, 'embedding unavailable — candidate kept without dedupe');
  }

  let sourceUrl = c.source_url?.trim() || null;
  let sourceTitle = c.source_title?.trim() || null;
  let sourceStatus: NewStoryCandidate['sourceStatus'] = 'unchecked';
  if (sourceUrl) {
    sourceStatus = await checkUrl(sourceUrl);
    if (sourceStatus === 'unreachable') flags.push('source_unreachable');
  } else {
    flags.push('no_source');
  }

  let sources: NewStoryCandidate['sources'] = [];
  let searchCost = 0;
  if (firecrawl) {
    try {
      const query = [c.topic, c.place, c.year].filter(Boolean).join(' ');
      const hits = await firecrawl.search(query, 3);
      searchCost = SEARCH_CREDITS * app.config.firecrawlCostPerPageUsd;
      sources = hits.map((h) => ({ url: h.url, title: h.title }));
      // a dead or missing model link is repaired by the top real hit
      if (sourceStatus !== 'reachable' && hits[0]) {
        const status = await checkUrl(hits[0].url);
        if (status === 'reachable') {
          sourceUrl = hits[0].url;
          sourceTitle = hits[0].title;
          sourceStatus = 'reachable';
          for (const f of ['source_unreachable', 'no_source']) {
            const i = flags.indexOf(f);
            if (i >= 0) flags.splice(i, 1);
          }
        }
      }
    } catch (err) {
      app.log.warn({ err, topic: c.topic }, 'firecrawl search failed — candidate kept without extra sources');
    }
  }

  const candidate: NewStoryCandidate = {
    topic: c.topic,
    hook: c.hook,
    year: c.year ?? null,
    place: c.place ?? null,
    summary: c.summary,
    moneyShot: c.money_shot,
    turn: c.turn,
    kicker: c.kicker,
    scores: c.scores,
    risk: c.risk,
    riskNote: c.risk_note ?? null,
    totalScore: totalScore(c.scores, flags, c.risk),
    rank: 0,
    sourceUrl,
    sourceTitle,
    sourceStatus,
    flags,
    sources,
    embedding,
  };
  return { candidate, searchCost };
}

export async function researchRouter(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Starts a research run and returns it immediately; the page polls it. */
  r.post(
    '/research/runs',
    { schema: { body: StartResearchBodySchema } },
    async (request, reply) => {
      const { provider: providerName, model, brief, count, use_sources } = request.body;
      if (use_sources && !app.config.firecrawlApiKey) {
        return reply.code(400).send({
          error: 'FIRECRAWL_API_KEY is not set (api/.env) — untick web sources or add a key',
        });
      }
      const provider = getProvider(app.config, providerName, model);
      const run = await createResearchRun(app, {
        provider: providerName,
        model: model ?? providerName,
        brief: brief?.trim() || null,
        count,
        useSources: use_sources,
      });
      runResearch(app, {
        runId: run.id,
        providerName,
        provider,
        count,
        brief: run.brief,
        useSources: use_sources,
      });
      return reply.code(202).send({ run });
    },
  );

  r.get('/research/runs', async () => findResearchRuns(app));

  r.get(
    '/research/runs/:id',
    { schema: { params: ResearchIdParamSchema } },
    async (request, reply) => {
      const run = await findResearchRunById(app, request.params.id);
      if (!run) return reply.code(404).send({ error: 'Research run not found' });
      const candidates = await findCandidatesByRun(app, run.id);
      return { ...run, candidates };
    },
  );

  r.delete(
    '/research/runs/:id',
    { schema: { params: ResearchIdParamSchema } },
    async (request, reply) => {
      const deleted = await deleteResearchRun(app, request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Research run not found' });
      return { ok: true };
    },
  );

  /** Like / dislike a candidate. This is the memory the next run reads. */
  r.patch(
    '/research/candidates/:id/feedback',
    { schema: { params: ResearchIdParamSchema, body: CandidateFeedbackBodySchema } },
    async (request, reply) => {
      const existing = await findCandidateById(app, request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Candidate not found' });
      const updated = await setCandidateFeedback(app, existing.id, {
        feedback: request.body.feedback,
        reason: request.body.reason ?? null,
        note: request.body.note ?? null,
      });
      return updated;
    },
  );
}
