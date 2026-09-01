import { describe, expect, it } from 'vitest';
import { parseCodexJsonl } from '../src/llm/codex.js';

describe('parseCodexJsonl', () => {
  it('parses current item.completed / usage event shapes', () => {
    const stdout = [
      '{"type":"item.started","item":{"type":"agent_message"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"a\\":1}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}',
    ].join('\n');
    const parsed = parseCodexJsonl(stdout);
    expect(parsed.text).toBe('{"a":1}');
    expect(parsed.inputTokens).toBe(100);
    expect(parsed.outputTokens).toBe(50);
  });

  it('parses the older msg-wrapped event shape', () => {
    const stdout = [
      '{"id":"1","msg":{"type":"agent_message","message":"hello"}}',
      '{"id":"2","msg":{"type":"token_count","usage":{"input_tokens":10,"output_tokens":5}}}',
    ].join('\n');
    const parsed = parseCodexJsonl(stdout);
    expect(parsed.text).toBe('hello');
    expect(parsed.inputTokens).toBe(10);
  });

  it('ignores non-JSON lines', () => {
    const stdout = ['warning: something', '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'].join('\n');
    expect(parseCodexJsonl(stdout).text).toBe('ok');
  });

  it('throws when no agent message was produced', () => {
    expect(() => parseCodexJsonl('{"type":"turn.completed"}')).toThrow('no agent message');
  });
});
