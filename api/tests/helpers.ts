import type { FastifyInstance } from 'fastify';
import type { Story } from '@reel-agent/shared';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5439/reel-agent-test';

/**
 * Tests use Redis logical DB 1 (production uses DB 0) so test-enqueued jobs
 * can NEVER be consumed by a running production worker — a test job in the
 * shared queue once triggered a real pipeline run against the prod database.
 */
export const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://:123456@localhost:6378/1';

export async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
  });
  const app = await buildApp(config);
  await app.ready();
  return app;
}

export async function truncateAll(app: FastifyInstance): Promise<void> {
  await app.pg.query(
    'TRUNCATE videos, generation_runs, assets, publications, oauth_tokens, settings RESTART IDENTITY CASCADE',
  );
}

/** Minimal but schema-valid story fixture. */
export function storyFixture(overrides: Partial<Story> = {}): Story {
  const narration = (words: number) => Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  const roles = ['hook', 'setup', 'escalation', 'turn', 'reveal', 'kicker'] as const;
  return {
    topic: 'Lake Nyos limnic eruption',
    hook: 'A lake killed a valley overnight — silently.',
    title: 'The Lake That Exploded',
    tiktok_caption: 'The lake that killed a valley #history #wtf #truestory',
    style_prefix:
      'nineteen eighties documentary photography, West African highland region, red laterite soil, overcast diffuse morning light, muted 35mm film stock, vertical 9:16 composition, cinematic',
    beats: roles.map((role, i) => ({
      index: i,
      role,
      narration: narration(28),
      word_count: 28,
      duration_seconds: 11.59,
      image_prompt: `wide shot of the crater lake at dawn, beat ${i}`,
      motion_prompt: 'slow push-in over the water',
      camera_locked: i >= 4,
    })),
    ...overrides,
  };
}
