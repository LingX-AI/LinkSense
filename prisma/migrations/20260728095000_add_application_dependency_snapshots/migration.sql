-- Forward-only migration for databases where the application tables were
-- created before dependency snapshot columns were included. The statements
-- are idempotent so a fresh database that already has the columns reaches the
-- same clean schema without rewriting existing snapshots.

BEGIN;

ALTER TABLE "application_capabilities"
    ADD COLUMN IF NOT EXISTS "capability_name_snapshot" VARCHAR(160),
    ADD COLUMN IF NOT EXISTS "capability_type_snapshot" VARCHAR(32);

ALTER TABLE "application_knowledge_bases"
    ADD COLUMN IF NOT EXISTS "knowledge_base_name_snapshot" VARCHAR(160);

UPDATE "application_capabilities" AS "binding"
SET
    "capability_name_snapshot" = "capability"."name",
    "capability_type_snapshot" = "capability"."type"
FROM "capabilities" AS "capability"
WHERE "capability"."id" = "binding"."capability_id"
  AND (
      "binding"."capability_name_snapshot" IS NULL
      OR "binding"."capability_type_snapshot" IS NULL
  );

UPDATE "application_knowledge_bases" AS "binding"
SET "knowledge_base_name_snapshot" = "knowledge_base"."name"
FROM "knowledge_bases" AS "knowledge_base"
WHERE "knowledge_base"."id" = "binding"."knowledge_base_id"
  AND "binding"."knowledge_base_name_snapshot" IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "application_capabilities"
        WHERE "capability_name_snapshot" IS NULL
           OR "capability_type_snapshot" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Cannot backfill application capability snapshots because a referenced capability is unavailable';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "application_knowledge_bases"
        WHERE "knowledge_base_name_snapshot" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Cannot backfill application knowledge base snapshots because a referenced knowledge base is unavailable';
    END IF;
END
$$;

ALTER TABLE "application_capabilities"
    ALTER COLUMN "capability_name_snapshot" SET NOT NULL,
    ALTER COLUMN "capability_type_snapshot" SET NOT NULL;

ALTER TABLE "application_knowledge_bases"
    ALTER COLUMN "knowledge_base_name_snapshot" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "pg_constraint"
        WHERE "conname" = 'application_capabilities_type_check'
          AND "conrelid" = 'application_capabilities'::regclass
    ) THEN
        ALTER TABLE "application_capabilities"
            ADD CONSTRAINT "application_capabilities_type_check" CHECK (
                "capability_type_snapshot" IN ('plugin', 'skill')
            );
    END IF;
END
$$;

COMMIT;
