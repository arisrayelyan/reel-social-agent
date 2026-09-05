You are looking at {{count}} photograph(s) that appear in the main body of an article about a real event. A story team will write image prompts for a photorealistic reconstruction of that event, and they can only use physical facts you give them.

Article: {{page_url}}

For EACH image, in order, write a description of at most 60 words made ONLY of what is physically visible:
- place and terrain: landscape, water, soil colour, vegetation, climate cues
- built things: buildings, roads, bridges, machines, vehicles, boats, tools — with materials, colours, condition and wear
- people as anonymous figures: how many, clothing by fabric and cut, what their hands and bodies are doing, posture — NEVER a name, NEVER facial features, NEVER a likeness
- light and weather: where the light comes from, its colour, shadows, haze, rain, smoke, dust
- era cues: film grain, colour cast, print damage, camera type, signage style

Mark an image `"usable": false` and leave its description empty when it is a logo, an icon, an unrelated map or diagram, a portrait whose point is a specific person's face, a screenshot of text, or anything that is not a photograph of the event or its place.

Do not interpret, do not narrate, do not guess what happened. No adjectives that are not physical ("tragic", "eerie", "beautiful"). No sentences about what the photo "shows" or "captures" — start straight with the subject.

Image captions from the page, if any:
{{captions}}

Respond with ONLY this JSON object, one entry per image, index starting at 0:

{
  "images": [
    { "index": 0, "usable": true, "description": "..." }
  ]
}
