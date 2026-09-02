import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, LlmValidationError, parseWithSchema } from '../src/llm/provider.js';

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

  it('rejects schema violations with the raw output and issue paths attached', () => {
    let thrown: unknown;
    try {
      parseWithSchema(schema, '{"topic":"x"}');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(LlmValidationError);
    const err = thrown as LlmValidationError;
    expect(err.raw).toBe('{"topic":"x"}');
    expect(err.issues).toEqual(['n: Invalid input: expected number, received undefined']);
    expect(err.message).toContain('n:');
  });

  it('wraps JSON syntax errors with the raw output, no issues', () => {
    let thrown: unknown;
    try {
      parseWithSchema(schema, "{'topic': 'single quotes'}");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(LlmValidationError);
    const err = thrown as LlmValidationError;
    expect(err.raw).toBe("{'topic': 'single quotes'}");
    expect(err.issues).toEqual([]);
    expect(err.message).toContain('not valid JSON');
  });
});
