# Visual style — the Evidence File look

Root identity for @oneminutewtf. The channel concept: **every video looks like the visual record of the event, captured on whatever would have captured it, annotated by an investigator.** For a 1962 story that's Tri-X film; for a 2024 story that's a flagship phone frame or a dashcam still. The *record* changes with the era — the *file* (overlays, light discipline, composition, captions) is the constant that makes it recognizably one channel.

This replaces "archival = old". Old stories get period stock; fresh stories get period-accurate *digital* capture. Nothing is fake-aged.

## 1. What is constant (channel identity, never varies)

- **Evidence-capture framing**: every image reads as a document of the event, not an illustration of it. One motivated light source with a clear direction, honest shadows, real surface wear and imperfections, off-center honest composition.
- **The overlay layer** (Remotion, not generated): mono/typewriter secondary font (IBM Plex Mono) for location/date stamps in the upper third ("LAKE NYOS, CAMEROON — AUGUST 1986" / "BALTIMORE HARBOR — MARCH 2024"), thin 1px rule lines, small EXHIBIT-style tags on map/diagram beats. One stamp on the setup beat, one on the reveal, never more. Kinetic captions stay as-is.
- **Motion grammar**: existing rules (subject motion, unique verbs, 2–3 locked beats) unchanged.
- **Kicker ritual**: haunting loopable final frame, stamp-free, so the loop is clean.
- **AI RECONSTRUCTION tag** (Remotion): small mono line under the first stamp. TikTok requires AIGC that shows realistic scenes or people to be labelled, and every reel on this channel is a reconstructed crisis event. `RECONSTRUCTION_TAG=false` turns it off; do not.
- **People in frame** (§7): anonymous figures and faces are part of the record. The old `no people` line is gone from the prefix and the motion negatives.

## 2. Root `DEFAULT_STYLE_PREFIX` (drop-in for `shared/src/constants.ts`)

```
documentary evidence photograph captured in the event's own era on the era's own
medium, period-accurate capture characteristics, one motivated light source with
a clear direction, honest shadows, real surface wear and imperfections, truthful
unstaged composition, vertical 9:16 composition, cinematic, single image,
no grid, no text, no labels, no collage, no watermark, no modern branding.
```

## 3. Per-story `style_prefix` skeleton (for `prompts/story.user.md` STYLE section)

```
- Build the style_prefix from this exact skeleton, filled for THIS story:
  "documentary evidence photograph, [CAPTURE MEDIUM from the era table],
  [explicit real geography: region, architecture, vegetation, soil],
  [ONE signature light: source + direction + color], honest shadows, real
  surface wear, vertical 9:16 composition, cinematic."
- Pick exactly ONE capture medium from the table. Never mix eras or media.
```

## 4. Era → capture medium table

Historical:

| Era | Capture medium line |
|---|---|
| pre-1900 | silver gelatin plate, warm sepia tone, tunnel vignette, soft optics |
| 1900–1945 | large-format black and white sheet film, deep tonal range, hard flash shadow |
| 1946–1965 | Tri-X black and white film, high mid-tone contrast, gritty shadow grain |
| 1966–1979 | Kodachrome 64 slide film, saturated reds, deep daylight blue — or faded color negative, orange-magenta cast, lifted blacks, for quieter stories |
| 1980–1995 | Kodak Gold 200 consumer color negative, punchy color, magenta lean, visible grain, mild halation — or Portra warmth for quieter stories |
| 1996–2010 | 35mm point-and-shoot color negative, mild barrel distortion, soft edges — or early compact digital, small-sensor noise, harsh on-camera flash indoors |

Modern (fresh stories):

| Era | Capture medium line |
|---|---|
| 2011–2019 | early-smartphone or DSLR digital, neutral color, blown highlights outdoors, faint sensor noise in shadows |
| 2020–now, handheld | current flagship-phone photograph, computational HDR, lifted shadows, slight halo on high-contrast edges, 24mm-equivalent wide feel |
| 2020–now, professional | full-frame mirrorless digital, clean accurate color, shallow depth of field, real lens character |
| 2020–now, aerial/scale | drone photograph, high vantage, wide field, crisp daylight, GPS-era clarity |
| any modern, institutional | fixed monitoring-camera still — CCTV, dashcam, weather cam, harbor cam: muted color, slight compression artifacts, wide static framing (use for 1–2 beats max in incident stories; it is the modern equivalent of archival footage) |

