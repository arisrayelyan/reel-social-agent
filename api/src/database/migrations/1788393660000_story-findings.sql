-- Up Migration
-- Structured output of the story quality gate (api/src/utils/storyValidate.ts).
-- NOT NULL DEFAULT '[]' so existing rows and every INSERT keep working
-- untouched; only the SELECT/RETURNING column lists need the new name.
ALTER TABLE videos
  ADD COLUMN story_findings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Down Migration
ALTER TABLE videos
  DROP COLUMN story_findings;
