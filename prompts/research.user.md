Find {{count}} true-story candidates for one-minute micro-documentaries.
{{focus_block}}
For EACH candidate return:
- topic — the canonical event, with place and year.
- hook — one spoken line, maximum 10 words, the concrete anomaly inside the first four words. Never claim more than the evidence supports.
- year — the year of the event as a number, or null if it spans years.
- place — country or region.
- summary — two or three sentences of verifiable facts. No adjectives that are not facts.
- money_shot — the single moment a camera would have caught IN PROGRESS, at scale: what is moving, what it is doing to what. If you cannot name one, the story is not a candidate.
- turn — the one documented fact that kills the obvious explanation, and the literal mechanism that replaces it.
- kicker — one verified final consequence, measurement, decision or present-day detail.
- source_url — ONE primary article or source you are confident exists: the Wikipedia article, an official report, a newspaper archive page, a paper. source_title — its title.
- scores — your honest 1 to 5 on each axis below.
- risk — none, low or high, and risk_note when not none.

SCORING AXES (a 5 means):
{{rubric_block}}

HARD REJECTS — do not propose:
- Anything that hinges on a living public figure, or whose reveal is WHO a named person is (real faces cannot be shown).
- Anything only tellable through corpses, the dying, injuries, blood or children in danger. A death can be in the story; the death cannot be the picture.
- A recent or ongoing crisis event, where a realistic reconstruction could mislead people about something still unfolding.
- Stories whose only evidence is paperwork, and stories that need background before the anomaly lands.
- Urban legends, hoaxes, and anything a fact-checker has already knocked down.

SPREAD: vary the shape of the anomaly across the set — a conflict between two verified facts, an impossible image, a certainty destroyed, a consequence stated first, an ordinary system behaving abnormally once, a strange documented human decision, an evidence question. Vary era and region; never default to Northern Europe. Do not hand back a list where every hook opens the same way.
{{catalogue_block}}{{feedback_block}}
Respond with ONLY this JSON object:

{
  "candidates": [
    {
      "topic": "...",
      "hook": "...",
      "year": 1975,
      "place": "...",
      "summary": "...",
      "money_shot": "...",
      "turn": "...",
      "kicker": "...",
      "source_url": "https://...",
      "source_title": "...",
      "scores": { "visual": 1, "hook": 1, "turn": 1, "verifiable": 1, "people": 1, "novelty": 1 },
      "risk": "none",
      "risk_note": null
    }
  ]
}
