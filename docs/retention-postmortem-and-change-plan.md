# Retention postmortem and change plan

**Date:** 3 September 2026
**Scope:** the first four published TikToks (@oneminutewtf), the reel-agent DB, and the alignment between `deep-research-report.md` / `pipeline-decisions.md` / `visual-style.md` / `hook-improvement-plan.md` and what the code actually does.
**Status:** findings are verified against data. The change plan is a proposal for review, not applied.

How to read this: §1 to §4 is what happened and why, all evidence-backed. §5 is the strategy check. §6 is the ordered change plan. §7 is what not to touch. §8 is the only research that is actually needed. §9 is how we falsify all of this. §10 reviews the working content theory and proposes the validator rules that would make it stick.

---

## 1. The data

Analytics from TikTok Studio exports, cross-referenced to DB rows via `GET /api/videos` and `generation_runs`.

| DB id | Topic | Views | Likes | Comments | Avg watch | AVD | Watched full | Length | Static clips | Shots | Cost |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | Lake Nyos | 120 | 5 | 0 | 11.65s | ~20% | 2.0% | 0:57 | 0/8 | 8 | $3.23 |
| 7 | Williston floating island | 163 | 3 | 0 | 3.09s | ~6% | 0.6% | 0:51 | 4/7 | 7 | $3.22 |
| 8 | Armero / Nevado del Ruiz | 159 | 2 | 0 | 3.54s | ~5% | 1.2% | 1:08 | 4/11 | 11 | $5.57 |
| 9 | Lake Peigneur | 132 | 5 | 0 | 3.67s | ~5% | 2.4% | 1:09 | 2/10 | 10 | $6.17 |

Definitions:

- **Static clips** = fal runs whose `output.expanded_prompt` contains "Static Shot", "perfectly static" or "static composition". These are fal's own rewrites of our motion prompts, recorded in `generation_runs.output`.
- **Shots** = selected clip assets, one per beat.
- TikTok Studio reports "most viewers stopped watching at 0:02" on all four.
- View-count curves rise for roughly 8 to 10 hours then flatten to zero on all four.

Totals across the project: 9 videos, 159 generation runs, $22.57 spent, of which fal is $15.36.

---

## 2. What is NOT the problem

Ruling these out first, because each would imply a completely different fix.

- **Not a shadowban or a policy strike.** "For You" is the top-listed traffic source on all four videos. The account is being distributed.
- **Not topic selection.** All four topics are strong, on-format and well within the "True WTF" concept. Lake Peigneur and Armero are among the best available stories in this genre.
- **Not script or prompt quality.** The story validator, the craft rules and the prompt work in `prompts/` are genuinely good. Video 4 passed with zero findings. The scripts are not what viewers are rejecting, because almost nobody reaches the script.
- **Not the AI-generated label on its own.** It is mandatory for this format and correctly applied. It compounds a retention problem; it does not create one.

The failure is narrower and earlier than any of these: **all four videos lose the audience inside the first two seconds, at exactly the moment TikTok decides whether to widen the test pool.** Views in the 120 to 163 band with 5% AVD is a cold-start pool that completed and was not extended. Nothing downstream of second two ever got a chance to matter.

---

## 3. Root causes, in order of impact

### 3.1 Every beat is a generated fal video clip, and fal makes them static

This is the primary cause and the source of three other problems.

Evidence:

- `api/src/pipeline/steps/merge.ts:65` throws `No selected clip for beat N` if any beat lacks a fal clip. There is no still-image path in the pipeline. Every beat must be an image-to-video generation.
- `minimax/h3-max/image-to-video` rewrites the prompt we send. Our motion text is advisory. Recorded rewrites:
  - Video 7 hook, sent `camera drifts right as the satellite tile flickers once on the glass`, returned `top-down Static Shot` of a piece of paper on a wooden table.
  - Video 8 hook, sent `Macro glide right along the stain line`, returned a macro shot of a weathered wall.
  - Video 9 hook, sent `The tilted barge slides stern first into the turning vortex`, returned a shot where "the camera holds a perfectly static shot throughout the entire eight-second duration".
