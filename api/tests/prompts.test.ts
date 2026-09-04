import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MUSIC_GENRES } from '@reel-agent/shared';
import {
  buildChangeRequestPrompt,
  buildResearchPrompt,
  buildSourceImagesPrompt,
  researchSystem,
  buildStoryPrompt,
  buildTopicPrompt,
  loadPrompt,
  renderTemplate,
  sourceImagesSystem,
  storySystem,
  topicsSystem,
} from '../src/llm/prompts.js';

const promptsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prompts',
);

describe('renderTemplate', () => {
  it('substitutes {{var}} placeholders', () => {
    expect(renderTemplate('a {{x}} c', { x: 'b' })).toBe('a b c');
  });

  it('throws when a placeholder has no value', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow('missing');
  });
});

describe('prompt templates (prompts/ folder)', () => {
  it('every template file exists and is non-empty', () => {
    for (const name of [
      'story.system.md',
      'story.user.md',
      'story.change-request.md',
      'topics.system.md',
      'topics.user.md',
      'source-images.user.md',
      'research.system.md',
      'research.user.md',
    ] as const) {
      expect(loadPrompt(promptsDir, name).length).toBeGreaterThan(20);
    }
  });

  it('story prompt fills every placeholder', () => {
    const prompt = buildStoryPrompt(promptsDir, 'Lake Nyos');
    expect(prompt).toContain('Lake Nyos');
    expect(prompt).toContain('145 wpm');
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it('story prompt omits the source block without source material', () => {
    expect(buildStoryPrompt(promptsDir, 'Lake Nyos')).not.toContain('SOURCE MATERIAL');
  });

  it('story prompt embeds source material when provided', () => {
    const prompt = buildStoryPrompt(promptsDir, 'Lake Nyos', '# Scraped page\nDeadly CO2 cloud.');
    expect(prompt).toContain('SOURCE MATERIAL');
    expect(prompt).toContain('Deadly CO2 cloud.');
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it('source block tells the model how to use PHOTO NOTES', () => {
    const prompt = buildStoryPrompt(promptsDir, 'Lake Nyos', '# Scraped page\n## PHOTO NOTES\n1. Red soil.');
    expect(prompt).toMatch(/PHOTO NOTES.*they outrank your memory/);
    expect(prompt).toContain("Never describe a named person's face");
  });

  it('story prompt lists every music genre from the shared vocabulary', () => {
    const prompt = buildStoryPrompt(promptsDir, 'Lake Nyos');
    for (const genre of MUSIC_GENRES) expect(prompt).toContain(genre);
  });

  it('source-images prompt fills count, page and captions', () => {
    const prompt = buildSourceImagesPrompt(promptsDir, [
      {
        url: 'https://a.com/1.jpg',
        page_url: 'https://en.wikipedia.org/wiki/Lake_Nyos_disaster',
        file_path: 'videos/1/00_sources/src01.jpg',
        alt: 'Lake Nyos, 1986',
        context: null,
        width: 800,
        height: 600,
        sha256: 'x',
        description: null,
        analysis_model: null,
      },
      {
        url: 'https://a.com/2.jpg',
        page_url: 'https://en.wikipedia.org/wiki/Lake_Nyos_disaster',
        file_path: 'videos/1/00_sources/src02.jpg',
        alt: null,
        context: null,
        width: 800,
        height: 600,
        sha256: 'y',
        description: null,
        analysis_model: null,
      },
    ]);
    expect(prompt).toContain('2 photograph(s)');
    expect(prompt).toContain('https://en.wikipedia.org/wiki/Lake_Nyos_disaster');
    expect(prompt).toContain('1. Lake Nyos, 1986');
    expect(prompt).toContain('2. (no caption)');
    expect(prompt).toContain('NEVER a name, NEVER facial features');
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(sourceImagesSystem()).toContain('raw JSON');
  });

  it('change-request prompt carries source material through', () => {
    const prompt = buildChangeRequestPrompt(
      promptsDir,
      'Lake Nyos',
      '{"beats":[]}',
      'shorter hook',
      '# Scraped page\nDeadly CO2 cloud.',
    );
    expect(prompt).toContain('Deadly CO2 cloud.');
  });

  it('change-request prompt embeds the base prompt, previous JSON and request', () => {
    const prompt = buildChangeRequestPrompt(promptsDir, 'Lake Nyos', '{"beats":[]}', 'shorter hook');
    expect(prompt).toContain('Lake Nyos');
    expect(prompt).toContain('{"beats":[]}');
    expect(prompt).toContain('shorter hook');
  });

  it('topics prompt lists existing topics only when present', () => {
    expect(buildTopicPrompt(promptsDir, 5, ['Old topic'])).toContain('- Old topic');
    expect(buildTopicPrompt(promptsDir, 5, [])).not.toContain('Already covered');
  });

  it('system prompts load', () => {
    expect(storySystem(promptsDir)).toContain('One Minute WTF');
    expect(topicsSystem(promptsDir)).toContain('research agent');
  });
});

describe('research prompt', () => {
  const base = { count: 8, catalogue: [], liked: [], disliked: [] };

  it('fills every placeholder and states the rubric with its weights', () => {
    const prompt = buildResearchPrompt(promptsDir, base);
    expect(prompt).toContain('Find 8 true-story candidates');
    expect(prompt).toMatch(/- visual \(weight 3\):/);
    expect(prompt).toMatch(/- novelty \(weight 1\):/);
    expect(prompt).toContain('source_url');
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt).not.toContain('CATALOGUE');
    expect(prompt).not.toContain('PRODUCER FEEDBACK');
    expect(prompt).not.toContain('FOCUS');
  });

  it('lists the catalogue with a coarse status and the focus brief', () => {
    const prompt = buildResearchPrompt(promptsDir, {
      ...base,
      brief: '1970s maritime',
      catalogue: [
        { topic: 'Lake Nyos', status: 'published' },
        { topic: 'Banqiao Dam', status: 'render_review' },
        { topic: 'Tacoma', status: 'story_review' },
        { topic: 'Bad one', status: 'failed' },
      ],
    });
    expect(prompt).toContain('FOCUS from the producer for this run: 1970s maritime');
    expect(prompt).toContain('- Lake Nyos [published]');
    expect(prompt).toContain('- Banqiao Dam [rendered]');
    expect(prompt).toContain('- Tacoma [in progress]');
    expect(prompt).toContain('- Bad one [failed]');
  });

  it('groups rejections by reason with the teaching line, and lists likes as "more like these"', () => {
    const prompt = buildResearchPrompt(promptsDir, {
      ...base,
      liked: [{ topic: 'Lituya Bay 1958', hook: 'A wave stripped the mountain bare.' }],
      disliked: [
        { topic: 'Roswell', hook: 'x', reason: 'not_verifiable', note: null },
        { topic: 'Some ledger', hook: 'x', reason: 'not_visual', note: 'all paperwork' },
        { topic: 'Another ledger', hook: 'x', reason: 'not_visual', note: null },
      ],
    });
    expect(prompt).toContain('Liked — more like these');
    expect(prompt).toContain('- Lituya Bay 1958 — "A wave stripped the mountain bare."');
    expect(prompt).toMatch(/as NOT VISUAL \(the event has no moment a camera would have caught in progress\):\n {4}- Some ledger — producer: "all paperwork"\n {4}- Another ledger/);
    expect(prompt).toMatch(/as NOT VERIFIABLE \(.*\):\n {4}- Roswell/);
    expect(researchSystem(promptsDir)).toContain('inventing a URL is worse');
  });
});
