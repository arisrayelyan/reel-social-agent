import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  TARGET_DURATION_SECONDS,
  TARGET_WORD_COUNT,
  WORDS_PER_MINUTE,
} from '@reel-agent/shared';

/**
 * All prompt text lives as editable markdown templates in the top-level
 * prompts/ folder ({{var}} placeholders). This module only loads and fills
 * them — edit the .md files to tune the voice, no rebuild needed.
 */

const PROMPT_FILES = [
  'story.system.md',
  'story.user.md',
  'story.change-request.md',
  'topics.system.md',
  'topics.user.md',
] as const;
export type PromptName = (typeof PROMPT_FILES)[number];

const cache = new Map<string, string>();

export function loadPrompt(promptsDir: string, name: PromptName): string {
  const filePath = path.join(promptsDir, name);
  // re-read in dev so prompt edits apply without restart
  if (process.env.NODE_ENV === 'production' && cache.has(filePath)) {
    return cache.get(filePath)!;
  }
  const content = readFileSync(filePath, 'utf8').trim();
  cache.set(filePath, content);
  return content;
}

/** Fills {{var}} placeholders; throws on any placeholder left unfilled. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt template variable missing: ${key}`);
    return String(vars[key]);
  });
  return rendered;
}

export function storySystem(promptsDir: string): string {
  return loadPrompt(promptsDir, 'story.system.md');
}

export function buildStoryPrompt(
  promptsDir: string,
  topic: string,
  sourceMaterial?: string | null,
): string {
  const sourceBlock = sourceMaterial
    ? `\nSOURCE MATERIAL (scraped from the web — your ONLY source of facts):\n` +
      `Base every fact, number and name strictly on the material below. If a detail is not in it, leave it out — never fill gaps from memory.\n\n` +
      `<source_material>\n${sourceMaterial}\n</source_material>\n`
    : '';
  return renderTemplate(loadPrompt(promptsDir, 'story.user.md'), {
    topic,
    source_block: sourceBlock,
    min_words: TARGET_WORD_COUNT.min,
    max_words: TARGET_WORD_COUNT.max,
    min_seconds: TARGET_DURATION_SECONDS.min,
    max_seconds: TARGET_DURATION_SECONDS.max,
    wpm: WORDS_PER_MINUTE,
  });
}

export function buildChangeRequestPrompt(
  promptsDir: string,
  topic: string,
  previousStoryJson: string,
  changeRequest: string,
  sourceMaterial?: string | null,
): string {
  return renderTemplate(loadPrompt(promptsDir, 'story.change-request.md'), {
    story_prompt: buildStoryPrompt(promptsDir, topic, sourceMaterial),
    previous_story_json: previousStoryJson,
    change_request: changeRequest,
  });
}

export function topicsSystem(promptsDir: string): string {
  return loadPrompt(promptsDir, 'topics.system.md');
}

export function buildTopicPrompt(
  promptsDir: string,
  count: number,
  existingTopics: string[],
): string {
  const existingBlock =
    existingTopics.length > 0
      ? `\nAlready covered (avoid anything similar):\n${existingTopics.map((t) => `- ${t}`).join('\n')}\n`
      : '';
  return renderTemplate(loadPrompt(promptsDir, 'topics.user.md'), {
    count,
    existing_topics_block: existingBlock,
  });
}
