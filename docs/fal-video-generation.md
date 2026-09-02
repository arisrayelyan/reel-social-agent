# fal.ai video generation — instructions for the reel pipeline

**Sources:** [fal-ai-community/skills](https://github.com/fal-ai-community/skills) (all 20 skills read: genmedia, model-routing, fal-models-catalog, fal-prompting/Kling+GPT-Image-2+Happy-Horse, cinematography, storytelling, fal-recipes incl. realism + video-with-audio + narrated-documentary, fal-workflow, ugc, commercial, character-design) and [How to generate videos with AI](https://fal.ai/learn/tools/how-to-generate-videos-with-ai) (fal Learn, 2026). Distilled against our pipeline (`clients/fal.ts`, `steps/clips.ts`, `storyPost.ts`, `prompts/story.user.md`).

**Status of our current rules:** the fal community skills independently confirm our two hardest-won rules — motion-only prompts for image-to-video ("the reference frame already carries identity, wardrobe, lighting; don't re-describe the still, describe motion only" — verbatim in both the Kling and Happy Horse guides) and per-beat i2v from approved stills as the maximum-continuity route for narrated sequences (the "narrated documentary" recipe is exactly our architecture: scene table → TTS → per-scene clips → join → subtitles). Nothing below contradicts pipeline-learnings; this doc extends it.

## 1. Model routing (September 2026)

fal's own routing order for premium image-to-video, per `model-routing` and the Learn article:

| Tier | Endpoint | Notes |
|---|---|---|
| Premium default | `bytedance/seedance-2.0/image-to-video` | best physics/motion, native audio, up to 15s, $0.30/s @720p (audio priced in), $0.68/s @1080p |
| Premium draft | `bytedance/seedance-2.0/fast/image-to-video` | $0.24/s, lower latency, slight quality trade |
| Alternates | `fal-ai/kling-video/v3/pro/image-to-video`, `fal-ai/veo3.1/image-to-video`, `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | Kling for control, Veo for 4K + native lip-sync ($0.20/s no audio) but adds SynthID watermark |
| Cheap draft | `xai/grok-imagine-video/image-to-video` | motion previews, economical |
| First/last frame | `fal-ai/kling-video/o1/image-to-video` (`image_url` + `tail_image_url`), `fal-ai/veo3.1/first-last-frame-to-video`, `fal-ai/wan-flf2v`, `fal-ai/vidu/start-end-to-video` | controlled transitions between two stills |

Rules for us:

- Our current `minimax/h3-max/image-to-video` stays the env default until we A/B it; `FAL_VIDEO_MODEL` already makes switching a one-line change, which is exactly the iteration pattern the article recommends ("one-line switch to test models without code rework"). Candidates to trial in order: Seedance 2.0 fast → Seedance 2.0 → Kling v3 pro.
- **Never invent endpoint IDs and never trust remembered schemas.** Field names differ per family (`duration` int vs enum, `resolution` vs `image_size`, `negative_prompt` present or absent). Before pointing `FAL_VIDEO_MODEL` at a new endpoint, fetch its schema: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`, or `genmedia schema <id> --json` if the CLI is installed. A guessed field is a 422.
- Check pricing before switching (`genmedia pricing <id> --json`). Seedance 2.0 at $0.30/s makes a 10-beat reel ~$18 in clips alone versus ~$2.40 on the current model — a premium-model render must be a deliberate choice, not a default.

## 2. Two-tier rendering: draft cheap, finalize once

The single strongest operational pattern across the article and the skills: **shape prompts at the cheap tier, pay for quality once.**

- Add `FAL_VIDEO_MODEL_DRAFT` (Grok Imagine or Seedance fast) next to `FAL_VIDEO_MODEL`. Render the first pass of every beat on the draft model; during render_review the producer rejects/regenerates on cheap takes; only approved beats re-render on the premium model. Our take system (`_v2`, `_v3`) and content-hash idempotency already support this — the hash includes `model`, so a model switch naturally produces a new take.
- Same logic for resolution: stay at 720P-class while iterating, request higher only for the final take, if the chosen endpoint prices by resolution.
- **Seed discipline** (article + Kling guide): when an endpoint exposes `seed`, record it in `generation_runs.output` on every clip. Reproducing a good take with one changed variable requires the seed; without it every retry is a fresh lottery. Change one axis per retry — motion prompt OR seed OR duration, never several at once ("one controlled variable per iteration" is a universal rule in fal-prompting).

## 3. Motion prompt rules (validated + additions)

Confirmed by the skills, keep as is: motion-only prompts, fixed negative block appended server-side, `camera_locked` beats, each motion verb used once per video, subject motion in ≥4 beats.

Additions from the Kling / Happy Horse / Learn guides:

- **Under 30 words per motion prompt.** Both Kling and Happy Horse degrade beyond that; Happy Horse's whole contract is ~20 plain-English words. Add a warning in `postProcessStory` when `motion_prompt` exceeds ~30 words.
- **One camera cue maximum per shot.** "Slow push-in while craning up and orbiting" forces the model to drop instructions or mush them. Our unique-verb rule mostly enforces this; make it explicit in `story.user.md`.
- **An unspecified camera defaults to a flat slow zoom** (article). Every non-locked beat's motion prompt must name the camera behavior explicitly, even if it is "camera drifts slowly right"; locked beats already get the tripod line.
- **Physically plausible motion only.** Kling is "conservative with implausible physics" and every family struggles with extreme slow motion and conflicting simultaneous actions. One motion event per beat; complex action is a story problem (split the beat), not a prompt problem.
- **Concrete negatives beat vague negatives.** Where a new endpoint exposes `negative_prompt`, pass `MOTION_NEGATIVES` there instead of appending to the prompt — check the schema; some families ignore in-prompt negation entirely.
- **No booru tags, weighted parentheses, or director-name references** on any family. Plain declarative English.
- Motion verb vocabulary worth adding to the prompt template's examples (from the cinematography skill): pull-back (isolation/reveal), crane up (scale release), macro glide (texture), orbit (inspection), rack focus (attention shift between two details) — each mapped to a narrative purpose, which fits our beat roles.

## 4. Image (keyframe) prompt upgrades

Our style prefix + shot-type-first subject prompts are sound. Three upgrades from the realism recipe and SCLCAM order:

- **Name the light source with a direction, per beat.** "Overcast diffuse natural light" in the global prefix is uniform by design, but the realism recipe is emphatic: one primary source with a direction sells the frame ("sodium-vapor lamp directly above, hard shadows under the brim"). Our per-story `style_prefix` already carries the signature lighting contrast; allow beat image prompts to add one light-direction clause without violating the byte-identical prefix rule (it's subject/composition text, same as now).
- **Imperfection budget.** The anti-AI-look checklist: real surfaces carry wear. Prompts that name two concrete imperfections (chipped tiles, dust in the light shaft, a bent sign, condensation) read as photographs; clean surfaces read as renders. Add to `story.user.md` cinematography section: each image_prompt should include one concrete wear/imperfection detail.
- **Two-axis style: genre × era/stock.** The realism recipe treats "what kind of photo" and "when/on what captured" as independent axes and warns that mixing two eras produces the AI look. Our style_prefix asks for "era-appropriate documentary photography + film stock" — good; make the rule explicit: exactly one genre, exactly one era/stock, never two. The recipe's stock cues (Portra 400 warmth, Tri-X grain, Kodachrome saturation, 1970s faded-paper cast) are a ready vocabulary for story-specific prefixes.
- The checklist's composition tells also apply: dead-center composition, everything-in-focus, seamless-gradient backgrounds are AI tells — off-center subjects, a named focal plane, and real walls/corners in the prompt counter them.

## 5. Continuity between beats: frame bridging and first/last-frame

Two patterns from fal-workflow we don't use and should consider:

- **Frame bridging** for beats that continue one scene: extract the last frame of clip N (we have ffmpeg; fal also has `fal-ai/ffmpeg-api/extract-frame`) and use it as the keyframe for beat N+1 instead of generating an independent still. Kills the "AI slideshow of unrelated postcards" feel on escalation→turn pairs that share a location. Cheap to pilot: it's a keyframe-source change, not a pipeline change.
- **First/last-frame endpoints** for the two or three beats where motion must land on a specific image (the reveal, the kicker's loopable final frame): generate the end frame by *editing* the start frame (nano-banana edit — we already have Gemini; "create the end frame by editing the start frame, not independent generation"), then drive Kling O1 / Veo FLF with both frames and a transition-only motion prompt ("degrees, directions, distances, and speed rather than vague movement"). This gives us a deterministic final frame — which the hook-improvement plan wants for the loopable kicker.

Both fit the existing per-beat asset model; each is a new optional keyframe/clip source behind env config.

## 6. Audio: the biggest unexploited capability

The 2026 generation of video models (Seedance 2.0, Veo 3.1, Happy Horse) generates audio natively, simultaneously with frames — and the article's rule is "write audio into the prompt or the model decides for you." Our pipeline strips/ignores clip audio entirely and runs silent visuals under TTS narration. Options, in order of fit:

1. **Keep clips silent (current), add a generated ambience pass with `fal-ai/mmaudio-v2`**: video + text prompt → same video with synchronized ambient/foley ("wind over a dead valley, distant water"). Fits as the optional `music` step from the hook plan — run it on the merged video before captions, duck it under narration with `sidechaincompress`. Non-deterministic; the recipe says run 2–3 and pick. This is the cheapest path to a sound bed that tracks the visuals.
2. **Native-audio clips**: if we move to Seedance 2.0, add one ambience clause per motion prompt and keep the clip audio at low mix weight under narration (`amix`), instead of stripping it. More organic foley per beat, but per-beat audio joins are more mixing work and the TTS still owns the timeline.
3. Music generation (`fal-ai/elevenlabs/music`, `cassetteai/music-generator`, `fal-ai/stable-audio-25`) for a tension bed as an alternative to a licensed library.

Whichever path: narration loudness always wins the mix; ambience is a bed, never a competitor (the video-with-audio recipe's quality bar: "SFX volume does not drown narration").

Also worth knowing: fal hosts Chatterbox itself (`fal-ai/chatterbox/text-to-speech/multilingual`) — a fallback if the local TTS service wedges again, same voice family, no local model load. And ElevenLabs eleven-v3 / Minimax speech-2.8-hd are the premium TTS tier if we ever want a voice upgrade; forced alignment still applies since we know the text.

## 7. Prompting habits from the Learn article worth encoding

The article's six habits, mapped to us:

1. *Described scene, not keywords* — already our rule (subject prompts are sentences, not tag lists). Keyword dumping produces "static with slight drift".
2. *Camera as direction* — encode the "no unspecified camera" rule from §3.
3. *Audio in the prompt* — only relevant if/when we adopt a native-audio model (§6).
4. *Dialogue in quotes* — N/A for us (no dialogue; narration is TTS).
5. *Shot-by-shot for longer scenes* — we already beat-split; never try to cram two beats into one generation ("cramming conflicting actions forces the model to drop some").
6. *Light and color as mood* — our style_prefix; keep one grade per video.

And its workflow loop, which matches §2: draft on fast tier at low res → vary seed with a constant prompt → refine camera/light language → final render on standard tier.

## 8. Concrete change list

| # | Change | Where | Effort |
|---|---|---|---|
| 1 | `FAL_VIDEO_MODEL_DRAFT` + draft-first render, premium re-render on approval | `config.ts`, `clips.ts`, review UI | ~1 day |
| 2 | Record `seed` (and full request input) in `generation_runs`; expose "retry same seed / new seed" | `fal.ts`, `clips.ts` | ~2h |
| 3 | Motion prompt validators: ≤30 words, explicit camera clause on non-locked beats | `storyPost.ts` warnings | ~1h |
| 4 | Prompt template: one camera cue max, plausible-physics line, imperfection detail per image prompt, genre×era single-choice rule | `prompts/story.user.md` | ~1h, no rebuild |
| 5 | Frame-bridging keyframe source for same-scene consecutive beats | `images.ts`/`clips.ts`, opt-in per beat pair | ~1 day |
| 6 | First/last-frame clip route for reveal + kicker (deterministic loopable end frame) | new client method + schema check | ~1 day |
| 7 | mmaudio-v2 ambience pass on merged video, ducked under narration | new optional pipeline step | ~1 day |
| 8 | Schema+pricing check script for any `FAL_VIDEO_MODEL` candidate before adoption | small script or README note | ~1h |

| 9 | Per-model cost-per-second map (replaces single `FAL_COST_PER_SECOND_USD`) so draft/premium tiers report honest costs | `config.ts`, `fal.ts` | ~1h |

Order: 3+4 first (free quality), then 2, then 1+9 (cost control unlocks premium-model experiments), then 6 (pairs with the hook plan's loopable kicker), then 5, then 7.

## 9. Cost optimization (compiled — no dedicated skill exists)

There is no cost-optimization skill in the repo; this section compiles every cost rule scattered across genmedia, model-routing, the Kling guide, the catalog, and the Learn article.

- **Check pricing before adopting any endpoint** — `genmedia pricing <id> --json` or the fal model page. The genmedia reference warns explicitly: some endpoints (GPT Image 2 at `quality=high`, Seedance Pro at long durations) are **an order of magnitude** more expensive than alternatives. A 200 on a test call proves nothing about unit economics.
- **Every video family ships a cheap tier — route drafts there.** Kling Standard is ~2x faster at ~half the cost of Pro ("use Standard when iteration count matters more than per-frame quality"); Seedance has `/fast/` variants ($0.24/s vs $0.30/s); Grok Imagine is the economy bucket; Veo has `/lite`. The rule everywhere: draft on the cheap tier, pay premium exactly once per approved beat — this is change #1 in §8 and the single biggest lever on our per-reel cost.
- **Duration is the cost multiplier.** Video is priced per second, and longer requests also "risk drift" (Kling guide). Our `ceil(audio)+1` request is already minimal — protect it: any warning from §3 that pushes a beat's narration longer directly buys more clip-seconds. The 145 wpm envelope is a cost control, not just pacing.
- **Resolution: iterate at 720P-class, upgrade only the final take** (article: $0.30/s → $0.68/s for Seedance 720p→1080p). Our fixed `768P` is right for drafts; make resolution part of the premium re-render config, not a global constant.
- **Audio toggle changes price on some families** (Veo: $0.20/s silent vs $0.40/s with audio; Seedance: same price either way). If we stay silent-clips + TTS, prefer endpoints where audio-off is cheaper, or explicitly disable audio in the request when the schema supports it — paying for generated audio we strip in merge is pure waste.
- **Never burn premium image models on drafts.** For stills the same tiering exists: `flux-2/klein/9b` for exploration, nano-banana-2 as the cheaper premium step, GPT Image 2 `quality=high` reserved for frames where typography or maximum realism is the point ("treat as expensive. Do not use it for cheap drafts" — model-routing). Maps to us: keyframe retries during story iteration could go through a cheap draft image model before the Gemini/premium take.
- **Idempotency is cost control.** Our content-hash skip-if-exists already prevents double-paying for unchanged inputs; the seed recording from §2 extends that to retries (reproduce instead of re-explore). Also keep the resumable `request_id` polling — a crashed worker resuming a poll costs $0; a resubmission costs the full clip.
- **Variants: fan out cheap, not premium.** The realism recipe generates 2–4 variants because "realism is partly luck of the seed" — do that on the draft tier and promote one, never generate N premium takes to pick from.
- Our own cost plumbing (`costUsd` per asset, `addVideoCost`, `FAL_COST_PER_SECOND_USD`) already tracks spend per video; when adding `FAL_VIDEO_MODEL_DRAFT`, add a per-model cost-per-second map so the dashboard numbers stay honest across tiers.

## 10. Hard don'ts (cross-family, from every source)

Prestige adjectives ("stunning, cinematic, masterpiece") are a signal the prompter doesn't know what to ask for — replace with photographic facts. No stacked color/synonym lists. No re-describing the keyframe in a motion prompt. No two camera moves in one shot. No extreme slow motion. No relying on generated in-frame text (our `no text` suffix is correct; overlay text belongs in the Remotion layer). No assuming clip length equals requested length — measure with ffprobe, always (already law here). No model choice from memory — schema and pricing first.
