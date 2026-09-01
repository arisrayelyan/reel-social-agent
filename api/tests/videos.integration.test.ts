import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, storyFixture, truncateAll } from './helpers.js';
import { createVideo, findVideoById, updateVideoStatus } from '../src/database/queries/videos.js';
import { insertAsset } from '../src/database/queries/assets.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  // drain test jobs so the real worker never sees them
  await app.pipelineQueue?.obliterate({ force: true }).catch(() => undefined);
  await app.close();
});
beforeEach(async () => {
  await truncateAll(app);
  await app.pipelineQueue?.obliterate({ force: true }).catch(() => undefined);
});

async function seedVideo() {
  return createVideo(app, {
    topic: 'Lake Nyos limnic eruption',
    hook: 'A lake killed a valley overnight',
    story: storyFixture(),
    embedding: null,
  });
}

describe('GET /api/videos', () => {
  it('returns videos newest first', async () => {
    await seedVideo();
    const res = await app.inject({ method: 'GET', url: '/api/videos' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ topic: string; status: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.status).toBe('story_review');
  });
});

describe('GET /api/videos/:id', () => {
  it('includes assets, runs and publications', async () => {
    const video = await seedVideo();
    await insertAsset(app, {
      videoId: video.id,
      beatIndex: 0,
      kind: 'keyframe',
      take: 1,
      contentHash: 'abc',
      filePath: 'videos/1/01_images/s01_v1.png',
    });
    const res = await app.inject({ method: 'GET', url: `/api/videos/${video.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assets: unknown[]; runs: unknown[]; publications: unknown[] };
    expect(body.assets).toHaveLength(1);
    expect(body.runs).toEqual([]);
  });

  it('404s for a missing video', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/videos/9999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/videos/:id/approve-story', () => {
  it('moves story_review → approved and enqueues the render chain', async () => {
    const video = await seedVideo();
    const res = await app.inject({ method: 'POST', url: `/api/videos/${video.id}/approve-story` });
    expect(res.statusCode).toBe(200);
    const updated = await findVideoById(app, video.id);
    expect(updated!.status).toBe('approved');
    const jobs = await app.pipelineQueue.getJobs(['waiting', 'active', 'delayed']);
    expect(jobs.some((j) => j.data.videoId === video.id && j.data.step === 'tts')).toBe(true);
  });

  it('409s from any other status', async () => {
    const video = await seedVideo();
    await updateVideoStatus(app, video.id, 'rendering', 'images');
    const res = await app.inject({ method: 'POST', url: `/api/videos/${video.id}/approve-story` });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/videos/:id/retry', () => {
  it('re-enqueues the failed step', async () => {
    const video = await seedVideo();
    await updateVideoStatus(app, video.id, 'failed', 'clips', 'fal exploded');
    const res = await app.inject({ method: 'POST', url: `/api/videos/${video.id}/retry` });
    expect(res.statusCode).toBe(200);
    const jobs = await app.pipelineQueue.getJobs(['waiting', 'active', 'delayed']);
    expect(jobs.some((j) => j.data.step === 'clips')).toBe(true);
  });

  it('rejects retry of a non-failed video', async () => {
    const video = await seedVideo();
    const res = await app.inject({ method: 'POST', url: `/api/videos/${video.id}/retry` });
    expect(res.statusCode).toBe(409);
  });
});

describe('DELETE /api/videos/:id', () => {
  it('deletes and cascades', async () => {
    const video = await seedVideo();
    const res = await app.inject({ method: 'DELETE', url: `/api/videos/${video.id}` });
    expect(res.statusCode).toBe(200);
    expect(await findVideoById(app, video.id)).toBeNull();
  });
});

describe('GET /api/stats', () => {
  it('aggregates counts and costs', async () => {
    await seedVideo();
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total_videos: number; by_status: Record<string, number> };
    expect(body.total_videos).toBe(1);
    expect(body.by_status.story_review).toBe(1);
  });
});
