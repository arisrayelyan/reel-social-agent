import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_VERBS,
  CAPTURE_MEDIA,
  HOOK_EXAMPLE_POOL,
  SHOT_TYPES,
  SLOP_PHRASES,
  SLOP_PHRASES_PROMPT_SAMPLE,
  STYLE_PREFIX_OPENER,
  TARGET_BEAT_COUNT,
  TARGET_DURATION_SECONDS,
  TARGET_WORD_COUNT,
  WORDS_PER_MINUTE,
  matchPhrases,
} from '@reel-agent/shared';
import {
  HOOK_EXAMPLES_PER_PROMPT,
  buildStoryPrompt,
  loadPrompt,
  sampleHookExamples,
  storyPromptExamples,
  storySystem,
  topicsSystem,
} from '../src/llm/prompts.js';

const promptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');
const TOPIC = 'The Boston molasses flood of 1919';
const prompt = () => buildStoryPrompt(promptsDir, TOPIC);
const template = () => loadPrompt(promptsDir, 'story.user.md');

/**
 * The rules the validator enforces must still be STATED in the prompt.
 * Named individually so a prompt edit that drops one fails by name instead of
 * by a vague snapshot diff.
 */
const HARD_RULES: Array<{ name: string; re: RegExp }> = [
  { name: '145 wpm', re: /145 wpm/ },
  { name: 'word envelope', re: /150-190 words/ },
  { name: 'no digits', re: /NO digits/i },
  { name: 'numbers as spoken words', re: /spoken words/i },
  { name: 'no stage directions', re: /\[sigh\]/ },
  { name: 'terminal punctuation', re: /terminal punctuation/i },
  { name: 'hook <= 10 words', re: /[Mm]aximum 10 words/ },
  { name: 'anomaly in the first four words', re: /first 4 words/i },
  { name: 'no date opener', re: /[Nn]ever open with a date/ },
  { name: 'seven hook forms', re: /evidence question/i },
  { name: 'sentence-length variance', re: /[Vv]ary sentence length/ },
  { name: 'no picture description', re: /[Nn]ever describe or point at the picture/ },
  { name: 'names the pointing phrases', re: /look at/ },
  { name: 'withheld payoff per beat', re: /withholding ONE concrete/ },
  { name: 'motion only', re: /[Dd]escribe motion ONLY/ },
  { name: 'motion under 30 words', re: /[Uu]nder 30 words/ },
  { name: 'one camera cue maximum', re: /[Aa]t most ONE camera cue/ },
  { name: 'explicit camera on non-locked beats', re: /flat slow zoom/ },
  { name: 'plausible physics', re: /physically plausible/ },
  { name: 'verb once per video', re: /at most once across the whole video/ },
  { name: '2-3 camera_locked', re: /exactly 2 or 3 quieter beats/ },
  { name: 'at least 5 shot types', re: /at least 5 DIFFERENT shot types/i },
  { name: 'imperfection detail', re: /wear or imperfection detail/ },
  { name: 'light source with direction', re: /motivated light source WITH a direction/ },
  { name: 'off-centre composition', re: /off-centre/ },
  { name: 'no style words in image prompts', re: /No style words/ },
  { name: 'no people or bodies', re: /No people, faces, bodies/ },
  { name: 'Evidence File skeleton', re: new RegExp(STYLE_PREFIX_OPENER) },
  { name: 'exactly one capture medium', re: /exactly ONE capture medium/ },
  { name: 'era follows the event', re: /era of the EVENT/ },
  { name: 'no negatives in style_prefix', re: /Do NOT include negative terms/ },
  { name: 'overlay hook <= 8 words', re: /maximum 8 words/ },
  { name: 'evidence stamp', re: /evidence_stamp/ },
  { name: 'caption fold', re: /under 100 characters/ },
  { name: 'derived fields omitted', re: /Do NOT output index, word_count or duration_seconds/ },
];

describe('story prompt still states every hard rule', () => {
  it.each(HARD_RULES)('$name', ({ re }) => {
    expect(prompt()).toMatch(re);
  });
});

