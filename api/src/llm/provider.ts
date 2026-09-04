import type { z } from 'zod';
import type { Provider } from '@reel-agent/shared';

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
  /**
   * Absolute paths of images to attach (source-photo analysis). Each CLI has
   * its own way in — codex `-i`, cursor-agent a workspace file, claude the Read
   * tool — and Ollama throws UnsupportedImagesError so the caller can skip.
   */
  images?: string[];
}

/** The provider cannot take image input; callers treat it as "skip", not "retry". */
export class UnsupportedImagesError extends Error {
  constructor(provider: string) {
    super(`${provider} cannot take image input`);
    this.name = 'UnsupportedImagesError';
  }
}

export interface LlmProvider {
  readonly name: Provider;
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

/**
 * Thrown when model output fails JSON parsing or schema validation. Carries
 * the raw model text so the failure can be repaired (fed back to the model)
 * and diagnosed (persisted in the failed generation_runs row) — before this,
 * the only copy of a bad response lived in the CLI's own session files.
 */
export class LlmValidationError extends Error {
  constructor(
    message: string,
    /** The unmodified model output. */
    readonly raw: string,
    /** Zod issues as "path: message" lines; empty for JSON syntax errors. */
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'LlmValidationError';
  }
}

/** Parses + validates; failures throw LlmValidationError with the raw payload. */
export function parseWithSchema<T>(schema: z.ZodType<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LlmValidationError(`LLM output is not valid JSON: ${reason}`, text);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new LlmValidationError(
      `LLM output failed schema validation:\n${issues.join('\n')}`,
      text,
      issues,
    );
  }
  return result.data;
}
