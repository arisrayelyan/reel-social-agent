# AI Video Pipeline: Decisions and Constraints

Session notes, 29 August 2026. Companion to `deep-research-report.md`.

---

## 1. Content decision

**Picked: True "WTF?" micro-documentaries.** Runner-up scored identically (8.9) but loses on operational grounds.

| | True WTF | Microdrama | Book/film |
|---|---:|---:|---:|
| Overall | 8.9 | 8.9 | 7.9 |
| Automation | 9.2 | 8.3 | 8.6 |
| Cost efficiency | 9.2 | 6.8 | 8.3 |
| Copyright safety | 8.6 | 9.3 | 5.5 |
| Defensibility | 8.3 | 9.5 | 7.5 |

Rationale for True WTF first: highest automation, cheapest per unit, unlimited topic supply. It is the format that lets you run hundreds of experiments to train the pipeline. Facts are not copyrightable, only their expression, so the research agent extracts facts and writes fresh narrative rather than paraphrasing a source.

Microdrama is the better long-term asset (owned IP) but needs a series bible, visual continuity, and 2 to 5x the cost and time. Build it second, on top of a proven pipeline.

Book/film explainers are gated on copyright and unspecified licensing costs. Deprioritized.

---

## 2. Pilot episode: Lake Nyos

Cameroon, 21 August 1986. 1,746 people died overnight from a limnic eruption. No wounds, no disease. Cattle and insects died too.

Structure that makes it work:
- Hard turn at ~23s: the poison gas theory collapses, no burns, water not toxic
- Second turn at ~40s: the lake itself is the weapon, CO2 saturated deep layer held down by pressure
- Kicker at ~70s: the lake is still loaded and is now vented on purpose by engineers

Visuals are cheap and rights-clean. USGS and Cameroon survey imagery, satellite stills, an animated cross-section of the CO2 layer inverting, a topo map tracing gas flow down the valleys. No archival footage, no faces, no death imagery.

**Franchise thread from one research pass:**
- Lake Monoun, 1984, 37 dead, same mechanism
- Lake Kivu, ~300x the gas, two million people on its shore

The cross-section and map animations are SVG components in Remotion, reusable across all three episodes. That reuse is where the franchise economics come from.

---

## 3. TikTok API reality (the constraint that shapes the build)

TikTok has multiple APIs. Only some are usable.

| API | Usable? | Notes |
|---|---|---|
| Login Kit | Yes | OAuth foundation, gets access_token + open_id |
| Content Posting, Direct Post | **No** | `video.publish` scope. Requires content audit |
| Content Posting, Inbox Upload | **Yes** | `video.upload` scope, lands in drafts, no audit |
| Display API | Yes | Own account: follower count, view/like/comment/share per video |
| Research API | No | Academic and non-profit only, US and EU |
| Business/Marketing API | Partial | Business accounts and ads reporting |

### The audit trap

Until an API client passes TikTok's content audit, every Direct Post lands as SELF_ONLY private regardless of the privacy level sent. `creator_info` still reports PUBLIC_TO_EVERYONE as available, so nothing in the API signals the state. Unaudited clients are also capped at 5 users per 24h.

Audit criteria explicitly reject "a utility tool to help upload contents to the account(s) you or your team manages." That is precisely this project. **Assume the audit fails.**

### Resulting design: draft push, human publish

Render fully automated, then `/v2/post/publish/inbox/video/init/` drops the video into TikTok drafts. Open the app, review, set the AIGC label, post. 30 seconds per video, and it doubles as the human QA gate the research report already recommended.

YouTube Shorts and Instagram Reels can be genuinely unattended. TikTok stays semi-manual.

### Metrics gap

**No retention or watch time in any TikTok API.** Display API gives counts only. Average watch time, completion rate, retention curve and traffic sources exist only in TikTok Studio.

Also no public API for trends or search. Creative Center is web UI only. The Trend Agent will need scraping or a third party vendor, both fragile.

**Decision: measure on YouTube, reach on TikTok.** YouTube Analytics API returns real retention curves. Same cuts go to both, so optimize hooks against YouTube data and apply winners to TikTok. Fall back to manual weekly CSV export from TikTok Studio, which is fine at 60 videos.

---

## 4. Architecture

