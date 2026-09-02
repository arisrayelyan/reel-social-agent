import { describe, expect, it } from 'vitest';
import { softenPrompt } from '../src/clients/nanoBanana.js';

describe('softenPrompt (the empty-response retry)', () => {
  it('strips graphic-content terms and states the constraint', () => {
    const out = softenPrompt('wide shot of a flooded street, a corpse by the wall, blood on the cobbles, light from the left.');
    expect(out).not.toMatch(/corpse|blood/i);
    expect(out).toMatch(/No injuries shown/);
    expect(out).not.toMatch(/\s,/);
  });

  it('leaves a clean prompt alone apart from the suffix', () => {
    const prompt = 'wide shot of a brown wave down a cobbled street, sun from the south.';
    expect(softenPrompt(prompt)).toBe(`${prompt} No injuries shown, no one harmed in frame.`);
  });
});
