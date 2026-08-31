CREATE TABLE "knowledge_base_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "knowledge_base_id" UUID NOT NULL,
    "parent_entry_id" UUID,
    "entry_type" VARCHAR(32) NOT NULL,
    "name" VARCHAR(260) NOT NULL,
    "normalized_name" VARCHAR(260) NOT NULL,
    "document_id" UUID,
    "source_item_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_base_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_entries_type_check" CHECK (
        "entry_type" IN ('folder', 'document')
    ),
    CONSTRAINT "knowledge_base_entries_target_check" CHECK (
        ("entry_type" = 'folder' AND "document_id" IS NULL) OR
        ("entry_type" = 'document' AND "document_id" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_base_entries_not_self_parent_check" CHECK (
        "parent_entry_id" IS NULL OR "parent_entry_id" <> "id"
    )
);

CREATE UNIQUE INDEX "knowledge_base_entries_root_name_key"
ON "knowledge_base_entries"("knowledge_base_id", "normalized_name")
WHERE "parent_entry_id" IS NULL;

CREATE UNIQUE INDEX "knowledge_base_entries_parent_name_key"
ON "knowledge_base_entries"("knowledge_base_id", "parent_entry_id", "normalized_name")
WHERE "parent_entry_id" IS NOT NULL;

CREATE UNIQUE INDEX "knowledge_base_entries_document_id_key"
ON "knowledge_base_entries"("document_id")
WHERE "document_id" IS NOT NULL;

CREATE UNIQUE INDEX "knowledge_base_entries_source_item_id_key"
ON "knowledge_base_entries"("source_item_id")
WHERE "source_item_id" IS NOT NULL;

CREATE INDEX "knowledge_base_entries_parent_name_idx"
ON "knowledge_base_entries"("knowledge_base_id", "parent_entry_id", "normalized_name");

CREATE INDEX "knowledge_base_entries_base_type_idx"
ON "knowledge_base_entries"("knowledge_base_id", "entry_type");

CREATE INDEX "knowledge_base_entries_parent_idx"
ON "knowledge_base_entries"("parent_entry_id");

CREATE INDEX "knowledge_base_entries_document_idx"
ON "knowledge_base_entries"("document_id");

CREATE INDEX "knowledge_base_entries_source_item_idx"
ON "knowledge_base_entries"("source_item_id");

INSERT INTO "knowledge_base_entries" (
    "id",
    "knowledge_base_id",
    "parent_entry_id",
    "entry_type",
    "name",
    "normalized_name",
    "document_id",
    "source_item_id",
    "created_by",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    document."knowledge_base_id",
    NULL,
    'document',
    document."display_name",
    document."normalized_display_name",
    document."id",
    NULL,
    document."created_by",
    document."created_at",
    document."updated_at"
FROM "knowledge_base_documents" AS document
WHERE document."status" <> 'deleted'
ON CONFLICT DO NOTHING;
