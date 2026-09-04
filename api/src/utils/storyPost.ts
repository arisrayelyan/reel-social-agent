import {
  BEAT_GAP_SECONDS,
  END_TAIL_SECONDS,
  EVIDENCE_STAMP_MAX_CHARS,
  EXHIBIT_TAG_MAX_CHARS,
  IMAGE_PROMPT_SUFFIX,
  MOTION_NEGATIVES,
  OVERLAY_HOOK_MAX_CHARS,
  OVERLAY_HOOK_MAX_WORDS,
  RULE_EXHIBIT_TAG_SHORTENED,
  RULE_MUSIC_DERIVED,
  RULE_STAMP_SHORTENED,
  WORDS_PER_MINUTE,
  sortFindings,
  type LlmStory,
  type Music,
  type Story,
  type StoryFinding,
} from '@reel-agent/shared';
import { validateStory } from './storyValidate.js';

/**
 * Server-side story post-processing — never trust the LLM's arithmetic:
 * recompute word counts and durations (145 wpm rule), enforce the target
 * envelope, and keep prompts free of style/negative boilerplate (injected
 * verbatim at generation time instead, so it is byte-identical per video).
 *
 * The quality gate runs here too, but it never blocks: findings are
 * diagnostic and the story always reaches story_review.
 */
export interface StoryValidation {
  story: Story;
  totalWords: number;
  totalSeconds: number;
  /** Structured gate output — persisted on the video and rendered at review. */
  findings: StoryFinding[];
  /** Legacy view of the same data: findings.map(f => f.detail). */
  warnings: string[];
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function durationForWords(wordCount: number): number {
  return Number(((wordCount / WORDS_PER_MINUTE) * 60).toFixed(2));
}

/**
 * On-screen hook: at most 8 words, no terminal punctuation (uppercase happens
 * in CSS). Used as the fallback when the model omits `overlay_hook` — a weaker
 * result than a purpose-written line, so postProcessStory warns about it.
 */
export function deriveOverlayHook(hook: string): string {
  const capped = hook
    .trim()
    .replace(/[.!?…]+$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, OVERLAY_HOOK_MAX_WORDS)
    .join(' ');
  return shortenToChars(capped, OVERLAY_HOOK_MAX_CHARS);
}

/**
 * Keyword fallback for the post-time music suggestion, used only when the
 * model omitted or mangled `music`. Coarse on purpose — it exists so an old
 * story row or a sloppy output still gets a usable suggestion, and the
 * `music.derived` warning tells the producer it was not the model's pick.
 * First matching family wins; order is specificity.
 */
const MUSIC_FALLBACKS: Array<{ re: RegExp; music: Music }> = [
  {
    re: /\b(haunt|ghost|vanish|disappear|unexplained|curse|mystery|myster|possess|séance|seance|unsolved)/i,
    music: { genre: 'horror', search_terms: ['eerie drone', 'horror ambience no drums', 'slow dread build'] },
  },
  {
    re: /\b(heist|fraud|robber|steal|stole|forger|smuggl|con man|swindl|counterfeit|spy|espionage|assassin|murder)/i,
    music: { genre: 'suspense thriller', search_terms: ['tense pulse', 'thriller underscore', 'ticking suspense'] },
  },
  {
    re: /\b(rescue|surviv|escape|against the odds|saved|miracle|record|first ever|won|victory)/i,
    music: { genre: 'cinematic orchestral', search_terms: ['cinematic build', 'orchestral swell', 'hopeful strings'] },
  },
  {
    re: /\b(dead|died|death|kill|toxic|poison|disaster|eruption|erupt|collapse|flood|drown|plague|famine|crash|explode|explosion|wiped out|buried)/i,
    music: { genre: 'dark ambient', search_terms: ['dark ambient drone', 'low tension pad', 'somber atmosphere'] },
  },
];
const DEFAULT_MUSIC: Music = {
  genre: 'tension',
  search_terms: ['slow tension build', 'documentary underscore', 'suspense pad'],
};

export function deriveMusic(story: Pick<LlmStory, 'topic' | 'hook' | 'beats'>): Music {
  const text = [story.topic, story.hook, ...story.beats.map((b) => b.narration)].join(' ');
  return MUSIC_FALLBACKS.find((f) => f.re.test(text))?.music ?? DEFAULT_MUSIC;
}

/** Cuts on a word boundary so an on-screen cap never slices mid-word. */
export function shortenToChars(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars + 1);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, maxChars)).replace(/[,;:—–-]+$/, '').trim();
}

