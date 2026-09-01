import { createHash, randomBytes } from 'node:crypto';
import { stat, open } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { findOAuthToken, upsertOAuthToken } from '../database/queries/oauthTokens.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

/** 64MB — TikTok chunk ceiling; our ~80s clips are 1–2 chunks. */
const CHUNK_SIZE = 64 * 1024 * 1024;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  open_id: string;
  scope: string;
  expires_in: number;
  refresh_expires_in: number;
  error?: string;
  error_description?: string;
}

/**
 * TikTok Login Kit + Content Posting **Inbox Upload** (video.upload scope).
 * Direct Post is deliberately not used: unaudited clients silently land as
 * SELF_ONLY (docs/pipeline-decisions.md §3). Inbox upload drops the video in
 * the user's TikTok drafts; the human reviews, sets the AIGC label and posts.
 */
export class TikTokClient {
  constructor(private readonly config: AppConfig) {
    if (!config.tiktokClientKey || !config.tiktokClientSecret) {
      throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set (api/.env)');
    }
  }

  /** Authorization URL + the CSRF state/PKCE verifier to hold in Redis. */
  buildAuthUrl(): { url: string; state: string; codeVerifier: string } {
    const state = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('hex');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('hex');
    const params = new URLSearchParams({
      client_key: this.config.tiktokClientKey,
      scope: 'user.info.basic,video.upload',
      response_type: 'code',
      redirect_uri: this.config.tiktokRedirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { url: `${AUTH_URL}?${params}`, state, codeVerifier };
  }

  async exchangeCode(app: FastifyInstance, code: string, codeVerifier: string): Promise<void> {
    const body = new URLSearchParams({
      client_key: this.config.tiktokClientKey,
      client_secret: this.config.tiktokClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.tiktokRedirectUri,
      code_verifier: codeVerifier,
    });
    await this.storeTokenResponse(app, body);
  }

  async refresh(app: FastifyInstance, refreshToken: string): Promise<void> {
    const body = new URLSearchParams({
      client_key: this.config.tiktokClientKey,
      client_secret: this.config.tiktokClientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    await this.storeTokenResponse(app, body);
  }

  private async storeTokenResponse(app: FastifyInstance, body: URLSearchParams): Promise<void> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const token = (await res.json()) as TokenResponse;
    if (!res.ok || token.error) {
      throw new Error(`TikTok token exchange failed: ${token.error_description ?? token.error ?? res.status}`);
    }
    await upsertOAuthToken(app, {
      provider: 'tiktok',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      openId: token.open_id,
      scope: token.scope,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      refreshExpiresAt: new Date(Date.now() + token.refresh_expires_in * 1000),
    });
  }

  /** Valid access token, transparently refreshing when < 10 min remain. */
  async getAccessToken(app: FastifyInstance): Promise<string> {
    let row = await findOAuthToken(app, 'tiktok');
    if (!row?.access_token || !row.refresh_token) {
      throw new Error('TikTok is not connected — open Settings and connect the account');
    }
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (expiresAt - Date.now() < 10 * 60_000) {
      await this.refresh(app, row.refresh_token);
      row = await findOAuthToken(app, 'tiktok');
    }
    return row!.access_token!;
  }

  /**
   * Uploads a finished MP4 into the user's TikTok inbox (drafts). Returns the
   * publish_id used for status polling.
   */
  async uploadToInbox(app: FastifyInstance, filePath: string): Promise<string> {
    const accessToken = await this.getAccessToken(app);
    const { size } = await stat(filePath);
    const chunkCount = Math.ceil(size / CHUNK_SIZE);

    const initRes = await fetch(INBOX_INIT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: size,
          chunk_size: Math.min(size, CHUNK_SIZE),
          total_chunk_count: chunkCount,
        },
      }),
    });
    const init = (await initRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };
    if (!initRes.ok || init.error?.code !== 'ok') {
      throw new Error(`TikTok inbox init failed: ${init.error?.message ?? initRes.status}`);
    }
    const { publish_id, upload_url } = init.data!;
    if (!publish_id || !upload_url) throw new Error('TikTok inbox init returned no upload_url');

    const file = await open(filePath, 'r');
    try {
      for (let i = 0; i < chunkCount; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, size) - 1;
        const length = end - start + 1;
        const buffer = Buffer.alloc(length);
        await file.read(buffer, 0, length, start);

        const uploadRes = await fetch(upload_url, {
          method: 'PUT',
          headers: {
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': String(length),
            'content-type': 'video/mp4',
          },
          body: new Uint8Array(buffer),
        });
        if (!uploadRes.ok && uploadRes.status !== 206) {
          throw new Error(`TikTok chunk upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
        }
      }
    } finally {
      await file.close();
    }
    return publish_id;
  }

  /** Poll status until the draft reaches the user's inbox. */
  async fetchPublishStatus(
    app: FastifyInstance,
    publishId: string,
  ): Promise<{ status: string; failReason?: string }> {
    const accessToken = await this.getAccessToken(app);
    const res = await fetch(STATUS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const body = (await res.json()) as {
      data?: { status?: string; fail_reason?: string };
      error?: { code?: string; message?: string };
    };
    if (!res.ok || (body.error && body.error.code !== 'ok')) {
      throw new Error(`TikTok status fetch failed: ${body.error?.message ?? res.status}`);
    }
    return { status: body.data?.status ?? 'UNKNOWN', failReason: body.data?.fail_reason };
  }
}
