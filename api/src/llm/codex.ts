import { execa } from 'execa';
import type { GenerateJsonOptions, LlmProvider, LlmResult } from './provider.js';
import { parseWithSchema } from './provider.js';

/**
 * Runs the OpenAI Codex CLI in non-interactive exec mode. `--json` emits
 * JSONL events; we take the last agent message and the turn usage totals.
 * Codex does not report dollar cost, so it is estimated from configured rates.
 */
export class CodexProvider implements LlmProvider {
  readonly name = 'codex' as const;

  constructor(
    private readonly cliPath: string,
    private readonly inputCostPerMTok: number,
    private readonly outputCostPerMTok: number,
    private readonly model: string = '',
  ) {}

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmResult<T>> {
    const prompt = `${opts.system}\n\n${opts.prompt}`;
    const { stdout } = await execa(
      this.cliPath,
      [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox', 'read-only',
        ...(this.model ? ['--model', this.model] : []),
        // `-i <FILE>` attaches an image to the initial prompt (codex exec --help)
        ...(opts.images ?? []).flatMap((file) => ['-i', file]),
        prompt,
      ],
      // stdin MUST be closed: codex exec waits for stdin EOF on a piped stdin
      // and hangs forever before ever contacting the API
      { timeout: 900_000, stdin: 'ignore' },
    );

    const { text, inputTokens, outputTokens, model } = parseCodexJsonl(stdout);
    const costUsd =
      ((inputTokens ?? 0) / 1_000_000) * this.inputCostPerMTok +
      ((outputTokens ?? 0) / 1_000_000) * this.outputCostPerMTok;

    return {
      data: parseWithSchema(opts.schema, text),
      inputTokens,
      outputTokens,
      costUsd: Number(costUsd.toFixed(4)),
      raw: text,
      model: model ?? (this.model || 'codex'),
    };
  }
}

/** Exported for tests. Tolerates both current and older codex event shapes. */
export function parseCodexJsonl(stdout: string): {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
} {
  // All agent messages, in order. The story is not always the LAST message —
  // codex sometimes appends a short closing remark after the JSON — so below
  // we prefer the last message that actually contains a JSON object.
  const texts: string[] = [];
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let model: string | null = null;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
      texts.push(item.text);
    }
    // older codex versions wrap events as {"msg": {"type": "agent_message", ...}}
    const msg = event.msg as Record<string, unknown> | undefined;
    if (msg?.type === 'agent_message' && typeof msg.message === 'string') {
      texts.push(msg.message);
    }
    const usage = (event.usage ?? msg?.usage ?? (event.info as Record<string, unknown> | undefined)?.total_token_usage) as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    if (usage) {
      inputTokens = usage.input_tokens ?? inputTokens;
      outputTokens = usage.output_tokens ?? outputTokens;
    }
    if (typeof event.model === 'string') model = event.model;
  }

  const text = texts.findLast((t) => t.includes('{')) ?? texts.at(-1) ?? '';
  if (!text) throw new Error('codex CLI produced no agent message');
  return { text, inputTokens, outputTokens, model };
}
