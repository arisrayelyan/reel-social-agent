import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, parseWithSchema } from '../src/llm/provider.js';

describe('extractJson', () => {
  it('strips markdown fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('drops prose around the object', () => {
    expect(extractJson('Sure! Here it is: {"a":1} Hope that helps.')).toBe('{"a":1}');
  });

  it('throws when no object is present', () => {
    expect(() => extractJson('no json here')).toThrow('No JSON object');
  });
});

describe('parseWithSchema', () => {
  const schema = z.object({ topic: z.string(), n: z.number() });

  it('parses and validates', () => {
    expect(parseWithSchema(schema, '{"topic":"x","n":1}')).toEqual({ topic: 'x', n: 1 });
  });

  it('rejects schema violations', () => {
    expect(() => parseWithSchema(schema, '{"topic":"x"}')).toThrow();
  });
});
