# Reel Social Agent

An automated agent that produces **true "WTF?" micro-documentary reels** (65–85s vertical videos) for **@oneminutewtf**. It researches topics, writes beat-by-beat scripts, generates keyframes (Google Nano Banana), animates them (fal.ai MiniMax H3 Max image-to-video), narrates them locally (Chatterbox TTS), merges everything with ffmpeg so audio drives timing, burns kinetic captions with Remotion, and tracks every token and dollar in a dashboard. TikTok inbox upload is built but currently parked — finished videos are reviewed and downloaded from the dashboard, with a Telegram ping when a render is ready.

## Architecture

```
pnpm monorepo
├── shared/              Zod schemas + constants shared by api and frontend
├── api/                 Fastify 5 + BullMQ pipeline worker      → :4041
├── frontend/            Vite + React + TanStack Query dashboard → :4040
├── services/tts/        Python 3.11 + Chatterbox (FastAPI)      → :4042
├── services/captions/   Node + Remotion caption renderer        → :4043
├── prompts/             ALL LLM prompt templates (editable .md files)
└── storage/             generated media: videos/<id>/{01_images,02_clips,03_audio,04_export}
```

Pipeline per video (each step idempotent, keyed by content hash — retries never regenerate paid assets):

```
topic or URL (Firecrawl scrapes the page + the pages it mentions)
  → script (Ollama / Claude Code / Codex) → [you approve the story]
  → tts (per beat, measures real durations)
  → images (Nano Banana, byte-identical style prefix)
  → clips (fal.ai i2v, length derived from the narration audio)
  → merge (ffmpeg: trim/pad each clip to its beat's audio, concat, mux)
  → captions (Remotion kinetic word captions from forced-alignment timings)
  → [you review in dashboard, download, get a Telegram ping]
```

Postgres is the source of truth (state machine per video); Redis/BullMQ carries only transient jobs; progress streams to the dashboard over SSE.

## Prerequisites

