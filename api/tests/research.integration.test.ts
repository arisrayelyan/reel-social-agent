import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ResearchRun, StoryCandidate } from '@reel-agent/shared';

/**
 * The research loop end to end against the real test DB: a 202 run that
 * fills in ranked candidates, source links checked and persisted, feedback
 * that the NEXT run's prompt reads back, and the candidate → video link.
 */

const { generateJson, search, checkUrl } = vi.hoisted(() => ({
  generateJson: vi.fn(),
  search: vi.fn(),
  checkUrl: vi.fn(),
}));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...mod, getProvider: () => ({ name: 'cursor-agent' as const, generateJson }) };
});
vi.mock('../src/llm/ollama.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/llm/ollama.js')>();
  return { ...mod, embedText: vi.fn().mockRejectedValue(new Error('ollama down (mock)')) };
});
vi.mock('../src/clients/firecrawl.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/clients/firecrawl.js')>();
  return { ...mod, FirecrawlClient: class { search = search; } };
});
vi.mock('../src/utils/sourceCheck.js', () => ({ checkUrl }));

const { buildTestApp, truncateAll } = await import('./helpers.js');
const { buildApp } = await import('../src/app.js');
const { loadConfig } = await import('../src/config.js');
const { TEST_DATABASE_URL, TEST_REDIS_URL, TEST_STORAGE_DIR } = await import('./helpers.js');

const scores = (visual: number) => ({ visual, hook: 4, turn: 4, verifiable: 4, people: 3, novelty: 4 });
const candidate = (topic: string, over: Record<string, unknown> = {}) => ({
  topic,
  hook: `${topic} hook`,
  year: 1975,
  place: 'Henan, China',
  summary: 'Two or three sentences of verifiable facts about the event.',
  money_shot: 'the dam face giving way as the reservoir pours through',
  turn: 'every sluice gate was already open',
  kicker: 'the rebuilt dam still stands',
  source_url: 'https://en.wikipedia.org/wiki/Test',
  source_title: 'Test article',
  scores: scores(5),
  risk: 'none',
  risk_note: null,
  ...over,
});
function okResearch(candidates: unknown[]) {
  return {
    data: { candidates },
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.02,
    raw: JSON.stringify({ candidates }),
    model: 'cursor-grok-4.6-high',
  };
}

let app: FastifyInstance;
beforeAll(async () => {
  // the Firecrawl client is mocked above; the key only has to pass the route's guard
  process.env.FIRECRAWL_API_KEY ||= 'fc-test';
  app = await buildTestApp();
});
afterAll(async () => {
  await app.pipelineQueue?.obliterate({ force: true }).catch(() => undefined);
  await app.close();
});
beforeEach(async () => {
  await truncateAll(app);
  generateJson.mockReset();
  search.mockReset();
  checkUrl.mockReset();
  checkUrl.mockImplementation(async (url: string) => (url.includes('wikipedia') ? 'reachable' : 'unreachable'));
});

async function startRun(body: Record<string, unknown> = {}): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/research/runs',
    payload: { provider: 'cursor-agent', model: 'cursor-grok-4.6-high', count: 5, ...body },
  });
  expect(res.statusCode).toBe(202);
  return (res.json() as { run: ResearchRun }).run.id;
}

async function waitForRun(id: number, status: string): Promise<ResearchRun & { candidates: StoryCandidate[] }> {
  let run!: ResearchRun & { candidates: StoryCandidate[] };
  await vi.waitFor(
    async () => {
      const res = await app.inject({ method: 'GET', url: `/api/research/runs/${id}` });
      run = res.json() as ResearchRun & { candidates: StoryCandidate[] };
      expect(run.status).toBe(status);
    },
    { timeout: 8_000 },
  );
  return run;
}

