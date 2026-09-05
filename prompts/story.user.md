Write a micro-documentary script about this true story/topic: "{{topic}}"
{{source_block}}
EDITING NOTE (for humans, not the model): sentences wrapped in `backticks` are
illustrative examples. The pipeline extracts them and flags any story that
reuses their wording. Never backtick a line the model is SUPPOSED to copy
(capture-medium lines, shot-type prefixes) — those stay unquoted.

STRUCTURE (question → evidence → complication → answer):
- 7 to 10 beats. Use the roles in order: hook, setup, escalation, turn, reveal, kicker. You may repeat setup, escalation, turn or reveal, but include exactly ONE hook and exactly ONE kicker.
- The hook states the anomaly. Setup establishes the ordinary reality and the documented causal event. Escalation gives the strongest obvious explanation. The turn introduces one specific fact that explanation cannot account for. The reveal explains the mechanism literally. The kicker supplies one final verified consequence, measurement, decision or present-day detail.
- HUMAN PRESENCE: within the first two beats, put a specific person or group in an ordinary moment — named when the source names them, described by role when it does not (the night-shift operator, a farmer walking to the paddies). Tell the story through what they saw, heard or did. A reel with no human in it is a catalogue of facts, and nobody finishes a catalogue.
- RE-HOOK: the first turn beat's narration must open a SECOND explicit open question, phrased as a statement of what did not add up — a new loop that the reveal closes. One loop at zero seconds and a second at the turn is what carries the middle.
- The first turn must land before ~22 seconds at {{wpm}} words per minute. Do not pad the opening to reach a timestamp.
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
- Weak → strong, so you can see the difference. The weak version is the topical summary every writer reaches for first; the strong one is specific, sensory and carries a cost. Reusing these is also auto-flagged:
{{hook_upgrades}}
- Carry at least one concrete noun, place, object, action or measurement whenever the source supports one.
- LOSS FRAMING: when the story has a victim, a cost or something that was lost, phrase the hook around the loss rather than the phenomenon. What was taken lands harder than what happened.
- Never open with a date or "At exactly" — dates belong in the setup beat, unless the date itself is the anomaly.
- Never use "everyone", "nobody" or "no one" unless the source explicitly supports that scope.
- Never make the hook louder than the evidence.

NARRATION — HARD RULES (read aloud by a voice engine):
- Total: {{min_words}}-{{max_words}} words ({{min_seconds}}-{{max_seconds}} seconds at {{wpm}} wpm). Per-beat narration under 300 characters and at most 22 words; the hook beat at most 12 words. A beat over that is a nine-second hold on one animated still.
- Write ALL numbers as spoken words: "1,746" → "one thousand seven hundred and forty six", "CO2" → "carbon dioxide", "1986" → "nineteen eighty six". NO digits anywhere in narration.
- NO bracketed tags or stage directions — no [sigh], [pause], (laughs). The engine reads them aloud.
- Every beat ends with a complete sentence and terminal punctuation (. ! ?). Never end a beat on a comma, dash or ellipsis — it sounds cut off.
- Vary sentence length deliberately. Across the script include some short sentences of three to seven words, some medium of eight to sixteen, and occasionally one of seventeen to twenty-four. Never write more than three consecutive sentences in the same length band — even rhythm is the clearest sign of machine writing.
- SENSORY BEAT: at least one sentence in the script puts the viewer inside the moment with a verified physical detail — what it sounded like, how cold, how fast, what it smelled of. A fact the body can feel outlasts a fact the mind files.
- Prefer concrete nouns, named places, physical actions, measurements, documents, tools and decisions. Avoid abstract filler: "the situation", "the phenomenon", "the mystery", "the truth", "the reality", "the forces at play", "things".
- Never describe or point at the picture. No "look at", "we see", "pictured here", "in this image" — the viewer is already looking. The narration adds cause, consequence, scale, mechanism, context or a documented human action.
- At most two adjectives for one noun. Prefer a measured or material detail over a mood adjective. No prestige adjectives in narration.
- Use the most informative verified number available when scale matters. Never invent precision to make a line stronger.
- Never write these phrases:
{{banned_phrases}}
- The kicker must LAND: its last sentence is short, closed and declarative, with falling finality. Optionally follow with ONE short engagement question — but never if it weakens the factual ending.
- Only verified facts. If a detail is uncertain, drop it.

