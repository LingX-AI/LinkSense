-- The immediately preceding owner-runtime migration intentionally truncates
-- the conversation graph, so this required generation column cannot reject
-- or silently coerce any historical conversation row.
ALTER TABLE "conversations"
    ADD COLUMN "runtime_generation" UUID NOT NULL;

CREATE TABLE "conversation_turn_start_intents" (
    "projection_turn_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "runtime_generation" UUID NOT NULL,
    "input_text" TEXT NOT NULL,
    "priority_capability_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "capabilities_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "attachments_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "message_display_json" JSONB,
    "submit_mode" VARCHAR(32) NOT NULL,
    "idempotency_key" VARCHAR(120),
    "preserves_draft" BOOLEAN NOT NULL DEFAULT false,
    "pending_request_id" UUID,
    "regeneration_json" JSONB,
    "audit_ip_address" INET,
    "audit_user_agent" TEXT,
    "runner_status" VARCHAR(32) NOT NULL DEFAULT 'slot_pending',
    "codex_thread_id" TEXT,
    "codex_turn_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turn_start_intents_pkey" PRIMARY KEY ("projection_turn_id"),
    CONSTRAINT "conversation_turn_start_intents_submit_mode_check" CHECK (
        "submit_mode" IN ('normal', 'next_turn', 'manual_retry')
    ),
    CONSTRAINT "conversation_turn_start_intents_runner_status_check" CHECK (
        "runner_status" IN ('slot_pending', 'prepared', 'runner_succeeded', 'release_pending')
    ),
    CONSTRAINT "conversation_turn_start_intents_runner_result_check" CHECK (
        ("runner_status" IN ('slot_pending', 'prepared', 'release_pending') AND "codex_thread_id" IS NULL AND "codex_turn_id" IS NULL)
        OR
        ("runner_status" = 'runner_succeeded' AND "codex_thread_id" IS NOT NULL AND "codex_turn_id" IS NOT NULL)
    ),
    CONSTRAINT "conversation_turn_start_intents_json_shapes_check" CHECK (
        jsonb_typeof("priority_capability_ids_json") = 'array'
        AND jsonb_typeof("capabilities_json") = 'array'
        AND jsonb_typeof("attachments_json") = 'array'
        AND ("message_display_json" IS NULL OR jsonb_typeof("message_display_json") = 'object')
        AND ("regeneration_json" IS NULL OR jsonb_typeof("regeneration_json") = 'object')
    ),
    CONSTRAINT "conversation_turn_start_intents_source_shape_check" CHECK (
        NOT ("pending_request_id" IS NOT NULL AND "regeneration_json" IS NOT NULL)
        AND ("pending_request_id" IS NULL OR "submit_mode" = 'next_turn')
        AND ("regeneration_json" IS NULL OR "submit_mode" = 'manual_retry')
    )
);

CREATE UNIQUE INDEX "conversation_turn_start_intents_conversation_id_key"
    ON "conversation_turn_start_intents"("conversation_id");
CREATE INDEX "conversation_turn_start_intents_owner_created_idx"
    ON "conversation_turn_start_intents"("owner_id", "created_at");
CREATE INDEX "conversation_turn_start_intents_status_created_idx"
    ON "conversation_turn_start_intents"("runner_status", "created_at");
