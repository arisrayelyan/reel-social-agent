import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  GenerateStoryBodySchema,
  LlmStorySchema,
  SuggestTopicsBodySchema,
  TopicIdeasSchema,
} from '@reel-agent/shared';
import { generateJsonWithRetry, getProvider } from '../llm/index.js';
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
  createVideo,
  findAllVideos,
  findMostSimilarTopic,
  findVideoById,
  updateVideoStory,
} from '../database/queries/videos.js';
import { insertGenerationRun } from '../database/queries/generationRuns.js';
import { addVideoCost } from '../database/queries/videos.js';

/** Hard reject when an explicit topic nearly duplicates an existing video. */
const SIMILARITY_THRESHOLD = 0.9;
/** Stricter filter for machine-suggested ideas — each generation must differ. */
const SUGGESTION_SIMILARITY_THRESHOLD = 0.82;

export async function generateRouter(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Generates (or regenerates with a change request) a story. Synchronous:
   * LLM latency is acceptable for an interactive review flow.
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

        const startedAt = Date.now();
        const result = await generateJsonWithRetry(provider, {
          system: storySystem(app.config.promptsDir),
          prompt: buildChangeRequestPrompt(
            app.config.promptsDir,
            video.topic,
            JSON.stringify(video.story),
            change_request,
          ),
          schema: LlmStorySchema,
        });
        const processed = postProcessStory(result.data);
        await insertGenerationRun(app, {
          videoId: video.id,
          step: 'script',
          provider: providerName,
          model: result.model,
          prompt: change_request,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          durationMs: Date.now() - startedAt,
        });
        await addVideoCost(app, video.id, result.costUsd);
        const updated = await updateVideoStory(app, video.id, processed.story, change_request);
        return { video: updated, warnings: processed.warnings, totals: { words: processed.totalWords, seconds: processed.totalSeconds } };
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

      const startedAt = Date.now();
      const result = await generateJsonWithRetry(provider, {
        system: storySystem(app.config.promptsDir),
        prompt: buildStoryPrompt(app.config.promptsDir, topic),
        schema: LlmStorySchema,
      });
      const processed = postProcessStory(result.data);
      const video = await createVideo(app, {
        topic: processed.story.topic,
        hook: processed.story.hook,
        story: processed.story,
        embedding,
      });
      await insertGenerationRun(app, {
        videoId: video.id,
        step: 'script',
        provider: providerName,
        model: result.model,
        prompt: topic,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
      });
      await addVideoCost(app, video.id, result.costUsd);
      return {
        video: { ...video, total_cost_usd: Number(video.total_cost_usd) + result.costUsd },
        warnings: processed.warnings,
        totals: { words: processed.totalWords, seconds: processed.totalSeconds },
      };
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
