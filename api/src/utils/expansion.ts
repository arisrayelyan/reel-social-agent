/**
 * Reads fal's `expanded_prompt` — the rewrite an endpoint that expands prompts
 * actually generated from — for signs our motion was flattened into a still.
 *
 * Diagnostic only, and deliberately narrow. An earlier version flagged mood
 * words (tranquil / serene / peaceful / calm) and that reading is what led
 * docs/retention-postmortem-and-change-plan.md §3.1 to name fal as the primary
 * cause of the retention failure. It was wrong: video 9's hook expansion says
 * "a tranquil swamp landscape" about the BACKGROUND of a barge sliding into a
 * churning vortex, and goes on to describe "a continuous, steady truck right
 * ... functioning as a tracking shot" with "foreground deadwood to parallax".
 * fal honoured that prompt precisely and the beat was flagged anyway.
 *
 * Measuring the artifact beats reading its description — see measureMotion.
 * These phrases are kept only for the cases where the rewrite states outright
 * that the camera does not move.
 */
const FLATTENING_PHRASES: ReadonlyArray<{ flag: string; re: RegExp }> = [
  { flag: 'static_shot', re: /\b(static shot|static composition|perfectly static)\b/i },
  {
    flag: 'locked_off',
    re: /\b(tripod-locked|locked[- ]off|remains (?:completely |perfectly )?still|no camera movement|camera holds)\b/i,
  },
  { flag: 'small_amplitude', re: /\bsmall amplitude\b/i },
  { flag: 'subtle_only', re: /\bthe only (?:movement|motion) is\b/i },
];

export function expansionFlags(expandedPrompt: string | null | undefined): string[] {
  if (!expandedPrompt) return [];
  // Checked on EVERY beat now. This used to short-circuit on camera_locked
  // beats — "a locked beat is supposed to be static" — which suppressed the
  // detector on exactly the beats most likely to come back flattened. Nothing
  // asks for a locked frame any more, so a static rewrite is always a defect.
  return FLATTENING_PHRASES.filter(({ re }) => re.test(expandedPrompt)).map(({ flag }) => flag);
}
