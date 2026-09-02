import { z } from 'zod';

/**
 * Structured output of the story quality gate.
 *
 * Findings live in shared/ because three consumers need them: the validator
 * (api/src/utils/storyValidate.ts), the DB round-trip (videos.story_findings)
 * and the review UI (frontend StoryFindings).
 *
 * Findings NEVER block. `severity: 'error'` means "a human should almost
 * certainly fix this before approving", not "reject" — the story always
 * reaches story_review and the producer decides.
 */
export const FINDING_SEVERITIES = ['error', 'warning'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_FIELDS = [
  'story',
  'hook',
  'overlay_hook',
  'evidence_stamp',
  'narration',
  'image_prompt',
  'motion_prompt',
  'tiktok_caption',
  'style_prefix',
] as const;
export type FindingField = (typeof FINDING_FIELDS)[number];

/**
 * Emitted by postProcessStory, not by the rule registry: only the normalizer
 * knows the pre-forcing camera_locked count, because the validator sees the
 * story after the fix-up has already run.
 */
export const RULE_CAMERA_LOCKED_FORCED = 'story.camera_locked_forced';

/**
 * Also normalizer-emitted: render-constraint caps (evidence_stamp 48 chars,
 * exhibit_tag 24) are accepted loose from the LLM and shortened here — a hard
 * schema failure on an on-screen length cap costs a full paid CLI call.
 */
export const RULE_STAMP_SHORTENED = 'stamp.shortened';
export const RULE_EXHIBIT_TAG_SHORTENED = 'exhibit.shortened';

/** Render caps shared by the LLM prompt, the normalizer and the overlay. */
export const EVIDENCE_STAMP_MAX_CHARS = 48;
export const EXHIBIT_TAG_MAX_CHARS = 24;
export const OVERLAY_HOOK_MAX_CHARS = 80;

export const StoryFindingSchema = z.object({
  /**
   * Rule id, e.g. 'hook.word_count'. Deliberately z.string() and NOT z.enum:
   * these rows are persisted, so an enum would make any future rule rename
   * turn historical story_findings unparseable and 500 the video page.
   * Rule ids are typo-proofed at authoring time by the STORY_RULES registry.
   */
  rule: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  field: z.enum(FINDING_FIELDS),
  /** null = story-level. */
  beat_index: z.number().int().min(0).nullable(),
  /** Human sentence, rendered verbatim in the review UI. */
  detail: z.string(),
  /** The offending substring, for highlighting. */
  evidence: z.string().nullable(),
});

export const StoryFindingsSchema = z.array(StoryFindingSchema);

export type StoryFinding = z.infer<typeof StoryFindingSchema>;

export function countFindings(findings: readonly StoryFinding[]): {
  errors: number;
  warnings: number;
} {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  };
}

/** Short line for the SSE event and the review header; undefined when clean. */
export function summarizeFindings(findings: readonly StoryFinding[]): string | undefined {
  const { errors, warnings } = countFindings(findings);
  if (errors === 0 && warnings === 0) return undefined;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** Errors first, then story-level before beat-level, then by beat, then by rule. */
export function sortFindings(findings: readonly StoryFinding[]): StoryFinding[] {
  const bySeverity = (f: StoryFinding) => (f.severity === 'error' ? 0 : 1);
  return [...findings].sort(
    (a, b) =>
      bySeverity(a) - bySeverity(b) ||
      (a.beat_index ?? -1) - (b.beat_index ?? -1) ||
      a.rule.localeCompare(b.rule),
  );
}
