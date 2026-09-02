import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LlmStory } from '@reel-agent/shared';
import { LlmValidationError } from '../src/llm/provider.js';

/**
 * The retry budget contract for runStoryGeneration: at most TWO provider
 * calls per story, a valid first draft always survives a broken retry, and
 * failed attempts persist the raw model output for diagnosis.
 */

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...mod,
    getProvider: () => ({ name: 'codex' as const, generateJson }),
  };
});

// dedupe must not depend on a live Ollama — reject fast, route skips it
vi.mock('../src/llm/ollama.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/llm/ollama.js')>();
  return { ...mod, embedText: vi.fn().mockRejectedValue(new Error('ollama down (mock)')) };
});

const { buildTestApp, goodStoryFixture, truncateAll } = await import('./helpers.js');
const { findVideoById } = await import('../src/database/queries/videos.js');

function okResult(story: LlmStory, costUsd: number) {
  return {
    data: story,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd,
    raw: JSON.stringify(story),
    model: 'fake-model',
  };
}

function validationError(raw: string, issues: string[]) {
  return new LlmValidationError(
    `LLM output failed schema validation:\n${issues.join('\n')}`,
    raw,
    issues,
  );
}

/** A story with exactly the kind of craft error that triggers the rewrite. */
function craftBrokenStory(): LlmStory {
  const story = goodStoryFixture();
  story.beats[3]!.image_prompt = 'the reservoir surface at dawn, mist over the water';
  return story;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.pipelineQueue?.obliterate({ force: true }).catch(() => undefined);
  await app.close();
});
beforeEach(async () => {
  await truncateAll(app);
  generateJson.mockReset();
});

async function startGeneration(): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/generate/story',
    payload: { topic: 'The reservoir island that vanished and came back', provider: 'codex' },
  });
  expect(res.statusCode).toBe(202);
  return (res.json() as { video: { id: number } }).video.id;
}

async function waitForStatus(id: number, status: string) {
  await vi.waitFor(
    async () => {
      const video = await findVideoById(app, id);
      expect(video?.status).toBe(status);
    },
    { timeout: 8_000 },
  );
}

async function runsFor(id: number) {
  const { rows } = await app.pg.query<{ status: string; output: { attempt?: number; raw?: string | null; error?: string } | null; cost_usd: string }>(
    `SELECT status, output, cost_usd FROM generation_runs WHERE video_id = $1 AND step = 'script' ORDER BY id`,
    [id],
  );
  return rows;
}

describe('runStoryGeneration retry budget', () => {
  it('a clean first draft costs exactly one call', async () => {
    generateJson.mockResolvedValueOnce(okResult(goodStoryFixture(), 0.1));
    const id = await startGeneration();
    await waitForStatus(id, 'story_review');
    expect(generateJson).toHaveBeenCalledTimes(1);
    const video = await findVideoById(app, id);
    expect(Number(video!.total_cost_usd)).toBeCloseTo(0.1);
  });

  it('an invalid first draft is repaired with ONE retry that carries the broken output', async () => {
    generateJson
      .mockRejectedValueOnce(validationError('{"broken": true}', ['beats: Invalid input']))
      .mockResolvedValueOnce(okResult(goodStoryFixture(), 0.2));
    const id = await startGeneration();
    await waitForStatus(id, 'story_review');
    expect(generateJson).toHaveBeenCalledTimes(2);

    // the repair prompt contains the previous output and the issues
    const retryPrompt = (generateJson.mock.calls[1]![0] as { prompt: string }).prompt;
    expect(retryPrompt).toContain('{"broken": true}');
    expect(retryPrompt).toContain('beats: Invalid input');

    const runs = await runsFor(id);
    expect(runs.map((r) => r.status)).toEqual(['failed', 'succeeded']);
    expect(runs[0]!.output?.raw).toBe('{"broken": true}');
  });

  it('a valid first draft SURVIVES a retry that fails validation', async () => {
    generateJson
      .mockResolvedValueOnce(okResult(craftBrokenStory(), 0.1))
      .mockRejectedValueOnce(validationError('garbage', ['topic: Invalid input']));
    const id = await startGeneration();
    await waitForStatus(id, 'story_review'); // NOT failed
    expect(generateJson).toHaveBeenCalledTimes(2);
    const video = await findVideoById(app, id);
    expect(video!.story).toBeTruthy();
    expect(Number(video!.total_cost_usd)).toBeCloseTo(0.1);
  });

  it('a valid first draft survives a retry that times out', async () => {
    const timeoutErr = Object.assign(new Error('Command timed out after 900000 milliseconds'), {
      timedOut: true,
    });
    generateJson
      .mockResolvedValueOnce(okResult(craftBrokenStory(), 0.1))
      .mockRejectedValueOnce(timeoutErr);
    const id = await startGeneration();
    await waitForStatus(id, 'story_review');
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it('two invalid drafts fail the video with the raw output persisted — never a third call', async () => {
    generateJson
      .mockRejectedValueOnce(validationError('first bad output', ['evidence_stamp: Too big']))
      .mockRejectedValueOnce(validationError('second bad output', ['evidence_stamp: Too big']));
    const id = await startGeneration();
    await waitForStatus(id, 'failed');
    expect(generateJson).toHaveBeenCalledTimes(2);

    const video = await findVideoById(app, id);
    expect(video!.error).toContain('evidence_stamp');
    const runs = await runsFor(id);
    expect(runs.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(runs[1]!.output?.raw).toBe('second bad output');
  });

  it('a craft rewrite that fixes the errors replaces the first draft', async () => {
    generateJson
      .mockResolvedValueOnce(okResult(craftBrokenStory(), 0.1))
      .mockResolvedValueOnce(okResult(goodStoryFixture(), 0.2));
    const id = await startGeneration();
    await waitForStatus(id, 'story_review');
    expect(generateJson).toHaveBeenCalledTimes(2);

    // the rewrite prompt names the violated rule's detail
    const retryPrompt = (generateJson.mock.calls[1]![0] as { prompt: string }).prompt;
    expect(retryPrompt).toContain('hard rules');

    const video = await findVideoById(app, id);
    expect(Number(video!.total_cost_usd)).toBeCloseTo(0.3);
    // the shipped story is the clean rewrite (no shot-type error survives)
    const findings = (video!.story_findings ?? []) as Array<{ rule: string; severity: string }>;
    expect(findings.filter((f) => f.rule === 'image.shot_type_prefix')).toEqual([]);
  });
});
