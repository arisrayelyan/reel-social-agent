# Micro-doc Pipeline — Learnings

Session date: 29 August 2026
First episode: Lake Nyos, 1986

---

## 1. Model landscape (verify before each build, this moves monthly)

Blind-vote Elo, image-to-video with audio, Artificial Analysis:

| Model | Elo | $/min 1080p |
|---|---|---|
| MiniMax H3 Max (fal post-train) | 1202 | 2.40 |
| Seedance 2.0 720p | 1190 | 9.07 |
| MiniMax H3 | 1184 | 7.80 |
| Gemini Omni Flash | 1179 | 6.00 |
| Veo 3.1 | 1085 | 24.00 |

**Ranks 1 to 4 are statistically tied.** Brand recognition drives most public "best AI video" lists, not measured quality. Veo 3.1 costs 10x H3 Max and loses the blind vote.

Facts with a shelf life:

- **Sora is dead.** Web and app discontinued 26 Apr 2026. API shuts 24 Sep 2026.
- **MiniMax H3 open weights are a licensing trap.** Community License excludes US, EU, UK, South Korea from Applicable Territory — traces to Disney / Universal / WBD litigation. Armenia not excluded, but shipping to EU/US customers needs legal review of Sections I.3, I.5, V.4. Downloadable package is H3-Base 768p only; Context-IR and 2K regeneration stay hosted. Orgs above $20M revenue need written authorization.
- **Seedance 2.5** launched 31 Jul 2026 via Jimeng/Doubao. BytePlus ModelArk endpoint still not GA. Available on fal.
- **Wan 3.0 is API-only.** Alibaba stopped open-weighting frontier Wan after 2.2.

## 2. Platform decision

**At 1 video/day, use a consumer subscription, not an API.**

- Dreamina (dreamina.capcut.com) ~$18/mo flat, same underlying Seedance models
- API pipeline: $250 to $750/mo for identical output

The API only makes sense at 5 to 10 videos/day or multiple channels. Paying API prices for automation you don't need at this volume is the single most expensive mistake available here.

Availability caveat: ByteDance paused global Seedance 2.0 rollout at one point over Hollywood copyright disputes; CapCut rollout went region by region. Keep fal as fallback — unaffected by those regional blocks.

Check commercial use terms on whichever tier before posting monetized content. Consumer plans often restrict commercial rights to higher tiers.

### If/when moving to API

