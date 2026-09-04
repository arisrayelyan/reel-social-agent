import {
  ATMOSPHERE_CUES,
  BEAT_GAP_SECONDS,
  BEAT_ROLE_ORDER,
  CAMERA_VERBS,
  CAPTURE_MEDIA,
  DOCUMENT_SUBJECT_TERMS,
  GENERIC_MOTION_VERBS,
  GRAPHIC_CONTENT_EXCLUSIONS,
  GRAPHIC_CONTENT_TERMS,
  IMPERFECTION_CUES,
  IMPLAUSIBLE_MOTION,
  INSTITUTIONAL_CAM_ID,
  LIGHT_DIRECTIONS,
  MAX_BEAT_WORDS,
  MAX_HOOK_BEAT_WORDS,
  MAX_HOOK_IMAGE_PROMPT_WORDS,
  MAX_SENTENCE_WORDS,
  MIN_SENTENCE_STDEV,
  PERSON_TERMS,
  PICTURE_DESCRIBING_PHRASES,
  PRESTIGE_ADJECTIVES,
  SHOT_TYPES,
  SLOP_PHRASES,
  SOFT_ADJECTIVES,
  STYLE_NOUNS,
  STYLE_PREFIX_OPENER,
  SUBJECT_MOTION_VERBS,
  TARGET_BEAT_COUNT,
  TARGET_DURATION_SECONDS,
  TARGET_WORD_COUNT,
  captureMediaIn,
  matchPhrases,
  stripPhrases,
  matchVerbKeys,
  shotTypeOf,
  type FindingField,
  type FindingSeverity,
  type Story,
  type StoryFinding,
} from '@reel-agent/shared';

/**
 * The story quality gate: every craft rule from prompts/story.user.md,
 * docs/visual-style.md and docs/fal-video-generation.md, expressed as a
 * deterministic check over a post-processed Story.
 *
 * Sibling of storyPost.ts on purpose. storyPost is the normalizer (recompute,
 * reindex, force) and is imported by the images and clips pipeline steps; this
 * module is pure rules with no pipeline coupling.
 *
 * NOTHING HERE THROWS, and nothing here blocks. `severity: 'error'` means "a
 * human should almost certainly fix this before approving" — the story always
 * reaches story_review and the producer decides.
 *
 * Rules are a registry rather than one long function so the test suite can
 * assert that every registered rule has a case and a documented source.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'in', 'into', 'is',
  'it', 'its', 'not', 'of', 'on', 'one', 'or', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'were', 'what',
  'when', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'all',
  'out', 'up', 'no', 'so', 'if', 'we', 'us', 'i', 'been', 'more', 'than',
]);

export function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Sentence split on terminal punctuation; keeps a trailing fragment. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lowercase, punctuation stripped, whitespace collapsed — for substring matching. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentWords(text: string): string[] {
  return normalizeForMatch(text)
    .split(' ')
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ngrams(words: readonly string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i++) out.push(words.slice(i, i + size).join(' '));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule registry
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleContext {
  story: Story;
  totalWords: number;
  totalSeconds: number;
  /** Cumulative start second of each beat, including BEAT_GAP_SECONDS. */
  beatStarts: number[];
  /** Narration split into sentences, per beat. */
  sentences: string[][];
  /** Backticked example spans lifted from the prompt; [] when unknown. */
  promptExamples: string[];
  /** Reveal-beat narration, for the spoiler checks. '' when absent. */
  revealNarration: string;
}

export type RuleEmit = (
  beatIndex: number | null,
  detail: string,
  evidence?: string | null,
  severity?: FindingSeverity,
) => void;

export interface StoryRule {
  id: string;
  severity: FindingSeverity;
  field: FindingField;
  scope: 'story' | 'beat';
  /** Provenance — asserted non-empty by the test suite. */
  source: string;
  /** 1 = deterministic. 2 = heuristic with a real false-positive rate. */
  tier: 1 | 2;
  check: (ctx: RuleContext, emit: RuleEmit) => void;
}

const PROMPT = 'prompts/story.user.md';
const FAL_DOC = 'docs/fal-video-generation.md';
const STYLE_DOC = 'docs/visual-style.md';
const HOOK_DOC = 'docs/hook-improvement-plan.md';

/**
 * Something in the frame moves: the curated vocabulary OR ordinary physical
 * motion. The curated list alone under-counted real motion on the eval
 * ("runners stagger forward", "condensation drips") and errored good stories.
 */
function hasSubjectMotion(motionPrompt: string): boolean {
  return (
    matchVerbKeys(motionPrompt, SUBJECT_MOTION_VERBS).length > 0 ||
    matchPhrases(motionPrompt, GENERIC_MOTION_VERBS).length > 0
  );
}

/**
 * Anything that reads as the camera rather than the scene.
 *
 * `frame` only in its camera senses: "grips the frame" is a car's frame, and
 * treating the bare word as a camera cue dropped a whole clause of real action.
 */
const CAMERA_CLAUSE =
  /\b(camera|lens|macro glide|rack focus|frame (?:stays|holds|remains)|fixed frame|pans?|tilts?|orbits?|dollys?|cranes?|zooms?|tracking|handheld)\b/i;

/**
 * Clause boundaries. Splitting on punctuation alone is not enough: these
 * prompts routinely join the action to the camera with "while" or "as"
 * ("Both men feed sticks into the fire as the camera tilts up"), so the camera
 * word poisoned the action clause and the beat looked camera-only.
 */
const CLAUSE_SPLIT = /[;,.]|\swhile\s|\sas\s/i;

/**
 * Words left once every camera clause is removed.
 *
 * This replaced a lexicon check, and the reason is worth keeping: gating a
 * mandatory-action rule on SUBJECT_MOTION_VERBS errored 4-7 beats of EVERY
 * story in the Opus 5 corpus, on prompts that plainly described action —
 * "the two men haul him forward" (the alias was `hauls`, not bare `haul`),
 * "the dust wall rolls back over the road" (aliases had `rolls over`, not
 * `rolls back`), "steam creeps out of the crack and spreads over the
 * concrete". CLAUDE.md already recorded this trap once; no alias list covers
 * English motion, and every miss buys a paid retry.
 *
 * So the rule tests the thing it actually cares about: is the camera the ONLY
 * thing moving? A camera-only prompt leaves nothing behind (measured: 0 words),
 * while a real one leaves 6-15.
 */
