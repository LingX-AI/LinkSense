-- Additive durable outbox for runner runtime cleanup requests.
-- This migration creates one table and indexes only. It does not delete,
-- rewrite, or constrain any existing rows and intentionally adds no foreign key.

CREATE TABLE "runtime_cleanup_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runtime_cleanup_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "runtime_cleanup_outbox_status_check" CHECK (
        "status" IN ('pending', 'queued', 'failed')
    ),
    CONSTRAINT "runtime_cleanup_outbox_attempt_count_check" CHECK (
        "attempt_count" >= 0
    ),
    CONSTRAINT "runtime_cleanup_outbox_max_attempts_check" CHECK (
        "max_attempts" > 0
    )
);

CREATE UNIQUE INDEX "runtime_cleanup_outbox_conversation_id_key"
    ON "runtime_cleanup_outbox"("conversation_id");

CREATE INDEX "runtime_cleanup_outbox_status_created_idx"
    ON "runtime_cleanup_outbox"("status", "created_at");
