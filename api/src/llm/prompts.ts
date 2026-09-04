import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  DISLIKE_REASONS,
  HOOK_EXAMPLE_POOL,
  HOOK_UPGRADE_PAIRS,
  MUSIC_GENRES,
  RESEARCH_SCORE_AXES,
  SLOP_PHRASES_PROMPT_SAMPLE,
  TARGET_DURATION_SECONDS,
  TARGET_WORD_COUNT,
  WORDS_PER_MINUTE,
  type HookExample,
  type HookUpgrade,
  type SourceImage,
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
  'source-images.user.md',
  'research.system.md',
  'research.user.md',
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

/** How many weak→strong pairs reach the prompt out of HOOK_UPGRADE_PAIRS. */
export const HOOK_UPGRADES_PER_PROMPT = 2;

/**
 * Two weak→strong pairs, rotated from the topic like the form examples. The
 * strong line is what a specific, sensory, loss-aware hook looks like; the
 * weak line is the topical summary every model reaches for first.
 */
export function sampleHookUpgrades(topic: string, seed?: number): HookUpgrade[] {
  const base = seed ?? hashString(`${topic}::upgrades`);
  const limit = HOOK_UPGRADE_PAIRS.length;
  const picked: HookUpgrade[] = [];
  for (let step = 0; step < limit && picked.length < HOOK_UPGRADES_PER_PROMPT; step++) {
    const candidate = HOOK_UPGRADE_PAIRS[(base + step * 5) % limit]!;
    if (!picked.includes(candidate)) picked.push(candidate);
  }
  return picked;
}

function renderHookUpgrades(pairs: readonly HookUpgrade[]): string {
  return pairs.map((p) => '- weak: `' + p.weak + '` → strong: `' + p.strong + '`').join('\n');
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
  for (const pair of sampleHookUpgrades(topic)) {
    spans.add(pair.weak);
    spans.add(pair.strong);
  }
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
      `Base every fact, number and name strictly on the material below. If a detail is not in it, leave it out — never fill gaps from memory.\n` +
      `If the material ends with PHOTO NOTES, those describe the real photographs of the event: take geography, structures, vehicles, clothing, materials, colours and weather for the style_prefix and for every image_prompt from them — they outrank your memory. Never describe a named person's face.\n\n` +
      `<source_material>\n${sourceMaterial}\n</source_material>\n`
    : '';
  return renderTemplate(loadPrompt(promptsDir, 'story.user.md'), {
    topic,
    source_block: sourceBlock,
    hook_examples: renderHookExamples(sampleHookExamples(topic)),
    hook_upgrades: renderHookUpgrades(sampleHookUpgrades(topic)),
    banned_phrases: renderBannedPhrases(),
    min_words: TARGET_WORD_COUNT.min,
    max_words: TARGET_WORD_COUNT.max,
    min_seconds: TARGET_DURATION_SECONDS.min,
    max_seconds: TARGET_DURATION_SECONDS.max,
    wpm: WORDS_PER_MINUTE,
    music_genres: MUSIC_GENRES.join(', '),
  });
}

/** Short system line for the vision pass; the whole brief is in the user template. */
export function sourceImagesSystem(): string {
  return (
    'You are a photo analyst for a documentary reconstruction team. You report only what is physically visible, ' +
    'in plain concrete nouns, and you respond with a single JSON object and nothing else — raw JSON, no markdown fences.'
  );
}

export function buildSourceImagesPrompt(promptsDir: string, images: SourceImage[]): string {
  const captions = images
    .map((img, i) => `${i + 1}. ${img.alt || img.context || '(no caption)'}`)
    .join('\n');
  return renderTemplate(loadPrompt(promptsDir, 'source-images.user.md'), {
    count: images.length,
    page_url: images[0]?.page_url ?? '',
    captions,
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

export function researchSystem(promptsDir: string): string {
  return loadPrompt(promptsDir, 'research.system.md');
}

export interface ResearchPromptInput {
  count: number;
  brief?: string | null;
  /** Every video already made, with a coarse status — the "avoid" list and the "this worked" list. */
  catalogue: Array<{ topic: string; status: string }>;
  liked: Array<{ topic: string; hook: string }>;
  disliked: Array<{ topic: string; hook: string; reason: string | null; note: string | null }>;
}

function catalogueStatus(status: string): string {
  if (status === 'published' || status === 'publishing') return 'published';
  if (status === 'render_review' || status === 'rendering' || status === 'approved') return 'rendered';
  if (status === 'failed') return 'failed';
  return 'in progress';
}

/**
 * The research brief. Three blocks make each run better than the last: the
 * catalogue (never repeat, and the published ones show what works), the
 * producer's likes (more of this mechanism), and the dislikes grouped by
 * reason so the model learns the CLASS of rejection, not just the topic.
 */
export function buildResearchPrompt(promptsDir: string, input: ResearchPromptInput): string {
  const focusBlock = input.brief?.trim()
    ? `\nFOCUS from the producer for this run: ${input.brief.trim()}\n`
    : '';
  const rubricBlock = RESEARCH_SCORE_AXES.map((a) => `- ${a.key} (weight ${a.weight}): ${a.teach}.`).join('\n');

  const catalogueBlock = input.catalogue.length
    ? `\n\nCATALOGUE — already made. Never propose these or anything that is the same event in different words. The published ones are what "works" looks like on this channel:\n` +
      input.catalogue.map((v) => `- ${v.topic} [${catalogueStatus(v.status)}]`).join('\n')
    : '';

  let feedbackBlock = '';
  if (input.liked.length || input.disliked.length) {
    feedbackBlock = '\n\nPRODUCER FEEDBACK from earlier research runs:';
    if (input.liked.length) {
      feedbackBlock +=
        '\nLiked — more like these: same kind of mechanism and picture, a DIFFERENT event:\n' +
        input.liked.map((c) => `- ${c.topic} — "${c.hook}"`).join('\n');
    }
    if (input.disliked.length) {
      feedbackBlock += '\nRejected — do not propose these, and avoid the class of problem each group names:';
      const groups = new Map<string, typeof input.disliked>();
      for (const c of input.disliked) {
        const key = c.reason ?? 'other';
        groups.set(key, [...(groups.get(key) ?? []), c]);
      }
      for (const [reason, items] of groups) {
        const def = DISLIKE_REASONS.find((r) => r.id === reason);
        const label = (def?.label ?? reason).toUpperCase();
        const teach = def?.teach ?? 'see the producer note';
        feedbackBlock += `\n- as ${label} (${teach}):`;
        for (const c of items) {
          feedbackBlock += `\n    - ${c.topic}${c.note ? ` — producer: "${c.note}"` : ''}`;
        }
      }
    }
  }

  return renderTemplate(loadPrompt(promptsDir, 'research.user.md'), {
    count: input.count,
    focus_block: focusBlock,
    rubric_block: rubricBlock,
    catalogue_block: catalogueBlock,
    feedback_block: feedbackBlock,
  });
}
