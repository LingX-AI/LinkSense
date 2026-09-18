BEGIN;

ALTER TABLE "conversation_turn_start_intents"
  ADD COLUMN "development_instructions" TEXT;

-- Development turns previously wrote instructions without an application
-- snapshot. Preserve accepted requests from databases missing the old CHECK.
UPDATE "conversation_turn_start_intents"
SET "development_instructions" = "application_instructions",
    "application_instructions" = NULL
WHERE "application_id" IS NULL
  AND "application_updated_at" IS NULL
  AND "application_instructions" IS NOT NULL;

-- Keep the production constraint unchanged; restore it on drifted databases.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'conversation_turn_start_intents'::regclass
      AND conname = 'conversation_turn_start_intents_application_check'
  ) THEN
    ALTER TABLE "conversation_turn_start_intents"
      ADD CONSTRAINT "conversation_turn_start_intents_application_check" CHECK (
        (
          "application_id" IS NULL
          AND "application_updated_at" IS NULL
          AND "application_instructions" IS NULL
        ) OR (
          "application_id" IS NOT NULL
          AND "application_updated_at" IS NOT NULL
          AND "application_instructions" IS NOT NULL
        )
      );
  END IF;
END $$;

ALTER TABLE "conversation_turn_start_intents"
  ADD CONSTRAINT "conversation_turn_start_intents_development_instructions_check" CHECK (
    "development_instructions" IS NULL OR (
      "application_id" IS NULL
      AND "application_updated_at" IS NULL
      AND "application_instructions" IS NULL
      AND char_length("development_instructions") BETWEEN 1 AND 20000
    )
  );

COMMIT;
