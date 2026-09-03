import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  GenerateFromUrlBodySchema,
  GenerateStoryBodySchema,
  LlmStorySchema,
  SuggestTopicsBodySchema,
  TopicIdeasSchema,
  summarizeFindings,
  type LlmStory,
  type Provider,
} from '@reel-agent/shared';
import { extractLinkedUrls, FirecrawlClient } from '../clients/firecrawl.js';
import {
  buildRepairInstruction,
  generateJsonWithRetry,
  getProvider,
  isFatalLlmError,
  LlmValidationError,
  type LlmProvider,
  type LlmResult,
} from '../llm/index.js';
import { embedText } from '../llm/ollama.js';
import {
  buildChangeRequestPrompt,
  buildStoryPrompt,
  buildTopicPrompt,
  storyPromptExamples,
  storySystem,
  topicsSystem,
} from '../llm/prompts.js';
import { postProcessStory, type StoryValidation } from '../utils/storyPost.js';
import {
  addVideoCost,
  createDraftVideo,
  findAllVideos,
  findMostSimilarTopic,
  findVideoById,
  updateVideoSource,
  updateVideoStatus,
  updateVideoStory,
} from '../database/queries/videos.js';
import { insertGenerationRun } from '../database/queries/generationRuns.js';
import { publishEvent } from '../pipeline/events.js';

/** Hard reject when an explicit topic nearly duplicates an existing video. */
const SIMILARITY_THRESHOLD = 0.9;
/** Stricter filter for machine-suggested ideas — each generation must differ. */
const SUGGESTION_SIMILARITY_THRESHOLD = 0.82;
/** Scraped source material caps — keeps the story prompt inside every model's context. */
const MAIN_PAGE_MAX_CHARS = 12_000;
const LINKED_PAGE_MAX_CHARS = 4_000;

