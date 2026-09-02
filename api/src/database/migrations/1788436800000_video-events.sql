-- Up Migration
CREATE TABLE video_events (
  id         SERIAL PRIMARY KEY,
  video_id   INT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  step       TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX video_events_video_id_id_idx ON video_events (video_id, id DESC);

-- Down Migration
DROP TABLE video_events;
