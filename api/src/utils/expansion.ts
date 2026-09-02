/**
 * Reads fal's `expanded_prompt` — the rewrite the endpoint actually generated
 * from — for signs that our motion was flattened into a still. Observed on
 * every published reel under prompt_expansion_mode=balanced: beats that asked
 * for a push-in or a spreading tide came back "Static Shot ... small amplitude
 * at slow speed ... emphasizing the absolute tranquility".
 *
 * Diagnostic only: the clip is already paid for. The flags land in
 * generation_runs.output and in the activity log so the render review knows
 * which beats to re-roll.
 */
const FLATTENING_PHRASES: ReadonlyArray<{ flag: string; re: RegExp }> = [
  { flag: 'static_shot', re: /\bstatic shot\b/i },
  { flag: 'locked_off', re: /\b(tripod-locked|locked[- ]off|remains (?:completely |perfectly )?still|no camera movement)\b/i },
  { flag: 'small_amplitude', re: /\bsmall amplitude\b/i },
  { flag: 'tranquil', re: /\b(tranquil(?:ity)?|serene|peaceful|calm(?:ness)?)\b/i },
  { flag: 'subtle_only', re: /\bthe only (?:movement|motion) is\b/i },
];

export function expansionFlags(expandedPrompt: string | null | undefined, cameraLocked: boolean): string[] {
  if (!expandedPrompt) return [];
  const flags = FLATTENING_PHRASES.filter(({ re }) => re.test(expandedPrompt)).map(({ flag }) => flag);
  // a locked beat is SUPPOSED to be static — only the mood flags matter there
  return cameraLocked ? flags.filter((f) => f === 'tranquil') : flags;
}
