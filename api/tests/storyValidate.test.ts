import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Story } from '@reel-agent/shared';
import { goodStoryFixture, sloppyStoryFixture } from './helpers.js';
import { storyPromptExamples } from '../src/llm/prompts.js';
import { postProcessStory } from '../src/utils/storyPost.js';
import {
  STORY_RULES,
  sentencesOf,
  stdev,
  validateStory,
  wordsOf,
} from '../src/utils/storyValidate.js';

const promptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');
const examples = () => storyPromptExamples(promptsDir, 'Lake Nyos');

/** One minimal mutation per registered rule. */
interface RuleCase {
  rule: string;
  mutate: (s: Story) => void;
}

/** Replaces every beat's field with a builder, keeping the array length. */
function eachBeat(story: Story, fn: (beat: Story['beats'][number], i: number) => void): void {
  story.beats.forEach(fn);
}

const CASES: RuleCase[] = [
  // ── envelope ──
  { rule: 'story.word_count_envelope', mutate: (s) => eachBeat(s, (b) => { b.narration = 'Short beat here.'; b.word_count = 3; }) },
  { rule: 'story.duration_envelope', mutate: (s) => eachBeat(s, (b) => { b.duration_seconds = 0.5; }) },
  { rule: 'story.camera_locked_excess', mutate: (s) => eachBeat(s, (b) => { b.camera_locked = true; }) },
  { rule: 'story.beat_count', mutate: (s) => { s.beats = s.beats.slice(0, 6); } },

  // ── structure ──
  { rule: 'story.role_coverage', mutate: (s) => { s.beats = s.beats.filter((b) => b.role !== 'turn'); } },
  { rule: 'story.role_order', mutate: (s) => { s.beats[0]!.role = 'reveal'; } },
  { rule: 'story.turn_timing', mutate: (s) => eachBeat(s, (b) => { b.duration_seconds = 12; }) },
  {
    rule: 'story.example_leakage',
    mutate: (s) => { s.beats[1]!.narration = `${examples()[0]} Nothing else changed here.`; },
  },
  { rule: 'story.motion_verb_reuse', mutate: (s) => { s.beats[3]!.motion_prompt = 'the camera pushes in on the wet paint'; } },
  {
    rule: 'story.shot_type_diversity',
    mutate: (s) => eachBeat(s, (b, i) => { b.image_prompt = `wide shot of subject number ${i} with rusted plating, light from the left`; }),
  },
  {
    rule: 'story.shot_type_adjacent',
    mutate: (s) => { s.beats[1]!.image_prompt = s.beats[0]!.image_prompt.replace(/^extreme close-up of/, 'extreme close-up of'); },
  },
  { rule: 'story.subject_motion_count', mutate: (s) => eachBeat(s, (b) => { b.motion_prompt = 'the camera holds steady on the frame'; }) },
  { rule: 'story.repeated_openers', mutate: (s) => { s.beats[2]!.narration = `Molasses killed the street that morning.`; } },
  {
    rule: 'story.sentence_variance',
    mutate: (s) => eachBeat(s, (b) => { b.narration = 'The tank stood beside the quiet harbour wall today.'; }),
  },
  {
    rule: 'story.repeated_bigram',
    mutate: (s) => { for (const i of [1, 3, 5]) s.beats[i]!.narration = 'The riveted tank leaned above the frozen quay.'; },
  },

  // ── hook ──
  { rule: 'hook.word_count', mutate: (s) => { s.hook = 'Molasses killed twenty one people in a single freezing January afternoon downtown.'; } },
  { rule: 'hook.digits', mutate: (s) => { s.hook = 'Molasses killed 21 people.'; } },
  { rule: 'hook.date_opener', mutate: (s) => { s.hook = 'In January the molasses killed twenty one people.'; } },
  { rule: 'hook.tension_marker', mutate: (s) => { s.hook = 'A harbour tank leaked warm syrup slowly.'; } },
  { rule: 'hook.overclaim', mutate: (s) => { s.hook = 'Everyone missed the killed tank seam.'; } },

  // ── narration ──
  { rule: 'narration.digits', mutate: (s) => { s.beats[2]!.narration = 'The tank held 2500000 gallons of molasses.'; } },
  { rule: 'narration.stage_directions', mutate: (s) => { s.beats[2]!.narration = 'The tank groaned all winter. [pause] Then it stopped.'; } },
  { rule: 'narration.terminal_punctuation', mutate: (s) => { s.beats[2]!.narration = 'The tank groaned all winter and then'; } },
  { rule: 'narration.slop_phrase', mutate: (s) => { s.beats[2]!.narration = 'The tank groaned, and little did they know what was coming.'; } },
  { rule: 'narration.picture_describing', mutate: (s) => { s.beats[2]!.narration = 'We see the tank leaking here at the harbour wall.'; } },
  { rule: 'narration.em_dash_density', mutate: (s) => { s.beats[2]!.narration = 'The tank groaned — badly — and the seams wept — for years.'; } },
  {
    rule: 'narration.long_sentence',
    mutate: (s) => { s.beats[2]!.narration = 'The tank groaned all through that winter while the neighbours complained again and again to a company that had already decided the cheapest possible answer was simply to paint the whole thing brown.'; },
  },
  { rule: 'narration.rule_of_three', mutate: (s) => { s.beats[2]!.narration = 'The seams wept mud, salt, and rust for years.'; } },
  {
    rule: 'narration.beat_word_cap',
    mutate: (s) => { s.beats[2]!.narration = 'The tank groaned all through that winter while the neighbours complained to a company that had already decided on cheap brown paint instead.'; },
  },
  { rule: 'narration.adjective_stack', mutate: (s) => { s.beats[2]!.narration = 'The vast eerie harbour front stood waiting for it.'; } },

  // ── image prompts ──
  { rule: 'image.shot_type_prefix', mutate: (s) => { s.beats[2]!.image_prompt = 'a rusted seam weeping dark residue, light from above'; } },
  { rule: 'image.style_words', mutate: (s) => { s.beats[2]!.image_prompt = 'detail shot of a rusted seam, muted 35mm film stock, light from above'; } },
  {
    rule: 'image.capture_override',
    mutate: (s) => { for (const i of [2, 4]) s.beats[i]!.image_prompt = `detail shot of a fixed CCTV monitoring-camera still of a rusted seam number ${i}, light from above`; },
  },
  { rule: 'image.graphic_content', mutate: (s) => { s.beats[2]!.image_prompt = 'detail shot of a rusted seam with a corpse beside it, light from above'; } },
  {
    rule: 'image.human_presence',
    mutate: (s) => eachBeat(s, (b, i) => { b.image_prompt = `${b.image_prompt.split(' of ')[0]} of a rusted seam number ${i}, light from above`; }),
  },
  {
    rule: 'image.named_likeness',
    mutate: (s) => {
      s.beats[1]!.narration = 'Arthur Jell signed the order for the steel that winter.';
      s.beats[1]!.image_prompt = 'medium shot of Arthur Jell at the rail below the rusted tank, low sun from the west';
    },
  },
  { rule: 'image.hook_is_document', mutate: (s) => { s.beats[0]!.image_prompt = 'overhead view of a printed map on a scratched desk, lamp light from above'; } },
  { rule: 'image.document_beats', mutate: (s) => { s.beats[2]!.image_prompt = 'detail shot of a folded and creased map, light from above'; } },
  { rule: 'image.booru_syntax', mutate: (s) => { s.beats[2]!.image_prompt = 'detail shot of a rusted seam (quality:1.4), light from above'; } },
  { rule: 'image.imperfection', mutate: (s) => { s.beats[2]!.image_prompt = 'detail shot of a clean steel seam, light from above'; } },
  { rule: 'image.light_direction', mutate: (s) => { s.beats[2]!.image_prompt = 'detail shot of a rusted and chipped steel seam'; } },
  { rule: 'image.duplicate_subject', mutate: (s) => { s.beats[4]!.image_prompt = s.beats[2]!.image_prompt.replace('detail shot of', 'overhead view of'); } },

  // ── motion prompts ──
  {
    rule: 'motion.word_count',
    mutate: (s) => { s.beats[2]!.motion_prompt = 'a single bead swells at the seam and falls and swells again and falls again and swells once more and falls once more and keeps on going like that for the whole shot without stopping'; },
  },
  { rule: 'motion.frame_redescription', mutate: (s) => { s.beats[2]!.motion_prompt = 'a bead swells at the seam under muted 35mm film stock'; } },
  { rule: 'motion.no_camera_behavior', mutate: (s) => { s.beats[3]!.motion_prompt = 'the wet paint darkens at the split'; } },
  { rule: 'motion.locked_has_camera_move', mutate: (s) => { s.beats[2]!.motion_prompt = 'the camera orbits the weeping seam as a bead falls'; } },
  { rule: 'motion.multiple_camera_cues', mutate: (s) => { s.beats[3]!.motion_prompt = 'the camera pans left and then cranes up over the painted plate'; } },
  { rule: 'motion.hook_locked', mutate: (s) => { s.beats[0]!.camera_locked = true; } },
  { rule: 'motion.implausible', mutate: (s) => { s.beats[2]!.motion_prompt = 'a bead falls from the seam in extreme slow motion'; } },

  // ── caption ──
  {
    rule: 'caption.first_line_length',
    mutate: (s) => { s.tiktok_caption = `${'A very long opening line that keeps going well past the fold and simply refuses to stop before the hundred character mark.'}\n#history #boston #wtf`; },
  },
  { rule: 'caption.hashtags', mutate: (s) => { s.tiktok_caption = 'Warm and brown and deadly.\n#history'; } },
  { rule: 'caption.spoiler', mutate: (s) => { s.tiktok_caption = 'Molasses in the street.\n#history #boston #wtf'; } },

  // ── style prefix ──
  { rule: 'style.negatives', mutate: (s) => { s.style_prefix = `${s.style_prefix} no people, no cars.`; } },
  { rule: 'style.vertical_clause', mutate: (s) => { s.style_prefix = s.style_prefix.replace('vertical 9:16 composition, ', ''); } },
  { rule: 'style.skeleton', mutate: (s) => { s.style_prefix = s.style_prefix.replace('documentary evidence photograph', 'a nice photo'); } },
  { rule: 'style.capture_medium', mutate: (s) => { s.style_prefix = s.style_prefix.replace('sheet film', 'Kodachrome 64 slide film'); } },
  { rule: 'style.era_truth', mutate: (s) => { s.evidence_stamp = 'BOSTON, MASSACHUSETTS — JANUARY 2019'; } },

  // ── overlay hook and stamp ──
  { rule: 'overlay.word_count', mutate: (s) => { s.overlay_hook = 'The harbour tank was quietly painted a fresh brown'; } },
  { rule: 'overlay.digits', mutate: (s) => { s.overlay_hook = 'The 1919 tank was painted brown'; } },
  { rule: 'overlay.verbatim_prefix', mutate: (s) => { s.overlay_hook = 'Molasses killed twenty one people'; } },
  { rule: 'overlay.spoiler', mutate: (s) => { s.overlay_hook = 'Built too thin'; } },
  { rule: 'stamp.format', mutate: (s) => { delete s.evidence_stamp; } },
  { rule: 'stamp.digits_allowed', mutate: (s) => { s.evidence_stamp = 'BOSTON, MASSACHUSETTS — JANUARY NINETEEN NINETEEN'; } },
];

