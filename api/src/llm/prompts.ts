import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  HOOK_EXAMPLE_POOL,
  SLOP_PHRASES_PROMPT_SAMPLE,
  TARGET_DURATION_SECONDS,
  TARGET_WORD_COUNT,
  WORDS_PER_MINUTE,
  type HookExample,
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

/** How many hook examples reach the prompt out of HOOK_EXAMPLE_POOL. */
export const HOOK_EXAMPLES_PER_PROMPT = 2;

/** Stable 32-bit hash - seeds the hook-example sample from the topic. */
function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Two examples of DIFFERENT hook forms, chosen deterministically from the
 * topic. Rotating the pool is the whole point: a fixed example becomes the
 * channel's tic - the old static prompt taught every video to open
 * "<noun> <violent verb> <noun>. <Adverb>." Seeding from the topic also means
 * a change-request regeneration sees the same examples, so the voice does not
 * re-roll mid-story.
 */
export function sampleHookExamples(topic: string, seed?: number): HookExample[] {
  const base = seed ?? hashString(topic);
  const picked: HookExample[] = [];
  const usedForms = new Set<string>();
  const limit = HOOK_EXAMPLE_POOL.length;
  for (let step = 0; step < limit && picked.length < HOOK_EXAMPLES_PER_PROMPT; step++) {
    // stride by an odd offset so neighbouring topics do not pick neighbours
    const candidate = HOOK_EXAMPLE_POOL[(base + step * 7) % limit]!;
    if (usedForms.has(candidate.form)) continue;
    usedForms.add(candidate.form);
    picked.push(candidate);
  }
  return picked;
}

function renderHookExamples(examples: readonly HookExample[]): string {
  return examples.map((e) => '- ' + e.form + ': `' + e.text + '`').join('\n');
}

/**
 * Quoted, NOT backticked. Backticks in story.user.md mean exactly one thing -
 * "example prose that must not be reused" - and storyPromptExamples() reads
 * them as such. A banned phrase is already caught by narration.slop_phrase, so
 * backticking it here would only produce a duplicate leakage finding.
 */
function renderBannedPhrases(): string {
  return SLOP_PHRASES_PROMPT_SAMPLE.map((phrase) => '- "' + phrase + '"').join('\n');
}

/**
 * Every backticked example span in story.user.md that reads as prose, plus the
 * rotating hook examples injected for this topic.
 *
 * The prompt convention is that ALL illustrative sentences are wrapped in
 * backticks. That is what makes them extractable here, so the validator can
 * flag a story that copied one (story.example_leakage) and the contract test
 * can assert no unlabeled examples remain.
 */
export function storyPromptExamples(promptsDir: string, topic = 'Lake Nyos'): string[] {
  const template = loadPrompt(promptsDir, 'story.user.md');
  const spans = new Set<string>();
  for (const match of template.matchAll(/`([^`\n]{10,120})`/g)) {
    const span = match[1]!.trim();
    if (span.split(/\s+/).filter(Boolean).length >= 3) spans.add(span);
  }
  for (const example of sampleHookExamples(topic)) spans.add(example.text);
  return [...spans];
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
    hook_examples: renderHookExamples(sampleHookExamples(topic)),
    banned_phrases: renderBannedPhrases(),
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
