-- Historical runtime cleanup state is intentionally not compatible with the
-- staged, leased state machine. The user approved discarding every existing
-- runtime cleanup record before rebuilding the constraints.
DELETE FROM "runtime_cleanup_outbox";

DROP INDEX "runtime_cleanup_outbox_status_created_idx";

ALTER TABLE "runtime_cleanup_outbox"
    DROP CONSTRAINT "runtime_cleanup_outbox_status_check",
    DROP CONSTRAINT "runtime_cleanup_outbox_attempt_count_check",
    DROP CONSTRAINT "runtime_cleanup_outbox_max_attempts_check",
    ALTER COLUMN "max_attempts" SET DEFAULT 8,
    ADD COLUMN "stage" VARCHAR(32) NOT NULL DEFAULT 'reconcile',
    ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "claim_token" UUID,
    ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
    ADD CONSTRAINT "runtime_cleanup_outbox_status_check" CHECK (
        "status" IN ('pending', 'queued', 'running', 'failed')
    ),
    ADD CONSTRAINT "runtime_cleanup_outbox_stage_check" CHECK (
        "stage" IN (
            'reconcile',
            'stop_runtime',
            'delete_workspace',
            'delete_control',
            'verify_absent'
        )
    ),
    ADD CONSTRAINT "runtime_cleanup_outbox_attempt_count_check" CHECK (
        "attempt_count" >= 0
    ),
    ADD CONSTRAINT "runtime_cleanup_outbox_max_attempts_check" CHECK (
        "max_attempts" > 0
    ),
    ADD CONSTRAINT "runtime_cleanup_outbox_claim_lease_check" CHECK (
        ("status" = 'running' AND "claim_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
        OR
        ("status" <> 'running' AND "claim_token" IS NULL AND "lease_expires_at" IS NULL)
    );

CREATE INDEX "runtime_cleanup_outbox_status_next_attempt_idx"
    ON "runtime_cleanup_outbox"("status", "next_attempt_at", "created_at");

CREATE INDEX "runtime_cleanup_outbox_status_lease_idx"
    ON "runtime_cleanup_outbox"("status", "lease_expires_at");