/** One generation_runs row per attempt — the retry rate is a prompt-health metric. */
async function recordScriptRun(
  app: FastifyInstance,
  opts: { videoId: number; providerName: Provider; runPrompt: string },
  outcome: { result: { model: string; inputTokens: number | null; outputTokens: number | null; costUsd: number }; processed: { findings: unknown[]; totalWords: number; totalSeconds: number } },
  startedAt: number,
  attemptNumber: number,
): Promise<void> {
  await insertGenerationRun(app, {
    videoId: opts.videoId,
    step: 'script',
    provider: opts.providerName,
    model: outcome.result.model,
    prompt: opts.runPrompt,
    output: {
      attempt: attemptNumber,
      findings: outcome.processed.findings,
      total_words: outcome.processed.totalWords,
      total_seconds: outcome.processed.totalSeconds,
    },
    inputTokens: outcome.result.inputTokens,
    outputTokens: outcome.result.outputTokens,
    costUsd: outcome.result.costUsd,
    durationMs: Date.now() - startedAt,
  });
}

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
    topic: string;
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
      const promptExamples = storyPromptExamples(app.config.promptsDir, opts.topic);
      const system = storySystem(app.config.promptsDir);

      type GoodAttempt = { ok: true; result: LlmResult<LlmStory>; processed: StoryValidation };
      type BadAttempt = { ok: false; error: unknown };

      // Direct provider call — deliberately NOT generateJsonWithRetry: this
      // loop is the single retry budget. Schema failure, craft failure and
      // the retry itself all share ONE second call, never more (a story used
      // to cost up to 4 paid CLI calls). Validation failures come back as a
      // value; only unfixable errors (timeout, missing CLI) throw.
      const attempt = async (prompt: string): Promise<GoodAttempt | BadAttempt> => {
        try {
          const result = await opts.provider.generateJson({
            system,
            prompt,
            schema: LlmStorySchema,
          });
          return { ok: true, result, processed: postProcessStory(result.data, { promptExamples }) };
        } catch (err) {
          if (isFatalLlmError(err)) throw err;
          return { ok: false, error: err };
        }
      };
      const recordFailedAttempt = (error: unknown, attemptStartedAt: number, n: number) =>
        insertGenerationRun(app, {
          videoId: opts.videoId,
          step: 'script',
          provider: opts.providerName,
          model: 'unknown',
          prompt: opts.runPrompt,
          output: {
            attempt: n,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
            raw: error instanceof LlmValidationError ? error.raw.slice(0, 4000) : null,
          },
          costUsd: 0,
          durationMs: Date.now() - attemptStartedAt,
          status: 'failed',
        }).catch(() => undefined);
      const errorsIn = (v: GoodAttempt) =>
        v.processed.findings.filter((f) => f.severity === 'error');

      const first = await attempt(opts.prompt);
      let best: GoodAttempt | null = null;
      let totalCost = 0;
      if (first.ok) {
        totalCost += first.result.costUsd;
        await recordScriptRun(app, opts, first, startedAt, 1);
        best = first;
      } else {
        await recordFailedAttempt(first.error, startedAt, 1);
      }

      // Decide the single retry: repair invalid JSON, or rewrite craft errors.
      let retryPrompt: string | null = null;
      let retryMessage = '';
      if (!first.ok) {
        retryPrompt = `${opts.prompt}\n\n${buildRepairInstruction(first.error)}`;
        retryMessage = 'The draft came back invalid — repairing it (last retry)';
      } else if (errorsIn(first).length > 0) {
        const violations = errorsIn(first)
          .map((f) => `- ${f.beat_index === null ? 'story' : `beat ${f.beat_index}`}: ${f.detail}`)
          .join('\n');
        retryPrompt = `${opts.prompt}\n\nYour previous draft broke these hard rules. Rewrite the FULL story fixing every one of them, and keep everything else that already worked:\n${violations}`;
        retryMessage = `Rewriting: ${errorsIn(first).length} hard rule violations (last retry)`;
      }

      if (retryPrompt) {
        await publishEvent(app, {
          video_id: opts.videoId,
          step: 'script',
          status: 'progress',
          level: 'warning',
          message: retryMessage,
        });
        const retryStartedAt = Date.now();
        let second: GoodAttempt | BadAttempt;
        try {
          second = await attempt(retryPrompt);
        } catch (err) {
          // fatal on the retry (e.g. timeout) — a good first draft must survive it
          if (!best) throw err;
          second = { ok: false, error: err };
        }
        if (second.ok) {
          totalCost += second.result.costUsd;
          await recordScriptRun(app, opts, second, retryStartedAt, 2);
          if (!best || errorsIn(second).length < errorsIn(best).length) best = second;
        } else {
          await recordFailedAttempt(second.error, retryStartedAt, 2);
          if (best) {
            await publishEvent(app, {
              video_id: opts.videoId,
              step: 'script',
              status: 'progress',
              level: 'warning',
              message: 'Retry failed — keeping the first draft',
            });
          } else {
            throw second.error instanceof Error ? second.error : new Error(String(second.error));
          }
        }
      }

      if (!best) throw new Error('story generation produced no valid draft');
      await addVideoCost(app, opts.videoId, totalCost);
      await updateVideoStory(
        app,
        opts.videoId,
        best.processed.story,
        opts.changeRequest,
        best.processed.findings,
      );
      await publishEvent(app, {
        video_id: opts.videoId,
        step: 'script',
        status: 'completed',
        level: errorsIn(best).length > 0 ? 'warning' : 'info',
        // summarize, don't join: a sloppy story now yields ~20 findings and
        // joining them ships a paragraph into a 12px mono status strip
        message: summarizeFindings(best.processed.findings) ?? 'Script ready for review',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err, videoId: opts.videoId }, 'script generation failed');
      // validation failures already have per-attempt failed rows (with raw
      // output) from recordFailedAttempt — don't insert a duplicate
      if (!(err instanceof LlmValidationError)) {
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
      }
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

/**
 * Background half of "generate from URL": scrape the page (plus the pages it
 * mentions), dedupe on the derived topic, persist the source material, then
 * hand off to the normal script generation. Any failure marks the video
 * failed at the script step — same UX as an LLM failure.
 */