describe('the good fixture is the acceptance criterion', () => {
  it('produces zero findings of any severity', () => {
    expect(validateStory(goodStoryFixture(), { promptExamples: examples() })).toEqual([]);
  });

  it('contains no prompt example', () => {
    const findings = validateStory(goodStoryFixture(), { promptExamples: examples() });
    expect(findings.filter((f) => f.rule === 'story.example_leakage')).toEqual([]);
  });

  it('survives postProcessStory with no findings either', () => {
    const good = goodStoryFixture();
    const { findings } = postProcessStory(good, { promptExamples: examples() });
    expect(findings.map((f) => `${f.severity}:${f.rule}`)).toEqual([]);
  });
});

describe('every rule fires when its rule is broken', () => {
  it.each(CASES)('$rule', ({ rule, mutate }) => {
    const story = goodStoryFixture();
    mutate(story);
    const findings = validateStory(story, { promptExamples: examples() });
    expect(findings.map((f) => f.rule)).toContain(rule);
  });
});

describe('registry integrity', () => {
  // Without this, a new rule can be added with no test and nobody notices.
  it('every registered rule has a case', () => {
    expect([...new Set(CASES.map((c) => c.rule))].sort()).toEqual(
      [...STORY_RULES].map((r) => r.id).sort(),
    );
  });

  it('every rule has a unique id and a documented source', () => {
    const ids = STORY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of STORY_RULES) {
      expect(rule.source.length, `${rule.id} has no source`).toBeGreaterThan(5);
    }
  });

  it('tier 2 rules are warning-only — heuristics never hard-fail', () => {
    for (const rule of STORY_RULES.filter((r) => r.tier === 2)) {
      expect(rule.severity, `${rule.id} is a heuristic and must be a warning`).toBe('warning');
    }
  });
});