- Static clip fraction tracks AVD monotonically across the batch: 0/8 gives 20% AVD, 2/10 gives 5%, 4/11 gives 5%, 4/7 gives 6% with the worst completion of the four (0.6%).
- Videos 7 and 8 ran with `prompt_expansion_mode: "balanced"`, which `CLAUDE.md` already documents as the mode that flattens motion. Video 9 ran `quality` and still came back static on the hook. **Changing the expansion mode did not solve this.**
- `motion.hook_locked` validates the prompt we send, not the video fal returns, so it cannot catch any of this.

Consequences that all trace back to this one decision:

1. **No cut rhythm.** fal clips are integer seconds with a 5s floor, so one beat equals one shot of 5 to 12 seconds. Actual average shot lengths: 9.0s (v4), 9.0s (v7), 7.7s (v8), 8.4s (v9). A 2s cut is architecturally impossible today. `deep-research-report.md` lists "~2s cuts vs ~4s cuts" as a variable to test; we cannot currently produce either.
2. **Static hooks.** Frame 0 of three of the four videos is an effectively still image.
3. **Cost.** fal is 68% of all spend. Actual per-video cost is $3.22 to $6.17 against `pipeline-decisions.md` §7's model of $0.70 to $1.70, or $4 to $8 "adding a generated hook clip". We are paying the hook-clip premium on every beat.
4. **No procedural visuals.** `pipeline-decisions.md` §2 specified an SVG cross-section and a topo map animation as reusable Remotion components, and called that reuse "where the franchise economics come from". `visual-style.md` §1 refers to "EXHIBIT-style tags on map/diagram beats". Neither exists. Those assets move by construction, cost nothing per render, and are rights-clean.

### 3.2 Video 7's hook is paperwork, and the rule that blocks it arrived a day late

`image.hook_is_document` (severity `error`) landed in commit `bff3c7d`, 2 Sep 2026 20:30. Videos 4, 7, 8 and 9 were rendered before it existed (v4 on 1 Sep, v7 12:31, v8 14:30, v9 16:05 on 2 Sep).

Video 7's hook image prompt matches three blocked terms from `DOCUMENT_SUBJECT_TERMS`: `printed`, `satellite frame`, `desk`. Its first three beats are all document beats (a printed satellite frame, an office monitor, a laminated printout), which would also trip `image.document_beats`. It has the worst completion of the batch at 0.6%.

The gate is correct. It simply has not been applied to anything that shipped.

### 3.3 Length is optimised for a payout program the account cannot enter

`deep-research-report.md` anchors the 65 to 80 second envelope on TikTok Creator Rewards requiring videos over one minute. `pipeline-decisions.md` §10 already flagged Armenia eligibility as unconfirmed.

As of July 2026 the publicly reported eligible countries are the US, UK, Germany, France, Japan, South Korea, Brazil and Mexico. Armenia does not appear. The program additionally requires 10,000 followers and 100,000 views in 30 days. (Third-party sources; see §8.1 for the check that should be run.)

At 5% AVD a 60 second video cannot generate a completion signal. We are paying a heavy retention tax for a monetization gate that is out of reach for months at minimum, and possibly permanently on this platform.

### 3.4 No measurement loop, so the four posts taught us nothing

- All five rendered videos are still `status = render_review`. `publications` is empty for every one. Nothing in the DB records that these were posted.
- `source_url` is null on all four published videos. The Firecrawl generate-from-URL path exists and was not used.
- There is no analytics table and no feature vector per video, which `deep-research-report.md` identifies as the actual competitive advantage and `pipeline-decisions.md` §9 specifies directly.
- The four posts simultaneously varied topic, length, hook type, overlay presence and fal expansion mode. Five variables, four observations, nothing logged. `deep-research-report.md` is explicit that each experiment should vary one major variable.

