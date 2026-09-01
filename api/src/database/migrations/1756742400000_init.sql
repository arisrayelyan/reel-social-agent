-- Up Migration

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE videos (
  id              SERIAL PRIMARY KEY,
  topic           TEXT NOT NULL,
  hook            TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  current_step    TEXT,
  story           JSONB,
  story_versions  JSONB NOT NULL DEFAULT '[]',
  -- qwen3-embedding:0.6b produces 1024-dim vectors
  topic_embedding vector(1024),
  error           TEXT,
  total_cost_usd  NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX videos_status_idx ON videos (status);
CREATE INDEX videos_topic_embedding_idx ON videos
  USING hnsw (topic_embedding vector_cosine_ops);

CREATE TABLE generation_runs (
  id            SERIAL PRIMARY KEY,
  video_id      INT REFERENCES videos(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  prompt        TEXT,
  output        JSONB,
  input_tokens  INT,
  output_tokens INT,
  cost_usd      NUMERIC(10,4) NOT NULL DEFAULT 0,
  duration_ms   INT,
  status        TEXT NOT NULL DEFAULT 'succeeded',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX generation_runs_video_idx ON generation_runs (video_id);

CREATE TABLE assets (
  id               SERIAL PRIMARY KEY,
  video_id         INT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  beat_index       INT,
  kind             TEXT NOT NULL,
  take             INT NOT NULL DEFAULT 1,
  selected         BOOLEAN NOT NULL DEFAULT true,
  content_hash     TEXT NOT NULL,
  file_path        TEXT NOT NULL,
  duration_seconds NUMERIC(8,3),
  prompt           TEXT,
  seed             INT,
  rights_record    JSONB,
  cost_usd         NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, kind, beat_index, content_hash, take)
);

CREATE INDEX assets_video_idx ON assets (video_id);

CREATE TABLE publications (
  id         SERIAL PRIMARY KEY,
  video_id   INT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL DEFAULT 'tiktok',
  publish_id TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  caption    TEXT,
  response   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX publications_video_idx ON publications (video_id);

CREATE TABLE oauth_tokens (
  provider           TEXT PRIMARY KEY,
  access_token       TEXT,
  refresh_token      TEXT,
  open_id            TEXT,
  scope              TEXT,
  expires_at         TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Down Migration

DROP TABLE settings;
DROP TABLE oauth_tokens;
DROP TABLE publications;
DROP TABLE assets;
DROP TABLE generation_runs;
DROP TABLE videos;
