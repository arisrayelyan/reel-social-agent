-- Up Migration
ALTER TABLE videos
  ADD COLUMN source_url text,
  ADD COLUMN source_material text;

-- Down Migration
ALTER TABLE videos
  DROP COLUMN source_url,
  DROP COLUMN source_material;
