import { z } from 'zod';
import type { GenerateJsonOptions, LlmProvider, LlmResult } from './provider.js';
import { parseWithSchema } from './provider.js';

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmResult<T>> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
        // Ollama constrains decoding to this JSON schema
        format: z.toJSONSchema(opts.schema),
        options: { temperature: 0.7 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as OllamaChatResponse;
    const raw = body.message.content;
    return {
      data: parseWithSchema(opts.schema, raw),
      inputTokens: body.prompt_eval_count ?? null,
      outputTokens: body.eval_count ?? null,
      costUsd: 0,
      raw,
      model: this.model,
    };
  }
}

/** Embedding via Ollama /api/embed (qwen3-embedding:0.6b → 1024 dims). */
export async function embedText(
  baseUrl: string,
  model: string,
  input: string,
): Promise<number[]> {
  const res = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input }),
    // dedupe is best-effort and runs before the 202 response — a wedged
    // Ollama must degrade to "skip dedupe", never block the request
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { embeddings: number[][] };
  const embedding = body.embeddings[0];
  if (!embedding) throw new Error('Ollama embed returned no embedding');
  return embedding;
}
