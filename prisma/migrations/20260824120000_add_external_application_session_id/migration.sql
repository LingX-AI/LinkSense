ALTER TABLE "application_external_sessions"
  ADD COLUMN "external_application_session_id_encrypted" TEXT,
  ADD COLUMN "external_application_session_id_encryption_key_id" VARCHAR(120),
  ADD COLUMN "external_application_session_id_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "application_external_sessions"
  ADD CONSTRAINT "application_external_sessions_external_application_session_id_encryption_check"
  CHECK (
    ("external_application_session_id_encrypted" IS NULL
      AND "external_application_session_id_encryption_key_id" IS NULL
      AND "external_application_session_id_updated_at" IS NULL)
    OR
    ("external_application_session_id_encrypted" IS NOT NULL
      AND "external_application_session_id_encryption_key_id" IS NOT NULL
      AND "external_application_session_id_updated_at" IS NOT NULL)
  );
