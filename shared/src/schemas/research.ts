import { z } from 'zod';
import { DISLIKE_REASONS, RESEARCH_SCORE_AXES } from '../constants.js';
import { ProviderSchema } from './video.js';

export const RESEARCH_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export const RESEARCH_COUNTS = [5, 8, 12] as const;

/** One research pass: what was asked, of which model, and what it cost. */
export const ResearchRunSchema = z.object({
  id: z.number().int(),
  status: z.enum(RESEARCH_RUN_STATUSES),
  provider: z.string(),
  model: z.string(),
  brief: z.string().nullable(),
  count: z.number().int(),
  use_sources: z.boolean(),
  /** The rendered user prompt — the audit trail for "what did the model see". */
  prompt: z.string().nullable(),
  error: z.string().nullable(),
  cost_usd: z.coerce.number(),
  created_at: z.coerce.string(),
  finished_at: z.coerce.string().nullable(),
  /** Filled by the list query. */
  candidate_count: z.coerce.number().int().default(0),
  liked_count: z.coerce.number().int().default(0),
  disliked_count: z.coerce.number().int().default(0),
});
export type ResearchRun = z.infer<typeof ResearchRunSchema>;

const axisKeys = RESEARCH_SCORE_AXES.map((a) => a.key);
export const ScoreCardSchema = z.object(
  Object.fromEntries(axisKeys.map((k) => [k, z.number().min(1).max(5)])) as Record<
    (typeof axisKeys)[number],
    z.ZodNumber
  >,
);
export type ScoreCard = z.infer<typeof ScoreCardSchema>;

export const SourceLinkSchema = z.object({
  url: z.string(),
  title: z.string().nullable().optional(),
});

/** A ranked story candidate. `embedding` never leaves the database. */
export const StoryCandidateSchema = z.object({
  id: z.number().int(),
  run_id: z.number().int(),
  topic: z.string(),
  hook: z.string(),
  year: z.number().int().nullable(),
  place: z.string().nullable(),
  summary: z.string(),
  money_shot: z.string(),
  turn: z.string(),
  kicker: z.string(),
  scores: ScoreCardSchema,
  risk: z.string(),
  risk_note: z.string().nullable(),
  total_score: z.number().int(),
  rank: z.number().int(),
  source_url: z.string().nullable(),
  source_title: z.string().nullable(),
  source_status: z.enum(['unchecked', 'reachable', 'unreachable']),
  flags: z.array(z.string()).default([]),
  sources: z.array(SourceLinkSchema).default([]),
  feedback: z.enum(['like', 'dislike']).nullable(),
  /** A DISLIKE_REASONS id — z.string() because the rows outlive the list. */
  feedback_reason: z.string().nullable(),
  feedback_note: z.string().nullable(),
  feedback_at: z.coerce.string().nullable(),
  video_id: z.number().int().nullable(),
  created_at: z.coerce.string(),
});
export type StoryCandidate = z.infer<typeof StoryCandidateSchema>;

export const StartResearchBodySchema = z.object({
  provider: ProviderSchema,
  model: z.string().min(1).max(120).optional(),
  brief: z.string().max(400).optional(),
  count: z.union([z.literal(5), z.literal(8), z.literal(12)]).default(8),
  use_sources: z.boolean().default(false),
});
export type StartResearchBody = z.infer<typeof StartResearchBodySchema>;

export const CandidateFeedbackBodySchema = z.object({
  feedback: z.enum(['like', 'dislike']).nullable(),
  reason: z.enum(DISLIKE_REASONS.map((r) => r.id) as [string, ...string[]]).optional(),
  note: z.string().max(300).optional(),
});
export type CandidateFeedbackBody = z.infer<typeof CandidateFeedbackBodySchema>;

export const ResearchIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * What the research model returns. Tolerant on purpose (see LlmStorySchema):
 * a wrong-typed score becomes 3, an unknown risk word becomes "low", a
 * missing year is null — every failure here would otherwise cost a paid
 * retry on a call whose whole point is breadth.
 */
const LlmScore = z.coerce.number().min(1).max(5).catch(3);
export const LlmResearchCandidateSchema = z.object({
  topic: z.string().min(3),
  hook: z.string().min(3),
  year: z.coerce.number().int().nullable().catch(null),
  place: z.string().nullable().catch(null),
  summary: z.string().min(10),
  money_shot: z.string().min(5),
  turn: z.string().min(5),
  kicker: z.string().min(3),
  source_url: z.string().nullable().catch(null),
  source_title: z.string().nullable().catch(null),
  scores: z
    .object(Object.fromEntries(axisKeys.map((k) => [k, LlmScore])) as Record<(typeof axisKeys)[number], typeof LlmScore>)
    .catch(Object.fromEntries(axisKeys.map((k) => [k, 3])) as Record<(typeof axisKeys)[number], number>),
  risk: z
    .preprocess((v) => (typeof v === 'string' ? v.toLowerCase().trim() : v), z.enum(['none', 'low', 'high']))
    .catch('low'),
  risk_note: z.string().nullable().catch(null),
});
export const LlmResearchSchema = z.object({
  candidates: z.array(LlmResearchCandidateSchema).min(1).max(20),
});
export type LlmResearch = z.infer<typeof LlmResearchSchema>;
export type LlmResearchCandidate = z.infer<typeof LlmResearchCandidateSchema>;
