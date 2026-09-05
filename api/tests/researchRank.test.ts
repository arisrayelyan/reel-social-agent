import { describe, expect, it } from 'vitest';
import { RESEARCH_PENALTIES, rankCandidates, rubricScore, totalScore } from '../src/utils/researchRank.js';

const perfect = { visual: 5, hook: 5, turn: 5, verifiable: 5, people: 5, novelty: 5 };
const middling = { visual: 3, hook: 3, turn: 3, verifiable: 3, people: 3, novelty: 3 };

describe('rubricScore', () => {
  it('maps all-5s to 100 and all-3s to 60', () => {
    expect(rubricScore(perfect)).toBe(100);
    expect(rubricScore(middling)).toBe(60);
  });

  it('weights visual three times a one-weight axis', () => {
    const visualDown = rubricScore({ ...perfect, visual: 1 });
    const noveltyDown = rubricScore({ ...perfect, novelty: 1 });
    expect(100 - visualDown).toBeGreaterThan(2 * (100 - noveltyDown));
  });
});

describe('totalScore', () => {
  it('applies flag penalties and clamps at 0', () => {
    expect(totalScore(perfect, ['seen_before'], 'low')).toBe(100 - RESEARCH_PENALTIES.seen_before!);
    expect(totalScore(perfect, ['no_source', 'near_rejected'], 'high')).toBe(
      100 - RESEARCH_PENALTIES.no_source! - RESEARCH_PENALTIES.near_rejected! - RESEARCH_PENALTIES.high_risk!,
    );
    expect(totalScore(middling, ['similar_to_video:14'], 'low')).toBe(0);
  });

  it('ignores unknown flags', () => {
    expect(totalScore(perfect, ['something_new'], 'none')).toBe(100);
  });
});

describe('rankCandidates', () => {
  it('orders by total, keeps model order on ties, numbers from 1', () => {
    const ranked = rankCandidates([
      { topic: 'a', totalScore: 70 },
      { topic: 'b', totalScore: 90 },
      { topic: 'c', totalScore: 70 },
    ]);
    expect(ranked.map((c) => [c.topic, c.rank])).toEqual([['b', 1], ['a', 2], ['c', 3]]);
  });
});
