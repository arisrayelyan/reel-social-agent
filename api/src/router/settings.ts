import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getAllSettings, setSetting } from '../database/queries/settings.js';
import { findOAuthToken } from '../database/queries/oauthTokens.js';
import { TtsClient } from '../clients/tts.js';
import { CaptionsClient } from '../clients/captions.js';
import { TelegramClient } from '../clients/telegram.js';

export async function settingsRouter(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/settings', async () => getAllSettings(app));

  r.put(
    '/settings/:key',
    {
      schema: {
        params: z.object({ key: z.string().min(1) }),
        body: z.object({ value: z.unknown() }),
      },
    },
    async (request) => {
      await setSetting(app, request.params.key, request.body.value);
      return { ok: true };
    },
  );

  /** Which services are reachable and which API keys are configured. */
  r.get('/settings/health', async () => {
    const config = app.config;
    const [db, redis, ollama, tts, captions, tiktokToken] = await Promise.all([
      app.pg
        .query('SELECT 1')
        .then(() => true)
        .catch(() => false),
      app.redis
        .ping()
        .then(() => true)
        .catch(() => false),
      fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) })
        .then((res) => res.ok)
        .catch(() => false),
      new TtsClient(config).health(),
      new CaptionsClient(config).health(),
      findOAuthToken(app, 'tiktok').catch(() => null),
    ]);
    return {
      db,
      redis,
      ollama,
      tts,
      captions,
      keys: {
        GEMINI_API_KEY: Boolean(config.geminiApiKey),
        FAL_KEY: Boolean(config.falKey),
        TIKTOK_CLIENT_KEY: Boolean(config.tiktokClientKey),
        TIKTOK_CLIENT_SECRET: Boolean(config.tiktokClientSecret),
        TELEGRAM_BOT_TOKEN: Boolean(config.telegramBotToken),
        TELEGRAM_CHAT_ID: Boolean(config.telegramChatId),
      },
      tiktok_connected: Boolean(tiktokToken?.access_token),
    };
  });

  /** Sends a test message so the Telegram setup can be verified from the UI. */
  r.post('/settings/telegram-test', async (request, reply) => {
    const telegram = new TelegramClient(app.config);
    if (!telegram.configured) {
      return reply.code(400).send({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set' });
    }
    await telegram.send('✅ reel-social-agent: Telegram notifications are working.');
    return { ok: true };
  });
}
