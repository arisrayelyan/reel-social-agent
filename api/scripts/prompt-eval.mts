/**
 * Prompt evaluation harness: generates stories for 5 fixed test topics with
 * the Claude CLI (Opus) and scores each against the measurable quality bars
 * from docs/ (hook craft, envelope, turn timing, shot variety, motion energy).
 *
 * Usage:  cd api && pnpm exec tsx --env-file=.env scripts/prompt-eval.mts [outDir]
 */
import 'dotenv/config';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { LlmStorySchema, type Story } from '@reel-agent/shared';
import { loadConfig } from '../src/config.js';
import { ClaudeCodeProvider } from '../src/llm/claudeCode.js';
import { generateJsonWithRetry } from '../src/llm/index.js';
import { buildStoryPrompt, storySystem } from '../src/llm/prompts.js';
import { postProcessStory } from '../src/utils/storyPost.js';

const TOPICS = [
  'Lake Nyos, Cameroon 1986 — a lake silently killed 1,746 people overnight',
  'Lituya Bay, Alaska 1958 — the 524-meter mega-tsunami that two fishermen survived',
  'The 1904 Olympic marathon — the winner rode a car and the real winner was poisoned by his own coach',
  'Centralia, Pennsylvania — the town that has been on fire underground since 1962',
  'The 1859 Carrington Event — telegraph machines operated on aurora power with batteries disconnected',
];

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export function scoreStory(story: Story, totals: { words: number; seconds: number }, warnings: string[]): Check[] {
  const checks: Check[] = [];
  const beats = story.beats;

  const hookWords = story.hook.trim().split(/\s+/).length;
  checks.push({
    name: 'hook ≤ 10 words',
    pass: hookWords <= 10,
    detail: `${hookWords} words: "${story.hook}"`,
  });

  checks.push({
    name: 'envelope 150-190w / 65-85s, no digits',
    pass: warnings.length === 0,
    detail: `${totals.words}w ${totals.seconds}s${warnings.length ? ` — ${warnings.join('; ')}` : ''}`,
  });

  const turnIndex = beats.findIndex((b) => b.role === 'turn');
  const secondsBeforeTurn = beats
    .slice(0, Math.max(turnIndex, 0))
    .reduce((s, b) => s + b.duration_seconds, 0);
  checks.push({
    name: 'first turn before ~25s',
    pass: turnIndex !== -1 && secondsBeforeTurn <= 27,
    detail: turnIndex === -1 ? 'no turn beat' : `turn at beat ${turnIndex}, ${secondsBeforeTurn.toFixed(0)}s in`,
  });

  // shot variety: classify each image_prompt by shot grammar keyword
  const grammars = ['close', 'macro', 'detail', 'wide', 'aerial', 'overhead', 'interior', 'low angle', 'silhouette'];
  const shotTypes = new Set(
    beats.map((b) => grammars.find((g) => b.image_prompt.toLowerCase().includes(g)) ?? 'unclassified'),
  );
  checks.push({
    name: 'shot variety ≥ 4 grammars',
    pass: [...shotTypes].filter((s) => s !== 'unclassified').length >= 4,
    detail: [...shotTypes].join(', '),
  });

  const firstWords = beats.map((b) => b.image_prompt.toLowerCase().split(/\s+/).slice(0, 2).join(' '));
  const consecutiveDupes = firstWords.filter((w, i) => i > 0 && w === firstWords[i - 1]).length;
  checks.push({
    name: 'no consecutive same-opening image prompts',
    pass: consecutiveDupes === 0,
    detail: `${consecutiveDupes} consecutive duplicates`,
  });

  // motion energy: verb variety + subject motion
  const motionVerbs = beats.map(
    (b) => b.motion_prompt.toLowerCase().match(/\b(\w+(?:s|ing))\b/)?.[1] ?? b.motion_prompt.toLowerCase().split(/\s+/)[0] ?? '',
  );
  const verbCounts = new Map<string, number>();
  motionVerbs.forEach((v) => verbCounts.set(v, (verbCounts.get(v) ?? 0) + 1));
  const maxVerbRepeat = Math.max(...verbCounts.values());
  checks.push({
    name: 'motion verb variety (max repeat ≤ 2)',
    pass: maxVerbRepeat <= 2,
    detail: [...verbCounts.entries()].filter(([, n]) => n > 1).map(([v, n]) => `${v}×${n}`).join(', ') || 'all unique',
  });

  const cameraOnly = /^(camera|slow|gentle|static|locked|push|pull|pan|tilt|zoom|drift|dolly|orbit)/;
  const subjectMotion = beats.filter((b) => !cameraOnly.test(b.motion_prompt.trim().toLowerCase())).length;
  checks.push({
    name: 'subject motion in ≥ 3 beats',
    pass: subjectMotion >= 3,
    detail: `${subjectMotion} beats move the scene, not just the camera`,
  });

  const locked = beats.filter((b) => b.camera_locked).length;
  checks.push({
    name: 'camera_locked 2-3',
    pass: locked >= 2 && locked <= 3,
    detail: `${locked} locked beats`,
  });

  checks.push({
    name: '"slow push-in" at most once',
    pass: beats.filter((b) => /slow push[- ]?in/i.test(b.motion_prompt)).length <= 1,
    detail: `${beats.filter((b) => /slow push[- ]?in/i.test(b.motion_prompt)).length} occurrences`,
  });

  return checks;
}

const isMain = process.argv[1]?.endsWith('prompt-eval.mts');
if (isMain) {
  const config = loadConfig();
  const outDir = path.resolve(process.argv[2] ?? 'prompt-eval-out');
  await mkdir(outDir, { recursive: true });
  const provider = new ClaudeCodeProvider(config.claudeCliPath, config.claudeModel);

  let totalPass = 0;
  let totalChecks = 0;
  for (const [i, topic] of TOPICS.entries()) {
    process.stdout.write(`\n[${i + 1}/5] ${topic.slice(0, 70)}...\n`);
    const started = Date.now();
    const result = await generateJsonWithRetry(provider, {
      system: storySystem(config.promptsDir),
      prompt: buildStoryPrompt(config.promptsDir, topic),
      schema: LlmStorySchema,
    });
    const processed = postProcessStory(result.data);
    await writeFile(
      path.join(outDir, `story-${i + 1}.json`),
      JSON.stringify({ topic, totals: { words: processed.totalWords, seconds: processed.totalSeconds }, warnings: processed.warnings, story: processed.story }, null, 2),
    );
    const checks = scoreStory(processed.story, { words: processed.totalWords, seconds: processed.totalSeconds }, processed.warnings);
    for (const c of checks) {
      console.log(`  ${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`);
    }
    const passed = checks.filter((c) => c.pass).length;
    totalPass += passed;
    totalChecks += checks.length;
    console.log(`  → ${passed}/${checks.length} in ${((Date.now() - started) / 1000).toFixed(0)}s ($${result.costUsd})`);
  }
  console.log(`\nTOTAL: ${totalPass}/${totalChecks} checks passed. Stories saved to ${outDir}`);
}
