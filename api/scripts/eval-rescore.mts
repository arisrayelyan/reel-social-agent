/**
 * Re-scores the stories saved by `pnpm prompt:eval` (api/eval-out/*.json)
 * against the CURRENT validator — free, offline, instant.
 *
 * Use it after editing a rule: the eval costs minutes and cents per story,
 * the re-score costs nothing and tells you whether the rule change fixed the
 * finding you were aiming at without touching the others.
 *
 *   pnpm prompt:rescore
 */
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LlmStorySchema } from '@reel-agent/shared';
import { postProcessStory } from '../src/utils/storyPost.js';
import { storyPromptExamples } from '../src/llm/prompts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../eval-out');
const promptsDir = path.resolve(here, '../../prompts');

for (const file of readdirSync(outDir).filter((f) => f.endsWith('.json')).sort()) {
  const saved = JSON.parse(readFileSync(path.join(outDir, file), 'utf8')) as {
    topic: string;
    story: unknown;
  };
  const parsed = LlmStorySchema.safeParse(saved.story);
  if (!parsed.success) {
    console.log(`\n${file}\n  (story no longer parses against LlmStorySchema — regenerate it)`);
    continue;
  }
  const { findings, totalWords, totalSeconds } = postProcessStory(parsed.data, {
    promptExamples: storyPromptExamples(promptsDir, saved.topic),
  });
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  console.log(`\n${saved.topic}`);
  console.log(`  ${totalWords} words / ${totalSeconds}s / ${parsed.data.beats.length} beats`);
  console.log(`  errors  : ${errors.length ? errors.map((f) => `${f.rule}@${f.beat_index ?? '-'}`).join(', ') : 'none'}`);
  console.log(`  warnings: ${[...new Set(warnings.map((f) => f.rule))].join(', ') || 'none'}`);
}
