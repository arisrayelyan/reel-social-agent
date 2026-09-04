import { describe, expect, it } from 'vitest';
import {
  BEAT_GAP_SECONDS,
  END_TAIL_SECONDS,
  IMAGE_PROMPT_SUFFIX,
  MOTION_LOCKED_CAMERA,
  LlmStorySchema,
  MOTION_NEGATIVES,
  StorySchema,
} from '@reel-agent/shared';
import { goodStoryFixture, sloppyStoryFixture, storyFixture } from './helpers.js';
import {
  buildImagePrompt,
  buildMotionPrompt,
  countWords,
  deriveOverlayHook,
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

describe('LlmStorySchema', () => {
  it('accepts an over-long evidence_stamp (normalized later, never a paid retry)', () => {
    // the exact stamp that burned two codex calls on 2 Sep 2026
    const story = { ...storyFixture(), evidence_stamp: 'WILLISTON RESERVOIR, BRITISH COLUMBIA, CANADA — AUGUST 2026' };
    expect(LlmStorySchema.parse(story).evidence_stamp).toHaveLength(59);
  });

  it('lowercases and trims beat roles before the enum', () => {
    const story = storyFixture();
    const raw = { ...story, beats: story.beats.map((b, i) => (i === 1 ? { ...b, role: ' Setup ' } : b)) };
    expect(LlmStorySchema.parse(raw).beats[1]!.role).toBe('setup');
  });

  it('still rejects a genuinely invalid role, naming the allowed values', () => {
    const story = storyFixture();
    const raw = { ...story, beats: story.beats.map((b, i) => (i === 2 ? { ...b, role: 'context' } : b)) };
    expect(() => LlmStorySchema.parse(raw)).toThrow(/hook/);
  });

  it('swallows wrong-typed derived fields instead of failing the parse', () => {
    const story = storyFixture();
    const raw = {
      ...story,
      beats: story.beats.map((b) => ({ ...b, word_count: '42' as unknown as number, duration_seconds: 0 })),
    };
    const parsed = LlmStorySchema.parse(raw);
    expect(parsed.beats[0]!.word_count).toBeUndefined();
    expect(parsed.beats[0]!.duration_seconds).toBeUndefined();
  });

  it('defaults camera_locked to false when the model omits it on unlocked beats', () => {
    const story = storyFixture();
    const raw = {
      ...story,
      // models write camera_locked only where it is true — omit it elsewhere.
      // Nothing forces it any more, so the fixture has none: set one here.
      beats: story.beats.map(({ camera_locked: _drop, ...rest }, i) =>
        i === 4 ? { ...rest, camera_locked: true } : rest,
      ),
    };
    const parsed = LlmStorySchema.parse(raw);
    expect(parsed.beats.every((b) => typeof b.camera_locked === 'boolean')).toBe(true);
    expect(parsed.beats[0]!.camera_locked).toBe(false);
    expect(parsed.beats[4]!.camera_locked).toBe(true);
  });
});

describe('postProcessStory normalizers', () => {
  it('shortens an over-long evidence_stamp on a word boundary, with a warning', () => {
    const raw = {
      ...storyFixture(),
      evidence_stamp: 'WILLISTON RESERVOIR, BRITISH COLUMBIA, CANADA — AUGUST 2026',
    };
    const { story, findings } = postProcessStory(raw);
    expect(story.evidence_stamp!.length).toBeLessThanOrEqual(48);
    expect(story.evidence_stamp).toBe('WILLISTON RESERVOIR, BRITISH COLUMBIA, CANADA');
    expect(findings.some((f) => f.rule === 'stamp.shortened' && f.severity === 'warning')).toBe(true);
  });

  it('shortens an over-long exhibit_tag with a warning', () => {
    const raw = storyFixture();
    raw.beats[2]!.exhibit_tag = 'EXHIBIT A — GAS LAKE CROSS SECTION DIAGRAM';
    const { story, findings } = postProcessStory(raw);
    expect(story.beats[2]!.exhibit_tag!.length).toBeLessThanOrEqual(24);
    expect(findings.some((f) => f.rule === 'exhibit.shortened')).toBe(true);
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

});

describe('deriveOverlayHook', () => {
  it('truncates to the on-screen maximum and drops terminal punctuation', () => {
    expect(deriveOverlayHook('One two three four five six seven eight nine ten.')).toBe(
      'One two three four five six seven eight',
    );
  });
  it('leaves a short hook alone but strips the full stop', () => {
    expect(deriveOverlayHook('Molasses killed twenty one people.')).toBe(
      'Molasses killed twenty one people',
    );
  });
});

describe('overlay_hook back-compat', () => {
  // The regression that would actually break production: worker.ts hard-parses
  // every historical videos.story row on every render.
  it('a story with no overlay_hook, evidence_stamp or exhibit_tag still parses', () => {
    const legacy = storyFixture();
    delete legacy.overlay_hook;
    delete legacy.evidence_stamp;
    expect(() => StorySchema.parse(legacy)).not.toThrow();
  });

  it('derives an overlay_hook and says so when the model omitted one', () => {
    const { story, findings } = postProcessStory(storyFixture());
    expect(story.overlay_hook).toBeTruthy();
    expect(findings.some((f) => f.rule === 'overlay.derived')).toBe(true);
  });

  it('keeps a model-written overlay_hook and warns when it is too long', () => {
    const raw = storyFixture({ overlay_hook: 'One two three four five six seven eight nine' });
    const { story, findings } = postProcessStory(raw);
    expect(story.overlay_hook).toBe('One two three four five six seven eight');
    expect(findings.some((f) => f.rule === 'overlay.truncated')).toBe(true);
  });
});

describe('findings alongside the legacy warnings array', () => {
  it('warnings is exactly the findings details, in order', () => {
    const { findings, warnings } = postProcessStory(storyFixture());
    expect(warnings).toEqual(findings.map((f) => f.detail));
    expect(findings.every((f) => f.rule && f.severity && f.field)).toBe(true);
  });

  it('includes END_TAIL_SECONDS in the duration estimate', () => {
    // the render adds a 1.2s tail to the last beat (beatTargetSeconds), so an
    // estimate without it measures something shorter than what ships
    const { story, totalSeconds } = postProcessStory(goodStoryFixture());
    const narration = story.beats.reduce((sum, b) => sum + b.duration_seconds, 0);
    const gaps = BEAT_GAP_SECONDS * (story.beats.length - 1);
    expect(totalSeconds).toBeCloseTo(narration + gaps + END_TAIL_SECONDS, 1);
  });

  it('never throws, however broken the story is', () => {
    expect(() => postProcessStory(sloppyStoryFixture())).not.toThrow();
  });
});
