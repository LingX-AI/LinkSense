ALTER TABLE "application_external_access"
  ADD COLUMN "starter_questions_json" JSONB NOT NULL DEFAULT '[]';
