-- Shapes of the values replaced in a request (kind, length, location),
-- never the values themselves. Rows recorded before this column keep an
-- empty list.
ALTER TABLE "user_privacy_masking_records"
    ADD COLUMN "hints" JSONB NOT NULL DEFAULT '[]';
