-- Keep the already-published 20260715170000 migration immutable. These fields
-- were introduced after that migration had been applied to development and
-- deployed databases, so they must advance through a new migration.
BEGIN;

ALTER TABLE "conversation_turns"
    ADD COLUMN "idempotency_request_hash" VARCHAR(64);

-- A legacy turn can retain its idempotency key, but its original normalized
-- request is not reconstructable. Backfill a stable non-replayable hash so a
-- later reuse of that key fails closed instead of creating a duplicate turn.
UPDATE "conversation_turns"
SET "idempotency_request_hash" = encode(
    digest('legacy-unverifiable:' || "id"::text, 'sha256'),
    'hex'
)
WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "conversation_turns"
    ADD CONSTRAINT "conversation_turns_idempotency_request_hash_check" CHECK (
        ("idempotency_key" IS NULL AND "idempotency_request_hash" IS NULL)
        OR
        ("idempotency_key" IS NOT NULL AND "idempotency_request_hash" ~ '^[0-9a-f]{64}$')
    );

ALTER TABLE "conversation_turn_start_intents"
    ADD COLUMN "credential_usage_receipts_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "conversation_turn_start_intents"
    DROP CONSTRAINT "conversation_turn_start_intents_json_shapes_check",
    ADD CONSTRAINT "conversation_turn_start_intents_json_shapes_check" CHECK (
        jsonb_typeof("priority_capability_ids_json") = 'array'
        AND jsonb_typeof("capabilities_json") = 'array'
        AND jsonb_typeof("credential_usage_receipts_json") = 'array'
        AND jsonb_typeof("attachments_json") = 'array'
        AND ("message_display_json" IS NULL OR jsonb_typeof("message_display_json") = 'object')
        AND ("regeneration_json" IS NULL OR jsonb_typeof("regeneration_json") = 'object')
    );

COMMIT;