### 3.5 Zero comments on four videos

Comments are heavily weighted in ranking and we generated none. There is no comment trigger in the caption template, no unresolved question, no pinned first comment. This is a free signal being left on the table.

### 3.6 No rights or claim records on a factual channel

`pipeline-decisions.md` §6 specifies a `rights_records[]` row per asset. `deep-research-report.md`'s checklist requires an evidence record for every number, date and proper name. Neither exists. We have `evidence_stamp`, which is a text overlay, not a source record.

Video 8 concerns more than 20,000 deaths. Video 7 names a living private individual. Both shipped with `source_url = null`. This is the one failure mode in this format that ends a channel rather than merely underperforming, and it is currently unmitigated.

---

## 4. The one counter-signal worth noting

Video 4 is the only video with no `overlay_hook`, and it has roughly three times the average watch time of the other three.

`hook-improvement-plan.md` §2 calls the missing text overlay "the single biggest miss" and Phase 1 adds it. Our own four data points do not support that premise. This is n=1 and confounded (different topic, different day, zero static clips, rendered before expansion-mode tracking), so it is not evidence that the overlay hurts.

What it does mean: **the overlay is an untested hypothesis, not a settled win, and it should be the first thing the A/B harness measures.** Worth noting that video 7's overlay ("Satellite lost an island") restates its narration hook ("Floating island vanished from satellite images in British Columbia"), which `hook-improvement-plan.md` Phase 1 explicitly forbids. Videos 8 and 9 use a different angle correctly.

Do not remove the overlay. Do stop treating it as proven.

---

## 5. Strategy check

### What holds up and should not change

- **Concept choice and ordering.** True WTF micro-docs first, microdrama second, book/film deprioritized. The scoring rationale in `pipeline-decisions.md` §1 is sound and nothing in the data contradicts it.
- **The Evidence File visual identity** (`visual-style.md`). This is a good, distinctive decision and it supersedes the "archival = old" framing in `pipeline-decisions.md` §6. It is not the problem. The problem is the render path, not the look.
- **Human approval gates.** `story_review` and `render_review` both exist. Both source docs say do not automate these away yet. Correct.
- **Audio drives timing**, derived from real TTS durations via ffprobe. Correct and load-bearing.
- **Never transcribe our own TTS.** Forced alignment via MMS_FA. Correct.
- **Idempotency by content hash.** `pipeline-decisions.md` §4's warning about a retry turning a $2 video into a $20 one is real and is handled.
- **The stack swap** away from the §4 sketch (BullMQ instead of Inngest, raw SQL instead of Drizzle, local Remotion instead of Lambda, Chatterbox instead of ElevenLabs, Telegram instead of Slack) is a defensible cost decision. Not a drift worth reversing.
- **The prompt and craft-rule work.** `STORY_RULES`, the validator registry, the meta-test that fails on an untested rule, the eval and rescore tooling. This is the strongest part of the codebase.

### What broke

The 65 to 80 second envelope. Its only justification was TikTok Creator Rewards eligibility, which does not apply here. See §3.3.

### What drifted from our own decisions

| Decision | Where written | Reality |
|---|---|---|
| Generated video for the hook shot only, gated | `pipeline-decisions.md` §6 | Generated video for every beat |
| SVG maps and cross-sections as reusable Remotion components | `pipeline-decisions.md` §2, `visual-style.md` §1 | Do not exist |
| Measure on YouTube, reach on TikTok | `pipeline-decisions.md` §3 | TikTok only; publishing parked; retention read off PDF screenshots |
| Features tracked in an analytics table | `pipeline-decisions.md` §9 | No analytics table |
| `rights_records[]` per asset | `pipeline-decisions.md` §6 | Does not exist |
| Cost $0.70 to $1.70 per video | `pipeline-decisions.md` §7 | $3.22 to $6.17 |
| One variable per experiment | `deep-research-report.md` | Five varied across four posts |

