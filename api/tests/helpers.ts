import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { StorySchema, type Story } from '@reel-agent/shared';
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

/**
 * Isolated media dir — tests must NEVER point at the real storage/ folder:
 * the delete route removes storage/videos/<id> recursively, and test video
 * ids restart from 1, which are real videos in the production storage dir.
 */
export const TEST_STORAGE_DIR = path.join(os.tmpdir(), 'reel-agent-test-storage');

export async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    STORAGE_DIR: TEST_STORAGE_DIR,
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

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Hand-written fixtures, parsed at load so a malformed one fails loudly here
 * rather than mysteriously inside a rule.
 *
 * structuredClone per call is load-bearing: the rule-coverage table mutates
 * the good fixture once per rule, and a shared reference would leak mutations
 * across it.each cases.
 */
function loadFixture(name: string): Story {
  return StorySchema.parse(JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')));
}

const GOOD = loadFixture('story.good.json');
const SLOPPY = loadFixture('story.sloppy.json');

/**
 * Realistic documentary prose that must produce ZERO findings of any severity.
 * If the validator flags this, the rules are wrong, not the prose — that is
 * the whole point of having it.
 */
export function goodStoryFixture(overrides: Partial<Story> = {}): Story {
  return { ...structuredClone(GOOD), ...overrides };
}

/** Deliberately breaks nearly every rule at once. */
export function sloppyStoryFixture(overrides: Partial<Story> = {}): Story {
  return { ...structuredClone(SLOPPY), ...overrides };
}
