-- Existing artifacts have no activity binding and remain downloadable.
ALTER TABLE "conversation_files"
    ADD COLUMN "desktop_source_path_digest" VARCHAR(64);
