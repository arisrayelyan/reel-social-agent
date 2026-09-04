-- Up Migration

-- A beat's picture time is filled by several SHOTS (api/src/pipeline/shots.ts),
-- and two crops of one still are a jump cut rather than a cut — so a beat
-- needs one still PER shot slot. `variant` says which slot an asset fills;
-- `take` keeps its existing meaning of alternative attempts at the same slot.
--
-- NOT NULL DEFAULT 0 so every existing row keeps working untouched, and so
-- does every INSERT that does not care about slots (audio, clips, merged).
ALTER TABLE assets
  ADD COLUMN variant INT NOT NULL DEFAULT 0;

-- The uniqueness that makes the pipeline idempotent has to include the slot.
-- Without it, two stills generated for the same beat collide on
-- (video_id, kind, beat_index, content_hash, take) and the second is rejected.
ALTER TABLE assets
  DROP CONSTRAINT assets_video_id_kind_beat_index_content_hash_take_key;

ALTER TABLE assets
  ADD CONSTRAINT assets_video_kind_beat_variant_hash_take_key
  UNIQUE (video_id, kind, beat_index, variant, content_hash, take);

-- Down Migration

ALTER TABLE assets
  DROP CONSTRAINT assets_video_kind_beat_variant_hash_take_key;

ALTER TABLE assets
  ADD CONSTRAINT assets_video_id_kind_beat_index_content_hash_take_key
  UNIQUE (video_id, kind, beat_index, content_hash, take);

ALTER TABLE assets
  DROP COLUMN variant;
