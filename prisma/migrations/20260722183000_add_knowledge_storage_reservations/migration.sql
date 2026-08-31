CREATE TABLE "knowledge_base_storage_reservations" (
  "id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "object_keys_json" JSONB NOT NULL,
  "lease_token" UUID NOT NULL,
  "lease_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "cleanup_started_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "knowledge_base_storage_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_base_storage_reservations_size_check"
    CHECK ("size_bytes" >= 0),
  CONSTRAINT "knowledge_base_storage_reservations_object_keys_check"
    CHECK (
      jsonb_typeof("object_keys_json") = 'array'
      AND jsonb_array_length("object_keys_json") > 0
    )
);

CREATE INDEX "knowledge_base_storage_reservations_expires_idx"
  ON "knowledge_base_storage_reservations" ("expires_at", "id");

CREATE INDEX "knowledge_base_storage_reservations_base_expires_idx"
  ON "knowledge_base_storage_reservations" ("knowledge_base_id", "expires_at");

CREATE INDEX "knowledge_base_storage_reservations_object_keys_idx"
  ON "knowledge_base_storage_reservations" USING GIN ("object_keys_json");

-- Before this migration only original objects were charged and the reserved
-- counter had no durable producer. Rebuild both counters from the manifest so
-- every still-managed object starts from one exact, non-destructive baseline.
UPDATE "knowledge_bases" AS kb
SET
  "storage_used_bytes" = COALESCE((
    SELECT SUM(obj."size_bytes")
    FROM "knowledge_base_objects" AS obj
    WHERE obj."knowledge_base_id" = kb."id"
      AND obj."lifecycle_status" <> 'cleaned'
  ), 0),
  "storage_reserved_bytes" = 0,
  "updated_at" = CURRENT_TIMESTAMP;
