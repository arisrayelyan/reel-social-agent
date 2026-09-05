import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_RESEARCH_MODEL } from '@reel-agent/shared';
import { api } from '@/lib/api';
import { ResearchPage } from '@/pages/ResearchPage';

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
  count: 8,
  use_sources: false,
  prompt: null,
  error: null,
  cost_usd: '0.2321',
  created_at: '2026-09-04T10:00:00.000Z',
  finished_at: '2026-09-04T10:02:00.000Z',
  candidate_count: 5,
  liked_count: 1,
  disliked_count: 2,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ResearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  navigate.mockReset();
});

describe('research desk', () => {
  it('defaults to Cursor Agent on the Grok research model with web sources off, sends exactly that and opens the new run', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: { run: { ...run, id: 2, status: 'running' } } });
    renderPage();
    expect(await screen.findByText(DEFAULT_RESEARCH_MODEL)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ground each candidate/)).not.toBeChecked();
    expect(await screen.findByText('No research yet')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Optional focus/), { target: { value: '1970s maritime' } });
    fireEvent.click(screen.getByText('12'));
    fireEvent.click(screen.getByText('Research stories'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/research/runs', {
        provider: 'cursor-agent',
        model: DEFAULT_RESEARCH_MODEL,
        brief: '1970s maritime',
        count: 12,
        use_sources: false,
      }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/research/2'));
  });

  it('lists every run as a table row that opens the dossier', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [run, { ...run, id: 3, brief: null, status: 'running', candidate_count: 0 }] });
    renderPage();
    const table = await screen.findByTestId('runs-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('dams');
    expect(rows[0]).toHaveTextContent('cursor-grok-4.6-high');
    expect(rows[0]).toHaveTextContent('$0.23');
    expect(rows[1]).toHaveTextContent('Open brief');
    expect(rows[1]).toHaveTextContent('running');
    // both rows carry the same counts, so the desk total is doubled
    expect(screen.getByText('2 liked')).toBeInTheDocument();
    expect(screen.getByText('4 rejected')).toBeInTheDocument();

    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/research/1');
  });
});
