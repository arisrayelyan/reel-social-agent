import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Video } from '@reel-agent/shared';
import { PipelineStrip, stageStates } from '@/components/design/PipelineStrip';

const baseVideo = {
  id: 1,
  topic: 'Lake Nyos',
  hook: 'h',
  status: 'rendering',
  current_step: 'clips',
  story: null,
  story_versions: [],
  error: null,
  total_cost_usd: 0,
  created_at: '',
  updated_at: '',
} as unknown as Video;

describe('stageStates', () => {
  it('marks stages before the current step done, current active', () => {
    expect(stageStates('rendering', 'clips')).toEqual(['done', 'done', 'active', 'todo', 'todo']);
  });

  it('marks every stage done once the render is reviewed/published', () => {
    expect(stageStates('render_review', null)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(stageStates('published', null)).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('marks the failing step failed', () => {
    expect(stageStates('failed', 'merge')).toEqual(['done', 'done', 'done', 'failed', 'todo']);
  });

  it('shows all todo before the render starts', () => {
    expect(stageStates('story_review', null)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
  });
});

describe('PipelineStrip', () => {
  it('renders all five stage cells', () => {
    render(<PipelineStrip video={baseVideo} />);
    for (const label of ['TTS', 'IMG', 'CLIP', 'MRG', 'CAP']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('titles the active cell for the current step', () => {
    render(<PipelineStrip video={baseVideo} />);
    expect(screen.getByTitle('clips: active')).toBeInTheDocument();
  });
});
