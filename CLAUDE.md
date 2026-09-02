# Reel Social Agent — project guide

Automated micro-documentary reel factory for @oneminutewtf. Read `docs/` first: `deep-research-report.md` (format + strategy), `pipeline-decisions.md` (architecture decisions), `pipeline-learnings.md` (hard-won generation rules). Those documents are the product spec.

## Layout

pnpm monorepo: `shared/` (Zod schemas + constants), `api/` (Fastify 5, port 4041), `frontend/` (Vite + React, 4040), `services/tts/` (Python Chatterbox, 4042, native not Docker), `services/captions/` (Remotion, 4043), `prompts/` (editable LLM prompt templates), `storage/` (generated media, gitignored).

## Hard rules (from docs/, do not violate)

- **Audio drives timing.** Beat durations come from ffprobe over the real TTS wav, never from script estimates. Clips are trimmed/padded to `audio + BEAT_GAP_SECONDS`.
- **145 wpm rule.** `storyPost.postProcessStory` recomputes every word count and duration; LLM numbers are discarded.
- **Byte-identical style prefix** per video, injected server-side (`buildImagePrompt`); the LLM never writes style/negative boilerplate.
- **Motion prompts are motion-only** + fixed negative block (`MOTION_NEGATIVES`); 2–3 beats must be `camera_locked`.
- **Idempotency by content hash.** Every asset row carries `content_hash = sha256(step inputs)`; steps skip existing hashes. Takes are never overwritten (`_v2`, `_v3`…).
- **Numbers as words** in narration ("nineteen eighty six"), digits break TTS.
- **Never transcribe our own TTS** — word timings come from forced alignment (`services/tts/app/align.py`, torchaudio MMS_FA) since the text is known.

## Backend conventions (mirrors claude-smart-memory)

- Three-file bootstrap: `index.ts` (process) / `app.ts` (`buildApp(config)`) / `config.ts` (`loadConfig()` — the ONLY place env is read).
- Routers are thin: schemas from `@reel-agent/shared`, SQL only in `database/queries/<table>.ts`, one file per table, `app` as first arg.
- Migrations: raw SQL in `api/src/database/migrations/`, `-- Up Migration` / `-- Down Migration`, `pnpm migrate`.
- Pipeline: BullMQ queue `pipeline`, worker in-process (`startWorker` in index.ts). Render chain: `tts → images → clips → merge → captions` (TTS first — clip lengths need real audio durations). Human gates (story approval, render review) are DB status changes from routes, not jobs.
- Progress: `publishEvent` → Redis pub/sub → SSE route `/api/videos/:id/events` (uses `reply.hijack()`; CORS header must be written manually there).
- Video state machine: `draft → story_review → approved → rendering → render_review → (publishing → published) | failed`.

## Tests

One `tests/` folder per service (`api/tests`, `frontend/tests`, `services/captions/tests`, `services/tts/tests`). api integration tests hit the real `reel-agent-test` DB (migrated in `tests/globalSetup.ts`) and real Redis, and obliterate the queue afterward. All external APIs are mocked; TTS tests stub the model (real synthesis behind `RUN_SLOW=1`).

## Gotchas

