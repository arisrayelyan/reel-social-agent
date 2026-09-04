-- Up Migration
-- Story research: one run per "find me stories" request, N ranked candidates
-- per run, and the producer's like/dislike on each — the feedback that the
-- next research prompt is built from. Candidates carry their own embedding so
-- a new run can be checked against what was already proposed or rejected,
-- not only against videos.

CREATE TABLE research_runs (
  id            SERIAL PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  brief         TEXT,
  count         INT  NOT NULL,
  use_sources   BOOLEAN NOT NULL DEFAULT false,
  prompt        TEXT,
  error         TEXT,
  cost_usd      NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE story_candidates (
  id              SERIAL PRIMARY KEY,
  run_id          INT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  topic           TEXT NOT NULL,
  hook            TEXT NOT NULL,
  year            INT,
  place           TEXT,
  summary         TEXT NOT NULL,
  money_shot      TEXT NOT NULL,
  turn            TEXT NOT NULL,
  kicker          TEXT NOT NULL,
  scores          JSONB NOT NULL,
  risk            TEXT NOT NULL DEFAULT 'low',
  risk_note       TEXT,
  total_score     INT NOT NULL,
  rank            INT NOT NULL,
  source_url      TEXT,
  source_title    TEXT,
  source_status   TEXT NOT NULL DEFAULT 'unchecked' CHECK (source_status IN ('unchecked', 'reachable', 'unreachable')),
  flags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- qwen3-embedding:0.6b, same space as videos.topic_embedding
  embedding       vector(1024),
  feedback        TEXT CHECK (feedback IN ('like', 'dislike')),
  feedback_reason TEXT,
  feedback_note   TEXT,
  feedback_at     TIMESTAMPTZ,
  -- SET NULL, not CASCADE: deleting a video must not erase the feedback that
  -- produced it
  video_id        INT REFERENCES videos(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX story_candidates_run_idx ON story_candidates (run_id);
CREATE INDEX story_candidates_feedback_idx ON story_candidates (feedback) WHERE feedback IS NOT NULL;
CREATE INDEX story_candidates_embedding_idx ON story_candidates
  USING hnsw (embedding vector_cosine_ops);

-- Down Migration
DROP TABLE story_candidates;
DROP TABLE research_runs;
