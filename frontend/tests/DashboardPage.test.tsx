import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import { DashboardPage } from '@/pages/DashboardPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
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

  describe('deleting a video from the queue', () => {
    // vitest does not clear mocks between tests here, so a call recorded by an
    // earlier case would satisfy the "not called" assertion below
    beforeEach(() => vi.mocked(api.delete).mockReset());
    afterEach(() => vi.unstubAllGlobals());

    const seedOneVideo = () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/api/videos') {
          return Promise.resolve({
            data: [
              {
                id: 15,
                topic: 'Tacoma Narrows bridge collapse',
                hook: 'The bridge tore itself apart',
                status: 'failed',
                current_step: 'script',
                story: null,
                story_versions: [],
                error: 'scrape failed',
                total_cost_usd: 0,
                created_at: '',
                updated_at: '',
              },
            ],
          });
        }
        return Promise.resolve({
          data: { total_videos: 1, by_status: { failed: 1 }, total_cost_usd: 0, avg_cost_usd: 0, total_runs: 1, cost_by_provider: {} },
        });
      });
    };

    it('offers a delete control on every row', async () => {
      // there was none: the only one lived at the bottom of the detail page
      seedOneVideo();
      renderPage();
      await waitFor(() =>
        expect(screen.getByLabelText('Delete Tacoma Narrows bridge collapse')).toBeInTheDocument(),
      );
    });

    it('deletes after confirmation', async () => {
      seedOneVideo();
      vi.stubGlobal('confirm', vi.fn(() => true));
      vi.mocked(api.delete).mockResolvedValue({ data: { ok: true } });
      renderPage();
      fireEvent.click(await screen.findByLabelText('Delete Tacoma Narrows bridge collapse'));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/videos/15'));
    });

    it('does nothing when the confirmation is dismissed', async () => {
      seedOneVideo();
      vi.stubGlobal('confirm', vi.fn(() => false));
      renderPage();
      fireEvent.click(await screen.findByLabelText('Delete Tacoma Narrows bridge collapse'));
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('keeps the delete button out of the row link', async () => {
      // a <button> inside an <a> is invalid markup, and clicking it would
      // navigate as well as delete
      seedOneVideo();
      renderPage();
      const button = await screen.findByLabelText('Delete Tacoma Narrows bridge collapse');
      expect(button.closest('a')).toBeNull();
    });
  });
});
