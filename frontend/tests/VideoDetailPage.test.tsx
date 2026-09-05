import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { StoryFinding } from '@reel-agent/shared';
import { api } from '@/lib/api';
import { VideoDetailPage } from '@/pages/VideoDetailPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

// jsdom has no EventSource, and the page opens one for live pipeline progress
vi.mock('@/hooks/useVideoEvents', () => ({ useVideoEvents: () => null }));

function finding(over: Partial<StoryFinding> = {}): StoryFinding {
  return {
    rule: 'hook.word_count',
    severity: 'error',
    field: 'hook',
    beat_index: null,
    detail: 'The hook is 14 words — the maximum is 10.',
    evidence: null,
    ...over,
  };
}

const beat = {
  index: 0,
  role: 'hook' as const,
  narration: 'Molasses killed twenty one people.',
  word_count: 5,
  duration_seconds: 2.07,
  image_prompt: 'extreme close-up of chipped cobblestones, light from the right',
  motion_prompt: 'the camera pushes in on the dark rivulet',
  camera_locked: false,
};

function videoWith(findings: StoryFinding[], status = 'story_review') {
  return {
    id: 7,
    topic: 'The Boston molasses flood',
    hook: 'Molasses killed twenty one people.',
    status,
    current_step: null,
    story: {
      topic: 'The Boston molasses flood',
      hook: 'Molasses killed twenty one people.',
      title: 'The Wave That Was Not Water',
      tiktok_caption: 'Warm and brown. #history #boston #wtf',
      music: {
        genre: 'dark ambient',
        search_terms: ['slow industrial drone', 'dread build no drums'],
        note: 'hold the drone under the setup, release on the reveal',
      },
      style_prefix: 'documentary evidence photograph, large-format sheet film, vertical 9:16 composition',
      beats: [beat],
    },
    story_findings: findings,
    story_versions: [],
    source_url: null,
    source_material: null,
    source_images: [],
    error: null,
    total_cost_usd: 0,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    assets: [],
    runs: [],
    publications: [],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/videos/7']}>
        <Routes>
          <Route path="/videos/:id" element={<VideoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('story review findings', () => {
  it('shows every error with its locator and detail', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: videoWith([
        finding(),
        finding({
          rule: 'narration.digits',
          beat_index: 2,
          detail: 'Narration contains digits ("1919").',
          evidence: '1919',
          field: 'narration',
        }),
      ]),
    } as never);
    renderPage();

    expect(await screen.findByTestId('story-findings')).toBeInTheDocument();
    expect(screen.getByText(/The hook is 14 words/)).toBeInTheDocument();
    expect(screen.getByText(/Narration contains digits/)).toBeInTheDocument();
    expect(screen.getByText('beat 02')).toBeInTheDocument();
    expect(screen.getByText('story')).toBeInTheDocument();
    expect(screen.getByText('1919')).toBeInTheDocument();
  });

  it('keeps warnings collapsed until asked for', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: videoWith([
        finding({ rule: 'image.imperfection', severity: 'warning', detail: 'No wear detail.', field: 'image_prompt' }),
      ]),
    } as never);
    renderPage();

    const disclosure = await screen.findByTestId('finding-warnings');
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('1 worth a look'));
    expect(screen.getByText('No wear detail.')).toBeInTheDocument();
  });

  // pins the product decision in the UI, not just in prose: findings are
  // diagnostic and the producer is the gate
  it('leaves Approve enabled even with errors', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: videoWith([finding(), finding({ rule: 'hook.digits' }), finding({ rule: 'style.negatives' })]),
    } as never);
    renderPage();

    const approve = await screen.findByRole('button', { name: /Approve story/ });
    expect(approve).toBeEnabled();
  });

  it('renders no findings block when the script is clean', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: videoWith([]) } as never);
    renderPage();

    expect(await screen.findByRole('button', { name: /Approve story/ })).toBeInTheDocument();
    expect(screen.queryByTestId('story-findings')).not.toBeInTheDocument();
  });
});

