import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from '../src/utils/hash.js';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([2, 1, { b: 0, a: 0 }])).toBe('[2,1,{"a":0,"b":0}]');
  });
});

describe('contentHash', () => {
  it('is stable across key ordering', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it('differs for different content', () => {
    expect(contentHash({ prompt: 'a' })).not.toBe(contentHash({ prompt: 'b' }));
  });

  it('produces a sha256 hex digest', () => {
    expect(contentHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
