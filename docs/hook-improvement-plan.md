# Hook & Retention Improvement Plan — reel-social-agent

Based on: [Admove social media hooks guide](https://www.admove.ai/blog/social-media-hooks-guide), [Nicola Washington — A Writer's Guide to Writing Hooks](https://nicolawashington.substack.com/p/a-writers-guide-to-writing-hooks), audited against `prompts/`, `api/src/utils/storyPost.ts`, `shared/src/constants.ts`, `shared/src/schemas/story.ts`, `services/captions/`, and the pipeline steps.

## 1. What the articles say, condensed to what matters for us

- 70%+ of viewers decide in the first 3 seconds; ~70% completion rate is the viral distribution threshold. The hook is not decoration, it is the product.
- Hooks are three simultaneous modalities: **text** (overlay, under 8 words, high contrast, center frame), **visual** (pattern interrupt in the first frame, mid-action, unexpected imagery), **audio** (contrast, sound triggers, mid-sentence starts). TikTok/Reels reward visual+audio, text overlay compounds both.
- Seven reusable hook types: curiosity, story, problem/pain, controversial, list/number, value/benefit, question. Loss-aversion framing outperforms positive framing (~2x).
- The three quality requirements: **immediacy** (under 3s), **truthfulness** (bait-and-switch kills retention and trust permanently), **specificity** (concrete detail beats vague promise).
- Nicola's weak→strong pattern: a strong hook = specificity + emotional resonance + curiosity gap, aimed at a named audience. "5 tips for better sleep" → "These soothing pre-bedtime rituals will get you deep sleep."
- Hook–Value–Action: the body must pay off the hook's exact promise; testing (same content, different hooks, retention decides) beats formulas.

## 2. Audit: where we already comply, where we don't

Already strong (keep, don't touch):

- Verbal hook rules in `prompts/story.user.md` are genuinely good: ≤10 words, impossibility in the first 3–4 words, three concrete forms, no date openers. This matches the curiosity/contradiction hook types.
- Structure (hook → setup → escalation → turn ~23s → reveal → kicker) is a correct open-loop retention arc.
- Kinetic word-highlight captions, truthfulness culture ("never promise what the story cannot deliver"), hook-specific shot grammar (closest, most impossible image).

Gaps, ranked by impact:

1. **No text-hook overlay.** The `hook` field goes to the DB and UI only. On screen, the first 3 seconds show lower-third captions of the narration — nothing center-frame. Both articles treat the text overlay as the highest-leverage element on TikTok/Reels. This is the single biggest miss.
2. **One hook per story, no variants, no testing.** Both articles say hook selection is empirical. We generate exactly one and never compare.
3. **No mechanical hook validation.** `StorySchema.hook` is `min(5)` chars. The ≤10-word rule, digit ban, date-opener ban, and front-loading rule live only in the prompt; `postProcessStory` never checks them.
4. **No truthfulness gate.** The rule exists as prose, but nothing verifies the hook's promise is paid off by the reveal beat.
5. **Hook type diversity is narrow.** The prompt allows only 3 forms (all curiosity/contradiction variants). No loss-aversion framing, no question hooks, no story hooks ("A year ago X. Now Y."). Channel-level, every video opening the same way is itself a pattern viewers learn to skip.
6. **No audio hook.** Narration starts cold (good) but there is no sound design, no music bed, no audio contrast. The research report itself calls for a "quiet tension/curiosity bed."
7. **No mid-video re-hook.** One open loop at 0s, resolved at ~40–57s. Retention graphs sag without a second loop.
8. **Caption first line for TikTok is prompted but unvalidated** (fold length, spoiler check).

## 3. Improvements

### Phase 1 — Text-hook overlay (highest impact, cheap)

The hook must exist on screen in the first frame, center frame, before any caption.

- `shared/src/schemas/story.ts`: add `overlay_hook: z.string()` to `StorySchema` — the on-screen version, **max 8 words** (Admove's overlay rule; the spoken hook keeps ≤10). It is allowed to differ from narration — text and voice hitting different angles is a feature, not a bug.
- `services/captions/src/remotion/CaptionedReel.tsx`: new `HookOverlay` component — center frame, ~88px, same stroke treatment as captions, visible from frame 0 to ~2.2s, quick fade/scale-out so it clears before the turn of beat 1. Suppress the lower-third caption group while the overlay is up (two competing text blocks in second 1 is noise).
- `api/src/pipeline/steps/captions.ts` + `api/src/clients/captions.ts`: pass `overlay_hook` through to the Remotion props and include it in the caption step's `content_hash` inputs — a changed overlay re-renders captions only (~cheap), not clips. This is exactly what makes Phase 3 A/B testing affordable.
- `prompts/story.user.md`: add the `overlay_hook` requirement: ≤8 words, no punctuation soup, must NOT restate the narration verbatim, must not spoil the reveal.

### Phase 2 — Hook variants + mechanical validation

- `prompts/story.user.md`: require a `hook_variants` array of 5 candidates, each tagged with a type from a fixed enum: `contradiction`, `impossible_image`, `certainty_destroyed`, `question`, `loss` ("Everyone in this valley made the same fatal assumption"), `story` ("One morning, every telegraph in Europe woke up on its own"). Keep the existing 3 forms and add the last three. The final `hook` field is the LLM's pick; the rest are stored for the producer and future testing.
- `shared/src/schemas/story.ts`: `hook_variants: z.array(z.object({ text, type }))` on `LlmStorySchema`/`StorySchema`.
- `api/src/utils/storyPost.ts` — add `validateHook()` producing warnings (same pattern as the digit check):
  - word count > 10 (spoken) / > 8 (overlay)
  - contains digits
  - `/^(in |on |at exactly|the year)/i` date-opener pattern
  - impossibility front-loading heuristic: warn if the first 4 words contain none of the tension markers (negation, "no/never/still/shouldn't/impossible/killed/vanished/wrong", a contradiction pair) — a soft warning, the producer decides
  - overlay identical to the first beat's narration opening (wasted modality)
- `frontend/src/pages/VideoDetailPage.tsx`: show the variants as radio options during `story_review` so switching the hook is one click, not a change-request round-trip.

### Phase 3 — Truthfulness gate (Hook–Value contract)

Both articles say a broken promise is worse than a weak hook.

- Add a cheap LLM self-check call after story generation (Ollama tier is fine): "Given this hook and this reveal beat, does the story fully deliver the hook's promise? Answer JSON `{delivers: bool, gap: string}`." Surface `delivers: false` as a blocking warning in story review. One extra local call, zero render cost.
- Add to `prompts/story.system.md`: "The reveal beat must answer the hook's promise **literally**, not approximately. If the hook says 'silently', the reveal must address the silence."

### Phase 4 — Prompt-quality upgrades (no code) — DONE 2 Sep 2026

Implemented in `prompts/story.user.md` with prompt-contract tests: weak→strong pairs (`HOOK_UPGRADE_PAIRS`, rotated and leakage-checked like the form examples), the specificity rule, the loss-framing nudge, the re-hook rule on the first turn, a human-presence rule (a specific person in the first two beats) and a sensory-beat rule. The original notes follow.

All in `prompts/`:

- **Weak→strong few-shots** (Nicola's core teaching device) in `story.user.md` and `topics.user.md`: 3 pairs showing generic topical hook → specific + emotional + curiosity-gap hook. Few-shot pairs move LLM output far more than rules do.
- **Specificity rule**: the hook or overlay should carry one concrete, sensory or numeric-as-words detail ("nineteen hundred cattle" beats "the animals").
- **Loss framing nudge**: when a story has a victim/cost angle, prefer loss-framed phrasing over neutral description.
- **Audience relevance line** in `topics.system.md`: score candidate topics on "would a 20-year-old with zero context feel this in the first sentence" — kills insider-y topics early, where they're cheapest to kill.
- **Re-hook rule** in `story.user.md`: the `turn` beat must open a *second* explicit question in its narration ("So what was actually under the lake?" style, as a statement), not just present evidence — one open loop at 0s and a second at ~23s covers the retention sag.
- **tiktok_caption**: enforce first line ≤ 100 characters (pre-fold), and add the same no-spoiler check to `validateHook()` warnings (substring match against reveal-beat keywords is enough for a warning).
- **Kicker loop**: add "the final frame and first frame should be visually rhymable (loopable): the kicker's last sentence may echo the hook's noun" — seamless loops inflate completion rate, the metric the algorithm actually pays.

### Phase 5 — Audio hook + music bed — SKIPPED BY DECISION (2 Sep 2026)

Music is added in TikTok at post time, so the pipeline stays silent under narration. The notes below are kept for reference only.

- New optional pipeline step `music` between `merge` and `captions`: a quiet tension bed under narration, ducked with `sidechaincompress`, from a small licensed/CC0 library keyed by story mood — start with 2–3 fixed tracks, env-configured, hash-keyed like every other step. No generative audio needed.
- Audio hook experiment: start beat 0 narration at 0.0s (already the case) and consider a single sub-second sound trigger (low boom/riser) under the overlay. Gate behind a setting; measure before adopting.

### Phase 6 — Measurement (when TikTok publish unparks)

- Persist `hook_variants` + chosen hook per publication; when the TikTok phase activates, pull retention/completion per video and correlate hook type → completion. The overlay re-render path from Phase 1 makes same-video/different-hook tests nearly free (captions re-render only, no fal/Gemini spend).
- Until then: the story-review radio buttons (Phase 2) at least capture *which* variant a human judged strongest — that's labeled training data for prompt iteration.

## 4. Suggested order and effort

| Phase | What | Effort | Render cost impact |
|---|---|---|---|
| 1 | Overlay hook in Remotion + schema | ~half day | none (captions re-render only) |
| 2 | Variants + `validateHook()` + review UI | ~half day | none |
| 3 | Truthfulness gate | ~2h | none (local LLM) |
| 4 | Prompt upgrades | ~2h, no rebuild | none |
| 5 | Music bed | ~1–2 days | negligible |
| 6 | Retention loop | with TikTok phase | — |

Phases 1–4 are one focused day and touch nothing in the expensive part of the pipeline (fal/Gemini). Do 4 first if you want zero-code wins today — the prompt files hot-reload in dev.

## 5. What NOT to do

- Don't add clickbait tolerance. Both articles and YouTube/Meta policy point the same way: a hook the story can't cash burns the channel. The truthfulness gate matters more than any single stronger hook.
- Don't put the overlay in the image prompts (text in generated frames violates the `no text` suffix for good reason — AI text renders garbled). Text belongs in the Remotion layer only.
- Don't chase trending-audio mechanics — wrong fit for a narrated documentary format; the music bed is enough.
- Don't loosen the ≤10-word hook rule to fit more "value" in. Immediacy beats completeness in second one; the setup beat exists for the rest.
