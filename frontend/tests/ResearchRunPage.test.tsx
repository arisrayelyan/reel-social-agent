import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { StoryCandidate } from '@reel-agent/shared';
import { api } from '@/lib/api';
import { ResearchRunPage } from '@/pages/ResearchRunPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => navigate };
});

const run = {
  id: 1,
  status: 'succeeded',
  provider: 'cursor-agent',
  model: 'cursor-grok-4.6-high',
  brief: 'dams',
  count: 5,
  use_sources: false,
  prompt: 'Find 5 true-story candidates',
  error: null,
  cost_usd: '0.2321',
  created_at: '2026-09-04T10:00:00.000Z',
  finished_at: '2026-09-04T10:02:00.000Z',
  candidate_count: 2,
  liked_count: 0,
  disliked_count: 1,
};
function candidate(over: Partial<StoryCandidate>): StoryCandidate {
  return {
    id: 10,
    run_id: 1,
    topic: 'Banqiao Dam, Henan, 1975',
    hook: 'Every gate was open. It rose anyway.',
    year: 1975,
    place: 'Henan, China',
    summary: 'Two sentences of facts.',
    money_shot: 'the dam face giving way',
    turn: 'the gates were open',
    kicker: 'rebuilt in 1993',
    scores: { visual: 5, hook: 4, turn: 4, verifiable: 4, people: 3, novelty: 4 },
    risk: 'none',
    risk_note: null,
    total_score: 84,
    rank: 1,
    source_url: 'https://en.wikipedia.org/wiki/1975_Banqiao_Dam_failure',
    source_title: '1975 Banqiao Dam failure',
    source_status: 'reachable',
    flags: [],
    sources: [],
    feedback: null,
    feedback_reason: null,
    feedback_note: null,
    feedback_at: null,
    video_id: null,
    created_at: '2026-09-04T10:02:00.000Z',
    ...over,
  };
}
const candidates = [
  candidate({}),
  candidate({
    id: 11,
    topic: 'A ledger nobody read',
    rank: 2,
    total_score: 61,
    source_url: null,
    source_title: null,
    source_status: 'unchecked',
    flags: ['no_source'],
    feedback: 'dislike',
    feedback_reason: 'not_visual',
  }),
];

function mockRun(detail: Record<string, unknown> = { ...run, candidates }) {
  vi.mocked(api.get).mockResolvedValue({ data: detail });
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/research/1']}>
        <Routes>
          <Route path="/research/:id" element={<ResearchRunPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  navigate.mockReset();
});

describe('research dossier', () => {
  it('shows the run header, every finding with rank, score, source and flags, and the prompt', async () => {
    mockRun();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'dams' })).toBeInTheDocument();
    expect(screen.getByText('$0.23')).toBeInTheDocument();
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('84');
    expect(rows[0]).toHaveTextContent('Banqiao Dam, Henan, 1975');
    expect(screen.getByText('1975 Banqiao Dam failure').closest('a')).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/1975_Banqiao_Dam_failure',
    );
    expect(rows[1]).toHaveTextContent('no source');
    expect(rows[1]).toHaveTextContent('Not visual');
    expect(screen.getByText('What the model was told')).toBeInTheDocument();
  });

  it('expands a row to the summary, turn, kicker and axis ledger', async () => {
    mockRun();
    renderPage();
    await screen.findAllByTestId('candidate-row');
    fireEvent.click(screen.getByLabelText('Show details for Banqiao Dam, Henan, 1975'));
    const details = screen.getByTestId('candidate-details');
    expect(details).toHaveTextContent('Two sentences of facts.');
    expect(details).toHaveTextContent('the gates were open');
    expect(details).toHaveTextContent('rebuilt in 1993');
    expect(details).toHaveTextContent('Visual');
  });

  it('thumbs-down opens reason chips in a sub-row and saves reason + note', async () => {
    mockRun();
    vi.mocked(api.patch).mockResolvedValue({ data: candidates[0] });
    renderPage();
    const rows = await screen.findAllByTestId('candidate-row');
    fireEvent.click(rows[0]!.querySelector('button[aria-label="Dislike"]')!);
    expect(screen.getByTestId('dislike-reasons')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dislike note'), { target: { value: 'seen it everywhere' } });
    fireEvent.click(screen.getByText('Too well known'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/research/candidates/10/feedback', {
        feedback: 'dislike',
        reason: 'too_well_known',
        note: 'seen it everywhere',
      }),
    );
  });

  it('thumbs-up likes in one click', async () => {
    mockRun();
    vi.mocked(api.patch).mockResolvedValue({ data: candidates[0] });
    renderPage();
    const rows = await screen.findAllByTestId('candidate-row');
    fireEvent.click(rows[0]!.querySelector('button[aria-label="Like"]')!);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/research/candidates/10/feedback', { feedback: 'like' }),
    );
  });

  it('Generate from source runs the from-URL path with the candidate linked and the chosen story model', async () => {
    mockRun();
    vi.mocked(api.post).mockResolvedValue({ data: { video: { id: 21 } } });
    renderPage();
    await screen.findAllByTestId('candidate-row');
    fireEvent.click(screen.getByText('Generate from source'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/21'));
    expect(api.post).toHaveBeenCalledWith('/api/generate/from-url', {
      url: 'https://en.wikipedia.org/wiki/1975_Banqiao_Dam_failure',
      provider: 'codex',
      model: undefined,
      candidate_id: 10,
    });
  });

  it('falls back to the topic path without a reachable source', async () => {
    mockRun();
    vi.mocked(api.post).mockResolvedValue({ data: { video: { id: 22 } } });
    renderPage();
    await screen.findAllByTestId('candidate-row');
    fireEvent.click(screen.getByText('Generate story'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/22'));
    expect(api.post).toHaveBeenCalledWith('/api/generate/story', {
      topic: 'A ledger nobody read',
      provider: 'codex',
      model: undefined,
      candidate_id: 11,
    });
  });

  it('shows the video link once a candidate became a video', async () => {
    mockRun({ ...run, candidates: [candidate({ video_id: 17 })] });
    renderPage();
    await screen.findAllByTestId('candidate-row');
    expect(screen.getByText('video #17').closest('a')).toHaveAttribute('href', '/videos/17');
    expect(screen.queryByText('Generate from source')).toBeNull();
  });

  it('Delete run removes it and returns to the desk', async () => {
    mockRun();
    vi.mocked(api.delete).mockResolvedValue({ data: { ok: true } });
    renderPage();
    await screen.findAllByTestId('candidate-row');
    fireEvent.click(screen.getByText('Delete run'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/research/runs/1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/research'));
  });
});