function nonCameraWordCount(motionPrompt: string): number {
  return motionPrompt
    .split(CLAUSE_SPLIT)
    .filter((clause) => clause.trim().length > 0 && !CAMERA_CLAUSE.test(clause))
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Below this, whatever is left beside the camera cannot be an event. */
const MIN_NON_CAMERA_WORDS = 4;

/** Beats licensed to name a capture medium in their own image_prompt. */
function isInstitutionalCamBeat(imagePrompt: string): boolean {
  const medium = CAPTURE_MEDIA.find((m) => m.id === INSTITUTIONAL_CAM_ID)!;
  return matchPhrases(imagePrompt, medium.keywords).length > 0;
}

export const STORY_RULES: readonly StoryRule[] = [
  // ── envelope ──────────────────────────────────────────────────────────────
  {
    id: 'story.word_count_envelope',
    severity: 'warning', field: 'story', scope: 'story', tier: 1,
    source: 'shared/src/constants.ts TARGET_WORD_COUNT',
    check: (ctx, emit) => {
      if (ctx.totalWords < TARGET_WORD_COUNT.min || ctx.totalWords > TARGET_WORD_COUNT.max) {
        emit(null, `Total word count ${ctx.totalWords} is outside target ${TARGET_WORD_COUNT.min}–${TARGET_WORD_COUNT.max}`);
      }
    },
  },
  {
    id: 'story.duration_envelope',
    severity: 'warning', field: 'story', scope: 'story', tier: 1,
    source: 'shared/src/constants.ts TARGET_DURATION_SECONDS',
    check: (ctx, emit) => {
      if (ctx.totalSeconds < TARGET_DURATION_SECONDS.min || ctx.totalSeconds > TARGET_DURATION_SECONDS.max) {
        emit(null, `Estimated duration ${ctx.totalSeconds}s is outside target ${TARGET_DURATION_SECONDS.min}–${TARGET_DURATION_SECONDS.max}s`);
      }
    },
  },
  {
    id: 'story.camera_locked_excess',
    severity: 'warning', field: 'story', scope: 'story', tier: 1,
    source: `${PROMPT} MOTION (do not ask for a static frame)`,
    check: (ctx, emit) => {
      // the old threshold was "more than 2", which the model read as a quota
      // to fill — and postProcessStory used to force two beats locked when it
      // did not. Stillness is now only right when it IS the evidence.
      const locked = ctx.story.beats.filter((b) => b.camera_locked);
      if (locked.length > 0) {
        emit(
          null,
          `${locked.length} locked-camera beat(s) (${locked.map((b) => b.index).join(', ')}) — a tripod-locked frame is a photograph unless the stillness itself is the documented evidence`,
        );
      }
    },
  },
  {
    id: 'story.beat_count',
    severity: 'warning', field: 'story', scope: 'story', tier: 1,
    source: `${PROMPT} STRUCTURE (7 to 10 beats)`,
    check: (ctx, emit) => {
      const n = ctx.story.beats.length;
      if (n < TARGET_BEAT_COUNT.min || n > TARGET_BEAT_COUNT.max) {
        emit(null, `${n} beats — the structure calls for ${TARGET_BEAT_COUNT.min} to ${TARGET_BEAT_COUNT.max}`);
      }
    },
  },

  // ── structure ─────────────────────────────────────────────────────────────
  {
    id: 'story.role_coverage',
    severity: 'error', field: 'story', scope: 'story', tier: 1,
    source: `${PROMPT} STRUCTURE (roles in order)`,
    check: (ctx, emit) => {
      const present = new Set(ctx.story.beats.map((b) => b.role));
      const missing = BEAT_ROLE_ORDER.filter((role) => !present.has(role));
      if (missing.length > 0) {
        emit(null, `Missing beat role${missing.length === 1 ? '' : 's'}: ${missing.join(', ')} — the retention arc is incomplete`, missing.join(','));
      }
    },
  },
  {
    id: 'story.role_order',
    severity: 'error', field: 'story', scope: 'story', tier: 1,
    source: `${PROMPT} STRUCTURE (exactly one hook and one kicker)`,
    check: (ctx, emit) => {
      const beats = ctx.story.beats;
      const hooks = beats.filter((b) => b.role === 'hook').length;
      const kickers = beats.filter((b) => b.role === 'kicker').length;
      if (hooks !== 1) emit(null, `${hooks} hook beats — there must be exactly one`);
      if (kickers !== 1) emit(null, `${kickers} kicker beats — there must be exactly one`);
      if (hooks === 1 && beats[0]?.role !== 'hook') emit(null, 'The hook is not the first beat');
      if (kickers === 1 && beats[beats.length - 1]?.role !== 'kicker') emit(null, 'The kicker is not the last beat');

      // first occurrence of each role must follow the canonical order
      const firstSeen = new Map<string, number>();
      beats.forEach((b, i) => {
        if (!firstSeen.has(b.role)) firstSeen.set(b.role, i);
      });
      const order = BEAT_ROLE_ORDER.filter((r) => firstSeen.has(r)).map((r) => firstSeen.get(r)!);
      for (let i = 1; i < order.length; i++) {
        if (order[i]! < order[i - 1]!) {
          emit(null, `Beat roles are out of order — first occurrences run ${BEAT_ROLE_ORDER.filter((r) => firstSeen.has(r)).map((r) => `${r}@${firstSeen.get(r)}`).join(' ')}`);
          break;
        }
      }
    },
  },
  {
    id: 'story.turn_timing',
    severity: 'warning', field: 'story', scope: 'story', tier: 1,
    source: `${PROMPT} STRUCTURE (first turn before ~25s)`,
    check: (ctx, emit) => {
      const turnIndex = ctx.story.beats.findIndex((b) => b.role === 'turn');
      if (turnIndex === -1) return; // story.role_coverage already covers this
      const at = ctx.beatStarts[turnIndex] ?? 0;
      if (at > 25) {
        emit(null, `The turn lands at about ${at.toFixed(0)}s, past the ~25s mark. Advisory: this is estimated at 145 wpm, and the real cut is timed from the TTS audio.`);
      }
    },
  },

  // ── the slop gate ─────────────────────────────────────────────────────────
  {
    id: 'story.example_leakage',
    severity: 'error', field: 'narration', scope: 'story', tier: 1,
    source: `${PROMPT} (backticked examples illustrate form only)`,
    check: (ctx, emit) => {
      if (ctx.promptExamples.length === 0) return;
      const haystacks: Array<{ beat: number | null; text: string }> = [
        { beat: null, text: ctx.story.hook },
        ...ctx.story.beats.map((b) => ({ beat: b.index, text: b.narration })),
      ];
      for (const example of ctx.promptExamples) {
        const needle = normalizeForMatch(example);
        if (needle.length < 12) continue;
        for (const { beat, text } of haystacks) {
          if (normalizeForMatch(text).includes(needle)) {
            emit(beat, `Reuses a prompt example verbatim: "${example}". The examples show FORM only — copying them is what makes every video sound the same.`, example);
          }
        }
      }
    },
  },
  {
    id: 'story.motion_verb_reuse',
    severity: 'error', field: 'motion_prompt', scope: 'story', tier: 1,
    source: `${PROMPT} MOTION (each verb at most once) / ${FAL_DOC} §3`,
    check: (ctx, emit) => {
      // The same camera move twice is the drifting-slideshow tell — an error.
      // A repeated subject verb ("rises" on steam and on heat) is a warning:
      // the aliases also match nouns ("floor cracks"), and the eval showed
      // that erroring on it sends a good story into a paid retry.
      const cameraKeys = new Set(CAMERA_VERBS.map((v) => v.key));
      const seen = new Map<string, number[]>();
      for (const beat of ctx.story.beats) {
        const keys = [
          ...matchVerbKeys(beat.motion_prompt, CAMERA_VERBS),
          ...matchVerbKeys(beat.motion_prompt, SUBJECT_MOTION_VERBS),
        ];
        for (const key of new Set(keys)) {
          seen.set(key, [...(seen.get(key) ?? []), beat.index]);
        }
      }
      for (const [key, beats] of seen) {
        if (beats.length <= 1) continue;
        // A repeated CAMERA move is the drifting-slideshow tell: still an
        // error. A repeated SUBJECT verb only reads as repetition when the
        // beats are next to each other — with action now mandatory on every
        // beat, once-per-video across the whole reel forced the exotic
        // synonyms the prompt itself warns against.
        if (cameraKeys.has(key)) {
          emit(null, `Camera move "${key}" is used in beats ${beats.join(', ')} — each camera cue may appear once per video`, key, 'error');
          continue;
        }
        const adjacent = beats.some((b, i) => i > 0 && b - beats[i - 1]! === 1);
        if (adjacent) {
          emit(null, `Motion verb "${key}" repeats in neighbouring beats ${beats.join(', ')} — vary it between consecutive shots`, key, 'warning');
        }
      }
    },
  },
  {
    id: 'story.shot_type_diversity',
    severity: 'error', field: 'image_prompt', scope: 'story', tier: 1,
    source: `${PROMPT} CINEMATOGRAPHY (at least 5 shot types)`,
    check: (ctx, emit) => {
      const ids = new Set(
        ctx.story.beats.map((b) => shotTypeOf(b.image_prompt)?.id).filter((id): id is string => Boolean(id)),
      );
      if (ids.size < 5) {
        emit(null, `Only ${ids.size} distinct shot type${ids.size === 1 ? '' : 's'} across the video (${[...ids].join(', ') || 'none recognised'}) — at least 5 are required`);
      }
    },
  },
  {
    id: 'story.shot_type_adjacent',
    severity: 'error', field: 'image_prompt', scope: 'story', tier: 1,
    source: `${PROMPT} CINEMATOGRAPHY (never the same type back to back)`,
    check: (ctx, emit) => {
      const beats = ctx.story.beats;
      for (let i = 1; i < beats.length; i++) {
        const prev = shotTypeOf(beats[i - 1]!.image_prompt);
        const curr = shotTypeOf(beats[i]!.image_prompt);
        if (prev && curr && prev.id === curr.id) {
          emit(beats[i]!.index, `Same shot type as the previous beat ("${curr.prefix}") — adjacent repeats flatten the cut`, curr.prefix);
        }
      }
    },
  },
  {
    /**
     * Every beat has to move something in the frame. Was a story-level count
     * (">= 5 of 9 beats"), which let a third of the reel be a photograph with
     * a pan over it — and the camera clause was mandatory on all of them, so
     * the grammar produced exactly the montage it was meant to prevent.
     *
     * An error on purpose: errors are fed back verbatim on the single paid
     * retry, so severity is the emphasis dial the model actually reads.
     */
    id: 'motion.no_subject_motion',
    severity: 'error', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: `${PROMPT} MOTION (every beat moves something in the frame)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const left = nonCameraWordCount(beat.motion_prompt);
        if (left < MIN_NON_CAMERA_WORDS) {
          emit(
            beat.index,
            'motion_prompt moves nothing but the camera — name a physical event in the frame. A person hauling, bracing or shielding counts; a camera move does not',
            beat.motion_prompt.slice(0, 60),
          );
          continue;
        }
        // something is described, but nothing recognisable as motion. A hint
        // rather than a retry: the lexicons under-count real English.
        if (!hasSubjectMotion(beat.motion_prompt)) {
          emit(
            beat.index,
            'motion_prompt describes the frame but no recognisable movement — check that something actually happens in it',
            beat.motion_prompt.slice(0, 60),
            'warning',
          );
        }
      }
    },
  },
  {
    id: 'story.repeated_openers',
    severity: 'warning', field: 'narration', scope: 'story', tier: 2,
    source: 'AI-writing tell: identical sentence openers',
    check: (ctx, emit) => {
      const openers = new Map<string, number[]>();
      for (const beat of ctx.story.beats) {
        const opener = normalizeForMatch(beat.narration).split(' ').slice(0, 2).join(' ');
        if (!opener) continue;
        openers.set(opener, [...(openers.get(opener) ?? []), beat.index]);
      }
      for (const [opener, beats] of openers) {
        if (beats.length > 1) {
          emit(null, `Beats ${beats.join(', ')} all open with "${opener}" — vary the entry or the narration reads as a template`, opener);
        }
      }
    },
  },
  {
    id: 'story.sentence_variance',
    severity: 'warning', field: 'narration', scope: 'story', tier: 2,
    source: `${PROMPT} NARRATION (vary sentence length deliberately)`,
    check: (ctx, emit) => {
      const lengths = ctx.sentences.flat().map((s) => wordsOf(s).length);
      if (lengths.length < 6) return;
      const spread = stdev(lengths);
      if (spread < MIN_SENTENCE_STDEV) {
        emit(null, `Every sentence is about the same length (spread ${spread.toFixed(1)} words, want ${MIN_SENTENCE_STDEV}+). Even rhythm is the clearest sign of machine writing.`);
      }
    },
  },
  {
    id: 'story.repeated_bigram',
    severity: 'warning', field: 'narration', scope: 'story', tier: 2,
    source: 'AI-writing tell: recycled phrasing across beats',
    check: (ctx, emit) => {
      const counts = new Map<string, Set<number>>();
      for (const beat of ctx.story.beats) {
        for (const gram of new Set(ngrams(contentWords(beat.narration), 2))) {
          counts.set(gram, (counts.get(gram) ?? new Set()).add(beat.index));
        }
      }
      for (const [gram, beats] of counts) {
        if (beats.size >= 3) {
          emit(null, `"${gram}" appears in ${beats.size} separate beats — the script is circling instead of advancing`, gram);
        }
      }
    },
  },

  // ── hook ──────────────────────────────────────────────────────────────────
  {
    id: 'hook.word_count',
    severity: 'error', field: 'hook', scope: 'story', tier: 1,
    source: `${PROMPT} THE HOOK (maximum 10 words)`,
    check: (ctx, emit) => {
      const n = wordsOf(ctx.story.hook).length;
      if (n > 10) emit(null, `The hook is ${n} words — the maximum is 10. Immediacy beats completeness in second one.`, ctx.story.hook);
    },
  },
  {
    id: 'hook.digits',
    severity: 'error', field: 'hook', scope: 'story', tier: 1,
    source: `${PROMPT} NARRATION (no digits anywhere)`,
    check: (ctx, emit) => {
      if (/\d/.test(ctx.story.hook)) emit(null, 'The hook contains digits — the hook beat is spoken, so numbers must be written as words', ctx.story.hook);
    },
  },
  {
    id: 'hook.date_opener',
    severity: 'error', field: 'hook', scope: 'story', tier: 1,
    source: `${PROMPT} THE HOOK (never open with a date)`,
    check: (ctx, emit) => {
      if (/^(in|on|at|by|during|the year)\b/i.test(ctx.story.hook.trim())) {
        emit(null, 'The hook opens with a date or scene-setting preposition — the anomaly has to arrive first; dates belong in the setup beat', ctx.story.hook);
      }
    },
  },
  {
    id: 'hook.tension_marker',
    severity: 'warning', field: 'hook', scope: 'story', tier: 1,
    source: `${HOOK_DOC} §3 (impossibility front-loading)`,
    check: (ctx, emit) => {
      const firstFour = wordsOf(ctx.story.hook).slice(0, 4).join(' ');
      // TENSION_MARKERS is checked loosely: a marker anywhere in the first four
      // words is enough, and this is advisory — the producer decides.
      const hit = matchPhrases(firstFour, ['no', 'not', 'never', 'nothing', 'nobody', 'without', 'still', 'wrong', 'impossible', 'killed', 'vanished', 'disappeared', 'empty', 'silent', 'refused', 'backwards', 'twice', 'again', 'stopped']);
      if (hit.length === 0) {
        emit(null, `No tension marker in the first four words ("${firstFour}") — check the anomaly really lands before the viewer's thumb does`, firstFour);
      }
    },
  },
  {
    id: 'hook.overclaim',
    severity: 'warning', field: 'hook', scope: 'story', tier: 1,
    source: `${PROMPT} THE HOOK (never "everyone"/"nobody" unless sourced)`,
    check: (ctx, emit) => {
      const hits = matchPhrases(ctx.story.hook, ['everyone', 'nobody', 'no one', 'everybody']);
      if (hits.length > 0) {
        emit(null, `The hook claims universal scope ("${hits.join('", "')}") — only keep it if the source explicitly supports that`, hits[0]!);
      }
    },
  },

  // ── narration ─────────────────────────────────────────────────────────────
  {
    id: 'narration.digits',
    severity: 'error', field: 'narration', scope: 'beat', tier: 1,
    source: `${PROMPT} NARRATION (no digits anywhere)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const match = beat.narration.match(/\d[\d,.]*/);
        if (match) emit(beat.index, `Narration contains digits ("${match[0]}") — write numbers as words or the voice engine mangles them`, match[0]);
      }
    },
  },
  {
    id: 'narration.stage_directions',
    severity: 'error', field: 'narration', scope: 'beat', tier: 1,
    source: `${PROMPT} NARRATION (no bracketed tags)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const match = beat.narration.match(/\[[^\]]{1,30}\]|\((?:sigh|pause|laughs?|breath|sfx|music|beat)\)/i);
        if (match) emit(beat.index, `Narration contains a stage direction ("${match[0]}") — the voice engine reads it aloud`, match[0]);
      }
    },
  },
  {
    id: 'narration.terminal_punctuation',
    severity: 'error', field: 'narration', scope: 'beat', tier: 1,
    source: `${PROMPT} NARRATION (every beat ends with terminal punctuation)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const trimmed = beat.narration.trim();
        if (!/[.!?]$/.test(trimmed)) {
          emit(beat.index, 'Narration does not end on terminal punctuation — the beat will sound cut off', trimmed.slice(-24));
        }
      }
    },
  },
  {
    id: 'narration.slop_phrase',
    severity: 'error', field: 'narration', scope: 'beat', tier: 1,
    source: 'shared/src/slop.ts SLOP_PHRASES',
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        for (const phrase of matchPhrases(beat.narration, SLOP_PHRASES)) {
          emit(beat.index, `Narration uses the filler phrase "${phrase}" — say the fact instead of announcing that a fact is coming`, phrase);
        }
      }
    },
  },
  {
    id: 'narration.picture_describing',
    severity: 'error', field: 'narration', scope: 'beat', tier: 1,
    source: `${PROMPT} NARRATION (never describe what the picture shows)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        for (const phrase of matchPhrases(beat.narration, PICTURE_DESCRIBING_PHRASES)) {
          emit(beat.index, `Narration points at the image ("${phrase}") — the picture already shows it; the voice adds cause, scale or consequence`, phrase);
        }
      }
    },
  },
  {
    id: 'narration.em_dash_density',
    severity: 'warning', field: 'narration', scope: 'beat', tier: 1,
    source: 'AI-writing tell: em-dash overuse',
    check: (ctx, emit) => {
      let total = 0;
      for (const beat of ctx.story.beats) {
        const count = (beat.narration.match(/—/g) ?? []).length;
        total += count;
        if (count > 1) emit(beat.index, `${count} em dashes in one beat — spoken narration wants commas and full stops`);
      }
      if (total > 2) emit(null, `${total} em dashes across the script — a machine-writing tell, and they do not read aloud`);
    },
  },
  {
    id: 'narration.long_sentence',
    severity: 'warning', field: 'narration', scope: 'beat', tier: 1,
    source: `${PROMPT} NARRATION (write for the ear)`,
    check: (ctx, emit) => {
      ctx.sentences.forEach((sentences, i) => {
        for (const sentence of sentences) {
          const n = wordsOf(sentence).length;
          if (n > MAX_SENTENCE_WORDS) {
            emit(ctx.story.beats[i]?.index ?? i, `A ${n}-word sentence — too long to land in one breath`, sentence.slice(0, 60));
          }
        }
      });
    },
  },
  {
    id: 'narration.beat_word_cap',
    severity: 'warning', field: 'narration', scope: 'beat', tier: 1,
    source: 'shared/src/constants.ts MAX_BEAT_WORDS / MAX_HOOK_BEAT_WORDS',
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const n = wordsOf(beat.narration).length;
        const cap = beat.role === 'hook' ? MAX_HOOK_BEAT_WORDS : MAX_BEAT_WORDS;
        if (n > cap) {
          emit(beat.index, `${n} words in one ${beat.role} beat (cap ${cap}) — that is a ${((n / 145) * 60).toFixed(0)}s hold on a single animated still`, beat.narration.slice(0, 60));
        }
      }
    },
  },
  {
    id: 'narration.rule_of_three',
    severity: 'warning', field: 'narration', scope: 'beat', tier: 2,
    source: 'AI-writing tell: rule-of-three lists',
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const match = beat.narration.match(/\b(\w+), (\w+),? (?:and|or) (\w+)\b/);
        if (match && [match[1]!, match[2]!, match[3]!].every((w) => w.length <= 12)) {
          emit(beat.index, `Three-item list ("${match[0]}") — the rule-of-three cadence is an AI tell; pick the one item that carries evidence`, match[0]);
        }
      }
    },
  },
  {
    id: 'narration.adjective_stack',
    severity: 'warning', field: 'narration', scope: 'beat', tier: 2,
    source: 'AI-writing tell: adjective stacking (heuristic — no POS tagger)',
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const words = normalizeForMatch(beat.narration).split(' ');
        for (let i = 1; i < words.length; i++) {
          if (SOFT_ADJECTIVES.includes(words[i - 1]!) && SOFT_ADJECTIVES.includes(words[i]!)) {
            emit(beat.index, `Stacked vague adjectives ("${words[i - 1]} ${words[i]}") — one measured detail beats two moods`, `${words[i - 1]} ${words[i]}`);
            break;
          }
        }
      }
    },
  },

  // ── image prompts ─────────────────────────────────────────────────────────
  {
    id: 'image.shot_type_prefix',
    severity: 'error', field: 'image_prompt', scope: 'beat', tier: 1,
    source: `${PROMPT} CINEMATOGRAPHY (start with one shot type)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        if (!shotTypeOf(beat.image_prompt)) {
          emit(beat.index, `image_prompt does not start with an approved shot type (one of: ${SHOT_TYPES.map((s) => s.prefix).join(', ')})`, beat.image_prompt.slice(0, 48));
        }
      }
    },
  },
  {
    id: 'image.style_words',
    severity: 'error', field: 'image_prompt', scope: 'beat', tier: 1,
    source: `${PROMPT} CINEMATOGRAPHY (no style words) / ${FAL_DOC} §10`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        // visual-style.md §4 licenses ONE institutional-cam beat to name its
        // own capture medium; story.capture_override caps that at one.
        if (isInstitutionalCamBeat(beat.image_prompt)) continue;
        const hits = [
          ...matchPhrases(beat.image_prompt, STYLE_NOUNS),
          ...matchPhrases(beat.image_prompt, PRESTIGE_ADJECTIVES),
        ];
        for (const hit of hits) {
          emit(beat.index, `image_prompt contains the style word "${hit}" — style lives in the byte-identical style_prefix; beats carry subject and composition only`, hit);
        }
      }
    },
  },
  {
    id: 'image.capture_override',
    severity: 'warning', field: 'image_prompt', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §4 (one institutional-cam beat maximum)`,
    check: (ctx, emit) => {
      const beats = ctx.story.beats.filter((b) => isInstitutionalCamBeat(b.image_prompt));
      if (beats.length > 1) {
        emit(null, `${beats.length} beats name the monitoring-camera medium (beats ${beats.map((b) => b.index).join(', ')}) — the style guide licenses exactly one`);
      }
    },
  },
  {
    // Replaces image.people (2 Sep 2026). People are allowed; the dead,
    // the dying and the injured are not — TikTok removes "dead bodies" and
    // "the moment of someone's death" regardless of label, and Gemini refuses.
    id: 'image.graphic_content',
    severity: 'error', field: 'image_prompt', scope: 'beat', tier: 1,
    source: `${STYLE_DOC} §7 (people yes, corpses/injury never)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        // material senses out first: "rust bleeding" is wear, not injury
        const hits = matchPhrases(
          stripPhrases(beat.image_prompt, GRAPHIC_CONTENT_EXCLUSIONS),
          GRAPHIC_CONTENT_TERMS,
        );
        if (hits.length > 0) {
          emit(beat.index, `image_prompt names "${hits[0]}" — shoot the absence for death beats: the empty doorway, the cold fire pit, the boots by the bed`, hits[0]!);
        }
      }
    },
  },
  {
    // The inverse of the rule it replaced: a reel with no human in any frame
    // is a still-life catalogue, and the research report's storyboard asks
    // for a person beat and a human/result image.
    /**
     * Was "warn when ZERO beats have a person", which a reel satisfied with
     * one figure in nine beats. People are the most legible thing a frame can
     * hold, so the bar is most beats.
     */
    id: 'image.human_presence',
    severity: 'warning', field: 'image_prompt', scope: 'story', tier: 2,
    source: `${STYLE_DOC} §7 (a person in almost every beat)`,
    check: (ctx, emit) => {
      const withPeople = ctx.story.beats.filter(
        (b) => matchPhrases(b.image_prompt, PERSON_TERMS).length > 0,
      );
      const wanted = Math.ceil(ctx.story.beats.length / 2);
      if (withPeople.length < wanted) {
        emit(
          null,
          `Only ${withPeople.length} of ${ctx.story.beats.length} beats put a person in frame — a reel of empty places is a catalogue of objects, and people are the most legible thing a frame can hold`,
        );
      }
    },
  },
  {
    /**
     * Faces, specifically. The prompt used to allow people and then give three
     * averted examples ("a back turned to the event", "hands on a rail"), and
     * the model generalised the ban on ADDRESSING the lens into no faces at
     * all. A lit face in profile is not a face turning to camera.
     */
    id: 'image.face_visible',
    severity: 'warning', field: 'image_prompt', scope: 'story', tier: 2,
    source: `${STYLE_DOC} §7 (faces are wanted, lit and visible)`,
    check: (ctx, emit) => {
      const faceTerms = ['face', 'faces', 'cheek', 'profile', 'expression', 'eyes', 'jaw', 'brow'];
      const withFaces = ctx.story.beats.filter(
        (b) => matchPhrases(b.image_prompt, faceTerms).length > 0,
      );
      if (withFaces.length === 0) {
        emit(
          null,
          'No beat puts a lit face in frame — faces in profile or three-quarter, absorbed in the work, are wanted. Only ADDRESSING the lens is banned',
        );
      }
    },
  },
  {
    // A capitalised two-word name that appears in both the narration and an
    // image_prompt is probably a real person being rendered by face.
    id: 'image.named_likeness',
    severity: 'warning', field: 'image_prompt', scope: 'beat', tier: 2,
    source: `${STYLE_DOC} §7 (never the face of a real named individual)`,
    check: (ctx, emit) => {
      const narrationNames = new Set(
        ctx.story.beats.flatMap((b) => [...b.narration.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)].map((m) => m[1]!)),
      );
      if (narrationNames.size === 0) return;
      for (const beat of ctx.story.beats) {
        for (const name of narrationNames) {
          if (beat.image_prompt.includes(name)) {
            emit(beat.index, `image_prompt renders "${name}", a named person from the narration — TikTok bans real likenesses; show their hands, back, instrument or seat instead`, name);
          }
        }
      }
    },
  },
  {
    // A published reel opened on a printout on a desk and never showed the
    // island. The hook frame is the cover image and the swipe decision.
    id: 'image.hook_is_document',
    severity: 'error', field: 'image_prompt', scope: 'beat', tier: 1,
    source: `${PROMPT} CINEMATOGRAPHY (the hook shows the event, never paperwork)`,
    check: (ctx, emit) => {
      const hook = ctx.story.beats.find((b) => b.role === 'hook');
      if (!hook) return;
      const hits = matchPhrases(hook.image_prompt, DOCUMENT_SUBJECT_TERMS);
      if (hits.length > 0) {
        emit(hook.index, `The hook image is paperwork ("${hits[0]}") — the first frame is the cover and the swipe decision; it has to show the event itself at its most extreme moment`, hits[0]!);
      }
    },
  },
  {
    id: 'image.hook_legibility',
    severity: 'warning', field: 'image_prompt', scope: 'beat', tier: 2,
    source: `${STYLE_DOC} §7 + retention postmortem §10.2 (a LEGIBLE anomaly)`,
    check: (ctx, emit) => {
      const hook = ctx.story.beats.find((beat) => beat.role === 'hook');
      if (!hook) return;
      const words = wordsOf(hook.image_prompt).length;
      if (words > MAX_HOOK_IMAGE_PROMPT_WORDS) {
        emit(
          hook.index,
          `Hook image prompt is ${words} words against a ${MAX_HOOK_IMAGE_PROMPT_WORDS}-word cap — a compliant hook needs about 38, so the extra length is extra SUBJECTS. The first frame has a third of a second to be read: one subject, one thing wrong with it`,
          hook.image_prompt.slice(0, 120),
        );
      }
    },
  },
  {
    id: 'image.document_beats',
    severity: 'warning', field: 'image_prompt', scope: 'story', tier: 2,
    source: `${PROMPT} CINEMATOGRAPHY (at most one document beat per video)`,
    check: (ctx, emit) => {
      const docs = ctx.story.beats.filter((b) => matchPhrases(b.image_prompt, DOCUMENT_SUBJECT_TERMS).length > 0);
      if (docs.length > 1) {
        emit(null, `${docs.length} beats show paper, maps, screens or desks (beats ${docs.map((b) => b.index).join(', ')}) — one is licensed; the rest should show the event`);
      }
    },
  },
  {
    id: 'image.booru_syntax',
    severity: 'error', field: 'image_prompt', scope: 'beat', tier: 1,
    source: `${FAL_DOC} §10 (no booru tags, weights or director names)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const match =
          beat.image_prompt.match(/\([^)]*:\s*\d/) ??
          beat.image_prompt.match(/\({2,}/) ??
          beat.image_prompt.match(/\b(?:by|in the style of)\s+[A-Z][a-z]+/);
        if (match) {
          emit(beat.index, `image_prompt uses prompt-hacking syntax ("${match[0]}") — plain declarative English only`, match[0]);
        }
      }
    },
  },
  {
    id: 'image.imperfection',
    severity: 'warning', field: 'image_prompt', scope: 'beat', tier: 2,
    source: `${FAL_DOC} §4 / ${STYLE_DOC} §1 (real surface wear or a physical atmosphere fact)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        if (
          matchPhrases(beat.image_prompt, IMPERFECTION_CUES).length === 0 &&
          matchPhrases(beat.image_prompt, ATMOSPHERE_CUES).length === 0
        ) {
          emit(beat.index, 'No concrete wear detail and no atmosphere fact (rain, ash, spray, smoke, backlight) — clean, airless surfaces read as renders, not as a record of the event');
        }
      }
    },
  },
  {
    id: 'image.light_direction',
    severity: 'warning', field: 'image_prompt', scope: 'beat', tier: 2,
    source: `${STYLE_DOC} §1 (one motivated light source with a direction)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        if (matchPhrases(beat.image_prompt, LIGHT_DIRECTIONS).length === 0) {
          emit(beat.index, 'No light direction named — one motivated source with a stated direction is what sells the frame as a photograph');
        }
      }
    },
  },
  {
    id: 'image.duplicate_subject',
    severity: 'warning', field: 'image_prompt', scope: 'story', tier: 2,
    source: 'AI-slideshow tell: two beats showing the same thing',
    check: (ctx, emit) => {
      const beats = ctx.story.beats;
      for (let i = 0; i < beats.length; i++) {
        for (let j = i + 1; j < beats.length; j++) {
          const a = new Set(contentWords(beats[i]!.image_prompt));
          const b = new Set(contentWords(beats[j]!.image_prompt));
          if (a.size === 0 || b.size === 0) continue;
          const shared = [...a].filter((w) => b.has(w)).length;
          const jaccard = shared / (a.size + b.size - shared);
          if (jaccard >= 0.8) {
            emit(beats[j]!.index, `Nearly the same subject as beat ${beats[i]!.index} (${(jaccard * 100).toFixed(0)}% shared) — two beats showing one thing is a wasted shot`);
          }
        }
      }
    },
  },

  // ── motion prompts ────────────────────────────────────────────────────────
  {
    id: 'motion.word_count',
    severity: 'warning', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: `${FAL_DOC} §3 (under 30 words)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const n = wordsOf(beat.motion_prompt).length;
        if (n > 40) emit(beat.index, `motion_prompt is ${n} words — past 40 the model drops instructions outright`, undefined, 'error');
        else if (n > 30) emit(beat.index, `motion_prompt is ${n} words — quality degrades past 30`);
      }
    },
  },
  {
    id: 'motion.frame_redescription',
    severity: 'error', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: 'CLAUDE.md motion-only rule / pipeline-learnings §5',
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const styleHits = matchPhrases(beat.motion_prompt, STYLE_NOUNS);
        const shot = shotTypeOf(beat.motion_prompt);
        if (shot) {
          emit(beat.index, `motion_prompt re-describes the frame ("${shot.prefix}") — the keyframe already carries composition; describe motion only`, shot.prefix);
        }
        for (const hit of styleHits) {
          emit(beat.index, `motion_prompt re-describes the look ("${hit}") — re-describing the still fights the reference frame`, hit);
        }
      }
    },
  },
  {
    id: 'motion.locked_has_camera_move',
    severity: 'error', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: 'shared/src/constants.ts MOTION_LOCKED_CAMERA',
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        if (!beat.camera_locked) continue;
        const moves = matchVerbKeys(beat.motion_prompt, CAMERA_VERBS);
        if (moves.length > 0) {
          emit(beat.index, `Locked beat asks for a camera move ("${moves.join('", "')}") — the tripod line is appended server-side and will contradict it`, moves[0]!);
        }
      }
    },
  },
  {
    // The hook has the strongest motion in the video, by rule: it is the
    // cover frame's first two seconds. A locked hook, or one whose motion is
    // camera-only, is exactly the "AI slideshow" first impression.
    id: 'motion.hook_locked',
    severity: 'error', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: `${PROMPT} MOTION (the hook beat has the strongest motion, never locked)`,
    check: (ctx, emit) => {
      const hook = ctx.story.beats.find((b) => b.role === 'hook');
      if (!hook) return;
      // the action requirement is now motion.no_subject_motion, on every beat
      if (hook.camera_locked) {
        emit(hook.index, 'The hook beat is camera_locked — the opening two seconds must move', 'camera_locked');
      }
    },
  },
  {
    id: 'motion.multiple_camera_cues',
    severity: 'warning', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: `${FAL_DOC} §3 (one camera cue maximum)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        const moves = matchVerbKeys(beat.motion_prompt, CAMERA_VERBS);
        if (moves.length > 1) {
          emit(beat.index, `${moves.length} camera cues in one shot ("${moves.join('", "')}") — the model drops or mushes the extras`, moves.join(', '));
        }
      }
    },
  },
  {
    id: 'motion.implausible',
    severity: 'warning', field: 'motion_prompt', scope: 'beat', tier: 1,
    source: `${FAL_DOC} §3 (physically plausible motion only)`,
    check: (ctx, emit) => {
      for (const beat of ctx.story.beats) {
        for (const hit of matchPhrases(beat.motion_prompt, IMPLAUSIBLE_MOTION)) {
          emit(beat.index, `motion_prompt asks for "${hit}" — every model family degrades on this; one plausible motion event per beat`, hit);
        }
      }
    },
  },

  // ── caption ───────────────────────────────────────────────────────────────
  {
    id: 'caption.first_line_length',
    severity: 'warning', field: 'tiktok_caption', scope: 'story', tier: 1,
    source: `${HOOK_DOC} §3 Phase 4 (first line under 100 chars, pre-fold)`,
    check: (ctx, emit) => {
      const firstLine = ctx.story.tiktok_caption.split('\n')[0]!.split('#')[0]!.trim();
      if (firstLine.length > 100) {
        emit(null, `Caption first line is ${firstLine.length} characters — past the ~100-char fold nobody reads it`, firstLine.slice(0, 60));
      }
    },
  },
  {
    id: 'caption.hashtags',
    severity: 'warning', field: 'tiktok_caption', scope: 'story', tier: 1,
    source: `${PROMPT} output block (3-5 hashtags)`,
    check: (ctx, emit) => {
      const count = (ctx.story.tiktok_caption.match(/#[\w]+/g) ?? []).length;
      if (count < 3 || count > 5) emit(null, `${count} hashtags — the brief is 3 to 5`);
    },
  },
  {
    id: 'caption.spoiler',
    severity: 'warning', field: 'tiktok_caption', scope: 'story', tier: 2,
    source: `${PROMPT} output block (does NOT spoil the reveal)`,
    check: (ctx, emit) => {
      if (!ctx.revealNarration) return;
      const firstLine = ctx.story.tiktok_caption.split('\n')[0]!.split('#')[0]!;
      const revealWords = new Set(contentWords(ctx.revealNarration).filter((w) => w.length >= 7));
      const shared = contentWords(firstLine).filter((w) => revealWords.has(w));
      if (shared.length > 0) {
        emit(null, `Caption first line shares "${shared.join('", "')}" with the reveal beat — it may be giving away the answer before the video starts`, shared[0]!);
      }
    },
  },

  // ── style prefix (Evidence File) ──────────────────────────────────────────
  {
    id: 'style.negatives',
    severity: 'error', field: 'style_prefix', scope: 'story', tier: 1,
    source: `${PROMPT} STYLE (negatives are added automatically)`,
    check: (ctx, emit) => {
      const match = ctx.story.style_prefix.match(/\b(no|not|without|avoid)\s+\w/i);
      if (match) {
        emit(null, `style_prefix contains a negative term ("${match[0].trim()}") — the fixed negative block is appended server-side`, match[0].trim());
      }
    },
  },
  {
    id: 'style.vertical_clause',
    severity: 'warning', field: 'style_prefix', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §3 (include vertical 9:16 composition)`,
    check: (ctx, emit) => {
      if (!/vertical\s+9:16/i.test(ctx.story.style_prefix)) {
        emit(null, 'style_prefix does not state "vertical 9:16 composition" — Gemini defaults to 16:9 and the subject gets cropped away');
      }
    },
  },
  {
    id: 'style.skeleton',
    severity: 'warning', field: 'style_prefix', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §3 (the Evidence File skeleton)`,
    check: (ctx, emit) => {
      if (!ctx.story.style_prefix.trim().toLowerCase().startsWith(STYLE_PREFIX_OPENER)) {
        emit(null, `style_prefix does not open "${STYLE_PREFIX_OPENER}" — the images step will fall back to the channel root prefix`, ctx.story.style_prefix.slice(0, 48));
      }
    },
  },
  {
    id: 'style.capture_medium',
    severity: 'warning', field: 'style_prefix', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §6 (exactly one capture medium)`,
    check: (ctx, emit) => {
      const media = captureMediaIn(ctx.story.style_prefix);
      if (media.length === 0) {
        emit(null, 'style_prefix names no capture medium from the era table — without one the frames have no era and the channel loses its identity');
      } else if (media.length > 1) {
        emit(null, `style_prefix mixes ${media.length} capture media (${media.map((m) => m.id).join(', ')}) — mixing eras or media is what produces the AI look`, media.map((m) => m.id).join(', '));
      }
    },
  },
  {
    id: 'image.monochrome',
    severity: 'error', field: 'style_prefix', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §1 (colour, always)`,
    check: (ctx, emit) => {
      const re = /\b(black[- ]and[- ]white|b&w|monochrom\w*|grey ?scale|gray ?scale|sepia|desaturat\w*|colou?rless)\b/i;
      const prefixHit = ctx.story.style_prefix.match(re);
      if (prefixHit) {
        emit(null, `style_prefix asks for a monochrome look ("${prefixHit[0]}") — every frame is in full colour; use the era's colour process from the table`, prefixHit[0]);
      }
      for (const beat of ctx.story.beats) {
        const hit = beat.image_prompt.match(re);
        if (hit) emit(beat.index, `image_prompt asks for a monochrome look ("${hit[0]}") — colourless frames read as a photo montage`, hit[0]);
      }
    },
  },
  {
    id: 'style.era_truth',
    severity: 'warning', field: 'style_prefix', scope: 'story', tier: 2,
    source: `${STYLE_DOC} §6 (the medium follows the era of the event)`,
    check: (ctx, emit) => {
      // The story's era is only knowable from the stamp. No stamp, no check —
      // this rule never guesses, because inventing a date is the one thing the
      // channel must not do.
      const year = Number(ctx.story.evidence_stamp?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1] ?? 0);
      if (!year) return;
      const media = captureMediaIn(ctx.story.style_prefix);
      if (media.length !== 1) return; // style.capture_medium owns that case
      const medium = media[0]!;
      const withinWindow = year >= medium.from && (medium.to === null || year <= medium.to);
      if (!withinWindow) {
        emit(null, `The event is dated ${year} but the capture medium is "${medium.id}" (${medium.era}) — the medium follows the era of the event, not the mood`, medium.id);
      }
    },
  },

  // ── overlay hook and Evidence File stamp ──────────────────────────────────
  {
    id: 'overlay.word_count',
    severity: 'error', field: 'overlay_hook', scope: 'story', tier: 1,
    source: `${HOOK_DOC} §3 Phase 1 (overlay maximum 8 words)`,
    check: (ctx, emit) => {
      if (!ctx.story.overlay_hook) return;
      const n = wordsOf(ctx.story.overlay_hook).length;
      if (n > 8) emit(null, `overlay_hook is ${n} words — the on-screen maximum is 8, centre frame at 88px`, ctx.story.overlay_hook);
    },
  },
  {
    id: 'overlay.digits',
    severity: 'error', field: 'overlay_hook', scope: 'story', tier: 1,
    source: `${HOOK_DOC} §3 Phase 1`,
    check: (ctx, emit) => {
      if (ctx.story.overlay_hook && /\d/.test(ctx.story.overlay_hook)) {
        emit(null, 'overlay_hook contains digits — keep it consistent with the spoken hook and write numbers as words', ctx.story.overlay_hook);
      }
    },
  },
  {
    id: 'overlay.verbatim_prefix',
    severity: 'warning', field: 'overlay_hook', scope: 'story', tier: 1,
    source: `${HOOK_DOC} §3 Phase 2 (a wasted modality)`,
    check: (ctx, emit) => {
      const overlay = ctx.story.overlay_hook;
      const firstBeat = ctx.story.beats[0];
      if (!overlay || !firstBeat) return;
      const needle = normalizeForMatch(overlay);
      if (needle.length >= 8 && normalizeForMatch(firstBeat.narration).startsWith(needle)) {
        emit(null, 'overlay_hook restates the opening narration verbatim — text and voice hitting different angles is the point', overlay);
      }
    },
  },
  {
    id: 'overlay.spoiler',
    severity: 'warning', field: 'overlay_hook', scope: 'story', tier: 1,
    source: `${HOOK_DOC} §3 Phase 1 (must not spoil the reveal)`,
    check: (ctx, emit) => {
      if (!ctx.story.overlay_hook || !ctx.revealNarration) return;
      const revealGrams = new Set(ngrams(contentWords(ctx.revealNarration), 2));
      const shared = ngrams(contentWords(ctx.story.overlay_hook), 2).filter((g) => revealGrams.has(g));
      if (shared.length > 0) {
        emit(null, `overlay_hook shares "${shared[0]}" with the reveal beat — the on-screen hook opens the loop, it does not close it`, shared[0]!);
      }
    },
  },
  {
    id: 'stamp.format',
    severity: 'warning', field: 'evidence_stamp', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §1 (PLACE, COUNTRY — MONTH YEAR)`,
    check: (ctx, emit) => {
      const stamp = ctx.story.evidence_stamp;
      if (!stamp) {
        emit(null, 'No evidence_stamp — the upper-third location/date stamp is the channel constant, and it is never derived because inventing a date is the one thing we must not do');
        return;
      }
      if (stamp.length > 48) {
        emit(null, `evidence_stamp is ${stamp.length} characters — it must fit one mono line across 1080px`, stamp);
      }
      if (!/\b(1[0-9]{3}|20[0-9]{2})\b/.test(stamp)) {
        emit(null, 'evidence_stamp names no year — the stamp is what dates the record', stamp);
      }
      if (stamp !== stamp.toUpperCase()) {
        emit(null, 'evidence_stamp is not uppercase — it is typed on a case file, not written in prose', stamp);
      }
    },
  },
  {
    id: 'stamp.digits_allowed',
    severity: 'warning', field: 'evidence_stamp', scope: 'story', tier: 1,
    source: `${STYLE_DOC} §1 (the stamp is read, never spoken)`,
    check: (ctx, emit) => {
      const stamp = ctx.story.evidence_stamp;
      if (!stamp) return; // stamp.format owns the absent case
      const spelledYear = stamp.match(/\b(nineteen|twenty|eighteen)\s+\w+/i);
      if (spelledYear && !/\d/.test(stamp)) {
        emit(null, `evidence_stamp spells the year out ("${spelledYear[0]}") — this one is read on screen, not spoken, so keep it numeric`, spelledYear[0]);
      }
    },
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Entry points
// ─────────────────────────────────────────────────────────────────────────────

export function buildRuleContext(
  story: Story,
  opts: { promptExamples?: string[] } = {},
): RuleContext {
  let offset = 0;
  const beatStarts = story.beats.map((beat) => {
    const start = offset;
    offset += beat.duration_seconds + BEAT_GAP_SECONDS;
    return Number(start.toFixed(2));
  });
  const totalWords = story.beats.reduce((sum, b) => sum + b.word_count, 0);
  const totalSeconds = Number(Math.max(offset - BEAT_GAP_SECONDS, 0).toFixed(2));
  return {
    story,
    totalWords,
    totalSeconds,
    beatStarts,
    sentences: story.beats.map((b) => sentencesOf(b.narration)),
    promptExamples: opts.promptExamples ?? [],
    revealNarration: story.beats.filter((b) => b.role === 'reveal').map((b) => b.narration).join(' '),
  };
}

/**
 * Runs every registered rule. A rule that throws is swallowed into a warning
 * rather than taking the story down with it — the gate is diagnostic, and a
 * bug in a heuristic must never stop a story reaching review.
 */
export function validateStory(
  story: Story,
  opts: { promptExamples?: string[]; totals?: { words: number; seconds: number } } = {},
): StoryFinding[] {
  const ctx = buildRuleContext(story, opts);
  if (opts.totals) {
    ctx.totalWords = opts.totals.words;
    ctx.totalSeconds = opts.totals.seconds;
  }
  const findings: StoryFinding[] = [];
  for (const rule of STORY_RULES) {
    const emit: RuleEmit = (beatIndex, detail, evidence = null, severity) => {
      findings.push({
        rule: rule.id,
        severity: severity ?? rule.severity,
        field: rule.field,
        beat_index: beatIndex,
        detail,
        evidence: evidence ?? null,
      });
    };
    try {
      rule.check(ctx, emit);
    } catch (err) {
      findings.push({
        rule: rule.id,
        severity: 'warning',
        field: rule.field,
        beat_index: null,
        detail: `Rule ${rule.id} could not run: ${err instanceof Error ? err.message : String(err)}`,
        evidence: null,
      });
    }
  }
  return findings;
}
