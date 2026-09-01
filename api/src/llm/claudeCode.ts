import { execa } from 'execa';
import type { GenerateJsonOptions, LlmProvider, LlmResult } from './provider.js';
import { parseWithSchema } from './provider.js';

interface ClaudeCliEnvelope {
  type: string;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

/**
 * Runs the Claude Code CLI in single-shot print mode. Uses the user's
 * existing subscription; the JSON envelope reports real cost and tokens.
 */
export class ClaudeCodeProvider implements LlmProvider {
  readonly name = 'claude-code' as const;

  constructor(private readonly cliPath: string) {}

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmResult<T>> {
    const prompt = `${opts.system}\n\n${opts.prompt}`;
    const { stdout } = await execa(
      this.cliPath,
      ['-p', prompt, '--output-format', 'json'],
      { timeout: 300_000 },
    );
    const envelope = JSON.parse(stdout) as ClaudeCliEnvelope;
    if (envelope.type === 'result' && envelope.subtype && envelope.subtype !== 'success') {
      throw new Error(`claude CLI returned ${envelope.subtype}`);
    }
    const raw = envelope.result ?? '';
    return {
      data: parseWithSchema(opts.schema, raw),
      inputTokens: envelope.usage?.input_tokens ?? null,
      outputTokens: envelope.usage?.output_tokens ?? null,
      costUsd: envelope.total_cost_usd ?? 0,
      raw,
      model: 'claude-code',
    };
  }
}
