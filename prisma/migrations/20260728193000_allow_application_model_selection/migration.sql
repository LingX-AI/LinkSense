-- Applications may either fix both runtime model settings or delegate both
-- settings to the user. Dropping NOT NULL is backward-compatible and does not
-- preserve every existing application row and setting.

BEGIN;

ALTER TABLE "applications"
    ALTER COLUMN "model" DROP NOT NULL,
    ALTER COLUMN "reasoning_effort" DROP NOT NULL;

ALTER TABLE "applications"
    ADD CONSTRAINT "applications_model_selection_pair_check" CHECK (
        ("model" IS NULL AND "reasoning_effort" IS NULL)
        OR ("model" IS NOT NULL AND "reasoning_effort" IS NOT NULL)
    );

COMMIT;