CINEMATOGRAPHY — image_prompt per beat:
- START each image_prompt with exactly one shot type, then the subject: "extreme close-up of...", "close-up of...", "detail shot of...", "medium shot of...", "over-the-shoulder view of...", "point of view from...", "interior of...", "wide shot of...", "aerial view of...", "low angle of...", "overhead view of...", "silhouette of...".
- Use at least 5 DIFFERENT shot types across the video. Never use the same shot type in adjacent beats.
- MONEY SHOTS: the hook beat AND at least one turn or reveal beat show the event itself at its most extreme documented moment, in progress, at scale — the gas cloud rolling downhill, the island of trees adrift on open water, the mudflow filling the valley, the wave crossing the street. Traces, aftermath and paperwork are supporting beats. The hook is never a document, a desk, a screen or an empty room: the first frame is the cover image and the swipe decision.
- PAPERWORK CAP: at most ONE beat per video may show paper, maps, screens, printouts, folders or desks. Everything else shows places, weather, machines, water, fire, sky and people.
- PEOPLE: put a person in almost every beat — a reel of empty places is a catalogue, and nobody finishes a catalogue. Describe them the way a photographer would brief a subject, in FIVE concrete parts: an age band and build, ONE garment named by fabric and cut, ONE accessory or tool they are actually using, what their hands and body are DOING, and which side of their face the light falls on. "a wiry man in his fifties, oil-stained canvas coveralls, a pipe wrench braced against his hip, hauling the valve handle over with both arms, low sun raking his right cheek" — not "a worker near the valve". FACES ARE WANTED, lit and visible, in profile or three-quarter, absorbed in the work. That is not the same as facing the lens: nobody turns to camera and nobody speaks, because a figure swinging to the lens mouthing nothing is the clearest tell that the footage is generated. Anonymous and period-accurate — the clothes, tools and haircuts of that place and year. Never corpses, the dying, injuries, blood or victims in distress: for a death beat, shoot the absence — the empty doorway, the cold fire pit, the boots by the bed. Never the face of a real named individual; give that person their hands, back, instrument or seat instead. Never children in danger.
- SCALE: one aerial or wide beat shows the full scale of the event; one human-scale beat stands inside it with a person in frame.
- Every image reads as a document of the event, not an illustration of it: name ONE motivated light source WITH a direction, keep shadows honest, and include ONE concrete wear or imperfection detail (chipped, rusted, water-stained, a bent sign, condensation) OR one physical atmosphere fact (rain, ash haze, spray, steam, smoke, dust in the air, backlight through a gap, lamplight in rain). Clean, airless surfaces read as renders.
- Compose off-centre and truthfully — include a real wall, edge, corner or horizon. Dead-centre subjects, everything-in-focus and seamless gradient backgrounds are the machine tells.
- Shot grammar by role: hook = the closest, most visually extreme evidence of the anomaly in progress, never a generic establishing landscape and never paperwork; setup = the ordinary world with its people in it; escalation and turn = change scale or focal plane only when the contrast clarifies the evidence; reveal = the clearest physical or procedural explanation; kicker = a concrete final image that can visually rhyme with the hook.
- Subject, composition and photographic facts only. No style words, no prestige adjectives, no director names, no booru tags, no weighted parentheses, no captions or labels. The style prefix is prepended automatically.

