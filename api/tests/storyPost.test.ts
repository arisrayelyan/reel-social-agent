import { describe, expect, it } from 'vitest';
import { IMAGE_PROMPT_SUFFIX, MOTION_LOCKED_CAMERA, MOTION_NEGATIVES } from '@reel-agent/shared';
import { storyFixture } from './helpers.js';
import {
  buildImagePrompt,
  buildMotionPrompt,
  countWords,
  durationForWords,
  postProcessStory,
} from '../src/utils/storyPost.js';

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
  });
  it('handles empty text', () => {
    expect(countWords('   ')).toBe(0);
  });
});

describe('durationForWords (145 wpm rule)', () => {
  it('derives seconds from word count at 145 wpm', () => {
    expect(durationForWords(145)).toBe(60);
    expect(durationForWords(29)).toBe(12);
  });
});

describe('postProcessStory', () => {
  it('recomputes word counts and durations, ignoring LLM values', () => {
    const story = storyFixture();
    story.beats[0]!.word_count = 999;
    story.beats[0]!.duration_seconds = 999;
    const { story: processed } = postProcessStory(story);
    expect(processed.beats[0]!.word_count).toBe(28);
    expect(processed.beats[0]!.duration_seconds).toBeCloseTo((28 / 145) * 60, 1);
  });

  it('reindexes beats sequentially', () => {
    const story = storyFixture();
    story.beats.forEach((b) => (b.index = 99));
    const { story: processed } = postProcessStory(story);
    expect(processed.beats.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('warns when totals fall outside the 65-85s / 150-190 word envelope', () => {
    const story = storyFixture();
    story.beats.forEach((b) => (b.narration = 'just five short words here'));
    const { warnings } = postProcessStory(story);
    expect(warnings.some((w) => w.includes('word count'))).toBe(true);
    expect(warnings.some((w) => w.includes('duration'))).toBe(true);
  });

  it('forces locked-camera beats when the LLM provides fewer than 2', () => {
    const story = storyFixture();
    story.beats.forEach((b) => (b.camera_locked = false));
    const { story: processed, warnings } = postProcessStory(story);
    expect(processed.beats.filter((b) => b.camera_locked).length).toBeGreaterThanOrEqual(2);
    expect(warnings.some((w) => w.includes('locked-camera'))).toBe(true);
  });

  it('warns when narration contains digits (TTS needs words)', () => {
    const story = storyFixture();
    story.beats[0]!.narration = 'in 1986 something happened here in the highlands region';
    const { warnings } = postProcessStory(story);
    expect(warnings.some((w) => w.includes('digits'))).toBe(true);
  });
});

describe('prompt builders', () => {
  it('prepends the style prefix and appends the anti-grid suffix byte-identically', () => {
    const prompt = buildImagePrompt('STYLE PREFIX', 'a crater lake at dawn');
    expect(prompt).toBe(`STYLE PREFIX a crater lake at dawn. ${IMAGE_PROMPT_SUFFIX}.`);
  });

  it('appends the fixed negative block to motion prompts', () => {
    const prompt = buildMotionPrompt('slow push-in', false);
    expect(prompt).toBe(`slow push-in. ${MOTION_NEGATIVES}`);
  });

  it('adds the tripod line for locked-camera beats', () => {
    const prompt = buildMotionPrompt('mist drifts left.', true);
    expect(prompt.endsWith(MOTION_LOCKED_CAMERA)).toBe(true);
    expect(prompt).toContain(MOTION_NEGATIVES);
  });
});
