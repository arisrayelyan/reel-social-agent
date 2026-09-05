import os from 'node:os';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LlmStorySchema, type StoryFinding } from '@reel-agent/shared';
import { ClaudeCodeProvider } from '../src/llm/claudeCode.js';
import { CodexProvider } from '../src/llm/codex.js';
import { CursorAgentProvider } from '../src/llm/cursorAgent.js';
import { OllamaProvider } from '../src/llm/ollama.js';
import { generateJsonWithRetry, type LlmProvider } from '../src/llm/index.js';
import { buildStoryPrompt, storyPromptExamples, storySystem } from '../src/llm/prompts.js';
import { postProcessStory } from '../src/utils/storyPost.js';

/**
 * The real prompt-quality instrument: generate stories and measure them with
 * the same gate the pipeline uses.
 *
 *   cd api && RUN_EVAL=1 pnpm test storyEval
 *   RUN_EVAL=1 EVAL_PROVIDER=ollama pnpm test storyEval
 *
 * Defaults to the Claude CLI on Haiku: fast, cheap, always available, and it
 * needs no local GPU — a 24GB local model turned out to cost minutes per story
 * and a hot laptop. Ollama stays available for a zero-cost run.
 *
 * NEVER part of `pnpm test` and never in CI.
 *
 * The deliverable is the printed histogram, not the assertion. Run it before
 * and after a prompt edit and diff the two — that is how you find out whether
 * a rule change actually moved the output.
 *
 * Note on provider skew: only the Ollama path gets schema-constrained
 * decoding. The CLI providers must produce conforming JSON from prose, so a
 * schema failure there is a MODEL limit, not a prompt defect — read the
 * histogram, not the pass/fail, when comparing across providers.
 */
const RUN = process.env.RUN_EVAL === '1';
const N = Number(process.env.EVAL_N ?? 3);
const PROVIDER = process.env.EVAL_PROVIDER ?? 'claude-code';
/** Cheapest capable model per provider — an eval run is many stories. */
const DEFAULT_EVAL_MODEL: Record<string, string> = {
  ollama: 'qwen3.6:latest',
  'claude-code': 'haiku',
  codex: 'gpt-5.4-mini',
  'cursor-agent': 'gemini-3.8-flash-medium',
};
const MODEL = process.env.EVAL_MODEL ?? DEFAULT_EVAL_MODEL[PROVIDER] ?? 'haiku';

function evalProvider(): LlmProvider {
  switch (PROVIDER) {
    case 'ollama':
      return new OllamaProvider(process.env.OLLAMA_URL ?? 'http://localhost:11434', MODEL);
    case 'codex':
      return new CodexProvider(process.env.CODEX_CLI_PATH ?? 'codex', MODEL);
    case 'claude-code':
      return new ClaudeCodeProvider(process.env.CLAUDE_CLI_PATH ?? 'claude', MODEL);
    case 'cursor-agent':
      return new CursorAgentProvider(
        process.env.CURSOR_CLI_PATH ?? 'cursor-agent',
        MODEL,
        {},
        path.join(os.tmpdir(), 'reel-agent-cursor-eval'),
      );
    default:
      throw new Error(
        `Unknown EVAL_PROVIDER "${PROVIDER}" (ollama | claude-code | codex | cursor-agent)`,
      );
  }
}

/**
 * Assert ONLY on rules a competent model should never break. Everything else
 * is reported. Asserting "zero errors" against a local 30B model would go red
 * on a shot-type collision every few runs, and a suite that cries wolf is a
 * suite people stop reading.
 */
const EVAL_HARD_RULES = new Set([
  'narration.digits',
  'narration.stage_directions',
  'narration.terminal_punctuation',
  'narration.picture_describing',
  'narration.slop_phrase',
  'image.shot_type_prefix',
  'story.example_leakage',
]);

/** Fixed and checked in — none of these appears in HOOK_EXAMPLE_POOL. */
const TOPICS = [
  'Centralia, Pennsylvania — the town that has been on fire underground since 1962',
  'The 1904 Olympic marathon and its poisoned, car-riding finishers',
  'Lituya Bay, Alaska 1958 — the wave that stripped a mountainside bare',
  'The Carrington Event of 1859 — telegraphs running on aurora current',
  'The Great Stink of London, 1858',
];

const promptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');

function histogram(findings: StoryFinding[]): Array<{ rule: string; severity: string; count: number }> {
  const counts = new Map<string, { severity: string; count: number }>();
  for (const f of findings) {
    const entry = counts.get(f.rule) ?? { severity: f.severity, count: 0 };
    entry.count += 1;
    counts.set(f.rule, entry);
  }
  return [...counts.entries()]
    .map(([rule, v]) => ({ rule, severity: v.severity, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

describe.skipIf(!RUN)(`story eval via ${PROVIDER}/${MODEL} (RUN_EVAL=1)`, () => {
  const provider = evalProvider();

  it.each(TOPICS.slice(0, N))(
    'writes a story clean of hard rules: %s',
    async (topic) => {
      const result = await generateJsonWithRetry(provider, {
        system: storySystem(promptsDir),
        prompt: buildStoryPrompt(promptsDir, topic),
        schema: LlmStorySchema,
      });
      const { findings, totalWords, totalSeconds } = postProcessStory(result.data, {
        promptExamples: storyPromptExamples(promptsDir, topic),
      });

      console.log(`\n${topic}`);
      console.log(`  model: ${result.model}  cost: $${result.costUsd.toFixed(4)}`);
      console.log(`  ${totalWords} words / ${totalSeconds}s / ${result.data.beats.length} beats`);
      console.log(`  hook: ${result.data.hook}`);
      console.log(`  overlay: ${result.data.overlay_hook ?? '(derived)'}`);
      console.log(`  stamp: ${result.data.evidence_stamp ?? '(missing)'}`);
      console.table(histogram(findings));

      // dump the story so a failure can be READ, not guessed at
      const outDir = path.resolve(promptsDir, '../api/eval-out');
      mkdirSync(outDir, { recursive: true });
      const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      writeFileSync(
        path.join(outDir, `${PROVIDER}-${slug}.json`),
        JSON.stringify({ topic, model: result.model, findings, story: result.data }, null, 2),
      );

      const hard = findings.filter((f) => EVAL_HARD_RULES.has(f.rule));
      expect(hard.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
    },
    900_000,
  );
});