function runUrlStoryGeneration(
  app: FastifyInstance,
  opts: { videoId: number; url: string; providerName: Provider; provider: LlmProvider },
): void {
  void (async () => {
    try {
      await publishEvent(app, {
        video_id: opts.videoId,
        step: 'script',
        status: 'started',
        message: `Reading ${opts.url}`,
      });
      const firecrawl = new FirecrawlClient(app.config);
      const startedAt = Date.now();
      const main = await firecrawl.scrape(opts.url);
      const linkedUrls = extractLinkedUrls(
        main.markdown,
        opts.url,
        app.config.firecrawlMaxLinkedPages,
      );
      const linked = linkedUrls.length ? await firecrawl.scrapeMany(linkedUrls) : [];

      const scrapeCost = (1 + linked.length) * app.config.firecrawlCostPerPageUsd;
      await insertGenerationRun(app, {
        videoId: opts.videoId,
        step: 'research',
        provider: opts.providerName,
        model: 'firecrawl',
        prompt: opts.url,
        output: { pages: [main.url, ...linked.map((p) => p.url)] },
        costUsd: scrapeCost,
        durationMs: Date.now() - startedAt,
      });
      await addVideoCost(app, opts.videoId, scrapeCost);

      const sourceMaterial = [
        `# ${main.title}\nSource: ${main.url}\n\n${main.markdown.slice(0, MAIN_PAGE_MAX_CHARS)}`,
        ...linked.map(
          (p) => `\n\n---\n\n## Related: ${p.title}\nSource: ${p.url}\n\n${p.markdown.slice(0, LINKED_PAGE_MAX_CHARS)}`,
        ),
      ].join('');

      // dedupe on the page title now that we know it (best-effort, like the topic path)
      let embedding: number[] | null = null;
      try {
        embedding = await embedText(app.config.ollamaUrl, app.config.ollamaEmbedModel, main.title);
        const similar = await findMostSimilarTopic(app, embedding);
        if (similar && similar.id !== opts.videoId && similar.similarity > SIMILARITY_THRESHOLD) {
          throw new Error(
            `Too similar to existing video #${similar.id}: "${similar.topic}" (${(similar.similarity * 100).toFixed(0)}%)`,
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Too similar')) throw err;
        app.log.warn({ err }, 'topic embedding unavailable — skipping dedupe');
        embedding = null;
      }

      await updateVideoSource(app, opts.videoId, {
        topic: main.title,
        embedding,
        sourceMaterial,
      });
      runStoryGeneration(app, {
        videoId: opts.videoId,
        topic: main.title,
        providerName: opts.providerName,
        provider: opts.provider,
        prompt: buildStoryPrompt(app.config.promptsDir, main.title, sourceMaterial),
        changeRequest: null,
        runPrompt: opts.url,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err, videoId: opts.videoId, url: opts.url }, 'source scrape failed');
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
      const { topic, provider: providerName, model, change_request, video_id } = request.body;
      const provider = getProvider(app.config, providerName, model);

      // — regeneration of an existing draft —
      if (video_id) {
        const video = await findVideoById(app, video_id);
        if (!video?.story) return reply.code(404).send({ error: 'Video not found' });
        if (!change_request) return reply.code(400).send({ error: 'change_request is required' });
        await updateVideoStatus(app, video.id, 'draft', 'script');
        runStoryGeneration(app, {
          videoId: video.id,
          topic: video.topic,
          providerName,
          provider,
          prompt: buildChangeRequestPrompt(
            app.config.promptsDir,
            video.topic,
            JSON.stringify(video.story),
            change_request,
            video.source_material,
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
        topic,
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
   * Generates a story from a web page: returns the draft video immediately,
   * then scrapes the URL (and the pages it mentions) with Firecrawl in the
   * background and writes the script from that material only.
   */
  r.post(
    '/generate/from-url',
    { schema: { body: GenerateFromUrlBodySchema } },
    async (request, reply) => {
      const { url, provider: providerName, model } = request.body;
      const provider = getProvider(app.config, providerName, model);
      if (!app.config.firecrawlApiKey) {
        return reply.code(400).send({
          error: 'FIRECRAWL_API_KEY is not set (api/.env) — get one at https://www.firecrawl.dev',
        });
      }

      const video = await createDraftVideo(app, { topic: url, embedding: null, sourceUrl: url });
      runUrlStoryGeneration(app, { videoId: video.id, url, providerName, provider });
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
      const provider = getProvider(app.config, request.body.provider, request.body.model);
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
