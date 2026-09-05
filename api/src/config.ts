import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CODEX_MODEL, DEFAULT_CURSOR_MODEL } from '@reel-agent/shared';
import { parseCostMap } from './clients/falModels.js';
import { parseCodexPriceMap } from './llm/codexPricing.js';
import { parseCursorPriceMap, type CursorPrice } from './llm/cursorPricing.js';
import type { TokenPrice } from './llm/pricing.js';

export interface AppConfig {
  port: number;
  corsOrigin: string;
  logLevel: string;
  isDev: boolean;
  databaseUrl: string;
  redisUrl: string;
  storageDir: string;
  promptsDir: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaEmbedModel: string;
  claudeCliPath: string;
  claudeModel: string;
  codexCliPath: string;
  /** Fallback `<model>` or `<model>@<effort>`; the pages override it per request. */
  codexModel: string;
  /** Model-id prefix → $/1M tokens, overriding the built-in table in llm/codexPricing.ts. */
  codexPricePerMTok: Record<string, TokenPrice>;
  cursorCliPath: string;
  /** Fallback model; the Generate page overrides it per request. */
  cursorModel: string;
  /** Model-id prefix → $/1M tokens, overriding the built-in family table. */
  cursorPricePerMTok: Record<string, CursorPrice>;
  geminiApiKey: string;
  geminiImageModel: string;
  geminiImageCostUsd: number;
  /** '1K' | '2K' | '4K', or '' to send nothing. Ignored by 2.5-flash-image. */
  geminiImageSize: string;
  falKey: string;
  falVideoModel: string;
  falVideoResolution: string;
  /**
   * Cheap tier for the first pass. Empty string = tiering OFF, which is the
   * default: the plan cannot promise 480P or any given endpoint is cheaper
   * (pricing is not in the openapi document), so this must be an opt-in.
   */
  falVideoModelDraft: string;
  falVideoResolutionDraft: string;
  /**
   * 'balanced' (~1s) or 'quality' (~30s, richer rewrite). The endpoint REQUIRES
   * this field and rewrites our motion prompt before generating either way —
   * 'balanced' keeps today's behaviour, now explicit and switchable.
   */
  falPromptExpansionMode: string;
  /** Beats that may get a generated video clip; the rest cut from stills.
   *  Infinity (env unset) = every beat, so the reel stays generated video. */
  falMaxClipsPerVideo: number;
  /**
   * Generate a deterministic end frame for the kicker (one extra Gemini edit)
   * and drive the kicker clip with first+last frame, so the reel's final frame
   * is known and the loop point is invisible. Requires an endpoint that
   * declares end_image_url — see falModels.ts.
   */
  loopableKicker: boolean;
  falCostPerSecondUsd: number;
  /** Per-model $/s so the dashboard stays honest across tiers. */
  falCostPerSecondUsdMap: Record<string, number>;
  firecrawlApiKey: string;
  /** 0 = the given URL's main content only (default since 4 Sep 2026). */
  firecrawlMaxLinkedPages: number;
  firecrawlCostPerPageUsd: number;
  /** Photos taken from the source page's main content and described for the story model. */
  firecrawlMaxSourceImages: number;
  /** Emergency off-switch for the vision pass over source photos. */
  sourceImageAnalysis: boolean;
  ttsUrl: string;
  /**
   * Delivery pace sent with every /synthesize call and folded into the TTS
   * content hash, so a pace change re-renders narration instead of silently
   * reusing cached wavs. 152: a touch brisker than the 145 planning rate, so
   * estimates run ~5% long — Aram's call after listening to the 145 take.
   */
  ttsTargetWpm: number;
  ttsSentenceGapSeconds: number;
  /** Small mono "AI RECONSTRUCTION" tag under the evidence stamp (TikTok AIGC labelling). */
  reconstructionTag: boolean;
  captionsUrl: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  tiktokRedirectUri: string;
  telegramBotToken: string;
  telegramChatId: string;
}