The strategy was right and was written down. The implementation diverged from it in exactly the places that produced the bad numbers.

---

## 6. Change plan

Ordered by impact per unit of effort. Each item states the expected effect so it can be falsified.

### Step 1 — Stop flying blind (half a day)

Nothing else on this list is measurable until this exists.

- **New migration: `video_publications`.** Columns: `video_id`, `platform`, `platform_video_id`, `published_at`, `posted_manually` (bool). Move the four existing posts to `status = published` and backfill their TikTok ids.
- **New migration: `video_metrics`.** Columns: `video_id`, `platform`, `captured_at`, `views`, `likes`, `comments`, `shares`, `saves`, `avg_watch_seconds`, `avd_pct`, `completion_pct`, `retention_2s_pct`, `traffic_sources` (jsonb). One row per capture, so the series is preserved.
- **New migration: `video_features`.** One row per video, written at render time, holding the experiment matrix: `duration_seconds`, `word_count`, `beat_count`, `shot_count`, `avg_shot_seconds`, `hook_type`, `overlay_present`, `overlay_restates_narration`, `first_visual_type` (event / object / document / map / diagram / person), `static_clip_count`, `expansion_mode`, `caption_density`, `has_rehook`, `topic_family`. These are the features `pipeline-decisions.md` §9 asked for.
- **Manual metrics entry** in the frontend, plus a CSV import path for TikTok Studio exports. Do not wait for an API to start collecting.
- Backfill all three tables for videos 4, 7, 8 and 9 from this document.

Expected effect: no reach improvement. Everything after this becomes measurable, which nothing currently is.

### Step 2 — Break the fal monopoly on shots (2 to 3 days, biggest reach win)

The goal is not to abandon the Evidence File look. It is to stop routing every frame of it through an image-to-video model that overrides our motion and imposes a 5s floor.

- **Add a still-image shot path.** `merge.ts:65` currently requires a clip per beat. Allow a beat to render from its selected `image` asset instead, with the camera move applied in Remotion (push in, pan, tilt, parallax on a 2x-resolution still). Free per render, fully deterministic, and it honours the motion grammar we write instead of fal's rewrite.
- **Gate fal to the hook beat plus at most one money shot**, per `pipeline-decisions.md` §6 priority 4. Env-configurable cap, defaulting to 2 clips per video.
- **Allow sub-5s beats.** Once a beat can be a still with a Remotion camera move, shot length is decoupled from fal's integer-second floor. Target 2 to 4s per shot.
- **Validate what fal returns, not what we send.** After each clip generation, fail and retry with a new seed if `expanded_prompt` matches a static-shot phrase. Cap retries. Record the rewrite either way. This closes the hole in `motion.hook_locked`.
- **Build the two procedural components** from `pipeline-decisions.md` §2: an animated cross-section and an annotated topo map, as SVG in Remotion with the EXHIBIT tag treatment from `visual-style.md` §1. These are reusable across every geology and disaster story, which is most of the catalogue.

Expected effect: shot count per 60s roughly triples, cut rate drops under 3s, static hooks become impossible to ship, and cost per video falls from $3 to $6 back toward the $1 to $2 model. This is the single largest lever on the 0:02 dropoff.

### Step 3 — Fix the length envelope (half a day)

- Change the envelope constants to **20 to 35 seconds, 45 to 80 words, 4 to 7 beats**, and update `story.duration_envelope` and `story.word_count_envelope` accordingly.
- Update `prompts/story.user.md` to match: shorter setup, turn by ~8s, reveal by ~20s, kicker under 30s.
- Run `pnpm prompt:eval` before and after and diff the finding histograms, per the existing tooling discipline.
- Keep the 50 to 70s envelope available behind a setting so the long form can be revisited for YouTube later.

Expected effect: completion rate is the metric TikTok pays for and it is currently 0.6 to 2.4%. At 25 seconds the same 3.5s of average watch becomes 14% AVD instead of 5%, and a viewer who stays through the turn actually finishes. This is the cheapest structural change on the list.

