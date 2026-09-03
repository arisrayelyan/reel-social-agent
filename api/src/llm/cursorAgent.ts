import { execa } from 'execa';
import { mkdir } from 'node:fs/promises';
import type { GenerateJsonOptions, LlmProvider, LlmResult } from './provider.js';
import { parseWithSchema } from './provider.js';
import {
  estimateCursorCost,
  promptTokens,
  type CursorPrice,
  type CursorTokenUsage,
} from './cursorPricing.js';

/**
 * One `type: "result"` line on stdout. Verified 2 Sep 2026 against
 * cursor-agent 2026.08.31-4057e58, and against the envelope builder in the
 * CLI's own bundle. `usage` is camelCase — the CLI's other surfaces
 * (hooks, stream-json) use snake_case, so both spellings are read.
 */
interface CursorCliEnvelope {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  request_id?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
}

/**
 * Runs the Cursor CLI in single-shot print mode. Uses the user's existing
 * Cursor subscription and, unlike the other two CLI providers, exposes ~220
 * models from every vendor Cursor resells — so the model is chosen per request
 * rather than fixed by env.
 *
 * The CLI reports token counts but no dollar cost, so cost is estimated from
 * the family price table in cursorPricing.ts.
 */
export class CursorAgentProvider implements LlmProvider {
  readonly name = 'cursor-agent' as const;

  constructor(
    private readonly cliPath: string,
    private readonly model: string,
    private readonly prices: Record<string, CursorPrice>,
    /** Empty scratch dir to run in — see generateJson. */
    private readonly workDir: string,
  ) {}

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmResult<T>> {
    // `--system-prompt <file>` exists but is gated to "Anysphere/OpenAI team
    // only", so system and user are concatenated as they are for claude/codex.
    const prompt = `${opts.system}\n\n${opts.prompt}`;
    await mkdir(this.workDir, { recursive: true });
    const { stdout } = await execa(
      this.cliPath,
      [
        '-p', prompt,
        '--output-format', 'json',
        // read-only Q&A: no edits, no shell, no tool loop. We want prose back,
        // not an agent session.
        '--mode', 'ask',
        // headless: never block waiting for the workspace-trust prompt
        '--trust',
        ...(this.model ? ['--model', this.model] : []),
      ],
      {
        // An EMPTY dir on purpose. Run from the repo, cursor-agent indexes the
        // codebase and folds AGENTS.md / .cursor/rules into the context — the
        // story prompt must be the only thing the model sees.
        cwd: this.workDir,
        timeout: 900_000,
        // stdin MUST be closed. Verified: with an open stdin pipe the CLI
        // prints the result envelope and then keeps running forever waiting
        // for EOF — the same trap as `codex exec`.
        stdin: 'ignore',
      },
    );

    const { text, usage } = parseCursorEnvelope(stdout);
    return {
      data: parseWithSchema(opts.schema, text),
      // fresh input + both cache buckets: on a warm session `inputTokens`
      // alone is a couple of tokens, and recording that as the prompt size
      // makes the per-video cost table meaningless
      inputTokens: promptTokens(usage),
      outputTokens: usage.outputTokens,
      costUsd: estimateCursorCost(this.model, usage, this.prices),
      raw: text,
      model: this.model || 'cursor-agent',
    };
  }
}

/**
 * Exported for tests. Takes the LAST line that parses as a `type: "result"`
 * envelope rather than JSON.parse-ing the whole of stdout, so an auto-update
 * notice or any other banner printed first does not break the run.
 *
 * There is no failure envelope to parse: on error the CLI writes to stderr and
 * exits non-zero, which surfaces as an execa throw before this is ever called.
 */
export function parseCursorEnvelope(stdout: string): {
  text: string;
  usage: CursorTokenUsage;
} {
  let envelope: CursorCliEnvelope | null = null;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let parsed: CursorCliEnvelope;
    try {
      parsed = JSON.parse(trimmed) as CursorCliEnvelope;
    } catch {
      continue;
    }
    if (parsed.type === 'result') envelope = parsed;
  }

  if (!envelope) throw new Error('cursor-agent produced no result envelope');
  if (envelope.is_error === true || (envelope.subtype && envelope.subtype !== 'success')) {
    throw new Error(`cursor-agent returned ${envelope.subtype ?? 'an error'}`);
  }
  const text = envelope.result ?? '';
  if (!text) throw new Error('cursor-agent returned an empty result');

  const u = envelope.usage;
  return {
    text,
    usage: {
      inputTokens: u?.inputTokens ?? u?.input_tokens ?? null,
      outputTokens: u?.outputTokens ?? u?.output_tokens ?? null,
      cacheReadTokens: u?.cacheReadTokens ?? u?.cache_read_tokens ?? null,
      cacheWriteTokens: u?.cacheWriteTokens ?? u?.cache_write_tokens ?? null,
    },
  };
}
