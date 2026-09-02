import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import { GeneratePage } from '@/pages/GeneratePage';

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, api: { post: vi.fn() } };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => navigate };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GeneratePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  navigate.mockReset();
});

describe('GeneratePage', () => {
  it('switches between Topic and From URL tabs', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/A true story/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('From URL'));
    expect(screen.getByPlaceholderText(/en\.wikipedia\.org/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/A true story/)).not.toBeInTheDocument();
  });

  it('validates the URL inline and blocks generation until it is valid', async () => {
    renderPage();
    fireEvent.click(screen.getByText('From URL'));
    const input = screen.getByPlaceholderText(/en\.wikipedia\.org/);
    fireEvent.change(input, { target: { value: 'not a url' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/valid URL/)).toBeInTheDocument();
    expect(screen.getByText('Generate from URL').closest('button')).toBeDisabled();

    fireEvent.change(input, { target: { value: 'ftp://example.com' } });
    expect(await screen.findByText(/Only http\(s\)/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'https://example.com/article' } });
    await waitFor(() =>
      expect(screen.getByText('Generate from URL').closest('button')).not.toBeDisabled(),
    );
  });

  it('posts to /api/generate/from-url and redirects to the new video', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { video: { id: 7 } } });
    renderPage();
    fireEvent.click(screen.getByText('From URL'));
    fireEvent.change(screen.getByPlaceholderText(/en\.wikipedia\.org/), {
      target: { value: 'https://example.com/article' },
    });
    fireEvent.click(screen.getByText('Generate from URL'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/7'));
    expect(api.post).toHaveBeenCalledWith('/api/generate/from-url', {
      url: 'https://example.com/article',
      provider: 'codex',
    });
  });

  it('shows a loading panel while topic suggestions are generating', async () => {
    let resolvePost: (v: unknown) => void;
    vi.mocked(api.post).mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }) as ReturnType<typeof api.post>,
    );
    renderPage();
    fireEvent.click(screen.getByText('Suggest topics'));
    expect(await screen.findByTestId('suggestions-loading')).toBeInTheDocument();
    expect(screen.getByText(/Thinking of fresh topics/)).toBeInTheDocument();

    resolvePost!({
      data: { ideas: [{ topic: 'The lighthouse that vanished', hook: 'Gone overnight', why_interesting: 'wtf' }], dropped: [] },
    });
    expect(await screen.findByText('The lighthouse that vanished')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestions-loading')).not.toBeInTheDocument();
  });

  it('Use fills the topic textarea, starts generation and redirects', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: { ideas: [{ topic: 'The lighthouse that vanished', hook: 'Gone overnight', why_interesting: 'wtf' }], dropped: [] },
      })
      .mockResolvedValueOnce({ data: { video: { id: 3 } } });
    renderPage();
    fireEvent.click(screen.getByText('Suggest topics'));
    fireEvent.click(await screen.findByText('Use'));

    expect(screen.getByPlaceholderText(/A true story/)).toHaveValue('The lighthouse that vanished');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/3'));
    expect(api.post).toHaveBeenLastCalledWith('/api/generate/story', {
      topic: 'The lighthouse that vanished',
      provider: 'codex',
    });
  });
});
