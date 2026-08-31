-- Preserve only minimal deletion tombstones and immutable citation display
-- snapshots after knowledge content cleanup. This migration is deliberately
-- fail-closed: every historical citation must still resolve to exactly one
-- live knowledge base and document before the new NOT NULL snapshots are set.

BEGIN;

CREATE TABLE "knowledge_base_tombstones" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "deleted_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL,
    "deletion_reason" TEXT NOT NULL,
    "cleanup_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "cleanup_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_tombstones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_tombstones_reason_check" CHECK (
        length(btrim("deletion_reason")) > 0
    ),
    CONSTRAINT "knowledge_base_tombstones_cleanup_status_check" CHECK (
        "cleanup_status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_base_tombstones_cleanup_error_check" CHECK (
        ("cleanup_status" = 'failed' AND "cleanup_error_code" IS NOT NULL)
        OR ("cleanup_status" <> 'failed' AND "cleanup_error_code" IS NULL)
    )
);

CREATE TABLE "knowledge_base_document_tombstones" (
    "id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "deleted_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL,
    "deletion_reason" TEXT NOT NULL,
    "cleanup_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "cleanup_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_document_tombstones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_document_tombstones_reason_check" CHECK (
        length(btrim("deletion_reason")) > 0
    ),
    CONSTRAINT "knowledge_base_document_tombstones_cleanup_status_check" CHECK (
        "cleanup_status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_base_document_tombstones_cleanup_error_check" CHECK (
        ("cleanup_status" = 'failed' AND "cleanup_error_code" IS NOT NULL)
        OR ("cleanup_status" <> 'failed' AND "cleanup_error_code" IS NULL)
    )
);

CREATE INDEX "knowledge_base_tombstones_owner_deleted_idx"
    ON "knowledge_base_tombstones"("owner_id", "deleted_at" DESC);
CREATE INDEX "knowledge_base_tombstones_cleanup_idx"
    ON "knowledge_base_tombstones"("cleanup_status", "updated_at");
CREATE INDEX "knowledge_base_document_tombstones_base_deleted_idx"
    ON "knowledge_base_document_tombstones"("knowledge_base_id", "deleted_at" DESC);
CREATE INDEX "knowledge_base_document_tombstones_cleanup_idx"
    ON "knowledge_base_document_tombstones"("cleanup_status", "updated_at");

-- The reservation reaper scans by this exact keyset.
CREATE INDEX "knowledge_base_storage_reservations_lease_expires_id_idx"
    ON "knowledge_base_storage_reservations"("lease_expires_at", "id");

ALTER TABLE "conversation_message_knowledge_citations"
    ADD COLUMN "knowledge_base_name_snapshot" VARCHAR(160),
    ADD COLUMN "document_name_snapshot" VARCHAR(260);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "conversation_message_knowledge_citations" citation
        LEFT JOIN "knowledge_bases" knowledge_base
          ON knowledge_base."id" = citation."knowledge_base_id"
        LEFT JOIN "knowledge_base_documents" document
          ON document."id" = citation."document_id"
         AND document."knowledge_base_id" = citation."knowledge_base_id"
        LEFT JOIN "knowledge_base_document_versions" version
          ON version."id" = citation."document_version_id"
         AND version."document_id" = citation."document_id"
         AND version."knowledge_base_id" = citation."knowledge_base_id"
        WHERE knowledge_base."id" IS NULL
           OR document."id" IS NULL
           OR version."id" IS NULL
           OR length(btrim(knowledge_base."name")) = 0
           OR length(btrim(document."display_name")) = 0
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'knowledge citation snapshots cannot be backfilled unambiguously',
            ERRCODE = 'check_violation';
    END IF;
END
$$;

UPDATE "conversation_message_knowledge_citations" citation
SET
    "knowledge_base_name_snapshot" = knowledge_base."name",
    "document_name_snapshot" = document."display_name"
