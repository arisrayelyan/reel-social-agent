import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaProvider, embedText } from '../src/llm/ollama.js';

afterEach(() => vi.unstubAllGlobals());

describe('OllamaProvider', () => {
  it('sends a schema-constrained chat request and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: '{"topic":"lake nyos"}' },
          prompt_eval_count: 42,
          eval_count: 17,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider('http://ollama.test', 'qwen3.6:latest');
    const result = await provider.generateJson({
      system: 'sys',
      prompt: 'user',
      schema: z.object({ topic: z.string() }),
    });

    expect(result.data).toEqual({ topic: 'lake nyos' });
    expect(result.costUsd).toBe(0);
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(17);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://ollama.test/api/chat');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('qwen3.6:latest');
    expect(body.format.type).toBe('object'); // JSON-schema constrained decoding
    expect(body.stream).toBe(false);
  });

  it('throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('model not found', { status: 404 })));
    const provider = new OllamaProvider('http://ollama.test', 'missing');
    await expect(
      provider.generateJson({ system: 's', prompt: 'p', schema: z.object({}) }),
    ).rejects.toThrow('Ollama chat failed (404)');
  });
});

describe('embedText', () => {
  it('returns the first embedding vector', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }))),
    );
    expect(await embedText('http://ollama.test', 'embed-model', 'hello')).toEqual([0.1, 0.2]);
  });
});