/**
 * Reads process.env exactly once into a typed config. Only DATABASE_URL is
 * mandatory at boot; media API keys are validated lazily at point of use so
 * the dashboard runs before every key is provisioned.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (see api/.env.example)');
  }

  const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const storageDir = path.resolve(apiDir, env.STORAGE_DIR ?? '../storage');
  const promptsDir = path.resolve(apiDir, env.PROMPTS_DIR ?? '../prompts');

  return {
    port: Number(env.PORT ?? 4041),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:4040',
    logLevel: env.LOG_LEVEL ?? 'info',
    isDev: env.NODE_ENV !== 'production',
    databaseUrl,
    redisUrl: env.REDIS_URL ?? 'redis://:123456@localhost:6378',
    storageDir,
    promptsDir,
    ollamaUrl: env.OLLAMA_URL ?? 'http://localhost:11434',
    ollamaModel: env.OLLAMA_MODEL ?? 'qwen3.6:latest',
    ollamaEmbedModel: env.OLLAMA_EMBED_MODEL ?? 'qwen3-embedding:0.6b',
    claudeCliPath: env.CLAUDE_CLI_PATH ?? 'claude',
    claudeModel: env.CLAUDE_MODEL ?? 'opus',
    codexCliPath: env.CODEX_CLI_PATH ?? 'codex',
    codexModel: env.CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    codexPricePerMTok: parseCodexPriceMap(env.CODEX_PRICE_PER_MTOK_MAP),
    cursorCliPath: env.CURSOR_CLI_PATH ?? 'cursor-agent',
    cursorModel: env.CURSOR_MODEL ?? DEFAULT_CURSOR_MODEL,
    cursorPricePerMTok: parseCursorPriceMap(env.CURSOR_PRICE_PER_MTOK_MAP),
    geminiApiKey: env.GEMINI_API_KEY ?? '',
    geminiImageModel: env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
    geminiImageCostUsd: Number(env.GEMINI_IMAGE_COST_USD ?? 0.039),
    geminiImageSize: env.GEMINI_IMAGE_SIZE ?? '',
    falKey: env.FAL_KEY ?? '',
    falVideoModel: env.FAL_VIDEO_MODEL ?? 'minimax/h3-max/image-to-video',
    falVideoResolution: env.FAL_VIDEO_RESOLUTION ?? '768P',
    falVideoModelDraft: env.FAL_VIDEO_MODEL_DRAFT ?? '',
    falVideoResolutionDraft: env.FAL_VIDEO_RESOLUTION_DRAFT ?? '480P',
    falPromptExpansionMode: env.FAL_PROMPT_EXPANSION_MODE ?? 'quality',
    // unset = no cap: every beat gets a clip and the reel stays generated
    // video throughout. A number caps it, and the uncapped beats cut from
    // stills instead — 0 means stills only.
    falMaxClipsPerVideo:
      env.FAL_MAX_CLIPS_PER_VIDEO === undefined || env.FAL_MAX_CLIPS_PER_VIDEO === ''
        ? Number.POSITIVE_INFINITY
        : Number(env.FAL_MAX_CLIPS_PER_VIDEO),
    loopableKicker: (env.LOOPABLE_KICKER ?? 'true') !== 'false',
    falCostPerSecondUsd: Number(env.FAL_COST_PER_SECOND_USD ?? 0.08),
    falCostPerSecondUsdMap: parseCostMap(env.FAL_COST_PER_SECOND_USD_MAP),
    firecrawlApiKey: env.FIRECRAWL_API_KEY ?? '',
    firecrawlMaxLinkedPages: Number(env.FIRECRAWL_MAX_LINKED_PAGES ?? 0),
    firecrawlCostPerPageUsd: Number(env.FIRECRAWL_COST_PER_PAGE_USD ?? 0.005),
    firecrawlMaxSourceImages: Number(env.FIRECRAWL_MAX_SOURCE_IMAGES ?? 4),
    sourceImageAnalysis: (env.SOURCE_IMAGE_ANALYSIS ?? 'true') !== 'false',
    ttsUrl: env.TTS_URL ?? 'http://localhost:4042',
    ttsTargetWpm: Number(env.TTS_TARGET_WPM ?? 152),
    ttsSentenceGapSeconds: Number(env.TTS_SENTENCE_GAP_SECONDS ?? 0.35),
    reconstructionTag: (env.RECONSTRUCTION_TAG ?? 'true') !== 'false',
    captionsUrl: env.CAPTIONS_URL ?? 'http://localhost:4043',
    tiktokClientKey: env.TIKTOK_CLIENT_KEY ?? '',
    tiktokClientSecret: env.TIKTOK_CLIENT_SECRET ?? '',
    tiktokRedirectUri:
      env.TIKTOK_REDIRECT_URI ?? 'http://localhost:4041/api/tiktok/callback',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: env.TELEGRAM_CHAT_ID ?? '',
  };
}
