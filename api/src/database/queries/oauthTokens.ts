import type { FastifyInstance } from 'fastify';

export interface OAuthTokenRow {
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  open_id: string | null;
  scope: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
}

export async function upsertOAuthToken(
  app: FastifyInstance,
  token: {
    provider: string;
    accessToken: string;
    refreshToken: string;
    openId: string;
    scope: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
  },
): Promise<void> {
  await app.pg.query(
    `INSERT INTO oauth_tokens
       (provider, access_token, refresh_token, open_id, scope, expires_at, refresh_expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       open_id = EXCLUDED.open_id,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       updated_at = now()`,
    [
      token.provider,
      token.accessToken,
      token.refreshToken,
      token.openId,
      token.scope,
      token.expiresAt,
      token.refreshExpiresAt,
    ],
  );
}

export async function findOAuthToken(
  app: FastifyInstance,
  provider: string,
): Promise<OAuthTokenRow | null> {
  const { rows } = await app.pg.query<OAuthTokenRow>(
    `SELECT provider, access_token, refresh_token, open_id, scope, expires_at, refresh_expires_at
       FROM oauth_tokens WHERE provider = $1`,
    [provider],
  );
  return rows[0] ?? null;
}
