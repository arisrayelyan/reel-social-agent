import { RESEARCH_SCORE_AXES, type ScoreCard } from '@reel-agent/shared';

/**
 * Deterministic ranking of research candidates. The model self-scores each
 * rubric axis 1-5; everything that turns that into an order lives here so it
 * can be tuned and unit-tested without another paid call.
 */
export const RESEARCH_PENALTIES: Record<string, number> = {
  /** Near-duplicate of a video already made — effectively removed. */
  similar_to_video: 100,
  /** Close to something the producer already rejected. */
  near_rejected: 25,
  /** Proposed in an earlier run and not liked then. */
  seen_before: 10,
  /** The model's source link did not answer. */
  source_unreachable: 10,
  /** No source at all — the channel promise is truth. */
  no_source: 15,
  /** Model-flagged policy risk (bodies, named face, live crisis). */
  high_risk: 20,
};

/** Weighted mean of the axes, on a 0-100 scale. */
export function rubricScore(scores: ScoreCard): number {
  let weighted = 0;
  let weights = 0;
  for (const axis of RESEARCH_SCORE_AXES) {
    weighted += axis.weight * Number(scores[axis.key] ?? 3);
    weights += axis.weight;
  }
  return Math.round((weighted / weights) * 20);
}

export function totalScore(scores: ScoreCard, flags: string[], risk: string): number {
  let total = rubricScore(scores);
  for (const flag of flags) {
    const key = flag.startsWith('similar_to_video') ? 'similar_to_video' : flag;
    total -= RESEARCH_PENALTIES[key] ?? 0;
  }
  if (risk === 'high') total -= RESEARCH_PENALTIES.high_risk!;
  return Math.max(0, Math.min(100, total));
}

/** Highest total first, ties keep model order; ranks 1..n. */
export function rankCandidates<T extends { totalScore: number }>(list: T[]): Array<T & { rank: number }> {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.totalScore - a.c.totalScore || a.i - b.i)
    .map(({ c }, idx) => ({ ...c, rank: idx + 1 }));
}
