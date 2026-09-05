import { describe, expect, it } from 'vitest';
import { buildCodexArgs, parseCodexJsonl } from '../src/llm/codex.js';

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

  it('keeps the JSON payload when codex appends a trailing summary message', () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"a\\":1}"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Done! Let me know if you need edits."}}',
    ].join('\n');
    expect(parseCodexJsonl(stdout).text).toBe('{"a":1}');
  });

  it('falls back to the last message when none contains JSON', () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"second"}}',
    ].join('\n');
    expect(parseCodexJsonl(stdout).text).toBe('second');
  });
});

describe('buildCodexArgs', () => {
  it('sends a bare model with -m only, leaving effort to the CLI default', () => {
    const args = buildCodexArgs('gpt-5.4-mini', [], 'p');
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-5.4-mini']));
    expect(args).not.toContain('-c');
    expect(args.at(-1)).toBe('p');
  });

  it('splits <model>@<effort> into -m and a model_reasoning_effort override', () => {
    const args = buildCodexArgs('gpt-6-astra@high', [], 'p');
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="high"']));
    expect(args).not.toContain('gpt-6-astra@high');
  });

  it('keeps an unknown @suffix as part of the model name', () => {
    const args = buildCodexArgs('gpt-7@preview', [], 'p');
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-7@preview']));
    expect(args).not.toContain('-c');
  });

  it('sends no -m at all when no model is configured', () => {
    expect(buildCodexArgs('', [], 'p')).not.toContain('--model');
  });

  it('places every image -i before the prompt', () => {
    const args = buildCodexArgs('gpt-5.5@medium', ['/a.jpg', '/b.png'], 'prompt');
    expect(args).toEqual(expect.arrayContaining(['-i', '/a.jpg', '-i', '/b.png']));
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('prompt'));
  });
});
