Write a micro-documentary script about this true story/topic: "{{topic}}"
{{source_block}}
EDITING NOTE (for humans, not the model): sentences wrapped in `backticks` are
illustrative examples. The pipeline extracts them and flags any story that
reuses their wording. Never backtick a line the model is SUPPOSED to copy
(capture-medium lines, shot-type prefixes) — those stay unquoted.

STRUCTURE (question → evidence → complication → answer):
- 8 to 12 beats. Use the roles in order: hook, setup, escalation, turn, reveal, kicker. You may repeat setup, escalation, turn or reveal, but include exactly ONE hook and exactly ONE kicker.
- The hook states the anomaly. Setup establishes the ordinary reality and the documented causal event. Escalation gives the strongest obvious explanation. The turn introduces one specific fact that explanation cannot account for. The reveal explains the mechanism literally. The kicker supplies one final verified consequence, measurement, decision or present-day detail.
- The first turn must land before ~25 seconds at {{wpm}} words per minute. Do not pad the opening to reach a timestamp.
- Every beat must add new information. Do not restate the hook, do not summarise the beat that is coming, and never announce that the story is about to get stranger.
- Every non-kicker beat ends by withholding ONE concrete cause, consequence, measurement, decision or mechanism that the next beat pays off. That withheld thing is what stops the swipe.
- The reveal must answer the hook's exact wording literally, not a related or weaker claim.
- Do NOT output index, word_count or duration_seconds. The server derives all three from the narration.

THE HOOK (this decides whether anyone watches):
- The hook beat's narration and the "hook" field must carry the same factual promise. Maximum 10 words. The anomaly must arrive within the first 4 words.
- Choose exactly ONE form for this story:
  - contradiction — two verified facts that cannot comfortably coexist.
  - impossible image — one documented physical condition that demands an explanation.
  - certainty destroyed — overturn a belief that was genuinely documented, never an invented consensus.
  - consequence first — state the measured result, withhold the cause.
  - procedural anomaly — an ordinary system performing one documented abnormal action.
  - human decision — the strange documented choice, withhold why it became necessary.
  - evidence question — one specific question whose answer is not obvious from the wording.
- Two examples of the FORM only. Reusing their wording is auto-flagged and sent back:
{{hook_examples}}
- Carry at least one concrete noun, place, object, action or measurement whenever the source supports one.
- Never open with a date or "At exactly" — dates belong in the setup beat, unless the date itself is the anomaly.
- Never use "everyone", "nobody" or "no one" unless the source explicitly supports that scope.
- Never make the hook louder than the evidence.

NARRATION — HARD RULES (read aloud by a voice engine):
- Total: {{min_words}}-{{max_words}} words ({{min_seconds}}-{{max_seconds}} seconds at {{wpm}} wpm). Per-beat narration under 300 characters.
- Write ALL numbers as spoken words: "1,746" → "one thousand seven hundred and forty six", "CO2" → "carbon dioxide", "1986" → "nineteen eighty six". NO digits anywhere in narration.
- NO bracketed tags or stage directions — no [sigh], [pause], (laughs). The engine reads them aloud.
- Every beat ends with a complete sentence and terminal punctuation (. ! ?). Never end a beat on a comma, dash or ellipsis — it sounds cut off.
- Vary sentence length deliberately. Across the script include some short sentences of three to seven words, some medium of eight to sixteen, and occasionally one of seventeen to twenty-four. Never write more than three consecutive sentences in the same length band — even rhythm is the clearest sign of machine writing.
- Prefer concrete nouns, named places, physical actions, measurements, documents, tools and decisions. Avoid abstract filler: "the situation", "the phenomenon", "the mystery", "the truth", "the reality", "the forces at play", "things".
- Never describe or point at the picture. No "look at", "we see", "pictured here", "in this image" — the viewer is already looking. The narration adds cause, consequence, scale, mechanism, context or a documented human action.
- At most two adjectives for one noun. Prefer a measured or material detail over a mood adjective. No prestige adjectives in narration.
- Use the most informative verified number available when scale matters. Never invent precision to make a line stronger.
- Never write these phrases:
{{banned_phrases}}
- The kicker must LAND: its last sentence is short, closed and declarative, with falling finality. Optionally follow with ONE short engagement question — but never if it weakens the factual ending.
- Only verified facts. If a detail is uncertain, drop it.

CINEMATOGRAPHY — image_prompt per beat:
- START each image_prompt with exactly one shot type, then the subject: "extreme close-up of...", "detail shot of...", "interior of...", "wide shot of...", "aerial view of...", "low angle of...", "overhead view of...", "silhouette of...".
- Use at least 5 DIFFERENT shot types across the video. Never use the same shot type in adjacent beats.
- Every image reads as a document of the event, not an illustration of it: name ONE motivated light source WITH a direction, keep shadows honest, and include ONE concrete wear or imperfection detail (chipped, rusted, water-stained, dust in the light shaft, a bent sign, condensation). Clean surfaces read as renders.
- Compose off-centre and truthfully — include a real wall, edge, corner or horizon. Dead-centre subjects, everything-in-focus and seamless gradient backgrounds are the machine tells.
- Shot grammar by role: hook = the closest, most visually specific evidence of the anomaly, never a generic establishing landscape; setup = human-scale evidence (objects, interiors, documents, machines, maps); escalation and turn = change scale or focal plane only when the contrast clarifies the evidence; reveal = the clearest physical or procedural explanation; kicker = a concrete final image that can visually rhyme with the hook.
- Subject, composition and photographic facts only. No style words, no prestige adjectives, no director names, no booru tags, no weighted parentheses, no captions or labels. The style prefix is prepended automatically.
- No people, faces, bodies, corpses or victims. Show the absence instead — traces, objects, an interior after the fact, or distant human-scale context.