describe('the sloppy fixture', () => {
  it('trips at least 20 distinct rules across both severities', () => {
    const findings = validateStory(sloppyStoryFixture(), { promptExamples: examples() });
    expect(new Set(findings.map((f) => f.rule)).size).toBeGreaterThanOrEqual(20);
    expect(findings.some((f) => f.severity === 'error')).toBe(true);
    expect(findings.some((f) => f.severity === 'warning')).toBe(true);
  });

  // errors must never block: the story still has to reach story_review
  it('does not throw in postProcessStory', () => {
    expect(() => postProcessStory(sloppyStoryFixture(), { promptExamples: examples() })).not.toThrow();
  });

  it('sorts errors before warnings', () => {
    const { findings } = postProcessStory(sloppyStoryFixture(), { promptExamples: examples() });
    const firstWarning = findings.findIndex((f) => f.severity === 'warning');
    const lastError = findings.map((f) => f.severity).lastIndexOf('error');
    expect(lastError).toBeLessThan(firstWarning);
  });
});

describe('false positives the eval caught (regressions)', () => {
  // Haiku wrote "macro glide leftward across the fractured coal surface,
  // revealing texture grain." — a real surface description, flagged because
  // STYLE_NOUNS carried a bare 'grain'.
  it('allows material grain in a motion prompt', () => {
    const story = goodStoryFixture();
    story.beats[5]!.motion_prompt = 'the camera orbits the fractured coal surface, revealing texture grain';
    const findings = validateStory(story, { promptExamples: examples() });
    expect(findings.filter((f) => f.rule === 'motion.frame_redescription')).toEqual([]);
  });

  it('still flags film-stock grain in a beat prompt', () => {
    const story = goodStoryFixture();
    story.beats[5]!.motion_prompt = 'the camera orbits the seam under heavy film grain';
    expect(
      validateStory(story, { promptExamples: examples() }).map((f) => f.rule),
    ).toContain('motion.frame_redescription');
  });

  it('still flags film-stock grain in an image prompt', () => {
    const story = goodStoryFixture();
    story.beats[5]!.image_prompt = 'detail shot of a rusted seam, fine grain, light from above';
    expect(
      validateStory(story, { promptExamples: examples() }).map((f) => f.rule),
    ).toContain('image.style_words');
  });
});

