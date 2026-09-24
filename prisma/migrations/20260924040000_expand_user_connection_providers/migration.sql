-- Expand the provider allowlist without changing existing rows, grants or indexes.
-- Keep the replacement atomic so no writes bypass provider validation.
BEGIN;

ALTER TABLE "user_connections"
  DROP CONSTRAINT "user_connections_provider_check",
  ADD CONSTRAINT "user_connections_provider_check"
    CHECK ("provider" IN ('onedrive', 'sharepoint', 'google_docs', 'gmail', 'outlook'));

COMMIT;