MOTION — motion_prompt per beat:
- Under 30 words. Describe motion ONLY — never re-describe the frame, its subject, lighting, geography, era or composition.
- ONE physically plausible motion event per beat. If the action is complex, that is a story problem: split the beat.
- At most ONE camera cue per beat. Every non-locked beat must name its camera behaviour explicitly, even if it is only "camera drifts slowly right" — an unspecified camera defaults to a flat slow zoom.
- Camera vocabulary, each with the reason to use it: push-in (pressure), pull-back (isolation, reveal of scale), crane up (scale release), crane down (descent into detail), tilt up or down (reveal), pan left or right (lateral survey), drift left or right (the honest default), orbit (inspection — the object IS the fact), macro glide (texture — the surface is the evidence), rack focus (attention shift between two named details), handheld (documentary instability).
- At least 4 beats must have SUBJECT motion inside the frame, not only camera movement.
- Use each substantive motion verb at most once across the whole video. Prefer a plain verb over a forced synonym.
- camera_locked: true on exactly 2 or 3 quieter beats — static tripod shots are what stop the video reading as a drifting AI slideshow. A locked beat must NOT contain a camera move; it still describes subject motion within the fixed frame, unless the stillness itself is the documented evidence.
- Never use cuts, transitions, extreme slow motion, time-lapse, reverse, morphing or conflicting simultaneous actions. The fixed negatives are appended server-side.

STYLE — style_prefix (one reusable line for THIS story):
- Build it from this exact skeleton, filled for this story:
  "documentary evidence photograph, [CAPTURE MEDIUM from the table below], [explicit real geography: region, architecture, vegetation, soil], [ONE signature light: source + direction + colour], honest shadows, real surface wear, vertical 9:16 composition, cinematic."
- Pick exactly ONE capture medium. Never mix eras or media.
- The medium follows the era of the EVENT, not the mood. A twenty-twenties story shot on Tri-X is a lie, and the channel promise is truth.

| Era of the event | Capture medium line |
|---|---|
| pre-1900 | silver gelatin plate, warm sepia tone, tunnel vignette, soft optics |
| 1900–1945 | large-format black and white sheet film, deep tonal range, hard flash shadow |
| 1946–1965 | Tri-X black and white film, high mid-tone contrast, gritty shadow grain |
| 1966–1979 | Kodachrome 64 slide film, saturated reds, deep daylight blue — or faded colour negative, orange-magenta cast, lifted blacks, for quieter stories |
| 1980–1995 | Kodak Gold 200 consumer colour negative, punchy colour, magenta lean, visible grain, mild halation — or Portra warmth for quieter stories |
| 1996–2010 | 35mm point-and-shoot colour negative, mild barrel distortion, soft edges — or early compact digital, small-sensor noise, harsh on-camera flash indoors |
| 2011–2019 | early-smartphone or DSLR digital, neutral colour, blown highlights outdoors, faint sensor noise in shadows |
| 2020–now, handheld | current flagship-phone photograph, computational HDR, lifted shadows, slight halo on high-contrast edges, 24mm-equivalent wide feel |
| 2020–now, professional | full-frame mirrorless digital, clean accurate colour, shallow depth of field, real lens character |
| 2020–now, aerial or scale | drone photograph, high vantage, wide field, crisp daylight, GPS-era clarity |
| any modern, institutional | fixed monitoring-camera still — CCTV, dashcam, weather cam or harbour cam: muted colour, slight compression artifacts, wide static framing |

- For a modern story: handheld phone for human-scale beats, mirrorless for the reveal's clearest explanatory image, drone for scale contrast, and the institutional monitoring-camera for the one "this was recorded as it happened" beat. Exactly one PRIMARY medium goes in the style_prefix; a single beat may name the monitoring-camera medium in its own image_prompt, and no more than one.
- Include explicit real geography — region, architecture, vegetation, soil. Never default to Northern Europe.
- Do NOT include negative terms; they are added automatically.

Also produce:
- topic — the short canonical form of the event.
- hook — the spoken swipe-stopper, maximum 10 words.
- overlay_hook — the on-screen version, maximum 8 words, no terminal punctuation. It may attack a different angle than the spoken hook; that is a feature. It must not restate the narration verbatim and must not spoil the reveal.
- evidence_stamp — the place and date as they would be typed on a case file, uppercase, e.g. PLACE, COUNTRY — MONTH YEAR. Keep the year in digits here: this one is read on screen, never spoken.
- exhibit_tag — optional, only on a map or diagram beat: a short uppercase tag of two or three words.
- title — specific, not clickbait.
- tiktok_caption — first line under 100 characters, a curiosity gap that does NOT spoil the reveal, then 3-5 relevant hashtags.

Respond with ONLY the JSON object.
