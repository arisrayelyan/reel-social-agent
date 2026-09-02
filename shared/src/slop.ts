/**
 * The AI-slop lexicon.
 *
 * The prompt used to hand the model finished sentences and the model copied
 * them — "A lake killed a valley. Silently." became "A river swallowed a town.
 * Quietly." on every topic. These lists are the mechanical half of the fix:
 * the prompt teaches form, the validator catches the tells.
 *
 * Sources: the Codex gpt-5.6-luna prompt review (2 Sep 2026) and the
 * humanizer / "Signs of AI writing" tells.
 */

/**
 * Narration killers. Matched case-insensitively with word-boundary guards.
 * Validator-side in full — only SLOP_PHRASES_PROMPT_SAMPLE reaches the prompt.
 */
export const SLOP_PHRASES: readonly string[] = [
  // portentous filler
  'little did they know',
  'what happened next',
  'and that is when things got strange',
  "and that's when things got strange",
  'things got strange',
  'the story gets even stranger',
  'the answer is stranger than you think',
  'this would become the key clue',
  'that is when things took a dark turn',
  'this changed everything',
  'changed everything forever',
  'nobody could have predicted',
  'no one could have predicted',
  'the truth was far stranger',
  'in a twist of fate',
  // false-closure cliches
  'the rest is history',
  'one thing is certain',
  'stands as a testament',
  'serves as a reminder',
  'to this day',
  'still remembered today',
  'would never be the same',
  // vague-attribution hedges standing in for evidence
  'somehow',
  'mysteriously',
  'inexplicably',
  'unbelievably',
  'experts believe',
  'some say',
  'it is said that',
  // abstract filler standing in for a concrete noun
  'the situation',
  'the phenomenon',
  'the forces at play',
  'the mystery deepened',
  'the reality was',
] as const;

/**
 * The six worst, injected into the prompt via {{banned_phrases}}.
 *
 * Deliberately NOT the whole list: a long "never write X" block can prime the
 * model toward the listed phrasing, and the prompt already carries up to 16k
 * chars of scraped source material. The split is provisional — the RUN_EVAL
 * histogram is the instrument that settles it.
 */
export const SLOP_PHRASES_PROMPT_SAMPLE: readonly string[] = [
  'little did they know',
  'what happened next',
  'this changed everything',
  'the rest is history',
  'to this day',
  'somehow',
] as const;

/** The format is audio-only — narration that describes the picture wastes the modality. */
export const PICTURE_DESCRIBING_PHRASES: readonly string[] = [
  'we see',
  'you can see',
  'as you can see',
  'pictured here',
  'shown here',
  'this image shows',
  'in this photo',
  'in this image',
  'look at',
] as const;

/**
 * Banned in image_prompt and motion_prompt only.
 *
 * NOT applied to style_prefix: "cinematic" closes both the root prefix and the
 * per-story skeleton in docs/visual-style.md — it is channel identity, not a
 * prompting smell. "haunting" and "striking" are excluded entirely; both are
 * legitimate writer directions in prompts/story.user.md.
 */
export const PRESTIGE_ADJECTIVES: readonly string[] = [
  'stunning', 'breathtaking', 'masterpiece', 'epic', 'iconic', 'legendary',
  'award-winning', 'award winning', 'gorgeous', 'beautiful', 'majestic',
  'mesmerizing', 'immersive', 'ethereal', 'surreal', 'vibrant',
  'hyper-realistic', 'hyperrealistic', 'photorealistic', 'ultra-detailed',
  'ultra detailed', 'highly detailed', 'intricate detail', 'best quality',
  'high quality', 'masterful', '4k', '8k',
] as const;

/** Vague modifiers, for the adjective-stack heuristic (warning-only, tier 2). */
export const SOFT_ADJECTIVES: readonly string[] = [
  'vast', 'eerie', 'silent', 'abandoned', 'windswept', 'desolate', 'bleak',
  'ominous', 'sinister', 'unsettling', 'haunting', 'mysterious', 'strange',
  'incredible', 'unbelievable', 'remarkable', 'extraordinary', 'astonishing',
  'shocking', 'terrifying', 'horrifying', 'devastating', 'catastrophic',
  'massive', 'enormous', 'immense', 'colossal', 'tiny', 'minuscule',
  'ancient', 'timeless', 'endless', 'infinite', 'profound', 'stark',
  'brutal', 'savage', 'relentless', 'unforgiving', 'treacherous',
  'pristine', 'immaculate', 'perfect', 'flawless', 'chilling', 'grim',
  'lonely', 'forgotten', 'forsaken', 'quiet',
] as const;

/** Sentence-length bands for the variance check (word counts, inclusive). */
export const SENTENCE_BANDS = {
  short: { min: 3, max: 7 },
  medium: { min: 8, max: 16 },
  long: { min: 17, max: 24 },
} as const;

/** A sentence longer than this is hard to read aloud in one breath. */
export const MAX_SENTENCE_WORDS = 28;

/** Below this stdev of sentence word counts the prose reads as a metronome. */
export const MIN_SENTENCE_STDEV = 3.0;
