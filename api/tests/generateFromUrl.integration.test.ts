import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { TEST_DATABASE_URL, TEST_REDIS_URL, truncateAll } from './helpers.js';
import { findVideoById } from '../src/database/queries/videos.js';

// The background scrape must never hit the network: the mocked scrape rejects,
// which also exercises the failure path of runUrlStoryGeneration end to end.
vi.mock('../src/clients/firecrawl.js', () => ({
  // must be constructible — the runner does `new FirecrawlClient(...)`
  FirecrawlClient: class {
    scrape = vi.fn().mockRejectedValue(new Error('scrape blew up (mock)'));
    scrapeMany = vi.fn();
  },
  extractLinkedUrls: vi.fn(() => []),
}));

const { buildApp } = await import('../src/app.js');

function testEnv(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
    ...overrides,
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig(testEnv({ FIRECRAWL_API_KEY: 'fc-test' })));
  await app.ready();
});
afterAll(async () => {
  await app.pipelineQueue?.obliterate({ force: true }).catch(() => undefined);
  await app.close();
});
beforeEach(async () => {
  await truncateAll(app);
});

describe('POST /api/generate/from-url', () => {
  it('rejects an invalid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/from-url',
      payload: { url: 'not-a-url', provider: 'ollama' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-http(s) URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/from-url',
      payload: { url: 'ftp://example.com/file', provider: 'ollama' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 with setup guidance when FIRECRAWL_API_KEY is missing', async () => {
    const bare = await buildApp(loadConfig(testEnv({ FIRECRAWL_API_KEY: '' })));
    await bare.ready();
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/api/generate/from-url',
        payload: { url: 'https://example.com/article', provider: 'ollama' },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain('FIRECRAWL_API_KEY');
    } finally {
      await bare.close();
    }
  });

  it('returns 202 with a draft video carrying the source_url, then the background scrape outcome lands on the video', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/from-url',
      payload: { url: 'https://example.com/article', provider: 'ollama' },
    });
    expect(res.statusCode).toBe(202);
    const { video } = res.json() as {
      video: { id: number; topic: string; source_url: string; status: string };
    };
    expect(video.status).toBe('draft');
    expect(video.topic).toBe('https://example.com/article');
    expect(video.source_url).toBe('https://example.com/article');

    // the mocked scrape rejects — the fire-and-forget runner must mark the video failed
    await vi.waitFor(
      async () => {
        const row = await findVideoById(app, video.id);
        expect(row?.status).toBe('failed');
        expect(row?.error).toContain('scrape blew up');
        expect(row?.current_step).toBe('script');
      },
      { timeout: 5_000 },
    );
  });
});