- Node 22+ and pnpm 10 (`corepack enable`)
- Python 3.11 via [uv](https://docs.astral.sh/uv/) (`brew install uv`)
- ffmpeg on PATH (`brew install ffmpeg`)
- PostgreSQL with pgvector on port **5439** (you have the `pgvector-db` container)
- Redis on port **6378** with password `123456` (you have the `redis-mq` container)
- [Ollama](https://ollama.com) with `qwen3.6:latest` and `qwen3-embedding:0.6b` pulled
- Optional for paid story generation: `claude` (Claude Code) and `codex` CLIs on PATH

## Setup

```bash
pnpm install                         # installs all workspaces, builds shared/

# databases (skip if they already exist)
docker exec pgvector-db psql -U postgres -c 'CREATE DATABASE "reel-agent"'
docker exec pgvector-db psql -U postgres -d reel-agent -c 'CREATE EXTENSION IF NOT EXISTS vector'
docker exec pgvector-db psql -U postgres -c 'CREATE DATABASE "reel-agent-test"'      # for api tests
docker exec pgvector-db psql -U postgres -d reel-agent-test -c 'CREATE EXTENSION IF NOT EXISTS vector'

# env files
cp api/.env.example api/.env                       # then fill the keys (see below)
cp frontend/.env.example frontend/.env
cp services/tts/.env.example services/tts/.env
cp services/captions/.env.example services/captions/.env

pnpm migrate                         # applies SQL migrations to reel-agent
```

## Running

```bash
pnpm dev        # api (:4041) + frontend (:4040) + captions (:4043)
pnpm dev:tts    # TTS service (:4042) — separate terminal; first run creates its venv
                # and downloads ~3GB of Chatterbox weights; model load takes ~90s
```

Open http://localhost:4040. The Settings page shows live health for every service and which keys are set.

> The TTS service runs **natively, not in Docker**, because Docker on macOS cannot use the Apple GPU (MPS). A Dockerfile is included in `services/tts/` for future Linux/CUDA deployment.

## Environment variables

### api/.env

| Variable | What it is | Where to get it |
|---|---|---|
| `DATABASE_URL` | Postgres (pgvector) | `postgresql://postgres:postgres@localhost:5439/reel-agent` |
| `REDIS_URL` | Redis for BullMQ | `redis://:123456@localhost:6378` |
| `GEMINI_API_KEY` | Nano Banana image generation | https://aistudio.google.com/apikey — **needs billing enabled** for image models (free tier returns 429) |
| `GEMINI_IMAGE_MODEL` | image model id | default `gemini-2.5-flash-image` |
| `FAL_KEY` | fal.ai image-to-video | https://fal.ai/dashboard/keys |
| `FAL_VIDEO_MODEL` | i2v endpoint | default `minimax/h3-max/image-to-video` |
| `FIRECRAWL_API_KEY` | generate-from-URL scraping | https://www.firecrawl.dev → dashboard → API Keys (`fc-…`) |
| `FIRECRAWL_MAX_LINKED_PAGES` | linked pages also scraped per article | default `4` (each page = 1 credit ≈ $0.005) |
| `OLLAMA_URL` / `OLLAMA_MODEL` / `OLLAMA_EMBED_MODEL` | free local LLM + embeddings | `http://localhost:11434`, `qwen3.6:latest`, `qwen3-embedding:0.6b` |
| `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH` | CLI story generators | `claude` / `codex` (uses your existing logins) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | render-ready notifications | see below |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok inbox upload (parked, optional) | https://developers.tiktok.com/apps — needs Login Kit + Content Posting (`video.upload` scope) |
| `STORAGE_DIR` / `PROMPTS_DIR` | media + prompt template folders | defaults `../storage`, `../prompts` |

### Telegram notifier setup

1. **Bot token** — message `@BotFather` on Telegram, run `/newbot`, copy the HTTP API token.
2. **Chat id** — message `@userinfobot` and copy your numerical **Id**. ⚠️ This is *your* user id, not the bot's id.
3. **Activate the bot** — open a chat with your new bot and press **Start**. If you skip this the bot cannot send you messages (`403 Forbidden`).
4. Fill `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `api/.env`, restart the api, then use **Settings → Send test message**.

You get a message when a render is ready for review and when a pipeline step fails permanently.

### Prompts

Every LLM prompt lives in `prompts/` as a markdown template with `{{placeholders}}`:
`story.system.md`, `story.user.md`, `story.change-request.md`, `topics.system.md`, `topics.user.md`.
Edit them freely — in dev they are re-read on every generation.

## Testing

```bash
pnpm test                                  # api (vitest, uses reel-agent-test DB) + frontend + captions
cd services/tts && .venv/bin/python -m pytest    # TTS service (stubbed model)
RUN_SLOW=1 .venv/bin/python -m pytest            # + real model synthesis test (~3GB download)
pnpm typecheck                             # strict TS across all workspaces
```

## Duplicate-story protection

Every video's topic is embedded (Ollama `qwen3-embedding`, pgvector HNSW index). A new explicit topic is rejected at >0.9 cosine similarity to an existing video; machine-suggested topics are additionally filtered at >0.82, and all existing topics are listed in the suggestion prompt as off-limits.

## Costs

Every AI call is recorded in `generation_runs` (provider, model, tokens, dollars, latency) and shown per video in the dashboard. Rough per-video estimate with defaults: images ~$0.4 (10 × $0.039), clips ~$2.4–4 (fal H3 Max 768p), script $0 (Ollama) to ~$0.10 (Claude/Codex), TTS/captions/merge $0.

## TikTok (parked)

The Content Posting **Inbox Upload** client (`api/src/clients/tiktok.ts`), OAuth routes (`/api/tiktok/connect`) and the publish pipeline step are implemented but not wired into the UI — per docs/pipeline-decisions.md, TikTok's content audit rejects self-upload tools, so Direct Post is a dead end and inbox upload still needs an approved developer app. When you want it: create the app, fill the `TIKTOK_*` keys, and re-enable the publish button in `VideoDetailPage`.