### Step 4 — Publish to YouTube Shorts and Instagram Reels (2 days)

`pipeline-decisions.md` §3 already decided this: measure on YouTube, reach on TikTok. It was never built.

- Implement the YouTube Data API `videos.insert` path and the Instagram Content Publishing path for Reels, both unattended per §3.
- Wire the YouTube Analytics API for retention curves into `video_metrics`.
- Keep TikTok as inbox-draft plus manual publish, per the audit-trap reasoning in §3. That decision was correct.

Expected effect: three retention datasets per video instead of one, and the only machine-readable one. Also the only ad-revenue path actually available from Armenia.

### Step 5 — Re-render and repost videos 7 and 8 (1 day, mostly render time)

Both were rendered before the money-shot rules existed. Video 7 opens on paperwork; video 8 opens on a static wall.

Re-render at the new envelope with event hooks that pass the current validator, then repost. Same topic, new execution, logged as a paired observation against the original in `video_features`.

Expected effect: a direct before/after on the hook change, holding topic constant. This is the highest-quality experiment available at n=4.

### Step 6 — Comments and rights records (1 day, in parallel)

- Add a required comment trigger to the caption template: one unresolved specific detail, or a decision question. Add a `pinned_comment` field and post it manually with the video.
- Add `source_claims[]` and `rights_records[]` to the schema, populated by the research step. Block `render_review` approval if the central claim has fewer than two sources, per the `deep-research-report.md` checklist. Backfill sources for videos 4, 7, 8 and 9.

Expected effect: comments are a ranking input we currently score zero on. Rights records are insurance, not growth.

### Step 7 — Then, and only then, the hook A/B harness

`hook-improvement-plan.md` Phases 2 and 3 (variants, `validateHook()`, truthfulness gate) are well specified and cheap. Run them after Step 1 exists, so variant selection produces labelled data instead of opinion. Make the overlay-on / overlay-off test the first experiment, given §4.

### Sequencing summary

| Step | What | Effort | Blocks |
|---|---|---|---|
| 1 | Analytics, publications and features tables | 0.5d | everything |
| 2 | Still-image shot path, fal gated to 2 clips, procedural SVG, fal output validation | 2 to 3d | — |
| 3 | 20 to 35s envelope | 0.5d | — |
| 4 | YouTube and Instagram publishing plus retention ingest | 2d | 1 |
| 5 | Re-render and repost 7 and 8 | 1d | 2, 3 |
| 6 | Comment trigger, source and rights records | 1d | — |
| 7 | Hook A/B harness | 1d | 1 |

Steps 1 and 3 can ship today. Step 2 is the one that actually moves retention.

---

## 7. What not to change

- Do not loosen the truthfulness rules or add clickbait tolerance. `hook-improvement-plan.md` §5 is right about this.
- Do not remove the AI RECONSTRUCTION tag or the AIGC label. Mandatory, and the cost of removing them is the account.
- Do not remove the human gates yet.
- Do not remove the overlay hook. Test it (Step 7); do not act on n=1.
- Do not abandon the Evidence File style. The look is fine. The render path is the problem.
- Do not switch orchestration to Inngest or Temporal now. BullMQ is not the bottleneck and the migration would consume the whole week.
- Do not add music. `hook-improvement-plan.md` Phase 5 was correctly skipped; music goes on in TikTok at post time.
- Do not automate the research agent further before Step 1. `pipeline-decisions.md` §8 is right that it should be last.
- Do not post more than one video per day until Step 1 lands. Four posts in one day split a 150-view test pool four ways and produced four unlogged observations.

---

## 8. Research needed

Only four items. Everything else in the source docs is either settled or not yet relevant.

### 8.1 TikTok Creator Rewards eligibility for Armenia — needed, blocks a strategic decision

