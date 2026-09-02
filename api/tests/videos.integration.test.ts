import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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

  it('drains pending pipeline jobs and removes the media directory', async () => {
    const video = await seedVideo();
    const other = await seedVideo();

    await app.pipelineQueue.add(
      'tts',
      { videoId: video.id, step: 'tts' },
      { jobId: `${video.id}:tts:${Date.now()}` },
    );
    await app.pipelineQueue.add(
      'tts',
      { videoId: other.id, step: 'tts' },
      { jobId: `${other.id}:tts:${Date.now()}` },
    );

    const mediaDir = path.join(app.config.storageDir, 'videos', String(video.id));
    await mkdir(path.join(mediaDir, '01_images'), { recursive: true });
    await writeFile(path.join(mediaDir, '01_images', 'beat_00_v1.png'), 'fake');

    const res = await app.inject({ method: 'DELETE', url: `/api/videos/${video.id}` });
    expect(res.statusCode).toBe(200);
    expect(await findVideoById(app, video.id)).toBeNull();
    expect(existsSync(mediaDir)).toBe(false);

    // only the deleted video's jobs are drained
    const remaining = await app.pipelineQueue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(remaining.map((j) => j.data.videoId)).toEqual([other.id]);
  });

  it('404s on a missing video', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/videos/9999' });
    expect(res.statusCode).toBe(404);
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

describe('PATCH /api/videos/:id/overlay', () => {
  it('rewrites the overlay hook without touching the narration or version history', async () => {
    const video = await seedVideo();
    const before = await findVideoById(app, video.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/videos/${video.id}/overlay`,
      payload: { overlay_hook: 'The tank was painted brown' },
    });

    expect(res.statusCode).toBe(200);
    const after = await findVideoById(app, video.id);
    expect(after!.story!.overlay_hook).toBe('The tank was painted brown');
    // the script itself must survive: a hook rewrite that regenerates the
    // narration destroys the same-content comparison it exists for
    expect(after!.story!.beats).toEqual(before!.story!.beats);
    expect(after!.story_versions).toEqual(before!.story_versions);
  });

  it('re-renders captions when there is already a merged video to caption', async () => {
    const video = await seedVideo();
    await updateVideoStatus(app, video.id, 'render_review', null);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/videos/${video.id}/overlay`,
      payload: { evidence_stamp: 'BOSTON, MASSACHUSETTS — JANUARY 1919' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { rerendering: boolean }).rerendering).toBe(true);
    const jobs = await app.pipelineQueue!.getJobs(['waiting', 'active', 'delayed']);
    expect(jobs.map((j) => j.data.step)).toContain('captions');
  });

  it('saves without re-rendering before the first render', async () => {
    const video = await seedVideo();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/videos/${video.id}/overlay`,
      payload: { overlay_hook: 'Painted brown, still leaking' },
    });
    expect((res.json() as { rerendering: boolean }).rerendering).toBe(false);
  });

  it('rejects an empty patch and an unknown video', async () => {
    const video = await seedVideo();
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/videos/${video.id}/overlay`, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/videos/999999/overlay',
          payload: { overlay_hook: 'nope at all' },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('POST /api/videos/:id/upgrade-clips', () => {
  it('refuses outside render_review', async () => {
    const video = await seedVideo();
    const res = await app.inject({
      method: 'POST',
      url: `/api/videos/${video.id}/upgrade-clips`,
      payload: { beat_indexes: [0] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses when tiering is off — there is no draft to upgrade from', async () => {
    const video = await seedVideo();
    await updateVideoStatus(app, video.id, 'render_review', null);
    const res = await app.inject({
      method: 'POST',
      url: `/api/videos/${video.id}/upgrade-clips`,
      payload: { beat_indexes: [0] },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/FAL_VIDEO_MODEL_DRAFT/);
  });

  it('estimates a premium re-render from the recorded clip durations', async () => {
    const video = await seedVideo();
    await insertAsset(app, {
      videoId: video.id,
      beatIndex: 0,
      kind: 'clip',
      take: 1,
      contentHash: 'tier-estimate-hash',
      filePath: '1/02_clips/beat_00_v1.mp4',
      durationSeconds: 6,
      costUsd: 0.24,
    });
    const res = await app.inject({ method: 'GET', url: `/api/videos/${video.id}/upgrade-estimate` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total_usd: number; beats: Array<{ seconds: number }> };
    expect(body.beats).toHaveLength(1);
    expect(body.beats[0]!.seconds).toBe(6);
    expect(body.total_usd).toBeGreaterThan(0);
  });
});