```
Inngest (durable orchestration, TS-native)
  Postgres + Drizzle          state machine, one row per video
  R2/S3                       assets, keyed by content hash
  Remotion Lambda             render 1080x1920 @ 30fps
  Claude + web search         research, verify, script
  ElevenLabs with-timestamps  narration + caption alignment
  Slack                       approval gate
```

Inngest over Temporal for now. Durable steps, retries, fan-out, no cluster to run, TS first. Move to Temporal when running multiple concurrent series and needing real workflow versioning.

**Every step idempotent and keyed by content hash.** Asset generation is the expensive part. A retry that regenerates 12 images because step 9 failed turns a $2 video into a $20 video.

Verification runs as a separate adversarial pass with a different prompt, not as part of the research call. Below 0.8 confidence, block and flag for human research.

---

## 5. Two details that make or break it

### Audio drives timing, not script timestamps

The script says "hard turn at 23s." TTS will not hit 23s. Hardcoding shot durations lets audio drift, captions desync, cuts land mid-word. This is the most common failure mode.

Generate narration **per storyboard beat**, measure each clip, derive shot durations from actual audio:

```ts
const shots = board.shots.map((shot, i) => ({
  ...shot,
  durationInFrames: Math.ceil(vo[i].durationSeconds * 30) + PAD_FRAMES,
}));
```

Compute total composition duration in Remotion's `calculateMetadata` so it is never wrong.

### Never transcribe your own TTS

ElevenLabs `/v1/text-to-speech/{voice_id}/with-timestamps` returns character level alignment. Group chars into words, words into 2 to 4 word cues, get frame accurate kinetic captions for free. Running Whisper over audio you just generated is wasted money and worse accuracy.

---

## 6. Asset resolution priority

1. **Public domain** (Wikimedia Commons API with license filter, USGS, NASA). Free, rights clean.
2. **Procedural** (maps, diagrams as SVG in Remotion). Free, on-brand, reusable across the series.
3. **Generated stills.** ~$0.03 to $0.09 each.
4. **Generated video, hook shot only.** 10x a still and the biggest driver of cost variance. Gate it.

Persist a `rights_records[]` row per asset. Provenance matters when a monetization review lands months later.

---

## 7. Cost per video

| Stage | Cost |
|---|---|
| Research + verify + script | $0.15 to $0.40 |
| 10 to 14 generated stills | $0.30 to $0.90 |
| ElevenLabs, ~180 words | $0.05 |
| Remotion Lambda render | $0.15 to $0.30 |
| **Total** | **~$0.70 to $1.70** |

Adding a generated hook clip pushes it to $4 to $8.

---

## 8. Build order

Build the render path first. It is the part most likely to look bad.

1. **Week 1:** Hardcode the Lake Nyos storyboard as JSON. Build the Remotion composition, TTS, caption alignment. Render it. Iterate until it does not look like AI slop.
2. **Week 2:** Wrap in Inngest, add script and storyboard agents. Topic string to rendered MP4.
3. **Week 3:** Research and verification agents, Slack approval, TikTok draft push.
4. **Week 4:** YouTube and Instagram publishing, analytics ingestion.

The research agent is the **last** thing to automate. Write the Monoun and Kivu scripts by hand while building. Three hand-written scripts will teach you more about the script schema than any upfront design.

---

## 9. Scale risk

TikTok makes reused or unoriginal content ineligible for the For You feed, and treats identical repetitive content across posts or accounts as spam automation. Template variance is not optional.

Vary hook structure, first visual type, caption density and pacing per video. Track those as features in the analytics table so variance does double duty as the experiment matrix.

---

## 10. Open items

- TikTok Creator Rewards eligibility for an Armenia-based account is still unconfirmed. Treat direct TikTok payouts as upside, not the financial model. YouTube lists Armenia as a YPP market, so Shorts is the reliable ad revenue path.
- Trend Agent data source unresolved. No official TikTok API. Decide between scraping, a third party vendor, or dropping trend input entirely for the first 30 days.
- AIGC disclosure is set manually in-app under the draft flow. Confirm whether the inbox init endpoint accepts it as metadata.


## 11. Video tool 
Video generation is going to happen via https://fal.ai/
here is docs: https://fal.ai/docs/documentation