The 65 to 80 second envelope existed only to satisfy this program. My check found the publicly reported eligible list as the US, UK, Germany, France, Japan, South Korea, Brazil and Mexico, with Armenia absent, but the sources were third-party aggregators, not TikTok's own support pages.

Confirm from TikTok's own Creator Rewards support documentation and from the in-app Creator Rewards entry on the account itself. The account is the authoritative source: if the program does not appear in TikTok Studio, it is not available.

Decides: whether long-form ever returns on TikTok, or whether >60s is purely a YouTube consideration. Also whether the financial model rests on YouTube alone.

### 8.2 YouTube Analytics API retention for a channel below the YPP threshold — needed, blocks Step 4's value

`pipeline-decisions.md` §3's whole measurement strategy assumes YouTube returns real retention curves. Confirm that the `audienceRetention` report is available for a channel with no subscribers and low view counts, and what the minimum-views threshold is before the report is suppressed for privacy.

If retention is suppressed at our volume, Step 4 still ships for reach and revenue, but the measurement loop has to run on manual TikTok Studio exports for longer than planned, and Step 1's CSV import becomes more important than the API work.

### 8.3 A fal image-to-video endpoint that honours motion, or a shorter minimum duration — needed, sizes Step 2

`minimax/h3-max` rewrites our prompts and returns static shots even under `quality`. Before gating fal to two clips per video, check whether any available endpoint (a) accepts durations under 5s, (b) exposes a real `negative_prompt`, or (c) does not rewrite the prompt at all.

Use the existing `pnpm fal:schema <endpoint-id>` tooling. Pricing is not in the openapi document, so cost has to be measured on one real render.

If a well-behaved endpoint exists, the hook clip becomes trustworthy and Step 2 gets simpler. If not, the still-image path plus Remotion camera moves carries more of the load and fal may be worth dropping entirely.

### 8.4 Instagram Trial Reels availability for this account — worth 20 minutes

`deep-research-report.md` recommends Trial Reels as the cheapest A/B surface because it shows content to non-followers first. Check whether it is available for this account type and region. If yes, it becomes the primary hook-testing surface in Step 7 and is far better than burning TikTok test pools.

### Explicitly not worth researching now

- **Copyright and fair use.** Settled in the source docs. The facts-only research-then-original-narrative architecture is correct and the format carries low risk. Revisit only if the book/film concept is ever built.
- **Microdrama and BookTok market data.** Concept two and concept three. Not being built. The numbers will be stale by the time they matter.
- **Whether the AI-generated label suppresses reach.** No credible public data exists, the label is mandatory for this format, and the answer would not change any decision. Treat it as a fixed cost and win on execution instead.
- **Trend and search data sources.** `pipeline-decisions.md` §10 lists this as unresolved. It stays unresolved. Topic supply is not the constraint; at four posts we have no shortage of good topics, and a scraping dependency is fragile. Revisit after 30 logged videos.
- **Universal viral benchmarks.** `deep-research-report.md` is right to reject these. After 20 to 30 videos in `video_metrics` we will have our own baseline per duration, which is the only benchmark that means anything.

---

## 9. How we will know it worked

Measured on the next 10 posts, at the new 20 to 35 second envelope, one variable at a time, all logged:

| Metric | Now | Target |
|---|---:|---:|
| Retention at 2s | below 50% | above 65% |
| AVD | 5 to 6% | above 25% |
| Completion | 0.6 to 2.4% | above 10% |
| Comments per video | 0 | above 1 |
| Avg shot length | 8.4s | under 3s |
| Static clips per video | up to 4 | 0 |
| Cost per video | $3.22 to $6.17 | under $2.00 |
| Videos with source records | 0/4 | all |

The reach number to watch is not views. It is whether any video escapes the 120 to 163 cold-start band. One video breaking past roughly 1,000 views means the pool was extended, which is the only signal that says the hook is working.

---

## 10. Content theory review

Reviewing the working theory of what makes these videos land, proposition by proposition. Three of four are right. One is wrong in a way that matters, and the set is missing four things.

