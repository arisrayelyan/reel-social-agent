import {
  BEAT_GAP_SECONDS,
  IMAGE_PROMPT_SUFFIX,
  MOTION_LOCKED_CAMERA,
  MOTION_NEGATIVES,
  TARGET_DURATION_SECONDS,
  TARGET_WORD_COUNT,
  WORDS_PER_MINUTE,
  type Story,
} from '@reel-agent/shared';

/**
 * Server-side story post-processing — never trust the LLM's arithmetic:
 * recompute word counts and durations (145 wpm rule), enforce the target
 * envelope, and keep prompts free of style/negative boilerplate (injected
 * verbatim at generation time instead, so it is byte-identical per video).
 */
export interface StoryValidation {
  story: Story;
  totalWords: number;
  totalSeconds: number;
  warnings: string[];
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function durationForWords(wordCount: number): number {
  return Number(((wordCount / WORDS_PER_MINUTE) * 60).toFixed(2));
}

export function postProcessStory(raw: Story): StoryValidation {
  const warnings: string[] = [];

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
  const totalSeconds = Number(
    (
      beats.reduce((sum, b) => sum + b.duration_seconds, 0) +
      BEAT_GAP_SECONDS * (beats.length - 1)
    ).toFixed(2),
  );

  if (totalWords < TARGET_WORD_COUNT.min || totalWords > TARGET_WORD_COUNT.max) {
    warnings.push(
      `Total word count ${totalWords} is outside target ${TARGET_WORD_COUNT.min}–${TARGET_WORD_COUNT.max}`,
    );
  }
  if (
    totalSeconds < TARGET_DURATION_SECONDS.min ||
    totalSeconds > TARGET_DURATION_SECONDS.max
  ) {
    warnings.push(
      `Estimated duration ${totalSeconds}s is outside target ${TARGET_DURATION_SECONDS.min}–${TARGET_DURATION_SECONDS.max}s`,
    );
  }

  const lockedCount = beats.filter((b) => b.camera_locked).length;
  if (lockedCount < 2) {
    // Force the last two non-hook beats static rather than reject the story.
    for (let i = beats.length - 1; i >= 0 && beats.filter((b) => b.camera_locked).length < 2; i--) {
      const beat = beats[i]!;
      if (beat.role !== 'hook') beat.camera_locked = true;
    }
    warnings.push('Fewer than 2 locked-camera beats — forced static holds on late beats');
  }

  if (/\d/.test(beats.map((b) => b.narration).join(' '))) {
    warnings.push(
      'Narration contains digits — numbers should be written out as words for TTS',
    );
  }

  return { story: { ...raw, beats }, totalWords, totalSeconds, warnings };
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
