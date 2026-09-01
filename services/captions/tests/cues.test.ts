import { describe, expect, it } from 'vitest';
import { groupWords, type CaptionCue } from '../src/cues';

function cue(words: Array<[string, number, number]>): CaptionCue {
  return {
    text: words.map(([w]) => w).join(' '),
    start: words[0]![1],
    end: words[words.length - 1]![2],
    words: words.map(([word, start, end]) => ({ word, start, end })),
  };
}

describe('groupWords', () => {
  it('splits into groups of at most 4 words', () => {
    const groups = groupWords([
      cue([
        ['one', 0, 0.2], ['two', 0.2, 0.4], ['three', 0.4, 0.6],
        ['four', 0.6, 0.8], ['five', 0.8, 1.0], ['six', 1.0, 1.2],
      ]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.words.map((w) => w.word)).toEqual(['one', 'two', 'three', 'four']);
    expect(groups[1]!.words.map((w) => w.word)).toEqual(['five', 'six']);
  });

  it('breaks on pauses longer than 0.6s', () => {
    const groups = groupWords([
      cue([
        ['before', 0, 0.3],
        ['after', 1.2, 1.5], // 0.9s gap
      ]),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('never merges words across beat boundaries', () => {
    const groups = groupWords([
      cue([['beat', 0, 0.3], ['one', 0.3, 0.5]]),
      cue([['beat', 0.95, 1.2], ['two', 1.2, 1.4]]),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('group start/end come from its first and last word', () => {
    const groups = groupWords([cue([['a', 0.5, 0.7], ['b', 0.7, 1.1]])]);
    expect(groups[0]!.start).toBe(0.5);
    expect(groups[0]!.end).toBe(1.1);
  });

  it('handles empty input', () => {
    expect(groupWords([])).toEqual([]);
  });
});
