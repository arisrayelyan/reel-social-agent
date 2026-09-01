Write a micro-documentary script about this true story/topic: "{{topic}}"

STRUCTURE (question → evidence → complication → answer):
- Beat roles in order: hook (0-3s contradiction), setup (establish reality + causal event), escalation (expected explanation), turn (~23s: evidence that breaks the expected explanation), reveal (the actual answer), kicker (one final verified detail / memory anchor).
- 8 to 12 beats total. The first major turn must land before ~25 seconds.

HARD RULES:
- Total narration: {{min_words}}-{{max_words}} words ({{min_seconds}}-{{max_seconds}} seconds at {{wpm}} wpm). Per-beat narration under 300 characters.
- Write ALL numbers as spoken words: "1,746" → "one thousand seven hundred and forty six", "CO2" → "carbon dioxide", "1986" → "nineteen eighty six", "50 km/h" → "fifty kilometres an hour". NO digits anywhere in narration.
- Only verified facts. If a detail is uncertain, drop it.
- The hook must be dramatic WITHOUT changing the facts.

VISUALS:
- style_prefix: one reusable photographic style line for THIS story: era-appropriate documentary photography, explicit real geography (region, architecture, vegetation, soil — never default to Northern Europe), light, film stock, muted palette, "vertical 9:16 composition, cinematic". Do NOT include negative terms; they are added automatically.
- image_prompt per beat: ONLY the subject and composition of that shot (what the camera sees). No style words — the style prefix is prepended automatically. No people or faces. Never depict bodies, corpses or victims — shoot the absence instead (empty doorway, cold fire pit, overturned bicycle, distant wide shots).
- motion_prompt per beat: ONLY camera/subject motion ("slow push-in over the water", "mist drifts left, water surface ripples"). Never re-describe the frame contents.
- camera_locked: set true on 2-3 quieter beats (static tripod shots stop the AI-slideshow feel).

Also produce: topic (short canonical form), hook (the one-line swipe-stopper), title, tiktok_caption (with 3-5 relevant hashtags).

Respond with ONLY the JSON object.
