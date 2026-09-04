-- Up Migration
-- Photographs found in the source page's main content (generate-from-URL):
-- url, local file, alt/caption and the vision-pass description that feeds the
-- story prompt as PHOTO NOTES. jsonb array, never a render asset.
ALTER TABLE videos ADD COLUMN source_images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Down Migration
ALTER TABLE videos DROP COLUMN source_images;
