import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CODEX_BASE_MODELS, CURSOR_BASE_MODELS, DEFAULT_CODEX_MODEL, DEFAULT_CURSOR_MODEL } from '@reel-agent/shared';
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
      model: DEFAULT_CODEX_MODEL,
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
      model: DEFAULT_CODEX_MODEL,
    });
  });
  it('reveals the Cursor model picker only when Cursor Agent is selected', () => {
    renderPage();
    expect(screen.queryByLabelText('Cursor model')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Cursor Agent'));
    const select = screen.getByLabelText('Cursor model');
    // the short model list, not the ~217-id grid flattened
    expect(select.querySelectorAll('option')).toHaveLength(CURSOR_BASE_MODELS.length);
    expect(select).toHaveValue('claude-opus-5');
    expect(screen.getByText(DEFAULT_CURSOR_MODEL)).toBeInTheDocument();
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      'Cursor Models',
      'Other Models',
    ]);

    fireEvent.click(screen.getByText('Codex'));
    expect(screen.queryByLabelText('Cursor model')).not.toBeInTheDocument();
  });

  it('offers only the parameters the selected model actually has', () => {
    renderPage();
    fireEvent.click(screen.getByText('Cursor Agent'));
    // Claude Opus 5: five effort rungs, thinking and fast
    expect(screen.getByLabelText('Effort')).toBeInTheDocument();
    expect(screen.getByLabelText('Thinking')).toBeInTheDocument();
    expect(screen.getByLabelText('Fast')).toBeInTheDocument();

    // Composer 2.5 has no effort rungs and no thinking mode, but does have fast
    fireEvent.change(screen.getByLabelText('Cursor model'), { target: { value: 'composer-2.5' } });
    expect(screen.queryByLabelText('Effort')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Thinking')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fast')).toBeInTheDocument();

    // Gemini 3.8 Flash has effort rungs but no fast tier
    fireEvent.change(screen.getByLabelText('Cursor model'), { target: { value: 'gemini-3.8-flash' } });
    expect(screen.getByLabelText('Effort')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fast')).not.toBeInTheDocument();
  });

  it('resolves model plus parameters to a real catalogue id', () => {
    renderPage();
    fireEvent.click(screen.getByText('Cursor Agent'));
    fireEvent.click(screen.getByLabelText('Fast'));
    expect(screen.getByText('claude-opus-5-thinking-high-fast')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Thinking'));
    expect(screen.getByText('claude-opus-5-high-fast')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } });
    expect(screen.getByText('claude-opus-5-low-fast')).toBeInTheDocument();
  });

  it('drops parameters the next model cannot honour instead of naming a fake id', () => {
    renderPage();
    fireEvent.click(screen.getByText('Cursor Agent'));
    fireEvent.click(screen.getByLabelText('Fast'));
    expect(screen.getByText('claude-opus-5-thinking-high-fast')).toBeInTheDocument();

    // Gemini has neither thinking nor a fast tier — both preferences are dropped
    fireEvent.change(screen.getByLabelText('Cursor model'), { target: { value: 'gemini-3.8-flash' } });
    expect(screen.getByText('gemini-3.8-flash-high')).toBeInTheDocument();
  });

  it('sends the resolved cursor model with the story request', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { video: { id: 11 } } });
    renderPage();
    fireEvent.click(screen.getByText('Cursor Agent'));
    fireEvent.change(screen.getByLabelText('Cursor model'), { target: { value: 'gemini-3.8-flash' } });
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } });
    fireEvent.change(screen.getByPlaceholderText(/A true story/), {
      target: { value: 'The lake that killed a valley' },
    });
    fireEvent.click(screen.getByText('Generate story'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/11'));
    expect(api.post).toHaveBeenCalledWith('/api/generate/story', {
      topic: 'The lake that killed a valley',
      provider: 'cursor-agent',
      model: 'gemini-3.8-flash-low',
    });
  });

  it('omits model entirely for the providers whose model is fixed by env', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { video: { id: 12 } } });
    renderPage();
    fireEvent.click(screen.getByText('Claude Code'));
    fireEvent.change(screen.getByPlaceholderText(/A true story/), {
      target: { value: 'The lake that killed a valley' },
    });
    fireEvent.click(screen.getByText('Generate story'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/12'));
    const body = vi.mocked(api.post).mock.calls[0]![1] as { provider: string; model?: string };
    expect(body).toMatchObject({ provider: 'claude-code' });
    expect(body.model).toBeUndefined();
  });

  it('shows the Codex model and effort pickers for the default Codex provider, and hides them for Claude Code', () => {
    renderPage();
    const select = screen.getByLabelText('Codex model');
    expect(select.querySelectorAll('option')).toHaveLength(CODEX_BASE_MODELS.length);
    expect(screen.getByLabelText('Effort')).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_CODEX_MODEL)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Claude Code'));
    expect(screen.queryByLabelText('Codex model')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Effort')).not.toBeInTheDocument();
  });

  it('sends the picked Codex model with its effort as one <model>@<effort> id', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { video: { id: 11 } } });
    renderPage();
    fireEvent.change(screen.getByLabelText('Codex model'), { target: { value: 'gpt-5.6-terra' } });
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'medium' } });
    expect(screen.getByText('gpt-5.6-terra@medium')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/A true story/), { target: { value: 'A dam that failed' } });
    fireEvent.click(screen.getByText('Generate story'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/videos/11'));
    expect(api.post).toHaveBeenCalledWith('/api/generate/story', {
      topic: 'A dam that failed',
      provider: 'codex',
      model: 'gpt-5.6-terra@medium',
    });
  });

  it('"Default" effort sends the bare model id so the CLI keeps its own effort', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: '' } });
    expect(screen.getByText('gpt-6-astra')).toBeInTheDocument();
  });
});
