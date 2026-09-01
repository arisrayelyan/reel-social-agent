import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TikTokClient } from '../clients/tiktok.js';
import { findOAuthToken } from '../database/queries/oauthTokens.js';

const STATE_TTL_SECONDS = 600;

export async function tiktokRouter(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Starts the Login Kit OAuth flow (redirects to TikTok). */
  r.get('/tiktok/connect', async (_request, reply) => {
    const client = new TikTokClient(app.config);
    const { url, state, codeVerifier } = client.buildAuthUrl();
    await app.redis.set(`tiktok:oauth:${state}`, codeVerifier, 'EX', STATE_TTL_SECONDS);
    return reply.redirect(url);
  });

  /** OAuth callback: verifies CSRF state, stores tokens, returns to Settings. */
  r.get(
    '/tiktok/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
          error_description: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, error, error_description } = request.query;
      const settingsUrl = `${app.config.corsOrigin}/settings`;
      if (error || !code || !state) {
        return reply.redirect(`${settingsUrl}?tiktok=error&reason=${encodeURIComponent(error_description ?? error ?? 'missing code')}`);
      }
      const codeVerifier = await app.redis.getdel(`tiktok:oauth:${state}`);
      if (!codeVerifier) {
        return reply.redirect(`${settingsUrl}?tiktok=error&reason=invalid_state`);
      }
      const client = new TikTokClient(app.config);
      await client.exchangeCode(app, code, codeVerifier);
      return reply.redirect(`${settingsUrl}?tiktok=connected`);
    },
  );

  r.get('/tiktok/status', async () => {
    const token = await findOAuthToken(app, 'tiktok');
    return {
      connected: Boolean(token?.access_token),
      open_id: token?.open_id ?? null,
      expires_at: token?.expires_at ?? null,
    };
  });
}