- fal, endpoint `bytedance/seedance-2.0/image-to-video`
- `fal.queue.submit` with webhook, never `fal.subscribe` — 30 to 120s per generation, 14 in flight
- Params: `image_url`, `end_image_url` (frame chaining), `resolution`, `duration`, `aspect_ratio: "9:16"`
- Seedance 2.5 bills by token: `(h * w * duration * 24) / 1024` @ $0.0214/1k. A 6s 720p vertical clip ≈ 129,600 tokens ≈ $2.77, roughly $28/min — 3x the 2.0 flat rate. Not worth it for b-roll. Its `reference-to-video` (50 refs vs 2.0's 12) is worth it only for shots where geography keeps drifting.
- Alternatives to fal: Replicate (closest swap, ~1 day migration), Vertex AI (Veo only, but existing GCP IAM/billing/quota plus Google indemnity), direct provider APIs (cheaper at volume, 4 auth schemes, China data residency)

## 3. Image-first, always

Generate stills, then animate each one. Not text-to-video.

- **Cost** — images cost cents, video costs dollars. Iterate on the cheap artifact.
- **Speed** — image regenerates in seconds vs 30 to 120s
- **Consistency** — same lake in shot 1, 6, 12. Text-to-video gives a different lake every time.
- **Quality** — i2v outscores t2v across the board; smaller problem to solve

Exception: shots with no continuity burden (maps, close-up objects, present-day footage) can go direct.
Rough split: ~70% through images, ~30% direct.

**Last-frame chaining:** final frame of clip N as input for clip N+1 gives a continuous 12s move instead of two clips cut together. Use inside a single beat.

## 4. Image generation gotchas

Every one of these cost a regeneration cycle:

1. **Aspect ratio.** Gemini defaults 16:9. TikTok is 9:16. Set it before generating — cropping a wide aerial to vertical loses the subject.
2. **Contact sheets.** Gemini returns 4-panel grids with burned-in captions unless told not to. Add `single image, no grid, no text, no labels, no watermark`. Never crop a grid panel — resolution loss shows once the video model upscales.
3. **Wrong continent.** Default "village" output is Northern European: half-timbered, stone masonry, deciduous leaf litter, conifer forest. Any real-world story needs explicit geography in the style prefix or it fails the credibility test with anyone who searches the event afterward.

**Style prefix must be byte-identical across every shot.** That is where cross-shot consistency comes from. Copy, don't retype.

Lake Nyos prefix:
```
1986 documentary photography, West African highland region of Cameroon,
red laterite soil, adobe and mud brick buildings with thatch and corrugated
iron roofs, open grassland with scattered scrub, overcast diffuse morning
light, muted 35mm film stock, fine grain, desaturated blue and earth tones,
vertical 9:16 composition, cinematic, no text, no labels, no grid, no
collage, no watermark, no people, no conifer forest, no timber framing,
no modern vehicles.
```

## 5. Motion prompt pattern

The image carries composition, lighting, subject. **Prompt motion only** — re-describing the frame fights the input.

Required negatives, learned the hard way:

| Line | Prevents |
|---|---|
| `No cuts.` | Model inserting its own scene cuts |
| `No one turns to face the camera, no speech, no lip movement.` | The ugly AI failure: a figure swinging to the lens and mouthing nothing |
| `Absolutely no camera movement, tripod locked.` | Drift on intended-static shots |
| `Use only this image, ignore all other references.` | Bleed from other images in the tray |

**Retired 2 Sep 2026:** `No people, no animals. No hands enter frame. Faces never visible.` Those lines were the Lake Nyos corpse-safety note generalised into a channel-wide ban, and with `no people` in the style prefix they made every reel a still-life (a published reel showed paper on a desk in four of seven beats and never showed the event). People are in frame now — see docs/visual-style.md §7 for what stays banned.

**Mix 2 to 3 locked-camera shots among moving ones.** That is what stops the video reading as a drifting AI slideshow.

Dreamina UI settings, per generation:
- Model: Seedance 2.0 Mini for tests, full 2.0 for finals
- Reference mode: standard image-to-video / first frame, **not** Omni reference (costs more, unnecessary for single-still animation)
- Aspect: 9:16 · Resolution: 720P (1080P is invisible on phone, burns credits)
- Duration: set per shot, never leave at default 5s
- One image per generation. Multiple images in tray = bleed risk.

## 6. Content-safety framing

Never prompt for bodies, corpses, the dying, injuries or blood. Refused or unusable output from Gemini, and TikTok removes "dead bodies" and "the moment of someone's death" regardless of the AIGC label. `image.graphic_content` (error) enforces the word list in `GRAPHIC_CONTENT_TERMS`.

**For a death beat, shoot the absence:** empty doorway at dawn, cold fire pit, bicycle on its side, boots by the bed. Same emotional hit, zero policy friction.

**For every other beat, put people in.** Anonymous, period-accurate figures — a farmer's back turned to the paddies, hands on a rail, a face lit by the glow — are allowed and wanted (`image.human_presence` warns when no beat has one). Two hard lines remain: never the face of a real named individual (TikTok bans real likenesses; `image.named_likeness` warns when a name from the narration lands in an image prompt), and never children in danger. Every reel carries the on-screen `AI RECONSTRUCTION` tag and must be posted with TikTok's AI-generated label — realistic AIGC of a crisis event is the exact case the platform polices.

## 7. Archival footage beats generation

Two or three real public-domain stills among twelve AI shots raises credibility of the whole piece measurably. Audiences can tell.

For Nyos: USGS-hosted imagery of the red lake and the degassing pipes. Verify each file's credit line — USGS-hosted does not automatically mean USGS-authored.

Use for continuity-free shots (present-day, documents, equipment). Free and stronger than generated.

## 8. Narration

**Model:** `standard`, not default `turbo`. Only tier besides multilingual exposing `--cfg`, the main pace lever. Tags are turbo/nano only and all nine are performance mannerisms — wrong register for documentary.

**Settings that worked:**
```
--model standard --cfg 0.3 --exaggeration 0.35 --para-gap 0.6 --seed 42
```

- `--cfg 0.3` → slower and more deliberate than 0.5, **but not 137–145 wpm.** Measured on the first three published reels (2 Sep 2026, ffprobe over the beat wavs): 182, 192 and 194 wpm at cfg 0.3 / exaggeration 0.35. The claim above was wrong for this voice; Chatterbox has no rate parameter at all.
- **Pace is therefore produced after synthesis** (`services/tts/app/pace.py`): one generation per sentence with `TTS_SENTENCE_GAP_SECONDS` (0.35s) of silence between them, then the take is measured over its speech span and time-stretched with ffmpeg `atempo` (pitch preserved, floor 0.8x) down to `TTS_TARGET_WPM` (152 — a touch brisker than the 145 planning rate after listening; estimates run ~5% long). Forced alignment runs on the stretched audio. Verify for free with `pnpm tts:calibrate`. The pace parameters travel on the `/synthesize` request and sit inside the api's audio content hash, so changing them re-synthesizes instead of reusing old wavs.
- `--exaggeration 0.35` → flat and factual; 0.7+ dramatic and unstable
- `--para-gap 0.6` → real silence at blank lines. On `standard`, `...` collapses to a comma and gives no pause. Blank line (now: sentence boundary, in the service) is the only pacing tool the text has.
- `--seed 42` on every file → same narrator across all beats. Without it, timbre drifts audibly when clips sit end to end.

**One file per beat, never one long block.** Re-roll 17 seconds instead of 80, and retime individual beats against picture.

**Always normalize numbers.** `1,746` → `one thousand, seven hundred and forty six`. `CO2` → `carbon dioxide`. `50 km/h` → `fifty kilometres an hour`. `1986` → `nineteen eighty six`. "See oh two" mid-explanation kills the shot.

Dry-run every file first; each should be one chunk (under 300 chars) for zero seams.

If timbre still drifts, clone with `--voice ref.wav` — 10s, one speaker, clean. Conditionals computed once and reused, locks harder than a seed.

## 9. The wpm rule

**Beat timings must be derived from word count, not assigned first.**

Original Nyos script had three unsayable beats:

| Beat | Words | Slot | Required wpm |
|---|---|---|---|
| n01 | 17 | 3s | 340 |
| n06 | 41 | 13s | 189 |
| n07 | 27 | 8s | 202 |

Documentary pace is 135 to 150 wpm. **Divide words by 145 to get the slot.** Total length was fine (193 words ≈ 80s) — only internal boundaries were wrong.

Write script → count words per beat → derive timings → then storyboard. Doing it in the other order guarantees a rebuild.

## 10. Project structure

```
nyos/
  01_images/
  02_clips/
  03_audio/
  04_export/
  shots.json
```

Filenames zero-padded: `s01_lake_dawn_aerial.png` … `s13_degassing_pipe_jet.png`. Without padding, `s10` sorts after `s1` and CapCut breaks timeline order.

Clips carry take numbers: `s08_lake_red_water_v4.mp4`. **Never overwrite** — v2 is often worse than v1 and you don't want to pay for the regeneration again.

`shots.json` holds shot id, duration, prompt, chosen take, seed. **This is the artifact that survives a platform migration** and the thing you loop over when automating. Build it from episode one.

## 11. Cost model, validated

Per video, 13 shots, ~76s output:

| Item | Cost |
|---|---|
| Keyframes, ~2 attempts each | ~$1.20 |
| Draft pass 480p | ~$3 |
| Final pass + ~30% reshoots | $4 to $16 |
| Narration, music, edit | subscription |
| **Total** | **$8 to $20** |

Budget assumptions: **50% first-pass keeper rate**, 2 to 3 generations per usable clip.

Levers, in order of impact:
1. Final-render on H3 Max not Seedance ($7 vs $25 per video)
2. Draft at 480p before committing to 720p
3. Fewer shots — 9 or 10 with longer holds reads better than 14 and cuts 30%
4. Archival stills for 3 or 4 beats — free

**The real constraint is attention, not compute.** 2 to 3 hours per video manually × 30 = 60 to 90 hours/month. The $270 of API spend is the cheap part. Build the pipeline only when cadence is actually the bottleneck.

## 12. Next episode checklist

Lake Monoun (1984) and Lake Kivu are the planned franchise follow-ups — same research pass, same style prefix, same voice seed, same shot grammar.

- [ ] Write script, count words per beat, derive timings at 145 wpm
- [ ] Reuse the style prefix verbatim
- [ ] Reuse `--seed 42` and the same TTS flags
- [ ] Reuse motion-prompt negatives
- [ ] Identify 2 or 3 archival stills before generating anything
- [ ] Build `shots.json` first, generate second
- [ ] Test 4 shots end to end before generating the remaining 9