describe('render review', () => {
  function mockEstimate(draftModel: string | null) {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('upgrade-estimate')) {
        return Promise.resolve({
          data: {
            premium_model: 'minimax/h3-max/image-to-video',
            draft_model: draftModel,
            per_second_usd: 0.04,
            beats: [{ beat_index: 0, seconds: 6, cost_usd: 0.24 }],
            total_usd: 0.24,
          },
        }) as never;
      }
      return Promise.resolve({ data: videoWith([], 'render_review') }) as never;
    });
  }

  it('offers the publish action that previously had no UI at all', async () => {
    mockEstimate(null);
    renderPage();
    expect(await screen.findByRole('button', { name: /Approve render/ })).toBeEnabled();
  });

  it('explains how to turn tiering on when no draft model is configured', async () => {
    mockEstimate(null);
    renderPage();
    expect(await screen.findByText(/FAL_VIDEO_MODEL_DRAFT/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('prices a premium re-render before the producer spends it', async () => {
    mockEstimate('xai/grok-imagine-video/image-to-video');
    renderPage();

    const upgrade = await screen.findByRole('button', { name: /Re-render on the premium model/ });
    expect(upgrade).toBeDisabled();

    fireEvent.click(await screen.findByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Re-render 1 beat — about \$0\.24/ })).toBeEnabled();
  });

  it('shows no render-review card before the render finishes', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: videoWith([], 'story_review') } as never);
    renderPage();
    expect(await screen.findByRole('button', { name: /Approve story/ })).toBeInTheDocument();
    expect(screen.queryByTestId('render-review')).not.toBeInTheDocument();
  });
});

describe('publish kit at story review', () => {
  it('shows the caption and the music suggestion as soon as the story exists', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: videoWith([]) });
    renderPage();
    expect(await screen.findByText('Warm and brown. #history #boston #wtf')).toBeInTheDocument();
    const music = screen.getByTestId('music-suggestion');
    expect(music).toHaveTextContent('dark ambient');
    expect(music).toHaveTextContent('slow industrial drone');
    expect(music).toHaveTextContent('dread build no drums');
    expect(music).toHaveTextContent('release on the reveal');
  });

  it('renders no music block for a story written before the field existed', async () => {
    const video = videoWith([]);
    const { music: _omit, ...story } = video.story;
    vi.mocked(api.get).mockResolvedValue({ data: { ...video, story } });
    renderPage();
    expect(await screen.findByText('Warm and brown. #history #boston #wtf')).toBeInTheDocument();
    expect(screen.queryByTestId('music-suggestion')).toBeNull();
  });
});

describe('source photos', () => {
  const photo = (i: number, description: string | null) => ({
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Nyos${i}.jpg`,
    page_url: 'https://en.wikipedia.org/wiki/Lake_Nyos_disaster',
    file_path: `videos/7/00_sources/src0${i}.jpg`,
    alt: i === 1 ? 'Lake Nyos after the eruption' : null,
    context: null,
    width: 1200,
    height: 800,
    sha256: String(i).repeat(64),
    description,
    analysis_model: description ? 'gpt-5.5' : null,
  });

  it('shows each photo with its description as the tooltip and names the analysing model', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { ...videoWith([]), source_images: [photo(1, 'Grey still water, red laterite shore.'), photo(2, null)] },
    });
    renderPage();
    const block = await screen.findByTestId('source-photos');
    expect(block).toHaveTextContent('2 source photos from the page');
    expect(block).toHaveTextContent('1 described by gpt-5.5');
    expect(screen.getByTitle('Grey still water, red laterite shore.')).toHaveAttribute(
      'href',
      'https://upload.wikimedia.org/wikipedia/commons/a/ab/Nyos1.jpg',
    );
    expect(screen.getByAltText('Lake Nyos after the eruption')).toHaveAttribute(
      'src',
      expect.stringContaining('videos/7/00_sources/src01.jpg'),
    );
  });

  it('renders nothing for a video generated from a topic', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: videoWith([]) });
    renderPage();
    await screen.findByText('Warm and brown. #history #boston #wtf');
    expect(screen.queryByTestId('source-photos')).toBeNull();
  });
});