### 10.1 "Viewers love intrigue" — correct, already the format's core

This is the concept and it is not the problem. `prompts/story.user.md` already enforces impossibility in the first three or four words, the open-loop arc, and the re-hook on the turn. TikTok's own "Curiosity Detours" framing in `deep-research-report.md` points the same way. Nothing to change.

### 10.2 "More active action, like an interesting movie" — correct, and it is the single biggest gap

This is §3.1 restated from the audience side, and the data backs it hard. Average shot length across the four posts is 8.4 seconds. Feature film dialogue scenes run 3 to 6 seconds per shot; action sequences run under 2. We are cutting three to four times slower than the slowest thing a viewer is used to, and up to half our shots do not move at all because fal rewrites the motion out.

One precision worth adding, because "more active" can be misread: **active is not the same as busy.** A frame that is visually loud but not parseable in a third of a second fails the same way a static frame does. The requirement is a legible anomaly: one subject, one thing wrong with it, readable instantly, and moving.

Our four hooks split exactly on those two axes:

| Video | Legible in 0.3s? | Actually moved? | Result |
|---|---|---|---|
| 7 | No (a printed page on a desk) | No (fal returned "top-down Static Shot") | worst completion, 0.6% |
| 8 | Marginal (a macro of a stained wall) | No | 1.2% |
| 9 | Yes (a barge going stern-first into a whirlpool) | No ("perfectly static" for the full 8s) | 2.4% |
| 4 | Marginal (black water, trembling shoreline) | Yes, 0/8 static | best AVD, ~20% |

Video 9 had the best hook concept in the batch and fal flattened it. Video 4 had a weaker concept and won because everything moved. That is the whole argument for Step 2 in one table.

### 10.3 "Keep it interesting, then culminate at the end so they watch to the end" — this one is wrong for short-form

The instinct behind it is right: the video needs to earn every second. The structure it implies is wrong, for three reasons.

**Nobody arrives at the end.** A culmination at 0:55 is a promise made to an audience that left at 0:03. Completion is 0.6 to 2.4%. Placing the best material where 98% of viewers never reach is the most expensive possible mistake, and it is self-reinforcing: withholding the payoff to drive completion only works if viewers already trust that a payoff is coming, and a new account has earned no such trust.

**Our own docs already specify something better.** `prompts/story.user.md` puts a hard turn at roughly 23 seconds. `hook-improvement-plan.md` Phase 4 added a re-hook rule requiring the turn beat to open a *second* question. `deep-research-report.md`'s template lands "establish reality" at 3 to 10 seconds, meaning a small concrete payoff arrives almost immediately. That is a multi-loop structure, not one climax. The theory above is a step backwards from what is already written down.

**Single-climax structure is cinema and long-form YouTube grammar.** It works when the viewer has committed: they chose the film, they paid, they are seated. On a For You feed nobody has committed to anything. Short-form needs **payoff density**: something concrete, surprising or reversing lands every five to eight seconds, and each payoff buys the next loop.

The correct shape at the new 20 to 35 second envelope:

| Time | Function | Why |
|---|---|---|
| 0 to 3s | Hook, opens loop A | Stop the swipe |
| 3 to 6s | **First small payoff**: one concrete verified detail | Proves the story is real and the channel pays out. This is the trust purchase |
| 6 to 14s | Escalation, opens loop B | The bigger question |
| 14 to 20s | Reveal, closes loop A | The actual answer |
| 20 to 25s | Kicker, one last verified detail, **loops back to frame 1** | Completion plus a restart |

**The mechanic that beats a climax is the loop.** If the final frame visually rhymes with the first, the video restarts seamlessly and the viewer watches into a second pass before realising. That inflates completion, which is the metric distribution actually responds to. `visual-style.md` §1 already specifies a "haunting loopable final frame, stamp-free, so the loop is clean" and `hook-improvement-plan.md` Phase 4 wrote the visual-rhyme rule as prose. Neither is enforced anywhere in code. That is a cheaper win than restructuring toward a climax, and it points the opposite direction.

