import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import { DashboardPage } from '@/pages/DashboardPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, api: { get: vi.fn() } };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  it('shows the empty state when there are no videos', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/videos') return Promise.resolve({ data: [] });
      return Promise.resolve({
        data: { total_videos: 0, by_status: {}, total_cost_usd: 0, avg_cost_usd: 0, total_runs: 0, cost_by_provider: {} },
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No videos yet')).toBeInTheDocument());
  });

  it('lists videos with status and cost', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/videos') {
        return Promise.resolve({
          data: [
            {
              id: 1,
              topic: 'Lake Nyos limnic eruption',
              hook: 'A lake killed a valley',
              status: 'story_review',
              current_step: null,
              story: null,
              story_versions: [],
              error: null,
              total_cost_usd: 1.23,
              created_at: '',
              updated_at: '',
            },
          ],
        });
      }
      return Promise.resolve({
        data: { total_videos: 1, by_status: { story_review: 1 }, total_cost_usd: 1.23, avg_cost_usd: 1.23, total_runs: 2, cost_by_provider: {} },
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Lake Nyos limnic eruption')).toBeInTheDocument());
    expect(screen.getAllByText('$1.23').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('story review')).toBeInTheDocument();
  });
});
