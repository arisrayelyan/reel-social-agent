import type { z } from 'zod';

export interface LlmResult<T> {
  data: T;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  raw: string;
  model: string;
}

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface LlmProvider {
  readonly name: 'ollama' | 'claude-code' | 'codex';
  generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmResult<T>>;
}

/**
 * Pulls a JSON object out of LLM text: strips markdown fences and anything
 * before the first `{` / after the last `}`.
 */
export function extractJson(text: string): string {
  const withoutFences = text.replace(/```(?:json)?/g, '');
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in LLM output: ${text.slice(0, 200)}`);
  }
  return withoutFences.slice(start, end + 1);
}

/** Parses + validates, with the raw payload preserved in the error message. */
export function parseWithSchema<T>(schema: z.ZodType<T>, text: string): T {
  const json = JSON.parse(extractJson(text)) as unknown;
  return schema.parse(json);
}
