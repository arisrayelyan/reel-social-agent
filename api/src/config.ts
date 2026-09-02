import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  codexModel: string;
  codexInputCostPerMTok: number;
  codexOutputCostPerMTok: number;
  geminiApiKey: string;
  geminiImageModel: string;
  geminiImageCostUsd: number;
  falKey: string;
  falVideoModel: string;
  falCostPerSecondUsd: number;
  firecrawlApiKey: string;
  firecrawlMaxLinkedPages: number;
  firecrawlCostPerPageUsd: number;
  ttsUrl: string;
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
    codexModel: env.CODEX_MODEL ?? 'gpt-5.6-sol',
    codexInputCostPerMTok: Number(env.CODEX_INPUT_COST_PER_MTOK ?? 1.25),
    codexOutputCostPerMTok: Number(env.CODEX_OUTPUT_COST_PER_MTOK ?? 10),
    geminiApiKey: env.GEMINI_API_KEY ?? '',
    geminiImageModel: env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
    geminiImageCostUsd: Number(env.GEMINI_IMAGE_COST_USD ?? 0.039),
    falKey: env.FAL_KEY ?? '',
    falVideoModel: env.FAL_VIDEO_MODEL ?? 'minimax/h3-max/image-to-video',
    falCostPerSecondUsd: Number(env.FAL_COST_PER_SECOND_USD ?? 0.04),
    firecrawlApiKey: env.FIRECRAWL_API_KEY ?? '',
    firecrawlMaxLinkedPages: Number(env.FIRECRAWL_MAX_LINKED_PAGES ?? 4),
    firecrawlCostPerPageUsd: Number(env.FIRECRAWL_COST_PER_PAGE_USD ?? 0.005),
    ttsUrl: env.TTS_URL ?? 'http://localhost:4042',
    captionsUrl: env.CAPTIONS_URL ?? 'http://localhost:4043',
    tiktokClientKey: env.TIKTOK_CLIENT_KEY ?? '',
    tiktokClientSecret: env.TIKTOK_CLIENT_SECRET ?? '',
    tiktokRedirectUri:
      env.TIKTOK_REDIRECT_URI ?? 'http://localhost:4041/api/tiktok/callback',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: env.TELEGRAM_CHAT_ID ?? '',
  };
}
