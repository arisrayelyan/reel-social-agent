Write a micro-documentary script about this true story/topic: "{{topic}}"

STRUCTURE (question → evidence → complication → answer):
- Beat roles in order: hook (0-3s contradiction), setup (establish reality + causal event), escalation (expected explanation), turn (~23s: evidence that breaks the expected explanation), reveal (the actual answer), kicker (one final verified detail / memory anchor).
- 8 to 12 beats total. The first major turn must land before ~25 seconds.

THE HOOK (this decides whether anyone watches):
- narration of the hook beat AND the "hook" field: maximum 10 words, and the impossibility must arrive in the first 3-4 words.
- Use one of these forms: a flat contradiction ("A lake killed a valley. Silently."), an impossible image ("Telegraphs ran with their batteries disconnected."), or a certainty destroyed ("Everyone blamed the volcano. There was no volcano.").
- Never open with a date or "At exactly..." — dates go in the setup beat.

NARRATION — HARD RULES (read aloud by a voice engine):
- Total: {{min_words}}-{{max_words}} words ({{min_seconds}}-{{max_seconds}} seconds at {{wpm}} wpm). Per-beat narration under 300 characters.
- Write ALL numbers as spoken words: "1,746" → "one thousand seven hundred and forty six", "CO2" → "carbon dioxide", "1986" → "nineteen eighty six". NO digits anywhere.
- NO bracketed tags or stage directions — no [sigh], [pause], (laughs). The engine reads them aloud.
- Every beat ends with a complete sentence and terminal punctuation (. ! ?). Never end a beat on a comma, dash or ellipsis — it sounds cut off.
- The kicker must LAND: its last sentence is a short, closed, declarative statement with falling finality ("The lake is still loaded. Engineers vent it every single day."). Optionally follow with ONE short engagement question. Never end mid-thought or with "and then...".
- Only verified facts. If a detail is uncertain, drop it.

CINEMATOGRAPHY — image_prompt per beat:
- START each image_prompt with its shot type, then the subject: "extreme close-up of...", "detail shot of...", "interior of...", "wide shot of...", "aerial view of...", "low angle of...", "overhead view of...", "silhouette of...".
- Use at least 5 DIFFERENT shot types across the video. Never two of the same shot type back to back.
- Shot grammar by role: hook = the single most impossible-looking image, shot CLOSE or as a striking detail (never a generic wide establishing shot); setup = human-scale evidence (objects, interiors, documents, machines); escalation/turn = violent contrast cuts (macro detail against vast scale); reveal = the clearest explanatory image; kicker = a haunting, loopable final frame.
- Subject and composition only — no style words (the style prefix is prepended automatically). No people or faces. Never bodies or victims — shoot the absence instead (empty doorway, cold fire pit, overturned bicycle, stopped clock).

MOTION — motion_prompt per beat:
- Describe only motion, never re-describe the frame.
- At least 4 beats must have SUBJECT motion inside the frame (water rising, lights dying row by row, papers lifting in wind, smoke curling from cracks, needles jumping on gauges) — not just camera moves.
- Each motion verb may appear at most once across the video. "slow push-in" may appear at most once.
- camera_locked: set true on exactly 2-3 quieter beats (static tripod shots stop the AI-slideshow feel). For those, motion_prompt still describes subject motion within the locked frame.

STYLE — style_prefix (one reusable line for THIS story):
- Era-appropriate documentary photography with explicit real geography (region, architecture, vegetation, soil — never default to Northern Europe), film stock, "vertical 9:16 composition, cinematic".
- Include ONE signature lighting contrast that makes this story visually its own (a single warm window in blue dusk, aurora glow over a dead grid, orange underground fire-light against snow). Not uniformly muted.
- Do NOT include negative terms; they are added automatically.

Also produce: topic (short canonical form), hook (the swipe-stopper, ≤ 10 words), title, tiktok_caption (first line = a curiosity gap that does NOT spoil the reveal, then 3-5 relevant hashtags).

Respond with ONLY the JSON object.