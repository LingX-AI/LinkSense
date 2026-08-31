-- Preserve every existing reservation while making its cleanup target explicit.
-- Invalid historical rows abort the migration instead of being discarded or
-- guessed, so operators can repair the exact row and safely retry.
BEGIN;

ALTER TABLE "knowledge_base_storage_reservations"
  ADD COLUMN "document_id" UUID,
  ADD COLUMN "document_version_id" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "knowledge_base_storage_reservations" AS reservation
    WHERE jsonb_typeof(reservation."object_keys_json") <> 'array'
       OR jsonb_array_length(reservation."object_keys_json") = 0
       OR jsonb_path_exists(
            reservation."object_keys_json",
            '$[*] ? (@.type() != "string")'
          )
  ) THEN
    RAISE EXCEPTION
      'knowledge storage reservation contains a non-string or empty object key suite';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "knowledge_base_storage_reservations" AS reservation
    CROSS JOIN LATERAL jsonb_array_elements_text(
      reservation."object_keys_json"
    ) AS entry(object_key)
    WHERE split_part(entry.object_key, '/', 1) <> 'knowledge-bases'
       OR split_part(entry.object_key, '/', 2) <> reservation."knowledge_base_id"::text
       OR split_part(entry.object_key, '/', 3) <> 'documents'
       OR split_part(entry.object_key, '/', 4) <>
          split_part(reservation."object_keys_json" ->> 0, '/', 4)
       OR split_part(entry.object_key, '/', 5) <> 'versions'
       OR split_part(entry.object_key, '/', 6) <>
          split_part(reservation."object_keys_json" ->> 0, '/', 6)
  ) THEN
    RAISE EXCEPTION
      'knowledge storage reservation object keys do not share one valid target';
  END IF;
END
$$;

UPDATE "knowledge_base_storage_reservations"
SET
  "document_id" = split_part("object_keys_json" ->> 0, '/', 4)::uuid,
  "document_version_id" = split_part("object_keys_json" ->> 0, '/', 6)::uuid;

ALTER TABLE "knowledge_base_storage_reservations"
  ALTER COLUMN "document_id" SET NOT NULL,
  ALTER COLUMN "document_version_id" SET NOT NULL,
  DROP CONSTRAINT "knowledge_base_storage_reservations_object_keys_check",
  ADD CONSTRAINT "knowledge_base_storage_reservations_object_keys_check"
    CHECK (
      jsonb_typeof("object_keys_json") = 'array'
      AND jsonb_array_length("object_keys_json") > 0
      AND NOT jsonb_path_exists(
        "object_keys_json",
        '$[*] ? (@.type() != "string")'
      )
    );

CREATE INDEX "knowledge_base_storage_reservations_target_idx"
  ON "knowledge_base_storage_reservations" (
    "knowledge_base_id",
    "document_id",
    "document_version_id"
  );

COMMIT;
