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
  { rule: 'story.camera_locked_excess', mutate: (s) => { s.beats[2]!.camera_locked = true; } },
  { rule: 'story.beat_count', mutate: (s) => { s.beats = s.beats.slice(0, 6); } },

  // ── structure ──
  { rule: 'story.role_coverage', mutate: (s) => { s.beats = s.beats.filter((b) => b.role !== 'turn'); } },
  { rule: 'story.role_order', mutate: (s) => { s.beats[0]!.role = 'reveal'; } },
  { rule: 'story.turn_timing', mutate: (s) => eachBeat(s, (b) => { b.duration_seconds = 12; }) },
  {
    rule: 'story.example_leakage',
    mutate: (s) => { s.beats[1]!.narration = `${examples()[0]} Nothing else changed here.`; },
  },
  { rule: 'story.motion_verb_reuse', mutate: (s) => { s.beats[3]!.motion_prompt = 'the painter reaches up as the camera pushes in'; s.beats[6]!.motion_prompt = 'the woman kneels as the camera pushes in on the stove'; } },
  {
    rule: 'story.shot_type_diversity',
    mutate: (s) => eachBeat(s, (b, i) => { b.image_prompt = `wide shot of subject number ${i} with rusted plating, light from the left`; }),
  },
  {
    rule: 'story.shot_type_adjacent',
    mutate: (s) => { s.beats[1]!.image_prompt = s.beats[0]!.image_prompt.replace(/^extreme close-up of/, 'extreme close-up of'); },
  },
  { rule: 'motion.no_subject_motion', mutate: (s) => { s.beats[3]!.motion_prompt = 'the camera pans slowly across the plate'; } },
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
  { rule: 'image.face_visible', mutate: (s) => eachBeat(s, (b, i) => {
    // people still in frame, but every face turned away — the exact shape the
    // prompt used to teach with "a back turned to the event"
    b.image_prompt = `medium shot of a labourer in canvas overalls with his back turned at the rail number ${i}, low sun from the west, salt crust in the joints`;
  }) },
  { rule: 'image.hook_legibility', mutate: (s) => {
    // the Opus 5 eval's longest hook: nine distinct objects in one frame
    s.beats[0]!.image_prompt =
      'low angle of a telegraph pole and its crossarm wires against a sky filled with red and ' +
      'green auroral curtains over a Boston street, sparks at a cracked glass insulator, a man ' +
      'in a frock coat and stovepipe hat on the plank sidewalk with his back turned, lit by the ' +
      'auroral glow above and to the north, wet cobbles and a bent iron gutter, pole set ' +
      'off-centre with brick storefronts along the right edge';
  } },
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
  { rule: 'motion.locked_has_camera_move', mutate: (s) => { s.beats[2]!.camera_locked = true; s.beats[2]!.motion_prompt = 'the camera orbits the weeping seam as a bead falls'; } },
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

describe('eval regressions (Opus 5 high via cursor-agent, 3 Sep 2026)', () => {
  it('does not error on rust bleeding — that is wear, not injury', () => {
    // hit 3 of 5 Opus 5 stories at ERROR severity, so each one bought a
    // second paid provider call for exactly the concrete wear detail that
    // image.imperfection asks for
    const story = goodStoryFixture();
    story.beats[2]!.image_prompt =
      'close-up of a mooring line and anchor chain against a scarred wooden bow rail, ' +
      'rust bleeding from the chain links, sidelight from the low western sun';
    const graphic = validateStory(story, { promptExamples: examples() }).filter(
      (f) => f.rule === 'image.graphic_content',
    );
    expect(graphic).toEqual([]);
  });

  it('still errors on the bodily sense the rule exists for', () => {
    const story = goodStoryFixture();
    story.beats[2]!.image_prompt = 'close-up of a bleeding man on the cinder track';
    expect(
      validateStory(story, { promptExamples: examples() }).some(
        (f) => f.rule === 'image.graphic_content' && f.severity === 'error',
      ),
    ).toBe(true);
  });
});