export function postProcessStory(
  raw: LlmStory,
  opts: { promptExamples?: string[] } = {},
): StoryValidation {
  const findings: StoryFinding[] = [];

  const beats = raw.beats.map((beat, i) => {
    const word_count = countWords(beat.narration);
    let exhibit_tag = beat.exhibit_tag;
    if (exhibit_tag && exhibit_tag.length > EXHIBIT_TAG_MAX_CHARS) {
      const shortened = shortenToChars(exhibit_tag, EXHIBIT_TAG_MAX_CHARS);
      findings.push({
        rule: RULE_EXHIBIT_TAG_SHORTENED,
        severity: 'warning',
        field: 'story',
        beat_index: i,
        detail: `exhibit_tag was ${exhibit_tag.length} chars — shortened to fit the ${EXHIBIT_TAG_MAX_CHARS}-char overlay tag`,
        evidence: exhibit_tag,
      });
      exhibit_tag = shortened;
    }
    return {
      ...beat,
      index: i,
      word_count,
      duration_seconds: durationForWords(word_count),
      exhibit_tag,
    };
  });

  const totalWords = beats.reduce((sum, b) => sum + b.word_count, 0);
  // END_TAIL_SECONDS is part of the finished reel (beatTargetSeconds adds it to
  // the last beat), so the envelope check has to include it or it measures
  // something 1.2s shorter than what actually renders.
  const totalSeconds = Number(
    (
      beats.reduce((sum, b) => sum + b.duration_seconds, 0) +
      BEAT_GAP_SECONDS * (beats.length - 1) +
      END_TAIL_SECONDS
    ).toFixed(2),
  );

  // No locked-camera fix-up. Until 4 Sep 2026 this forced two beats static
  // when the model wrote fewer, appending MOTION_LOCKED_CAMERA — the loudest
  // sentence in a prompt h3-max then expands, which is how "Absolutely no
  // camera movement, tripod locked" came back as "a perfectly static shot
  // throughout". Stillness is now only ever the model's own choice, and
  // story.camera_locked_excess warns on any of it.

  const overlay_hook = deriveOverlayHook(raw.overlay_hook ?? raw.hook);
  if (!raw.overlay_hook) {
    findings.push({
      rule: 'overlay.derived',
      severity: 'warning',
      field: 'overlay_hook',
      beat_index: null,
      detail:
        'No overlay_hook from the model — derived from the spoken hook. That is weaker: on-screen text and voice should hit different angles.',
      evidence: overlay_hook,
    });
  } else if (countWords(raw.overlay_hook) > OVERLAY_HOOK_MAX_WORDS) {
    findings.push({
      rule: 'overlay.truncated',
      severity: 'warning',
      field: 'overlay_hook',
      beat_index: null,
      detail: `overlay_hook was ${countWords(raw.overlay_hook)} words — truncated to ${OVERLAY_HOOK_MAX_WORDS} for the centre-frame render`,
      evidence: raw.overlay_hook,
    });
  }

  let evidence_stamp = raw.evidence_stamp?.trim() || undefined;
  if (evidence_stamp && evidence_stamp.length > EVIDENCE_STAMP_MAX_CHARS) {
    const shortened = shortenToChars(evidence_stamp, EVIDENCE_STAMP_MAX_CHARS);
    findings.push({
      rule: RULE_STAMP_SHORTENED,
      severity: 'warning',
      field: 'evidence_stamp',
      beat_index: null,
      detail: `evidence_stamp was ${evidence_stamp.length} chars — shortened to fit the ${EVIDENCE_STAMP_MAX_CHARS}-char on-screen stamp`,
      evidence: evidence_stamp,
    });
    evidence_stamp = shortened;
  }

  // `music` is a post-time suggestion, never a render input, so a missing or
  // mangled value (LlmMusicSchema collapses any failure to undefined) costs a
  // keyword fallback and a warning — never a paid retry.
  let music = raw.music;
  if (!music) {
    music = deriveMusic(raw);
    findings.push({
      rule: RULE_MUSIC_DERIVED,
      severity: 'warning',
      field: 'music',
      beat_index: null,
      detail: `No usable music suggestion from the model — picked "${music.genre}" from story keywords. Weaker than a pick made for the story's register.`,
      evidence: music.genre,
    });
  }

  const story: Story = { ...raw, overlay_hook, evidence_stamp, music, beats };
  findings.push(
    ...validateStory(story, {
      promptExamples: opts.promptExamples,
      totals: { words: totalWords, seconds: totalSeconds },
    }),
  );

  const sorted = sortFindings(findings);
  return {
    story,
    totalWords,
    totalSeconds,
    findings: sorted,
    warnings: sorted.map((f) => f.detail),
  };
}

/** Full image prompt: byte-identical style prefix + beat subject + anti-grid suffix. */
export function buildImagePrompt(stylePrefix: string, beatPrompt: string): string {
  return `${stylePrefix.trim()} ${beatPrompt.trim()}. ${IMAGE_PROMPT_SUFFIX}.`;
}

/**
 * Full motion prompt: motion only + fixed negatives (+ tripod line when locked).
 *
 * `inlineNegatives: false` leaves MOTION_NEGATIVES out, for endpoints that
 * declare a real `negative_prompt` field — there they go in their own field as
 * MOTION_NEGATIVES_KEYWORDS instead of spending the prompt's word budget.
 *
 * No tripod line any more: MOTION_LOCKED_CAMERA is gone, because on a model
 * that expands prompts it dominated the rewrite and turned the clip static.
 */
export function buildMotionPrompt(
  motionPrompt: string,
  opts: { inlineNegatives?: boolean } = {},
): string {
  const parts = [motionPrompt.trim().replace(/\.?$/, '.')];
  if (opts.inlineNegatives ?? true) parts.push(MOTION_NEGATIVES);
  return parts.join(' ');
}
