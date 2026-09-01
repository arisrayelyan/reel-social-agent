import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  GenerateStoryBodySchema,
  LlmStorySchema,
  SuggestTopicsBodySchema,
  TopicIdeasSchema,
  type Provider,
} from '@reel-agent/shared';
import { generateJsonWithRetry, getProvider, type LlmProvider } from '../llm/index.js';
import { embedText } from '../llm/ollama.js';
import {
  buildChangeRequestPrompt,
  buildStoryPrompt,
  buildTopicPrompt,
  storySystem,
  topicsSystem,
} from '../llm/prompts.js';
import { postProcessStory } from '../utils/storyPost.js';
import {
  addVideoCost,
  createDraftVideo,
  findAllVideos,
  findMostSimilarTopic,
  findVideoById,
  updateVideoStatus,
  updateVideoStory,
} from '../database/queries/videos.js';
import { insertGenerationRun } from '../database/queries/generationRuns.js';
import { publishEvent } from '../pipeline/events.js';

/** Hard reject when an explicit topic nearly duplicates an existing video. */
const SIMILARITY_THRESHOLD = 0.9;
/** Stricter filter for machine-suggested ideas — each generation must differ. */
const SUGGESTION_SIMILARITY_THRESHOLD = 0.82;

/**
 * Runs script generation in the background so the HTTP request returns
 * instantly — the frontend redirects to the video page, which shows the
 * draft/"writing" state live (SSE + polling). Reasoning models can take
 * 5-15 minutes, far beyond a sane request timeout.
 */
function runStoryGeneration(
  app: FastifyInstance,
  opts: {
    videoId: number;
    providerName: Provider;
    provider: LlmProvider;
    prompt: string;
    changeRequest: string | null;
    runPrompt: string;
  },
): void {
  void (async () => {
    const startedAt = Date.now();
    await publishEvent(app, {
      video_id: opts.videoId,
      step: 'script',
      status: 'started',
      message: `Writing script with ${opts.providerName}`,
    });
    try {
      const result = await generateJsonWithRetry(opts.provider, {
        system: storySystem(app.config.promptsDir),
        prompt: opts.prompt,
        schema: LlmStorySchema,
      });
      const processed = postProcessStory(result.data);
      await insertGenerationRun(app, {
        videoId: opts.videoId,
        step: 'script',
        provider: opts.providerName,
        model: result.model,
        prompt: opts.runPrompt,
        output: processed.warnings.length ? { warnings: processed.warnings } : null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
      });
      await addVideoCost(app, opts.videoId, result.costUsd);
      await updateVideoStory(app, opts.videoId, processed.story, opts.changeRequest);
      await publishEvent(app, {
        video_id: opts.videoId,
        step: 'script',
        status: 'completed',
        message: processed.warnings.join('; ') || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err, videoId: opts.videoId }, 'script generation failed');
      await insertGenerationRun(app, {
        videoId: opts.videoId,
        step: 'script',
        provider: opts.providerName,
        model: 'unknown',
        prompt: opts.runPrompt,
        output: { error: message.slice(0, 2000) },
        costUsd: 0,
        durationMs: Date.now() - startedAt,
        status: 'failed',
      }).catch(() => undefined);
      await updateVideoStatus(app, opts.videoId, 'failed', 'script', message.slice(0, 2000));
      await publishEvent(app, {
        video_id: opts.videoId,
        step: 'script',
        status: 'failed',
        message: message.slice(0, 300),
      });
    }
  })();
}

export async function generateRouter(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Kicks off (or re-kicks with a change request) story generation and
   * returns the video row immediately — generation completes in background.
   */
  r.post(
    '/generate/story',
    { schema: { body: GenerateStoryBodySchema } },
    async (request, reply) => {
      const { topic, provider: providerName, change_request, video_id } = request.body;
      const provider = getProvider(app.config, providerName);

      // — regeneration of an existing draft —
      if (video_id) {
        const video = await findVideoById(app, video_id);
        if (!video?.story) return reply.code(404).send({ error: 'Video not found' });
        if (!change_request) return reply.code(400).send({ error: 'change_request is required' });
        await updateVideoStatus(app, video.id, 'draft', 'script');
        runStoryGeneration(app, {
          videoId: video.id,
          providerName,
          provider,
          prompt: buildChangeRequestPrompt(
            app.config.promptsDir,
            video.topic,
            JSON.stringify(video.story),
            change_request,
          ),
          changeRequest: change_request,
          runPrompt: change_request,
        });
        return { video: { ...video, status: 'draft', current_step: 'script' } };
      }

      // — new story —
      if (!topic) return reply.code(400).send({ error: 'topic is required' });

      // topic dedupe via pgvector (best-effort: skipped if ollama is down)
      let embedding: number[] | null = null;
      try {
        embedding = await embedText(app.config.ollamaUrl, app.config.ollamaEmbedModel, topic);
        const similar = await findMostSimilarTopic(app, embedding);
        if (similar && similar.similarity > SIMILARITY_THRESHOLD) {
          return reply.code(409).send({
            error: `Too similar to existing video #${similar.id}: "${similar.topic}" (${(similar.similarity * 100).toFixed(0)}%)`,
          });
        }
      } catch (err) {
        app.log.warn({ err }, 'topic embedding unavailable — skipping dedupe');
      }

      const video = await createDraftVideo(app, { topic, embedding });
      runStoryGeneration(app, {
        videoId: video.id,
        providerName,
        provider,
        prompt: buildStoryPrompt(app.config.promptsDir, topic),
        changeRequest: null,
        runPrompt: topic,
      });
      return reply.code(202).send({ video });
    },
  );

  /**
   * Suggests fresh topics. Duplicate protection is two-layered: every
   * existing topic is listed in the prompt as off-limits, and each returned
   * idea is embedded and dropped if it is semantically close (pgvector
   * cosine similarity) to any video already in the database.
   */
  r.post(
    '/generate/topics',
    { schema: { body: SuggestTopicsBodySchema } },
    async (request) => {
      const provider = getProvider(app.config, request.body.provider);
      const existing = (await findAllVideos(app)).map((v) => v.topic);
      const startedAt = Date.now();
      const result = await generateJsonWithRetry(provider, {
        system: topicsSystem(app.config.promptsDir),
        prompt: buildTopicPrompt(app.config.promptsDir, request.body.count, existing),
        schema: TopicIdeasSchema,
      });
      await insertGenerationRun(app, {
        videoId: null,
        step: 'research',
        provider: request.body.provider,
        model: result.model,
        prompt: `suggest ${request.body.count} topics`,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
      });

      // semantic dedupe against everything already produced (best-effort)
      const ideas = [];
      const dropped: Array<{ topic: string; similar_to: string }> = [];
      for (const idea of result.data.ideas) {
        try {
          const embedding = await embedText(
            app.config.ollamaUrl,
            app.config.ollamaEmbedModel,
            idea.topic,
          );
          const similar = await findMostSimilarTopic(app, embedding);
          if (similar && similar.similarity > SUGGESTION_SIMILARITY_THRESHOLD) {
            dropped.push({ topic: idea.topic, similar_to: similar.topic });
            continue;
          }
        } catch (err) {
          app.log.warn({ err }, 'embedding unavailable — keeping idea without dedupe');
        }
        ideas.push(idea);
      }
      return { ideas, dropped };
    },
  );
}
