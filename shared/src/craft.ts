/**
 * Craft vocabulary — the shot, motion and capture-medium lists that both the
 * prompt templates and the story validator read.
 *
 * These live in shared/ (not api/) on purpose: the prompt-contract test
 * asserts that the prompt's shot-type list *is* SHOT_TYPES, and the review UI
 * names the offending verb back to the producer. One source of truth, or the
 * prompt and the validator drift apart within a month.
 *
 * Sources: docs/visual-style.md (root identity, wins on conflict),
 * docs/fal-video-generation.md §3-§4, docs/pipeline-learnings.md §4-§5.
 */

/** Canonical first-occurrence order of beat roles (see BEAT_ROLES). */
export const BEAT_ROLE_ORDER = [
  'hook',
  'setup',
  'escalation',
  'turn',
  'reveal',
  'kicker',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shot grammar
// ─────────────────────────────────────────────────────────────────────────────

export interface ShotType {
  id: string;
  /** Every image_prompt must start with one of these, verbatim. */
  prefix: string;
}

/**
 * The twelve approved image_prompt openers (prompts/story.user.md
 * CINEMATOGRAPHY). The last four were added when people came back into the
 * frame (docs/visual-style.md §7): the original eight are all object/space
 * framings, and a grammar with no way to hold a person produces still-lifes.
 * Order matters for shotTypeOf: "extreme close-up of" must precede "close-up of".
 */
export const SHOT_TYPES: readonly ShotType[] = [
  { id: 'extreme_close_up', prefix: 'extreme close-up of' },
  { id: 'close_up', prefix: 'close-up of' },
  { id: 'detail', prefix: 'detail shot of' },
  { id: 'medium', prefix: 'medium shot of' },
  { id: 'over_shoulder', prefix: 'over-the-shoulder view of' },
  // 'point of view' on purpose: Haiku wrote "point of view shot ..." and a
  // paid retry over the preposition is not a craft failure
  { id: 'pov', prefix: 'point of view' },
  { id: 'interior', prefix: 'interior of' },
  { id: 'wide', prefix: 'wide shot of' },
  { id: 'aerial', prefix: 'aerial view of' },
  { id: 'low_angle', prefix: 'low angle of' },
  { id: 'overhead', prefix: 'overhead view of' },
  { id: 'silhouette', prefix: 'silhouette of' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Hook forms and the rotating example pool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seven forms, not three. The original trio (contradiction / impossible image /
 * certainty destroyed) are three phrasings of one mechanism, so every video
 * opened the same way and viewers learn the trick.
 */
export const HOOK_FORMS = [
  'contradiction',
  'impossible_image',
  'certainty_destroyed',
  'consequence_first',
  'procedural_anomaly',
  'human_decision',
  'evidence_question',
] as const;
export type HookForm = (typeof HOOK_FORMS)[number];

export interface HookExample {
  form: HookForm;
  text: string;
}

/**
 * Sampled two-at-a-time into the prompt so no single phrasing becomes the
 * channel's tic. Deliberately drawn from stories we would never produce — an
 * example from a real candidate topic is the model being shown the answer.
 * Every entry is <= 10 words with the anomaly inside the first four.
 */
export const HOOK_EXAMPLE_POOL: readonly HookExample[] = [
  { form: 'contradiction', text: 'A river caught fire. Thirteen times.' },
  { form: 'contradiction', text: 'The safest ship afloat sank on calm water.' },
  { form: 'impossible_image', text: 'Frozen sharks washed ashore mid-swim.' },
  { form: 'impossible_image', text: 'A postbox kept delivering letters for forty years.' },
  { form: 'certainty_destroyed', text: 'Doctors blamed the water. The water was clean.' },
  { form: 'certainty_destroyed', text: 'Engineers signed it off. Nobody had checked underneath.' },
  { form: 'consequence_first', text: 'Nine hundred clocks stopped at once.' },
  { form: 'consequence_first', text: 'An entire harbour drained in eleven minutes.' },
  { form: 'procedural_anomaly', text: 'The alarm rang before anything went wrong.' },
  { form: 'procedural_anomaly', text: 'A lighthouse logged weather it never had.' },
  { form: 'human_decision', text: 'The crew locked themselves out on purpose.' },
  { form: 'evidence_question', text: 'Why was the bridge painted twice that week?' },
] as const;

/**
 * Weak → strong hook pairs (docs/hook-improvement-plan.md Phase 4). Few-shot
 * pairs move output further than rules do. Injected into the prompt in
 * backticks and rotated like HOOK_EXAMPLE_POOL, so a story that copies the
 * strong line is flagged by story.example_leakage. Drawn from stories we
 * would never produce, for the same reason as the pool.
 */
export interface HookUpgrade {
  weak: string;
  strong: string;
}
export const HOOK_UPGRADE_PAIRS: readonly HookUpgrade[] = [
  { weak: 'A strange event happened at a Welsh mine.', strong: 'The canary lived. The miners did not.' },
  { weak: 'An unusual weather event hit a small town.', strong: 'Hail the size of fists, in July, on one street.' },
  { weak: 'A ship disappeared under mysterious circumstances.', strong: 'The lifeboats were still lashed to the deck.' },
  { weak: 'A famous bridge had engineering problems.', strong: 'The bridge swayed for months. Then it twisted.' },
  { weak: 'Something odd was found in an old church.', strong: 'Under the altar, a sealed door nobody had opened.' },
  { weak: 'A city experienced a mysterious noise.', strong: 'A hum kept a whole town awake for years.' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Motion vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptVerb {
  /** Uniqueness is per key, not per phrase — synonym-swapping can't defeat it. */
  key: string;
  /** Narrative purpose (fal cinematography skill) — taught in the prompt. */
  purpose: string;
  /** Case-insensitive phrases that map to this key. */
  aliases: readonly string[];
}

/** Camera behaviour. At most ONE per beat; required on every non-locked beat. */
export const CAMERA_VERBS: readonly PromptVerb[] = [
  { key: 'push_in', purpose: 'pressure, intimacy', aliases: ['push in', 'push-in', 'pushes in', 'pushes closer', 'dolly in', 'moves closer', 'creeps toward', 'creeps in'] },
  { key: 'pull_back', purpose: 'isolation, reveal of scale', aliases: ['pull back', 'pull-back', 'pulls back', 'dolly out', 'pulls away', 'retreats from'] },
  { key: 'crane_up', purpose: 'scale release', aliases: ['crane up', 'cranes up', 'rises above', 'lifts over', 'boom up'] },
  { key: 'crane_down', purpose: 'descent into detail', aliases: ['crane down', 'cranes down', 'descends toward', 'lowers onto', 'boom down'] },
  { key: 'tilt_up', purpose: 'upward reveal', aliases: ['tilt up', 'tilts up', 'tilts upward', 'tilting up'] },
  { key: 'tilt_down', purpose: 'downward reveal', aliases: ['tilt down', 'tilts down', 'tilts downward', 'tilting down'] },
  { key: 'pan_left', purpose: 'lateral survey', aliases: ['pans left', 'pan left', 'panning left', 'pan to the left', 'right to left'] },
  { key: 'pan_right', purpose: 'lateral survey', aliases: ['pans right', 'pan right', 'panning right', 'pan to the right', 'left to right'] },
  { key: 'pan_across', purpose: 'lateral survey', aliases: ['pan across', 'pans across', 'slow pan', 'panning across', 'pans over', 'pan over'] },
  { key: 'drift_left', purpose: 'last resort — only when nothing in the frame moves', aliases: ['drifts left', 'drifts slowly left', 'slides left'] },
  { key: 'drift_right', purpose: 'last resort — only when nothing in the frame moves', aliases: ['drifts right', 'drifts slowly right', 'slides right'] },
  { key: 'tracking', purpose: 'follows a moving subject — the event is happening', aliases: ['tracking shot', 'tracks alongside', 'tracks with', 'follows alongside', 'camera follows', 'keeps pace with'] },
  { key: 'orbit', purpose: 'inspection — the object IS the fact', aliases: ['orbits', 'orbit around', 'slow orbit', 'orbiting', 'arcs around', 'circles around', 'circles the', 'arcs slowly around'] },
  { key: 'macro_glide', purpose: 'texture — the surface is the evidence', aliases: ['macro glide', 'glides across', 'glides over', 'skims the surface', 'travels across'] },
  { key: 'rack_focus', purpose: 'attention shift between two named details', aliases: ['rack focus', 'racks focus', 'focus shifts', 'focus pulls'] },
  { key: 'handheld', purpose: 'documentary instability', aliases: ['handheld', 'hand-held', 'slight sway', 'unsteady frame'] },
] as const;

/**
 * In-frame subject motion. >= 5 beats need one; at most two per beat.
 * The second block is the event vocabulary added 2 Sep 2026: the first list
 * was all whisper-scale (a crumb drops, a rope sways), and a WTF channel whose
 * biggest motion is a curling wisp reads as a slideshow.
 */
export const SUBJECT_MOTION_VERBS: readonly PromptVerb[] = [
  { key: 'rising', purpose: 'threat accumulating', aliases: ['rises', 'rising', 'climbs', 'creeps up', 'fills'] },
  { key: 'falling', purpose: 'aftermath', aliases: ['falls', 'falling', 'drifts down', 'rains down', 'sifts down'] },
  { key: 'settling', purpose: 'stillness after the event', aliases: ['settles', 'settling', 'comes to rest'] },
  { key: 'drifting', purpose: 'slow spread', aliases: ['drifts across', 'rolls in', 'creeps across', 'seeps'] },
  { key: 'curling', purpose: 'escape, leakage', aliases: ['curls', 'curling', 'coils', 'wisps'] },
  { key: 'lifting', purpose: 'disturbance', aliases: ['lifts', 'lifting', 'flutters', 'peels up', 'billows'] },
  { key: 'flickering', purpose: 'failure beginning', aliases: ['flickers', 'flickering', 'stutters', 'pulses'] },
  { key: 'dying_in_sequence', purpose: 'cascade failure', aliases: ['die row by row', 'dies row by row', 'goes dark one by one', 'switches off in sequence'] },
  { key: 'jumping', purpose: 'an instrument reacting', aliases: ['jump', 'jumps', 'twitches', 'kicks', 'spikes'] },
  { key: 'swaying', purpose: 'wind, abandonment', aliases: ['sways', 'swaying', 'rocks', 'nods'] },
  { key: 'rippling', purpose: 'unseen force below', aliases: ['ripples', 'rippling', 'trembles', 'shivers'] },
  { key: 'venting', purpose: 'pressure escaping', aliases: ['vents', 'venting', 'steams', 'hisses out', 'escapes from'] },
  { key: 'cracking', purpose: 'structural failure', aliases: ['cracks', 'cracking', 'splits', 'fractures'] },
  { key: 'spilling', purpose: 'containment lost', aliases: ['spills', 'spilling', 'overtops', 'pours over'] },
  { key: 'rotating', purpose: 'machinery still running', aliases: ['turns', 'rotates', 'spins', 'revolves'] },
  { key: 'shadow_creep', purpose: 'time passing', aliases: ['shadow crosses', 'shadow creeps', 'light moves across', 'light slides across'] },
  // event-scale motion — the documented catastrophe in progress
  { key: 'surging', purpose: 'the event arriving', aliases: ['surges', 'surging', 'rushes in', 'rushes down', 'sweeps in', 'sweeps across', 'sweeps through'] },
  { key: 'flooding', purpose: 'water taking ground', aliases: ['floods', 'flooding', 'inundates', 'swallows the', 'rises over', 'pours over', 'pours through', 'pours down'] },
  { key: 'collapsing', purpose: 'structure failing', aliases: ['collapses', 'collapsing', 'gives way', 'buckles under', 'caves in', 'topples'] },
  { key: 'erupting', purpose: 'pressure released', aliases: ['erupts', 'erupting', 'bursts from', 'bursts out', 'blows out', 'jets up', 'shoots up'] },
  { key: 'tearing', purpose: 'containment ripping open', aliases: ['tears open', 'tears through', 'rips open', 'rips through', 'splits open', 'breaks apart', 'breaks free'] },
  { key: 'racing', purpose: 'speed, pursuit', aliases: ['races', 'racing', 'speeds', 'hurtles', 'barrels down', 'streaks across'] },
  { key: 'crashing', purpose: 'impact', aliases: ['crashes', 'crashing', 'slams into', 'smashes', 'hammers against', 'batters'] },
  { key: 'igniting', purpose: 'fire starting or spreading', aliases: ['ignites', 'catches fire', 'flares up', 'flames spread', 'fire spreads', 'burns through', 'blazes'] },
  { key: 'running', purpose: 'people reacting', aliases: ['people run', 'runs from', 'run toward', 'run from', 'scramble', 'scrambles', 'flee', 'flees', 'hurry', 'hurries'] },
  { key: 'scattering', purpose: 'crowd or debris dispersing', aliases: ['scatters', 'scattering', 'scatter', 'disperse', 'flung', 'thrown across'] },
  { key: 'rolling', purpose: 'a mass advancing', aliases: ['rolls down', 'rolls across', 'rolls over', 'rolls in', 'tumbles', 'churns'] },
] as const;

/** Terms that read as "camera" even without a move verb (locked beats say these). */
export const CAMERA_BEHAVIOR_TERMS: readonly string[] = [
  'camera', 'static', 'locked', 'tripod', 'fixed frame', 'frame holds', 'camera holds',
  // bare cinematography nouns — "slow pan across", "orbit around", "lens racks"
  'lens', 'pan', 'orbit', 'dolly', 'crane', 'tilt', 'zoom', 'tracking',
] as const;

/**
 * Detection-only motion vocabulary. SUBJECT_MOTION_VERBS is the curated,
 * purpose-tagged list the prompt teaches and the once-per-video rule polices;
 * this broader list exists so story.subject_motion_count and motion.hook_locked
 * recognise ordinary physical motion ("runners stagger forward", "condensation
 * drips", "heat shimmer intensifies") instead of erroring a good story into a
 * paid retry. Never used for the reuse rule.
 */
export const GENERIC_MOTION_VERBS: readonly string[] = [
  // bare forms for plural subjects ("runners stagger", "clouds billow")
  'stagger', 'stumble', 'run', 'walk', 'shift', 'sway', 'swirl', 'drip', 'swell', 'flow', 'spread',
  'climb', 'fall', 'rise', 'billow', 'scatter', 'flee', 'tremble', 'shake', 'move', 'lean', 'slide',
  'sink', 'drift', 'tumble', 'burst', 'pour', 'surge', 'crumble', 'collapse', 'flicker', 'shimmer',
  'moves', 'moving', 'move forward', 'moves forward', 'walks', 'walking', 'walk', 'runs', 'running',
  'steps', 'stepping', 'staggers', 'staggering', 'stumbles', 'stumbling', 'shifts', 'shifting',
  'sways', 'swaying', 'swirls', 'swirling', 'swirl', 'drips', 'dripping', 'swells', 'swelling',
  'intensifies', 'shimmer', 'shimmers', 'shimmering', 'wavers', 'wavering', 'waves', 'flows', 'flowing',
  'streams', 'streaming', 'trickles', 'trickling', 'gushes', 'gushing', 'spreads', 'spreading',
  'bends', 'bending', 'sinks', 'sinking', 'slides', 'sliding', 'slips', 'slipping', 'leans', 'leaning',
  'reaches', 'reaching', 'grips', 'gripping', 'turns', 'turning', 'enters', 'entering', 'exits',
  'passes', 'passing', 'crosses', 'crossing', 'climbs', 'climbing', 'descends', 'descending',
  'drops', 'dropping', 'rains', 'snows', 'blows', 'blowing', 'gusts', 'flaps', 'flapping',
  'flutters', 'fluttering', 'trembles', 'trembling', 'shakes', 'shaking', 'vibrates', 'rattles',
  'tips', 'tipping', 'topples', 'tumbles', 'bursts', 'erupts', 'surges', 'floods', 'pours',
  'billows', 'rises', 'rising', 'falls', 'falling', 'settles', 'spills', 'cracks open', 'splits',
  'wipes', 'lifts', 'lowers', 'pulls', 'pushes forward', 'straining', 'strains', 'kneels', 'crouches',
  'points', 'gestures', 'nods', 'breathes', 'breathing', 'pulses', 'flickers', 'glows brighter',
  'dims', 'brightens', 'fades', 'darkens', 'lightens', 'churns', 'boils', 'bubbles', 'steams', 'smokes',
  'ignites', 'burns', 'flares', 'sparks', 'crumbles', 'collapses', 'gives way', 'creaks', 'groans',
] as const;

/** Every video family struggles with these (fal doc §3, §10). */
export const IMPLAUSIBLE_MOTION: readonly string[] = [
  'slow motion', 'slow-motion', 'extreme slow motion', 'bullet time',
  'time lapse', 'time-lapse', 'timelapse', 'hyperlapse',
  'time reverses', 'in reverse', 'rewinds', 'played backwards',
  'morphs into', 'transforms into', 'melts into', 'dissolves into',
  'teleports', 'levitates', 'defies gravity', 'impossibly fast',
  'warps', 'glitches',
  // "explodes into" / "shatters into" were removed 2 Sep 2026: documented
  // eruptions, bursts and collapses ARE the story on this channel.
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Image and style vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/** Front-loading heuristic: the anomaly should land in the hook's first 4 words. */
export const TENSION_MARKERS: readonly string[] = [
  'no', 'not', 'never', 'nothing', 'nobody', 'without', 'still', 'wrong',
  'impossible', 'killed', 'vanished', 'disappeared', 'empty', 'silent',
  'refused', 'backwards', 'twice', 'again', 'before', 'stopped',
] as const;

/** One concrete wear detail per image_prompt — clean surfaces read as renders. */
export const IMPERFECTION_CUES: readonly string[] = [
  'chipped', 'cracked', 'hairline crack', 'peeling', 'flaking paint', 'blistered paint',
  'rust', 'rusted', 'corroded', 'oxidised', 'oxidized', 'pitted',
  'worn', 'scuffed', 'scratched', 'faded', 'sun-bleached', 'sun bleached',
  'stained', 'water-stained', 'water stained', 'tide line', 'salt crust', 'limescale',
  'dented', 'bent', 'buckled', 'warped', 'sagging', 'patched', 'mismatched',
  'dusty', 'dust', 'grit', 'cobwebs', 'soot', 'smoke-blackened', 'grease', 'oil sheen',
  'mud-caked', 'caked in mud', 'mould', 'mold', 'moss', 'lichen', 'weeds', 'overgrown',
  'torn', 'frayed', 'dog-eared', 'creased', 'smudged', 'fingerprints', 'condensation',
] as const;

/**
 * Physical atmosphere and light facts a beat may name instead of (or with)
 * wear. Added when the imperfection lexicon turned every frame into decay:
 * rain, ash and backlight are photographic facts, not style words, and they
 * are what makes an evidence photograph of a catastrophe look like one.
 */
export const ATMOSPHERE_CUES: readonly string[] = [
  'rain', 'raining', 'downpour', 'drizzle', 'spray', 'sea spray', 'mist', 'fog', 'haze', 'ash haze',
  'ash', 'ashfall', 'smoke', 'steam', 'dust cloud', 'dust hanging', 'dust in the air', 'airborne dust',
  'snow', 'snowfall', 'sleet', 'hail', 'frost', 'ice fog', 'blizzard',
  'backlit', 'backlight', 'rim light', 'rim-lit', 'sun through', 'light through', 'lamplight', 'torchlight',
  'floodlight', 'floodlit', 'headlights', 'searchlight', 'firelight', 'lightning', 'glow of', 'glare',
  'shaft of light', 'light shaft', 'god rays', 'silhouetted against', 'against the sky', 'low sun',
  'storm light', 'storm clouds', 'overcast', 'heat shimmer', 'wind-driven', 'windblown', 'wind-blown',
] as const;

/**
 * Hard content line (docs/visual-style.md §7, TikTok "Shocking and Graphic
 * Content"): people are allowed, these are not. image.graphic_content errors
 * on them and the Gemini retry strips them.
 */
export const GRAPHIC_CONTENT_TERMS: readonly string[] = [
  'corpse', 'corpses', 'dead body', 'dead bodies', 'bodies', 'body bag', 'body bags', 'cadaver',
  'dying', 'dead man', 'dead woman', 'dead child', 'dead children', 'the dead', 'lifeless',
  'blood', 'bloody', 'bleeding', 'wound', 'wounds', 'wounded', 'gore', 'gory', 'mutilated',
  'dismembered', 'charred body', 'burned body', 'burning man', 'burning woman', 'drowning',
  'drowned', 'victim', 'victims', 'casualty', 'casualties', 'remains', 'skeleton', 'skull',
] as const;

/** Words that mean a human figure is in the frame — image.human_presence wants at least one beat. */
export const PERSON_TERMS: readonly string[] = [
  'person', 'people', 'man', 'woman', 'men', 'women', 'child', 'children', 'boy', 'girl',
  'figure', 'figures', 'crowd', 'crowds', 'worker', 'workers', 'farmer', 'farmers', 'fisherman',
  'fishermen', 'soldier', 'soldiers', 'sailor', 'sailors', 'crew', 'engineer', 'engineers',
  'villager', 'villagers', 'resident', 'residents', 'family', 'families', 'boater', 'boaters',
  'pilot', 'pilots', 'driver', 'drivers', 'nurse', 'doctor', 'operator', 'operators', 'passenger',
  'passengers', 'onlooker', 'onlookers', 'bystander', 'bystanders', 'silhouette of a man',
  'hands', 'hand', 'face', 'faces', 'shoulder', 'back of a', 'backs of',
] as const;

/**
 * Subjects that read as paperwork rather than the event. One such beat per
 * video is licensed (the hazard map, the logbook); the hook never is —
 * a published reel opened on a printout on a desk and never showed the island.
 */
export const DOCUMENT_SUBJECT_TERMS: readonly string[] = [
  'paper', 'papers', 'document', 'documents', 'map', 'maps', 'printout', 'printouts', 'desk',
  'screen', 'monitor', 'laptop', 'folder', 'folders', 'file', 'files', 'newspaper', 'report',
  'reports', 'logbook', 'ledger', 'chart', 'charts', 'diagram', 'blueprint', 'drawing', 'sheet',
  'form', 'letter', 'telegram', 'photograph of', 'printed', 'typed', 'stamped', 'clipboard',
  'satellite image', 'satellite frame', 'satellite printout',
] as const;

/**
 * Legal in style_prefix, an error in image_prompt / motion_prompt — the style
 * prefix is injected server-side and must stay byte-identical per video.
 */
export const STYLE_NOUNS: readonly string[] = [
  'film stock', 'bokeh', '35mm', '16mm', 'colour grade', 'color grade',
  'lens flare', 'depth of field', 'golden hour', 'lighting setup', 'colour palette',
  'color palette', 'aspect ratio', '9:16', 'vignette', 'halation',
  // film grain only in its film-stock forms. Bare 'grain' is a legitimate
  // material noun — the eval caught it flagging "revealing texture grain" on a
  // coal seam, which is a real surface description, not film-stock language.
  'film grain', 'fine grain', 'visible grain', 'heavy grain', 'grain structure',
  'gritty grain', 'shadow grain',
] as const;

/** Direction tokens — one motivated light source with a clear direction. */
export const LIGHT_DIRECTIONS: readonly string[] = [
  'from the left', 'from the right', 'from above', 'from below', 'from behind',
  'directly above', 'overhead', 'side-lit', 'side lit', 'backlit', 'backlighting', 'backlight',
  'rim light', 'rim-lit', 'raking', 'low from the', 'lit from', 'sun from', 'sunlight from',
  'light from', 'glow from', 'through the window', 'through the doorway', 'through a gap',
  'from the east', 'from the west', 'from the north', 'from the south',
  'from camera left', 'from camera right', 'from frame left', 'from frame right',
  'casting long shadows', 'casting deep shadows', 'shafts of light', 'shaft of light',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Evidence File: era -> capture medium (docs/visual-style.md §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureMedium {
  id: string;
  /** Human era label as written in the doc. */
  era: string;
  /** Inclusive event-year window. `to: null` means "and after". */
  from: number;
  to: number | null;
  /** Detection keywords (docs/visual-style.md §6 enforcement list). */
  keywords: readonly string[];
  /** The medium clause the prompt teaches and the validator quotes back. */
  line: string;
}

/**
 * The capture medium follows the era of the EVENT, not the mood. A 2023 story
 * in Tri-X is a lie; the channel promise is truth (visual-style.md §6).
 */
export const CAPTURE_MEDIA: readonly CaptureMedium[] = [
  {
    id: 'silver_gelatin', era: 'pre-1900', from: 0, to: 1899,
    keywords: ['gelatin', 'silver gelatin plate'],
    line: 'silver gelatin plate, warm sepia tone, tunnel vignette, soft optics',
  },
  {
    id: 'sheet_film', era: '1900–1945', from: 1900, to: 1945,
    keywords: ['sheet film', 'large-format black and white'],
    line: 'large-format black and white sheet film, deep tonal range, hard flash shadow',
  },
  {
    id: 'tri_x', era: '1946–1965', from: 1946, to: 1965,
    keywords: ['tri-x'],
    line: 'Tri-X black and white film, high mid-tone contrast, gritty shadow grain',
  },
  {
    id: 'kodachrome', era: '1966–1979', from: 1966, to: 1979,
    keywords: ['kodachrome'],
    line: 'Kodachrome 64 slide film, saturated reds, deep daylight blue',
  },
  {
    id: 'faded_color_negative', era: '1966–1979 (quieter stories)', from: 1966, to: 1979,
    keywords: ['color negative', 'colour negative'],
    line: 'faded colour negative, orange-magenta cast, lifted blacks',
  },
  {
    id: 'kodak_gold', era: '1980–1995', from: 1980, to: 1995,
    keywords: ['kodak gold'],
    line: 'Kodak Gold 200 consumer colour negative, punchy colour, magenta lean, visible grain, mild halation',
  },
  {
    id: 'portra', era: '1980–1995 (quieter stories)', from: 1980, to: 1995,
    keywords: ['portra'],
    line: 'Portra warmth, soft contrast, natural skin-neutral palette',
  },
  {
    id: 'point_and_shoot', era: '1996–2010', from: 1996, to: 2010,
    keywords: ['point-and-shoot', 'point and shoot'],
    line: '35mm point-and-shoot colour negative, mild barrel distortion, soft edges',
  },
  {
    id: 'compact_digital', era: '1996–2010 (digital)', from: 1996, to: 2010,
    keywords: ['compact digital'],
    line: 'early compact digital, small-sensor noise, harsh on-camera flash indoors',
  },
  {
    id: 'early_digital', era: '2011–2019', from: 2011, to: 2019,
    keywords: ['dslr', 'early-smartphone', 'early smartphone'],
    line: 'early-smartphone or DSLR digital, neutral colour, blown highlights outdoors, faint sensor noise in shadows',
  },
  {
    id: 'flagship_phone', era: '2020–now, handheld', from: 2020, to: null,
    keywords: ['flagship-phone', 'flagship phone', 'smartphone'],
    line: 'current flagship-phone photograph, computational HDR, lifted shadows, slight halo on high-contrast edges, 24mm-equivalent wide feel',
  },
  {
    id: 'mirrorless', era: '2020–now, professional', from: 2020, to: null,
    keywords: ['mirrorless'],
    line: 'full-frame mirrorless digital, clean accurate colour, shallow depth of field, real lens character',
  },
  {
    id: 'drone', era: '2020–now, aerial/scale', from: 2020, to: null,
    keywords: ['drone'],
    line: 'drone photograph, high vantage, wide field, crisp daylight, GPS-era clarity',
  },
  {
    id: 'institutional_cam', era: 'any modern, institutional', from: 2000, to: null,
    keywords: ['monitoring-camera', 'monitoring camera', 'cctv', 'dashcam', 'weather cam', 'harbor cam', 'harbour cam'],
    line: 'fixed monitoring-camera still — CCTV, dashcam, weather cam or harbour cam: muted colour, slight compression artifacts, wide static framing',
  },
] as const;

/** The one beat per incident story allowed to override the medium in its own image_prompt. */
export const INSTITUTIONAL_CAM_ID = 'institutional_cam';

/** The Evidence File style_prefix always opens with this (visual-style.md §3). */
export const STYLE_PREFIX_OPENER = 'documentary evidence photograph';

// ─────────────────────────────────────────────────────────────────────────────
// Pure matchers — used by the prompt builder, the validator and the tests
// ─────────────────────────────────────────────────────────────────────────────

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive, word-boundary-guarded phrase hits, in order of appearance. */
export function matchPhrases(text: string, phrases: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return phrases.filter((phrase) => {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase.toLowerCase())}([^a-z0-9]|$)`);
    return re.test(haystack);
  });
}

/** Distinct verb keys present in `text` (aliases collapse to their key). */
export function matchVerbKeys(text: string, verbs: readonly PromptVerb[]): string[] {
  const keys: string[] = [];
  for (const verb of verbs) {
    if (matchPhrases(text, verb.aliases).length > 0) keys.push(verb.key);
  }
  return keys;
}

/** The shot type an image_prompt opens with, or null. */
export function shotTypeOf(imagePrompt: string): ShotType | null {
  const normalized = imagePrompt.trim().toLowerCase();
  return SHOT_TYPES.find((shot) => normalized.startsWith(shot.prefix)) ?? null;
}

/** Capture media whose keywords appear in a style_prefix (should be exactly one). */
export function captureMediaIn(stylePrefix: string): CaptureMedium[] {
  return CAPTURE_MEDIA.filter((medium) => matchPhrases(stylePrefix, medium.keywords).length > 0);
}