- pnpm blocks postinstall scripts unless listed in root `package.json` `pnpm.onlyBuiltDependencies` (esbuild is there — don't remove it).
- `services/captions` uses `moduleResolution: bundler` + extensionless imports because Remotion's webpack cannot resolve NodeNext `.js`-suffixed imports. Everything else is NodeNext with `.js` suffixes.
- The captions service streams the source video to Remotion's headless Chrome over its own `/files/` static route — the video path must live under `STORAGE_DIR`. First render downloads Chrome Headless Shell (~93MB).
- `fal.storage.upload` returns a bare 403 "Forbidden" for malformed/suspicious image files (verified: a hand-crafted 100-byte PNG is rejected, a real PNG uploads fine) — `FalClient.uploadImage` falls back to a base64 data URI on any upload error, so the pipeline survives either way.
- fal clips are integer seconds (min 5) at 24fps; merge re-encodes to 30fps CFR and trims — never assume the clip length equals the request. Verified output for a 5s 768P request: 768×1344, ~5.18s, ~$0.20.
- fal e2e verified 1 Sep 2026 through the production client: upload → queue submit → status poll → download all work with the current key.
- Chatterbox is not thread-safe; the TTS service serializes generation with a lock and the pipeline calls it with concurrency 1. Cold model load ~90s on MPS.
- A long-idle TTS process can wedge (instant 500 on every /synthesize; observed 1 Sep 2026 after ~15 min idle on macOS — suspected App Nap / MPS state). A restart fixes it. Mitigations in place: TtsClient retries once after 5s, and the service returns real exception details instead of a bare 500. If it recurs, restart via `pnpm dev:tts`.
- Gemini free tier has **zero** quota for image models (`generate_content_free_tier_requests, limit: 0` → 429 on every call) — billing must be enabled on the key's Google Cloud project before Nano Banana works. Plain-auth calls (models list) succeed, so a 200 on /models does NOT prove image generation will work. `gemini-2.5-flash-image` currently resolves to `gemini-2.5-flash-preview-image` server-side.
- Telegram `sendMessage` fails with 403 "the bot can't send messages to the bot" when TELEGRAM_CHAT_ID is the bot's own id — the chat id must be the human's id from @userinfobot, and the human must have pressed Start in the bot chat.
- BullMQ requires `maxRetriesPerRequest: null` on its ioredis connection.
- **Ollama can wedge like the TTS service does** — observed 2 Sep 2026 timing out at 120s on a one-field request with a one-field schema, while `/api/ps` still reported the model resident. `OllamaProvider` now carries a 15-minute deadline (it previously had none, unlike the claude/codex providers); if it recurs, `ollama stop <model>` then restart the app. `qwen3.6` is also a reasoning model: a trivial reply took 112s because of the thinking pass, so budget minutes per story, not seconds.
- **fal's `minimax/h3-max/image-to-video` rewrites our motion prompt.** `prompt_expansion_mode` is a REQUIRED field defaulting to `balanced`, and the rewrite comes back as `expanded_prompt` — recorded in `generation_runs.output`. Read it before tuning any motion rule; the model does not generate from the text we send. The same endpoint accepts `seed` (never echoed back, so we derive it via `seedFromHash`) and `end_image_url` (used for the loopable kicker), and has no `negative_prompt` — `MOTION_NEGATIVES` must stay in the prompt text. Verify any endpoint with `pnpm fal:schema <id>` before repointing `FAL_VIDEO_MODEL`; pricing is NOT in the openapi document.
- Craft rules are enforced by the `STORY_RULES` registry in `api/src/utils/storyValidate.ts`, not by prose. Adding a rule without a case in `api/tests/storyValidate.test.ts` fails the registry meta-test on purpose. Rule ids are persisted in `videos.story_findings`, so `rule` is `z.string()` and never a `z.enum`.
- Prompt examples rotate: `HOOK_EXAMPLE_POOL` in `shared/src/craft.ts` is sampled per topic, and `story.example_leakage` errors if a story copies one. **Every illustrative sentence in `prompts/story.user.md` must be wrapped in backticks** — that is how `storyPromptExamples()` finds them; never backtick a line the model is supposed to copy (capture-medium lines, shot-type prefixes).
- TikTok integration exists but is parked (see README). Do not delete `clients/tiktok.ts` / the publish step; they are the planned next phase.
- Model ids are env-configurable and move fast (docs §1 of pipeline-learnings) — never hardcode a model name outside config defaults.

## Verification

`pnpm typecheck && pnpm test` at root, `pytest` in `services/tts`. End-to-end: generate a story with Ollama (free), approve it, watch the pipeline strip; a full real render costs ~$3–5 (fal + Gemini).

Prompt quality has its own tooling, all free:

- `pnpm prompt:eval` — generates real stories through Ollama and prints the finding histogram per topic. Run it before and after any prompt edit and diff the histograms; that comparison, not a single sample, is what tells you whether a change helped. Gated behind `RUN_EVAL=1` and never in CI.
- `pnpm prompt:critique` — read-only review of `prompts/` plus the direction docs by Codex (`gpt-5.6-luna`) and Claude (Opus), written to `docs/prompt-critique-<date>.md`. Act on what both models raise; treat a single-model finding as a hypothesis.
- `pnpm fal:schema <endpoint-id>` — the real input/output schema and capabilities of a fal endpoint, from the public openapi document. Run it before repointing `FAL_VIDEO_MODEL`; a guessed field is a 422.
