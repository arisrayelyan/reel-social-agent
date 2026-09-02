import {
  BEAT_GAP_SECONDS,
  END_TAIL_SECONDS,
  IMAGE_PROMPT_SUFFIX,
  MOTION_LOCKED_CAMERA,
  MOTION_NEGATIVES,
  OVERLAY_HOOK_MAX_WORDS,
  RULE_CAMERA_LOCKED_FORCED,
  WORDS_PER_MINUTE,
  sortFindings,
  type LlmStory,
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
  return hook
    .trim()
    .replace(/[.!?…]+$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, OVERLAY_HOOK_MAX_WORDS)
    .join(' ');
}

export function postProcessStory(
  raw: LlmStory,
  opts: { promptExamples?: string[] } = {},
): StoryValidation {
  const findings: StoryFinding[] = [];

  const beats = raw.beats.map((beat, i) => {
    const word_count = countWords(beat.narration);
    return {
      ...beat,
      index: i,
      word_count,
      duration_seconds: durationForWords(word_count),
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

  // The locked-camera fix-up must happen HERE, not in a rule: only the
  // normalizer knows the pre-forcing count, because the validator sees the
  // story after the mutation has already run.
  if (beats.filter((b) => b.camera_locked).length < 2) {
    // Force the last two non-hook beats static rather than reject the story.
    for (let i = beats.length - 1; i >= 0 && beats.filter((b) => b.camera_locked).length < 2; i--) {
      const beat = beats[i]!;
      if (beat.role !== 'hook') beat.camera_locked = true;
    }
    findings.push({
      rule: RULE_CAMERA_LOCKED_FORCED,
      severity: 'warning',
      field: 'story',
      beat_index: null,
      detail: 'Fewer than 2 locked-camera beats — forced static holds on late beats',
      evidence: null,
    });
  }

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

  const story: Story = { ...raw, overlay_hook, beats };
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

/** Full motion prompt: motion only + fixed negatives (+ tripod line when locked). */
export function buildMotionPrompt(motionPrompt: string, cameraLocked: boolean): string {
  const parts = [motionPrompt.trim().replace(/\.?$/, '.'), MOTION_NEGATIVES];
  if (cameraLocked) parts.push(MOTION_LOCKED_CAMERA);
  return parts.join(' ');
}