FROM "knowledge_bases" knowledge_base,
     "knowledge_base_documents" document
WHERE knowledge_base."id" = citation."knowledge_base_id"
  AND document."id" = citation."document_id"
  AND document."knowledge_base_id" = citation."knowledge_base_id";

ALTER TABLE "conversation_message_knowledge_citations"
    ALTER COLUMN "knowledge_base_name_snapshot" SET NOT NULL,
    ALTER COLUMN "document_name_snapshot" SET NOT NULL,
    ADD CONSTRAINT "conversation_message_knowledge_citations_name_snapshots_check"
      CHECK (
          length(btrim("knowledge_base_name_snapshot")) > 0
          AND length(btrim("document_name_snapshot")) > 0
      );

INSERT INTO "knowledge_base_tombstones" (
    "id", "owner_id", "deleted_by", "deleted_at", "deletion_reason",
    "cleanup_status", "cleanup_error_code", "created_at", "updated_at"
)
SELECT
    "id", "owner_id", "deleted_by", "deleted_at", "deletion_reason",
    "cleanup_status", "cleanup_error_code", "created_at", "updated_at"
FROM "knowledge_bases"
WHERE "lifecycle_status" = 'deleted';

INSERT INTO "knowledge_base_document_tombstones" (
    "id", "knowledge_base_id", "deleted_by", "deleted_at", "deletion_reason",
    "cleanup_status", "cleanup_error_code", "created_at", "updated_at"
)
SELECT
    "id", "knowledge_base_id", "deleted_by", "deleted_at", "deletion_reason",
    "cleanup_status", "cleanup_error_code", "created_at", "updated_at"
FROM "knowledge_base_documents"
WHERE "status" = 'deleted';

-- A previously completed logical deletion needs one final idempotent pass in
-- the new application code so the live rows converge into tombstones. Existing
-- failed/pending/running work is preserved exactly and is not duplicated.
INSERT INTO "knowledge_base_cleanup_outbox" (
    "target_type", "knowledge_base_id", "status", "attempt_count",
    "max_attempts", "next_attempt_at", "created_at", "updated_at"
)
SELECT
    'knowledge_base', knowledge_base."id", 'pending', 0, 10,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "knowledge_bases" knowledge_base
WHERE knowledge_base."lifecycle_status" = 'deleted'
  AND knowledge_base."cleanup_status" = 'completed'
  AND NOT EXISTS (
      SELECT 1
      FROM "knowledge_base_cleanup_outbox" outbox
      WHERE outbox."knowledge_base_id" = knowledge_base."id"
        AND outbox."target_type" = 'knowledge_base'
        AND outbox."status" IN ('pending', 'running', 'failed')
  );

INSERT INTO "knowledge_base_cleanup_outbox" (
    "target_type", "knowledge_base_id", "document_id", "status",
    "attempt_count", "max_attempts", "next_attempt_at", "created_at", "updated_at"
)
SELECT
    'document', document."knowledge_base_id", document."id", 'pending',
    0, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "knowledge_base_documents" document
INNER JOIN "knowledge_bases" knowledge_base
  ON knowledge_base."id" = document."knowledge_base_id"
WHERE document."status" = 'deleted'
  AND document."cleanup_status" = 'completed'
  AND knowledge_base."lifecycle_status" <> 'deleted'
  AND NOT EXISTS (
      SELECT 1
      FROM "knowledge_base_cleanup_outbox" outbox
      WHERE outbox."knowledge_base_id" = document."knowledge_base_id"
        AND outbox."document_id" = document."id"
        AND outbox."target_type" = 'document'
        AND outbox."status" IN ('pending', 'running', 'failed')
  );

-- Completed outbox rows are not audit records. The fresh convergence work
-- above preserves any still-needed cleanup before old completed rows vanish.
DELETE FROM "knowledge_base_cleanup_outbox"
WHERE "status" = 'completed';

COMMIT;