describe('image.hook_legibility calibration', () => {
  const hookWords = (story: Story) =>
    validateStory(story, { promptExamples: examples() }).filter(
      (f) => f.rule === 'image.hook_legibility',
    );

  it('passes a fully compliant hook — every mandated clause present', () => {
    // the good fixture's hook is 38 words and all of it is required by
    // prompts/story.user.md: shot type, subject, a human, light + direction,
    // atmosphere, imperfection
    expect(hookWords(goodStoryFixture())).toEqual([]);
  });

  it('flags a hook carrying extra subjects, not extra compliance', () => {
    const story = goodStoryFixture();
    story.beats[0]!.image_prompt = `${story.beats[0]!.image_prompt}, a bent warning sign at frame left, a bicycle on its side, two gulls on the parapet, a cracked drain cover in the foreground`;
    expect(hookWords(story)).toHaveLength(1);
  });

  it('says nothing about the later beats — only the hook has 0.3s to be read', () => {
    const story = goodStoryFixture();
    story.beats[3]!.image_prompt = `${story.beats[3]!.image_prompt}, and a great many more things besides, piled up in the frame until nothing at all can be read from it quickly`;
    expect(hookWords(story)).toEqual([]);
  });
});

describe('motion.no_subject_motion calibration (Opus 5 corpus, 4 Sep 2026)', () => {
  const errorsFor = (motion: string) => {
    const story = goodStoryFixture();
    story.beats[3]!.motion_prompt = motion;
    return validateStory(story, { promptExamples: examples() }).filter(
      (f) => f.rule === 'motion.no_subject_motion' && f.severity === 'error',
    );
  };

  it('errors when the camera is the only thing moving', () => {
    for (const motion of [
      'the camera drifts slowly right across the street',
      'the camera holds steady on the frame',
      'the lens racks focus from the wet paint to the split beneath it',
      // verbatim from the corpus, the one true positive in seven stories
      'Camera tilts down from bare branches to buckled asphalt in foreground, revealing destruction.',
    ]) {
      expect(errorsFor(motion), motion).toHaveLength(1);
    }
  });

  it('does NOT error when action and camera share a clause', () => {
    // every one of these is verbatim from the corpus and every one was a false
    // positive until the clause splitter learned "while" and "as". A lexicon
    // gate failed them too: `haul` was not an alias of `hauling`, and
    // `rolls back` was not an alias of `rolling`.
    for (const motion of [
      'Frame stays fixed while the brass counterweight swings slowly to a stop.',
      'The auroral arc ripples southward across the sky while the camera pulls back along the wire.',
      'Both men feed sticks into the fire as the camera tilts up toward the sky.',
      'Camera pushes in while the two men haul him forward, his shoe tips scraping the track.',
      'The dust wall rolls back over the road and buries the runners behind it, camera tilting down with the cloud.',
      'Steam creeps out of the floor crack and spreads over the concrete; camera racks focus from the furnace door to the crack.',
    ]) {
      expect(errorsFor(motion), motion).toEqual([]);
    }
  });

  it('reads a car frame as a car frame, not a camera cue', () => {
    expect(
      errorsFor('The car bounces through a rut and the man on the running board grips the frame, camera tracking alongside.'),
    ).toEqual([]);
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

  it('a locked hook fails — the opening two seconds must move', () => {
    const locked = goodStoryFixture();
    locked.beats[0]!.camera_locked = true;
    expect(validateStory(locked, { promptExamples: examples() }).map((f) => f.rule)).toContain('motion.hook_locked');
  });

  it('a camera-only hook fails as a missing physical event, on any beat', () => {
    const cameraOnly = goodStoryFixture();
    cameraOnly.beats[0]!.motion_prompt = 'the camera drifts slowly right across the street';
    expect(
      validateStory(cameraOnly, { promptExamples: examples() }).some(
        (f) => f.rule === 'motion.no_subject_motion' && f.severity === 'error' && f.beat_index === 0,
      ),
    ).toBe(true);
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

  it('a subject verb repeated in NEIGHBOURING beats warns, a repeated camera move errors', () => {
    const subject = goodStoryFixture();
    // beat 2 already uses `falling`; repeat it in beat 3, right next to it
    subject.beats[3]!.motion_prompt = 'the painter reaches up and the loaded brush falls from his hand';
    subject.beats[2]!.motion_prompt = 'a bead swells at the seam and falls onto the waiting rag';
    const s = validateStory(subject, { promptExamples: examples() }).filter((f) => f.rule === 'story.motion_verb_reuse');
    expect(s.map((f) => f.severity)).toEqual(['warning']);

    // the fixture names no camera moves at all now, so plant the same one twice
    const camera = goodStoryFixture();
    camera.beats[3]!.motion_prompt = 'the painter reaches up as the camera pushes in';
    camera.beats[6]!.motion_prompt = 'the woman kneels as the camera pushes in on the stove';
    const c = validateStory(camera, { promptExamples: examples() }).filter((f) => f.rule === 'story.motion_verb_reuse');
    expect(c.map((f) => f.severity)).toEqual(['error']);
  });
});