### 10.4 "The first frame must be very interesting and active" — correct, and it is finding number one

Agreed, and §3.1 is exactly this. Two things the proposition does not account for, both of which are why "make the hook better" has not worked so far:

- **We do not currently control it.** The hook motion prompt is advisory. fal rewrites it and returned a static shot on three of four videos, including under `quality` mode. Prompting harder cannot fix this; only validating the returned `expanded_prompt` and retrying can, which is why that is in Step 2 rather than in a prompt edit.
- **Legibility gates intensity.** See the table in §10.2. An intense but unreadable frame performs like a static one.

### 10.5 What the theory is missing

Four things, roughly in order of how much they are worth.

**Retention is not the only ranking input.** The theory optimises watch time exclusively. Shares, comments and saves are weighted too, and we scored zero comments on four videos. A video can hold attention well and still not spread, because nothing in it asks to be passed on or argued with. Step 6 addresses this and it is currently the cheapest unclaimed signal we have.

**Sound.** The theory says nothing about audio, and neither does the pipeline. Narration starts cold at 0.0s over silence. `hook-improvement-plan.md` Phase 5 correctly skipped the music bed, since music is added inside TikTok at post time, but it also mentioned a single sub-second audio accent under the hook overlay and gated it behind a setting that was never turned on or tested. Audio contrast in the first half-second is one of the three hook modalities in that plan's own source material and we use one of the three.

**The loop.** Covered in §10.3. Specified in two docs, enforced in none.

**"Interesting" is not a specification.** This is the important one. The strongest thing about this codebase is that craft rules were turned into machine-checkable rules in `STORY_RULES`, with a meta-test that fails when a rule ships without a case. Every instinct above is currently either unenforced prose or absent. Until they are rules, they will drift back out on the next prompt change, exactly as the money-shot rules missed all four published videos by fourteen hours.

### 10.6 Proposed rules, so this survives contact with the next prompt edit

Add to the Step 3 scope. All of these are checks on data we already have.

| Rule id | Severity | Check |
|---|---|---|
| `story.first_payoff_timing` | error | The first beat carrying a concrete verified detail must start before ~6s. Requires tagging each beat `advance` or `context` in the schema |
| `story.payoff_density` | warning | No gap longer than 8s between `advance` beats |
| `story.climax_position` | warning | The `reveal` beat must not be the last beat. A payoff in the final position sits where the fewest viewers are |
| `story.loop_rhyme` | warning | The kicker's final noun should echo a noun from the hook. Makes `visual-style.md`'s loopable-kicker ritual and Phase 4's visual-rhyme rule checkable |
| `image.hook_legibility` | warning | The hook image prompt names exactly one subject. Warn on three or more distinct concrete nouns in the hook frame |
| `motion.hook_returned_static` | error | The hook clip's returned `expanded_prompt` must not match a static-shot phrase. This is the Step 2 fal-output validation expressed as a rule |

Per the existing discipline in `CLAUDE.md`, each of these needs a case in `api/tests/storyValidate.test.ts` or the registry meta-test fails, and each should be checked against the saved stories in `api/eval-out/` with `pnpm prompt:rescore` before any error-severity rule is turned on, since a new error costs a second provider call on every violating story.

### 10.7 A note on sources

Public "short-form retention playbook" material is overwhelmingly SEO content produced by tools vendors, not primary research, and it contradicts itself on almost every number. The primary sources already cited in `deep-research-report.md` are better: YouTube's own Shorts discussion with Jenny Hoyos on the first second, the Dhar Mann case study on conflict-first structure, and Reuters/Omdia on the microdrama cliffhanger mechanic.

Beyond those, our own retention curves are the best evidence available to us, and after ten logged videos at the new envelope they will be better than anything published. That is the whole point of Step 1.