describe('POST /api/research/runs', () => {
  it('ranks candidates by total score, persists checked source links and the prompt, and records the spend', async () => {
    generateJson.mockResolvedValue(
      okResearch([
        candidate('Weak visual', { scores: scores(1) }),
        candidate('Strong story'),
        candidate('Dead link', { source_url: 'https://nope.example/404' }),
        candidate('No link', { source_url: null, source_title: null }),
        candidate('Risky', { risk: 'high', risk_note: 'only tellable through bodies' }),
      ]),
    );
    const id = await startRun({ brief: 'dams' });
    const run = await waitForRun(id, 'succeeded');

    expect(run.model).toBe('cursor-grok-4.6-high');
    expect(Number(run.cost_usd)).toBe(0.02);
    expect(run.prompt).toContain('FOCUS from the producer for this run: dams');
    expect(run.candidates.map((c) => c.topic)).toEqual(['Strong story', 'Dead link', 'No link', 'Risky', 'Weak visual']);
    expect(run.candidates.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5]);

    const byTopic = Object.fromEntries(run.candidates.map((c) => [c.topic, c]));
    expect(byTopic['Strong story']).toMatchObject({ total_score: 84, source_status: 'reachable', flags: [], source_url: 'https://en.wikipedia.org/wiki/Test' });
    expect(byTopic['Dead link']).toMatchObject({ total_score: 74, source_status: 'unreachable', flags: ['source_unreachable'] });
    expect(byTopic['No link']).toMatchObject({ total_score: 69, source_status: 'unchecked', flags: ['no_source'], source_url: null });
    expect(byTopic['Risky']).toMatchObject({ total_score: 64, risk: 'high' });
    expect(search).not.toHaveBeenCalled();

    const runs = await app.pg.query(`SELECT video_id, step, cost_usd FROM generation_runs`);
    expect(runs.rows).toEqual([{ video_id: null, step: 'research', cost_usd: '0.0200' }]);
    const stats = await app.inject({ method: 'GET', url: '/api/stats' });
    expect((stats.json() as { research_cost_usd: number }).research_cost_usd).toBe(0.02);
  });

  it('with web sources on, searches per candidate, repairs a dead model link and bills the credits', async () => {
    generateJson.mockResolvedValue(okResearch([candidate('Dead link', { source_url: 'https://nope.example/404' })]));
    search.mockResolvedValue([{ url: 'https://en.wikipedia.org/wiki/Real', title: 'Real article', description: null }]);
    const id = await startRun({ use_sources: true });
    const run = await waitForRun(id, 'succeeded');

    expect(search).toHaveBeenCalledWith('Dead link Henan, China 1975', 3);
    expect(run.candidates[0]).toMatchObject({
      source_url: 'https://en.wikipedia.org/wiki/Real',
      source_title: 'Real article',
      source_status: 'reachable',
      flags: [],
      sources: [{ url: 'https://en.wikipedia.org/wiki/Real', title: 'Real article' }],
    });
    // 0.02 provider + 2 credits × $0.005
    expect(Number(run.cost_usd)).toBe(0.03);
  });

  it('refuses web sources without a Firecrawl key', async () => {
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      STORAGE_DIR: TEST_STORAGE_DIR,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
      FIRECRAWL_API_KEY: '',
    });
    const bare = await buildApp(config);
    await bare.ready();
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/api/research/runs',
        payload: { provider: 'codex', use_sources: true },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain('FIRECRAWL_API_KEY');
    } finally {
      await bare.close();
    }
  });

  it('marks the run failed when the provider throws, keeping the prompt for diagnosis', async () => {
    generateJson.mockRejectedValue(new Error('CLI exploded'));
    const id = await startRun();
    const run = await waitForRun(id, 'failed');
    expect(run.error).toContain('CLI exploded');
    expect(run.prompt).toContain('Find 5 true-story candidates');
    expect(run.candidates).toEqual([]);
  });
});