describe('prompt and shared craft data agree', () => {
  it('teaches every approved shot type', () => {
    for (const shot of SHOT_TYPES) expect(prompt()).toContain(shot.prefix);
  });

  it('teaches every camera verb family', () => {
    // asserted by stem: the prompt writes "push-in" where the key is push_in
    const stems = [...new Set(CAMERA_VERBS.map((v) => v.key.split('_')[0]!))];
    for (const stem of stems) {
      expect(prompt().toLowerCase(), `camera vocabulary is missing "${stem}"`).toContain(stem);
    }
  });

  it('teaches at least one detection keyword for every capture medium', () => {
    // a medium the prompt never names is a medium style.capture_medium can
    // never see, so the era table and CAPTURE_MEDIA must not drift apart
    for (const medium of CAPTURE_MEDIA) {
      expect(
        matchPhrases(prompt(), medium.keywords).length,
        `the era table does not name ${medium.id}`,
      ).toBeGreaterThan(0);
    }
  });

  it('carries the pacing and envelope constants', () => {
    const p = prompt();
    expect(p).toContain(String(WORDS_PER_MINUTE));
    expect(p).toContain(String(TARGET_WORD_COUNT.min));
    expect(p).toContain(String(TARGET_WORD_COUNT.max));
    expect(p).toContain(String(TARGET_DURATION_SECONDS.min));
    expect(p).toContain(String(TARGET_DURATION_SECONDS.max));
    expect(p).toContain(`${TARGET_BEAT_COUNT.min} to ${TARGET_BEAT_COUNT.max} beats`);
  });

  it('injects the banned-phrase sample, and the sample is a real subset', () => {
    for (const phrase of SLOP_PHRASES_PROMPT_SAMPLE) {
      expect(prompt()).toContain(phrase);
      expect(SLOP_PHRASES).toContain(phrase);
    }
    // the full lexicon stays validator-side: a long "never write X" list can
    // prime the model toward the listed phrasing
    expect(SLOP_PHRASES_PROMPT_SAMPLE.length).toBeLessThan(SLOP_PHRASES.length);
  });
});

describe('example discipline (the slop fix has to stay fixed)', () => {
  it('the static template contains no copyable prose example', () => {
    // backticks mean exactly one thing here: "example prose, do not reuse".
    // Every such example now lives in HOOK_EXAMPLE_POOL and is injected, so a
    // literal one reappearing in the template is a regression.
    const spans = [...template().matchAll(/`([^`\n]{10,120})`/g)]
      .map((m) => m[1]!.trim())
      .filter((span) => span.split(/\s+/).filter(Boolean).length >= 3);
    expect(spans).toEqual([]);
  });

  it('has no unlabeled parenthesised example', () => {
    // the OLD example form was ("A lake killed a valley. Silently.") — this
    // assertion mechanically forces the backtick convention on future edits
    expect(template()).not.toMatch(/\([^)]*"[^"]{15,}"/);
  });

  it('extracts exactly the injected hook examples', () => {
    const extracted = storyPromptExamples(promptsDir, TOPIC);
    expect(extracted).toHaveLength(HOOK_EXAMPLES_PER_PROMPT);
    for (const span of extracted) {
      expect(HOOK_EXAMPLE_POOL.map((e) => e.text)).toContain(span);
    }
  });

  it('keeps every pool example short and slop-free', () => {
    for (const example of HOOK_EXAMPLE_POOL) {
      expect(example.text.split(/\s+/).length, example.text).toBeLessThanOrEqual(10);
      expect(matchPhrases(example.text, SLOP_PHRASES), example.text).toEqual([]);
      expect(/\d/.test(example.text), example.text).toBe(false);
    }
  });

  it('rotates the examples across topics instead of teaching one phrasing', () => {
    const forms = new Set(
      ['Lake Nyos', 'Centralia mine fire', 'Lituya Bay', 'The Carrington Event', 'Tunguska']
        .flatMap((t) => sampleHookExamples(t).map((e) => e.form)),
    );
    expect(forms.size).toBeGreaterThan(2);
  });

  it('samples deterministically, and a pinned seed is reproducible', () => {
    expect(sampleHookExamples(TOPIC)).toEqual(sampleHookExamples(TOPIC));
    expect(sampleHookExamples('anything', 3)).toEqual(sampleHookExamples('other', 3));
  });

  it('picks two different hook forms', () => {
    const picked = sampleHookExamples(TOPIC);
    expect(picked).toHaveLength(2);
    expect(picked[0]!.form).not.toBe(picked[1]!.form);
  });

  it('leaves no placeholder unfilled', () => {
    expect(prompt()).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('system prompts', () => {
  it('the story system prompt carries the Evidence File identity', () => {
    const system = storySystem(promptsDir);
    expect(system).toContain('One Minute WTF');
    expect(system).toMatch(/visual record of the event/);
    expect(system).toMatch(/\[sigh\]/);
  });

  it('the topics system prompt scores for audience relevance', () => {
    expect(topicsSystem(promptsDir)).toContain('research agent');
    expect(topicsSystem(promptsDir)).toMatch(/twenty-year-old with zero context/);
  });
});