MOTION — motion_prompt per beat:
- Under 30 words. Describe motion ONLY — never re-describe the frame, its subject, lighting, geography, era or composition.
- EVERY BEAT MOVES SOMETHING IN THE FRAME. Name a physical event: what shifts, gives way, spreads, spills, is hauled, is braced against. A beat whose only movement is the camera is a photograph with a pan over it, and that is the single clearest sign the footage is generated.
- Lead with the SUBJECT, and put it in the first four words. "The span ripples along its full length" — then, only if it helps, "camera cranes up".
- A PERSON DOING SOMETHING is the most legible action available. Hands hauling, shoulders bracing, an arm shielding a face, a body leaning into weight, a head turning away from heat. Use people for the beats where the event itself is too slow or too large to read.
- ONE physically plausible motion event per beat. If the action is complex, that is a story problem: split the beat.
- THE HOOK MOVES MOST: the hook beat carries the strongest subject motion in the video. A drifting still in the first two seconds and the viewer is gone.
- The camera is OPTIONAL and always secondary. Name it only when the move does narrative work, and then at most ONE cue per beat. No camera clause at all is better than a decorative one.
- Camera vocabulary when you do use it, each with the reason: push-in (pressure), pull-back (isolation, reveal of scale), crane up (scale release), crane down (descent into detail), tilt up or down (reveal), pan left or right (lateral survey), tracking (follows a moving subject), orbit (inspection — the object IS the fact), macro glide (texture — the surface is the evidence), rack focus (attention shift between two named details), handheld (documentary instability).
- Use each substantive motion verb at most once in any two neighbouring beats. Prefer a plain verb over a forced synonym.
- Do not ask for a static or tripod-locked frame. Stillness is only ever right when the documented evidence IS the stillness, and then say what is still and why.
- Never use cuts, transitions, extreme slow motion, time-lapse, reverse, morphing or conflicting simultaneous actions. Nobody in frame turns to face the camera or speaks. The fixed negatives are appended server-side.

STYLE — style_prefix (one reusable line for THIS story):
- Build it from this exact skeleton, filled for this story:
  "documentary evidence photograph, [CAPTURE MEDIUM from the table below], [explicit real geography: region, architecture, vegetation, soil], [ONE signature light: source + direction + colour], honest shadows, real surface wear, vertical 9:16 composition, cinematic."
- Pick exactly ONE capture medium. Never mix eras or media.
- The medium follows the era of the EVENT, not the mood. A twenty-twenties story shot on Autochrome is a lie, and the channel promise is truth.
- COLOUR, always. Every frame is in full natural colour: never black-and-white, monochrome, sepia-only, greyscale or desaturated, and never a fade to black or white. A colourless frame reads as a photo montage and the viewer swipes. Old stories use the period's COLOUR process from the table, not a monochrome one.

| Era of the event | Capture medium line |
|---|---|
| pre-1900 | hand-tinted albumen print, warm muted colour wash, soft optics, tunnel vignette |
| 1900–1935 | Autochrome colour plate, soft pointillist grain, muted pastel colour, warm cast |
| 1936–1965 | early Ektachrome colour slide film, gentle saturation, cool shadows, warm highlights, fine grain |
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
- overlay_hook — the on-screen version, maximum 8 words and 80 characters, no terminal punctuation. It may attack a different angle than the spoken hook; that is a feature. It must not restate the narration verbatim and must not spoil the reveal.
- evidence_stamp — the place and date as they would be typed on a case file, uppercase, MAXIMUM 48 CHARACTERS, e.g. PLACE, COUNTRY — MONTH YEAR. Abbreviate the region rather than exceed the cap — province and state names shorten to their usual initials, and the country drops when the region already places it. Keep the year in digits here: this one is read on screen, never spoken.
- exhibit_tag — optional, only on a map or diagram beat: a short uppercase tag of two or three words, maximum 24 characters.
- title — specific, not clickbait.
- tiktok_caption — first line under 100 characters, a curiosity gap that does NOT spoil the reveal, then 3-5 relevant hashtags.
- music — genre EXACTLY one of: {{music_genres}}. Music is added inside TikTok when posting, so this is advice for the producer: pick for the story's emotional register, not its era. search_terms: 2-4 short phrases a producer can type into TikTok's sound search, describing energy and texture rather than a song. note: optional, one line on tempo and where the music should release.

Respond with ONLY the JSON object.