describe('CORS', () => {
  it('lets the dashboard origin PATCH and DELETE (preflight names the methods)', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/research/candidates/1/feedback',
      headers: {
        origin: 'http://localhost:4040',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    const allowed = String(res.headers['access-control-allow-methods']);
    expect(allowed).toMatch(/PATCH/);
    expect(allowed).toMatch(/DELETE/);
  });
});

describe('feedback loop', () => {
  it('persists like/dislike with reason and note, and the next run reads it back', async () => {
    generateJson.mockResolvedValue(okResearch([candidate('Good one'), candidate('Paperwork one')]));
    const first = await waitForRun(await startRun(), 'succeeded');
    const [good, paper] = first.candidates;

    let res = await app.inject({
      method: 'PATCH',
      url: `/api/research/candidates/${good!.id}/feedback`,
      payload: { feedback: 'like', reason: 'other', note: 'ignored on a like' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ feedback: 'like', feedback_reason: null, feedback_note: null });

    res = await app.inject({
      method: 'PATCH',
      url: `/api/research/candidates/${paper!.id}/feedback`,
      payload: { feedback: 'dislike', reason: 'not_visual', note: 'it is a ledger' },
    });
    expect(res.json()).toMatchObject({ feedback: 'dislike', feedback_reason: 'not_visual', feedback_note: 'it is a ledger' });

    const listed = (await app.inject({ method: 'GET', url: '/api/research/runs' })).json() as ResearchRun[];
    expect(listed[0]).toMatchObject({ id: first.id, candidate_count: 2, liked_count: 1, disliked_count: 1 });

    generateJson.mockResolvedValue(okResearch([candidate('Third')]));
    const second = await waitForRun(await startRun(), 'succeeded');
    expect(second.prompt).toContain('Liked — more like these');
    expect(second.prompt).toContain('- Good one — "Good one hook"');
    expect(second.prompt).toMatch(/as NOT VISUAL .*:\n {4}- Paperwork one — producer: "it is a ledger"/);
  });

  it('404s on an unknown candidate and validates the reason', async () => {
    let res = await app.inject({ method: 'PATCH', url: '/api/research/candidates/999/feedback', payload: { feedback: 'like' } });
    expect(res.statusCode).toBe(404);
    generateJson.mockResolvedValue(okResearch([candidate('X')]));
    const run = await waitForRun(await startRun(), 'succeeded');
    res = await app.inject({
      method: 'PATCH',
      url: `/api/research/candidates/${run.candidates[0]!.id}/feedback`,
      payload: { feedback: 'dislike', reason: 'because' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('research → video', () => {
  it('links the candidate to the draft video started from it, and survives video deletion', async () => {
    generateJson.mockResolvedValue(okResearch([candidate('Linked')]));
    const run = await waitForRun(await startRun(), 'succeeded');
    const cand = run.candidates[0]!;

    generateJson.mockRejectedValue(new Error('no story in this test'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/story',
      payload: { topic: 'Linked', provider: 'codex', candidate_id: cand.id },
    });
    expect(res.statusCode).toBe(202);
    const videoId = (res.json() as { video: { id: number } }).video.id;

    let after = await waitForRun(run.id, 'succeeded');
    expect(after.candidates[0]!.video_id).toBe(videoId);

    await app.inject({ method: 'DELETE', url: `/api/videos/${videoId}` });
    after = await waitForRun(run.id, 'succeeded');
    expect(after.candidates[0]!.video_id).toBeNull();
    expect(after.candidates[0]!.topic).toBe('Linked');
  });

  it('DELETE removes the run and its candidates', async () => {
    generateJson.mockResolvedValue(okResearch([candidate('Gone')]));
    const run = await waitForRun(await startRun(), 'succeeded');
    expect((await app.inject({ method: 'DELETE', url: `/api/research/runs/${run.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/research/runs/${run.id}` })).statusCode).toBe(404);
    const left = await app.pg.query(`SELECT count(*)::int n FROM story_candidates`);
    expect(left.rows[0].n).toBe(0);
  });
});