Rule of thumb for fresh stories: handheld phone for human-scale beats, mirrorless for the reveal's clearest explanatory image, drone for scale contrast, institutional cam for the "this was recorded as it happened" beat. Still exactly one *primary* medium in the style_prefix; a beat may override medium in its image_prompt only for the institutional-cam beat.

## 5. Filled examples

1986 (Lake Nyos):

```
documentary evidence photograph, Kodak Gold 200 consumer color negative, punchy
color with magenta lean, visible grain and mild halation, northwest Cameroon
volcanic highlands, red laterite soil, elephant grass and scattered acacia,
tin-roof mudbrick villages, one signature light: low amber morning sun raking
across grey still water from the east, honest shadows, real surface wear,
vertical 9:16 composition, cinematic.
```

2024 (fresh incident, e.g. a harbor event):

```
documentary evidence photograph, current flagship-phone capture, computational
HDR with lifted shadows and slight halo on high-contrast edges, 24mm-equivalent
wide feel, US mid-Atlantic industrial harbor, steel truss structures, container
cranes, brackish grey-green water, one signature light: cold pre-dawn sodium
floodlights from the pier against a blue-black sky, honest shadows, real
surface wear, vertical 9:16 composition, cinematic.
```

## 6. Enforcement

- `postProcessStory`: warn unless the story's `style_prefix` contains exactly one capture-medium phrase from the table (substring check against a keyword list: "gelatin", "sheet film", "Tri-X", "Kodachrome", "color negative", "Kodak Gold", "Portra", "point-and-shoot", "compact digital", "smartphone", "flagship-phone", "DSLR", "mirrorless", "drone", "monitoring-camera"). Warning only, producer decides.
- Filled prefix is copied byte-identical across every beat (pipeline-learnings rule, unchanged).
- Overlay stamps are Remotion-rendered only — never ask the image model for text (the `no text` suffix stays).
- Era of the *capture medium* follows the era of the *event*, not the mood. A 2023 story in Tri-X is a lie; the channel promise is truth.

## 7. People and spectacle (added 2 Sep 2026)

The first published reels failed the channel promise in the opposite direction from the AI-slop we were guarding against: they were tasteful still-lifes. A floating-island story showed paper on a desk in four of seven beats and never showed the island; a lahar that buried a town opened on a mud stain on a wall. The cause was our own grammar — eight object framings, a hard `no people` rule, an imperfection lexicon made of decay, "drift" as the default camera and two force-locked beats.

**People.** Allowed and wanted. Anonymous, period-accurate figures in the clothes and postures of the place and year; faces are fine. At least one beat carries a human for scale or reaction (`image.human_presence` warns). Four framings were added so the grammar can hold a person: `close-up of`, `medium shot of`, `over-the-shoulder view of`, `point of view from`.

What stays banned, as errors: corpses, the dying, injuries, blood, victims in distress (`image.graphic_content` — for a death beat shoot the absence). What stays banned, as a warning: the face of a real named individual (`image.named_likeness` — show their hands, back, instrument or seat). Never children in danger. TikTok's Community Guidelines (Sep 2025) allow realistic AI people when labelled; they remove "dead bodies", "the moment of someone's death" and realistic AIGC that "misleads about a crisis event". Hence the on-screen tag in §1 and the AI-generated toggle at publish.

**Money shots.** The hook beat and at least one turn or reveal beat show the event itself at its most extreme documented moment, in progress, at scale. The hook is never paperwork (`image.hook_is_document`, error); at most one beat per video shows paper, maps, screens or desks (`image.document_beats`). One aerial or wide beat carries the full scale; one human-scale beat stands inside it.

**Atmosphere over decay.** A beat satisfies the "record of the event" test with either a wear detail or a physical atmosphere fact — rain, ash haze, spray, steam, smoke, backlight through a gap (`ATMOSPHERE_CUES`). Airless clean surfaces are the render tell; a catastrophe has weather.

**Motion.** The hook has the strongest subject motion in the video and is never locked (`motion.hook_locked`, error). Five beats move the scene (`story.subject_motion_count`, error). Exactly two locked beats, never hook, turn or reveal. Event-scale verbs (surge, flood, collapse, erupt, tear, race, crash, ignite, run, scatter, roll) are in the vocabulary; "explodes"/"shatters" left the implausible list. fal runs `prompt_expansion_mode: quality`, and any rewrite that comes back as "Static Shot / small amplitude / tranquil" on an unlocked beat is flagged in `generation_runs.output.expansion_flags` and the activity log.