describe('text helpers', () => {
  it('splits sentences on terminal punctuation', () => {
    expect(sentencesOf('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });
  it('counts words ignoring extra whitespace', () => {
    expect(wordsOf('  one   two\nthree ')).toEqual(['one', 'two', 'three']);
  });
  it('returns zero spread for identical values', () => {
    expect(stdev([5, 5, 5])).toBe(0);
    expect(stdev([2, 10])).toBeGreaterThan(3);
  });
});

describe('people are allowed, the dead are not (2 Sep 2026)', () => {
  it('does not flag anonymous figures or faces in an image prompt', () => {
    const story = goodStoryFixture();
    story.beats[3]!.image_prompt =
      'medium shot of a woman in a shawl at a tenement window, her face lit by lamplight from the left, cracked sill';
    const rules = validateStory(story, { promptExamples: examples() }).map((f) => f.rule);
    expect(rules).not.toContain('image.graphic_content');
    expect(rules).not.toContain('image.people');
  });

  it('the hook must move: a locked hook and a camera-only hook both fail', () => {
    const cameraOnly = goodStoryFixture();
    cameraOnly.beats[0]!.motion_prompt = 'the camera drifts slowly right across the street';
    expect(validateStory(cameraOnly, { promptExamples: examples() }).map((f) => f.rule)).toContain('motion.hook_locked');
  });

  it('accepts an atmosphere fact in place of a wear detail', () => {
    const story = goodStoryFixture();
    story.beats[2]!.image_prompt = 'detail shot of a steel seam in driving rain, light from above';
    expect(validateStory(story, { promptExamples: examples() }).filter((f) => f.rule === 'image.imperfection')).toEqual([]);
  });

  it('licenses exactly one paperwork beat', () => {
    const story = goodStoryFixture();
    const findings = validateStory(story, { promptExamples: examples() });
    expect(findings.filter((f) => f.rule === 'image.document_beats')).toEqual([]);
    expect(findings.filter((f) => f.rule === 'image.hook_is_document')).toEqual([]);
  });
});

describe('eval regressions (Haiku, 2 Sep 2026)', () => {
  it('counts ordinary physical motion as subject motion', () => {
    const story = goodStoryFixture();
    story.beats[0]!.motion_prompt = 'runners stagger forward through the dust, camera tracks alongside';
    story.beats[2]!.motion_prompt = 'condensation drips from the concrete and pools in the floor cracks';
    const rules = validateStory(story, { promptExamples: examples() }).map((f) => f.rule);
    expect(rules).not.toContain('motion.hook_locked');
    expect(rules).not.toContain('story.subject_motion_count');
  });

  it('accepts "point of view shot" as the pov framing', () => {
    const story = goodStoryFixture();
    story.beats[3]!.image_prompt = 'point of view shot ground-level on a cracked street, low sun from the west';
    expect(validateStory(story, { promptExamples: examples() }).filter((f) => f.rule === 'image.shot_type_prefix')).toEqual([]);
  });

  it('recognises a bare "slow pan across" as camera behaviour', () => {
    const story = goodStoryFixture();
    story.beats[3]!.motion_prompt = 'slow pan across the industrial site as steam swells from the vents';
    expect(validateStory(story, { promptExamples: examples() }).filter((f) => f.rule === 'motion.no_camera_behavior')).toEqual([]);
  });

  it('a repeated subject verb warns, a repeated camera move errors', () => {
    const subject = goodStoryFixture();
    subject.beats[3]!.motion_prompt = 'the lens racks focus as steam lifts off the wet paint';
    const s = validateStory(subject, { promptExamples: examples() }).filter((f) => f.rule === 'story.motion_verb_reuse');
    expect(s.map((f) => f.severity)).toEqual(['warning']);

    const camera = goodStoryFixture();
    camera.beats[3]!.motion_prompt = 'the camera pushes in on the wet paint';
    const c = validateStory(camera, { promptExamples: examples() }).filter((f) => f.rule === 'story.motion_verb_reuse');
    expect(c.map((f) => f.severity)).toEqual(['error']);
  });
});
