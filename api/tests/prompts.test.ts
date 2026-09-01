import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildChangeRequestPrompt,
  buildStoryPrompt,
  buildTopicPrompt,
  loadPrompt,
  renderTemplate,
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
